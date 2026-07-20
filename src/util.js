'use strict';
/* DOM + parsing helpers. Browser/Obsidian APIs only — must stay mobile-safe
   (no Node imports in this file or anywhere under src/). */

const { setIcon } = require('obsidian');

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return n;
};

/* Lucide icons: try each name until one renders (icon names occasionally get
   renamed between the lucide versions Obsidian ships). */
function setIco(elm, names) {
  for (const n of Array.isArray(names) ? names : [names]) {
    try { setIcon(elm, n); } catch (e) { /* unknown icon name */ }
    if (elm.firstElementChild) return;
  }
}
function icoEl(names, cls) {
  const s = document.createElement('span');
  s.className = 'ico' + (cls ? ' ' + cls : '');
  setIco(s, names);
  return s;
}

const escMd = s => (s ?? '').toString().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const unescMd = s => (s ?? '').replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();

/* ---------------- markdown frontmatter + table parsing ------------------ */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (/^".*"$/.test(val)) val = val.slice(1, -1);
      fm[key] = val;
    }
  }
  // `raw` is the verbatim frontmatter block (between the --- fences) so a
  // serializer can write back keys it doesn't model (tags, aliases, …).
  return { fm, raw: m ? m[1] : '', body: m ? text.slice(m[0].length) : text };
}
function parseMdTable(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|') || /^\|[\s:|-]+\|$/.test(t)) continue;
    // Drop the leading pipe; drop the trailing pipe only when it's actually
    // there and unescaped — a hand-edited row with no trailing pipe must not
    // lose its final cell's last character.
    let inner = t.slice(1);
    if (/(?<!\\)\|$/.test(inner)) inner = inner.slice(0, -1);
    const cells = inner.split(/(?<!\\)\|/).map(c => c.trim());
    rows.push(cells);
  }
  return rows;
}

/* Strict numeric-cell parse. Returns { ok, value, raw }. `ok` is true only for
   a plain decimal (the app's on-disk format); anything else (e.g. "1 234,56",
   "R100") is preserved verbatim in `raw` so a serializer can write it back
   unchanged instead of silently coercing it to a wrong number. */
function parseNum(s) {
  const t = (s ?? '').toString().trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: parseFloat(t) };
  return { ok: false, value: parseFloat(t) || 0, raw: t };
}

/* Patch specific keys inside a YAML frontmatter block while preserving key
   order, unmodeled keys, and multi-line (block) values verbatim. `updates` maps
   key -> preformatted RHS string (null removes the key; absent keys are left
   untouched; new keys are appended). This is what lets Accounts/Budgets/Tx
   serializers keep tags, aliases, cssclasses and any hand-added frontmatter
   that the in-memory model doesn't carry. */
function patchFrontmatter(raw, updates) {
  const has = k => Object.prototype.hasOwnProperty.call(updates, k);
  if (!raw || !raw.trim()) {
    return Object.keys(updates).filter(k => updates[k] != null).map(k => `${k}: ${updates[k]}`).join('\n');
  }
  const isTopKey = l => /^[^\s#][^:]*:(\s.*)?$/.test(l);
  const entries = [];
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    if (isTopKey(line)) { cur = { key: line.slice(0, line.indexOf(':')).trim(), lines: [line] }; entries.push(cur); }
    else if (cur) cur.lines.push(line);
    else entries.push({ key: null, lines: [line] });
  }
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (e.key != null && has(e.key)) {
      seen.add(e.key);
      if (updates[e.key] != null) out.push(`${e.key}: ${updates[e.key]}`);  // replace (collapses block→scalar)
      // else: remove entry entirely
    } else {
      out.push(...e.lines);  // preserve verbatim
    }
  }
  for (const k of Object.keys(updates)) {
    if (!seen.has(k) && updates[k] != null) out.push(`${k}: ${updates[k]}`);
  }
  return out.join('\n');
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* Parse a bank-statement date cell to a canonical 'YYYY-MM-DD' string, or null
   if unparseable. Explicit and engine-independent — never the Date constructor,
   whose non-ISO parsing differs between V8 (desktop) and JavaScriptCore (iOS)
   and silently mis-files DD/MM vs MM/DD dates. SA bank exports are DD/MM/YYYY;
   an unambiguous MM/DD (day field > 12) is tolerated by swapping. */
function isoParts(y, mo, d) {
  if (!y || y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseStatementDate(raw) {
  const s = (raw ?? '').toString().trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);      // ISO: YYYY-MM-DD
  if (m) return isoParts(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);          // DD/MM/YYYY (SA)
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }     // tolerate MM/DD
    return isoParts(+m[3], mo, d);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);                        // YYYYMMDD (Absa/SB)
  if (m) return isoParts(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})$/);       // DD Mon YYYY
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return isoParts(+m[3], mo, +m[1]);
  }
  const dt = new Date(s);                                        // last-resort fallback
  if (!isNaN(dt.getTime())) return isoParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  return null;
}

/* Parse a statement amount cell to a Number, or null if empty/unparseable.
   Tolerates the spread of SA bank export styles: "R 1 234.56", "1,234.56",
   decimal-comma "1 234,56" / "1.234,56", parenthesised negatives "(123.45)",
   trailing minus "123.45-", and Cr/Dr markers (Cr → credit/positive,
   Dr → debit/negative). Zero is a valid return — callers decide to skip it. */
function normalizeAmount(raw) {
  let s = (raw ?? '').toString().trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const marker = s.match(/(cr|dr)\.?\s*$/i);
  if (marker) { if (marker[1].toLowerCase() === 'dr') neg = true; s = s.slice(0, marker.index).trim(); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1).trim(); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }
  if (s.startsWith('+')) s = s.slice(1).trim();
  s = s.replace(/^(r|zar)\s*/i, '').replace(/[\s\u00A0\u202F']/g, '');
  if (/^\d+(\.\d{3})*,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');  // decimal comma
  else s = s.replace(/,/g, '');                                                       // thousands comma
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/* Sanitise a string for safe use as a single path segment (folder/file name):
   strip path separators and filesystem-illegal characters, and neutralise
   "../" traversal attempts (dot runs, leading dots). */
function safeSeg(s) {
  return (s ?? '').toString()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^\.+/, '')
    .trim();
}

/* Collapse '.' and '..' segments in a '/'-path; returns null if it escapes the
   root (more '..' than depth). Used to verify a write stays inside the folder. */
function collapsePath(p) {
  const out = [];
  for (const seg of (p || '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); }
    else out.push(seg);
  }
  return out.join('/');
}

module.exports = { el, setIco, icoEl, escMd, unescMd, parseFrontmatter, parseMdTable, parseCsv, parseStatementDate, normalizeAmount, parseNum, patchFrontmatter, safeSeg, collapsePath };
