'use strict';
/* Copy a transaction into the Add dialog (issue #188), on the Transactions page.

   The REAL view over the real loader and an in-memory vault, the way
   tests/subcategory-views.test.cjs drives it. Only the dialog is scripted:
   askFields opens an Obsidian modal, so it is replaced at the module loader and
   what the view asked it for is recorded. The pure rules (what a draft holds, who
   may be copied) are pinned in tests/tx-copy.test.cjs; this file pins that the
   page offers the action to the right rows, opens the dialog with that draft, and
   writes nothing until the dialog is confirmed.

   DECISIONS under test (settled with the issue, 2026-11-28):
     1. Today's date, not the original row's -- and not defaultAddDate(), which
        would move the entry into whichever past period is on screen.
     2. A split part is copied as an ordinary row; a split parent is not offered
        the action.
     3. The copy does not start excluded.
     4. The copy carries account, description, category, subcategory, amount,
        direction and note.
     5. The Add dialog is pre-filled through addDraft; cancelling leaves no row,
        no file change and no draft that would pre-fill a later, ordinary Add.
     6. The action has an accessible name, from a language key (all twelve
        languages are held by tests/i18n.test.cjs), and sits in the actions cell
        beside Split and Delete.

     node tests/transactions-copy.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the dialog, scripted ---------------------------------------------- */
const script = { askFields: [] };
const asked = [];
const fakeModal = {
  askFields: async (app, title, fields, opts) => {
    asked.push({ title, fields, opts });
    if (!script.askFields.length) throw new Error(`unscripted askFields: ${title}`);
    return script.askFields.shift();
  },
  confirmModal: async () => true,
  askSubcategories: async () => undefined,
  askSplit: async () => null,
  askRulesCleanup: async () => null,
  askBudgetReslice: async () => null,
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '../modal' || req === './modal') return fakeModal;
  return origLoad.call(this, req, ...rest);
};
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, hasClass, textOf } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

const B = 'Budget';
const TODAY = '2026-11-28';
const VIEWED = '2026-08';                      // a past period, so "today" and "the period on screen" differ
const settle = () => new Promise(r => setTimeout(r, 25));
const AUG = `${B}/Transactions/Cheque/2026-08.md`;
const NOV = `${B}/Transactions/Cheque/2026-11.md`;

const HEAD = '---\naccount: "Cheque"\nmonth: 2026-08\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n|---|---|---|---:|---|---|---|---|\n';
const TX = HEAD
  + '| 2026-08-14 | Engen Rivonia | Car | -512.40 |  | monthly fill |  | Fuel |\n'
  + '| 2026-08-25 | Salary | Income | 20000.00 |  |  |  |  |\n'
  + '| 2026-08-20 | Transfer to savings | Home | -1000.00 | yes | moved |  |  |\n'
  + '| 2026-08-18 | Checkers | Home | -300.00 | yes | Split into 2 | parent |  |\n'
  + '| 2026-08-18 | Checkers | Home | -200.00 |  | kettle | part | Kitchen |\n'
  + '| 2026-08-18 | Checkers | Groceries | -100.00 |  |  | part |  |\n';
const files = (tx, carSubs = true) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-07-31\n---\n',
  [`${B}/Categories/Car.md`]: `---\ntype: expense\ncolor: "#123456"\n${carSubs ? 'subcategories: "Fuel, Services"\n' : ''}---\n`,
  [`${B}/Categories/Income.md`]: '---\ntype: income\ncolor: "#22aa44"\n---\n',
  [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#aa3366"\nsubcategories: "Kitchen"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Budgets/${VIEWED}.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Car | expense | 2000.00 |  |\n',
  [AUG]: tx,
});

function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}
async function open(f = files(TX)) {
  const unpin = pinClock(TODAY);
  const M = await mountFor(f, { period: VIEWED });
  M.unpin = unpin;
  M.ctx.$('#txWholeHistory').checked = false;
  realSelect(M.ctx.$('#txCategory'));
  realSelect(M.ctx.$('#txSubcategory'));
  M.ctx.renderTransactions();
  return M;
}
const store = M => M.ctx.vault._store;
const tbody = M => find(M.ctx.$('#txTable'), n => n.tagName === 'TBODY')[0];
const trs = M => tbody(M).children.filter(n => n.tagName === 'TR');
const rowsOf = (M, desc) => trs(M).filter(tr => textOf(tr.children[1]) === desc);
const actions = tr => tr.children[7];
const buttons = tr => find(actions(tr), n => n.tagName === 'BUTTON');
const keyOf = b => b.attrs['data-focus-key'];
const copyBtn = tr => buttons(tr).find(b => /^copy:/.test(keyOf(b))) || null;
const lastAsk = () => asked[asked.length - 1];
const valueOf = (ask, key) => ask.fields.find(f => f.key === key).value;

(async () => {
  /* ---- 6. the button: where it is, who has it, what it is called --------- */
  {
    const M = await open();
    const engen = rowsOf(M, 'Engen Rivonia')[0];
    eq(buttons(engen).map(b => keyOf(b).split(':')[0]), ['split', 'copy', 'del'], 'Copy sits in the actions cell between Split and Delete, Delete last');
    ok(find(actions(engen), n => n.tagName === 'BUTTON').every(b => hasClass(b, 'btn-ghost-sm')), 'all three are the same row-action button');
    eq(M.ctx.$('#txTable').querySelectorAll('th').length, 8, 'and no column was added: the same eight');

    const label = copyBtn(engen).attrs['aria-label'];
    eq(label, i18n.t('tx.aria.copy', { date: '2026-08-14', desc: 'Engen Rivonia' }), 'its accessible name is the language key, naming the row');
    ok(label.includes('Engen Rivonia') && label.includes('2026-08-14'), 'and says which row it copies');
    eq(copyBtn(engen).attrs.title, i18n.t('tx.title.copy'), 'with a hover title from its key');
    ok(copyBtn(engen).attrs.type === 'button', 'a button, not a submit');
    ok(copyBtn(engen).attrs['aria-hidden'] === undefined && find(copyBtn(engen), n => n.attrs && n.attrs['aria-hidden'] === 'true').length === 1,
      'the icon is decorative: the name is on the button');

    const checkers = rowsOf(M, 'Checkers');
    eq(checkers.length, 3, 'fixture: a parent and two parts');
    const [parent, kettle, other] = ['parent', 'part', 'part'].map((_, i) => checkers[i]);
    eq(buttons(parent).map(b => keyOf(b).split(':')[0]), ['split', 'del'], 'a split parent is not offered Copy (Split and Delete only, as before)');
    eq(buttons(kettle).map(b => keyOf(b).split(':')[0]), ['split', 'copy', 'del'], 'a split part is');
    eq(buttons(other).map(b => keyOf(b).split(':')[0]), ['split', 'copy', 'del'], 'both parts are');
    ok(buttons(rowsOf(M, 'Transfer to savings')[0]).some(b => /^copy:/.test(keyOf(b))), 'an excluded ordinary row is');
    M.unpin();
  }

  /* ---- 1, 4, 5. the click opens Add filled from the row; cancel leaves nothing ---- */
  {
    const M = await open();
    const before = new Map(store(M));
    script.askFields.push(null);                             // the reader cancels
    copyBtn(rowsOf(M, 'Engen Rivonia')[0]).click();
    await settle();
    const ask = lastAsk();
    eq(ask.title, i18n.t('tx.add.title'), 'it opens the Add transaction dialog');
    eq(ask.fields.map(f => f.key), ['date', 'desc', 'label', 'dir', 'amount', 'cat', 'subcategory', 'note'], 'the ordinary Add form, subcategory field included');
    eq(valueOf(ask, 'date'), TODAY, 'dated today (the viewed period is August, which an ordinary Add would have chosen: 2026-08-31)');
    eq(valueOf(ask, 'desc'), 'Engen Rivonia', 'description');
    eq(valueOf(ask, 'label'), 'Cheque', 'account');
    eq(valueOf(ask, 'dir'), 'out', 'direction');
    eq(valueOf(ask, 'amount'), '512.4', 'amount, as a magnitude');
    eq(valueOf(ask, 'cat'), 'Car', 'category');
    eq(valueOf(ask, 'subcategory'), 'Fuel', 'subcategory');
    eq(valueOf(ask, 'note'), 'monthly fill', 'note');
    ok(typeof ask.opts.validate === 'function', 'and it is validated like any typed entry');

    eq([...store(M)], [...before], 'cancelled: no file in the vault changed by a byte, none was added');
    eq(M.S.txFiles['Cheque/2026-08'].rows.length, 6, 'and no row was added to memory');
    eq(M.S.txFiles['Cheque/2026-08'].dirty, false, 'nor was the month marked unsaved');

    /* The draft is spent: the next, ordinary Add is blank again. */
    script.askFields.push(null);
    await M.ctx.addTransaction();
    const plain = lastAsk();
    eq([valueOf(plain, 'desc'), valueOf(plain, 'amount'), valueOf(plain, 'cat'), valueOf(plain, 'subcategory'), valueOf(plain, 'note'), valueOf(plain, 'dir')],
      [undefined, undefined, '', '', undefined, 'out'], 'a later ordinary Add opens blank: a cancelled copy left no draft behind');
    eq(valueOf(plain, 'date'), '2026-08-31', 'and on the period\'s own default date, which the copy bypassed');
    M.unpin();
  }

  /* ---- 1, 3, 4. confirm: today's month file gets one ordinary, counted row ---- */
  {
    const M = await open();
    const augBefore = store(M).get(AUG);
    script.askFields.push({ date: TODAY, desc: 'Engen Rivonia', label: 'Cheque', dir: 'out', amount: '512.4', cat: 'Car', subcategory: 'Fuel', note: 'monthly fill' });
    copyBtn(rowsOf(M, 'Engen Rivonia')[0]).click();
    await settle();
    const nov = store(M).get(NOV);
    ok(nov && nov.endsWith('| 2026-11-28 | Engen Rivonia | Car | -512.40 |  | monthly fill | Fuel |\n'),
      'confirmed: the row is written to the month of the date it carries (November), not the original\'s, with its subcategory and note');
    eq(store(M).get(AUG), augBefore, 'and the original month file is untouched, byte for byte');
    const made = M.S.txFiles['Cheque/2026-11'].rows;
    eq(made.length, 1, 'one new row');
    eq([made[0].excluded, made[0].split, made[0].subcategory, made[0].amount], [false, undefined, 'Fuel', -512.4], 'not excluded, not a split, carrying the subcategory');
    M.unpin();
  }
  {
    // An excluded row copies as a counted one.
    const M = await open();
    script.askFields.push(null);
    copyBtn(rowsOf(M, 'Transfer to savings')[0]).click();
    await settle();
    const ask = lastAsk();
    eq([valueOf(ask, 'desc'), valueOf(ask, 'amount'), valueOf(ask, 'note'), valueOf(ask, 'date')], ['Transfer to savings', '1000', 'moved', TODAY],
      'the excluded row\'s fields are filled');
    ok(!ask.fields.some(f => /exclu/i.test(f.key)), 'the dialog has no Excluded field to carry the veto into');
    script.askFields.push({ date: TODAY, desc: 'Transfer to savings', label: 'Cheque', dir: 'out', amount: '1000', cat: 'Home', note: 'moved' });
    await M.ctx.copyTransaction({ _row: M.S.txFiles['Cheque/2026-08'].rows.find(r => r.desc === 'Transfer to savings'), _file: M.S.txFiles['Cheque/2026-08'] });
    const made = M.S.txFiles['Cheque/2026-11'].rows;
    eq([made[0].desc, made[0].excluded], ['Transfer to savings', false], 'confirmed: the copy of an excluded row is NOT excluded');
    ok(!/\| yes \|/.test(store(M).get(NOV).split('\n').filter(l => l.includes('Transfer')).join('\n')), 'and its line in the file has no Excluded tick');
    M.unpin();
  }

  /* ---- 4. income ------------------------------------------------------------ */
  {
    const M = await open();
    script.askFields.push(null);
    copyBtn(rowsOf(M, 'Salary')[0]).click();
    await settle();
    eq([valueOf(lastAsk(), 'dir'), valueOf(lastAsk(), 'amount'), valueOf(lastAsk(), 'cat'), valueOf(lastAsk(), 'subcategory')], ['in', '20000', 'Income', ''],
      'income opens as direction in, with no subcategory');
    M.unpin();
  }

  /* ---- 2. a split part is copied as an ordinary row ---------------------------- */
  {
    const M = await open();
    script.askFields.push({ date: TODAY, desc: 'Checkers', label: 'Cheque', dir: 'out', amount: '200', cat: 'Home', subcategory: 'Kitchen', note: 'kettle' });
    copyBtn(rowsOf(M, 'Checkers')[1]).click();
    await settle();
    const ask = lastAsk();
    eq([valueOf(ask, 'desc'), valueOf(ask, 'amount'), valueOf(ask, 'cat'), valueOf(ask, 'subcategory'), valueOf(ask, 'note')],
      ['Checkers', '200', 'Home', 'Kitchen', 'kettle'], 'the part opens with its own category, subcategory, slice amount and note');
    const made = M.S.txFiles['Cheque/2026-11'].rows;
    eq([made.length, made[0].split, made[0].excluded], [1, undefined, false], 'confirmed: one row, with no split role and not excluded');
    ok(!/\| (part|parent) \|/.test(store(M).get(NOV)), 'nothing in the new month\'s file says part or parent');
    eq(M.S.txFiles['Cheque/2026-08'].rows.map(r => r.split || ''), ['', '', '', 'parent', 'part', 'part'], 'the split in August is exactly as it was');
    M.unpin();
  }

  /* ---- a copy is read live: the category just changed in the table is the one copied -- */
  {
    const M = await open();
    const live = M.S.txFiles['Cheque/2026-08'].rows.find(r => r.desc === 'Salary');
    live.cat = 'Groceries';                                   // edited in the table, not yet saved
    script.askFields.push(null);
    copyBtn(rowsOf(M, 'Salary')[0]).click();
    await settle();
    eq(valueOf(lastAsk(), 'cat'), 'Groceries', 'the row\'s current category is copied, not the one it was listed with');
    M.unpin();
  }

  /* ---- a book with no subcategories gets the ordinary form ------------------------- */
  {
    const plainTx = HEAD.replace(/ Split \| Subcategory \|/, ' Split |').replace('|---|---|---:|---|---|---|---|---|', '|---|---|---:|---|---|---|---|')
      + '| 2026-08-14 | Engen Rivonia | Car | -512.40 |  | monthly fill |  |\n';
    const f = files(plainTx, false);
    delete f[`${B}/Categories/Home.md`];
    f[`${B}/Categories/Home.md`] = '---\ntype: expense\ncolor: "#aa3366"\n---\n';
    const M = await open(f);
    script.askFields.push(null);
    copyBtn(rowsOf(M, 'Engen Rivonia')[0]).click();
    await settle();
    eq(lastAsk().fields.map(f => f.key), ['date', 'desc', 'label', 'dir', 'amount', 'cat', 'note'], 'no subcategory field appears for a book that has none');
    eq([valueOf(lastAsk(), 'desc'), valueOf(lastAsk(), 'cat'), valueOf(lastAsk(), 'date')], ['Engen Rivonia', 'Car', TODAY], 'and the copy is otherwise the same');
    M.unpin();
  }

  /* ---- the draft is not sticky: a copy, a cancel, another row's copy ------------------ */
  {
    const M = await open();
    script.askFields.push(null);
    copyBtn(rowsOf(M, 'Engen Rivonia')[0]).click();
    await settle();
    script.askFields.push(null);
    copyBtn(rowsOf(M, 'Salary')[0]).click();
    await settle();
    eq([valueOf(lastAsk(), 'desc'), valueOf(lastAsk(), 'amount'), valueOf(lastAsk(), 'cat')], ['Salary', '20000', 'Income'],
      'a second copy shows its own row, nothing of the first');
    M.unpin();
  }

  /* ---- a copy that never reached the dialog leaves no draft either ---------------------- */
  {
    // No account and no month file: addTransaction says so and returns before it opens the form.
    const M = await open({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' });
    const n = asked.length;
    await M.ctx.copyTransaction({ _row: { date: '2026-08-14', desc: 'Orphan', cat: '', amount: -5, note: '' }, _file: { label: 'Ghost' } });
    eq(asked.length, n, 'fixture: with nowhere to file it, the dialog never opened');
    M.S.txFiles['Cheque/2026-08'] = { label: 'Cheque', month: '2026-08', rows: [], dirty: false };
    script.askFields.push(null);
    await M.ctx.addTransaction();
    eq([valueOf(lastAsk(), 'desc'), valueOf(lastAsk(), 'amount')], [undefined, undefined], 'the next ordinary Add is blank: the unseen copy was not kept as a draft');
    M.unpin();
  }

  /* ---- the shipped stylesheet gives the button the row-action size and a 44px touch target ---- */
  {
    const fs = require('fs'), path = require('path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'statement', 'primitives.css'), 'utf8');
    ok(css.includes('.btn-ghost-sm[data-focus-key^="copy:"]'), 'Copy is in the quiet icon-square rule beside Split and Delete');
    ok(css.includes('.btn-ghost-sm[data-focus-key^="copy:"]:hover'), 'and its hover');
  }

  console.log(`PASS transactions-copy -- Copy opens Add filled from the row on today's date and writes nothing until confirmed (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
