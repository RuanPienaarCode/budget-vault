'use strict';
/* The same slip saved twice (receipt-file.js findDuplicateReceipt).

   Add receipt used to write "... 2.md" beside the first file with no word
   said, so a slip pasted twice doubled that shop's food spend and item
   counts. The Food page now asks first; this is the pure half that decides
   whether to ask. Same shop (trimmed, case- and space-folded), same date,
   same total to the cent, and the same time when BOTH carry one. A slip with
   no time on either side is one a reader typed without it, so it is still
   the same slip. Synthetic data.

   node tests/receipt-duplicate.test.cjs */

const assert = require('assert');
const rf = require('../src/receipt-file');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const saved = (over = {}) => ({
  rel: 'Receipts/2026-02/2026-02-14 Sample Store 0930.md',
  store: 'Sample Store', date: '2026-02-14', time: '09:30', total: 90,
  items: [{ name: 'A', amount: 60, discount: 0 }, { name: 'B', amount: 30, discount: 0 }],
  ...over,
});
const typed = (over = {}) => ({
  store: 'Sample Store', date: '2026-02-14', time: '09:30', total: 90, items: [{ name: 'A', amount: 90, discount: 0 }], ...over,
});
const find = (got, existing = [saved()]) => rf.findDuplicateReceipt(existing, got);

const first = saved();
eq(rf.findDuplicateReceipt([first], typed()), first, 'an identical slip matches, and the saved receipt is returned');
eq(find(typed({ total: 90.01 })), null, 'a different total does not match');
eq(find(typed({ total: 89.999999 })), first, 'totals are compared to the cent, not as floats');
eq(find(typed({ date: '2026-02-15' })), null, 'a different date does not match');
eq(find(typed({ store: 'Other Store' })), null, 'a different shop does not match');
eq(find(typed({ time: '17:45' })), null, 'same shop, date and total at two different times is two shops');
eq(find(typed({ time: '' })), first, 'no time on the new slip: still the same slip');
eq(!!find(typed(), [saved({ time: '' })]), true, 'no time on the saved slip: still the same slip');
eq(!!find(typed({ time: '' }), [saved({ time: '' })]), true, 'no time on either side matches');
eq(find(typed({ store: '  sample   STORE ' })), first, 'case and spacing in the shop name do not matter');
eq(find(typed({ time: ' 09:30 ' })), first, 'a time is compared trimmed');

/* A saved slip whose total is missing is compared by what its lines add up to. */
eq(!!find(typed(), [saved({ total: null })]), true, 'no frontmatter total: the lines add up to 90, so it matches');
eq(!!find(typed({ total: 91 }), [saved({ total: null })]), false, 'and a different total still does not');

/* Of several receipts, the match is found wherever it sits. */
const others = [saved({ rel: 'a.md', total: 10 }), saved({ rel: 'b.md', store: 'Elsewhere' }), first];
eq(find(typed(), others), first, 'found among others');
eq(find(typed(), []), null, 'nothing saved yet');
eq(rf.findDuplicateReceipt(undefined, typed()), null, 'no list at all');

console.log(`PASS receipt-duplicate: ${checks} checks`);

/* The page asks before it writes: a source pin, because food.js needs the
   host and cannot run here. The order is the contract — ask, then re-check
   the bound-load guard, then pick a free path — and the safe answer must be
   the default one. */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/views/food.js'), 'utf8');
  const body = src.slice(src.indexOf('async function addReceipt'), src.indexOf('async function refile'));
  const at = re => { const m = body.search(re); assert.ok(m >= 0, 'missing in addReceipt: ' + re); checks++; return m; };
  const ask = at(/findDuplicateReceipt\(S\.receipts, got\)/);
  const dialog = at(/confirmModal\(app,/);
  const recheck = body.indexOf('op.replaced()', dialog);
  const path = at(/let rel = receiptPath\(got\)/);
  assert.ok(ask < dialog && dialog < recheck && recheck < path, 'ask, re-check the load, then choose the path'); checks++;
  assert.ok(/primary: 'cancel'/.test(body), 'the safe answer is the highlighted one'); checks++;
  assert.ok(/if \(!again\) return;/.test(body), 'declining saves nothing'); checks++;
  console.log(`PASS receipt-duplicate wiring: ${checks} checks in all`);
}
