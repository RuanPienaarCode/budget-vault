'use strict';
/* MOVED TO FUNDS IS A TRANSFER FROM THE HOUSEHOLD'S OWN ACCOUNTS, NOT ANY DEPOSIT.

   Ruan's decision of 29 Sep 2026 (ADR-0006 amendment): "moved to funds" counts an
   inflow into a savings or investment account only when it is matched by an
   outflow from another of the household's own non-pool accounts. Outside money
   that lands in a fund (a UIF payout paid straight in, a gift, interest) is not
   moved. Pool-to-pool shuffles stay out, as before.

   On the vault this was decided on, a large UIF-style payout counted as moved
   and August read far too high. It reached Kids Fund as a TRANSFER out of the
   cheque account (both legs marked Excluded), so the transfer test alone could
   not remove it; the row-level Excluded veto does, and it is read in the same
   seam, on either leg. Both are pinned below, on a synthetic household (no real figures).

   One seam: ctx.movedToFunds (the Dashboard "moved so far", the Budget strip, the
   Report) and ctx.savingContribution (the saving rate's numerator, the Score's
   flow card) both go through ctx.transfersIntoFunds.

     node tests/lane-r-moved-to-funds.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { savedFromOutside } = require('../src/savings-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(a !== null && Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const { B, TX, FILES, fund } = require('./helpers/lane-r-household.cjs');

async function mount(files, period) {
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = period;
  return ctx;
}

(async () => {
  const unpin = pinClock('2026-09-05');
  try {
    const ctx = await mount(FILES, '2026-08');

    /* ---- 1. the assembled seam, on the whole household -------------------- */
    near(ctx.movedToFunds('2026-08'), 1000,
      'moved = the one regular transfer; the windfall, the gift, the interest, the pool shuffle and the half-vetoed transfer are not');
    near(ctx.savingContribution('2026-08'), ctx.movedToFunds('2026-08'),
      'the saving rate\'s numerator is the very figure the Dashboard prints as moved: one seam');

    /* ---- 2. each row shape alone, through the pure function --------------- */
    const pool = new Map([['Kids Fund', { name: 'Kids Fund' }], ['Old Fund', { name: 'Old Fund' }]]);
    const own = new Set(['Cheque']);
    const row = (label, date, amount, extra) => ({ label, date, amount, desc: '', cat: '', ...extra });
    const declared = n => (n === 'Interest' ? 'interest' : null);
    const moved = (rows, opts) => savedFromOutside(rows, pool, declared, { ownLabels: own, ...opts });

    near(moved([row('Cheque', '2026-08-02', -1000), row('Kids Fund', '2026-08-02', 1000)]), 1000,
      'salary -> fund transfer counts');
    near(moved([row('Kids Fund', '2026-08-06', 2500)]), 0,
      'a UIF-style deposit straight into a fund has no leg in an own account: not moved');
    near(moved([row('Kids Fund', '2026-08-06', 2500, { excluded: true })]), 0,
      'and the same deposit marked Excluded is not moved either');
    near(moved([row('Kids Fund', '2026-08-07', 80, { cat: 'Interest' }), row('Cheque', '2026-08-07', -80)]), 0,
      'interest credited in the pool never enters the pairing, so an unrelated equal outflow cannot make it moved');
    near(moved([row('Kids Fund', '2026-08-10', -700), row('Old Fund', '2026-08-10', 700)]), 0,
      'pool to pool is not moved');
    near(moved([row('Cheque', '2026-08-02', -1000), row('Kids Fund', '2026-08-02', 1000)].concat([row('Cheque', '2026-08-02', -1000)])), 1000,
      'one outflow can vouch for one inflow only');
    near(moved([row('Cheque', '2026-08-02', -1000), row('Kids Fund', '2026-08-02', 1000), row('Old Fund', '2026-08-02', 1000)]), 1000,
      'two equal deposits, one sending leg: only one is a transfer');
    near(moved([row('Kids Fund', '2026-08-02', 1000), row('Cheque', '2026-08-20', -1000)]), 0,
      'a sending leg dated weeks AFTER the deposit is not that deposit\'s other leg');
    near(moved([row('Cheque', '2026-08-02', -1000), row('Kids Fund', '2026-08-03', 1000)]), 1000,
      'a next-day settlement still pairs');

    /* ---- 3. the Excluded veto belongs to the regular reading only --------- */
    const vetoed = [row('Cheque', '2026-08-02', -300, { excluded: true }), row('Kids Fund', '2026-08-02', 300)];
    near(moved(vetoed), 300, 'without the veto the transfer is a transfer (the default reading keeps every row)');
    near(moved(vetoed, { regular: true }), 0, 'with it, one Excluded leg makes it a windfall move, not regular saving');
    near(moved([row('Cheque', '2026-08-02', -300), row('Kids Fund', '2026-08-02', 300, { excluded: true })], { regular: true }), 0,
      'either leg');

    /* A vault this was built against: a R500 deposit took an unrelated Excluded R500
       out of another account, dated four days earlier, as its sending leg, and the
       real same-day one was left over. The nearest date wins. */
    const decoy = [row('Card', '2026-08-26', -500, { excluded: true }), row('Cheque', '2026-08-30', -500), row('Kids Fund', '2026-08-30', 500)];
    near(savedFromOutside(decoy, pool, declared, { ownLabels: new Set(['Cheque', 'Card']), regular: true }), 500,
      'the same-day leg is the deposit\'s leg, not an older equal Excluded outflow listed first');

    /* ---- 4. old callers are unchanged ------------------------------------- */
    near(savedFromOutside([row('Kids Fund', '2026-08-06', 2500)], pool, () => null), 2500,
      'no ownLabels: the old reading (any non-interest inflow) still holds for a caller that asks for it');

    /* ---- 5. a foreign fund is still no part of it ------------------------- */
    const files = { ...FILES,
      [`${B}/Accounts/Euro Fund.md`]: fund('Euro Fund', 'currency: "€"\n'),
      [`${B}/Transactions/Euro Fund/2026-08.md`]: TX([['2026-08-02', 'From cheque', 'Saving', 1000]]) };
    const ctx2 = await mount(files, '2026-08');
    near(ctx2.movedToFunds('2026-08'), 1000, 'a euro fund with a matching rand-sized deposit adds nothing');
  } finally { unpin(); }

  console.log(`PASS - moved to funds is a transfer from the household's own accounts (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
