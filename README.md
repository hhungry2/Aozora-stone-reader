# Aozora-stone-reader

Aozora-stone-readerは、青空文庫の作品を縦書き・横書きで読めるブラウザ向けリーダーです。React・TypeScript・Viteで構築し、両方向の本文組版に [stone-engine.js](https://github.com/non-standardworld/stone_engine_js) を使っています。

初版の20作品、本文計613,774文字を同梱しています。本棚、読書画面、設定、目次、しおりを実装し、GitHub Pagesで公開しています。

- [公開サイトを開く](https://hhungry2.github.io/Aozora-stone-reader/)
- [『蜘蛛の糸』を読む](https://hhungry2.github.io/Aozora-stone-reader/#/read/000092)
- [GitHubリポジトリ](https://github.com/hhungry2/Aozora-stone-reader)

[初版の実装と検証記録](docs/implementation-notes.md) に、仕様との対応、自動確認した範囲、実機・読み上げなど残る確認を掲載しています。

## 読書機能

- 題名・著者名・読みで作品を検索し、題名順・著者順で並べ替えられます。
- 縦書き・横書きを切り替え、1画面1ページで読めます。ボタン、キーボード、スワイプ、マウスホイールでページを送れます。本文上で下へスクロールすると次ページ、上へスクロールすると前ページへ移動します。
- ルビ、傍点、外字、見出し・字下げを表示し、目次から見出しへ移動できます。JIS面区点で対応を確定できる外字画像は自動的にUnicode文字へ変換し、本文のフォントで表示します。未対応の外字は説明付きの画像として表示します。
- [Stoneプレイグラウンド](https://non-standardworld.github.io/stone_engine_js/)と同じ組版設定を提供します。文字方向、約物（stone・常に全角・常に半角）、文字寄せ（行頭・中央・行末・均等）、行の寄せ（start・middle・end）、フォントサイズ10〜48px、行送り1.00〜3.00倍、和文・欧文別フォント、欧文スケール0.60〜1.20倍、禁則処理、単語での改行、縦中横、文字枠の表示を変更できます。白・生成り・暗色とルビの表示も設定できます。
- 読書位置、しおり、表示設定をブラウザ内に保存し、続きから読めます。表示方向や文字サイズを変えたときも、本文内の位置を使って読み直すページを決めます。
- 各作品の情報画面から、底本・入力者・校正者・出典と、表示形式の変更内容を確認できます。

## ローカルで起動

Node.js 24を使用します。初回に依存パッケージをインストールし、開発サーバーを起動してください。

```sh
npm install
npm run dev
```

表示されたローカルURLをブラウザで開きます。作品データはリポジトリの `public/data/` に入っているため、初回起動のために青空文庫から作品を取得する必要はありません。

本番用の静的ファイルを生成して確認する場合は、次を実行します。

```sh
npm run build
npm run preview
```

成果物は `dist/` に生成します。依存パッケージのインストール後は、通常のビルドにネットワーク接続は不要です。第三者ライセンスの一覧 `public/licenses.txt` は、ビルド前に依存パッケージの許諾文から生成します。

## テスト

```sh
npm test
npx playwright install
npm run test:e2e
```

`npm test` は組版・ページ分割・読書位置・保存処理などの単体テスト、`npm run test:e2e` はブラウザでの読書操作を確認します。Playwright用ブラウザのインストールには初回だけネットワーク接続が必要です。E2Eではデスクトップとモバイル相当の画面を、Chromium・Firefox・WebKitで確認します。

読書画面の応答時間は、本番ビルドを `npm run preview -- --port 4176` で起動してから、別のターミナルで `npm run measure` を実行すると測れます。取得済みの『吾輩は猫である』を開く操作、ページ送り、縦横切替を測定し、条件と結果を `.cache/performance.json` に保存します。外部通信や実機での性能を保証する試験ではありません。

## 収録作品

| 著者 | 作品 |
| --- | --- |
| 芥川竜之介 | 羅生門、鼻、蜘蛛の糸、杜子春、トロッコ、河童、藪の中 |
| 太宰治 | 走れメロス、富嶽百景、駈込み訴え |
| 宮沢賢治 | 注文の多い料理店、銀河鉄道の夜、セロ弾きのゴーシュ、どんぐりと山猫、よだかの星 |
| 夏目漱石 | 吾輩は猫である、夢十夜、坊っちゃん |
| 梶井基次郎 | 檸檬 |
| 中島敦 | 山月記 |

著者名は公式書誌CSVの表記です。新字新仮名を優先し、『富嶽百景』は新字旧仮名の版を収録しています。

## 作品データの取得と追加

Pythonの変換器は、青空文庫の公式書誌CSVと作品XHTMLを取得して、本文・注記の範囲・書誌情報をJSONに変換します。作品と関係人物の著作権フラグがすべて「なし」の作品だけを収録します。通常のWebビルドでは、この取り込み処理を実行しません。

```sh
python -m pip install -r scripts/requirements.txt
python scripts/import_books.py
```

原XHTML、書誌CSV、原画像は `.cache/aozora/` に保存します。キャッシュからの再生成と、同梱データだけの検証は次のとおりです。

```sh
python scripts/import_books.py --offline
python scripts/import_books.py --validate-only
python -m unittest discover -s scripts -p test_gaiji.py
```

公式データを取り直すときは `python scripts/import_books.py --refresh` を使います。

外字の自動変換は作品の取り込み時に行います。公式画像URLのJIS面区点と、記載がある場合は原注記の番号を照合し、JIS X 0213:2004の対応でUnicode化します。変換した文字と元画像・注記・位置はJSONと取り込み記録に残します。現在の20作品では35種類・88箇所を変換済みです。補助漢字や結合文字列も扱い、変換後のルビ位置を再計算します。変換前と同じ原文版に保存した読書位置・しおりは、文字数の増加分を補正して復元します。

作品を追加する場合は、次の順で更新してください。

1. 青空文庫の図書カードで対象の版と作品IDを確認します。
2. [変換器](scripts/import_books.py) の `SELECTION` に、6桁の作品IDと正確な題名を追加します。
3. 変換器を実行します。著作権フラグ、原文との本文一致、各ルビの親文字と読み、UTF-16の範囲、外字画像、目次リンクを検証してからJSONを更新します。
4. `npm test`、`npm run build`、`npm run test:e2e` を実行し、追加作品の縦横表示と出典情報をブラウザで確認します。
5. `public/data/` と自動更新された [取り込み記録](docs/import-report.md) を、作品追加の変更に含めます。作品数を示すUIや説明も更新します。

## GitHub Pagesへ公開

[公開ワークフロー](.github/workflows/pages.yml) は、`main` へのpushまたは `main` 上での手動実行で依存パッケージをインストールし、単体テストとビルドを実行して `dist/` をGitHub Pagesへ配信します。公開リポジトリ `hhungry2/Aozora-stone-reader` は **GitHub Actions** を配信元に設定済みで、`main` へのpushが公開サイトへ自動反映されます。別のリポジトリで使用する場合は、**Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選んでください。

Pagesのサブパスはワークフローが `VITE_BASE_PATH` へ渡します。画面のURLはハッシュ形式のため、作品への直接リンクを開いてもGitHub Pages側のルート設定は不要です。別の静的ホストでサブパスを指定する場合も、ビルド時に `VITE_BASE_PATH` を設定できます。

## 初版の制約

- 長いルビは親文字の領域に収まるよう縮小します。複雑な熟語ルビの割り付けには改善の余地があります。
- 地付き・字詰め・囲み・添字の配置は簡略化しています。文字と校訂注記は保持し、作品情報に変更内容を示します。連続空行は段落境界へ統合します。
- 設定・読書位置・しおりは端末内のブラウザに保存します。端末間同期はなく、ブラウザの保存データ削除で消えます。
- PWAとオフライン読書の保証、本文内検索、任意作品URLの取り込みは初版に含めていません。
- Noto Sans JP・Noto Serif JP・Zen Kaku Gothic New・Shippori Minchoは、選択時にGoogle Fontsから読み込みます。端末の明朝体・ゴシック体とヒラギノも選べます。通信できない場合や端末に書体がない場合は代替フォントで表示するため、端末によって字形は異なります。
- 狭い行送りはルビや傍点が隣の行へ近づくため、読みづらいときは行送りを広げてください。

## 仕様と出典

- [仕様定義案](docs/specification.md)
- [初版の実装と検証記録](docs/implementation-notes.md)
- [作品取り込みと検証の記録](docs/import-report.md)
- [青空文庫収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html)
- [第三者ライセンス](public/licenses.txt)

作品の本文・底本・入力者・校正者などの情報は青空文庫から取得し、各作品JSONと情報画面に保持しています。書誌データは青空文庫提供のCC BY 4.0で、項目の抽出と形式変換を行っています。このアプリは青空文庫の公式サービスではありません。
