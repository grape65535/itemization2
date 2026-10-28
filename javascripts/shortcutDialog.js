'use strict';

// 「オプション → ショートカットキーの設定」のモーダルダイアログ。メニュー・右クリックメニューの操作の一覧（操作名・ショートカットキー・設定ボタン）を表示し、
// OK で割り当てを文書に記録する（Application.setShortcuts）。固定のショートカットの操作は表示のみ（設定できない）
class ShortcutSettingsDialog {
  constructor(app) {
    this.app = app;
    this.overlay = null;
    this.keyDialog = new ShortcutKeyDialog();
  }

  get isOpen() {
    return this.overlay !== null;
  }

  open() {
    if (this.isOpen) return;
    const app = this.app;
    app.finishInput();
    app.menuBar.closeAll();
    this.ops = app.menuBar.operations();
    // 編集中の割り当て（一覧にある操作のものだけ）
    const saved = app.doc.shortcuts || {};
    this.pending = {};
    for (const op of this.ops) {
      if (!op.fixed && saved[op.id]) this.pending[op.id] = Object.assign({}, saved[op.id]);
    }

    this.overlay = Util.el('div', 'modal-overlay');
    const dialog = Util.el('div', 'modal-dialog shortcut-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'ショートカットキーの設定');
    const title = Util.el('div', 'modal-title');
    title.append(Util.el('span', '', 'ショートカットキーの設定'));
    const body = Util.el('div', 'modal-body');
    const header = Util.el('div', 'shortcut-row shortcut-header');
    header.append(Util.el('span', '', '操作'), Util.el('span', '', 'ショートカットキー'), Util.el('span'));
    this.list = Util.el('div', 'shortcut-list');
    this.error = Util.el('div', 'settings-error');
    body.append(header, this.list);

    const footer = Util.el('div', 'modal-footer');
    const cancel = Util.el('button', 'settings-button', 'キャンセル');
    cancel.type = 'button';
    this.ok = Util.el('button', 'settings-button primary', 'OK');
    this.ok.type = 'button';
    cancel.addEventListener('click', () => this.close());
    this.ok.addEventListener('click', () => this.submit());
    const right = Util.el('div', 'modal-footer-group shortcut-footer-right');
    right.append(this.error, this.ok);
    footer.append(cancel, right);

    dialog.append(title, body, footer);
    this.overlay.append(dialog);
    // ダイアログ内のキー操作はアプリのショートカットに渡さない（ESC はキャンセル）
    this.overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        this.close();
      }
    });
    for (const type of ['copy', 'cut', 'paste']) this.overlay.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(this.overlay);
    this.renderRows();
    this.ok.focus();
  }

  // 一覧を作り直す。重複している割り当ては赤字で「（重複）」を付け、重複がある間は OK を押せない
  renderRows() {
    const count = new Map();
    for (const combo of Object.values(this.pending)) {
      const key = Shortcut.id(combo);
      count.set(key, (count.get(key) || 0) + 1);
    }
    let duplicated = false;
    this.list.textContent = '';
    for (const op of this.ops) {
      const row = Util.el('div', 'shortcut-row');
      const name = Util.el('span', 'shortcut-name', op.path.join(' › '));
      name.title = name.textContent;
      const key = Util.el('span', 'shortcut-key');
      const cell = Util.el('span', 'shortcut-action');
      row.append(name, key, cell);
      if (op.fixed) {
        // 固定のショートカット：表示のみ
        row.classList.add('fixed');
        key.textContent = Shortcut.label(op.fixed);
        row.title = '固定のショートカットキーのため変更できません';
      } else {
        const combo = this.pending[op.id];
        if (combo) {
          const dup = count.get(Shortcut.id(combo)) > 1;
          key.textContent = Shortcut.label(combo) + (dup ? '（重複）' : '');
          key.classList.toggle('duplicate', dup);
          duplicated = duplicated || dup;
        } else if (op.builtin) {
          // 既定のキー（; など。割り当てたキーと併用できる）
          key.textContent = Shortcut.label(Shortcut.parse(op.builtin));
          key.classList.add('builtin');
        }
        const button = Util.el('button', 'settings-button shortcut-set', '設定');
        button.type = 'button';
        button.addEventListener('click', () => this.edit(op));
        cell.append(button);
        row.addEventListener('dblclick', () => this.edit(op));
      }
      this.list.append(row);
    }
    this.ok.disabled = duplicated;
    this.error.textContent = duplicated ? 'ショートカットキーが重複しています' : '';
  }

  // ショートカットキーの割り当てダイアログを重ねて開く
  edit(op) {
    this.keyDialog.open(op.path.join(' › '), this.pending[op.id] || null, {
      ok: (combo) => {
        this.pending[op.id] = combo;
        this.renderRows();
      },
      remove: () => {
        delete this.pending[op.id];
        this.renderRows();
      },
    });
  }

  submit() {
    if (this.ok.disabled) return;
    const shortcuts = this.pending;
    this.close();
    this.app.setShortcuts(shortcuts);
  }

  close() {
    this.keyDialog.close();
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
  }
}

// ショートカットキーの割り当てダイアログ（ショートカットキーの設定に重ねて表示する）。
// CTRL・SHIFT・ALT のチェックボックスと、押したキーを表示するラベル。表示中に押したキーをラベルに表示し、OK でそのキーを割り当てる
class ShortcutKeyDialog {
  constructor() {
    this.overlay = null;
  }

  get isOpen() {
    return this.overlay !== null;
  }

  // name: 操作名、current: 現在の割り当て（無ければ null）、handlers: { ok(combo), remove() }
  open(name, current, handlers) {
    this.close();
    this.key = current ? current.key : null;
    this.overlay = Util.el('div', 'modal-overlay shortcut-key-overlay');
    const dialog = Util.el('div', 'modal-dialog shortcut-key-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'ショートカットキーの割り当て');
    dialog.tabIndex = -1;
    const title = Util.el('div', 'modal-title');
    title.append(Util.el('span', '', 'ショートカットキーの割り当て'));
    const body = Util.el('div', 'modal-body');
    const target = Util.el('div', 'shortcut-key-target', name);
    target.title = name;

    // 初期値は現在の割り当て（無ければ CTRL のみオン）
    const modifiers = Util.el('div', 'shortcut-modifiers');
    const check = (text, checked) => {
      const label = Util.el('label', 'settings-check');
      const input = Util.el('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => this.update());
      label.append(input, Util.el('span', '', text));
      modifiers.append(label);
      return input;
    };
    this.ctrl = check('CTRL', current ? current.ctrl : true);
    this.shift = check('SHIFT', current ? current.shift : false);
    this.alt = check('ALT', current ? current.alt : false);
    this.label = Util.el('div', 'shortcut-key-label');
    this.message = Util.el('div', 'settings-error shortcut-key-message');
    body.append(target, modifiers, this.label, this.message);

    const footer = Util.el('div', 'modal-footer');
    const cancel = Util.el('button', 'settings-button', 'キャンセル');
    cancel.type = 'button';
    const remove = Util.el('button', 'settings-button', '削除');
    remove.type = 'button';
    remove.disabled = !current;
    this.ok = Util.el('button', 'settings-button primary', 'OK');
    this.ok.type = 'button';
    cancel.addEventListener('click', () => this.close());
    remove.addEventListener('click', () => {
      this.close();
      handlers.remove();
    });
    this.ok.addEventListener('click', () => {
      const combo = this.combo();
      if (!this.valid(combo)) return;
      this.close();
      handlers.ok(combo);
    });
    const right = Util.el('div', 'modal-footer-group');
    right.append(remove, this.ok);
    footer.append(cancel, right);

    dialog.append(title, body, footer);
    this.overlay.append(dialog);
    // 表示中に押したキーをラベルに表示する（ESC はキャンセル）。修飾キーと一緒に押した時は、チェックボックスを押していた修飾キーに合わせる。
    // 修飾キーのみ・修飾キーなしのキーではチェックボックスを変えない
    this.overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      const key = Shortcut.keyOf(e);
      if (!key) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        this.ctrl.checked = e.ctrlKey || e.metaKey;
        this.shift.checked = e.shiftKey;
        this.alt.checked = e.altKey;
      }
      this.key = key;
      this.update();
    });
    // フォーカスのあるチェックボックス・ボタンが SPACE・ENTER で動かないようにする（キーとして受け付けるため）
    this.overlay.addEventListener('keyup', (e) => {
      e.stopPropagation();
      if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    });
    for (const type of ['copy', 'cut', 'paste']) this.overlay.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(this.overlay);
    this.update();
    dialog.focus();
  }

  combo() {
    return { ctrl: this.ctrl.checked, shift: this.shift.checked, alt: this.alt.checked, key: this.key };
  }

  valid(combo) {
    return !!combo.key && Shortcut.hasModifier(combo) && !Shortcut.isFixed(combo);
  }

  // ラベル・メッセージ・OK ボタンを現在の状態に合わせる
  update() {
    const combo = this.combo();
    this.label.textContent = combo.key ? Shortcut.label(combo) : 'キーを押してください';
    this.label.classList.toggle('empty', !combo.key);
    let message = '';
    if (!Shortcut.hasModifier(combo)) message = 'CTRL・SHIFT・ALT のいずれかをオンにしてください';
    else if (combo.key && Shortcut.isFixed(combo)) message = '固定のショートカットキーのため割り当てられません';
    this.message.textContent = message;
    this.ok.disabled = !this.valid(combo);
  }

  close() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
  }
}
