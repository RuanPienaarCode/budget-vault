'use strict';
/* "Where the money went" takes committed bills and living costs under ONE sign
   rule (2026-10-07 audit, L2a-07).

   periodFlow() splits gross spend (periodSummary's `spend`: every outflow in
   full, a refund its own row) into committed & fixed bills and living costs,
   with living = spent − committed. But `committed` was read off the TREND
   lens's NET category map, where a refund inside a fixed category has already
   been netted off. So a refunded rent payment left committed smaller by the
   refund while spent still held the payment in full, and the difference landed
   in living costs: on the audited vault, a period holding a rent refund printed
   Living costs higher than its own rule gives by exactly that refund. The
   net map also covered the WHOLE period while spent stops at today, so a fixed
   bill dated later in the running period was counted as committed before it
   was paid, and taken out of living costs to make room.

   Now the Score hands periodFlow the BUDGET lens's gross outgoings per
   category, over the same as-of-today window periodSummary uses: what was paid
   under each name, so far. One lens, one sign rule, one window for all three
   of spent, committed and living.

   Pure periodFlow() first, then the REAL loader and views/score.js, clock
   pinned. Synthetic rows.

     node tests/flow-committed-gross.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const { atAuditDate } = require('./_audit-seed.cjs');
const { periodFlow } = require('../src/money-flow');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const TYPES = { Rent: 'housing', Groceries: 'expense', TFSA: 'savings', Cover: 'insurance' };
const catType = c => TYPES[c] || null;

/* ---- 1. a refund inside a fixed category stays out of living costs ------ */
{
  /* Rent paid 9 000 and 1 000 of it refunded; groceries 500. Gross spend 9 500. */
  const args = { income: 20000, spentTotal: 9500, budgeted: 12000, fixedCats: new Set(['Rent']), catType, savingContribution: 0, debts: [] };
  const f = periodFlow({ ...args, grossOutByCat: { Rent: 9000, Groceries: 500 }, spendByCat: { Rent: 8000, Groceries: 500 } });
  near(f.bands.committed, 9000, 'committed is what was PAID under the fixed category');
  near(f.committedDetail.housing, 9000, 'and its housing sub-chip says the same');
  near(f.bands.living, 500, 'living costs are the groceries, not the groceries plus the rent refund');
  near(f.bands.committed + f.bands.living, 9500, 'committed + living = gross spend, the figure they split');
  /* Negative control: the net map alone reproduces the defect. */
  const old = periodFlow({ ...args, spendByCat: { Rent: 8000, Groceries: 500 } });
  near(old.bands.living, 1500, 'negative control: read off the net map, living costs swallow the R1 000 refund');
}

/* ---- 2. the savings-typed slice is gross too ------------------------------ */
{
  /* 2 000 into a savings-typed category, 500 of it reversed; groceries 500. */
  const f = periodFlow({ income: 20000, spentTotal: 2500, setAsideSpent: 2000, budgeted: 5000, fixedCats: new Set(), catType,
    savingContribution: 2000, debts: [], grossOutByCat: { TFSA: 2000, Groceries: 500 }, spendByCat: { TFSA: 1500, Groceries: 500 } });
  near(f.bands.living, 500, 'living excludes the WHOLE set-aside outflow that is inside gross spend, not its netted remainder');
}

/* ---- 3. on screen, through the real loader -------------------------------- */
const B = 'Budget';
const table = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |  |`).join('\n') + '\n';
const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: housing\nfixed: true\n---\n',
  [`${B}/Categories/Cover.md`]: '---\ntype: insurance\nfixed: true\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 20000.00\nbalance_updated: 2026-08-15\ntx_label: "Cheque"\n---\n',
  [`${B}/Budgets/2026-08.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n| Rent | housing | 9000.00 |  |\n| Cover | insurance | 800.00 |  |\n| Groceries | expense | 3000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: table([
    ['2026-08-01', 'Salary', 'Salary', 30000],
    ['2026-08-02', 'Landlord', 'Rent', -9000],
    ['2026-08-04', 'Landlord refund', 'Rent', 1000],
    ['2026-08-05', 'Checkers', 'Groceries', -500],
    /* Dated after today: periodSummary does not count it yet, so neither may committed. */
    ['2026-08-25', 'Cover debit order', 'Cover', -800],
  ]),
};
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? e.textContent : '');

atAuditDate(async () => {
  const { ctx, nodes } = await mountFor(files, { period: '2026-08' });
  ctx.renderScore();
  near(ctx.periodSummary('2026-08').spend, 9500, 'fixture check: gross spend so far is the rent and the groceries');
  const band = name => {
    const r = descend(nodes.get('#view-score')).filter(e => hasCls(e, 'score-flow-m-row'))
      .find(x => textOf(descend(x).find(e => hasCls(e, 'score-flow-m-name'))) === name);
    return r ? textOf(descend(r).find(e => hasCls(e, 'score-flow-m-amt'))) : null;
  };
  ok(band(i18n.t('score.flow.committed')) === ctx.money(9000, 0), `Committed & fixed bills prints the rent paid — got ${band(i18n.t('score.flow.committed'))}`);
  ok(band(i18n.t('score.flow.living')) === ctx.money(500, 0), `Living costs prints the groceries alone — got ${band(i18n.t('score.flow.living'))}`);
  const chip = descend(nodes.get('#view-score')).filter(e => hasCls(e, 'score-flow-chip'))
    .find(c => textOf(c.children.find(k => hasCls(k, 'l'))) === i18n.t('score.flow.chip.committed'));
  const chipRow = label => { const r = chip.children.filter(k => hasCls(k, 'score-flow-row')).find(x => textOf(x.children[0]) === label); return r ? textOf(r.children[1]) : null; };
  ok(chipRow(i18n.t('score.flow.chip.housing')) === ctx.money(9000, 0), 'the housing sub-chip agrees with the band');
  ok(chipRow(i18n.t('score.flow.chip.subscriptions')) === ctx.money(0, 0), 'and the insurance debit order dated after today is not committed yet');
  console.log(`PASS flow-committed-gross (${checks} checks)`);
}, '2026-08-15').catch(e => { console.error(e); process.exit(1); });
