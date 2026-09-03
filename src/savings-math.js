'use strict';
/* Where a savings or investment balance actually came from. Every provider
   statement reports Opening + Contributions + Growth − Withdrawals = Closing,
   and this module DERIVES that split from the account's own transactions
   rather than a hand-typed baseline. Classification (ADR-0007 · The savings
   classification rule): outflow → withdrawal; inflow whose category carries
   `interest: true` → growth; any other real, non-transfer inflow →
   contribution. Excluded rows count; a split parent does not. Every caller
   injects poolCatType, never ctx.catType. Pure — no DOM, no obsidian
   import. Narrative: ADR-0007, savings-math.js — purpose. */

const { ISO_DATE, todayIso, isRealIsoDate } = require('./dates');
const { supersededBySplit } = require('./tx-role');

/* ADR-0007 · poolCatType is built once and shared byte-for-byte. Passing
   ctx.catType instead reverts that one screen to the old rule (two call
   sites once disagreed by R60 000 on one account). */
function poolCatType(categories, name) {
  const c = (categories || []).find(x => x.name === name);
  if (!c) return null;
  return (c.type === 'income' && c.interest) ? 'interest' : c.type;
}

/* ADR-0007 · classifyRow is the one rule, and it does not apply the date
   window: callers window AFTER it, so a split parent at the window's edge
   cannot count twice. Only the string 'interest' reads as growth. */
function classifyRow(r, typeOf) {
  if (!r || typeof r.amount !== 'number' || !r.amount) return null;
  if (supersededBySplit(r)) return null;   // its parts are in this same list
  if (r.amount < 0) return 'withdrawal';
  return (typeOf ? typeOf(r.cat) : null) === 'interest' ? 'growth' : 'contribution';
}

/* Split one account's rows. `typeOf(categoryName)` returns the category's type
   or null. Rows are [{ date, amount, cat }] — the shape the loader produces. */
function splitFlows(rows, typeOf, opts) {
  const from = (opts && opts.from) || '';
  const to = (opts && opts.to) || '';
  let contributions = 0, growth = 0, withdrawals = 0, count = 0, first = null;
  const growthCategories = new Map();
  for (const r of rows || []) {
    const kind = classifyRow(r, typeOf);
    if (!kind) continue;
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    count++;
    /* The earliest row that actually COUNTED, reported here rather than
       recomputed by callers — the filtering above (usable amount, split parent,
       window) is the whole reason a caller cannot just take rows[0], and a
       second copy of these four conditions is how the two would drift. */
    if (first === null || r.date < first) first = r.date;
    if (kind === 'withdrawal') { withdrawals += -r.amount; continue; }
    if (kind === 'growth') {
      growth += r.amount;
      const k = r.cat || '(uncategorised)';
      growthCategories.set(k, (growthCategories.get(k) || 0) + r.amount);
    } else {
      contributions += r.amount;
    }
  }
  return {
    contributions, growth, withdrawals, count, first,
    net: contributions + growth - withdrawals,
    growthCategories: [...growthCategories]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amount]) => ({ cat, amount })),
  };
}

/* ADR-0007 · An account's opening balance is inferred so the identity holds.
   basis: 'derived' | 'stated' (balance − total_invested) | 'none'. */
function accountFlows(account, rows, typeOf, opts) {
  const a = account || {};
  const balance = typeof a.balance === 'number' ? a.balance : 0;
  const has = (rows || []).length > 0;

  if (has) {
    const f = splitFlows(rows, typeOf, opts);
    return {
      basis: 'derived',
      opening: balance - f.net,
      contributions: f.contributions,
      growth: f.growth,
      withdrawals: f.withdrawals,
      closing: balance,
      count: f.count,
      growthCategories: f.growthCategories,
    };
  }

  /* ADR-0007 · Stated baseline: starting_amount first, and a written zero is
     real. `typeof` is the was-it-written test; the old `||` chain got both wrong. */
  const baseline = typeof a.starting_amount === 'number' ? a.starting_amount
    : typeof a.total_invested === 'number' ? a.total_invested : null;
  if (baseline !== null) {
    return {
      basis: 'stated',
      opening: baseline,
      contributions: 0,
      growth: balance - baseline,
      withdrawals: 0,
      closing: balance,
      count: 0,
      growthCategories: [],
    };
  }
  return {
    basis: 'none', opening: balance, contributions: 0, growth: 0,
    withdrawals: 0, closing: balance, count: 0, growthCategories: [],
  };
}

/* ADR-0007 · Total return works backwards from the balance — growth =
   balance − starting_amount − contributions + withdrawals — and reports its
   own trust, because a late-starting history overstates growth silently. */

const HISTORY_GAP_DAYS = 45;
const MS_PER_DAY = 86400000;
const DAYS_PER_YEAR = 365.2425;   // Gregorian mean, so leap years do not drift the rate

function daysBetween(fromIso, toIso) {
  if (!ISO_DATE.test(fromIso || '') || !ISO_DATE.test(toIso || '')) return null;
  const a = new Date(`${fromIso}T00:00:00`), b = new Date(`${toIso}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/* ADR-0007 · Month keys come from real dates only. '2025-13-05' used to
   vanish from the chart (64/4000 fuzzed vaults); '' routes it to UNDATABLE. */
const monthOf = iso => (isRealIsoDate(iso) ? String(iso).slice(0, 7) : '');

function nextMonth(m) {
  let y = +m.slice(0, 4), mo = +m.slice(5, 7) + 1;
  if (mo > 12) { mo = 1; y++; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/* ADR-0007 · Total return: basis 'measured' | 'stated' | 'none'; trust 'ok' |
   'history-gap' (first row > HISTORY_GAP_DAYS after inception) |
   'pre-inception' | 'none'. */
function totalReturn(account, rows, typeOf, opts) {
  const a = account || {};
  const today = (opts && opts.today) || todayIso();
  const balance = typeof a.balance === 'number' ? a.balance : 0;

  /* ADR-0007 · Capital sums are windowed from inception; the first-row test is
     not. Unwindowed sums counted pre-inception contributions twice (a fund
     that earned R200 reported R0); `all` must see the whole record. */
  const all = splitFlows(rows, typeOf);
  const from = ISO_DATE.test(a.inception_date || '') ? a.inception_date : '';
  const f = from ? splitFlows(rows, typeOf, { from }) : all;

  /* fmNum writes null for an absent key and a number for a written one, so a
     deliberate `starting_amount: 0` — an account opened empty and funded by
     transfer — is a real baseline and must not fall through to 'none'. */
  const hasBaseline = typeof a.starting_amount === 'number';
  /* ADR-0007 · Stated baseline: a written `total_invested: 0` is real; the
     same `typeof` rule accountFlows applies, from which this had drifted. */
  const stated = !hasBaseline && !f.count && typeof a.total_invested === 'number';

  let basis, baseline, capitalIn, postedGrowth;
  if (hasBaseline) {
    basis = 'measured';
    baseline = a.starting_amount;
    capitalIn = baseline + f.contributions - f.withdrawals;
    postedGrowth = f.growth;
  } else if (stated) {
    basis = 'stated';
    baseline = a.total_invested;
    capitalIn = baseline;
    postedGrowth = 0;
  } else {
    return {
      basis: 'none', trust: 'none', baseline: null, capitalIn: null, growth: null,
      postedGrowth: 0, undatedGrowth: 0, returnPct: null, annualisedPct: null,
      years: null, since: null, gapDays: null, balance,
      contributions: f.contributions, withdrawals: f.withdrawals,
      growthCategories: f.growthCategories, count: f.count,
    };
  }

  const growth = balance - capitalIn;

  /* Growth that no row carries a date for. The chart cannot draw a curve
     through it — see growthSeries — and the card must not imply it arrived
     evenly, so it is reported as its own figure rather than folded in. */
  const undatedGrowth = growth - postedGrowth;

  /* Return ON CAPITAL, and only where capital is positive. An account that has
     had more taken out of it than was ever put in has a negative or zero
     denominator, and a percentage against that is arithmetic noise, not a
     return. */
  const returnPct = capitalIn > 0 ? (growth / capitalIn) * 100 : null;

  const since = ISO_DATE.test(a.inception_date || '') ? a.inception_date : f.first;
  const days = since ? daysBetween(since, today) : null;
  const years = days !== null && days > 0 ? days / DAYS_PER_YEAR : null;

  /* ADR-0007 · Annualised return is approximate (not money-weighted) and
     withheld under a year ("+180% a year" otherwise). */
  const annualisedPct = years !== null && years >= 1 && capitalIn > 0 && balance > 0
    ? (Math.pow(balance / capitalIn, 1 / years) - 1) * 100
    : null;

  /* The gap is measured against the account's OWN opening date, so an account
     with no `inception_date` never reports one — there is nothing to be short
     of. An account that opened long ago and holds no transactions at all is the
     same failure as one whose history starts late, and gets the same flag. */
  let trust = 'ok', gapDays = null;
  if (ISO_DATE.test(a.inception_date || '')) {
    /* Against the UNWINDOWED first row: the question is when the record
       begins, and the window above deliberately hides everything before
       inception, so asking `f` would always answer "on or after inception"
       and the gap could never be seen. */
    const g = daysBetween(a.inception_date, all.first || today);
    if (g !== null && g > HISTORY_GAP_DAYS) { trust = 'history-gap'; gapDays = g; }
    /* ADR-0007 · Records before the opening date are named, not swallowed. Gated
       on all.first being real: with no rows `g` is measured from today, not a row. */
    else if (all.first !== null && g !== null && g < 0) { trust = 'pre-inception'; gapDays = g; }
  }

  return {
    basis, trust, baseline, capitalIn, growth, postedGrowth, undatedGrowth,
    returnPct, annualisedPct, years, since, gapDays, balance,
    contributions: f.contributions, withdrawals: f.withdrawals,
    growthCategories: f.growthCategories, count: f.count,
  };
}

/* One account's rows folded into monthly buckets, by the SAME rule splitFlows
   uses. `capital` is money the household moved (contributions less
   withdrawals, so a withdrawal month is negative); `posted` is growth the
   account actually wrote down. */
/* ADR-0007 · Undatable rows keep a bucket, or the total holds money the
   bands never show. */
const UNDATABLE = '';

function monthlyFlows(rows, typeOf, opts) {
  const from = (opts && opts.from) || '';
  const to = (opts && opts.to) || '';
  const out = new Map();
  for (const r of rows || []) {
    const kind = classifyRow(r, typeOf);
    if (!kind) continue;
    /* ADR-0007 · monthlyFlows windows exactly as splitFlows does; a non-ISO date
       cell once put R200 in the bands the total had already called undated. */
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    const m = monthOf(r.date);          // '' when the date is not a real ISO date
    if (!out.has(m)) out.set(m, { capital: 0, posted: 0 });
    const b = out.get(m);
    if (kind === 'growth') b.posted += r.amount;
    else b.capital += r.amount;          // withdrawals are already negative
  }
  return out;
}

/* ADR-0007 · The growth chart carries only dated money, and closing =
   capital + posted + undated = Σ balances of included accounts. `entries` is
   [{ account, rows }]; an unmeasurable account is excluded and COUNTED. */
/* ADR-0007 · chartable: measured basis AND a placeable month, and the tile counts the same set. Exported so
   the Growth tile counts the SAME set the chart draws. */
function chartable(account, r) {
  const at = monthOf((account || {}).inception_date) || monthOf(r.since);
  return r.basis === 'measured' && !!at;
}

/* ADR-0007 · growthTotals is the one pool aggregate (2026-08-29 audit, M4);
   drawn-down accounts (capitalIn <= 0) stay in `growth` but leave the rate
   as `negCapital`, counted so a caller can disclose them. */
function growthTotals(entries, typeOf, opts) {
  let growth = 0, rateGrowth = 0, rateCapital = 0, measured = 0, unmeasured = 0, negCapital = 0;
  for (const e of entries) {
    const r = totalReturn(e.account, e.rows, typeOf, opts);
    if (!chartable(e.account, r)) { unmeasured++; continue; }
    measured++;
    growth += r.growth;
    if (r.capitalIn > 0) { rateGrowth += r.growth; rateCapital += r.capitalIn; }
    else negCapital++;
  }
  return { growth, rateGrowth, rateCapital, measured, unmeasured, negCapital, total: measured + unmeasured };
}

function growthSeries(entries, typeOf, opts) {
  const today = (opts && opts.today) || todayIso();
  const maxMonths = (opts && opts.maxMonths) || 60;

  const deltas = new Map();
  let firstMonth = '', undated = 0, included = 0, excluded = 0, closing = 0;

  /* Money that counts toward the total but carries no placeable date. Held
     here and folded into the first point once that point is known — the same
     treatment truncation already gives the months it drops, and for the same
     reason: the curve starting partway up is honest, money missing from it is
     not. Dropping these was one of the two ways the identity could fail. */
  const pending = { capital: 0, posted: 0 };

  const bump = (m, key, amt) => {
    if (!amt) return;
    if (!m) { pending[key] += amt; return; }
    if (!deltas.has(m)) deltas.set(m, { capital: 0, posted: 0 });
    deltas.get(m)[key] += amt;
    if (!firstMonth || m < firstMonth) firstMonth = m;
  };

  for (const e of entries || []) {
    const a = (e && e.account) || {};
    const rows = (e && e.rows) || [];
    const r = totalReturn(a, rows, typeOf, { today });
    /* 'stated' accounts are excluded too: they have no transactions at all, so
       every figure they carry is undated and they would contribute a flat step
       from a date nobody wrote down. */
    /* The opening capital sits AT the opening date. Where there is no
       inception_date it sits at the first month the account did anything,
       which is the earliest point the vault can honestly place it. */
    const at = monthOf(a.inception_date) || monthOf(r.since);
    /* ADR-0007 · An account that can be placed nowhere is excluded, not
       half-included — test `at` via chartable, never the baseline's truthiness
       (a `starting_amount: 0` account once broke closing = Σ balances). */
    if (!chartable(a, r)) { excluded++; continue; }
    included++;
    closing += r.balance;
    bump(at, 'capital', r.baseline);
    /* Windowed exactly as totalReturn windows its capital sum — see the note
       in monthlyFlows. The baseline already contains everything before the
       opening date, so counting those rows again in the bands would draw money
       the total does not have. */
    const from = ISO_DATE.test(a.inception_date || '') ? a.inception_date : '';
    for (const [m, b] of monthlyFlows(rows, typeOf, from ? { from } : undefined)) {
      bump(m, 'capital', b.capital);
      bump(m, 'posted', b.posted);
    }
    undated += r.undatedGrowth;
  }

  if (!firstMonth) {
    return { points: [], undated: 0, closing: 0, included, excluded, truncatedFrom: '' };
  }

  /* Everything that could not be dated joins the first point. */
  if (pending.capital || pending.posted) {
    const d = deltas.get(firstMonth);
    d.capital += pending.capital;
    d.posted += pending.posted;
  }

  /* ADR-0007 · The month walk reaches the last month anything happened in; a
     future-dated row is otherwise counted but never accumulated. */
  let lastMonth = monthOf(today) || firstMonth;
  for (const m of deltas.keys()) if (m > lastMonth) lastMonth = m;
  const months = [];
  for (let m = firstMonth; m <= lastMonth; m = nextMonth(m)) months.push(m);
  if (!months.length) months.push(firstMonth);

  /* Truncation folds the dropped months' totals INTO the first point kept,
     rather than discarding them — the curve then starts partway up, which is
     honest, instead of starting at zero and understating everything after it.
     The month it starts from is returned so the caller can say so. */
  let truncatedFrom = '';
  let kept = months;
  if (months.length > maxMonths) {
    truncatedFrom = months[months.length - maxMonths];
    kept = months.slice(-maxMonths);
  }

  let capital = 0, posted = 0;
  const points = [];
  for (const m of months) {
    const d = deltas.get(m);
    if (d) { capital += d.capital; posted += d.posted; }
    if (m >= kept[0]) points.push({ month: m, capital, posted });
  }

  return { points, undated, closing, included, excluded, truncatedFrom };
}


/* ADR-0007 · Money cannot arrive before it leaves: a DIRECTION, not a window
   (a window re-opens the 66 -> 76 settlement cliff tests/household-shapes
   .test.cjs pins). Backstamp covers reversed value-dating; null never matches. */
const BACKSTAMP_DAYS = 3;
function couldBeSameMovement(outIso, inIso) {
  const d = daysBetween(outIso, inIso);   // positive when the money left first
  return d !== null && d >= -BACKSTAMP_DAYS;
}

/* ADR-0007 · savedFromOutside is the one answer to "how much did you save"
   for health-data.js and views/score.js alike (R4 270 moved fund-to-fund once
   read as saving on one surface and R0 on the other). `saverLabels`: label → pool account. */
/* ADR-0007 · The outflow's category closes the mirror case, on the outflow
   side only (ISSUE 32). Optional; absent or unknown means every outflow
   stays matchable. */
function savedFromOutside(rows, saverLabels, catType) {
  let savings = 0;
  const labels = saverLabels instanceof Map ? saverLabels : new Map(saverLabels || []);
  const householdRows = rows || [];
/* ADR-0007 · The category is consulted only where the dates have run out
   (ISSUE 32): inside the backstamp window equal-and-opposite rows pair
   whatever they are called — tests/health-data.test.cjs pins `Move`. */
const { INTERNAL_LEG_TYPES } = require('./vocabulary');
const looksLikeSpending = r => {
  if (typeof catType !== 'function') return false;  // unchanged for every caller that has not been taught
  const t = catType(r.cat);
  /* An unknown category stays matchable: a row under a name no category file
     answers to has told us nothing, and reading that as "definitely a
     purchase" is the same unprovable-is-not-disproved error one direction
     over. */
  return !!t && !INTERNAL_LEG_TYPES.has(t);
};
const couldBeAnInternalLeg = (outRow, inRow) => {
  const gap = daysBetween(outRow.date, inRow.date);   // positive when the money left first
  if (gap === null || gap <= BACKSTAMP_DAYS) return true;
  return !looksLikeSpending(outRow);
};
const inflows = [], outflows = [];
{
  for (const r of householdRows) {
    if (!r || typeof r.amount !== 'number' || !r.amount) { continue; }
    if (supersededBySplit(r)) { continue; }   // its parts are in this same list
    const a = labels.get(r.label);
    if (!a) { continue; }                     // not a savings or investment account
    /* ADR-0007 · Nothing is skipped on the strength of a row's own flags; the
       pool boundary is the only test (the R40 000 UIF is in the income base,
       so it is in the saving too). */
    (r.amount > 0 ? inflows : outflows).push({ acct: a, row: r });
  }
}
const spent = new Set();
for (const { acct, row } of inflows) {
  /* ADR-0007 · Saving is what crossed into the pool from outside it — not
     gross inflow (1.23.0, +R1 250 a month) and not net of every outflow
     (1.23.1, a sinking fund read as dis-saving). Rows read directly. */
  /* ADR-0007 · The other leg is the only test, and the dates are consulted:
     equal and opposite, a DIFFERENT pool account, one cancel per outflow,
     couldBeAnInternalLeg and couldBeSameMovement (the 1 Aug / 28 Aug pram). */
  const j = outflows.findIndex((o, i) => !spent.has(i)
    && o.acct !== acct
    && couldBeAnInternalLeg(o.row, row)
    && Math.abs(-o.row.amount - row.amount) < 0.005
    && couldBeSameMovement(o.row.date, row.date));
  if (j !== -1) { spent.add(j); continue; }

  savings += row.amount;
}
  return savings;
}

/* The pool's growth rate, as a percentage of the capital it was measured on,
   or null when nothing rated was put in. One owner (Phase 3 of ADR-0006):
   views/savings.js and report.js each divided the two figures growthTotals()
   hands back. */
function growthRate(g) {
  const cap = Number(g && g.rateCapital) || 0;
  return cap > 0 ? ((Number(g.rateGrowth) || 0) / cap) * 100 : null;
}

module.exports = { splitFlows, savedFromOutside, accountFlows, totalReturn, growthTotals, growthSeries, classifyRow, chartable, poolCatType, growthRate };
