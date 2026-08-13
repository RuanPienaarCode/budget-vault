'use strict';
/* What is still coming out before this period ends.

   Every other page in this app answers what HAPPENED. The Dashboard's hero
   answers "how much budget is left", which on day 3 of a period reads like a
   fortune while the medical aid, the bond and four debit orders have not landed
   yet. This module answers the other question — how much money is actually free
   once the charges already scheduled against it are taken off.

   It invents no data. Services already know what they were last charged and
   when (recurring.js), Debts.md already carries a contracted instalment, and
   reconcile.js already knows what an account should read right now. This is the
   arithmetic that puts the three together.

   SEVEN RULES, and the second one is the one the card lives or dies by.

   1. Cash is the IMPLIED balance, never the stated one. A stated balance is a
      claim with an age; the caller passes implied figures in. An account whose
      balance has no readable date cannot be placed at all and is COUNTED AS
      UNKNOWN rather than as zero — a missing figure must not read as an empty
      account.

   2. A commitment already charged is not a commitment. Medical aid that went
      off on the 1st is SPENT, not still coming. Counting it would inflate the
      committed figure every single period, and a reader who catches that once
      will never trust the card again.

   3. The amount is what was really charged, not what was typed. Services'
      stated amounts were measured against the statements and disagreed on four
      of six; `recent` (the median of the last three charges) is used wherever
      there is a charge history, and the typed figure only where there is none.

   4. Budget targets are NOT commitments. A budget is an intention. Folding
      intentions in here would make free money vanish into a number the reader
      never agreed to.

   5. Every prediction is disclosed. `items` carries one entry per counted
      charge with what it is, when it is expected and where the amount came
      from, so the card can show its working. A figure nobody can check is how
      the Services page died.

   6. Nothing is asserted that cannot be placed. A charge whose date cannot be
      worked out is not silently assumed to fall inside the window.

   7. A card you settle in full is a commitment, not a debt. The money is
      already spent; it just has not left the cheque account yet. Counting the
      cheque account at face value while the card sits at -R8,874 reports money
      that is already owed to Discovery. This is opt-in per account
      (`settle_monthly`), because a card someone genuinely revolves at interest
      is a Debt-page row and must keep behaving like one.

   Pure — no DOM, no obsidian import — so tests/committed.test.cjs drives it in
   bare node, and `today` is injected rather than read off the clock. */

const { ISO_DATE } = require('./dates');
const { matchCharges, chargeStats, nextExpected, findRecurringCredit } = require('./recurring');
const { isSplitPart } = require('./tx-role');

/* A debt instalment can only be placed inside a window at least this long when
   its usual payment day is unknown. A monthly instalment lands in every
   payday month, so on a monthly cycle "not paid yet" is enough to know it is
   still coming. On a 7- or 14-day cycle it plainly is not: three weeks out of
   four would claim a bond payment that is not due, which is rule 6's whole
   point. */
const WHOLE_MONTH_DAYS = 28;

/* THE ONE DEFINITION of a settle-monthly card. Three sites used to spell it
   three ways — cardCommitments keyed on the flag alone, cardsOwed on the type
   alone, the cycle guard on both — and money dropped out through the gaps: a
   `settle_monthly: true` cheque account landed in cardDue (excluded from
   `free`) while nothing measured its spending against settling income,
   because its rows could never join cardRows and no cycle could form. One
   predicate, used everywhere: the flag only means something ON A CREDIT CARD.
   On anything else it is a no-op and the account keeps its ordinary
   treatment (an overdrawn cheque account is already visible as the cash it
   failed to contribute).

   Reads BOTH spellings of the flag deliberately: whatsLeft's callers hand in
   a mapped shape (`settleMonthly`), while the dashboard resolves transaction
   folders against the RAW vault account (`settle_monthly`). One function
   answering both shapes is the point — a second spelling of the rule is how
   the three definitions happened the first time. */
const isSettleCard = a => !!a && !!(a.settleMonthly ?? a.settle_monthly) &&
  String(a.type || '').trim().toLowerCase() === 'credit_card';

const day = iso => Number(String(iso).slice(8, 10));
const median = arr => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
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

/* What the household can actually spend right now.

   Only accounts that are IN the budget, and only positive balances. A credit
   card sitting at −R8,874 is not negative cash — netting a liability against
   cash here would report money the household does not have. When the card is
   settled monthly it comes back as a COMMITMENT instead, which is where it
   belongs; see cardCommitments below.

   Long-term money is kept out by `budget: false` on the account, which is the
   mechanism this app already has for it. There is deliberately no second,
   type-based rule layered on top: two overlapping ways to exclude the same
   account is how a reader ends up unable to explain their own total.

   `implied` is what reconcile() worked out; `dated` says whether the stated
   balance carried a date it could be measured from. Undated accounts are
   counted as unknown and named, never folded in at zero.

   `counted` is accounts that actually CONTRIBUTED to the figure. It used to
   increment before the positive check, so a card at −R8,874 padded the "N
   accounts counted" line printed under a cash total it formed no part of. The
   line sits beneath the cash figure and so describes what that figure is made
   of — an account holding nothing added nothing to it. */
function cashOnHand(accounts) {
  let cash = 0, counted = 0;
  const unknown = [];
  for (const a of accounts || []) {
    if (!a || a.inBudget === false) continue;
    if (!a.dated) { unknown.push(a.name); continue; }
    if (a.implied > 0) { cash += a.implied; counted++; }
  }
  return { cash, counted, unknown };
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
    /* TWO stats, from two different groups, because two different questions are
       being asked and only one of them is about price.

       PRICE comes from the dominant description group: "Spotify" hits both the
       R94.99 subscription and the R2.50 international-payment fee on it, and
       averaging those is how the card would quote a price nobody pays.

       WHEN — has it landed, and when is it next due — must come from EVERY
       description the tokens hit. A merchant that renames its debit order is
       still taking the money: this vault has eight distinct Vodacom
       descriptions, and read through the dominant group alone Airtime's last
       charge looked like 2026-02-07 when it had actually gone off on 2026-08-02.
       The effect was silent and one-directional: a stale anchor puts the derived
       due date months in the past, `due < from` drops the service, and a real
       instalment vanishes from the committed figure — which is the number
       telling the reader how much is safe to spend. Website Hosting was hidden
       the same way while its R601 had already gone off.

       views/services.js reached this conclusion first for its liveness pill
       (see its `chargeStats(m.all)`); this is the same rule applied to the half
       that moves money. */
    const stats = chargeStats(m.charges);        // price
    const seen = chargeStats(m.all);             // liveness + cadence

    /* Already charged in this period? Asked of the merchant's own charges, not
       of the category — a phone contract and a cloud subscription share a
       category on real data, and one would cancel the other out. Across every
       description, so a renamed debit order is not claimed a second time. */
    const landed = (m.all || []).some(c => c.date >= periodStart && c.date <= to);
    if (landed) continue;

    /* Derived first, typed second. Every next-billing date in the reference
       vault was months in the past; the charge history knows better. */
    const due = nextExpected(seen, s.cycle) || (ISO_DATE.test(s.next || '') ? s.next : null);
    if (!due || due < from || due > to) continue;

    const derived = stats && stats.recent > 0;
    const amount = derived ? stats.recent : Math.abs(s.amount || 0);
    if (!amount) continue;

    out.push({
      kind: 'service',
      name: s.name,
      detail: s.provider || '',
      due,
      amount,
      basis: derived ? 'charged' : 'stated',
    });
  }
  return out;
}

/* Debt instalments expected between `from` and `to` inclusive.

   The usual payment day comes from the payments actually seen on the debt's
   linked category — the same link the Debt page already uses to pull real
   payments. Falling back to the debt's start date is honest (that is the day
   the agreement runs on); falling back to nothing means the instalment can only
   be placed in a window of a whole month or more, per rule 6. */
function debtCommitments({ debts, rows, from, to, periodStart, periodDays }) {
  const out = [];
  const history = (rows || []).filter(r => !isSplitPart(r));
  for (const d of debts || []) {
    if (!d || d.status === 'paid') continue;
    const payment = (d.payment || 0) + (d.extra || 0);
    if (payment <= 0) continue;

    const paid = d.category
      ? history.filter(r => r.cat === d.category && r.amount < 0)
      : [];
    if (paid.some(r => r.date >= periodStart && r.date <= to)) continue;   // rule 2

    const usual = paid.length ? median(paid.map(r => day(r.date))) : (d.start ? day(d.start) : 0);
    let due = usual ? nextOnDay(from, usual) : null;

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
      amount: payment,
      basis: 'contracted',
    });
  }
  return out;
}

/* Credit cards the household settles in full before interest (rule 7).

   The amount is the card's own OUTSTANDING balance, which makes this
   self-correcting in a way the other two commitments are not: there is no
   prediction to get wrong and no rule-2 problem to solve. If the settlement has
   already been paid, the implied balance is at or near zero and there is
   nothing left to claim. If it has not, the balance IS what is still to leave
   the cheque account. `implied` rather than stated, so a payment made since the
   balance was last confirmed has already been taken off.

   Deliberately NOT subject to the WHOLE_MONTH_DAYS guard that debts carry. That
   guard exists because a monthly instalment cannot be placed inside a 7-day
   window without inventing a date. This is not a prediction about a future
   charge — the money is owed right now, today, in every window. `settle_day`
   refines WHEN if the household has told us; its absence changes nothing about
   whether. */
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
      basis: 'settled',
    });
  }
  return out;
}

/* What is owed on credit cards — STATED, never folded in.

   This is the third answer, and it exists because the other two are both wrong
   on their own. Counting a card balance as negative cash reports money the
   household does not have. Counting it as a commitment claims it leaves the
   cheque account before the period ends, which for a card topped up several
   times a month cannot be placed and so falls foul of rule 6. Saying nothing —
   what this card did until now — reports "R53 actually free" beside R17,011 of
   money already spent.

   So it is reported next to the figures rather than inside them: a sentence,
   not arithmetic. Nothing above it moves, the reader can still add up every
   number on the card, and the one fact that was missing is on screen.

   Cards only. An overdrawn cheque account is already visible as the cash it
   failed to contribute; a card is invisible precisely because it is a separate
   account nobody looks at. `implied`, so a settlement made since the balance
   was last confirmed has already come off. */
function cardsOwed(accounts) {
  let owed = 0;
  const cards = [];
  /* Per-card entries alongside the totals, so whatsLeft can subtract the
     cards the commitment chain has CLAIMED and disclose the remainder —
     without re-deriving which accounts are cards under a second rule. */
  const entries = [];
  for (const a of accounts || []) {
    if (!a || a.inBudget === false || !a.dated) continue;
    if (String(a.type || '').trim().toLowerCase() !== 'credit_card') continue;
    if (a.implied < 0) {
      owed += -a.implied; cards.push(a.name);
      entries.push({ name: a.name, amount: -a.implied });
    }
  }
  return { owed, cards, entries };
}

/* ------------------------------ the card -------------------------------- */

/* Everything the "What's left" card renders.

   `accounts`  [{ name, implied, dated, inBudget }] — implied balances from reconcile()
   `services`  S.services            `debts`  S.debts
   `rows`      every transaction row in the vault
   `cardRows`  rows from the cards that are SETTLED MONTHLY, for the cycle
               comparison — spending on those cards this period against the
               income that will clear it.
   `incomeRows` rows from IN-BUDGET accounts only, for the repeating-credit
               search. Separate from `rows` on purpose: a monthly debit order
               into a savings fund is a credit on that fund's statement, and
               predicting it as household income would announce money arriving
               that is only moving.
   `periodStart` / `periodEnd`       the window the Dashboard is showing
   `today`     injected

   `free` may be negative; the caller renders that as "short", never as a
   negative amount of free money. `perDay` is null on the last day of a period —
   dividing the balance by zero days remaining, or printing a whole balance as a
   daily rate, are both worse than saying nothing. */
function whatsLeft({ accounts, services, debts, rows, incomeRows, cardRows, periodStart, periodEnd, today }) {
  const now = ISO_DATE.test(today || '') ? today : null;
  const to = periodEnd;
  /* The window starts today, not at the period start: a charge dated earlier
     that never arrived is not "still coming", it is missing, and this card is
     not the place to argue about it. */
  const from = now && now > periodStart ? now : periodStart;

  const { cash, counted, unknown } = cashOnHand(accounts);
  const { owed, cards, entries: owedEntries } = cardsOwed(accounts);

  const periodDays = daysBetween(periodStart, periodEnd) + 1;
  const items = [
    ...serviceCommitments({ services, rows, from, to, periodStart }),
    ...debtCommitments({ debts, rows, from, to, periodStart, periodDays }),
    ...cardCommitments({ accounts, from, to }),
  ].sort((a, b) => (b.amount - a.amount));

  const committed = items.reduce((s, i) => s + i.amount, 0);
  /* The card settlement, kept SEPARABLE from the debit orders even though both
     are subtracted. They are different kinds of claim and the reader needs to
     tell them apart: a debit order is a fixed instalment somebody else takes on
     a known day, and a card settlement is this cycle's own spending coming home.
     Folded into one "still committed" figure, seventeen thousand rand of card
     hides ninety-five rand of Spotify and the reader cannot see either. */
  const cardDue = items.filter(i => i.kind === 'card').reduce((s, i) => s + i.amount, 0);
  const daysLeft = now ? Math.max(0, daysBetween(now, periodEnd)) : null;
  const committedOther = committed - cardDue;

  /* The owed remainder: card balances the commitment chain did NOT claim.
     `owed` states every card in full — that stays, per the both-places test.
     But the VIEW's sentence used to gate on `owed > 0 && cardDue === 0`,
     which is all-or-nothing where the data is per-card: one settle-monthly
     card claimed in the chain (cardDue > 0) suppressed the sentence for a
     SECOND, revolving card, and that card's balance appeared in no figure
     and no sentence — the exact silent state this disclosure exists to end.
     Derived from the actual claimed items, not from a second reading of the
     account list, so the two cannot disagree about which cards were taken. */
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

  /* ------------------------- the settlement cycle -------------------------

     A card settled every month is not a claim on the cash sitting in the cheque
     account, and subtracting it from that cash answers a question nobody asks.

     The household this was measured on runs its whole month through the card
     and clears it on payday: the work month runs the 23rd to the 22nd, spending
     happens on the card throughout, and the salary that lands on the 23rd — day
     ONE of the next period — settles it. The cash left in the cheque account
     mid-period is the tail of LAST month's salary after the non-card spending;
     it was never going to pay the card. Measured against it the card reported
     "R16 958 short" at the same point in every single cycle, which is a warning
     that fires monthly and is therefore read by nobody.

     The interest is what proves this is timing and not credit: 16.5% on R40 000
     would cost about R550 a month, and the real card charged R0.02, R1.92 and
     R23.62 across three of them. It is a conduit, not a loan.

     So the honest comparison is card spending THIS CYCLE against the income
     that will settle it — and `over` is the signal that actually matters,
     because a cycle whose card spend exceeds its settling income is the one
     case where the pattern really has stopped working.

     `settling` is deliberately NOT gated on periodEnd the way `incoming` is.
     Under a payday month anchored on payday the settling salary ALWAYS lands on
     day one of the next period, so a period-end gate excludes the only income
     that was ever going to clear the balance. That gate is right for "what else
     arrives before this window shuts" and exactly backwards for this. */
  const cardSpend = (cardRows || []).reduce((s, r) => (
    r && typeof r.amount === 'number' && r.amount < 0 && !isSplitPart(r) &&
    r.date >= periodStart && r.date <= periodEnd ? s - r.amount : s), 0);
  const settling = (credit && now && credit.next >= now) ? credit : null;
  /* The settle-monthly card is re-checked HERE rather than trusted from the
     caller's filtering of `cardRows`. A revolving balance must never be read as
     a settlement cycle — it is a real claim, and telling its holder they have
     "headroom before the 23rd" would be the most dangerous sentence this card
     could print. Leaving that guarantee in the caller is how the two drift:
     whatsLeft would report a cycle for any rows it was handed. */
  const settlesMonthly = (accounts || []).some(a => isSettleCard(a) && a.inBudget !== false);
  const cycle = (settlesMonthly && cardSpend > 0 && settling) ? {
    spend: cardSpend,
    settling: settling.amount,
    date: settling.next,
    ratio: cardSpend / settling.amount,
    over: cardSpend > settling.amount,
    headroom: settling.amount - cardSpend,
  } : null;

  /* THE ONE FREE FIGURE. Everything the card renders about "what's actually
     free" — the headline, the per-day rate, the "this leaves you short/
     covered" sentence and the bar's aria-label — must all read this same
     number, or the card contradicts itself out loud (a screen-reader user
     hearing one figure in the aria-label and a different one printed beside
     it is exactly that).

     While a settlement cycle is running the card has its OWN band below
     (`cycle`) and is no longer a claim on this cash — see the settlement-
     cycle comment above cardSpend. So `free` excludes cardDue exactly when
     `cycle` says the card is being handled separately; committedOther alone
     is what is still coming out of THIS cash. Outside a cycle, cardDue is a
     real claim like any other and stays in. */
  const free = cycle ? cash - committedOther : cash - committed;

  /* Compared in CENTS, never as a raw float difference. Summing floats that
     were themselves fine (measured across 1,000 realistic amounts: no
     drift) can still leave a difference of a few units in the 13th decimal
     place — R4,001.60 confirmed against R1,000.70 + R3,000.90 committed
     nets to -4.55e-13, not zero, in IEEE 754. Read as `free < 0` a household
     that is exactly break-even is told it is short and shown "R -0,00".
     Rounding to the cent before comparing is the fix; the sums themselves
     are untouched. */
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
    incoming,
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

/* Whole days from a to b. Both are ISO dates the caller has already validated;
   built on UTC so a local-time DST shift cannot round a day away. */
function daysBetween(a, b) {
  if (!ISO_DATE.test(a || '') || !ISO_DATE.test(b || '')) return 0;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

module.exports = {
  WHOLE_MONTH_DAYS, nextOnDay, isSettleCard,
  cashOnHand, cardsOwed, serviceCommitments, debtCommitments, cardCommitments, whatsLeft,
};
