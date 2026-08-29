'use strict';
/* Per-account currency — a DISPLAY symbol, and deliberately nothing more.

   The household has one currency, set once in Settings.md, and every total in
   this app is stated in it. An account may now carry its own `currency:` in
   frontmatter, which changes how THAT ACCOUNT'S OWN figures are printed — its
   balance cell, its drawer, the dialog that edits it. A euro account reads
   "€ 1 200,00" instead of claiming to hold twelve hundred rand.

   What it explicitly does NOT do is convert, and it does not exclude.

   No conversion, because a rate is a fact about a day that this vault does not
   hold. Storing one would mean every figure derived from it silently ages, and
   a household total that was right last month is the worst kind of wrong —
   it looks the same.

   No exclusion, because `budget: false` is already the one mechanism this app
   has for keeping an account out of the household totals, and committed.js
   says plainly why there must not be a second: "two overlapping ways to
   exclude the same account is how a reader ends up unable to explain their own
   total." A currency rule layered on top would be exactly that second way.

   So a total that spans more than one currency is still added up — and SAYS
   SO, via currenciesIn() below. A disclosure the reader can act on (opt the
   account out with `budget: false`, which they already know how to do) beats a
   silent rule they cannot see. Pure — no DOM, no obsidian import — so
   tests/currency.test.cjs runs it in bare node. */

/* The symbol to print this account's own figures in. Falls back to the
   household's, so every account in a single-currency vault — which is nearly
   all of them — is unchanged and needs no frontmatter key. */
function symbolOf(a, household) {
  const own = String((a && a.currency) || '').trim();
  return own || String(household || '').trim() || 'R';
}

/* Does this account state a currency that is not the household's? Compared on
   the trimmed symbol, so `currency: "R"` in a rand vault is correctly read as
   "same", not as a second currency that happens to look identical. */
function isForeign(a, household) {
  const own = String((a && a.currency) || '').trim();
  return !!own && own !== String(household || '').trim();
}

/* Every distinct symbol across a set of accounts, household first, in the
   order first met after that — so the caller can say "this total spans R and
   €" and name them in a stable order rather than whatever Set iteration gives.

   One entry means the total is honest as printed and the caller says nothing;
   two or more is what the disclosure is for. */
function currenciesIn(accounts, household) {
  const home = String(household || '').trim() || 'R';
  const seen = [];
  for (const a of accounts || []) {
    const s = symbolOf(a, home);
    if (!seen.includes(s)) seen.push(s);
  }
  // Household first when present, so the list reads from what the total is
  // stated in outwards to what it is quietly folding in.
  return seen.includes(home) ? [home, ...seen.filter(s => s !== home)] : seen;
}

/* Split a set of accounts into the ones stated in the household's own currency
   — safe to add straight up — and a running total per FOREIGN symbol present.

   This is the rule the whole app now sums by, and it lives HERE rather than in
   a view because of how it got here. It was written inside views/accounts.js,
   applied to that page's hero and table, and deliberately not applied to the
   ring or the owner rows. A reporter found the gap from the outside (issue
   #28): the donut's centre said Rp 5,203,956 while the hero directly above it
   said Rp 5,200,000. The ring and the owner rows were fixed. An audit then
   found the Savings page — a different file that never had the rule at all —
   printing Rp 6,203,956 against the Accounts page's Rp 6,200,000, with no
   disclosure of any kind.

   That is three rounds of the same defect, and every round had the same cause:
   the rule existed in ONE view, so every other view was free to sum its own
   way. This repo's recurring bug shape is "two figures derived by different
   rules"; a rule that lives in a view is that shape waiting to happen. It is
   module-level now so there is one implementation to be right, and any view
   that wants a total has to come here to get it.

   Never converts — see the header above. `others` is a list of [symbol, total]
   pairs, each in ITS OWN currency, for the caller to state beside the primary
   figure rather than fold into it. Household first is not needed here (these
   are only the non-household symbols), but insertion order is stable so two
   callers listing the same accounts print them in the same order. */
function splitByCurrency(accounts, household) {
  const home = String(household || '').trim();
  const primary = [];
  const bySymbol = new Map();
  for (const a of accounts || []) {
    if (isForeign(a, home)) {
      const sym = symbolOf(a, home);
      bySymbol.set(sym, (bySymbol.get(sym) || 0) + (Number(a.balance) || 0));
    } else {
      primary.push(a);
    }
  }
  /* Rounded to the cent and -0 collapsed, the same two-step every other total
     in this app applies — a foreign side figure is a figure like any other,
     and "¥ -0" beside a headline reads as a debt that does not exist. */
  return {
    primary,
    others: [...bySymbol].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]),
  };
}

/* The same split, reduced to the one number a caller usually wants: the sum of
   the household-currency accounts, rounded to the cent with -0 collapsed.

   Every page was rounding this by hand — accounts.js's roundedSum, worth.js's
   own two-step, owners.js's per-row pass — which is three copies of a rule
   that exists because summing signed floats leaves a remainder like -7.1e-15
   behind, and read raw that renders a break-even household as "-R0,00" in
   danger red. */
function primaryTotal(accounts, household) {
  const { primary } = splitByCurrency(accounts, household);
  return (Math.round(primary.reduce((s, a) => s + (Number(a.balance) || 0), 0) * 100) / 100) || 0;
}

/* The one money-formatting routine, so a figure printed by a callout and one
   printed by money() on the same page never disagree.

   Byte-for-byte the same rules as controller.js's formatMoney: symbol, a
   space, then sign-and-digits (so "-100" reads "R -100,00", not "-R100,00"),
   thousands grouped per `loc.thousands`, decimals joined with `loc.decimal`,
   and non-finite input rendered as 0 rather than "RNaN" or "RInfinity".

   Duplicated here rather than imported from controller.js: controller.js
   pulls in `obsidian` and mounts the live app, so nothing pure can require it
   without dragging that in, and controller.js is out of scope for this
   change to touch (it must keep working unchanged). `loc` only needs
   `{thousands, decimal}`, which both a locale.js country profile and a bare
   `{thousands, decimal}` object satisfy — so views/tax.js's second formatter
   (locale.js's fmtAmt) can delegate here instead of re-deriving the same
   separator logic and drifting from it, which is the bug this closes: fmtAmt
   used to take no currency argument at all and print the COUNTRY's default
   symbol instead of the household's, so a household set to "$" saw its own
   tax callouts labelled "R". */
function formatAmount(symbol, v, decimals, loc) {
  if (!Number.isFinite(v)) v = 0;
  const sign = v < 0 ? '-' : '';
  const parts = Math.abs(v).toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, loc.thousands);
  return `${symbol} ${sign}${parts[0]}${decimals > 0 ? loc.decimal + parts[1] : ''}`;
}

module.exports = { symbolOf, isForeign, currenciesIn, splitByCurrency, primaryTotal, formatAmount };
