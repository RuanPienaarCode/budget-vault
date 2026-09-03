'use strict';
/* The type vocabulary, declared once. Phase 1 of ADR-0006.

   "A savings or investment category or account" is the set that decides what
   is set aside rather than consumed, which accounts form the household's
   savings pool, which accounts can carry an earmark, and which category types
   mark an internal leg of money moving between the household's own pockets.
   Those are one idea seen from four sides, and on 1.38.0 it was spelled
   fifteen times in twelve files under six different names — SET_ASIDE_TYPES,
   EARMARKED_TYPES, EARMARKED_ACCOUNT_TYPES, POOL_TYPES, INTERNAL_LEG_TYPES,
   and as a bare literal pair — beside four hand-written copies of the same
   case-and-whitespace fold for an account's `type:`. All of them agreed. None
   of them had to. A type added to one and not the others would have bucketed
   the same rand two ways, which is this repository's recurring defect.

   So the sets live here, the fold lives here, and tests/one-vocabulary.test.cjs
   forbids the literals and the fold anywhere else in src/. A reader who needs
   to know whether something counts as set aside asks this module; a reader
   who needs to add a type adds it in one place and every consumer follows.

   Pure on purpose: no DOM, no ctx, no `require('obsidian')`. */

/* Category types under which an outflow is money the household KEPT, not
   money it consumed. Read by summaryInRange (setAside), budgetTotals (the
   set-aside envelopes), periodFlow's rail, health-data's consumption slice
   and the Budget page's bucketing. */
const SET_ASIDE_TYPES = Object.freeze(new Set(['savings', 'investment']));

/* Account types that form the savings pool — the same pair, seen from the
   account side: the vehicles a contribution lands in, the balances the
   Savings page lists, the accounts an earmark can sit on. One object, not a
   copy, so the two can never drift. */
const POOL_ACCOUNT_TYPES = SET_ASIDE_TYPES;

/* Category types that mark an internal leg: money moving between the
   reader's own pockets, never fresh saving from outside the pool. */
const INTERNAL_LEG_TYPES = Object.freeze(new Set(['transfer', ...SET_ASIDE_TYPES]));

/* Category types health-math does NOT count as essential spend. Everything
   else a household pays for is treated as a bill the emergency fund must
   cover; groups.js may add to this set per household, never remove. */
const NON_ESSENTIAL_TYPES = Object.freeze(new Set(['luxuries', 'giving', 'income', 'transfer', ...SET_ASIDE_TYPES]));

/* THE fold. load.js only defaults an account's `type` when the frontmatter
   key is ABSENT, so `type: Savings` or `type: ' savings '` reaches every
   reader exactly as written. Every comparison of an account type goes
   through here so a capital letter cannot count an account toward net worth
   while dropping it from the Savings page. */
function normType(t) { return String(t || '').trim().toLowerCase(); }
function accountType(a) { return normType(a && a.type); }

/* Category types compare RAW, deliberately: load.js hands a category's type
   through as written, and every `type === 'income'` / `'transfer'` test in
   the codebase reads it the same way. Folding here alone would make set-aside
   the one classification that forgave a capital letter. If categories are
   ever normalised, it happens in the loader, once, and these stay as they are. */
function isSetAsideType(type) { return SET_ASIDE_TYPES.has(type); }
function isInternalLegType(type) { return INTERNAL_LEG_TYPES.has(type); }
function isPoolAccount(a) { return !!a && POOL_ACCOUNT_TYPES.has(accountType(a)); }
function accountsOfType(accounts, type) {
  const want = normType(type);
  return (accounts || []).filter(a => accountType(a) === want);
}
function poolAccounts(accounts) { return (accounts || []).filter(isPoolAccount); }

module.exports = {
  SET_ASIDE_TYPES, POOL_ACCOUNT_TYPES, INTERNAL_LEG_TYPES, NON_ESSENTIAL_TYPES,
  normType, accountType, isSetAsideType, isInternalLegType, isPoolAccount, accountsOfType, poolAccounts,
};
