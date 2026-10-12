'use strict';

// アプリ全体の定数・設定値
const Config = {
  appName: 'Itemization',
  version: 'v2.2.14',

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
  maxContentWidth: 360, // アイテムの最大表示幅の初期値（タブの設定で変更可能）
  cornerRadius: 6,
  borderHitWidth: 3, // 枠線の両側この幅(px)以内のクリックは枠線クリックとみなす

  // ツリー配置
  margin: 24,
  horizontalGap: 48,
  verticalGap: 10,
  // 親アイテムがスクロールに追従する時の、メインエリアの上端・下端との間隔
  followScrollGap: 8,

  // [+][-] アイコン
  toggleSize: 12,
  // フィルタで隠したアイテムの代わりに置く [+]（展開アイコン）の大きさ
  placeholderSize: 16,

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
  // 文字列中の URL（ハイパーリンク）の表示色（文字色の「青」と同じ）。下線も付ける
  linkColor: '#0046ff',
  // タブの設定（オプション → タブの設定）
  maxContentWidthRange: [100, 1000],
  statusMax: 12,
  statusNameMax: 12,
  // ステータスのバッジの色（背景色と文字色の組）。保存データには key を記録する
  statusColors: [
    { key: 'gray', name: '灰', bg: '#b5b5b5', fg: '#000000' },
    { key: 'black', name: '黒', bg: '#222222', fg: '#ffffff' },
    { key: 'red', name: '赤', bg: '#ff6b6b', fg: '#000000' },
    { key: 'orange', name: '橙', bg: '#ffa94d', fg: '#000000' },
    { key: 'yellow', name: '黄', bg: '#ffd43b', fg: '#000000' },
    { key: 'lime', name: '黄緑', bg: '#a9e34b', fg: '#000000' },
    { key: 'green', name: '緑', bg: '#51cf66', fg: '#000000' },
    { key: 'teal', name: '青緑', bg: '#38d9a9', fg: '#000000' },
    { key: 'cyan', name: '水色', bg: '#66d9e8', fg: '#000000' },
    { key: 'blue', name: '青', bg: '#74a9ff', fg: '#000000' },
    { key: 'navy', name: '紺', bg: '#1c3d8f', fg: '#ffffff' },
    { key: 'purple', name: '紫', bg: '#c49bff', fg: '#000000' },
    { key: 'pink', name: '桃', bg: '#ff8fc8', fg: '#000000' },
    { key: 'brown', name: '茶', bg: '#8d5524', fg: '#ffffff' },
    { key: 'darkgreen', name: '深緑', bg: '#2b8a3e', fg: '#ffffff' },
    { key: 'darkred', name: '深紅', bg: '#b02a2a', fg: '#ffffff' },
  ],
  // アイテムに表示するステータスのバッジ（左上）
  statusFont: 'bold 10px system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Meiryo", sans-serif',
  statusFontSize: 10,
  statusHeight: 15,
  statusPaddingX: 6,
  statusGap: 3, // バッジと文字列の間隔
  // タブの設定から削除されたステータス（白背景・灰色の文字・黒の点線枠）
  statusOrphan: { bg: '#ffffff', fg: '#808080', border: '#000000' },
  defaultStatuses: [
    { name: '未着手', color: 'gray' },
    { name: '作業中', color: 'blue' },
    { name: '完了', color: 'green' },
    { name: '保留', color: 'purple' },
    { name: 'キャンセル', color: 'black' },
    { name: '確認中', color: 'red' },
  ],

  // 文字入力中のツールバーの高さ(px)とアイテムとの間隔
  toolbarHeight: 30,
  toolbarGap: 6,
  // メインエリアの右上に重ねる表示（フィルタ中の漏斗・複数選択中のツールバー）の、端からの間隔
  overlayMargin: 8,

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
