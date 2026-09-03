'use strict';
/* ISSUE 41's omission, on every surface that states a spend total.

   summaryInRange vetoes outgoings from an account the household has declared
   set aside, so on the `BudgetAudit` household "Total spent" is R4 700 in a
   period that moved R9 700 out of its accounts. That is the right total — the
   R5 000 pram came out of the baby fund, not out of the grocery budget — but
   it is R5 000 a reader cannot reconcile against their own bank statement
   without being told.

   The Dashboard hero said so from the start. The Budget page and the exported
   report did not: three surfaces, one figure, two of them silent. That is the
   same shape as every other finding in this audit, pointed at a caveat instead
   of at a number, and it is why the report matters most — it is read by
   someone who cannot see either screen.

   ALSO PINNED HERE: the separator. `gapNote` is APPENDED to the spent tile's
   own sentence, and two of its fragments carry no leading ' · ' of their own —
   they guarded on `gapNote` being non-empty, which is not the same question.
   On a period whose only disclosure was this one, the result ran together as
   "45% of budget usedR 5000,00 more went out of your funds". The guard now
   asks whether anything stands to the LEFT of the fragment, which is what the
   separator is actually for.

     node tests/fund-spend-disclosed.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const i18n = require('../src/i18n');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');
const { financialReportMarkdown, financialReportJson, prepareReportData } = require('../src/report');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const textOf = node => {
  let out = '';
  const walk = n => { if (n._text) out += n._text + ' | '; for (const c of (n.children || [])) walk(c); };
  walk(node);
  return out;
};

atAuditDate(async () => {
  /* ---------------- the Budget page ---------------- */
  {
    const { $ } = makeDom();
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    ctx.typeBadge = t => el('span', {}, t);
    ctx.switchView = () => {};
    require('../src/categories')(ctx);
    require('../src/views/budgets')(ctx);
    ctx.renderBudgets();

    const txt = textOf($('#budTotalsTop'));
    const want = i18n.t('dash.fundedFromSavings', { amount: 'R 5000.00', count: 1 });
    ok(txt.includes(want),
      `the Budget page names the R5 000 its total does not hold — wanted "${want}", got: ${txt}`);
    /* The same key the Dashboard uses, so the two screens cannot word one fact
       differently — asserted by the shared key above, not by a copy of the
       sentence. And the separator: no digit may butt onto a word. */
    ok(/used · R 5000\.00 more/.test(txt),
      `the fragment is separated from the sentence it follows — got: ${txt}`);
    ok(!/usedR /.test(txt), 'and never runs onto the end of it');
  }

  /* ---------------- the exported report ---------------- */
  {
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    const sum = ctx.periodSummary(PERIOD);
    eq(sum.fundedFromSavings, { spend: 5000, count: 1 },
      'the household really did move R5 000 out of a fund this period');

    const data = prepareReportData({
      generated: '2026-09-02 09:00', periodLabel: 'September 2026',
      rangeNote: '1 – 30 Sep 2026', detail: 'summary', currency: 'R',
      income: sum.income, spend: sum.spend, net: sum.net,
      budgetIncome: 35000, budgetSpend: 14500,
      categories: [], spendByCategory: [{ cat: 'Groceries', amount: 1200, orphaned: false }],
      categoryGap: { uncat: 0, netted: 0 },
      fundedFromSavings: sum.fundedFromSavings,
      savings: null, debts: null, transactions: null,
      netWorth: { net: 120800, assets: 128800, liabilities: 8000 },
      health: null,
    });

    const md = financialReportMarkdown(data, (v, dp = 2) => `R ${Number(v).toFixed(dp)}`);
    const want = i18n.t('report.category.fromFunds', { amount: 'R 5000.00', count: 1 });
    ok(md.includes(want),
      `the exported markdown states the omission — wanted "${want}"`);

    const json = JSON.parse(financialReportJson(data));
    eq(json.funded_from_savings, { spend: 5000, count: 1 },
      'and a machine reader gets the same fact as a field, not as prose it would have to parse');
  }

  /* ---------------- and stays quiet with nothing to say ---------------- */
  {
    const data = prepareReportData({
      generated: '2026-09-02 09:00', periodLabel: 'September 2026',
      rangeNote: '1 – 30 Sep 2026', detail: 'summary', currency: 'R',
      income: 35000, spend: 4700, net: 30300, budgetIncome: 35000, budgetSpend: 14500,
      categories: [], spendByCategory: [{ cat: 'Groceries', amount: 1200, orphaned: false }],
      categoryGap: { uncat: 0, netted: 0 },
      fundedFromSavings: { spend: 0, count: 0 },
      savings: null, debts: null, transactions: null,
      netWorth: { net: 1, assets: 1, liabilities: 0 }, health: null,
    });
    const md = financialReportMarkdown(data, (v, dp = 2) => `R ${Number(v).toFixed(dp)}`);
    ok(!md.includes(i18n.t('report.category.fromFunds', { amount: 'R 0.00', count: 0 })),
      'a household with no fund spending gets no sentence about it — a caveat qualifying nothing is how real ones stop being read');
    eq(JSON.parse(financialReportJson(data)).funded_from_savings, { spend: 0, count: 0 },
      'though the JSON field is always present, so a consumer never has to test for its absence');
  }

  console.log(`PASS fund-spend-disclosed (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
