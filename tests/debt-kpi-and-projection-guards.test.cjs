'use strict';
/* Two independent guards, both filed against the same debt-page/debt-math
   review pass, kept in one file because both are small and both are new:

   BUG 1 — renderDebtKpis (src/views/debts.js) gated its celebratory empty
   state on `!S.debts.length` — zero ROWS — not zero ACTIVE debts. A household
   that has paid every debt off still has rows in Debts.md (status 'paid'), so
   it fell through to the ordinary tile path and rendered the exact four-
   hollow-zero-tiles shape ("Total debt R0,00", "Paying per month R0,00 ·
   nothing budgeted", "Interest this month R0,00", "Debt-free — no debt
   tracked") that renderDebtKpis's own comment says it exists to replace — for
   the one reader who most deserves the congratulation. Fixed by gating on
   worth.js's activeDebts() instead, with distinct wording for "never recorded
   a debt" vs "cleared everything recorded".

   BUG 2 — debt-math.js's expectedBalance validated `d.start` with ISO_DATE,
   which dates.js:19 documents as shape-only ("2026-13-45 passes"). A shape-
   valid, impossible start date (e.g. a day/month-swapped '2026-13-01') was
   then walked as real elapsed months and fed views/debts.js's "schedule says
   RX since {date}" line a fabricated projection dressed as arithmetic. Fixed
   by validating with dates.js's isRealIsoDate instead, which returns the same
   "cannot project" null the function already gives for a missing/blank start.

   Runs in bare node. Wired into ./build.sh via scripts/run-tests.mjs.
     node tests/debt-kpi-and-projection-guards.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { expectedBalance } = require('../src/debt-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ============================================================================
   §BUG 1 — the paid-off-book empty state
   ============================================================================ */
const B = 'Budget';
const PAID_OFF_FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Old card | Bank A | credit card | 0.00 | 5000.00 | 20.00 | 500.00 | 0.00 | 2022-01-01 | | paid | |\n',
};

async function mountDebts(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $, nodes } = makeDom();
  $('#debtExtra').value = '';
  $('#debtStrategy').value = 'avalanche';
  ctx.$ = $;
  ctx.root = $('#root');
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/debts')(ctx);
  return { ctx, S, nodes };
}

(async () => {
  /* A book with S.debts.length === 1 (one paid-off row) must get the
     congratulatory panel, not the four-zero-tile skeleton. */
  {
    const { ctx, S, nodes } = await mountDebts(PAID_OFF_FILES);
    ok(S.debts.length === 1 && S.debts[0].status === 'paid',
      'fixture sanity: one row, status paid — the exact shape that used to slip past `!S.debts.length`');
    ctx.renderDebts();
    const text = nodes.get('#debtKpis').textContent;
    ok(!/Total debt/.test(text),
      'a fully paid-off debt book must NOT fall through to the ordinary "Total debt" tile path');
    ok(/Debt-free/.test(text) && /paid/i.test(text),
      'it must instead render a congratulatory panel naming the debt as paid off');
    // The two empty-state sentences must actually differ — "never recorded"
    // is not an achievement, "cleared everything recorded" is.
    ok(!text.includes('No debt tracked — nothing owing here.'),
      'the paid-off case must use its OWN wording, not the "never recorded a debt" sentence');
  }

  /* And the sibling case — truly zero rows — must still get the original
     "never recorded a debt" sentence, unchanged. Guards against a fix that
     collapsed both states into one generic message. */
  {
    const files = { [`${B}/Settings.md`]: PAID_OFF_FILES[`${B}/Settings.md`] };
    const { ctx, S, nodes } = await mountDebts(files);
    ok(S.debts.length === 0, 'fixture sanity: genuinely no Debts.md rows at all');
    ctx.renderDebts();
    const text = nodes.get('#debtKpis').textContent;
    ok(text.includes('No debt tracked — nothing owing here.'),
      'a vault that has never recorded a debt keeps its original, distinct empty-state sentence');
  }

  /* ==========================================================================
     §BUG 2 — expectedBalance must reject a shape-valid, impossible start date
     ========================================================================== */
  {
    const good = { original: 10000, payment: 500, extra: 0, rate: 12, start: '2024-01-15', balance: 6000 };
    const proj = expectedBalance(good, '2026-01-15');
    ok(proj && Number.isFinite(proj.expected),
      'sanity: a REAL start date still projects normally');
  }
  {
    // '2026-04-31' is shape-valid for ISO_DATE (\d{4}-\d{2}-\d{2}) but April
    // has 30 days — the exact case dates.js:19 calls out ("2026-13-45 passes")
    // and isRealIsoDate exists to reject. No `balance` field, so the separate
    // "balance disagrees with cash that could have been paid" guard a few
    // lines down (gated on Number.isFinite(d.balance)) stays out of the way —
    // this probes the DATE check alone. Confirmed against the pre-fix code
    // (ISO_DATE only) that this exact fixture returns a real, non-null
    // projection {months:3, expected:8787.96,...} instead of the null a
    // "cannot project" input should give.
    const impossible = { original: 10000, payment: 500, extra: 0, rate: 12, start: '2026-04-31' };
    const proj = expectedBalance(impossible, '2026-08-15');
    ok(proj === null,
      'expectedBalance must refuse to project from a shape-valid but impossible start date (2026-04-31, '
      + 'April has 30 days), returning the same "cannot project" null it gives for a missing start — '
      + 'not a fabricated month count and balance');
  }
  {
    // Same trap, a different impossible calendar day — 30 February. Confirmed
    // against pre-fix code that this also silently produced a real projection
    // ({months:5, expected:7959.60,...}).
    const feb30 = { original: 10000, payment: 500, extra: 0, rate: 12, start: '2026-02-30' };
    const proj = expectedBalance(feb30, '2026-08-15');
    ok(proj === null,
      'expectedBalance must refuse an impossible day-of-month (2026-02-30) the same way monthOf was '
      + 'fixed for the identical shape-vs-real trap in 1.23.0');
  }

  console.log(`PASS — debt-kpi-and-projection guards: ${checks} assertions.`);
})().catch(e => { console.error(e); process.exit(1); });
