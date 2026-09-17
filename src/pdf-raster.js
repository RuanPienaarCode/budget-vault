'use strict';
/* The PDF's second backend: paint pdf.js's laid-out pages onto a canvas and
   hand back JPEGs for renderImagePdf().

   WHY IT EXISTS. A PDF written without a font engine can only name the fonts
   every reader already has — Helvetica, in WinAnsi — and WinAnsi has no
   Chinese, Japanese, Devanagari, Cyrillic or Arabic. This app ships in twelve
   languages and a category name is whatever the household typed, so "Latin
   only" would mean a 食费 row printing as a line of question marks in a
   document that otherwise looks finished. The browser, though, can already
   draw every one of those scripts: so when pdf.js's docEncodable() says no,
   the SAME layout is measured with the canvas's own metrics and painted here,
   and each page goes into the PDF as one image. The text is no longer
   selectable, and the file is larger — which is why this is the fallback and
   not the only path.

   JPEG, not PNG: canvas.toBlob('image/jpeg') output IS a valid /DCTDecode
   stream, byte for byte, so it drops into the PDF with no decoder or encoder
   in between. A PNG would have to be inflated and re-filtered by code this
   plugin would then have to carry.

   The one module in this feature that needs a DOM, kept apart from pdf.js so
   that one stays requirable in bare node. No Node APIs; toBlob + arrayBuffer
   are both on the iOS 15 floor. */

/* A system stack, not Helvetica: the whole point of this path is glyph
   coverage, and -apple-system / system-ui fall through to the platform's CJK
   and Indic faces where a named Latin font would stop at tofu. */
const FONT_STACK = '-apple-system, system-ui, "Segoe UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const fontCss = (font, sizePx) => `${font === 'bold' ? '600' : '400'} ${sizePx}px ${FONT_STACK}`;

/* 2 device pixels per point ≈ 144 dpi: legible when zoomed and printed, and an
   A4 page stays near 1200×1700 — comfortably inside iOS Safari's canvas area
   ceiling, which a 300 dpi page (2480×3508) is not on older phones. */
const SCALE = 2;
const JPEG_QUALITY = 0.9;

/* The measure() pdf.js's layoutDocument() is handed on this path. It must be
   the SAME font the painter below sets, at the same size, or right-aligned
   amounts are placed by one face's widths and drawn in another's — a column of
   figures whose right edge wanders by a digit. Measured at 1px-per-point on a
   scratch canvas; widths scale linearly, so the painter's 2× does not matter. */
function canvasMeasure(doc) {
  const ctx = (doc || document).createElement('canvas').getContext('2d');
  let current = '';
  return (text, font, size) => {
    const css = fontCss(font, size);
    if (css !== current) { ctx.font = css; current = css; }
    return ctx.measureText(String(text)).width;
  };
}

const grayCss = g => {
  const v = Math.round(255 * Math.max(0, Math.min(1, Number(g) || 0)));
  return `rgb(${v},${v},${v})`;
};

function paintPage(page, doc) {
  const canvas = (doc || document).createElement('canvas');
  canvas.width = Math.round(page.width * SCALE);
  canvas.height = Math.round(page.height * SCALE);
  const ctx = canvas.getContext('2d');
  /* White first. A canvas starts transparent and JPEG has no alpha, so an
     unpainted page encodes as solid BLACK with black text on it. */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';   // pdf.js's text ops carry a BASELINE y
  /* Rects before lines before text, whatever order layout emitted them in: a
     header band painted after its own label would bury it. */
  const order = { rect: 0, line: 1, text: 2 };
  const ops = page.ops.slice().sort((a, b) => order[a.op] - order[b.op]);
  for (const o of ops) {
    if (o.op === 'rect') {
      ctx.fillStyle = grayCss(o.gray);
      ctx.fillRect(o.x, o.y, o.w, o.h);
    } else if (o.op === 'line') {
      ctx.strokeStyle = grayCss(o.gray);
      ctx.lineWidth = o.width || 0.5;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
    } else if (o.op === 'text') {
      ctx.font = fontCss(o.font, o.size);
      ctx.fillStyle = grayCss(o.gray);
      ctx.fillText(o.text, o.x, o.y);
    }
  }
  return canvas;
}

function toJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('canvas.toBlob returned nothing'));
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject);
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

/* One page at a time, each canvas dropped before the next is made: a sixty-page
   "all periods" export held as sixty live 2-megapixel canvases is exactly the
   allocation iOS kills a WebView for. */
async function rasterisePages(pages, doc) {
  const images = [];
  for (const page of pages) {
    const canvas = paintPage(page, doc);
    images.push({ jpeg: await toJpeg(canvas), width: canvas.width, height: canvas.height });
    canvas.width = 0; canvas.height = 0;   // releases the backing store on WebKit
  }
  return images;
}

module.exports = { canvasMeasure, rasterisePages, FONT_STACK };
