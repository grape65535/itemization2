'use strict';

// 等幅フォントでの文字幅計測と折り返し計算。
// CANVAS 描画・アイテム寸法・カーソル行判定のすべてでこの折り返し結果を使う。
class TextMeasurer {
  constructor(font) {
    this.ctx = document.createElement('canvas').getContext('2d');
    this.ctx.font = font;
    this.cache = new Map();
  }

  charWidth(ch) {
    let w = this.cache.get(ch);
    if (w === undefined) {
      w = this.ctx.measureText(ch).width;
      this.cache.set(ch, w);
    }
    return w;
  }

  // 表示行に分割する。戻り値: [{ start, end, width }]（start/end は UTF-16 オフセット、改行文字は含まない）
  wrap(text, maxWidth) {
    const lines = [];
    let lineStart = 0;
    let width = 0;
    let i = 0;
    while (i < text.length) {
      const code = text.codePointAt(i);
      const len = code > 0xffff ? 2 : 1;
      if (text[i] === '\n') {
        lines.push({ start: lineStart, end: i, width });
        i += 1;
        lineStart = i;
        width = 0;
        continue;
      }
      const cw = this.charWidth(text.substr(i, len));
      if (width + cw > maxWidth && i > lineStart) {
        lines.push({ start: lineStart, end: i, width });
        lineStart = i;
        width = 0;
      }
      width += cw;
      i += len;
    }
    lines.push({ start: lineStart, end: text.length, width });
    return lines;
  }

  // 表示行内の x 座標に最も近い文字境界のオフセット
  offsetAt(text, line, x) {
    let acc = 0;
    let i = line.start;
    while (i < line.end) {
      const len = text.codePointAt(i) > 0xffff ? 2 : 1;
      const cw = this.charWidth(text.substr(i, len));
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
