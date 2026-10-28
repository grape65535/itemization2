'use strict';

// ショートカットキー（オプション → ショートカットキーの設定で割り当てるキー）。
//   Combo = { ctrl, shift, alt, key }（key は文字・数字なら大文字 1 文字、それ以外は KeyboardEvent.key の名前（'ArrowUp'・'Enter' 等）。
//   文書には { 操作の ID: Combo } で記録する（Document.shortcuts）
const Shortcut = {
  MODIFIERS: ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'],
  // 表示名を変えるキー
  KEY_LABELS: { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'SPACE' },

  // 押したキー（修飾キーのみ・IME 変換中・判別できないキーは null）。
  // 文字・数字は物理キーで判定する（SHIFT・ALT で文字が変わっても同じキー）
  keyOf(e) {
    if (e.isComposing || Shortcut.MODIFIERS.includes(e.key) || e.key === 'Process' || e.key === 'Dead' || e.key === 'Unidentified') return null;
    let m = /^Key([A-Z])$/.exec(e.code || '');
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(e.code || '');
    if (m) return m[1];
    if (!e.key) return null;
    return e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : e.key;
  },

  // キーイベントの組み合わせ（Mac の ⌘ は CTRL とみなす）。修飾キーのみなら null
  fromEvent(e) {
    const key = Shortcut.keyOf(e);
    return key ? { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key } : null;
  },

  // メニューの表示（'Ctrl+Shift+Z'）から組み合わせを作る
  parse(text) {
    const parts = text.split('+');
    const key = parts.pop() || '+';
    const has = (name) => parts.includes(name);
    return { ctrl: has('Ctrl'), shift: has('Shift'), alt: has('Alt'), key: key.length === 1 ? key.toUpperCase() : key };
  },

  // ダイアログの表示（'CTRL + SHIFT + H'）
  label(combo) {
    const parts = [];
    if (combo.ctrl) parts.push('CTRL');
    if (combo.shift) parts.push('SHIFT');
    if (combo.alt) parts.push('ALT');
    if (combo.key) parts.push(Shortcut.KEY_LABELS[combo.key] || combo.key.toUpperCase());
    return parts.join(' + ');
  },

  // メニューの右端の表示（'Ctrl+Shift+H'。既存のショートカットの表記に合わせる）
  menuLabel(combo) {
    const parts = [];
    if (combo.ctrl) parts.push('Ctrl');
    if (combo.shift) parts.push('Shift');
    if (combo.alt) parts.push('Alt');
    parts.push(Shortcut.KEY_LABELS[combo.key] || combo.key);
    return parts.join('+');
  },

  // 比較用の文字列
  id(combo) {
    return `${combo.ctrl ? 1 : 0}${combo.shift ? 1 : 0}${combo.alt ? 1 : 0}:${combo.key}`;
  },

  equals(a, b) {
    return !!a && !!b && Shortcut.id(a) === Shortcut.id(b);
  },

  // 固定のショートカット（割り当てられない）か
  isFixed(combo) {
    return Config.fixedShortcuts.some((text) => Shortcut.equals(Shortcut.parse(text), combo));
  },

  hasModifier(combo) {
    return combo.ctrl || combo.shift || combo.alt;
  },

  // 読み込んだ割り当てを検証・補正する（修飾キーの無いもの・固定のものは捨てる）。無ければ null
  normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const result = {};
    for (const [id, c] of Object.entries(raw)) {
      if (!c || typeof c !== 'object' || typeof c.key !== 'string' || !c.key) continue;
      const combo = { ctrl: !!c.ctrl, shift: !!c.shift, alt: !!c.alt, key: c.key };
      if (Shortcut.hasModifier(combo) && !Shortcut.isFixed(combo)) result[id] = combo;
    }
    return Object.keys(result).length ? result : null;
  },
};
