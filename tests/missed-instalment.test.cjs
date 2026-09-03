'use strict';
/* ISSUE 46 — a missed debt instalment drops off "still committed" the day
   after it was due.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs): an FNB card, R500 a month, start 2025-01-01 so due
   day 1, and no September payment row anywhere in the ledger.

     debtCommitments({ ..., from: '2026-09-02' })   ->  []
     whatsLeft(...).committed                        ->  0
     the card                                        ->  "nothing scheduled"

   and "actually free" was the entire cash pile, on the one day of the month
   the household most needs that figure to be right.

   THE MECHANISM is two halves of one rule looking at two different windows.
   Rule 2 — "has this already been paid?" — searches [periodStart, to]. The
   date placement asked nextOnDay(from = TODAY), so on 2 Sep the next day-1 it
   could find was 1 OCTOBER, past the period end, and the item was dropped.
   Rule 2 correctly found no payment and correctly did not skip it; the
   instalment then fell out the other side of the same function anyway.

   whatsLeft's window genuinely does start at today, on the argument that "a
   charge dated earlier that never arrived is not still coming, it is missing".
   That is right for a SERVICE, whose charge is somebody else's to make. A
   contracted instalment does not stop being owed because its day went by, and
   this is the difference the fix draws.

   WHAT IS PINNED

     1. An unpaid instalment whose day has passed is still committed, and is
        marked `missed` rather than silently carried — the app argues, it does
        not correct.
     2. Rule 2 still wins. A payment recorded against the debt's category
        anywhere in the period clears it, on the 2nd or the 30th, and the item
        does NOT come back as missed.
     3. An instalment due LATER in the period is unchanged, and is not marked
        missed.
     4. An instalment whose day falls after the period ends is still dropped —
        the guard this fix must not swallow.
     5. The view says "was due 1 Sep", not "expected 1 Sep": on the 2nd, the
        second sentence tells the reader to wait for something that has already
        not happened.

     node tests/missed-instalment.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, TODAY, PERIOD, atAuditDate } = require('./_audit-seed.cjs');
const { debtCommitments, whatsLeft } = require('../src/committed');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const START = '2026-09-01', END = '2026-09-30';
const CARD = { name: 'FNB card', lender: 'FNB', balance: 8000, payment: 500, extra: 0,
  start: '2025-01-01', category: 'Debt', status: 'active' };
const run = (debts, rows, today, from) => debtCommitments({
  debts, rows: rows || [], from: from || today, to: END,
  periodStart: START, periodDays: 30, today,
});

/* ------------------- 1. the defect itself, at the pure rule -------------- */
{
  const got = run([CARD], [], TODAY);
  eq(got.length, 1, 'an unpaid instalment whose day has passed is still committed');
  eq(got[0].amount, 500, 'for the amount the debt states');
  eq(got[0].due, '2026-09-01', 'placed on its day IN THIS PERIOD, not on the next one a month away');
  eq(got[0].missed, true, 'and marked missed, so the card can say so rather than imply it is still coming');
}

/* ---------------------- 2. rule 2 still wins ----------------------------- */
{
  const paidEarly = run([CARD], [{ date: '2026-09-01', cat: 'Debt', amount: -500 }], TODAY);
  eq(paidEarly, [], 'a payment on the due day clears it');
  /* ISSUE 55 CORRECTED THIS LINE. It used to assert that a payment dated
     LATER in the period also cleared the commitment, on the reasoning that
     "rule 2 reads the whole period, and always did". That was the defect: the
     money has not left the account yet — reconcile() puts such a row in
     `ahead` and cash still counts it — so clearing the commitment took R500
     out of both figures and over-stated "actually free" by the whole
     instalment. Services had carried a `date <= today` filter since ISSUE 47;
     the debt half now does too. */
  const paidLate = run([CARD], [{ date: '2026-09-28', cat: 'Debt', amount: -500 }], TODAY);
  eq(paidLate.length, 1, 'a payment dated LATER in the period has not happened yet, so the instalment is still committed');
  eq(paidLate[0].amount, 500, 'for its full amount — the money is still in the account');
  const paidLateArrived = run([CARD], [{ date: '2026-09-28', cat: 'Debt', amount: -500 }], '2026-09-29');
  eq(paidLateArrived, [], 'and once that day arrives it clears, exactly as an earlier payment does');
}

/* ------------------ 3. a future instalment is unchanged ------------------ */
{
  const later = run([{ ...CARD, start: '2025-01-20' }], [], TODAY);
  eq(later.length, 1, 'an instalment due later this period is claimed, as it always was');
  eq(later[0].due, '2026-09-20', 'on its own day');
  eq(later[0].missed, false, 'and is not "missed" — nothing has been missed yet');
}

/* ------------- 4. the after-the-period guard is not swallowed ------------ */
{
  const short = debtCommitments({
    debts: [{ ...CARD, start: '2025-01-25' }], rows: [], from: '2026-09-02',
    to: '2026-09-10', periodStart: '2026-09-01', periodDays: 10, today: TODAY,
  });
  eq(short, [], 'an instalment whose day falls after the window ends is still not this window\'s problem');
}

/* --------- 5. the household, and the sentence the card prints ------------ */
/* Every rendered assertion below runs on 2026-09-02, the day of the audit —
   see atAuditDate's own note for why the real clock would make this file
   stop testing anything in October. */
atAuditDate(async () => {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;

  const L = whatsLeft({
    accounts: [], services: [], debts: S.debts, rows: [], incomeRows: [], cardRows: [],
    periodStart: START, periodEnd: END, today: TODAY,
  });
  eq(L.committed, 500, "the audit household's card no longer reads R0 committed");
  eq(L.items.length, 1, 'with exactly one item behind that figure');
  ok(L.items[0].missed, 'and it is the missed instalment');

  /* The row the disclosure table prints. Driven through the REAL view, and
     asserted through i18n.t() rather than an English literal — the twelve
     tables are filled in a separate lane and a hard-coded sentence would go
     red on a translation rather than on the defect. */
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

  const left = nodes.get('leftBody').textContent;
  ok(left.includes(i18n.t('dash.left.overdue', { date: '2026-09-01' })),
    `the card says the instalment WAS due, not that it is expected — got: ${left}`);
  ok(!left.includes(i18n.t('dash.left.expected', { date: '2026-09-01' })),
    'and never tells the reader to wait for something that has already not happened');
  ok(!left.includes(i18n.t('dash.left.none')),
    'and no longer reports "nothing scheduled" over a real unpaid instalment');

  console.log(`PASS missed-instalment (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
