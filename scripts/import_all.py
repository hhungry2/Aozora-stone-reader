"""Resumable, bounded-memory import of the current official public-domain catalog.

Only explicit なし flags on every work/person row are eligible. The index is the
allowlist, never a recursive scrape of the website or an unfiltered mirror.
"""
from __future__ import annotations

import concurrent.futures
import gzip
import json
import time
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

import import_books as core

STAGE = core.CACHE / "converted"
WORKER_FETCHER = None
CATALOG_KEYS = ("id", "title", "titleKana", "subtitle", "authors", "authorLabel", "cardUrl", "dataPath", "contentVersion", "characterCount", "excerpt", "features")


def eligible_works(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["作品ID"]].append(row)
    return {identifier: matches for identifier, matches in sorted(grouped.items())
            if all(row["作品著作権フラグ"] == "なし" and row["人物著作権フラグ"] == "なし" for row in matches)}


def fingerprint(matches):
    return core.sha256(json.dumps(matches, ensure_ascii=False, sort_keys=True).encode("utf-8"))


def encoded_json(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def read_book(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == ".gz" else raw)


def unavailable_entry(identifier, matches, reason):
    row = matches[0]
    authors = core.people(matches)
    return {
        "id": identifier, "title": row["作品名"], "titleKana": row["作品名読み"],
        "subtitle": row["副題"], "authors": authors,
        "authorLabel": "・".join(person["name"] for person in authors),
        "cardUrl": row["図書カードURL"].replace("http://", "https://"),
        "dataPath": "", "contentVersion": "", "characterCount": 0,
        "excerpt": "", "features": [], "availability": "source-only", "unavailableReason": reason,
        "orthography": row["文字遣い種別"],
    }


def unavailable_record(entry, matches, reason):
    return {"id": entry["id"], "title": entry["title"], "cardUrl": entry["cardUrl"], "reason": reason,
            "workCopyright": matches[0]["作品著作権フラグ"],
            "people": [{"id": row["人物ID"], "copyright": row["人物著作権フラグ"], "role": row["役割フラグ"]} for row in matches],
            "metadataSha256": fingerprint(matches)}


def convert_one(identifier, matches, fetcher):
    checksum = fingerprint(matches)
    checkpoint = STAGE / f"{identifier}.audit.json"
    plain = identifier in {key for key, _ in core.SELECTION}
    suffix = ".json" if plain else ".json.gz"
    output = STAGE / (identifier + suffix)
    if checkpoint.exists() and output.exists() and not fetcher.refresh:
        try:
            saved = json.loads(checkpoint.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            saved = {}
        if saved.get("metadataSha256") == checksum and saved.get("conversionVersion") == core.VERSION and saved.get("outputSha256") == core.sha256(output.read_bytes()):
            reconvert_images = False
            if saved["audit"].get("imageCount"):
                book = read_book(output)
                assets = [asset for block in book["blocks"] for asset in [*block["inlineImages"], *([block["image"]] if block.get("image") else [])]]
                reconvert_images = book["conversion"].get("illustrationsVersion") != 1 and any("/cards/" in asset["sourceUrl"] for asset in assets)
                for asset in assets:
                    destination = core.ROOT / "public" / asset["src"]
                    if not destination.is_file():
                        image_suffix = Path(urllib.parse.urlparse(asset["sourceUrl"]).path).suffix.lower()
                        raw, _ = fetcher.get(asset["sourceUrl"], "images/" + core.sha256(asset["sourceUrl"].encode())[:16] + image_suffix)
                        if destination.name != core.sha256(raw)[:16] + image_suffix:
                            raise ValueError("Cached image changed; refresh this work")
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_bytes(raw)
            if not reconvert_images:
                return saved["entry"], saved["audit"], output
    book, audit = core.import_book(identifier, matches[0]["作品名"], matches, fetcher)
    book["dataPath"] = f"data/books/{identifier}{suffix}"
    entry = {key: book[key] for key in CATALOG_KEYS}
    entry["availability"] = "available"
    entry["orthography"] = matches[0]["文字遣い種別"]
    book.update({key: entry[key] for key in ("availability", "orthography")})
    raw = encoded_json(book)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw if plain else gzip.compress(raw, compresslevel=9, mtime=0))
    core.write_json(checkpoint, {"metadataSha256": checksum, "conversionVersion": core.VERSION,
                               "outputSha256": core.sha256(output.read_bytes()), "entry": entry, "audit": audit})
    return entry, audit, output


def initialize_worker(offline, refresh):
    global WORKER_FETCHER
    WORKER_FETCHER = core.Fetcher(offline, refresh, request_interval=1)


def convert_job(identifier, matches):
    try:
        return convert_one(identifier, matches, WORKER_FETCHER)
    except Exception as error:
        # HTTPError can contain an open response that cannot cross the process
        # boundary. Preserve its useful status/URL in a serializable exception.
        raise ValueError(f"{type(error).__name__}: {error}") from None


def publish_book(output, destination):
    raw = output.read_bytes()
    if destination.is_file() and destination.read_bytes() == raw:
        return
    temporary = destination.with_name(destination.name + ".tmp")
    temporary.write_bytes(raw)
    try:
        for attempt in range(5):
            try:
                temporary.replace(destination)
                return
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * 2 ** attempt)
    finally:
        temporary.unlink(missing_ok=True)


def write_all_report(catalog, audits, index, failures, elapsed):
    available = [entry for entry in catalog if entry.get("availability") == "available"]
    sizes = Counter()
    for path in core.DATA.rglob("*"):
        if path.is_file():
            sizes["bytes"] += path.stat().st_size
    summary = {
        "schemaVersion": 1, "scope": "all-public-domain", "index": index,
        "eligibleCount": len(catalog), "readableCount": len(available), "sourceOnlyCount": len(failures),
        "personCount": len({person["id"] for entry in catalog for person in entry["authors"]}),
        "characterCount": sum(entry["characterCount"] for entry in available),
        "dataBytes": sizes["bytes"], "conversionSeconds": round(elapsed, 1), "unavailableWorks": failures,
    }
    core.write_json(core.DATA / "import-status.json", summary)
    lines = ["# 全著作権切れ作品の取り込み記録", "",
             "公式の公開作品CSVを作品ID単位でまとめ、作品および全関係人物の著作権フラグが明示的に「なし」の作品を対象にした。版・表記が異なる作品IDは統合しない。",
             "", f"- 一覧・検索対象: {len(catalog):,}作品", f"- 本文の取り込み・検証済み: {len(available):,}作品",
             f"- 本文を同梱できない作品: {len(failures):,}作品（検索結果から公式図書カードに案内）",
             f"- 本文: {summary['characterCount']:,}文字", f"- データ容量: {sizes['bytes']:,} bytes",
             f"- 公式CSV: {index['url']}", f"- 取得: {index['fetchedAt']}", f"- CSV ZIP SHA-256: `{index['sha256']}`",
             f"- 変換器: `{core.VERSION}`", "",
             "本文・ルビの親文字と読み・画像数・UTF-16範囲・Unicode外字の逆変換・目次リンク・出典を作品ごとに検証する。未対応の配置は本文を保持して簡略化し、作品情報に記録する。原文の欠落を検知した作品は収録成功として扱わない。",
             "", "大規模な本文データは決定的なgzip形式で保存し、開いた作品だけブラウザで展開する。挿絵・図版は独立したページで表示する。既存40作品のJSON形式と作品IDは保持する。個々の監査結果は `public/data/import-manifest.json`、未収録理由は `public/data/import-status.json` に記録する。",
             "", "## 本文を同梱できない作品", "", "| ID | 作品 | 理由 |", "| --- | --- | --- |"]
    for failure in failures:
        reason = failure["reason"].replace("|", "／").replace("\n", " ")
        title = failure["title"].replace("|", "／")
        lines.append(f"| {failure['id']} | [{title}]({failure['cardUrl']}) | {reason} |")
    lines += ["", "## 再実行", "", "```sh", "python -m pip install -r scripts/requirements.txt",
              "python scripts/import_books.py --all", "python scripts/import_books.py --all --offline",
              "python scripts/import_books.py --validate-only", "```", "",
              "成功した作品は `.cache/aozora/converted/` にチェックポイントを保存し、同じCSV行・変換器・出力ハッシュなら次回は再利用する。失敗した作品は再試行する。`--refresh` は公式データを再取得して変換する。`--limit N` は診断用で、公開用カタログを更新しない。通常のWebビルドは取り込みを実行せず、同梱データを使用する。"]
    lines += ["", "## 出典・利用条件", "",
              "本文・底本・入力者・校正者情報は青空文庫提供。各作品に原文URLと制作情報を保持し、[収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html)に従う。書誌データは青空文庫提供の[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。本アプリでは書誌項目の抽出、XHTMLからJSONへの変換、段落化、ルビ・注記の範囲化、外字のUnicode化、図版のページ化、圧縮を行っている。"]
    (core.ROOT / "docs" / "import-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_all(args):
    if not 1 <= args.workers <= 8:
        raise ValueError("--workers must be between 1 and 8")
    started = time.monotonic()
    # The index is fetched once. Each conversion process permits one network
    # request/second, with at most eight processes and bounded submission.
    fetcher = core.Fetcher(args.offline, args.refresh, request_interval=0.25)
    rows, index = core.load_index(fetcher)
    works = eligible_works(rows)
    core.write_json(core.CACHE / "eligible-works.json", {"index": index, "count": len(works), "ids": list(works)})
    print(f"Public-domain candidates: {len(works):,} of {len({row['作品ID'] for row in rows}):,} work IDs", flush=True)
    entries, audits, outputs, failures = {}, {}, {}, {}
    jobs = []
    for identifier, matches in works.items():
        url = matches[0]["XHTML/HTMLファイルURL"]
        if not url or urllib.parse.urlparse(url).netloc != "www.aozora.gr.jp":
            reason = "公式サイトにHTML本文がありません" if not url else "本文の提供先が青空文庫の公式サイト外です"
            entry = unavailable_entry(identifier, matches, reason)
            entries[identifier] = entry
            failures[identifier] = unavailable_record(entry, matches, reason)
        else:
            jobs.append((identifier, matches))
    if args.limit is not None:
        jobs = jobs[:args.limit]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers,
            initializer=initialize_worker, initargs=(args.offline, args.refresh)) as pool:
        # Submit a bounded number of futures: completed books are written on disk,
        # and only small catalog entries/audits remain in memory.
        pending = {}
        iterator = iter(jobs)
        done_count = 0
        while True:
            while len(pending) < args.workers * 2:
                job = next(iterator, None)
                if job is None:
                    break
                identifier, matches = job
                pending[pool.submit(convert_job, identifier, matches)] = (identifier, matches)
            if not pending:
                break
            completed, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in completed:
                identifier, matches = pending.pop(future)
                try:
                    entry, audit, output = future.result()
                    entries[identifier], audits[identifier], outputs[identifier] = entry, audit, output
                except Exception as error:
                    reason = f"{type(error).__name__}: {error}"
                    entry = unavailable_entry(identifier, matches, "本文の取り込みを完了できませんでした")
                    entries[identifier] = entry
                    failures[identifier] = unavailable_record(entry, matches, reason)
                    print(f"FAILED {identifier}: {reason}", flush=True)
                done_count += 1
                if done_count % 100 == 0 or done_count == len(jobs):
                    core.write_json(core.CACHE / "import-progress.json", {"done": done_count, "total": len(jobs), "success": len(outputs), "failures": list(failures.values()), "elapsedSeconds": round(time.monotonic() - started)})
                    print(f"{done_count:,}/{len(jobs):,}: {len(outputs):,} validated, {len(failures):,} unavailable, {time.monotonic()-started:.0f}s", flush=True)
    if args.limit is not None:
        print("Diagnostic batch finished; public catalog was not replaced.", flush=True)
        return
    catalog = [entries[identifier] for identifier in works]
    ordered_failures = [failures[identifier] for identifier in works if identifier in failures]
    for identifier, output in outputs.items():
        destination = core.ROOT / "public" / entries[identifier]["dataPath"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        publish_book(output, destination)
    retained = {Path(entry["dataPath"]).name for entry in catalog if entry["dataPath"]}
    book_directory = (core.DATA / "books").resolve()
    for stale in book_directory.iterdir():
        if stale.is_file() and stale.name.endswith((".json", ".json.gz")) and stale.name not in retained:
            if stale.resolve().parent != book_directory:
                raise ValueError("Refusing to remove an output outside the book directory")
            stale.unlink()
    core.write_json(core.DATA / "catalog.json", catalog)
    (core.DATA / "catalog.json.gz").write_bytes(gzip.compress(encoded_json(catalog), compresslevel=9, mtime=0))
    ordered_audits = [audits[identifier] for identifier in works if identifier in audits]
    core.write_json(core.DATA / "import-manifest.json", {"schemaVersion": 1, "scope": "all-public-domain", "conversionVersion": core.VERSION,
                    "index": index, "eligibleIds": list(works), "works": ordered_audits, "unavailableWorks": ordered_failures})
    write_all_report(catalog, ordered_audits, index, ordered_failures, time.monotonic() - started)
    validate_all()


def validate_all():
    manifest = json.loads((core.DATA / "import-manifest.json").read_text(encoding="utf-8"))
    catalog = json.loads((core.DATA / "catalog.json").read_text(encoding="utf-8"))
    ids = [entry["id"] for entry in catalog]
    if ids != manifest["eligibleIds"] or len(set(ids)) != len(ids):
        raise ValueError("Catalog does not cover the eligible IDs exactly once")
    audits = {audit["id"]: audit for audit in manifest["works"]}
    unavailable = {entry["id"] for entry in manifest["unavailableWorks"]}
    for record in [*manifest["works"], *manifest["unavailableWorks"]]:
        if record["workCopyright"] != "なし" or any(person["copyright"] != "なし" for person in record["people"]):
            raise ValueError("Copyright check failed")
    if set(audits) & unavailable or set(audits) | unavailable != set(ids):
        raise ValueError("Every eligible work must have a validated text or an explicit unavailability record")
    if json.loads(gzip.decompress((core.DATA / "catalog.json.gz").read_bytes())) != catalog:
        raise ValueError("Compressed catalog differs from the source catalog")
    validated = 0
    for entry in catalog:
        if entry["id"] in unavailable:
            if entry.get("availability") != "source-only" or entry["dataPath"]:
                raise ValueError("Unavailable work exposes a book data path")
            continue
        audit = audits[entry["id"]]
        if audit["workCopyright"] != "なし" or any(person["copyright"] != "なし" for person in audit["people"]):
            raise ValueError("Copyright check failed")
        book = read_book(core.ROOT / "public" / entry["dataPath"])
        if any(book[key] != value for key, value in entry.items()):
            raise ValueError(f"Catalog differs from book {entry['id']}")
        core.validate_book(book, audit)
        validated += 1
        if validated % 2000 == 0:
            print(f"Verified source and annotations: {validated:,}/{len(audits):,}", flush=True)
    print(f"Validated {len(audits):,} complete books; all {len(ids):,} eligible works are searchable ({len(unavailable):,} source-only).", flush=True)
