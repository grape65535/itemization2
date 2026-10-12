'use strict';

// 「編集 → フィルタを設定」のモーダルダイアログ。検索文字列と検索方法（大文字小文字を区別しない・正規表現）を入力し、
// OK で表示タブにフィルタを適用する（Application.applyFilter）
class FilterDialog {
  constructor(app) {
    this.app = app;
    this.overlay = null;
  }

  get isOpen() {
    return this.overlay !== null;
  }

  open() {
    if (this.isOpen) return;
    const app = this.app;
    app.finishInput();
    app.menuBar.closeAll();
    // 初期値は表示タブに記録した条件（無ければ最後に適用した条件）
    const current = app.activeTab.filter || app.filterCondition || { text: '', ignoreCase: false, regex: false };

    this.overlay = Util.el('div', 'modal-overlay');
    const dialog = Util.el('div', 'modal-dialog filter-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'フィルタを設定');
    const title = Util.el('div', 'modal-title');
    title.append(Util.el('span', '', 'フィルタを設定'));
    const body = Util.el('div', 'modal-body');

    // 検索文字列と、検索方法の切り替えボタンを 1 行に並べる
    const row = Util.el('div', 'filter-row');
    const input = Util.el('input', 'settings-input filter-input');
    input.type = 'text';
    input.placeholder = '検索する文字列';
    input.value = current.text;
    const ignoreCase = this.toggleButton('Aa', '大文字小文字を区別しない', current.ignoreCase);
    const regex = this.toggleButton('.*', '正規表現で検索', current.regex);
    row.append(input, ignoreCase, regex);
    this.error = Util.el('div', 'settings-error filter-error');
    body.append(row, this.error);
    this.input = input;
    input.addEventListener('input', () => this.showError(''));

    const footer = Util.el('div', 'modal-footer');
    const cancel = Util.el('button', 'settings-button', 'キャンセル');
    cancel.type = 'button';
    const ok = Util.el('button', 'settings-button primary', 'OK');
    ok.type = 'button';
    const submit = () => this.submit({ text: input.value, ignoreCase: FilterDialog.pressed(ignoreCase), regex: FilterDialog.pressed(regex) });
    cancel.addEventListener('click', () => this.close());
    ok.addEventListener('click', submit);
    footer.append(cancel, ok);

    dialog.append(title, body, footer);
    this.overlay.append(dialog);
    // ダイアログ内のキー操作はアプリのショートカットに渡さない（ESC はキャンセル、文字欄の Enter は OK）
    this.overlay.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter' && e.target === input) {
        e.preventDefault();
        submit();
      }
    });
    for (const type of ['copy', 'cut', 'paste']) this.overlay.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(this.overlay);
    input.focus();
    input.select();
  }

  // 押すとオン・オフが切り替わるアイコンボタン（オンの時は aria-pressed="true"）
  toggleButton(icon, label, pressed) {
    const button = Util.el('button', 'filter-toggle', icon);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(!!pressed));
    button.addEventListener('click', () => button.setAttribute('aria-pressed', String(!FilterDialog.pressed(button))));
    return button;
  }

  static pressed(button) {
    return button.getAttribute('aria-pressed') === 'true';
  }

  // 入力を検証してフィルタを適用する（検索文字列が空・正規表現が不正ならメッセージを表示し、閉じない）
  submit(condition) {
    if (condition.text === '') {
      this.showError('検索する文字列を入力してください');
      return;
    }
    try {
      Model.filterMatcher(condition);
    } catch (e) {
      this.showError('正規表現が正しくありません: ' + e.message);
      return;
    }
    this.close();
    this.app.applyFilter(condition);
  }

  showError(message) {
    this.error.textContent = message;
    this.input.classList.toggle('invalid', !!message);
    if (message) this.input.focus();
  }

  close() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
  }
}
