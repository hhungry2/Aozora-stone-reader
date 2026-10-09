# 作品取り込み・検証記録

初期本棚は20作品。公式の書誌CSVで作品と関係人物の著作権フラグがすべて「なし」の版だけを収録した。新字新仮名を優先し、該当版のない『富嶽百景』は新字旧仮名を採用した。

- 公式CSV: https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip
- 取得: 2026-10-09T13:03:56+00:00
- CSV ZIP SHA-256: `a615fa6ddb6ef3e0ad598337f5d08f1570c3d2aa51cc5d43a62998ca904905be`
- 変換器: `aozora-xhtml-1.0.0`

作品本文は原XHTMLを厳密にShift_JISデコードし、ルビの読みと括弧を除いた本文を抽出した。改行・HTMLの空白を除く独立した本文抽出結果と、JSON全ブロックを連結した結果のSHA-256・文字数が一致することを検証している。各ルビの親文字と読みの組を原文から独立抽出して照合し、ルビ・画像数の一致、UTF-16の範囲とサロゲート境界、画像の同梱、目次リンク、文字化け置換文字の不在も自動検査した。校訂注記は本文中に保持する。

| ID | 作品 | 著者 | 本文文字数 | ルビ | 外字画像 | 見出し | 表記 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 000127 | [羅生門](https://www.aozora.gr.jp/cards/000879/card127.html) | 芥川竜之介 | 5,713 | 129 | 3 | 0 | 新字新仮名 |
| 000042 | [鼻](https://www.aozora.gr.jp/cards/000879/card42.html) | 芥川竜之介 | 5,778 | 145 | 0 | 0 | 新字新仮名 |
| 000092 | [蜘蛛の糸](https://www.aozora.gr.jp/cards/000879/card92.html) | 芥川竜之介 | 2,882 | 68 | 17 | 3 | 新字新仮名 |
| 043015 | [杜子春](https://www.aozora.gr.jp/cards/000879/card43015.html) | 芥川竜之介 | 9,148 | 267 | 0 | 6 | 新字新仮名 |
| 043016 | [トロッコ](https://www.aozora.gr.jp/cards/000879/card43016.html) | 芥川竜之介 | 4,356 | 136 | 2 | 0 | 新字新仮名 |
| 000069 | [河童](https://www.aozora.gr.jp/cards/000879/card69.html) | 芥川竜之介 | 37,705 | 687 | 4 | 18 | 新字新仮名 |
| 000179 | [藪の中](https://www.aozora.gr.jp/cards/000879/card179.html) | 芥川竜之介 | 8,487 | 271 | 0 | 7 | 新字新仮名 |
| 001567 | [走れメロス](https://www.aozora.gr.jp/cards/000035/card1567.html) | 太宰治 | 9,840 | 88 | 0 | 0 | 新字新仮名 |
| 000270 | [富嶽百景](https://www.aozora.gr.jp/cards/000035/card270.html) | 太宰治 | 15,030 | 74 | 0 | 0 | 新字旧仮名 |
| 000277 | [駈込み訴え](https://www.aozora.gr.jp/cards/000035/card277.html) | 太宰治 | 13,490 | 117 | 0 | 0 | 新字新仮名 |
| 043754 | [注文の多い料理店](https://www.aozora.gr.jp/cards/000081/card43754.html) | 宮沢賢治 | 5,466 | 106 | 0 | 0 | 新字新仮名 |
| 000456 | [銀河鉄道の夜](https://www.aozora.gr.jp/cards/000081/card456.html) | 宮沢賢治 | 38,455 | 693 | 0 | 9 | 新字新仮名 |
| 000470 | [セロ弾きのゴーシュ](https://www.aozora.gr.jp/cards/000081/card470.html) | 宮沢賢治 | 11,706 | 142 | 0 | 0 | 新字新仮名 |
| 043752 | [どんぐりと山猫](https://www.aozora.gr.jp/cards/000081/card43752.html) | 宮沢賢治 | 6,334 | 67 | 0 | 0 | 新字新仮名 |
| 000473 | [よだかの星](https://www.aozora.gr.jp/cards/000081/card473.html) | 宮沢賢治 | 5,197 | 64 | 0 | 0 | 新字新仮名 |
| 000789 | [吾輩は猫である](https://www.aozora.gr.jp/cards/000148/card789.html) | 夏目漱石 | 318,922 | 9,214 | 36 | 11 | 新字新仮名 |
| 000799 | [夢十夜](https://www.aozora.gr.jp/cards/000148/card799.html) | 夏目漱石 | 15,995 | 714 | 3 | 10 | 新字新仮名 |
| 000752 | [坊っちゃん](https://www.aozora.gr.jp/cards/000148/card752.html) | 夏目漱石 | 88,491 | 3,042 | 0 | 11 | 新字新仮名 |
| 000424 | [檸檬](https://www.aozora.gr.jp/cards/000074/card424.html) | 梶井基次郎 | 4,959 | 95 | 1 | 0 | 新字新仮名 |
| 000624 | [山月記](https://www.aozora.gr.jp/cards/000119/card624.html) | 中島敦 | 5,820 | 242 | 22 | 0 | 新字新仮名 |

## 再実行

```powershell
python -m pip install -r scripts/requirements.txt
python scripts/import_books.py
python scripts/import_books.py --offline
python scripts/import_books.py --validate-only
```

通常のWebビルドでは取り込み処理を実行せず、ネットワークなしで同梱JSONを使う。原文・書誌CSV・原画像と取得メタデータは `.cache/aozora/` に保存する。`--refresh` で公式データを再取得する。選定作品は変換器内の作品IDと題名で固定する。公開JSONには作品別の出典URL・取得日時・原文SHA-256・底本・入力者・校正者を保持し、`public/data/import-manifest.json` にはCSVの著作権フラグと完全性検査結果を記録する。

## 配置を簡略化した箇所

- 羅生門: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化
- 鼻: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化
- 蜘蛛の糸: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化
- 河童: レイアウト chitsuki_3 は本文と段落を保持し、配置のみ簡略化／レイアウト jizume_28 は本文と段落を保持し、配置のみ簡略化／レイアウト keigakomi は本文と段落を保持し、配置のみ簡略化／青空文庫の校訂注記を本文中にそのまま保持
- 藪の中: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化
- 走れメロス: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化
- 富嶽百景: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化
- 銀河鉄道の夜: 青空文庫の校訂注記を本文中にそのまま保持
- 吾輩は猫である: sub の文字は保持し、上下位置のみ簡略化／レイアウト chitsuki_2 は本文と段落を保持し、配置のみ簡略化／レイアウト chitsuki_5 は本文と段落を保持し、配置のみ簡略化／青空文庫の校訂注記を本文中にそのまま保持
- 坊っちゃん: レイアウト chitsuki_1 は本文と段落を保持し、配置のみ簡略化

字下げはブロック属性に保持し、外字は原画像を同梱して本文のU+FFFC位置に対応づけた。配置簡略化の警告は本文の省略を意味しない。連続する空行による版面上の間隔は段落境界へ統合した。今後の再取り込みで曖昧なルビ構造・デコード失敗・著作権フラグ不一致・本文欠落を検出した場合、公開JSON更新を中止する。

## 出典・利用条件

[青空文庫収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html) に従い、作品の底本・入力・校正情報と原文出典を保持する。書誌CSV由来のメタデータは青空文庫提供、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。本アプリによる変更はXHTMLからJSONへの変換、段落化、注記範囲化、画像の同梱である。
