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

/* committed.js owns what counts as a credit card. A strict `===` here read a
   hand-typed `Credit_Card` as not-a-card while the committed chain trimmed and
   case-folded — the same account, a card to one page and not the other. */
const { isCreditCard } = require('./committed');
const { currenciesIn, isForeign, symbolOf } = require('./currency');

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

/* Owned is positive account balances PLUS the Assets page; owed is negative
   account balances PLUS every active debt-page balance.

   Accounts split by SIGN rather than by type, matching the chart: a cheque
   account in overdraft is a liability however it is labelled, and a credit
   card in credit is an asset. Returned as positive magnitudes — callers negate
   for display.

   The three ledgers are kept separable on the way out (`ownedAccounts`,
   `ownedAssets`, `fromAccounts`, `fromDebts`) because every page that states a
   total also has to be able to say where it came from. `fromAccounts` is the
   OWED half of the account ledger and `ownedAccounts` the owned half — an
   asymmetry in the names, kept because `fromAccounts`/`fromDebts` already
   shipped and renaming them buys nothing.

   A house here and its bond on the Debt page is NOT a double count: one is
   owned and one is owed, which is exactly the arithmetic net worth is.

   `household`, if given, is the household's own currency symbol
   (S.settings.currency) — passed through to currenciesIn() so the returned
   `currencies` list names it first. Optional and defaults through to
   currenciesIn()'s own "R" fallback so every existing caller (none of which
   pass it yet) keeps working unchanged; a caller that wants the disclosure to
   actually name the household's real symbol should start passing it.

   `currencies` walks ACCOUNTS only, the same list currenciesIn() already
   covers everywhere else in the app (views/accounts.js:589 is the one other
   call site). Assets have no currency field at all — SCHEMAS.assets is
   name/type/value/valued/notes, and table-schema.js is append-only with a
   byte-golden gate, so adding one is a bigger decision than this fix; a
   R-valued house and a €20 000 account are summed together either way (as
   documented above they always have been) and this only gives a caller
   something to name the mix with. */
function worth(accounts, debts, assets, household) {
  const list = accounts || [];
  const ownedAccounts = list.reduce((t, a) => t + Math.max(0, a.balance || 0), 0);
  const ownedAssets = assetTotal(assets, household);
  const owned = ownedAccounts + ownedAssets;
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
  // Rounded to the cent, then `|| 0` collapses -0 — the same two-step
  // `fromAccounts` already applies above, extended to the difference itself.
  // A household exactly break-even (50.30 owned, 10.10 + 40.20 owed) leaves
  // a float remainder like -7.1e-15 behind; read raw, `net < 0` reports a
  // solvent household as short and renders "-R0.00". The remainder is a
  // read-off-the-sign bug, not a summing one — nothing above this line
  // changes.
  const net = (Math.round((owned - liabilities) * 100) / 100) || 0;
  return {
    assets: owned, ownedAccounts, ownedAssets,
    liabilities, fromAccounts, fromDebts,
    net, active,
    currencies: currenciesIn(list, household),
    /* Everything this total could NOT include, per ledger and per symbol.
       Accounts are already split by the caller (splitByCurrency) before they
       reach here; these two are the ledgers worth() reads directly. */
    otherCurrencies: {
      assets: foreignTotals(assets, household, 'value'),
      debts: foreignTotals(active, household, 'balance'),
    },
  };
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
  const cardAccounts = (accounts || []).filter(a => isCreditCard(a) && (a.balance || 0) < 0);
  const cardDebts = activeDebts(debts).filter(d => /credit\s*card/i.test(d.type || ''));
  return cardAccounts.length && cardDebts.length
    ? { cardAccounts: cardAccounts.length, cardDebts: cardDebts.length }
    : null;
}

/* Grouped by TYPE, largest first, so a bond and a car loan (or a house and a
   car) are tellable apart in the chart rather than merged into one anonymous
   block. Zero and negative amounts are dropped — a segment of no width is
   noise in the legend. `debtsByType` and `assetsByType` below are this same
   grouping over a different value key on a different list; kept as one
   function so the drop rule and the sort cannot drift between the two. */
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

/* Debt-page rows grouped by their own type.

   `household`, if given, holds out the rows stated in another currency —
   exactly the filter `fromDebts` inside worth() already applies, and for the
   same reason. Optional, and absent means "add everything", so a caller that
   has not been taught about currencies is unchanged rather than quietly
   altered — the same contract assetTotal() carries.

   It has to be on offer because of what these groups ARE. A chart row's
   widths are shares of ONE scale under a single heading: the Savings
   composition chart took its heading from worth() (which holds foreign rows
   out) and its segments from here (which did not), so a two-currency vault
   drew R2 300 000 of blocks under a R2 100 000 heading on a track scaled to
   R2 100 000 — 109.5% of the bar's own width, running over its neighbour —
   and sharePercents then stated each wedge against the SEGMENT sum, a
   denominator the reader was never shown. Unlike a total, a bar has nowhere
   to print a disclosure inside itself, so the held-out rows are named
   underneath instead; see views/savings.js's `worthNote`. */
function debtsByType(debts, household) {
  return groupedByType(
    activeDebts(debts).filter(d => !household || !isForeign(d, household)),
    d => d.balance);
}

/* Every account, grouped for the composition chart, split by SIGN — the known
   types first in the order given, then any type the vault actually carries that
   the caller's list does not know about.

   That second half is the whole reason this is not a filter in the view. The
   chart used to walk a fixed list of six types while `worth()` above counted
   every account by sign, so an account whose file says `type: tfsa` — or
   `type: Savings` with a capital S, which is the same bug wearing a hat — was
   inside the net-worth tile and absent from the chart beneath it. Measured: one
   R80 000 account of an unlisted type put "Net worth R740 000" in the tile and
   "Net worth R660 000" in the chart's own label, on one screen, with nothing
   saying which was wrong. `load.js` only defaults the type when the key is
   ABSENT, so a present-but-unrecognised value reaches here verbatim, and a
   vault whose files a person could have written by hand will produce them.

   Unlisted types keep their OWN name rather than being folded into "other":
   this is the same choice debtsByType and assetsByType already make, and
   renaming a reader's own label to make a chart tidy is the kind of quiet
   correction this app does not do.

   `known` marks which groups came from the caller's list, so it can pair them
   with their fixed labels and colours and colour-walk the rest. */
function accountGroups(accounts, knownTypes) {
  const known = knownTypes || [];
  const order = new Map(known.map((t, i) => [t, i]));
  const owned = new Map(), owed = new Map();
  for (const a of accounts || []) {
    /* Case-folded as well as trimmed. This file's own header (see the note
       above accountGroups' siblings) named `type: Savings` with a capital S as
       "the same bug wearing a hat" after it cost the composition chart R80 000
       — and then this function kept comparing `.trim()` alone, so a
       capital-S account still missed the sealed `savings` bucket and drew as
       its own unlisted group under its own label. views/savings.js and
       health-data.js were folded first; this was the last raw reading of the
       field, and the one that decides which colour a segment gets. */
    const t = (a && typeof a.type === 'string' && a.type.trim().toLowerCase()) || 'other';
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

/* Everything a net-worth figure held out, per symbol, as ONE list a page can
   print beside it.

   worth() has returned `otherCurrencies` — the foreign assets and the foreign
   debts it filtered out — since ADR-0004 landed, and no page ever read it.
   Every surface disclosed the ACCOUNTS half only (splitByCurrency's `others`,
   computed by the caller before worth() was reached), so a €200 000 flat and
   a €100 000 bond vanished from the Dashboard, Savings and Report net-worth
   tiles with nothing said — the silent exclusion currency.js forbids, on the
   one figure that claims to be the whole picture.

   Merged into a per-symbol NET (accounts + assets − debts), because the figure
   it sits beside is a net worth and "held" in the disclosure sentence means
   "in the household's position", not "in a bank". A symbol that nets to
   nothing is dropped and -0 is collapsed, so a household whose euro flat
   exactly matches its euro bond does not print "€ 0" beside a rand total.
   Insertion order is accounts first, then assets, then debts, so two pages
   listing the same household print the symbols in the same order. */
function otherCurrencyNet(w, accountOthers) {
  const by = new Map();
  const add = (pairs, sign) => {
    for (const [sym, v] of pairs || []) by.set(sym, (by.get(sym) || 0) + sign * (Number(v) || 0));
  };
  add(accountOthers, 1);
  add(w && w.otherCurrencies && w.otherCurrencies.assets, 1);
  add(w && w.otherCurrencies && w.otherCurrencies.debts, -1);
  return [...by]
    .map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0])
    .filter(([, v]) => v !== 0);
}

module.exports = {
  worth, activeDebts, assetTotal, foreignTotals, otherCurrencyNet, cardOverlap, accountGroups, debtsByType, assetsByType,
};
