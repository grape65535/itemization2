'use strict';

// コピー/貼り付け用のアイテム形式の変換。
// クリップ形式 = [{ text, children: [クリップ形式] }]（ID を持たない木）
const ItemClipboard = {
  MIME: 'application/x-itemization+json',
  BULLET: '・',
  INDENT: '  ',

  // 行頭の箇条書き記号。- # * は連続可（連続数だけ深い階層）
  LINE_PATTERN: /^([ \t　]*)(?:(-+|#+|\*+)|([・･•○●×→▲▶▼◀△▷▽◁①-⑳])[︎️]?)[ \t　]*(.*)$/,
  // 罫線ツリー（├── / └ / ┣━ / ASCII の |-- `-- +-- など）。前置きの │ と空白がインデント
  TREE_PATTERN: /^([ \t　│┃║|]*?)(?:[├└┣┗┠┖┝┕╠╚╟╙]|[|`+](?=-))[─━═\-]*[ \t　]*(.*)$/,
  TREE_RULE: /^[ \t　│┃║|]*/,
  // 番号付き（1. / 1.text / 1 text / 1.2 text / 1-2 text / 1.2.text / 1-2.text、全角も可）。末尾が . なら後の空白は任意、. が無ければ空白必須。区切りの数が多いほど深い階層
  NUMBER_PATTERN: /^([ \t　]*)([0-9０-９]+(?:[.．\-－][0-9０-９]+)*)(?:[.．](?![0-9０-９])[ \t　]*|[ \t　]+)(.*)$/,
  // 括弧で囲った番号付き（(1) text / （１） text）。後の空白は必須
  PAREN_NUMBER_PATTERN: /^([ \t　]*)[(（][0-9０-９]+[)）][ \t　]+(.*)$/,

  // 行がアイテムの始まりなら { key: [indent, rank, run], body, tree } を返す
  matchItemLine(line) {
    let m = line.match(ItemClipboard.TREE_PATTERN);
    if (m) {
      // 分岐記号の位置より左から始まるアイテムの子になるよう +1
      return { key: [ItemClipboard.indentWidth(m[1]) + 1, 1, 1], body: m[2], tree: true };
    }
    m = line.match(ItemClipboard.LINE_PATTERN);
    if (m) {
      const run = m[2] ? m[2].length : 1;
      const rank = m[2] && m[2][0] === '#' ? 0 : 1;
      return { key: [ItemClipboard.indentWidth(m[1]), rank, run], body: m[4], tree: false };
    }
    m = line.match(ItemClipboard.NUMBER_PATTERN);
    if (m) {
      const run = m[2].split(/[.．\-－]/).length;
      return { key: [ItemClipboard.indentWidth(m[1]), 1, run], body: m[3], tree: false };
    }
    m = line.match(ItemClipboard.PAREN_NUMBER_PATTERN);
    if (m) return { key: [ItemClipboard.indentWidth(m[1]), 1, 1], body: m[2], tree: false };
    return null;
  },

  // 文書のアイテムからクリップ形式を作る。
  // ids（文書順）のうち、選択された最も近い祖先の子として並べることで、選択アイテム間の親子関係を維持する
  fromSelection(index, ids) {
    const selected = new Set(ids);
    const nodes = new Map();
    const roots = [];
    for (const id of ids) {
      const node = { text: index.get(id).item.text, children: [] };
      nodes.set(id, node);
      let parent = null;
      for (let e = index.get(id); e && e.parent; e = index.get(e.parent.id)) {
        if (selected.has(e.parent.id)) {
          parent = nodes.get(e.parent.id);
          break;
        }
      }
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  },

  toJson(clips) {
    return JSON.stringify({ format: 'itemization-clip', version: 1, items: clips });
  },

  fromJson(json) {
    try {
      const data = JSON.parse(json);
      if (!data || data.format !== 'itemization-clip' || !Array.isArray(data.items)) return null;
      const fix = (c) => ({
        text: c && typeof c.text === 'string' ? c.text : '',
        children: c && Array.isArray(c.children) ? c.children.map(fix) : [],
      });
      return data.items.map(fix);
    } catch (e) {
      return null;
    }
  },

  // クリップ形式 → 文書のアイテム（新しい ID を振る）
  toItems(clips) {
    return clips.map((c) => {
      const item = Model.createItem(c.text);
      item.children = ItemClipboard.toItems(c.children);
      return item;
    });
  },

  // 箇条書きの文字列（・＋2 空白インデント。複数行のアイテムは 2 行目以降を記号の後ろに揃える）
  toText(clips) {
    const out = [];
    const walk = (list, depth) => {
      const indent = ItemClipboard.INDENT.repeat(depth);
      for (const c of list) {
        const lines = c.text.split('\n');
        out.push(indent + ItemClipboard.BULLET + lines[0]);
        for (const line of lines.slice(1)) out.push(line ? indent + ItemClipboard.INDENT + line : '');
        walk(c.children, depth + 1);
      }
    };
    walk(clips, 0);
    return out.join('\n');
  },

  indentWidth(s) {
    let w = 0;
    for (const ch of s) w += ch === '\t' ? 4 : ch === '　' ? 2 : 1;
    return w;
  },

  // プレーンテキストを箇条書きとして解釈してクリップ形式にする
  //  - 行頭（インデント後）に記号がある行は新しいアイテム。後続の記号なしの行は改行を含めてそのアイテムの文字列（行頭の空白は除去）
  //  - 記号なしで始まるアイテムは、インデント量が変わった行で新しいアイテムに区切る
  //  - 罫線ツリー（├ └ など）・番号付き（1. / 1 / 1.2 / 1-2 / (1)）の行も記号付きの行と同様に扱う
  //  - 親子関係はインデント量で決め、同じインデントでは # 見出し ＞ その他、記号の連続数（- -- / # ## / 1 1.2）が多いほど深い
  parseText(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const roots = [];
    const stack = []; // { key: [indent, rank, run], node }
    let current = null;
    let currentHasSymbol = false;
    let currentIsTree = false;
    let lastIndent = 0;
    const less = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);
    const add = (key, body) => {
      while (stack.length && !less(stack[stack.length - 1].key, key)) stack.pop();
      const node = { text: body, children: [] };
      (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
      stack.push({ key, node });
      current = node;
    };

    for (const raw of lines) {
      const line = raw.replace(/[ \t　]+$/, '');
      const item = ItemClipboard.matchItemLine(line);
      if (item) {
        add(item.key, item.body);
        currentHasSymbol = true;
        currentIsTree = item.tree;
        lastIndent = item.key[0];
        continue;
      }
      // 罫線ツリーの続きの行は、前置きの縦線も除く（縦線だけの行は空行）
      if (current && currentIsTree) {
        current.text += '\n' + line.replace(ItemClipboard.TREE_RULE, '');
        continue;
      }
      if (line === '') {
        if (current) current.text += '\n';
        continue;
      }
      const lead = line.match(/^[ \t　]*/)[0];
      const indent = ItemClipboard.indentWidth(lead);
      const body = line.slice(lead.length);
      if (current && (currentHasSymbol || indent === lastIndent)) {
        current.text += '\n' + body;
      } else {
        add([indent, 1, 1], body);
        currentHasSymbol = false;
        currentIsTree = false;
      }
      lastIndent = indent;
    }

    const trim = (list) => {
      for (const c of list) {
        c.text = c.text.replace(/\n+$/, '');
        trim(c.children);
      }
    };
    trim(roots);
    return roots;
  },
};
