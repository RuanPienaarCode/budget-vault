'use strict';
/* Export — turning what is on screen into a file another program can read.

   The vault already holds every transaction as plain markdown, so this is a
   RE-SHAPING, not a rescue. What it adds is a format spreadsheets open and one
   consolidated file instead of one per month per account, which is what an
   accountant, a tax return or a pivot table actually needs.

   Two formats, and no PDF engine. CSV is for spreadsheets. Markdown is for
   reading, and for Obsidian's own "Export to PDF" on desktop — which is why
   there is no bundled PDF library: main.js is 410KB and the smallest credible
   PDF engine is ~350KB, an 85% bundle increase to draw a table. That is the
   same trade the charting library was refused for in 1.4.0, and the answer is
   the same. Obsidian already renders markdown to PDF; the plugin does not need
   to learn how.

   Pure — no DOM, no obsidian import, no vault access — so tests/exporter.test
   drives it in bare node. Callers hand it rows and get strings back; writing
   them is views/transactions.js's job.

   AMOUNTS ARE RAW IN CSV AND FORMATTED IN MARKDOWN, deliberately. A spreadsheet
   needs -1234.56 to do arithmetic on; "R -1 234,56" imports as text and every
   SUM over the column silently returns zero. The markdown is for a person, so
   it carries the currency and the thousands separators the app uses on screen.

   EXCLUDED ROWS ARE EXPORTED, and carry a column saying so. The glossary is
   explicit that an excluded transaction is vetoed from income and spend totals,
   not hidden — dropping them here would make an export disagree with the app it
   came from, and the reader would have no way to see why.

   SPLIT PARENTS ARE EXPORTED TOO, for the same reason and one more: the parent
   stays on disk after a split precisely so a re-import can't re-add the bank's
   original line on top of its own parts (src/tx-role.js). Dropping it from the
   export would make the CSV a worse audit trail than the vault file it came
   from. What it needs is not removal but a label: a Split column, same shape
   as serializeTxFile already writes into the vault, so a parent (Split:
   "parent") reads differently from a transfer (Split: "" but Excluded: yes) —
   the one distinction `Excluded` alone can never make, because both mean
   "vetoed from totals" and only one of them means "described twice". */

/* csvCell is imported, not injected. It used to be handed in as a `cell`
   argument because it lived in util.js, which pulled in obsidian and would have
   stopped this module running in bare node; the util.js split left it in a pure
   src/csv.js, so the parameter was scaffolding for a constraint that no longer
   exists. `money` further down is still injected, for a real reason: it is the
   view's own locale-aware formatter, not a fixed escaping rule. */
const { csvCell } = require('./csv');
/* splitRole only — this module reads it exactly the way serializeTxFile does
   (src/views/transactions.js's `roleOf`), never as a third hand-copy of
   `r.split === 'parent'`. See src/tx-role.js for why that string got its own
   module: `excluded` already carries a different, unrelated meaning
   (transfer, still real money) and cannot be reused to mean "phantom row,
   described elsewhere" too. */
const { splitRole } = require('./tx-role');
/* SCHEMAS.transactions is the ONE declaration of the transaction columns
   (docs/adr/0003-columns-are-declared-once.md) — append-only, guarded by a
   tripwire and a byte-golden gate over in src/table-schema.js, which this
   module does not touch. TX_HEAD reads that declaration instead of holding a
   fourth hand-written copy of the column order (the vault file, the loader
   and the byte-golden test are the other three): a column appended there
   used to reach the vault, the loader and the golden gate while silently
   never reaching either export, with nothing going red to say so. `Account`
   is spliced in at index 2 because it is a real column on screen but not one
   the schema models — a transaction's account is which file it lives in, not
   a cell in it. */
const { SCHEMAS } = require('./table-schema');
const TX_HEAD = (() => {
  const h = SCHEMAS.transactions.columns.map(c => c.header);
  h.splice(2, 0, 'Account');
  return h;
})();
const TX_ALIGN = (() => {
  const a = SCHEMAS.transactions.columns.map(c => c.align);
  a.splice(2, 0, 'left');
  return a;
})();
/* Same derivation as table-schema.js's own headerLines — dash count equals
   the header cell's width, a right-aligned column trades its last dash for
   the colon — kept as its own small copy rather than a call into that module
   because headerLines takes a `schema` (columns carry their own read/write),
   and TX_HEAD/TX_ALIGN describe a row shape table-schema.js was never asked
   to model (Account is on-screen, not a transaction-file column). */
function txHeaderLines() {
  const header = `| ${TX_HEAD.join(' | ')} |`;
  const sep = '|' + TX_HEAD.map((h, i) => {
    const width = h.length + 2;
    return TX_ALIGN[i] === 'right' ? '-'.repeat(width - 1) + ':' : '-'.repeat(width);
  }).join('|') + '|';
  return [header, sep];
}
/* escMd is markdown.js's, not a local copy. This USED to be its own
   pipes-only escaper, and that was the bug: markdown.js's escMd also turns a
   real newline into `<br>`, because a wrapped Description/Note/Category cell
   is a normal thing for a hand-typed vault file to hold and unescMd turns it
   back into `\n` on load (src/load.js). A row that reaches this module with a
   raw `\n` inside a cell and gets only the pipe-escape is written as a SECOND
   line that doesn't start with `|` — which doesn't just mangle that row, it
   ends the markdown table, so every transaction after it renders as plain
   paragraph text instead of a row. See tests/exporter.test.cjs's "wrapped
   cell" case, proven against the same fixture value
   tests/vault-roundtrip.test.cjs uses ("multi<br>line" on disk, "multi\nline"
   in state). */
const { escMd } = require('./markdown');

/* Where exports land. A folder of its own so an export is never mistaken for
   one of the vault's own data files, and so deleting the lot is one action. */
const EXPORT_DIR = 'Exports';

/* Characters a vault path cannot carry. Ranges are built from period names the
   user controls (a household could name a period anything), so this runs over
   every generated filename rather than trusting the caller. */
function safeName(s) {
  const cleaned = String(s ?? '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
  /* A name of nothing but dots is "." or ".." — a traversal, not a name, and
     the one input that survives the character filter above untouched because
     a dot is legal in a filename everywhere else. Caught here so the traversal
     never reaches a path at all; io.js refuses it a second time at the write,
     and neither ring is allowed to be the only one that works. */
  return /^\.+$/.test(cleaned) ? 'export' : (cleaned || 'export');
}

/* ------------------------------- CSV ---------------------------------- */

/* Amounts do NOT go through csvCell, and this is the whole reason this function
   exists.

   csvCell prefixes anything starting with = + - or @ with a quote, so a
   description cannot execute as a formula when the file is opened in Excel.
   Applied to an amount that rule is a bug: every negative number becomes
   "'-250.50", which imports as TEXT, and every SUM over the column silently
   returns zero. A column of correct-looking figures that will not add up is
   about the worst thing an export can produce, because nothing announces it.

   ALWAYS row.amount, NEVER row.amountRaw — deliberately, and this used to be
   the other way round. amountRaw is the loader's "I could not strictly parse
   this on-disk cell, keep the human's exact text for the SERIALIZER to write
   back unchanged" flag (src/load.js, src/amount.js) — right for the vault
   file, which must round-trip a hand-typed "1 234,56" byte for byte. A CSV
   export has no such duty and exactly one job for this column: a number a
   spreadsheet can add. Writing amountRaw here fails BOTH ends of that job —
   the value fails the bare-number test below, so csvCell quotes it, so Excel
   reads it as text and SUM silently treats the row as zero, while
   transactionsMarkdown (which always uses `amount`, the parser's numeric best
   guess, and is right to) counts the real figure. Two files written by one
   click that disagree, and nothing on either announces it. `amount` is that
   same numeric best guess — normalizeAmount already turned "1 234,56 CR" into
   1234.56 before amountRaw was ever set — so using it here is not a loss of
   precision, only a stop to re-deriving amountRaw's OWN reason for existing
   (round-tripping the vault file) as if it were also a reason to break the
   export's arithmetic. */
function amountCell(row) {
  return Number(row.amount || 0).toFixed(2);
}

function transactionsCsv(rows) {
  const head = TX_HEAD;
  const body = rows.map(r => [
    csvCell(r.date),
    csvCell(r.desc),
    csvCell(r.label),
    csvCell(r.cat || ''),
    amountCell(r),
    csvCell(r.excluded ? 'yes' : ''),
    csvCell(r.note || ''),
    csvCell(splitRole(r.split)),
  ].join(','));
  return [head.map(csvCell).join(','), ...body].join('\n') + '\n';
}

function categoriesCsv(categories) {
  const head = ['Name', 'Type', 'Colour'];
  const body = (categories || []).map(c => [c.name, c.type || '', c.color || ''].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...body].join('\n') + '\n';
}

/* ----------------------------- Markdown -------------------------------- */

/* One transaction row, rendered as a markdown table cell — the ONE place that
   decides how a row looks in a table shaped like TX_HEAD. Factored out of
   transactionsMarkdown's own loop so views/report.js's transaction-detail
   section (src/report.js) draws every row exactly the way an export does,
   instead of a second hand-written template drifting from this one the way
   income and saving-rate already have drifted from each other elsewhere in
   this codebase. splitRole, not r.split raw — see the loop below, this is
   the same call, only moved. */
function transactionRow(r, money) {
  return `| ${r.date} | ${escMd(r.desc)} | ${escMd(r.label)} | ${escMd(r.cat)} | ${money(r.amount)} | ${r.excluded ? 'yes' : ''} | ${escMd(r.note)} | ${splitRole(r.split)} |`;
}

/* `money` is the view's own formatter, injected because the export must read in
   the household's currency and separators — and that is a runtime setting off
   ctx, not something a pure module can know. */
function transactionsMarkdown(rows, meta, money) {
  const { range, filters, generated } = meta;
  const included = rows.filter(r => !r.excluded);
  const inTotal = included.filter(r => r.amount > 0).reduce((t, r) => t + r.amount, 0);
  const outTotal = included.filter(r => r.amount < 0).reduce((t, r) => t + r.amount, 0);

  const out = [
    '---',
    'generated: ' + generated,
    'range: ' + JSON.stringify(String(range)),
    '---',
    '',
    '# Transactions',
    '',
    `**${range}** · ${rows.length} row${rows.length === 1 ? '' : 's'}`,
  ];
  if (filters.length) out.push('', 'Filtered by: ' + filters.join(' · '));
  out.push(
    '',
    `Money in **${money(inTotal)}** · money out **${money(outTotal)}** · net **${money(inTotal + outTotal)}**`,
    '',
    /* Said plainly rather than left for the reader to work out from a column
       of blanks: a total that ignores some listed rows has to explain itself. */
    ...(rows.length !== included.length
      ? [`Totals cover ${included.length} of ${rows.length} rows — excluded rows are listed but not counted.`, '']
      : []),
    ...txHeaderLines(),
  );
  // splitRole, not r.split raw: same reason serializeTxFile reads it this
  // way — only two strings are ever legal here, so the cell never needs
  // escMd, and a stray hand-typed word in the source column reads as ''.
  for (const r of rows) out.push(transactionRow(r, money));
  return out.join('\n') + '\n';
}

function categoriesMarkdown(categories, generated) {
  const list = categories || [];
  const byType = new Map();
  for (const c of list) {
    const k = (c.type || '').trim() || 'other';
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k).push(c);
  }
  const out = ['---', 'generated: ' + generated, '---', '', '# Categories', '',
    `${list.length} categor${list.length === 1 ? 'y' : 'ies'}`, ''];
  for (const [type, cats] of [...byType].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`## ${type}`, '', '| Name | Colour |', '|------|--------|');
    for (const c of cats.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`| ${escMd(c.name)} | ${escMd(c.color)} |`);
    }
    out.push('');
  }
  return out.join('\n') + '\n';
}

/* ----------------------------- filenames ------------------------------- */

/* Named by WHAT IS IN THEM, not by when they were made. Re-exporting the same
   range overwrites the earlier file, which is what a reader who just fixed a
   category and exported again expects — a folder accumulating
   "Transactions (3).csv" is a worse outcome than a file that is simply current.
   The generated timestamp lives inside the markdown for anyone who needs it. */
/* `folder` is vault-relative and comes from the export dialog. Each SEGMENT is
   sanitised rather than the whole string, so a nested destination like
   "Admin/Tax 2026" survives while a "../" segment cannot: safeName turns the
   dots into dashes, and io.js's guardedVaultPath refuses anything that still
   resolves outside the vault. Two rings, because this path is user input and
   the file write is the thing that cannot be taken back. */
function exportPaths(range, folder) {
  const dir = String(folder || EXPORT_DIR).split('/')
    /* Dropped, not sanitised: turning "../../secrets" into "export/export/
       secrets" would honour a traversal attempt by inventing two folders for
       it. Removing the segments resolves it to the folder actually named. */
    .filter(seg => seg.trim() && !/^\.+$/.test(seg.trim()))
    .map(safeName).join('/') || EXPORT_DIR;
  const base = `${dir}/Transactions ${safeName(range)}`;
  return {
    dir,
    txCsv: `${base}.csv`,
    txMd: `${base}.md`,
    catCsv: `${dir}/Categories.csv`,
    catMd: `${dir}/Categories.md`,
  };
}

module.exports = {
  EXPORT_DIR, safeName,
  transactionsCsv, categoriesCsv, transactionsMarkdown, categoriesMarkdown, exportPaths,
  /* txHeaderLines and transactionRow: published so views/report.js's own
     transaction-detail table (src/report.js) is built from the SAME column
     order and row template as this file's own export, rather than a fourth
     hand-written copy of TX_HEAD's shape. */
  txHeaderLines, transactionRow,
};
