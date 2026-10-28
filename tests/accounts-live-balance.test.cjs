'use strict';
/* The Accounts page leads with the balance the transactions say, not the one
   last typed (GitHub discussion #124, 2 Oct 2026).

   THE REPORT. "Why transactions don't lower balance?" — a new user added
   spending to a cheque account and the figure on the Accounts page did not
   move. Nothing was broken: the row printed the STATED balance (the
   `balance:` line, a claim with an age) and parked the difference in a red
   "doesn't match" pill with a "Use R…" button. The Dashboard's position tile
   meanwhile printed the IMPLIED balance for the same account. Two pages, two
   numbers, and the one the reader looked at was the one that never moves.

   THE OTHER HALF. reconcile() takes a row dated ON the confirmation day as
   already inside the figure. Type today's balance, then log today's coffee,
   and the coffee never counts — under a green "agrees". That is correct for a
   bank figure read after the day's postings and wrong for a figure typed
   first, and the file cannot say which. So the app says it, at the two places
   a reader can act on it: the toast when the row is added, and the account's
   drawer. Neither moves the date for them — the drawer's button opens the
   balance dialog, whose as-at field is the answer.

   No row-level "Count them" button: acceptImplied() stamps the date of the
   last row it absorbed, so EVERY reconciled account carries same-day rows that
   genuinely are inside its figure. A one-tap "count these" on the row would
   add them twice on exactly the accounts that were just put right.

   WHAT IS PINNED (the audit household, today 2 Sep 2026, every balance
   confirmed 1 Sep):

     1. The row's figure is the implied balance: Cheque R20 000 typed, then
        −R1 200 on the 2nd → R18 800. Accounts with nothing since keep their
        typed figure.
     2. The typed figure is still on the row, with its date and the movement
        since — the disagreement is shown, not erased.
     3. The hero, the group subtotal and the balance sort read the same
        figure as the rows, so the page adds up to itself.
     4. A drift is a prompt to confirm, not an alarm: warning tone, and the
        button says Confirm.
     5. The drawer names the same-day rows and offers the balance dialog.
     6. Adding a row dated on or before its account's balance date says so.

     node tests/accounts-live-balance.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

const seen = { fields: [] };
const answers = { fields: null };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return true; },
    async askFields(_app, title, fields) { seen.fields.push({ title, fields }); return answers.fields; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const { makeDom, readable } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const i18n = require('../src/i18n');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

async function mount() {
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/transactions')(ctx);
  require('../src/views/accounts')(ctx);
  ctx.render = () => ctx.renderAccounts();
  ctx.switchView = () => {};
  return { ctx, S };
}

const walk = (n, fn) => { fn(n); for (const c of (n.children || [])) walk(c, fn); };
const has = (n, cls) => !!(n && n._cls && n._cls.has(cls));
const textOf = n => { let s = ''; walk(n, m => { if (m._text) s += m._text; }); return s; };
/* "R 18800.00" → 18800. The harness's moneyIn prints a plain fixed figure. */
const num = s => Number(String(s).replace(/[^0-9.\-]/g, ''));

/* Each account row, keyed by name, with the parts this file asserts on. */
function rowsOf(ctx) {
  const out = new Map();
  walk(ctx.$('#acctTable'), tr => {
    if (!has(tr, 'acct-row')) return;
    const r = { tr, name: null, bal: null, sub: null, pill: null };
    walk(tr, n => {
      if (!r.name && has(n, 'acct-name-btn')) r.name = textOf(n).trim();
      if (!r.bal && has(n, 'acct-bal')) r.bal = n;
      if (!r.sub && has(n, 'acct-bal-sub')) r.sub = n;
      if (!r.pill && has(n, 'acct-pill')) r.pill = n;
    });
    if (r.name) out.set(r.name, r);
  });
  return out;
}

atAuditDate(async () => {
  /* ------------- 1 + 2. the row leads with the implied figure ------------ */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    const rows = rowsOf(ctx);

    eq(num(textOf(rows.get('Cheque').bal)), 18800,
      'Cheque reads R18 800 — R20 000 typed on the 1st, less the R1 200 Checkers shop on the 2nd');
    eq(num(textOf(rows.get('Emergency fund').bal)), 15000,
      'an account with nothing dated since its confirmation keeps its typed figure');
    eq(num(textOf(rows.get('Baby fund').bal)), 8000, 'and so does the baby fund');

    const sub = rows.get('Cheque').sub;
    ok(sub, 'the drifting row still shows what was typed');
    const subTxt = readable(textOf(sub));
    eq(subTxt, readable(i18n.t('acct.row.typedAsAt', {
      stated: 'R 20000.00', date: ctx.dateText('2026-09-01'), delta: '−R 1200.00' })),
    `the sub-line names the typed figure, its date and the movement since — got "${subTxt}"`);
    ok(!rows.get('Emergency fund').sub, 'no sub-line where the two figures are the same');
  }

  /* ------------- 3. the page adds up to its own rows --------------------- */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    let heroNum = null, bankTotal = null;
    walk(ctx.$('#acctSummary'), n => { if (heroNum === null && has(n, 'hero-num')) heroNum = num(textOf(n)); });
    walk(ctx.$('#acctTable'), n => {
      if (bankTotal === null && n.attrs && n.attrs['data-fig'] === 'acct-group-total') bankTotal = num(textOf(n));
    });
    eq(heroNum, 41800, 'the hero is the sum of the rows: 18 800 + 15 000 + 8 000');
    eq(bankTotal, 18800, 'the Bank group subtotal is the cheque row it sits over');

    let heroTxt = '';
    walk(ctx.$('#acctSummary'), n => { if (has(n, 'hero-sub')) heroTxt += textOf(n); });
    ok(readable(heroTxt).includes(readable(i18n.t('acct.hero.driftDown', { amount: 'R 1200.00' }))),
      `the hero says how far the typed balances sit from it — got "${heroTxt}"`);
  }

  /* ------------- 4. a drift asks to be confirmed ------------------------- */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    const pill = rowsOf(ctx).get('Cheque').pill;
    ok(has(pill, 'warn') && !has(pill, 'danger'), 'the drift pill is a warning, not an error');
    let btnTxt = '';
    walk(rowsOf(ctx).get('Cheque').tr, n => { if (has(n, 'acct-deck-btn') && !has(n, 'ghost')) btnTxt += textOf(n); });
    eq(readable(btnTxt).trim(), readable(i18n.t('acct.deck.do.drift', { amount: 'R 18800.00' })),
      'the one-tap answer confirms the figure the row already shows');
    ok(/confirm/i.test(i18n.t('acct.deck.do.drift', { amount: 'x' })), 'and says Confirm in English');
  }

  /* ------------- 5. the drawer names the same-day rows ------------------- */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    rowsOf(ctx).get('Emergency fund').tr.click();
    let drawer = null;
    walk(ctx.$('#acctTable'), n => { if (!drawer && has(n, 'acct-drawer')) drawer = n; });
    ok(drawer, 'the emergency fund drawer opens');
    const want = i18n.t('acct.drawer.sameDay', { count: 1, date: ctx.dateText('2026-09-01'), amount: '+R 2000.00' });
    ok(readable(textOf(drawer)).includes(readable(want)),
      `the drawer says the R2 000 transfer dated the 1st is taken as already in — got "${textOf(drawer)}"`);

    let btn = null;
    walk(drawer, n => { if (!btn && has(n, 'acct-sameday-btn')) btn = n; });
    ok(btn, 'with a button beside it');
    answers.fields = null;   // the reader cancels — nothing is written
    seen.fields.length = 0;
    btn.click();
    await new Promise(r => setImmediate(r));
    ok(seen.fields.length === 1 && seen.fields[0].fields.some(f => f.key === 'as_at'),
      'which opens the balance dialog, where the as-at date is set');

    /* The baby fund's pram is money OUT on the confirmation day. */
    const { ctx: c2 } = await mount();
    c2.renderAccounts();
    rowsOf(c2).get('Baby fund').tr.click();
    let d2 = null;
    walk(c2.$('#acctTable'), n => { if (!d2 && has(n, 'acct-drawer')) d2 = n; });
    ok(readable(textOf(d2)).includes(readable(i18n.t('acct.drawer.sameDay', {
      count: 1, date: c2.dateText('2026-09-01'), amount: '−R 5000.00' }))),
    `money out is signed as money out — got "${textOf(d2)}"`);
  }

  /* ------------- 6. adding a row the balance will not count -------------- */
  {
    const { ctx } = await mount();
    ctx.renderTransactions();
    const lastToast = () => readable((ctx._toasts[ctx._toasts.length - 1] || {}).msg || '');
    const note = readable(i18n.t('tx.add.beforeBalance', { account: 'Cheque', date: ctx.dateText('2026-09-01') }));

    answers.fields = { date: '2026-09-01', desc: 'Coffee', label: 'Cheque', dir: 'out', amount: '30', cat: '', note: '' };
    await ctx.addTransaction();
    ok(lastToast().includes(note), `a row dated ON the balance date says it is taken as already in — got "${lastToast()}"`);

    answers.fields = { date: '2026-08-30', desc: 'Parking', label: 'Cheque', dir: 'out', amount: '20', cat: '', note: '' };
    await ctx.addTransaction();
    ok(lastToast().includes(note), 'and so does one dated before it');

    answers.fields = { date: '2026-09-02', desc: 'Bread', label: 'Cheque', dir: 'out', amount: '18', cat: '', note: '' };
    await ctx.addTransaction();
    ok(!lastToast().includes(note), 'a row dated after the balance date counts, and the toast says nothing extra');
  }

  console.log(`PASS accounts-live-balance (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
