'use strict';
/* ISSUES 40, 41 and 43 — three readings of one confusion: money the household
   set aside, counted as money it can spend.

   Reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs). September budgeted R14 500 — Groceries 6 000, Gym
   1 000, Medical 3 500, Emergency 2 000, Investing 2 000 — against R11 590
   spent, leaving a hero reading "Budget remaining this period R2 910".

     #40  That R2 910 was R4 000 of unfilled SAVINGS envelopes less R1 090 of
          grocery overspend. Two facts that had cancelled into a number
          looking like headroom. A household reading it spends the emergency
          fund's allocation on groceries and the card calls it fine.

     #41  R5 000 of the "spend" was a pram bought out of the baby fund —
          an account of type `savings`, opening balance R8 000. On screen that
          read exactly like blowing the grocery budget at Checkers, while the
          health card beside it went on counting the same R8 000 as cover.

     #43  Emergency and Investing showed R0 spent after the household had
          already moved R2 000 into the emergency fund, because both legs of
          that transfer are categorised Transfer and summaryInRange skips
          transfer-typed rows. Not a wrong total — a figure saying you have
          not done the thing you did this morning.

   THE ONE RULE: money the household has declared set aside — by CATEGORY type
   (savings/investment) or by ACCOUNT (a savings/investment account, or one
   carrying an `emergency_fund` earmark) — is not this period's spending money,
   on either side of the ratio.

   BOTH SIDES, and that is the load-bearing part. A remaining figure built from
   a narrowed budget and an unnarrowed actual would be a new version of the same
   defect rather than a fix for it.

   WHAT #43 CANNOT DO, stated so nobody re-opens it expecting more: there is no
   link from a transfer row to a budget CATEGORY. The cheque leg says
   "Transfer", the envelope says "Emergency", and matching them on the
   description would be guessing at free text — which this repo refuses to do
   for the reason worth.js's cardOverlap sets out. So the per-envelope actual
   stays R0 and the AGGREGATE is stated beside the budgeted figure instead.

     node tests/earmarked-envelopes.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, B, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

async function vault(files) {
  const ctx = makeCtx(files || SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  return { ctx, S };
}

atAuditDate(async () => {
  const { ctx } = await vault();
  const sum = ctx.periodSummary(PERIOD);
  const bud = ctx.budgetTotals(PERIOD);

  /* --------------- #40: the budget side, split by type ------------------ */
  eq(bud.spend, 10500, 'the SPEND envelopes are Groceries 6 000 + Gym 1 000 + Medical 3 500');
  eq(bud.setAside, 4000, 'and Emergency + Investing are set aside, not spending money');
  eq(bud.income, 35000, 'income is unchanged');

  /* --------------- #41: the actual side, by account --------------------- */
  eq(sum.spend, 4700, 'spend is Discovery 3 500 + Checkers 1 200 — the pram is not in it');
  eq(sum.fundedFromSavings, { spend: 5000, count: 1 },
    'the pram is named as money that left a fund, not dropped');
  eq(sum.byCat.Groceries, -1200,
    'and the Groceries envelope reads what was actually spent on groceries, so the hero and the budget table cannot disagree');

  /* The remaining figure the hero now states: spend against spend. */
  eq(bud.spend - sum.spend, 5800, 'R5 800 of spend budget is genuinely left');

  /* --------------- #43: what was actually set aside --------------------- */
  eq(ctx.movedToFunds(PERIOD), 2000,
    'R2 000 really did reach the emergency fund, however its rows are categorised');
  eq(sum.byCat.Emergency, undefined,
    'the per-envelope actual is still R0 — there is no link from a Transfer row to a budget category, and this app does not guess at free text');

  /* ---------------- the household declared all of this ------------------ */
  {
    /* Nothing here is inferred from a NAME. Retype the category and the
       account and the same rows go back to being ordinary spending — which is
       the negative control that proves the rule is reading the household's own
       declarations rather than the words "Emergency" and "Baby". */
    const PLAIN = { ...SEED };
    PLAIN[`${B}/Categories/Emergency.md`] = '---\ntype: expense\ncolor: "#cc9933"\n---\n';
    PLAIN[`${B}/Categories/Investing.md`] = '---\ntype: expense\ncolor: "#33cc99"\n---\n';
    PLAIN[`${B}/Accounts/Baby fund.md`] =
      '---\ntype: checking\ntx_label: "Baby fund"\nbalance: 8000.00\nbalance_updated: 2026-09-01\n---\n';
    const { ctx: c2 } = await vault(PLAIN);
    eq(c2.budgetTotals(PERIOD).setAside, 0,
      'an expense-typed envelope is spending, because that is what the household wrote');
    eq(c2.periodSummary(PERIOD).spend, 9700,
      'and a purchase from a plain checking account burns the budget, exactly as it always did');
  }

  /* -------------- and `budget: true` is taken at its word --------------- */
  {
    const OPTED_IN = { ...SEED };
    OPTED_IN[`${B}/Accounts/Baby fund.md`] =
      '---\ntype: savings\ntx_label: "Baby fund"\nbudget: true\nbalance: 8000.00\nbalance_updated: 2026-09-01\n---\n';
    const { ctx: c3 } = await vault(OPTED_IN);
    eq(c3.periodSummary(PERIOD).spend, 9700,
      'a household that says it spends from this savings account is believed — an absent key is not consent, but a stated one is');
  }

  /* ------------------------ and the card says it ------------------------ */
  {
    const { FakeEl } = makeDom();
    const { ctx: c4 } = await vault();
    const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
    c4.$ = sel => nodes.get(sel.slice(1)) || null;
    c4.root = new FakeEl('div');
    c4.plugin.settings = { ...c4.plugin.settings, chartTrendRange: '6m' };
    c4.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    require('../src/views/dashboard')(c4);
    c4.renderDashboard();
    const hero = nodes.get('heroCard').textContent;

    ok(hero.includes('R5800'), `the hero states the spend remaining — got: ${hero}`);
    ok(!hero.includes('R2910'), 'never the figure that mixed unfilled envelopes with grocery overspend');
    ok(hero.includes(i18n.t('dash.fundedFromSavings', { amount: 'R 5000', count: 1 })),
      `and names the pram it stopped counting — got: ${hero}`);
    ok(hero.includes(i18n.t('dash.stat.setAsideMoved', { amount: 'R 4000', moved: 'R 2000' })),
      `and states what was budgeted to set aside beside what actually moved — got: ${hero}`);
  }

  console.log(`PASS earmarked-envelopes (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
