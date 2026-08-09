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

   SIX RULES, and the second one is the one the card lives or dies by.

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

   Pure — no DOM, no obsidian import — so tests/committed.test.cjs drives it in
   bare node, and `today` is injected rather than read off the clock. */

const { ISO_DATE } = require('./dates');
const { matchCharges, chargeStats, nextExpected } = require('./recurring');
const { isSplitPart } = require('./tx-role');

/* A debt instalment can only be placed inside a window at least this long when
   its usual payment day is unknown. A monthly instalment lands in every
   payday month, so on a monthly cycle "not paid yet" is enough to know it is
   still coming. On a 7- or 14-day cycle it plainly is not: three weeks out of
   four would claim a bond payment that is not due, which is rule 6's whole
   point. */
const WHOLE_MONTH_DAYS = 28;

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
   card sitting at −R8,400 is a debt the Debt page owns; adding it here would
   net a liability against cash and report money the household does not have.

   `implied` is what reconcile() worked out; `dated` says whether the stated
   balance carried a date it could be measured from. Undated accounts are
   counted as unknown and named, never folded in at zero. */
function cashOnHand(accounts) {
  let cash = 0, counted = 0;
  const unknown = [];
  for (const a of accounts || []) {
    if (!a || a.inBudget === false) continue;
    if (!a.dated) { unknown.push(a.name); continue; }
    counted++;
    if (a.implied > 0) cash += a.implied;
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
    const stats = chargeStats(m.charges);

    /* Already charged in this period? Asked of the merchant's own charges, not
       of the category — a phone contract and a cloud subscription share a
       category on real data, and one would cancel the other out. */
    const landed = (m.charges || []).some(c => c.date >= periodStart && c.date <= to);
    if (landed) continue;

    /* Derived first, typed second. Every next-billing date in the reference
       vault was months in the past; the charge history knows better. */
    const due = nextExpected(stats, s.cycle) || (ISO_DATE.test(s.next || '') ? s.next : null);
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

/* ------------------------------ the card -------------------------------- */

/* Everything the "What's left" card renders.

   `accounts`  [{ name, implied, dated, inBudget }] — implied balances from reconcile()
   `services`  S.services            `debts`  S.debts
   `rows`      every transaction row in the vault
   `periodStart` / `periodEnd`       the window the Dashboard is showing
   `today`     injected

   `free` may be negative; the caller renders that as "short", never as a
   negative amount of free money. `perDay` is null on the last day of a period —
   dividing the balance by zero days remaining, or printing a whole balance as a
   daily rate, are both worse than saying nothing. */
function whatsLeft({ accounts, services, debts, rows, periodStart, periodEnd, today }) {
  const now = ISO_DATE.test(today || '') ? today : null;
  const to = periodEnd;
  /* The window starts today, not at the period start: a charge dated earlier
     that never arrived is not "still coming", it is missing, and this card is
     not the place to argue about it. */
  const from = now && now > periodStart ? now : periodStart;

  const { cash, counted, unknown } = cashOnHand(accounts);

  const periodDays = daysBetween(periodStart, periodEnd) + 1;
  const items = [
    ...serviceCommitments({ services, rows, from, to, periodStart }),
    ...debtCommitments({ debts, rows, from, to, periodStart, periodDays }),
  ].sort((a, b) => (b.amount - a.amount));

  const committed = items.reduce((s, i) => s + i.amount, 0);
  const daysLeft = now ? Math.max(0, daysBetween(now, periodEnd)) : null;
  const free = cash - committed;

  return {
    cash,
    cashKnown: counted > 0,
    unknownAccounts: unknown,
    committed,
    items,
    free,
    short: free < 0,
    days: daysLeft,
    perDay: (daysLeft && daysLeft > 0 && free > 0) ? free / daysLeft : null,
    counts: {
      service: items.filter(i => i.kind === 'service').length,
      debt: items.filter(i => i.kind === 'debt').length,
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
  WHOLE_MONTH_DAYS, nextOnDay, cashOnHand, serviceCommitments, debtCommitments, whatsLeft,
};
