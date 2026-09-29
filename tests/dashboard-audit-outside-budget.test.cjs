'use strict';
/* Accounts outside the budget, said out loud in two places (2026-09-29 totals
   audit, Ruan's decisions b, c and h).

   b   "Money left this period" counts the cash of accounts inside the budget.
       An account with `budget: false` is the household saying its money is not
       part of the budget, so it is left out on purpose - but on the vault this
       was found on that left out two everyday accounts (a business cheque and
       an Online Wallet balance) and nothing on the card said so. It now names them:
       "2 accounts outside the budget not counted (R288)". Deliberately NOT
       every `budget: false` account: a savings or investment pool outside the
       budget is a different concept, worth thousands of times more, and
       printing it would be alarming noise, and a foreign-currency account is already
       given its own band.

   c   The donut's drill-through opened Transactions on the category and
       period only, so the rows listed did not add up to the wedge clicked: a
       business account charging the same category is not in the Dashboard's
       figure. The drill-through now filters to accounts inside the budget and
       says how many rows it hid, with a way to show them. The page's own
       category filter, chosen by hand, behaves as it always did.

   h   The "Missing categories" tile (category names no category file answers
       to) only cleared a stale filter. It now selects a "Missing categories"
       option on Transactions - built from the names on the rows - and lists
       those rows.

   Synthetic households; the figures are invented.

     node tests/dashboard-audit-outside-budget.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, figNumber, renderDash } = require('./helpers/dash-audit.cjs');
const { cashOnHand, whatsLeft } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const sum = rows => Math.round(rows.reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100;

/* The stub DOM does not reflect an <option>'s value attribute onto `.value`
   the way a browser does. Made to here, so the page's own select logic
   (syncOptions, openCategory's membership test) runs against real values. */
function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}

/* Wire the drill-through the way the app does: switching view renders it. */
function wire(ctx) {
  ctx.switchView = () => ctx.renderTransactions();
  const sel = realSelect(ctx.$('#txCategory'));
  ctx.$('#txWholeHistory').checked = false;
  return sel;
}
const note = ctx => textOf(ctx.$('#txScopeNote'));
const legendRow = (nodes, name) => find(nodes.get('#dashSplit'), n => n.tagName === 'LI'
  && find(n, m => hasClass(m, 'dl-name') && textOf(m) === name).length)[0];
const click = n => find(n, m => hasClass(m, 'dl-link'))[0]._fire('click');

(async () => {
  /* ---- b1. the seam names what it left out ----------------------------------- */
  {
    const c = cashOnHand([
      { name: 'Cheque', dated: true, implied: 10000, inBudget: true },
      { name: 'Business Cheque', dated: true, implied: 250, inBudget: false, type: 'checking' },
      { name: 'Online Wallet', dated: true, implied: 37.60, inBudget: false, type: 'checking' },
      { name: 'Nest egg', dated: true, implied: 800000, inBudget: false, type: 'savings' },
      { name: 'Broker', dated: true, implied: 50000, inBudget: false, type: 'investment' },
      { name: 'Undated', dated: false, implied: 99, inBudget: false, type: 'checking' },
      { name: 'Overdrawn', dated: true, implied: -20, inBudget: false, type: 'checking' },
      { name: 'Unreadable', dated: true, implied: 5, readable: false, inBudget: false, type: 'checking' },
    ]);
    eq(c.cash, 10000, 'cash is unchanged: the in-budget account only');
    eq(c.outside.map(o => o.name), ['Business Cheque', 'Online Wallet'],
      'only the everyday accounts the card WOULD have counted: not the pools, the undated, the overdrawn or the unreadable');
    eq(Math.round(c.outside.reduce((t, o) => t + o.amount, 0) * 100), 28760, 'with their money');
    const L = whatsLeft({ accounts: [{ name: 'A', dated: true, implied: 100, inBudget: true },
      { name: 'B', dated: true, implied: 40, inBudget: false, type: 'checking' }],
    services: [], debts: [], rows: [], periodStart: '2026-09-01', periodEnd: '2026-09-30', today: '2026-09-10' });
    eq([L.outside.count, L.outside.amount], [1, 40], 'whatsLeft hands it on');
  }

  /* ---- b2. the card prints it ------------------------------------------------- */
  const household = extra => ({
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
    [`${B}/Accounts/Business Cheque.md`]: account('Business Cheque', { balance: '250.00', balance_updated: '2026-09-01', budget: 'false' }),
    [`${B}/Accounts/Online Wallet.md`]: account('Online Wallet', { balance: '37.60', balance_updated: '2026-09-01', budget: 'false' }),
    /* Neither of these belongs in the sentence. */
    [`${B}/Accounts/Nest egg.md`]: account('Nest egg', { type: 'savings', balance: '800000.00', balance_updated: '2026-09-01', budget: 'false' }),
    [`${B}/Accounts/EuroSave.md`]: account('EuroSave', { currency: '"€"', balance: '500', balance_updated: '2026-09-01', budget: 'false' }),
    ...extra,
  });
  {
    const { nodes, t } = await renderDash(household(), { today: '2026-09-10' });
    const left = t('#leftBody');
    ok(/2 accounts outside the budget not counted \(R ?288\)/.test(left), `the card names them: ${left}`);
    ok(!/800[\s\u00a0\u202f]?000/.test(left), 'and says nothing about the R800 000 savings pool (nor counts the euro account: the count is 2)');
    eq(figNumber(nodes.get('#leftBody'), 'left-cash'), 10000, 'the cash figure is unchanged by the sentence');
  }
  /* One account: the singular, through `count`. */
  {
    const f = household();
    delete f[`${B}/Accounts/Online Wallet.md`];
    const { t } = await renderDash(f, { today: '2026-09-10' });
    ok(/1 account outside the budget not counted \(R ?250\)/.test(t('#leftBody')), `singular: ${t('#leftBody')}`);
  }
  /* None: no sentence at all. */
  {
    const f = household();
    for (const k of ['Business Cheque', 'Online Wallet']) delete f[`${B}/Accounts/${k}.md`];
    const { t } = await renderDash(f, { today: '2026-09-10' });
    ok(!/outside the budget/.test(t('#leftBody')), 'nothing outside the budget, nothing said');
  }
  /* The invariant that makes it one rule: opt the two accounts back in and the
     cash grows by exactly the amount the sentence printed. */
  {
    const off = await renderDash(household(), { today: '2026-09-10' });
    const inn = household();
    for (const k of ['Business Cheque', 'Online Wallet']) inn[`${B}/Accounts/${k}.md`] = account(k, { balance: k === 'Online Wallet' ? '37.60' : '250.00', balance_updated: '2026-09-01' });
    const on = await renderDash(inn, { today: '2026-09-10' });
    const printed = Number(/\(R ?(\d+)\)/.exec(off.t('#leftBody'))[1]);
    eq(figNumber(on.nodes.get('#leftBody'), 'left-cash') - figNumber(off.nodes.get('#leftBody'), 'left-cash'), printed,
      'cash with the accounts opted in = cash + the printed amount (they cannot disagree)');
  }

  /* ---- c. the category drill-through lists what the wedge adds up -------------- */
  const groceries = () => household({
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([
      ['2026-09-02', 'Checkers', 'Groceries', -400],
      ['2026-09-03', 'Woolworths', 'Groceries', -100],
      ['2026-09-04', 'Spar (refunded to a colleague)', 'Groceries', -50, 'yes'],   // excluded: still LISTED
      ['2026-09-05', 'Pharmacy', 'Phone', -75],
    ]),
    [`${B}/Transactions/Business Cheque/2026-09.md`]: tx([
      ['2026-09-02', 'Stationery run', 'Groceries', -250],
      ['2026-09-06', 'Airtime', 'Phone', -25],
    ]),
  });
  {
    const { ctx, nodes } = await renderDash(groceries(), { today: '2026-09-10' });
    const sel = wire(ctx);
    const wedge = legendRow(nodes, 'Groceries');
    ok(wedge, 'the Groceries legend row is rendered');
    const figure = Number(textOf(find(wedge, m => hasClass(m, 'dl-val'))[0]).replace(/[^\d]/g, ''));
    eq(figure, 500, 'the Dashboard figure: 400 + 100, with the excluded row and the business account out');

    click(wedge);
    eq(sel.value, 'Groceries', 'the drill-through selects the category');
    const rows = ctx.filteredRows().rows;
    eq(rows.filter(r => !r.excluded).length, 2, 'two counted rows are listed');
    eq(sum(rows.filter(r => !r.excluded)), -figure, 'and they add up to the figure clicked');
    ok(rows.some(r => r.excluded), 'the excluded row is still LISTED (CONTEXT.md: nothing silently disappears)');
    ok(!rows.some(r => r.label === 'Business Cheque'), 'the business account\'s row is not');
    eq(ctx.filteredRows().hiddenOutside, 1, 'the filter knows how many rows it left out');
    ok(/1 row from an account outside the budget is hidden/.test(note(ctx)), `and says so: ${note(ctx)}`);
    ok(/Show them/.test(note(ctx)), 'with a way to show them');

    /* The link clears the state and nothing else. */
    const link = find(ctx.$('#txScopeNote'), n => n.tagName === 'BUTTON')[0];
    ok(link, 'the way to show them is a button');
    link._fire('click');
    eq(sel.value, 'Groceries', 'the category filter stays');
    eq(ctx.filteredRows().rows.length, 4, 'the hidden row is listed again');
    eq(note(ctx), '', 'and the note is gone');
  }
  /* Choosing the category by hand is the page as it always was. */
  {
    const { ctx } = await renderDash(groceries(), { today: '2026-09-10' });
    const sel = wire(ctx);
    ctx.renderTransactions();
    sel.value = 'Groceries';
    ctx.renderTransactions();
    eq(ctx.filteredRows().rows.length, 4, 'a hand-picked category lists the business account\'s row too');
    eq(note(ctx), '', 'and prints no note');
  }
  /* The state belongs to the drill-through: choosing something else ends it, and
     choosing the same category again by hand does not bring it back. */
  {
    const { ctx, nodes } = await renderDash(groceries(), { today: '2026-09-10' });
    const sel = wire(ctx);
    click(legendRow(nodes, 'Groceries'));
    eq(ctx.filteredRows().hiddenOutside, 1, 'drilled: one row hidden');
    sel.value = 'Phone'; ctx.renderTransactions();
    eq(ctx.filteredRows().rows.length, 2, 'another category, picked by hand, lists both accounts\' rows');
    sel.value = 'Groceries'; ctx.renderTransactions();
    eq(ctx.filteredRows().rows.length, 4, 'and going back to Groceries by hand does not resurrect the drill-through filter');
    eq(note(ctx), '', 'no note');
    /* Another drill-through starts it afresh. */
    click(legendRow(nodes, 'Phone'));
    eq(ctx.filteredRows().rows.map(r => r.label), ['Cheque'], 'a second drill-through filters again');
  }
  /* Several rows: the plural, through `count`. */
  {
    const f = groceries();
    f[`${B}/Transactions/Business Cheque/2026-09.md`] = tx([
      ['2026-09-02', 'Stationery run', 'Groceries', -250],
      ['2026-09-03', 'Courier', 'Groceries', -40],
    ]);
    const { ctx, nodes } = await renderDash(f, { today: '2026-09-10' });
    wire(ctx);
    click(legendRow(nodes, 'Groceries'));
    ok(/2 rows from accounts outside the budget are hidden/.test(note(ctx)), `plural: ${note(ctx)}`);
  }
  /* Nothing to hide: no note. */
  {
    const f = groceries();
    delete f[`${B}/Transactions/Business Cheque/2026-09.md`];
    const { ctx, nodes } = await renderDash(f, { today: '2026-09-10' });
    wire(ctx);
    click(legendRow(nodes, 'Groceries'));
    eq(note(ctx), '', 'no rows from outside the budget, no note');
  }
  /* The export and the bulk actions describe what is on screen. */
  {
    const { ctx, nodes } = await renderDash(groceries(), { today: '2026-09-10' });
    wire(ctx);
    click(legendRow(nodes, 'Groceries'));
    ok(ctx.filteredRows().filters.some(x => /budget/i.test(x)), 'the filter description carries the scope, so an export names it');
  }

  /* ---- h. the Missing categories tile filters to the rows it counts ------------ */
  {
    const files = {
      ...household({
        [`${B}/Transactions/Cheque/2026-09.md`]: tx([
          ['2026-09-03', 'Kiosk', 'Renamed away', -80],
          ['2026-09-04', 'Deli', 'Old name', -20],
          ['2026-09-04', 'Checkers', 'Groceries', -120],
        ]),
        [`${B}/Transactions/Business Cheque/2026-09.md`]: tx([['2026-09-05', 'Print shop', 'Renamed away', -10]]),
      }),
    };
    const { ctx, nodes } = await renderDash(files, { today: '2026-09-10' });
    const sel = wire(ctx);
    ctx.renderTransactions();
    const values = sel.options.map(o => o.value);
    ok(values.includes('__missing__'), `Transactions offers a Missing categories option: ${values}`);
    eq(sel.options.find(o => o.value === '__missing__').textContent, 'Missing categories', 'named as the tile is');
    ok(values.includes('Renamed away') && values.includes('Old name'), 'and each orphaned name, so a wedge can find its rows');

    const tile = find(nodes.get('#heroCard'), n => n.tagName === 'BUTTON' && /Missing categories/.test(textOf(n)))[0];
    ok(tile, 'the tile is a button');
    const counted = ctx.periodSummary(ctx.S.period).unknown.count;
    tile._fire('click');
    eq(sel.value, '__missing__', 'the tile selects it');
    const rows = ctx.filteredRows().rows;
    eq(rows.length, counted, `the rows listed are the rows the tile counts (${counted})`);
    eq(rows.map(r => r.cat).sort(), ['Old name', 'Renamed away'], 'and they are the orphaned ones');
    ok(/1 row from an account outside the budget is hidden/.test(note(ctx)), 'the business account\'s orphaned row is disclosed, not silently dropped');

    /* A wedge for an orphaned name finds its rows too. */
    const wedge = legendRow(nodes, 'Renamed away');
    ok(wedge, 'the orphaned name has a wedge');
    click(wedge);
    eq(sel.value, 'Renamed away', 'which selects that name');
    eq(sum(ctx.filteredRows().rows), -80, 'and lists exactly the figure on the wedge');
  }
  /* ---- c2. the Uncategorised tile is the same drill-through ------------------- */
  {
    const files = household({
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-03', 'Mystery shop', '', -60],
        ['2026-09-04', 'Checkers', 'Groceries', -120],
      ]),
      [`${B}/Transactions/Business Cheque/2026-09.md`]: tx([['2026-09-05', 'Print shop', '', -10]]),
    });
    const { ctx, nodes } = await renderDash(files, { today: '2026-09-10' });
    const sel = wire(ctx);
    const tile = find(nodes.get('#heroCard'), n => n.tagName === 'BUTTON' && /Uncategorised/.test(textOf(n)))[0];
    ok(tile, 'the Uncategorised tile is a button');
    const counted = ctx.periodSummary(ctx.S.period).uncategorised;
    tile._fire('click');
    eq(sel.value, '__none__', 'the tile selects Uncategorised');
    eq(ctx.filteredRows().rows.filter(r => !r.excluded).length, counted, `the rows listed are the rows the tile counts (${counted})`);
    ok(/1 row from an account outside the budget is hidden/.test(note(ctx)), `the business account's row is disclosed: ${note(ctx)}`);
  }

  /* No orphan, no option. */
  {
    const { ctx } = await renderDash(groceries(), { today: '2026-09-10' });
    const sel = wire(ctx);
    ctx.renderTransactions();
    ok(!sel.options.some(o => o.value === '__missing__'), 'a vault with every category on file is offered no such option');
  }

  console.log(`PASS dashboard-audit-outside-budget (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
