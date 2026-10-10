'use strict';

// アイテムへの文字入力。
// 見えない TEXTAREA でキー入力・IME・クリップボードを受け、装飾付きの文字・選択範囲・カーソルは CANVAS に描く（WYSIWYG）。
// 未確定の内容（文字列・文字ごとのスタイル・アイテム背景色・寄せ方）は入力終了時にまとめて文書へ反映する。
class ItemEditor {
  constructor(mainArea, textarea) {
    this.area = mainArea;
    this.app = mainArea.app;
    this.ta = textarea;
    this.editingId = null;
    this.styles = []; // 文字ごとのスタイル（RichText.intern の値）
    this.fill = null;
    this.align = 'left';
    this.prevText = '';
    this.sel = [0, 0]; // 最後に把握した選択範囲
    this.undoStack = [];
    this.redoStack = [];
    this.lastKind = null; // 直前の入力の種類（連続する入力を 1 回の Undo にまとめる）
    this.goalX = null; // ↑↓で移動する時の横位置
    this.composition = null; // IME 変換中: { start, baseLength }
    this.caretOn = true;
    this.blinkTimer = null;

    this.ta.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.ta.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    this.ta.addEventListener('input', (e) => this.onInput(e));
    this.ta.addEventListener('select', () => this.syncSelection());
    this.ta.addEventListener('compositionstart', () => {
      const ta = this.ta;
      this.composition = { start: ta.selectionStart, baseLength: ta.value.length - (ta.selectionEnd - ta.selectionStart) };
    });
    this.ta.addEventListener('compositionend', () => {
      this.composition = null;
      this.area.draw();
    });
    document.addEventListener('selectionchange', () => {
      if (this.editingId !== null && document.activeElement === this.ta) this.syncSelection();
    });
    this.ta.addEventListener('focus', () => this.area.draw());
    this.ta.addEventListener('blur', () => {
      // ページ内の別要素へフォーカスが移った時だけ確定する（ウィンドウ切替では継続）
      if (this.editingId && document.hasFocus()) this.end();
      else this.area.draw();
    });
    window.addEventListener('focus', () => this.area.draw());
  }

  get isEditing() {
    return this.editingId !== null;
  }

  get text() {
    return this.ta.value;
  }

  // 配置計算に使う未確定の内容
  get override() {
    return { id: this.editingId, text: this.ta.value, styles: this.styles, fill: this.fill, align: this.align };
  }

  get node() {
    return this.editingId !== null && this.area.layout ? this.area.layout.nodes.get(this.editingId) : null;
  }

  // caret: 数値オフセット / 'end' / { line: 'first'|'last'|番号, col?: 数値, pos?: 'start'|'end' }
  start(itemId, caret = 'end') {
    if (!this.app.index.get(itemId)) return;
    if (this.editingId !== null) this.commitText();
    const item = this.app.index.get(itemId).item;
    this.editingId = itemId;
    this.ta.value = item.text;
    this.prevText = item.text;
    this.styles = RichText.toArray(item.text, item.spans);
    this.fill = item.fill || null;
    this.align = item.align || 'left';
    this.undoStack = [];
    this.redoStack = [];
    this.lastKind = null;
    this.goalX = null;
    this.composition = null;
    this.ta.style.display = 'block';
    this.area.render();
    const offset = this.resolveCaret(caret);
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(offset, offset);
    this.sel = [offset, offset];
    this.area.scrollIntoView(itemId);
    this.app.tabBar.render();
    this.syncSelection();
  }

  resolveCaret(caret) {
    const text = this.ta.value;
    if (typeof caret === 'number') return Util.clamp(caret, 0, text.length);
    if (caret === 'end' || !caret || !this.node) return text.length;
    const lines = this.node.lines;
    const last = lines.length - 1;
    const index = caret.line === 'first' ? 0 : caret.line === 'last' ? last : Util.clamp(caret.line, 0, last);
    const line = lines[index];
    if (caret.pos === 'start') return line.start;
    if (caret.pos === 'end') return line.end;
    return line.start + Math.min(caret.col || 0, line.end - line.start);
  }

  // 未確定の内容を文書に反映する（変更があれば履歴に積まれる）
  commitText() {
    const id = this.editingId;
    if (id === null) return;
    const entry = this.app.index.get(id);
    if (!entry) return;
    const text = this.ta.value;
    const spans = RichText.toSpans(RichText.fit(this.styles, text.length));
    const item = entry.item;
    const same = item.text === text && JSON.stringify(item.spans || null) === JSON.stringify(spans) &&
      (item.fill || null) === this.fill && (item.align || 'left') === this.align;
    if (same) return;
    const decoration = { spans, fill: this.fill, align: this.align };
    this.app.commit((doc) => {
      const target = Model.locate(doc, id).item;
      target.text = text;
      RichText.assignDecoration(target, decoration);
    }, { itemId: id });
  }

  // 文字入力を確定して終了する（選択状態は変えない）
  end() {
    if (this.editingId === null) return;
    this.commitText();
    this.cancel();
  }

  // 確定せずに終了する（アイテム削除時・Undo 時など）
  cancel() {
    if (this.editingId === null) return;
    this.editingId = null;
    this.composition = null;
    this.stopBlink();
    this.area.toolbar.closePopup();
    this.ta.style.display = 'none';
    if (document.activeElement === this.ta) this.ta.blur();
    this.area.render();
    this.app.tabBar.render();
  }

  // ---- 選択範囲・カーソル ----

  // [anchor, focus]（focus はカーソルのある側）
  anchorFocus() {
    const ta = this.ta;
    return ta.selectionDirection === 'backward' ? [ta.selectionEnd, ta.selectionStart] : [ta.selectionStart, ta.selectionEnd];
  }

  setSelection(anchor, focus, keepGoal = false) {
    const len = this.ta.value.length;
    anchor = Util.clamp(anchor, 0, len);
    focus = Util.clamp(focus, 0, len);
    this.ta.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), focus < anchor ? 'backward' : 'forward');
    if (!keepGoal) this.goalX = null;
    this.syncSelection();
  }

  // 選択範囲の変化を反映する（カーソルの点滅を戻し、TEXTAREA・ツールバーの位置と状態を更新して再描画）
  syncSelection() {
    if (this.editingId === null) return;
    const s = this.ta.selectionStart;
    const e = this.ta.selectionEnd;
    if (s !== this.sel[0] || e !== this.sel[1]) {
      this.sel = [s, e];
      this.lastKind = null;
    }
    this.restartBlink();
    this.area.positionEditor();
    this.area.draw();
    this.area.toolbar.update();
  }

  // 単語単位で選択する（ダブルクリック）
  selectWord(offset) {
    const text = this.ta.value;
    let start = offset;
    let end = offset;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      for (const seg of new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)) {
        const segEnd = seg.index + seg.segment.length;
        if (seg.index <= offset && offset < segEnd && seg.segment !== '\n') {
          start = seg.index;
          end = segEnd;
          break;
        }
      }
    } else {
      const word = /[\p{L}\p{N}_]/u;
      while (start > 0 && word.test(text[start - 1])) start--;
      while (end < text.length && word.test(text[end])) end++;
    }
    this.setSelection(start, end);
  }

  // 改行で区切られた段落を選択する（トリプルクリック）
  selectParagraph(offset) {
    const text = this.ta.value;
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    const nl = text.indexOf('\n', offset);
    this.setSelection(start, nl < 0 ? text.length : nl);
  }

  // オフセットの位置のカーソル矩形（コンテンツ座標）
  caretRect(offset) {
    const node = this.node;
    const line = node.lines[TextMeasurer.lineIndexOf(node.lines, offset)];
    return {
      x: node.x + Config.paddingX + line.x + this.area.measurer.xOf(node.text, node.styles, line, offset),
      y: node.y + Config.paddingY + line.top,
      h: line.height,
      line,
    };
  }

  // 範囲 [start, end) を表示行ごとの矩形にする（改行をまたぐ行は改行分の幅を足す）
  rangeRects(start, end) {
    const node = this.node;
    const m = this.area.measurer;
    const rects = [];
    for (const line of node.lines) {
      const from = Math.max(start, line.start);
      const to = Math.min(end, line.end);
      const crossesNewline = end > line.end && start <= line.end && node.text[line.end] === '\n';
      if (from > to || (from === to && !crossesNewline)) continue;
      const x1 = m.xOf(node.text, node.styles, line, from);
      const x2 = m.xOf(node.text, node.styles, line, to) + (crossesNewline ? 4 : 0);
      rects.push({
        x: node.x + Config.paddingX + line.x + x1,
        y: node.y + Config.paddingY + line.top,
        w: x2 - x1,
        h: line.height,
        line,
      });
    }
    return rects;
  }

  // CANVAS に描く文字入力の状態
  drawState() {
    if (!this.node) return null;
    const ta = this.ta;
    const focused = document.activeElement === ta && document.hasFocus();
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    let composition = [];
    if (this.composition) {
      const cs = this.composition.start;
      const ce = cs + ta.value.length - this.composition.baseLength;
      composition = this.rangeRects(cs, ce).map((r) => ({ x: r.x, y: r.y + Math.round(r.line.baseline) + 2, w: r.w }));
    }
    return {
      id: this.editingId,
      focused,
      selection: s < e ? this.rangeRects(s, e) : [],
      caret: s === e && focused && this.caretOn ? this.caretRect(s) : null,
      composition,
    };
  }

  restartBlink() {
    this.caretOn = true;
    this.stopBlink();
    this.blinkTimer = setInterval(() => {
      this.caretOn = !this.caretOn;
      this.area.draw();
    }, 530);
  }

  stopBlink() {
    if (this.blinkTimer !== null) clearInterval(this.blinkTimer);
    this.blinkTimer = null;
  }

  // ---- 入力 ----

  snapshot() {
    return { text: this.ta.value, styles: this.styles, fill: this.fill, align: this.align, sel: this.sel.slice() };
  }

  pushUndo(snap = this.snapshot()) {
    this.undoStack.push(snap);
    if (this.undoStack.length > Config.historyLimit) this.undoStack.shift();
    this.redoStack = [];
  }

  restoreSnapshot(snap) {
    this.ta.value = snap.text;
    this.prevText = snap.text;
    this.styles = snap.styles;
    this.fill = snap.fill;
    this.align = snap.align;
    this.lastKind = null;
    this.area.render();
    this.ta.setSelectionRange(snap.sel[0], snap.sel[1]);
    this.sel = snap.sel.slice();
    this.syncSelection();
    this.notifyRootChange();
  }

  // 文字入力中の Undo/Redo（文字・装飾の変更を 1 操作ずつ戻す。アプリの履歴とは別）
  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.snapshot());
    this.restoreSnapshot(snap);
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.snapshot());
    this.restoreSnapshot(snap);
  }

  onBeforeInput(e) {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      if (e.inputType === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    // 変更前の選択範囲（Undo で戻す位置）
    if (this.ta.value === this.prevText) this.sel = [this.ta.selectionStart, this.ta.selectionEnd];
  }

  // 文字列の変化から文字ごとのスタイルを追従させる。
  // 挿入した文字は、置き換えた文字（無ければ直前の文字、先頭なら直後の文字）のスタイルを引き継ぐ
  onInput(e) {
    if (this.editingId === null) return;
    const text = this.ta.value;
    const before = this.prevText;
    if (text !== before) {
      const d = RichText.diff(before, text, this.ta.selectionEnd);
      const inserted = text.slice(d.from, d.from + d.inserted);
      const type = e && e.inputType ? e.inputType : '';
      const kind = inserted.includes('\n') ? 'other'
        : /^insert(Text|CompositionText)$/.test(type) ? 'insert'
          : /^delete(Content)?(Backward|Forward)$/.test(type) ? 'delete' : 'other';
      if (kind !== this.lastKind || kind === 'other') {
        this.pushUndo({ text: before, styles: this.styles, fill: this.fill, align: this.align, sel: this.sel.slice() });
      }
      const old = RichText.fit(this.styles, before.length);
      const style = d.removed > 0 ? old[d.from] : d.from > 0 ? old[d.from - 1] : old[0] || null;
      this.styles = RichText.splice(old, d.from, d.removed, d.inserted, style);
      this.prevText = text;
      this.redoStack = [];
      this.sel = [this.ta.selectionStart, this.ta.selectionEnd];
      this.lastKind = kind;
    }
    this.goalX = null;
    this.area.render();
    this.syncSelection();
    this.notifyRootChange();
  }

  notifyRootChange() {
    const entry = this.app.index.get(this.editingId);
    if (entry && !entry.parent) this.app.tabBar.render();
  }

  insertText(str) {
    // execCommand なら input イベントが発生し、スタイルも追従する
    if (!document.execCommand('insertText', false, str)) {
      this.ta.setRangeText(str, this.ta.selectionStart, this.ta.selectionEnd, 'end');
      this.onInput({ inputType: 'insertText' });
    }
  }

  // ---- ツールバーからの装飾 ----

  // 選択中の文字列の装飾の状態（ツールバーの表示用）
  selectionInfo() {
    const text = this.ta.value;
    const styles = RichText.fit(this.styles, text.length);
    const s = this.ta.selectionStart;
    const e = this.ta.selectionEnd;
    return {
      hasSelection: s < e,
      bold: s < e && RichText.allHave(styles, text, s, e, 'bold'),
      strike: s < e && RichText.allHave(styles, text, s, e, 'strike'),
      underline: s < e && RichText.allHave(styles, text, s, e, 'underline'),
      size: s < e ? RichText.commonValue(styles, text, s, e, (st) => RichText.sizeOf(st)) : null,
      color: s < e ? RichText.commonValue(styles, text, s, e, (st) => (st && st.color) || '') : null,
      bg: s < e ? RichText.commonValue(styles, text, s, e, (st) => (st && st.bg) || '') : null,
      fill: this.fill || '',
      align: this.align,
    };
  }

  // 選択中の文字列だけに装飾を設定する（value が null なら解除）。選択が無ければ何もしない
  applyStyle(prop, value) {
    const s = this.ta.selectionStart;
    const e = this.ta.selectionEnd;
    if (this.editingId === null || s >= e) return;
    const styles = RichText.fit(this.styles, this.ta.value.length).slice();
    for (let i = s; i < e; i++) styles[i] = RichText.withProp(styles[i], prop, value);
    this.pushUndo();
    this.styles = styles;
    this.decorated();
  }

  // 太字・取消し線・下線：選択中の文字がすべて持っていれば解除、そうでなければ設定
  toggleStyle(prop) {
    const s = this.ta.selectionStart;
    const e = this.ta.selectionEnd;
    if (s >= e) return;
    const all = RichText.allHave(RichText.fit(this.styles, this.ta.value.length), this.ta.value, s, e, prop);
    this.applyStyle(prop, all ? null : true);
  }

  // アイテム全体の背景色・寄せ方（選択範囲に関係なく適用）
  setFill(color) {
    if (this.editingId === null || (color || null) === this.fill) return;
    this.pushUndo();
    this.fill = color || null;
    this.decorated();
  }

  setAlign(align) {
    if (this.editingId === null || align === this.align) return;
    this.pushUndo();
    this.align = align;
    this.decorated();
  }

  // ツールバーで操作できる装飾（文字の装飾・アイテム背景色・寄せ方）をアイテム全体から消す
  clearDecoration() {
    if (this.editingId === null) return;
    const styles = new Array(this.ta.value.length).fill(null);
    if (this.fill === null && this.align === 'left' && this.styles.every((s) => s === null)) return;
    this.pushUndo();
    this.styles = styles;
    this.fill = null;
    this.align = 'left';
    this.decorated();
  }

  decorated() {
    this.lastKind = null;
    this.area.render();
    this.syncSelection();
  }

  // ---- キー操作 ----

  onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || this.editingId === null) return;
    const ta = this.ta;
    const text = ta.value;
    const start = ta.selectionStart;
    const noSelection = start === ta.selectionEnd;
    const ctrl = e.ctrlKey || e.metaKey;
    const plain = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    const id = this.editingId;
    const node = this.node;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // 文字入力中の Undo/Redo は文字・装飾の変更をアイテム内で戻す
    if (ctrl && !e.altKey && (key === 'z' || (key === 'y' && !e.shiftKey))) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') this.goalX = null;
    // カーソル移動などの既定の動作の後に、描画を合わせる
    setTimeout(() => this.syncSelection(), 0);

    switch (e.key) {
      case 'Enter':
        if (!plain) return; // SHIFT+ENTER は通常の改行
        e.preventDefault();
        this.createAndEdit(id, 'sibling');
        return;
      case 'Escape':
        e.preventDefault();
        if (this.area.toolbar.closePopup()) return;
        this.end();
        return;
      case 'Backspace':
      case 'Delete':
        if (plain && text.length === 0) {
          e.preventDefault();
          this.deleteEmpty(id);
        }
        return;
      case '>':
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        if (noSelection && start > 0 && (text[start - 1] === '\\' || text[start - 1] === '¥')) {
          ta.setSelectionRange(start - 1, start);
          this.insertText('>');
        } else {
          this.createAndEdit(id, 'child');
        }
        return;
    }

    if (!node || ctrl || e.altKey) return;
    const lines = node.lines;
    const [anchor, focus] = this.anchorFocus();
    const lineIndex = TextMeasurer.lineIndexOf(lines, focus);
    const line = lines[lineIndex];

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const up = e.key === 'ArrowUp';
        const edge = up ? lineIndex === 0 : lineIndex === lines.length - 1;
        if (edge && plain && noSelection) {
          // 表示上の 1 行目の↑・最終行の↓は、同じ階層の前後のアイテムへ
          const target = this.area.sameDepthNeighbor(id, up ? -1 : 1);
          if (target) this.start(target, { line: up ? 'last' : 'first', col: start - line.start });
          else this.setSelection(up ? 0 : text.length, up ? 0 : text.length);
          return;
        }
        let to;
        const x = this.goalX !== null ? this.goalX : line.x + this.area.measurer.xOf(text, node.styles, line, focus);
        if (edge) {
          to = up ? 0 : text.length;
        } else {
          const next = lines[lineIndex + (up ? -1 : 1)];
          to = this.area.measurer.offsetAt(text, node.styles, next, x - next.x);
        }
        this.setSelection(e.shiftKey ? anchor : to, to, true);
        this.goalX = x;
        return;
      }
      case 'Home':
      case 'End': {
        e.preventDefault();
        const to = e.key === 'Home' ? line.start : line.end;
        this.setSelection(e.shiftKey ? anchor : to, to);
        return;
      }
    }

    if (!plain || !noSelection) return;
    switch (e.key) {
      case 'ArrowLeft':
        if (start !== line.start || node.parentId === null) return;
        e.preventDefault();
        this.start(node.parentId, { line: lineIndex, pos: 'end' });
        return;
      case 'ArrowRight':
        if (start !== line.end || node.children.length === 0) return;
        e.preventDefault();
        this.start(node.children[0].id, { line: lineIndex, pos: 'start' });
        return;
    }
  }

  // ENTER（兄弟・ルートでは子）/ SHIFT+.（最後の子）でアイテムを新設して入力を移す
  createAndEdit(id, kind) {
    this.commitText();
    let newId = null;
    this.app.commit((doc) => {
      const loc = Model.locate(doc, id);
      const item = Model.createItem('');
      newId = item.id;
      if (kind === 'child' || !loc.parent) {
        loc.item.collapsed = false;
        loc.item.children.push(item);
      } else {
        loc.parent.children.splice(loc.index + 1, 0, item);
      }
      return { itemId: newId };
    }, { itemId: id });
    this.app.selection.clear();
    this.editingId = null;
    this.start(newId, 0);
  }

  // 0 文字のアイテムで BackSpace/Delete：アイテムを削除し、子を繰り上げる
  deleteEmpty(id) {
    const entry = this.app.index.get(id);
    if (!entry || !entry.parent) return; // ルートは何もしない
    const focusId = entry.index > 0 ? entry.parent.children[entry.index - 1].id : entry.parent.id;
    this.editingId = null;
    this.app.commit((doc) => {
      Model.removePromote(doc, id);
      return { itemId: focusId };
    }, { itemId: id });
    this.app.selection.delete(id);
    this.start(focusId, 'end');
  }
}
