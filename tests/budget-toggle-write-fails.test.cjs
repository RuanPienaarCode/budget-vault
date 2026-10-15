'use strict';
/* The Budget page's "fixed bill" and "assume spent" toggles had no catch
   (2026-10-14 audit, L8-07). The button's onclick drops the promise, so when the
   category file's write failed (iCloud holding the file, a stale-file refusal)
   the result was an unhandled rejection and no toast: the reader pressed a
   button, nothing visibly changed, and nothing said why. A failed write now says
   so, and leaves the page showing what the file says.

     node tests/budget-toggle-write-fails.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const H = require('./figures/household.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(String((e && e.message) || e)));

async function press(cls, { fail }) {
  const unpin = pinClock(H.TODAY);
  try {
    const { ctx, S, nodes } = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
    ctx.switchView = () => {};
    if (fail) {
      ctx.vault.modify = async () => { throw new Error('EBUSY: file is locked by iCloud'); };
      ctx.vault.process = async () => { throw new Error('EBUSY: file is locked by iCloud'); };
    }
    ctx.renderBudgets();
    const btn = [...nodes.values()].flatMap(n => descend(n)).find(e => e._cls && e._cls.has(cls));
    ok(btn, `${cls}: the toggle is rendered`);
    const before = JSON.stringify(S.categories.map(c => [c.name, c.fixed, c.assumeSpent]));
    ctx._toasts.length = 0;
    btn.click();
    await new Promise(r => setTimeout(r, 60));
    const after = JSON.stringify(S.categories.map(c => [c.name, c.fixed, c.assumeSpent]));
    return { toasts: ctx._toasts.slice(), before, after };
  } finally { unpin(); }
}

(async () => {
  for (const cls of ['bud-act-fixed', 'bud-act-assume']) {
    const failed = await press(cls, { fail: true });
    eq(failed.toasts.length, 1, `${cls}: a failed write raises exactly one toast`);
    ok(failed.toasts[0].bad === true, `${cls}: and it is an error toast`);
    ok(/EBUSY: file is locked by iCloud/.test(failed.toasts[0].msg), `${cls}: naming the failure — got: ${failed.toasts[0].msg}`);
    eq(failed.after, failed.before, `${cls}: the in-memory flag is not flipped by a write that did not land`);

    const good = await press(cls, { fail: false });
    ok(good.toasts.length === 1 && !good.toasts[0].bad, `${cls}: control: a write that lands toasts the success, not an error`);
    ok(good.after !== good.before, `${cls}: control: and flips the flag`);
  }
  eq(unhandled, [], 'no unhandled rejection from either toggle');

  console.log(`PASS budget-toggle-write-fails — a failed category-file write from the fixed / assume-spent toggles says so, leaves the flag as the file has it, and rejects nothing unhandled (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
