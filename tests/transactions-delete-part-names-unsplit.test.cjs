'use strict';
/* The way back from deleting one part of a split names the control that is
   actually there, as it is labelled (2026-10-20 audit, D2-21).

   Deleting one PART of a split moves a figure: the parent stays excluded and
   superseded, so that slice's money leaves the account totals instead of
   falling back onto the parent (tx-role.js supersededBySplit). The delete
   confirmation says so, and then told the reader how to undo it:

     "… Untick Excluded on the original to put it back."

   Wrong twice over. The column is labelled "Excl. budget" (tx.col.excl), not
   "Excluded" — and on the original line, a split parent, there is no tick to
   untick: the cell holds the "split into N" chip instead, because a parent has
   no honest checkbox state (views/transactions.js excludedCell). The chip's
   one action is the reversal the sentence was describing, behind a dialog
   whose button is labelled Un-split (tx.unsplit.action). So the sentence now
   names THAT, in every language, with the label that language's button
   carries.

   Pinned two ways: in all twelve tables, tx.delete.part contains that
   language's own tx.unsplit.action word for word; and on the real page, the
   original line of a split really does offer that control — the chip opens a
   confirmation whose button is tx.unsplit.action — so the sentence cannot
   drift back into naming something the row does not have.

     node tests/transactions-delete-part-names-unsplit.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const seen = { confirms: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return false; },
    async askFields() { return null; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const i18n = require('../src/i18n');
const { TABLES } = i18n;

/* ---- 1. every language names the control by its own label ---- */
for (const [lang, table] of Object.entries(TABLES)) {
  const sentence = table['tx.delete.part'];
  const action = table['tx.unsplit.action'];
  ok(typeof sentence === 'string' && typeof action === 'string', `${lang}: both strings exist`);
  ok(sentence.includes(action),
    `${lang}: tx.delete.part names the Un-split action exactly as its button is labelled ("${action}") — got "${sentence}"`);
}
ok(!/Untick Excluded/i.test(TABLES.en['tx.delete.part']),
  'English no longer tells the reader to untick a control called "Excluded"');
ok(!/\bExcluded\b/.test(TABLES.en['tx.delete.part']),
  'nor names a control "Excluded" at all — the column is labelled "' + TABLES.en['tx.col.excl'] + '"');

/* ---- 2. the original line really offers that control ---- */
const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
/* Made-up figures. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#777777"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: `---\naccount: "Cheque"\nmonth: 2026-07\n---\n\n${HEAD}`
    + '| 2026-07-05 | Big shop | Groceries | -900.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-05 | Big shop | Groceries | -600.00 |  |  | part |\n'
    + '| 2026-07-05 | Big shop | Home | -300.00 |  |  | part |\n',
};

(async () => {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/transactions')(ctx);
  ctx.render = () => {}; ctx.switchView = () => {}; ctx.reloadFromDisk = async () => {};

  ctx.renderTransactions();
  const f = S.txFiles['Cheque/2026-07'];
  const part = f.rows.find(r => r.split === 'part' && r.amount === -300);
  await ctx.deleteTransaction({ label: 'Cheque', _file: f, _row: part });
  ok(String(seen.confirms[0].message).includes(i18n.t('tx.delete.part')), 'deleting a part says what it costs, in tx.delete.part');

  /* The original line: no checkbox to untick, and a chip whose dialog's button
     is the very word the sentence names. */
  const parentRow = descend($('#txTable')).filter(n => n.tagName === 'TR')
    .find(tr => descend(tr).some(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className)));
  ok(!!parentRow, 'the original line renders its split chip');
  const inputs = descend(parentRow).filter(n => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
  eq(inputs.length, 0, 'and has no Excl. budget checkbox to untick — which is why the old sentence could not be followed');
  seen.confirms = [];
  descend(parentRow).find(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className)).click();
  await new Promise(r => setImmediate(r));
  eq(seen.confirms.length, 1, 'the chip opens a confirmation');
  eq(seen.confirms[0].confirmText, i18n.t('tx.unsplit.action'), 'whose button is the control tx.delete.part names');

  console.log(`PASS transactions-delete-part-names-unsplit — the way back from deleting a split part names Un-split, as labelled, in all ${Object.keys(TABLES).length} languages (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
