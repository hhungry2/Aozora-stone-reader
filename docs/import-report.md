# 全著作権切れ作品の取り込み記録

公式の公開作品CSVを作品ID単位でまとめ、作品および全関係人物の著作権フラグが明示的に「なし」の作品を対象にした。版・表記が異なる作品IDは統合しない。

- 一覧・検索対象: 17,352作品
- 本文の取り込み・検証済み: 17,344作品
- 本文を同梱できない作品: 8作品（検索結果から公式図書カードに案内）
- 本文: 228,539,554文字
- データ容量: 498,534,630 bytes
- 公式CSV: https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip
- 取得: 2026-10-11T10:32:46+00:00
- CSV ZIP SHA-256: `a615fa6ddb6ef3e0ad598337f5d08f1570c3d2aa51cc5d43a62998ca904905be`
- 変換器: `aozora-xhtml-1.3.0`

本文・ルビの親文字と読み・画像数・UTF-16範囲・Unicode外字の逆変換・目次リンク・出典を作品ごとに検証する。未対応の配置は本文を保持して簡略化し、作品情報に記録する。原文の欠落を検知した作品は収録成功として扱わない。

大規模な本文データは決定的なgzip形式で保存し、開いた作品だけブラウザで展開する。挿絵・図版は独立したページで表示する。既存40作品のJSON形式と作品IDは保持する。個々の監査結果は `public/data/import-manifest.json`、未収録理由は `public/data/import-status.json` に記録する。

## 本文を同梱できない作品

| ID | 作品 | 理由 |
| --- | --- | --- |
| 000362 | [源氏物語](https://www.aozora.gr.jp/cards/000052/card362.html) | 本文の提供先が青空文庫の公式サイト外です |
| 000409 | [実語教](https://www.aozora.gr.jp/cards/001529/card409.html) | 本文の提供先が青空文庫の公式サイト外です |
| 000457 | [春と修羅](https://www.aozora.gr.jp/cards/000081/card457.html) | 本文の提供先が青空文庫の公式サイト外です |
| 000547 | [みだれ髪（昭和8年）](https://www.aozora.gr.jp/cards/000885/card547.html) | 公式サイトにHTML本文がありません |
| 000548 | [みだれ髪（明治34年）](https://www.aozora.gr.jp/cards/000885/card548.html) | 公式サイトにHTML本文がありません |
| 000706 | [更級日記](https://www.aozora.gr.jp/cards/000133/card706.html) | 公式サイトにHTML本文がありません |
| 000860 | [著作権法](https://www.aozora.gr.jp/cards/001528/card860.html) | 本文の提供先が青空文庫の公式サイト外です |
| 055796 | [地震なまず](https://www.aozora.gr.jp/cards/001748/card55796.html) | ValueError: HTTPError: HTTP Error 404: Not Found |

## 再実行

```sh
python -m pip install -r scripts/requirements.txt
python scripts/import_books.py --all
python scripts/import_books.py --all --offline
python scripts/import_books.py --validate-only
```

成功した作品は `.cache/aozora/converted/` にチェックポイントを保存し、同じCSV行・変換器・出力ハッシュなら次回は再利用する。失敗した作品は再試行する。`--refresh` は公式データを再取得して変換する。`--limit N` は診断用で、公開用カタログを更新しない。通常のWebビルドは取り込みを実行せず、同梱データを使用する。

## 出典・利用条件

本文・底本・入力者・校正者情報は青空文庫提供。各作品に原文URLと制作情報を保持し、[収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html)に従う。書誌データは青空文庫提供の[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。本アプリでは書誌項目の抽出、XHTMLからJSONへの変換、段落化、ルビ・注記の範囲化、外字のUnicode化、図版のページ化、圧縮を行っている。
