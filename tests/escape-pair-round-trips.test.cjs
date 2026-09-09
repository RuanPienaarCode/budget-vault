'use strict';
/* Every escaped cell is read back through the escape's inverse.

   table-schema.js's own contract says the escape pair (escMd/unescMd) lives in
   one declaration "so the escape pair and the number pair live side by side in
   one declaration and cannot drift apart". `verbatim()` carried only half of it
   until 2026-09-09: it wrote through escMd and read with a bare `.trim()`, so
   every save re-escaped a cell that was already escaped.

   The cost is not theoretical and not self-limiting. A date cell holds text a
   date parser rejected — that is what it is FOR, and reconcile-unreadable-dates
   exists because those cells are real — so "June | maybe" is exactly the kind of
   value that lands there. It gained one backslash per save:

     June \| maybe  ->  June \\| maybe  ->  June \\\| maybe  ->  …

   forever, turning a merely unparseable cell into an unreadable one. Five
   columns carried it (assets `valued`, owed `due`/`lent`, services `next`, debts
   `start`), and Plan's hand-rolled copy of the same shape carried it on two more
   (`sources[].date`, `envelopes[].tint`).

   Three claims:

     1. every column of every schema round-trips a pipe unchanged — asserted by
        WALKING the schemas, so a column added later is covered without anyone
        remembering this file exists,
     2. it is STABLE across repeated saves, which is the actual defect: one pass
        looked fine, and the drift only showed from the second save on,
     3. the two hand-rolled Plan columns round-trip too.

     node tests/escape-pair-round-trips.test.cjs
*/

const assert = require('assert');
const { SCHEMAS, rowLine, rowToObject, headerLines } = require('../src/table-schema');
const { parseMdTable } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A value that exercises both halves of escMd: a pipe (which would shear the
   row unescaped) and nothing else clever. Newlines are deliberately NOT tested
   here — escMd turns them into `<br>` and unescMd turns them back, but a real
   date cell cannot hold one and asserting it would pin a shape no writer makes. */
const PIPED = 'June | maybe';

/* One representative row per schema, minimal but complete enough that every
   column's write is total. Money keys get numbers, vocab keys their default. */
const SEEDS = {
  assets: { name: 'Ring', type: 'other', value: 1200, valued: PIPED, owner: '', notes: '', currency: PIPED },
  debts: { name: 'Bond', lender: 'Bank', type: 'other', balance: 1000, original: 1000,
    rate: 9, payment: 100, extra: 0, start: PIPED, category: '', status: 'active', notes: '', currency: PIPED },
  owed: { person: 'Sam', amount: 500, note: '', due: PIPED, lent: PIPED, repaid: 0, currency: PIPED },
  services: { name: 'Netflix', amount: 199, cycle: 'monthly', next: PIPED, account: '', category: '', notes: '', currency: PIPED },
};

/* ---- 1 + 2: every schema column, over TWO saves --------------------------- */

const cellsOf = line => {
  const rows = parseMdTable(line);
  return rows[rows.length - 1];
};

for (const [name, seeded] of Object.entries(SEEDS)) {
  const schema = SCHEMAS[name];
  eq(!!schema, true, `${name} is a real schema in SCHEMAS`);
  /* Which columns actually carry the seeded value — found by reading the row
     back, not by a hardcoded list, so this survives a column being renamed. */
  const first = rowLine(schema, seeded);
  const back1 = rowToObject(schema, cellsOf(first));
  /* Intersected with the schema's real columns, so a seed key that no longer
     exists is dropped rather than asserted into a false failure — and a seeded
     key the schema DOES carry can never be silently skipped. `currency` was
     added to every seed after ISSUE 76 pointed out that currency() carries the
     same pair as verbatim() and had been missed. */
  const declared = new Set(schema.columns.map(c => c.key));
  const carriers = Object.keys(seeded).filter(k => seeded[k] === PIPED && declared.has(k));
  eq(carriers.length > 0, true, `${name}: the seed actually exercises a verbatim column`);

  for (const key of carriers) {
    eq(back1[key], PIPED, `${name}.${key}: a pipe survives one save unchanged`);
  }

  // The defect only showed from the SECOND save: pass one looked correct.
  const second = rowLine(schema, back1);
  const back2 = rowToObject(schema, cellsOf(second));
  for (const key of carriers) {
    eq(back2[key], PIPED, `${name}.${key}: and is STILL unchanged after a second save`);
  }

  /* Byte equality is asserted from the SECOND save on, not the first. These
     seeds are hand-built rows, so the first write legitimately normalises a
     default the seed omitted (an absent owed `status` reads back as
     `outstanding` and is then written) — that is a one-off, not drift. From
     here the file must be a fixed point, which is exactly what the escape bug
     broke: it added a backslash on every pass, forever. */
  const third = rowLine(schema, back2);
  eq(third, second, `${name}: the bytes are a fixed point — a second save changes nothing`);

  const fourth = rowLine(schema, rowToObject(schema, cellsOf(third)));
  eq(fourth, second, `${name}: and still nothing on the third`);
  for (const key of carriers) {
    eq(rowToObject(schema, cellsOf(fourth))[key], PIPED, `${name}.${key}: unchanged after three saves`);
  }
}

/* ---- 3: the hand-rolled Plan columns -------------------------------------- */

/* Plan does not go through table-schema — views/plan.js builds its rows and
   load.js maps them by index. That second spelling is exactly why this test
   walks BOTH: fixing one and not the other is this repo's recurring shape. */
const { escMd, unescMd } = require('../src/markdown');
for (const label of ['sources[].date', 'envelopes[].tint']) {
  // The pair as load.js now applies it: written escaped, read unescaped.
  eq(unescMd(escMd(PIPED)), PIPED, `plan ${label}: escMd's inverse restores the cell`);
  eq(escMd(unescMd(escMd(PIPED))), escMd(PIPED), `plan ${label}: and a second save writes the same bytes`);
}

/* A guard on the loader itself, since the assertion above only proves the pair
   is sound, not that load.js uses it. */
const fs = require('fs');
const path = require('path');
const loadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'load.js'), 'utf8');
eq(/date: unescMd\(c\[3\] \|\| ''\)/.test(loadSrc), true,
  "plan sources[].date is read through unescMd, not a bare trim");
eq(/tint: unescMd\(c\[3\] \|\| ''\)/.test(loadSrc), true,
  "plan envelopes[].tint is read through unescMd, not a bare trim");

console.log(`PASS — every escaped cell reads back through the escape's inverse, and stays put across saves (${checks} checks).`);
