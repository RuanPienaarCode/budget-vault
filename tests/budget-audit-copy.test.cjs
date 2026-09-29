'use strict';
/* Two pieces of user-facing copy that told the wrong story.

   1. "Set category" on the Transactions toolbar, with no filter chosen, toasted
      tx.bulk.needFilter — "this deletes what the filters select". Set category
      deletes nothing. It now has its own key (tx.bulkCat.needFilter), in all
      twelve languages.

   2. The New category dialog closed without a word when Name was blank, so
      Create looked like it had done nothing. It now toasts
      cat.err.nameRequired, as the Add-transaction form does for its blank
      field. Cancelling the dialog stays silent, and no file is written.

   Synthetic data only.
     node tests/budget-audit-copy.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* categories.js and transactions.js capture askFields/confirmModal from
   modal.js at require time, so the stub goes in first (the idiom of
   budget-fixed-bill-toggle-guard). */
const modal = require('../src/modal');
let nextAnswer = null;
modal.askFields = async () => nextAnswer;
modal.confirmModal = async () => false;

const i18n = require('../src/i18n');
const B = 'Budget';
const files = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + '| 2026-07-02 | Landlord | Rent | -8000.00 |  |  |  |\n',
});

async function mount() {
  const ctx = makeCtx(files());
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
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  return { ctx, S, $ };
}

(async () => {
  /* ---- 1. Set category with no filter ---- */
  {
    const { ctx, $ } = await mount();
    require('../src/views/transactions')(ctx);
    /* The toolbar button is spliced in beside Delete, which needs a parent the
       DOM stub does not give an auto-created element. */
    const made = [];
    $('#txDeleteFiltered').parentNode = { insertBefore: (k) => made.push(k) };
    ctx.renderTransactions();
    ok(made.length === 1, 'the Set category button was built');
    made[0]._fire('click');
    await new Promise(r => setImmediate(r));
    const toast = ctx._toasts[ctx._toasts.length - 1];
    ok(toast && toast.bad, 'with no filter chosen, Set category toasts an error');
    ok(toast.msg === i18n.t('tx.bulkCat.needFilter'), 'and it is its own key, not the Delete one');
    ok(toast.msg !== i18n.t('tx.bulk.needFilter'), 'never the delete-flavoured tx.bulk.needFilter');
    ok(!/delet|skrap|löschen|gelöscht|elimin|supprim|excl|削除|删除|मिटा|susa|cima/i.test(toast.msg),
      'the wording promises no deletion');
    /* All twelve languages carry it, translated (not the English fall-through). */
    const dir = path.join(__dirname, '..', 'src', 'lang');
    const en = require(path.join(dir, 'en.js'))['tx.bulkCat.needFilter'];
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'en.js')) {
      const v = require(path.join(dir, f))['tx.bulkCat.needFilter'];
      ok(typeof v === 'string' && v && v !== en, `${f} has its own tx.bulkCat.needFilter`);
    }
  }

  /* ---- 2. New category with a blank name ---- */
  {
    const { ctx, S } = await mount();
    const before = S.categories.length;
    const wrote = [];
    const realWrite = ctx.vault.create && ctx.vault.create.bind(ctx.vault);
    ctx.vault.create = async (...a) => { wrote.push(a[0]); return realWrite ? realWrite(...a) : undefined; };

    nextAnswer = { name: '   ', type: 'expense', fixed: [] };
    const res = await ctx.promptCreateCategory();
    ok(res === null, 'a blank name creates nothing');
    const toast = ctx._toasts[ctx._toasts.length - 1];
    ok(toast && toast.bad && toast.msg === i18n.t('cat.err.nameRequired'), 'and says why, as an error toast');
    ok(S.categories.length === before && wrote.length === 0, 'no category, no file');

    /* Cancel is a decision, not an error: it stays silent. */
    ctx._toasts.length = 0;
    nextAnswer = null;
    ok((await ctx.promptCreateCategory()) === null, 'cancel returns null');
    ok(ctx._toasts.length === 0, 'cancel stays silent');
  }

  console.log(`PASS — Set category no longer says it deletes; a blank category name is toasted (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
