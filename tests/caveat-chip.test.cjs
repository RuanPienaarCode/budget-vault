'use strict';
/* ITEM 4 — tap-to-expand caveat chip: the component itself, and three of the
   real sites it replaced a hover-only `title=` at.

   A `title=` attribute is a hover tooltip — invisible on iOS/Android, which
   have no hover — so a caveat that lived only in one silently disappeared on
   the platform this plugin ships to as a first-class target, not a fallback
   one. caveatChip (src/dom.js) renders the short version as a real, focusable
   `<button>` that reveals an inline detail line on tap, keeping `title` too as
   a free desktop-hover bonus.

   §A pins the component in isolation: a real <button>, `aria-expanded`
   starting false, a detail line that starts hidden and toggles on tap.

   §B/§C/§D mount the REAL views (debts, savings, accounts) over the dom-stub
   harness and prove the caveat actually reaches the rendered page as a
   tappable button carrying the same text the old `title=` alone used to carry
   — not merely that the source text happens to mention caveatChip.

   Runs in bare node. Wired into ./build.sh via scripts/run-tests.mjs.
     node tests/caveat-chip.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, installDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const hasCls = (el, cls) => el.className.split(/\s+/).includes(cls);

(async () => {
  /* ==========================================================================
     §A — the component in isolation
     ========================================================================== */
  installDom();
  const { caveatChip } = require('../src/dom');

  {
    const wrap = caveatChip('short text', 'the longer explanation');
    eq(wrap.className, 'caveat-chip', 'wraps in its own class');
    const btn = wrap.children.find(c => c.tagName === 'BUTTON');
    ok(btn, 'renders a real <button>, not a span styled to look like one');
    eq(btn.getAttribute('type'), 'button',
      'type=button — it must never submit a form it happens to be mounted inside');
    eq(btn.getAttribute('aria-expanded'), 'false', 'starts collapsed');
    eq(btn.getAttribute('title'), 'the longer explanation', 'title kept as the free desktop-hover bonus');
    eq(btn.textContent, 'short text', 'the button itself carries the short text');

    const detail = wrap.children.find(c => c !== btn);
    ok(detail, 'a detail element sits alongside the button');
    ok(hasCls(detail, 'hidden'),
      'NEGATIVE CONTROL: the detail starts hidden — a chip that showed its detail by default would fail this');
    eq(detail.textContent, 'the longer explanation', 'the detail line carries the FULL text, not a truncation');

    btn.click();
    eq(btn.getAttribute('aria-expanded'), 'true', 'a tap opens it');
    ok(!hasCls(detail, 'hidden'), 'and reveals the detail line');

    btn.click();
    eq(btn.getAttribute('aria-expanded'), 'false', 'a second tap closes it again');
    ok(hasCls(detail, 'hidden'), 'and hides the detail line again');
  }

  /* ==========================================================================
     §B — the Debt page: the "Interest still to pay" header, and the
     "on this plan it would be…" derivation note (views/debts.js)
     ========================================================================== */
  {
    // Pinned so expectedBalance()'s "months elapsed since start" arithmetic is
    // deterministic — a real-clock read here would make the material-gap
    // branch below drift in and out of range with the calendar.
    const RealDate = Date;
    class PinnedDate extends RealDate {
      constructor(...a) { if (a.length) { super(...a); } else { super(2026, 7, 15, 12, 0, 0); } }
      static now() { return new PinnedDate().getTime(); }
    }
    global.Date = PinnedDate;

    /* Original 12000, 0% interest, R500/mo, opened 2024-01-01. By 2026-08-15,
       31 whole calendar months have elapsed (24 of them enough to clear the
       loan on schedule) — the schedule expects R0 owed. The file still says
       R8 000 — a R8 000 gap, far past the material threshold
       (max(50, original*0.02) = R240), so the derivation note renders. */
    const FILES = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
        + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
        + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
        + '| Card | Bank A | credit card | 8000.00 | 12000.00 | 0.00 | 500.00 | 0.00 | 2024-01-01 | | active | |\n',
    };

    const ctx = makeCtx(FILES);
    const S = await loadInto(ctx);
    S.period = '2026-08';
    const { $ } = makeDom();
    $('#debtExtra').value = '';
    $('#debtStrategy').value = 'avalanche';
    ctx.$ = $;
    ctx.root = $('#root');
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    require('../src/views/debts')(ctx);
    ctx.renderDebts();

    const table = $('#debtTable');
    const chips = table.querySelectorAll('.caveat-chip-btn');

    const headerBtn = chips.find(b => b.textContent === 'Interest still to pay');
    ok(headerBtn, 'the "Interest still to pay" column header is a real caveatChip button, not a bare title=');
    eq(headerBtn.getAttribute('title'),
      'Total interest still to be paid before this debt clears, at the balance, rate and payment as entered',
      'and still carries the full explanation as its title, for a desktop hover');

    const derivedBtn = chips.find(b => /on this plan it would be/.test(b.textContent));
    ok(derivedBtn, 'the "on this plan it would be…" derivation note is a real caveatChip button');
    ok(/schedule puts this at/.test(derivedBtn.getAttribute('title')),
      'and its title still carries the full derivation, the same sentence a hover used to show alone');

    derivedBtn.click();
    const detail = derivedBtn.parentElement.querySelectorAll('.caveat-chip-detail')[0];
    ok(detail && !hasCls(detail, 'hidden'),
      'tapping the derivation chip reveals the full derivation inline — reachable on a phone, not just a mouse');

    global.Date = RealDate;
  }

  /* ==========================================================================
     §C — the Savings page: "based on the account file, not transactions"
     (views/savings.js, the renderReturn/`r.basis === 'stated'` path)
     ========================================================================== */
  {
    const FILES = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      // total_invested set (NOT starting_amount — that would earn totalReturn's
      // OWN 'measured' basis instead), and no Transactions/Fund folder at all:
      // no rows to derive a split from, so totalReturn() falls back to its
      // 'stated' basis — balance minus total_invested, the same fallback
      // accountFlows() makes and no stronger a claim.
      [`${B}/Accounts/Fund.md`]: '---\ntype: investment\ntx_label: "Fund"\nbalance: 90000\n'
        + 'total_invested: 70000\nbalance_updated: 2026-08-01\n---\n',
    };

    const ctx = makeCtx(FILES);
    const S = await loadInto(ctx);
    S.period = '2026-08';
    const { $ } = makeDom();
    ctx.$ = $;
    ctx.root = $('#root');
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    require('../src/views/savings')(ctx);
    ctx.renderSavings();

    const chips = $('#savingsSections').querySelectorAll('.caveat-chip-btn');
    const btn = chips.find(b => b.textContent === 'based on the account file, not transactions');
    ok(btn, 'the stated-basis caveat renders as a real caveatChip button, not a bare title=');
    ok(/No transactions in the vault/.test(btn.getAttribute('title')),
      'and its title still carries the full explanation');

    btn.click();
    const detail = btn.parentElement.querySelectorAll('.caveat-chip-detail')[0];
    ok(detail && !hasCls(detail, 'hidden'), 'tapping it reveals the explanation inline');
  }

  /* ==========================================================================
     §D — the Accounts page: the muted reconciliation-state pill
     (views/accounts.js's statePill(), `acct.mutedTitle`)
     ========================================================================== */
  {
    const FILES = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      // No Transactions/Cash folder at all -> state 'nofolder'; ignore_warnings
      // mutes it -> muted:true, the branch statePill() special-cases.
      [`${B}/Accounts/Cash.md`]: '---\ntype: cash\nbalance: 500.00\nbalance_updated: 2026-07-01\nignore_warnings: true\n---\n',
    };

    const ctx = makeCtx(FILES);
    const S = await loadInto(ctx);
    S.period = '2026-08';
    const { $ } = makeDom();
    ctx.$ = $;
    ctx.$$ = () => [];
    ctx.root = $('#root');
    ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    const { el } = require('../src/dom');
    ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
    ctx.switchView = () => {};
    require('../src/categories')(ctx);
    require('../src/views/accounts')(ctx);
    ctx.renderAccounts();

    const pill = $('#acctTable').querySelectorAll('.acct-pill').find(p => hasCls(p, 'muted'));
    ok(pill, 'fixture sanity: the muted pill actually rendered');
    const btn = pill.querySelectorAll('.caveat-chip-btn')[0];
    ok(btn, 'the muted pill carries a real caveatChip button, not a bare title=');
    ok(!pill.attrs.title, 'NEGATIVE CONTROL: the OLD shape put the explanation on the outer pill\'s own title — that attribute is gone now');
    ok((btn.getAttribute('title') || '').length > 0, 'the explanation moved to the button\'s own title, not lost');

    btn.click();
    const detail = btn.parentElement.querySelectorAll('.caveat-chip-detail')[0];
    ok(detail && !hasCls(detail, 'hidden'), 'tapping it reveals why the warning is quiet');
  }

  console.log(`PASS — caveatChip: the component, and the Debt/Savings/Accounts sweep (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
