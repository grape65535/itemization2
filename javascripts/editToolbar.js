'use strict';

// 文字入力中にアイテムの上に表示する装飾のツールバー。
// フォントサイズ・太字・取消し線・下線・文字色・文字背景色は選択中の文字列だけに、
// アイテム背景色・左寄せ・中央寄せ・右寄せは選択に関係なくアイテム全体に適用する。
class EditToolbar {
  constructor(area, container) {
    this.area = area;
    this.el = Util.el('div', 'edit-toolbar');
    this.el.style.display = 'none';
    container.append(this.el);
    this.popup = null; // { id, el }
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

  onClick(e) {
    const option = e.target.closest('[data-value]');
    if (option && this.popup) {
      const value = option.dataset.value;
      this.choose(this.popup.id, value === '' ? null : value);
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
    def.action(this.editor);
  }

  // ポップアップで選んだ値を適用する（null は解除）
  choose(id, value) {
    const ed = this.editor;
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
    const info = this.editor.selectionInfo();
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

  // アイテムの上に表示する（上に余地が無ければ下）
  show(node) {
    const C = Config;
    const scroller = this.area.scroller;
    let top = node.y - C.toolbarHeight - C.toolbarGap;
    if (top < scroller.scrollTop) top = node.y + node.h + C.toolbarGap;
    this.el.style.display = 'flex';
    this.el.style.left = node.x + 'px';
    this.el.style.top = top + 'px';
  }

  hide() {
    this.closePopup();
    this.hideTooltip();
    this.el.style.display = 'none';
  }

  // 選択範囲に合わせてボタンの有効・無効と状態を更新する
  update() {
    if (!this.editor.isEditing) return;
    const info = this.editor.selectionInfo();
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
  };
})();
