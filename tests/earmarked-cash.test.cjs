'use strict';
/* ISSUE 48 — "actually free" offering the emergency fund at R1 493 a day.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs):

     cash on hand   R41 800   cheque R18 800 + emergency R15 000 + baby R8 000
     committed      R0
     actually free  R41 800   over 28 days = R1 493/day

   The emergency fund carries `emergency_fund: true`. The baby fund is
   `type: savings`. Both were offered as this week's spending money — while the
   health card four tiles along, off the same accounts, said the household had
   1.6 months of cover. One dashboard telling the reader to spend the emergency
   fund and to worry that it is too small.

   The card's own copy says both "in your accounts" and "actually free". The
   first is true of every rand of it. The second was true of R18 300.

   WHAT `cash` IS NOT. The top figure does not move and must not: money in a
   savings account IS money in your accounts, and a figure with that caption
   quietly omitting it would be a different lie. The earmark comes out of
   `free` and out of nothing else.

   WHY IT IS A VISIBLE TERM. This strip is the one place on the page whose
   arithmetic has to survive being re-added by eye — views/dashboard.js rebuilds
   the free figure from the ROUNDED terms for exactly that reason. Deducting
   an earmark silently would have broken that in the same edit that fixed the
   number: the reader would have seen R41 800 − R500 = R18 300 and been right
   to distrust the card.

   WHAT IS PINNED

     1. Both declarations count, and both are the HOUSEHOLD'S: the
        `emergency_fund` flag (true, or a partial number) and an account typed
        savings/investment. Nothing is guessed from a name.
     2. `cash` is unchanged. Only `free` moves.
     3. The strip re-adds: cash − earmarked − committed = free, in the rounded
        figures the reader actually sees.
     4. The accounts are NAMED, because a figure held back that cannot be
        traced invites the reader to assume it is wrong.
     5. An over-declared earmark cannot drive `free` negative and turn a
        solvent household into a "short" one.
     6. `budget: false` still wins — the household's existing way to say an
        account is not part of these figures at all.

     node tests/earmarked-cash.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');
const { cashOnHand, whatsLeft } = require('../src/committed');
const { resolveEarmarks } = require('../src/health-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const acct = o => ({ name: 'x', inBudget: true, dated: true, implied: 0, ...o });

/* ------------------------- 1. what counts as spoken for ----------------- */
{
  eq(cashOnHand([acct({ implied: 1000 })]).earmarked, 0,
    'an ordinary cheque account is not earmarked');
  eq(cashOnHand([acct({ implied: 1000, emergencyFund: true })]).earmarked, 1000,
    'a fund flagged in full takes its whole balance');
  eq(cashOnHand([acct({ implied: 1000, emergencyFund: 400 })]).earmarked, 400,
    'a PARTIAL earmark takes only what the household declared');
  eq(cashOnHand([acct({ implied: 300, emergencyFund: 400 })]).earmarked, 300,
    'and never more than the account actually holds');
  eq(cashOnHand([acct({ implied: 1000, type: 'savings' })]).earmarked, 1000,
    'a savings account is money set aside by the act of putting it there');
  eq(cashOnHand([acct({ implied: 1000, type: ' Investment ' })]).earmarked, 1000,
    "case-folded and trimmed — load.js only defaults `type` when the key is ABSENT, so ' Investment ' reaches here as written");
  eq(cashOnHand([acct({ implied: 1000, type: 'savings', inBudget: false })]).earmarked, 0,
    'and `budget: false` still wins: the household already had a way to say an account is not in these figures at all');
}

/* ------ 2. the same reading the score's own earmark uses ---------------- */
{
  /* committed.js and health-math.js may not require each other — one is the
     pure module the card is built from, the other the pure module the score
     is built from. That the two agree is therefore proven here rather than
     assumed by sharing a function. */
  const accounts = [{ name: 'Fund', balance: 15000, emergency_fund: true },
    { name: 'Part', balance: 5000, emergency_fund: 2000 }];
  const score = resolveEarmarks(accounts);
  const card = cashOnHand(accounts.map(a => acct({
    name: a.name, implied: a.balance, emergencyFund: a.emergency_fund,
  })));
  eq(card.earmarked, score.total,
    'the card and the score agree on how much is earmarked, over the same accounts');
}

/* --------- 3. cash does not move; free does. And it cannot go under ----- */
{
  const all = [acct({ name: 'Cheque', implied: 1000 }),
    acct({ name: 'Fund', implied: 4000, emergencyFund: true })];
  const c = cashOnHand(all);
  eq(c.cash, 5000, 'cash on hand still counts every rand in the accounts');
  eq(c.earmarked, 4000, 'and says how much of it is spoken for');
  eq(c.earmarkedFrom.map(e => e.name), ['Fund'], 'naming which account');

  const over = whatsLeft({
    accounts: [acct({ name: 'Fund', implied: 1000, emergencyFund: 9999 })],
    services: [], debts: [], rows: [], incomeRows: [], cardRows: [],
    periodStart: '2026-09-01', periodEnd: '2026-09-30', today: '2026-09-02',
  });
  eq(over.free, 0,
    'an over-declared earmark floors free at zero rather than reporting a shortfall the household does not have');
  ok(!over.short, 'and does not colour a solvent household red');
}

/* ------------- 4. the household, and the strip on screen --------------- */
const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

atAuditDate(async () => {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();

  const left = nodes.get('leftBody').textContent;
  ok(left.includes('R 41800'), `cash on hand is unchanged — got: ${left}`);
  ok(left.includes(`R 23000${i18n.t('dash.left.earmarked')}`),
    `the emergency fund and the baby fund are shown as set aside — got: ${left}`);
  ok(left.includes('Baby fund') && left.includes('Emergency fund'),
    'named, so the reader can disagree with the claim');
  /* R41 800 − R23 000 set aside − R1 500 committed. The committed figure is
     R1 500 rather than R500 because ISSUE 47 landed after this one: the weekly
     gym now claims the four charges still ahead of it this period, where it
     used to claim nothing at all. */
  ok(left.includes(`R 17300${i18n.t('dash.left.free')}`),
    `and actually free is what is left of the cheque account — got: ${left}`);
  ok(!left.includes(`R 41800${i18n.t('dash.left.free')}`),
    'never the whole pile, sinking funds included');

  /* The strip re-adds in the ROUNDED figures a reader sees. */
  eq(41800 - 23000 - 1500, 17300, 'cash − set aside − committed = free, by eye');

  /* And the per-day rate is drawn from the same figure as the headline —
     committed.js's own rule that every "free" on this card is ONE number. */
  ok(left.includes('R 618/day'),
    `the per-day rate divides the free figure, not the cash pile — got: ${left}`);

  console.log(`PASS earmarked-cash (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
