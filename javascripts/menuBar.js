'use strict';

// ヘッダのメニュー（ファイル・編集・表示・オプション）と、アイテムの右クリックメニュー
class MenuBar {
  constructor(app, container) {
    this.app = app;
    this.menus = [
      {
        label: 'ファイル',
        items: [
          { id: 'file.open', label: 'ファイルを開く', shortcut: 'Ctrl+O', action: () => app.openFileDialog() },
          { id: 'file.saveJson', label: '名前をつけて保存', shortcut: 'Ctrl+S', action: () => app.saveJson() },
          { id: 'file.saveSvg', label: 'SVGで保存', action: () => app.saveSvg() },
          { id: 'file.savePdf', label: 'PDFで保存', action: () => app.savePdf() },
        ],
      },
      {
        label: '編集',
        items: [
          { id: 'edit.undo', label: '元に戻す', shortcut: 'Ctrl+Z', action: () => app.undo(), enabled: () => app.history.canUndo() },
          { id: 'edit.redo', label: 'やり直す', shortcut: 'Ctrl+Shift+Z', action: () => app.redo(), enabled: () => app.history.canRedo() },
          { separator: true },
          {
            label: '選択',
            submenu: () => [
              { id: 'edit.select.all', label: '全て選択', shortcut: 'Ctrl+A', action: () => app.selectAll() },
              { id: 'edit.select.descendants', label: '子を全て選択', action: () => app.selectDescendants(), enabled: () => app.selectedIds().length > 0 },
              { id: 'edit.select.siblings', label: '同階層を全て選択', action: () => app.selectSiblings(), enabled: () => app.selectedIds().length > 0 },
            ],
          },
          { id: 'edit.copy', label: 'コピー', shortcut: 'Ctrl+C', action: () => app.menuCopy(false), enabled: () => app.selectedIds().length > 0 },
          {
            label: '形式を指定してコピー',
            enabled: () => app.selectedIds().length > 0,
            submenu: () => [
              { id: 'edit.copyAs.numbered', label: '番号付き箇条書きとしてコピー', action: () => app.copyAs('numbered') },
              { id: 'edit.copyAs.markdown', label: 'マークダウンとしてコピー', action: () => app.copyAs('markdown') },
              { id: 'edit.copyAs.tree', label: 'ツリーとしてコピー', action: () => app.copyAs('tree') },
              { id: 'edit.copyAs.csv', label: 'CSVとしてコピー', action: () => app.copyAs('csv') },
              { id: 'edit.copyAs.tsv', label: 'TSVとしてコピー', action: () => app.copyAs('tsv') },
            ],
          },
          { id: 'edit.cut', label: '切り取り', shortcut: 'Ctrl+X', action: () => app.menuCopy(true), enabled: () => app.selectedIds().length > 0 },
          { id: 'edit.paste', label: '貼り付け', shortcut: 'Ctrl+V', action: () => app.menuPaste() },
          { separator: true },
          {
            label: 'アイテムを追加',
            enabled: () => app.selectedIds().length === 1,
            submenu: () => {
              const isRoot = () => !app.index.get(app.selectedIds()[0]).parent; // ルートには兄弟を追加できない
              return [
                { id: 'edit.addItem.first', label: '最初の子として追加', action: () => app.addItem('first') },
                { id: 'edit.addItem.last', label: '最後の子として追加', action: () => app.addItem('last') },
                { id: 'edit.addItem.before', label: '前に追加', action: () => app.addItem('before'), enabled: () => !isRoot() },
                { id: 'edit.addItem.after', label: '後に追加', action: () => app.addItem('after'), enabled: () => !isRoot() },
              ];
            },
          },
          {
            label: 'アイテムを削除',
            enabled: () => app.selectedIds().length > 0,
            // 選択中のアイテムに子が無いか、子孫がすべて選択中ならサブメニューを出さず、選択した時点で削除する
            submenuIf: () => app.selectedHasUnselectedDescendants(),
            action: () => app.deleteSelected(),
            submenu: () => [
              { id: 'edit.delete.promote', label: '選択中のアイテムを削除', action: () => app.deleteSelected() },
              { id: 'edit.delete.subtree', label: '選択中のアイテムの子も削除', action: () => app.deleteSelected(true) },
            ],
          },
          { separator: true },
          { label: 'ステータスを設定', dynamic: true, submenu: () => app.statusMenuItems(), enabled: () => app.selectedIds().length > 0 },
          { id: 'edit.clearStatus', label: 'ステータスを削除', action: () => app.clearStatus(), enabled: () => app.selectedHasStatus() },
          { separator: true },
          { id: 'edit.filter', label: 'フィルタを設定', action: () => app.filterDialog.open() },
          { id: 'edit.clearFilter', label: 'フィルタを削除', action: () => app.clearFilter(), enabled: () => app.activeFilter !== null },
        ],
      },
      {
        label: '表示',
        items: [
          { id: 'view.expandAll', label: 'ツリーを全て開く', shortcut: ';', action: () => app.setTreeCollapsed(false) },
          { id: 'view.collapseAll', label: 'ツリーを全て閉じる', shortcut: '-', action: () => app.setTreeCollapsed(true) },
          { separator: true },
          { id: 'view.hide', label: '非表示にする', action: () => app.hideSelected(), enabled: () => app.selectedIds().length > 0 },
          { separator: true },
          {
            label: '並べ替え',
            enabled: () => app.selectedIds().length > 0,
            submenu: () => [
              { id: 'view.sort.status', label: 'ステータス順', action: () => app.sortSelected('status') },
              { id: 'view.sort.created', label: '登録順', action: () => app.sortSelected('created') },
              { id: 'view.sort.updated', label: '更新順', action: () => app.sortSelected('updated') },
              { id: 'view.sort.name', label: '名前順', action: () => app.sortSelected('name') },
              { id: 'view.sort.reverse', label: '逆順', action: () => app.sortSelected('reverse') },
            ],
          },
        ],
      },
      {
        label: 'オプション',
        items: [
          { id: 'option.tabSettings', label: 'タブの設定', action: () => app.tabSettings.open() },
          { id: 'option.shortcuts', label: 'ショートカットキーの設定', action: () => app.shortcutSettings.open() },
        ],
      },
    ];
    this.openMenu = null;
    // アイテムの右クリックメニュー（項目は編集メニューと共通）
    const editItems = this.menus.find((m) => m.label === '編集').items;
    const pick = (label) => editItems.find((d) => d.label === label);
    const hideItem = this.menus.find((m) => m.label === '表示').items.find((d) => d.label === '非表示にする');
    this.contextItems = [
      pick('コピー'), pick('切り取り'), pick('貼り付け'), { separator: true },
      pick('アイテムを追加'), pick('アイテムを削除'), { separator: true },
      pick('ステータスを設定'), pick('ステータスを削除'), { separator: true },
      pick('フィルタを設定'), pick('フィルタを削除'), { separator: true },
      hideItem,
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
      const item = Util.el('button', 'menu-item', menu.emptyLabel || '（項目なし）');
      item.disabled = true;
      menu.dropdown.append(item);
    }
    for (const def of menu.items) {
      if (def.separator) {
        menu.dropdown.append(Util.el('div', 'menu-separator'));
        continue;
      }
      // submenuIf() が偽なら、サブメニューを持たない項目として action を実行する
      const hasSubmenu = !!def.submenu && (!def.submenuIf || def.submenuIf());
      const item = Util.el('button', 'menu-item');
      item.append(def.badge || Util.el('span', 'menu-item-label', def.label), Util.el('span', 'menu-item-shortcut', hasSubmenu ? '▶︎' : this.shortcutText(def)));
      item.disabled = def.enabled ? !def.enabled() : false;
      if (hasSubmenu) {
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

  // 項目の右端に表示するショートカットキー（ショートカットキーの設定で割り当てたキーを優先する）
  shortcutText(def) {
    const shortcuts = this.app.doc.shortcuts;
    const combo = def.id && shortcuts && shortcuts[def.id];
    return combo ? Shortcut.menuLabel(combo) : def.shortcut || '';
  }

  // ショートカットキーを割り当てられる操作（メニュー・右クリックメニューの項目。サブメニューの項目を含み、ステータスの一覧は除く）。
  // [{ id, path: [メニュー名, …, 項目名], fixed: 固定のショートカットの Combo（無ければ null）, builtin: 既定のショートカットの表示, enabled(), action() }]
  operations() {
    const ops = [];
    const add = (def, path, parent) => {
      const builtin = def.shortcut ? Shortcut.parse(def.shortcut) : null;
      ops.push({
        id: def.id,
        path: [...path, def.label],
        fixed: builtin && Shortcut.isFixed(builtin) ? builtin : null,
        builtin: def.shortcut || null,
        enabled: () => (!parent || !parent.enabled || parent.enabled()) && (!def.enabled || def.enabled()),
        action: def.action,
      });
    };
    for (const menu of this.menus) {
      for (const def of menu.items) {
        if (def.separator || def.dynamic) continue;
        if (def.submenu) {
          for (const entry of def.submenu()) add(entry, [menu.label, def.label], def);
        } else {
          add(def, [menu.label]);
        }
      }
    }
    return ops;
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

  // ステータスのバッジのクリックで開くステータス選択のメニュー。画面座標 (x, centerY) を左端・縦中央にして開く（はみ出す場合は内側へずらす）。
  // 項目は「ステータスを設定」のサブメニューと同じ
  openStatusMenu(x, centerY) {
    this.closeAll();
    const el = Util.el('div', 'menu context-menu');
    const dropdown = Util.el('div', 'menu-dropdown menu-status-popup');
    el.append(dropdown);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(el);
    this.open({ el, dropdown, items: this.app.statusMenuItems(), context: true, emptyLabel: '（ステータスが登録されていません）' });
    const r = dropdown.getBoundingClientRect();
    el.style.left = Math.max(0, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    el.style.top = Math.max(0, Math.min(centerY - r.height / 2, window.innerHeight - r.height - 4)) + 'px';
  }

  // サブメニュー: def.submenu() の [{ label, badge?, shortcut?, action, enabled? }] を表示する（無効なら開かない）
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
      const shortcut = this.shortcutText(entry);
      if (shortcut) sub.append(Util.el('span', 'menu-item-shortcut', shortcut));
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
