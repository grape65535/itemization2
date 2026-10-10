'use strict';

// アプリ全体の定数・設定値
const Config = {
  appName: 'Itemization',
  version: 'v2.0.17',

  // localStorage のキー
  storageKeyDocument: 'itemization2.document',
  storageKeyUi: 'itemization2.ui',

  // Undo 履歴の最大保持数
  historyLimit: 500,

  // アイテムの文字描画（CANVAS と TEXTAREA で同じ値を使う）
  fontFamily: 'Consolas, "Courier New", "BIZ UDGothic", "MS Gothic", "Osaka-Mono", monospace',
  fontSize: 14,
  lineHeight: 20,

  // アイテムの寸法
  paddingX: 8,
  paddingY: 5,
  minContentWidth: 24,
  maxContentWidth: 360, // 「設定で変更可能な最大横幅」（設定 UI は未実装）
  cornerRadius: 6,
  borderHitWidth: 3, // 枠線の両側この幅(px)以内のクリックは枠線クリックとみなす

  // ツリー配置
  margin: 24,
  horizontalGap: 48,
  verticalGap: 10,

  // [+][-] アイコン
  toggleSize: 12,

  // ドラッグ開始とみなす移動量(px)
  dragThreshold: 4,

  // タブ名の最大文字数
  tabTitleMaxLength: 12,
  newTabTitle: '新規タブ',

  // 文字の装飾：フォントサイズの選択肢（fontSize が標準）
  fontSizes: [10, 12, 14, 18, 24, 32],
  // 文字色の 16 色（原色に近い色）。背景色はこれを白と混ぜた薄い色（paleRatio が白の割合）
  colorNames: [
    ['黒', '#000000'], ['灰', '#808080'], ['茶', '#8b4513'], ['赤', '#e60000'],
    ['橙', '#ff8000'], ['黄', '#e6c200'], ['黄緑', '#80c000'], ['緑', '#00a000'],
    ['青緑', '#00a08c'], ['水色', '#00b4f0'], ['青', '#0046ff'], ['紺', '#000096'],
    ['紫', '#8000e0'], ['赤紫', '#e000c8'], ['桃', '#ff5096'], ['オリーブ', '#808000'],
  ],
  paleRatio: 0.8,
  // 文字入力中のツールバーの高さ(px)とアイテムとの間隔
  toolbarHeight: 30,
  toolbarGap: 6,

  get font() {
    return `${this.fontSize}px ${this.fontFamily}`;
  },
};

// 色の一覧 [{ name, text: 文字色, pale: 文字背景色・アイテム背景色 }]
Config.palette = Config.colorNames.map(([name, hex]) => {
  const mix = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - Config.paleRatio) + 255 * Config.paleRatio);
  const pale = '#' + [1, 3, 5].map((i) => mix(i).toString(16).padStart(2, '0')).join('');
  return { name, text: hex, pale };
});
