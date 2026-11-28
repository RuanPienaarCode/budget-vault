'use strict';
/* The pure half of the Dashboard expansion (ADR-0010, issue #186): what a
   category's subcategories are, as rows, and the whole-unit figures printed
   beside them.

   CONTRACT (agreed before the first line of the module):

     breakdownOf(entry) -> null | Row[]
       entry  one value of ledger.subcategoryTotals(): { total, none, subs }, in
              byCat's sign (spending negative, a refund positive); undefined for
              a category with no kept row in the window.
       null   unless at least one kept row carries a subcategory: the category
              then behaves exactly as it did before.
       Row    { kind: 'sub' | 'none', name, amount }, `amount` in SPEND sign
              (money out positive — the sign the legend prints), to the cent.
              One 'sub' row per name; a 'none' row (name '') only when the rows
              without one net to something. Order: biggest amount first, ties by
              name, the 'none' row last. A subcategory whose rows net to nothing
              is still a row: it has rows.
       Never throws: a malformed entry is no breakdown.

     printedRows(rows, printed) -> Row & { shown }[]
       printed  the whole-unit figure the category's own legend row prints.
       `shown`  each amount as a whole unit, allocated by largest remainder so
                the `shown` figures add up to `printed` EXACTLY, each within a
                unit of its own amount. Same order, same rows.

   Every expectation is a literal or an independent sum, so the module cannot
   agree with itself and be wrong.

     node tests/subcategory-breakdown.test.cjs */

const assert = require('assert');
const { breakdownOf, printedRows } = require('../src/subcategories');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. when there is a breakdown at all ------------------------------- */
eq(breakdownOf(undefined), null, 'a category with no kept row has none');
eq(breakdownOf(null), null, 'null is none');
eq(breakdownOf({ total: -300, none: -300, subs: [] }), null, 'spending with no subcategory on any row is not expanded');
eq(breakdownOf({ total: 0, none: 0, subs: [] }), null, 'nor an empty one');
eq(breakdownOf({ total: -300 }), null, 'an entry without subs is not a breakdown, and not an error');
eq(breakdownOf('Car'), null, 'a malformed entry is none');

/* ---- 2. rows, signs and order ------------------------------------------ */
eq(breakdownOf({ total: -1180, none: -800, subs: [{ name: 'Fuel', amount: -380 }] }), [
  { kind: 'sub', name: 'Fuel', amount: 380 },
  { kind: 'none', name: '', amount: 800 },
], 'spend sign: the legend prints money out as positive; the rows with none come last');

eq(breakdownOf({ total: -1000, none: 0, subs: [{ name: 'A', amount: -400 }, { name: 'B', amount: -600 }] }).map(r => r.name),
  ['B', 'A'], 'biggest first, the way the legend itself is ordered');
eq(breakdownOf({ total: -1000, none: 0, subs: [{ name: 'Tolls', amount: -500 }, { name: 'Fuel', amount: -500 }] }).map(r => r.name),
  ['Fuel', 'Tolls'], 'a tie is broken by name, so the order is the same on every render');
eq(breakdownOf({ total: -1000, none: -900, subs: [{ name: 'Fuel', amount: -100 }] }).map(r => r.kind),
  ['sub', 'none'], 'the none row stays last even when it is the biggest');

/* A row with no rows-without-subcategory is not shown: there is nothing to open. */
eq(breakdownOf({ total: -500, none: 0, subs: [{ name: 'Fuel', amount: -500 }] }),
  [{ kind: 'sub', name: 'Fuel', amount: 500 }], 'no none row when nothing is without a subcategory');

/* Refunds are signed in, not dropped. */
eq(breakdownOf({ total: -250, none: -500, subs: [{ name: 'Levy', amount: 250 }] }), [
  { kind: 'sub', name: 'Levy', amount: -250 },
  { kind: 'none', name: '', amount: 500 },
], 'a subcategory that nets to a refund is a negative amount, and is still a row (none stays last)');
eq(breakdownOf({ total: -500, none: -500, subs: [{ name: 'Fuel', amount: 0 }] }), [
  { kind: 'sub', name: 'Fuel', amount: 0 },
  { kind: 'none', name: '', amount: 500 },
], 'a subcategory that nets to zero has rows, so it is a row');
ok(Object.is(breakdownOf({ total: 0, none: 0, subs: [{ name: 'Fuel', amount: 0 }] })[0].amount, 0),
  'and its amount is 0, never -0, which would print as a sign');

/* ---- 3. the printed whole units add up to the printed category --------- */
const sum = rows => rows.reduce((n, r) => n + r.shown, 0);

eq(printedRows([{ kind: 'sub', name: 'Fuel', amount: 380 }, { kind: 'none', name: '', amount: 800 }], 1180).map(r => r.shown),
  [380, 800], 'whole amounts print as they are');

/* Three equal thirds of 100 — the shape independent rounding gets wrong (33+33+33). */
{
  const rows = printedRows([
    { kind: 'sub', name: 'A', amount: 100 / 3 }, { kind: 'sub', name: 'B', amount: 100 / 3 }, { kind: 'none', name: '', amount: 100 / 3 },
  ], 100);
  eq(sum(rows), 100, 'three thirds print 34 + 33 + 33, not 99');
  eq(rows.map(r => r.name), ['A', 'B', ''], 'same order in, same order out');
}
/* Half a unit each: rounding every one alone would print 1 + 1 + 1 against a printed 1. */
eq(sum(printedRows([
  { kind: 'sub', name: 'A', amount: 0.5 }, { kind: 'sub', name: 'B', amount: 0.5 }, { kind: 'none', name: '', amount: 0.5 },
], 2)), 2, 'three halves print so they add up to the 2 the category prints');
/* The category's own printed figure may sit above or below round(x): it is the
   donut's largest-remainder share, not a rounding of its own. */
eq(sum(printedRows([{ kind: 'sub', name: 'A', amount: 10.4 }, { kind: 'none', name: '', amount: 10.4 }], 21)), 21,
  'a category printed one above its own rounding is still the sum of its parts');
eq(sum(printedRows([{ kind: 'sub', name: 'A', amount: 10.6 }, { kind: 'none', name: '', amount: 10.6 }], 21)), 21,
  'and one at its floor');

/* Randomised, with a deterministic generator so a failure reproduces: parts
   that include refund-heavy (negative) ones, summing to a category that nets to
   an outflow, with the printed figure at either end of what the donut can give. */
{
  let seed = 186;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const cents = v => Math.round(v * 100) / 100;
  let cases = 0, withNegative = 0;
  for (let n = 0; n < 4000; n++) {
    const parts = 1 + Math.floor(rnd() * 6);
    const rows = [];
    for (let i = 0; i < parts; i++) {
      const refundHeavy = rnd() < 0.2;
      const v = cents((refundHeavy ? -1 : 1) * rnd() * 5000);
      rows.push({ kind: i === parts - 1 && rnd() < 0.5 ? 'none' : 'sub', name: `S${i}`, amount: v });
    }
    const total = cents(rows.reduce((t, r) => t + r.amount, 0));
    if (total <= 0) continue;                       // a category in the donut nets to an outflow
    const printed = [Math.floor(total), Math.floor(total) + 1][Math.floor(rnd() * 2)];
    if (Math.abs(printed - total) >= 1) continue;   // the donut's figure is within a unit of the truth
    const out = printedRows(rows, printed);
    cases++;
    if (rows.some(r => r.amount < 0)) withNegative++;
    assert.strictEqual(sum(out), printed, `case ${n}: ${JSON.stringify(rows.map(r => r.amount))} printed ${printed} -> ${out.map(r => r.shown)}`);
    out.forEach((r, i) => assert.ok(Math.abs(r.shown - rows[i].amount) < 1 + 1e-9, `case ${n}: part ${i} stays within a unit of itself`));
    out.forEach((r, i) => assert.strictEqual(r.amount, rows[i].amount, 'the exact amount rides along untouched'));
    checks += 3;
  }
  ok(cases > 1500 && withNegative > 200, `the property was exercised (${cases} cases, ${withNegative} with a refund-heavy part)`);
}

/* The input is not mutated: the same rows are read again on the next render. */
{
  const rows = [{ kind: 'sub', name: 'A', amount: 1.5 }];
  printedRows(rows, 2);
  eq(rows, [{ kind: 'sub', name: 'A', amount: 1.5 }], 'printedRows does not touch its input');
}

console.log(`subcategory-breakdown.test.cjs — ${checks} checks OK`);
