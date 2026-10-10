'use strict';

// 文字装飾のツールバー。文字入力中はそのアイテムの上に、文字入力中以外でアイテム選択中は最後に選択したアイテムの上に表示する。
// 文字入力中: フォントサイズ・太字・取消し線・下線・文字色・文字背景色は選択中の文字列だけに、
//            アイテム背景色・寄せ方・装飾を消すはアイテム全体に適用する（操作先は ItemEditor）。
// アイテム選択中: すべての操作を選択中の各アイテムの文字列全体に適用する（操作先は SelectionDecorator）。
class EditToolbar {
  constructor(area, container) {
    this.area = area;
    this.el = Util.el('div', 'edit-toolbar');
    this.el.style.display = 'none';
    container.append(this.el);
    this.popup = null; // { id, el }
    this.selectionDecorator = new SelectionDecorator(area.app);
    this.shownKey = null; // 表示中の対象（変わったらポップアップを閉じる）
    this.dismissedKey = null; // × で閉じた時の対象（文字入力を始めるか、選択が変わるまで表示しない）
    // 最後に選んだ色（ボタンのアイコンに表示する）
    this.lastColor = { color: Config.palette[3].text, bg: Config.palette[5].pale, fill: Config.palette[9].pale };

    const ICON = EditToolbar.ICONS;
    const defs = [
      { id: 'size', title: 'フォントサイズ', icon: ICON.size, popup: true, textOnly: true },
      { id: 'bold', title: '太字', icon: ICON.bold, textOnly: true, action: (ed) => ed.toggleStyle('bold') },
      { id: 'strike', title: '取消し線', icon: ICON.strike, textOnly: true, action: (ed) => ed.toggleStyle('strike') },
      { id: 'underline', title: '下線', icon: ICON.underline, textOnly: true, action: (ed) => ed.toggleStyle('underline') },
      { id: 'color', title: '文字色', icon: ICON.color, popup: true, textOnly: true },
      { id: 'bg', title: '文字背景色', icon: ICON.bg, popup: true, textOnly: true },
      { separator: true },
      { id: 'fill', title: 'アイテム背景色', icon: ICON.fill, popup: true },
      { separator: true },
      { id: 'left', title: '左寄せ', icon: ICON.left, action: (ed) => ed.setAlign('left') },
      { id: 'center', title: '中央寄せ', icon: ICON.center, action: (ed) => ed.setAlign('center') },
      { id: 'right', title: '右寄せ', icon: ICON.right, action: (ed) => ed.setAlign('right') },
      { separator: true },
      { id: 'clear', title: '装飾を消す', icon: ICON.clear, action: (ed) => ed.clearDecoration() },
    ];
    this.buttons = new Map();
    for (const def of defs) {
      if (def.separator) {
        this.el.append(Util.el('span', 'edit-toolbar-separator'));
        continue;
      }
      const button = Util.el('button', 'edit-toolbar-button' + (def.popup ? ' has-popup' : ''));
      button.type = 'button';
      button.setAttribute('aria-label', def.title);
      button.dataset.tooltip = def.title;
      button.innerHTML = def.icon;
      button.dataset.id = def.id;
      this.buttons.set(def.id, { def, button });
      this.el.append(button);
    }
    // ツールバーを閉じる × ボタン（装飾のボタンと区別できるよう、右端に離して丸いボタンにする）
    this.closeButton = Util.el('button', 'edit-toolbar-button edit-toolbar-close');
    this.closeButton.type = 'button';
    this.closeButton.setAttribute('aria-label', 'ツールバーを閉じる');
    this.closeButton.dataset.tooltip = 'ツールバーを閉じる';
    this.closeButton.dataset.id = 'close';
    this.closeButton.innerHTML = ICON.close;
    this.el.append(this.closeButton);

    // 文字入力欄からフォーカスを奪わない（mousedown の既定動作を止める）。メインエリアのマウス操作にも渡さない
    this.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.area.app.menuBar.closeAll();
      if (!e.target.closest('.edit-toolbar-popup')) {
        const button = e.target.closest('.edit-toolbar-button');
        if (!button) this.closePopup();
      }
    });
    this.el.addEventListener('click', (e) => this.onClick(e));

    // ボタンの説明のツールチップ（マウスを置くと少し遅れて表示）
    this.tooltip = Util.el('div', 'edit-toolbar-tooltip');
    this.tooltipTimer = null;
    this.el.addEventListener('mouseover', (e) => {
      const button = e.target.closest('.edit-toolbar-button');
      if (button) this.showTooltip(button);
    });
    this.el.addEventListener('mouseout', (e) => {
      const button = e.target.closest('.edit-toolbar-button');
      if (button && !button.contains(e.relatedTarget)) this.hideTooltip();
    });
    this.el.addEventListener('mousedown', () => this.hideTooltip(), true);
  }

  showTooltip(button) {
    if (this.tooltip.parentNode && this.tooltip.dataset.for === button.dataset.id) return;
    this.hideTooltip();
    this.tooltipTimer = setTimeout(() => {
      this.tooltip.textContent = button.dataset.tooltip;
      this.tooltip.dataset.for = button.dataset.id;
      this.tooltip.style.left = button.offsetLeft + button.offsetWidth / 2 + 'px';
      this.el.append(this.tooltip);
    }, 400);
  }

  hideTooltip() {
    clearTimeout(this.tooltipTimer);
    this.tooltipTimer = null;
    this.tooltip.remove();
  }

  get editor() {
    return this.area.editor;
  }

  // 操作先（文字入力中は ItemEditor、それ以外は選択中のアイテム）
  get target() {
    return this.editor.isEditing ? this.editor : this.selectionDecorator;
  }

  onClick(e) {
    const option = e.target.closest('[data-value]');
    if (option && this.popup) {
      const value = option.dataset.value;
      this.choose(this.popup.id, value === '' ? null : value);
      return;
    }
    if (e.target.closest('.edit-toolbar-close')) {
      this.dismiss();
      return;
    }
    const button = e.target.closest('.edit-toolbar-button');
    if (!button || button.classList.contains('disabled')) return;
    const { def } = this.buttons.get(button.dataset.id);
    if (def.popup) {
      if (this.popup && this.popup.id === def.id) this.closePopup();
      else this.openPopup(def.id);
      return;
    }
    this.closePopup();
    def.action(this.target);
  }

  // ポップアップで選んだ値を適用する（null は解除）
  choose(id, value) {
    const ed = this.target;
    this.closePopup();
    if (id === 'size') {
      const size = Number(value);
      ed.applyStyle('size', size === Config.fontSize ? null : size);
      return;
    }
    if (value) this.lastColor[id] = value;
    if (id === 'fill') ed.setFill(value);
    else ed.applyStyle(id, value);
  }

  openPopup(id) {
    this.closePopup();
    const info = this.target.selectionInfo();
    const popup = Util.el('div', 'edit-toolbar-popup');
    if (id === 'size') {
      popup.classList.add('size-list');
      for (const size of Config.fontSizes) {
        const option = Util.el('button', 'size-option' + (info.size === size ? ' current' : ''));
        option.type = 'button';
        option.dataset.value = String(size);
        const sample = Util.el('span', 'size-sample', 'あA');
        sample.style.fontSize = size + 'px';
        option.append(sample, Util.el('span', 'size-label', size === Config.fontSize ? `${size}px（標準）` : `${size}px`));
        popup.append(option);
      }
    } else {
      // 文字色は原色に近い 16 色、文字背景色・アイテム背景色は同じ 16 色を薄くした色
      const key = id === 'color' ? 'text' : 'pale';
      const current = id === 'color' ? info.color : id === 'bg' ? info.bg : info.fill;
      const grid = Util.el('div', 'color-grid');
      for (const c of Config.palette) {
        const hex = c[key];
        const swatch = Util.el('button', 'color-swatch' + (current === hex ? ' current' : ''));
        swatch.type = 'button';
        swatch.dataset.value = hex;
        swatch.title = c.name;
        swatch.style.background = hex;
        grid.append(swatch);
      }
      const none = Util.el('button', 'color-none' + (current === '' ? ' current' : ''), id === 'color' ? '標準の色（黒）' : '色なし');
      none.type = 'button';
      none.dataset.value = '';
      popup.append(grid, none);
    }
    const button = this.buttons.get(id).button;
    button.classList.add('open');
    popup.style.left = button.offsetLeft + 'px';
    this.el.append(popup);
    this.popup = { id, el: popup };
  }

  // 開いていたポップアップを閉じたら true
  closePopup() {
    if (!this.popup) return false;
    this.popup.el.remove();
    this.buttons.get(this.popup.id).button.classList.remove('open');
    this.popup = null;
    return true;
  }

  // 文字入力中以外の表示：選択中のアイテムがあれば最後に選択したアイテムの上に表示し、無ければ隠す
  syncSelection() {
    if (this.editor.isEditing) return;
    const area = this.area;
    const ids = this.selectionDecorator.ids();
    const node = area.layout && !(area.drag && area.drag.type !== 'pending') ? this.selectionDecorator.anchorNode(area.layout) : null;
    if (!node) {
      this.dismissedKey = null;
      this.hide();
      return;
    }
    if (this.show(node, 'sel:' + ids.join(','))) this.update();
  }

  // × ボタン：ツールバーを一時的に閉じる（文字入力中なら次に文字入力を始めるまで、
  // アイテム選択中なら選択が変わるか文字入力を始めるまで表示しない）
  dismiss() {
    this.dismissedKey = this.shownKey;
    this.hide();
    this.dismissedKey = this.dismissedKey || 'dismissed';
  }

  // 文字入力を始めた時に、× で閉じたツールバーを再び表示できるようにする
  restore() {
    this.dismissedKey = null;
  }

  // アイテムの上に表示する（上に余地が無ければ下）。key は表示対象を表す文字列。× で閉じていれば表示せず false
  show(node, key = 'edit:' + node.id) {
    if (this.dismissedKey !== null && this.dismissedKey !== key) {
      // 文字入力中に閉じた後、入力を終えて同じアイテムが選択されたままなら閉じたままにする
      if (this.dismissedKey.startsWith('edit:') && key.startsWith('sel:')) this.dismissedKey = key;
      else this.dismissedKey = null;
    }
    if (this.dismissedKey !== null) {
      this.hide();
      return false;
    }
    if (key !== this.shownKey) this.closePopup();
    this.shownKey = key;
    const C = Config;
    const scroller = this.area.scroller;
    let top = node.y - C.toolbarHeight - C.toolbarGap;
    if (top < scroller.scrollTop) top = node.y + node.h + C.toolbarGap;
    this.el.style.display = 'flex';
    this.el.style.left = node.x + 'px';
    this.el.style.top = top + 'px';
    return true;
  }

  hide() {
    this.shownKey = null;
    this.closePopup();
    this.hideTooltip();
    this.el.style.display = 'none';
  }

  // 選択範囲に合わせてボタンの有効・無効と状態を更新する
  update() {
    const info = this.target.selectionInfo();
    for (const { def, button } of this.buttons.values()) {
      const disabled = !!def.textOnly && !info.hasSelection;
      button.classList.toggle('disabled', disabled);
      button.setAttribute('aria-disabled', String(disabled));
      const active = def.id === 'bold' || def.id === 'strike' || def.id === 'underline' ? info[def.id]
        : def.id === 'left' || def.id === 'center' || def.id === 'right' ? info.align === def.id : false;
      button.classList.toggle('active', !!active);
    }
    this.buttons.get('color').button.style.setProperty('--swatch', this.lastColor.color);
    this.buttons.get('bg').button.style.setProperty('--swatch', this.lastColor.bg);
    this.buttons.get('fill').button.style.setProperty('--swatch', this.lastColor.fill);
    // 文字列の装飾は選択が無くなったら選べない
    if (this.popup && this.buttons.get(this.popup.id).def.textOnly && !info.hasSelection) this.closePopup();
  }
}

// ボタンのアイコン（SVG）。色見本は CSS 変数 --swatch で塗る
EditToolbar.ICONS = (() => {
  const svg = (body) => `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${body}</svg>`;
  const font = 'font-family="Arial, Helvetica, sans-serif"';
  const lines = (xs) => xs.map(([x, w], i) => `<rect x="${x}" y="${4 + i * 3.5}" width="${w}" height="1.6" fill="currentColor"/>`).join('');
  return {
    size: svg(`<text x="1" y="15" ${font} font-size="15" font-weight="bold" fill="currentColor">A</text>` +
      `<text x="11" y="15" ${font} font-size="9" font-weight="bold" fill="currentColor">A</text>` +
      '<path d="M14 2 l2.5 3 l2.5 -3 z" fill="currentColor"/>'),
    bold: svg(`<text x="10" y="15.5" ${font} font-size="15" font-weight="900" text-anchor="middle" fill="currentColor">B</text>`),
    strike: svg(`<text x="10" y="15.5" ${font} font-size="15" text-anchor="middle" fill="currentColor">S</text>` +
      '<rect x="3" y="9.6" width="14" height="1.6" fill="currentColor"/>'),
    underline: svg(`<text x="10" y="14" ${font} font-size="14" text-anchor="middle" fill="currentColor">U</text>` +
      '<rect x="4" y="16" width="12" height="1.6" fill="currentColor"/>'),
    color: svg(`<text x="10" y="13.5" ${font} font-size="14" font-weight="bold" text-anchor="middle" fill="currentColor">A</text>` +
      '<rect x="3" y="15.5" width="14" height="3.5" rx="0.5" style="fill: var(--swatch)" stroke="#999" stroke-width="0.5"/>'),
    bg: svg('<rect x="2" y="2" width="16" height="16" rx="2" style="fill: var(--swatch)" stroke="#999" stroke-width="0.6"/>' +
      `<text x="10" y="15" ${font} font-size="13" font-weight="bold" text-anchor="middle" fill="currentColor">A</text>`),
    fill: svg('<rect x="2" y="4" width="16" height="12" rx="3" style="fill: var(--swatch)" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="5.5" y="8" width="9" height="1.4" fill="currentColor"/><rect x="5.5" y="10.8" width="6" height="1.4" fill="currentColor"/>'),
    left: svg(lines([[3, 14], [3, 9], [3, 14], [3, 9]])),
    center: svg(lines([[3, 14], [5.5, 9], [3, 14], [5.5, 9]])),
    right: svg(lines([[3, 14], [8, 9], [3, 14], [8, 9]])),
    close: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">' +
      '<path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    clear: svg(`<text x="8.5" y="15" ${font} font-size="14" font-weight="bold" text-anchor="middle" fill="currentColor">A</text>` +
      '<path d="M3 17 L17 3" stroke="#e60000" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M13 13 l5 5 M18 13 l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  };
})();

// 文字入力中以外で、選択中のアイテム（アクティブタブ内）の文字列全体に装飾を適用する。ItemEditor と同じ操作を持つ
class SelectionDecorator {
  constructor(app) {
    this.app = app;
  }

  ids() {
    return this.app.selectedIds();
  }

  // 最後に選択したアイテムの表示位置（折り畳みで見えなければ、その前に選択した見えるアイテム）
  anchorNode(layout) {
    const app = this.app;
    const selected = [...app.selection].filter((id) => {
      const entry = app.index.get(id);
      return entry && entry.tab.id === app.activeTabId;
    });
    for (let i = selected.length - 1; i >= 0; i--) {
      const node = layout.nodes.get(selected[i]);
      if (node) return node;
    }
    return null;
  }

  items() {
    return this.ids().map((id) => this.app.index.get(id).item);
  }

  // 選択中の全アイテムの文字をつなげて、文字入力中と同じ形で状態を返す（アイテムの区切りは改行として無視される）
  selectionInfo() {
    const items = this.items();
    let text = '';
    let styles = [];
    items.forEach((item, i) => {
      if (i > 0) {
        text += '\n';
        styles.push(null);
      }
      text += item.text;
      styles = styles.concat(RichText.toArray(item.text, item.spans));
    });
    const common = (values) => (values.every((v) => v === values[0]) ? values[0] : null);
    const n = text.length;
    return {
      hasSelection: items.length > 0,
      bold: RichText.allHave(styles, text, 0, n, 'bold'),
      strike: RichText.allHave(styles, text, 0, n, 'strike'),
      underline: RichText.allHave(styles, text, 0, n, 'underline'),
      size: RichText.commonValue(styles, text, 0, n, (st) => RichText.sizeOf(st)),
      color: RichText.commonValue(styles, text, 0, n, (st) => (st && st.color) || ''),
      bg: RichText.commonValue(styles, text, 0, n, (st) => (st && st.bg) || ''),
      fill: common(items.map((item) => item.fill || '')),
      align: common(items.map((item) => item.align || 'left')),
    };
  }

  // 選択中の各アイテムを fn(item) で変更する（1 回の Undo で戻る）
  decorate(fn) {
    const ids = this.ids();
    if (ids.length === 0) return;
    this.app.commit((doc) => {
      for (const id of ids) {
        const item = Model.locate(doc, id).item;
        fn(item);
        RichText.assignDecoration(item, item);
      }
      return { itemId: ids[0] };
    }, { itemId: ids[0] });
  }

  applyStyle(prop, value) {
    this.decorate((item) => {
      const styles = RichText.toArray(item.text, item.spans).map((st) => RichText.withProp(st, prop, value));
      item.spans = RichText.toSpans(styles);
    });
  }

  // すべての文字がその装飾を持っていれば解除、そうでなければ設定
  toggleStyle(prop) {
    this.applyStyle(prop, this.selectionInfo()[prop] ? null : true);
  }

  setFill(color) {
    this.decorate((item) => {
      item.fill = color || null;
    });
  }

  setAlign(align) {
    this.decorate((item) => {
      item.align = align;
    });
  }

  clearDecoration() {
    this.decorate((item) => {
      item.spans = null;
      item.fill = null;
      item.align = null;
    });
  }
}
