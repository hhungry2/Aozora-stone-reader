# 作品取り込み・検証記録

初期本棚は20作品。公式の書誌CSVで作品と関係人物の著作権フラグがすべて「なし」の版だけを収録した。新字新仮名を優先し、該当版のない『富嶽百景』は新字旧仮名を採用した。

- 公式CSV: https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip
- 取得: 2026-10-09T13:03:56+00:00
- CSV ZIP SHA-256: `a615fa6ddb6ef3e0ad598337f5d08f1570c3d2aa51cc5d43a62998ca904905be`
- 変換器: `aozora-xhtml-1.1.0`

作品本文は原XHTMLを厳密にShift_JISデコードし、ルビの読みと括弧を除いた本文を抽出した。下記のJIS面区点による外字変換を適用した独立本文抽出結果と、JSON全ブロックを連結した結果のSHA-256・文字数が一致することを検証している。Unicodeへ変換した位置をU+FFFCに戻し、変換前の原文指紋に一致することも検証した。各ルビの親文字と読みの組を原文から独立抽出して照合し、ルビ数・原画像数（同梱画像＋Unicode変換数）の一致、UTF-16の範囲とサロゲート境界、画像の同梱、目次リンク、文字化け置換文字の不在も自動検査した。校訂注記は本文中に保持する。

| ID | 作品 | 著者 | 本文文字数 | ルビ | 外字画像 | 見出し | 表記 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 000127 | [羅生門](https://www.aozora.gr.jp/cards/000879/card127.html) | 芥川竜之介 | 5,713 | 129 | 0 | 0 | 新字新仮名 |
| 000042 | [鼻](https://www.aozora.gr.jp/cards/000879/card42.html) | 芥川竜之介 | 5,778 | 145 | 0 | 0 | 新字新仮名 |
| 000092 | [蜘蛛の糸](https://www.aozora.gr.jp/cards/000879/card92.html) | 芥川竜之介 | 2,882 | 68 | 0 | 3 | 新字新仮名 |
| 043015 | [杜子春](https://www.aozora.gr.jp/cards/000879/card43015.html) | 芥川竜之介 | 9,148 | 267 | 0 | 6 | 新字新仮名 |
| 043016 | [トロッコ](https://www.aozora.gr.jp/cards/000879/card43016.html) | 芥川竜之介 | 4,356 | 136 | 0 | 0 | 新字新仮名 |
| 000069 | [河童](https://www.aozora.gr.jp/cards/000879/card69.html) | 芥川竜之介 | 37,705 | 687 | 0 | 18 | 新字新仮名 |
| 000179 | [藪の中](https://www.aozora.gr.jp/cards/000879/card179.html) | 芥川竜之介 | 8,487 | 271 | 0 | 7 | 新字新仮名 |
| 001567 | [走れメロス](https://www.aozora.gr.jp/cards/000035/card1567.html) | 太宰治 | 9,840 | 88 | 0 | 0 | 新字新仮名 |
| 000270 | [富嶽百景](https://www.aozora.gr.jp/cards/000035/card270.html) | 太宰治 | 15,030 | 74 | 0 | 0 | 新字旧仮名 |
| 000277 | [駈込み訴え](https://www.aozora.gr.jp/cards/000035/card277.html) | 太宰治 | 13,490 | 117 | 0 | 0 | 新字新仮名 |
| 043754 | [注文の多い料理店](https://www.aozora.gr.jp/cards/000081/card43754.html) | 宮沢賢治 | 5,466 | 106 | 0 | 0 | 新字新仮名 |
| 000456 | [銀河鉄道の夜](https://www.aozora.gr.jp/cards/000081/card456.html) | 宮沢賢治 | 38,455 | 693 | 0 | 9 | 新字新仮名 |
| 000470 | [セロ弾きのゴーシュ](https://www.aozora.gr.jp/cards/000081/card470.html) | 宮沢賢治 | 11,706 | 142 | 0 | 0 | 新字新仮名 |
| 043752 | [どんぐりと山猫](https://www.aozora.gr.jp/cards/000081/card43752.html) | 宮沢賢治 | 6,334 | 67 | 0 | 0 | 新字新仮名 |
| 000473 | [よだかの星](https://www.aozora.gr.jp/cards/000081/card473.html) | 宮沢賢治 | 5,197 | 64 | 0 | 0 | 新字新仮名 |
| 000789 | [吾輩は猫である](https://www.aozora.gr.jp/cards/000148/card789.html) | 夏目漱石 | 318,922 | 9,214 | 0 | 11 | 新字新仮名 |
| 000799 | [夢十夜](https://www.aozora.gr.jp/cards/000148/card799.html) | 夏目漱石 | 15,995 | 714 | 0 | 10 | 新字新仮名 |
| 000752 | [坊っちゃん](https://www.aozora.gr.jp/cards/000148/card752.html) | 夏目漱石 | 88,491 | 3,042 | 0 | 11 | 新字新仮名 |
| 000424 | [檸檬](https://www.aozora.gr.jp/cards/000074/card424.html) | 梶井基次郎 | 4,959 | 95 | 0 | 0 | 新字新仮名 |
| 000624 | [山月記](https://www.aozora.gr.jp/cards/000119/card624.html) | 中島敦 | 5,820 | 242 | 0 | 0 | 新字新仮名 |

## JIS面区点からUnicodeへの自動変換

`class=gaiji` の原画像について、公式HTTPSオリジン・`gaiji/面-区/面-区-点.png` のディレクトリとファイル名が一致し、1/2面・区点1〜94の範囲にある場合を変換候補にする。原XHTMLにも面区点注記がある場合はURLとの一致を必須とし、不一致は取り込みを中止する。面2はJIS X 0213の割当区（1、3〜5、8、12〜15、78〜94）のみを認め、Python標準コーデックによるJIS X 0212へのフォールバックを除外する。Python標準の `euc_jis_2004` で厳密にデコードできる対応をUnicodeへ変換する。非公式URLはUnicode変換の対象外とし、画像取得も既存の公式HTTPSオリジン制限に従って拒否する。公式画像のパスが変換条件に合わない場合や、規格外の区・未定義の対応は、既存の画像処理へ渡す。変換文字・Unicodeコードポイント列・JIS面区点・使用コーデック・元画像URL・元注記・根拠URL・変換後のブロック内UTF-16範囲を各作品JSONの `conversion.normalizedGaiji` に記録する。本文・ルビ・傍点・残る画像の範囲は変換後のUTF-16長で再計算する。

| 作品 | 原画像・JIS面区点 | Unicode | 箇所 | 根拠 |
| --- | --- | --- | ---: | --- |
| 羅生門 | [2-12-93](https://www.aozora.gr.jp/gaiji/2-12/2-12-93.png) | 扭 (U+626D) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 羅生門 | [1-88-81](https://www.aozora.gr.jp/gaiji/1-88/1-88-81.png) | 眶 (U+7736) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 蜘蛛の糸 | [1-87-71](https://www.aozora.gr.jp/gaiji/1-87/1-87-71.png) | 犍 (U+728D) | 17 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| トロッコ | [1-14-75](https://www.aozora.gr.jp/gaiji/1-14/1-14-75.png) | 匀 (U+5300) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 河童 | [2-88-74](https://www.aozora.gr.jp/gaiji/2-88/2-88-74.png) | 譃 (U+8B43) | 4 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [2-88-74](https://www.aozora.gr.jp/gaiji/2-88/2-88-74.png) | 譃 (U+8B43) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [2-92-68](https://www.aozora.gr.jp/gaiji/2-92/2-92-68.png) | 饀 (U+9940) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-92-39](https://www.aozora.gr.jp/gaiji/1-92/1-92-39.png) | 蹰 (U+8E70) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-87-64](https://www.aozora.gr.jp/gaiji/1-87/1-87-64.png) | 燄 (U+71C4) | 4 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [2-92-71](https://www.aozora.gr.jp/gaiji/2-92/2-92-71.png) | 饍 (U+994D) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-87-40](https://www.aozora.gr.jp/gaiji/1-87/1-87-40.png) | 炷 (U+70B7) | 4 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-6-84](https://www.aozora.gr.jp/gaiji/1-06/1-06-84.png) | ㇶ (U+31F6) | 3 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-86-15](https://www.aozora.gr.jp/gaiji/1-86/1-86-15.png) | 橛 (U+6A5B) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-88-85](https://www.aozora.gr.jp/gaiji/1-88/1-88-85.png) | 睜 (U+775C) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-84-54](https://www.aozora.gr.jp/gaiji/1-84/1-84-54.png) | 惝 (U+60DD) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-84-45](https://www.aozora.gr.jp/gaiji/1-84/1-84-45.png) | 怳 (U+6033) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-15-89](https://www.aozora.gr.jp/gaiji/1-15/1-15-89.png) | 媧 (U+5AA7) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-92-78](https://www.aozora.gr.jp/gaiji/1-92/1-92-78.png) | 鄢 (U+9122) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [2-12-83](https://www.aozora.gr.jp/gaiji/2-12/2-12-83.png) | 戕 (U+6215) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-14-76](https://www.aozora.gr.jp/gaiji/1-14/1-14-76.png) | 匇 (U+5307) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [2-92-67](https://www.aozora.gr.jp/gaiji/2-92/2-92-67.png) | 餼 (U+993C) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-94-13](https://www.aozora.gr.jp/gaiji/1-94/1-94-13.png) | 騃 (U+9A03) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-15-24](https://www.aozora.gr.jp/gaiji/1-15/1-15-24.png) | 噱 (U+5671) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-84-28](https://www.aozora.gr.jp/gaiji/1-84/1-84-28.png) | 彘 (U+5F58) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-84-55](https://www.aozora.gr.jp/gaiji/1-84/1-84-55.png) | 惸 (U+60F8) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-88-22](https://www.aozora.gr.jp/gaiji/1-88/1-88-22.png) | 璆 (U+7486) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-86-62](https://www.aozora.gr.jp/gaiji/1-86/1-86-62.png) | 泫 (U+6CEB) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-9-60](https://www.aozora.gr.jp/gaiji/1-09/1-09-60.png) | æ (U+00E6) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [1-91-55](https://www.aozora.gr.jp/gaiji/1-91/1-91-55.png) | 蛼 (U+86FC) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 吾輩は猫である | [2-3-54](https://www.aozora.gr.jp/gaiji/2-03/2-03-54.png) | 卺 (U+537A) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 夢十夜 | [1-88-85](https://www.aozora.gr.jp/gaiji/1-88/1-88-85.png) | 睜 (U+775C) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 夢十夜 | [1-84-66](https://www.aozora.gr.jp/gaiji/1-84/1-84-66.png) | 戢 (U+6222) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 檸檬 | [2-79-45](https://www.aozora.gr.jp/gaiji/2-79/2-79-45.png) | 𤄃 (U+24103) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 山月記 | [1-91-48](https://www.aozora.gr.jp/gaiji/1-91/1-91-48.png) | 虢 (U+8662) | 2 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 山月記 | [2-1-79](https://www.aozora.gr.jp/gaiji/2-01/2-01-79.png) | 傪 (U+50AA) | 18 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 山月記 | [1-92-44](https://www.aozora.gr.jp/gaiji/1-92/1-92-44.png) | 軺 (U+8EFA) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |
| 山月記 | [2-4-33](https://www.aozora.gr.jp/gaiji/2-04/2-04-33.png) | 嘷 (U+5637) | 1 | [Python標準JIS X 0213:2004対応](https://docs.python.org/3/library/codecs.html#standard-encodings) |

対応表の参照先は [Project X0213のEUC-JIS-2004対Unicode表](https://x0213.org/codetable/euc-jis-2004-std.txt)。取り込み時はネットワーク上の表に依存せず、Python標準コーデックと上記の割当区ガードで変換する。

補助漢字や結合文字列はUTF-16長が増えるため、逆変換検証では同一ブロック内を末尾から処理する。`conversion.sourcePlaceholderVersion` に変換前のU+FFFC本文のバージョンを記録し、全変換がUTF-16で1単位の場合だけ `positionCompatibleVersions` に同バージョンを登録する。ブロック境界はすべて保持する。『蜘蛛の糸』の犍陀多の「犍」は16×16ピクセルの画像を拡大せず、本文フォントで表示する。

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

字下げはブロック属性に保持し、変換できない外字は原画像を同梱して本文のU+FFFC位置に対応づけた。配置簡略化の警告は本文の省略を意味しない。連続する空行による版面上の間隔は段落境界へ統合した。今後の再取り込みで曖昧なルビ構造・デコード失敗・著作権フラグ不一致・本文欠落を検出した場合、公開JSON更新を中止する。

## 出典・利用条件

[青空文庫収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html) に従い、作品の底本・入力・校正情報と原文出典を保持する。書誌CSV由来のメタデータは青空文庫提供、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。本アプリによる変更はXHTMLからJSONへの変換、段落化、注記範囲化、画像の同梱、JIS面区点を使った外字のUnicode化である。
