'use strict';
/* Period figures: the one snapshot the period pages read. Phase 3 of ADR-0006.

   The Dashboard, the Budget page, the Report page and the report serialiser
   all print the same period: its summary, its budget, the budget-vs-actual
   rows, the category split and the gap between the split and gross spend.
   On 1.38.0 the rows and the split were built in views/dashboard.js and
   published from there, and the arithmetic ON them — "remaining", the
   "unbudgeted" flag, the donut's gap into uncategorised and netted parts —
   was written three times and had already drifted once (the Dashboard's
   `unbudgeted` excluded assume-spent rows; the serialiser's did not).

   This module owns that. Views render what periodFigures(p) hands them and
   compute nothing about the period themselves; tests/period-figures.test.cjs
   forbids the old arithmetic anywhere outside the owners. The pure row rule
   lives in money-flow.js (budgetRowStatus) so the serialiser, which has no
   ctx, reads the same one. */

const { typeOrder, typeRank } = require('./groups');
const { reconcile, stalenessSummary } = require('./reconcile');
const { isForeign, symbolOf } = require('./currency');
const { assumedActual, budgetRowStatus, categoryGap: gapOf } = require('./money-flow');

module.exports = function registerFigures(ctx) {
  const { S, periodSummary, budgetTotals, budgetUsed, periodSpend, periodRange, catType, catAssumeSpent, budgetRowType, accountIndex } = ctx;

  /* Budget vs actual, one row per category that is either budgeted or
     spent, the type read live (budgetRowType), and an assume-spent row's
     Actual through assumedActual() — the rule the Budget page's own Actual
     column reads. Every row carries its status (budgetRowStatus) so no page
     recomputes "remaining" or "unbudgeted". */
  function budgetVsActualRows(p) {
    const sum = periodSummary(p);
    const budget = S.budgets[p] || [];
    const rows = new Map();
    for (const b of budget) {
      const type = budgetRowType(b);
      const assumed = type !== 'income' && type !== 'transfer' && catAssumeSpent(b.category);
      rows.set(b.category, { budget: b.amount, type, actual: assumed ? assumedActual(b.amount, 0) : 0, notes: b.notes, assumed });
    }
    for (const [cat, amt] of Object.entries(sum.byCat)) {
      if (!cat) continue;
      const type = catType(cat);
      if (type === 'transfer') continue;
      const existing = rows.get(cat);
      if (existing && existing.assumed) {
        existing.actual = assumedActual(existing.budget, -amt);
        continue;
      }
      /* A category with no file and no budget row is the uncategorised /
         unknown bucket the summary already discloses; it is not a table row. */
      if (type === null && !existing) continue;
      const r = existing || rows.set(cat, { budget: 0, type: type || 'expense', actual: 0, notes: '' }).get(cat);
      const signType = type === null ? r.type : type;
      r.actual += signType === 'income' ? amt : -amt;
    }
    const order = typeOrder(S.settings.groups);
    return [...rows.entries()]
      .sort((a, b) => typeRank(a[1].type, order) - typeRank(b[1].type, order) || a[0].localeCompare(b[0]))
      .map(([cat, r]) => ({ cat, ...r, ...budgetRowStatus(r) }));
  }

  /* The category split: named, non-income, non-transfer categories whose net
     for the period is an outflow, largest first. The donut and the Report's
     spend-by-category table. */
  function categorySpendRows(p) {
    const sum = periodSummary(p);
    const spend = [];
    for (const [cat, amt] of Object.entries(sum.byCat)) {
      const type = catType(cat);
      if (!cat || type === 'income' || type === 'transfer') continue;
      if (amt >= 0) continue;
      spend.push({ cat, amount: -amt });
    }
    spend.sort((a, b) => b.amount - a.amount);
    return spend;
  }

  /* What the split leaves out of gross spend, decomposed: uncategorised
     outgoings and refunds netted inside named categories. The identity
     tests/cross-page-consistency.test.cjs pins, computed once. */
  function categoryGap(p) {
    const sum = periodSummary(p);
    const rows = categorySpendRows(p);
    return gapOf({ spend: sum.spend, uncatSpend: sum.uncatSpend, rows });
  }

  /* The snapshot. Everything a period page prints about the period, built
     once per call, with its caveats riding along. */
  function periodFigures(p) {
    const summary = periodSummary(p);
    const budget = budgetTotals(p);
    return {
      period: p,
      range: periodRange(p),
      summary,
      budget,
      used: budgetUsed(p),
      trend: periodSpend(p, null),
      rows: budgetVsActualRows(p),
      split: categorySpendRows(p),
      gap: categoryGap(p),
      scheduled: summary.scheduled || { income: 0, spend: 0, count: 0, from: null },
      fundedFromSavings: summary.fundedFromSavings || { spend: 0, count: 0 },
      foreign: summary.foreign,
      uncountedIncome: (summary.uncatIncome || 0) + ((summary.unknown && summary.unknown.income) || 0),
    };
  }

  /* The book: every account reconciled ONCE, and the figures the Dashboard's
     cards derive from that pass. On 1.38.0 the Dashboard ran reconcile() over
     every account three times in one render (the what's-left card, the drift
     note and net worth), each with its own filter. */
  function bookFigures() {
    const cur = S.settings.currency;
    const idx = accountIndex();
    const reconciled = new Map();
    const unplacedBy = new Map();
    const confirmDayBy = new Map();
    let drift = 0, driftForeign = 0, driftUnplaced = 0;
    for (const a of S.accounts) {
      const rec = reconcile(a, (idx.get(a) || {}).rows || []);
      reconciled.set(a, rec);
      const foreign = isForeign(a, cur);
      const sym = symbolOf(a, cur);
      /* The what's-left card's disclosures: in-budget accounts only. */
      if (rec.unreadable && a.in_budget !== false) unplacedBy.set(sym, (unplacedBy.get(sym) || 0) + rec.unreadable);
      if (rec.sameDay && rec.sameDay.count && a.in_budget !== false) {
        const at = confirmDayBy.get(sym) || { count: 0, net: 0 };
        confirmDayBy.set(sym, { count: at.count + rec.sameDay.count, net: at.net + rec.sameDay.net });
      }
      /* The drift note's: household currency only, unreadable rows counted
         on every verdict (an all-undatable account comes back 'clean'). */
      if (!foreign) driftUnplaced += rec.unreadable || 0;
      if (rec.state === 'drift') { if (foreign) driftForeign++; else drift += rec.delta; }
    }
    return {
      reconciled, unplacedBy, confirmDayBy,
      drift: { drift, driftForeign, driftUnplaced },
      stale: stalenessSummary(S.accounts),
      overdrawn: S.accounts.filter(a => (a.balance || 0) < 0).length,
    };
  }

  ctx.provide({ budgetVsActualRows, categorySpendRows, categoryGap, periodFigures, bookFigures });
};
