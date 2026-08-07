'use strict';
/* Net worth — what is owned, what is owed, and where each figure came from.

   This exists because "owed" has two homes in this vault and used to have two
   different answers depending on which part of the Savings page you read. An
   account with a negative balance is a liability (a card, an overdrawn cheque
   account). So is a row on the Debt page. The KPI tile counted only the first,
   the chart beneath it counted only the first, and the subtitle disclosed the
   omission as a phrase — which is not a disclosure when the omitted item is a
   home loan and the number it qualifies is the headline of the page.

   One definition, used by the tiles and the chart, so they cannot drift apart
   again. Pure — no DOM, no obsidian import — so tests/worth.test.cjs runs it in
   bare node. */

/* Only `active` debts count. A debt marked paid is history; leaving it in
   reports a bond as still owed years after it was settled. */
function activeDebts(debts) {
  return (debts || []).filter(d => d && d.status !== 'paid');
}

/* Assets are positive account balances; liabilities are negative account
   balances PLUS every active debt-page balance.

   Split by SIGN rather than by type, matching the chart: a cheque account in
   overdraft is a liability however it is labelled, and a credit card in credit
   is an asset. Returned as positive magnitudes — callers negate for display. */
function worth(accounts, debts) {
  const list = accounts || [];
  const assets = list.reduce((t, a) => t + Math.max(0, a.balance || 0), 0);
  // `|| 0` collapses -0, which negating a sum of zero produces. Left alone it
  // reaches money() and renders a debt-free vault's liabilities as "-R0.00".
  const fromAccounts = -list.reduce((t, a) => t + Math.min(0, a.balance || 0), 0) || 0;
  const active = activeDebts(debts);
  // A negative balance on the Debt page would mean the lender owes YOU, which
  // is an Owed Money row, not a debt. Ignored rather than credited against the
  // total, where it would quietly reduce a real liability.
  const fromDebts = active.reduce((t, d) => t + Math.max(0, d.balance || 0), 0);
  const liabilities = fromAccounts + fromDebts;
  return { assets, liabilities, fromAccounts, fromDebts, net: assets - liabilities, active };
}

/* A credit card can honestly be tracked as an account OR as a debt-page row,
   and nothing stops someone doing both — at which point net worth counts it
   twice.

   This deliberately does NOT guess or dedupe. Names are free text, and
   "Discovery" on an account file need not match "Discovery Bank" on a debt row,
   so any matching rule would be wrong on real data in both directions. It
   reports that the overlap is POSSIBLE and lets the reader look. Silently
   picking one ledger would be the worse failure: it hides money either way, and
   without saying so. */
function cardOverlap(accounts, debts) {
  const cardAccounts = (accounts || []).filter(a => a.type === 'credit_card' && (a.balance || 0) < 0);
  const cardDebts = activeDebts(debts).filter(d => /credit\s*card/i.test(d.type || ''));
  return cardAccounts.length && cardDebts.length
    ? { cardAccounts: cardAccounts.length, cardDebts: cardDebts.length }
    : null;
}

/* Debt-page rows grouped by their own type, largest first, so a bond and a car
   loan are tellable apart in the chart rather than merged into one anonymous
   block. Zero and negative balances are dropped — a segment of no width is
   noise in the legend. */
function debtsByType(debts) {
  const byType = new Map();
  for (const d of activeDebts(debts)) {
    if (!(d.balance > 0)) continue;
    const k = (d.type || '').trim() || 'other';
    byType.set(k, (byType.get(k) || 0) + d.balance);
  }
  return [...byType].sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount }));
}

module.exports = { worth, activeDebts, cardOverlap, debtsByType };
