'use strict';
/* Net worth — what is owned, what is owed, and where each figure came from.

   "Owed" has two homes in this vault (a negative account balance and a
   Debt-page row) and the Savings tiles and chart once counted only the
   first, disclosing the omission as a phrase. One definition, used by the
   tiles and the chart, so they cannot drift apart again (ADR-0007 ·
   worth.js — purpose). Pure — no DOM, no obsidian import — so
   tests/worth.test.cjs runs it in bare node. */

/* committed.js owns what counts as a credit card. A strict `===` here read a
   hand-typed `Credit_Card` as not-a-card while the committed chain trimmed and
   case-folded — the same account, a card to one page and not the other. */
const { isCreditCard } = require('./committed');
const { accountType } = require('./vocabulary');
const { currenciesIn, isForeign, symbolOf } = require('./currency');
/* ADR-0007 · Net worth reads outstanding from owed-math: a part-recovered
   loan (R2 000 lent, R500 back) is R1 500, subtracted in one place. */
const { outstandingOf, isSettled } = require('./owed-math');

/* Only `active` debts count. A debt marked paid is history; leaving it in
   reports a bond as still owed years after it was settled. */
function activeDebts(debts) {
  return (debts || []).filter(d => d && d.status !== 'paid');
}

/* What the Assets page is worth. A negative value is ignored rather than
   subtracted, for the same reason a negative debt-page balance is: a
   possession cannot be worth less than nothing, so the figure is a typo, and
   quietly netting it off a real total hides the error instead of leaving it
   somewhere the reader can see it. */
function assetTotal(assets, household) {
  return (assets || [])
    /* ISSUE 30. Assets can state a currency now (ADR-0003 append). One that
       does not is household money, which is what every asset already on disk
       says by saying nothing — so `household` being absent means "add them
       all", exactly as this function always behaved, and every caller that
       has not been taught about currencies is unchanged. */
    .filter(a => !household || !isForeign(a, household))
    .reduce((t, a) => t + Math.max(0, a.value || 0), 0);
}

/* ADR-0007 · Receivables are the third owned ledger (ISSUE 39): R2 000 lent
   to Thabo was missing from a R120 000 net worth. Settled rows are history,
   foreign rows are named not converted, absent `household` adds them all. */
function owedTotal(owed, household) {
  return (owed || [])
    .filter(o => o && !isSettled(o) && (!household || !isForeign(o, household)))
    .reduce((t, o) => t + outstandingOf(o), 0);
}

/* The other half of that filter, so a caller can NAME what was left out
   rather than quietly dropping it — currency.js:14 is explicit that this app
   does not exclude. Returns [symbol, total] pairs in the same shape
   splitByCurrency() uses for accounts, so a view can print both the same way. */
function foreignTotals(rows, household, valueKey) {
  const by = new Map();
  for (const r of rows || []) {
    if (!isForeign(r, household)) continue;
    const sym = symbolOf(r, household);
    by.set(sym, (by.get(sym) || 0) + Math.max(0, Number(r[valueKey]) || 0));
  }
  return [...by].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]);
}

/* ADR-0007 · Net worth splits accounts by sign, keeps the ledgers separable,
   and a house here plus its bond on the Debt page is not a double count.
   `currencies` names the household first and walks accounts only. */
function worth(accounts, debts, assets, household, owed) {
  const list = accounts || [];
  const ownedAccounts = list.reduce((t, a) => t + Math.max(0, a.balance || 0), 0);
  const ownedAssets = assetTotal(assets, household);
  /* ISSUE 39. Optional and LAST, so every existing three- and four-argument
     caller is unchanged: absent means "this surface is not about receivables",
     which is the honest reading for views/accounts.js's hero (bank money only)
     and the wrong one for anything that prints the words "net worth". */
  const ownedOwed = owedTotal(owed, household);
  const owned = ownedAccounts + ownedAssets + ownedOwed;
  // `|| 0` collapses -0, which negating a sum of zero produces. Left alone it
  // reaches money() and renders a debt-free vault's liabilities as "-R0.00".
  const fromAccounts = -list.reduce((t, a) => t + Math.min(0, a.balance || 0), 0) || 0;
  const active = activeDebts(debts);
  // A negative balance on the Debt page would mean the lender owes YOU, which
  // is an Owed Money row, not a debt. Ignored rather than credited against the
  // total, where it would quietly reduce a real liability.
  /* Foreign debts held out for the same reason foreign assets are: a euro
     mortgage added into a rand liability is a wrong number, and there is no
     rate here to convert it with. Named below via `otherCurrencies` so no
     caller can drop it silently. */
  const fromDebts = active
    .filter(d => !household || !isForeign(d, household))
    .reduce((t, d) => t + Math.max(0, d.balance || 0), 0);
  const liabilities = fromAccounts + fromDebts;
  /* ADR-0007 · Net rounded to the cent, then `|| 0`: a break-even household
     leaves -7.1e-15 and read raw renders "-R0.00" and reports short. */
  const net = (Math.round((owned - liabilities) * 100) / 100) || 0;
  return {
    assets: owned, ownedAccounts, ownedAssets, ownedOwed,
    liabilities, fromAccounts, fromDebts,
    net, active,
    currencies: currenciesIn(list, household),
    /* Everything this total could NOT include, per ledger and per symbol.
       Accounts are already split by the caller (splitByCurrency) before they
       reach here; these two are the ledgers worth() reads directly. */
    otherCurrencies: {
      assets: foreignTotals(assets, household, 'value'),
      debts: foreignTotals(active, household, 'balance'),
      /* Keyed on `outstanding` rather than `amount` — the same figure the
         home-currency side counts, so the total and the sentence naming what
         is missing from it are one subtraction, not two. Unsettled rows only,
         matching owedTotal: a foreign loan the reader marked paid is history
         in every currency, and the Owed page's own pill says so. */
      owed: foreignTotals(
        (owed || []).filter(o => o && !isSettled(o)).map(o => ({ ...o, outstanding: outstandingOf(o) })),
        household, 'outstanding'),
    },
  };
}

/* ADR-0007 · Card overlap is reported, not deduped: names are free text, so
   any matching rule would be wrong on real data in both directions. */
function cardOverlap(accounts, debts) {
  const cardAccounts = (accounts || []).filter(a => isCreditCard(a) && (a.balance || 0) < 0);
  const cardDebts = activeDebts(debts).filter(d => /credit\s*card/i.test(d.type || ''));
  return cardAccounts.length && cardDebts.length
    ? { cardAccounts: cardAccounts.length, cardDebts: cardDebts.length }
    : null;
}

/* ADR-0007 · Grouped by type, largest first. Zero and negative values dropped.
   One function so debtsByType and assetsByType cannot drift. */
function groupedByType(rows, valueOf) {
  const byType = new Map();
  for (const r of rows || []) {
    const v = valueOf(r);
    if (!(v > 0)) continue;
    const k = (r.type || '').trim() || 'other';
    byType.set(k, (byType.get(k) || 0) + v);
  }
  return [...byType].sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount }));
}

/* ADR-0007 · Chart segments and heading from one filter: foreign rows held
   out as in worth()'s fromDebts (a two-currency vault once drew 109.5% of its
   own bar); named underneath via views/savings.js's `worthNote`. */
function debtsByType(debts, household) {
  return groupedByType(
    activeDebts(debts).filter(d => !household || !isForeign(d, household)),
    d => d.balance);
}

/* ADR-0007 · Account groups carry unlisted types under their own name, known
   types first in the caller's order: an unlisted R80 000 account once read
   R740 000 in the tile and R660 000 in the chart on one screen. */
function accountGroups(accounts, knownTypes) {
  const known = knownTypes || [];
  const order = new Map(known.map((t, i) => [t, i]));
  const owned = new Map(), owed = new Map();
  for (const a of accounts || []) {
    /* ADR-0007 · Account type case-folded in the chart: the last raw reading
       of `type`, and the one that decides a segment's colour. */
    const t = accountType(a) || 'other';
    const bal = (a && a.balance) || 0;
    if (bal > 0) owned.set(t, (owned.get(t) || 0) + bal);
    else if (bal < 0) owed.set(t, (owed.get(t) || 0) - bal);
  }
  /* Known types in the caller's order, then the rest largest first — an
     ordering the vault's own contents decide, so it cannot be forgotten. */
  const sort = m => [...m]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => {
      const ai = order.has(a[0]) ? order.get(a[0]) : Infinity;
      const bi = order.has(b[0]) ? order.get(b[0]) : Infinity;
      return ai !== bi ? ai - bi : b[1] - a[1];
    })
    .map(([type, amount]) => ({ type, amount, known: order.has(type) }));
  return { owned: sort(owned), owed: sort(owed) };
}

/* The same grouping for the owned side, so the house, the car and the ring are
   three named blocks in the chart rather than one anonymous "possessions"
   slab. `household` behaves exactly as it does on debtsByType above — and
   matches assetTotal()'s filter, so the segments and the figure worth() states
   for the same ledger are drawn from one rule. */
function assetsByType(assets, household) {
  return groupedByType(
    (assets || []).filter(a => !household || !isForeign(a, household)),
    a => a.value);
}

/* ADR-0007 · Other-currency net disclosure: one per-symbol net of everything
   worth() held out (a €200 000 flat and €100 000 bond once vanished unsaid);
   zero symbols dropped, -0 collapsed, stable insertion order. */
function otherCurrencyNet(w, accountOthers) {
  const by = new Map();
  const add = (pairs, sign) => {
    for (const [sym, v] of pairs || []) by.set(sym, (by.get(sym) || 0) + sign * (Number(v) || 0));
  };
  add(accountOthers, 1);
  add(w && w.otherCurrencies && w.otherCurrencies.assets, 1);
  add(w && w.otherCurrencies && w.otherCurrencies.debts, -1);
  /* ISSUE 39. Owned, so positive — and reached through the same merge as the
     other two rather than named separately, because this list qualifies ONE
     figure (a net worth) and a reader working out what is missing from it
     should not have to add three sentences together themselves. */
  add(w && w.otherCurrencies && w.otherCurrencies.owed, 1);
  return [...by]
    .map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0])
    .filter(([, v]) => v !== 0);
}

module.exports = {
  worth, activeDebts, assetTotal, owedTotal, foreignTotals, otherCurrencyNet, cardOverlap, accountGroups, debtsByType, assetsByType,
};
