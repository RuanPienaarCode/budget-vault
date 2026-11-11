'use strict';
/* The Transactions page's two status lines are announced, not just drawn.

   Above the table sit two bars: the undo offer for the import that just
   landed, and the note saying what a Dashboard drill-through left out. Both
   were `role="status"` — and both were `hidden` (display:none) until the
   moment they were filled. A live region that is not in the accessibility
   tree is not being listened to: the element appears already carrying its
   text, there is no CHANGE for a screen reader to report, and most say
   nothing. So "42 rows imported — undo is available" and "3 rows from
   accounts outside the budget are hidden" reached everyone except the reader
   who could not see them (audit of 11 Nov 2026, task 18).

   Un-hiding the bars would not have been enough either. They sit inside the
   Transactions section, which is itself display:none while another page is
   open, and both bars are filled at exactly the moment that section is shown
   (an import sends the reader here; so does a drill-through).

   So the announcement has its own two regions, at the shell's top level
   beside the toast: always in the tree, never hidden, empty at rest, and
   written with the sentence alone — no buttons, which a status region would
   otherwise read out as part of the message. The bars stay as the visible
   half and lose the role they could not honour.

   Pinned:

     1. the shell: both regions exist, are status regions, are not hidden, sit
        outside the page sections, and ship empty; the bars carry no role.
     2. an import receipt writes its sentence — and only its sentence — into
        the region, once: a re-render (every search keystroke is one) does not
        write it again, which would announce it again.
     3. dismissing the bar empties the region.
     4. the scope note does the same, with each hidden-row sentence.
     5. neither region is ever given `hidden`.

     node tests/tx-status-regions.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { descend } = require('./helpers/dom-stub.cjs');
const { mountFor, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. the shell ---------------------------------------------------------- */
{
  const { SHELL_HTML } = require('../src/shell');
  const tag = id => (new RegExp(`<div[^>]*\\bid="${id}"[^>]*>`).exec(SHELL_HTML) || [''])[0];
  for (const id of ['txUndoSay', 'txScopeSay']) {
    const t = tag(id);
    ok(t, `the shell ships #${id}`);
    ok(/role="status"/.test(t), `#${id} is a status region`);
    ok(/class="sr-only"/.test(t), `#${id} is clipped, not display:none — in the tree, off the screen`);
    ok(!/hidden/.test(t), `#${id} is not hidden at rest`);
    ok(new RegExp(`id="${id}"[^>]*></div>`).test(SHELL_HTML), `#${id} ships empty`);
    ok(SHELL_HTML.indexOf(`id="${id}"`) > SHELL_HTML.indexOf('</main>'),
      `#${id} is outside the page sections, which are display:none while another page is open`);
  }
  for (const id of ['txUndoBar', 'txScopeNote']) {
    ok(tag(id), `the shell still ships #${id}, the visible half`);
    ok(!/role=/.test(tag(id)), `#${id} no longer claims a role it is display:none too often to honour`);
  }
}

const B = 'Budget';
const TX_HEAD = '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 100.00\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Side.md`]: '---\ntype: checking\ntx_label: "Side"\nbalance: 100.00\nbalance_updated: 2026-10-01\nbudget: false\n---\n',
  [`${B}/Transactions/Cheque/2026-10.md`]: TX_HEAD + '| 2026-10-03 | Grocer | Groceries | -120.00 |  |  |  |\n',
  [`${B}/Transactions/Side/2026-10.md`]: TX_HEAD + '| 2026-10-09 | Side shop | Groceries | -50.00 |  |  |  |\n',
});

/* Counts WRITES to a region's text, which is what a screen reader hears. */
function watch(node) {
  let writes = 0, text = '';
  Object.defineProperty(node, 'textContent', {
    configurable: true,
    get: () => text,
    set: v => { writes++; text = v == null ? '' : String(v); },
  });
  return { writes: () => writes, text: () => text.replace(/ /g, ' ') };
}

(async () => {
  const unpin = pinClock('2026-10-15');
  try {
    const M = await mountFor(FILES(), { period: '2026-10', budgetFolder: B });
    const { ctx, S } = M;
    const i18n = require('../src/i18n');
    const say = { undo: ctx.$('#txUndoSay'), scope: ctx.$('#txScopeSay') };
    const undo = watch(say.undo), scope = watch(say.scope);
    const bar = ctx.$('#txUndoBar'), note = ctx.$('#txScopeNote');
    const buttons = n => descend(n).filter(e => e.tagName === 'BUTTON');

    /* ---- at rest ---------------------------------------------------------- */
    ctx.renderTransactions();
    eq([undo.text(), scope.text()], ['', ''], 'with nothing to say, both regions are empty');
    eq([undo.writes(), scope.writes()], [0, 0], 'and neither was written to at all');

    /* ---- 2. an import receipt --------------------------------------------- */
    S.lastImport = { count: 42, label: 'Cheque', at: '10:00', filename: 'statement.csv', files: [] };
    ctx.renderTransactions();
    ok(!bar.classList.contains('hidden') && buttons(bar).length === 2, 'the visible bar is shown, with Undo and Dismiss');
    const sentence = `${i18n.t('tx.undo.what', { count: 42, label: 'Cheque', at: '10:00' })} ${i18n.t('tx.undo.session')}`.replace(/ /g, ' ');
    eq(undo.text(), sentence, 'the region carries the sentence: what was imported, and how long the undo lasts');
    for (const b of buttons(bar)) {
      ok(!b.textContent.trim() || !undo.text().includes(b.textContent.trim()), `and not the "${b.textContent.trim()}" button's label`);
    }
    eq(undo.writes(), 1, 'written once');
    ctx.renderTransactions();
    ctx.renderTransactions();
    eq(undo.writes(), 1, 'a re-render with the same receipt does not write — and so does not announce — it again');

    // A second import is a new message.
    S.lastImport = { count: 7, label: 'Cheque', at: '10:05', files: [] };
    ctx.renderTransactions();
    eq(undo.writes(), 2, 'a different receipt is said');
    ok(/7/.test(undo.text()) && !/42/.test(undo.text()), 'and replaces the first');

    /* ---- 3. dismissed ------------------------------------------------------ */
    buttons(bar).find(b => b.classList.contains('tx-undo-x')).click();
    ok(bar.classList.contains('hidden'), 'dismissing hides the bar');
    eq(undo.text(), '', 'and empties the region, so nothing stale is left for a reader browsing the page');
    S.lastImport = { count: 7, label: 'Cheque', at: '10:05', files: [] };
    ctx.renderTransactions();
    ok(/7/.test(undo.text()), 'the same receipt shown again after a dismiss IS said again');

    /* ---- 4. the scope note -------------------------------------------------- */
    const cat = ctx.$('#txCategory');
    Object.defineProperty(cat, 'options', { configurable: true,
      get() { return cat.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); } });
    ctx.renderTransactions();
    cat.value = 'Groceries';
    ctx.setTxInBudgetOnly('Groceries');
    ctx.renderTransactions();
    ok(!note.classList.contains('hidden'), 'the scope note is shown');
    eq(scope.text(), i18n.t('tx.outside.hidden', { count: 1 }).replace(/ /g, ' '), 'the region carries the hidden-rows sentence');
    ok(!scope.text().includes(i18n.t('tx.outside.show')), 'and not the "show them" button\'s label');
    const w = scope.writes();
    ctx.renderTransactions();
    eq(scope.writes(), w, 'a re-render does not say it again');
    buttons(note)[0].click();
    ok(note.classList.contains('hidden'), 'giving the rows back hides the note');
    eq(scope.text(), '', 'and empties its region');

    /* ---- 5. never hidden ---------------------------------------------------- */
    ok(!say.undo.classList.contains('hidden') && !say.scope.classList.contains('hidden'),
      'neither region was given `hidden` by any of that');
  } finally {
    unpin();
  }
  console.log(`PASS tx-status-regions — the undo offer and the scope note are written into regions that were already listening (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
