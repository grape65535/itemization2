'use strict';

// メインエリアの CANVAS 描画
const Renderer = {
  colors: {
    background: '#f7f8fa',
    connector: '#8a929c',
    itemFill: '#ffffff',
    candidateFill: '#cfe0ff', // 範囲選択の候補（選択確定後は通常の背景に戻る）
    marqueeFill: 'rgba(110, 118, 130, 0.12)', // 候補の青と区別するため無彩色
    marqueeBorder: '#6b7480',
    itemBorder: '#000000',
    text: '#000000',
    selected: '#1e64f0',
    textSelection: 'rgba(30, 100, 240, 0.28)', // 文字入力中の選択範囲
    textSelectionBlur: 'rgba(110, 118, 130, 0.25)', // フォーカスが無い時の選択範囲
    caret: '#000000',
    toggleFill: '#ffffff',
    toggleBorder: '#6b7480',
  },

  // state: { scrollX, scrollY, viewWidth, viewHeight, editing, selection, candidates, drag }
  //   editing: 文字入力中のアイテムの { id, focused, caret: {x,y,h}|null, selection: [{x,y,w,h}], composition: [{x,y,w}] }
  draw(ctx, layout, state) {
    const C = Config;
    const col = Renderer.colors;
    ctx.save();
    ctx.fillStyle = col.background;
    ctx.fillRect(0, 0, state.viewWidth, state.viewHeight);
    ctx.translate(-state.scrollX, -state.scrollY);

    const view = { x: state.scrollX, y: state.scrollY, w: state.viewWidth, h: state.viewHeight };
    const visible = (x, y, w, h) => x + w >= view.x && x <= view.x + view.w && y + h >= view.y && y <= view.y + view.h;

    // 関係線
    ctx.strokeStyle = col.connector;
    ctx.lineWidth = 1.5;
    for (const node of layout.order) {
      if (node.children.length === 0) continue;
      const x1 = node.x + node.w;
      const y1 = node.y + node.h / 2;
      for (const child of node.children) {
        const x2 = child.x;
        const y2 = child.y + child.h / 2;
        if (!visible(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1) + 1)) continue;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        if (y1 === y2) {
          ctx.lineTo(x2, y2);
        } else {
          const mx = (x1 + x2) / 2;
          ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
        }
        ctx.stroke();
      }
    }

    // 範囲選択の矩形の塗りはアイテムの背面に描き、候補アイテムの背景色と混ざらないようにする
    const drag = state.drag;
    if (drag && drag.type === 'marquee') Renderer.drawMarquee(ctx, drag, 'fill');

    // アイテム
    for (const node of layout.order) {
      if (!visible(node.x - 2, node.y - 2, node.w + C.toggleSize + 8, node.h + 4)) continue;
      Renderer.drawItem(ctx, node, state);
      if (TreeLayout.isToggleVisible(node)) Renderer.drawToggle(ctx, node);
    }

    if (drag && drag.type === 'item') Renderer.drawItemDrag(ctx, layout, drag);
    if (drag && drag.type === 'marquee') Renderer.drawMarquee(ctx, drag, 'stroke');

    ctx.restore();
  },

  roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  },

  drawItem(ctx, node, state) {
    const C = Config;
    const col = Renderer.colors;
    const selected = state.selection.has(node.id);
    const candidate = !selected && state.candidates && state.candidates.has(node.id);

    Renderer.roundRectPath(ctx, node.x + 0.5, node.y + 0.5, node.w - 1, node.h - 1, C.cornerRadius);
    ctx.fillStyle = candidate ? col.candidateFill : node.fill || col.itemFill;
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected || candidate ? col.selected : col.itemBorder;
    ctx.stroke();

    const editing = state.editing && state.editing.id === node.id ? state.editing : null;
    if (node.status) Renderer.drawStatus(ctx, node);
    // 文字背景 → 選択範囲 → 文字 → 下線・取消し線 → カーソルの順に重ねる
    Renderer.eachSegment(node, (seg, x, baseline) => {
      if (!seg.style || !seg.style.bg) return;
      const d = RichText.decoration(seg.style, baseline);
      ctx.fillStyle = seg.style.bg;
      ctx.fillRect(x, d.bgTop, seg.width, d.bgHeight);
    });
    if (editing) {
      ctx.fillStyle = editing.focused ? col.textSelection : col.textSelectionBlur;
      for (const r of editing.selection) ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    Renderer.eachSegment(node, (seg, x, baseline) => {
      ctx.font = RichText.font(seg.style);
      ctx.fillStyle = (seg.style && seg.style.color) || col.text;
      ctx.fillText(node.text.slice(seg.start, seg.end), x, baseline);
      if (seg.style && (seg.style.underline || seg.style.strike)) {
        const d = RichText.decoration(seg.style, baseline);
        if (seg.style.underline) ctx.fillRect(x, Math.round(d.underlineY), seg.width, d.thickness);
        if (seg.style.strike) ctx.fillRect(x, Math.round(d.strikeY), seg.width, d.thickness);
      }
    });
    ctx.restore();
    if (editing) {
      ctx.fillStyle = col.text;
      for (const r of editing.composition) ctx.fillRect(r.x, r.y, r.w, 1);
      if (editing.caret) {
        ctx.fillStyle = col.caret;
        ctx.fillRect(Math.round(editing.caret.x), editing.caret.y, 1, editing.caret.h);
      }
    }
  },

  // ステータスのバッジ（文字領域の左上。削除されたステータスは白背景・灰色の文字・黒の点線枠）
  drawStatus(ctx, node) {
    const C = Config;
    const s = node.status;
    const x = node.x + C.paddingX;
    const y = node.y + C.paddingY;
    ctx.save();
    Renderer.roundRectPath(ctx, x + 0.5, y + 0.5, s.w - 1, s.h - 1, s.h / 2 - 0.5);
    ctx.fillStyle = s.bg;
    ctx.fill();
    if (s.orphan) {
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.statusOrphan.border;
      ctx.stroke();
    }
    ctx.font = C.statusFont;
    ctx.fillStyle = s.fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, x + s.w / 2, y + s.h / 2 + 0.5);
    ctx.restore();
  },

  // 表示行の区間ごとに fn(segment, 左端の x, ベースラインの y) を呼ぶ（座標はコンテンツ座標）
  eachSegment(node, fn) {
    const left = node.x + Config.paddingX;
    const top = node.y + Config.paddingY;
    for (const line of node.lines) {
      const baseline = top + line.top + line.baseline;
      for (const seg of line.segments) fn(seg, left + line.x + seg.x, baseline);
    }
  },

  drawToggle(ctx, node) {
    const col = Renderer.colors;
    const r = TreeLayout.toggleRect(node);
    ctx.save();
    ctx.fillStyle = col.toggleFill;
    ctx.strokeStyle = col.toggleBorder;
    ctx.lineWidth = 1;
    ctx.fillRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.beginPath();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.moveTo(r.x + 3, cy);
    ctx.lineTo(r.x + r.w - 3, cy);
    if (node.collapsed) {
      ctx.moveTo(cx, r.y + 3);
      ctx.lineTo(cx, r.y + r.h - 3);
    }
    ctx.stroke();
    ctx.restore();
  },

  drawItemDrag(ctx, layout, drag) {
    const C = Config;
    const col = Renderer.colors;
    const target = drag.target && layout.nodes.get(drag.target.id);
    if (target) {
      ctx.save();
      ctx.strokeStyle = col.selected;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (drag.target.mode === 'before' || drag.target.mode === 'after') {
        const y = drag.target.mode === 'before' ? target.y - C.verticalGap / 2 : target.y + target.h + C.verticalGap / 2;
        ctx.moveTo(target.x, y);
        ctx.lineTo(target.x + target.w, y);
        ctx.stroke();
      } else {
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        Renderer.roundRectPath(ctx, target.x - 3, target.y - 3, target.w + 6, target.h + 6, C.cornerRadius + 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(target.x + target.w + 3, target.y + target.h / 2);
        ctx.lineTo(target.x + target.w + C.horizontalGap / 2, target.y + target.h / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ドラッグ中のアイテムの影
    const dx = drag.current.x - drag.start.x;
    const dy = drag.current.y - drag.start.y;
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (const id of drag.ids) {
      const node = layout.nodes.get(id);
      if (!node) continue;
      const ghost = Object.assign({}, node, { x: node.x + dx, y: node.y + dy });
      Renderer.drawItem(ctx, ghost, { selection: new Set([id]), editing: null });
    }
    ctx.restore();
  },

  // part: 'fill'（アイテムの背面）/ 'stroke'（アイテムの前面、点線）
  drawMarquee(ctx, drag, part) {
    const r = drag.rect;
    if (!r) return;
    const col = Renderer.colors;
    ctx.save();
    if (part === 'fill') {
      ctx.fillStyle = col.marqueeFill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else {
      ctx.strokeStyle = col.marqueeBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
    ctx.restore();
  },
};
