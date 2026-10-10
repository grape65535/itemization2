'use strict';

// メインエリアの CANVAS 描画
const Renderer = {
  colors: {
    background: '#f7f8fa',
    connector: '#8a929c',
    itemFill: '#ffffff',
    itemBorder: '#000000',
    text: '#000000',
    selected: '#1e64f0',
    toggleFill: '#ffffff',
    toggleBorder: '#6b7480',
  },

  // state: { scrollX, scrollY, viewWidth, viewHeight, editingId, selection, candidates, drag }
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

    // アイテム
    ctx.font = C.font;
    ctx.textBaseline = 'middle';
    for (const node of layout.order) {
      if (!visible(node.x - 2, node.y - 2, node.w + C.toggleSize + 8, node.h + 4)) continue;
      Renderer.drawItem(ctx, node, state);
      if (TreeLayout.isToggleVisible(node)) Renderer.drawToggle(ctx, node);
    }

    const drag = state.drag;
    if (drag && drag.type === 'item') Renderer.drawItemDrag(ctx, layout, drag);
    if (drag && drag.type === 'marquee') Renderer.drawMarquee(ctx, drag);

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
    ctx.fillStyle = col.itemFill;
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected || candidate ? col.selected : col.itemBorder;
    ctx.stroke();

    // 文字入力中は TEXTAREA が文字を表示する
    if (node.id === state.editingId) return;
    ctx.fillStyle = col.text;
    const tx = node.x + C.paddingX;
    for (let i = 0; i < node.lines.length; i++) {
      const line = node.lines[i];
      if (line.end <= line.start) continue;
      ctx.fillText(node.text.slice(line.start, line.end), tx, node.y + C.paddingY + i * C.lineHeight + C.lineHeight / 2);
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
      Renderer.drawItem(ctx, ghost, { selection: new Set([id]), editingId: null });
    }
    ctx.restore();
  },

  drawMarquee(ctx, drag) {
    const r = drag.rect;
    if (!r) return;
    ctx.save();
    ctx.fillStyle = 'rgba(30, 100, 240, 0.08)';
    ctx.strokeStyle = Renderer.colors.selected;
    ctx.lineWidth = 1;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    ctx.restore();
  },
};
