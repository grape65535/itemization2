'use strict';

// タブバー：タブの表示・切替・削除・追加・ドラッグでの並べ替え
class TabBar {
  constructor(app, container) {
    this.app = app;
    this.list = Util.el('div', 'tab-list');
    this.indicator = Util.el('div', 'tab-drop-indicator');
    this.addButton = Util.el('button', 'tab-add', '+');
    this.addButton.title = '新しいタブ';
    container.append(this.list, this.addButton);
    this.drag = null;
    this.renderedActiveId = null;
    this.rename = null; // タブ名編集中: { id, input }

    this.addButton.addEventListener('click', () => this.app.addTab());
    this.list.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.list.addEventListener('click', (e) => {
      const close = e.target.closest('.tab-close');
      if (close) this.app.deleteTab(close.parentElement.dataset.id);
    });
    // 縦ホイールでも横スクロールできるようにする（スクロールバーは非表示）
    this.list.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this.list.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    // タブ名のダブルクリックでその場で編集
    this.list.addEventListener('dblclick', (e) => {
      const title = e.target.closest('.tab-title');
      if (title) this.startRename(title.parentElement.dataset.id);
    });
    // 入力欄以外をクリックしたら確定（メインエリアは mousedown を preventDefault するため blur に頼らない）
    document.addEventListener('mousedown', (e) => {
      if (this.rename && e.target !== this.rename.input) this.finishRename(true);
    }, true);
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
  }

  render() {
    if ((this.drag && this.drag.active) || this.rename) return;
    const app = this.app;
    this.list.textContent = '';
    for (const tab of app.doc.tabs) {
      const el = Util.el('div', 'tab' + (tab.id === app.activeTabId ? ' active' : ''));
      el.dataset.id = tab.id;
      const title = Util.el('span', 'tab-title', app.tabTitle(tab));
      const close = Util.el('button', 'tab-close', '×');
      close.title = 'タブを閉じる';
      el.append(title, close);
      this.list.append(el);
    }
    this.list.append(this.indicator);
    if (this.renderedActiveId !== app.activeTabId) {
      this.renderedActiveId = app.activeTabId;
      const active = this.list.querySelector('.tab.active');
      if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  startRename(id) {
    const tab = this.app.findTab(id);
    const tabEl = this.list.querySelector(`.tab[data-id="${id}"]`);
    if (!tab || !tabEl || this.rename) return;
    this.app.editor.end();
    const title = tabEl.querySelector('.tab-title');
    const input = Util.el('input', 'tab-title-input');
    input.type = 'text';
    input.value = this.app.tabTitle(tab);
    input.spellcheck = false;
    title.replaceWith(input);
    this.rename = { id, input };
    const fit = () => {
      const ctx = TabBar.measureCtx || (TabBar.measureCtx = document.createElement('canvas').getContext('2d'));
      ctx.font = getComputedStyle(input).font;
      input.style.width = Math.ceil(ctx.measureText(input.value).width) + 6 + 'px';
    };
    fit();
    input.addEventListener('input', fit);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finishRename(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishRename(false);
      }
    });
    input.addEventListener('blur', () => this.finishRename(true));
    input.focus();
    input.select();
  }

  // commit=false（ESC）または 0 文字なら破棄して元のタブ名に戻す
  finishRename(commit) {
    const r = this.rename;
    if (!r) return;
    this.rename = null;
    const name = r.input.value;
    if (commit && name.length > 0) this.app.renameTab(r.id, name);
    this.render();
  }

  onMouseDown(e) {
    if (e.button !== 0 || e.target.closest('.tab-close') || e.target.closest('.tab-title-input')) return;
    const tabEl = e.target.closest('.tab');
    if (!tabEl) return;
    this.drag = { id: tabEl.dataset.id, el: tabEl, x: e.clientX, active: false, index: -1 };
  }

  onMouseMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientX - d.x) < Config.dragThreshold) return;
      d.active = true;
      d.el.classList.add('dragging');
      document.body.classList.add('tab-dragging');
    }
    // 挿入位置（ドラッグ中のタブを除いた並びでの index）
    const tabs = [...this.list.querySelectorAll('.tab')].filter((t) => t !== d.el);
    let index = tabs.length;
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    d.index = index;
    const listRect = this.list.getBoundingClientRect();
    let x;
    if (tabs.length === 0) x = d.el.getBoundingClientRect().left;
    else if (index < tabs.length) x = tabs[index].getBoundingClientRect().left - 2;
    else x = tabs[tabs.length - 1].getBoundingClientRect().right;
    this.indicator.style.left = x - listRect.left + this.list.scrollLeft + 'px';
    this.indicator.style.display = 'block';
    // 端に近ければタブバーをスクロール
    if (e.clientX < listRect.left + 20) this.list.scrollLeft -= 10;
    else if (e.clientX > listRect.right - 20) this.list.scrollLeft += 10;
  }

  onMouseUp(e) {
    const d = this.drag;
    if (!d || e.button !== 0) return;
    this.drag = null;
    this.indicator.style.display = 'none';
    document.body.classList.remove('tab-dragging');
    if (d.active) {
      d.el.classList.remove('dragging');
      this.app.moveTab(d.id, d.index);
      this.render();
    } else {
      this.app.switchTab(d.id);
    }
  }
}
