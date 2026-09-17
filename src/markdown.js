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
      if (/^".*"$/.test(val)) val = unquoteYaml(val);
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
   supports (iOS 15 / WebKit 15.0 is the documented mobile floor — minAppVersion
   gates the app, not the engine). Same char-by-char shape as parseCsv below. */
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
  /* A top-level key is an unindented line with a colon in it. The `\s` after
     the colon used to be required, which meant `cssclasses:wide` — legal
     enough for a human to type, and something Obsidian itself tolerates — read
     as a CONTINUATION of the entry above it. If that entry was one of the keys
     being replaced, the hand-typed line was deleted along with it, silently,
     by a function whose entire contract is to preserve what it does not
     model. */
  const isTopKey = l => /^[^\s#][^:]*:(\s.*)?$/.test(l) || /^[^\s#][^:]*:\S/.test(l);
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
   inside the app.

   NEWLINES ESCAPE TOO, and that is not theoretical. A name typed into a
   markdown TABLE cell — a debt, an asset, a service, an owed entry — round
   trips through unescMd, which turns `<br>` back into a real newline. Written
   raw, that newline ends the scalar mid-value and the REST OF THE NAME becomes
   a line of its own inside the block:

       note_subject: "Absa Bond
       note_kind: account"

   which is invalid YAML (so Obsidian drops every property on the file) AND
   forges a key that this module's own line parser then reads back as real. A
   name wrapped for width — "Standard Bank<br>Access Bond", no colon, nothing
   clever — breaks the block just as thoroughly.

   The reader half is unquoteYaml() below, called by parseFrontmatter, which has
   to undo exactly these four or the app shows a literal backslash-n where
   Obsidian shows a break. It reads left to right in ONE pass for the reason
   given there — a chain of .replace() calls turns a literal `\n` back into a
   real newline. note-file.js used to carry a second decoder of its own; it was
   dead by the time it was removed, and running both ate a backslash. */
/* ISSUE 54. The READER half of yamlStr, and the reason this function had to
   exist here rather than only in note-file.js.

   parseFrontmatter stripped the surrounding quotes and stopped — it never
   undid the escapes. So every field written by yamlStr and read back by
   anything other than note-file.js came back still escaped, and the next save
   escaped it AGAIN. Measured on an account's `institution`:

       gen0  "O\"Reilly Bank"
       gen1  "O\\\"Reilly Bank"
       gen2  "O\\\\\\\"Reilly Bank"
       gen3  "O\\\\\\\\\\\\\\\"Reilly Bank"

   Doubling on every save, and visible to the reader from the first reload. It
   reached `institution`, `account_number`, `owner`, `tx_label`, `household`,
   `owners`, `groups`, the tax deadline and reference fields and a plan's own
   name — everything with a yamlStr write site and no unyaml on the way back.

   Fixed HERE, at the one boundary both halves already pass through, rather
   than by adding unyaml() to nine call sites: an inverse that lives next to
   the function it inverts cannot be forgotten at a tenth. note-file.js's own
   unyaml() calls are dropped with this change — running both would eat a
   legitimate backslash, which is the same defect one turn further on.

   Gated on the value having been QUOTED, which is exactly when yamlStr wrote
   it; an unquoted scalar is returned untouched. That also matches what YAML
   itself says a double-quoted scalar means, so the app and Obsidian's own
   property reader now agree about what is on the page. */
function unquoteYaml(val) {
  const s = val.slice(1, -1);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue; }
    const next = s[++i];
    out += next === 'n' ? '\n'
      : next === 'r' ? '\r'
        : next === 't' ? '\t'
          : next;                    // \" and \\ — and anything else, verbatim
  }
  return out;
}

const yamlStr = v => `"${String(v ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r/g, '\\r')
  .replace(/\n/g, '\\n')
  .replace(/\t/g, '\\t')}"`;

/* Issue #69 — like parseMdTable, but keeps the header and separator rows the
   generic reader throws away. Needed only by callers preserving columns a
   schema does not model; every other caller keeps using parseMdTable so this
   never becomes a second parser the first one can drift from without
   anything going red. Deliberately a SEPARATE loop over the same rule rather
   than a wrapper around parseMdTable, because parseMdTable's contract is "the
   data rows, no header" and changing what it returns would ripple through
   every existing caller — tests/markdown-preserve.test.cjs holds `.dataRows`
   and `.header` to exactly what parseMdTable(text) and parseMdTable(text)[0]
   already give, over the same fixtures parseMdTable's own tests use, so the
   two cannot disagree about where a table starts or stops without a test
   going red. */
function parseMdTableWithSeparator(text) {
  const rows = [];
  let sep = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) { if (rows.length) break; continue; }
    if (/^\|[\s:|-]+\|$/.test(t)) {
      // The first separator-shaped line right after the header is THE
      // separator; a table with no header (rows.length === 0 here) never
      // reaches this arm because parseMdTable's own rule doesn't either.
      if (rows.length === 1 && !sep) {
        let inner = t.slice(1);
        if (endsWithBarePipe(inner)) inner = inner.slice(0, -1);
        sep = splitBarePipes(inner).map(c => c.trim());
      }
      continue;
    }
    let inner = t.slice(1);
    if (endsWithBarePipe(inner)) inner = inner.slice(0, -1);
    rows.push(splitBarePipes(inner).map(c => c.trim()));
  }
  return { header: rows[0], sep, dataRows: rows.slice(1) };
}

/* Issue #67 — where the FIRST table sits inside a body of text, expressed as
   the raw text before it and the raw text after it. Copies parseMdTable's own
   "first table only, a blank (or any non-`|`) line ends it" rule rather than
   calling it, because a caller here wants the BOUNDARY, not the rows — but it
   is copied from the same four lines above on purpose, and
   tests/markdown-preserve.test.cjs pins the two functions to agreeing about
   where that boundary falls over a shared set of fixtures, so the copy cannot
   drift without a test noticing.

   Used to preserve whatever the plugin does not model around a table it owns
   (a paragraph above it, a `## heading` a household added below it) — never
   to reparse the table itself. */
function splitAroundTable(text) {
  const lines = text.split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) { if (start >= 0) { end = i; break; } continue; }
    if (start < 0) start = i;
  }
  if (start < 0) return { before: text, after: '' };
  return { before: lines.slice(0, start).join('\n'), after: lines.slice(end).join('\n') };
}

/* Issue #67 — the lines a fresh save of a single-table or lead-paragraph
   region would ALWAYS write, before any reader's own extra content is
   considered: a blank line under the frontmatter fence, the `# Title`, a
   blank line, the view's own prose (fixed strings, or in tax.js's case a
   locale-derived sentence that must keep tracking the household's country —
   so these lines are always regenerated fresh, never frozen from disk), and
   a trailing blank line before whatever comes next. Shared by
   table-schema.js's mdTableFile, budget-file.js, tax.js and plan.js so the
   shape is declared once rather than four times drifting apart. */
function freshLeadLines(title, contentLines) {
  return ['', `# ${title}`, '', ...contentLines, ''];
}

/* Issue #67 — replay a reader's own extra content past the lines a fresh save
   would always write. `capturedBefore` is the raw text read off disk last
   load (via splitAroundTable, or the lead chunk of a body.split(/##/) for a
   multi-table file); `freshLines` is freshLeadLines()'s own output for the
   CURRENT state, so a setting or a rename that must keep tracking live state
   (a budget's range note, a plan's own name) is regenerated fresh every save
   regardless of what used to be on disk. Anything the reader's file held
   BEYOND that fixed shape — a paragraph they added, a heading they started —
   is never interpreted, only replayed byte for byte in the position it was
   found.

   `capturedBefore` carries one leading blank line that is not something
   anyone typed: parseFrontmatter's `body` is sliced right after the closing
   `---`, one character short of consuming the newline that followed it, so
   every capture off real text starts one line "early" compared to the
   literal array a writer builds by hand. Dropped here, once, rather than
   adjusted at every call site. */
function withLeadExtra(capturedBefore, freshLines) {
  if (capturedBefore == null) return freshLines;
  const content = capturedBefore.split(/\r?\n/).slice(1);
  if (content.length <= freshLines.length) return freshLines;
  /* Before trusting a POSITION to mean "past the fixed shape", check that the
     shape is actually still there: every fixed line except the title (index
     1 — a plan's own name is itself live state, allowed to differ) must
     match exactly where freshLines says it should be. A mismatch means the
     reader inserted or edited something INSIDE the fixed block rather than
     appending after it — guessing where "extra" starts from there risks
     duplicating the plugin's own line while still losing the reader's, which
     is worse than doing nothing. Replay the whole captured block exactly as
     found instead: unregenerated (so a locale or a rename goes stale there
     until the reader's own next edit un-misaligns it), but nothing is
     invented and nothing is lost. */
  const fixedTail = freshLines.slice(2);
  const alignedTail = content.slice(2, freshLines.length);
  const aligned = fixedTail.length === alignedTail.length && fixedTail.every((l, i) => alignedTail[i] === l);
  return aligned ? [...freshLines, ...content.slice(freshLines.length)] : content;
}

/* Issue #67 — the same preservation for a MULTI-table file (tax, plan), whose
   sections are already delimited by top-level `## ` headings (load.js's
   section() reads the known ones by name). Splitting on that same boundary
   gives every OTHER chunk for free: `lead` is the paragraph above the first
   heading (fed to withLeadExtra by the caller, the same as a single-table
   file's lead), and `extras` is every chunk this file does NOT recognise —
   a `## My own working` a household added anywhere — PLUS, for each chunk
   this file DOES recognise, whatever splitAroundTable finds after that
   chunk's OWN table and before the next heading (a plain paragraph with no
   heading of its own, which section()'s caller only ever fed to
   parseMdTable and never looked at again). Both kinds carry `after`: the
   name of the nearest RECOGNISED section before them, or null for anything
   above the first one — so a save can put each one back relative to the
   section it followed rather than at a fixed line number that shifts every
   time a row is added or removed. */
function extraContent(body, knownNames) {
  const chunks = body.split(/\r?\n##\s+/);
  const extras = [];
  let lastKnown = null;
  for (const raw of chunks.slice(1)) {
    const name = knownNames.find(n => raw.trim().toLowerCase().startsWith(n));
    if (name) {
      lastKnown = name;
      const extra = splitAroundTable(raw).after.trim();
      if (extra) extras.push({ after: name, raw: extra });
    } else {
      extras.push({ after: lastKnown, raw: ('## ' + raw).trim() });
    }
  }
  return { lead: chunks[0], extras };
}

module.exports = {
  escMd, unescMd, parseFrontmatter, parseMdTable, patchFrontmatter, yamlStr, unquoteYaml,
  parseMdTableWithSeparator, splitAroundTable, freshLeadLines, withLeadExtra, extraContent,
};
