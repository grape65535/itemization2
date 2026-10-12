'use strict';

// 「オプション → タブの設定」のモーダルダイアログ。表示中のタブの設定を編集し、OK の時だけ反映する
class TabSettingsDialog {
  constructor(app) {
    this.app = app;
    this.overlay = null;
    this.tabId = null;
  }

  get isOpen() {
    return this.overlay !== null;
  }

  // ステータスのバッジ（見本）。今後アイテムに表示する時も同じ見た目にする
  static badge(name, colorKey) {
    const color = Config.statusColors.find((c) => c.key === colorKey) || Config.statusColors[0];
    const el = Util.el('span', 'status-badge', name);
    el.style.background = color.bg;
    el.style.color = color.fg;
    return el;
  }

  open() {
    if (this.isOpen) return;
    const app = this.app;
    app.finishInput();
    app.menuBar.closeAll();
    const tab = app.activeTab;
    const options = Model.normalizeOptions(tab.options);
    this.tabId = tab.id;
    const C = Config;

    this.overlay = Util.el('div', 'modal-overlay');
    const dialog = Util.el('div', 'modal-dialog tab-settings-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'タブの設定');
    const title = Util.el('div', 'modal-title');
    title.append(Util.el('span', '', 'タブの設定'), Util.el('span', 'modal-subtitle', app.tabTitle(tab)));
    const body = Util.el('div', 'modal-body');

    // 親アイテムの縦表示位置
    const alignSelect = Util.el('select', 'settings-select');
    for (const [value, label] of [['center', '中央寄せ'], ['top', '上寄せ']]) {
      const option = Util.el('option', '', label);
      option.value = value;
      alignSelect.append(option);
    }
    alignSelect.value = options.parentAlign;
    // スクロールに追従する（プルダウンの位置を初期位置とする）
    const followLabel = Util.el('label', 'settings-check');
    const followInput = Util.el('input');
    followInput.type = 'checkbox';
    followInput.checked = options.followScroll;
    followLabel.append(followInput, Util.el('span', '', 'スクロールに追従する'));
    const alignWrap = Util.el('div', 'settings-inline');
    alignWrap.append(alignSelect, followLabel);
    body.append(this.field('親アイテムの縦表示位置', alignWrap));

    // アイテムの最大表示幅
    const widthWrap = Util.el('div', 'settings-range');
    const widthInput = Util.el('input');
    widthInput.type = 'range';
    widthInput.min = String(C.maxContentWidthRange[0]);
    widthInput.max = String(C.maxContentWidthRange[1]);
    widthInput.step = '10';
    widthInput.value = String(options.maxWidth);
    const widthValue = Util.el('span', 'settings-range-value', options.maxWidth + 'px');
    widthInput.addEventListener('input', () => {
      widthValue.textContent = widthInput.value + 'px';
    });
    widthWrap.append(widthInput, widthValue);
    body.append(this.field('アイテムの最大表示幅', widthWrap));

    // ステータス（0〜12 個）
    const statusSection = Util.el('div', 'settings-statuses');
    const header = Util.el('div', 'status-row status-header');
    header.append(Util.el('span', ''), Util.el('span', '', 'ステータス名'), Util.el('span', '', '色'), Util.el('span', '', '見本'), Util.el('span', ''));
    this.statusList = Util.el('div', 'status-list');
    this.addButton = Util.el('button', 'settings-button status-add', '＋ 追加');
    this.addButton.type = 'button';
    this.addButton.addEventListener('click', () => {
      this.addStatusRow({ name: '', color: C.statusColors[0].key }).querySelector('input').focus();
    });
    statusSection.append(header, this.statusList, this.addButton);
    for (const status of options.statuses) this.addStatusRow(status);
    this.updateAddButton();
    const statusField = this.field(`ステータス（${C.statusMax} 個まで）`, statusSection);
    statusField.classList.add('settings-field-block');
    body.append(statusField);

    this.error = Util.el('div', 'settings-error');
    body.append(this.error);

    const footer = Util.el('div', 'modal-footer');
    const cancel = Util.el('button', 'settings-button', 'キャンセル');
    cancel.type = 'button';
    const ok = Util.el('button', 'settings-button primary', 'OK');
    ok.type = 'button';
    cancel.addEventListener('click', () => this.close());
    ok.addEventListener('click', () => this.submit(alignSelect.value, followInput.checked, Number(widthInput.value)));
    footer.append(cancel, ok);

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
    alignSelect.focus();
  }

  field(label, control) {
    const row = Util.el('div', 'settings-field');
    row.append(Util.el('div', 'settings-label', label), control);
    return row;
  }

  addStatusRow(status) {
    const row = Util.el('div', 'status-row');
    const name = Util.el('input', 'settings-input');
    name.type = 'text';
    name.maxLength = Config.statusNameMax;
    name.placeholder = `1〜${Config.statusNameMax} 文字`;
    name.value = status.name;
    // 設定済みのステータスの元の名前（名前を変えたら、そのステータスのアイテムの表示も変える）
    if (status.name) row.dataset.original = status.name;
    const color = Util.el('select', 'settings-select');
    for (const c of Config.statusColors) {
      const option = Util.el('option', '', c.name);
      option.value = c.key;
      option.style.background = c.bg;
      option.style.color = c.fg;
      color.append(option);
    }
    color.value = status.color;
    const sample = Util.el('span', 'status-sample');
    const remove = Util.el('button', 'settings-button status-remove', '削除');
    remove.type = 'button';
    const refresh = () => {
      sample.textContent = '';
      sample.append(TabSettingsDialog.badge(name.value.trim() || '（未入力）', color.value));
      name.classList.remove('invalid');
    };
    name.addEventListener('input', refresh);
    color.addEventListener('change', refresh);
    remove.addEventListener('click', () => {
      row.remove();
      this.updateAddButton();
    });
    refresh();
    // 先頭のつまみを上下にドラッグして順序を入れ替える
    const grip = Util.el('span', 'status-grip');
    grip.title = 'ドラッグで順序を入れ替え';
    grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('pointerdown', (e) => this.startReorder(e, row));
    row.append(grip, name, color, sample, remove);
    this.statusList.append(row);
    this.updateAddButton();
    return row;
  }

  // ステータスの行のドラッグ：ポインタが他の行の縦中央を越えたら、その位置へ行を移す
  startReorder(e, row) {
    if (e.button !== 0) return;
    e.preventDefault();
    // 行を DOM 内で移すとポインタのキャプチャが外れるため、window で追う
    row.classList.add('dragging');
    const move = (ev) => {
      const rows = [...this.statusList.children].filter((r) => r !== row);
      const before = rows.find((r) => {
        const rect = r.getBoundingClientRect();
        return ev.clientY < rect.top + rect.height / 2;
      });
      if (before) {
        if (row.nextElementSibling !== before) this.statusList.insertBefore(row, before);
      } else if (this.statusList.lastElementChild !== row) {
        this.statusList.append(row);
      }
    };
    const end = () => {
      row.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  updateAddButton() {
    this.addButton.disabled = this.statusList.children.length >= Config.statusMax;
  }

  // 入力を検証して反映する（ステータス名は前後の空白を除いて 1〜12 文字で、重複しないこと）
  submit(parentAlign, followScroll, maxWidth) {
    const statuses = [];
    const renames = new Map(); // 元の名前 -> 新しい名前
    const seen = new Set();
    let invalid = null;
    let message = '';
    for (const row of this.statusList.children) {
      const input = row.querySelector('input');
      const name = input.value.trim();
      const length = Array.from(name).length;
      let error = '';
      if (length < 1 || length > Config.statusNameMax) error = `ステータス名は 1〜${Config.statusNameMax} 文字で入力してください`;
      else if (seen.has(name)) error = `同じステータス名「${name}」は登録できません`;
      seen.add(name);
      if (error) {
        input.classList.add('invalid');
        invalid = invalid || input;
        message = message || error;
        continue;
      }
      statuses.push({ name, color: row.querySelector('select').value });
      if (row.dataset.original && row.dataset.original !== name) renames.set(row.dataset.original, name);
    }
    if (invalid) {
      this.error.textContent = message;
      invalid.focus();
      return;
    }
    const tabId = this.tabId;
    const options = Model.normalizeOptions({ parentAlign, followScroll, maxWidth, statuses });
    this.close();
    this.app.commit((doc) => {
      const tab = doc.tabs.find((t) => t.id === tabId);
      if (!tab) return { tabId };
      tab.options = options;
      // 名前を変えたステータスは、そのタブのアイテムの表示名も変える（削除したステータスはアイテムに残す）
      const walk = (item) => {
        if (item.status && renames.has(item.status)) item.status = renames.get(item.status);
        item.children.forEach(walk);
      };
      if (renames.size) walk(tab.root);
      // フィルタの「表示しないステータス」も新しい名前にする
      if (renames.size && tab.filter) tab.filter.hideStatuses = tab.filter.hideStatuses.map((n) => renames.get(n) || n);
      return { tabId };
    }, { tabId });
  }

  close() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.tabId = null;
  }
}
