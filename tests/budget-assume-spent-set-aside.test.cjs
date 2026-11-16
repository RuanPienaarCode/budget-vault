'use strict';
/* An unpaid savings / investment category marked "assume spent" adds nothing
   to Total spent or "% of spending budget used".

   `budgeted` (the base, budgetTotalsOf(budget).spend) leaves set-aside
   envelopes out, and real set-aside spend is subtracted from the numerator
   (budgetSpent: spend - setAside). The assume-spent provision filtered rows by
   "not income, not transfer" only, so a savings row's provision went into the
   numerator with nothing in the base:

     Groceries R4 000 budget, R3 000 spent; Emergency Fund (savings,
     assume_spent) R2 000 budget, no transfer yet
       -> "Total spent R 5000, 125% of spending budget used";
     after the R2 000 transfer the same household read R3 000 and 75%.

   The provision now covers exactly the rows budgetTotalsOf calls "spend", by
   asking the same predicate (budgetCountsAsSpend) rather than keeping a second
   list of types. A set-aside category contributes nothing to spent, assumed or
   used whether or not its transfer has happened.

   REAL loader, REAL budgets view over the DOM stub.
     node tests/budget-assume-spent-set-aside.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';

/* extra: more categories / budget rows / transactions for the variants. */
function files({ fundType = 'savings', fundPaid = false, groceriesAssumed = false, groceriesSpent = 3000, spendingExtra = false } = {}) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
    [`${B}/Categories/Groceries.md`]: `---\ntype: expense\ncolor: "#888888"\n${groceriesAssumed ? 'assume_spent: true\n' : ''}---\n`,
    [`${B}/Categories/Emergency Fund.md`]: `---\ntype: ${fundType}\ncolor: "#888888"\nassume_spent: true\n---\n`,
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Groceries | expense | 4000.00 | |\n'
      + `| Emergency Fund | ${fundType} | 2000.00 | |\n| Salary | income | 10000.00 | |\n`,
    [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-07-01 | Salary | Salary | 10000.00 |  |  |  |\n'
      + `| 2026-07-06 | Grocer | Groceries | -${groceriesSpent.toFixed(2)} |  |  |  |\n`
      + (fundPaid ? '| 2026-07-07 | To fund | Emergency Fund | -2000.00 |  |  |  |\n' : ''),
  };
}

async function mount(f) {
  const ctx = makeCtx(f);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', {}, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const v of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${v}`)(ctx);
  return { ctx, S, $ };
}
const used = ctx => ctx.budgetUsed('2026-07', { today: '2026-07-31' });
const strip = ($, ctx) => { ctx.renderBudgets(); return $('#budTotalsTop').textContent.replace(/\s+/g, ' '); };

(async () => {
  /* ---- the audited example, both states ---- */
  for (const type of ['savings', 'investment']) {
    const before = await mount(files({ fundType: type, fundPaid: false }));
    eq(used(before.ctx), { spent: 3000, budgeted: 4000, assumed: 0, setAside: 0, used: 0.75 },
      `${type}, transfer not made: Total spent 3000, 75% — the provision is not in the numerator`);
    const text = strip(before.$, before.ctx);
    ok(!/already spent/.test(text), `${type}, not made: the strip does not claim anything is "already spent" — got: ${text}`);
    ok(/75%/.test(text), `${type}, not made: the strip says 75% — got: ${text}`);

    const after = await mount(files({ fundType: type, fundPaid: true }));
    const a = used(after.ctx);
    eq([a.spent, a.used, a.assumed], [3000, 0.75, 0], `${type}, transfer made: the same household reads the same`);
    eq(used(before.ctx).used, a.used, `${type}: "used" is identical before and after the transfer`);
  }

  /* ---- unchanged: a SPENDING category's provision still counts ---- */
  {
    const m = await mount(files({ groceriesAssumed: true, groceriesSpent: 0 }));
    eq(used(m.ctx), { spent: 4000, budgeted: 4000, assumed: 4000, setAside: 0, used: 1 },
      'assume-spent spending category, no payment yet: its whole provision is still added');
    ok(/already spent/.test(strip(m.$, m.ctx)), 'and the strip still says so');
  }
  {
    const m = await mount(files({ groceriesAssumed: true, groceriesSpent: 3000 }));
    eq(used(m.ctx), { spent: 4000, budgeted: 4000, assumed: 1000, setAside: 0, used: 1 },
      'assume-spent spending category part-paid: only the shortfall is provisioned');
  }
  {
    const m = await mount(files({ groceriesAssumed: true, groceriesSpent: 5000 }));
    const u = used(m.ctx);
    eq([u.spent, u.assumed, u.used], [5000, 0, 1.25], 'assume-spent spending category that overran: real spend only, as before');
  }

  /* ---- both at once: the set-aside row adds nothing, the spending row still does ---- */
  {
    const m = await mount(files({ groceriesAssumed: true, groceriesSpent: 0, fundPaid: false }));
    const u = used(m.ctx);
    eq([u.spent, u.assumed], [4000, 4000], 'a spending provision alongside an unpaid set-aside one: only the spending one counts');
  }

  /* ---- the strip's clause agrees with `assumed` ---- */
  {
    const m = await mount(files({ groceriesAssumed: true, groceriesSpent: 0, fundPaid: false }));
    const text = strip(m.$, m.ctx);
    ok(/includes R 4000 already spent/.test(text), `the clause names the spending provision only — got: ${text}`);
  }

  console.log(`PASS budget-assume-spent-set-aside — an unpaid set-aside category marked "assume spent" adds nothing to spent / used, a spending one still does (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
