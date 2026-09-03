'use strict';
/* Debt amortisation + payoff-strategy simulation.

   Pure arithmetic — no DOM, no obsidian import, no clock read — so the Debt
   view's numbers can be driven from a bare-node test. Iterative on purpose,
   never closed-form (ADR-0007, "debt-math.js — purpose").

   Convention: `rate` is the ANNUAL nominal rate as a percentage (18.5 means
   18.5%), compounded monthly. Amounts are positive; a balance is what is
   still owed. */

/* ADR-0007 · Real start date, not a date-shaped one. ISO_DATE is shape-only and
   expectedBalance walks `start` as real elapsed months. */
const { ISO_DATE, isRealIsoDate } = require('./dates');

/* Below this, a balance is settled. Floating-point interest leaves fractions
   of a cent behind, and comparing to exactly 0 makes the loop run to the cap. */
const EPS = 0.005;

/* Runaway guard: 50 years. A debt that has not closed by then is reported as
   unsettled rather than looped on forever — see the header note. */
const MAX_MONTHS = 600;

const monthlyRate = rate => (Number(rate) || 0) / 100 / 12;

/* One debt, paid on its own at a fixed monthly amount. Returns the months to
   zero, the interest paid getting there, and whether it actually closed. */
function amortise(balance, rate, payment, maxMonths = MAX_MONTHS) {
  let b = Number(balance) || 0;
  const r = monthlyRate(rate);
  const pay = Number(payment) || 0;
  if (b <= EPS) return { months: 0, interest: 0, settled: true };
  if (pay <= 0) return { months: maxMonths, interest: 0, settled: false };
  let interest = 0, m = 0;
  while (b > EPS && m < maxMonths) {
    m++;
    const i = b * r;
    b += i; interest += i;
    b -= Math.min(pay, b);
  }
  return { months: m, interest, settled: b <= EPS };
}

/* What this month's interest costs, before a cent of principal moves. The most
   useful single number on the page: it is the price of doing nothing. */
const monthlyInterest = (balance, rate) => Math.max(0, Number(balance) || 0) * monthlyRate(rate);

/* ADR-0007 · Attack order and tie-break. avalanche = highest rate first, snowball =
   smallest balance first, recomputed monthly; ties break on name then key. */
function priorityOrder(debts, strategy) {
  const open = debts.filter(d => d.balance > EPS);
  const tie = (a, b) => a.name.localeCompare(b.name) || ((a.key ?? 0) - (b.key ?? 0));
  if (strategy === 'snowball') {
    return open.sort((a, b) => a.balance - b.balance || tie(a, b));
  }
  return open.sort((a, b) => b.rate - a.rate || a.balance - b.balance || tie(a, b));
}

/* ADR-0007 · Minimum is the no-rollover baseline. ADR-0007 · Payoff keyed by key, not name.
   ADR-0007 · The payoff curve is recorded in the payoff loop. `series[0]` is the opening balance.
   Returns { months, interest, payoff: {key: month}, settled, stalled, series }. */
function simulate(debts, { extra = 0, strategy = 'avalanche', maxMonths = MAX_MONTHS } = {}) {
  const list = (debts || [])
    .map((d, idx) => ({
      key: d.key ?? idx,
      name: d.name,
      balance: Number(d.balance) || 0,
      rate: Number(d.rate) || 0,
      // A debt's own standing extra is part of its committed payment under
      // every strategy — it is money already being paid, not a what-if.
      payment: Math.max(0, (Number(d.payment) || 0) + (Number(d.extra) || 0)),
    }))
    .filter(d => d.balance > EPS);
  if (!list.length) return { months: 0, interest: 0, payoff: {}, settled: true, stalled: [], series: [0] };

  const roll = strategy !== 'minimum';
  const pool = roll ? Math.max(0, Number(extra) || 0) : 0;
  const payoff = Object.create(null);
  const owed = () => list.reduce((t, d) => t + d.balance, 0);
  const series = [owed()];
  let interest = 0, m = 0;

  while (m < maxMonths && list.some(d => d.balance > EPS)) {
    m++;
    let free = pool;
    for (const d of list) {
      // Already closed: its whole payment is available to the pool from here on.
      if (d.balance <= EPS) { if (roll) free += d.payment; continue; }
      const i = d.balance * monthlyRate(d.rate);
      d.balance += i; interest += i;
      const paid = Math.min(d.payment, d.balance);
      d.balance -= paid;
      // A debt closing mid-month spills the unused remainder of THIS month's
      // payment, not just next month's — dropping it would overstate the plan.
      if (roll) free += d.payment - paid;
      if (d.balance <= EPS) { d.balance = 0; payoff[d.key] = m; }
    }
    if (roll && free > EPS) {
      for (const d of priorityOrder(list, strategy)) {
        if (free <= EPS) break;
        const paid = Math.min(free, d.balance);
        d.balance -= paid; free -= paid;
        if (d.balance <= EPS) { d.balance = 0; payoff[d.key] = m; }
      }
    }
    series.push(owed());
  }

  const stalled = list.filter(d => d.balance > EPS).map(d => d.name);
  return { months: m, interest, payoff, settled: !stalled.length, stalled, series };
}

/* ADR-0007 · addMonths takes an injected date and drops the day. 'YYYY-MM' n months
   after `from` (a Date, REQUIRED — no clock read here). */
function addMonths(n, from) {
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* "3 yr 2 mo" / "7 months" / "1 month". Years-and-months once past a year,
   because "38 months" is a number nobody converts in their head. */
function humanMonths(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 12) return `${n} month${n === 1 ? '' : 's'}`;
  const y = Math.floor(n / 12), r = n % 12;
  return r ? `${y} yr ${r} mo` : `${y} year${y === 1 ? '' : 's'}`;
}

/* ADR-0007 · Expected balance projects from the fields the row already has.
   ADR-0007 · Interest before each payment. ADR-0007 · Missing input is null, not a guess.
   Where a debt SHOULD be today, or null when the row cannot support the projection. */
function expectedBalance(debt, today) {
  const d = debt || {};
  const original = Number(d.original) || 0;
  const pay = (Number(d.payment) || 0) + (Number(d.extra) || 0);
  if (!original || pay <= 0) return null;
  /* `today` is caller-supplied (views/debts.js's own todayIso()), always
     real — but `d.start` comes off a hand-editable file, so only IT needs the
     real-calendar check; today still only needs the shape check to keep this
     symmetric with the rest of the module's "missing input → null" contract. */
  if (!isRealIsoDate(d.start) || !ISO_DATE.test(today || '')) return null;

  const [sy, sm, sd] = d.start.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  /* ADR-0007 · Whole months elapsed, billing day clamped. Only completed months count; the
     billing day is clamped to a short month's last day as nextOnDay() in committed.js does. */
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const billDay = Math.min(sd, lastDay);
  const months = (ty - sy) * 12 + (tm - sm) - (td < billDay ? 1 : 0);
  if (months <= 0) return null;

  /* ADR-0007 · An unanchored original/start pair returns null. A drop beyond payment × months is
     impossible even at 0% interest, so `original` was edited alone and the pair is not one debt. */
  if (Number.isFinite(d.balance)) {
    const maxCashPaid = pay * months;
    if (original - d.balance > maxCashPaid + 0.01) return null;
  }

  const r = monthlyRate(d.rate);
  let b = original;
  let paid = 0, interest = 0;
  for (let m = 0; m < months && b > EPS; m++) {
    const i = b * r;
    b += i; interest += i;
    const step = Math.min(pay, b);
    b -= step; paid += step;
  }
  return { expected: b, months, paid, interest, settled: b <= EPS };
}

// MAX_MONTHS and EPS are tuning constants for the functions above, not part of
// the contract — every caller goes through amortise/simulate, which apply them.
module.exports = { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths, expectedBalance };
