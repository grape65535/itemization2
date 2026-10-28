'use strict';

// 保存データ（JSON）のツリー操作
//   Document = { format, tabs: [Tab], shortcuts? }（shortcuts はショートカットキーの割り当て { 操作の ID: Combo }。shortcut.js を参照）
//   Tab      = { id, name?, root: Item, options: TabOptions, filter?: TabFilter }（name はユーザーが付けたタブ名。無ければルートの文字列から生成）
//   TabFilter = { text, ignoreCase, regex, hideStatuses, hideUnregistered, hideNoStatus, active, hidden? }
//              （フィルタの条件と、フィルタ中か。hidden はフィルタ中に [+] で隠しているアイテムの ID（フィルタ後の開閉状態））
//   TabOptions = { horizontalAlign: 'depth'|'compact', parentAlign: 'center'|'top', followScroll, maxWidth: 100〜1000, statuses: [{ name, color }] }（タブの設定）
//   Item     = { id, text, collapsed, children: [Item], created, updated, spans?, fill?, align?, status?, width?, hidden? }
//              （created・updated は登録日時・更新日時の ISO 8601 文字列（UTC）。更新日時は文字列・ステータスの変更時に更新する）
//              （装飾は richText.js を参照、status はステータス名、width は枠の右端のドラッグで変えた表示幅（文字領域の幅 px。無ければ自動）、hidden は「非表示にする」で [+] に隠したか（true のみ記録。ルートには付けない））
const Model = {
  FORMAT: 1,

  createItem(text = '') {
    const now = Model.now();
    return { id: Util.newId(), text, collapsed: false, children: [], created: now, updated: now };
  },

  // 登録日時・更新日時に記録する現在日時
  now() {
    return new Date().toISOString();
  },

  // 日時の文字列として正しければそのまま、でなければ null
  validTime(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
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

  // アイテムの表示幅（文字領域の幅 px）を設定する。正の数でなければ削除（自動的に計算する幅に戻す）
  assignWidth(item, width) {
    const w = Math.round(Number(width));
    if (Number.isFinite(w) && w > 0) item.width = w;
    else delete item.width;
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
      horizontalAlign: o.horizontalAlign === 'compact' ? 'compact' : 'depth',
      parentAlign: o.parentAlign === 'top' ? 'top' : 'center',
      followScroll: !!o.followScroll,
      maxWidth: Number.isFinite(width) ? Util.clamp(width, minW, maxW) : C.maxContentWidth,
      statuses,
    };
  },

  // フィルタの条件を検証・補正する。条件が無い・正規表現が不正なら null
  normalizeFilter(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const names = Array.isArray(raw.hideStatuses) ? raw.hideStatuses.filter((n) => typeof n === 'string' && n) : [];
    const filter = {
      text: typeof raw.text === 'string' ? raw.text : '',
      ignoreCase: !!raw.ignoreCase,
      regex: !!raw.regex,
      hideStatuses: [...new Set(names)],
      hideUnregistered: !!raw.hideUnregistered,
      hideNoStatus: !!raw.hideNoStatus,
      active: !!raw.active,
    };
    if (filter.active && Array.isArray(raw.hidden)) filter.hidden = raw.hidden.filter((id) => typeof id === 'string' && id);
    if (!Model.filterHasCondition(filter)) return null;
    try {
      Model.filterMatcher(filter, null);
    } catch (e) {
      return null;
    }
    return filter;
  },

  // 検索文字列があるか、表示しないステータスの条件があるか（無ければ全アイテムがヒットするため条件として扱わない）
  filterHasCondition(filter) {
    return filter.text !== '' || (filter.hideStatuses || []).length > 0 || !!filter.hideUnregistered || !!filter.hideNoStatus;
  },

  // アイテムが条件に合う（ヒット）かを判定する関数を返す。正規表現が不正なら SyntaxError。
  // 文字列: 条件に合う部分を含むか（検索文字列が空なら問わない）。
  // ステータス: タブの設定（options）にステータスが登録されている時だけ、表示しないステータス・未登録のステータス・ステータス無しを除く。
  // 両方の条件は AND
  filterMatcher(condition, options) {
    let re = null;
    if (condition.text !== '') {
      const source = condition.regex ? condition.text : condition.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(source, condition.ignoreCase ? 'i' : '');
    }
    const names = new Set(options ? options.statuses.map((s) => s.name) : []);
    const hide = new Set(condition.hideStatuses || []);
    const statusOk = (status) => {
      if (names.size === 0) return true;
      if (!status) return !condition.hideNoStatus;
      if (names.has(status)) return !hide.has(status);
      return !condition.hideUnregistered;
    };
    return (item) => statusOk(item.status) && (!re || re.test(item.text));
  },

  // フィルタをかけた時の表示：条件に合うアイテム（ヒット）とその祖先・ルートを表示し、
  // それらの子のうちヒットを含まない兄弟を [+] で隠す（hidden）。子孫にヒットを含むアイテムは展開し（expand）、
  // 含まないヒットは折り畳む（collapse）。ルートもヒットしなければ、展開して子をすべて隠す
  filterPlan(root, test) {
    const below = new Map(); // 表示するアイテムの ID -> 子孫にヒットを含むか
    const visit = (item) => {
      let found = false;
      for (const child of item.children) found = visit(child) || found;
      const hit = test(item);
      if (hit || found || item === root) below.set(item.id, found);
      return hit || found;
    };
    visit(root);
    const plan = { hidden: new Set(), expand: new Set(), collapse: new Set(), shown: new Set(below.keys()) };
    const walk = (item) => {
      if (below.get(item.id) || (item === root && !test(item))) {
        if (item.children.length) plan.expand.add(item.id);
        for (const child of item.children) {
          if (below.has(child.id)) walk(child);
          else plan.hidden.add(child.id);
        }
      } else if (item.children.length) {
        plan.collapse.add(item.id);
      }
    };
    walk(root);
    return plan;
  },

  // タブにフィルタをかける（「フィルタを設定」の OK）：ヒットしないアイテムを [+] で隠し（tab.filter.hidden に記録）、
  // 折り畳み状態・非表示も filterPlan のとおりにする。フィルタ後の開閉状態はこれでリセットされる
  applyFilter(tab) {
    const plan = Model.filterPlan(tab.root, Model.filterMatcher(tab.filter, tab.options));
    Model.applyFilterCollapse(tab.root, plan);
    tab.filter.hidden = [...plan.hidden];
  },

  // フィルタ中のタブで、[+] で隠しているアイテム（tab.filter.hidden）から ids を除く
  unhideFiltered(tab, ids) {
    if (!tab.filter || !Array.isArray(tab.filter.hidden)) return;
    const remove = new Set(ids);
    tab.filter.hidden = tab.filter.hidden.filter((id) => !remove.has(id));
  },

  // filterPlan の展開・折り畳みをツリーに反映する。表示するアイテム（ヒットとその祖先）は「非表示にする」も解除する
  applyFilterCollapse(root, plan) {
    const walk = (item) => {
      if (plan.shown.has(item.id)) delete item.hidden;
      if (plan.expand.has(item.id)) item.collapsed = false;
      if (plan.collapse.has(item.id)) item.collapsed = true;
      item.children.forEach(walk);
    };
    walk(root);
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
      const fixed = Model.assignStatus(RichText.assignDecoration({
        id: uniqueId(item.id),
        text: typeof item.text === 'string' ? item.text : '',
        collapsed: !!item.collapsed,
        children: Array.isArray(item.children) ? item.children.map(fixItem) : [],
      }, item), item.status);
      // 日時の無い（旧形式の）アイテムは、もう一方の日時か読み込んだ日時で補う
      const created = Model.validTime(item.created);
      const updated = Model.validTime(item.updated);
      fixed.created = created || updated || Model.now();
      fixed.updated = updated || fixed.created;
      Model.assignWidth(fixed, item.width);
      if (item.hidden === true) fixed.hidden = true;
      return fixed;
    };
    const doc = {
      format: Model.FORMAT,
      tabs: raw.tabs.map((tab) => {
        const fixed = { id: uniqueId(tab && tab.id), root: fixItem(tab && tab.root) };
        delete fixed.root.hidden;
        if (tab && typeof tab.name === 'string' && tab.name) fixed.name = tab.name;
        fixed.options = Model.normalizeOptions(tab && tab.options);
        const filter = Model.normalizeFilter(tab && tab.filter);
        if (filter) fixed.filter = filter;
        // フィルタ後の開閉状態が無い（旧形式の）フィルタ中のタブは、折り畳み状態を変えずに [+] で隠すアイテムだけを求める
        if (filter && filter.active && !filter.hidden) {
          filter.hidden = [...Model.filterPlan(fixed.root, Model.filterMatcher(filter, fixed.options)).hidden];
        }
        return fixed;
      }),
    };
    const shortcuts = Shortcut.normalize(raw.shortcuts);
    if (shortcuts) doc.shortcuts = shortcuts;
    return doc;
  },

  // タブとその全アイテムに新しい ID を振る（外部ファイルから追加する時に既存の ID と重ならないように）
  reassignIds(tab) {
    const map = new Map();
    const walk = (item) => {
      const id = Util.newId();
      map.set(item.id, id);
      item.id = id;
      item.children.forEach(walk);
    };
    tab.id = Util.newId();
    walk(tab.root);
    if (tab.filter && Array.isArray(tab.filter.hidden)) tab.filter.hidden = tab.filter.hidden.filter((id) => map.has(id)).map((id) => map.get(id));
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

  // アイテムを子孫ごと削除する。ルートはルートを残して子孫を全て削除する（祖先と一緒に削除済みなら何もしない）
  removeSubtree(doc, id) {
    const loc = Model.locate(doc, id);
    if (!loc) return false;
    if (loc.parent) loc.parent.children.splice(loc.index, 1);
    else loc.item.children = [];
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
