'use strict';

// アプリ全体の定数・設定値
const Config = {
  appName: 'Itemization',
  version: 'v2.0.4',

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

  get font() {
    return `${this.fontSize}px ${this.fontFamily}`;
  },
};
