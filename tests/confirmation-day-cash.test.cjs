'use strict';
/* ISSUE 45 — "money you have right now" with no payday in it.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs): every account confirmed `balance_updated:
   2026-09-01`, and the cheque account carrying three rows dated 2026-09-01 —
   a R35 000 salary, a R3 500 medical aid debit and a R2 000 transfer out,
   netting +R29 500. The card read

     cash on hand   R41 800

   with payday nowhere in it and nothing on screen explaining why.

   THE RULE IS NOT THE BUG. reconcile() skips rows dated on or before
   `balance_updated`, and it has to: views/accounts.js's accept handler stamps
   that date to the LAST row it counted, so a row sharing the date has already
   been folded into the figure on file. Read with `<` instead, every accepted
   reconciliation would count its own boundary rows a second time on the next
   pass — and that handler's own comment already names the case as the one
   thing day-granularity dates cannot resolve.

   THE SILENCE IS THE BUG. Two readings fit what the reader saw — "the app has
   missed my salary" and "the balance I typed already contains it" — they are
   opposite conclusions, and only one of them is a reason to act. This app does
   not get to leave that open: it argues rather than corrects, and currency.js's
   own rule is that money is never left out of a figure without being named.

   So reconcile() now COUNTS what it skips at the boundary and hands it back
   with the verdict — the same shape `unreadable` already takes, and for the
   same stated reason (a count, not a sixth state, so no caller has to learn a
   new vocabulary before this can ship) — and the cash card says it.

   WHAT IS PINNED

     1. The skip itself, unchanged, in both directions: a row ON the boundary
        stays out of `since`, and a row after it stays in. This test would be
        worthless if the fix had quietly changed the arithmetic.
     2. `sameDay` is reported on every verdict that walked the rows — clean,
        pending and drift alike — because an account with nothing else moving
        is exactly where the silence was loudest.
     3. The net, not just the count: three rows netting nothing is a
        formality, three rows netting R29 500 is the whole claim.
     4. The card says it, through the REAL view — and says it only about the
        accounts whose money is actually in the figure.

     node tests/confirmation-day-cash.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, TODAY, atAuditDate } = require('./_audit-seed.cjs');
const { reconcile } = require('../src/reconcile');
const { cashOnHand } = require('../src/committed');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* --------------- 1. the arithmetic is untouched, both ways --------------- */
{
  const a = { balance: 1000, balance_updated: '2026-09-01' };
  const r = reconcile(a, [
    { date: '2026-09-01', amount: 500 },     // on the boundary — already counted
    { date: '2026-09-02', amount: -200 },    // after it — moves the figure
  ], '2026-09-03');
  eq(r.state, 'drift', 'a row after the boundary still moves the balance');
  eq(r.delta, -200, 'and only that row does — the boundary row is not folded in');
  eq(r.implied, 800, 'so the implied balance is unchanged by this fix');
  eq(r.sameDay, { count: 1, net: 500 },
    'but the boundary row is now COUNTED rather than merely skipped');
}

/* ------- 2. reported on every verdict that walked the rows -------------- */
{
  const a = { balance: 1000, balance_updated: '2026-09-01' };
  const clean = reconcile(a, [{ date: '2026-09-01', amount: 500 }], '2026-09-03');
  eq(clean.state, 'clean', 'an account whose only rows sit on the boundary reads clean');
  eq(clean.sameDay, { count: 1, net: 500 },
    'and still discloses them — this is where the silence was loudest, not quietest');

  const pending = reconcile(a, [
    { date: '2026-09-01', amount: 500 }, { date: '2026-09-09', amount: -100 },
  ], '2026-09-03');
  eq(pending.state, 'pending', 'a future-dated row alone leaves the account pending');
  eq(pending.sameDay, { count: 1, net: 500 }, 'and the boundary row is reported there too');

  const none = reconcile(a, [{ date: '2026-09-04', amount: -100 }], '2026-09-05');
  eq(none.sameDay, { count: 0, net: 0 },
    'an account with nothing on its boundary says so as a zero, not an undefined a template would print');
}

/* ---- 3. the net matters as much as the count: offsetting rows ---------- */
{
  const a = { balance: 1000, balance_updated: '2026-09-01' };
  const r = reconcile(a, [
    { date: '2026-09-01', amount: 2000 }, { date: '2026-09-01', amount: -2000 },
  ], '2026-09-03');
  eq(r.sameDay, { count: 2, net: 0 },
    'two boundary rows that cancel are two rows and nothing to worry about — the caveat must be able to say both');
}

/* ---------------- 4. the household, and what the card says -------------- */
/* Every rendered assertion below runs on 2026-09-02, the day of the audit —
   see atAuditDate's own note for why the real clock would make this file
   stop testing anything in October. */
atAuditDate(async () => {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;

  const idx = ctx.accountIndex();
  const byName = new Map(S.accounts.map(a => [a.name, reconcile(a, (idx.get(a) || {}).rows || [], TODAY)]));
  eq(byName.get('Cheque').sameDay, { count: 3, net: 29500 },
    'the cheque account really does hold R29 500 of confirmation-day activity, salary included');
  eq(byName.get('Baby fund').sameDay, { count: 1, net: -5000 }, 'and the baby fund a R5 000 outflow');
  eq(byName.get('Emergency fund').sameDay, { count: 1, net: 2000 }, 'and the emergency fund the transfer in');

  /* The figure itself is deliberately NOT changed by this fix — see the
     header. Pinned so a later "just include same-day rows" edit has to argue
     with the accept handler rather than sail past it. */
  const accts = S.accounts.map(a => {
    const r = byName.get(a.name);
    return { name: a.name, inBudget: true, dated: r.state !== 'no-date',
      implied: r.state === 'drift' ? r.implied : a.balance };
  });
  eq(cashOnHand(accts).cash, 41800,
    'cash on hand is the same R41 800 the audit saw — this fix names what is behind it, it does not restate it');

  const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
    'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
    'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
    'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];
  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();

  /* 3 + 1 + 1 rows across the three in-budget accounts, netting
     29 500 − 5 000 + 2 000 = 26 500. Asserted through i18n.t() rather than an
     English literal, and with `count` passed because t() picks the plural off
     `count` alone. */
  const left = nodes.get('leftBody').textContent;
  const want = i18n.t('dash.left.confirmDay', { count: 5, amount: 'R 26500' });
  ok(left.includes(want),
    `the cash card names the confirmation-day activity behind its figure — wanted "${want}", got: ${left}`);

  console.log(`PASS confirmation-day-cash (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
