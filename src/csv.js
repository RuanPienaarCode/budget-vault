'use strict';
/* Delimited text, read and written.

   The generic layer under src/statement.js: this module knows about quoting,
   escaping and separators, and nothing about banks or transactions. Split that
   way because the two halves have opposite trust levels — parseCsv reads files
   THIS APP wrote (the categorisation rules), where the delimiter is known,
   while a foreign statement has to have its delimiter guessed. Conflating them
   is how a rule whose pattern contains a semicolon gets silently corrupted.

   Pure — no DOM, no obsidian import. */

function parseDelimited(text, delim) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      /* ISSUE 51. A quote opens a quoted field only at the START of one.

         This read `else if (ch === '"')` — a quote ANYWHERE entered quoting
         mode, so in an otherwise unquoted export every delimiter and newline
         after it was absorbed into that field until the next quote. RFC 4180
         only opens a quoted field on the first character of the field, and
         every lenient reader treats a mid-field quote as a literal.

         Measured on a twelve-row statement carrying two ordinary South
         African merchant names, `BUILDERS 15" HOSE` and `CASHBUILD 24" PIPE`:
         thirteen lines parsed to SIX rows, seven transactions swallowed into
         one merged field dated 2026-01-04. And because that merged row still
         carried a date, a description and an amount, views/import.js's skip
         counter reported "0 unparseable" — the loss was a hole in the middle
         of an import that looked entirely normal. An inch mark is not an edge
         case in hardware, tyres, plumbing or screens.

         `field.trim() === ''` rather than `field === ''` on purpose: a bank
         that writes `Date, "Description"` puts a space between the delimiter
         and the quote, and that file has always been read as quoted. Keeping
         the accumulated whitespace in `field` preserves what this function
         already returned for it. */
      inQ = true;
    }
    else if (ch === delim) { row.push(field); field = ''; }
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
/* Comma-delimited, always. This is the app's OWN files — Data/Categorisation
   Rules.csv, written by csvCell — where the delimiter is known and sniffing it
   would be a way to corrupt a rule whose pattern happens to contain a
   semicolon. Foreign statements go through parseStatement instead. */
const parseCsv = text => parseDelimited(text, ',');

/* Which character separates the fields of a statement we did not write?
   Comma is the SA/US/UK default, but a bank exporting for a comma-decimal
   locale writes semicolons ("1.234,56;GROCER;01/02/2026"), and "export to
   text" paths hand out tabs. Guessing wrong doesn't fail loudly — it yields
   one giant field per row, which reaches detectStatementColumns as an
   unrecognisable file and sends the user to the manual mapper with nothing
   useful to map.

   Scored by how many delimiters land inside a CONSISTENT block of rows, not
   by raw frequency: on a semicolon file the commas are decimal separators and
   are genuinely numerous, but they produce a ragged field count while the
   semicolons produce a square one. `agree * (mode - 1)` is the number of
   separators participating in that square block, which reads both signals as
   one number. Comma is tested first and ties are kept, so an ordinary CSV can
   never be talked out of being an ordinary CSV. */
const DELIMS = [',', ';', '\t', '|'];
function sniffDelimiter(text) {
  const sample = text.slice(0, 65536);
  let best = ',', bestScore = 0;
  for (const d of DELIMS) {
    const counts = parseDelimited(sample, d).map(r => r.length).filter(n => n > 1);
    if (!counts.length) continue;
    // Modal field count, and how many rows agree with it.
    const freq = new Map();
    for (const n of counts) freq.set(n, (freq.get(n) || 0) + 1);
    let mode = 0, agree = 0;
    for (const [n, c] of freq) if (c > agree) { mode = n; agree = c; }
    const score = agree * (mode - 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/* Quote a value for a CSV cell. Beyond the usual quote/comma/newline rules,
   a leading =, +, -, @, tab or CR makes the cell a live formula in Excel and
   LibreOffice. The categorisation rules file is written from bank statement
   descriptions — which anyone who can send the user a payment reference gets
   to influence — and it is explicitly a file the user opens in a spreadsheet.
   Prefix those with an apostrophe so they stay inert. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["',\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { parseDelimited, parseCsv, sniffDelimiter, csvCell };
