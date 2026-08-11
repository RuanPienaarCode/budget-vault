'use strict';
/* Debt amortisation + payoff-strategy simulation.

   Pure arithmetic, no DOM and no obsidian import, so the numbers the Debt view
   shows can be driven directly from a bare-node test. Every function here is
   iterative rather than closed-form on purpose: the closed-form payoff formula
   (-ln(1 - rB/P) / ln(1+r)) silently returns NaN for the exact case that
   matters most to a reader in trouble — a payment at or below the monthly
   interest, where the balance never falls. Iterating lets that case come back
   as `settled: false` with a month count instead of a blank cell.

   Convention: `rate` is the ANNUAL nominal rate as a percentage (18.5 means
   18.5%), compounded monthly — how a lender quotes it and how it is stored in
   Debts.md. Amounts are positive numbers; a balance is what is still owed. */

const { ISO_DATE } = require('./dates');

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

/* Attack order for the pooled extra payment.
     avalanche — highest rate first (mathematically cheapest)
     snowball  — smallest balance first (closes accounts soonest)
   Recomputed every month against live balances, so snowball re-targets as
   accounts close. Ties break on name and then on key, so a run is reproducible
   even when two debts share a name — which households do have ("Credit card"
   twice, one per bank). */
function priorityOrder(debts, strategy) {
  const open = debts.filter(d => d.balance > EPS);
  const tie = (a, b) => a.name.localeCompare(b.name) || ((a.key ?? 0) - (b.key ?? 0));
  if (strategy === 'snowball') {
    return open.sort((a, b) => a.balance - b.balance || tie(a, b));
  }
  return open.sort((a, b) => b.rate - a.rate || a.balance - b.balance || tie(a, b));
}

/* Run every debt forward together under one strategy.

   `strategy: 'minimum'` is the do-nothing baseline — contracted payments plus
   each debt's own standing extra, no pooled extra and no rollover. The other
   two add `extra` per month AND roll a closed debt's payment into the pool,
   which is the entire point of both methods and the reason their debt-free
   date beats the baseline even when `extra` is 0.

   `payoff` is keyed by each debt's `key` — its own if it carries one, otherwise
   its position in the INPUT array. Keying by name looks tidier and is wrong:
   two debts called "Credit card" would share one entry, so the second one's
   payoff month would overwrite the first's and both rows would show the same
   clear date. Mapping before filtering keeps those positions stable even when a
   settled debt drops out.

   `series` is the total still owed at the END of each month, with `series[0]`
   the opening balance before a cent is paid — so it always has months + 1
   entries and can be plotted straight against a month axis. Recorded inside
   this loop rather than by a second pass on purpose: a payoff CURVE drawn from
   its own re-implementation would be free to disagree with the payoff DATE
   printed beside it, and the reader would have no way to tell which one lied.

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

/* 'YYYY-MM' n months after `from` (a Date, default today). Day-of-month is
   deliberately dropped: a payoff month is the honest resolution here, and
   keeping the day would invent precision the model does not have. */
function addMonths(n, from = new Date()) {
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

/* Where a debt SHOULD be today, given what it started at and what has been paid
   into it since — the Accounts page's reconciliation argument, made on the one
   page where a hand-typed figure goes out of date fastest, because a debt
   balance moves every single month.

   It cannot be made the same way as an account's. A debt row carries no
   "balance as of" date, and payments are attributed per CATEGORY rather than
   per debt (three debts sharing one category would each claim the full amount).
   So the projection runs from the fields the file already has — `original`,
   `rate`, `payment` + `extra`, `start` — and needs no new column.

   Interest is applied BEFORE each payment, month by month, because a debt does
   not fall by the instalment: the lender adds interest between statements.
   Subtracting payments alone would report a debt shrinking faster than it is,
   which is the flattering direction and therefore the dangerous one.

   Returns null when the row cannot support the projection — no start date, no
   original, no instalment, or a start date in the future. A missing answer is
   the honest output; a projection from guessed inputs is not. */
function expectedBalance(debt, today) {
  const d = debt || {};
  const original = Number(d.original) || 0;
  const pay = (Number(d.payment) || 0) + (Number(d.extra) || 0);
  if (!original || pay <= 0) return null;
  if (!ISO_DATE.test(d.start || '') || !ISO_DATE.test(today || '')) return null;

  const [sy, sm, sd] = d.start.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  /* WHOLE months elapsed, floored on the day of the month.

     A difference of month indices alone counts any part-month as a full one, so
     a debt starting on the 31st and read on the 1st was charged a whole month of
     interest AND credited a whole instalment for a single day. The instalment is
     the larger of the two, so the error runs in the flattering direction — the
     one this module's header already refuses to take on the interest ordering,
     arriving by a different route. Only completed months count.

     The billing day is clamped to a short month's last day, the same way
     nextOnDay() does it in committed.js: an agreement running on the 31st is
     debited on the 28th in February, and treating that month as incomplete
     would swing the error the other way and report a debt LARGER than it is. */
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const billDay = Math.min(sd, lastDay);
  const months = (ty - sy) * 12 + (tm - sm) - (td < billDay ? 1 : 0);
  if (months <= 0) return null;

  /* UNANCHORED: `original` and `start` are only ever set together, by
     addDebt, as `original = balance` on the day the row is created — nothing
     in the Debt table edits either field afterward. The only way `original`
     later disagrees with a fresh row's balance is a hand edit to Debts.md
     (which the view's own comment invites, to record the loan's true original
     amount), and that edit moves `original` alone: `start` is left reading as
     the ROW's creation date, not the day that original amount was actually
     owed.

     That is provable, not a guess: a balance can only fall by cash actually
     paid, and crediting every rand of it straight to principal (0% interest,
     the most generous case) still bounds the drop by payment(+extra) × months
     elapsed. `original - balance` exceeding that bound means the balance
     could not possibly have gone from `original` to today's figure on this
     schedule — proof the pair does not describe one continuous debt, not a
     material discrepancy to flag. Gated on a real `.balance` so the bare
     date/month arithmetic exercised without one (above) is untouched. */
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
