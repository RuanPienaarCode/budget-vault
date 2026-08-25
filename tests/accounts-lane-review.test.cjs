'use strict';
/* Four fixes from the Accounts-lane pass of the 13-agent comprehension audit,
   pinned against the real view rather than trusted by inspection.

     1. CARD OVERLAP DISCLOSURE — a credit card tracked as BOTH an Accounts
        page row and a Debt-page row double-counts in the hero's own net
        figure. The Dashboard and the Savings worth chart already said so;
        this page (and the Debt page, fixed separately) did not.
     2. EMPTY VAULT — a brand-new vault with zero accounts used to render a
        "Net across your accounts R 0,00" hero over a bordered, empty ring.
        renderDeck already bails on `!S.accounts.length`; renderSummary now
        follows the same rule.
     3. STARTING-AMOUNT DESCRIPTION — every neighbouring optional field in the
        edit dialog (invested, currency, limit) carries a `desc` explaining
        what it feeds; starting_amount, the WHOLE basis for the Savings page's
        Growth tile, carried none.
     4. FIELD-NAMED VALIDATION — acct.err.nan and acct.err.type used to fire
        with no field name and no example of a valid answer. Both call sites
        of each now pass `field` + `example` params.

   Runs in bare node against the real view, same harness as
   tests/accounts-audit-fixes.test.cjs.
     node tests/accounts-lane-review.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

/* Same programmable modal stub as accounts-audit-fixes.test.cjs, installed
   BEFORE anything requires views/accounts.js for the same reason — that
   module destructures askFields/confirmModal off '../modal' at REQUIRE time. */
const modalPath = require.resolve('../src/modal.js');
const modalAnswers = { confirm: true, fields: null };
const modalSeen = { fields: [] };
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return modalAnswers.confirm; },
    async askFields(app, title, fields) { modalSeen.fields.push({ title, fields }); return modalAnswers.fields; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

/* A spy on the REAL i18n.t, not a stub — every unrelated call in this file
   (headers, labels, the deck, the ring) still needs a real translation, so
   this wraps the shared module's own function rather than replacing it.
   accounts.js resolves `i18n.t(...)` dynamically off the same namespace
   object on every call, so patching the property here is visible to it. */
const i18n = require('../src/i18n');
const realT = i18n.t;
const tCalls = [];
i18n.t = function spyT(key, params) { tCalls.push({ key, params }); return realT(key, params); };

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const textOf = root => descend(root).map(n => n.textContent || '').join(' | ');

async function mount(files, settingsFm = 'currency: "R"\n') {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: `---\nmonth_start_day: 1\ncountry: za\n${settingsFm}---\n`,
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    ...files,
  });
  const S = await loadInto(ctx);
  S.period = '2026-07';
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
  return { ctx, S, $ };
}

const DEBT_HEAD = '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start | Category | Status | Notes |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n';

(async () => {
  /* ---- 1. the card-overlap disclosure appears on the Accounts hero ---- */
  {
    const { ctx, S } = await mount({
      [`${B}/Accounts/Visa.md`]: '---\ntype: credit_card\ncredit_limit: 5000\nbalance: -2000.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Debts.md`]: `---\nkind: debts\n---\n\n${DEBT_HEAD}`
        + '| Visa | Bank | credit card | 2000 | 2000 | 21 | 500 | 0 | 2025-01-01 | Debt | active |  |\n',
    });
    ctx.renderAccounts();
    const summaryTxt = textOf(ctx.$('#acctSummary'));
    ok(/counted twice/i.test(summaryTxt),
      `the hero band discloses the double-count when a card sits on both pages (summary text: ${summaryTxt})`);
    void S;
  }

  /* ---- 1b. negative control: no matching debt row, no disclosure ---- */
  {
    const { ctx } = await mount({
      [`${B}/Accounts/Visa.md`]: '---\ntype: credit_card\ncredit_limit: 5000\nbalance: -2000.00\nbalance_updated: 2026-07-01\n---\n',
    });
    ctx.renderAccounts();
    const summaryTxt = textOf(ctx.$('#acctSummary'));
    ok(!/counted twice/i.test(summaryTxt),
      `no disclosure when the card is tracked on this page ONLY, not also on the Debt page (summary text: ${summaryTxt})`);
  }

  /* ---- 2. an account-less vault renders no hero, no ring ---- */
  {
    const { ctx, S } = await mount({});
    eq(S.accounts.length, 0, 'the fixture really has no accounts');
    ctx.renderAccounts();
    const wrap = ctx.$('#acctSummary');
    eq(descend(wrap).filter(n => n !== wrap).length, 0,
      'renderSummary renders nothing at all for a zero-account vault — no "R 0,00" hero, no empty ring card');
  }

  /* ---- 2b. negative control: one real account still gets the full band ---- */
  {
    const { ctx } = await mount({
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    });
    ctx.renderAccounts();
    const wrap = ctx.$('#acctSummary');
    ok(descend(wrap).some(n => n._cls && n._cls.has('hero')),
      'a vault with one real account still renders the hero — the guard is scoped to the empty case only');
  }

  /* ---- 3. starting_amount carries a description in the edit dialog ---- */
  {
    const { ctx, S } = await mount({
      [`${B}/Accounts/Fund.md`]: '---\ntype: investment\nbalance: 10000.00\nbalance_updated: 2026-07-01\n---\n',
    });
    const fund = S.accounts.find(a => a.name === 'Fund');
    modalAnswers.fields = null;               // editAccount returns immediately on a null result
    modalSeen.fields.length = 0;
    await ctx.editAccount(fund);
    const asked = modalSeen.fields[modalSeen.fields.length - 1];
    ok(asked, 'editAccount opened its dialog');
    const field = asked.fields.find(f => f.key === 'starting_amount');
    ok(field, 'starting_amount is offered for an investment account');
    ok(field.desc && field.desc.trim().length > 0,
      `starting_amount now carries a desc, like invested/currency/limit already do (desc: ${JSON.stringify(field.desc)})`);
  }

  /* ---- 4a. acct.err.nan names the field and shows an example (editBalance) ---- */
  {
    const { ctx, S } = await mount({
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    });
    const cheque = S.accounts.find(a => a.name === 'Cheque');
    modalAnswers.fields = { balance: 'not a number at all', as_at: '2026-07-01' };
    tCalls.length = 0;
    await ctx.editBalance(cheque);
    const call = tCalls.find(c => c.key === 'acct.err.nan');
    ok(call, 'acct.err.nan fired for an unparseable balance');
    ok(call.params && call.params.field, `the field name is passed (params: ${JSON.stringify(call.params)})`);
    ok(call.params && call.params.example, `a valid example is passed (params: ${JSON.stringify(call.params)})`);
    eq(call.params.field, realT('acct.balance.field'), 'the field named is the one the dialog actually showed ("New balance")');
  }

  /* ---- 4b. acct.err.nan on addAccount names WHICH of three fields failed ---- */
  {
    const { ctx } = await mount({}, 'currency: "R"\n');
    modalAnswers.fields = {
      name: 'Pot', type: 'savings', institution: '', balance: '1000',
      currency: '', goal_amount: 'not-a-number', budget: 'yes',
    };
    tCalls.length = 0;
    const created = await ctx.addAccount();
    eq(created, null, 'addAccount refuses to create the account on a bad optional figure');
    const call = tCalls.find(c => c.key === 'acct.err.nan');
    ok(call, 'acct.err.nan fired');
    eq(call.params.field, realT('acct.field.goalOpt'),
      `the SAVINGS GOAL field is named, not a generic "not a number" (params: ${JSON.stringify(call.params)})`);
  }

  /* ---- 4c. acct.err.type names the field and offers a real example ---- */
  {
    const { ctx, S } = await mount({
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    });
    const cheque = S.accounts.find(a => a.name === 'Cheque');
    modalAnswers.fields = { type: 'not-a-real-type', institution: '', account_number: '',
      tx_label: '', currency: '', budget: 'yes', ignore_warnings: [] };
    tCalls.length = 0;
    await ctx.editAccount(cheque);
    const call = tCalls.find(c => c.key === 'acct.err.type');
    ok(call, 'acct.err.type fired for a type outside ACCT_TYPES');
    eq(call.params.field, realT('acct.field.type'), 'the field name is passed');
    ok(call.params.example, `a real, valid example type is offered (params: ${JSON.stringify(call.params)})`);
  }

  i18n.t = realT;
  console.log(`PASS — accounts lane review: card-overlap disclosure, empty-vault summary, `
    + `starting_amount description, field-named validation (${checks} checks).`);
})().catch(e => { i18n.t = realT; console.error(e); process.exit(1); });
