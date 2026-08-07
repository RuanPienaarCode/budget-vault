'use strict';
/* The markdown files ARE the database.

   Every figure this plugin shows is derived from a file the user could have
   written by hand, so reading and writing that markdown is not a serialisation
   detail — it is the storage layer. Two rules follow from that and are enforced
   here rather than by each caller:

     - a hand-edited file must survive a round trip. parseMdTable stops at the
       first table and tolerates a missing trailing pipe; patchFrontmatter
       rewrites only the keys it is handed and leaves tags, aliases and any
       unmodeled key verbatim.
     - anything written back must not corrupt the file for OBSIDIAN, which
       parses it too. That is what escMd and yamlStr are for.

   Pure — no DOM, no obsidian import. */

const escMd = s => (s ?? '').toString().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const unescMd = s => (s ?? '').replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();

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
/* "Is the last character an unescaped pipe?" and "split on unescaped pipes".
   Hand-rolled rather than /(?<!\\)\|/ on purpose: a lookbehind *literal* is a
   parse-time SyntaxError on WebKit before iOS 16.4, which would take down the
   whole bundle — not just this function — on a device Obsidian itself still
   supports (iOS 14.5+). Same char-by-char shape as parseCsv below. */
const endsWithBarePipe = s => s.endsWith('|') && s[s.length - 2] !== '\\';
function splitBarePipes(s) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '|' && s[i - 1] !== '\\') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
function parseMdTable(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    /* Stop at the end of the FIRST table. This used to collect every `|` line
       in the file, which merged a second table into the first — and because
       every caller does `.slice(1)` to drop the one header row, the second
       table's HEADER survived as data: a budget category literally named
       "Category" with type "Type" and amount 0, counted in the totals. It then
       became permanent, because saveBudget rebuilds the file from parsed state.
       A blank line ends a table in markdown and Obsidian renders it that way,
       so stopping here is what makes the parser agree with what the user sees.
       Anything before the table (frontmatter, a heading, prose) is still
       skipped — the run only closes once rows have actually started. */
    if (!t.startsWith('|')) { if (rows.length) break; continue; }
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    // Drop the leading pipe; drop the trailing pipe only when it's actually
    // there and unescaped — a hand-edited row with no trailing pipe must not
    // lose its final cell's last character.
    let inner = t.slice(1);
    if (endsWithBarePipe(inner)) inner = inner.slice(0, -1);
    const cells = splitBarePipes(inner).map(c => c.trim());
    rows.push(cells);
  }
  return rows;
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

/* Quote a value for use as a YAML frontmatter scalar. Everything written into
   frontmatter goes through here: an unescaped quote, backslash or a bare
   "Ref: ABC-1" makes the whole block unparseable to Obsidian, which drops the
   note's properties from the metadata cache — while this plugin's own
   first-colon parser reads it back happily, so the breakage is invisible from
   inside the app. */
const yamlStr = v => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

module.exports = { escMd, unescMd, parseFrontmatter, parseMdTable, patchFrontmatter, yamlStr };
