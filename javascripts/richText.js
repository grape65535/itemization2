'use strict';

// 文字の装飾（部分的な文字スタイル）とアイテム全体の装飾。
//   保存形式: Item.spans = [{ start, end, size?, bold?, strike?, underline?, color?, colorOverLink?, bg? }]（装飾のある範囲だけ、昇順・重なりなし）
//             colorOverLink: URL の文字に、文字を選択して文字色を指定した印（ハイパーリンクの色より文字色を優先する）
//             Item.fill = アイテム背景色、Item.align = 'center' | 'right'（左寄せは省略）
//   編集・描画時は文字ごとのスタイル配列（null = 装飾なし）で扱う。等しいスタイルは同じオブジェクトを共有する（参照で比較できる）
const RichText = {
  PROPS: ['size', 'bold', 'strike', 'underline', 'color', 'bg'],
  ALIGNS: ['left', 'center', 'right'],
  interned: new Map(),

  isColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  },

  // 不正な値・標準値を除いた共有のスタイルオブジェクト（装飾なしなら null）
  intern(raw) {
    if (!raw) return null;
    const style = {};
    if (Config.fontSizes.includes(raw.size) && raw.size !== Config.fontSize) style.size = raw.size;
    if (raw.bold === true) style.bold = true;
    if (raw.strike === true) style.strike = true;
    if (raw.underline === true) style.underline = true;
    if (RichText.isColor(raw.color)) style.color = raw.color.toLowerCase();
    if (style.color && raw.colorOverLink === true) style.colorOverLink = true;
    if (RichText.isColor(raw.bg)) style.bg = raw.bg.toLowerCase();
    const key = JSON.stringify(style);
    if (key === '{}') return null;
    let shared = RichText.interned.get(key);
    if (!shared) {
      shared = Object.freeze(style);
      RichText.interned.set(key, shared);
    }
    return shared;
  },

  // スタイルの 1 項目を変えたもの（value が null/false なら除く）
  withProp(style, prop, value) {
    const next = Object.assign({}, style);
    if (value === null || value === undefined || value === false) delete next[prop];
    else next[prop] = value;
    return RichText.intern(next);
  },

  sizeOf(style) {
    return (style && style.size) || Config.fontSize;
  },

  font(style) {
    return `${style && style.bold ? 'bold ' : ''}${RichText.sizeOf(style)}px ${Config.fontFamily}`;
  },

  // フォントサイズに比例した行の高さ（標準 14px → 20px）
  lineHeightOf(size) {
    return Math.round(size * Config.lineHeight / Config.fontSize);
  },

  // 文字のベースライン（行の上端から。行の縦中央に合わせる）
  baselineOf(lineHeight, maxSize) {
    return lineHeight / 2 + maxSize * 0.35;
  },

  // 文字背景・下線・取消し線の位置（ベースラインからの相対。CANVAS・SVG・PDF で共通）
  decoration(style, baseline) {
    const size = RichText.sizeOf(style);
    const thickness = Math.max(1, Math.round(size / 14));
    return {
      bgTop: baseline - size * 0.92,
      bgHeight: size * 1.2,
      underlineY: baseline + size * 0.15,
      strikeY: baseline - size * 0.3,
      thickness,
    };
  },

  // 文字列中の URL の範囲 [{ start, end }]（http:// / https:// で始まる ASCII の文字の並び。末尾の句読点・対応しない括弧は除く）
  URL_PATTERN: /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g,
  urlRanges(text) {
    const ranges = [];
    for (const m of text.matchAll(RichText.URL_PATTERN)) {
      let url = m[0];
      for (;;) {
        const last = url[url.length - 1];
        if (/[.,;:!?'"]/.test(last)) url = url.slice(0, -1);
        else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
        else if (last === ']' && (url.match(/\[/g) || []).length < (url.match(/\]/g) || []).length) url = url.slice(0, -1);
        else break;
      }
      if (/^https?:\/\/[^/]/.test(url)) ranges.push({ start: m.index, end: m.index + url.length });
    }
    return ranges;
  },

  // 表示用のスタイル配列：URL の文字はハイパーリンク（下線＋青）にする。
  // 文字色は、文字を選択して指定したもの（colorOverLink）だけがハイパーリンクの色より優先する
  displayStyles(text, styles) {
    const ranges = RichText.urlRanges(text);
    if (ranges.length === 0) return styles;
    const display = styles.slice();
    for (const r of ranges) {
      for (let i = r.start; i < r.end; i++) {
        const st = styles[i];
        const color = st && st.colorOverLink ? st.color : Config.linkColor;
        display[i] = RichText.intern(Object.assign({}, st, { underline: true, color, colorOverLink: false }));
      }
    }
    return display;
  },

  // URL の範囲に含まれるオフセットか
  inRanges(ranges, i) {
    return ranges.some((r) => r.start <= i && i < r.end);
  },

  // 保存形式 → 文字ごとのスタイル配列
  toArray(text, spans) {
    const styles = new Array(text.length).fill(null);
    if (!Array.isArray(spans)) return styles;
    for (const span of spans) {
      if (!span || typeof span !== 'object') continue;
      const start = Util.clamp(Math.floor(Number(span.start)) || 0, 0, text.length);
      const end = Util.clamp(Math.floor(Number(span.end)) || 0, 0, text.length);
      const style = RichText.intern(span);
      for (let i = start; i < end; i++) styles[i] = style;
    }
    return styles;
  },

  // 文字ごとのスタイル配列 → 保存形式（装飾が無ければ null）
  toSpans(styles) {
    const spans = [];
    let i = 0;
    while (i < styles.length) {
      const style = styles[i];
      let j = i + 1;
      while (j < styles.length && styles[j] === style) j++;
      if (style) spans.push(Object.assign({ start: i, end: j }, style));
      i = j;
    }
    return spans.length ? spans : null;
  },

  // 文字列の長さに合わせる（念のための補正）
  fit(styles, length) {
    if (!styles) return new Array(length).fill(null);
    if (styles.length === length) return styles;
    const fixed = styles.slice(0, length);
    while (fixed.length < length) fixed.push(fixed.length ? fixed[fixed.length - 1] : null);
    return fixed;
  },

  // styles の [from, from+removed) を、style の文字 count 個に置き換えた新しい配列
  splice(styles, from, removed, count, style) {
    return styles.slice(0, from).concat(new Array(count).fill(style), styles.slice(from + removed));
  },

  // 変更前後の文字列の差分。挿入された文字列がカーソル位置で終わるように取る
  diff(before, after, caret) {
    const maxSuffix = Math.min(before.length, after.length, after.length - caret);
    let suffix = 0;
    while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const maxPrefix = Math.min(before.length, after.length) - suffix;
    let prefix = 0;
    while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;
    return { from: prefix, removed: before.length - prefix - suffix, inserted: after.length - prefix - suffix };
  },

  // アイテムの装飾（spans / fill / align）を正規化して target に設定する（無いものは削除）
  assignDecoration(target, source) {
    const spans = source && RichText.toSpans(RichText.toArray(target.text, source.spans));
    const fill = source && RichText.isColor(source.fill) ? source.fill.toLowerCase() : null;
    const align = source && (source.align === 'center' || source.align === 'right') ? source.align : null;
    if (spans) target.spans = spans;
    else delete target.spans;
    if (fill) target.fill = fill;
    else delete target.fill;
    if (align) target.align = align;
    else delete target.align;
    return target;
  },

  // 選択範囲 [start, end) の文字（改行を除く）すべてが prop を持つか
  allHave(styles, text, start, end, prop) {
    let any = false;
    for (let i = start; i < end; i++) {
      if (text[i] === '\n') continue;
      if (!styles[i] || !styles[i][prop]) return false;
      any = true;
    }
    return any;
  },

  // 選択範囲の文字（改行を除く）に共通の値（混在・該当なしは null）
  commonValue(styles, text, start, end, read) {
    let value;
    for (let i = start; i < end; i++) {
      if (text[i] === '\n') continue;
      const v = read(styles[i]);
      if (value === undefined) value = v;
      else if (value !== v) return null;
    }
    return value === undefined ? null : value;
  },
};
