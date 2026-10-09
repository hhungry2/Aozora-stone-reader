"""Regression tests for Aozora gaiji conversion; no network access required."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bs4 import BeautifulSoup

import import_books as importer


SOURCE_URL = "https://www.aozora.gr.jp/cards/000879/files/92_14545.html"


def image(code, note=None):
    plane, row, cell = map(int, code.split("-"))
    tag = BeautifulSoup('<img class="gaiji">', "html.parser").img
    tag["src"] = f"../../../gaiji/{plane}-{row:02}/{plane}-{row:02}-{cell:02}.png"
    tag["alt"] = note if note is not None else f"※(外字、第3水準{code})"
    return tag


def mixed_fixture():
    """Mix a surrogate pair, combining sequence, BMP glyph and image in a ruby."""
    unknown = '<img class="gaiji" src="../../../gaiji/unknown.png" alt="未定義外字">'
    markup = (
        '<div class="main_text"><ruby><rb><span class="sesame_dot">A'
        + str(image("2-79-45")) + "B"
        + str(image("1-4-87")) + "C"
        + str(image("1-87-71")) + "D" + unknown
        + "E</span></rb><rt>よみ</rt></ruby>終</div>"
    )
    body = BeautifulSoup(markup, "html.parser").div
    converter = importer.Converter(SOURCE_URL, importer.Fetcher(True, False))
    asset = {
        "src": "fixture.png", "alt": "未定義外字",
        "sourceUrl": "https://www.aozora.gr.jp/gaiji/unknown.png",
    }
    # The fallback stays an image without writing assets or fetching the source.
    with patch.object(converter, "image", return_value=asset) as fetch_image:
        blocks = converter.convert(body)
    assert fetch_image.call_count == 1
    book = {
        "id": "fixture", "blocks": blocks, "credits": "fixture", "toc": [],
        "source": {"url": SOURCE_URL},
        "conversion": {
            "normalizedGaiji": converter.normalized_gaiji,
            "sourcePlaceholderVersion": "original-fixture",
        },
    }
    logical = importer.logical_text(body, SOURCE_URL)
    audit = {
        "sourceGlyphCount": len(logical),
        "sourceGlyphSha256": importer.sha256(logical.encode()),
        "sourceLiteralGlyphSha256": importer.sha256(
            importer.logical_text(body, SOURCE_URL, normalize_gaiji=False).encode()
        ),
        "rubyCount": 1, "sourceRubyCount": 1,
        "sourceRubySha256": importer.ruby_fingerprint([
            (importer.logical_text(body.rb, SOURCE_URL), "よみ")
        ]),
        "imageCount": 1, "sourceImageCount": 4,
        "normalizedGaijiCount": 3, "sourceNormalizedGaijiCount": 3,
    }
    return book, audit


class UnicodeGaijiTests(unittest.TestCase):
    def test_kandata_cell_and_source_annotation_match(self):
        result = importer.unicode_gaiji(image("1-87-71"), SOURCE_URL)
        self.assertEqual(result["character"], "犍")
        self.assertEqual(result["codePoint"], "U+728D")
        self.assertEqual(result["jisCode"], "1-87-71")
        self.assertEqual(result["encoding"], "euc_jis_2004")
        self.assertEqual(result["sourceUrl"], "https://www.aozora.gr.jp/gaiji/1-87/1-87-71.png")
        self.assertIn("1-87-71", result["sourceNote"])

    def test_canonical_url_identifies_ae_without_number_in_note(self):
        result = importer.unicode_gaiji(image("1-9-60", "※(リガチャAE小文字)"), SOURCE_URL)
        self.assertEqual(result["character"], "æ")
        self.assertEqual(result["codePoint"], "U+00E6")

    def test_supplementary_kanji_keeps_both_utf16_units(self):
        result = importer.unicode_gaiji(image("2-79-45", "第4水準2-79-45"), SOURCE_URL)
        self.assertEqual(result["character"], "\U00024103")
        self.assertEqual(result["codePoint"], "U+24103")
        self.assertEqual(importer.utf16_length(result["character"]), 2)

    def test_combining_cell_preserves_the_unicode_sequence(self):
        result = importer.unicode_gaiji(image("1-4-87"), SOURCE_URL)
        self.assertEqual(result["character"], "\u304b\u309a")
        self.assertEqual(result["codePoint"], "U+304B U+309A")

    def test_unassigned_rows_cells_and_out_of_range_values_fall_back(self):
        # CPython decodes plane 2, row 2 as JIS X 0212; it is not JIS X 0213.
        for code in ("2-2-1", "1-4-94", "1-95-1", "1-1-95"):
            with self.subTest(code=code):
                self.assertIsNone(importer.unicode_gaiji(image(code), SOURCE_URL))

    def test_noncanonical_sources_and_missing_class_fall_back(self):
        tags = []
        foreign = image("1-87-71")
        foreign["src"] = "https://example.com/gaiji/1-87/1-87-71.png"
        tags.append(foreign)
        malformed = image("1-87-71")
        malformed["src"] = "../../../gaiji/1-88/1-87-71.png"
        tags.append(malformed)
        unclassified = image("1-87-71")
        del unclassified["class"]
        tags.append(unclassified)
        queried = image("1-87-71")
        queried["src"] += "?other=1"
        tags.append(queried)
        for tag in tags:
            with self.subTest(tag=str(tag)):
                self.assertIsNone(importer.unicode_gaiji(tag, SOURCE_URL))

    def test_disagreeing_or_ambiguous_source_annotations_are_rejected(self):
        for note in ("第3水準1-87-72", "第3水準1-87-71、第3水準1-87-72"):
            with self.subTest(note=note), self.assertRaises(ValueError):
                importer.unicode_gaiji(image("1-87-71", note), SOURCE_URL)


class GaijiAnnotationTests(unittest.TestCase):
    def test_annotations_follow_converted_utf16_lengths(self):
        book, _ = mixed_fixture()
        block = book["blocks"][0]
        self.assertEqual(block["text"], "A\U00024103B\u304b\u309aC犍D\ufffcE終")
        self.assertEqual(importer.utf16_length(block["text"]), 12)
        self.assertEqual(block["rubies"], [{"start": 0, "end": 11, "reading": "よみ"}])
        self.assertEqual(block["emphasis"], [{"start": 0, "end": 11, "kind": "sesame_dot"}])
        self.assertEqual([(item["start"], item["end"]) for item in block["inlineImages"]], [(9, 10)])
        self.assertEqual(
            [(item["start"], item["end"]) for item in book["conversion"]["normalizedGaiji"]],
            [(1, 3), (4, 6), (7, 8)],
        )

    def test_reverse_conversion_recovers_original_source_fingerprint(self):
        book, audit = mixed_fixture()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "public").mkdir()
            (root / "public" / "fixture.png").write_bytes(b"fixture")
            with patch.object(importer, "ROOT", root):
                importer.validate_book(book, audit)
                corrupted = copy.deepcopy(book)
                corrupted["conversion"]["normalizedGaiji"][0]["character"] = "犍"
                with self.assertRaises(ValueError):
                    importer.validate_book(corrupted, audit)

    def test_changed_utf16_lengths_cannot_claim_position_compatibility(self):
        book, audit = mixed_fixture()
        book["conversion"]["positionCompatibleVersions"] = ["original-fixture"]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "public").mkdir()
            (root / "public" / "fixture.png").write_bytes(b"fixture")
            with patch.object(importer, "ROOT", root), self.assertRaisesRegex(ValueError, "Position compatibility"):
                importer.validate_book(book, audit)


if __name__ == "__main__":
    unittest.main()
