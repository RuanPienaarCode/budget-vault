'use strict';
/* "Budgeted" meant two numbers (2026-09-29 totals audit, Ruan's decision).

   The app's rule is ADR-0005: budget used = spent / SPENDING budget, with the
   set-aside envelopes (savings and investment) out of both sides. That rule
   stays. What was wrong is that the word "budgeted" was printed beside both
   denominators. The Dashboard's hero read "R10 500 spent of R10 000 budgeted"
   directly beside a stat tile "Budgeted R12 000" — two figures under one word
   on one card — and the Budget page printed "Total budgeted R12 000" above a
   "105% of budget used" that no reader could reproduce from the tile: 10 500 /
   12 000 is 88%.

   The goal, pinned below on BOTH pages: a reader who divides the printed spent
   by the printed denominator gets the printed percentage. The denominator is
   named "spending budget"; the whole plan says how much of it is set aside.

   Synthetic household: R10 000 of spending envelopes plus a R2 000 emergency
   fund envelope (a set-aside type). R10 500 spent on the two spending
   categories and R2 000 into the fund, so gross spend is R12 500, budget used
   is 10 500 / 10 000 = 105%, and the wrong readings are 12 500 / 12 000 = 104%
   and 10 500 / 12 000 = 88%.

     node tests/dashboard-audit-spending-budget.test.cjs */
const assert = require('assert');
const { B, tx, base, account, cat, find, hasClass, textOf, renderDash, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Every money figure in a string, as a number: "R 10 500,00" -> 10500. */
const moneys = s => [...String(s).matchAll(/R[\s\u00a0\u202f]?(\d(?:[\d\s\u00a0\u202f]*\d)?)(?:,(\d{2}))?/g)]
  .map(m => Number(m[1].replace(/[\s\u00a0\u202f]/g, '') + (m[2] ? '.' + m[2] : '')));
const pctOf = (s, re) => { const m = String(s).match(re); return m ? Number(m[1]) : null; };

const budget = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + '| Salary | income | 20000.00 |  |\n| Groceries | expense | 6000.00 |  |\n'
  + '| Fuel | expense | 4000.00 |  |\n| Emergency fund | savings | 2000.00 |  |\n';

const files = () => ({
  ...base(),
  [`${B}/Categories/Fuel.md`]: cat('expense'),
  [`${B}/Categories/Emergency fund.md`]: cat('savings'),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '30000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: budget,
  [`${B}/Transactions/Cheque/2026-08.md`]: tx([
    ['2026-08-02', 'Salary', 'Salary', 20000],
    ['2026-08-05', 'Checkers', 'Groceries', -5000],
  ]),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 20000],
    ['2026-09-03', 'Checkers', 'Groceries', -6500],
    ['2026-09-04', 'Engen', 'Fuel', -4000],
    ['2026-09-05', 'Fund debit order', 'Emergency fund', -2000],
  ]),
});

(async () => {
  const SPENT = 10500, SPENDING = 10000, PLAN = 12000, SET_ASIDE = 2000;

  /* ---- 1. the Dashboard ----------------------------------------------------- */
  {
    const { nodes, t } = await renderDash(files(), { today: '2026-09-20' });
    const hero = t('#heroCard');
    const sub = textOf(find(nodes.get('#heroCard'), n => n.attrs && n.attrs['data-fig'] === 'hero-budget')[0]);

    ok(/spending budget/.test(sub), `the hero sub-line names its denominator: ${sub}`);
    ok(!/budgeted/.test(sub), `and no longer calls the spend-only figure "budgeted": ${sub}`);
    const [spent, denom] = moneys(sub);
    eq([spent, denom], [SPENT, SPENDING], 'the sub-line prints spent and the spending budget');

    const pct = pctOf(hero, /(\d+)% of spending budget used/);
    ok(pct !== null, `the Spent stat says what the percentage is of: ${hero}`);
    eq(Math.round((spent / denom) * 100), pct, 'dividing the printed spent by the printed denominator gives the printed %');
    ok(Math.round((SPENT / PLAN) * 100) !== pct, 'control: the whole-plan reading (88%) is not what is printed');

    /* The Budgeted stat states the whole plan and how much of it is set aside,
       so the two denominators reconcile on the same card. */
    const stat = find(nodes.get('#heroCard'), n => hasClass(n, 'stat') && /Budgeted/.test(textOf(n)))[0];
    ok(stat, 'the Budgeted stat is rendered');
    const statText = textOf(stat);
    /* "R total … R moved of R set-aside saved so far": the set-aside is the last figure. */
    const statMoneys = moneys(statText);
    const [total, aside] = [statMoneys[0], statMoneys[statMoneys.length - 1]];
    eq(total, PLAN, 'the Budgeted stat still states the whole plan');
    ok(/saved so far/.test(statText), `and says the set-aside is part of it: ${statText}`);
    eq(aside, SET_ASIDE, 'with the set-aside envelopes named');
    eq(total - aside, denom, 'so plan less set-aside IS the denominator printed above');

    /* The trend readout's row is the same series as the hero's denominator. */
    const tips = find(nodes.get('#trendChart'), n => hasClass(n, 'trend-tip-name')).map(textOf);
    ok(tips.includes('Spending budget'), `the trend tooltip row is named for what it plots: ${JSON.stringify(tips)}`);
    ok(!tips.includes('Budget'), 'not the bare word "Budget"');
  }

  /* ---- 2. the Budget page --------------------------------------------------- */
  {
    const unpin = pinClock('2026-09-20');
    let M;
    try {
      M = await mountFor(files(), { period: '2026-09' });
      M.ctx.renderBudgets();
    } finally { unpin(); }
    const strip = M.nodes.get('#budTotalsTop');
    const fig = name => find(strip, n => n.attrs && n.attrs['data-fig'] === name)[0];
    const tile = name => textOf(find(strip, n => hasClass(n, 'bud-total') && find(n, m => m.attrs && m.attrs['data-fig'] === name).length)[0]);

    const budgetedTile = tile('bud-budgeted');
    const [plan, aside] = moneys(budgetedTile);
    eq(plan, PLAN, 'Total budgeted is the whole plan');
    ok(/for savings/.test(budgetedTile), `and the tile says the set-aside is part of it: ${budgetedTile}`);
    eq(aside, SET_ASIDE, 'naming the set-aside envelopes');
    ok(fig('bud-budgeted-setaside'), 'the fragment has its own name for the reconciliation');

    const spentTile = tile('bud-spent');
    const [spent] = moneys(spentTile);
    eq(spent, SPENT, 'Total spent is the set-aside-free numerator');
    const pct = pctOf(spentTile, /(\d+)% of spending budget used/);
    ok(pct !== null, `and the percentage says what it is of: ${spentTile}`);
    eq(Math.round((spent / (plan - aside)) * 100), pct,
      'printed spent / (printed Total budgeted − printed set-aside) gives the printed %');
    ok(Math.round((spent / plan) * 100) !== pct, 'control: dividing by the whole plan would not');
  }

  /* ---- 3. a plan with nothing set aside adds no line ------------------------- */
  {
    const f = files();
    f[`${B}/Budgets/2026-09.md`] = budget.replace('| Emergency fund | savings | 2000.00 |  |\n', '');
    const unpin = pinClock('2026-09-20');
    let M;
    try { M = await mountFor(f, { period: '2026-09' }); M.ctx.renderBudgets(); } finally { unpin(); }
    const text = textOf(M.nodes.get('#budTotalsTop'));
    ok(!/of which/.test(text), `no "of which" when nothing is set aside: ${text}`);
  }

  /* ---- 4. every language carries the keys, and the Report reads the same words - */
  {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'src', 'lang');
    const en = require(path.join(dir, 'en.js'));
    for (const key of ['bud.total.setAsidePlanned', 'dash.stat.ofWhichSetAside', 'dash.hero.sub', 'dash.stat.used', 'bud.total.spentNote']) {
      for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'en.js')) {
        const v = require(path.join(dir, f))[key];
        ok(v && v !== en[key], `${f} has its own ${key}`);
      }
    }
    eq(i18n.t('dash.hero.sub', { spent: 'A', budgeted: 'B' }), 'A spent of B spending budget', 'the hero sentence, as the Report also prints it');
  }

  console.log(`PASS dashboard-audit-spending-budget (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
