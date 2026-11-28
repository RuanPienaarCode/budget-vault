'use strict';
/* The sum rule (ADR-0010 §2, issue #184): for any category and any window, its
   subcategories plus the transactions that have none add up to exactly the
   category's own figure, refunds signed, under the same ledger lens
   categorySpendRows reads.

   This is the property that lets the feature ship without re-auditing a single
   number: nothing that existed before reads the new field, and the new figures
   are a partition of the old ones.

   Run over BOTH committed households, with the real loader: each seed's month
   files are rewritten to carry a Subcategory column (so the column is read by
   its header, not handed in as an object), and refunds are added, because the
   seeds hold none and a refund is the row a partition is most likely to lose —
   a positive amount inside a spending category is netted into it, and a
   subcategory that dropped it would still add up for every outflow.

   The partition is checked three ways, so it cannot pass by agreeing with
   itself: against the category's own figure in the period summary, against the
   rows the donut draws (categorySpendRows), and against an independent oracle
   that sums the loaded rows by hand with none of ledger.js's vetoes spelled
   differently from the lens it names.

     node tests/subcategory-sum.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const household = require('./figures/household.cjs');
const household2 = require('./figures/household2.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
/* Whole cents: every figure here is a sum of two-decimal amounts. */
const cents = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };

/* Which subcategory each row of a category gets: a cycle that leaves some rows
   with none, repeats a name, and gives a category two names. Deterministic, so
   a failure is reproducible. Categories the cycle does not name get a name on
   every other row. */
const CYCLE = {
  Groceries: ['Fresh', '', 'Pantry', 'Fresh'],
  Rent: ['', 'Levy'],
  Gym: ['Classes', ''],
  Salary: ['Bonus', ''],
  Transfer: ['Savings top-up', ''],   // a transfer-typed category may have them too
  Investing: ['Unit trust'],
  Software: ['Backup', ''],
};

/* Rewrite a month file so it carries a Subcategory column after its last one. */
function addColumn(text) {
  const seen = {};
  return text.split('\n').map(line => {
    if (!line.startsWith('|')) return line;
    if (line.startsWith('| Date')) return `${line.replace(/\s*$/, '')} Subcategory |`;
    if (/^\|[-:|]+\|$/.test(line)) return `${line}---|`;
    const cells = line.split('|').map(c => c.trim());   // ['', date, desc, cat, ...]
    const cat = cells[3];
    const cycle = CYCLE[cat] || ['Other', ''];
    seen[cat] = (seen[cat] || 0) + 1;
    const name = cat ? cycle[(seen[cat] - 1) % cycle.length] : '';
    return `${line.replace(/\s*$/, '')} ${name} |`;
  }).join('\n');
}

const REFUND = (date, desc, cat, amount, sub, split) =>
  `| ${date} | ${desc} | ${cat} | ${amount.toFixed(2)} |  |  | ${split || ''} | ${sub} |\n`;

function seeded(seed, refunds) {
  const files = {};
  for (const [path, text] of Object.entries(seed.SEED)) {
    files[path] = path.includes('/Transactions/') ? addColumn(text) : text;
  }
  for (const [path, rows] of Object.entries(refunds)) files[path] += rows.join('');
  /* A list on one category's note, none on the others: names a row carries that
     no list offers are subcategories all the same. */
  files[`${seed.B}/Categories/Groceries.md`] =
    '---\ntype: expense\ncolor: "#888888"\nsubcategories: Fresh, Pantry\n---\n';
  return files;
}

const SEEDS = [
  {
    name: 'household', seed: household,
    refunds: {
      [`${household.B}/Transactions/Cheque/2026-09.md`]: [
        REFUND('2026-09-02', 'Checkers refund', 'Groceries', 150, 'Fresh'),
        REFUND('2026-09-02', 'Checkers refund', 'Groceries', 80, ''),          // a refund with none
        REFUND('2026-09-02', 'Gym refund', 'Gym', 50, 'Classes'),
        REFUND('2026-09-02', 'Landlord overpaid', 'Rent', 9500, 'Levy'),        // more than the category spent: nets positive
      ],
    },
  },
  {
    name: 'household2', seed: household2,
    refunds: {
      [`${household2.B}/Transactions/Cheque/2026-11.md`]: [
        REFUND('2026-11-26', 'Checkers refund', 'Groceries', 200, 'Pantry'),
        REFUND('2026-11-26', 'Checkers refund', 'Groceries', 40, ''),
      ],
    },
  },
];

/* The oracle: the BUDGET lens spelled by hand — not excluded, not in a
   budget:false account, not in a foreign currency, not paid out of an
   earmarked fund, not a transfer-typed category — over the rows the loader
   produced, summed per category and per (category, subcategory). */
function oracle(ctx, start, end) {
  const S = ctx.S;
  const nonBudget = ctx.nonBudgetLabels(), foreign = ctx.foreignLabels(), earmarked = ctx.earmarkedLabels();
  const typeOf = n => (S.categories.find(c => c.name === n) || {}).type;
  const out = {};
  for (const f of Object.values(S.txFiles)) {
    for (const r of f.rows) {
      if (r.date < start || r.date > end) continue;
      if (r.excluded || nonBudget.has(f.label) || foreign.has(f.label)) continue;
      if (r.amount < 0 && earmarked.has(f.label)) continue;
      if (r.split === 'parent') continue;           // superseded by its parts (excluded by construction)
      if (typeOf(r.cat) === 'transfer') continue;
      const c = out[r.cat] || (out[r.cat] = { total: 0, none: 0, subs: {} });
      const k = cents(r.amount);
      c.total += k;
      const sub = r.cat && r.subcategory ? r.subcategory : '';
      if (sub) c.subs[sub] = (c.subs[sub] || 0) + k; else c.none += k;
    }
  }
  return out;
}

(async () => {
  for (const { name, seed, refunds } of SEEDS) {
    const files = seeded(seed, refunds);
    const ctx = makeCtx(files);
    const S = await loadInto(ctx);
    const restore = pinClock(seed.TODAY);
    try {
      /* The column really was read from the files, not assumed. */
      const rows = Object.values(S.txFiles).flatMap(f => f.rows);
      ok(rows.some(r => r.subcategory), `${name}: the rewritten files carry subcategories through the real loader`);
      ok(rows.some(r => r.amount > 0 && r.cat && r.subcategory && ctx.catType(r.cat) === 'expense'),
        `${name}: and a refund carries one`);
      eq(S.categories.find(c => c.name === 'Groceries').subcategories, ['Fresh', 'Pantry'], `${name}: the list on a category note is read`);

      const { start } = ctx.periodRange(seed.PERIOD);
      const sum = ctx.periodSummary(seed.PERIOD, seed.TODAY);
      const windows = {
        'the period as the Dashboard reads it (to today)': [start, sum.asOf],
        'the whole period': [start, ctx.periodRange(seed.PERIOD).end],
        'a single day': [seed.TODAY, seed.TODAY],
        'the whole history': ['0000-01-01', '9999-12-31'],
        'a window that holds nothing': ['2001-01-01', '2001-01-31'],
      };

      let partitioned = 0, withNone = 0, withSubs = 0;
      for (const [label, [a, b]] of Object.entries(windows)) {
        const lens = ctx.tally(ctx.ledger(a, b), ctx.LENSES.BUDGET);
        const totals = ctx.subcategoryTotalsInRange(a, b);
        const expect = oracle(ctx, a, b);

        /* Same categories, same figures, as the lens the donut reads. */
        eq(Object.keys(totals).sort(), Object.keys(lens.byCat).sort(), `${name}, ${label}: the same categories as the lens's own`);
        for (const cat of Object.keys(lens.byCat)) {
          const t = totals[cat];
          eq(cents(t.total), cents(lens.byCat[cat]), `${name}, ${label}, "${cat}": the category's figure is the lens's own`);
          const parts = t.subs.reduce((n, s) => n + cents(s.amount), 0) + cents(t.none);
          eq(parts, cents(t.total), `${name}, ${label}, "${cat}": its subcategories plus the rows with none add up to it`);
          partitioned++;
          if (cents(t.none) !== 0) withNone++;
          if (t.subs.length) withSubs++;
          /* ...and to what an independent walk of the rows says. */
          const o = expect[cat] || { total: 0, none: 0, subs: {} };
          eq(cents(t.total), o.total, `${name}, ${label}, "${cat}": the total agrees with the oracle`);
          eq(cents(t.none), o.none, `${name}, ${label}, "${cat}": so does the none part`);
          eq(Object.fromEntries(t.subs.map(s => [s.name, cents(s.amount)])), o.subs, `${name}, ${label}, "${cat}": and every subcategory`);
        }
      }
      ok(partitioned > 0 && withNone > 0 && withSubs > 0,
        `${name}: the partition was exercised — categories with subcategories and with rows that have none (${partitioned} checked)`);

      /* The rows the donut draws: its figure is the sum of that category's parts. */
      const totalsToDay = ctx.subcategoryTotalsInRange(start, sum.asOf);
      const split = ctx.categorySpendRows(seed.PERIOD);
      ok(split.length > 0, `${name}: the donut has categories`);
      for (const row of split) {
        const t = totalsToDay[row.cat];
        const parts = t.subs.reduce((n, s) => n + cents(s.amount), 0) + cents(t.none);
        eq(-parts, cents(row.amount), `${name}: "${row.cat}" on the donut equals its subcategories plus the rows with none`);
      }

      /* A refund is signed into its subcategory, not dropped from it. */
      const groc = ctx.subcategoryTotalsInRange('0000-01-01', '9999-12-31').Groceries;
      const fresh = groc.subs.find(s => s.name === 'Fresh');
      ok(fresh, `${name}: Groceries has a Fresh subcategory`);

      /* No row with a subcategory but no category adds a figure of its own. */
      const none = ctx.subcategoryTotalsInRange('0000-01-01', '9999-12-31')[''];
      if (none) { eq(none.subs, [], `${name}: uncategorised money has no subcategories`); }
    } finally { restore(); }
  }

  /* Refunds, by hand, on the smallest case: the invariant on a category whose
     only subcategory is a refund-heavy one. */
  {
    const files = {
      'Budget/Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      'Budget/Categories/Car.md': '---\ntype: expense\nsubcategories: Fuel\n---\n',
      'Budget/Transactions/Cheque/2026-09.md': '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|---|---|---|---:|---|---|---|\n'
        + '| 2026-09-01 | Engen | Car | -500.00 |  |  | Fuel |\n'
        + '| 2026-09-02 | Engen refund | Car | 120.00 |  |  | Fuel |\n'
        + '| 2026-09-03 | Servicing | Car | -900.00 |  |  |  |\n'
        + '| 2026-09-04 | Servicing refund | Car | 100.00 |  |  |  |\n',
    };
    const ctx = makeCtx(files);
    await loadInto(ctx);
    const car = ctx.subcategoryTotalsInRange('2026-09-01', '2026-09-30').Car;
    eq(car, { total: -1180, none: -800, subs: [{ name: 'Fuel', amount: -380 }] },
      'by hand: -500 + 120 = -380 under Fuel, -900 + 100 = -800 under none, -1180 in all, every refund signed');
  }

  console.log(`subcategory-sum.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
