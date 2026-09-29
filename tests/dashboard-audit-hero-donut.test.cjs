'use strict';
/* Three Dashboard cards that said something their own arithmetic did not
   (2026-09-29 totals audit).

     D1   The "Missing categories" tile drills through openCategory(), which
          only assigned the Transactions category filter when the select had a
          matching option. An orphaned name never had one, so the tap landed on
          Transactions under whatever category filter was set on an earlier
          visit. (Since the follow-up pass the page HAS such an option and the
          tile selects it; this suite keeps the no-option fallback honest.)
     8    The donut's Change column was r(raw amount) − r(average), while the
          Spent column beside it prints the largest-remainder allocation of the
          same amounts, so a row printed R3 775 next to a baseline of R2 513
          and a Change of +R1 261. compareCell's own promise is that the change
          is the difference of the two figures printed beside it.
     9    A period with no budget file read "Over budget this period" with a figure
          and "0% of the R 0 income this budget plans for": an over-budget
          verdict against a plan that does not exist, and a percentage of
          nothing.

   Synthetic households throughout; the figures are invented.

     node tests/dashboard-audit-hero-donut.test.cjs */
const assert = require('assert');
const { B, tx, base, account, textOf, find, hasClass, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const digits = s => Number(String(s).replace(/[^\d-]/g, '').replace(/^-$/, '0'));
/* A printed signed change like "+R 1 261" or "−R 40" as a number. */
const signed = s => (/^\s*[−-]/.test(s) ? -1 : 1) * Math.abs(digits(s.replace(/[−+]/g, '')));

(async () => {
  /* ---- D1. the orphan tile clears a stale category filter -------------------- */
  {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-09-01' }),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-03', 'Kiosk', 'Renamed away', -80],      // no category file answers to this name
        ['2026-09-04', 'Checkers', 'Groceries', -120],
      ]),
    };
    const { ctx, nodes } = await renderDash(files, { today: '2026-09-10' });
    const tile = find(nodes.get('#heroCard'), n => n.tagName === 'BUTTON' && /Missing categories/.test(textOf(n)))[0];
    ok(tile, 'the Missing categories tile is rendered as a button');

    /* The stub DOM does not reflect an <option>'s `value` attribute onto its
       `.value` property the way a browser does, and Transactions' own
       syncOptions would rebuild the list from it; so the select is a plain
       object with the options a rendered Transactions page would hold, and the
       page render is a no-op. What is under test is what openCategory() ASSIGNS. */
    ctx.switchView = () => {};
    ctx.renderTransactions = () => {};
    const sel = ctx.$('#txCategory');
    Object.defineProperty(sel, 'options', { configurable: true, value: [{ value: '' }, { value: '__none__' }, { value: 'Groceries' }] });
    sel.value = 'Groceries';                 // left over from an earlier visit
    tile._fire('click');
    eq(sel.value, '', 'with no option to select, the category filter is cleared rather than left stale');

    /* Since the follow-up pass the Transactions page builds a "Missing
       categories" option from the names on the rows, and the tile selects it
       (tests/dashboard-audit-outside-budget.test.cjs drives the real page). */
    Object.defineProperty(sel, 'options', { configurable: true, value: [{ value: '' }, { value: '__none__' }, { value: '__missing__' }, { value: 'Renamed away' }, { value: 'Groceries' }] });
    sel.value = 'Groceries';
    tile._fire('click');
    eq(sel.value, '__missing__', 'the tile selects the Missing categories option when the page offers it');
    sel.value = 'Groceries';

    /* Control: a real category still filters. */
    const dl = find(nodes.get('#dashSplit'), n => hasClass(n, 'dl-link'));
    ok(dl.length > 0, 'the donut renders a drill-through');
    dl[0]._fire('click');
    eq(sel.value, 'Groceries', 'a category with an option is still selected (control)');
  }

  /* ---- 8. the Change column is the difference of the two printed figures ------ */
  {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
    };
    /* Three earlier periods with Groceries at exactly 2513 in their first days
       (the baseline is like-for-like: only the elapsed days of each). */
    for (const m of ['06', '07', '08']) {
      files[`${B}/Transactions/Cheque/2026-${m}.md`] = tx([
        [`2026-${m}-02`, 'Checkers', 'Groceries', -2513],
        [`2026-${m}-02`, 'Airtime', 'Phone', -100],
        [`2026-${m}-02`, 'Instalment', 'Car loan', -100],
      ]);
    }
    /* This period: 3774,45 + 100,40 + 100,30 = 3975,15. Rounded alone the first
       row is 3774; allocated to sum to the total (3975) it is 3775. */
    files[`${B}/Transactions/Cheque/2026-09.md`] = tx([
      ['2026-09-03', 'Checkers', 'Groceries', -3774.45],
      ['2026-09-03', 'Airtime', 'Phone', -100.40],
      ['2026-09-03', 'Instalment', 'Car loan', -100.30],
    ]);
    const { nodes } = await renderDash(files, { today: '2026-09-10' });
    const rows = find(nodes.get('#dashSplit'), n => n.tagName === 'LI' && n._parent && hasClass(n._parent, 'donut-legend')
      && !hasClass(n, 'donut-legend-head'));
    const cell = (li, cls) => textOf(find(li, n => hasClass(n, cls))[0]);
    const groceries = rows.find(li => /Groceries/.test(cell(li, 'dl-name')));
    ok(groceries, 'the Groceries legend row is rendered');
    eq(digits(cell(groceries, 'dl-val')), 3775, 'Spent prints the allocated figure');
    eq(digits(cell(groceries, 'dl-base')), 2513, 'the baseline prints 2 513');
    eq(signed(cell(groceries, 'dl-delta')), 3775 - 2513,
      `so the change is the difference of those two: ${cell(groceries, 'dl-delta')}`);

    /* And for every row that has a comparison at all. */
    for (const li of rows) {
      const base_ = cell(li, 'dl-base'), delta = cell(li, 'dl-delta');
      if (!/\d/.test(base_) || !/\d/.test(delta)) continue;
      const printedDiff = digits(cell(li, 'dl-val')) - digits(base_);
      eq(signed(delta), printedDiff === 0 ? 0 : printedDiff,
        `${cell(li, 'dl-name')}: change ${delta} = ${cell(li, 'dl-val')} − ${base_}`);
    }
  }

  /* ---- 9. a period with no budget does not claim to be over one --------------- */
  {
    const budget = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Salary | income | 30000.00 |  |\n| Groceries | expense | 5000.00 |  |\n';
    const mk = withBudget => ({
      ...base(),
      [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '50000.00', balance_updated: '2026-09-25' }),
      /* The previous period (Aug 22 – Sep 21) has its budget; the running one
         (Sep 22 – Oct 21, named 2026-10) has none yet. */
      [`${B}/Budgets/2026-09.md`]: budget,
      ...(withBudget ? { [`${B}/Budgets/2026-10.md`]: budget } : {}),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-23', 'Salary', 'Salary', 30000],
        ['2026-09-24', 'Checkers', 'Groceries', -18377],
      ]),
    });

    const fresh = await renderDash(mk(false), { today: '2026-09-29' });
    eq(fresh.ctx.currentPeriod(), '2026-10', 'fixture: the running period is 2026-10');
    const hero = fresh.t('#heroCard');
    ok(!/Over budget/.test(hero), `no over-budget verdict against a plan that does not exist: ${hero}`);
    ok(!/0% of the/.test(hero) && !/of the R 0 income/.test(hero), 'no percentage of a R 0 income');
    ok(!/of R 0[,.]?0* budgeted/.test(hero), 'and no "spent of R 0 budgeted"');
    ok(/nothing budgeted yet/.test(hero), `it says so, in the Budget page's own words: ${hero}`);
    ok(/18[  ]?377/.test(hero), 'and still shows what has been spent so far');
    ok(!/remaining this period/.test(hero), 'with no remaining figure either');

    /* Control: once the period has a budget the hero is the hero it was. */
    const planned = await renderDash(mk(true), { today: '2026-09-29' });
    const hero2 = planned.t('#heroCard');
    ok(/Over the spending budget this period/.test(hero2), `with a budget the over-budget verdict is real: ${hero2}`);
    ok(!/nothing budgeted yet/.test(hero2), 'and the empty state is gone');
    ok(/18[  ]?377/.test(hero2) && /5[  ]?000/.test(hero2), 'showing spent against budgeted');
  }

  console.log(`PASS dashboard-audit-hero-donut (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
