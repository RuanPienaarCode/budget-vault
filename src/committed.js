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

const { ISO_DATE, isRealIsoDate, daysBetween: isoDaysBetween, isoDayNumber, isoFromDayNumber } = require('./dates');
const { isPoolAccount, accountType } = require('./vocabulary');
const { matchCharges, chargeStats, chargeStatus, addCycles, normDesc, findRecurringCredit, STEP_DAYS } = require('./recurring');

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
/* ADR-0007 · Days of the month are a circle (ISSUE 74). A cluster inside half
   the circle is an ordinary median; a wider spread is the circular median, the
   day minimising the summed circular distance on a 31-day circle. The lift-by-31
   rule this replaces was only right across the month END: payments on the 14th,
   15th, 16th and one on the 30th gave the 7th, a week early (L2b-03). A tie goes
   to the lower day; NaN days are dropped. */
const MONTH_CIRCLE = 31;
const circularGap = (a, b) => { const x = Math.abs(a - b); return Math.min(x, MONTH_CIRCLE - x); };
const usualDay = days => {
  const ds = days.filter(d => Number.isFinite(d) && d >= 1 && d <= 31);
  if (!ds.length) return 0;
  const lo = Math.min(...ds), hi = Math.max(...ds);
  if (hi - lo <= 15) return median(ds);
  let best = 0, bestCost = Infinity;
  for (let d = 1; d <= MONTH_CIRCLE; d++) {
    const cost = ds.reduce((t, x) => t + circularGap(x, d), 0);
    if (cost < bestCost) { best = d; bestCost = cost; }
  }
  return best;
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

/* ADR-0007 · An unreadable balance is unknown, on the same predicate as
   figures.js's balanceBook(): the loader parsed "about 300" to 0 and kept the
   text in balanceRaw, and adding "0 plus the rows since" as cash is a figure
   the reader never wrote. The view hands over `readable`; absent means
   readable, so every caller that never heard of the field is unchanged. */
const isUnreadable = a => !!a && a.readable === false;

function cashOnHand(accounts) {
  let cash = 0, counted = 0, staleCounted = 0, earmarked = 0;
  const unknown = [];
  /* Held out because the balance could not be read, not because it has no
     date: a different reason, and the card says which. */
  const unreadable = [];
  /* The accounts whose implied balance actually reached `cash`. The card's
     own sentences about them (unconfirmed, rows nothing could place, rows on
     a confirmation day) must describe THIS set and no wider one: on the real
     vault "2 accounts · 1 unconfirmed" named an unconfirmed cash account that
     held nothing and so was not among the 2. */
  const contributors = [];
  /* Named, not just totalled: a figure held back from "actually free" is an
     exclusion, and this app does not exclude in silence. */
  const earmarkedFrom = [];
  /* Accounts the household opted OUT of the budget whose money this card would
     otherwise have counted as cash (a business cheque, an online wallet),
     named because an exclusion the reader cannot see is the silent kind
     (2026-09-29 audit). Judged by the SAME tests as the loop below - dated,
     readable, positive - so the sentence cannot describe an account the card
     would not have counted anyway. NOT the pools: a savings or investment
     account outside the budget was never cash, and naming it would drown the
     two that matter. Foreign accounts never arrive - the view partitions first. */
  const outside = [];
  for (const a of accounts || []) {
    if (a && a.inBudget === false) {
      if (a.dated && !isUnreadable(a) && a.implied > 0 && !isPoolAccount(a)) outside.push({ name: a.name, amount: a.implied });
      continue;
    }
    if (!a) continue;
    if (!a.dated) { unknown.push(a.name); continue; }
    if (isUnreadable(a)) { unreadable.push(a.name); continue; }
    if (a.implied > 0) {
      cash += a.implied; counted++;
      if (a.stale) staleCounted++;
      contributors.push(a);
      const ear = earmarkOf(a);
      if (ear > 0) { earmarked += ear; earmarkedFrom.push({ name: a.name, amount: ear }); }
    }
  }
  return { cash, counted, staleCounted, unknown, unreadable, earmarked, earmarkedFrom, contributors, outside };
}

/* ---------------------------- commitments ------------------------------- */

/* The day an account's figures are known up to: its newest imported row on
   or before today, or the day its balance was confirmed, whichever is later.
   A balance typed on the 3rd already holds a debit order taken on the 1st,
   so holding that order again would subtract it twice. A confirmation dated
   after today is the typo reconcile() refuses, so it proves nothing. Null
   when neither field is there: a caller that never passes them keeps the
   behaviour it always had. */
function knownTo(a, today) {
  const usable = d => isRealIsoDate(d) && (!today || d <= today);
  const imported = usable(a && a.importedTo) ? a.importedTo : '';
  const confirmed = usable(a && a.balanceDate) ? a.balanceDate : '';
  return (imported > confirmed ? imported : confirmed) || null;
}

/* The account a service is paid from: whichever folder holds its most recent
   real charge (`charged` is in date order). `accountOfRow` is the view's map
   from every row it handed over to the account entry that owns it; with no
   map, or a row from a folder no account claims, there is no account to read
   a date off and the answer is null rather than a guess. */
function payerOf(charged, accountOfRow) {
  if (!accountOfRow || !charged.length) return null;
  return accountOfRow.get(charged[charged.length - 1]) || null;
}

/* Services expected between `from` and `to` inclusive.

   `rows` is every transaction in the vault, so a service's charge history is
   its whole history — the price and cadence come from all of it. Whether it has
   ALREADY landed is a separate question asked only of this period. */
function serviceCommitments({ services, rows, from, to, periodStart, accountOfRow }) {
  const out = [];
  const history = rows || [];
  for (const s of services || []) {
    if (!s || !s.active) continue;
    const m = matchCharges(s, history);
    /* ADR-0007 · Price from the dominant group, timing from every group. A
       renamed debit order is still taking the money; a stale anchor silently
       dropped Airtime and Website Hosting from the committed figure. */
    /* `current`, not `charges`: the price is what the service charges NOW,
       and the dominant group by lifetime total can be a description the
       merchant abandoned (see currentCharges in recurring.js). */
    const stats = chargeStats(m.current || m.charges);   // price
    /* ADR-0007 · Charged by today, not merely present. A row dated later this
       period is not history (ISSUE 35/42/44's as-of, reaching the last
       figure); price is deliberately not filtered.

       ISSUE 91. `isRealIsoDate` FIRST, because `<=` on a date column load.js
       never validated is a string comparison: `2026-02-30` — reconcile.js's
       own month-length slip — sits inside a period straddling the month end,
       so it landed in `charged`, satisfied the landed test below, and dropped
       R2 500 of medical aid out of "still committed" into "actually free".
       chargeStats already refuses the row (ISSUE 75); this is the half that
       decides whether the charge HAPPENED. */
    const charged = (m.all || []).filter(c => isRealIsoDate(c.date) && c.date <= from);
    const seen = chargeStats(charged);           // liveness + cadence

    /* Derived first, typed second. Every next-billing date in the reference
       vault was months in the past; the charge history knows better. */
    const typedNext = ISO_DATE.test(s.next || '') ? s.next : null;

    const derived = stats && stats.recent > 0;
    /* A typed figure below zero counts as 0, as the Services page counts it
       (Math.abs held a typed -50 as a R50 commitment beside a row saying it
       counted as 0). A charge history, when there is one, still decides. */
    const amount = derived ? stats.recent : Math.max(0, s.amount || 0);
    if (!amount) continue;

    /* NOT IMPORTED YET. A charge due between the period start and today that
       never arrived is missing only once its account has been imported past
       its day. Before that it is in neither bucket — not in cash, since no
       statement holding it has been imported, and not still to come, since
       its date has passed — and "actually free" counted it as spendable. On
       a real household on a 7 October, three debit orders due on the 1st, on
       accounts last imported on the 26th and the 29th, were counted nowhere.
       So it is held, as its own `basis`, with the date its account is known
       to: always priced from its charges, since the account comes from one. */
    const payer = payerOf(charged, accountOfRow);
    const asOf = payer ? knownTo(payer, from) : null;
    const held = (dueOn, n) => heldItem({ name: s.name, detail: s.provider || '', due: dueOn, unit: amount, n, payer, asOf });

    /* ADR-0007 · How many charges remain (ISSUE 47). Sub-monthly services are
       walked date by date; monthly and annual keep the one-charge-per-period
       rule exactly. */
    const step = STEP_DAYS[s.cycle];
    if (!step) {
      /* Unchanged since 1.20 apart from the window: at most one charge per
         period, so evidence of one is evidence there is nothing left to come. */
      if (charged.some(c => c.date >= periodStart)) continue;
      const { missed, upcoming } = placeCycle({
        last: seen && seen.last, typed: typedNext, cycle: s.cycle, from, to, asOf,
        /* Silent for more than two cycles, counted to the day its account is
           known to: the row on the Services page already asks whether it was
           cancelled, and stepping it into a new period would answer that for
           the reader. Counted to the account's date, not to today, so a service
           is not "lapsed" merely because its statement has not been imported. */
        lapsed: chargeStatus(seen, s.cycle, asOf || from).state === 'overdue',
      });
      if (missed.length) out.push(held(missed[0], missed.length));
      if (!upcoming) continue;
      out.push({
        kind: 'service', name: s.name, detail: s.provider || '',
        due: upcoming, amount, occurrences: 1, unit: amount,
        basis: derived ? 'charged' : 'stated',
      });
      continue;
    }

    /* The same question per occurrence: the cadence dates between the first day
       the account's records do not cover and yesterday that no charge cleared.
       That is the period start or the day after the account's date, whichever
       is EARLIER — starting at the period start dropped every charge between a
       cheque account's last import and the boundary (2026-10-14 audit, L1-01).
       A service silent for more than two cycles to that date is not held. */
    const pastFrom = asOf ? (isoFromDayNumber(isoDayNumber(asOf) + 1) < periodStart ? isoFromDayNumber(isoDayNumber(asOf) + 1) : periodStart) : periodStart;
    const past = asOf && pastFrom < from && chargeStatus(seen, s.cycle, asOf).state !== 'overdue'
      ? remainingCharges({ anchor: seen && seen.last, next: s.next, step, from: pastFrom,
        to: isoFromDayNumber(isoDayNumber(from) - 1), charges: charged }).filter(d => d > asOf)
      : [];
    if (past.length) out.push(held(past[0], past.length));

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

/* The row a charge the account's records have not reached yet is carried as:
   its own `basis`, the account it belongs to and the day that account is known
   to, so the card can say "not imported yet" instead of asserting a miss. */
function heldItem({ name, detail, due, unit, n, payer, asOf }) {
  return {
    kind: 'service', name, detail,
    due, amount: unit * n, occurrences: n, unit,
    basis: 'not-imported', account: payer.name, asOf,
  };
}

/* Where a monthly or annual charge falls against the window (L1-01). Walks the
   cycle from the LAST real charge with addCycles (anchored on its own day, so
   the 31st survives February). `missed` is every date before `from` that the
   account's records have not reached (after `asOf`): held whichever side of the
   period start it falls, since neither the cash nor a statement holds it; a date
   the records DO reach with no charge was really missed and is dropped.
   `upcoming` is the first date inside the window; at most one a period. A lapsed
   service yields neither. With no history the typed date is used, never stepped. */
const MAX_CYCLES = 60;
function placeCycle({ last, typed, cycle, from, to, asOf, lapsed }) {
  const missed = [];
  let upcoming = null;
  if (last && ISO_DATE.test(last)) {
    if (lapsed) return { missed, upcoming };
    for (let k = 1; k <= MAX_CYCLES; k++) {
      const due = addCycles(last, cycle, k);
      if (due > to) break;
      if (due >= from) { upcoming = due; break; }
      if (asOf && due > asOf) missed.push(due);
    }
  } else if (typed && typed >= from && typed <= to) {
    upcoming = typed;
  }
  return { missed, upcoming };
}

/* Debit orders nobody listed (L2a-N05 / L1-10): HELD like a not-imported Service,
   in the shape the Dashboard already renders (name = category, detail = the
   description). The bar is findRecurringCredit's: high, and [] is a good answer.
   A group is one payer, category and exact amount (description only where there
   is no category); it must be charged once in each of the last three months, on
   about one day, from an in-budget account that is not a card or a savings pool,
   and not lapsed. Category and amount, not description: the real orders shared
   their bank wording or changed its letters monthly. Anything a Services row or
   a debt already counts (rows matched, or its name/category) is left to it. */
const ORDER_MONTHS = 3;
const DAY_DRIFT = 4;
const monthNumber = iso => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
const fold = x => String(x || '').trim().toLowerCase();

function debitOrderCommitments({ rows, services, debts, from, to, periodStart, accountOfRow }) {
  if (!accountOfRow || !rows || !rows.length) return [];

  const counted = new Set();
  const named = new Set();
  for (const sv of services || []) {
    if (!sv) continue;
    for (const c of matchCharges(sv, rows).all || []) counted.add(c);
    if (fold(sv.name)) named.add(fold(sv.name));
    if (fold(sv.category)) named.add(fold(sv.category));
  }
  for (const d of debts || []) { if (d && fold(d.category)) named.add(fold(d.category)); }

  /* A fixed payment to a card is the card's balance moving, which
     cardCommitments already holds; its other leg (the same amount landing on a
     card within DAY_DRIFT days) is what tells it from an order. One leg pairs
     with ONE outflow, the nearest: "any equal outflow nearby" let a card
     settlement on the 2nd claim a same-amount fund order on the 3rd too. */
  const cents = x => Math.round(Math.abs(x) * 100);
  const outByCents = new Map();
  for (const r of rows) {
    if (!r || !(r.amount < 0) || !isRealIsoDate(r.date) || isCreditCard(accountOfRow.get(r))) continue;
    const k = cents(r.amount);
    if (!outByCents.has(k)) outByCents.set(k, []);
    outByCents.get(k).push(r);
  }
  const paidToCard = new Set();
  for (const c of rows) {
    if (!c || !(c.amount > 0) || !isRealIsoDate(c.date) || !isCreditCard(accountOfRow.get(c))) continue;
    let best = null, bestGap = Infinity;
    for (const r of outByCents.get(cents(c.amount)) || []) {
      if (paidToCard.has(r)) continue;
      const gap = Math.abs(isoDaysBetween(c.date, r.date));
      if (gap <= DAY_DRIFT && gap < bestGap) { best = r; bestGap = gap; }
    }
    if (best) paidToCard.add(best);
  }
  const paysCard = r => paidToCard.has(r);

  const groups = new Map();
  for (const r of rows) {
    if (!r || typeof r.amount !== 'number' || !(r.amount < 0) || !isRealIsoDate(r.date) || r.date > from) continue;
    const payer = accountOfRow.get(r);
    if (!payer || payer.inBudget === false || isCreditCard(payer) || isPoolAccount(payer)) continue;
    if (paysCard(r)) continue;
    const category = String(r.cat || '').trim();
    const key = category || normDesc(r.desc);
    if (!key) continue;
    const gk = `${payer.name}\u0000${key}\u0000${Math.round(Math.abs(r.amount) * 100)}`;
    if (!groups.has(gk)) groups.set(gk, { payer, rows: [] });
    groups.get(gk).rows.push(r);
  }

  const out = [];
  for (const { payer, rows: list } of groups.values()) {
    if (list.length < ORDER_MONTHS) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const recent = list.slice(-ORDER_MONTHS);
    const months = recent.map(r => monthNumber(r.date));
    if (!months.every((m, i) => i === 0 || m === months[i - 1] + 1)) continue;
    const newest = recent[recent.length - 1];
    const newestDay = day(newest.date);
    if (recent.some(r => circularGap(day(r.date), newestDay) > DAY_DRIFT)) continue;
    const unit = Math.abs(newest.amount);
    if (!(unit > 0)) continue;
    if (list.some(r => counted.has(r))) continue;
    const category = String(newest.cat || '').trim();
    if (category && named.has(fold(category))) continue;

    const asOf = knownTo(payer, from);
    const seen = chargeStats(list);
    const { missed, upcoming } = placeCycle({
      last: newest.date, typed: null, cycle: 'monthly', from, to, asOf,
      lapsed: chargeStatus(seen, 'monthly', asOf || from).state === 'overdue',
    });
    const name = category || String(newest.desc || '').trim();
    const detail = String(newest.desc || '').trim();
    if (missed.length) out.push({ ...heldItem({ name, detail, due: missed[0], unit, n: missed.length, payer, asOf }), source: 'debit-order' });
    if (upcoming) {
      out.push({
        kind: 'service', name, detail, due: upcoming, amount: unit, occurrences: 1, unit,
        basis: 'charged', source: 'debit-order',
      });
    }
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
/* ADR-0007 · Rule 2 asks the BUDGET lens. `settleRows` is the rows the lens
   kept — a narrower question than `rows`, and asking it of `rows` is what made
   this function disagree with the Debts page. `rows` remains the fallback for
   a caller with no lens question to ask at all; the Dashboard always has one
   now, home band or foreign (ISSUE 85 — dropsAnyOf's `except` parameter). */
function debtCommitments({ debts, rows, settleRows, from, to, periodStart, periodDays, today }) {
  const out = [];
  const history = settleRows || rows || [];
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
    /* ISSUE 91, same guard as `charged` above and for the same reason: a
       date-SHAPED cell that names no day (`2026-02-30`) passes ISO_DATE, sorts
       exactly where a real February date would, and would prove an instalment
       paid that never was. */
    if (paid.some(r => isRealIsoDate(r.date) && r.date >= periodStart && r.date <= asOf)) continue;   // rule 2

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
    if (!isSettleCard(a) || a.inBudget === false || !a.dated || isUnreadable(a)) continue;
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
    if (!a || a.inBudget === false || !a.dated || isUnreadable(a)) continue;
    if (accountType(a) !== 'credit_card') continue;
    if (a.implied < 0) {
      owed += -a.implied; cards.push(a.name);
      entries.push({ name: a.name, amount: -a.implied, account: a });
    }
  }
  return { owed, cards, entries };
}

/* ------------------------------ the card -------------------------------- */

/* ADR-0007 · whatsLeft inputs and outputs. Implied accounts from reconcile(),
   `cardRows` from settle-monthly cards, `incomeRows` from in-budget accounts
   only; `free` may be negative, `perDay` is null once the period is over. */
function whatsLeft({ accounts, services, debts, rows, settleRows, incomeRows, cardRows, cardRefundRows, accountOfRow, periodStart, periodEnd, today }) {
  const now = ISO_DATE.test(today || '') ? today : null;
  const to = periodEnd;
  /* The window starts today, not at the period start: a charge dated earlier
     that never arrived is not "still coming". It is missing once its account
     has been imported past its day, and this card is not the place to argue
     about that; until then serviceCommitments holds it as not imported yet,
     which needs the view's `accountOfRow` and each account's `importedTo`
     and `balanceDate`. */
  const from = now && now > periodStart ? now : periodStart;

  const { cash, counted, staleCounted, unknown, unreadable, earmarked, earmarkedFrom, contributors, outside } = cashOnHand(accounts);
  const { owed, cards, entries: owedEntries } = cardsOwed(accounts);

  /* The rows behind the accounts whose balances reached a figure on this card:
     the ones cash counted, and the cards whose owed balance is claimed or
     stated. An account that contributed to neither (a stale cash account at
     zero, an overdrawn cheque) is in no printed figure, so a caveat drawn from
     its rows would qualify a total it cannot have moved. Carried on the
     accounts by the view (`unplaced`, `sameDay`) because reconcile() is not
     this module's business; summed here because WHICH accounts is. */
  let unplaced = 0, sameDayCount = 0, sameDayNet = 0;
  for (const a of new Set([...contributors, ...owedEntries.map(e => e.account)])) {
    unplaced += a.unplaced || 0;
    if (a.sameDay && a.sameDay.count) { sameDayCount += a.sameDay.count; sameDayNet += a.sameDay.net || 0; }
  }
  const confirmDay = { count: sameDayCount, net: Math.round(sameDayNet * 100) / 100 || 0 };

  const periodDays = daysBetween(periodStart, periodEnd) + 1;
  /* How fresh `cash` is: the EARLIEST day the imported accounts behind it
     are known up to, so nothing after it is in the figure. Only accounts
     that reached `cash` — an empty or opted-out one cannot age a total it is
     not in — and only those something is imported into: a hand-kept wallet
     confirmed in June has no import to date the figure by, and printing its
     June over a cheque account imported yesterday misreads the whole total.
     Its age is what the "unconfirmed" count already says. Null when none. */
  const knownDates = contributors
    .filter(a => isRealIsoDate(a.importedTo))
    .map(a => knownTo(a, now)).filter(Boolean);
  const cashAsOf = knownDates.length ? knownDates.reduce((m, d) => (d < m ? d : m)) : null;

  const items = [
    ...serviceCommitments({ services, rows, from, to, periodStart, accountOfRow }),
    ...debitOrderCommitments({ rows, services, debts, from, to, periodStart, accountOfRow }),
    ...debtCommitments({ debts, rows, settleRows, from, to, periodStart, periodDays, today: now }),
    ...cardCommitments({ accounts, from, to }),
  ].sort((a, b) => (b.amount - a.amount));

  const committed = items.reduce((s, i) => s + i.amount, 0);
  /* ADR-0007 · Card settlement kept separable from debit orders: a different
     kind of claim, and folded together R17 000 of card hides R95 of Spotify. */
  const cardDue = items.filter(i => i.kind === 'card').reduce((s, i) => s + i.amount, 0);
  /* Counted INCLUSIVELY: today is a day still to spend in, and the window
     above opens on today (a charge due today is still to come). Counting from
     tomorrow read "0 days" on the last day and "1 day" on the one before, and
     divided today's money across one day too few (2026-10-14 audit, L2a-N12). */
  const daysLeft = now ? (now <= periodEnd ? daysBetween(now, periodEnd) + 1 : 0) : null;
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
  /* ISSUE 91's guard, third of three. Junk sorting into this window inflates
     card spend and can distort the settlement `cycle` derived from it. */
  const inCycle = r => isRealIsoDate(r.date) && r.date >= periodStart && r.date <= periodEnd;
  const cardGross = (cardRows || []).reduce((s, r) => (
    r && typeof r.amount === 'number' && r.amount < 0 && inCycle(r) ? s - r.amount : s), 0);
  /* ADR-0007 · A refund on the card lowers the cycle's spend. `cardRefundRows`
     are the positive rows the ledger calls refunds (isRefund), Excluded or not;
     the net is floored at zero. */
  const cardRefunds = (cardRefundRows || []).reduce((s, r) => (
    r && typeof r.amount === 'number' && r.amount > 0 && inCycle(r) ? s + r.amount : s), 0);
  const cardSpend = cardRefunds ? Math.max(0, cardGross - cardRefunds) : cardGross;
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
    cashAsOf,
    countedAccounts: counted,
    /* Of the counted accounts, those whose stated balance is stale. */
    staleCounted,
    unknownAccounts: unknown,
    unreadableAccounts: unreadable,
    unplaced,
    confirmDay,
    cardDue,
    /* The debit-order half on its own, so the chain can show four terms that
       still add up: cash - committedOther - cardDue = free (outside a
       cycle; inside one, cash - committedOther = free directly). */
    committedOther,
    /* The committed figure a BAND prints as one term: whatever `free` actually
       subtracted. Inside a settlement cycle the card leaves `free` (it is
       measured against the salary that settles it), so it must leave the
       printed term too, or cash · committed · free stop adding up — a euro
       band read "€6 000 cash · €1 000 committed · €6 000 free". The home chain
       keeps committedOther and a separate card term, which sum to the same. */
    committedShown: cycle ? committedOther : committed,
    /* ISSUE 48. Beside the figures AND inside `free`, unlike `owed` below —
       the whole point is that this one changes the answer. `earmarkedFrom`
       names which accounts, because "R23 000 is spoken for" with no way to
       see where invites the reader to assume it is wrong. */
    earmarked: spokenFor,
    earmarkedFrom,
    /* Left OUT of `cash` on purpose and named beside it (see cashOnHand). */
    outside: { count: outside.length, amount: outside.reduce((t, o) => t + o.amount, 0), accounts: outside },
    incoming,
    /* ADR-0007 · afterIncoming counts the settling salary once: inside a
       cycle `incoming` is the credit that funds the card band, so cardDue
       comes back off. Null when nothing is arriving. */
    afterIncoming: incoming ? free + incoming.amount - (cycle ? cardDue : 0) : null,
    cardSpend,
    /* The two halves of cardSpend, for the tests and any sentence that wants
       to say what came back: spend = max(0, cardGross - cardRefunds). */
    cardGross,
    cardRefunds,
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
      /* Of those, the ones held because their account is not imported yet. */
      notImported: items.filter(i => i.basis === 'not-imported').length,
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
  knownTo, cashOnHand, cardsOwed, serviceCommitments, debitOrderCommitments, debtCommitments, cardCommitments, whatsLeft, debtMonthly,
};
