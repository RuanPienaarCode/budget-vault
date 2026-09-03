'use strict';
/* The Ignore action on a flagged account row (3 Sep 2026 redesign, variant B).

   An account with no linked folder lands in the decision queue as `nofolder`.
   Before this action the only way to quieten it was the Edit sheet's toggles.
   The row now carries "Ignore", which appends the row's own state to
   ignore_warnings (never wider than that state), saves only that key, and the
   account leaves the queue while its pill keeps stating what it is.

   `unreadable` must NOT offer the button: it is a typo, not a judgement, and
   mutedWarnings() refuses to mute it even from a hand-written key.

     node tests/accounts-ignore-action.test.cjs
*/
const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const SRC = path.join(__dirname, '..', 'src');
const i18n = require(path.join(SRC, 'i18n.js'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const writes = [];
  ctx.patchFile = async (p, fm, body, updates) => { writes.push({ p, updates }); return fm; };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts',
    'savings', 'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, S, $, writes };
}
const B = 'Budget';
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
};

(async () => {
  /* ---- 1. nofolder: Ignore is offered, mutes exactly that state, saves one key ---- */
  {
    const { ctx, S, $, writes } = await mount({ ...BASE,
      [`${B}/Accounts/Education Fund.md`]: '---\ntype: savings\nbalance: 5000.00\nbalance_updated: 2026-08-20\n---\n' });
    ctx.renderAccounts();
    const btn = $('#acctTable').querySelectorAll('button')
      .find(b => b.textContent === i18n.t('acct.deck.ignore'));
    ok(btn, 'a flagged (nofolder) row offers Ignore');
    eq(i18n.t('acct.deck.ignore') === 'acct.deck.ignore', false, 'the label is a real string, not its key');
    btn.click();
    await new Promise(r => setTimeout(r, 0));
    eq(writes.length, 1, 'one save');
    eq(writes[0].p, 'Accounts/Education Fund.md', 'to this account\'s own file');
    eq(writes[0].updates.ignore_warnings, '[nofolder]', 'muting only the state the row was in');
    ok(!('tx_label' in writes[0].updates), 'and touching no other editable key');
    const a = S.accounts.find(x => x.name === 'Education Fund');
    eq(a.ignore_warnings, '[nofolder]', 'the model carries it for the re-render');
    const { statusOf, wantsALook } = require(path.join(SRC, 'acct-status.js'));
    const st = statusOf(a, [], '2026-09-02');
    eq(st.state, 'nofolder', 'the state is still the fact');
    eq(wantsALook(st), false, 'but it no longer wants a decision');
  }

  /* ---- 2. unreadable: never offered ---- */
  {
    const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
    const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
    const { ctx, $ } = await mount({ ...BASE,
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 10000.00\nbalance_updated: 2026-08-20\n---\n',
      [`${B}/Transactions/Cheque/2026-08.md`]: `---\n${TX_FM}\n---\n\n${HEAD}| 2026-13-05 | Grocer | Groceries | -2000.00 |  |  |  |\n` });
    ctx.renderAccounts();
    const btn = $('#acctTable').querySelectorAll('button')
      .find(b => b.textContent === i18n.t('acct.deck.ignore'));
    ok(!btn, 'an unreadable-date row offers no Ignore: a typo is not a judgement');
  }
  console.log(`accounts-ignore-action.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
