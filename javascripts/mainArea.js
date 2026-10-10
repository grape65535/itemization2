'use strict';

// メインエリア：CANVAS 描画、スクロール、マウス操作（選択・ドラッグ移動・範囲選択）
class MainArea {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.canvas = Util.el('canvas', 'main-canvas');
    this.scroller = Util.el('div', 'main-scroller');
    this.spacer = Util.el('div', 'main-spacer');
    // 文字入力を受ける見えない TEXTAREA（文字・カーソルは CANVAS に描く）。IME の候補窓のためカーソル位置に置く
    const textarea = Util.el('textarea', 'item-editor');
    textarea.spellcheck = false;
    textarea.setAttribute('wrap', 'off');
    textarea.style.font = Config.font;
    this.scroller.append(this.spacer, textarea);
    container.append(this.canvas, this.scroller);
    this.ctx = this.canvas.getContext('2d');

    this.measurer = new TextMeasurer();
    this.editor = new ItemEditor(this, textarea);
    this.toolbar = new EditToolbar(this, this.scroller);
    this.layout = null;
    this.drag = null;
    this.renderedTabId = null;
    this.scrollPositions = new Map();

    this.scroller.addEventListener('scroll', () => {
      this.positionEditor();
      this.draw();
    });
    this.scroller.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.scroller.addEventListener('mousemove', (e) => this.updateCursor(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    // ドラッグ中の右クリックでキャンセル
    window.addEventListener('mousedown', (e) => {
      if (e.button === 2 && this.drag && this.drag.type === 'item') {
        this.cancelDrag();
        this.suppressContextMenu = true;
      }
    }, true);
    window.addEventListener('contextmenu', (e) => {
      if (this.suppressContextMenu) {
        e.preventDefault();
        this.suppressContextMenu = false;
      }
    });
    window.addEventListener('resize', () => this.render());
  }

  // ---- 描画 ----

  // 配置を再計算して描画する
  render() {
    const tab = this.app.activeTab;
    if (this.renderedTabId !== tab.id) {
      if (this.renderedTabId !== null) {
        this.scrollPositions.set(this.renderedTabId, { x: this.scroller.scrollLeft, y: this.scroller.scrollTop });
      }
    }
    const override = this.editor.isEditing ? this.editor.override : null;
    this.layout = TreeLayout.compute(tab.root, this.measurer, override);
    this.spacer.style.width = this.layout.width + 'px';
    this.spacer.style.height = this.layout.height + 'px';
    if (this.renderedTabId !== tab.id) {
      const pos = this.scrollPositions.get(tab.id) || { x: 0, y: 0 };
      this.scroller.scrollLeft = pos.x;
      this.scroller.scrollTop = pos.y;
      this.renderedTabId = tab.id;
    }
    this.positionEditor();
    this.draw();
  }

  // 見えない TEXTAREA をカーソル位置に、ツールバーをアイテムの上（隠れる場合は下）に置く
  positionEditor() {
    const ta = this.editor.ta;
    const node = this.editor.node;
    if (!node) {
      ta.style.display = 'none';
      this.toolbar.hide();
      return;
    }
    const caret = this.editor.caretRect(this.editor.anchorFocus()[1]);
    ta.style.display = 'block';
    ta.style.left = caret.x + 'px';
    ta.style.top = caret.y + 'px';
    ta.style.height = caret.h + 'px';
    this.toolbar.show(node);
  }

  draw() {
    if (!this.layout) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Renderer.draw(this.ctx, this.layout, {
      scrollX: this.scroller.scrollLeft,
      scrollY: this.scroller.scrollTop,
      viewWidth: w,
      viewHeight: h,
      editing: this.editor.drawState(),
      selection: this.app.selection,
      candidates: this.drag && this.drag.type === 'marquee' ? this.drag.candidates : null,
      drag: this.drag,
    });
  }

  // アイテムが描画範囲外ならスクロールして範囲内に収める
  scrollIntoView(id) {
    const node = this.layout && this.layout.nodes.get(id);
    if (!node) return;
    const s = this.scroller;
    const m = 16;
    const viewW = s.clientWidth;
    const viewH = s.clientHeight;
    if (node.x - m < s.scrollLeft) s.scrollLeft = node.x - m;
    else if (node.x + node.w + m > s.scrollLeft + viewW) s.scrollLeft = Math.min(node.x - m, node.x + node.w + m - viewW);
    if (node.y - m < s.scrollTop) s.scrollTop = node.y - m;
    else if (node.y + node.h + m > s.scrollTop + viewH) s.scrollTop = Math.min(node.y - m, node.y + node.h + m - viewH);
  }

  // ---- ナビゲーション ----

  // 可視アイテムの文書順で、同じ階層の直前(-1)/直後(+1)のアイテム
  sameDepthNeighbor(id, direction) {
    const order = this.layout.order;
    const i = order.findIndex((n) => n.id === id);
    if (i < 0) return null;
    const depth = order[i].depth;
    for (let j = i + direction; j >= 0 && j < order.length; j += direction) {
      if (order[j].depth === depth) return order[j].id;
    }
    return null;
  }

  // ---- ヒットテスト ----

  toContent(e) {
    const r = this.scroller.getBoundingClientRect();
    return { x: e.clientX - r.left + this.scroller.scrollLeft, y: e.clientY - r.top + this.scroller.scrollTop };
  }

  hitTest(p) {
    const order = this.layout.order;
    const b = Config.borderHitWidth;
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if (TreeLayout.isToggleVisible(n)) {
        const t = TreeLayout.toggleRect(n);
        if (p.x >= t.x - 2 && p.x <= t.x + t.w + 2 && p.y >= t.y - 2 && p.y <= t.y + t.h + 2) return { type: 'toggle', id: n.id };
      }
      // 枠線（1px）とその両側 b px を「枠」とみなす
      if (p.x >= n.x - b && p.x < n.x + n.w + b && p.y >= n.y - b && p.y < n.y + n.h + b) {
        const inner = p.x >= n.x + 1 + b && p.x < n.x + n.w - 1 - b && p.y >= n.y + 1 + b && p.y < n.y + n.h - 1 - b;
        return { type: 'item', id: n.id, part: inner ? 'inner' : 'border' };
      }
    }
    return null;
  }

  caretAt(id, p) {
    const node = this.layout.nodes.get(id);
    const line = node.lines[TreeLayout.lineIndexAtY(node, p.y - node.y - Config.paddingY)];
    return this.measurer.offsetAt(node.text, node.styles, line, p.x - node.x - Config.paddingX - line.x);
  }

  updateCursor(e) {
    if (this.drag) return;
    const hit = this.layout && this.hitTest(this.toContent(e));
    this.scroller.style.cursor = !hit ? 'default' : hit.type === 'toggle' ? 'pointer' : hit.part === 'inner' ? 'text' : 'default';
  }

  // ---- マウス操作 ----

  onMouseDown(e) {
    if (e.button !== 0 || e.target === this.editor.ta || this.toolbar.el.contains(e.target)) return;
    const r = this.scroller.getBoundingClientRect();
    if (e.clientX - r.left >= this.scroller.clientWidth || e.clientY - r.top >= this.scroller.clientHeight) return; // スクロールバー
    e.preventDefault();
    this.app.menuBar.closeAll();
    this.toolbar.closePopup();
    const p = this.toContent(e);
    const hit = this.hitTest(p);
    const modifier = e.shiftKey || e.ctrlKey || e.metaKey;

    if (hit && hit.type === 'toggle') {
      this.app.toggleCollapse(hit.id);
      return;
    }
    // 文字入力中のアイテム内：クリックでカーソル移動、ドラッグ・SHIFT+クリックで範囲選択、ダブル／トリプルクリックで単語／段落を選択
    if (hit && hit.part === 'inner' && hit.id === this.editor.editingId) {
      const editor = this.editor;
      const offset = this.caretAt(hit.id, p);
      editor.ta.focus({ preventScroll: true });
      if (e.detail === 2) {
        editor.selectWord(offset);
      } else if (e.detail >= 3) {
        editor.selectParagraph(offset);
      } else {
        const anchor = e.shiftKey ? editor.anchorFocus()[0] : offset;
        editor.setSelection(anchor, offset);
        this.drag = { type: 'text', id: hit.id, anchor };
      }
      return;
    }
    this.editor.end();

    if (hit) {
      if (modifier) {
        const sel = this.app.selection;
        if (sel.has(hit.id)) sel.delete(hit.id);
        else sel.add(hit.id);
        this.draw();
        return;
      }
      this.drag = { type: 'pending', id: hit.id, part: hit.part, start: p, client: { x: e.clientX, y: e.clientY } };
    } else if (modifier) {
      this.drag = { type: 'marquee', start: p, current: p, rect: null, candidates: new Set() };
    } else {
      this.drag = {
        type: 'pan', client: { x: e.clientX, y: e.clientY },
        scroll: { x: this.scroller.scrollLeft, y: this.scroller.scrollTop }, moved: false,
      };
    }
  }

  onMouseMove(e) {
    const d = this.drag;
    if (!d) return;
    const dist = (a) => Math.hypot(e.clientX - a.x, e.clientY - a.y);
    switch (d.type) {
      case 'pending':
        if (dist(d.client) >= Config.dragThreshold) this.beginItemDrag(e);
        break;
      case 'item':
        this.autoScroll(e);
        d.current = this.toContent(e);
        d.target = this.dropTarget(d.current);
        this.draw();
        break;
      case 'pan':
        if (!d.moved && dist(d.client) >= Config.dragThreshold) {
          d.moved = true;
          this.scroller.style.cursor = 'grabbing';
        }
        if (d.moved) {
          this.scroller.scrollLeft = d.scroll.x - (e.clientX - d.client.x);
          this.scroller.scrollTop = d.scroll.y - (e.clientY - d.client.y);
        }
        break;
      case 'marquee':
        this.autoScroll(e);
        d.current = this.toContent(e);
        this.updateMarquee();
        this.draw();
        break;
      case 'text':
        if (this.editor.editingId !== d.id) break;
        this.autoScroll(e);
        this.editor.setSelection(d.anchor, this.caretAt(d.id, this.toContent(e)));
        break;
    }
  }

  onMouseUp(e) {
    const d = this.drag;
    if (!d || e.button !== 0) return;
    this.drag = null;
    this.scroller.style.cursor = 'default';
    const sel = this.app.selection;
    switch (d.type) {
      case 'pending':
        sel.clear();
        sel.add(d.id);
        if (d.part === 'inner') this.editor.start(d.id, this.caretAt(d.id, d.start));
        else this.draw();
        break;
      case 'item':
        if (d.target) this.app.moveItems(d.ids, d.target);
        else this.draw();
        break;
      case 'pan':
        if (!d.moved) {
          sel.clear();
          this.draw();
        }
        break;
      case 'marquee':
        for (const id of d.candidates) sel.add(id);
        this.draw();
        break;
    }
  }

  beginItemDrag(e) {
    const d = this.drag;
    const sel = this.app.selection;
    if (!sel.has(d.id)) {
      sel.clear();
      sel.add(d.id);
    }
    const ids = this.app.topmostSelected();
    if (ids.length === 0) {
      // ルートのみの選択はドラッグ移動できない
      this.drag = { type: 'none' };
      this.draw();
      return;
    }
    const excluded = new Set();
    const index = this.app.index;
    for (const node of this.layout.order) {
      if (ids.some((id) => id === node.id || Model.isDescendant(index, node.id, id))) excluded.add(node.id);
    }
    this.drag = { type: 'item', ids, excluded, start: d.start, current: this.toContent(e), target: null };
    this.drag.target = this.dropTarget(this.drag.current);
    this.scroller.style.cursor = 'grabbing';
    this.draw();
  }

  // ドロップ先：アイテム上部 3 割＝直前の兄弟、下部 3 割＝直後の兄弟、中央＝最後の子（ルートは常に子）
  dropTarget(p) {
    const order = this.layout.order;
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      if (this.drag.excluded.has(n.id)) continue;
      if (p.x < n.x || p.x > n.x + n.w || p.y < n.y || p.y > n.y + n.h) continue;
      if (n.parentId === null) return { id: n.id, mode: 'child' };
      const rel = (p.y - n.y) / n.h;
      return { id: n.id, mode: rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'child' };
    }
    return null;
  }

  cancelDrag() {
    if (!this.drag) return false;
    this.drag = null;
    this.scroller.style.cursor = 'default';
    this.draw();
    return true;
  }

  updateMarquee() {
    const d = this.drag;
    const x1 = Math.min(d.start.x, d.current.x);
    const y1 = Math.min(d.start.y, d.current.y);
    const x2 = Math.max(d.start.x, d.current.x);
    const y2 = Math.max(d.start.y, d.current.y);
    d.rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    d.candidates = new Set();
    for (const n of this.layout.order) {
      const ow = Math.min(x2, n.x + n.w) - Math.max(x1, n.x);
      const oh = Math.min(y2, n.y + n.h) - Math.max(y1, n.y);
      if (ow > 0 && oh > 0 && ow * oh * 2 >= n.w * n.h) d.candidates.add(n.id);
    }
  }

  autoScroll(e) {
    const r = this.scroller.getBoundingClientRect();
    const edge = 30;
    const step = 20;
    if (e.clientX < r.left + edge) this.scroller.scrollLeft -= step;
    else if (e.clientX > r.right - edge) this.scroller.scrollLeft += step;
    if (e.clientY < r.top + edge) this.scroller.scrollTop -= step;
    else if (e.clientY > r.bottom - edge) this.scroller.scrollTop += step;
  }

  // ESC でドラッグをキャンセル。処理したら true
  handleKeyDown(e) {
    if (e.key === 'Escape' && this.drag && this.drag.type !== 'pending') {
      e.preventDefault();
      return this.cancelDrag();
    }
    return false;
  }
}
