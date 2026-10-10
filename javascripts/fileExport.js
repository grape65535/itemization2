'use strict';

// ファイルの読み込み（JSON / SVG）と書き出し（JSON / SVG / PDF）
const FileExport = {
  SVG_METADATA_ID: 'itemization-data',
  PDF_SCRIPTS: [
    'javascripts/vendor/pdf-lib/pdf-lib.min.js',
    'javascripts/vendor/fontkit/fontkit.umd.min.js',
    'javascripts/vendor/ipafont/ipag-font.js',
  ],
  PDF_MAX_PAGE_SIZE: 14400, // PDF のページの最大寸法(pt)
  PX_TO_PT: 0.75,

  // ---- JSON ----

  // 「名前をつけて保存」の JSON（内部データ形式の文書から表示タブだけを切り出したもの）
  tabJson(tab) {
    return JSON.stringify({ format: Model.FORMAT, tabs: [tab] }, null, 2);
  },

  // 開いたファイルの内容から、追加するタブの配列（ID は振り直す）を返す。開けない形式なら null
  parseFile(text) {
    const body = text.replace(/^﻿/, '').trim();
    let json = null;
    if (body.startsWith('{')) json = body;
    else if (body.startsWith('<')) json = FileExport.svgMetadata(body);
    if (!json) return null;
    let raw;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      return null;
    }
    if (!raw || !Array.isArray(raw.tabs) || !raw.tabs.every((t) => t && t.root && typeof t.root === 'object')) return null;
    const doc = Model.normalize(raw);
    return doc ? doc.tabs.map((tab) => Model.reassignIds(tab)) : null;
  },

  svgMetadata(text) {
    const svg = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (svg.querySelector('parsererror') || svg.documentElement.nodeName.toLowerCase() !== 'svg') return null;
    const meta = svg.getElementById(FileExport.SVG_METADATA_ID) || svg.querySelector('metadata');
    return meta ? meta.textContent.trim() : null;
  },

  // ---- 保存（ダウンロード） ----

  fileName(title, ext) {
    const base = title.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim() || Config.newTabTitle;
    return base + ext;
  },

  download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  // ---- 描画内容 ----

  // 画面と同じ配置（折り畳み状態を含む）から、SVG/PDF に描く図形を作る
  scene(layout) {
    const C = Config;
    const connectors = [];
    const items = [];
    const toggles = [];
    for (const node of layout.order) {
      for (const child of node.children) {
        connectors.push({ x1: node.x + node.w, y1: node.y + node.h / 2, x2: child.x, y2: child.y + child.h / 2 });
      }
      items.push({
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        contentWidth: node.contentWidth,
        lines: node.lines.map((l) => node.text.slice(l.start, l.end)),
      });
      if (TreeLayout.isToggleVisible(node)) toggles.push(Object.assign({ collapsed: node.collapsed }, TreeLayout.toggleRect(node)));
    }
    return { width: Math.ceil(layout.width), height: Math.ceil(layout.height), connectors, items, toggles };
  },

  connectorPath(c) {
    if (c.y1 === c.y2) return `M ${c.x1} ${c.y1} L ${c.x2} ${c.y2}`;
    const mx = (c.x1 + c.x2) / 2;
    return `M ${c.x1} ${c.y1} C ${mx} ${c.y1} ${mx} ${c.y2} ${c.x2} ${c.y2}`;
  },

  roundRectPath(x, y, w, h, r) {
    return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} ` +
      `Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} ` +
      `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
  },

  togglePaths(t) {
    const cy = t.y + t.h / 2;
    const cx = t.x + t.w / 2;
    let d = `M ${t.x + 3} ${cy} L ${t.x + t.w - 3} ${cy}`;
    if (t.collapsed) d += ` M ${cx} ${t.y + 3} L ${cx} ${t.y + t.h - 3}`;
    return { box: `M ${t.x + 0.5} ${t.y + 0.5} h ${t.w - 1} v ${t.h - 1} h ${-(t.w - 1)} Z`, mark: d };
  },

  // 文字のベースライン（行の縦中央に合わせる）
  baselineY(item, lineIndex) {
    return item.y + Config.paddingY + lineIndex * Config.lineHeight + Config.lineHeight / 2 + Config.fontSize * 0.35;
  },

  // ---- SVG ----

  buildSvg(scene, json) {
    const C = Config;
    const col = Renderer.colors;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const W = scene.width;
    const H = scene.height;
    const out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      `<metadata id="${FileExport.SVG_METADATA_ID}">${esc(json)}</metadata>`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`,
      `<g fill="none" stroke="${col.connector}" stroke-width="1.5">`,
    ];
    for (const c of scene.connectors) out.push(`<path d="${FileExport.connectorPath(c)}"/>`);
    out.push('</g>');
    out.push(`<g font-family="${esc(C.fontFamily)}" font-size="${C.fontSize}" fill="${col.text}" xml:space="preserve">`);
    for (const it of scene.items) {
      out.push(`<rect x="${it.x + 0.5}" y="${it.y + 0.5}" width="${it.w - 1}" height="${it.h - 1}" rx="${C.cornerRadius}" ` +
        `fill="${col.itemFill}" stroke="${col.itemBorder}" stroke-width="1"/>`);
      it.lines.forEach((line, i) => {
        if (line) out.push(`<text x="${it.x + C.paddingX}" y="${FileExport.baselineY(it, i)}">${esc(line)}</text>`);
      });
    }
    out.push('</g>');
    for (const t of scene.toggles) {
      const p = FileExport.togglePaths(t);
      out.push(`<path d="${p.box}" fill="${col.toggleFill}" stroke="${col.toggleBorder}" stroke-width="1"/>`);
      out.push(`<path d="${p.mark}" fill="none" stroke="${col.toggleBorder}" stroke-width="1"/>`);
    }
    out.push('</svg>');
    return out.join('\n');
  },

  // ---- PDF ----

  loadScript(src) {
    FileExport.loaded = FileExport.loaded || new Map();
    if (!FileExport.loaded.has(src)) {
      FileExport.loaded.set(src, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${src}?v=${Config.version.replace(/^v/, '')}`;
        script.onload = resolve;
        script.onerror = () => {
          FileExport.loaded.delete(src);
          reject(new Error(`${src} を読み込めませんでした`));
        };
        document.head.append(script);
      }));
    }
    return FileExport.loaded.get(src);
  },

  // 同梱の IPAゴシック（gzip＋base64）を展開する
  async fontBytes() {
    if (!FileExport.fontCache) {
      const data = window.ItemizationFontData.ipag.gzipBase64;
      const bin = atob(data);
      const gz = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
      const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
      FileExport.fontCache = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return FileExport.fontCache;
  },

  // 1 ページに表示タブの内容を描いた PDF。文字は IPAゴシックをサブセット化して埋め込む
  async buildPdf(scene) {
    for (const src of FileExport.PDF_SCRIPTS) await FileExport.loadScript(src);
    const { PDFDocument, rgb } = window.PDFLib;
    const C = Config;
    const col = Renderer.colors;
    const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    const font = await pdf.embedFont(await FileExport.fontBytes(), { subset: true });

    const W = scene.width;
    const H = scene.height;
    const k = Math.min(FileExport.PX_TO_PT, FileExport.PDF_MAX_PAGE_SIZE / W, FileExport.PDF_MAX_PAGE_SIZE / H);
    const page = pdf.addPage([W * k, H * k]);
    // drawSvgPath は (x, y) を原点として SVG と同じ下向きの y 座標で描く
    const svgOpts = { x: 0, y: H * k, scale: k };

    page.drawRectangle({ x: 0, y: 0, width: W * k, height: H * k, color: rgb(1, 1, 1) });
    for (const c of scene.connectors) {
      page.drawSvgPath(FileExport.connectorPath(c), Object.assign({ borderColor: hex(col.connector), borderWidth: 1.5 * k }, svgOpts));
    }
    for (const it of scene.items) {
      page.drawSvgPath(FileExport.roundRectPath(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1, C.cornerRadius),
        Object.assign({ color: hex(col.itemFill), borderColor: hex(col.itemBorder), borderWidth: k }, svgOpts));
      it.lines.forEach((line, i) => {
        if (!line) return;
        let size = C.fontSize * k;
        // 画面のフォントと字幅が違っても枠からはみ出さないよう、必要なら文字を縮める
        const maxWidth = it.contentWidth * k;
        const width = font.widthOfTextAtSize(line, size);
        if (width > maxWidth) size *= maxWidth / width;
        page.drawText(line, { x: (it.x + C.paddingX) * k, y: (H - FileExport.baselineY(it, i)) * k, size, font, color: hex(col.text) });
      });
    }
    for (const t of scene.toggles) {
      const p = FileExport.togglePaths(t);
      page.drawSvgPath(p.box, Object.assign({ color: hex(col.toggleFill), borderColor: hex(col.toggleBorder), borderWidth: k }, svgOpts));
      page.drawSvgPath(p.mark, Object.assign({ borderColor: hex(col.toggleBorder), borderWidth: k }, svgOpts));
    }
    return pdf.save();
  },
};
