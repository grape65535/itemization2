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
    const dialog = Util.el('div', 'modal-dialog');
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
    body.append(this.field('親アイテムの縦表示位置', alignSelect));

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
    header.append(Util.el('span', '', 'ステータス名'), Util.el('span', '', '色'), Util.el('span', '', '見本'), Util.el('span', ''));
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
    ok.addEventListener('click', () => this.submit(alignSelect.value, Number(widthInput.value)));
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
    row.append(name, color, sample, remove);
    this.statusList.append(row);
    this.updateAddButton();
    return row;
  }

  updateAddButton() {
    this.addButton.disabled = this.statusList.children.length >= Config.statusMax;
  }

  // 入力を検証して反映する（ステータス名は前後の空白を除いて 1〜12 文字）
  submit(parentAlign, maxWidth) {
    const statuses = [];
    let invalid = null;
    for (const row of this.statusList.children) {
      const input = row.querySelector('input');
      const name = input.value.trim();
      const length = Array.from(name).length;
      if (length < 1 || length > Config.statusNameMax) {
        input.classList.add('invalid');
        invalid = invalid || input;
        continue;
      }
      statuses.push({ name, color: row.querySelector('select').value });
    }
    if (invalid) {
      this.error.textContent = `ステータス名は 1〜${Config.statusNameMax} 文字で入力してください`;
      invalid.focus();
      return;
    }
    const tabId = this.tabId;
    const options = Model.normalizeOptions({ parentAlign, maxWidth, statuses });
    this.close();
    this.app.commit((doc) => {
      const tab = doc.tabs.find((t) => t.id === tabId);
      if (tab) tab.options = options;
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
