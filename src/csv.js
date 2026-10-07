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
   semicolon. Foreign statements go through parseStatement instead. Each cell
   it returns still carries csvCell's formula guard; uncsvCell below takes it
   off. */
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

/* C0 control characters, except tab, LF and CR (those three are legal inside
   a quoted cell and can be real text). A NUL in a bank description reached
   both export CSVs and python's csv module refused the whole file with "line
   contains NUL" (2026-10-07 audit, L4A-11). The XLSX writer already dropped
   these and the PDF writer already stripped them, so the CSVs were the only
   files that kept them. Exported because rules.js folds the same characters
   out of what it matches, for the reason given at its ruleText(). */
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const stripControls = s => String(s ?? '').replace(CONTROLS, '');

/* Does a cell need the formula guard? A cell is a live formula in Excel and
   LibreOffice when it starts with = + - @, or with a tab or CR. The guard
   used to check the first character only, which let two shapes through
   (2026-10-07 audit, CSV-VARIANTS):
     ` =1+1`   leading whitespace (a space, a no-break space, an ideographic
               space), which a reader that trims before it parses removes
     `＝1+1`   the full-width signs ＝ ＋ － ＠, for a reader that folds
               full-width input to ASCII
   The audit printed the bytes and did not run a spreadsheet, so which
   readers actually evaluate these is unconfirmed. Guarding them costs one
   apostrophe on a cell that starts that way, and no real description in the
   audited vault did. So the guard checks the first character that is not
   whitespace, and the full-width signs with the ASCII ones.

   Leading apostrophes are skipped before the test. That keeps the guard
   reversible: a cell that already starts with `'` and then a formula sign
   gets a second apostrophe, so uncsvCell can always remove exactly the one
   csvCell added and never one that was part of the text. */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@＝＋－＠])/;
const needsGuard = s => FORMULA_START.test(s.replace(/^'+/, ''));

/* Quote a value for a CSV cell. Beyond the usual quote/comma/newline rules,
   a cell that would start a live formula (needsGuard above) gets an
   apostrophe in front so it stays inert. The categorisation rules file is
   written from bank statement descriptions — which anyone who can send the
   user a payment reference gets to influence — and it is explicitly a file
   the user opens in a spreadsheet.

   A cell holding a ; or a tab is quoted as well as one holding a comma. A
   reader in a semicolon locale, or one that splits on tabs, would otherwise
   cut `x;=1+1` into a second cell starting with `=`. Quoted, any of them
   keeps it whole, and parseCsv reads it back the same. Control characters go
   first, so a NUL cannot hide a formula sign from the guard and then drop
   out.

   Numbers never come through here: exporter.js amountCell and
   budget-export.js num() write amounts raw, because a guarded "-250.50" is
   text and every SUM over the column skips it. */
function csvCell(v) {
  let s = stripControls(v);
  if (needsGuard(s)) s = `'${s}`;
  return /["',;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* The reader's half of csvCell's formula guard. Strip ONE leading apostrophe
   when what follows is a cell the guard would have guarded, and nothing
   else. A spreadsheet treats that apostrophe as a text marker and hides it,
   so this is the same reading, not a new rule.

   It used to have no reader half at all (2026-10-07 audit, L3-06). The rules
   file is the one CSV this app writes AND reads, so a rule learned from
   `@PARKING …` went to disk as `'@PARKING …`, came back from parseCsv with
   the apostrophe, and never matched its own merchant again. The next import
   then learned the description afresh and appended another dead copy, one
   per import. An apostrophe that guards nothing (`'tis`, `O'Brien`) is text
   and is left alone. */
function uncsvCell(s) {
  const v = String(s ?? '');
  return v[0] === "'" && needsGuard(v.slice(1)) ? v.slice(1) : v;
}

module.exports = { parseDelimited, parseCsv, sniffDelimiter, csvCell, uncsvCell, stripControls };
