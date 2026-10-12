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

  // 画面と同じ配置（折り畳み状態・フィルタを含む）から、SVG/PDF に描く図形を作る（[+][-] アイコンは描かない）
  scene(layout) {
    const C = Config;
    const connectors = [];
    const items = [];
    for (const node of layout.order) {
      for (const child of node.children) {
        if (child.placeholder) continue; // フィルタで隠したアイテムの [+] は描かない
        connectors.push({ x1: node.x + node.w, y1: node.y + node.h / 2, x2: child.x, y2: child.y + child.h / 2 });
      }
      // 文字は装飾の同じ区間ごと（座標はコンテンツ座標、y はベースライン）
      const segments = [];
      Renderer.eachSegment(node, (seg, x, baseline) => {
        segments.push({ text: node.text.slice(seg.start, seg.end), x, y: baseline, width: seg.width, style: seg.style });
      });
      const status = node.status && Object.assign({ x: node.x + C.paddingX, y: node.y + C.paddingY }, node.status);
      items.push({ x: node.x, y: node.y, w: node.w, h: node.h, fill: node.fill, status, segments });
    }
    return { width: Math.ceil(layout.width), height: Math.ceil(layout.height), connectors, items };
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
        `fill="${it.fill || col.itemFill}" stroke="${col.itemBorder}" stroke-width="1"/>`);
      const st = it.status;
      if (st) {
        const dash = st.orphan ? ` stroke="${C.statusOrphan.border}" stroke-width="1" stroke-dasharray="2 2"` : '';
        out.push(`<rect x="${st.x + 0.5}" y="${st.y + 0.5}" width="${st.w - 1}" height="${st.h - 1}" rx="${st.h / 2 - 0.5}" fill="${st.bg}"${dash}/>`);
        out.push(`<text x="${st.x + st.w / 2}" y="${st.y + st.h / 2 + C.statusFontSize * 0.35}" font-family="sans-serif" ` +
          `font-size="${C.statusFontSize}" font-weight="bold" text-anchor="middle" fill="${st.fg}">${esc(st.name)}</text>`);
      }
      // 文字背景 → 文字 → 下線・取消し線（CANVAS と同じ順・位置）
      for (const seg of it.segments) {
        if (!seg.style || !seg.style.bg) continue;
        const d = RichText.decoration(seg.style, seg.y);
        out.push(`<rect x="${seg.x}" y="${d.bgTop}" width="${seg.width}" height="${d.bgHeight}" fill="${seg.style.bg}"/>`);
      }
      for (const seg of it.segments) {
        const st = seg.style;
        if (seg.text.trim()) {
          const attrs = [`x="${seg.x}"`, `y="${seg.y}"`];
          if (st && st.size) attrs.push(`font-size="${st.size}"`);
          if (st && st.bold) attrs.push('font-weight="bold"');
          if (st && st.color) attrs.push(`fill="${st.color}"`);
          // 字幅が違う環境でも区間の幅に収める
          attrs.push(`textLength="${seg.width}"`, 'lengthAdjust="spacingAndGlyphs"');
          out.push(`<text ${attrs.join(' ')}>${esc(seg.text)}</text>`);
        }
        if (st && (st.underline || st.strike)) {
          const d = RichText.decoration(st, seg.y);
          const color = st.color || col.text;
          if (st.underline) out.push(`<rect x="${seg.x}" y="${Math.round(d.underlineY)}" width="${seg.width}" height="${d.thickness}" fill="${color}"/>`);
          if (st.strike) out.push(`<rect x="${seg.x}" y="${Math.round(d.strikeY)}" width="${seg.width}" height="${d.thickness}" fill="${color}"/>`);
        }
      }
    }
    out.push('</g>');
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
        Object.assign({ color: hex(it.fill || col.itemFill), borderColor: hex(col.itemBorder), borderWidth: k }, svgOpts));
      // 矩形（コンテンツ座標）を PDF の座標で塗る
      const fillRect = (x, y, w, h, color) => page.drawRectangle({ x: x * k, y: (H - y - h) * k, width: w * k, height: h * k, color: hex(color) });
      const st = it.status;
      if (st) {
        const opts = { color: hex(st.bg) };
        if (st.orphan) Object.assign(opts, { borderColor: hex(C.statusOrphan.border), borderWidth: k, borderDashArray: [2 * k, 2 * k] });
        page.drawSvgPath(FileExport.roundRectPath(st.x + 0.5, st.y + 0.5, st.w - 1, st.h - 1, st.h / 2 - 0.5), Object.assign(opts, svgOpts));
        let size = C.statusFontSize * k;
        const width = font.widthOfTextAtSize(st.name, size);
        const maxWidth = (st.w - C.statusPaddingX * 2) * k;
        if (width > maxWidth) size *= maxWidth / width;
        const textWidth = font.widthOfTextAtSize(st.name, size);
        const drawn = { x: (st.x + st.w / 2) * k - textWidth / 2, y: (H - st.y - st.h / 2 - C.statusFontSize * 0.35) * k, size, font, color: hex(st.fg) };
        page.drawText(st.name, drawn);
        page.drawText(st.name, Object.assign({}, drawn, { x: drawn.x + size * 0.04 }));
      }
      for (const seg of it.segments) {
        if (!seg.style || !seg.style.bg) continue;
        const d = RichText.decoration(seg.style, seg.y);
        fillRect(seg.x, d.bgTop, seg.width, d.bgHeight, seg.style.bg);
      }
      for (const seg of it.segments) {
        const st = seg.style;
        const color = (st && st.color) || col.text;
        if (seg.text.trim()) {
          let size = RichText.sizeOf(st) * k;
          // 画面のフォントと字幅が違っても区間の幅からはみ出さないよう、必要なら文字を縮める
          const maxWidth = seg.width * k;
          const width = font.widthOfTextAtSize(seg.text, size);
          if (width > maxWidth) size *= maxWidth / width;
          const opts = { x: seg.x * k, y: (H - seg.y) * k, size, font, color: hex(color) };
          page.drawText(seg.text, opts);
          // 埋め込みフォントに太字が無いため、少しずらして重ね描きする
          if (st && st.bold) page.drawText(seg.text, Object.assign({}, opts, { x: opts.x + size * 0.04 }));
        }
        if (st && (st.underline || st.strike)) {
          const d = RichText.decoration(st, seg.y);
          if (st.underline) fillRect(seg.x, Math.round(d.underlineY), seg.width, d.thickness, color);
          if (st.strike) fillRect(seg.x, Math.round(d.strikeY), seg.width, d.thickness, color);
        }
      }
    }
    return pdf.save();
  },
};
