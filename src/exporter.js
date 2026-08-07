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
   came from, and the reader would have no way to see why. */

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

/* `cell` is util.js's csvCell, injected rather than imported: util.js pulls in
   obsidian, which would stop this module running in bare node — and the
   escaping rule (including the leading-quote guard that stops a description
   beginning with = or + executing as a formula in Excel) is worth having in
   exactly one place rather than reimplemented here. */
/* Amounts do NOT go through csvCell, and this is the whole reason this function
   exists.

   csvCell prefixes anything starting with = + - or @ with a quote, so a
   description cannot execute as a formula when the file is opened in Excel.
   Applied to an amount that rule is a bug: every negative number becomes
   "'-250.50", which imports as TEXT, and every SUM over the column silently
   returns zero. A column of correct-looking figures that will not add up is
   about the worst thing an export can produce, because nothing announces it.

   So: a value that IS a plain number is written bare — it needs no escaping,
   since a number contains no comma, quote or newline. Anything else is
   untrusted (amountRaw is the verbatim cell from a file the loader could not
   parse, and could hold anything at all) and gets the full csvCell treatment,
   formula guard included. */
function amountCell(row, cell) {
  const v = row.amountRaw != null ? row.amountRaw : Number(row.amount || 0).toFixed(2);
  return /^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : cell(v);
}

function transactionsCsv(rows, cell) {
  const head = ['Date', 'Description', 'Account', 'Category', 'Amount', 'Excluded', 'Note'];
  const body = rows.map(r => [
    cell(r.date),
    cell(r.desc),
    cell(r.label),
    cell(r.cat || ''),
    amountCell(r, cell),
    cell(r.excluded ? 'yes' : ''),
    cell(r.note || ''),
  ].join(','));
  return [head.map(cell).join(','), ...body].join('\n') + '\n';
}

function categoriesCsv(categories, cell) {
  const head = ['Name', 'Type', 'Colour'];
  const body = (categories || []).map(c => [c.name, c.type || '', c.color || ''].map(cell).join(','));
  return [head.map(cell).join(','), ...body].join('\n') + '\n';
}

/* ----------------------------- Markdown -------------------------------- */

/* A pipe inside a cell ends the cell. Escaped rather than stripped so a
   description reads the way the bank sent it. */
function escMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

/* `money` is the view's own formatter, injected for the same reason `cell` is:
   the export must read in the household's currency and separators, and that
   lives on ctx rather than in a pure module. */
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
    '| Date | Description | Account | Category | Amount | Excluded | Note |',
    '|------|-------------|---------|----------|-------:|----------|------|',
  );
  for (const r of rows) {
    out.push(`| ${r.date} | ${escMd(r.desc)} | ${escMd(r.label)} | ${escMd(r.cat)} | ${money(r.amount)} | ${r.excluded ? 'yes' : ''} | ${escMd(r.note)} |`);
  }
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
  EXPORT_DIR, safeName, escMd,
  amountCell, transactionsCsv, categoriesCsv, transactionsMarkdown, categoriesMarkdown, exportPaths,
};
