'use strict';
/* ISSUE 42 — a frozen balance beside a pill that has read ahead.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs). The Accounts page, period 1–30 September:

     Cheque           R20 000  (last confirmed 1 Sep)   pill  +R26 410
     Emergency fund   R15 000  (last confirmed 1 Sep)   pill   +R7 000
     Baby fund         R8 000  (last confirmed 1 Sep)   pill   −R5 000

   The pills were the WHOLE period's signed net. Cheque's carried gym charges
   dated the 10th, 17th and 24th and a Woolworths shop on the 12th; the
   emergency fund's R7 000 was a R2 000 transfer plus a family gift dated 28
   SEPTEMBER. Read the way a row invites — balance plus its own delta — that
   says cheque will hold R46 410, which is a forecast for the end of the month
   printed in the colours of something that has happened.

   TWO ERRORS, POINTING OPPOSITE WAYS. Rolled through today only, cheque is
   R48 300 — MORE than either figure, because the pill was also silent about
   the R35 000 salary the confirmed balance had already absorbed. One row, one
   green number, and neither of the two things a reader could take it to mean
   was true.

   WHAT IS NOT THE BUG: the balance staying at its last confirmed figure. This
   page exists to show a claim WITH ITS AGE and offer to reconcile it — the
   drift is already on screen with a button that accepts it, and a balance that
   silently rolled itself would destroy the disagreement this page is for.
   What was wrong is a delta measured over a different window from everything
   else.

   WHAT IS PINNED

     1. The pill is as-of today.
     2. The remainder is REPORTED, not dropped — it is real money still coming.
     3. So-far plus ahead is the whole period: nothing was lost in the split.
     4. A finished period is unclamped. There is no "today" inside it, and a
        past month whose pill shrank as the calendar moved would be worse than
        the bug this fixes.

     node tests/account-pill-as-of.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const i18n = require('../src/i18n');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

async function mount(period) {
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = period;
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.switchView = () => {};
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S };
}

/* The rendered pill, per account, read off the REAL table rather than off a
   function this test could call with different arguments than the page does.
   `model()` is deliberately private to views/accounts.js, and reaching past a
   view's own door to assert on its internals is how a test ends up green about
   arithmetic no reader ever sees. */
function pills(ctx) {
  const out = new Map();
  const walk = (n, fn) => { fn(n); for (const c of (n.children || [])) walk(c, fn); };
  const table = ctx.$('#acctTable');
  const rows = [];
  walk(table, n => { if (n._cls && n._cls.has('acct-row')) rows.push(n); });
  for (const tr of rows) {
    let name = null, chip = null;
    walk(tr, n => {
      if (!name && n._cls && n._cls.has('acct-name-btn')) name = n.textContent.trim();
      if (!chip && n._cls && n._cls.has('acct-chip')) chip = n.textContent.trim();
    });
    if (name) out.set(name, chip);
  }
  return out;
}

/* "+R 28300" / "−R 5000" back to a number, so the assertions can be about
   money rather than about string formatting. The minus is U+2212, which is
   what the view prints and is not the ASCII hyphen Number() understands. */
const amountOf = chip => {
  if (!chip) return null;
  const neg = chip.trim().startsWith('\u2212');
  const n = Number(chip.replace(/[^0-9.]/g, ''));
  return neg ? -n : n;
};

atAuditDate(async () => {
  /* ------------------- 1. the running period, per account ---------------- */
  {
    const { ctx } = await mount(PERIOD);
    ctx.renderAccounts();
    const p = pills(ctx);

    /* 35 000 salary − 3 500 medical − 2 000 transfer − 1 200 Checkers */
    eq(amountOf(p.get('Cheque')), 28300,
      `cheque moved +R28 300 through today, not the +R26 410 the whole month nets to — got ${p.get('Cheque')}`);
    eq(amountOf(p.get('Emergency fund')), 2000,
      `the emergency fund shows the transfer that landed, not the gift three weeks out — got ${p.get('Emergency fund')}`);
    eq(amountOf(p.get('Baby fund')), -5000,
      `the pram already happened, so it is in the pill exactly as before — got ${p.get('Baby fund')}`);
  }

  /* ---- 2. and the drawer names what the pill stopped short of ----------- */
  {
    const { ctx } = await mount(PERIOD);
    ctx.renderAccounts();
    /* The drawer opens the way a reader opens it — by clicking the row —
       rather than through a function this test would have to reach past the
       view's own door to call. */
    const walk = (n, fn) => { fn(n); for (const c of (n.children || [])) walk(c, fn); };
    let chequeRow = null;
    walk(ctx.$('#acctTable'), n => {
      if (chequeRow || !n._cls || !n._cls.has('acct-row')) return;
      let isCheque = false;
      walk(n, m => { if (m._cls && m._cls.has('acct-name-btn') && m.textContent.trim() === 'Cheque') isCheque = true; });
      if (isCheque) chequeRow = n;
    });
    ok(chequeRow, 'the cheque row is on the page to click');
    chequeRow.click();
    let txt = '';
    walk(ctx.$('#acctTable'), n => { if (n._text) txt += n._text + ' | '; });
    ok(txt.includes(i18n.t('acct.drawer.ahead')),
      `the drawer names the rows still to come — got: ${txt}`);
    ok(txt.includes(i18n.t('acct.drawer.aheadRows', { count: 5 })),
      `and how many there are — five, on the cheque account — got: ${txt}`);
    ok(txt.includes('R 1890'),
      `and what they are worth: four gym charges and a Woolworths shop — got: ${txt}`);
  }

  /* --------------- 3. a finished period is not clamped ------------------ */
  {
    const { ctx } = await mount('2026-08');
    ctx.renderAccounts();
    /* 35 000 − 3 500 − 4 000 − 4×250 */
    eq(amountOf(pills(ctx).get('Cheque')), 26500,
      'August is the whole month, exactly as it always was — a past period whose pill shrank as the calendar moved would be worse than the bug this fixes');
  }

  console.log(`PASS account-pill-as-of (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
