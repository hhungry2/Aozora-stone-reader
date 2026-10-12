# Google Apps Script 中継の設定

GitHub Pages はサーバー処理を実行できないため、なろう・カクヨムの公開作品を取得する中継を、自分の Google アカウントに作成します。

1. [Google Apps Script](https://script.google.com/home) で「新しいプロジェクト」を作成します。
2. エディターの `コード.gs` を、このフォルダーの `Code.gs` の内容で置き換えて保存します。
3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選びます。
4. 実行するユーザーを「自分」、アクセスできるユーザーを「全員」にしてデプロイし、Google の権限確認を完了します。
5. 発行された `https://script.google.com/macros/s/…/exec` を、リーダーの「トップページ → Web小説を読む → Web小説の接続設定 → Google Apps Scriptの公開URL」に保存します。`/dev` ではなく `/exec` を使います。

Google アカウントの管理ポリシーにより「全員」を選べない場合、この公開用中継を作成できません。コードを更新したときは「デプロイを管理」から新しいバージョンへ更新してください。

API は `GET <ウェブアプリURL>?url=<作品URL>&charset=UTF-8` です。成功時は `{ "ok": true, "url": "正規化後のURL", "html": "取得したHTML" }`、失敗時は `{ "ok": false, "error": "説明" }` を JSON で返します。[ContentService の転送](https://developers.google.com/apps-script/guides/content#redirects)はブラウザーが追跡します。本文HTMLはそのまま画面に挿入せず、クライアントで必要な文章だけを抽出します。

取得先は HTTPS の `ncode.syosetu.com` と `kakuyomu.jp` の作品・エピソードURLだけです。なろう目次の `p` 以外の検索パラメーターとフラグメントは除去し、転送先も毎回同じ条件で確認します。最大3回の転送、2 MiB の本文上限、30秒の短いキャッシュを設けています。[CacheService の1項目100 KB上限](https://developers.google.com/apps-script/reference/cache/cache#putkey,-value,-expirationinseconds)を超える長い本文はキャッシュしません。Google Apps Script の実行時間・UrlFetchApp の使用量制限内で利用してください。Cookies、認証情報、アクセス制限を回避する処理はありません。

ローカルの `npm run dev` では Vite が `/__web-novel` を提供するため、この設定なしで同じ取得形式を利用できます。この開発用中継はビルド結果に含まれず、GitHub Pages 上では自分で作成した Apps Script のURLが必要です。

TxtMiruOnTheWeb の `server/ActionScript.js`（MIT License、Copyright (c) 2021 gearsns）を参考に、`url` と `charset` を受け取る取得方式を採用しています。原作者の公開中継は使用しません。出典: [gearsns/TxtMiruOnTheWeb](https://github.com/gearsns/TxtMiruOnTheWeb)、参照コミット `da2c63591aa9ac0db1d0823e8f5bfb962eeaef63`。
