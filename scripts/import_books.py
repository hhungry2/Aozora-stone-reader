#!/usr/bin/env python3
"""Import the curated shelf from the official Aozora Bunko XHTML and CSV.

The website build needs no Python or network access: committed public/data files
are the runtime input. Run `python scripts/import_books.py --offline` to repeat
conversion from .cache, or `--validate-only` to check the committed output.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "aozora"
DATA = ROOT / "public" / "data"
CSV_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"
VERSION = "aozora-xhtml-1.0.0"
# Explicit IDs avoid accidentally switching editions when the official index grows.
SELECTION = (
    ("000127", "羅生門"), ("000042", "鼻"), ("000092", "蜘蛛の糸"),
    ("043015", "杜子春"), ("043016", "トロッコ"), ("000069", "河童"),
    ("000179", "藪の中"), ("001567", "走れメロス"), ("000270", "富嶽百景"),
    ("000277", "駈込み訴え"), ("043754", "注文の多い料理店"),
    ("000456", "銀河鉄道の夜"), ("000470", "セロ弾きのゴーシュ"),
    ("043752", "どんぐりと山猫"), ("000473", "よだかの星"),
    ("000789", "吾輩は猫である"), ("000799", "夢十夜"),
    ("000752", "坊っちゃん"), ("000424", "檸檬"), ("000624", "山月記"),
)
ASCII_SPACE = re.compile(r"[ \t\r\n\f]+")
BLOCK_TAGS = {"div", "p", "blockquote", "section", "li", "ul", "ol"}
KNOWN_CLASSES = {
    "main_text", "midashi_anchor", "naka-midashi", "o-midashi", "ko-midashi",
    "gaiji", "notes", "sesame_dot", "white_sesame_dot", "black_circle",
    "white_circle", "black_triangle", "white_triangle", "double_circle",
    "bullseye", "sesame", "subscript", "superscript",
}
EMPHASIS_CLASSES = {
    "sesame_dot", "white_sesame_dot", "black_circle", "white_circle",
    "black_triangle", "white_triangle", "double_circle", "bullseye",
}
UNSUPPORTED_LAYOUT = ("chitsuki_", "jizume_", "keigakomi")


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def utc_timestamp(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")


class Fetcher:
    def __init__(self, offline: bool, refresh: bool):
        self.offline = offline
        self.refresh = refresh

    def get(self, url: str, name: str) -> tuple[bytes, str]:
        url = url.replace("http://www.aozora.gr.jp/", "https://www.aozora.gr.jp/")
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "www.aozora.gr.jp":
            raise ValueError(f"Only the official HTTPS origin is allowed: {url}")
        path = CACHE / name
        meta = path.with_suffix(path.suffix + ".meta.json")
        if self.refresh or not path.exists():
            if self.offline:
                raise FileNotFoundError(f"Missing cached source: {path}")
            request = urllib.request.Request(url, headers={"User-Agent": "Aozora-stone-reader/1.0 (curated literature importer)"})
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            write_json(meta, {"url": url, "fetchedAt": utc_timestamp(path), "sha256": sha256(data)})
        data = path.read_bytes()
        if meta.exists():
            provenance = json.loads(meta.read_text(encoding="utf-8"))
            if provenance["url"] != url or provenance["sha256"] != sha256(data):
                raise ValueError(f"Cached source provenance mismatch: {path}")
            fetched_at = provenance["fetchedAt"]
        else:
            fetched_at = utc_timestamp(path)
            write_json(meta, {"url": url, "fetchedAt": fetched_at, "sha256": sha256(data)})
        return data, fetched_at


def load_index(fetcher: Fetcher) -> tuple[list[dict[str, str]], dict[str, Any]]:
    raw, fetched_at = fetcher.get(CSV_URL, "catalog.zip")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = [name for name in archive.namelist() if name.endswith(".csv")]
        if len(names) != 1:
            raise ValueError("Expected exactly one CSV in official index")
        text = archive.read(names[0]).decode("utf-8-sig", errors="strict")
    (CACHE / "catalog.csv").write_text(text, encoding="utf-8")
    return list(csv.DictReader(io.StringIO(text))), {"url": CSV_URL, "fetchedAt": fetched_at, "sha256": sha256(raw)}


def decode_source(raw: bytes) -> tuple[str, str]:
    match = re.search(br"(?:encoding|charset)\s*=\s*[\"']?([A-Za-z0-9_-]+)", raw[:1500], re.I)
    encoding = match.group(1).decode("ascii") if match else "Shift_JIS"
    text = raw.decode(encoding, errors="strict")
    if "\ufffd" in text:
        raise ValueError("Replacement character in decoded source")
    return text, encoding


def logical_text(node: Tag) -> str:
    """Independent text oracle: remove readings and preserve every source glyph.

    Structural boundaries and HTML whitespace do not count as glyphs. Images are
    represented by one object-replacement character, exactly as in TextBlock.
    """
    duplicate = copy.deepcopy(node)
    for unwanted in list(duplicate.find_all(["rt", "rp", "script", "style"])):
        unwanted.decompose()
    for comment in duplicate.find_all(string=lambda item: isinstance(item, Comment)):
        comment.extract()
    for picture in duplicate.find_all("img"):
        picture.replace_with("\ufffc")
    return ASCII_SPACE.sub("", duplicate.get_text())


def ruby_fingerprint(pairs: list[tuple[str, str]]) -> str:
    return sha256(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode())


class Converter:
    def __init__(self, source_url: str, fetcher: Fetcher):
        self.source_url = source_url
        self.fetcher = fetcher
        self.blocks: list[dict[str, Any]] = []
        self.warnings: set[str] = set()
        self.images: dict[str, dict[str, str]] = {}
        self.text = ""
        self.rubies: list[dict[str, Any]] = []
        self.emphasis: list[dict[str, Any]] = []
        self.inline_images: list[dict[str, Any]] = []
        self.indent = 0
        self.kind = "paragraph"
        self.level: int | None = None

    @property
    def offset(self) -> int:
        return utf16_length(self.text)

    def append(self, text: str) -> None:
        text = ASCII_SPACE.sub(" ", text)
        if not self.text or self.text.endswith(" "):
            text = text.lstrip(" ")
        self.text += text

    def flush(self) -> None:
        self.text = self.text.rstrip(" ")
        if self.text:
            limit = self.offset
            block: dict[str, Any] = {
                "id": f"b{len(self.blocks) + 1:05d}", "kind": self.kind,
                "text": self.text, "rubies": self.rubies, "emphasis": self.emphasis,
                "inlineImages": self.inline_images, "indent": self.indent,
            }
            if self.level is not None:
                block["level"] = self.level
            for key in ("rubies", "emphasis", "inlineImages"):
                for item in block[key]:
                    if item["end"] > limit:
                        raise ValueError("An annotation crossed discarded structural whitespace")
            self.blocks.append(block)
        self.text, self.rubies, self.emphasis, self.inline_images = "", [], [], []

    def image(self, tag: Tag) -> dict[str, str]:
        url = urllib.parse.urljoin(self.source_url, str(tag.get("src", "")))
        if url not in self.images:
            suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
            if suffix not in {".png", ".gif", ".jpg", ".jpeg", ".webp"}:
                raise ValueError(f"Unsupported image format: {url}")
            raw, _ = self.fetcher.get(url, "images/" + sha256(url.encode())[:16] + suffix)
            filename = sha256(raw)[:16] + suffix
            destination = DATA / "images" / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            self.images[url] = {"src": "data/images/" + filename, "sourceUrl": url}
        return {**self.images[url], "alt": str(tag.get("alt", "青空文庫の画像"))}

    def visit(self, node: Any) -> None:
        if isinstance(node, Comment):
            return
        if isinstance(node, NavigableString):
            self.append(str(node))
            return
        if not isinstance(node, Tag):
            return
        name = node.name.lower()
        classes = [str(value).lower() for value in node.get("class", [])]
        for cls in classes:
            if cls.startswith(UNSUPPORTED_LAYOUT):
                self.warnings.add(f"レイアウト {cls} は本文と段落を保持し、配置のみ簡略化")
            elif cls not in KNOWN_CLASSES and not re.fullmatch(r"jisage_\d+", cls):
                self.warnings.add(f"未対応クラス {cls}: 内容をそのまま保持")
        if name in {"script", "style"}:
            raise ValueError(f"Executable content inside main_text: {name}")
        if name in {"rt", "rp"}:
            return
        if name == "br":
            self.flush()
            return
        if name == "img":
            start = self.offset
            asset = self.image(node)
            self.append("\ufffc")
            self.inline_images.append({**asset, "start": start, "end": self.offset})
            return
        if name == "ruby":
            bases = node.find_all("rb", recursive=False)
            readings = node.find_all("rt", recursive=False)
            if len(bases) != 1 or len(readings) != 1:
                raise ValueError("Only an unambiguous rb/rt pair is accepted; source needs review")
            start = self.offset
            self.visit(bases[0])
            reading = readings[0].get_text().strip()
            if start == self.offset or not reading:
                raise ValueError("Empty ruby base or reading")
            self.rubies.append({"start": start, "end": self.offset, "reading": reading})
            return
        if "notes" in classes:
            self.warnings.add("青空文庫の校訂注記を本文中にそのまま保持")
        if name in {"sub", "sup"}:
            self.warnings.add(f"{name} の文字は保持し、上下位置のみ簡略化")
        if name not in BLOCK_TAGS | {"h1", "h2", "h3", "h4", "h5", "h6", "span", "rb", "a", "em", "strong", "sub", "sup", "i", "b"}:
            self.warnings.add(f"未対応タグ {name}: 内容をそのまま保持")
        heading = bool(re.fullmatch(r"h[1-6]", name))
        structural = heading or name in BLOCK_TAGS
        old_indent, old_kind, old_level = self.indent, self.kind, self.level
        if structural:
            self.flush()
            for cls in classes:
                match = re.fullmatch(r"jisage_(\d+)", cls)
                if match:
                    self.indent += int(match.group(1))
            if heading:
                self.kind = "heading"
                self.level = {"o-midashi": 1, "naka-midashi": 2, "ko-midashi": 3}.get(next((cls for cls in classes if "midashi" in cls), ""), max(1, int(name[1]) - 2))
        start = self.offset
        for child in node.children:
            self.visit(child)
        marked = next((cls for cls in classes if cls in EMPHASIS_CLASSES), None)
        if marked and self.offset > start:
            self.emphasis.append({"start": start, "end": self.offset, "kind": marked})
        if structural:
            self.flush()
            self.indent, self.kind, self.level = old_indent, old_kind, old_level

    def convert(self, body: Tag) -> list[dict[str, Any]]:
        self.visit(body)
        self.flush()
        actual = ASCII_SPACE.sub("", "".join(block["text"] for block in self.blocks))
        expected = logical_text(body)
        if actual != expected:
            mismatch = next((i for i, (a, b) in enumerate(zip(actual, expected)) if a != b), min(len(actual), len(expected)))
            raise ValueError(f"Source completeness check failed at glyph {mismatch}: {actual[mismatch:mismatch+30]!r} vs {expected[mismatch:mismatch+30]!r}")
        return self.blocks


def people(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    grouped: dict[str, dict[str, str]] = {}
    roles: dict[str, list[str]] = {}
    for row in rows:
        identifier = row["人物ID"]
        grouped[identifier] = {
            "id": identifier, "name": row["姓"] + row["名"],
            "kana": row["姓読み"] + row["名読み"], "role": "",
        }
        roles.setdefault(identifier, [])
        if row["役割フラグ"] not in roles[identifier]:
            roles[identifier].append(row["役割フラグ"])
    return [{**person, "role": "・".join(roles[identifier])} for identifier, person in grouped.items()]


def import_book(identifier: str, title: str, rows: list[dict[str, str]], fetcher: Fetcher) -> tuple[dict[str, Any], dict[str, Any]]:
    matches = [row for row in rows if row["作品ID"] == identifier]
    if not matches:
        raise ValueError(f"Work missing from official index: {identifier}")
    for row in matches:
        if row["作品名"] != title:
            raise ValueError(f"Edition/title mismatch for {identifier}")
        if row["作品著作権フラグ"] != "なし" or row["人物著作権フラグ"] != "なし":
            raise ValueError(f"Copyright flag is not explicitly なし for {identifier}, person {row['人物ID']}")
    row = matches[0]
    url = row["XHTML/HTMLファイルURL"].replace("http://", "https://")
    raw, fetched_at = fetcher.get(url, identifier + ".html")
    text, encoding = decode_source(raw)
    soup = BeautifulSoup(text, "html.parser")
    bodies = soup.select(".main_text")
    if len(bodies) != 1:
        raise ValueError(f"Expected one main_text in {identifier}")
    credits = soup.select_one(".bibliographical_information")
    if credits is None:
        raise ValueError(f"Credits missing from {identifier}")
    converter = Converter(url, fetcher)
    blocks = converter.convert(bodies[0])
    authors = people(matches)
    features = []
    if any(block["rubies"] for block in blocks):
        features.append("ルビ")
    if any(block["emphasis"] for block in blocks):
        features.append("傍点")
    if any(block["inlineImages"] for block in blocks):
        features.append("外字画像")
    toc = [{"title": block["text"], "blockId": block["id"], "level": block["level"]} for block in blocks if block["kind"] == "heading"]
    if toc:
        features.append("目次")
    character_count = sum(len(block["text"]) for block in blocks)
    if character_count > 80000:
        features.append("長編")
    version_payload = {"version": VERSION, "source": sha256(raw), "metadata": matches}
    content_version = sha256(json.dumps(version_payload, ensure_ascii=False, sort_keys=True).encode())[:16]
    entry = {
        "id": identifier, "title": title, "titleKana": row["作品名読み"],
        "subtitle": row["副題"], "authors": authors,
        "authorLabel": "・".join(person["name"] for person in authors),
        "cardUrl": row["図書カードURL"].replace("http://", "https://"),
        "dataPath": f"data/books/{identifier}.json", "contentVersion": content_version,
        "characterCount": character_count,
        "excerpt": next(block["text"].replace("\ufffc", "※")[:90] for block in blocks if block["kind"] == "paragraph"),
        "features": features,
    }
    book = {
        **entry, "schemaVersion": 1, "blocks": blocks, "toc": toc,
        "credits": credits.get_text("\n", strip=True),
        "source": {"url": url, "fetchedAt": fetched_at, "sha256": sha256(raw), "encoding": encoding},
        "conversion": {"version": VERSION, "warnings": sorted(converter.warnings)},
    }
    audit = {
        "id": identifier, "title": title, "orthography": row["文字遣い種別"],
        "workCopyright": row["作品著作権フラグ"],
        "people": [{"id": value["人物ID"], "copyright": value["人物著作権フラグ"], "role": value["役割フラグ"]} for value in matches],
        "sourceGlyphCount": len(logical_text(bodies[0])),
        "sourceGlyphSha256": sha256(logical_text(bodies[0]).encode()),
        "rubyCount": sum(len(block["rubies"]) for block in blocks),
        "sourceRubyCount": len(bodies[0].find_all("ruby")),
        "sourceRubySha256": ruby_fingerprint([
            (logical_text(ruby.find("rb")), ruby.find("rt").get_text().strip())
            for ruby in bodies[0].find_all("ruby")
        ]),
        "imageCount": sum(len(block["inlineImages"]) for block in blocks),
        "sourceImageCount": len(bodies[0].find_all("img")),
    }
    validate_book(book, audit)
    return book, audit


def validate_book(book: dict[str, Any], audit: dict[str, Any]) -> None:
    if not book["blocks"] or not book["credits"]:
        raise ValueError("Empty book or attribution")
    ids = [block["id"] for block in book["blocks"]]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate block IDs")
    logical = ASCII_SPACE.sub("", "".join(block["text"] for block in book["blocks"]))
    if len(logical) != audit["sourceGlyphCount"] or sha256(logical.encode()) != audit["sourceGlyphSha256"]:
        raise ValueError("Content differs from independently extracted source glyph stream")
    if audit["rubyCount"] != audit["sourceRubyCount"] or audit["imageCount"] != audit["sourceImageCount"]:
        raise ValueError("Ruby/image count differs from source")
    ruby_pairs = []
    for block in book["blocks"]:
        text = block["text"]
        if "\ufffd" in text:
            raise ValueError("Replacement character in output")
        boundaries = {0}
        offset = 0
        for character in text:
            offset += utf16_length(character)
            boundaries.add(offset)
        for key in ("rubies", "emphasis", "inlineImages"):
            end = -1
            for annotation in sorted(block[key], key=lambda item: item["start"]):
                start, stop = annotation["start"], annotation["end"]
                if not 0 <= start < stop <= offset or start not in boundaries or stop not in boundaries:
                    raise ValueError(f"Invalid UTF-16 range: {book['id']} {block['id']} {key}")
                if key == "rubies" and start < end:
                    raise ValueError("Overlapping ruby bases")
                end = stop
                if key == "rubies" and not annotation["reading"]:
                    raise ValueError("Missing ruby reading")
                if key == "rubies":
                    base = text.encode("utf-16-le")[start*2:stop*2].decode("utf-16-le")
                    ruby_pairs.append((ASCII_SPACE.sub("", base), annotation["reading"]))
                if key == "inlineImages":
                    base = text.encode("utf-16-le")[start*2:stop*2].decode("utf-16-le")
                    if base != "\ufffc" or not (ROOT / "public" / annotation["src"]).is_file():
                        raise ValueError("Missing image glyph or bundled asset")
    if ruby_fingerprint(ruby_pairs) != audit["sourceRubySha256"]:
        raise ValueError("Ruby readings or their base glyphs differ from source")
    for item in book["toc"]:
        if item["blockId"] not in ids:
            raise ValueError("Broken TOC target")


def write_report(books: list[dict[str, Any]], audits: list[dict[str, Any]], index: dict[str, Any]) -> None:
    report = [
        "# 作品取り込み・検証記録", "",
        "初期本棚は20作品。公式の書誌CSVで作品と関係人物の著作権フラグがすべて「なし」の版だけを収録した。新字新仮名を優先し、該当版のない『富嶽百景』は新字旧仮名を採用した。",
        "", f"- 公式CSV: {index['url']}", f"- 取得: {index['fetchedAt']}",
        f"- CSV ZIP SHA-256: `{index['sha256']}`", f"- 変換器: `{VERSION}`", "",
        "作品本文は原XHTMLを厳密にShift_JISデコードし、ルビの読みと括弧を除いた本文を抽出した。改行・HTMLの空白を除く独立した本文抽出結果と、JSON全ブロックを連結した結果のSHA-256・文字数が一致することを検証している。各ルビの親文字と読みの組を原文から独立抽出して照合し、ルビ・画像数の一致、UTF-16の範囲とサロゲート境界、画像の同梱、目次リンク、文字化け置換文字の不在も自動検査した。校訂注記は本文中に保持する。",
        "", "| ID | 作品 | 著者 | 本文文字数 | ルビ | 外字画像 | 見出し | 表記 |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for book, audit in zip(books, audits):
        report.append(f"| {book['id']} | [{book['title']}]({book['cardUrl']}) | {book['authorLabel']} | {book['characterCount']:,} | {audit['rubyCount']:,} | {audit['imageCount']} | {len(book['toc'])} | {audit['orthography']} |")
    report += ["", "## 再実行", "", "```powershell", "python -m pip install -r scripts/requirements.txt", "python scripts/import_books.py", "python scripts/import_books.py --offline", "python scripts/import_books.py --validate-only", "```", "", "通常のWebビルドでは取り込み処理を実行せず、ネットワークなしで同梱JSONを使う。原文・書誌CSV・原画像と取得メタデータは `.cache/aozora/` に保存する。`--refresh` で公式データを再取得する。選定作品は変換器内の作品IDと題名で固定する。公開JSONには作品別の出典URL・取得日時・原文SHA-256・底本・入力者・校正者を保持し、`public/data/import-manifest.json` にはCSVの著作権フラグと完全性検査結果を記録する。", "", "## 配置を簡略化した箇所", ""]
    for book in books:
        if book["conversion"]["warnings"]:
            report.append(f"- {book['title']}: " + "／".join(book["conversion"]["warnings"]))
    report += ["", "字下げはブロック属性に保持し、外字は原画像を同梱して本文のU+FFFC位置に対応づけた。配置簡略化の警告は本文の省略を意味しない。連続する空行による版面上の間隔は段落境界へ統合した。今後の再取り込みで曖昧なルビ構造・デコード失敗・著作権フラグ不一致・本文欠落を検出した場合、公開JSON更新を中止する。", "", "## 出典・利用条件", "", "[青空文庫収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html) に従い、作品の底本・入力・校正情報と原文出典を保持する。書誌CSV由来のメタデータは青空文庫提供、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。本アプリによる変更はXHTMLからJSONへの変換、段落化、注記範囲化、画像の同梱である。", ""]
    (ROOT / "docs" / "import-report.md").write_text("\n".join(report), encoding="utf-8")


def validate_committed() -> None:
    manifest = json.loads((DATA / "import-manifest.json").read_text(encoding="utf-8"))
    catalog = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
    if [entry["id"] for entry in catalog] != [identifier for identifier, _ in SELECTION]:
        raise ValueError("Catalog does not contain the curated 20 works in order")
    if [entry["id"] for entry in manifest["works"]] != [entry["id"] for entry in catalog]:
        raise ValueError("Audit manifest does not match catalog order and work count")
    for entry, audit in zip(catalog, manifest["works"]):
        book = json.loads((ROOT / "public" / entry["dataPath"]).read_text(encoding="utf-8"))
        if any(book[key] != value for key, value in entry.items()):
            raise ValueError("Catalog metadata differs from book")
        if audit["workCopyright"] != "なし" or any(person["copyright"] != "なし" for person in audit["people"]):
            raise ValueError("Copyright check failed")
        validate_book(book, audit)
    print(f"Validated {len(catalog)} complete books, UTF-16 annotations, ruby counts, image assets and metadata.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use cached official files without network access")
    parser.add_argument("--refresh", action="store_true", help="Download current official sources again")
    parser.add_argument("--validate-only", action="store_true", help="Check committed JSON and image assets without network access")
    args = parser.parse_args()
    if args.offline and args.refresh:
        parser.error("--offline and --refresh cannot be combined")
    if args.validate_only:
        validate_committed()
        return
    fetcher = Fetcher(args.offline, args.refresh)
    rows, index = load_index(fetcher)
    books, audits = [], []
    for identifier, title in SELECTION:
        book, audit = import_book(identifier, title, rows, fetcher)
        books.append(book)
        audits.append(audit)
        print(f"{identifier} {title}: {book['characterCount']:,} characters, {audit['rubyCount']:,} rubies")
    # Complete every source and validation before replacing the public outputs.
    catalog_keys = ("id", "title", "titleKana", "subtitle", "authors", "authorLabel", "cardUrl", "dataPath", "contentVersion", "characterCount", "excerpt", "features")
    for book in books:
        write_json(DATA / "books" / (book["id"] + ".json"), book)
    write_json(DATA / "catalog.json", [{key: book[key] for key in catalog_keys} for book in books])
    write_json(DATA / "import-manifest.json", {"schemaVersion": 1, "conversionVersion": VERSION, "index": index, "works": audits})
    write_report(books, audits, index)
    validate_committed()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError) as error:
        sys.exit(str(error))
