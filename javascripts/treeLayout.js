'use strict';

// アイテムツリーの配置計算。
// ルートを左上に置き、左→右（階層）、上→下（兄弟）へ広げる。
// 同じ階層のアイテムは左端を揃え、親は可視の子群（最初の子と最後の子の縦中央の中間）に縦中央を合わせる（タブの設定で上寄せも可）。
const TreeLayout = {
  // override: 文字入力中アイテムの { id, text, styles, fill, align }（未確定の内容で寸法を計算するため）
  // options: タブの設定（最大表示幅 maxWidth、親の縦位置 parentAlign）
  compute(root, measurer, override, options) {
    const C = Config;
    const maxWidth = (options && options.maxWidth) || C.maxContentWidth;
    const parentTop = !!options && options.parentAlign === 'top';
    const nodes = new Map();
    const order = []; // 可視アイテムの文書順
    const maxWidthByDepth = [];

    const measure = (item, depth, parentId) => {
      const src = override && override.id === item.id ? override : item;
      const text = src.text;
      const styles = src === item ? RichText.toArray(text, item.spans) : RichText.fit(src.styles, text.length);
      const lines = measurer.wrap(text, maxWidth, styles);
      let contentWidth = C.minContentWidth;
      for (const line of lines) contentWidth = Math.max(contentWidth, line.width);
      contentWidth = Math.ceil(contentWidth);
      // 行の縦位置と、寄せ方による横位置（文字領域の左端から）
      const align = src.align === 'center' || src.align === 'right' ? src.align : 'left';
      const factor = align === 'center' ? 0.5 : align === 'right' ? 1 : 0;
      let contentHeight = 0;
      for (const line of lines) {
        line.top = contentHeight;
        line.x = (contentWidth - line.width) * factor;
        contentHeight += line.height;
      }
      const node = {
        id: item.id,
        item,
        text,
        styles,
        lines,
        fill: src.fill || null,
        align,
        depth,
        parentId,
        contentWidth,
        w: contentWidth + C.paddingX * 2,
        h: contentHeight + C.paddingY * 2,
        x: 0,
        y: 0,
        hasChildren: item.children.length > 0,
        collapsed: !!item.collapsed,
        children: [],
      };
      nodes.set(item.id, node);
      order.push(node);
      maxWidthByDepth[depth] = Math.max(maxWidthByDepth[depth] || 0, node.w);
      if (!item.collapsed) {
        for (const child of item.children) node.children.push(measure(child, depth + 1, item.id));
      }
      return node;
    };
    const rootNode = measure(root, 0, null);

    const columnX = [C.margin];
    for (let d = 1; d < maxWidthByDepth.length; d++) {
      columnX[d] = columnX[d - 1] + maxWidthByDepth[d - 1] + C.horizontalGap;
    }

    // 部分木内での相対位置を求める
    const place = (node) => {
      node.x = columnX[node.depth];
      if (node.children.length === 0) {
        node.relTop = 0;
        node.childShift = 0;
        node.subtreeHeight = node.h;
        return;
      }
      let y = 0;
      for (const child of node.children) {
        place(child);
        child.subtreeTop = y;
        y += child.subtreeHeight + C.verticalGap;
      }
      const blockHeight = y - C.verticalGap;
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      const firstCenter = first.subtreeTop + first.relTop + first.h / 2;
      const lastCenter = last.subtreeTop + last.relTop + last.h / 2;
      // 中央寄せ: 最初と最後の子の縦中央の中間に縦中央を合わせる。上寄せ: 最初の子と上端を揃える
      let top = parentTop ? first.subtreeTop + first.relTop : Math.round((firstCenter + lastCenter) / 2 - node.h / 2);
      let shift = 0;
      if (top < 0) {
        shift = -top;
        top = 0;
      }
      node.relTop = top;
      node.childShift = shift;
      node.subtreeHeight = Math.max(top + node.h, blockHeight + shift);
    };
    const assign = (node, top) => {
      node.y = top + node.relTop;
      for (const child of node.children) assign(child, top + node.childShift + child.subtreeTop);
    };
    place(rootNode);
    assign(rootNode, C.margin);

    let width = 0;
    for (const node of order) width = Math.max(width, node.x + node.w);
    return {
      root: rootNode,
      nodes,
      order,
      width: width + C.toggleSize + C.margin,
      height: C.margin * 2 + rootNode.subtreeHeight,
    };
  },

  // 表示行の番号（文字領域の上端からの y 座標で。範囲外は最初・最後の行）
  lineIndexAtY(node, y) {
    for (let i = node.lines.length - 1; i > 0; i--) {
      if (y >= node.lines[i].top) return i;
    }
    return 0;
  },

  // [+][-] アイコンを表示するか（子があれば文字入力・選択状態に関係なく常に表示）
  isToggleVisible(node) {
    return node.hasChildren;
  },

  // アイテム外の右端、子への関係線のすぐ上（関係線から 5px 上）
  toggleRect(node) {
    const s = Config.toggleSize;
    return { x: node.x + node.w + 3, y: node.y + node.h / 2 - s - 5, w: s, h: s };
  },
};
