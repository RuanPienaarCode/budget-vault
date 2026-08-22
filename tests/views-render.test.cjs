'use strict';
/* Every view renders — the guard the Debt page did not have.

   In 1.13.0 the Debt page threw ReferenceError on every render for a whole
   release. The cause was a caption reaching for a binding declared in another
   function; the reason it SHIPPED is that views/debts.js had no test that ever
   called it. Forty-nine guard suites were green over a dead page, because the
   arithmetic beneath a view is easy to test and reads, at a glance, like
   coverage of the view.

   Three things conspire, and all three are still true of every other view:
     - `node --check` passes, because an out-of-scope name is valid syntax;
     - the repo has no linter;
     - controller.js's view dispatcher does NOT wrap the call, so a throw takes
       the page rather than degrading it. Only the Dashboard guards its cards.

   So this file makes the cheapest possible claim about every view — that it
   runs — and makes it against the REAL module over the shared DOM stub. It
   asserts almost nothing about what a view SAYS; suites that care about output
   already exist. What it refuses to allow is another page that throws.

   The view list is read out of src/controller.js rather than typed here, so a
   view added to the app without a test is caught by this file rather than
   quietly skipped by it.

   Runs in bare node. Wired into ./build.sh.
     node tests/views-render.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the list, read from the app ---------------------------------------
   controller.js dispatches on S.view through an object literal mapping each
   view name to its render function. Parsing that map is what keeps this file
   honest: a fourteenth view cannot be added without either appearing here or
   failing the completeness assertion below. */
const CONTROLLER = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
const DISPATCH = (() => {
  const start = CONTROLLER.indexOf('({ dashboard: ctx.renderDashboard');
  ok(start !== -1, 'the view dispatch map is still recognisable in controller.js');
  const chunk = CONTROLLER.slice(start, CONTROLLER.indexOf('[S.view]()', start));
  const out = [];
  for (const m of chunk.matchAll(/(\w+):\s*ctx\.(render\w+)/g)) out.push({ view: m[1], fn: m[2] });
  return out;
})();
ok(DISPATCH.length >= 13, `every dispatched view is covered (found ${DISPATCH.length})`);

/* ---- a vault with something on every page ------------------------------
   Every figure is synthetic. Never put real statement data in this repo. */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test"\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Transfer.md`]: '---\ntype: transfer\ncolor: "#666666"\n---\n',

  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ninstitution: "Bank A"\naccount_number: "12345678901"\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\ncredit_limit: 30000\nbalance: -4000.00\nsettle_monthly: true\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Savings Pot.md`]: '---\ntype: savings\nbalance: 55000.00\ngoal_amount: 100000\nmonthly_contribution: 2000\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Fund.md`]: '---\ntype: investment\nbalance: 90000.00\ntotal_invested: 75000\nbalance_updated: 2026-07-01\n---\n',

  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | |\n| Salary | income | 40000.00 | |\n',

  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n'
    + '| 2026-07-05 | Split parent | Groceries | -900.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-05 | Split parent | Groceries | -500.00 |  |  | part |\n'
    + '| 2026-07-05 | Split parent | Salary | -400.00 |  |  | part |\n'
    + '| 2026-07-09 | Uncategorised thing |  | -300.00 |  |  |  |\n',

  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card debt | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | | active | |\n'
    + '| Vehicle | Bank B | vehicle | 150000.00 | 200000.00 | 11.25 | 3500.00 | 0.00 | 2023-01-15 | | active | |\n',

  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n| House | property | 1500000.00 | 2026-03-01 | |\n| Car | vehicle | 180000.00 | | |\n',

  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n| Sam | 250.00 | lunch | 2026-08-01 | outstanding | |\n| Lee | 400.00 | tools | | paid | 400.00 |\n',

  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Streaming | Provider A | 199.00 | monthly | 2026-08-05 | Groceries | yes | |\n| Domain | Provider B | 250.00 | annual | 2026-11-01 | | no | |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | needed | | |\n\n## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n',
};

/* Mount every view module against one ctx, the way controller.js does — the
   modules are registered together and several read helpers off each other, so
   registering them in isolation would test a shape the app never runs. */
async function mountAll(files = FILES, period = '2026-07') {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = period;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  /* Built in controller.js alongside the ctx literal rather than published by a
     module, so makeCtx does not know about it and a view that uses it throws
     "not a function" — which reads like an app bug and is not one. Anything
     controller.js puts on the ctx directly has to be mirrored here. */
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, S, nodes };
}

(async () => {
  /* ---- 1. every dispatched view renders on a populated vault ---- */
  {
    const { ctx } = await mountAll();
    for (const { view, fn } of DISPATCH) {
      if (fn === 'renderPlan' && !ctx[fn]) continue;   // guarded below instead
      ok(typeof ctx[fn] === 'function',
        `controller dispatches "${view}" to ctx.${fn}, so some module must provide it`);
      assert.doesNotThrow(() => ctx[fn](),
        `the ${view} view must render without throwing — controller.js does not guard this call`);
      checks++;
    }
  }

  /* ---- 2. and on an EMPTY vault, which is what a new install is ----
     Half the crashes a view can have are in the "nothing to show" branch, and
     that is the branch the first person to open the plugin sees. */
  {
    const { ctx } = await mountAll({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n' });
    for (const { view, fn } of DISPATCH) {
      if (typeof ctx[fn] !== 'function') continue;
      assert.doesNotThrow(() => ctx[fn](),
        `the ${view} view must render on a vault with nothing in it — that is a new install`);
      checks++;
    }
  }

  /* ---- 3. twice in a row ----
     Every render* empties its container and rebuilds, and the app re-renders on
     a period change, a vault reload and a save. A view that only survives a
     first paint is broken in ordinary use. */
  {
    const { ctx } = await mountAll();
    for (const { view, fn } of DISPATCH) {
      if (typeof ctx[fn] !== 'function') continue;
      ctx[fn]();
      assert.doesNotThrow(() => ctx[fn](),
        `the ${view} view must survive a re-render — the app repaints on every period change`);
      checks++;
    }
  }

  /* ---- 4. on a period with no data at all ----
     Paging back before the vault's history is one tap, and several views divide
     by something they found in the period. */
  {
    const { ctx } = await mountAll(FILES, '2020-01');
    for (const { view, fn } of DISPATCH) {
      if (typeof ctx[fn] !== 'function') continue;
      assert.doesNotThrow(() => ctx[fn](),
        `the ${view} view must render for a period the vault has no data for`);
      checks++;
    }
  }

  /* ---- 5. the completeness claim ----
     If a view is added to the dispatcher, it lands in DISPATCH and is swept
     above automatically. This asserts the parse actually found them, so a
     refactor that reshapes the map fails loudly here rather than silently
     reducing this file to testing nothing. */
  {
    const names = DISPATCH.map(d => d.view);
    for (const v of ['dashboard', 'transactions', 'budgets', 'plan', 'savings', 'accounts',
      'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
      ok(names.includes(v), `"${v}" is still one of the views this file sweeps`);
    }
    eq(new Set(names).size, names.length, 'no view is dispatched twice');
  }

  /* ---- 6. manual mode hides the CSV affordances, and only advertises ----
     A household that types its transactions in by hand should not be handed a
     drawer link and a top-bar button for a screen that asks them for a file
     they do not have. applyInputMode() is exported from controller.js rather
     than living as a closure inside mountApp() for exactly this reason: as a
     closure the only way to reach it would be a full DOMParser shell mount,
     which no bare-node suite performs, so a selector that stopped matching
     would ship with every suite green.

     Both directions, because a household can change its mind: flipping the
     setting back to CSV and reloading has to bring the link back, and an
     add-only implementation would leave the drawer permanently short of an
     entry the settings screen says is on. */
  {
    const { applyInputMode } = require('../src/controller.js');
    const { FakeEl } = require('./helpers/dom-stub.cjs');
    const root = new FakeEl('div');
    const link = new FakeEl('button');
    link.attrs['data-view'] = 'import';
    const btn = new FakeEl('button');
    btn.attrs.id = 'topbarImport';
    root.append(link, btn);

    eq(applyInputMode(root, 'manual'), true, 'manual mode reports itself as manual');
    ok(link._cls.has('hidden'), 'manual mode hides the Import CSV drawer link');
    ok(btn._cls.has('hidden'), 'and the top-bar import button');

    eq(applyInputMode(root, 'csv'), false, 'csv mode reports itself as not manual');
    ok(!link._cls.has('hidden'), 'and puts the drawer link back — the setting is reversible');
    ok(!btn._cls.has('hidden'), 'and the top-bar button with it');

    /* An unknown value from a hand-edited Settings.md behaves as CSV, which is
       what every vault written before input_mode existed says. */
    applyInputMode(root, 'manual');
    eq(applyInputMode(root, 'nonsense'), false, 'an unrecognised mode is not manual');
    ok(!link._cls.has('hidden'), 'so the drawer link stays where it has always been');

    /* Missing nodes are not an error: the wizard's own modal and the connect
       screen both mount before the top bar exists. */
    assert.doesNotThrow(() => applyInputMode(new FakeEl('div'), 'manual'),
      'a root without the import affordances must not throw');
    checks++;
  }

  console.log(`PASS — all ${DISPATCH.length} views render, empty and populated (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
