'use strict';
/* A money cell nobody can read must survive a save.

   src/table-schema.js's money() reader ran `parseNum(c || '0')` and kept only
   `.value`, discarding `ok`/`raw`. parseNum's fallback for a cell it cannot
   read is 0 — deliberately, because every money column feeds arithmetic and JS
   has no "unreadable" numeric type to hand back. But the WRITE side then
   rendered that fallback as `0.00` and put it back on disk, so the next save
   of Assets.md, Debts.md, Owed Money.md or Services.md — triggered by an edit
   to some entirely different row — overwrote the reader's own text with a
   figure the file never stated.

   `| Ring | other | 12 000 R | 2026-01-01 | gift |` loaded as 0 and was
   rewritten as `| Ring | other | 0.00 | 2026-01-01 | gift |`. The value was
   gone, the fact that anything had been typed there was gone, and nothing on
   screen said so. That is data loss, and it is the app silently CORRECTING
   the reader instead of arguing with them.

   The transactions `amount` column has done this right since ADR-0003 landed:
   one cell, two fields, `amountRaw` written back verbatim. This test holds the
   four flat tables to the same contract — and to its two boundaries:

     1. Only the UNREADABLE cell keeps a raw. "15 000 000", "1 234,56" and
        "R4000" are cells normalizeAmount READS correctly, and those have
        always been rewritten canonically; tests/golden-tables.test.cjs pins
        those exact bytes, so keeping their raw would rewrite every table in
        every vault on upgrade — churn under iCloud sync, in exchange for
        nothing. The distinction is "could a number be derived at all", not
        "was the cell already canonical".

     2. A raw is written back only while the row still HOLDS the zero it
        produced. views/assets.js and views/debts.js edit these fields in place
        (`d.balance = Math.max(0, parseFloat(...))`) and, unlike
        views/budgets.js with amountRaw, have no way to clear a sibling they
        never knew about. Preferring the raw unconditionally would make an
        edit to a previously-unreadable cell vanish on save — the same bug one
        step to the left. So the number wins the moment it stops being 0.

   The money columns are DERIVED from the schemas (every right-aligned column),
   not listed here, so a money column appended tomorrow is covered the day it
   lands rather than the day someone remembers this file.

   Pure node — table-schema.js is the markdown.js/amount.js layer.
     node tests/schema-unreadable-money-cells.test.cjs */

const assert = require('assert');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { SCHEMAS, rowLine, rowToObject } = require('../src/table-schema');
const { parseNum } = require('../src/amount');

/* A full, readable row per flat table — the same shape
   tests/table-schema-guards.test.cjs sweeps, so a column added there and not
   here goes red on length rather than passing quietly. */
const READABLE = {
  assets: ['A \\| a', 'property', '1 500,00', '2026-03-01', 'n \\| n', '€'],
  owed: ['P \\| p', 'R4000', 'd \\| d', '2026-09-01', 'PAID', '1 000,00', '2026-01-01', '€'],
  services: ['S \\| s', 'Prov', '199.00', 'ANNUAL', '2026-08-05', 'Cat', 'NO', 'n \\| n', '€'],
  debts: ['D \\| d', 'L \\| l', 'vehicle', '1 234,56', '12000.00', '22.50', '400.00', '150.00', '2024-03-01', 'Cat', 'PAID', 'n \\| n', '€'],
};

/* Cells a human really types into these files and normalizeAmount really
   refuses: a currency code on the wrong side of the number (the trailing-strip
   needs two ASCII letters, so a lone "R" is left attached), and a rate written
   as the thing it tracks rather than as a number. Both come back null from
   normalizeAmount, so parseNum's value is a fabricated 0. */
const UNREADABLE = ['12 000 R', 'prime + 2', 'TBC', 'ask Dad'];

const FLAT = ['assets', 'owed', 'services', 'debts'];
const moneyIndexes = schema => schema.columns
  .map((c, i) => (c.align === 'right' ? i : -1)).filter(i => i >= 0);

/* ---- 1. every money column of every flat table keeps an unreadable cell ---- */
for (const name of FLAT) {
  const schema = SCHEMAS[name];
  const idxs = moneyIndexes(schema);
  assert.ok(idxs.length, `${name}: must have at least one money column to guard`); checks++;

  for (const i of idxs) {
    const col = schema.columns[i];
    for (const bad of UNREADABLE) {
      const cells = [...READABLE[name]];
      cells[i] = bad;
      const row = rowToObject(schema, cells);

      eq(row[col.key], 0, `${name}.${col.key}: an unreadable cell still falls back to 0 for arithmetic`);
      eq(row[col.key + 'Raw'], bad,
        `${name}.${col.key}: …and keeps the reader's own text for write-back`);

      const line = rowLine(schema, row);
      eq(line.split(' | ')[i].trim(), bad,
        `${name}.${col.key}: the save writes "${bad}" back verbatim, never "0.00" over it`);
    }
  }
}

/* ---- 2. a readable cell is still rewritten canonically (the golden gate) ---- */
for (const name of FLAT) {
  const schema = SCHEMAS[name];
  const row = rowToObject(schema, READABLE[name]);
  for (const i of moneyIndexes(schema)) {
    const col = schema.columns[i];
    eq(row[col.key + 'Raw'], undefined,
      `${name}.${col.key}: a cell normalizeAmount CAN read carries no raw — ` +
      'tests/golden-tables.test.cjs pins those canonical bytes, and a raw here ' +
      'would rewrite every table in every vault on upgrade');
    eq(rowLine(schema, row).split(' | ')[i].trim(), row[col.key].toFixed(2),
      `${name}.${col.key}: …and is written canonically, exactly as it always was`);
  }
}

/* An empty cell is not "unreadable" — it is absent, and absent has always
   meant 0.00 on these tables. A blank-but-present cell (spaces) is the same
   fact wearing whitespace, and must not be written back as whitespace. */
for (const name of FLAT) {
  const schema = SCHEMAS[name];
  for (const i of moneyIndexes(schema)) {
    const col = schema.columns[i];
    for (const blank of ['', '   ']) {
      const cells = [...READABLE[name]];
      cells[i] = blank;
      const row = rowToObject(schema, cells);
      eq(row[col.key + 'Raw'], undefined,
        `${name}.${col.key}: an empty cell keeps no raw — nothing was typed to preserve`);
    }
  }
}

/* ---- 3. an edit beats the kept raw ---- */
/* The views mutate these fields in place and cannot clear a sibling key they
   have never heard of, so the write side decides: the raw stands only while
   the row still holds the 0 that raw produced. */
for (const name of FLAT) {
  const schema = SCHEMAS[name];
  for (const i of moneyIndexes(schema)) {
    const col = schema.columns[i];
    const cells = [...READABLE[name]];
    cells[i] = '12 000 R';
    const row = rowToObject(schema, cells);
    row[col.key] = 12000;                       // what views/assets.js's onchange does
    eq(rowLine(schema, row).split(' | ')[i].trim(), '12000.00',
      `${name}.${col.key}: a figure typed into the UI is saved, not swallowed by the stale raw`);
  }
}

/* ---- 4. the contract this rests on, asserted at its source ---- */
/* parseNum.readable is what separates "0 because the file says 0" and "0
   because nobody can read this" — a distinction its `ok` flag does NOT make:
   `ok` means "already in the app's canonical on-disk form", and "1 234,56" is
   readable while failing it. Reading one as the other is what would put the
   golden bytes at risk. */
eq(parseNum('0').readable, true, 'a stated zero is readable');
eq(parseNum('-12.50').readable, true, 'so is a canonical negative');
eq(parseNum('1 234,56').readable, true, 'a hand-grouped cell is readable though not canonical (ok:false)');
eq(parseNum('1 234,56').ok, false, '…and `ok` is the separate question it has always been');
eq(parseNum('R4000').readable, true, 'a currency prefix is read, not refused');
eq(parseNum('12 000 R').readable, false, 'a trailing lone code is NOT readable — its 0 is fabricated');
eq(parseNum('prime + 2').readable, false, 'nor is a rate written as prose');
eq(parseNum('').readable, false, 'an empty cell reads no number either — callers default it before asking');

console.log(`schema-unreadable-money-cells.test.cjs — ${checks} checks OK`);
