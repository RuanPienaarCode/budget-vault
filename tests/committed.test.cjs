'use strict';
/* What's left — the forward view, and the six rules that make it trustworthy.

   src/committed.js is pure, so this runs in bare node with no stub. Every case
   passes an explicit `today`: a test that reads the wall clock passes in August
   and fails in September.

   The rule this file exists to defend is rule 2 — a commitment already charged
   is NOT a commitment. Medical aid that went off on the 1st is spent, not still
   coming. Counting it would inflate the committed figure every single period,
   and a reader who catches that once never trusts the card again.

     node tests/committed.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const {
  WHOLE_MONTH_DAYS, nextOnDay, isCreditCard, isSettleCard,
  cashOnHand, cardsOwed, serviceCommitments, debtCommitments, cardCommitments, whatsLeft,
} = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-08-13';
const P_START = '2026-07-26', P_END = '2026-08-25';   // a payday month, 31 days

/* A merchant charged on the 2nd of each month, at a price that rose. */
const fibreRows = [
  { date: '2026-05-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -779 },
  { date: '2026-06-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -859 },
  { date: '2026-07-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -859 },
];
const fibre = { name: 'Fibre', provider: 'Cool Ideas', cycle: 'monthly', amount: 779, active: true, next: '' };

/* ---- 1. nextOnDay places a day-of-month, and clamps a short month ---- */
{
  eq(nextOnDay('2026-08-13', 22), '2026-08-22', 'a day later this month');
  eq(nextOnDay('2026-08-13', 2), '2026-09-02', 'a day already past rolls to next month');
  eq(nextOnDay('2026-08-13', 13), '2026-08-13', 'today itself counts');
  eq(nextOnDay('2026-01-30', 31), '2026-01-31', 'the 31st exists in January');
  eq(nextOnDay('2026-02-15', 31), '2026-02-28', 'the 31st clamps to a short month, it does not skip it');
  eq(nextOnDay('', 5), null, 'no date, no placement');
  eq(nextOnDay('2026-08-13', 0), null, 'no day, no placement');
}

/* ---- 2. Cash: implied, in-budget, positive, and honest about gaps ---- */
{
  const r = cashOnHand([
    { name: 'Cheque', implied: 12400, dated: true, inBudget: true, type: 'checking' },
    { name: 'Credit Card', implied: -8400, dated: true, inBudget: true, type: 'credit_card' },
    { name: 'Holiday fund', implied: 5000, dated: true, inBudget: false, type: 'savings' },
    { name: 'Old savings', implied: 900, dated: false, inBudget: true, type: 'savings' },
  ]);
  eq(r.cash, 12400, 'only positive, in-budget balances are spendable cash');
  ok(r.cash !== 4000, 'a credit-card balance is a debt, not negative cash — the Debt page owns it');
  eq(r.counted, 1, 'counted = accounts that CONTRIBUTED; the card at -8400 added nothing, so it no longer pads the line');
  eq(r.unknown, ['Old savings'], 'an undated balance is NAMED, never folded in as zero');
}
{
  /* The count sits under the CASH figure, so it describes what that figure is
     made of. An account holding nothing put nothing into it. */
  const r = cashOnHand([
    { name: 'Empty', implied: 0, dated: true, inBudget: true, type: 'checking' },
    { name: 'Overdrawn', implied: -500, dated: true, inBudget: true, type: 'checking' },
  ]);
  eq(r.counted, 0, 'a zero and an overdrawn account contributed nothing, so neither is counted');
  eq(r.cash, 0, 'and neither added cash — an overdraft is not negative spending money');
}
{
  eq(cashOnHand([]).cash, 0, 'no accounts is no cash');
  eq(cashOnHand(null).counted, 0, 'a missing list is not a crash');
}

{
  /* Long-term money stays out via `budget: false`, which is the mechanism this
     app already has. There is deliberately no second type-based rule — this
     pins that, so a future "investment accounts obviously aren't cash" change
     has to argue with a test rather than land quietly. */
  const r = cashOnHand([
    { name: 'Cheque', implied: 10748, dated: true, inBudget: true, type: 'checking' },
    { name: 'Education Fund', implied: 350000, dated: true, inBudget: false, type: 'investment' },
    { name: 'Hedge Fund', implied: 55045, dated: true, inBudget: true, type: 'investment' },
  ]);
  eq(r.cash, 65793, 'an investment account left IN the budget is still counted — only `budget: false` excludes it');
  eq(r.counted, 2, 'and both contributing accounts are counted, whatever their type');
}

/* ---- 3. RULE 2: a charge already made is not still coming ---- */
{
  // Due on the 2nd. Today is the 13th, and the 2 Aug charge is in this period.
  const landed = [...fibreRows, { date: '2026-08-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -859 }];
  const out = serviceCommitments({
    services: [fibre], rows: landed, from: TODAY, to: P_END, periodStart: P_START,
  });
  eq(out, [], 'a service already charged in this period is NOT counted again');
}
{
  // Same service, same dates, but this period's charge has not landed.
  const out = serviceCommitments({
    services: [fibre], rows: fibreRows, from: '2026-07-30', to: P_END, periodStart: P_START,
  });
  eq(out.length, 1, 'a service not yet charged this period is still coming');
  eq(out[0].due, '2026-08-02', 'the due date is derived from the charge history, not typed');
  eq(out[0].amount, 859, 'RULE 3: the amount is what was really charged, not the 779 on the page');
  eq(out[0].basis, 'charged', 'and it says where the figure came from');
}

/* ---- 4. Only what falls inside the window ---- */
{
  const out = serviceCommitments({
    services: [fibre], rows: fibreRows, from: TODAY, to: P_END, periodStart: P_START,
  });
  eq(out, [], 'a charge due on the 2nd is not "still coming" on the 13th');
}
{
  const inactive = { ...fibre, active: false };
  eq(serviceCommitments({ services: [inactive], rows: fibreRows, from: '2026-07-30', to: P_END, periodStart: P_START }),
    [], 'an inactive service is not counted');
}
{
  // No history at all: the typed figure is all there is, and it is labelled.
  const svc = { name: 'iCloud', provider: 'Apple', cycle: 'monthly', amount: 199, active: true, next: '2026-08-20' };
  const out = serviceCommitments({ services: [svc], rows: [], from: TODAY, to: P_END, periodStart: P_START });
  eq(out.length, 1, 'a service with no charge history falls back to its typed date');
  eq(out[0].amount, 199, 'and to its typed amount');
  eq(out[0].basis, 'stated', 'clearly marked as stated rather than charged');
}

/* ---- 5. Debts: placed from real payments, and never double-counted ---- */
const bond = { name: 'Home loan', lender: 'FNB', payment: 2110, extra: 500, status: 'active', category: 'Bond', start: '2019-03-22' };
const paidHistory = [
  { date: '2026-05-22', desc: 'BOND', cat: 'Bond', amount: -2610 },
  { date: '2026-06-22', desc: 'BOND', cat: 'Bond', amount: -2610 },
  { date: '2026-07-22', desc: 'BOND', cat: 'Bond', amount: -2610 },
];
{
  const out = debtCommitments({
    debts: [bond], rows: paidHistory, from: TODAY, to: P_END, periodStart: P_START, periodDays: 31,
  });
  eq(out.length, 1, 'an unpaid instalment inside the window is still coming');
  eq(out[0].due, '2026-08-22', 'placed on the day the payments actually land');
  eq(out[0].amount, 2610, 'payment + extra, because both go out');
  eq(out[0].basis, 'contracted', 'a debt instalment is contracted, not observed');
}
{
  const paidThisPeriod = [...paidHistory, { date: '2026-08-05', desc: 'BOND', cat: 'Bond', amount: -2610 }];
  eq(debtCommitments({ debts: [bond], rows: paidThisPeriod, from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }),
    [], 'RULE 2 again: a debt already paid this period is not still coming');
}
{
  eq(debtCommitments({ debts: [{ ...bond, status: 'paid' }], rows: paidHistory, from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }),
    [], 'a settled debt is not counted');
  eq(debtCommitments({ debts: [{ ...bond, payment: 0, extra: 0 }], rows: [], from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }),
    [], 'a debt with no instalment has nothing to expect');
}
{
  /* RULE 6: unplaceable, so only a window of a whole month can claim it. On a
     weekly cycle a monthly instalment does NOT fall in every period, and
     claiming it three weeks out of four is the failure this guards. */
  const noLink = { ...bond, category: '', start: '' };
  eq(debtCommitments({ debts: [noLink], rows: [], from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }).length,
    1, 'a whole-month window can claim an unplaceable instalment');
  eq(debtCommitments({ debts: [noLink], rows: [], from: TODAY, to: '2026-08-19', periodStart: '2026-08-13', periodDays: 7 }),
    [], 'a weekly window must NOT claim a monthly instalment it cannot place');
  ok(WHOLE_MONTH_DAYS === 28, 'the threshold is a whole month');
}

/* ---- 5a. What is owed on cards: stated, never folded in ---- */
{
  const accts = [
    { name: 'Cheque', implied: 148, dated: true, inBudget: true, type: 'checking' },
    { name: 'Discovery Card', implied: -17011, dated: true, inBudget: true, type: 'credit_card' },
  ];
  const o = cardsOwed(accts);
  eq(o.owed, 17011, 'the owed figure is the outstanding card balance, as a positive');
  eq(o.cards, ['Discovery Card'], 'and the card is named, so a one-card household gets a sentence about ITS card');

  const L = whatsLeft({
    accounts: accts, services: [], debts: [], rows: [],
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.owed, 17011, 'the card reports what is owed');
  eq(L.cash, 148, 'and cash is UNCHANGED by it');
  eq(L.committed, 0, 'and committed is unchanged by it');
  eq(L.free, 148, 'and so is free — this is a sentence beside the figures, not arithmetic inside them');
}
{
  eq(cardsOwed([{ name: 'Card', implied: 1200, dated: true, inBudget: true, type: 'credit_card' }]).owed, 0,
    'a card in credit is not owed anything');
  eq(cardsOwed([{ name: 'Overdrawn', implied: -500, dated: true, inBudget: true, type: 'checking' }]).owed, 0,
    'an overdrawn cheque account is not a card — it is already visible as the cash it did not contribute');
  eq(cardsOwed([{ name: 'Card', implied: -900, dated: false, inBudget: true, type: 'credit_card' }]).owed, 0,
    'an undated card balance cannot be asserted — rule 1 applies here too');
  eq(cardsOwed([{ name: 'Card', implied: -900, dated: true, inBudget: false, type: 'credit_card' }]).owed, 0,
    'an out-of-budget card is out of this sentence');
  eq(cardsOwed([]).owed, 0, 'no accounts, nothing owed');
  eq(cardsOwed(null).cards, [], 'a missing list is not a crash');
}
{
  const two = cardsOwed([
    { name: 'Visa', implied: -1000, dated: true, inBudget: true, type: 'credit_card' },
    { name: 'Amex', implied: -2500, dated: true, inBudget: true, type: 'credit_card' },
  ]);
  eq(two.owed, 3500, 'two cards sum');
  eq(two.cards.length, 2, 'and both are named, so the view can switch to the counted sentence');
}
{
  /* A card that IS settled monthly appears in both places, and that is correct:
     the commitment says it leaves before the period ends, the owed line says
     what it is. Double-counting would need it inside `cash` as well, which is
     exactly what neither does. */
  const c = { name: 'Card', implied: -8874, dated: true, inBudget: true,
    type: 'credit_card', settleMonthly: true };
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 10748, dated: true, inBudget: true, type: 'checking' }, c],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 8874, 'settled monthly: it is a commitment');
  eq(L.owed, 8874, 'and the owed line still states it');
  eq(L.free, 1874, 'free counts it ONCE, through committed');
  eq(L.owedElse, 0, 'a card the chain claimed leaves NO unclaimed remainder — the sentence stays silent');
}
{
  /* THE MIXED HOUSEHOLD — the case the old view gate got wrong. One card is
     settled monthly and claimed by the chain (cardDue > 0); the second is
     revolved. The view used to gate its sentence on `owed > 0 && cardDue
     === 0`, all-or-nothing where the data is per-card, so the revolving
     card's R8 000 appeared in no figure and no sentence — the exact silent
     state the disclosure exists to end. `owedElse` is the per-card remainder:
     derived from the items the chain actually claimed, so the two cannot
     disagree about which cards were taken. */
  const L = whatsLeft({
    accounts: [
      { name: 'Cheque', implied: 30000, dated: true, inBudget: true, type: 'checking' },
      { name: 'Settle Card', implied: -17000, dated: true, inBudget: true, type: 'credit_card', settleMonthly: true },
      { name: 'Revolver', implied: -8000, dated: true, inBudget: true, type: 'credit_card' },
    ],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.cardDue, 17000, 'the settled card is claimed by the chain');
  eq(L.owed, 25000, 'owed still states every card in full');
  eq(L.owedElse, 8000, 'the unclaimed remainder is the revolving card alone');
  eq(L.owedElseCards, ['Revolver'], 'and it is named, so the sentence can say WHOSE balance this is');
}
{
  /* A settle-monthly card whose settle day falls AFTER the period ends is not
     claimed by the chain ("not this period's problem") — so it must surface
     in the remainder instead. Claimed nowhere and disclosed nowhere was the
     bug; unclaimed but disclosed is the contract. */
  const L = whatsLeft({
    accounts: [
      { name: 'Cheque', implied: 5000, dated: true, inBudget: true, type: 'checking' },
      { name: 'Late Card', implied: -3000, dated: true, inBudget: true,
        type: 'credit_card', settleMonthly: true, settleDay: 28 },
    ],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: '2026-08-25', today: TODAY,
  });
  eq(L.cardDue, 0, 'a settlement after period end is not claimed');
  eq(L.owedElse, 3000, 'so the balance is disclosed as the remainder instead');
}

/* ---- 5c. ONE definition of a settle-monthly card ---- */
{
  /* Three sites used to spell the rule three ways — cardCommitments keyed on
     the flag alone, cardsOwed on the type alone, the cycle guard on both —
     and a `settle_monthly: true` CHEQUE account fell through the gap: it
     landed in cardDue (excluded from free) while its rows could never join
     cardRows and no cycle could form, so money dropped out of the arithmetic.
     The flag now only means something on a credit card; on anything else it
     is a no-op and the account keeps the ordinary overdrawn treatment
     ("already visible as the cash it did not contribute"). */
  const flaggedCheque = { name: 'Flagged Cheque', implied: -5000, dated: true,
    inBudget: true, type: 'cheque', settleMonthly: true };
  eq(cardCommitments({ accounts: [flaggedCheque], from: TODAY, to: P_END }), [],
    'settle_monthly on a non-card claims no commitment');
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 10000, dated: true, inBudget: true, type: 'checking' }, flaggedCheque],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.cardDue, 0, 'nothing lands in cardDue for it');
  eq(L.owed, 0, 'and it is not a card, so the owed sentence stays out of it too');
  eq(L.free, 10000, 'free is untouched — the ordinary overdrawn-account treatment applies');

  ok(!isSettleCard(flaggedCheque), 'the one predicate refuses a flagged non-card');
  ok(isSettleCard({ type: 'credit_card', settleMonthly: true }), 'and accepts the mapped spelling');
  ok(isSettleCard({ type: 'credit_card', settle_monthly: true }),
    'and the raw vault spelling — the dashboard resolves folders against raw accounts');
  ok(!isSettleCard({ type: 'credit_card' }), 'an unflagged card is not settle-monthly');

  /* The type test underneath is its own exported rule now: worth.js and the
     importer used to compare `=== 'credit_card'` strictly while this file
     trimmed and folded — a hand-typed `Credit_Card` was a card to the
     committed chain and invisible to net worth. One spelling, everywhere. */
  ok(isCreditCard({ type: 'credit_card' }), 'the canonical spelling is a card');
  ok(isCreditCard({ type: 'Credit_Card' }), 'hand-typed case survives — frontmatter is kept verbatim by the loader');
  ok(isCreditCard({ type: ' credit_card ' }), 'and stray whitespace');
  ok(!isCreditCard({ type: 'checking' }), 'a non-card type is refused');
  ok(!isCreditCard({}), 'and so is an account with no type at all');
  ok(!isCreditCard(null), 'null is not a card, so callers need no guard of their own');
}

/* ---- 5b. RULE 8: a card settled in full is a commitment ---- */
const card = {
  name: 'Discovery Card', institution: 'Discovery Bank', type: 'credit_card',
  dated: true, inBudget: true, settleMonthly: true, implied: -8874,
};
{
  const out = cardCommitments({ accounts: [card], from: TODAY, to: P_END });
  eq(out.length, 1, 'an outstanding settled-monthly card is still coming');
  eq(out[0].amount, 8874, 'the amount is what is OUTSTANDING, as a positive charge');
  eq(out[0].basis, 'settled', 'and it says where the figure came from');
  eq(out[0].due, null, 'with no settle day stated, it is simply due this period');
}
{
  eq(cardCommitments({ accounts: [{ ...card, settleMonthly: false }], from: TODAY, to: P_END }), [],
    'a card the household REVOLVES is not swept into cash flow — it stays a Debt-page row');
  eq(cardCommitments({ accounts: [{ ...card, implied: 0 }], from: TODAY, to: P_END }), [],
    'a card already settled has nothing left to claim — the balance is self-correcting, so rule 2 needs no special case');
  eq(cardCommitments({ accounts: [{ ...card, implied: 1200 }], from: TODAY, to: P_END }), [],
    'a card in CREDIT is not a commitment either');
  eq(cardCommitments({ accounts: [{ ...card, dated: false }], from: TODAY, to: P_END }), [],
    'an undated card balance cannot be asserted — rule 1 applies here too');
  eq(cardCommitments({ accounts: [{ ...card, inBudget: false }], from: TODAY, to: P_END }), [],
    'an out-of-budget card is out of this figure');
}
{
  // A stated settlement day only ever NARROWS the claim.
  eq(cardCommitments({ accounts: [{ ...card, settleDay: 20 }], from: TODAY, to: P_END })[0].due,
    '2026-08-20', 'a stated settle day places the settlement');
  eq(cardCommitments({ accounts: [{ ...card, settleDay: 28 }], from: TODAY, to: '2026-08-25' }), [],
    'a settlement falling after the period ends is not this period\'s problem');
  /* Unlike a debt instalment, this takes NO whole-month guard: the balance is
     owed right now, in every window, so a short window still claims it. */
  eq(cardCommitments({ accounts: [card], from: TODAY, to: '2026-08-19' }).length, 1,
    'a 7-day window still claims an outstanding card — it is owed today, not predicted');
}

/* ---- 6. The card as a whole ---- */
{
  const accounts = [{ name: 'Cheque', implied: 12400, dated: true, inBudget: true }];
  const rows = [...fibreRows, ...paidHistory];
  const L = whatsLeft({
    accounts, services: [fibre], debts: [bond], rows,
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.cash, 12400, 'cash is the implied balance');
  eq(L.committed, 2610, 'only the bond is still coming — the fibre was due on the 2nd');
  eq(L.free, 9790, 'free is cash less what is committed');
  eq(L.short, false, 'not short');
  eq(L.days, 12, '13 Aug to 25 Aug is 12 days');
  eq(Math.round(L.perDay), 816, 'per-day divides what is free by the days left');
  eq(L.counts, { service: 0, debt: 1, card: 0 }, 'the counts describe what was actually counted');
  eq(L.items.length, 1, 'RULE 5: every counted charge is disclosed');
}
{
  /* The vault this change was written against, end to end: salary into a cheque
     account, debit orders off it, everyday spend on a card settled before
     interest. The funds and wrappers are already `budget: false`, so the only
     thing the card was getting wrong was the card itself — R8,874 of money
     already spent, reported as still available. */
  const real = [
    { name: 'Cash', implied: 0, dated: true, inBudget: true, type: 'cash' },
    { name: 'Cheque', implied: 10748, dated: true, inBudget: true, type: 'checking' },
    { name: 'Education Fund', implied: 350000, dated: true, inBudget: false, type: 'investment' },
    { name: 'Emergency Fund', implied: 104634, dated: true, inBudget: false, type: 'savings' },
    { name: 'Discovery Card', institution: 'Discovery Bank', implied: -8874,
      dated: true, inBudget: true, type: 'credit_card', settleMonthly: true },
  ];
  const L = whatsLeft({
    accounts: real, services: [], debts: [], rows: [],
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.cash, 10748, 'cash is the cheque account; the funds are out on `budget: false`');
  eq(L.countedAccounts, 1, 'one account contributed — the empty cash tin and the card did not');
  eq(L.committed, 8874, 'the outstanding card is what is still to leave the cheque account');
  eq(L.counts, { service: 0, debt: 0, card: 1 }, 'counted as a card settlement, not as a debt instalment');
  eq(L.free, 1874, 'free is what survives settling the card — not the full 10,748');
  eq(L.items.length, 1, 'RULE 5 holds for the card too: the settlement is disclosed');
}
{
  /* Add the month's debit orders and the same vault goes SHORT — the reading
     the old card could never produce, because the card balance was invisible
     to it and the cheque balance looked like free money. */
  const L = whatsLeft({
    accounts: [
      { name: 'Cheque', implied: 10748, dated: true, inBudget: true, type: 'checking' },
      { name: 'Card', implied: -8874, dated: true, inBudget: true, type: 'credit_card', settleMonthly: true },
    ],
    services: [{ name: 'Orders', provider: '', cycle: 'monthly', amount: 2669, active: true, next: '2026-08-20' }],
    debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 11543, 'the card settlement and the debit orders are both still coming');
  eq(L.short, true, 'and together they exceed the cheque balance');
  eq(L.free, -795, 'short, where the old card would have said 8,079 free');
  eq(L.perDay, null, 'a short card has no per-day rate to offer');
}
{
  /* RULE 4: a budget target is an intention and must never enter this figure.
     Nothing in the input carries one — this asserts the shape stays that way. */
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 1000, dated: true, inBudget: true }],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 0, 'no scheduled charges means nothing is committed, whatever is budgeted');
  eq(L.free, 1000, 'and everything in the account is free');
}
{
  // Short, not "negative free".
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 500, dated: true, inBudget: true }],
    services: [], debts: [bond], rows: paidHistory,
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.short, true, 'less cash than commitments reads as short');
  eq(L.free, -2110, 'the figure itself keeps its sign for the caller to abs()');
  eq(L.perDay, null, 'there is no daily allowance to quote when there is nothing free');
}
{
  // The last day of a period: no division by zero, and no whole balance quoted
  // as a daily rate.
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 1000, dated: true, inBudget: true }],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: P_END,
  });
  eq(L.days, 0, 'the last day has no days left');
  eq(L.perDay, null, 'and quotes no per-day figure');
}
{
  // No dated balance anywhere: the cash side cannot be drawn, and must not
  // silently read as an empty account.
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 12400, dated: false, inBudget: true }],
    services: [fibre], debts: [], rows: fibreRows,
    periodStart: P_START, periodEnd: P_END, today: '2026-07-30',
  });
  eq(L.cashKnown, false, 'an undated balance leaves cash unknown');
  eq(L.cash, 0, 'and contributes nothing');
  eq(L.unknownAccounts, ['Cheque'], 'the account is named so the reader can fix it');
  ok(L.committed > 0, 'the committed side still works without it');
}

/* ---- a merchant that RENAMES its debit order is still taking the money ----

   Taken from the live vault: Vodacom bills under eight distinct descriptions.
   Read through the dominant description group alone, Airtime's last charge
   looked like February while it had actually gone off eight days ago — so the
   derived due date landed months in the past, `due < from` dropped the service,
   and a live instalment vanished from the committed figure. Silent, and always
   in the direction that makes the reader look richer.

   Price still comes from the dominant group; only WHEN follows the merchant. */
{
  const airtime = { name: 'Airtime and Data', provider: 'Vodacom', cycle: 'monthly', amount: 675, active: true, next: '' };
  // The dominant group by spend is the old name, and it stopped in February.
  // The live charges sit under a renamed description at a lower price.
  // Both descriptions bill the same 583, so the DUE DATE is the only variable
  // under test — a fixture where they differ would confound it with the price.
  const renamed = [
    { date: '2025-11-07', desc: 'VODACOM ONLINE ACCOUN', cat: 'Cellphone', amount: -583 },
    { date: '2025-12-07', desc: 'VODACOM ONLINE ACCOUN', cat: 'Cellphone', amount: -583 },
    { date: '2026-01-07', desc: 'VODACOM ONLINE ACCOUN', cat: 'Cellphone', amount: -583 },
    { date: '2026-02-07', desc: 'VODACOM ONLINE ACCOUN', cat: 'Cellphone', amount: -583 },
    { date: '2026-06-02', desc: 'VODACOM BUNDLES', cat: 'Cellphone', amount: -583 },
    { date: '2026-07-02', desc: 'VODACOM BUNDLES', cat: 'Cellphone', amount: -583 },
  ];

  // Period 26 Jul - 25 Aug, read on 30 Jul: the 2 Aug charge has not landed yet.
  const due = serviceCommitments({
    services: [airtime], rows: renamed, from: '2026-07-30', to: P_END, periodStart: P_START,
  });
  eq(due.length, 1, 'a renamed debit order is still coming, not cancelled');
  eq(due[0].due, '2026-08-02', 'dated from the LAST charge under any of its names');
  eq(due[0].amount, 583, 'while the price still comes from the dominant group');

  // Once it lands — under the renamed description — it must not be claimed again.
  const landed = [...renamed, { date: '2026-08-02', desc: 'VODACOM BUNDLES', cat: 'Cellphone', amount: -583 }];
  eq(serviceCommitments({ services: [airtime], rows: landed, from: '2026-08-05', to: P_END, periodStart: P_START }),
    [], 'and a charge that has landed under the NEW name is not counted a second time');

  // The regression this replaces: anchored on the dominant group the due date
  // would be 2026-03-07, which is before `from`, and the service disappears.
  ok(due[0].due > '2026-07-30', 'the anchor is never a charge months in the past');
}

/* ---- the chain has FOUR terms when a card is being settled, and still adds up ---- */
{
  const cardAcct = { name: 'Discovery Card', implied: -17011, dated: true, inBudget: true,
    type: 'credit_card', settleMonthly: true };
  const cheque = { name: 'Cheque', implied: 148, dated: true, inBudget: true, type: 'checking' };
  const SAL = 'CASHFOCUS SALARIS';
  const income = [
    { date: '2026-05-23', amount: 40240.20, desc: SAL },
    { date: '2026-06-23', amount: 40240.20, desc: SAL },
    { date: '2026-07-23', amount: 40240.20, desc: SAL },
  ];
  const L = whatsLeft({
    accounts: [cheque, cardAcct], services: [fibre], debts: [], rows: fibreRows, incomeRows: income,
    periodStart: P_START, periodEnd: P_END, today: '2026-07-30',
  });

  eq(L.cardDue, 17011, 'the card settlement is reported as its own term');
  ok(L.committedOther > 0, 'and the debit orders keep a term of their own');
  eq(L.committedOther + L.cardDue, L.committed, 'the two halves are exactly the old committed figure');
  // The whole reason the term is split out: cash - orders - card = free, and a
  // reader can add up every number on the card.
  eq(Math.round((L.cash - L.committedOther - L.cardDue) * 100), Math.round(L.free * 100),
    'the four-term chain still reconciles to `free`');
  ok(L.short, 'R148 against a R17 011 settlement is short, not free');

  eq(L.incoming.amount, 40240.20, 'the salary is found and reported at its real amount');
  eq(L.incoming.next, '2026-08-23', 'on the day it actually lands');

  // A card with no settle_monthly flag is disclosed, never claimed as due.
  const unflagged = whatsLeft({
    accounts: [cheque, { ...cardAcct, settleMonthly: false }], services: [], debts: [], rows: [],
    periodStart: P_START, periodEnd: P_END, today: '2026-07-30',
  });
  eq(unflagged.cardDue, 0, 'an unflagged card adds no term to the chain');
  eq(unflagged.owed, 17011, 'but is still disclosed beside it — the reader who revolves a balance is not told it is due');

  // Income that lands after the window cannot resolve the window.
  const late = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [], incomeRows: income,
    periodStart: P_START, periodEnd: '2026-08-10', today: '2026-07-30',
  });
  eq(late.incoming, null, 'a salary arriving after the period ends is not a comfort this period');

  // No repeating credit: silence, never a guess.
  const quiet = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: [{ date: '2026-07-02', amount: 90000, desc: 'ONE OFF WINDFALL' }],
    periodStart: P_START, periodEnd: P_END, today: '2026-07-30',
  });
  eq(quiet.incoming, null, 'one big credit predicts nothing, and the card says nothing');
}

/* ---- the settlement cycle: card spend against the income that clears it ----

   The household this was measured on runs the whole month through the card and
   settles it on payday. The work month runs the 23rd to the 22nd, so the salary
   that clears it lands on day ONE of the next period — and the cash left in the
   cheque account mid-period is the tail of LAST month's salary, which was never
   going to pay the card. Subtracting the card from that cash reported
   "R16 958 short" at the same point in every cycle.

   The interest is what proves it is timing, not credit: 16.5% on R40 000 would
   cost about R550 a month and the real card charged R0.02, R1.92 and R23.62.

   So the verdict is card spend vs settling income, and `over` is the only state
   worth colouring — the cycle that genuinely did not pay for itself. */
{
  const cheque = { name: 'Cheque', implied: 148, dated: true, inBudget: true, type: 'checking' };
  const cardAcct = { name: 'Discovery Card', implied: -17011, dated: true, inBudget: true,
    type: 'credit_card', settleMonthly: true };
  const SAL = 'CASHFOCUS SALARIS';
  const income = [
    { date: '2026-05-23', amount: 40240.20, desc: SAL },
    { date: '2026-06-23', amount: 40240.20, desc: SAL },
    { date: '2026-07-23', amount: 40240.20, desc: SAL },
  ];
  // A work month running 23 Jul -> 22 Aug. The salary that settles it lands
  // 23 Aug, the day AFTER the period ends.
  const PS = '2026-07-23', PE = '2026-08-22', TODAY = '2026-08-10';
  const spend = amt => [{ date: '2026-08-01', desc: 'CHECKERS', amount: -amt }];

  const under = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: income, cardRows: spend(17011),
    periodStart: PS, periodEnd: PE, today: TODAY,
  });
  ok(under.cycle, 'a settled card is measured as a cycle, not as a claim on cash');
  eq(under.cycle.spend, 17011, 'the cycle counts what went ON the card this period');
  eq(under.cycle.settling, 40240.20, 'against the salary that clears it');
  eq(under.cycle.date, '2026-08-23', 'which lands the day AFTER the period ends — the gate `incoming` uses would have hidden it');
  eq(under.cycle.over, false, 'R17 011 of a R40 240 salary is the pattern working');
  eq(Math.round(under.cycle.headroom), 23229, 'and the headroom is what is left of that salary');
  eq(under.incoming, null, 'the in-period income line stays silent — nothing lands before the 22nd');

  // The one state that means something: the cycle did not pay for itself.
  const over = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: income, cardRows: spend(45000),
    periodStart: PS, periodEnd: PE, today: TODAY,
  });
  eq(over.cycle.over, true, 'card spend ABOVE the settling salary is the real overspend signal');
  ok(over.cycle.headroom < 0, 'and the headroom goes negative rather than clamping');

  // A card that is NOT settled monthly is a genuine claim and keeps the old
  // treatment — no cycle, and the chain still subtracts it.
  const revolving = whatsLeft({
    accounts: [cheque, { ...cardAcct, settleMonthly: false }], services: [], debts: [], rows: [],
    incomeRows: income, cardRows: spend(17011),
    periodStart: PS, periodEnd: PE, today: TODAY,
  });
  eq(revolving.cycle, null, 'a revolving balance is not a settlement cycle');
  eq(revolving.cardDue, 0, 'it is not claimed as due this period either');
  eq(revolving.owed, 17011, 'it is disclosed instead — the reader carrying a balance is told the truth about it');

  // No repeating credit: no cycle. A comparison against a guessed income is
  // exactly the average this whole feature refuses to compute.
  const noIncome = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: [{ date: '2026-07-02', amount: 90000, desc: 'ONE OFF' }], cardRows: spend(17011),
    periodStart: PS, periodEnd: PE, today: TODAY,
  });
  eq(noIncome.cycle, null, 'without a proven settling income there is no ratio to state');

  // No card spending this period: nothing to compare.
  eq(whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: income, cardRows: [],
    periodStart: PS, periodEnd: PE, today: TODAY,
  }).cycle, null, 'a cycle with no card spending states nothing');

  // Only spending INSIDE the period counts, and settlements are not spending.
  const mixed = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: income,
    cardRows: [
      { date: '2026-07-01', desc: 'LAST CYCLE', amount: -9999 },   // before periodStart
      { date: '2026-08-01', desc: 'CHECKERS', amount: -1000 },
      { date: '2026-08-02', desc: 'Settling July', amount: 5000 }, // a payment IN
      { date: '2026-09-01', desc: 'NEXT CYCLE', amount: -8888 },   // after periodEnd
    ],
    periodStart: PS, periodEnd: PE, today: TODAY,
  });
  eq(mixed.cycle.spend, 1000, 'only outflows dated inside the period are this cycle\'s card spending');
}

/* ---- DEFECT 1: the headline, perDay, "after" and the bar aria-label must
   all read the SAME free figure — the one the card actually shows.

   During an active settlement cycle the card that used to be subtracted from
   `free` is shown in its own band instead (see dash.left.cycle in
   views/dashboard.js). Before this fix `free` still had the card taken off,
   so the per-day rate, the "short/covered" sentence and the bar's
   aria-label all quoted a smaller figure than the headline — a card that
   contradicted itself out loud. */
{
  const cheque = { name: 'Cheque', implied: 148, dated: true, inBudget: true, type: 'checking' };
  const cardAcct = { name: 'Discovery Card', implied: -17011, dated: true, inBudget: true,
    type: 'credit_card', settleMonthly: true };
  const SAL = 'CASHFOCUS SALARIS';
  const income = [
    { date: '2026-05-23', amount: 40240.20, desc: SAL },
    { date: '2026-06-23', amount: 40240.20, desc: SAL },
    { date: '2026-07-23', amount: 40240.20, desc: SAL },
  ];
  const PS = '2026-07-23', PE = '2026-08-22', TODAY2 = '2026-08-10';
  const spend = amt => [{ date: '2026-08-01', desc: 'CHECKERS', amount: -amt }];

  const L = whatsLeft({
    accounts: [cheque, cardAcct], services: [], debts: [], rows: [],
    incomeRows: income, cardRows: spend(17011),
    periodStart: PS, periodEnd: PE, today: TODAY2,
  });
  ok(L.cycle, 'a settlement cycle is active for this fixture');
  eq(L.cardDue, 17011, 'the card commitment is still reported — the cycle band shows it, the chain no longer subtracts it');
  eq(L.committedOther, 0, 'no debit orders in this fixture');
  eq(L.free, 148, 'free is cash less what is STILL a claim on it — the card is not, once it has its own band');
  eq(L.short, false, 'R148 with nothing else committed is not short');
  eq(L.days, 12, '10 Aug to 22 Aug is 12 days');
  eq(Math.round(L.perDay * 100) / 100, Math.round((148 / 12) * 100) / 100,
    'perDay must divide the SAME free the headline shows, not the card-inclusive figure');
}

/* ---- DEFECT 3: short is read off cents, not a raw float difference ----
   Two accounts and two debit orders that are exactly break-even on paper
   leave a sub-cent float remainder behind — never a real shortfall, and
   never one a human could act on. */
{
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 4001.60, dated: true, inBudget: true, type: 'checking' }],
    services: [], debts: [
      { name: 'A', payment: 1000.70, extra: 0, status: 'active', category: '', start: '' },
      { name: 'B', payment: 3000.90, extra: 0, status: 'active', category: '', start: '' },
    ],
    rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  ok(Math.abs(L.free) < 1e-6, 'the float remainder is sub-cent, as measured');
  eq(L.short, false, 'break-even to the cent must not read as short off a -4.5e-13 float artefact');
}

console.log(`PASS — the forward view counts what is coming, once, and only what it can place (${checks} assertions).`);
