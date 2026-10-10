# 同梱している外部ライブラリ・フォント

いずれも「PDFで保存」の実行時にだけ `<script>` で遅延読み込みする（`file://` でも動作させるため fetch は使わない）。

| フォルダ | 内容 | バージョン | 入手元 | ライセンス |
|---|---|---|---|---|
| `pdf-lib/` | `pdf-lib.min.js`（PDF 生成） | 1.17.1 | npm `pdf-lib` | MIT（`LICENSE.md`）。同梱の tslib は Apache-2.0（ファイル内に表記） |
| `fontkit/` | `fontkit.umd.min.js`（フォントのサブセット化） | 1.1.1 | npm `@pdf-lib/fontkit` | MIT（`LICENSE.md`） |
| `ipafont/` | `ipag-font.js`（IPAゴシック `ipag.ttf` を gzip＋base64 で格納） | IPAフォント Ver.003.03 | Debian/Ubuntu パッケージ `fonts-ipafont-gothic`（00303） | IPAフォントライセンスv1.0（`IPA_Font_License_Agreement_v1.0.txt`） |

## IPAフォントについて
- フォント本体は改変していない。`ipag-font.js` 内のデータを base64 → gzip 展開したバイト列は元の `ipag.ttf` と同一
  （SHA-256: `503af4a8b84d1079b8e2e358dc7f7a7fb8cb7a1f212f35eaef6782dbfc75a55e`）。
  gzip＋base64 は `file://` で読み込むための格納形式（アーカイブと同等）であり、フォントの名称・内容は変更していない。
- PDF には表示に使う文字だけをサブセット化して埋め込む（ライセンス第2条5項の「エンベッドされたフォント」）。
