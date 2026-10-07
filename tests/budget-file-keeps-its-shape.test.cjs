'use strict';
/* A Budgets/<period>.md file comes back from a Save in the shape the household
   gave it: their own columns, and their own row order.

   1. A HAND-ADDED COLUMN (2026-10-07 round-trip audit, L3-25). ISSUE 69 taught
      transactions and the four flat tables to carry a column the schema does
      not model; budgets never got it. load.js read c[0]..c[3] and
      budget-file.js wrote exactly four cells, so `| … | Notes | Last year |`
      lost the column and every figure in it on the next Save — even a Save
      that changed nothing. The same extra-columns machinery now reaches
      budgets: each row carries its own extra cells, the file carries the extra
      headers and separator cells, and the serializer writes them back after
      the four it owns.

   2. THE FILE'S OWN ROW ORDER (L3-22, live churn). serializeBudgetFile sorted
      every row by type then name, so a Save with no change rewrote 7 of the 10
      period files on the vault the audit read — nothing lost, but a diff in a
      synced folder for nothing. Rows already in the file now keep their
      places; a row the file did not have is placed by the same grouping rule
      the sort used (after the last row that sorts at or before it), which is
      exactly where the old sort put it in a file that was already in order.
      A file with no recorded order (a new period, the setup wizard) is still
      written sorted — tests/budget-file.test.cjs pins that.

   3. A row copied from ANOTHER period (Copy previous, Bring over) carries that
      period's modelled fields only — never the other file's extra cells, which
      would land under this file's headers as somebody else's figures.

   Synthetic household. Real loader, real Budget page, real serializer.
     node tests/budget-file-keeps-its-shape.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nlanguage: en\n---\n';
const RANGE = 'With `month_start_day: 1`, this period is the calendar month — the 1st to the last day of the month.';
const cat = type => `---\ntype: ${type}\ncolor: "#888888"\n---\n`;
const budget = (period, head, rows) => ['---', `period: ${period}`, '---', '', `# Budget — ${period}`, '', RANGE, '',
  ...head, ...rows, ''].join('\n');
const HEAD4 = ['| Category | Type | Amount | Notes |', '|----------|------|-------:|-------|'];
const HEAD5 = ['| Category | Type | Amount | Notes | Last year |', '|----------|------|-------:|-------|----------:|'];

const base = extra => ({
  [`${B}/Settings.md`]: SETTINGS,
  [`${B}/Categories/Food.md`]: cat('expense'),
  [`${B}/Categories/Rent.md`]: cat('expense'),
  [`${B}/Categories/Fun.md`]: cat('expense'),
  [`${B}/Categories/Salary.md`]: cat('income'),
  [`${B}/Categories/Bonus.md`]: cat('income'),
  ...extra,
});

async function page(files, period) {
  const M = await mountFor(files, { period });
  return {
    ...M,
    file: () => M.ctx.vault._store.get(`${B}/Budgets/${period}.md`),
    async save() { await M.ctx.saveBudget(); return this.file(); },
    /* What typing an amount into a row's input does: the draft row's amount,
       its raw cleared, Save lit. Reached through the rendered input so the
       test drives the page rather than a copy of its handler. */
    type(category, value) {
      M.ctx.renderBudgets();
      const input = findInput(M.nodes.get('#budTable'), `Budget amount for ${category}`);
      assert.ok(input, `the ${category} amount input is on the page`);
      input.value = String(value);
      input._fire('change', { target: input });
    },
  };
}
function findInput(node, label) {
  if (!node) return null;
  if (node.tagName === 'INPUT' && node.attrs && node.attrs['aria-label'] === label) return node;
  for (const c of node.children || []) { const hit = findInput(c, label); if (hit) return hit; }
  return null;
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. a hand-added column, in a file whose rows are NOT in type order ---- */
    const UNSORTED = budget('2026-10', HEAD5, ['| Food | expense | 4000.00 |  | 3600.00 |',
      '| Salary | income | 30000.00 |  | 28000.00 |']);
    {
      const p = await page(base({ [`${B}/Budgets/2026-10.md`]: UNSORTED }), '2026-10');
      eq(p.S.budgets['2026-10'].map(r => r.extraCells), [['3600.00'], ['28000.00']],
        'each row carries its own hand-added cell, verbatim');
      eq(await p.save(), UNSORTED,
        'a no-change Save gives the file back byte for byte: the "Last year" column and the household\'s own row order');

      p.type('Food', '4200');
      const edited = await p.save();
      eq(edited, budget('2026-10', HEAD5, ['| Food | expense | 4200.00 |  | 3600.00 |',
        '| Salary | income | 30000.00 |  | 28000.00 |']),
      'an edit changes its own cell and nothing else — the column, its figures and the order all stay');

      p.type('Rent', '6000');
      eq(await p.save(), budget('2026-10', HEAD5, ['| Food | expense | 4200.00 |  | 3600.00 |',
        '| Salary | income | 30000.00 |  | 28000.00 |', '| Rent | expense | 6000.00 |  |  |']),
      'a new row is placed by the grouping rule (after the last row that sorts at or before it) and gets a blank cell in the household column');
    }

    /* ---- 2. a file already in order: new rows land exactly where the old sort put them ---- */
    {
      const SORTED = budget('2026-10', HEAD4, ['| Salary | income | 30000.00 |  |', '| Food | expense | 4000.00 |  |']);
      const p = await page(base({ [`${B}/Budgets/2026-10.md`]: SORTED }), '2026-10');
      eq(await p.save(), SORTED, 'an in-order file is unchanged by a no-change Save, as it always was');
      p.type('Rent', '6000');
      p.type('Bonus', '1000');
      eq(await p.save(), budget('2026-10', HEAD4, ['| Bonus | income | 1000.00 |  |', '| Salary | income | 30000.00 |  |',
        '| Food | expense | 4000.00 |  |', '| Rent | expense | 6000.00 |  |']),
      'new rows in an in-order file come out exactly as the full type-then-name sort wrote them');
    }

    /* ---- 3. a file with no hand-added column gains none ---- */
    {
      const PLAIN = budget('2026-10', HEAD4, ['| Food | expense | 4000.00 |  |']);
      const p = await page(base({ [`${B}/Budgets/2026-10.md`]: PLAIN }), '2026-10');
      eq(p.S.budgets['2026-10'][0].extraCells, undefined, 'control: a four-column file carries no extra cells');
      eq(await p.save(), PLAIN, 'and its Save writes the same four columns it always did');
    }

    /* ---- 4. a row copied from another period brings no extra cells with it ---- */
    {
      const PREV = budget('2026-09', ['| Category | Type | Amount | Notes | Who pays |', '|----------|------|-------:|-------|----------|'],
        ['| Old thing | expense | 100.00 | gone now | Ann |']);
      const p = await page(base({
        [`${B}/Budgets/2026-09.md`]: PREV,
        [`${B}/Budgets/2026-10.md`]: budget('2026-10', HEAD5, ['| Food | expense | 4000.00 |  | 3600.00 |']),
      }), '2026-10');
      p.ctx.renderBudgets();
      p.ctx.copyPreviousBudget();
      const out = await p.save();
      ok(out.includes('| Old thing | expense | 100.00 | gone now |  |'),
        `the copied row's "Last year" cell is blank — not September's "Who pays" — in:\n${out}`);
      ok(!out.includes('Ann'), 'September\'s extra cell does not reach October\'s file under another header');
    }
  } finally { unpin(); }

  console.log(`PASS budget-file-keeps-its-shape (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
