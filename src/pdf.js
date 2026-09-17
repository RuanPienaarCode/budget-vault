'use strict';
/* pdf.js — a PDF-1.4 writer with no dependency, because src/exporter.js's own
   header already explains why one was refused: the smallest credible PDF
   library is ~350KB against a 410KB main.js, an 85% bundle increase to draw
   a table. That refusal did not change; what changed is the shape of the
   ask — a PRINTABLE report, not "open this markdown in a text PDF app" —
   so the answer here is to hand-write the ~200 lines of PDF-1.4 structure a
   report actually needs (a few Type1 base-14 font refs, some text and rect
   operators, one xref table) rather than pull in a library built to also
   handle embedded fonts, images, forms and encryption this plugin will
   never use.

   TWO BACKENDS, ONE LAYOUT. A base-14 Helvetica has no glyph outside
   WinAnsiEncoding (cp1252) — so a Chinese or Cyrillic category name cannot
   be drawn as vector text without embedding a font, which is exactly the
   bundle-size cost this module exists to avoid. `docEncodable` decides once,
   the caller rasterises the page with a real font via canvas when it fails,
   and `renderImagePdf` just wraps whatever JPEG bytes the canvas produced —
   `canvas.toBlob('image/jpeg')` output IS a valid DCTDecode stream, so that
   path needs no encoder either. `layoutDocument` never knows which backend
   it's feeding: it takes `measure` as a parameter so the vector path can
   pass `helveticaMeasure` and the raster path can pass a
   `ctx.measureText`-based function, and it must never reach for
   `helveticaMeasure` itself — a canvas-backed page laid out with Helvetica's
   metrics would wrap and truncate in the wrong places the moment the actual
   paint font differs even slightly.

   normalizeText runs BEFORE the encodability check for a concrete reason:
   `Intl.NumberFormat('en-ZA', {style:'currency', currency:'ZAR'})` prints
   "R 1 234,56" with a U+00A0 NO-BREAK SPACE as the thousands gap (not
   U+0020), and fr-FR uses U+202F NARROW NO-BREAK SPACE for the same job.
   Neither byte exists in WinAnsi. Skip the normalize step and EVERY money
   figure in EVERY currency this app formats sends its export to the raster
   path — the exact failure this module exists to prevent, silently, with
   nothing in the file announcing why a plain rand amount produced a raster
   page.

   AFM WIDTHS: the two width tables below are Adobe's Core-14 metrics for
   Helvetica and Helvetica-Bold, EncodingScheme WinAnsiEncoding, read
   character-by-character off two independent on-disk copies of the real
   .afm files (dompdf ships them, vendored under two unrelated Herd projects
   on this machine — ~/Herd/jg-forms-main and ~/Herd/Pienaar-Empire — parsed
   separately and diffed byte-for-byte identical before either was trusted).
   No value here was typed from memory. The five WinAnsi codes with no glyph
   at all (0x81, 0x8D, 0x8F, 0x90, 0x9D) are exactly the five the AFM files
   have no `C` entry for — that agreement is itself part of the proof, not a
   coincidence pasted over.

   Uncompressed content streams: no deflate exists in this module because
   deflating without a dependency means hand-rolling zlib, and a text PDF is
   tiny anyway — the tables this app actually exports (a household's
   transactions, a year of budgets) run to a few KB uncompressed, nowhere
   near where stream compression would matter.

   Built as raw bytes (a plain JS array of 0-255 values, turned into a
   Uint8Array once at the end), never as a JS string pushed through
   TextEncoder. TextEncoder is UTF-8; a cp1252 byte like 0xE9 (é) is not a
   valid UTF-8 lead byte on its own, so encoding a WinAnsi string through it
   would corrupt every accented character AND, because the corruption
   changes byte lengths, shift every xref offset written after it — two
   independent failures from one wrong call.

   Pure — no DOM, no `require('obsidian')`, no Node/Electron API. `Uint8Array`
   is a plain JS type; nothing here needs Buffer. `created` (a timestamp) is
   injected because a bare-node guard test needs the SAME PDF bytes back on
   every run — `new Date()` inside this module would make the /CreationDate
   field, and therefore the whole file, different every time it runs. */

/* -------------------------------------------------------------------------
   Page sizes, in points (1/72 inch) — PDF's native unit, and the unit every
   coordinate in this module is expressed in. */
const PAGE = {
  A4: { width: 595.28, height: 841.89 },
  A4_LANDSCAPE: { width: 841.89, height: 595.28 },
};

/* -------------------------------------------------------------------------
   WinAnsiEncoding (cp1252). Verified against the real AFM files: for every
   byte 0x20-0xFF except the five undefined slots, `EncodingScheme
   WinAnsiEncoding` in the AFM means the `C` code IS the output byte — no
   separate glyph-name indirection to get wrong. The only bytes that are NOT
   "byte value equals Unicode code point" are 0x80-0x9F (Windows' C1-control
   override block); everything else, ASCII and Latin-1 supplement alike,
   maps straight through. */
const WINANSI_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function winAnsiByte(cp) {
  if (WINANSI_HIGH.has(cp)) return WINANSI_HIGH.get(cp);
  if (cp >= 0x20 && cp <= 0x7e) return cp; // ASCII (0x7f DEL has no AFM entry, correctly excluded)
  if (cp >= 0xa0 && cp <= 0xff) return cp; // Latin-1 supplement, straight through
  return -1;
}

/* Characters a real locale formatter emits that LOOK like their ASCII
   twin and are not. Mapped to the twin BEFORE any encodability check, so a
   plain rand or euro figure never trips the raster fallback over an
   invisible byte. See the module header for the ZAR/fr-FR evidence. */
const SPACE_LIKE = new Set([0x00a0, 0x202f, 0x2009, 0x2007]);
function normalizeText(str) {
  if (str == null) return '';
  let out = '';
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (SPACE_LIKE.has(cp) || cp === 0x09 || cp === 0x0a || cp === 0x0d) { out += ' '; continue; }
    if (cp === 0x2212 || cp === 0x2011) { out += '-'; continue; } // minus sign, non-breaking hyphen
    if (cp <= 0x1f || cp === 0x7f) continue; // strip other C0 controls / DEL, not replace
    out += ch;
  }
  return out;
}

function canEncode(str) {
  const s = normalizeText(str);
  if (!s) return false; // empty (or nothing left after stripping) is not a printable encodable string
  for (const ch of s) {
    if (winAnsiByte(ch.codePointAt(0)) === -1) return false;
  }
  return true;
}

function blockStrings(block) {
  const out = [];
  if (!block) return out;
  if (block.type === 'heading' || block.type === 'note') out.push(block.text);
  if (block.type === 'table') {
    if (block.head) out.push(...block.head);
    if (block.rows) for (const row of block.rows) out.push(...row);
  }
  return out;
}

/* Empty fields are skipped rather than forced through canEncode's own
   empty-string === false rule: a doc with no subtitle must not be pushed to
   the raster path for lacking one. "Every string is encodable" is checked
   over the strings the document actually holds. */
function docEncodable(doc) {
  const strs = [doc.title, doc.subtitle, doc.footer]
    .concat((doc.blocks || []).reduce((a, b) => a.concat(blockStrings(b)), []))
    .filter(s => s != null && s !== '');
  return strs.every(canEncode);
}

/* -------------------------------------------------------------------------
   Adobe Core-14 AFM widths (1/1000 em), WinAnsi byte order, codes 32-255.
   Index [byte - 32]. The five undefined WinAnsi bytes (0x81 0x8D 0x8F 0x90
   0x9D) carry 0 — they can never reach here because canEncode/winAnsiByte
   already refuse them; 0 is a deliberate "this should not be measured", not
   a real advance width. Source: see module header. */
/* eslint-disable */
const HELVETICA_WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const HELVETICA_BOLD_WIDTHS = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
/* eslint-enable */

function helveticaMeasure(text, font, size) {
  const s = normalizeText(text);
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const ch of s) {
    const b = winAnsiByte(ch.codePointAt(0));
    total += (b === -1) ? 0 : (table[b - 32] || 0);
  }
  return total * size / 1000;
}

/* -------------------------------------------------------------------------
   Layout. Coordinates are TOP-LEFT origin, y DOWN, in points — canvas-
   native, so the raster backend can paint an Op list with no coordinate
   translation of its own. renderVectorPdf is the one place that flips y,
   because PDF content streams are y-up from the bottom-left. */
const MARGIN = 40;
const CELL_PAD = 4;
const MIN_TEXT_COL = 20;
const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 9;
const FOOTER_SIZE = 8;
const HEADING_SIZE = 12;
const NOTE_SIZE = 9;
const FOOTER_BAND = 24;
const TABLE_FONT_START = 9;
const TABLE_FONT_FLOOR = 6;

function defaultPageLabel(n, m) { return `Page ${n} of ${m}`; }

function layoutDocument(doc, opts) {
  opts = opts || {};
  const measure = opts.measure;
  const pageDims = opts.page || PAGE.A4;
  const pageLabel = opts.pageLabel || defaultPageLabel;
  const contentLeft = MARGIN;
  const contentRight = pageDims.width - MARGIN;
  const contentWidth = contentRight - contentLeft;
  const contentBottom = pageDims.height - MARGIN - FOOTER_BAND;

  const pages = [];
  let cur = null;
  let y = MARGIN;
  function newPage() {
    cur = { width: pageDims.width, height: pageDims.height, ops: [] };
    pages.push(cur);
    y = MARGIN;
  }
  newPage();

  /* ---- table planning: font size + column widths, computed once per
     table and cached so the heading keep-with-next lookahead and the
     actual render agree on how much room the table will need. ---- */
  const plans = new Map();
  function headH(size) { return size * 1.9 + 4; }
  function rowH(size) { return size * 1.7 + 4; }

  function naturalColWidths(head, rows, align, size) {
    const n = head.length;
    const nat = new Array(n).fill(0);
    for (let c = 0; c < n; c++) {
      nat[c] = measure(head[c] == null ? '' : String(head[c]), 'bold', size) + CELL_PAD * 2;
    }
    for (const row of rows) {
      for (let c = 0; c < n; c++) {
        const cell = row[c] == null ? '' : String(row[c]);
        const w = measure(cell, 'regular', size) + CELL_PAD * 2;
        if (w > nat[c]) nat[c] = w;
      }
    }
    return nat;
  }

  function computeColWidths(head, rows, align, weights, size) {
    const n = head.length;
    if (weights && weights.length === n) {
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      return weights.map(w => contentWidth * w / total);
    }
    const natural = naturalColWidths(head, rows, align, size);
    const total = natural.reduce((a, b) => a + b, 0);
    if (total <= contentWidth) {
      if (total === 0) return natural;
      const extra = contentWidth - total;
      return natural.map(w => w + extra * (w / total));
    }
    const numericIdx = [], textIdx = [];
    for (let c = 0; c < n; c++) (align[c] === 'right' ? numericIdx : textIdx).push(c);
    const numericTotal = numericIdx.reduce((s, c) => s + natural[c], 0);
    const textTotal = textIdx.reduce((s, c) => s + natural[c], 0);
    const widths = natural.slice();
    if (textIdx.length) {
      const available = Math.max(0, contentWidth - numericTotal);
      const scale = textTotal > 0 ? available / textTotal : 0;
      for (const c of textIdx) widths[c] = Math.max(MIN_TEXT_COL, natural[c] * scale);
      // The MIN_TEXT_COL floor can itself push the total back over budget —
      // never claw that back from a numeric column (it must never truncate),
      // so squeeze the text columns a second time instead.
      const sumNow = widths.reduce((a, b) => a + b, 0);
      if (sumNow > contentWidth) {
        const textNow = textIdx.reduce((s, c) => s + widths[c], 0);
        const budget = Math.max(0, contentWidth - numericTotal);
        const scale2 = textNow > 0 ? budget / textNow : 0;
        for (const c of textIdx) widths[c] = widths[c] * scale2;
      }
    }
    return widths;
  }

  /* Used only by the WEIGHTS path, where a column's width is fixed by the
     caller and does not move with font size — so "does it fit" is a real
     question there. In the no-weights path this predicate would be
     tautological: colWidths there is DERIVED from these same per-cell
     measurements (see computeColWidths), so a numeric column always
     "fits" the width that was sized to fit it, at ANY font, and the
     step-down loop below would never fire — which is the bug
     numericNaturalTotal exists to avoid. */
  function numericFits(head, rows, align, colWidths, size, boldRows) {
    for (let c = 0; c < head.length; c++) {
      if (align[c] !== 'right') continue;
      if (measure(String(head[c] == null ? '' : head[c]), 'bold', size) + CELL_PAD * 2 > colWidths[c] + 0.01) return false;
      for (let r = 0; r < rows.length; r++) {
        const cell = rows[r][c] == null ? '' : String(rows[r][c]);
        const font = boldRows.has(r) ? 'bold' : 'regular';
        if (measure(cell, font, size) + CELL_PAD * 2 > colWidths[c] + 0.01) return false;
      }
    }
    return true;
  }

  /* The real "does this font size work" question for the no-weights path:
     NUMERIC columns alone must fit the page, because they can never give
     ground. A left-aligned text column never blocks a font choice — it
     absorbs whatever is left over, truncated with an ellipsis by
     computeColWidths/fitCell if it must. Summing natural TEXT width in here
     too would shrink the font on an ordinary 6-column budget table just
     because one category name is long, when truncating that one cell at
     size 9 was always the right answer. */
  function numericNaturalTotal(head, rows, align, size) {
    const natural = naturalColWidths(head, rows, align, size);
    let sum = 0;
    for (let c = 0; c < align.length; c++) if (align[c] === 'right') sum += natural[c];
    return sum;
  }

  function planTable(block) {
    if (plans.has(block)) return plans.get(block);
    const head = (block.head || []).map(h => normalizeText(h));
    const rows = (block.rows || []).map(row => row.map(cell => normalizeText(cell == null ? '' : String(cell))));
    const align = block.align || head.map(() => 'left');
    const boldRows = new Set(block.boldRows || []);
    const weights = block.weights;
    function fitsAtSize(sz) {
      if (weights && weights.length === head.length) {
        return numericFits(head, rows, align, computeColWidths(head, rows, align, weights, sz), sz, boldRows);
      }
      return numericNaturalTotal(head, rows, align, sz) <= contentWidth;
    }
    let size = TABLE_FONT_START;
    while (size > TABLE_FONT_FLOOR && !fitsAtSize(size)) size--;
    const colWidths = computeColWidths(head, rows, align, weights, size);
    const plan = { head, rows, align, colWidths, size, boldRows };
    plans.set(block, plan);
    return plan;
  }

  function fitCell(text, colW, size, isRight, font) {
    const avail = colW - CELL_PAD * 2;
    if (isRight) return text; // guaranteed to fit — numeric cells are never truncated
    if (measure(text, font, size) <= avail) return text;
    const ell = '…';
    for (let n = text.length; n >= 0; n--) {
      const cand = text.slice(0, n) + ell;
      if (measure(cand, font, size) <= avail) return cand;
    }
    return ell;
  }

  function drawCell(text, cx, cy, w, h, font, size, align) {
    const tw = measure(text, font, size);
    const x = align === 'right' ? cx + w - CELL_PAD - tw : cx + CELL_PAD;
    const baseline = cy + h - 4;
    cur.ops.push({ op: 'text', x, y: baseline, text, font, size });
  }

  function drawHeaderRow(plan) {
    const h = headH(plan.size);
    cur.ops.push({ op: 'rect', x: contentLeft, y, w: contentWidth, h, gray: 0.85 });
    let cx = contentLeft;
    for (let c = 0; c < plan.head.length; c++) {
      drawCell(String(plan.head[c] || ''), cx, y, plan.colWidths[c], h, 'bold', plan.size, plan.align[c]);
      cx += plan.colWidths[c];
    }
    cur.ops.push({ op: 'line', x1: contentLeft, y1: y + h, x2: contentLeft + contentWidth, y2: y + h, width: 0.75, gray: 0.3 });
    y += h;
  }

  function tableMinRoom(block) {
    const plan = planTable(block);
    return headH(plan.size) + rowH(plan.size) * Math.min(2, Math.max(1, plan.rows.length));
  }

  function layoutTable(block) {
    const plan = planTable(block);
    const rH = rowH(plan.size);
    if (y + headH(plan.size) + rH > contentBottom) newPage();
    drawHeaderRow(plan);
    for (let r = 0; r < plan.rows.length; r++) {
      if (y + rH > contentBottom) { newPage(); drawHeaderRow(plan); }
      const isBold = plan.boldRows.has(r);
      if (isBold) {
        cur.ops.push({ op: 'line', x1: contentLeft, y1: y, x2: contentLeft + contentWidth, y2: y, width: 0.75, gray: 0.3 });
      } else if (r % 2 === 1) {
        cur.ops.push({ op: 'rect', x: contentLeft, y, w: contentWidth, h: rH, gray: 0.965 });
      }
      let cx = contentLeft;
      for (let c = 0; c < plan.head.length; c++) {
        const raw = plan.rows[r][c] == null ? '' : plan.rows[r][c];
        const font = isBold ? 'bold' : 'regular';
        const text = fitCell(raw, plan.colWidths[c], plan.size, plan.align[c] === 'right', font);
        drawCell(text, cx, y, plan.colWidths[c], rH, font, plan.size, plan.align[c]);
        cx += plan.colWidths[c];
      }
      y += rH;
    }
    y += 10;
  }

  /* A heading keeps with what it heads — and that is not always the very next
     block. budget-export.js puts a one-line note (the period's income and
     spend) BETWEEN a period's heading and its table, and looking one block
     ahead saw "a note, not a table" and reserved nothing: the first rendered
     export stranded "May 2026" and its income line at the foot of page 2 with
     the table they introduce at the top of page 3. So the lookahead walks
     through any run of notes, adding each one's real wrapped height, until it
     reaches the table (whose minimum room is header + two rows) or anything
     else. */
  function layoutHeading(text, following) {
    const h = HEADING_SIZE * 1.9;
    let needed = h + 4;
    for (const next of following || []) {
      if (next && next.type === 'note') { needed += noteHeight(wrapNote(next.text)); continue; }
      if (next && next.type === 'table') needed += tableMinRoom(next);
      break;
    }
    if (y + needed > contentBottom) newPage();
    cur.ops.push({ op: 'text', x: contentLeft, y: y + HEADING_SIZE * 0.85, text: normalizeText(text), font: 'bold', size: HEADING_SIZE });
    y += h + 4;
  }

  function wrapNote(text) {
    const norm = normalizeText(text);
    const words = norm.split(' ').filter(w => w.length > 0);
    const lines = [];
    let line = '';
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (measure(cand, 'regular', NOTE_SIZE) <= contentWidth) { line = cand; continue; }
      if (line) lines.push(line);
      if (measure(w, 'regular', NOTE_SIZE) > contentWidth) {
        let piece = '';
        for (const ch of w) {
          const cand2 = piece + ch;
          if (piece && measure(cand2, 'regular', NOTE_SIZE) > contentWidth) { lines.push(piece); piece = ch; }
          else piece = cand2;
        }
        line = piece;
      } else {
        line = w;
      }
    }
    if (line) lines.push(line);
    if (!lines.length) lines.push('');
    return lines;
  }

  /* One rule for a note's height, read by the painter below AND by the
     heading lookahead above — a lookahead that estimated would reserve a
     different room from the one the note then takes. */
  const NOTE_LINE_H = NOTE_SIZE * 1.5;
  const NOTE_GAP = 6;
  function noteHeight(lines) { return lines.length * NOTE_LINE_H + NOTE_GAP; }

  function layoutNote(text) {
    const lines = wrapNote(text);
    const lineH = NOTE_LINE_H;
    for (const l of lines) {
      if (y + lineH > contentBottom) newPage();
      cur.ops.push({ op: 'text', x: contentLeft, y: y + NOTE_SIZE * 0.85, text: l, font: 'regular', size: NOTE_SIZE, gray: 0.4 });
      y += lineH;
    }
    y += NOTE_GAP;
  }

  // Title + subtitle, page 1 only.
  cur.ops.push({ op: 'text', x: contentLeft, y: y + TITLE_SIZE * 0.85, text: normalizeText(doc.title || ''), font: 'bold', size: TITLE_SIZE });
  y += TITLE_SIZE * 1.3;
  if (doc.subtitle) {
    cur.ops.push({ op: 'text', x: contentLeft, y: y + SUBTITLE_SIZE * 0.85, text: normalizeText(doc.subtitle), font: 'regular', size: SUBTITLE_SIZE, gray: 0.45 });
    y += SUBTITLE_SIZE * 1.6;
  }
  y += 10;

  const blocks = doc.blocks || [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'pagebreak') { newPage(); continue; }
    if (b.type === 'heading') { layoutHeading(b.text, blocks.slice(i + 1)); continue; }
    if (b.type === 'note') { layoutNote(b.text); continue; }
    if (b.type === 'table') { layoutTable(b); continue; }
  }

  // Footer, every page, appended after pagination so "Page N of M" can name
  // the real total.
  const total = pages.length;
  pages.forEach((p, idx) => {
    const n = idx + 1;
    const baseline = p.height - MARGIN - 6;
    if (doc.footer) {
      p.ops.push({ op: 'text', x: contentLeft, y: baseline, text: normalizeText(doc.footer), font: 'regular', size: FOOTER_SIZE, gray: 0.5 });
    }
    const label = pageLabel(n, total);
    const labelW = measure(label, 'regular', FOOTER_SIZE);
    p.ops.push({ op: 'text', x: contentRight - labelW, y: baseline, text: label, font: 'regular', size: FOOTER_SIZE, gray: 0.5 });
  });

  return pages;
}

/* -------------------------------------------------------------------------
   Byte-level PDF assembly, shared by both backends. */
class ByteBuf {
  constructor() { this._b = []; }
  ascii(str) { for (let i = 0; i < str.length; i++) this._b.push(str.charCodeAt(i) & 0xff); return this; }
  bytes(arr) { for (let i = 0; i < arr.length; i++) this._b.push(arr[i]); return this; }
  get length() { return this._b.length; }
  toUint8Array() { return new Uint8Array(this._b); }
}
function asciiBytes(str) { return new ByteBuf().ascii(str).toUint8Array(); }

/* Numbers in content streams and dict values: fixed decimals, never
   exponent notation (`1e-7` is a syntax error in PDF, not just ugly), never
   NaN — a stray NaN here would silently write the literal text "NaN" into a
   position operator and corrupt every op after it in that content stream. */
function fmtNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) n = 0;
  let v = Math.round(n * 1000) / 1000;
  if (Object.is(v, -0)) v = 0;
  let s = v.toFixed(3);
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-' ? '0' : s;
}

function winAnsiBytesEscaped(str) {
  const out = [];
  for (const ch of normalizeText(str)) {
    const b = winAnsiByte(ch.codePointAt(0));
    const byte = b === -1 ? 0x3f : b; // should never hit -1 on the vector path — docEncodable gates it
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) out.push(0x5c);
    out.push(byte);
  }
  return out;
}

function bytesToHex(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
  return s;
}

/* An Info string that cannot be written as WinAnsi (the raster path exists
   precisely because a title can be, say, Chinese) falls back to a UTF-16BE
   hex string with a BOM — the one string encoding the PDF spec defines for
   exactly this case, so the metadata survives even when the page content is
   a raster image because the text could not be drawn as vector glyphs. */
function utf16beHexBytes(str) {
  const units = [];
  for (const ch of String(str || '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const c = cp - 0x10000;
      units.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else {
      units.push(cp);
    }
  }
  const bytes = [0xfe, 0xff];
  for (const u of units) { bytes.push((u >> 8) & 0xff, u & 0xff); }
  return bytes;
}

function writeInfoField(buf, key, value) {
  buf.ascii(key + ' ');
  const s = String(value || '');
  if (!s) { buf.ascii('()'); return; }
  if (canEncode(s)) {
    buf.ascii('(');
    buf.bytes(winAnsiBytesEscaped(s));
    buf.ascii(')');
  } else {
    buf.ascii('<' + bytesToHex(utf16beHexBytes(s)) + '>');
  }
}

function pdfDateFromInjected(created) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(created || ''));
  if (!m) return 'D:19700101000000';
  return `D:${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}00`;
}

/* Header + object table + xref + trailer, identical between the vector and
   image backends — only how the page bodies (`objs[pageNum..]`) are built
   differs between them. */
function assemblePdf(objs, totalObjs, rootNum, infoNum) {
  const file = new ByteBuf();
  file.ascii('%PDF-1.4\n');
  file.ascii('%').bytes([0xe2, 0xe3, 0xcf, 0xd3]).ascii('\n');

  const offsets = new Array(totalObjs + 1).fill(0);
  for (let num = 1; num <= totalObjs; num++) {
    offsets[num] = file.length;
    file.ascii(`${num} 0 obj\n`);
    file.bytes(objs[num]);
    file.ascii('\nendobj\n');
  }
  const xrefOffset = file.length;
  file.ascii(`xref\n0 ${totalObjs + 1}\n`);
  file.ascii('0000000000 65535 f \n');
  for (let num = 1; num <= totalObjs; num++) {
    file.ascii(`${String(offsets[num]).padStart(10, '0')} 00000 n \n`);
  }
  file.ascii(`trailer\n<< /Size ${totalObjs + 1} /Root ${rootNum} 0 R /Info ${infoNum} 0 R >>\n`);
  file.ascii(`startxref\n${xrefOffset}\n%%EOF`);
  return file.toUint8Array();
}

function buildContentStream(page) {
  const buf = new ByteBuf();
  for (const op of page.ops) {
    if (op.op === 'text') {
      const gray = op.gray != null ? op.gray : 0;
      buf.ascii(`${fmtNum(gray)} g\nBT\n/${op.font === 'bold' ? 'F2' : 'F1'} ${fmtNum(op.size)} Tf\n`);
      buf.ascii(`${fmtNum(op.x)} ${fmtNum(page.height - op.y)} Td\n(`);
      buf.bytes(winAnsiBytesEscaped(op.text));
      buf.ascii(') Tj\nET\n');
    } else if (op.op === 'line') {
      const gray = op.gray != null ? op.gray : 0;
      buf.ascii(`${fmtNum(gray)} G\n${fmtNum(op.width || 1)} w\n`);
      buf.ascii(`${fmtNum(op.x1)} ${fmtNum(page.height - op.y1)} m\n`);
      buf.ascii(`${fmtNum(op.x2)} ${fmtNum(page.height - op.y2)} l\nS\n`);
    } else if (op.op === 'rect') {
      const gray = op.gray != null ? op.gray : 0.85;
      buf.ascii(`${fmtNum(gray)} g\n`);
      buf.ascii(`${fmtNum(op.x)} ${fmtNum(page.height - op.y - op.h)} ${fmtNum(op.w)} ${fmtNum(op.h)} re\nf\n`);
    }
  }
  return buf.toUint8Array();
}

function renderVectorPdf(pages, opts) {
  opts = opts || {};
  const meta = opts.meta || {};
  const list = (pages && pages.length) ? pages : [{ width: PAGE.A4.width, height: PAGE.A4.height, ops: [] }];
  const n = list.length;
  const CATALOG = 1, PAGES = 2, F_REG = 3, F_BOLD = 4, INFO = 5;
  const pageNum = i => 6 + i * 2;
  const contentNum = i => 6 + i * 2 + 1;
  const totalObjs = 5 + n * 2;
  const objs = new Array(totalObjs + 1);

  objs[CATALOG] = asciiBytes(`<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${pageNum(i)} 0 R`);
  objs[PAGES] = asciiBytes(`<< /Type /Pages /Kids [ ${kids.join(' ')} ] /Count ${n} >>`);
  objs[F_REG] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs[F_BOLD] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const infoBuf = new ByteBuf();
  infoBuf.ascii('<< ');
  writeInfoField(infoBuf, '/Title', meta.title || '');
  infoBuf.ascii(' ');
  writeInfoField(infoBuf, '/Producer', meta.producer || 'budget-vault');
  infoBuf.ascii(` /CreationDate (${pdfDateFromInjected(meta.created)}) >>`);
  objs[INFO] = infoBuf.toUint8Array();

  for (let i = 0; i < n; i++) {
    const pg = list[i];
    const content = buildContentStream(pg);
    const contentObj = new ByteBuf();
    contentObj.ascii(`<< /Length ${content.length} >>\nstream\n`);
    contentObj.bytes(content);
    contentObj.ascii('\nendstream');
    objs[contentNum(i)] = contentObj.toUint8Array();

    objs[pageNum(i)] = asciiBytes(
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${fmtNum(pg.width)} ${fmtNum(pg.height)}] ` +
      `/Resources << /Font << /F1 ${F_REG} 0 R /F2 ${F_BOLD} 0 R >> >> /Contents ${contentNum(i)} 0 R >>`
    );
  }

  return assemblePdf(objs, totalObjs, CATALOG, INFO);
}

function renderImagePdf(images, opts) {
  opts = opts || {};
  const pageDims = opts.page || PAGE.A4;
  const meta = opts.meta || {};
  const list = images || [];
  const n = list.length;
  const CATALOG = 1, PAGES = 2, INFO = 3;
  const imgNum = i => 4 + i * 3;
  const contentNum = i => 4 + i * 3 + 1;
  const pageNum = i => 4 + i * 3 + 2;
  const totalObjs = 3 + n * 3;
  const objs = new Array(totalObjs + 1);

  objs[CATALOG] = asciiBytes(`<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${pageNum(i)} 0 R`);
  objs[PAGES] = asciiBytes(`<< /Type /Pages /Kids [ ${kids.join(' ')} ] /Count ${n} >>`);

  const infoBuf = new ByteBuf();
  infoBuf.ascii('<< ');
  writeInfoField(infoBuf, '/Title', meta.title || '');
  infoBuf.ascii(' ');
  writeInfoField(infoBuf, '/Producer', meta.producer || 'budget-vault');
  infoBuf.ascii(` /CreationDate (${pdfDateFromInjected(meta.created)}) >>`);
  objs[INFO] = infoBuf.toUint8Array();

  for (let i = 0; i < n; i++) {
    const img = list[i];
    const jpeg = img.jpeg instanceof Uint8Array ? img.jpeg : new Uint8Array(img.jpeg || []);
    const w = img.width | 0, h = img.height | 0;
    const imgObj = new ByteBuf();
    imgObj.ascii(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    imgObj.bytes(jpeg);
    imgObj.ascii('\nendstream');
    objs[imgNum(i)] = imgObj.toUint8Array();

    const contentStr = `q\n${fmtNum(pageDims.width)} 0 0 ${fmtNum(pageDims.height)} 0 0 cm\n/Im0 Do\nQ`;
    const contentObj = new ByteBuf();
    contentObj.ascii(`<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream`);
    objs[contentNum(i)] = contentObj.toUint8Array();

    objs[pageNum(i)] = asciiBytes(
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${fmtNum(pageDims.width)} ${fmtNum(pageDims.height)}] ` +
      `/Resources << /XObject << /Im0 ${imgNum(i)} 0 R >> >> /Contents ${contentNum(i)} 0 R >>`
    );
  }

  return assemblePdf(objs, totalObjs, CATALOG, INFO);
}

module.exports = {
  PAGE,
  normalizeText, canEncode, docEncodable,
  helveticaMeasure,
  layoutDocument,
  renderVectorPdf, renderImagePdf,
};
