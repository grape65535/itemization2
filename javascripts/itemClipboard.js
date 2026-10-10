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
  // 番号付き（1. / 1.text / 1 text / 1.2 text / 1-a. / B-C text / D.e. など、各区切りは数字か英字 1 文字、全角も可）。
  // 末尾が . なら後の空白は任意、. が無ければ空白必須。区切りの数が多いほど深い階層
  NUMBER_PATTERN: /^([ \t　]*)((?:[0-9０-９]+|[A-Za-zＡ-Ｚａ-ｚ])(?:[.．\-－](?:[0-9０-９]+|[A-Za-zＡ-Ｚａ-ｚ]))*)(?:([.．])(?![0-9０-９])[ \t　]*|[ \t　]+)(.*)$/,
  // 括弧で囲った番号付き（(1) text / (A) text / （１） text）。後の空白は必須
  PAREN_NUMBER_PATTERN: /^([ \t　]*)[(（](?:[0-9０-９]+|[A-Za-zＡ-Ｚａ-ｚ])[)）][ \t　]+(.*)$/,

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
      const segments = m[2].split(/[.．\-－]/);
      // 英字 1 文字＋空白だけ（"A text" / "I think"）は英文と区別できないため番号付きにしない
      const letterOnly = segments.length === 1 && !/[0-9０-９]/.test(segments[0]);
      if (!(letterOnly && !m[3])) {
        return { key: [ItemClipboard.indentWidth(m[1]), 1, segments.length], body: m[4], tree: false };
      }
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

  // CSV/TSV として解釈できればクリップ形式（各行を「1 列目 → 2 列目 → …」の親子の連なりにし、行同士は兄弟）を返す。
  // 条件: 2 行以上、全行の列数が一致し 2 列以上、改行を含む値は要素全体が "" で囲われている（TSV を優先して試す）
  parseTable(text) {
    for (const delimiter of ['\t', ',']) {
      const rows = ItemClipboard.parseDelimited(text, delimiter);
      if (!rows || rows.length < 2) continue;
      const columns = rows[0].length;
      if (columns < 2 || rows.some((r) => r.length !== columns)) continue;
      return rows.map((row) => {
        // 空のセルは飛ばして次の列をその子にする
        const cells = row.filter((cell) => cell !== '');
        let top = null;
        let parent = null;
        for (const cell of cells) {
          const node = { text: cell, children: [] };
          if (parent) parent.children.push(node);
          else top = node;
          parent = node;
        }
        return top;
      }).filter(Boolean);
    }
    return null;
  },

  // 区切り文字で分割した行の配列。区切り前後の空白は除く。"..." 内の区切り・改行・"" は値の一部。
  // 不正な形式（閉じられていない "、" の後ろに余計な文字）なら null。空行は無視する
  parseDelimited(text, delimiter) {
    const isSpace = (ch) => (ch === ' ' || ch === '\t' || ch === '\u3000') && ch !== delimiter;
    const rows = [];
    let row = [];
    let i = 0;
    const n = text.length;
    const endRow = () => {
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    };
    while (i <= n) {
      while (i < n && isSpace(text[i])) i++;
      let value = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) return null;
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              value += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          value += text[i++];
        }
        while (i < n && isSpace(text[i])) i++;
        if (i < n && text[i] !== delimiter && text[i] !== '\n') return null;
      } else {
        const start = i;
        while (i < n && text[i] !== delimiter && text[i] !== '\n') i++;
        value = text.slice(start, i).replace(/[ \t\u3000]+$/, '');
      }
      row.push(value);
      if (i >= n) {
        endRow();
        break;
      }
      if (text[i] === '\n') endRow();
      i++;
    }
    return rows;
  },

  // 番号付き箇条書き（1. / 1.1. …）。兄弟の番号の桁数が違っても文字列の開始位置が揃うよう番号の後ろを空白で埋める。
  // 子は親の文字列の開始位置からインデントする
  toNumbered(clips) {
    const out = [];
    const walk = (list, prefix, indent) => {
      if (list.length === 0) return;
      const labels = list.map((c, i) => prefix + (i + 1) + '.');
      const width = Math.max(...labels.map((l) => l.length)) + 1;
      const textIndent = indent + ' '.repeat(width);
      list.forEach((c, i) => {
        const lines = c.text.split('\n');
        out.push(indent + labels[i].padEnd(width) + lines[0]);
        for (const line of lines.slice(1)) out.push(line ? textIndent + line : '');
        walk(c.children, labels[i], textIndent);
      });
    };
    walk(clips, '', '');
    return out.join('\n');
  },

  // マークダウンの箇条書き（- ＋ 階層ごとに 2 空白）。複数行のアイテムは行末の 2 空白で改行を表す
  toMarkdown(clips) {
    const out = [];
    const walk = (list, depth) => {
      const indent = '  '.repeat(depth);
      for (const c of list) {
        const lines = c.text.split('\n');
        lines.forEach((line, i) => {
          const hardBreak = i < lines.length - 1 ? '  ' : '';
          out.push((i === 0 ? indent + '- ' : indent + '  ') + line + hardBreak);
        });
        walk(c.children, depth + 1);
      }
    };
    walk(clips, 0);
    return out.join('\n');
  },

  // tree コマンドの出力形式（子孫は ├── / └── と │ で表す）。
  // 最上位のアイテムが 1 つならそれを枝なしの先頭行にし、複数なら最上位のアイテムも枝で表す（区切りが曖昧にならないように）。
  // 複数行のアイテムの 2 行目以降は、そのアイテムの子と同じ前置きを付ける
  toTree(clips) {
    const out = [];
    const walk = (list, prefix) => {
      list.forEach((c, i) => {
        const last = i === list.length - 1;
        const childPrefix = prefix + (last ? '    ' : '│   ');
        const lines = c.text.split('\n');
        out.push(prefix + (last ? '└── ' : '├── ') + lines[0]);
        for (const line of lines.slice(1)) out.push(childPrefix + line);
        walk(c.children, childPrefix);
      });
    };
    if (clips.length === 1) {
      out.push(...clips[0].text.split('\n'));
      walk(clips[0].children, '');
    } else {
      walk(clips, '');
    }
    return out.map((line) => line.replace(/ +$/, '')).join('\n');
  },

  // CSV/TSV。ルートから末端までの経路ごとに 1 行（貼り付けの逆）。行ごとに列数は異なってよい
  toDelimited(clips, delimiter) {
    const rows = [];
    const walk = (c, path) => {
      const next = path.concat(c.text);
      if (c.children.length === 0) rows.push(next);
      else for (const child of c.children) walk(child, next);
    };
    for (const c of clips) walk(c, []);
    const quote = (v) => {
      const needs = v.includes(delimiter) || /["\n\r]/.test(v) || /^[ \t\u3000]|[ \t\u3000]$/.test(v);
      return needs ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return rows.map((row) => row.map(quote).join(delimiter)).join('\n');
  },

  indentWidth(s) {
    let w = 0;
    for (const ch of s) w += ch === '\t' ? 4 : ch === '　' ? 2 : 1;
    return w;
  },

  // プレーンテキストを箇条書きとして解釈してクリップ形式にする
  //  - 行頭（インデント後）に記号がある行は新しいアイテム。後続の記号なしの行は改行を含めてそのアイテムの文字列（行頭の空白は除去）
  //  - 記号なしで始まるアイテムは、インデント量が変わった行で新しいアイテムに区切る
  //  - 罫線ツリー（├ └ など）・番号付き（1. / 1 / 1.2 / 1-2 / 1-a. / (1) / (A)）の行も記号付きの行と同様に扱う
  //  - 親子関係はインデント量で決め、同じインデントでは # 見出し ＞ その他、記号の連続数（- -- / # ## / 1 1.2）が多いほど深い
  parseText(text) {
    text = text.replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    // 行頭の記号（箇条書き・番号・罫線）が無ければ、CSV/TSV として解釈できるか試す
    if (!lines.some((line) => ItemClipboard.matchItemLine(line))) {
      const table = ItemClipboard.parseTable(text);
      if (table) return table;
    }
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
