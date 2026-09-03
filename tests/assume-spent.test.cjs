'use strict';
/* Assume-spent categories, and the overspend they carry.

   A budget line for "previous month overspending" is not waiting for a
   transaction. The money left in an earlier period; this period's row is the
   provision that funds the hole. Budgeted as an ordinary row it read
   "R1 900 left" all month — the exact opposite of the truth — and every total
   that summed actual spending was short by the same amount.

   The flag is `assume_spent: true` in the CATEGORY note, because the answer
   belongs to the category and has to hold in every period the row appears in,
   including periods whose file was written before the flag existed.

   Six invariants, pinned so the arithmetic cannot quietly regress:

     1. the loader reads the flag, tri-state, and defaults it OFF
     2. an assume-spent row's actual IS its budgeted amount, on both the Budget
        page and the Dashboard's category table
     3. "Total spent" on the Budget page includes it — the figure it was
        missing
     4. periodDeficit measures REAL money only, and specifically does NOT count
        assume-spent rows, or an overspend carried once would be carried again
        every period after, compounding off nothing
     5. a period that paid for itself yields no overspend to carry
     6. overspendLag clamps a hand-edited Settings.md into 1–12

   Runs in bare node against the REAL loader and the REAL view modules over the
   shared DOM stub. Wired into ./build.sh.
     node tests/assume-spent.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { overspendLag, OVERSPEND_LAG_DEFAULT, OVERSPEND_LAG_MAX } = require('../src/constants');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- a vault carrying one period's hole into the next -------------------
   Every figure is synthetic. Never put real statement data in this repo.

   June: R10 000 in, R12 500 out — a R2 500 hole, dug entirely by real
   transactions. July budgets that R2 500 against an assume-spent category and
   spends a further R3 000 on groceries. */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const CARRY = 'Previous Month Overspending';

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/${CARRY}.md`]: `---\ntype: expense\ncolor: "#dc3545"\nassume_spent: true\n---\n\n# ${CARRY}\n\nBody text kept verbatim.\n`,

  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-06-01\n---\n',

  [`${B}/Budgets/2026-06.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Groceries | expense | 9000.00 | |\n| Salary | income | 10000.00 | |\n',

  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Groceries | expense | 4000.00 | |\n'
    + `| ${CARRY} | expense | 2500.00 | Overspending for June |\n`
    + '| Salary | income | 10000.00 | |\n',

  [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-06-01 | Salary | Salary | 10000.00 |  |  |  |\n'
    + '| 2026-06-08 | Grocer | Groceries | -12500.00 |  |  |  |\n',

  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-07-01 | Salary | Salary | 10000.00 |  |  |  |\n'
    + '| 2026-07-06 | Grocer | Groceries | -3000.00 |  |  |  |\n',
};

/* Mounted the way controller.js does — the view modules read helpers off each
   other, so registering one in isolation tests a shape the app never runs. */
async function mount(files = FILES, period = '2026-07') {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = period;
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
  for (const f of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${f}`)(ctx);
  return { ctx, S, $ };
}

(async () => {
  /* ---- 1. the loader reads the flag, and defaults it off ---- */
  {
    const { ctx, S } = await mount();
    const carry = S.categories.find(c => c.name === CARRY);
    ok(!!carry, 'the carry category loaded at all');
    eq(carry.assumeSpent, true, 'assume_spent: true is read off the category note');
    eq(carry.rel, `Categories/${CARRY}.md`,
      'the budget-folder-relative path travels with the category, so the toggle can write it back');
    eq(S.categories.find(c => c.name === 'Groceries').assumeSpent, false,
      'a category with no assume_spent key defaults to OFF — every existing vault must behave as it always did');
    eq(ctx.catAssumeSpent(CARRY), true, 'catAssumeSpent agrees with the loader');
    eq(ctx.catAssumeSpent('Groceries'), false, 'and says no for an ordinary category');
    eq(ctx.catAssumeSpent('No such category'), false, 'and does not throw on a name that is not a category');
  }

  /* ---- 1b. an unreadable value is "unset", not false, and not true ---- */
  {
    const files = { ...FILES };
    files[`${B}/Categories/${CARRY}.md`] = '---\ntype: expense\nassume_spent: perhaps\n---\n';
    const { S } = await mount(files);
    eq(S.categories.find(c => c.name === CARRY).assumeSpent, false,
      'an unreadable assume_spent falls back to the default rather than being treated as set');
  }

  /* ---- 2. the row's actual IS its amount, on both pages ---- */
  {
    const { ctx, $ } = await mount();
    ctx.renderBudgets();
    const rowText = $('#budTable').textContent;
    ok(rowText.includes('R 2500.00'),
      'the Budget page states the carried amount as the actual, not R 0.00 with R 2 500 still to go');
    ok(!rowText.includes('R 2500.00 left'),
      'and never offers the carried amount as money still available');

    ctx.renderDashboard();
    const dash = $('#dashBudget').textContent;
    ok(dash.includes(CARRY), 'the Dashboard category table still lists the carried row');
    // budget 2500, actual 2500 -> remaining 0.00, and no red.
    ok(dash.includes('R 0.00'),
      'the Dashboard shows the carried row as fully consumed rather than fully available');
  }

  /* ---- 3. Total spent includes it ---- */
  {
    const { ctx, $ } = await mount();
    ctx.renderBudgets();
    const totals = $('#budTotalsTop').textContent;
    /* July's real spend is R3 000 of groceries; the carried row adds R2 500.
       Before the flag existed this tile read R 3000.00 while the table below it
       claimed R6 500 was budgeted and R2 500 of that was still unspent. */
    ok(totals.includes('R 5500.00'),
      'Total spent = real transactions (3000) + assume-spent rows (2500)');
    ok(totals.includes('R 2500.00'),
      'and the tile discloses how much of itself came from an assume-spent row');
  }

  /* ---- 4. the deficit is REAL money only ---- */
  {
    const { ctx } = await mount();
    eq(ctx.periodDeficit('2026-06'), 2500,
      'June ran R2 500 in the red: 12 500 out less 10 000 in');
    eq(ctx.budgetUsed('2026-07').assumed, 2500, 'July provisions exactly that much');
    /* The load-bearing one. July's real position is 10 000 in, 3 000 out — a
       R7 000 SURPLUS. If periodDeficit counted the assume-spent provision it
       would report July as R4 500 short, and pulling that into August would
       carry June's hole a second time, then a third, growing every period with
       no bank line anywhere behind it. */
    eq(ctx.periodDeficit('2026-07'), -7000,
      'the assume-spent provision must NOT count as this period\'s own overspend — that is how a carry compounds off nothing');
  }

  /* ---- 5. a period that paid for itself carries nothing ---- */
  {
    const { ctx } = await mount();
    ok(ctx.periodDeficit('2026-07') <= 0,
      'a surplus period yields no overspend, so the pull button has nothing to offer');
    // A period with no data at all is a surplus of zero, not a crash.
    eq(ctx.periodDeficit('2026-01'), 0, 'an empty period is level, not NaN');
  }

  /* ---- 6. the lag clamps ---- */
  {
    eq(overspendLag(undefined), OVERSPEND_LAG_DEFAULT, 'absent -> the default');
    eq(overspendLag(''), OVERSPEND_LAG_DEFAULT, 'blank -> the default');
    eq(overspendLag('nonsense'), OVERSPEND_LAG_DEFAULT, 'unreadable -> the default');
    eq(overspendLag('2'), 2, 'a plain number is taken as written');
    eq(overspendLag(3), 3, 'and so is a real number, not only a string');
    // 0 would read the period you are standing in, whose deficit is still
    // growing; a negative one would read the future.
    eq(overspendLag('0'), 1, 'zero clamps up to 1');
    eq(overspendLag('-4'), 1, 'negative clamps up to 1');
    eq(overspendLag('99'), OVERSPEND_LAG_MAX, 'absurdly large clamps down to the ceiling');

    const files = { ...FILES };
    files[`${B}/Settings.md`] = '---\nmonth_start_day: 1\ncurrency: "R"\noverspend_lag: 0\n---\n';
    const { S } = await mount(files);
    eq(S.settings.overspend_lag, 1, 'a hand-edited 0 in Settings.md is clamped by the loader, not just by the control');
  }

  console.log(`PASS — assume-spent rows are their own actual, and a carried overspend cannot compound (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
