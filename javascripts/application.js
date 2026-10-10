'use strict';

// アプリ全体の状態（文書・アクティブタブ・選択・履歴）と画面部品の統括
class Application {
  constructor(rootEl) {
    this.doc = Storage.loadDocument() || Model.createDocument();
    this.reindex();
    const ui = Storage.loadUi();
    this.activeTabId = this.findTab(ui.activeTabId) ? ui.activeTabId : this.doc.tabs[0].id;
    this.selection = new Set();
    this.history = new History(Config.historyLimit);

    const header = Util.el('header', 'app-header');
    const menus = Util.el('nav', 'menus');
    header.append(Util.el('span', 'app-name', Config.appName), menus, Util.el('span', 'app-version', Config.version));
    const tabBar = Util.el('div', 'tab-bar');
    const main = Util.el('div', 'main-area');
    rootEl.append(header, tabBar, main);
    document.title = Config.appName;

    this.menuBar = new MenuBar(this, menus);
    this.tabBar = new TabBar(this, tabBar);
    this.mainArea = new MainArea(this, main);

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.refresh();
  }

  // ---- 状態 ----

  get activeTab() {
    return this.findTab(this.activeTabId);
  }

  get editor() {
    return this.mainArea.editor;
  }

  findTab(id) {
    return this.doc.tabs.find((t) => t.id === id) || null;
  }

  reindex() {
    this.index = Model.buildIndex(this.doc);
  }

  tabTitle(tab) {
    const editor = this.mainArea && this.editor;
    let text = editor && editor.editingId === tab.root.id ? editor.text : tab.root.text;
    const chars = Array.from(text.replace(/[\r\n]/g, ''));
    return chars.length ? chars.slice(0, Config.tabTitleMaxLength).join('') : Config.newTabTitle;
  }

  setActiveTab(id) {
    if (this.activeTabId === id) return;
    this.activeTabId = id;
    this.selection.clear();
    Storage.saveUi({ activeTabId: id });
  }

  // 選択中のアイテムのうち、祖先が選択されていないもの（ルート除く）を文書順で返す
  topmostSelected() {
    const ids = [];
    for (const id of this.selection) {
      const entry = this.index.get(id);
      if (!entry || !entry.parent || entry.tab.id !== this.activeTabId) continue;
      let ancestorSelected = false;
      for (let e = this.index.get(entry.parent.id); e; e = e.parent && this.index.get(e.parent.id)) {
        if (this.selection.has(e.item.id)) {
          ancestorSelected = true;
          break;
        }
      }
      if (!ancestorSelected) ids.push(id);
    }
    return ids.sort((a, b) => this.index.get(a).order - this.index.get(b).order);
  }

  // ---- 変更（すべて履歴に積まれる） ----

  // fn(doc) で文書を変更する。fn の戻り値 { tabId, itemId } は Redo 時に表示する位置。
  // hint { tabId, itemId } は Undo 時に表示する位置（省略時はアクティブタブ）。
  commit(fn, hint = {}) {
    const before = JSON.stringify(this.doc);
    const beforeHint = { tabId: hint.tabId || this.activeTabId, itemId: hint.itemId || null };
    const result = fn(this.doc) || {};
    this.reindex();
    const after = JSON.stringify(this.doc);
    if (before === after) return false;
    this.history.push({
      before,
      after,
      beforeHint,
      afterHint: { tabId: result.tabId || beforeHint.tabId, itemId: result.itemId || beforeHint.itemId },
    });
    Storage.saveDocument(after);
    this.refresh();
    return true;
  }

  undo() {
    this.editor.end();
    const entry = this.history.undo();
    if (entry) this.restore(entry.before, entry.beforeHint);
  }

  redo() {
    this.editor.end();
    const entry = this.history.redo();
    if (entry) this.restore(entry.after, entry.afterHint);
  }

  // 履歴の状態を復元し、変化のあったタブへ切り替えて該当位置を表示する
  restore(json, hint) {
    this.doc = JSON.parse(json);
    this.reindex();
    if (hint.tabId && this.findTab(hint.tabId)) this.setActiveTab(hint.tabId);
    else if (!this.activeTab) this.setActiveTab(this.doc.tabs[0].id);
    for (const id of [...this.selection]) {
      const entry = this.index.get(id);
      if (!entry || entry.tab.id !== this.activeTabId) this.selection.delete(id);
    }
    Storage.saveDocument(json);
    this.refresh();
    const entry = hint.itemId && this.index.get(hint.itemId);
    if (entry && entry.tab.id === this.activeTabId) this.mainArea.scrollIntoView(hint.itemId);
  }

  refresh() {
    this.tabBar.render();
    this.mainArea.render();
  }

  switchTab(id) {
    if (id === this.activeTabId || !this.findTab(id)) return;
    this.editor.end();
    this.setActiveTab(id);
    this.refresh();
  }

  addTab() {
    this.editor.end();
    let tab = null;
    this.commit((doc) => {
      tab = Model.createTab();
      doc.tabs.push(tab);
      this.setActiveTab(tab.id);
      return { tabId: tab.id };
    });
    this.editor.start(tab.root.id, 0);
  }

  deleteTab(id) {
    this.editor.end();
    const index = this.doc.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    this.commit((doc) => {
      doc.tabs.splice(index, 1);
      if (doc.tabs.length === 0) doc.tabs.push(Model.createTab()); // 最低 1 個は必ず存在する
      if (!this.findTab(this.activeTabId)) this.setActiveTab(doc.tabs[Math.min(index, doc.tabs.length - 1)].id);
      return { tabId: this.activeTabId };
    }, { tabId: id });
  }

  moveTab(id, newIndex) {
    const index = this.doc.tabs.findIndex((t) => t.id === id);
    if (index < 0 || newIndex < 0) return;
    this.commit((doc) => {
      const [tab] = doc.tabs.splice(index, 1);
      doc.tabs.splice(newIndex, 0, tab);
      return { tabId: id };
    }, { tabId: id });
  }

  toggleCollapse(id) {
    this.commit((doc) => {
      const item = Model.locate(doc, id).item;
      item.collapsed = !item.collapsed;
    }, { itemId: id });
  }

  // ids を target { id, mode: 'before'|'after'|'child' } の位置へ兄弟として並べて移動する
  moveItems(ids, target) {
    this.commit((doc) => {
      const items = ids.map((id) => {
        const loc = Model.locate(doc, id);
        loc.parent.children.splice(loc.index, 1);
        return loc.item;
      });
      const t = Model.locate(doc, target.id);
      if (target.mode === 'child') {
        t.item.collapsed = false;
        t.item.children.push(...items);
      } else {
        t.parent.children.splice(t.index + (target.mode === 'after' ? 1 : 0), 0, ...items);
      }
      return { itemId: ids[0] };
    }, { itemId: ids[0] });
  }

  // 選択中のアイテムを削除し、子をその位置に繰り上げる（ルートは削除しない）
  deleteSelected() {
    const ids = [...this.selection]
      .filter((id) => {
        const entry = this.index.get(id);
        return entry && entry.parent && entry.tab.id === this.activeTabId;
      })
      .sort((a, b) => this.index.get(a).order - this.index.get(b).order);
    if (ids.length === 0) return;
    const parentId = this.index.get(ids[0]).parent.id;
    this.commit((doc) => {
      for (const id of ids) Model.removePromote(doc, id);
      return { itemId: parentId };
    }, { itemId: ids[0] });
    this.selection.clear();
    this.mainArea.draw();
  }

  // ---- キー操作（文字入力中以外） ----

  onKeyDown(e) {
    if (this.mainArea.handleKeyDown(e)) return;
    if (e.key === 'Escape' && this.menuBar.closeAll()) return;
    if (Util.isTextInput(e.target) || e.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && !e.altKey && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (ctrl && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault();
      this.redo();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && !ctrl && !e.altKey) {
      if (this.selection.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
    }
  }
}
