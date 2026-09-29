'use strict';
/* A Dashboard drill-through listed rows the clicked figure did not count
   (2026-09-29 totals audit, lane Y item 2).

   A running period's Dashboard figures close at today: periodSummary counts
   the window up to `asOf` and reports the rest as `scheduled`. The category
   wedge clicked on the 10th said R500; the Transactions list it opened showed
   the whole period, including a R300 row already dated the 20th, and added up
   to R800. While the drill-through scope is on it now also holds back rows
   dated after today, says how many, and the same "Show them" button gives them
   back. A category chosen by hand is the page as it always was.

   The cut-off is todayIso() - the clock the figure itself was cut with - not a
   second one; every interaction below runs under the same pinned day.

   Synthetic household; the figures are invented.
     node tests/lane-y-drill-future-rows.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, mountFor, pinClock } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const sum = rows => Math.round(rows.filter(r => !r.excluded).reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100;

function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}
const legendRow = (nodes, name) => find(nodes.get('#dashSplit'), n => n.tagName === 'LI'
  && find(n, m => hasClass(m, 'dl-name') && textOf(m) === name).length)[0];
const legendFigure = row => Number(textOf(find(row, m => hasClass(m, 'dl-val'))[0]).replace(/[^\d]/g, ''));
const click = n => find(n, m => hasClass(m, 'dl-link'))[0]._fire('click');

const household = txFiles => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/Business Cheque.md`]: account('Business Cheque', { balance: '300.00', balance_updated: '2026-09-01', budget: 'false' }),
  ...txFiles,
});
const groceries = (extraCheque = [], extraBiz = []) => household({
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-02', 'Checkers', 'Groceries', -400],
    ['2026-09-03', 'Woolworths', 'Groceries', -100],
    ['2026-09-20', 'Pick n Pay (dated ahead)', 'Groceries', -300],
    ['2026-09-05', 'Pharmacy', 'Phone', -75],
    ...extraCheque,
  ]),
  [`${B}/Transactions/Business Cheque/2026-09.md`]: tx([
    ['2026-09-02', 'Stationery run', 'Groceries', -250],
    ...extraBiz,
  ]),
});

/* Everything runs under one pinned day, the way the app does. */
async function session(files, run, today = '2026-09-10') {
  const unpin = pinClock(today);
  try {
    const M = await mountFor(files, { period: today.slice(0, 7) });
    M.ctx.renderDashboard();
    M.ctx.switchView = () => M.ctx.renderTransactions();
    const sel = realSelect(M.ctx.$('#txCategory'));
    M.ctx.$('#txWholeHistory').checked = false;
    await run({ ...M, sel, note: () => textOf(M.ctx.$('#txScopeNote')) });
  } finally { unpin(); }
}

(async () => {
  /* ---- the rows listed add up to the figure clicked --------------------------- */
  await session(groceries(), ({ ctx, nodes, sel, note }) => {
    const wedge = legendRow(nodes, 'Groceries');
    const figure = legendFigure(wedge);
    eq(figure, 500, 'the Dashboard figure stops at today: 400 + 100, not the row dated the 20th');

    click(wedge);
    eq(sel.value, 'Groceries', 'the drill-through selects the category');
    const f = ctx.filteredRows();
    eq(sum(f.rows), -figure, 'the rows listed add up to the figure clicked');
    ok(!f.rows.some(r => r.date > '2026-09-10'), 'and none of them is dated after today');
    eq(f.hiddenFuture, 1, 'the filter knows how many it held back');
    eq(f.hiddenOutside, 1, 'and how many the account scope did');
    ok(/1 row dated after today is hidden/.test(note()), `the note says so: ${note()}`);
    ok(/1 row from an account outside the budget is hidden/.test(note()), 'beside the account sentence it already had');
    ok(f.filters.some(x => /today/.test(x)), 'the export names the scope: ' + f.filters.join(' | '));

    /* One button gives every hidden row back. */
    const btn = find(ctx.$('#txScopeNote'), n => n.tagName === 'BUTTON')[0];
    ok(btn && /Show them/.test(textOf(btn)), 'a single "Show them" button');
    btn._fire('click');
    const after = ctx.filteredRows();
    eq(after.rows.length, 4, 'after Show them all four Groceries rows are listed, business account included');
    ok(after.rows.some(r => r.date === '2026-09-20'), 'including the one dated the 20th');
    eq(after.hiddenFuture, 0, 'nothing is held back');
    eq(note(), '', 'and the note is gone');
    eq(sel.value, 'Groceries', 'the category filter stays');
  });

  /* ---- a hand-picked category is the page as it always was -------------------- */
  await session(groceries(), ({ ctx, sel, note }) => {
    ctx.renderTransactions();
    sel.value = 'Groceries';
    ctx.renderTransactions();
    const f = ctx.filteredRows();
    ok(f.rows.some(r => r.date === '2026-09-20'), 'picked by hand, the future-dated row is listed');
    eq([f.hiddenFuture, f.hiddenOutside], [0, 0], 'nothing is held back');
    eq(note(), '', 'and there is no note');
  });

  /* ---- the future sentence alone: singular and plural through count ---------- */
  const noBiz = (extra = []) => {
    const f = groceries(extra);
    delete f[`${B}/Transactions/Business Cheque/2026-09.md`];
    return f;
  };
  await session(noBiz(), ({ ctx, nodes, note }) => {
    click(legendRow(nodes, 'Groceries'));
    eq(note().replace(/\s+/g, ' ').replace(/Show them/, '').trim(), '1 row dated after today is hidden',
      'only the future sentence when no account was held back: singular');
  });
  await session(noBiz([['2026-09-25', 'Spar (dated ahead)', 'Groceries', -50]]), ({ ctx, nodes, note }) => {
    click(legendRow(nodes, 'Groceries'));
    ok(/2 rows dated after today are hidden/.test(note()), `plural: ${note()}`);
    ok(!/outside the budget/.test(note()), 'and no account sentence when none was held back');
  });

  /* ---- a row is counted under ONE reason ------------------------------------- */
  await session(groceries([], [['2026-09-22', 'Print shop (dated ahead)', 'Groceries', -40]]), ({ ctx, nodes }) => {
    click(legendRow(nodes, 'Groceries'));
    const f = ctx.filteredRows();
    eq([f.hiddenOutside, f.hiddenFuture], [2, 1],
      'the business account\'s future row is counted as outside the budget only');
  });

  /* ---- nothing to hide, no note ----------------------------------------------- */
  await session(household({
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-02', 'Checkers', 'Groceries', -400]]),
  }), ({ ctx, nodes, note }) => {
    click(legendRow(nodes, 'Groceries'));
    eq(note(), '', 'no future rows and no outside rows: no note');
  });

  /* ---- a finished period has no future rows to hide -------------------------- */
  await session(household({
    [`${B}/Transactions/Cheque/2026-08.md`]: tx([
      ['2026-08-02', 'Checkers', 'Groceries', -400], ['2026-08-30', 'Woolworths', 'Groceries', -100]]),
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-02', 'Checkers', 'Groceries', -60]]),
  }), ({ ctx, nodes, note, S }) => {
    S.period = '2026-08';
    ctx.renderDashboard();
    click(legendRow(nodes, 'Groceries'));
    const f = ctx.filteredRows();
    eq(sum(f.rows), -500, 'a closed period lists all of its rows');
    eq(f.hiddenFuture, 0, 'none held back');
    eq(note(), '', 'no note');
  });

  /* ---- the Uncategorised tile is the same drill-through ----------------------- */
  await session(household({
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([
      ['2026-09-03', 'Mystery shop', '', -60],
      ['2026-09-21', 'Mystery shop (dated ahead)', '', -70],
      ['2026-09-04', 'Checkers', 'Groceries', -120],
    ]),
  }), ({ ctx, nodes, sel, note }) => {
    const tile = find(nodes.get('#heroCard'), n => n.tagName === 'BUTTON' && /Uncategorised/.test(textOf(n)))[0];
    ok(tile, 'the Uncategorised tile is a button');
    const counted = ctx.periodSummary(ctx.S.period).uncategorised;
    tile._fire('click');
    eq(sel.value, '__none__', 'it selects Uncategorised');
    eq(ctx.filteredRows().rows.filter(r => !r.excluded).length, counted, `the rows listed are the rows the tile counts (${counted})`);
    ok(/1 row dated after today is hidden/.test(note()), `and the future one is disclosed: ${note()}`);
  });

  /* ---- the cut-off is the clock the figure used ------------------------------- */
  await session(groceries(), ({ ctx, nodes }) => {
    click(legendRow(nodes, 'Groceries'));
    eq(ctx.filteredRows().hiddenFuture, 1, 'on the 10th the row dated the 20th is ahead');
  }, '2026-09-10');
  await session(groceries(), ({ ctx, nodes }) => {
    click(legendRow(nodes, 'Groceries'));
    eq(ctx.filteredRows().hiddenFuture, 0, 'on the 20th it is today, and today is counted');
  }, '2026-09-20');

  console.log(`PASS lane-y-drill-future-rows (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
