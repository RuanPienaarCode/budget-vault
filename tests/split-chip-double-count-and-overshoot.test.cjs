'use strict';
/* The split chip tells two more things than "do the parts add up"
   (2026-11-25 audit, TXN-4).

   (a) A split parent whose Excluded tick was removed by hand — the half-done
       reversal the markdown invites — is counted alongside its parts: once as
       itself, once through them. The chip replaced the checkbox, so the reader
       could not re-tick it from the page, and still read "split into 2". Now it
       says the line is no longer excluded and is counted twice, and pressing
       it offers to put the tick back: one confirm, then `excluded = true` as a
       fresh split sets it, the file marked unsaved, the parts left alone.

   (b) Parts that add up to MORE than the line were labelled "R 200 unaccounted",
       which reads as money missing when it is money counted too often. An
       over-allocation now says "more than the line".

   Drives the real view over the shared harness with the dialogs made
   answerable, and records the KEY and PARAMS the view asked the language
   tables for rather than matching English, as split-parent-chip.test.cjs does.

     node tests/split-chip-double-count-and-overshoot.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend, readable } = require('./helpers/dom-stub.cjs');
const { splitRole, supersededBySplit } = require('../src/tx-role');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const answers = { confirm: true };
const seen = { confirms: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return answers.confirm; },
    async askFields() { return null; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const i18n = require('../src/i18n');
const realT = i18n.t;
let tCalls = [];
i18n.t = (key, params) => { tCalls.push({ key, params }); return realT(key, params); };
const asked = key => tCalls.filter(c => c.key === key);

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const TX_PATH = `${B}/Transactions/Cheque/2026-07.md`;
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#aa8833"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [TX_PATH]: `---\n${TX_FM}\n---\n\n${HEAD}`
    // (a) the tick was removed by hand: parent NOT excluded, both parts still there
    + '| 2026-07-05 | Big shop | Groceries | -1200.00 |  | Split into 2 | parent |\n'
    + '| 2026-07-05 | Big shop | Groceries | -800.00 |  |  | part |\n'
    + '| 2026-07-05 | Big shop | Fuel | -400.00 |  |  | part |\n'
    // (b) parts add up to MORE than the line
    + '| 2026-07-06 | Forecourt | Fuel | -500.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-06 | Forecourt | Fuel | -400.00 |  |  | part |\n'
    + '| 2026-07-06 | Forecourt | Groceries | -300.00 |  |  | part |\n'
    // control: parts add up to LESS (a deleted part)
    + '| 2026-07-07 | Taxi | Fuel | -300.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-07 | Taxi | Fuel | -200.00 |  |  | part |\n'
    // control: a stale role word with no parts anywhere, not excluded
    + '| 2026-07-08 | Orphan | Groceries | -100.00 |  |  | parent |\n'
    // control: a healthy split
    + '| 2026-07-09 | Hardware | Groceries | -600.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-09 | Hardware | Groceries | -350.00 |  |  | part |\n'
    + '| 2026-07-09 | Hardware | Fuel | -250.00 |  |  | part |\n',
});

async function mount() {
  const ctx = makeCtx(FILES());
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
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  ctx.render = () => {};
  ctx.switchView = () => {};
  ctx.reloadFromDisk = async () => {};
  return { ctx, S };
}

const EXCL = 5;
const kids = (node, tag) => node.children.filter(c => c.tagName === tag);
const within = (node, tag) => descend(node).filter(e => e.tagName === tag);
const render = ctx => {
  tCalls = [];
  ctx.renderTransactions();
  return kids(kids(ctx.$('#txTable'), 'TBODY')[0], 'TR');
};
/* The parent row, found by its description (cell 1) and its being the one that
   carries a chip rather than a checkbox — parts share the description. */
const parentRow = (rows, desc) => rows.find(tr =>
  kids(tr, 'TD')[1] && kids(tr, 'TD')[1].textContent === desc
  && within(kids(tr, 'TD')[EXCL], 'BUTTON').length === 1);
const chipOf = (rows, desc) => within(kids(parentRow(rows, desc), 'TD')[EXCL], 'BUTTON')[0];
const rowIn = (S, match) => S.txFiles['Cheque/2026-07'].rows.find(match);
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  /* ---- (a) the parent whose tick was removed by hand ---- */
  {
    const { ctx, S } = await mount();
    const rows = render(ctx);
    const parent = rowIn(S, r => r.desc === 'Big shop' && splitRole(r.split) === 'parent');
    ok(!supersededBySplit(parent), 'the fixture parent really is un-ticked: the budget and the account both count it');

    const chip = chipOf(rows, 'Big shop');
    ok(!!chip, 'it still renders a chip, never a checkbox');
    eq(within(kids(parentRow(rows, 'Big shop'), 'TD')[EXCL], 'INPUT').length, 0, 'and no input in its cell');
    eq(asked('tx.split.chip')[0].params.count, 2, 'the chip still says how many parts');
    eq(asked('tx.split.chipTwice').length, 1, 'and says the line is no longer excluded and is counted twice');
    eq(chip.textContent,
      readable(realT('tx.split.chip', { count: 2 }) + ' · ' + realT('tx.split.chipTwice')),
      'in the one label — and no shortfall clause, because its parts add up');
    eq(asked('tx.aria.splitChipTwice').length, 1, 'its accessible name says what pressing does, not "split options"');
    eq(asked('tx.aria.splitChip').filter(c => c.params.desc === 'Big shop').length, 0, 'and is not the generic one');

    /* Pressing it: a confirm, then the tick, and nothing else. */
    answers.confirm = true;
    seen.confirms = [];
    const f = S.txFiles['Cheque/2026-07'];
    const onDisk = ctx.vault._store.get(TX_PATH);
    const partsBefore = f.rows.filter(r => r.desc === 'Big shop' && splitRole(r.split) === 'part');
    const snapshot = partsBefore.map(p => ({ ...p }));
    const rowCount = f.rows.length;
    chip.click();
    await tick();

    eq(seen.confirms.length, 1, 'one confirm');
    eq(seen.confirms[0].title, realT('tx.reexclude.title'), 'under its own title — not the un-split\'s');
    eq(seen.confirms[0].confirmText, realT('tx.reexclude.action'), 'with its own button');
    const msg = asked('tx.reexclude.msg');
    eq(msg.length, 1, 'and its own message');
    eq([msg[0].params.desc, msg[0].params.amount], ['Big shop', '−R 1 200,00'], 'naming the line and what it is worth');
    eq(asked('tx.unsplit.title').length, 0, 'the un-split dialog is never shown');

    eq(parent.excluded, true, 'the tick is back, the way a fresh split sets it');
    ok(supersededBySplit(parent), 'so the parent is superseded again everywhere at once');
    eq(splitRole(parent.split), 'parent', 'its role is untouched');
    eq(f.rows.length, rowCount, 'no row was added or removed');
    eq(f.rows.filter(r => r.desc === 'Big shop' && splitRole(r.split) === 'part').map(p => ({ ...p })), snapshot,
      'the parts are exactly as they were — same rows, same values');
    ok(f.dirty, 'the file is marked unsaved');
    eq(ctx.vault._store.get(TX_PATH), onDisk, 'and nothing was written: Save is the one door to disk');

    const after = render(ctx);
    eq(chipOf(after, 'Big shop').textContent, readable(realT('tx.split.chip', { count: 2 })),
      'the chip now says only "split into 2"');
    eq(asked('tx.split.chipTwice').length, 0, 'with no double-count clause');
  }

  /* ---- a cancelled confirm changes nothing ---- */
  {
    const { ctx, S } = await mount();
    answers.confirm = false;
    const f = S.txFiles['Cheque/2026-07'];
    const parent = rowIn(S, r => r.desc === 'Big shop' && splitRole(r.split) === 'parent');
    chipOf(render(ctx), 'Big shop').click();
    await tick();
    eq(parent.excluded, false, 'Cancel leaves the tick off');
    ok(!f.dirty, 'and marks nothing unsaved');
    answers.confirm = true;
  }

  /* ---- (b) over-allocation is worded differently from a shortfall ---- */
  {
    const { ctx } = await mount();
    const rows = render(ctx);
    const over = asked('tx.split.chipOver');
    eq(over.length, 1, 'parts that add up to more than the line use their own sentence');
    eq(over[0].params.amount, 'R 200.00', 'with the size of the excess as a magnitude');
    const chip = chipOf(rows, 'Forecourt');
    eq(chip.textContent,
      readable(realT('tx.split.chip', { count: 2 }) + ' · ' + realT('tx.split.chipOver', { amount: 'R 200.00' })),
      'in the chip');
    ok(!/unaccounted/i.test(chip.textContent), 'and never says "unaccounted" of money that is counted too often');
    // The control: a split that falls SHORT keeps the old sentence.
    const gap = asked('tx.split.chipGap');
    eq(gap.length, 1, 'only the split that falls short asks for chipGap');
    eq(gap[0].params.amount, 'R 100.00', 'for its own shortfall');
    eq(chipOf(rows, 'Taxi').textContent,
      readable(realT('tx.split.chip', { count: 1 }) + ' · ' + realT('tx.split.chipGap', { amount: 'R 100.00' })),
      'the shortfall chip is unchanged');
  }

  /* ---- controls: a stale role with no parts, and a healthy split ---- */
  {
    const { ctx } = await mount();
    seen.confirms = [];
    const rows = render(ctx);
    eq(chipOf(rows, 'Orphan').textContent, readable(realT('tx.split.chipMissing')),
      'an un-ticked parent with NO parts is not "counted twice" — it is counted once, and still reads parts not found');
    eq(asked('tx.split.chipTwice').length, 1, 'chipTwice was asked for exactly one row: the one with parts under it');
    eq(chipOf(rows, 'Hardware').textContent, readable(realT('tx.split.chip', { count: 2 })),
      'a healthy split says only what it is');
    chipOf(rows, 'Orphan').click();
    await tick();
    eq(seen.confirms.length, 0, 'pressing the parts-not-found chip offers no re-exclude (it has nothing to double)');
  }

  console.log(`PASS split-chip-double-count-and-overshoot — the chip names a lost tick and an overshoot (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
