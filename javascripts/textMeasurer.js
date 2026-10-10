'use strict';

// 文字幅計測と折り返し計算（文字ごとのスタイルに対応）。
// CANVAS 描画・アイテム寸法・カーソル位置・SVG/PDF 出力のすべてでこの折り返し結果を使う。
class TextMeasurer {
  constructor() {
    this.ctx = document.createElement('canvas').getContext('2d');
    this.caches = new Map(); // フォント -> (文字 -> 幅)
  }

  charWidth(ch, style) {
    const font = RichText.font(style);
    let cache = this.caches.get(font);
    if (!cache) {
      cache = new Map();
      this.caches.set(font, cache);
    }
    let w = cache.get(ch);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(ch).width;
      cache.set(ch, w);
    }
    return w;
  }

  // 表示行に分割する。styles は文字ごとのスタイル（省略時は装飾なし）。
  // 戻り値: [{ start, end, width, height, baseline, segments: [{ start, end, x, width, style }] }]
  //   start/end は UTF-16 オフセット（改行文字は含まない）、baseline は行の上端から、segment.x は行頭から
  wrap(text, maxWidth, styles) {
    styles = RichText.fit(styles, text.length);
    const lines = [];
    let lineStart = 0;
    let width = 0;
    let i = 0;
    while (i < text.length) {
      const len = text.codePointAt(i) > 0xffff ? 2 : 1;
      if (text[i] === '\n') {
        lines.push({ start: lineStart, end: i, width });
        i += 1;
        lineStart = i;
        width = 0;
        continue;
      }
      const cw = this.charWidth(text.substr(i, len), styles[i]);
      if (width + cw > maxWidth && i > lineStart) {
        lines.push({ start: lineStart, end: i, width });
        lineStart = i;
        width = 0;
      }
      width += cw;
      i += len;
    }
    lines.push({ start: lineStart, end: text.length, width });
    for (const line of lines) this.finishLine(text, styles, line);
    return lines;
  }

  // 行の高さ（行内の最大のフォントサイズで決まる。空行は行末の改行か直前の文字のサイズ）と描画用の区間
  finishLine(text, styles, line) {
    let maxSize = 0;
    for (let i = line.start; i < line.end; i++) maxSize = Math.max(maxSize, RichText.sizeOf(styles[i]));
    if (text[line.end] === '\n') maxSize = Math.max(maxSize, RichText.sizeOf(styles[line.end]));
    if (maxSize === 0) maxSize = line.start > 0 ? RichText.sizeOf(styles[line.start - 1]) : Config.fontSize;
    line.maxSize = maxSize;
    line.height = RichText.lineHeightOf(maxSize);
    line.baseline = RichText.baselineOf(line.height, maxSize);
    line.segments = [];
    let x = 0;
    let i = line.start;
    while (i < line.end) {
      const style = styles[i];
      const seg = { start: i, end: i, x, width: 0, style };
      while (i < line.end && styles[i] === style) {
        const len = text.codePointAt(i) > 0xffff ? 2 : 1;
        seg.width += this.charWidth(text.substr(i, len), style);
        i += len;
      }
      seg.end = i;
      x += seg.width;
      line.segments.push(seg);
    }
  }

  // 表示行の行頭からオフセットまでの幅
  xOf(text, styles, line, offset) {
    let x = 0;
    let i = line.start;
    while (i < Math.min(offset, line.end)) {
      const len = text.codePointAt(i) > 0xffff ? 2 : 1;
      x += this.charWidth(text.substr(i, len), styles && styles[i]);
      i += len;
    }
    return x;
  }

  // 表示行内の x 座標（行頭から）に最も近い文字境界のオフセット
  offsetAt(text, styles, line, x) {
    let acc = 0;
    let i = line.start;
    while (i < line.end) {
      const len = text.codePointAt(i) > 0xffff ? 2 : 1;
      const cw = this.charWidth(text.substr(i, len), styles && styles[i]);
      if (x < acc + cw / 2) return i;
      acc += cw;
      i += len;
    }
    return line.end;
  }

  // オフセットが属する表示行の番号（折り返し境界は後ろの行の行頭とみなす）
  static lineIndexOf(lines, offset) {
    for (let i = lines.length - 1; i > 0; i--) {
      if (lines[i].start <= offset) return i;
    }
    return 0;
  }
}
