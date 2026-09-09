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
const { isForeign, symbolOf, splitByCurrency } = require('./currency');
const { assumedActual, budgetRowStatus, categoryGap: gapOf, incomeBaseFor, allocatedShare } = require('./money-flow');
const { accountType } = require('./vocabulary');
const { netByOwner } = require('./owners');
const { normalizeAmount } = require('./amount');

module.exports = function registerFigures(ctx) {
  const { S, periodSummary, budgetTotals, budgetTotalsOf, budgetUsed, periodSpend, periodRange, catType, catAssumeSpent, budgetRowType, accountIndex, impliedAccounts, currentPeriod } = ctx;

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

  /* The plan: what this period's budget file promises, and how it measures
     against income. The RULES are money-flow.js's (incomeBaseFor,
     allocatedShare); what lives here is the one assembly of their operands.
     On 1.41.1 the Dashboard hero, the Budget page's totals strip and the
     Report each gathered these themselves, and the strip carried a comment
     admitting it mirrored the hero's denominator logic by hand.

     `rows` is the Budget page's: its strip moves with the unsaved draft, so
     it hands the draft in the way budgetUsed(p, { rows }) already takes it.
     Every other reader takes the saved file.

       total        the WHOLE plan — spend and set-aside envelopes, a rand
                    into the emergency fund being as allocated as a rand of
                    groceries (ISSUE 40)
       hasIncomeRow a row that came from the file or was deliberately touched
                    (inFile), never a zero row the draft seeded for a category
                    nobody has budgeted
       incomeBase   the plan's own income; a finished period's actual income
                    stands in when the plan names none (ISSUE 73: finished
                    means BEFORE today's period, a future one has not)
       allocated    total / incomeBase, null with nothing honest to divide by
       baseDiffers  the base is not the income that arrived — the hero names
                    which one it divided by only then (ISSUE 36)
       unallocated  income − total when the plan states an income row, the
                    settled actual income − total once the period is
                    finished, and null mid-period with no income row: a
                    part-period income is not a base to budget against */
  function planFigures(p, opts) {
    const rows = (opts && opts.rows) || S.budgets[p] || [];
    const totals = budgetTotalsOf(rows);
    const total = totals.spend + totals.setAside;
    const hasIncomeRow = rows.some(r => budgetRowType(r) === 'income' && r.inFile !== false);
    const actualIncome = periodSummary(p).income;
    const periodFinished = p < currentPeriod();
    const args = { budgetIncome: totals.income, actualIncome, periodFinished };
    const incomeBase = incomeBaseFor(args);
    const allocated = allocatedShare({ budgeted: total, ...args });
    const baseDiffers = allocated !== null && Math.round((incomeBase - actualIncome) * 100) !== 0;
    const unallocated = (hasIncomeRow || totals.income > 0) ? totals.income - total
      : (periodFinished ? actualIncome - total : null);
    return { total, spend: totals.spend, setAside: totals.setAside, income: totals.income, hasIncomeRow,
      actualIncome, periodFinished, incomeBase, allocated, baseDiffers, unallocated };
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
      plan: planFigures(p),
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
      balances: balanceBook(),
    };
  }

  /* The balance book: the household's accounts summed ONCE on each of the
     two bases a page may print, with the difference between them named.

     `stated` is the balance: line of each account file — a claim with an
     age. `implied` is that claim rolled forward by the rows dated after it
     (impliedAccounts, one as-of across the app — ISSUE 44). On 1.41.1 the
     Savings KPIs and the Accounts page summed the first and the Dashboard
     tile, the Savings chart, the Score and the Report summed the second, each
     in its own loop; on the vault this was built against the Savings page
     printed R 674 463,50 invested above a chart segment reading
     R 691 357,55, and nothing on that page said the R 16 894,05 between
     them was rows nobody had confirmed yet. Both bases live here so a page
     that prints one is handed the other, and the drift, with it.

     Home currency only, the way every total in this app is (currency.js);
     the foreign accounts are `others`, named beside the book and never
     summed into it. An unreadable balance — "about 300" — is held out of
     BOTH bases, matching the Accounts hero's own rule: a figure that cannot
     be read cannot be added. Types are case-folded through accountType();
     owners through netByOwner(), the Accounts page's own rule. */
  function balanceBook() {
    const cur = S.settings.currency;
    const readable = a => !(a.balanceRaw != null && normalizeAmount(a.balanceRaw) === null);
    const declared = Array.isArray(S.settings.owners) ? S.settings.owners : [];
    const summarise = (accounts, all) => {
      const byType = {};
      let positive = 0, negative = 0;
      for (const a of accounts) {
        const bal = Number(a.balance) || 0;
        const t = accountType(a) || 'other';
        byType[t] = (byType[t] || 0) + bal;
        if (bal > 0) positive += bal; else negative -= bal;
      }
      for (const t of Object.keys(byType)) byType[t] = Math.round(byType[t] * 100) / 100 || 0;
      return {
        accounts, byType, byOwner: netByOwner(accounts, declared),
        /* The foreign accounts on the same base, named (pairs of symbol and
           total) and listed, for the disclosures a page prints beside a
           home-currency figure — never summed into it. */
        others: splitByCurrency(all, cur).others,
        foreignAccounts: all.filter(a => isForeign(a, cur)),
        positive: Math.round(positive * 100) / 100 || 0,
        negative: Math.round(negative * 100) / 100 || 0,
        net: Math.round((positive - negative) * 100) / 100 || 0,
      };
    };
    const statedAll = S.accounts.filter(readable);
    const impliedAll = impliedAccounts().filter(readable);
    const stated = summarise(splitByCurrency(statedAll, cur).primary, statedAll);
    const implied = summarise(splitByCurrency(impliedAll, cur).primary, impliedAll);
    const driftByType = {};
    for (const t of new Set([...Object.keys(stated.byType), ...Object.keys(implied.byType)])) {
      const d = Math.round(((implied.byType[t] || 0) - (stated.byType[t] || 0)) * 100) / 100;
      if (d) driftByType[t] = d;
    }
    return {
      stated, implied,
      drift: Math.round((implied.net - stated.net) * 100) / 100 || 0,
      driftByType,
      others: stated.others,
    };
  }

  ctx.provide({ budgetVsActualRows, categorySpendRows, categoryGap, planFigures, periodFigures, bookFigures });
};
