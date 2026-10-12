'use strict';

// 「編集 → フィルタを設定」のモーダルダイアログ。検索文字列と検索方法（大文字小文字を区別しない・正規表現）、
// 表示するステータスを入力し、OK で表示タブにフィルタを適用する（Application.applyFilter）
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
    const statuses = app.activeTab.options.statuses;

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
    body.append(row);
    // 表示するステータス（ステータスが登録されている時だけ）
    this.statusChecks = [];
    if (statuses.length) body.append(this.statusSection(statuses, current));
    this.error = Util.el('div', 'settings-error filter-error');
    body.append(this.error);
    this.input = input;
    input.addEventListener('input', () => this.showError(''));

    const footer = Util.el('div', 'modal-footer');
    const cancel = Util.el('button', 'settings-button', 'キャンセル');
    cancel.type = 'button';
    const ok = Util.el('button', 'settings-button primary', 'OK');
    ok.type = 'button';
    const submit = () => this.submit(Object.assign(
      { text: input.value, ignoreCase: FilterDialog.pressed(ignoreCase), regex: FilterDialog.pressed(regex) },
      this.statusCondition(),
    ));
    // フィルタ削除（表示タブがフィルタ中の時だけ押せる）
    const remove = Util.el('button', 'settings-button', 'フィルタ削除');
    remove.type = 'button';
    remove.disabled = !app.activeFilter;
    cancel.addEventListener('click', () => this.close());
    ok.addEventListener('click', submit);
    remove.addEventListener('click', () => {
      this.close();
      app.clearFilter();
    });
    const right = Util.el('div', 'modal-footer-group');
    right.append(remove, ok);
    footer.append(cancel, right);

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

  // ステータスのチェックボックス：全てチェック / 登録順のステータス（2 列 6 行まで。1 列目に 1〜6、2 列目に 7〜12）/
  // 未登録のステータス・ステータス無し（同じ行の 1 列目と 2 列目）。「全てチェック」は他のすべてを一括でオン・オフする
  statusSection(statuses, current) {
    const C = Config;
    const section = Util.el('div', 'filter-statuses');
    section.append(Util.el('div', 'filter-statuses-title', 'ステータス'));
    const hide = new Set(current.hideStatuses || []);
    const all = this.checkbox(Util.el('span', 'filter-check-text', '全てチェック'), true);
    const grid = Util.el('div', 'filter-status-grid');
    grid.style.gridTemplateRows = `repeat(${Math.min(statuses.length, 6)}, auto)`;
    for (const s of statuses) {
      grid.append(this.statusCheck(TabSettingsDialog.badge(s.name, s.color), !hide.has(s.name), { name: s.name }));
    }
    const extra = Util.el('div', 'filter-status-extra');
    const orphan = Util.el('span', 'status-badge', '未登録のステータス');
    orphan.style.background = C.statusOrphan.bg;
    orphan.style.color = C.statusOrphan.fg;
    orphan.style.border = `1px dotted ${C.statusOrphan.border}`;
    extra.append(
      this.statusCheck(orphan, !current.hideUnregistered, { unregistered: true }),
      this.statusCheck(Util.el('span', 'filter-check-text', 'ステータス無し'), !current.hideNoStatus, { none: true }),
    );
    const allInput = all.querySelector('input');
    const sync = () => {
      const on = this.statusChecks.filter((c) => c.input.checked).length;
      allInput.checked = on === this.statusChecks.length;
      allInput.indeterminate = on > 0 && on < this.statusChecks.length;
    };
    allInput.addEventListener('change', () => {
      for (const c of this.statusChecks) c.input.checked = allInput.checked;
      this.showError('');
    });
    for (const c of this.statusChecks) {
      c.input.addEventListener('change', () => {
        sync();
        this.showError('');
      });
    }
    sync();
    section.append(all, grid, extra);
    return section;
  }

  checkbox(content, checked) {
    const label = Util.el('label', 'filter-check');
    const input = Util.el('input');
    input.type = 'checkbox';
    input.checked = checked;
    label.append(input, content);
    return label;
  }

  // 「全てチェック」に連動するチェックボックス。kind: { name } / { unregistered } / { none }
  statusCheck(content, checked, kind) {
    const label = this.checkbox(content, checked);
    this.statusChecks.push(Object.assign({ input: label.querySelector('input') }, kind));
    return label;
  }

  // チェックを外したステータスを、表示しない条件にする
  statusCondition() {
    const checks = this.statusChecks;
    return {
      hideStatuses: checks.filter((c) => c.name && !c.input.checked).map((c) => c.name),
      hideUnregistered: checks.some((c) => c.unregistered && !c.input.checked),
      hideNoStatus: checks.some((c) => c.none && !c.input.checked),
    };
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

  // 入力を検証してフィルタを適用する（条件が無い・正規表現が不正ならメッセージを表示し、閉じない）
  submit(condition) {
    if (!Model.filterHasCondition(condition)) {
      this.showError(this.statusChecks.length ? '検索する文字列を入力するか、表示するステータスを絞り込んでください' : '検索する文字列を入力してください');
      return;
    }
    try {
      Model.filterMatcher(condition, null);
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
