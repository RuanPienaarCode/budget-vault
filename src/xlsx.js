'use strict';
/* xlsx.js — a minimal, valid .xlsx workbook, built on src/zip.js and nothing
   else. See zip.js's own header for why there is no bundled library: the
   dependency-free ZIP container is the one primitive both this module and a
   future PDF-adjacent export can share.

   Strings are written as INLINE STRINGS (`t="inlineStr"`), never through a
   sharedStrings.xml table. That is also what closes the formula-injection
   hole src/csv.js's csvCell exists for, the OPPOSITE way: csvCell prefixes a
   description starting =/+/-/@ with an apostrophe because a CSV cell with no
   type information defaults to being evaluated as a formula when it looks
   like one. An inline string cell is typed — `t="inlineStr"` — so Excel
   never asks "is this a formula", and a defensive apostrophe here would just
   be a stray character sitting IN the cell, visible to the reader, guarding
   against a class of bug this cell type cannot have. See tests/xlsx.test.cjs
   for the pin: a cell holding "=SUM(A1)" round-trips with no leading quote.

   Numbers are real numeric cells (`<v>`, no `t=`). This repo already has a
   canonical example of what happens when a number is written as text
   instead: src/exporter.js's amountCell comment — a SUM over a text column
   silently returns zero, with nothing on screen to say why. The same trap
   exists here and is closed the same way.

   The quiet failures a hand-rolled OOXML writer can produce, each guarded by
   tests/xlsx.test.cjs:

     1. A single illegal XML 1.0 character (a raw control byte, a lone UTF-16
        surrogate) anywhere in ANY part makes Excel refuse the WHOLE
        workbook, not just the sheet holding it — bank descriptions are
        exactly the kind of text nobody sanitised before it reached here.
     2. `&`, `<`, `>`, `"` unescaped break the XML outright; escaped but with
        an off-by-one (double-escaping an already-escaped &amp;, say) breaks
        it a quieter way that only shows up as a mis-rendered character.
     3. A sheet name over 31 characters, containing one of `[ ] : * ? / \`,
        or that begins/ends with an apostrophe is rejected by Excel at open
        time — and every sheet name here started as a category or period
        name the user typed, not a literal this module controls.
     4. Two sheets whose names differ only by case ("Budget" / "budget") are
        the SAME name to Excel's own uniqueness rule, even though they are
        different strings to this module's own Set — sheetName folds case
        before comparing, or a workbook that looked fine at build time fails
        to open.
     5. colRef has to match Excel's own bijective base-26 column naming past
        Z, where a naive base-26 (with a real zero digit) gets AA wrong.
     6. A cell's `s=` index has to exist in styles.xml's cellXfs table — an
        index that doesn't (or a table that's missing an index a cell uses)
        is a repair prompt, not a rendering glitch.

   Pure — no DOM, no Node API — Uint8Array/TextEncoder only via zip.js;
   this module itself only ever builds strings and hands them to zipStore. */

const { zipStore } = require('./zip');

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* ------------------------------ XML text --------------------------------- */

/* Legal XML 1.0 characters, by the spec's own ranges: tab/LF/CR, then
   U+0020-U+D7FF, U+E000-U+FFFD, U+10000-U+10FFFF. Surrogates (U+D800-DFFF)
   and U+FFFE/U+FFFF are excluded by those ranges themselves — there is
   nothing extra to special-case for them once the ranges are right. Written
   as a codepoint scan rather than a regex charclass because a charclass
   spanning astral codepoints needs the `u` flag AND still can't see a lone
   (unpaired) surrogate as anything other than "a character in range" —
   exactly the case this function exists to catch. No lookbehind anywhere:
   this repo's iOS 15 floor treats one as a parse-time SyntaxError for the
   whole bundle, not a runtime exception in this function alone. */
function bmpCharIsLegal(code) {
  if (code === 0x09 || code === 0x0A || code === 0x0D) return true;
  if (code >= 0x20 && code <= 0xD7FF) return true;
  if (code >= 0xE000 && code <= 0xFFFD) return true;
  return false;
}

function escXml(value) {
  const s = value === null || value === undefined ? '' : String(value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        // A valid surrogate pair encodes a single astral codepoint, which is
        // always legal in XML 1.0 — copy both UTF-16 units through untouched.
        out += s.charAt(i) + s.charAt(i + 1);
        i++;
        continue;
      }
      continue; // a lone high surrogate is not a character — dropped
    }
    if (code >= 0xDC00 && code <= 0xDFFF) continue; // a lone low surrogate — dropped
    if (!bmpCharIsLegal(code)) continue; // a C0 control (other than \t\n\r) — dropped
    const ch = s.charAt(i);
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else out += ch;
  }
  return out;
}

/* ------------------------------ sheetName --------------------------------- */

const SHEET_NAME_MAX = 31;
const SHEET_NAME_BAD_CHARS = /[[\]:*?/\\]/g;

/* Every rule here is Excel's own, not this module's taste — violate any one
   and the workbook opens with a repair prompt instead of the sheet:
     - non-empty, at most 31 characters
     - none of [ ] : * ? / \
     - does not begin or end with an apostrophe (Excel reserves that for its
       own quoting of a sheet name inside a formula reference)
     - unique CASE-INSENSITIVELY within the workbook — "Budget" and "budget"
       collide even though they are different JS strings.
   `taken` is a Set the caller owns across every sheet in one workbook; this
   function adds the lower-cased form of whatever name it returns, so a
   caller only has to pass the same Set into every call to get disambiguation
   across the whole book, exactly the way buildXlsx below does it. */
function sheetName(raw, taken) {
  taken = taken || new Set();
  let name = (raw === null || raw === undefined ? '' : String(raw)).replace(SHEET_NAME_BAD_CHARS, ' ').trim();
  name = stripEdgeApostrophes(name);
  if (name.length > SHEET_NAME_MAX) name = stripEdgeApostrophes(name.slice(0, SHEET_NAME_MAX));
  if (!name) name = 'Sheet';

  let candidate = name;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    const base = name.length + suffix.length > SHEET_NAME_MAX
      ? name.slice(0, SHEET_NAME_MAX - suffix.length)
      : name;
    candidate = base + suffix;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

function stripEdgeApostrophes(s) {
  let out = s;
  while (out.charAt(0) === "'") out = out.slice(1);
  while (out.length && out.charAt(out.length - 1) === "'") out = out.slice(0, -1);
  return out;
}

/* ------------------------------- colRef ----------------------------------- */

/* Excel's column naming is bijective base-26 (A=1..Z=26, AA=27..), not
   ordinary base-26 — there is no digit that means zero, which is exactly
   what makes Z -> AA the boundary a naive `n % 26` implementation gets
   wrong (it produces a spurious leading "@" or an off-by-one letter).
   Subtracting 1 before each mod/div step is what makes 26 map to "AA"
   instead of "A0". */
function colRef(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* -------------------------------- styles ----------------------------------- */

/* cellXfs index order is this module's own choice, fixed and small — every
   workbook this app writes gets the same seven-entry palette whether or not
   a given sheet uses all of them, so the table a cell's `s=` points into
   never depends on which columns happen to appear in one particular export.
   Index 0 is the format's own required default and is what an unknown or
   absent StyleKey resolves to. */
const STYLE_INDEX = { head: 1, bold: 2, money: 3, moneyBold: 4, pct: 5, muted: 6 };

function styleIndexFor(key) {
  if (!key) return 0;
  return Object.prototype.hasOwnProperty.call(STYLE_INDEX, key) ? STYLE_INDEX[key] : 0;
}

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';
const PCT_FMT = '0.0%';

const STYLES_XML = XML_DECL
  + `<styleSheet xmlns="${NS_MAIN}">`
  + '<numFmts count="2">'
  + `<numFmt numFmtId="164" formatCode="${escXml(MONEY_FMT)}"/>`
  + `<numFmt numFmtId="165" formatCode="${escXml(PCT_FMT)}"/>`
  + '</numFmts>'
  + '<fonts count="3">'
  + '<font><sz val="11"/><name val="Calibri"/></font>' // 0: default
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>' // 1: bold
  + '<font><color rgb="FF808080"/><sz val="11"/><name val="Calibri"/></font>' // 2: muted (grey)
  + '</fonts>'
  + '<fills count="3">'
  + '<fill><patternFill patternType="none"/></fill>' // 0: required by the format
  + '<fill><patternFill patternType="gray125"/></fill>' // 1: required by the format
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>' // 2: head background
  + '</fills>'
  + '<borders count="2">'
  + '<border><left/><right/><top/><bottom/><diagonal/></border>' // 0: none
  + '<border><left/><right/><top/><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>' // 1: head underline
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="7">'
  // 0: default
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  // 1: head — bold, light grey fill, bottom border
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
  // 2: bold
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  // 3: money — right-aligned currency format
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">'
  + '<alignment horizontal="right"/></xf>'
  // 4: moneyBold
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1">'
  + '<alignment horizontal="right"/></xf>'
  // 5: pct
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  // 6: muted — grey font
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/* -------------------------------- sheets ----------------------------------- */

/* One cell of the sheets[i].rows shape (contract in the task brief):
   null/undefined (omitted entirely — a hole in the row, not a blank cell,
   since every emitted cell already carries its own r="A1"-style reference
   and so needs no placeholder to stay in the right column), a bare
   string/number, or { v, s } for a styled cell. */
function cellShape(cell) {
  if (cell === null || cell === undefined) return { v: null, style: undefined };
  if (typeof cell === 'object') return { v: cell.v === undefined ? null : cell.v, style: cell.s };
  return { v: cell, style: undefined };
}

function rowXml(rowNumber, cells) {
  const parts = [];
  for (let c = 0; c < cells.length; c++) {
    const { v, style } = cellShape(cells[c]);
    if (v === null || v === undefined) continue; // empty cell — omitted, not written blank
    const ref = colRef(c) + rowNumber;
    const sIdx = styleIndexFor(style);
    const sAttr = sIdx ? ` s="${sIdx}"` : '';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue; // NaN/Infinity: not a number a spreadsheet can hold — empty cell
      parts.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
    } else {
      // Inline string, never sharedStrings — see this module's header for why
      // that also closes the formula-injection hole without a quote prefix.
      parts.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`);
    }
  }
  return parts.length ? `<row r="${rowNumber}">${parts.join('')}</row>` : `<row r="${rowNumber}"/>`;
}

function sheetViewsXml(freezeRows) {
  if (freezeRows && freezeRows > 0) {
    return '<sheetViews><sheetView workbookViewId="0">'
      + `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" state="frozen"/>`
      + '</sheetView></sheetViews>';
  }
  return '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
}

function colsXml(widths) {
  if (!widths || !widths.length) return '';
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
  return `<cols>${cols.join('')}</cols>`;
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const body = rows.map((row, i) => rowXml(i + 1, row || [])).join('');
  return XML_DECL
    + `<worksheet xmlns="${NS_MAIN}">`
    + sheetViewsXml(sheet.freezeRows)
    + colsXml(sheet.widths)
    + `<sheetData>${body}</sheetData>`
    + '</worksheet>';
}

/* ------------------------------ package parts ------------------------------ */

const CONTENT_TYPES_RELS = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_XML = 'application/xml';

function contentTypesXml(sheetCount) {
  const overrides = [];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i}.xml" `
      + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  }
  return XML_DECL
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + `<Default Extension="rels" ContentType="${CONTENT_TYPES_RELS}"/>`
    + `<Default Extension="xml" ContentType="${CONTENT_TYPES_XML}"/>`
    + '<Override PartName="/xl/workbook.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + overrides.join('')
    + '<Override PartName="/docProps/core.xml" '
    + 'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>';
}

const ROOT_RELS_XML = XML_DECL
  + `<Relationships xmlns="${NS_PKG_REL}">`
  + `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>`
  + '<Relationship Id="rId2" '
  + 'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
  + 'Target="docProps/core.xml"/>'
  + `<Relationship Id="rId3" Type="${NS_DOC_REL}/extended-properties" Target="docProps/app.xml"/>`
  + '</Relationships>';

function workbookXml(names) {
  const sheets = names.map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
  return XML_DECL
    + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}">`
    + `<sheets>${sheets.join('')}</sheets>`
    + '</workbook>';
}

function workbookRelsXml(sheetCount) {
  const rels = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(`<Relationship Id="rId${i}" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`);
  }
  rels.push(`<Relationship Id="rId${sheetCount + 1}" Type="${NS_DOC_REL}/styles" Target="styles.xml"/>`);
  return XML_DECL + `<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
}

function coreXml(creator, created) {
  // created is 'YYYY-MM-DDTHH:MM' (no seconds, no zone) — W3CDTF wants both,
  // so ':00Z' is appended rather than left ambiguous about which zone a bare
  // local time would otherwise imply.
  const iso = `${created}:00Z`;
  return XML_DECL
    + '<cp:coreProperties '
    + 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:creator>${escXml(creator)}</dc:creator>`
    + `<cp:lastModifiedBy>${escXml(creator)}</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>`
    + '</cp:coreProperties>';
}

function appXml(creator) {
  return XML_DECL
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
    + `<Application>${escXml(creator)}</Application>`
    + '</Properties>';
}

const CREATED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function buildXlsx(sheets, opts) {
  opts = opts || {};
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('buildXlsx requires at least one sheet');
  }
  const created = opts.created || '1980-01-01T00:00'; // the zip DOS epoch's own default — see zip.js
  if (!CREATED_RE.test(created)) {
    throw new Error(`opts.created must look like YYYY-MM-DDTHH:MM, got ${JSON.stringify(created)}`);
  }
  const creator = opts.creator || 'Budget Vault';

  const taken = new Set();
  const names = sheets.map(s => sheetName(s && s.name, taken));

  const entries = [
    { name: '[Content_Types].xml', data: contentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: ROOT_RELS_XML },
    { name: 'docProps/core.xml', data: coreXml(creator, created) },
    { name: 'docProps/app.xml', data: appXml(creator) },
    { name: 'xl/workbook.xml', data: workbookXml(names) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml(sheets.length) },
    { name: 'xl/styles.xml', data: STYLES_XML },
  ];
  sheets.forEach((s, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s || {}) });
  });

  return zipStore(entries, { created });
}

module.exports = { buildXlsx, sheetName, colRef };
