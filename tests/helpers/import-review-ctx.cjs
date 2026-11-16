'use strict';
/* The REAL import view (src/views/import.js) over a hand-built ctx, for the
   guard tests that need to read a statement from bytes and look at the review
   screen's state and banner. Everything is synthetic.

   Not the full-app harness (makeCtx/loadInto): those tests that need the real
   loader and commit use it. This one is for the review step alone, where the
   only things the view asks of its host are the account list, the transfer-leg
   index and a few formatters. */
const path = require('path');
const { stubObsidian } = require('./harness.cjs');
stubObsidian();
const { makeDom } = require('./dom-stub.cjs');
const registerImport = require(path.join(__dirname, '..', '..', 'src', 'views', 'import'));
const { FakeEl } = makeDom();

function mountReview({ accounts, accountIndex, dayFirst = true, thousands = ' ' }) {
  const els = {};
  const byLabel = new Map(accounts.map(a => [a.tx_label || a.name, a]));
  const ctx = {
    S: { settings: { currency: 'R', country: 'za', month_start_day: 1 }, accounts, categories: [], rules: [],
      txFiles: {}, budgets: {}, period: '2026-08' },
    $: sel => (els[sel] ||= new FakeEl('div')), $$: () => [], app: {},
    money: v => `R ${Number(v).toFixed(2)}`, moneyIn: (s, v) => `${s} ${Number(v).toFixed(2)}`,
    toast() {}, async writeFile() {}, currentPeriod: () => '2026-08',
    periodRange: () => ({ start: '2026-08-01', end: '2026-08-31' }), periodTitle: () => 'Aug 2026',
    deferredCatSelect: () => new FakeEl('select'), serializeTxFile: () => '',
    locale: () => ({ dayFirst, thousands, decimal: '.', banks: null, importHint: '' }),
    learnRules() {}, txSegment: s => s, accountForLabel: l => byLabel.get(l) || null,
    provide(o) { Object.assign(ctx, o); },
  };
  if (accountIndex) ctx.accountIndex = accountIndex;
  registerImport(ctx);
  const file = (csv, name = 'statement.csv') => ({ name, async arrayBuffer() { return new TextEncoder().encode(csv).buffer; } });
  return {
    ctx, els,
    async load(csv, name) { await ctx.handleStatementFile(file(csv, name)); return ctx.S.pendingImport; },
    banner: () => els['#impReconcile'].textContent,
  };
}

module.exports = { mountReview };
