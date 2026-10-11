#!/usr/bin/env python3
"""Import all public-domain works from the official Aozora Bunko HTML and CSV.

The website build needs no Python or network access: committed public/data files
are the runtime input. Imports resume from per-work checkpoints. Use --offline
for cached sources, --validate-only for output checks, or --curated for the
original 40-work regression shelf.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import time
import threading
import os
import gzip
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
VERSION = "aozora-xhtml-1.3.0"
GAIJI_ENCODING = "euc_jis_2004"
GAIJI_REFERENCE = "https://docs.python.org/3/library/codecs.html#standard-encodings"
GAIJI_PATH = re.compile(r"^/gaiji/([12])-(\d{2})/([12])-(\d{2})-(\d{2})\.png$")
GAIJI_NOTE = re.compile(r"(?<![0-9-])([12])-(\d{1,2})-(\d{1,2})(?![0-9-])")
# CPython also accepts JIS X 0212 in otherwise unassigned plane-2 rows. Aozora
# gaiji paths describe JIS X 0213, so those fallback rows must not be converted.
# Standard table: https://x0213.org/codetable/euc-jis-2004-std.txt
JIS_X0213_PLANE2_ROWS = {1, 3, 4, 5, 8, 12, 13, 14, 15, *range(78, 95)}
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
    ("000773", "こころ"), ("000301", "人間失格"), ("000753", "文鳥"),
    ("043017", "蜜柑"), ("000055", "芋粥"), ("000621", "名人伝"),
    ("001737", "李陵"), ("000427", "桜の樹の下には"),
    ("000628", "ごん狐"), ("000637", "手袋を買いに"),
    ("054372", "赤い蝋燭と人魚"), ("056648", "人間椅子"),
    ("056645", "押絵と旅する男"), ("045245", "高瀬舟"),
    ("056041", "たけくらべ"), ("000360", "外科室"),
    ("042618", "桜の森の満開の下"), ("002381", "瓶詰地獄"),
    ("000211", "一房の葡萄"), ("000496", "恩讐の彼方に"),
)
ASCII_SPACE = re.compile(r"[ \t\r\n\f]+")
BLOCK_TAGS = {"div", "p", "blockquote", "section", "li", "ul", "ol"}
KNOWN_CLASSES = {
    "main_text", "midashi_anchor", "naka-midashi", "o-midashi", "ko-midashi",
    "gaiji", "notes", "sesame_dot", "white_sesame_dot", "black_circle",
    "white_circle", "black_triangle", "white_triangle", "double_circle",
    "bullseye", "sesame", "subscript", "superscript", "illustration",
}
EMPHASIS_CLASSES = {
    "sesame_dot", "white_sesame_dot", "black_circle", "white_circle",
    "black_triangle", "white_triangle", "double_circle", "bullseye",
}
UNSUPPORTED_LAYOUT = ("chitsuki_", "jizume_", "keigakomi")


def utf16_length(text: str) -> int:
    if len(text) == 1:
        return 2 if ord(text) > 0xffff else 1
    return len(text.encode("utf-16-le")) // 2


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def utc_timestamp(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")


class Fetcher:
    def __init__(self, offline: bool, refresh: bool, request_interval: float = 0):
        self.offline = offline
        self.refresh = refresh
        self.request_interval = request_interval
        self.request_lock = threading.Lock()
        self.last_request = 0.0

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
            request = urllib.request.Request(url, headers={"User-Agent": "Aozora-stone-reader/1.0 (public-domain literature importer)"})
            for attempt in range(4):
                try:
                    with self.request_lock:
                        time.sleep(max(0, self.last_request + self.request_interval - time.monotonic()))
                        self.last_request = time.monotonic()
                    with urllib.request.urlopen(request, timeout=45) as response:
                        data = response.read()
                    break
                except (OSError, TimeoutError) as error:
                    if attempt == 3 or getattr(error, "code", None) in {400, 401, 403, 404, 410}:
                        raise
                    time.sleep(2 ** attempt)
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
    if encoding.lower().replace("_", "-") in {"x-sjis", "x-shift-jis", "sjis"}:
        encoding = "Shift_JIS"
    try:
        text = raw.decode(encoding, errors="strict")
    except UnicodeDecodeError:
        if encoding.lower().replace("_", "-") not in {"shift-jis", "shiftjis", "sjis"}:
            raise
        # Web Shift_JIS also permits Windows extensions; retain the actual
        # decoder in provenance instead of replacing undecodable characters.
        encoding = "cp932"
        text = raw.decode(encoding, errors="strict")
    if "\ufffd" in text:
        raise ValueError("Replacement character in decoded source")
    return text, encoding


def unicode_gaiji(tag: Tag, source_url: str) -> dict[str, str] | None:
    if "gaiji" not in tag.get("class", []):
        return None
    url = urllib.parse.urljoin(source_url, str(tag.get("src", "")))
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "www.aozora.gr.jp" or parsed.query or parsed.fragment:
        return None
    path = GAIJI_PATH.fullmatch(parsed.path)
    if path is None:
        return None
    directory_plane, directory_row, plane, row, cell = map(int, path.groups())
    if (directory_plane, directory_row) != (plane, row):
        return None
    if not 1 <= row <= 94 or not 1 <= cell <= 94:
        return None
    if plane == 2 and row not in JIS_X0213_PLANE2_ROWS:
        return None
    note = str(tag.get("alt", ""))
    codes = {tuple(map(int, match)) for match in GAIJI_NOTE.findall(note)}
    # A canonical official gaiji URL identifies the JIS cell on its own. When
    # the original note also names a cell, it must agree with that URL.
    if codes and codes != {(plane, row, cell)}:
        raise ValueError(f"Gaiji image and source annotation disagree: {url} {note!r}")
    encoded = bytes(([0x8f] if plane == 2 else []) + [row + 0xa0, cell + 0xa0])
    try:
        character = encoded.decode(GAIJI_ENCODING, errors="strict")
    except UnicodeDecodeError:
        return None
    if not character or "\ufffd" in character:
        return None
    return {
        "character": character,
        "codePoint": " ".join(f"U+{ord(value):04X}" for value in character),
        "jisCode": f"{plane}-{row}-{cell}", "encoding": GAIJI_ENCODING,
        "referenceUrl": GAIJI_REFERENCE, "sourceUrl": url, "sourceNote": note,
    }


def logical_text(node: Tag, source_url: str, *, normalize_gaiji: bool = True) -> str:
    """Independent text oracle: remove readings and preserve every source glyph.

    Structural boundaries and HTML whitespace do not count as glyphs. Images are
    represented by one object-replacement character, except for verified Unicode
    gaiji mappings. The original unnormalized stream is also retained in audits.
    """
    pieces = []
    def extract(item):
        if isinstance(item, Comment):
            return
        if isinstance(item, NavigableString):
            pieces.append(str(item))
        elif isinstance(item, Tag):
            if item.name in {"rt", "rp", "script", "style"}:
                return
            if item.name == "img":
                replacement = unicode_gaiji(item, source_url) if normalize_gaiji else None
                pieces.append(replacement["character"] if replacement else "\ufffc")
            else:
                for child in item.children:
                    extract(child)
    extract(node)
    return ASCII_SPACE.sub("", "".join(pieces))


def ruby_fingerprint(pairs: list[tuple[str, str]]) -> str:
    return sha256(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode())


def ruby_reading(reading: Tag, source_url: str) -> str:
    if reading.find("img") is None:
        return reading.get_text().strip()
    pieces = []
    for item in reading.descendants:
        if isinstance(item, Comment):
            continue
        if isinstance(item, NavigableString):
            pieces.append(str(item))
        elif isinstance(item, Tag) and item.name == "img":
            mapping = unicode_gaiji(item, source_url)
            if mapping is None:
                raise ValueError("A ruby reading contains an image without a verified Unicode mapping")
            pieces.append(mapping["character"])
    return "".join(pieces).strip()


class Converter:
    def __init__(self, source_url: str, fetcher: Fetcher):
        self.source_url = source_url
        self.fetcher = fetcher
        self.blocks: list[dict[str, Any]] = []
        self.warnings: set[str] = set()
        self.images: dict[str, dict[str, str]] = {}
        self.normalized_gaiji: list[dict[str, Any]] = []
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
            replacement = unicode_gaiji(node, self.source_url)
            if replacement:
                self.append(replacement["character"])
                self.normalized_gaiji.append({**replacement, "blockId": f"b{len(self.blocks) + 1:05d}", "start": start, "end": self.offset})
                return
            asset = self.image(node)
            dimensions = [int(match.group()) if (match := re.search(r"\d+", str(node.get(key, "0")))) else 0 for key in ("width", "height")]
            if "gaiji" not in classes and max(dimensions) > 80 and node.find_parent("ruby") is None:
                self.flush()
                self.blocks.append({"id": f"b{len(self.blocks) + 1:05d}", "kind": "image", "text": "\ufffc",
                    "rubies": [], "emphasis": [], "inlineImages": [], "indent": 0, "image": asset})
                return
            self.append("\ufffc")
            self.inline_images.append({**asset, "start": start, "end": self.offset})
            return
        if name == "ruby":
            bases = node.find_all("rb", recursive=False)
            readings = node.find_all("rt", recursive=False)
            if len(readings) != 1:
                raise ValueError("Only an unambiguous ruby reading is accepted; source needs review")
            start = self.offset
            base_start = len(self.text)
            if bases:
                for base in bases:
                    self.visit(base)
            else:
                for child in node.children:
                    if not isinstance(child, Tag) or child.name not in {"rt", "rp"}:
                        self.visit(child)
            reading = ruby_reading(readings[0], self.source_url)
            if not reading:
                self.warnings.add("読みが空のルビは親文字を保持し、空の読みを省略")
                return
            if start == self.offset or not ASCII_SPACE.sub("", self.text[base_start:]):
                self.warnings.add(f"原文の親文字が空のルビ（読み：{reading}）は作品情報に保持")
                return
            if node.find("ruby") is not None:
                self.warnings.add(f"原文の入れ子ルビの外側の読み（{reading}）は作品情報に保持し、内側のルビを表示")
                return
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
        expected = logical_text(body, self.source_url)
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


def extract_sections(text: str, identifier: str) -> tuple[Tag, str, list[str]]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(<h([1-6])\b[^>]*>[^<>]*</)h[1-6]\s*>", lambda match: f"{match[1]}h{match[2]}>", text, flags=re.I)
    # html.parser preserves deeply nested/malformed legacy HTML without a
    # parser depth limit silently discarding the tail of a long work.
    soup = BeautifulSoup(text, "html.parser")
    bodies = soup.select(".main_text")
    credits = soup.select_one(".bibliographical_information")
    if len(bodies) == 1 and credits is not None:
        return bodies[0], credits.get_text("\n", strip=True), []
    if len(bodies) > 1:
        raise ValueError(f"Ambiguous main_text in {identifier}")
    # Early Aozora HTML used .honbun/.tyu or a bare BODY separated from the
    # colophon by a horizontal rule. Require an explicit colophon boundary.
    credit_markers = list(re.finditer(r"(?m)^[ \t]*(?:<[^>\n]+>[ \t]*)*(?:底本|定本)(?:・初出)?[：:「]", text))
    if not credit_markers:
        raise ValueError(f"No unambiguous body/credits boundary in {identifier}")
    credit_start = credit_markers[-1].start()
    legacy_credits = BeautifulSoup(text[credit_start:], "html.parser").get_text("\n", strip=True)
    prefix = BeautifulSoup(text[:credit_start] + "</body></html>", "html.parser")
    honbun = prefix.select(".honbun")
    if honbun:
        roots = [node for node in honbun if not any(parent in honbun for parent in node.parents)]
        body = prefix.new_tag("div")
        for node in roots:
            for note in list(node.select(".tyu")):
                note.decompose()
            body.append(node.extract())
    elif len(bodies) == 1:
        body = prefix.select_one(".main_text")
    else:
        body = prefix.body
        if body is not None:
            # The title/author header precedes the prose in the early template.
            for header in list(body.select(".header")):
                header.decompose()
            for heading in list(body.find_all(["h1", "h2"], recursive=False)):
                if len(heading.get_text(strip=True)) < 200:
                    heading.decompose()
    if body is None or not body.get_text(strip=True):
        raise ValueError(f"Empty legacy body in {identifier}")
    warnings = ["旧形式HTMLの本文と底本・入力者・校正者情報を抽出"]
    if re.search(r"<!r>", text, flags=re.I):
        warnings.append("旧形式のルビは原文の括弧表記を本文中に保持")
    return body, legacy_credits, warnings


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
    body, credits, extraction_warnings = extract_sections(text, identifier)
    converter = Converter(url, fetcher)
    converter.warnings.update(extraction_warnings)
    if encoding == "cp932":
        converter.warnings.add("Shift_JIS表記の原文にWindows拡張文字があるためCP932で厳密にデコード")
    blocks = converter.convert(body)
    authors = people(matches)
    features = []
    if any(block["rubies"] for block in blocks):
        features.append("ルビ")
    if any(block["emphasis"] for block in blocks):
        features.append("傍点")
    if any(block["inlineImages"] for block in blocks):
        features.append("外字画像")
    if any(block["kind"] == "image" for block in blocks):
        features.append("挿絵・図版")
    toc = [{"title": block["text"], "blockId": block["id"], "level": block["level"]} for block in blocks if block["kind"] == "heading"]
    if toc:
        features.append("目次")
    character_count = sum(len(block["text"]) for block in blocks)
    if character_count > 80000:
        features.append("長編")
    # Preserve existing reading versions for works whose output is unchanged.
    version_payload = {"version": "aozora-xhtml-1.0.0", "source": sha256(raw), "metadata": matches}
    if any(block["kind"] == "image" for block in blocks):
        version_payload["illustrations"] = "aozora-illustrations-1"
    previous_content_version = sha256(json.dumps(version_payload, ensure_ascii=False, sort_keys=True).encode())[:16]
    if converter.normalized_gaiji:
        version_payload["gaijiUnicode"] = converter.normalized_gaiji
    content_version = sha256(json.dumps(version_payload, ensure_ascii=False, sort_keys=True).encode())[:16]
    entry = {
        "id": identifier, "title": title, "titleKana": row["作品名読み"],
        "subtitle": row["副題"], "authors": authors,
        "authorLabel": "・".join(person["name"] for person in authors),
        "cardUrl": row["図書カードURL"].replace("http://", "https://"),
        "dataPath": f"data/books/{identifier}.json", "contentVersion": content_version,
        "characterCount": character_count,
        "excerpt": next((block["text"].replace("\ufffc", "※")[:90] for block in blocks if block["kind"] == "paragraph"), blocks[0]["text"][:90] if blocks else ""),
        "features": features,
    }
    book = {
        **entry, "schemaVersion": 1, "blocks": blocks, "toc": toc,
        "credits": credits,
        "source": {"url": url, "fetchedAt": fetched_at, "sha256": sha256(raw), "encoding": encoding},
        "conversion": {"version": VERSION, "warnings": sorted(converter.warnings), "normalizedGaiji": converter.normalized_gaiji, "illustrationsVersion": 1},
    }
    body_images = [picture for picture in body.find_all("img") if picture.find_parent(["rt", "rp"]) is None]
    reading_images = [picture for picture in body.find_all("img") if picture.find_parent("rt") is not None]
    if reading_images:
        book["conversion"]["normalizedRubyGaiji"] = [unicode_gaiji(picture, url) for picture in reading_images]
    source_ruby_pairs = [
        (logical_text(ruby, url), ruby_reading(ruby.find("rt", recursive=False), url))
        for ruby in body.find_all("ruby")
        if ruby.find("rt", recursive=False) is not None and ruby_reading(ruby.find("rt", recursive=False), url) and logical_text(ruby, url) and ruby.find("ruby") is None
    ]
    unanchored_readings = [ruby_reading(ruby.find("rt", recursive=False), url)
        for ruby in body.find_all("ruby") if ruby.find("rt", recursive=False) is not None
        and ruby_reading(ruby.find("rt", recursive=False), url) and not logical_text(ruby, url)]
    if unanchored_readings:
        book["conversion"]["unanchoredRubyReadings"] = unanchored_readings
    nested_readings = [ruby_reading(ruby.find("rt", recursive=False), url)
        for ruby in body.find_all("ruby") if ruby.find("rt", recursive=False) is not None
        and ruby_reading(ruby.find("rt", recursive=False), url) and logical_text(ruby, url) and ruby.find("ruby") is not None]
    if nested_readings:
        book["conversion"]["nestedRubyReadings"] = nested_readings
    if converter.normalized_gaiji:
        book["conversion"]["sourcePlaceholderVersion"] = previous_content_version
        if all(utf16_length(item["character"]) == 1 for item in converter.normalized_gaiji):
            book["conversion"]["positionCompatibleVersions"] = [previous_content_version]
    audit = {
        "id": identifier, "title": title, "orthography": row["文字遣い種別"],
        "workCopyright": row["作品著作権フラグ"],
        "people": [{"id": value["人物ID"], "copyright": value["人物著作権フラグ"], "role": value["役割フラグ"]} for value in matches],
        "sourceGlyphCount": len(logical_text(body, url)),
        "sourceGlyphSha256": sha256(logical_text(body, url).encode()),
        "sourceLiteralGlyphSha256": sha256(logical_text(body, url, normalize_gaiji=False).encode()),
        "rubyCount": sum(len(block["rubies"]) for block in blocks),
        "sourceRubyCount": len(source_ruby_pairs),
        "sourceRubyTagCount": len(body.find_all("ruby")),
        "sourceUnanchoredRubyReadings": unanchored_readings,
        "sourceNestedRubyReadings": nested_readings,
        "sourceEmptyRubyReadingCount": sum(not ruby_reading(ruby.find("rt", recursive=False), url)
            for ruby in body.find_all("ruby") if ruby.find("rt", recursive=False) is not None),
        "sourceRubySha256": ruby_fingerprint(source_ruby_pairs),
        "imageCount": sum(len(block["inlineImages"]) + (block["kind"] == "image") for block in blocks),
        "sourceImageCount": len(body_images),
        "sourceReadingImageCount": len(reading_images),
        "normalizedGaijiCount": len(converter.normalized_gaiji),
        "sourceNormalizedGaijiCount": sum(unicode_gaiji(picture, url) is not None for picture in body_images),
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
    normalized_gaiji = book["conversion"].get("normalizedGaiji", [])
    reading_gaiji = book["conversion"].get("normalizedRubyGaiji", [])
    if len(reading_gaiji) != audit.get("sourceReadingImageCount", 0) or any(item is None for item in reading_gaiji):
        raise ValueError("Ruby reading gaiji differs from source")
    unanchored = book["conversion"].get("unanchoredRubyReadings", [])
    if unanchored != audit.get("sourceUnanchoredRubyReadings", []):
        raise ValueError("Unanchored source ruby readings were not retained")
    nested = book["conversion"].get("nestedRubyReadings", [])
    if nested != audit.get("sourceNestedRubyReadings", []):
        raise ValueError("Nested source ruby readings were not retained")
    if "sourceRubyTagCount" in audit and audit["sourceRubyTagCount"] != audit["sourceRubyCount"] + len(unanchored) + len(nested) + audit.get("sourceEmptyRubyReadingCount", 0):
        raise ValueError("Source ruby tags were not fully accounted for")
    normalized_count = audit.get("normalizedGaijiCount", 0)
    if normalized_count != audit.get("sourceNormalizedGaijiCount", 0) or len(normalized_gaiji) != normalized_count:
        raise ValueError("Unicode gaiji count differs from source")
    if audit["rubyCount"] != audit["sourceRubyCount"] or audit["imageCount"] + normalized_count != audit["sourceImageCount"]:
        raise ValueError("Ruby/image count differs from source")
    ruby_pairs = []
    for block in book["blocks"]:
        text = block["text"]
        if block["kind"] == "image" and (text != "\ufffc" or not block.get("image") or not (ROOT / "public" / block["image"]["src"]).is_file()):
            raise ValueError("Missing standalone illustration or image placeholder")
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
    original_text = {block["id"]: block["text"] for block in book["blocks"]}
    seen_gaiji = set()
    # Offsets refer to the converted text: reverse from the end of each block so
    # supplementary characters and combining sequences cannot shift later ranges.
    for item in sorted(normalized_gaiji, key=lambda value: (value["blockId"], value["start"]), reverse=True):
        position = (item["blockId"], item["start"], item["end"])
        source_tag = BeautifulSoup("<img class='gaiji'>", "html.parser").img
        source_tag["src"], source_tag["alt"] = item["sourceUrl"], item["sourceNote"]
        mapping = unicode_gaiji(source_tag, book["source"]["url"])
        if position in seen_gaiji or item["blockId"] not in original_text or mapping is None:
            raise ValueError("Invalid Unicode gaiji provenance or duplicate position")
        seen_gaiji.add(position)
        if any(item.get(key) != value for key, value in mapping.items()) or item["end"] != item["start"] + utf16_length(item["character"]):
            raise ValueError("Unicode gaiji differs from verified mapping")
        encoded = original_text[item["blockId"]].encode("utf-16-le")
        start, stop = item["start"] * 2, item["end"] * 2
        if not 0 <= start < stop <= len(encoded):
            raise ValueError("Unicode gaiji range is outside its block")
        if encoded[start:stop].decode("utf-16-le") != item["character"]:
            raise ValueError("Unicode gaiji range does not contain its character")
        original_text[item["blockId"]] = (encoded[:start] + "\ufffc".encode("utf-16-le") + encoded[stop:]).decode("utf-16-le")
    if "sourceLiteralGlyphSha256" in audit:
        literal = ASCII_SPACE.sub("", "".join(original_text[block["id"]] for block in book["blocks"]))
        if sha256(literal.encode()) != audit["sourceLiteralGlyphSha256"]:
            raise ValueError("Reversing Unicode gaiji does not recover the literal source glyph stream")
    if normalized_gaiji:
        compatible = book["conversion"].get("positionCompatibleVersions", [])
        if compatible and (compatible != [book["conversion"].get("sourcePlaceholderVersion")] or any(utf16_length(item["character"]) != 1 for item in normalized_gaiji)):
            raise ValueError("Position compatibility declared for a changed UTF-16 layout")
    for item in book["toc"]:
        if item["blockId"] not in ids:
            raise ValueError("Broken TOC target")


def write_report(books: list[dict[str, Any]], audits: list[dict[str, Any]], index: dict[str, Any]) -> None:
    authors = {person["id"] for book in books for person in book["authors"]}
    older_orthography = "・".join(f"『{book['title']}』（{audit['orthography']}）" for book, audit in zip(books, audits) if audit["orthography"] != "新字新仮名")
    report = [
        "# 作品取り込み・検証記録", "",
        f"収録作品は{len(books)}作品、{len(authors)}名。公式の書誌CSVで作品と関係人物の著作権フラグがすべて「なし」の版だけを収録した。新字新仮名を優先し、{older_orthography}は新字新仮名の公開版がないため、記載の表記を採用した。",
        "", "童話・短編・中編を中心に選定し、新美南吉、小川未明、江戸川乱歩、森鴎外、樋口一葉、泉鏡花、坂口安吾、夢野久作、有島武郎、菊池寛の作品も収録した。長い作品として『こころ』『人間失格』を含む。追加作品の公式図書カードで題名・著者・文字遣い・XHTML版の対応を確認し、作品IDを固定した。",
        "", f"- 公式CSV: {index['url']}", f"- 取得: {index['fetchedAt']}",
        f"- CSV ZIP SHA-256: `{index['sha256']}`", f"- 変換器: `{VERSION}`",
        f"- 収録: {len(books)}作品・{len(authors)}名・本文合計{sum(book['characterCount'] for book in books):,}文字",
        f"- ルビ: {sum(audit['rubyCount'] for audit in audits):,}箇所／外字Unicode化: {sum(audit['normalizedGaijiCount'] for audit in audits):,}箇所／同梱画像: {sum(audit['imageCount'] for audit in audits):,}箇所", "",
        "作品本文は原XHTMLを厳密にShift_JISデコードし、ルビの読みと括弧を除いた本文を抽出した。下記のJIS面区点による外字変換を適用した独立本文抽出結果と、JSON全ブロックを連結した結果のSHA-256・文字数が一致することを検証している。Unicodeへ変換した位置をU+FFFCに戻し、変換前の原文指紋に一致することも検証した。各ルビの親文字と読みの組を原文から独立抽出して照合し、ルビ数・原画像数（同梱画像＋Unicode変換数）の一致、UTF-16の範囲とサロゲート境界、画像の同梱、目次リンク、文字化け置換文字の不在も自動検査した。校訂注記は本文中に保持する。",
        "", "| ID | 作品 | 著者 | 本文文字数 | ルビ | 外字画像 | 見出し | 表記 |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for book, audit in zip(books, audits):
        report.append(f"| {book['id']} | [{book['title']}]({book['cardUrl']}) | {book['authorLabel']} | {book['characterCount']:,} | {audit['rubyCount']:,} | {audit['imageCount']} | {len(book['toc'])} | {audit['orthography']} |")
    report += ["", "## JIS面区点からUnicodeへの自動変換", "", "`class=gaiji` の原画像について、公式HTTPSオリジン・`gaiji/面-区/面-区-点.png` のディレクトリとファイル名が一致し、1/2面・区点1〜94の範囲にある場合を変換候補にする。原XHTMLにも面区点注記がある場合はURLとの一致を必須とし、不一致は取り込みを中止する。面2はJIS X 0213の割当区（1、3〜5、8、12〜15、78〜94）のみを認め、Python標準コーデックによるJIS X 0212へのフォールバックを除外する。Python標準の `euc_jis_2004` で厳密にデコードできる対応をUnicodeへ変換する。非公式URLはUnicode変換の対象外とし、画像取得も既存の公式HTTPSオリジン制限に従って拒否する。公式画像のパスが変換条件に合わない場合や、規格外の区・未定義の対応は、既存の画像処理へ渡す。変換文字・Unicodeコードポイント列・JIS面区点・使用コーデック・元画像URL・元注記・根拠URL・変換後のブロック内UTF-16範囲を各作品JSONの `conversion.normalizedGaiji` に記録する。本文・ルビ・傍点・残る画像の範囲は変換後のUTF-16長で再計算する。", "", "| 作品 | 原画像・JIS面区点 | Unicode | 箇所 | 根拠 |", "| --- | --- | --- | ---: | --- |"]
    for book in books:
        normalized = book["conversion"]["normalizedGaiji"]
        for url in dict.fromkeys(item["sourceUrl"] for item in normalized):
            items = [item for item in normalized if item["sourceUrl"] == url]
            item = items[0]
            report.append(f"| {book['title']} | [{item['jisCode']}]({url}) | {item['character']} ({item['codePoint']}) | {len(items)} | [Python標準JIS X 0213:2004対応]({item['referenceUrl']}) |")
    report += ["", "対応表の参照先は [Project X0213のEUC-JIS-2004対Unicode表](https://x0213.org/codetable/euc-jis-2004-std.txt)。取り込み時はネットワーク上の表に依存せず、Python標準コーデックと上記の割当区ガードで変換する。", "", "補助漢字や結合文字列はUTF-16長が増えるため、逆変換検証では同一ブロック内を末尾から処理する。`conversion.sourcePlaceholderVersion` に変換前のU+FFFC本文のバージョンを記録し、全変換がUTF-16で1単位の場合だけ `positionCompatibleVersions` に同バージョンを登録する。ブロック境界はすべて保持する。『蜘蛛の糸』の犍陀多の「犍」は16×16ピクセルの画像を拡大せず、本文フォントで表示する。"]
    report += ["", "## 再実行", "", "```powershell", "python -m pip install -r scripts/requirements.txt", "python scripts/import_books.py", "python scripts/import_books.py --offline", "python scripts/import_books.py --validate-only", "```", "", "通常のWebビルドでは取り込み処理を実行せず、ネットワークなしで同梱JSONを使う。原文・書誌CSV・原画像と取得メタデータは `.cache/aozora/` に保存する。`--refresh` で公式データを再取得する。選定作品は変換器内の作品IDと題名で固定する。公開JSONには作品別の出典URL・取得日時・原文SHA-256・底本・入力者・校正者を保持し、`public/data/import-manifest.json` にはCSVの著作権フラグと完全性検査結果を記録する。", "", "## 配置を簡略化した箇所", ""]
    for book in books:
        if book["conversion"]["warnings"]:
            report.append(f"- {book['title']}: " + "／".join(book["conversion"]["warnings"]))
    report += ["", "字下げはブロック属性に保持し、変換できない外字は原画像を同梱して本文のU+FFFC位置に対応づけた。配置簡略化の警告は本文の省略を意味しない。連続する空行による版面上の間隔は段落境界へ統合した。今後の再取り込みで曖昧なルビ構造・デコード失敗・著作権フラグ不一致・本文欠落を検出した場合、公開JSON更新を中止する。", "", "## 出典・利用条件", "", "[青空文庫収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html) に従い、作品の底本・入力・校正情報と原文出典を保持する。書誌CSV由来のメタデータは青空文庫提供、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。本アプリによる変更はXHTMLからJSONへの変換、段落化、注記範囲化、画像の同梱、JIS面区点を使った外字のUnicode化である。", ""]
    (ROOT / "docs" / "import-report.md").write_text("\n".join(report), encoding="utf-8")


def validate_committed() -> None:
    manifest = json.loads((DATA / "import-manifest.json").read_text(encoding="utf-8"))
    catalog = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
    if manifest.get("scope") == "all-public-domain":
        from import_all import validate_all
        validate_all()
        return
    if [entry["id"] for entry in catalog] != [identifier for identifier, _ in SELECTION]:
        raise ValueError(f"Catalog does not contain the curated {len(SELECTION)} works in order")
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
    parser.add_argument("--all", action="store_true", help="Import all public-domain entries, checkpointing each validated work")
    parser.add_argument("--curated", action="store_true", help="Explicitly rebuild only the original 40-work regression shelf")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent conversions for --all (1-8)")
    parser.add_argument("--limit", type=int, help="Limit --all to a diagnostic batch; does not publish the catalog")
    args = parser.parse_args()
    if args.curated and args.all:
        parser.error("--curated and --all cannot be combined")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be a positive integer")
    if args.curated and args.limit is not None:
        parser.error("--limit cannot be combined with --curated")
    if args.offline and args.refresh:
        parser.error("--offline and --refresh cannot be combined")
    if args.validate_only:
        validate_committed()
        return
    if not args.curated:
        from import_all import run_all
        run_all(args)
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
    catalog = [{key: book[key] for key in catalog_keys} for book in books]
    write_json(DATA / "catalog.json", catalog)
    (DATA / "catalog.json.gz").write_bytes(gzip.compress((json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"), mtime=0))
    write_json(DATA / "import-manifest.json", {"schemaVersion": 1, "conversionVersion": VERSION, "index": index, "works": audits})
    write_report(books, audits, index)
    validate_committed()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError) as error:
        sys.exit(str(error))
