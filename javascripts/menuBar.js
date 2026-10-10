'use strict';

// ヘッダのメニュー（ファイル・編集・表示）
class MenuBar {
  constructor(app, container) {
    this.app = app;
    this.menus = [
      { label: 'ファイル', items: [] },
      {
        label: '編集',
        items: [
          { label: '元に戻す', shortcut: 'Ctrl+Z', action: () => app.undo(), enabled: () => app.history.canUndo() },
          { label: 'やり直す', shortcut: 'Ctrl+Shift+Z', action: () => app.redo(), enabled: () => app.history.canRedo() },
        ],
      },
      { label: '表示', items: [] },
    ];
    this.openMenu = null;

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
      const item = Util.el('button', 'menu-item');
      item.append(Util.el('span', 'menu-item-label', def.label), Util.el('span', 'menu-item-shortcut', def.shortcut || ''));
      item.disabled = def.enabled ? !def.enabled() : false;
      item.addEventListener('click', () => {
        this.closeAll();
        def.action();
      });
      menu.dropdown.append(item);
    }
    menu.el.classList.add('open');
  }

  closeAll() {
    if (!this.openMenu) return false;
    this.openMenu.el.classList.remove('open');
    this.openMenu = null;
    return true;
  }
}
