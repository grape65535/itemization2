'use strict';

// 全タブ共通の単一 Undo/Redo 履歴。
// 各エントリは変更前後の文書 JSON と、Undo/Redo 時に表示すべき位置（タブ・アイテム）を持つ。
class History {
  constructor(limit) {
    this.limit = limit;
    this.entries = [];
    this.position = 0;
  }

  push(entry) {
    this.entries.length = this.position;
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.position = this.entries.length;
  }

  canUndo() {
    return this.position > 0;
  }

  canRedo() {
    return this.position < this.entries.length;
  }

  undo() {
    return this.canUndo() ? this.entries[--this.position] : null;
  }

  redo() {
    return this.canRedo() ? this.entries[this.position++] : null;
  }
}
