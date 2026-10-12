# TxtMiruOnTheWebから利用した処理

- 出典: https://github.com/gearsns/TxtMiruOnTheWeb
- 参照コミット: `da2c63591aa9ac0db1d0823e8f5bfb962eeaef63`
- ライセンス: MIT、Copyright (c) 2021 gearsns。[許諾文全文](LICENSE)

`js/TxtMiruSitePlugin.js`のNarou・Kakuyomuにある本文、作品情報、目次、前後の話の抽出方法と、Apollo参照データをたどる目次処理を、このリーダーの`TextBlock`形式へ適応した。カクヨムの`tableOfContentsV2`、なろうの現行・旧HTMLを扱うように更新している。

`server/ActionScript.js`の`url`・`charset`パラメーターでHTMLを取得する方式を利用し、取得先を2サイトの公開作品URLに限定した自前のGASと開発用の中継を実装した。原作者の公開GASとアプリ全体の組版・保存処理は利用していない。

上記の許諾文はビルド時に`public/licenses.txt`にも含める。小説本文の権利は各作品の権利者に帰属し、TxtMiruOnTheWebのソフトウェアライセンスとは別に扱う。
