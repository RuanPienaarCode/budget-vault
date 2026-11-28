'use strict';
/* Every drill-through into Transactions clears the subcategory filter
   (ADR-0010 section 6; the leftover of issue #186).

   The Transactions page keeps its filters between visits. A subcategory chosen
   there ("Fuel", under Car) is still on offer when the next visit arrives with
   the category cleared or changed, because the select lists every name in use
   when no category narrows it. Nothing drops it, so the reader taps the
   Dashboard's Uncategorised tile, or "See transactions" on an account, and lands
   on "0 rows" under a filter they did not set on the way in: the page is titled
   for one thing and filtered by another.

   openCategory() cleared it in #186. The three other ways in did not:

     - the Dashboard's Uncategorised tile          (dashboard.js openUncategorised)
     - the Dashboard's Missing categories tile     (dashboard.js openMissingCategories,
                                                    which reaches it through openCategory)
     - the Accounts page's "See transactions"      (accounts.js openTransactions,
                                                    published as ctx.openAccountTransactions)

   Each is driven here the way the page drives it, over the real loader, with the
   subcategory filter left on "Fuel" by an earlier visit, and read off the rows the
   real Transactions filter then lists.

     node tests/drill-through-clears-subcategory.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, hasClass, textOf } = require('./helpers/dash-audit.cjs');
const { NO_SUBCATEGORY } = require('../src/subcategories');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const HEAD = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|---|---|---|---:|---|---|---|\n';
const row = (date, desc, cat, amount, sub = '') => `| ${date} | ${desc} | ${cat} | ${amount.toFixed(2)} |  |  | ${sub} |\n`;
const book = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\nsubcategories: Fuel, Tolls\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: HEAD + [
    row('2026-09-01', 'Engen', 'Car', -500, 'Fuel'),
    row('2026-09-02', 'Engen again', 'Car', -120, 'Fuel'),
    row('2026-09-03', 'e-tag', 'Car', -65, 'Tolls'),
    row('2026-09-04', 'Checkers', 'Groceries', -250),
    /* No category at all: what the Uncategorised tile counts. */
    row('2026-09-05', 'Cash withdrawal', '', -300),
    row('2026-09-06', 'Mystery debit', '', -80),
    /* A category no Categories/ note answers to: what the Missing tile counts. */
    row('2026-09-07', 'Old gym', 'Gym', -400),
  ].join(''),
});

function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}

/* The page, with only the Transactions page's routing stubbed: switchView
   re-renders it in place, so the filter controls and the listed rows are the
   real ones. */
async function open() {
  const unpin = pinClock('2026-09-10');
  try {
    const M = await mountFor(book(), { period: '2026-09' });
    const { ctx } = M;
    ctx.renderDashboard();
    M.switched = [];
    ctx.switchView = v => { M.switched.push(v); ctx.renderTransactions(); };
    M.cat = realSelect(ctx.$('#txCategory'));
    M.acct = realSelect(ctx.$('#txAccount'));
    M.sub = realSelect(ctx.$('#txSubcategory'));
    ctx.$('#txWholeHistory').checked = false;
    ctx.renderTransactions();   // the visit that leaves the filters behind
    return M;
  } finally { unpin(); }
}
const listed = M => M.ctx.filteredRows().rows.map(r => r.desc).sort();
const tile = (M, label) => find(M.nodes.get('#heroCard'), n => n.tagName === 'BUTTON' && hasClass(n, 'stat'))
  .find(b => textOf(b).startsWith(label));

/* The earlier visit: Fuel chosen under Car, then the reader leaves the page. */
function staleFuel(M) {
  M.cat.value = 'Car';
  M.ctx.renderTransactions();
  M.sub.value = 'Fuel';
  M.ctx.renderTransactions();
  eq([M.cat.value, M.sub.value], ['Car', 'Fuel'], 'precondition: the earlier visit left Fuel chosen under Car');
  eq(listed(M), ['Engen', 'Engen again'], 'precondition: and only the Fuel rows are listed');
}

(async () => {
  /* The select offers "Fuel" with no category narrowing it, which is what lets
     the stale choice survive the next drill. Without that the rest proves nothing. */
  {
    const M = await open();
    M.cat.value = '';
    M.sub.value = 'Fuel';
    M.ctx.renderTransactions();
    eq(M.sub.value, 'Fuel', 'precondition: Fuel stays on offer with every category showing, so nothing drops a stale choice');
  }

  /* -- the Dashboard's Uncategorised tile -- */
  {
    const M = await open();
    ok(tile(M, 'Uncategorised'), 'the Dashboard draws an Uncategorised tile for this book');
    staleFuel(M);
    M.switched.length = 0;
    tile(M, 'Uncategorised')._fire('click');
    eq(M.switched, ['transactions'], 'the tile opens Transactions');
    eq(M.cat.value, '__none__', 'on Uncategorised');
    eq(M.sub.value, '', 'with the subcategory filter cleared');
    eq(listed(M), ['Cash withdrawal', 'Mystery debit'], 'so the uncategorised rows are listed, not "0 rows"');
  }

  /* -- the Dashboard's Missing categories tile -- */
  {
    const M = await open();
    ok(tile(M, 'Missing categories'), 'the Dashboard draws a Missing categories tile for this book');
    staleFuel(M);
    M.switched.length = 0;
    tile(M, 'Missing categories')._fire('click');
    eq(M.switched, ['transactions'], 'the tile opens Transactions');
    eq(M.cat.value, '__missing__', 'on Missing categories');
    eq(M.sub.value, '', 'with the subcategory filter cleared');
    eq(listed(M), ['Old gym'], 'so the row on the missing category is listed');
  }

  /* -- the Accounts page's "See transactions" -- */
  {
    const M = await open();
    staleFuel(M);
    M.switched.length = 0;
    M.ctx.openAccountTransactions('Cheque');
    eq(M.switched, ['transactions'], 'the account button opens Transactions');
    eq(M.acct.value, 'Cheque', 'on that account');
    eq(M.cat.value, '', 'with every category');
    eq(M.sub.value, '', 'and the subcategory filter cleared');
    eq(listed(M).length, 7, 'so every row of the account is listed');
  }

  /* -- the sentinel is a subcategory filter too: "No subcategory" left behind -- */
  {
    const M = await open();
    M.cat.value = 'Car';
    M.ctx.renderTransactions();
    M.sub.value = NO_SUBCATEGORY;
    M.ctx.renderTransactions();
    M.ctx.openAccountTransactions('Cheque');
    eq([M.cat.value, M.sub.value], ['', ''], 'a stale "No subcategory" is cleared by the account drill-through as well');
    eq(listed(M).length, 7, 'and every row is listed');
  }

  /* -- a drill-through into a book with no subcategory control must not break -- */
  {
    const unpin = pinClock('2026-09-10');
    try {
      const files = book();
      files[`${B}/Transactions/Cheque/2026-09.md`] = files[`${B}/Transactions/Cheque/2026-09.md`].replace(/ (Fuel|Tolls) \|/g, '  |');
      files[`${B}/Categories/Car.md`] = '---\ntype: expense\ncolor: "#123456"\n---\n';
      const M = await mountFor(files, { period: '2026-09' });
      M.ctx.switchView = () => M.ctx.renderTransactions();
      M.ctx.renderDashboard();
      M.ctx.renderTransactions();
      M.ctx.openAccountTransactions('Cheque');
      eq(M.ctx.$('#txSubcategory').value || '', '', 'a book with no subcategory drills through as before');
      eq(M.ctx.filteredRows().rows.length, 7, 'and lists every row');
    } finally { unpin(); }
  }

  console.log(`PASS drill-through-clears-subcategory (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
