'use strict';
/* Debt view — does it actually RENDER?

   This file exists because of a specific escape. The Debt-free tile's caption
   was changed to name the assumptions it folds in, and the new line reached for
   a bare `extra` — a binding declared in renderDebtPlan, a DIFFERENT function.
   That is a ReferenceError the instant the page draws its tiles, and unlike the
   Dashboard, this view has no per-card try/catch to contain it: the throw takes
   the whole Debt page down.

   It shipped. Every one of the 49 guard suites was green while the page was
   dead, because views/debts.js had no test that ever CALLED it — the arithmetic
   under it (debt-math.js) is thoroughly covered, and coverage of the maths reads
   like coverage of the page.

   So this is deliberately not a test of what the Debt page says. It is a test
   that the Debt page RUNS: mount the real module over a DOM stub, call every
   render path, and fail on a throw. `node --check` cannot catch this class —
   an out-of-scope identifier is valid syntax — and the repo has no linter, so
   executing the code is the only thing that does.

   Runs in bare node. Wired into ./build.sh.
     node tests/debts-render.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const noThrow = (fn, m) => { assert.doesNotThrow(fn, m); checks++; };

/* The DOM comes from tests/helpers/dom-stub.cjs — the same one
   views-render.test.cjs uses. A private copy here was the obvious thing to
   write and the wrong thing to keep: two stubs drift, and the one that drifts
   is always the one the failing test is using. */

const B = 'Budget';
/* Two debts so the payoff simulation has an ordering to make, one of them a
   settled row so the `status !== 'paid'` filter is exercised. Balances and
   rates are ordinary and synthetic — nothing here is anyone's real debt. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | | active | |\n'
    + '| Vehicle | Bank B | vehicle | 150000.00 | 200000.00 | 11.25 | 3500.00 | 0.00 | 2023-01-15 | | active | |\n'
    + '| Old | Bank C | personal loan | 0.00 | 5000.00 | 15.00 | 500.00 | 0.00 | 2022-01-01 | | paid | |\n',
};

async function mount(files = FILES, extra = '') {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $, nodes } = makeDom();
  $('#debtExtra').value = extra;
  $('#debtStrategy').value = 'avalanche';
  ctx.$ = $;
  ctx.root = $('#root');
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/debts')(ctx);
  return { ctx, S, nodes };
}

(async () => {
  /* ---- 1. the page draws at all ---- */
  {
    const { ctx, nodes } = await mount();
    noThrow(() => ctx.renderDebts(), 'renderDebts must not throw on an ordinary vault');
    ok(nodes.get('#debtKpis').children.length > 0, 'the KPI tiles are drawn, not merely attempted');
    ok(nodes.get('#debtPlan').children.length > 0, 'the payoff plan is drawn');
    ok(nodes.get('#debtTable').children.length > 0, 'the debt table is drawn');
  }

  /* ---- 2. the exact escape: a what-if extra reaches the caption ----
     `extra` was out of scope in renderDebtKpis, so ANY render threw — but this
     pins the branch that actually reads it, which is the one a reader reaches
     by typing into the planner box. */
  {
    const { ctx, nodes } = await mount(FILES, '3000');
    noThrow(() => ctx.renderDebts(), 'a what-if extra must not throw on the way into the Debt-free caption');
    const txt = nodes.get('#debtKpis').textContent;
    ok(/3\s?000/.test(txt.replace(/ /g, ' ')),
      'and the caption states the extra it folded in, rather than promising a date that assumes it silently');
  }

  /* ---- 3. replan, the path the planner controls call ---- */
  {
    const { ctx } = await mount(FILES, '500');
    noThrow(() => ctx.replan(), 'replan must not throw');
  }

  /* ---- 4. an empty vault is a normal state, not an edge case ---- */
  {
    const { ctx } = await mount({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n' });
    noThrow(() => ctx.renderDebts(), 'a vault with no debts at all must still draw the page');
  }

  /* ---- 5. every debt settled — the branch where totals are zero ---- */
  {
    const paidOnly = {
      ...FILES,
      [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
        + '| Old | Bank C | personal loan | 0.00 | 5000.00 | 15.00 | 500.00 | 0.00 | 2022-01-01 | | paid | |\n',
    };
    const { ctx } = await mount(paidOnly);
    noThrow(() => ctx.renderDebts(), 'a vault whose debts are all settled must draw without dividing by zero');
  }

  console.log(`PASS — the Debt view renders (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
