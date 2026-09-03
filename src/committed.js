'use strict';
/* What is still coming out before this period ends — how much money is
   actually free once the charges already scheduled against it are taken off.
   It invents no data: recurring.js knows what a service was last charged,
   Debts.md carries the contracted instalment, reconcile.js knows what an
   account should read now; this is the arithmetic that joins the three.

   Seven rules govern it (ADR-0007 · committed.js — purpose): implied cash,
   never stated; a charge already taken is not a commitment; the amount is
   what was really charged; budget targets are not commitments; every
   prediction is disclosed in `items`; nothing unplaceable is asserted; a
   card settled in full is a commitment, not a debt. Pure — `today` is
   injected — so tests/committed.test.cjs drives it in bare node. */

const { ISO_DATE, daysBetween: isoDaysBetween, isoDayNumber, isoFromDayNumber } = require('./dates');
const { isPoolAccount, accountType } = require('./vocabulary');
const { matchCharges, chargeStats, nextExpected, findRecurringCredit, STEP_DAYS } = require('./recurring');
const { isSplitPart } = require('./tx-role');

/* ADR-0007 · Whole-month placement window. An instalment with no known
   payment day is only claimed inside a window of 28 days or more. */
const WHOLE_MONTH_DAYS = 28;

/* ADR-0007 · One definition of a settle-monthly card. The flag (either
   spelling) only means something on a credit card; three sites once spelled
   it three ways and money fell through the gaps. */

/* ADR-0007 · One definition of a credit card. Trimmed and case-folded via
   vocabulary.js; a strict `===` once made one account a card to one page and
   not another. */
const isCreditCard = a => !!a && accountType(a) === 'credit_card';

const isSettleCard = a => !!a && !!(a.settleMonthly ?? a.settle_monthly) && isCreditCard(a);

const day = iso => Number(String(iso).slice(8, 10));
const median = arr => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};
/* ADR-0007 · Days of the month are a circle (ISSUE 74). A cluster straddling
   the month end is lifted, medianed and folded back; NaN days are dropped. */
const usualDay = days => {
  const ds = days.filter(d => Number.isFinite(d) && d >= 1 && d <= 31);
  if (!ds.length) return 0;
  const lo = Math.min(...ds), hi = Math.max(...ds);
  if (hi - lo <= 15) return median(ds);
  const lifted = ds.map(d => (d < 16 ? d + 31 : d));
  const m = median(lifted);
  return m > 31 ? m - 31 : m;
};

/* The first date on or after `from` that falls on day-of-month `d`, clamped to
   a short month's last day so "the 31st" does not skip February entirely. */
function nextOnDay(from, d) {
  if (!ISO_DATE.test(from || '') || !d) return null;
  let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < 2; i++) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
    if (iso >= from) return iso;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return null;
}

/* ------------------------------- cash ---------------------------------- */

/* ADR-0007 · Cash on hand. Positive implied balances of in-budget, dated
   accounts; undated ones are named as unknown, a card at −R8,874 is not
   negative cash, and `counted` is only the accounts that contributed. */
/* ADR-0007 · Earmarked cash comes out of free (ISSUE 48). An emergency-fund
   flag or a savings/investment type is the household's own declaration;
   `cash` does not move, `free` does. */
function earmarkOf(a) {
  const held = Math.max(0, a.implied || 0);
  if (!held) return 0;
  /* ADR-0007 · A stated budget: key wins over the earmark, matching
     period.js's isEarmarkedAccount, so one declaration is one rule. */
  if (a.budgetStated) return 0;
  const ef = a.emergencyFund;
  if (ef === true) return held;
  if (typeof ef === 'number' && ef > 0) return Math.min(ef, held);
  return isPoolAccount(a) ? held : 0;
}

/* A debt's monthly commitment: the instalment plus whatever extra the
   household has chosen to pay. One owner (Phase 3 of ADR-0006) — the Debt
   page's "Paying per month", its debt-to-income ratio, its amortisation and
   the what's-left chain below all used to spell this themselves. */
function debtMonthly(d) { return (Number(d && d.payment) || 0) + (Number(d && d.extra) || 0); }

function cashOnHand(accounts) {
  let cash = 0, counted = 0, earmarked = 0;
  const unknown = [];
  /* Named, not just totalled: a figure held back from "actually free" is an
     exclusion, and this app does not exclude in silence. */
  const earmarkedFrom = [];
  for (const a of accounts || []) {
    if (!a || a.inBudget === false) continue;
    if (!a.dated) { unknown.push(a.name); continue; }
    if (a.implied > 0) {
      cash += a.implied; counted++;
      const ear = earmarkOf(a);
      if (ear > 0) { earmarked += ear; earmarkedFrom.push({ name: a.name, amount: ear }); }
    }
  }
  return { cash, counted, unknown, earmarked, earmarkedFrom };
}

/* ---------------------------- commitments ------------------------------- */

/* Services expected between `from` and `to` inclusive.

   `rows` is every transaction in the vault, so a service's charge history is
   its whole history — the price and cadence come from all of it. Whether it has
   ALREADY landed is a separate question asked only of this period. */
function serviceCommitments({ services, rows, from, to, periodStart }) {
  const out = [];
  const history = (rows || []).filter(r => !isSplitPart(r));
  for (const s of services || []) {
    if (!s || !s.active) continue;
    const m = matchCharges(s, history);
    /* ADR-0007 · Price from the dominant group, timing from every group. A
       renamed debit order is still taking the money; a stale anchor silently
       dropped Airtime and Website Hosting from the committed figure. */
    const stats = chargeStats(m.charges);        // price
    /* ADR-0007 · Charged by today, not merely present. A row dated later this
       period is not history (ISSUE 35/42/44's as-of, reaching the last
       figure); price is deliberately not filtered. */
    const charged = (m.all || []).filter(c => c.date <= from);
    const seen = chargeStats(charged);           // liveness + cadence

    /* Derived first, typed second. Every next-billing date in the reference
       vault was months in the past; the charge history knows better. */
    const due = nextExpected(seen, s.cycle) || (ISO_DATE.test(s.next || '') ? s.next : null);

    const derived = stats && stats.recent > 0;
    const amount = derived ? stats.recent : Math.abs(s.amount || 0);
    if (!amount) continue;

    /* ADR-0007 · How many charges remain (ISSUE 47). Sub-monthly services are
       walked date by date; monthly and annual keep the one-charge-per-period
       rule exactly. */
    const step = STEP_DAYS[s.cycle];
    if (!step) {
      /* Unchanged since 1.20 apart from that window: at most one charge per
         period, so evidence of one is evidence there is nothing left to come. */
      if (charged.some(c => c.date >= periodStart)) continue;
      if (!due || due < from || due > to) continue;
      out.push({
        kind: 'service', name: s.name, detail: s.provider || '',
        due, amount, occurrences: 1, unit: amount,
        basis: derived ? 'charged' : 'stated',
      });
      continue;
    }

    const dates = remainingCharges({ anchor: seen && seen.last, next: s.next, step, from, to, charges: charged });
    if (!dates.length) continue;
    out.push({
      kind: 'service',
      name: s.name,
      detail: s.provider || '',
      /* The FIRST of the remaining charges. The card's disclosure row prints
         one date, and the first one is the one a reader can act on. */
      due: dates[0],
      /* What the window still owes this merchant, which is what "still
         committed" has always meant. `unit` and `occurrences` travel with it
         so the row can say "4 × R250" rather than asserting a R1 000 charge
         nobody will ever see on a statement. */
      amount: amount * dates.length,
      occurrences: dates.length,
      unit: amount,
      basis: derived ? 'charged' : 'stated',
    });
  }
  return out;
}

/* ADR-0007 · Remaining charges of a sub-monthly service (ISSUE 47). Anchored
   on the last real charge, walked back then forward, each charge clearing one
   date within CHARGE_MATCH_DAYS, bounded at MAX_STEPS. */
const CHARGE_MATCH_DAYS = 3;
const MAX_STEPS = 400;
function remainingCharges({ anchor, next, step, from, to, charges }) {
  const start = ISO_DATE.test(anchor || '') ? anchor : (ISO_DATE.test(next || '') ? next : null);
  if (!start) return [];
  const toN = isoDayNumber(to), fromN = isoDayNumber(from);
  let n = isoDayNumber(start);
  if (n === null || toN === null || fromN === null) return [];
  /* Back to the last occurrence at or before the window, then forward. */
  let guard = 0;
  while (n - step >= fromN && guard++ < MAX_STEPS) { n -= step; }
  const seen = (charges || []).map(c => isoDayNumber(c.date)).filter(d => d !== null);
  const used = new Set();
  const out = [];
  for (let guard2 = 0; n <= toN && guard2 < MAX_STEPS; n += step, guard2++) {
    if (n < fromN) continue;
    const hit = seen.findIndex((d, i) => !used.has(i) && Math.abs(d - n) <= CHARGE_MATCH_DAYS);
    if (hit !== -1) { used.add(hit); continue; }
    out.push(isoFromDayNumber(n));
  }
  return out;
}

/* ADR-0007 · Where a debt's usual payment day comes from: payments on the
   linked category, then the start date, else only a whole-month window. */
/* ADR-0007 · Debt placement window is the period (ISSUE 46). Placed from
   periodStart, not today; a passed day with no payment is `missed`, not
   dropped, and a debt with no category is claimed for the whole period. */
function debtCommitments({ debts, rows, from, to, periodStart, periodDays, today }) {
  const out = [];
  const history = (rows || []).filter(r => !isSplitPart(r));
  for (const d of debts || []) {
    if (!d || d.status === 'paid') continue;
    const payment = debtMonthly(d);
    if (payment <= 0) continue;

    const paid = d.category
      ? history.filter(r => r.cat === d.category && r.amount < 0)
      : [];
    /* ADR-0007 · Rule 2 reads the ledger as of today (ISSUE 55). A payment
       row dated later this period is still in cash, so it cannot settle the
       instalment; `asOf` falls back to the period end for past periods. */
    const asOf = ISO_DATE.test(today || '') && today < to ? today : to;
    if (paid.some(r => r.date >= periodStart && r.date <= asOf)) continue;   // rule 2

    const usual = paid.length ? usualDay(paid.map(r => day(r.date))) : (d.start ? day(d.start) : 0);
    let due = usual ? nextOnDay(periodStart, usual) : null;

    if (due) {
      if (due > to) continue;
    } else {
      /* Unplaceable. Only a window of a whole month or more can be sure a
         monthly instalment falls inside it. */
      if (periodDays < WHOLE_MONTH_DAYS) continue;
      due = null;
    }

    out.push({
      kind: 'debt',
      name: d.name,
      detail: d.lender || '',
      due,
      /* Its day has gone and rule 2 found no payment against it. Carried on
         the item rather than re-derived in the view, so the figure and the
         sentence explaining it cannot come from two different comparisons. */
      missed: !!(due && ISO_DATE.test(today || '') && due < today),
      amount: payment,
      basis: 'contracted',
    });
  }
  return out;
}

/* ADR-0007 · Settle-monthly card as a commitment (rule 7). The outstanding
   implied balance is owed now in every window, so no WHOLE_MONTH_DAYS guard;
   `settle_day` only narrows the claim. */
function cardCommitments({ accounts, from, to }) {
  const out = [];
  for (const a of accounts || []) {
    if (!isSettleCard(a) || a.inBudget === false || !a.dated) continue;
    const owed = a.implied < 0 ? -a.implied : 0;
    if (!owed) continue;

    /* A stated settlement day only ever narrows the claim. Falling outside the
       window means the balance is not due before the period ends, so it is not
       this period's problem. */
    const due = a.settleDay ? nextOnDay(from, a.settleDay) : null;
    if (due && due > to) continue;

    out.push({
      kind: 'card',
      name: a.name,
      detail: a.institution || '',
      due,
      amount: owed,
      /* ADR-0007 · Card commitments carry their own currency (ISSUE 30);
         services and debts are household money by construction. */
      currency: a.currency || '',
      basis: 'settled',
    });
  }
  return out;
}

/* ADR-0007 · Cards owed are stated, never folded in. Neither negative cash
   nor a placeable commitment; a sentence beside the figures, with per-card
   entries so whatsLeft can disclose the unclaimed remainder. */
function cardsOwed(accounts) {
  let owed = 0;
  const cards = [];
  /* Per-card entries alongside the totals, so whatsLeft can subtract the
     cards the commitment chain has CLAIMED and disclose the remainder —
     without re-deriving which accounts are cards under a second rule. */
  const entries = [];
  for (const a of accounts || []) {
    if (!a || a.inBudget === false || !a.dated) continue;
    if (accountType(a) !== 'credit_card') continue;
    if (a.implied < 0) {
      owed += -a.implied; cards.push(a.name);
      entries.push({ name: a.name, amount: -a.implied });
    }
  }
  return { owed, cards, entries };
}

/* ------------------------------ the card -------------------------------- */

/* ADR-0007 · whatsLeft inputs and outputs. Implied accounts from reconcile(),
   `cardRows` from settle-monthly cards, `incomeRows` from in-budget accounts
   only; `free` may be negative, `perDay` is null on the last day. */
function whatsLeft({ accounts, services, debts, rows, incomeRows, cardRows, periodStart, periodEnd, today }) {
  const now = ISO_DATE.test(today || '') ? today : null;
  const to = periodEnd;
  /* The window starts today, not at the period start: a charge dated earlier
     that never arrived is not "still coming", it is missing, and this card is
     not the place to argue about it. */
  const from = now && now > periodStart ? now : periodStart;

  const { cash, counted, unknown, earmarked, earmarkedFrom } = cashOnHand(accounts);
  const { owed, cards, entries: owedEntries } = cardsOwed(accounts);

  const periodDays = daysBetween(periodStart, periodEnd) + 1;
  const items = [
    ...serviceCommitments({ services, rows, from, to, periodStart }),
    ...debtCommitments({ debts, rows, from, to, periodStart, periodDays, today: now }),
    ...cardCommitments({ accounts, from, to }),
  ].sort((a, b) => (b.amount - a.amount));

  const committed = items.reduce((s, i) => s + i.amount, 0);
  /* ADR-0007 · Card settlement kept separable from debit orders: a different
     kind of claim, and folded together R17 000 of card hides R95 of Spotify. */
  const cardDue = items.filter(i => i.kind === 'card').reduce((s, i) => s + i.amount, 0);
  const daysLeft = now ? Math.max(0, daysBetween(now, periodEnd)) : null;
  const committedOther = committed - cardDue;

  /* ADR-0007 · The owed remainder is per card: balances the chain did not
     claim, derived from the claimed items so the two cannot disagree. */
  const claimedCards = new Set(items.filter(i => i.kind === 'card').map(i => i.name));
  const owedElseEntries = owedEntries.filter(e => !claimedCards.has(e.name));
  const owedElse = owedElseEntries.reduce((s, e) => s + e.amount, 0);

  /* What is due to LAND before this period ends, when the vault can prove it.
     Only ever from repeating credits the rows themselves establish — see
     findRecurringCredit, which returns null far more often than it answers.
     Gated on the period too: a salary arriving after the window closes cannot
     resolve this window's shortfall, and saying so would be a false comfort. */
  const credit = findRecurringCredit(incomeRows || [], now);
  const incoming = (credit && now && credit.next >= now && credit.next <= periodEnd) ? credit : null;

  /* ADR-0007 · The settlement cycle. Card spend this period against the
     income that settles it (not gated on periodEnd); R16 958 "short" every
     cycle and R0.02 of interest proved the card is a conduit, not a loan. */
  const cardSpend = (cardRows || []).reduce((s, r) => (
    r && typeof r.amount === 'number' && r.amount < 0 && !isSplitPart(r) &&
    r.date >= periodStart && r.date <= periodEnd ? s - r.amount : s), 0);
  const settling = (credit && now && credit.next >= now) ? credit : null;
  /* ADR-0007 · Settle-monthly re-checked inside whatsLeft, never trusted from
     the caller: a revolving balance must never read as a cycle. */
  const settlesMonthly = (accounts || []).some(a => isSettleCard(a) && a.inBudget !== false);
  const cycle = (settlesMonthly && cardSpend > 0 && settling) ? {
    spend: cardSpend,
    settling: settling.amount,
    date: settling.next,
    ratio: cardSpend / settling.amount,
    over: cardSpend > settling.amount,
    headroom: settling.amount - cardSpend,
  } : null;

  /* ADR-0007 · One free figure. Every rendered "actually free" reads this;
     cardDue leaves it exactly when `cycle` handles the card separately. */
  /* ADR-0007 · Earmark floored at cash (ISSUE 48): "R0 free", never a
     shortfall the household does not have. */
  const spokenFor = Math.min(cash, earmarked);
  const free = (cycle ? cash - committedOther : cash - committed) - spokenFor;

  /* ADR-0007 · Compared in cents. A break-even sum nets to -4.55e-13 in IEEE
     754 and read raw reports "short"; the sums themselves are untouched. */
  const freeCents = Math.round(free * 100);

  return {
    cash,
    cashKnown: counted > 0,
    countedAccounts: counted,
    unknownAccounts: unknown,
    cardDue,
    /* The debit-order half on its own, so the chain can show four terms that
       still add up: cash - committedOther - cardDue = free (outside a
       cycle; inside one, cash - committedOther = free directly). */
    committedOther,
    /* ISSUE 48. Beside the figures AND inside `free`, unlike `owed` below —
       the whole point is that this one changes the answer. `earmarkedFrom`
       names which accounts, because "R23 000 is spoken for" with no way to
       see where invites the reader to assume it is wrong. */
    earmarked: spokenFor,
    earmarkedFrom,
    incoming,
    /* ADR-0007 · afterIncoming counts the settling salary once: inside a
       cycle `incoming` is the credit that funds the card band, so cardDue
       comes back off. Null when nothing is arriving. */
    afterIncoming: incoming ? free + incoming.amount - (cycle ? cardDue : 0) : null,
    cardSpend,
    cycle,
    /* Reported beside the figures, deliberately absent from every one of them:
       cash, committed and free are all unchanged by this. */
    owed,
    owedCards: cards,
    /* The unclaimed remainder — what the view's sentence should disclose.
       A card the chain claimed already has its own line in `items`; this is
       every card balance that would otherwise be nowhere on screen. */
    owedElse,
    owedElseCards: owedElseEntries.map(e => e.name),
    committed,
    items,
    free,
    short: freeCents < 0,
    days: daysLeft,
    perDay: (daysLeft && daysLeft > 0 && freeCents > 0) ? free / daysLeft : null,
    counts: {
      service: items.filter(i => i.kind === 'service').length,
      debt: items.filter(i => i.kind === 'debt').length,
      card: items.filter(i => i.kind === 'card').length,
    },
  };
}

/* Whole days from a to b. dates.js owns the UTC counting; this module's own
   policy is the 0 on an unusable date — a window this can't measure reads as
   no days rather than as an error the caller has to guard against. */
function daysBetween(a, b) {
  const n = isoDaysBetween(a, b);
  return n === null ? 0 : n;
}

module.exports = {
  WHOLE_MONTH_DAYS, nextOnDay, isCreditCard, isSettleCard,
  cashOnHand, cardsOwed, serviceCommitments, debtCommitments, cardCommitments, whatsLeft, debtMonthly,
};
