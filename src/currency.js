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

module.exports = { symbolOf, isForeign, currenciesIn };
