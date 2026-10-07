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

/* A free-text value as one table cell, and back.

   escMd used to escape `|` and turn CRLF/LF into `<br>`, and nothing else.
   That let two inputs end a row early in every CommonMark reader while this
   module's own reader saw nothing wrong (2026-10-07 audit, L4A-06):

     - a lone CR — CommonMark ends a line on `\r` alone, so `old mac\rline
       ending` cut its row in two and the table stopped there; parseMdTable
       splits on `\r?\n` and read one line. It is a line ending, so it becomes
       `<br>` like the other two (and reads back as `\n`, as CRLF always has).
     - a backslash right before a pipe — `a\|b` was written `a\\|b`. `\\` is an
       ESCAPED BACKSLASH, so the pipe after it is a bare cell boundary: one
       cell too many. splitBarePipes reads any backslash-before-pipe as an
       escape, so the app read one cell. Now every backslash in a run that ends
       at a pipe is doubled before the pipe is escaped — `a\\\|b`, an escaped
       backslash and an escaped pipe — which is one cell under either reading,
       and renders as the `a\|b` that was typed.

   unescMd is the exact inverse: an ODD run of backslashes before a pipe is
   what escMd writes (2k+1 for k typed), and reads back as k. An EVEN run is
   what the old escMd wrote (k+1 for an odd k — `a\\|b` for a typed `a\|b`)
   and keeps the reading it always had, so a file already on disk loads
   exactly as before and heals on its next save. One reading changes: an odd
   run of three or more, which the old pair wrote for a typed `\\|` and which
   Obsidian renders as one backslash — it now reads as Obsidian shows it, and
   is written back byte for byte.

   For a value holding neither shape the bytes are exactly what they were;
   tests/escape-pair-round-trips.test.cjs proves it over every string of up
   to five of the characters that matter, against the old pair frozen there.
   A character scan rather than chained .replace() calls, so an escape this
   adds is never seen by a later pass — the same reason as escMdText below. */
function escMd(s) {
  const str = (s ?? '').toString();
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\') {
      let j = i;
      while (str[j] === '\\') j++;
      const run = str.slice(i, j);
      out += str[j] === '|' ? run + run : run;
      i = j - 1;
      continue;
    }
    if (ch === '|') { out += '\\|'; continue; }
    if (ch === '\r') { if (str[i + 1] === '\n') i++; out += '<br>'; continue; }
    if (ch === '\n') { out += '<br>'; continue; }
    out += ch;
  }
  return out.trim();
}
function unescMd(s) {
  const str = (s ?? '').toString();
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '<' && str.startsWith('<br>', i)) { out += '\n'; i += 3; continue; }
    if (ch === '\\') {
      let j = i;
      while (str[j] === '\\') j++;
      const m = j - i;
      if (str[j] === '|') {
        out += '\\'.repeat(m % 2 ? (m - 1) / 2 : m - 1) + '|';
        i = j;
      } else {
        out += str.slice(i, j);
        i = j - 1;
      }
      continue;
    }
    out += ch;
  }
  return out.trim();
}

/* Text for a GENERATED note — the Report today, the Transactions export next —
   shown, never obeyed. escMd above guards only the TABLE: it escapes `|` and
   newlines and leaves every other piece of markdown live, which is right for
   the vault's own month files (unescMd must turn each one back into exactly
   what the household typed) and wrong for a note this app writes once and
   Obsidian then renders. A transaction's Description is written by whoever
   wrote the EFT reference or the card descriptor, and import keeps it
   verbatim, so in a generated note `EFT ![x](https://attacker.example/p.png)`
   fetched that URL every time the note was opened, `![[Settings]]`
   transcluded another note, `#word` joined the tag index, `%%` hid the rest
   of the line, a backtick opened a code span (Dataview runs some of those),
   and a category called "Home <Garden>" lost "<Garden>" to the HTML parser
   (2026-10-07 audit). No real description held one of these; nothing stopped
   one either.

   Every ASCII punctuation mark CommonMark lets a backslash escape, among the
   ones Obsidian gives a meaning to — \ ` * _ [ ] ! < > # % $ — is
   backslash-escaped, so it renders as itself. The backslash goes first so the
   escapes added after it are not escaped again. Two things are NOT
   backslash-escaped, deliberately:

     - `|` becomes `&#124;`, which renders as a pipe and splits no table cell.
       `\|` would split none either, but escMd escapes a backslash that stands
       before a pipe as well as the pipe, so a `\|` handed to it comes out as
       `\\\|` and the reader sees a stray backslash (before L4A-06's fix it
       came out as `\\|` — an escaped backslash and a bare pipe, which ENDED
       the cell). With no pipe and no line break left in the output,
       escMd(escMdText(s)) is escMdText(s): a caller can escape a field and
       hand it to code that still runs escMd (exporter.transactionRow)
       without doubling anything. tests/report-markdown-escape.test.cjs holds
       that property.
     - every line ending — CRLF, LF, and a lone CR, which CommonMark also ends
       a line on (escMd let a lone CR through raw until the same audit) —
       becomes `<br>`, added AFTER the escaping so the tag itself stays live.

   One-way on purpose. A generated note is never parsed back in (see
   src/report.js's REPORT_DIR header), so there is no unescape to keep in
   step; the month files are a separate decision because theirs would be.
   Currency symbols and formatted money are not passed through here — they
   are the household's own configuration printed as part of a figure, and
   `$ 1 000` cannot open Obsidian's inline math (a `$` followed by a space
   never does). Scanned a character at a time rather than chained .replace()
   calls, so no escape this adds is ever seen by a later pass. */
const MD_TEXT_ACTIVE = new Set(['\\', '`', '*', '_', '[', ']', '!', '<', '>', '#', '%', '$']);
function escMdText(s) {
  const str = (s ?? '').toString();
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\r') { if (str[i + 1] === '\n') i++; out += '<br>'; continue; }
    if (ch === '\n') { out += '<br>'; continue; }
    if (ch === '|') { out += '&#124;'; continue; }
    out += MD_TEXT_ACTIVE.has(ch) ? `\\${ch}` : ch;
  }
  return out.trim();
}

/* #76 item 3. A leading UTF-8 BOM (U+FEFF) — an encoding artifact some
   editors and OSes prepend, not content the reader typed — defeated capture
   entirely here: the regex below anchors on the very first character being
   `-`, so a BOM'd Debts.md loaded its table but S.debtsFm fell back to the
   bare 'kind: debts' default, and the next save (patchFrontmatter with
   raw='') wrote THAT in place of whatever tags/aliases the real frontmatter
   held — silent loss of properties on a file nobody had touched. Whether
   Obsidian's own reader already strips a BOM before this text arrives was
   never verified either way, and it doesn't need to be: stripping one here
   is harmless if Obsidian already did it (the charCode check just misses),
   and load-bearing if it didn't.

   Not carried forward into `raw`/`body`/the write path: every writeFile call
   in io.js already emits a bare `---\n` with no BOM of its own, so a file
   this app saves never has one from the moment it does — preserving an
   inherited BOM would need new plumbing threaded through raw/body/patchFile
   for a value nothing downstream reads or displays. It heals on the FIRST
   save after this fix, the same way this file's own unescMd unwinds a
   double-escape without a migration. */
function parseFrontmatter(text) {
  const t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (/^".*"$/.test(val)) val = unquoteYaml(val);
      /* A single-quoted value has one escape, `''` for a quote, and was never
         unquoted at all: `institution: 'Bob''s Bank'` — how YAML quotes a
         value that holds a double quote — showed its quotes on every page,
         and a save of that key wrote them INTO the value. Only a well-formed
         one is read this way (no lone quote inside), so `'a' b`, which YAML
         itself rejects, is left as typed. */
      else if (/^'(?:[^']|'')*'$/.test(val)) val = val.slice(1, -1).replace(/''/g, "'");
      fm[key] = val;
    }
  }
  // `raw` is the verbatim frontmatter block (between the --- fences) so a
  // serializer can write back keys it doesn't model (tags, aliases, …).
  /* `body` is everything after the closing fence, STARTING WITH the line
     break that ends the fence's own line — sliced one character short of
     consuming it. Every writer relies on that: io.patchFile writes
     `---\n${fm}\n---${body}` with nothing in between, and withLeadExtra
     drops that first, untyped line from every capture.

     A file with NO block has no fence and so no such break, and this used to
     hand back the bare text — the first frontmatter the app added to a
     hand-written note was glued to its first line: `---\nfixed: true\n---#
     Snacks` from the Budget page's Fixed toggle, `---# Wallet` from a
     hand-made account's first balance edit. That is not a closing fence, so
     Obsidian saw no properties on the file, while the lazy regex above still
     found the block and nothing in the app noticed (2026-10-07 audit, L3-07).
     It mis-READ such a file too: load.js's section() and extraContent below
     find a `##` heading by the line break in front of it, so a plan that
     opened on `## Money in` never loaded that table.

     So a bare file reads as the break its fence would need, then its own
     text verbatim — exactly what views/notes.js's splitFm already did for the
     notes it re-points — and patching it prepends a block without touching a
     character the household wrote. An empty file stays '': there is no first
     line to glue anything to, and saveAccount's `a.body ||` fallback reads
     '' as "this account note has no body yet". */
  return { fm, raw: m ? m[1] : '', body: m ? t.slice(m[0].length) : (t ? `\n${t}` : '') };
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
   order, unmodeled keys, comment lines, and multi-line (block) values
   verbatim. `updates` maps
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
  /* A `#` comment line belongs to NO key. Every non-key line used to count
     as a continuation of the key above it, so a comment a household wrote
     under `balance:` — "# per statement, before the card payment cleared" —
     was deleted with the old figure the next time the balance was saved, by
     the function whose contract is to keep what it does not model
     (2026-10-07 audit, L3-08). Now each comment is a segment of its own and
     is always written back where it stood.

     Two things that look like comments are not, and both decide this shape:

       - an INDENTED `#` line under a block scalar (`notes: |`, `notes: >-`)
         is text in that scalar, so it stays a continuation and goes with its
         key, like the rest of the text. An UNINDENTED one ends the scalar —
         block text is always indented under a top-level key — so it is a
         real comment.
       - the lines AFTER a comment still belong to the key above it. YAML
         lets a comment sit inside a block list (`aliases:` / `# old names` /
         `  - Wallet`), and if the comment took the items over, replacing
         `aliases` would leave `  - Wallet` orphaned under a scalar: a parse
         error, and Obsidian drops every property on the file. So a
         continuation after a comment opens a new segment OWNED by that key,
         and the file's line order is kept by emitting segments in the order
         they were read.

     With no comment lines, every key and its continuation lines form one
     segment exactly as before, so a block without comments patches to the
     same bytes it always did. */
  const BLOCK_SCALAR = /^[|>](?:[-+][1-9]?|[1-9][-+]?)?\s*(?:#.*)?$/;
  const segs = [];      // file order: { owner: {key, blockScalar} | null, first, lines }
  let cur = null;       // the key a continuation line belongs to
  let open = null;      // the segment the next continuation line extends
  for (const line of raw.split(/\r?\n/)) {
    if (isTopKey(line)) {
      const c = line.indexOf(':');
      cur = { key: line.slice(0, c).trim(), blockScalar: BLOCK_SCALAR.test(line.slice(c + 1).trim()) };
      open = { owner: cur, first: true, lines: [line] };
      segs.push(open);
    } else if (/^\s*#/.test(line) && !(cur && cur.blockScalar && /^\s/.test(line))) {
      segs.push({ owner: null, first: false, lines: [line] });
      open = null;
    } else if (cur) {
      if (!open) { open = { owner: cur, first: false, lines: [] }; segs.push(open); }
      open.lines.push(line);
    } else {
      segs.push({ owner: null, first: false, lines: [line] });
    }
  }
  const seen = new Set();
  const out = [];
  for (const s of segs) {
    const key = s.owner ? s.owner.key : null;
    if (key != null && has(key)) {
      if (s.first) {
        seen.add(key);
        if (updates[key] != null) out.push(`${key}: ${updates[key]}`);  // replace (collapses block→scalar)
      }
      // else: the rest of a replaced or removed key's value goes with it
    } else {
      out.push(...s.lines);  // preserve verbatim
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
/* 2026-10-07 audit (L4a). This decoded only the escapes yamlStr writes and
   handed every other one back as its bare letter — the backslash was eaten.
   A household that typed `institution: "Caf\u00e9 Bank"`, the YAML way to
   write é in a double-quoted value, saw "Cafu00e9 Bank" on every page, and
   the next save of that key wrote "Cafu00e9 Bank" back for good.

   It now reads a one-line double-quoted value the way the reader Obsidian
   parses frontmatter with does — the `yaml` package bundled in Obsidian
   1.13.7, whose escape table this mirrors: every YAML 1.2 escape below, and
   \xXX \uXXXX \UXXXXXXXX by code point. An escape YAML does not define (`\q`,
   or \x \u \U without their full run of hex digits) is kept AS WRITTEN,
   backslash and all — that is what Obsidian's reader does with the value too,
   while it flags the file — rather than shown as a value that is on neither
   page; yamlStr then writes it back as `\\q`, valid YAML meaning exactly
   what the page showed. A code point past U+10FFFF is kept as written rather
   than thrown on. */
const YAML_ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
};
const YAML_HEX_ESCAPES = { x: 2, u: 4, U: 8 };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function unquoteYaml(val) {
  const s = val.slice(1, -1);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue; }
    const next = s[i + 1];
    if (own(YAML_ESCAPES, next)) { out += YAML_ESCAPES[next]; i++; continue; }
    if (own(YAML_HEX_ESCAPES, next)) {
      const len = YAML_HEX_ESCAPES[next];
      const hex = s.slice(i + 2, i + 2 + len);
      const code = hex.length === len && /^[0-9a-fA-F]+$/.test(hex) ? parseInt(hex, 16) : NaN;
      out += code <= 0x10FFFF ? String.fromCodePoint(code) : s.slice(i, i + 2 + len);
      i += 1 + len;
      continue;
    }
    out += s[i] + next;   // not an escape YAML defines: kept, backslash and all
    i++;
  }
  return out;
}

/* U+2028 and U+2029 are written as YAML's own \L and \P. Raw, they defeated
   this module's reader: parseFrontmatter recognises a quoted value with
   /^".*"$/, and `.` does not match a line separator, so a name holding one
   came back with its quotes on — the one place yamlStr and unquoteYaml were
   not each other's inverse (tests/yaml-quoted-scalars.test.cjs sweeps it).
   Every other value is written exactly as before. */
const yamlStr = v => `"${String(v ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r/g, '\\r')
  .replace(/\n/g, '\\n')
  .replace(/\t/g, '\\t')
  .replace(/\u2028/g, '\\L')
  .replace(/\u2029/g, '\\P')}"`;

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
   so these lines are regenerated fresh rather than frozen from disk, for as
   long as they are still the plugin's: withLeadExtra keeps any one of them a
   household replaced with its own), and a trailing blank line before
   whatever comes next. Shared by
   table-schema.js's mdTableFile, budget-file.js, tax.js and plan.js so the
   shape is declared once rather than four times drifting apart. */
function freshLeadLines(title, contentLines) {
  return ['', `# ${title}`, '', ...contentLines, ''];
}

/* Sentences the plugin writes into a lead that legitimately read differently
   from one save to the next: written under another setting, or by an earlier
   version. A captured line that matches one of these AND the fresh line for
   the same slot is still the plugin's own sentence — the same sentence, due
   for regenerating. Without these, the range note of a household that moved
   month_start_day from 1 to 25 would read as the household's own words and
   never update again. Each pattern names the writer it follows; widening the
   wording there means widening it here, and tests/lead-lines-kept-or-
   regenerated.test.cjs goes red on a writer whose sentence stops matching. */
const GENERATED_LEAD_SENTENCES = [
  /* src/budget-file.js budgetRangeNote: every month_start_day and period
     length, the "25rd"/"24nd" spelling of the 1.0 releases, and the interval
     sentence an earlier version wrote under `period_type`. */
  /^With `(?:month_start_day|period_days|period_type): [^`]*`, this period (?:is|runs) /,
  /* src/views/tax.js: the authority and the year span follow the household's
     country (and za's span was once spelled "28 Feb", now "end Feb"). */
  /^\S.* return tracking for the \d{4} tax year \(.+\)\.$/,
  /* src/views/services.js: the cycle list grew from two words to four
     (ISSUE 33). */
  /^Recurring services and subscriptions\. `cycle` is /,
];
const isBlankLine = l => !l.trim();
const isTitleLine = l => /^#\s/.test(l);
/* Is `line` still the plugin's own line for the slot whose fresh line is
   `fresh`? A blank where a blank goes; a `# heading` where the title goes (the
   title is live state — a renamed plan's heading must follow the new name, so
   any level-1 heading in that slot is the plugin's to rewrite); the sentence
   itself; or the same generated sentence in another wording. */
function ownLeadLine(line, fresh) {
  if (line === fresh) return true;
  if (isBlankLine(fresh)) return isBlankLine(line);
  if (isTitleLine(fresh)) return isTitleLine(line);
  return GENERATED_LEAD_SENTENCES.some(re => re.test(fresh) && re.test(line));
}

/* Issue #67 — replay a reader's own extra content past the lines a fresh save
   would always write. `capturedBefore` is the raw text read off disk last
   load (via splitAroundTable, or the lead chunk of a body.split(/##/) for a
   multi-table file); `freshLines` is freshLeadLines()'s own output for the
   CURRENT state, so a setting or a rename that must keep tracking live state
   (a budget's range note, a plan's own name) is regenerated fresh on every
   save that finds the plugin's own line in its slot — and a line the
   household wrote there instead is kept (below). Anything the reader's file
   held BEYOND that fixed shape — a paragraph they added, a heading they
   started — is never interpreted, only replayed byte for byte in the
   position it was found.

   `capturedBefore` carries one leading blank line that is not something
   anyone typed: parseFrontmatter's `body` starts with the line break that
   ended the closing `---` (one it supplies itself for a file with no block),
   so every capture off real text starts one line "early" compared to the
   literal array a writer builds by hand. Dropped here, once, rather than
   adjusted at every call site. */
function withLeadExtra(capturedBefore, freshLines) {
  if (capturedBefore == null) return freshLines;
  const content = capturedBefore.split(/\r?\n/).slice(1);
  const n = freshLines.length;
  /* Decided LINE BY LINE, never by length. A captured lead no longer than
     the fixed shape used to be thrown away whole and regenerated, so a
     household that replaced the plugin's sentence with its own — same line
     count — lost its sentence on the next save, while one that ADDED a line
     kept it (2026-10-07 audit, L3-15, on a budget period's range note; the
     same rule serves the flat tables, Plans and Tax). A longer lead that
     matched everywhere but its first two lines had those two replaced unread,
     which lost text typed directly under the frontmatter fence.

     A SHORTER capture made only of the plugin's own lines — an older,
     shorter lead (Owed had one sentence before it had two), a title and
     nothing else, nothing at all — is regenerated whole, as before. Position
     is not trusted there (a line may have been deleted), so each line is
     matched against the whole fresh block, and only the first heading may
     claim the title. */
  if (content.length < n) {
    let titled = false;
    const plugins = l => {
      if (isTitleLine(l)) { const first = !titled; titled = true; return first && freshLines.some(isTitleLine); }
      return freshLines.some(f => !isTitleLine(f) && ownLeadLine(l, f));
    };
    if (content.every(plugins)) return freshLines;
  }
  /* Otherwise slot by slot over the fixed shape: a line that is still the
     plugin's own for its slot is regenerated; any other line is the
     household's and stays exactly where it is; everything past the fixed
     shape is replayed as found. A line is only ever swapped for ITS OWN
     slot's fresh line, and only when it is that line or the same generated
     sentence, so a household who inserted or deleted a line inside the block
     shifts the rest out of their slots and those are kept as found — nothing
     the plugin wrote is duplicated and nothing the household wrote is lost.
     The previous all-or-nothing alignment check is the special case where
     every slot matched. */
  const head = content.slice(0, n).map((l, i) => (ownLeadLine(l, freshLines[i]) ? freshLines[i] : l));
  return [...head, ...content.slice(n)];
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
  escMd, unescMd, escMdText, parseFrontmatter, parseMdTable, patchFrontmatter, yamlStr, unquoteYaml,
  parseMdTableWithSeparator, splitAroundTable, freshLeadLines, withLeadExtra, extraContent,
};
