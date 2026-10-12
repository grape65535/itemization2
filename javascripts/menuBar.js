'use strict';

// ヘッダのメニュー（ファイル・編集・表示・オプション）と、アイテムの右クリックメニュー
class MenuBar {
  constructor(app, container) {
    this.app = app;
    this.menus = [
      {
        label: 'ファイル',
        items: [
          { label: 'ファイルを開く', shortcut: 'Ctrl+O', action: () => app.openFileDialog() },
          { label: '名前をつけて保存', shortcut: 'Ctrl+S', action: () => app.saveJson() },
          { label: 'SVGで保存', action: () => app.saveSvg() },
          { label: 'PDFで保存', action: () => app.savePdf() },
        ],
      },
      {
        label: '編集',
        items: [
          { label: '元に戻す', shortcut: 'Ctrl+Z', action: () => app.undo(), enabled: () => app.history.canUndo() },
          { label: 'やり直す', shortcut: 'Ctrl+Shift+Z', action: () => app.redo(), enabled: () => app.history.canRedo() },
          { separator: true },
          { label: '全て選択', shortcut: 'Ctrl+A', action: () => app.selectAll() },
          { label: 'コピー', shortcut: 'Ctrl+C', action: () => app.menuCopy(false), enabled: () => app.selectedIds().length > 0 },
          {
            label: '形式を指定してコピー',
            enabled: () => app.selectedIds().length > 0,
            submenu: () => [
              { label: '番号付き箇条書きとしてコピー', action: () => app.copyAs('numbered') },
              { label: 'マークダウンとしてコピー', action: () => app.copyAs('markdown') },
              { label: 'ツリーとしてコピー', action: () => app.copyAs('tree') },
              { label: 'CSVとしてコピー', action: () => app.copyAs('csv') },
              { label: 'TSVとしてコピー', action: () => app.copyAs('tsv') },
            ],
          },
          { label: '切り取り', shortcut: 'Ctrl+X', action: () => app.menuCopy(true), enabled: () => app.selectedIds().length > 0 },
          { label: '貼り付け', shortcut: 'Ctrl+V', action: () => app.menuPaste() },
          { separator: true },
          {
            label: 'アイテムを追加',
            enabled: () => app.selectedIds().length === 1,
            submenu: () => {
              const isRoot = () => !app.index.get(app.selectedIds()[0]).parent; // ルートには兄弟を追加できない
              return [
                { label: '最初の子として追加', action: () => app.addItem('first') },
                { label: '最後の子として追加', action: () => app.addItem('last') },
                { label: '前に追加', action: () => app.addItem('before'), enabled: () => !isRoot() },
                { label: '後に追加', action: () => app.addItem('after'), enabled: () => !isRoot() },
              ];
            },
          },
          { label: 'アイテムを削除', action: () => app.deleteSelected(), enabled: () => app.selectedIds().length > 0 },
          { separator: true },
          { label: 'ステータスを設定', submenu: () => app.statusMenuItems(), enabled: () => app.selectedIds().length > 0 },
          { label: 'ステータスを削除', action: () => app.clearStatus(), enabled: () => app.selectedHasStatus() },
          { separator: true },
          { label: 'フィルタを設定', action: () => app.filterDialog.open() },
          { label: 'フィルタを削除', action: () => app.clearFilter(), enabled: () => app.activeFilter !== null },
        ],
      },
      {
        label: '表示',
        items: [
          { label: 'ツリーを全て開く', shortcut: ';', action: () => app.setTreeCollapsed(false) },
          { label: 'ツリーを全て閉じる', shortcut: '-', action: () => app.setTreeCollapsed(true) },
        ],
      },
      {
        label: 'オプション',
        items: [
          { label: 'タブの設定', action: () => app.tabSettings.open() },
        ],
      },
    ];
    this.openMenu = null;
    // アイテムの右クリックメニュー（項目は編集メニューと共通）
    const editItems = this.menus.find((m) => m.label === '編集').items;
    const pick = (label) => editItems.find((d) => d.label === label);
    this.contextItems = [
      pick('コピー'), pick('切り取り'), pick('貼り付け'), { separator: true },
      pick('アイテムを追加'), pick('アイテムを削除'), { separator: true },
      pick('ステータスを設定'), pick('ステータスを削除'), { separator: true },
      pick('フィルタを設定'), pick('フィルタを削除'),
    ];
    // アイテム外の右クリックメニュー
    this.contextOutsideItems = [pick('フィルタを設定'), pick('フィルタを削除')];

    for (const menu of this.menus) {
      const el = Util.el('div', 'menu');
      const title = Util.el('button', 'menu-title', menu.label);
      const dropdown = Util.el('div', 'menu-dropdown');
      el.append(title, dropdown);
      container.append(el);
      menu.el = el;
      menu.dropdown = dropdown;
      title.addEventListener('click', () => (this.openMenu === menu ? this.closeAll() : this.open(menu)));
      title.addEventListener('mouseenter', () => {
        if (this.openMenu && this.openMenu !== menu) this.open(menu);
      });
    }

    document.addEventListener('mousedown', (e) => {
      if (this.openMenu && !e.target.closest('.menu')) this.closeAll();
    });
  }

  open(menu) {
    this.closeAll();
    this.openMenu = menu;
    menu.dropdown.textContent = '';
    if (menu.items.length === 0) {
      const item = Util.el('button', 'menu-item', '（項目なし）');
      item.disabled = true;
      menu.dropdown.append(item);
    }
    for (const def of menu.items) {
      if (def.separator) {
        menu.dropdown.append(Util.el('div', 'menu-separator'));
        continue;
      }
      const item = Util.el('button', 'menu-item');
      item.append(Util.el('span', 'menu-item-label', def.label), Util.el('span', 'menu-item-shortcut', def.submenu ? '▶︎' : def.shortcut || ''));
      item.disabled = def.enabled ? !def.enabled() : false;
      if (def.submenu) {
        // マウスを置くとサブメニューを右に開く
        item.classList.add('has-submenu');
        item.addEventListener('mouseenter', () => this.openSubmenu(menu, item, def));
        item.addEventListener('click', () => this.openSubmenu(menu, item, def));
      } else {
        item.addEventListener('click', () => {
          this.closeAll();
          def.action();
        });
        item.addEventListener('mouseenter', () => this.closeSubmenu());
      }
      menu.dropdown.append(item);
    }
    menu.el.classList.add('open');
  }

  // 右クリックメニューを画面座標 (x, y) に開く（画面からはみ出す場合は内側へずらす）。outside: アイテム外のメニュー
  openContext(x, y, outside) {
    this.closeAll();
    const el = Util.el('div', 'menu context-menu');
    const dropdown = Util.el('div', 'menu-dropdown');
    el.append(dropdown);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(el);
    this.open({ el, dropdown, items: outside ? this.contextOutsideItems : this.contextItems, context: true });
    const r = dropdown.getBoundingClientRect();
    el.style.left = Math.max(0, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    el.style.top = Math.max(0, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  }

  // サブメニュー: def.submenu() の [{ label, badge?, action, enabled? }] を表示する（無効なら開かない）
  openSubmenu(menu, item, def) {
    if (this.submenu && this.submenu.item === item) return;
    this.closeSubmenu();
    if (item.disabled) return;
    const el = Util.el('div', 'menu-dropdown menu-submenu');
    const entries = def.submenu();
    if (entries.length === 0) {
      const empty = Util.el('button', 'menu-item', '（ステータスが登録されていません）');
      empty.disabled = true;
      el.append(empty);
    }
    for (const entry of entries) {
      const sub = Util.el('button', 'menu-item');
      sub.append(entry.badge || Util.el('span', 'menu-item-label', entry.label));
      sub.disabled = entry.enabled ? !entry.enabled() : false;
      sub.addEventListener('click', () => {
        this.closeAll();
        entry.action();
      });
      el.append(sub);
    }
    el.style.top = item.offsetTop - 4 + 'px';
    menu.dropdown.append(el);
    // 画面の右・下からはみ出す場合は左側に開く・上へずらす
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) {
      el.style.left = 'auto';
      el.style.right = '100%';
      el.style.marginLeft = '0';
      el.style.marginRight = '2px';
    }
    if (r.bottom > window.innerHeight) el.style.top = item.offsetTop - 4 - (r.bottom - window.innerHeight + 4) + 'px';
    item.classList.add('submenu-open');
    this.submenu = { item, el };
  }

  closeSubmenu() {
    if (!this.submenu) return;
    this.submenu.el.remove();
    this.submenu.item.classList.remove('submenu-open');
    this.submenu = null;
  }

  closeAll() {
    this.closeSubmenu();
    if (!this.openMenu) return false;
    this.openMenu.el.classList.remove('open');
    if (this.openMenu.context) this.openMenu.el.remove();
    this.openMenu = null;
    return true;
  }
}
