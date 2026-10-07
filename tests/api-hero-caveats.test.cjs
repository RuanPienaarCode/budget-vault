'use strict';
/* The headless API hands over every caveat the Dashboard hero prints beside
   the figure — the hero's own sentences, line for line.

   app.plugins.plugins['budget-app'].api.currentPeriod() gives a sibling plugin
   (Vista's Budget card) the hero's "left to spend". Its `notes` are meant to
   be "the caveats the Dashboard prints beside it" — the API header and the
   CHANGELOG both say so — but api.js built them from its own copy of ONE of
   the hero's sentences, the foreign-accounts one, under a comment reading
   "Today that is exactly one". The hero prints up to six. On the committed
   synthetic household the 2026-10-07 audit found the hero saying "R 2 000 for
   savings · includes R 500 already spent" and "R 1 500 more went out of your
   funds (1 transaction), which this budget does not count", and api.notes
   was []: Vista's "spent" carried a R 500 assume-spent provision with no word
   about it.

   views/dashboard.js's heroQualifiers() is now the one list both read. This
   suite holds the API to what the hero RENDERS, not to the builder: for each
   fixture it renders the real Dashboard, reads every qualifier line off the
   hero (each `.hero-sub--ahead`, then the stat column's `.stat-note`), and
   asks the API for the same household at the same pinned instant.

   The API is required AFTER the mount, on purpose: mountFor purges src/ from
   the require cache, and inside the plugin bundle the API and the view share
   one i18n module and one formatter. A copy required up front would be a
   second instance with its own language state.

     node tests/api-hero-caveats.test.cjs */

const assert = require('assert');
const { stubObsidian, makeVault } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, textOf } = require('./helpers/dash-audit.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TXH = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => TXH + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${Number(r[3]).toFixed(2)} |  |  |  |\n`).join('');

/* Every qualifier the hero has, lit at once: a set-aside contribution, an
   assume-spent envelope with nothing behind it, a refund inside a category, a
   row dated after today, an outflow from an earmarked fund, and an account in
   another currency with rows of its own. Synthetic names and figures. */
const SIX = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Wages.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Index fund.md`]: '---\ntype: investment\ncolor: "#66aa33"\n---\n',
  [`${B}/Categories/Levy.md`]: '---\ntype: expense\ncolor: "#aa6633"\nassume_spent: true\n---\n',
  [`${B}/Accounts/Everyday.md`]: '---\ntype: checking\ntx_label: "Everyday"\nbalance: 8000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Rainy day.md`]: '---\ntype: savings\ntx_label: "Rainy day"\nemergency_fund: true\nbalance: 4000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Travel euro.md`]: '---\ntype: checking\ntx_label: "Travel euro"\ncurrency: "€"\nbalance: 700.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Wages | income | 25000.00 |  |\n| Food | expense | 4000.00 |  |\n| Index fund | investment | 1500.00 |  |\n| Levy | expense | 600.00 |  |\n',
  [`${B}/Transactions/Everyday/2026-09.md`]: tx([
    ['2026-09-01', 'Employer pay', 'Wages', 25000],
    ['2026-09-02', 'Corner shop', 'Food', -1800],
    ['2026-09-03', 'Corner shop refund', 'Food', 250],
    ['2026-09-05', 'To index fund', 'Index fund', -1200],
    ['2026-09-26', 'Corner shop', 'Food', -700],
  ]),
  [`${B}/Transactions/Rainy day/2026-09.md`]: tx([['2026-09-04', 'Cot', 'Food', -900]]),
  [`${B}/Transactions/Travel euro/2026-09.md`]: tx([['2026-09-06', 'Museum', 'Food', -40]]),
};

/* The hero's qualifier lines as rendered, in print order: the sub-lines under
   the figure, then the stat column's note. */
function heroLines(nodes) {
  const hero = nodes.get('#heroCard');
  return [
    ...find(hero, n => n._cls && n._cls.has('hero-sub--ahead')).map(textOf),
    ...find(hero, n => n._cls && n._cls.has('stat-note')).map(textOf),
  ];
}

async function heroAndApi(files, today, budgetFolder) {
  const unpin = pinClock(today);
  let restore = () => {};
  try {
    const M = await mountFor(files, { budgetFolder });
    restore = M.restore;
    M.ctx.renderDashboard();
    const lines = heroLines(M.nodes);
    const { buildApi } = require('../src/api');
    const api = buildApi({ settings: { budgetFolder }, app: { vault: makeVault(files) }, _lastWrite: 0 });
    const got = await api.currentPeriod();
    return { lines, got, viewPeriod: M.S.period, current: M.ctx.currentPeriod(), title: M.ctx.periodTitle(M.S.period) };
  } finally { restore(); unpin(); }
}

(async () => {
  const H1 = require('./figures/household.cjs');
  const H2 = require('./figures/household2.cjs');
  const AU = require('./_audit-seed.cjs');
  const cases = [
    ['household', H1.SEED, H1.TODAY, H1.B],
    ['household2', H2.SEED, H2.TODAY, H2.B],
    ['audit seed', AU.SEED, AU.TODAY, AU.B],
    ['all six qualifiers', SIX, '2026-09-15', B],
    ['the next period, with no budget yet', SIX, '2026-10-05', B],
  ];
  let lit = 0;
  const seen = {};
  for (const [name, files, today, bf] of cases) {
    const { lines, got, viewPeriod, current, title } = await heroAndApi(files, today, bf);
    eq(viewPeriod, current, `${name}: sanity — the hero shows the current period, the one the API answers for`);
    eq(got.label, title, `${name}: sanity — and the API answered for that same period`);
    ok(Array.isArray(got.notes) && got.notes.every(n => typeof n === 'string' && n.length > 0),
      `${name}: notes are still plain strings (apiVersion 1)`);
    eq(got.notes, lines, `${name}: api.notes are the hero's own qualifier lines, every one, in its order`);
    lit += lines.length;
    seen[name] = lines.length;
  }
  /* Not a comparison over nothing: the household alone prints two lines, and
     the six-qualifier vault prints four (one of them two sentences joined, as
     the hero joins them). */
  ok(seen.household >= 2, `the committed household lights real lines (${seen.household})`);
  eq(seen['all six qualifiers'], 4, 'all six qualifiers print on four lines: spent, scheduled, funds, foreign');
  ok(lit >= 6, `the fixtures between them light real lines (${lit})`);

  /* The joined line is the hero's joiner, not a second spelling of the three
     sentences: the six-qualifier vault's first note carries all three. */
  {
    const { got } = await heroAndApi(SIX, '2026-09-15', B);
    ok(got.notes[0].split(' · ').length === 3,
      `the spent line carries set-aside, the provision and netted refunds as ONE note — got ${JSON.stringify(got.notes[0])}`);
  }

  console.log(`PASS — api-hero-caveats: the API carries every caveat the hero prints beside its figure (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
