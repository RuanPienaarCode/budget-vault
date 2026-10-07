'use strict';
/* The hero's qualifiers come from ONE builder, and the hero prints exactly
   what it returns.

   The Dashboard hero prints its "left to spend" figure with up to six
   sentences beside it: set-aside, the assume-spent provision and netted
   refunds on one line, then what is dated later this period, what left an
   earmarked fund, and the foreign accounts held out. The headless API
   (src/api.js) hands the same figure to a sibling plugin and carried only
   the last of those, from its own copy. heroQualifiers() in
   views/dashboard.js is the one list, so the API can read it instead of
   re-spelling it.

   Two halves:
     1. the contract — which qualifiers, in what order, on which line, with
        their raw figures — over a synthetic vault that lights all six;
     2. the hero did not move — an ORACLE spelled exactly as renderHero
        spelled these lines before the builder existed, compared with the
        rendered hero over every committed fixture. A byte-level snapshot of
        the hero before and after the refactor was also diffed by hand (zero
        bytes changed); this half is what keeps it that way.

     node tests/dashboard-hero-qualifiers.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, textOf } = require('./helpers/dash-audit.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TXH = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => TXH + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${Number(r[3]).toFixed(2)} |  |  |  |\n`).join('');
/* Every qualifier at once: a set-aside contribution, an assume-spent envelope
   with nothing behind it, a refund inside a category, a row dated after
   today, an outflow from an earmarked fund, and a euro account with rows. */
const ALL = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Investing.md`]: '---\ntype: investment\ncolor: "#66aa33"\n---\n',
  [`${B}/Categories/Carry.md`]: '---\ntype: expense\ncolor: "#aa6633"\nassume_spent: true\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 10000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Rainy fund.md`]: '---\ntype: savings\ntx_label: "Rainy fund"\nemergency_fund: true\nbalance: 5000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Euro cheque.md`]: '---\ntype: checking\ntx_label: "Euro cheque"\ncurrency: "€"\nbalance: 900.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n| Groceries | expense | 5000.00 |  |\n| Investing | investment | 2000.00 |  |\n| Carry | expense | 500.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 30000],
    ['2026-09-02', 'Checkers', 'Groceries', -2000],
    ['2026-09-03', 'Checkers refund', 'Groceries', 300],
    ['2026-09-05', 'To unit trust', 'Investing', -1500],
    ['2026-09-25', 'Woolies', 'Groceries', -800],
  ]),
  [`${B}/Transactions/Rainy fund/2026-09.md`]: tx([['2026-09-04', 'Pram', 'Groceries', -1200]]),
  [`${B}/Transactions/Euro cheque/2026-09.md`]: tx([['2026-09-05', 'Cafe', 'Groceries', -50]]),
};

async function mount(files, { today, period, budgetFolder }) {
  const unpin = pinClock(today);
  try {
    const M = await mountFor(files, { period, budgetFolder });
    M.ctx.renderDashboard();
    /* Taken from the module the view was registered from: mountFor purges
       src/ from the require cache, so a copy required at the top of this
       file would be a different instance with its own i18n state. */
    const { heroQualifiers } = require('../src/views/dashboard');
    return { ...M, F: M.ctx.periodFigures(period), heroQualifiers };
  } finally { unpin(); }
}

/* The hero's lines as rendered: every `.hero-sub--ahead` in order, and the
   foreign note the stat column carries. */
function rendered(nodes) {
  const hero = nodes.get('#heroCard');
  return {
    ahead: find(hero, n => n._cls && n._cls.has('hero-sub--ahead')).map(textOf),
    foreign: find(hero, n => n._cls && n._cls.has('stat-note')).map(textOf),
  };
}

/* renderHero's qualifier lines as they were spelled before heroQualifiers()
   existed, verbatim. The oracle for "the hero did not move". */
function oracle(F, money, i18n) {
  const sum = F.summary, used = F.used;
  const nettedRefunds = F.gap.netted;
  const spentNoteParts = [
    used.setAside >= 1 ? i18n.t('dash.stat.setAside', { amount: money(used.setAside, 0) }) : '',
    used.assumed >= 1 ? i18n.t('dash.hero.assumedIncluded', { amount: money(used.assumed, 0) }) : '',
    nettedRefunds >= 1 ? i18n.t('dash.hero.nettedOff', { amount: money(nettedRefunds, 0) }) : '',
  ].filter(Boolean);
  const fromFunds = sum.fundedFromSavings || { spend: 0, count: 0 };
  const sched = sum.scheduled || { income: 0, spend: 0 };
  const scheduledAhead = (sched.income || 0) + (sched.spend || 0);
  const ahead = [];
  if (spentNoteParts.length) ahead.push(spentNoteParts.join(' · '));
  if (scheduledAhead > 0) ahead.push(i18n.t('dash.scheduledAhead', { amount: money(scheduledAhead, 0) }));
  if (fromFunds.count > 0) ahead.push(i18n.t('dash.fundedFromSavings', { amount: money(fromFunds.spend, 0), count: fromFunds.count }));
  const foreign = sum.foreign && sum.foreign.count
    ? [i18n.t('dash.foreignExcluded', { count: sum.foreign.count, symbols: sum.foreign.symbols.join(' · ') })]
    : [];
  return { ahead, foreign };
}

(async () => {
  /* ---- 1. the contract ---- */
  {
    const { ctx, nodes, F, heroQualifiers } = await mount(ALL, { today: '2026-09-15', period: '2026-09', budgetFolder: B });
    const Q = heroQualifiers(F, ctx.money);
    eq(Q.map(q => [q.key, q.line]), [
      ['setAside', 'spent'], ['assumed', 'spent'], ['netted', 'spent'],
      ['scheduledAhead', 'scheduled'], ['fundedFromSavings', 'funds'], ['foreign', 'foreign'],
    ], 'all six, in the order the hero prints them, each on its own line');
    eq(Q.map(q => q.amount), [1500, 500, 300, 800, 1200, undefined], 'with the raw figure each sentence states');
    eq(Q.find(q => q.key === 'fundedFromSavings').count, 1, 'the funds line carries its count');
    eq([Q.find(q => q.key === 'foreign').count, Q.find(q => q.key === 'foreign').symbols], [1, ['€']],
      'the foreign line carries how many accounts and which symbols');
    ok(Q.every(q => typeof q.text === 'string' && q.text && !/^dash\./.test(q.text)), 'every text is a real sentence, not a key');

    const r = rendered(nodes);
    const lineText = line => Q.filter(q => q.line === line).map(q => q.text);
    eq(r.ahead, [lineText('spent').join(' · '), ...lineText('scheduled'), ...lineText('funds')],
      'the hero prints the builder\'s lines and nothing else under its figure');
    eq(r.foreign, lineText('foreign'), 'and the foreign note is the builder\'s');
  }

  /* ---- 2. the hero did not move, on every committed fixture ---- */
  {
    const H1 = require('./figures/household.cjs');
    const H2 = require('./figures/household2.cjs');
    const AU = require('./_audit-seed.cjs');
    const cases = [
      ['household', H1.SEED, H1.TODAY, H1.PERIOD, H1.B],
      ['household, previous period', H1.SEED, H1.TODAY, '2026-08', H1.B],
      ['household2', H2.SEED, H2.TODAY, H2.PERIOD, H2.B],
      ['audit seed', AU.SEED, AU.TODAY, AU.PERIOD, AU.B],
      ['all six qualifiers', ALL, '2026-09-15', '2026-09', B],
      ['a period with no budget yet', ALL, '2026-09-15', '2026-10', B],
    ];
    let lit = 0;
    for (const [name, files, today, period, bf] of cases) {
      const { ctx, nodes, F } = await mount(files, { today, period, budgetFolder: bf });
      const i18n = require('../src/i18n');
      const want = oracle(F, ctx.money, i18n);
      eq(rendered(nodes), want, `${name}: the hero's qualifier lines are exactly the pre-builder ones`);
      lit += want.ahead.length + want.foreign.length;
    }
    ok(lit >= 8, `the fixtures between them light real lines, so the comparison is not over nothing (${lit})`);
  }

  console.log(`PASS dashboard-hero-qualifiers (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
