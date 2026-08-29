'use strict';
/* The two enforcement tests docs/adr/0003-columns-are-declared-once.md
   promises. Neither is the mirror anti-pattern this ADR deletes: the old
   mirror re-implemented PARSING and could stay green while behaviour
   drifted. A frozen order list cannot drift silently — going red is its
   whole job.

     node tests/table-schema-guards.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { SCHEMAS, rowToObject } = require('../src/table-schema');

/* ---------------- the tripwire: append is the only cheap operation --------

   These lists are HISTORY, not configuration. Every sequence below is the
   column order of files already written into user vaults by shipped
   versions. Appending a new column passes this test silently; reordering,
   renaming or inserting mid-table goes red — which means you are about to
   shear every later value into the wrong field of every file on disk.
   Read docs/adr/0003-columns-are-declared-once.md before editing a frozen
   list; the only legitimate edit is appending to the END of one. */

/* `currency` was APPENDED to four of these on 2026-08-29 (issue #30) — the
   only edit ADR-0003 permits, and the frozen prefix below is unchanged, which
   is the property that matters: every file already on disk still parses into
   exactly the fields it always did, and a blank cell means the household's
   currency, which is what those files say by saying nothing.

   Transactions is deliberately NOT among them: a transaction's currency is a
   property of the account whose FOLDER it lives in, so a column here would be
   a second place to state one fact, and the two could disagree row by row. */
const FROZEN = {
  assets: ['name', 'type', 'value', 'valued', 'notes', 'currency'],
  owed: ['person', 'amount', 'description', 'due', 'status', 'repaid', 'lent', 'currency'],
  services: ['name', 'provider', 'amount', 'cycle', 'next', 'category', 'active', 'notes', 'currency'],
  debts: ['name', 'lender', 'type', 'balance', 'original', 'rate', 'payment', 'extra', 'start', 'category', 'status', 'notes', 'currency'],
  transactions: ['date', 'desc', 'cat', 'amount', 'excluded', 'note', 'split'],
};

eq(Object.keys(SCHEMAS).sort(), Object.keys(FROZEN).sort(),
  'every schema is frozen and every frozen list has a schema — additions register here');

for (const [name, frozen] of Object.entries(FROZEN)) {
  const live = SCHEMAS[name].columns.map(c => c.key);
  eq(live.slice(0, frozen.length), frozen,
    `${name}: the live column order must START WITH its shipped history — ` +
    'reordering/renaming/inserting corrupts every file on disk (ADR-0003; append only)');
  assert.ok(live.length >= frozen.length,
    `${name}: a shipped column can never be removed — files on disk still carry it`);
  checks++;
}

/* ---------------- the truncation sweep: every column tolerates absence ----

   Files written before a column existed are still on disk, so a row
   truncated at ANY length must read cleanly, every missing field landing on
   its documented default. This is what made the Split column safe to append
   to a positional parser — and this sweep makes that property mechanical
   for every column anyone appends in future, instead of a review-time
   reminder. The defaults are literals (the independent source of truth:
   what the shipped loader yields for an absent cell), not recomputed. */

const FULL_CELLS = {
  assets: ['A \\| a', 'property', '1 500,00', '2026-03-01', 'n \\| n', '€'],
  owed: ['P \\| p', 'R4000', 'd \\| d', '2026-09-01', 'PAID', '1 000,00', '2026-01-01', '€'],
  services: ['S \\| s', 'Prov', '199.00', 'ANNUAL', '2026-08-05', 'Cat', 'NO', 'n \\| n', '€'],
  debts: ['D \\| d', 'L \\| l', 'vehicle', '1 234,56', '12000.00', '22.50', '400.00', '150.00', '2024-03-01', 'Cat', 'PAID', 'n \\| n', '€'],
  transactions: ['2026-07-04', 'De \\| sc', 'Cat', '1 234,56', 'yes', 'no \\| te', 'parent'],
};

const FULL_EXPECTED = {
  assets: { name: 'A | a', type: 'property', value: 1500, valued: '2026-03-01', notes: 'n | n', currency: '€' },
  owed: { person: 'P | p', amount: 4000, description: 'd | d', due: '2026-09-01', status: 'paid', repaid: 1000, lent: '2026-01-01', currency: '€' },
  services: { name: 'S | s', provider: 'Prov', amount: 199, cycle: 'annual', next: '2026-08-05', category: 'Cat', active: false, notes: 'n | n', currency: '€' },
  debts: { name: 'D | d', lender: 'L | l', type: 'vehicle', balance: 1234.56, original: 12000, rate: 22.5, payment: 400, extra: 150, start: '2024-03-01', category: 'Cat', status: 'paid', notes: 'n | n', currency: '€' },
  transactions: { date: '2026-07-04', desc: 'De | sc', cat: 'Cat', amount: 1234.56, amountRaw: '1 234,56', excluded: true, note: 'no | te', split: 'parent' },
};

const DEFAULTS = {
  assets: { name: '', type: 'other', value: 0, valued: '', notes: '', currency: '' },
  owed: { person: '', amount: 0, description: '', due: '', status: 'outstanding', repaid: 0, lent: '', currency: '' },
  services: { name: '', provider: '', amount: 0, cycle: 'monthly', next: '', category: '', active: true, notes: '', currency: '' },
  debts: { name: '', lender: '', type: 'other', balance: 0, original: null, rate: 0, payment: 0, extra: 0, start: '', category: '', status: 'active', notes: '', currency: '' },
  // A zero-length transaction row cannot exist on disk (parseMdTable yields
  // at least one cell), but the sweep proves the floor anyway: date keeps
  // the loader's verbatim read (undefined), amountRaw keeps parseNum's
  // empty raw — both exactly what the shipped loader yields today.
  transactions: { date: undefined, desc: '', cat: '', amount: 0, amountRaw: '', excluded: false, note: '', split: '' },
};

for (const [name, cells] of Object.entries(FULL_CELLS)) {
  const schema = SCHEMAS[name];
  eq(rowToObject(schema, cells), FULL_EXPECTED[name],
    `${name}: the full row reads to its expected literal`);
  for (let len = 0; len < cells.length; len++) {
    const obj = rowToObject(schema, cells.slice(0, len));
    /* Fields owned by the columns that DID get a cell keep their full-row
       values; every field past the truncation lands on its default. The
       key list per column comes from the read itself, but every VALUE
       asserted is a literal. */
    const expected = { ...DEFAULTS[name] };
    for (let i = 0; i < len; i++) {
      for (const k of Object.keys(schema.columns[i].read(cells[i]))) {
        expected[k] = FULL_EXPECTED[name][k];
      }
    }
    eq(obj, expected, `${name}: a row truncated at ${len} column(s) reads to defaults, never throws`);
  }
}

console.log(`table-schema-guards.test.cjs — ${checks} checks OK (tripwire + truncation sweep)`);
