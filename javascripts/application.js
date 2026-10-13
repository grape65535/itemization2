'use strict';

// アプリ全体の状態（文書・アクティブタブ・選択・履歴）と画面部品の統括
class Application {
  constructor(rootEl) {
    const loaded = Storage.loadDocument();
    this.doc = loaded || Model.createDocument();
    if (loaded) Storage.saveDocument(JSON.stringify(this.doc)); // 読み込み時に補った値（旧形式のアイテムの日時など）を保存する
    this.filters = new Map(); // タブ ID -> フィルタ中の表示 { hidden: [+] で隠すアイテムの ID の Set }（文書の tab.filter.hidden から作る）
    this.reindex();
    this.syncFilters();
    const ui = Storage.loadUi();
    this.activeTabId = this.findTab(ui.activeTabId) ? ui.activeTabId : this.doc.tabs[0].id;
    this.selection = new Set();
    this.history = new History(Config.historyLimit);
    this.pseudoClipboard = null; // アプリ内の擬似クリップボード { clips, text }
    this.copyTextOverride = null; // 「〜としてコピー」でクリップボードに書く文字列

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
    this.tabSettings = new TabSettingsDialog(this);
    this.filterDialog = new FilterDialog(this);
    this.filterCondition = null; // 最後に適用したフィルタの条件 { text, ignoreCase, regex }（タブに条件が無い時のダイアログの初期値）

    // ファイルを開く（OS 標準のダイアログ）・画面へのドロップ
    this.fileInput = Util.el('input', 'file-input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,.svg,application/json,image/svg+xml';
    this.fileInput.addEventListener('change', () => this.openFiles([...this.fileInput.files]));
    rootEl.append(this.fileInput);
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    window.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        this.openFiles([...e.dataTransfer.files]);
      }
    });

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    // 文字入力中以外のコピー・切り取り・貼り付け（文字入力欄では標準動作）
    document.addEventListener('copy', (e) => this.onClipboardEvent(e, 'copy'));
    document.addEventListener('cut', (e) => this.onClipboardEvent(e, 'cut'));
    document.addEventListener('paste', (e) => this.onClipboardEvent(e, 'paste'));
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
    if (tab.name) return tab.name;
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
      if (!entry || !entry.parent || entry.tab.id !== this.activeTabId || this.isHidden(id)) continue;
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
    this.syncFilters();
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
    this.syncFilters();
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

  // タブ名の変更（空文字・変更なしの場合は何もしない）
  renameTab(id, name) {
    const tab = this.findTab(id);
    if (!tab || !name || name === this.tabTitle(tab)) return;
    this.commit((doc) => {
      doc.tabs.find((t) => t.id === id).name = name;
      return { tabId: id };
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
        // 子のあるアイテムが折り畳み中なら折り畳んだまま（子が無ければ、移動したアイテムが見えるよう展開する）
        if (t.item.children.length === 0) t.item.collapsed = false;
        t.item.children.push(...items);
      } else {
        t.parent.children.splice(t.index + (target.mode === 'after' ? 1 : 0), 0, ...items);
      }
      return { itemId: ids[0] };
    }, { itemId: ids[0] });
  }

  // 「アイテムを追加」：選択中の 1 つのアイテムの最初の子（first）・最後の子（last）・前（before）・後（after）に
  // 空のアイテムを新設して文字入力にする（子として追加する時は展開する。ルートの前後には追加しない）
  addItem(kind) {
    this.editor.end();
    const ids = this.selectedIds();
    if (ids.length !== 1) return;
    const id = ids[0];
    let newId = null;
    this.commit((doc) => {
      const loc = Model.locate(doc, id);
      if (!loc || (!loc.parent && (kind === 'before' || kind === 'after'))) return null;
      const item = Model.createItem('');
      newId = item.id;
      if (kind === 'first' || kind === 'last') {
        loc.item.collapsed = false;
        if (kind === 'first') loc.item.children.unshift(item);
        else loc.item.children.push(item);
      } else {
        loc.parent.children.splice(loc.index + (kind === 'after' ? 1 : 0), 0, item);
      }
      return { itemId: newId };
    }, { itemId: id });
    if (!newId) return;
    this.selection.clear();
    this.editor.start(newId, 0);
    this.mainArea.scrollIntoView(newId);
  }

  // 選択中のアイテムを削除し、子をその位置に繰り上げる（ルートは削除しない）。
  // withDescendants: 子を繰り上げず、子孫（折り畳み・非表示・フィルタで隠れたものも含む）ごと削除する
  deleteSelected(withDescendants = false) {
    const ids = [...this.selection]
      .filter((id) => {
        const entry = this.index.get(id);
        return entry && entry.parent && entry.tab.id === this.activeTabId && !this.isHidden(id);
      })
      .sort((a, b) => this.index.get(a).order - this.index.get(b).order);
    if (ids.length === 0) return;
    const parentId = this.index.get(ids[0]).parent.id;
    this.commit((doc) => {
      for (const id of ids) {
        if (withDescendants) Model.removeSubtree(doc, id);
        else Model.removePromote(doc, id);
      }
      return { itemId: parentId };
    }, { itemId: ids[0] });
    this.selection.clear();
    this.mainArea.draw();
  }

  // ---- ファイル ----

  // 文字入力・タブ名編集を確定する（保存・ファイル操作の前に）
  finishInput() {
    this.editor.end();
    this.tabBar.finishRename(true);
  }

  openFileDialog() {
    this.finishInput();
    this.fileInput.value = '';
    this.fileInput.click();
  }

  // JSON / SVG（metadata の JSON）を読み込み、常に新しいタブとして末尾に追加する
  async openFiles(files) {
    for (const file of files) {
      let tabs = null;
      try {
        tabs = FileExport.parseFile(await file.text());
      } catch (e) {
        tabs = null;
      }
      if (!tabs || tabs.length === 0) {
        alert('アプリケーションで開ける形式ではありませんでした');
        continue;
      }
      this.finishInput();
      this.commit((doc) => {
        doc.tabs.push(...tabs);
        this.setActiveTab(tabs[tabs.length - 1].id);
        return { tabId: this.activeTabId };
      });
    }
  }

  // 表示タブだけを内部データ形式の JSON で保存する
  saveJson() {
    this.finishInput();
    const tab = this.activeTab;
    FileExport.download(new Blob([FileExport.tabJson(tab)], { type: 'application/json' }), FileExport.fileName(this.tabTitle(tab), '.json'));
  }

  // 表示タブを SVG 画像で保存する（metadata に「名前をつけて保存」と同じ JSON を埋め込む）
  saveSvg() {
    this.finishInput();
    const tab = this.activeTab;
    const svg = FileExport.buildSvg(this.mainArea.exportScene(), FileExport.tabJson(tab));
    FileExport.download(new Blob([svg], { type: 'image/svg+xml' }), FileExport.fileName(this.tabTitle(tab), '.svg'));
  }

  // 表示タブを PDF で保存する（ライブラリ・フォントは初回に読み込む）
  async savePdf() {
    this.finishInput();
    const tab = this.activeTab;
    const scene = this.mainArea.exportScene();
    document.body.classList.add('busy');
    try {
      const bytes = await FileExport.buildPdf(scene);
      FileExport.download(new Blob([bytes], { type: 'application/pdf' }), FileExport.fileName(this.tabTitle(tab), '.pdf'));
    } catch (e) {
      console.error(e);
      alert('PDFの作成に失敗しました');
    } finally {
      document.body.classList.remove('busy');
    }
  }

  // ---- ツリーを全て開く／閉じる ----

  // 選択アイテム（無ければルート）とその全ての子孫を開く／閉じる。子のあるアイテムだけを対象にする。
  // 開く時は、子孫のうちフィルタ・非表示の [+] で隠したアイテムも表示する
  setTreeCollapsed(collapsed) {
    this.editor.end();
    const ids = this.selectedIds();
    const targets = ids.length ? ids : [this.activeTab.root.id];
    this.commit((doc) => {
      const tab = doc.tabs.find((t) => t.id === this.activeTabId);
      const opened = [];
      const walk = (item) => {
        if (item.children.length > 0) item.collapsed = collapsed;
        if (!collapsed) {
          delete item.hidden;
          opened.push(item.id);
        }
        item.children.forEach(walk);
      };
      for (const id of targets) walk(Model.locate(doc, id).item);
      Model.unhideFiltered(tab, opened);
      return { itemId: targets[0] };
    }, { itemId: targets[0] });
  }

  // ---- ステータス ----

  // 「ステータスを設定」のサブメニュー（タブの設定に登録されたステータス）
  statusMenuItems() {
    return this.activeTab.options.statuses.map((s) => ({
      label: s.name,
      badge: TabSettingsDialog.badge(s.name, s.color),
      action: () => this.setStatus(s.name),
    }));
  }

  selectedHasStatus() {
    return this.selectedIds().some((id) => !!this.index.get(id).item.status);
  }

  // 選択中のアイテムにステータスを設定する（name が null なら削除）。1 回の Undo で戻る
  setStatus(name) {
    this.editor.end();
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    this.commit((doc) => {
      for (const id of ids) {
        const item = Model.locate(doc, id).item;
        const before = item.status;
        Model.assignStatus(item, name);
        if (item.status !== before) item.updated = Model.now();
      }
      return { itemId: ids[0] };
    }, { itemId: ids[0] });
  }

  // ---- 並べ替え ----

  // 選択中のアイテムを、親ごとに同階層の中で並べ替える（1 回の Undo で戻る）。
  // 同じ親の選択アイテムが連続していなければ、最も兄のアイテムの位置から連続させて並べる。
  // mode: 'status'（タブの設定のステータス順）/ 'created'（登録順）/ 'updated'（更新順）/ 'name'（名前順）/ 'reverse'（逆順）
  sortSelected(mode) {
    this.editor.end();
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const groups = new Map(); // 親の ID -> 選択中の子の ID（文書順）
    for (const id of ids) {
      const parent = this.index.get(id).parent;
      if (!parent) continue; // ルートは並べ替えない
      if (!groups.has(parent.id)) groups.set(parent.id, []);
      groups.get(parent.id).push(id);
    }
    if (groups.size === 0) return;
    const tabId = this.activeTabId;
    this.commit((doc) => {
      const tab = doc.tabs.find((t) => t.id === tabId);
      const compare = Application.sortComparator(mode, tab.options);
      for (const [parentId, childIds] of groups) {
        const parent = Model.locate(doc, parentId).item;
        const picked = new Set(childIds);
        const start = parent.children.findIndex((c) => picked.has(c.id));
        const items = parent.children.filter((c) => picked.has(c.id));
        const rest = parent.children.filter((c) => !picked.has(c.id));
        // 安定ソート（同じ値なら元の順序を保つ）
        const sorted = mode === 'reverse' ? items.reverse()
          : items.map((item, i) => ({ item, i })).sort((a, b) => compare(a.item, b.item) || a.i - b.i).map((e) => e.item);
        rest.splice(start, 0, ...sorted);
        parent.children = rest;
      }
      return { itemId: ids[0] };
    }, { itemId: ids[0] });
  }

  // 並べ替えの比較関数（reverse 以外）
  static sortComparator(mode, options) {
    if (mode === 'status') {
      // 登録順のステータス → 未登録のステータス → ステータス無し
      const names = options.statuses.map((s) => s.name);
      const rank = (item) => (!item.status ? names.length + 1 : names.includes(item.status) ? names.indexOf(item.status) : names.length);
      return (a, b) => rank(a) - rank(b);
    }
    if (mode === 'created' || mode === 'updated') return (a, b) => Date.parse(a[mode]) - Date.parse(b[mode]);
    const collator = new Intl.Collator('ja', { numeric: true });
    return (a, b) => collator.compare(a.text, b.text);
  }

  clearStatus() {
    this.setStatus(null);
  }

  // ---- 全て選択・コピー・切り取り・貼り付け ----

  // アクティブタブ内の選択中アイテム（文書順。フィルタで隠れたアイテムは除く）
  selectedIds() {
    return [...this.selection]
      .filter((id) => {
        const entry = this.index.get(id);
        return entry && entry.tab.id === this.activeTabId && !this.isHidden(id);
      })
      .sort((a, b) => this.index.get(a).order - this.index.get(b).order);
  }

  selectAll() {
    this.editor.end();
    this.selection.clear();
    const walk = (item) => {
      if (this.isHiddenItem(item)) return; // フィルタ・非表示で隠れたアイテムは選択しない
      this.selection.add(item.id);
      item.children.forEach(walk);
    };
    walk(this.activeTab.root);
    this.mainArea.draw();
  }

  // 選択中アイテムの子孫（折り畳み中も含む。フィルタ・非表示で隠れたアイテムは除く）を選択に加える
  selectDescendants() {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    this.editor.end();
    const walk = (item) => {
      if (this.isHiddenItem(item)) return;
      this.selection.add(item.id);
      item.children.forEach(walk);
    };
    for (const id of ids) this.index.get(id).item.children.forEach(walk);
    this.mainArea.draw();
  }

  // 選択中アイテムの兄弟（自身を含む。フィルタ・非表示で隠れたアイテムは除く）を選択に加える
  selectSiblings() {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    this.editor.end();
    for (const id of ids) {
      const parent = this.index.get(id).parent;
      if (!parent) continue; // ルートには兄弟が無い
      for (const child of parent.children) {
        if (!this.isHidden(child.id)) this.selection.add(child.id);
      }
    }
    this.mainArea.draw();
  }

  // 選択中アイテムのコピー用データ。選択が無ければ null
  clipboardData() {
    const ids = this.selectedIds();
    if (ids.length === 0) return null;
    const clips = ItemClipboard.fromSelection(this.index, ids);
    return { clips, text: ItemClipboard.toText(clips), json: ItemClipboard.toJson(clips) };
  }

  // モーダルダイアログを表示中か
  get modalOpen() {
    return this.tabSettings.isOpen || this.filterDialog.isOpen;
  }

  // ---- フィルタ ----

  get activeFilter() {
    return this.filters.get(this.activeTabId) || null;
  }

  // フィルタ・非表示の [+] で隠れているアイテム（自身か祖先が隠れている）か
  isHidden(id) {
    const entry = this.index.get(id);
    if (!entry) return false;
    const filter = this.filters.get(entry.tab.id);
    for (let e = entry; e; e = e.parent && this.index.get(e.parent.id)) {
      if (e.item.hidden || (filter && filter.hidden.has(e.item.id))) return true;
    }
    return false;
  }

  // 表示タブで、アイテム自身が [+] で隠れているか（祖先は見ない）
  isHiddenItem(item) {
    const filter = this.activeFilter;
    return !!item.hidden || (!!filter && filter.hidden.has(item.id));
  }

  // 表示タブにフィルタを適用する（Model.filterPlan）。条件とフィルタ中であることをタブに記録し、
  // 折り畳み状態の変更とあわせて 1 回の Undo で戻る。表示されなくなったアイテムの選択は解除する
  applyFilter(condition) {
    this.finishInput();
    const tabId = this.activeTabId;
    this.filterCondition = condition;
    const changed = this.commit((doc) => {
      const tab = doc.tabs.find((t) => t.id === tabId);
      tab.filter = Object.assign({}, condition, { active: true });
      Model.applyFilter(tab);
      return { tabId };
    }, { tabId });
    if (!changed) this.refresh();
    for (const id of [...this.selection]) {
      if (!this.mainArea.layout.nodes.has(id)) this.selection.delete(id);
    }
    this.mainArea.draw();
  }

  // 文書のフィルタ状態（tab.filter の active・hidden。Undo/Redo などで変わる）に、[+] で隠すアイテムを合わせる
  syncFilters() {
    const tabIds = new Set();
    for (const tab of this.doc.tabs) {
      if (!tab.filter || !tab.filter.active) continue;
      tabIds.add(tab.id);
      this.filters.set(tab.id, { hidden: new Set(tab.filter.hidden || []) });
    }
    for (const id of [...this.filters.keys()]) {
      if (!tabIds.has(id)) this.filters.delete(id);
    }
  }

  // フィルタ・非表示の [+] をクリック：隠れていたアイテムを表示する（tab.filter.hidden・item.hidden から除く。Undo の対象）
  revealHidden(ids) {
    if (ids.length === 0) return;
    const itemId = this.index.get(ids[0]).parent.id;
    this.commit((doc) => {
      for (const id of ids) {
        const loc = Model.locate(doc, id);
        delete loc.item.hidden;
        Model.unhideFiltered(loc.tab, [id]);
      }
      return { itemId: ids[0] };
    }, { itemId });
  }

  // 表示 → 非表示にする：選択中のアイテムを [+] で隠す（文書に記録し、1 回の Undo で戻る）。
  // 同じ親の子（隠れていないもの）がすべて選択中なら、子を隠す代わりに親を折り畳む。ルートは対象外
  hideSelected() {
    this.editor.end();
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const selected = new Set(ids);
    const collapse = [];
    const hide = [];
    const parents = new Set();
    for (const id of ids) {
      const parent = this.index.get(id).parent;
      if (!parent || parents.has(parent.id)) continue;
      parents.add(parent.id);
      const visible = parent.children.filter((c) => !this.isHiddenItem(c));
      if (visible.every((c) => selected.has(c.id))) collapse.push(parent.id);
      else hide.push(...visible.filter((c) => selected.has(c.id)).map((c) => c.id));
    }
    if (collapse.length === 0 && hide.length === 0) return;
    const itemId = collapse[0] || this.index.get(hide[0]).parent.id;
    this.commit((doc) => {
      for (const id of collapse) Model.locate(doc, id).item.collapsed = true;
      for (const id of hide) Model.locate(doc, id).item.hidden = true;
      return { itemId };
    }, { itemId });
    for (const id of ids) {
      if (this.index.has(id) && this.index.get(id).parent) this.selection.delete(id);
    }
    this.mainArea.draw();
  }

  // 表示タブのフィルタを解除し、隠していたアイテムをすべて表示する（条件はタブに残す。折り畳み状態はそのまま）
  clearFilter() {
    this.finishInput();
    const tabId = this.activeTabId;
    this.commit((doc) => {
      const tab = doc.tabs.find((t) => t.id === tabId);
      if (tab.filter) {
        tab.filter.active = false;
        delete tab.filter.hidden;
      }
      return { tabId };
    }, { tabId });
  }

  onClipboardEvent(e, type) {
    if (this.modalOpen) return;
    if (Util.isTextInput(e.target) || this.editor.isEditing || this.tabBar.rename) return;
    if (type === 'paste') {
      e.preventDefault();
      const dt = e.clipboardData;
      this.paste(dt.getData(ItemClipboard.MIME), dt.getData('text/plain'));
      return;
    }
    if (type === 'copy' && this.copyTextOverride !== null) {
      e.preventDefault();
      this.clipboardEventFired = true;
      e.clipboardData.setData('text/plain', this.copyTextOverride);
      return;
    }
    const data = this.clipboardData();
    if (!data) return;
    e.preventDefault();
    this.clipboardEventFired = true;
    // システムのクリップボードに箇条書きの文字列と JSON を同居させる
    e.clipboardData.setData('text/plain', data.text);
    e.clipboardData.setData(ItemClipboard.MIME, data.json);
    this.pseudoClipboard = { clips: data.clips, text: data.text };
    if (type === 'cut') this.deleteSelected();
  }

  // メニューからのコピー・切り取り（copy/cut イベント経由。使えなければ文字列のみ書き込む）
  menuCopy(cut) {
    this.editor.end();
    const data = this.clipboardData();
    if (!data) return;
    this.clipboardEventFired = false;
    try {
      document.execCommand(cut ? 'cut' : 'copy');
    } catch (e) {
      // 下でフォールバック
    }
    if (!this.clipboardEventFired) {
      this.pseudoClipboard = { clips: data.clips, text: data.text };
      if (navigator.clipboard) navigator.clipboard.writeText(data.text).catch(() => {});
      if (cut) this.deleteSelected();
    }
  }

  // 番号付き箇条書き・マークダウン・ツリー・CSV・TSV としてコピー（文字列のみ。JSON は書き込まない）
  copyAs(format) {
    this.editor.end();
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const clips = ItemClipboard.fromSelection(this.index, ids);
    const text = format === 'numbered' ? ItemClipboard.toNumbered(clips)
      : format === 'markdown' ? ItemClipboard.toMarkdown(clips)
        : format === 'tree' ? ItemClipboard.toTree(clips)
          : ItemClipboard.toDelimited(clips, format === 'tsv' ? '\t' : ',');
    this.clipboardEventFired = false;
    this.copyTextOverride = text;
    try {
      document.execCommand('copy');
    } catch (e) {
      // 下でフォールバック
    }
    this.copyTextOverride = null;
    if (!this.clipboardEventFired && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }

  // メニューからの貼り付け（ブラウザの許可が得られなければ擬似クリップボードのみ）
  async menuPaste() {
    this.editor.end();
    let text = null;
    try {
      if (navigator.clipboard) text = await navigator.clipboard.readText();
    } catch (e) {
      text = null;
    }
    this.paste('', text);
  }

  // JSON 形式があれば採用。無ければ擬似クリップボード（文字列が一致する場合）、それも無ければ箇条書きとして解釈する。
  // 最後に選択したアイテム（選択が無ければルート）の最後の子として挿入する
  paste(json, text) {
    let clips = json ? ItemClipboard.fromJson(json) : null;
    const pseudo = this.pseudoClipboard;
    if (!clips && pseudo && (text === null || text === pseudo.text)) clips = pseudo.clips;
    if (!clips && text && text.trim()) clips = ItemClipboard.parseText(text);
    if (!clips || clips.length === 0) return;

    let targetId = this.activeTab.root.id;
    for (const id of this.selection) {
      const entry = this.index.get(id);
      if (entry && entry.tab.id === this.activeTabId) targetId = id;
    }
    let firstId = null;
    this.commit((doc) => {
      const target = Model.locate(doc, targetId).item;
      const items = ItemClipboard.toItems(clips);
      firstId = items[0].id;
      target.collapsed = false;
      target.children.push(...items);
      return { itemId: firstId };
    }, { itemId: targetId });
    this.mainArea.scrollIntoView(firstId);
  }

  // ---- キー操作（文字入力中以外） ----

  onKeyDown(e) {
    // モーダルダイアログ表示中はアプリのショートカットを無効にする（ESC は閉じる）
    if (this.modalOpen) {
      if (e.key === 'Escape') {
        this.tabSettings.close();
        this.filterDialog.close();
      }
      return;
    }
    if (this.mainArea.handleKeyDown(e)) return;
    if (e.key === 'Escape' && this.menuBar.closeAll()) return;
    if (e.key === 'Escape' && this.mainArea.toolbar.closePopup()) return;
    // ファイルを開く・保存は文字入力中も有効（ブラウザ標準の動作を抑止）
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing) {
      const k = e.key.toLowerCase();
      if (k === 'o' || k === 's') {
        e.preventDefault();
        if (k === 'o') this.openFileDialog();
        else this.saveJson();
        return;
      }
    }
    if (Util.isTextInput(e.target) || e.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && !e.altKey && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (!ctrl && !e.altKey && (e.key === ';' || e.key === '-')) {
      // ; でツリーを全て開く、- でツリーを全て閉じる
      e.preventDefault();
      this.setTreeCollapsed(e.key === '-');
    } else if (ctrl && !e.altKey && !e.shiftKey && key === 'a') {
      e.preventDefault();
      this.selectAll();
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
