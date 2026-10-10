# CLAUDE.md

このリポジトリで作業する AI 向けの指示・作業手順と、コンテキスト節約のためのファイル構成メモ。
機能・仕様の説明は `要求仕様.md` を参照すること（本書には仕様は書かない）。

## 作業ルール

### バージョン番号
- 表記は `vメジャー.マイナー.パッチ`（例: `v2.11.1`）。v2.0.0 から
  - **メジャー**: 大規模な作り直しや、互換性のない変更。
  - **マイナー**: 機能追加のまとまりや、保存データのスキーマ変更。上げたらパッチは 0 に戻す。
  - **パッチ**: 不具合修正・小改善などの個々の変更。
- **コミットの度にパッチ番号を 1 つ上げること**（例: `v2.11.0` → `v2.11.1`）。
  メジャー・マイナーはユーザーから指示があった時に上げる。

### ドキュメント
- 機能・仕様を追加・変更したら `要求仕様.md` の該当箇所も更新する（現状仕様の記録として維持する）。
- AI 向けの手順・ルール・ファイル構成は本書（`CLAUDE.md`）に書く。

### 動作確認
- ビルド・テスト基盤は無い。`index.html` を `file://` で開けば動作する（サーバ不要）。

## ファイル構成

```
index.html                 起動HTML。全JS/CSSを ?v=X.Y.Z 付きで読み込み、Application を生成
要求.md                     ユーザーからの元の要求
要求仕様.md                 機能・仕様・データモデルの説明（現状仕様）
CLAUDE.md                  本書
doc/自己判断事項.md          要求に無い部分で AI が判断した内容と他の選択肢
stylesheets/app.css        全スタイル
javascripts/               （index.html での読み込み順）
  config.js                定数（アプリ名・バージョン・寸法・フォント・localStorage キー）
  util.js                  ID 生成・DOM 生成などの小物
  model.js                 文書 JSON のツリー操作（生成・検証・索引・削除＋子の繰り上げ）
  history.js               全タブ共通の Undo/Redo 履歴（変更前後の JSON を保持）
  storage.js               localStorage への保存・復元
  fileExport.js            ファイルを開く（JSON/SVG）・保存（JSON/SVG/PDF）。PDF 用ライブラリは遅延読み込み
  itemClipboard.js         コピー/貼り付け用の変換（選択→クリップ形式、箇条書き文字列の生成と解析、JSON）
  textMeasurer.js          文字幅計測と折り返し計算（CANVAS・寸法・カーソル行判定で共通使用）
  treeLayout.js            ツリー配置計算、[+][-] アイコン位置
  renderer.js              メインエリアの CANVAS 描画
  itemEditor.js            TEXTAREA による文字入力とキー操作
  mainArea.js              メインエリア（スクロール・ヒットテスト・選択・ドラッグ・範囲選択）
  tabBar.js                タブバー（切替・追加・削除・並べ替え）
  menuBar.js               ヘッダのメニュー
  application.js           全体の状態（文書・アクティブタブ・選択・履歴）と変更操作 commit()
  vendor/                  同梱ライブラリ・フォント（PDF 保存時のみ読み込み。内容とライセンスは vendor/README.md）
```

### 実装メモ
- 文書の変更は必ず `Application.commit(fn, hint)` を通す（履歴登録・保存・再描画を一括で行う）。
- UI 状態（選択・文字入力中アイテム）は ID で保持する。Undo で文書オブジェクトが作り直されるため。
- バージョンを上げる時は `config.js` の `version` と `index.html` の `?v=` をすべて更新する。
- `file://` で動かすため fetch/XHR でローカルファイルを読まない。追加のリソースは `<script>` で読み込む（例: `vendor/ipafont/ipag-font.js`）。
- `vendor/ipafont/ipag-font.js`（約 5.7MB）は巨大なので Read/Grep の対象にしない。

