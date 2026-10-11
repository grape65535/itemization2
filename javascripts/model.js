'use strict';

// 保存データ（JSON）のツリー操作
//   Document = { format, tabs: [Tab] }
//   Tab      = { id, name?, root: Item, options: TabOptions }（name はユーザーが付けたタブ名。無ければルートの文字列から生成）
//   TabOptions = { parentAlign: 'center'|'top', maxWidth: 100〜1000, statuses: [{ name, color }] }（タブの設定）
//   Item     = { id, text, collapsed, children: [Item], spans?, fill?, align?, status? }（装飾は richText.js を参照、status はステータス名）
const Model = {
  FORMAT: 1,

  createItem(text = '') {
    return { id: Util.newId(), text, collapsed: false, children: [] };
  },

  createTab() {
    return { id: Util.newId(), root: Model.createItem(''), options: Model.normalizeOptions(null) };
  },

  // アイテムのステータス（ステータス名）を設定する。空なら削除
  assignStatus(item, status) {
    const name = typeof status === 'string' ? status.trim() : '';
    if (name) item.status = name;
    else delete item.status;
    return item;
  },

  // タブの設定からステータスの表示（名前と色）を求める。設定に無い名前は削除されたステータスの表示
  statusLook(options, name) {
    const status = options && options.statuses.find((s) => s.name === name);
    const color = status && Config.statusColors.find((c) => c.key === status.color);
    if (!color) return { name, bg: Config.statusOrphan.bg, fg: Config.statusOrphan.fg, orphan: true };
    return { name, bg: color.bg, fg: color.fg, orphan: false };
  },

  // タブの設定を検証・補正する（無い項目は初期値）
  normalizeOptions(raw) {
    const C = Config;
    const o = raw && typeof raw === 'object' ? raw : {};
    const [minW, maxW] = C.maxContentWidthRange;
    const width = Math.round(Number(o.maxWidth));
    const colors = C.statusColors.map((c) => c.key);
    // ステータス名は 1〜12 文字・重複なし
    const names = new Set();
    const statuses = Array.isArray(o.statuses)
      ? o.statuses
        .filter((s) => s && typeof s.name === 'string' && s.name.trim())
        .map((s) => ({
          name: Array.from(s.name.trim()).slice(0, C.statusNameMax).join(''),
          color: colors.includes(s.color) ? s.color : colors[0],
        }))
        .filter((s) => !names.has(s.name) && names.add(s.name))
        .slice(0, C.statusMax)
      : C.defaultStatuses.map((s) => Object.assign({}, s));
    return {
      parentAlign: o.parentAlign === 'top' ? 'top' : 'center',
      maxWidth: Number.isFinite(width) ? Util.clamp(width, minW, maxW) : C.maxContentWidth,
      statuses,
    };
  },

  createDocument() {
    return { format: Model.FORMAT, tabs: [Model.createTab()] };
  },

  // 読み込んだデータを検証・補正する。不正なら null
  normalize(raw) {
    if (!raw || !Array.isArray(raw.tabs) || raw.tabs.length === 0) return null;
    const seen = new Set();
    const uniqueId = (id) => {
      const result = typeof id === 'string' && id && !seen.has(id) ? id : Util.newId();
      seen.add(result);
      return result;
    };
    const fixItem = (item) => {
      if (!item || typeof item !== 'object') return Model.createItem();
      return Model.assignStatus(RichText.assignDecoration({
        id: uniqueId(item.id),
        text: typeof item.text === 'string' ? item.text : '',
        collapsed: !!item.collapsed,
        children: Array.isArray(item.children) ? item.children.map(fixItem) : [],
      }, item), item.status);
    };
    return {
      format: Model.FORMAT,
      tabs: raw.tabs.map((tab) => {
        const fixed = { id: uniqueId(tab && tab.id), root: fixItem(tab && tab.root) };
        if (tab && typeof tab.name === 'string' && tab.name) fixed.name = tab.name;
        fixed.options = Model.normalizeOptions(tab && tab.options);
        return fixed;
      }),
    };
  },

  // タブとその全アイテムに新しい ID を振る（外部ファイルから追加する時に既存の ID と重ならないように）
  reassignIds(tab) {
    const walk = (item) => {
      item.id = Util.newId();
      item.children.forEach(walk);
    };
    tab.id = Util.newId();
    walk(tab.root);
    return tab;
  },

  // id -> { item, parent, index, depth, tab, order }（order は文書順の通し番号）
  buildIndex(doc) {
    const map = new Map();
    let order = 0;
    for (const tab of doc.tabs) {
      const walk = (item, parent, index, depth) => {
        map.set(item.id, { item, parent, index, depth, tab, order: order++ });
        item.children.forEach((child, i) => walk(child, item, i, depth + 1));
      };
      walk(tab.root, null, 0, 0);
    }
    return map;
  },

  locate(doc, id) {
    const search = (item, parent, index, tab) => {
      if (item.id === id) return { item, parent, index, tab };
      for (let i = 0; i < item.children.length; i++) {
        const found = search(item.children[i], item, i, tab);
        if (found) return found;
      }
      return null;
    };
    for (const tab of doc.tabs) {
      const found = search(tab.root, null, 0, tab);
      if (found) return found;
    }
    return null;
  },

  // アイテムを削除し、子をその位置に繰り上げる（ルートは削除しない）
  removePromote(doc, id) {
    const loc = Model.locate(doc, id);
    if (!loc || !loc.parent) return false;
    loc.parent.children.splice(loc.index, 1, ...loc.item.children);
    return true;
  },

  isDescendant(index, id, ancestorId) {
    let entry = index.get(id);
    while (entry && entry.parent) {
      if (entry.parent.id === ancestorId) return true;
      entry = index.get(entry.parent.id);
    }
    return false;
  },
};
