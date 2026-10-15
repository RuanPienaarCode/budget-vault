'use strict';
/* The what's-left card resolves each transaction FOLDER to its account once per
   render, not once per transaction FILE (audit L8-04, Wave B lane B4).

   renderLeft walked every file in S.txFiles twice (the per-account import
   horizon, then the per-currency partition) and called accountForLabel on each
   one. A household has one file per account per month, so a year of three
   accounts is 36 files and 36 scans of the account list, each running safeSeg()
   on the label and on up to two names per account - for 3 distinct labels. On
   the vault this was found on (a few hundred files, about a dozen labels) that was
   about 2.3 ms of the render, 0.05 ms once per label; the full Dashboard stays
   near 105 ms either way, so this is bookkeeping, not the fix for a slow page.
   period.js already holds a once-per-call labelLookup() for its own readers, but
   it is not published on ctx; the Dashboard memoises accountForLabel itself, so
   the memo IS the rule and can never disagree with it.

   Counting needs the view to hold a wrapped accountForLabel, which it takes off
   ctx at registration - so the period module's registration is wrapped (at the
   require hook) to swap ctx.accountForLabel for a counting twin. Equivalence of what the card
   prints is held by the existing suites (tests/dashboard-cards.test.cjs, the
   "Visa: Gold" folder, still forms its cycle band through this path) and by the
   two golden ledgers coming out byte-identical with and without the memo.

     node tests/dashboard-folder-lookup-once.test.cjs */
const assert = require('assert');
/* tests/helpers/figures.cjs purges the src module cache on every mount (so the
   money recorder wraps a fresh currency.js), which throws away anything done to
   a module beforehand. So the counting twin is installed at the require() hook:
   whatever registerPeriod the harness loads is wrapped on its way in. */
const Module = require('module');
const realRequire = Module.prototype.require;
let calls = 0;
const seen = [];
const wrapped = new WeakMap();
Module.prototype.require = function (id) {
  const m = realRequire.apply(this, arguments);
  if (typeof m === 'function' && /(^|[\\/])period$/.test(id)) {
    if (!wrapped.has(m)) {
      wrapped.set(m, function registerPeriodCounting(ctx) {
        m(ctx);
        const real = ctx.accountForLabel;
        ctx.accountForLabel = l => { calls++; seen.push(l); return real(l); };
      });
    }
    return wrapped.get(m);
  }
  return m;
};
const { B, tx, base, account, textOf, pinClock, mountFor } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

(async () => {
  const files = {
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-09-10' }),
    [`${B}/Accounts/Savings.md`]: account('Savings', { type: 'savings', balance: '3000.00', balance_updated: '2026-09-10' }),
    [`${B}/Accounts/Visa: Gold.md`]: '---\ntype: credit_card\nsettle_monthly: true\nbalance: -2500\nbalance_updated: 2026-09-10\n---\n',
  };
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  for (const m of months) {
    files[`${B}/Transactions/Cheque/${m}.md`] = tx([[`${m}-03`, 'Checkers', 'Groceries', -100]]);
    files[`${B}/Transactions/Savings/${m}.md`] = tx([[`${m}-04`, 'Interest', 'Salary', 5]]);
    files[`${B}/Transactions/Visa- Gold/${m}.md`] = tx([[`${m}-05`, 'Woolworths', 'Groceries', -200]]);
  }

  const unpin = pinClock('2026-09-20');
  try {
    const { ctx, S } = await mountFor(files, { period: '2026-09' });
    const nFiles = Object.keys(S.txFiles).length;
    const labels = new Set(Object.values(S.txFiles).map(f => f.label));
    eq([nFiles, labels.size], [18, 3], 'premise: eighteen transaction files under three folder labels');

    calls = 0; seen.length = 0;
    ctx.renderDashboard();

    ok(calls > 0, 'the Dashboard still resolves folders through accountForLabel (the one rule)');
    ok(calls <= labels.size, `at most one resolution per distinct folder label (${calls} for ${labels.size} labels, not ${nFiles * 2})`);
    eq([...new Set(seen)].sort(), [...labels].sort(), 'and every folder label was resolved (none skipped)');
    eq(seen.length, new Set(seen).size, 'no label is resolved twice');

    /* The card the lookups feed is still drawn. */
    ok(textOf(ctx.$('#leftBody')).length > 0, "the what's-left card is still drawn");
  } finally { unpin(); }

  console.log(`PASS dashboard-folder-lookup-once - the what's-left card resolves each folder label once per render, not once per file (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
