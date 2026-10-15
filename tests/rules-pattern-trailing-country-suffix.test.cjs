'use strict';
/* A rule written with the bank's " ZA" suffix still matches its merchant.

   L1-14 (Low). Discovery prints a country code on card rows ("PNP ROSEBANK
   ZA"), and the importer strips it from every description before it
   categorises or dedupes (views/import.js, `loc.stripDescSuffix`). A rule typed
   or pasted WITH the suffix - "PNP ROSEBANK ZA", copied from the statement -
   therefore never matched: it was compared with "pnp rosebank". On the vault
   this was found on, a number of rules sat dead for exactly that reason.

   The matcher now also tries a pattern with a trailing " za" removed, and ONLY
   when nothing else matched the description. That is the whole safety
   argument: it can turn "no category" into a category, never change which rule
   wins a description some rule already matched, so no existing categorisation
   moves. Descriptions that still carry the suffix (rows imported before the
   strip, typed by hand) keep matching the way they always did.

     node tests/rules-pattern-trailing-country-suffix.test.cjs */

const assert = require('assert');
const { prepareRules, matchRule, autoCategorise, patternMatches } = require('../src/rules');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const R = (...pairs) => prepareRules(pairs.map(([pattern, category]) => ({ pattern, category })));

/* ---- the defect ---- */
{
  const rules = R(['PNP ROSEBANK ZA', 'Groceries']);
  eq(autoCategorise('PNP ROSEBANK', rules), 'Groceries', 'a description as the importer leaves it matches a rule typed with " ZA"');
  eq(autoCategorise('PNP ROSEBANK ZA', rules), 'Groceries', 'and one that still carries the suffix matches as before');
  eq(autoCategorise('pnp rosebank kloof st', rules), 'Groceries', 'by substring, like any rule');
  eq(matchRule('PNP ROSEBANK', rules).p, 'pnp rosebank za', 'the winning rule is reported by its own pattern, so callers can find it again');
  eq(patternMatches('pnp rosebank', 'pnp rosebank za'), true, 'patternMatches (rule-cleanup\'s question) agrees with the matcher');
  eq(patternMatches('checkers hyper', 'pnp rosebank za'), false, 'and does not match a different merchant');
}

/* ---- nothing that already matched moves ---- */
{
  const rules = R(['PNP ROSEBANK ZA', 'Dead'], ['PNP ROSEBANK', 'Live']);
  eq(autoCategorise('PNP ROSEBANK', rules), 'Live', 'an exact rule keeps winning over the suffix form of the same text');
  const longer = R(['PNP ROSEBANK ZA', 'Suffix form'], ['PNP ROSEBANK ZA 4455', 'Longer']);
  eq(autoCategorise('PNP ROSEBANK ZA 4455', longer), 'Longer', 'a longer matching rule still wins');
  const other = R(['PNP', 'Short'], ['PNP ROSEBANK ZA', 'Suffix form']);
  eq(autoCategorise('PNP ROSEBANK', other), 'Short', 'a description some rule already matches keeps that rule - the suffix form is only a fallback');
  eq(autoCategorise('PNP ROSEBANK', R(['za', 'Country'])), '', 'a pattern that is just "za" is left alone (no preceding space to strip)');
  eq(autoCategorise('PIZZA PLACE', R(['PIZZA', 'Eating out'])), 'Eating out', 'and a word that merely ends in the letters is not touched');
  eq(autoCategorise('ZA TRADERS', R(['TRADERS ZA', 'Shops'])), 'Shops', 'only a TRAILING suffix is stripped from a pattern - "traders" matches via the fallback');
  eq(autoCategorise('X', R([' ZA', 'Nothing'])), '', 'a pattern that is only the suffix is just "za" once trimmed, and matches nothing here');
}

console.log(`PASS rules-pattern-trailing-country-suffix (${checks} checks)`);
