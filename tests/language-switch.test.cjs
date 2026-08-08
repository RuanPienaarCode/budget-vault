'use strict';
/* Switching language has to reach the filter selects too.

   Reported as "I switch back from Afrikaans to English and other pages are
   still in Afrikaans". The pages were not the unit that was stale — the
   Transactions filter selects were, and they are the only thing on that screen
   that survives a re-render on purpose.

   Why it looked like a whole-page bug: applyLanguage() does applyDom(root) +
   render(), and switchView() renders the page it moves to, so every static
   label and every rebuilt row DID switch. What did not was the two <select>
   filters, because renderTransactions skips rebuilding them when their
   contents already match — a real optimisation, since a blind rebuild drops
   the user's current selection and the ~40k option nodes behind it.

   The skip-check compared only the DYNAMIC values: account labels and category
   names. A language switch changes neither. It changes the FIXED options —
   "All accounts", "All categories", "Uncategorised" — which the check never
   looked at, so it held on precisely the render that had to run. The filters
   then kept the old language until something unrelated renamed a category,
   which is why it read as random pages not switching.

   Pinned here against the REAL syncOptions (published on ctx for this, the
   same way accounts.js publishes accountReconcile) and the REAL language
   tables. A fake select is enough: the bug is entirely in the skip decision,
   and driving the whole Transactions view would test the table windowing
   instead of the thing that broke.

   Bare node; wired into ./build.sh.
     node tests/language-switch.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const i18n = require('../src/i18n.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ------------------------- the smallest real select ---------------------- */
/* syncOptions builds its options through src/dom.js's el(), which goes to
   document.createElement — so the options under test are made by the REAL
   builder, not by the test. Only what el() and syncOptions actually touch is
   stubbed; anything more would be a second DOM implementation to get wrong. */
class FakeNode {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this._text = '';
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener() {}
  append(kid) { if (kid && kid.nodeType === 3) this._text += kid.textContent; }
  get value() { return this.attrs.value || ''; }      // <option> takes it from the attribute
  get textContent() { return this._text; }
}
global.document = {
  createElement: tag => new FakeNode(tag),
  createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
};

class FakeSelect {
  constructor() { this.options = []; this._value = ''; this.rebuilds = 0; }
  empty() { this.options = []; this.rebuilds++; }
  append(o) { this.options.push(o); }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  labels() { return this.options.map(o => o.textContent); }
  values() { return this.options.map(o => o.value); }
}

/* The real syncOptions, off the real register body — same minimal ctx
   split-transaction.test.cjs uses to reach splitTransaction. */
const registerTransactions = require('../src/views/transactions');
const ctx = { S: {}, registerDirty() {}, registerSaveButton: () => () => {}, provide(o) { Object.assign(ctx, o); } };
registerTransactions(ctx);

ok(typeof ctx.syncOptions === 'function',
  'transactions.js must publish syncOptions on ctx so this test drives the REAL one');
const syncOptions = ctx.syncOptions;

/* The two filters exactly as renderTransactions builds them. */
const accountFixed = () => [['', i18n.t('tx.allAccounts')]];
const categoryFixed = () => [['', i18n.t('tx.allCategories')], ['__none__', i18n.t('tx.uncategorised')]];

const ACCOUNTS = ['FNB Cheque', 'Ninety One TFSA'];
const CATEGORIES = ['Freelance', 'Groceries'];

/* ---- 1. the reported bug: language changes, nothing else does ---- */
/* This is the assertion that fails on the old skip-check. Values are byte-for-byte
   identical across the switch — only the translated fixed labels move. */
for (const lang of ['af', 'de', 'es', 'fr', 'ja', 'zh']) {
  i18n.setLanguage(lang);
  const acct = new FakeSelect();
  const cat = new FakeSelect();
  syncOptions(acct, ACCOUNTS, accountFixed());
  syncOptions(cat, CATEGORIES, categoryFixed());

  const foreignAcct = acct.labels()[0];
  const foreignCat = cat.labels().slice(0, 2);

  i18n.setLanguage('en');
  syncOptions(acct, ACCOUNTS, accountFixed());
  syncOptions(cat, CATEGORIES, categoryFixed());

  eq(acct.labels()[0], i18n.t('tx.allAccounts'),
    `#txAccount kept the ${lang} label "${foreignAcct}" after switching to English — ` +
    'the skip-check ignored the fixed labels, so the only translated option never rebuilt');
  eq(cat.labels().slice(0, 2), [i18n.t('tx.allCategories'), i18n.t('tx.uncategorised')],
    `#txCategory kept the ${lang} labels ${JSON.stringify(foreignCat)} after switching to English`);
}

/* And the other direction — English to Afrikaans — for the same reason. */
i18n.setLanguage('en');
const back = new FakeSelect();
syncOptions(back, ACCOUNTS, accountFixed());
i18n.setLanguage('af');
syncOptions(back, ACCOUNTS, accountFixed());
eq(back.labels()[0], i18n.t('tx.allAccounts'), 'en -> af has to move the fixed label too');
i18n.setLanguage('en');

/* ---- 2. the optimisation the skip-check exists for still holds ---- */
/* If this stops passing the fix has become "rebuild always", which drops the
   user's selection and the option nodes the windowing works hard to avoid. */
const stable = new FakeSelect();
syncOptions(stable, ACCOUNTS, accountFixed());
const afterFirst = stable.rebuilds;
syncOptions(stable, ACCOUNTS, accountFixed());
syncOptions(stable, ACCOUNTS, accountFixed());
eq(stable.rebuilds, afterFirst,
  'same language + same values must NOT rebuild — that is what the skip-check is for');

/* ---- 3. the rename case the skip-check was written for ---- */
const renamed = new FakeSelect();
syncOptions(renamed, ACCOUNTS, accountFixed());
syncOptions(renamed, ['FNB Cheque', 'Ninety One TFSA (old)'], accountFixed());
eq(renamed.values().slice(1), ['FNB Cheque', 'Ninety One TFSA (old)'],
  'a rename on another device must still rebuild the list');

/* ---- 4. the selection survives a language switch ---- */
/* Rebuilding is what threatened the selection in the first place, so the
   language path has to preserve it or the fix trades one bug for another. */
const selected = new FakeSelect();
i18n.setLanguage('af');
syncOptions(selected, ACCOUNTS, accountFixed());
selected.value = 'FNB Cheque';
i18n.setLanguage('en');
syncOptions(selected, ACCOUNTS, accountFixed());
eq(selected.value, 'FNB Cheque',
  'switching language must not silently reset which account the user is filtering by');

/* A selection that no longer exists still falls back to "all". */
const gone = new FakeSelect();
syncOptions(gone, ACCOUNTS, accountFixed());
gone.value = 'FNB Cheque';
syncOptions(gone, ['Ninety One TFSA'], accountFixed());
eq(gone.value, '', 'a selection whose account disappeared falls back to all-accounts');

/* ---- 5. every language actually has these three strings ---- */
/* A missing key falls back to English, which would make check 1 pass for the
   wrong reason — the label would "switch" only because it was English already. */
for (const lang of ['af', 'de', 'es', 'fr', 'ja', 'zh']) {
  i18n.setLanguage(lang);
  for (const key of ['tx.allAccounts', 'tx.allCategories', 'tx.uncategorised']) {
    i18n.setLanguage('en');
    const enText = i18n.t(key);
    i18n.setLanguage(lang);
    ok(i18n.t(key) !== enText,
      `${lang}.js '${key}' is identical to English — check 1 would pass without proving anything`);
  }
}
i18n.setLanguage('en');

console.log(`PASS — language switch reaches the Transactions filter selects (${checks} checks).`);
