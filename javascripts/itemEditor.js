'use strict';

// アイテムへの文字入力（CANVAS 上に TEXTAREA をオーバーラップ表示する）
class ItemEditor {
  constructor(mainArea, textarea) {
    this.area = mainArea;
    this.app = mainArea.app;
    this.ta = textarea;
    this.editingId = null;

    this.ta.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.ta.addEventListener('input', () => this.onInput());
    this.ta.addEventListener('blur', () => {
      // ページ内の別要素へフォーカスが移った時だけ確定する（ウィンドウ切替では継続）
      if (this.editingId && document.hasFocus()) this.end();
    });
  }

  get isEditing() {
    return this.editingId !== null;
  }

  get text() {
    return this.ta.value;
  }

  // caret: 数値オフセット / 'end' / { line: 'first'|'last'|番号, col?: 数値, pos?: 'start'|'end' }
  start(itemId, caret = 'end') {
    const entry = this.app.index.get(itemId);
    if (!entry) return;
    if (this.editingId !== null && this.editingId !== itemId) this.commitText();
    this.editingId = itemId;
    const text = entry.item.text;
    this.ta.value = text; // 値の再設定で TEXTAREA 自身の Undo 履歴はリセットされる
    this.ta.style.display = 'block';
    this.area.render();
    const offset = this.resolveCaret(text, caret);
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(offset, offset);
    this.area.scrollIntoView(itemId);
    this.app.tabBar.render();
  }

  resolveCaret(text, caret) {
    if (typeof caret === 'number') return Util.clamp(caret, 0, text.length);
    if (caret === 'end' || !caret) return text.length;
    const lines = this.area.measurer.wrap(text, Config.maxContentWidth);
    const last = lines.length - 1;
    const index = caret.line === 'first' ? 0 : caret.line === 'last' ? last : Util.clamp(caret.line, 0, last);
    const line = lines[index];
    if (caret.pos === 'start') return line.start;
    if (caret.pos === 'end') return line.end;
    return line.start + Math.min(caret.col || 0, line.end - line.start);
  }

  // 未確定の文字列を文書に反映する（変更があれば履歴に積まれる）
  commitText() {
    const id = this.editingId;
    if (id === null) return;
    const entry = this.app.index.get(id);
    const text = this.ta.value;
    if (!entry || entry.item.text === text) return;
    this.app.commit((doc) => {
      Model.locate(doc, id).item.text = text;
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
    this.ta.style.display = 'none';
    if (document.activeElement === this.ta) this.ta.blur();
    this.area.render();
    this.app.tabBar.render();
  }

  onInput() {
    if (this.editingId === null) return;
    this.area.render();
    const entry = this.app.index.get(this.editingId);
    if (entry && !entry.parent) this.app.tabBar.render();
  }

  insertText(str) {
    // execCommand なら TEXTAREA 自身の Undo 履歴に残る
    if (!document.execCommand('insertText', false, str)) {
      this.ta.setRangeText(str, this.ta.selectionStart, this.ta.selectionEnd, 'end');
      this.onInput();
    }
  }

  onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || this.editingId === null) return;
    const ta = this.ta;
    const text = ta.value;
    const start = ta.selectionStart;
    const noSelection = start === ta.selectionEnd;
    const plain = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    const id = this.editingId;
    const node = this.area.layout && this.area.layout.nodes.get(id);

    switch (e.key) {
      case 'Enter':
        if (!plain) return; // SHIFT+ENTER は通常の改行
        e.preventDefault();
        this.createAndEdit(id, 'sibling');
        return;
      case 'Escape':
        e.preventDefault();
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

    if (!plain || !noSelection || !node) return;
    const lines = this.area.measurer.wrap(text, Config.maxContentWidth);
    const lineIndex = TextMeasurer.lineIndexOf(lines, start);
    const line = lines[lineIndex];
    const nav = this.area;

    switch (e.key) {
      case 'ArrowUp': {
        if (lineIndex !== 0) return;
        e.preventDefault();
        const target = nav.sameDepthNeighbor(id, -1);
        if (target) this.start(target, { line: 'last', col: start - line.start });
        else ta.setSelectionRange(0, 0);
        return;
      }
      case 'ArrowDown': {
        if (lineIndex !== lines.length - 1) return;
        e.preventDefault();
        const target = nav.sameDepthNeighbor(id, 1);
        if (target) this.start(target, { line: 'first', col: start - line.start });
        else ta.setSelectionRange(text.length, text.length);
        return;
      }
      case 'ArrowLeft':
        if (start !== line.start || node.parentId === null) return;
        e.preventDefault();
        this.start(node.parentId, { line: lineIndex, pos: 'end' });
        return;
      case 'ArrowRight':
        if (start !== line.start || node.children.length === 0) return;
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
