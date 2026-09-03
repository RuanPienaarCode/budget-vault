'use strict';
/* ISSUE 53 — correcting the account did not recompute the sign verdict, so a
   credit-card statement could import every purchase as INCOME under a green
   "amounts check out" banner.

   THE DEFECT. `rec` — the reconcile verdict that decides whether amounts are
   flipped — was computed ONCE inside runImport, from
   `accountForLabel(label0)`: the filename/preamble guess. An account the
   importer cannot identify keeps the ASSET reading, deliberately, because
   guessing a sign is the one thing that block exists to avoid.

   The reader then picks the card in the account select. renderImportReview
   re-runs applyCounterparties on every account change — this file's own header
   says the guess failing is "the ordinary case for any hand-saved or renamed
   export, not an edge one" — and never recomputed `rec`, `flipped` or
   `inverted`. The verdict, the banner and every amount stayed on the reading
   taken before the reader corrected it, straight through commitImport.

   A credit card's balance column is the amount OWING and rises when you spend,
   so the relation the ledger must satisfy is the opposite of an asset
   account's. The same file reconciles under both readings — only the account
   can say which is right:

     read as ASSET      1200, 340.50, 99, -500, 210.25, 45
     read as LIABILITY -1200, -340.50, -99, 500, -210.25, -45

   WHY IT WAS NOT A ONE-LINER. The old code negated `it.amount` IN PLACE, so
   simply calling the computation again would negate a second time. The verdict
   now reads `amount0` (the unflipped parsed value, stamped once) and writes
   `amount`, which makes it idempotent — it can run on every render, however
   many times, and land on the same numbers.

   WHAT IS PINNED

     1. The verdict follows the account the reader actually picked.
     2. Re-rendering does not double-negate — the invariant that makes (1)
        safe, asserted over repeated renders rather than assumed.
     3. Switching back restores the original reading exactly.
     4. The banner tracks the verdict, so the reassuring sentence cannot sit
        over a file that was just read backwards.

     node tests/import-sign-follows-account.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const registerImport = require('../src/views/import');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { FakeEl } = makeDom();

/* A card statement: the balance column is the amount OWING and RISES as the
   household spends, which is what makes the asset reading reconcile with every
   sign inverted. */
const CSV = [
  'Date,Description,Amount,Balance',
  '2026-08-01,WOOLWORTHS,1200.00,1200.00',
  '2026-08-02,ENGEN,340.50,1540.50',
  '2026-08-03,SPOTIFY,99.00,1639.50',
  '2026-08-04,PAYMENT RECEIVED,-500.00,1139.50',
  '2026-08-05,CHECKERS,210.25,1349.75',
  '2026-08-06,UBER,45.00,1394.75',
].join('\n') + '\n';

const CARD = { name: 'Visa', tx_label: 'Visa', type: 'credit_card', balance: -1394.75 };

function makeCtx() {
  const els = {};
  const ctx = {
    S: {
      settings: { currency: 'R', country: 'za', month_start_day: 1 },
      accounts: [CARD], categories: [], rules: [], txFiles: {}, budgets: {}, period: '2026-08',
    },
    $: sel => (els[sel] ||= new FakeEl('div')),
    $$: () => [],
    app: {},
    money: v => `R ${Number(v).toFixed(2)}`,
    moneyIn: (s, v) => `${s} ${Number(v).toFixed(2)}`,
    toast() {},
    async writeFile() {},
    currentPeriod: () => '2026-08',
    periodRange: () => ({ start: '2026-08-01', end: '2026-08-31' }),
    periodTitle: () => 'Aug 2026',
    deferredCatSelect: () => new FakeEl('select'),
    serializeTxFile: () => '',
    locale: () => ({ dayFirst: false, thousands: ',', decimal: '.', banks: null, importHint: '' }),
    learnRules() {},
    txSegment: s => s,
    /* The crux: the importer cannot identify the account from the filename, so
       the parse-time guess is null and the ASSET reading is taken. */
    accountForLabel: label => (label === 'Visa' ? CARD : null),
    provide(obj) { Object.assign(ctx, obj); },
    _els: els,
  };
  return ctx;
}

const file = text => ({ name: 'statement.csv', async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });
const amounts = ctx => ctx.S.pendingImport.items.map(i => i.amount);

(async () => {
  const ctx = makeCtx();
  registerImport(ctx);
  await ctx.handleStatementFile(file(CSV));

  const p = ctx.S.pendingImport;
  ok(p, 'the statement parsed');
  eq(p.label, '', 'and the importer could not identify the account from the filename');

  /* ---- 1. the parse-time reading, unchanged ---- */
  const asAsset = amounts(ctx);
  eq(asAsset, [1200, 340.5, 99, -500, 210.25, 45],
    'an unidentified account keeps the asset reading — guessing a sign is what that block avoids');
  ok(p.reconcile && p.reconcile.verified, 'and the file reconciles under it');
  eq(p.reconcile.flipped, false, 'so nothing is flipped yet');

  /* ---- 2. the reader corrects the account ---- */
  p.label = 'Visa';
  ctx.renderImportReview();
  eq(amounts(ctx), [-1200, -340.5, -99, 500, -210.25, -45],
    'once the card is picked, the verdict follows it and every purchase is an outgoing');
  eq(p.reconcile.flipped, true, 'the verdict itself says so');
  ok(p.reconcile.verified, 'and the file still reconciles — both readings are arithmetically consistent, which is the trap');

  /* ---- 3. idempotent: the invariant that makes (2) safe ---- */
  ctx.renderImportReview();
  ctx.renderImportReview();
  eq(amounts(ctx), [-1200, -340.5, -99, 500, -210.25, -45],
    're-rendering does not negate a second time — the old in-place flip is why this needed proving');

  /* ---- 4. and switching back restores the original reading ---- */
  p.label = '';
  ctx.renderImportReview();
  eq(amounts(ctx), asAsset,
    'switching away from the card restores the asset reading exactly, not an approximation of it');

  /* ---- 5. the banner tracks the verdict ---- */
  p.label = 'Visa';
  ctx.renderImportReview();
  const CORRECTED = 'money out shows as negative below';
  const REASSURING = 'Amounts check out against this statement';
  const banner = ctx._els['#impReconcile'];
  ok(banner.textContent.includes(CORRECTED),
    `the banner says the file was corrected — got: ${banner.textContent}`);
  ok(!banner.textContent.includes(REASSURING),
    'and never the reassuring sentence over a file that was just read backwards');

  /* The other direction, so the assertion above is not passing by accident:
     back on the asset reading the banner IS the reassuring one, because under
     that reading the file genuinely does check out. */
  p.label = '';
  ctx.renderImportReview();
  ok(ctx._els['#impReconcile'].textContent.includes(REASSURING),
    `and the unflipped reading gets the plain verdict — got: ${ctx._els['#impReconcile'].textContent}`);

  console.log(`PASS import-sign-follows-account (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
