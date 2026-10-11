"""Public-domain eligibility, legacy extraction and resumable checkpoint tests."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bs4 import BeautifulSoup

import import_all as bulk
import import_books as core


def row(identifier="100001", person="1", work_copyright="なし", person_copyright="なし"):
    return {"作品ID": identifier, "人物ID": person, "作品著作権フラグ": work_copyright,
            "人物著作権フラグ": person_copyright, "作品名": "試験作品", "文字遣い種別": "新字新仮名"}


class EligibilityTests(unittest.TestCase):
    def test_deduplicates_work_ids_and_checks_every_author_and_translator(self):
        rows = [row(), row(person="2"), row("100002"), row("100002", "2", person_copyright="あり"),
                row("100003", work_copyright="あり"), row("100004", person_copyright=""), row("100005")]
        works = bulk.eligible_works(rows)
        self.assertEqual(list(works), ["100001", "100005"])
        self.assertEqual(len(works["100001"]), 2)

    def test_unknown_or_missing_copyright_flags_never_become_public_domain(self):
        self.assertFalse(bulk.eligible_works([row(work_copyright="不明")]))
        self.assertFalse(bulk.eligible_works([row(person_copyright="なし ")]))


class LegacyTests(unittest.TestCase):
    def test_x_sjis_alias_and_carriage_return_only_colophon(self):
        raw = '<meta charset="x-sjis"><body><h1>題名</h1>原文<br>終わり<hr>\r底本：本<br>入力：人</body>'.encode("shift_jis")
        text, encoding = core.decode_source(raw)
        body, credits, warnings = core.extract_sections(text, "fixture")
        self.assertEqual(encoding, "Shift_JIS")
        self.assertEqual(core.logical_text(body, "https://www.aozora.gr.jp/"), "原文終わり")
        self.assertIn("入力：人", credits)
        self.assertTrue(warnings)

    def test_nested_legacy_colophon_is_kept_out_of_prose(self):
        text = '<body><p class="honbun">本文<br>終わり<div class="tyu">\n底本：本<br>校正：人</div></p></body>'
        body, credits, _ = core.extract_sections(text, "fixture")
        self.assertEqual(core.logical_text(body, "https://www.aozora.gr.jp/"), "本文終わり")
        self.assertIn("校正：人", credits)

    def test_ruby_reading_gaiji_is_not_silently_dropped(self):
        source = "https://www.aozora.gr.jp/cards/000126/files/891_1.html"
        reading = BeautifulSoup('<rt>く<img class="gaiji" src="../../../gaiji/1-02/1-02-22.png" alt="二の字点、1-2-22">し</rt>', "html.parser").rt
        self.assertEqual(core.ruby_reading(reading, source), "く〻し")

    def test_ruby_without_rb_and_source_errors_preserve_all_known_text(self):
        body = BeautifulSoup('<div><ruby>漢字<rt>かんじ</rt></ruby><ruby><rb>原文</rb><rt></rt></ruby><ruby><rb></rb><rt>むか</rt></ruby>終</div>', 'html.parser').div
        converter = core.Converter('https://www.aozora.gr.jp/', core.Fetcher(True, False))
        blocks = converter.convert(body)
        self.assertEqual(blocks[0]['text'], '漢字原文終')
        self.assertEqual(blocks[0]['rubies'], [{'start': 0, 'end': 2, 'reading': 'かんじ'}])
        self.assertTrue(any('むか' in warning for warning in converter.warnings))

    def test_nested_ruby_keeps_inner_reading_and_records_outer_reading(self):
        body = BeautifulSoup('<div><ruby><rb><ruby><rb>白</rb><rt>しろ</rt></ruby>衣</rb><rt>はくい</rt></ruby></div>', 'html.parser').div
        converter = core.Converter('https://www.aozora.gr.jp/', core.Fetcher(True, False))
        blocks = converter.convert(body)
        self.assertEqual(blocks[0]['text'], '白衣')
        self.assertEqual(blocks[0]['rubies'], [{'start': 0, 'end': 1, 'reading': 'しろ'}])
        self.assertTrue(any('はくい' in warning for warning in converter.warnings))

    def test_large_illustration_uses_a_page_while_small_character_stays_inline(self):
        body = BeautifulSoup('<div>前<img src="figure.png" width="400" height="250">後<img src="letter.png" width="48" height="48"></div>', 'html.parser').div
        converter = core.Converter('https://www.aozora.gr.jp/', core.Fetcher(True, False))
        with patch.object(converter, 'image', side_effect=lambda tag: {'src': tag['src'], 'sourceUrl': tag['src'], 'alt': ''}):
            blocks = converter.convert(body)
        self.assertEqual([block['kind'] for block in blocks], ['paragraph', 'image', 'paragraph'])
        self.assertEqual(blocks[1]['image']['src'], 'figure.png')
        self.assertEqual(blocks[2]['inlineImages'][0]['src'], 'letter.png')
        self.assertEqual(''.join(block['text'] for block in blocks), '前\ufffc後\ufffc')


class CheckpointTests(unittest.TestCase):
    def test_publication_retries_a_busy_destination_without_truncating_it(self):
        with tempfile.TemporaryDirectory() as folder:
            output, destination = Path(folder) / 'stage.json', Path(folder) / 'public.json'
            output.write_bytes(b'new content')
            destination.write_bytes(b'previous complete content')
            replace = Path.replace
            attempts = []
            def temporarily_busy(path, target):
                attempts.append(path)
                if len(attempts) == 1:
                    self.assertEqual(destination.read_bytes(), b'previous complete content')
                    raise OSError('File temporarily in use')
                return replace(path, target)
            with patch.object(Path, 'replace', temporarily_busy), patch.object(bulk.time, 'sleep'):
                bulk.publish_book(output, destination)
            self.assertEqual(destination.read_bytes(), b'new content')
            self.assertEqual(len(attempts), 2)
            self.assertFalse(destination.with_name('public.json.tmp').exists())

    def test_resumes_successes_and_reconverts_corrupt_or_changed_outputs(self):
        matches = [row()]
        entry = {key: "" for key in bulk.CATALOG_KEYS}
        entry.update({"id": "100001", "title": "試験作品", "authors": [], "features": [], "characterCount": 10})
        book = {**entry, "blocks": [], "conversion": {}}
        with tempfile.TemporaryDirectory() as folder, patch.object(bulk, "STAGE", Path(folder)), \
                patch.object(core, "import_book", side_effect=lambda *args: (copy.deepcopy(book), {"id": "100001"})) as convert:
            fetcher = core.Fetcher(True, False)
            first = bulk.convert_one("100001", matches, fetcher)
            second = bulk.convert_one("100001", matches, fetcher)
            self.assertEqual(convert.call_count, 1)
            self.assertEqual(first[:2], second[:2])
            self.assertEqual(bulk.read_book(first[2])["title"], "試験作品")
            first[2].write_bytes(b"corrupt")
            bulk.convert_one("100001", matches, fetcher)
            self.assertEqual(convert.call_count, 2)
            changed = [{**matches[0], "作品名": "変更した題名"}]
            bulk.convert_one("100001", changed, fetcher)
            self.assertEqual(convert.call_count, 3)
            saved = json.loads((Path(folder) / "100001.audit.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["metadataSha256"], bulk.fingerprint(changed))
            (Path(folder) / "100001.audit.json").write_text("corrupt", encoding="utf-8")
            bulk.convert_one("100001", changed, fetcher)
            self.assertEqual(convert.call_count, 4)


if __name__ == "__main__":
    unittest.main()
