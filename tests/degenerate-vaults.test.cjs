'use strict';
/* The degenerate-vault sweep — a matrix of implausible-but-real vault shapes
   crossed with every dispatched view, driven through the REAL loader and the
   REAL view modules (tests/helpers/harness.cjs), not a hand-mirrored copy of
   either.

   tests/views-render.test.cjs proves every view RUNS, on one hand-tuned
   "something on every page" vault. That is a smoke test, and a smoke test is
   exactly what let every one of these ship on a vault someone could have
   written by hand:

     - a household with no recognised income scored 100/100 "Strong" because
       every OTHER measure came back null and the one that survived inherited
       the whole score;
     - R250 000 of debt with a blank Rate cell earned full marks on "Nothing
       is lost to interest", because table-schema's money() reader turns a
       blank cell into 0 and a MEASURED zero is not the same claim as an
       UNANSWERED question;
     - a transaction dated 2025-13-05 (a real 2025-05-13 with the day and
       month swapped) passed ISO_DATE's shape-only check, was bucketed under
       the unwalkable month key '2025-13' by one function, and then never
       visited by the calendar walk that sums the chart's own points — gone
       from a total that still claimed to include it.

   Every one of those specific bugs is guarded elsewhere today (health-math.js
   §budgetUsed/§debtInterestMonthly, savings-math.js §monthOf) — this file's
   job is not to re-discover them, it is to keep them guarded from the OTHER
   side: through the loader, through the view, on a vault nobody hand-tuned
   for the assertion. Three of the shapes below carry a negative control
   (§NEGATIVE CONTROLS) that reintroduces the old behaviour in a scratch copy
   of the fixed module and proves the assertion actually goes red without it —
   an assertion nobody has watched fail is not a guard, it is a comment.

   Three more bugs turned up WHILE BUILDING this sweep, were reported rather
   than fixed here (per this file's original brief: this lane reports, it does
   not fix), and have SINCE been fixed elsewhere — src/acct-status.js,
   src/views/debts.js and src/views/savings.js. §FIXED BUGS below (formerly
   §LIVE BUG) now pins each one down the same way §NEGATIVE CONTROLS pins the
   three older fixes above it: reverted in a scratch copy, proved red without
   the fix, proved green against main.

   Runs in bare node. Wired into ./build.sh via scripts/run-tests.mjs, which
   auto-discovers every tests/*.test.cjs file.
     node tests/degenerate-vaults.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
const i18n = require('../src/i18n');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the dispatched-view list, read out of controller.js -----------------
   Exactly the parse views-render.test.cjs uses, so a sixteenth view lands in
   this sweep automatically instead of being silently skipped by a hardcoded
   list here. Kept as a second, independent extraction (not a shared import)
   deliberately: if the two ever disagreed about what controller.js dispatches
   that would itself be worth seeing fail. */
const CONTROLLER = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
const DISPATCH = (() => {
  const start = CONTROLLER.indexOf('({ dashboard: ctx.renderDashboard');
  ok(start !== -1, 'the view dispatch map is still recognisable in controller.js');
  const chunk = CONTROLLER.slice(start, CONTROLLER.indexOf('[S.view]()', start));
  const out = [];
  for (const m of chunk.matchAll(/(\w+):\s*ctx\.(render\w+)/g)) out.push({ view: m[1], fn: m[2] });
  return out;
})();
ok(DISPATCH.length === 16, `all 16 dispatched views are still parsed out of controller.js (found ${DISPATCH.length})`);

// 'report' right after 'dashboard' — see views-render.test.cjs's mountAll for
// why the order is load-bearing (views/report.js reads dashboard.js's own
// ctx.provide()'d budgetVsActualRows/categorySpendRows at register time).
const VIEW_MODULES = ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
  'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import'];

/* Mounts one vault against one fresh ctx + DOM, the way controller.js does —
   copied from views-render.test.cjs's mountAll rather than imported, because
   this file may not edit that one and the two harnesses are allowed to drift
   on purpose (this one never calls ctx.renderScore()'s hero-ring override,
   for instance). */
/* `viewsDir` is an escape hatch for the negative controls below: pointing it
   at a scratch copy of src/views lets a probe mount the REAL view stack
   against a deliberately-reverted single file, rather than a hand-mirrored
   copy of what that view does. Omitted, it resolves to this repo's own
   src/views — every existing call site keeps working unchanged. */
async function mount(files, period, viewsDir) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  if (period) S.period = period;
  const { $, nodes } = makeDom();
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
  const base = viewsDir || path.join(__dirname, '..', 'src', 'views');
  for (const f of VIEW_MODULES) require(path.join(base, `${f}.js`))(ctx);
  return { ctx, S, nodes };
}

/* ---- the garbage scan -----------------------------------------------------
   Every top-level node the DOM stub has ever handed out (makeDom's `$` is
   flat and auto-vivifying — see its own header) plus every one of their
   descendants, checked two ways: rendered TEXT for a leaked raw value, and
   every attribute for the same thing reaching an SVG/geometry attribute
   instead (stroke-dasharray, d, width, cx, …) — text.match alone would miss a
   chart whose <path> carries "NaN,Infinity" with no text node anywhere near
   it.

   Word-boundaried on purpose: `\bnull\b` does not fire on "annulled", and
   grepping src/lang/en.js confirms no real copy in this app uses any of these
   five tokens as an English word (the one near-miss, 'acct.err.nan', reads
   "Not a number" — no match). */
const GARBAGE = [
  { name: 'NaN', re: /\bNaN\b/ },
  { name: 'Infinity', re: /\bInfinity\b/ },
  { name: 'undefined', re: /\bundefined\b/ },
  { name: 'null', re: /\bnull\b/ },
  { name: '[object Object]', re: /\[object Object\]/ },
];
function garbageIn(nodes, shapeName, viewName) {
  for (const [key, top] of nodes) {
    const text = top.textContent || '';
    for (const g of GARBAGE) {
      const m = text.match(g.re);
      ok(!m, `${shapeName} / ${viewName}: "${key}" renders the literal ${g.name} — `
        + `"…${text.slice(Math.max(0, m ? m.index - 40 : 0), (m ? m.index : 0) + 40)}…"`);
    }
    for (const d of [top, ...descend(top)]) {
      for (const [attr, val] of Object.entries(d.attrs || {})) {
        if (typeof val !== 'string') continue;
        ok(!/NaN|Infinity/.test(val),
          `${shapeName} / ${viewName}: "${key}" → <${d.tagName.toLowerCase()} ${attr}="${val}"> `
          + 'carries a non-finite number into an attribute');
      }
    }
  }
}

/* The value text of one dom.js kpiTiles() tile, found by its label — src/dom.js
   builds each as `<div class=mini><div class=l>label</div><div class=v>value
   </div></div>`. Reading a whole card's textContent for one figure is a false
   positive waiting to happen whenever a SIBLING tile states the same number
   for an unrelated reason (see the account-type-capitalised `after` check and
   NC6 below, both of which hit exactly that with the "Net worth" tile). */
function tileValue(container, label) {
  if (!container) return null;
  for (const c of container.children) {
    if (c.children && c.children[0] && String(c.children[0].textContent) === label) {
      return c.children[1] ? String(c.children[1].textContent) : null;
    }
  }
  return null;
}

/* ---- vault-shape builders -------------------------------------------------
   Kept tiny and composable so a new shape is a few lines, not a new fixture
   file — the brief's own ask ("cheap for the next person to add a shape"). */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const settings = (extra = '') => `---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test"\n${extra}---\n`;
const category = (name, type, extra = '') => [`${B}/Categories/${name}.md`, `---\ntype: ${type}\n${extra}---\n`];
const account = (name, fm) => [`${B}/Accounts/${name}.md`, `---\n${fm}---\n`];
const txRow = (date, desc, cat, amount, excluded = '', note = '', split = '') =>
  `| ${date} | ${desc} | ${cat} | ${amount.toFixed(2)} | ${excluded} | ${note} | ${split} |\n`;
const txFile = (acct, month, rows) => [`${B}/Transactions/${acct}/${month}.md`,
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n${rows.join('')}`];
const debtsFile = rows => [`${B}/Debts.md`, '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n' + rows.join('')];
const debtRow = (name, balance, rate, payment, status = 'active', extra = '') =>
  `| ${name} | Bank | credit card | ${balance.toFixed(2)} | ${balance.toFixed(2)} | ${rate} | ${payment} | 0.00 | 2024-01-01 | | ${status} | ${extra} |\n`;
const assetsFile = rows => [`${B}/Assets.md`, '---\nkind: assets\n---\n\n'
  + '| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n' + rows.join('')];
const owedFile = rows => [`${B}/Owed Money.md`, '---\nkind: owed\n---\n\n'
  + '| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n' + rows.join('')];
const servicesFile = rows => [`${B}/Services.md`, '---\nkind: services\n---\n\n'
  + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n' + rows.join('')];
const budgetFile = (period, rows) => [`${B}/Budgets/${period}.md`, '---\nkind: budget\n---\n\n'
  + '| Category | Type | Amount | Notes |\n|---|---|---:|---|\n' + rows.join('')];

const files = (...pairs) => Object.fromEntries(pairs);

/* Real calendar months before "now", counted the way period.js's own
   shiftPeriod does for a month_start_day: 1 vault (a straight calendar month)
   — health-data.js's trailing window looks at the SIX PERIODS BEFORE
   currentPeriod(), never the one on screen, so a fixed 2026-07 fixture would
   silently stop exercising that window the day this suite is run a year late.
   Same anchoring views-render.test.cjs's own §7b already had to adopt for the
   money-flow card. */
function pastMonth(n) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1 - n;
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/* ============================================================================
   THE MATRIX — shape × the 15 dispatched views.

   Each shape is a complete vault (`files`) plus an optional `after` map of
   view -> extra assertion run ONLY for that (shape, view) cell, on top of the
   two blanket checks (does not throw, renders no garbage token) every cell
   gets regardless. Where a shape exists specifically to prove one view's
   empty state is a real empty state and not a bordered skeleton, its `after`
   entry is that proof. ============================================================================ */
const SHAPES = [];

/* ---- 1. completely empty vault — day one of a fresh install --------------- */
SHAPES.push({ name: 'completely-empty-vault', files: files() });

/* ---- 2. exactly one of everything ------------------------------------------
   Not zero of everything (already covered) and not "something on every page"
   (views-render.test.cjs already owns that) — the boundary between them,
   where a `.reduce` over one element or a `[0]` off a one-long array is where
   an off-by-one actually shows up. */
SHAPES.push({
  name: 'exactly-one-of-everything',
  files: files(
    ['Budget/Settings.md', settings()],
    category('Groceries', 'expense'),
    account('Cheque', 'type: checking\nbalance: 1000.00\nbalance_updated: 2026-01-01\n'),
    txFile('Cheque', '2026-01', [txRow('2026-01-05', 'Shop', 'Groceries', -100)]),
    budgetFile('2026-01', ['| Groceries | expense | 200.00 | |\n']),
    debtsFile([debtRow('Card', 500, '20.00', '50.00')]),
    assetsFile(['| Bike | vehicle | 3000.00 | 2026-01-01 | |\n']),
  ),
  period: '2026-01',
});

/* ---- 3–5. zero income, three different ways --------------------------------
   The Dashboard health card and the Score page both derive "hasIncome" from
   whether ANY category typed `income` produced money — not from whether the
   word "salary" appears anywhere in the vault. All three genuinely have zero
   recognised income; only the REASON differs, and each reason is a vault a
   person actually writes. */
SHAPES.push({
  name: 'zero-income-no-income-category-at-all',
  files: files(
    ['Budget/Settings.md', settings()],
    category('Groceries', 'expense'),
    account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
    txFile('Cheque', '2026-01', [txRow('2026-01-05', 'Shop', 'Groceries', -300)]),
  ),
  period: '2026-01',
});
SHAPES.push({
  name: 'zero-income-category-name-has-no-file',
  /* The row names a category no Categories/ file answers to — catType()
     returns null for it (period.js), which is NOT the same as 'income', so
     this money is invisible to every income-typed measure even though a
     human reading the transaction table would call it income at a glance. */
  files: files(
    ['Budget/Settings.md', settings()],
    category('Groceries', 'expense'),
    account('Cheque', 'type: checking\nbalance: 40500.00\nbalance_updated: 2026-01-01\n'),
    txFile('Cheque', '2026-01', [
      txRow('2026-01-01', 'Pay', 'Wages', 40000),
      txRow('2026-01-05', 'Shop', 'Groceries', -300),
    ]),
  ),
  period: '2026-01',
});
SHAPES.push({
  name: 'zero-income-all-in-non-budget-account',
  /* `budget: false` opts the account's OWN inflow out of the household
     totals (load.js's in_budget) — a joint account the reader has
     deliberately excluded still exists, but periodSummary()'s income figure
     must not count what landed in it. */
  files: files(
    ['Budget/Settings.md', settings()],
    category('Salary', 'income'),
    category('Groceries', 'expense'),
    account('Offshore', 'type: checking\nbudget: false\nbalance: 40000.00\nbalance_updated: 2026-01-01\n'),
    account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
    txFile('Offshore', '2026-01', [txRow('2026-01-01', 'Pay', 'Salary', 40000)]),
    txFile('Cheque', '2026-01', [txRow('2026-01-05', 'Shop', 'Groceries', -300)]),
  ),
  period: '2026-01',
});

/* ---- 6–11. debt-page pathology -------------------------------------------- */
SHAPES.push({ name: 'no-debts-page-at-all', files: files(['Budget/Settings.md', settings()]),
  after: { debts: nodes => {
    const kpis = nodes.get('#debtKpis');
    ok(kpis && kpis.textContent.includes('No debt tracked'),
      'a vault with no Debts.md at all gets the "No debt tracked" empty state, not four hollow zero tiles');
  } } });
SHAPES.push({
  /* Formerly asserted only via LIVE BUG 3 below the matrix: renderDebtKpis's
     first empty-state branch is gated on `!S.debts.length` (zero ROWS), not on
     zero ACTIVE debts, so a fully paid-off book used to fall through to the
     ordinary tile path and render the four hollow zero tiles the same comment
     in debts.js names as the thing that branch exists to avoid. Fixed with a
     second gate on activeDebts() — see §FIXED BUGS for the reverted-and-proved
     negative control; the `after` check here pins the same fix through the
     matrix's own real vault, on top of that. */
  name: 'all-debts-paid-off',
  files: files(['Budget/Settings.md', settings()],
    debtsFile([debtRow('Old card', 0, '20.00', '0.00', 'paid')])),
  after: { debts: nodes => {
    const kpis = nodes.get('#debtKpis');
    ok(kpis && kpis.textContent.includes('Debt-free') && kpis.textContent.includes('paid in full'),
      'a fully paid-off debt book gets its own "Debt-free" empty state, not the four-hollow-zero-tile skeleton');
    ok(!kpis.textContent.includes('Total debt'),
      'and never falls through to the ordinary tile path — the exact shape the paid-off gate exists to avoid');
  } },
});
SHAPES.push({ name: 'debt-blank-rate', files: files(['Budget/Settings.md', settings()],
  debtsFile([debtRow('Card', 8000, '', '400.00')])) });
SHAPES.push({ name: 'debt-blank-payment', files: files(['Budget/Settings.md', settings()],
  debtsFile([debtRow('Card', 8000, '20.00', '')])) });
SHAPES.push({ name: 'debt-zero-rate-stated', files: files(['Budget/Settings.md', settings()],
  debtsFile([debtRow('Card', 8000, '0.00', '400.00')])) });
SHAPES.push({ name: 'debt-payment-below-monthly-interest',
  /* R250 000 at 22% is ~R4 583/mo in interest alone; a R500 payment never
     touches principal — debt-math.js's own simulate() has to cap at
     MAX_MONTHS rather than loop forever or return Infinity. */
  files: files(['Budget/Settings.md', settings()],
    debtsFile([debtRow('Card', 250000, '22.00', '500.00')])) });

/* ---- 12–15. net-worth pathology -------------------------------------------- */
SHAPES.push({ name: 'negative-net-worth', files: files(['Budget/Settings.md', settings()],
  account('Cheque', 'type: checking\nbalance: -500.00\nbalance_updated: 2026-01-01\n'),
  debtsFile([debtRow('Card', 20000, '20.00', '500.00')])) });
SHAPES.push({ name: 'every-account-overdrawn', files: files(['Budget/Settings.md', settings()],
  account('Cheque', 'type: checking\nbalance: -1200.00\nbalance_updated: 2026-01-01\n'),
  account('Card', 'type: credit_card\nbalance: -4000.00\nbalance_updated: 2026-01-01\n')) });
SHAPES.push({ name: 'group-nets-to-exactly-zero', files: files(['Budget/Settings.md', settings()],
  account('Cheque', 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-01-01\n'),
  account('Card', 'type: credit_card\nbalance: -5000.00\nbalance_updated: 2026-01-01\n')) });
SHAPES.push({ name: 'multi-currency-account', files: files(['Budget/Settings.md', settings()],
  account('Cheque', 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-01-01\n'),
  account('Euro Wallet', 'type: checking\ncurrency: "€"\nbalance: 400.00\nbalance_updated: 2026-01-01\n')) });

/* ---- 16–19. account-type case/whitespace drift -----------------------------
   `load.js` only DEFAULTS `type` when the frontmatter key is absent — a
   present-but-odd value reaches every downstream reader verbatim. This
   uncovered a live bug in views/savings.js (§FIXED BUGS, formerly §LIVE BUG):
   a capitalised type counted toward net worth on this very page while
   showing 0 accounts and R0,00 on the savings tile beside it. Fixed with
   views/savings.js's own typeIs() fold; the `after` check below pins it
   through this shape as well as through the scratch-copy negative control. */
SHAPES.push({ name: 'account-type-capitalised', files: files(['Budget/Settings.md', settings()],
  account('Pot', 'type: Savings\nbalance: 55000.00\nbalance_updated: 2026-01-01\n')),
  after: { savings: nodes => {
    /* The SPECIFIC "Savings" tile, not the whole card's text — the "Net
       worth" tile beside it states the same R 55000.00 whether or not the
       fold works (worth() sums by sign, unaffected by typeIs()), so a
       whole-card substring match would pass even on the reverted, buggy
       function. tileValue() reads the one tile that is actually the claim
       under test. */
    ok(tileValue(nodes.get('#savingsKpis'), 'Savings') === 'R 55000.00',
      `the capitalised type: Savings account is counted on the SAVINGS tile itself, not left at `
      + `R 0.00 beside a net-worth tile that already counts it — got "${tileValue(nodes.get('#savingsKpis'), 'Savings')}"`);
  } } });
SHAPES.push({ name: 'account-type-padded', files: files(['Budget/Settings.md', settings()],
  account('Pot', "type: ' savings '\nbalance: 55000.00\nbalance_updated: 2026-01-01\n")) });
SHAPES.push({ name: 'account-type-unrecognised', files: files(['Budget/Settings.md', settings()],
  account('Pot', 'type: tfsa\nbalance: 55000.00\nbalance_updated: 2026-01-01\n')) });
SHAPES.push({ name: 'account-type-blank', files: files(['Budget/Settings.md', settings()],
  account('Pot', 'type: \nbalance: 55000.00\nbalance_updated: 2026-01-01\n')) });

/* ---- 20–25. date pathology -------------------------------------------------- */
SHAPES.push({ name: 'future-balance-updated', files: files(['Budget/Settings.md', settings()],
  account('Cheque', 'type: checking\nbalance: 12000.00\nbalance_updated: 2099-01-01\n'),
  txFile('Cheque', '2026-01', [txRow('2026-01-05', 'Shop', '', -2100)])) });
SHAPES.push({ name: 'future-inception-date-no-rows', files: files(['Budget/Settings.md', settings()],
  account('Fund', 'type: investment\nbalance: 10000.00\nstarting_amount: 10000.00\ninception_date: 2099-01-01\nbalance_updated: 2026-01-01\n')) });
SHAPES.push({ name: 'transaction-date-day-month-swapped', files: files(['Budget/Settings.md', settings()],
  category('Groceries', 'expense'),
  account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
  txFile('Cheque', '2026-01', [
    txRow('2026-01-05', 'Shop', 'Groceries', -300),
    txRow('2026-13-45', 'Typo\'d row', 'Groceries', -200),
  ])) });
SHAPES.push({ name: 'non-iso-asset-valued-date', files: files(['Budget/Settings.md', settings()],
  assetsFile(['| House | property | 1500000.00 | when we bought it | |\n'])) });
SHAPES.push({ name: 'non-iso-owed-due-date', files: files(['Budget/Settings.md', settings()],
  owedFile(['| Sam | 250.00 | lunch | whenever | outstanding | |\n'])) });
SHAPES.push({ name: 'row-filed-under-wrong-month-file',
  /* A row whose Date column disagrees with the FOLDER it physically lives in
     — the file is named 2026-01.md but the row itself says August. */
  files: files(['Budget/Settings.md', settings()],
    category('Groceries', 'expense'),
    account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
    txFile('Cheque', '2026-01', [txRow('2026-08-15', 'Misfiled', 'Groceries', -300)])) });

/* ---- 26–28. orphaned references --------------------------------------------- */
SHAPES.push({ name: 'orphan-category-no-file', files: files(['Budget/Settings.md', settings()],
  account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
  txFile('Cheque', '2026-01', [txRow('2026-01-05', 'Shop', 'GhostCategory', -300)])) });
SHAPES.push({ name: 'orphan-transactions-folder-no-account', files: files(['Budget/Settings.md', settings()],
  category('Groceries', 'expense'),
  txFile('Ghost Account', '2026-01', [txRow('2026-01-05', 'Shop', 'Groceries', -300)])) });
SHAPES.push({ name: 'renamed-account-tx-label-mismatch',
  /* The account file was renamed but tx_label was not updated to match the
     on-disk Transactions/ folder that is still importing under the old name. */
  files: files(['Budget/Settings.md', settings()],
    category('Groceries', 'expense'),
    account('New Name', 'type: checking\ntx_label: Old Name\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
    txFile('Old Name', '2026-01', [txRow('2026-01-05', 'Shop', 'Groceries', -300)])) });

/* ---- 29–31. split pathology -------------------------------------------------- */
SHAPES.push({ name: 'split-parent-with-no-parts', files: files(['Budget/Settings.md', settings()],
  category('Groceries', 'expense'),
  account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
  txFile('Cheque', '2026-01', [txRow('2026-01-05', 'Orphan split', 'Groceries', -900, 'yes', '', 'parent')])) });
SHAPES.push({ name: 'split-parts-do-not-sum-to-parent', files: files(['Budget/Settings.md', settings()],
  category('Groceries', 'expense'),
  account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
  txFile('Cheque', '2026-01', [
    txRow('2026-01-05', 'Split parent', 'Groceries', -900, 'yes', '', 'parent'),
    txRow('2026-01-05', 'Split parent', 'Groceries', -100, '', '', 'part'),
  ])) });
SHAPES.push({ name: 'split-partially-reversed', /* excluded cleared by hand, split:parent left standing */
  files: files(['Budget/Settings.md', settings()],
    category('Groceries', 'expense'),
    account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
    txFile('Cheque', '2026-01', [
      txRow('2026-01-05', 'Split parent', 'Groceries', -900, '', '', 'parent'),
      txRow('2026-01-05', 'Split parent', 'Groceries', -500, '', '', 'part'),
    ])) });

/* ---- 32–36. zero/negative figures -------------------------------------------- */
SHAPES.push({ name: 'starting-amount-zero', files: files(['Budget/Settings.md', settings()],
  account('Fund', 'type: investment\nbalance: 300.00\nstarting_amount: 0.00\ninception_date: 2026-01-01\nbalance_updated: 2026-01-01\n')) });
SHAPES.push({ name: 'total-invested-zero', files: files(['Budget/Settings.md', settings()],
  account('Fund', 'type: investment\nbalance: 300.00\ntotal_invested: 0.00\nbalance_updated: 2026-01-01\n')) });
SHAPES.push({ name: 'goal-amount-zero-and-negative', files: files(['Budget/Settings.md', settings()],
  account('PotA', 'type: savings\nbalance: 100.00\ngoal_amount: 0\nbalance_updated: 2026-01-01\n'),
  account('PotB', 'type: savings\nbalance: 100.00\ngoal_amount: -1\nbalance_updated: 2026-01-01\n')),
  after: { savings: nodes => {
    const goals = nodes.get('#savingsGoals');
    ok(goals && goals.textContent.includes('No goals set yet'),
      'goal_amount 0 and -1 both fail the > 0 filter, so the goals card shows its real empty state');
    ok(!goals.textContent.includes('Goal reached'),
      'no account here has a positive goal, so nothing may claim one is reached — the exact 1.15-era bug (a.balance >= a.goal_amount true for any balance against a negative goal)');
  } } });
SHAPES.push({ name: 'negative-asset-value', files: files(['Budget/Settings.md', settings()],
  assetsFile(['| Broken thing | other | -500.00 | 2026-01-01 | |\n'])) });
SHAPES.push({ name: 'negative-owed-amount', files: files(['Budget/Settings.md', settings()],
  owedFile(['| Sam | -50.00 | refund owed to them | | outstanding | |\n'])) });

/* ---- run the matrix -------------------------------------------------------- */
async function runMatrix() {
  for (const shape of SHAPES) {
    const { ctx, nodes } = await mount(shape.files, shape.period);
    for (const { view, fn } of DISPATCH) {
      if (typeof ctx[fn] !== 'function') { ok(false, `${shape.name}: ctx.${fn} is missing for view "${view}"`); continue; }
      assert.doesNotThrow(() => ctx[fn](),
        `${shape.name} / ${view}: must render without throwing — that is this whole file's first claim`);
      checks++;
      garbageIn(nodes, shape.name, view);
      const extra = shape.after && shape.after[view];
      if (extra) extra(nodes, ctx);
    }
  }
  console.log(`PASS — degenerate-vault matrix: ${SHAPES.length} shapes × ${DISPATCH.length} views `
    + `(${SHAPES.length * DISPATCH.length} cells).`);
}

/* ============================================================================
   TARGETED DEEP DIVES — the marquee scenarios named in the brief, each
   through the real loader end to end, asserting the FIGURE rather than only
   "did not throw". ============================================================================ */
async function runDeepDives() {
  /* ---- A. zero income, no earmarked fund -> NO fabricated score, anywhere.
     health-math.js already guards every individual ratio behind hasIncome;
     this proves the end-to-end consequence a household actually sees: with no
     income and no emergency_fund flag on any account, every one of the five
     pillars comes back null, financialScore() has nothing live to renormalise
     over, and BOTH surfaces that would otherwise say "100" or "Strong" say
     nothing measurable instead. */
  {
    const f = files(['Budget/Settings.md', settings()],
      category('Groceries', 'expense'),
      account('Cheque', 'type: checking\nbalance: 500.00\nbalance_updated: 2026-01-01\n'),
      ...[1, 2, 3, 4, 5, 6].map(n => txFile('Cheque', pastMonth(n), [txRow(`${pastMonth(n)}-05`, 'Shop', 'Groceries', -300)])),
    );
    const { ctx, nodes } = await mount(f);
    const snap = ctx.healthSnapshot();
    ok(snap.breakdown === null, 'zero income and no earmarked fund: healthSnapshot has no score to report, not a fabricated one');
    ok(snap.empty === true, 'and reports itself empty, which is what hides the Dashboard health card entirely');

    ctx.renderScore();
    const hero = nodes.get('#scoreHero');
    /* The UNMEASURED copy, not the too-new one. This vault has six completed
       periods of groceries — it is not short of history, it is short of
       income, and "not enough history yet" would send it hunting for periods
       it already has. The Score page picks between the two on countedPeriods
       for exactly this reason. */
    ok(hero.textContent.includes(i18n.t('score.empty.unmeasured.title')),
      'the Score page names the real reason — no income to measure against — rather than printing any number');
    ok(!hero.textContent.includes(i18n.t('score.empty.title')),
      'and does not tell a household with six months of history that it has too little history');
    ok(!/\b100\b/.test(hero.textContent) && !hero.querySelector('.score-ring'),
      'no score value and no ring are drawn — the exact shape of the "100/100 Strong off one surviving measure" bug');

    ctx.renderDashboard();
    const card = nodes.get('#healthCard');
    ok(card.classList.contains('hidden'), 'and the Dashboard health card stays hidden rather than showing hollow tiles');
    checks += 4;
  }

  /* ---- B. a debt with a blank Rate, otherwise scoring well on its
     instalments -> the debt pillar's "good" line must say the rate is
     unrecorded, never "Nothing is lost to interest". health-math.js's own
     debtInterestMonthly returns null (not a measured 0) whenever every active
     debt has a blank rate, which excludes `interest` from the pillar's inner
     average and leaves it standing on `instalments` alone — so a low
     instalment share can genuinely earn the pillar a place in the "going
     well" list. i18n.js's 'score.win.debt' ("Nothing is lost to interest.")
     is the string this must NOT show; 'score.win.debtNoRate' is the one
     that must. */
  {
    const f = files(['Budget/Settings.md', settings()],
      category('Groceries', 'expense'),
      category('Salary', 'income'),
      account('Cheque', 'type: checking\nbalance: 40000.00\nbalance_updated: 2026-01-01\n'),
      ...[1, 2, 3, 4, 5, 6].map(n => txFile('Cheque', pastMonth(n), [
        txRow(`${pastMonth(n)}-01`, 'Pay', 'Salary', 40000),
        txRow(`${pastMonth(n)}-05`, 'Shop', 'Groceries', -3000),
      ])),
      debtsFile([debtRow('Card', 8000, '', '500.00')]),   // blank rate on disk, low payment
    );
    const { ctx, nodes } = await mount(f);
    const snap = ctx.healthSnapshot();
    ok(snap.debtInterest === null, 'a book with debts but no stated rate anywhere reports interest as UNMEASURED, not R0');
    const debtPillar = snap.breakdown && snap.breakdown.pillars.find(p => p.key === 'debt');
    ok(!!debtPillar, 'the debt pillar is still live off instalments alone');

    ctx.renderScore();
    const good = nodes.get('#scoreGood');
    if (debtPillar && debtPillar.at >= 0.9) {
      ok(good.textContent.includes(i18n.t('score.win.debtNoRate')),
        'the debt win explains the rate is unrecorded');
      ok(!good.textContent.includes(i18n.t('score.win.debt')),
        '"Nothing is lost to interest" must never print when no rate was ever supplied — the R250,000-at-full-marks bug');
    } else {
      // The fixture is tuned to land the pillar at >=0.9; if a future change
      // to the weights moves it, fail loudly here rather than silently
      // passing on a cell the fixture no longer reaches.
      ok(false, `fixture no longer lands the debt pillar in the "good" list (at=${debtPillar && debtPillar.at}) — retune the fixture`);
    }
    checks += 2;
  }
}

/* ============================================================================
   NEGATIVE CONTROLS — reintroduce the old (buggy) behaviour in a scratch
   copy of the fixed module, in a temp directory OUTSIDE the repo, and prove
   each assertion above actually goes red without the fix it is guarding.
   Never touches src/ in this repo. ============================================================================ */
function scratchCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenerate-vaults-nc-'));
  fs.cpSync(path.join(__dirname, '..', 'src'), dir, { recursive: true });
  return dir;
}
function revert(dir, relFile, find, replace) {
  const target = path.join(dir, relFile);
  const src = fs.readFileSync(target, 'utf8');
  if (!src.includes(find)) throw new Error(`negative control: pattern not found in ${relFile} — has the fix moved?`);
  fs.writeFileSync(target, src.replace(find, replace));
}

async function runNegativeControls() {
  const dir = scratchCopy();

  /* NC1 — reconcile.js's future-balance_updated guard (§ "Folded into
     no-date rather than given a state of its own"). Without it, a future
     confirmation date makes every real row look like it happened BEFORE the
     confirmation, `since` comes back empty, and the account reads 'clean'. */
  {
    const before = require(path.join(dir, 'reconcile.js')).reconcile;
    const a = { balance: 12000, balance_updated: '2099-01-01' };
    const rows = [
      { date: '2026-01-03', amount: -1200, excluded: false },
      { date: '2026-01-05', amount: -900, excluded: false },
    ];
    eq(before(a, rows, '2026-08-24').state, 'no-date',
      'NC1 sanity: the unmodified scratch copy still agrees with main before the revert');

    revert(dir, 'reconcile.js',
      "  if (a.balance_updated > now) return { state: 'no-date' };\n", '');
    delete require.cache[require.resolve(path.join(dir, 'reconcile.js'))];
    const reverted = require(path.join(dir, 'reconcile.js')).reconcile;
    const redState = reverted(a, rows, '2026-08-24').state;
    ok(redState !== 'no-date', `NC1 RED as expected: without the guard, reconcile() reports "${redState}" `
      + 'for a future-dated confirmation — reintroducing exactly the "a year typo makes an account read clean" bug');

    const mainState = require('../src/reconcile.js').reconcile(a, rows, '2026-08-24').state;
    eq(mainState, 'no-date', 'NC1 GREEN against main: the guard is present and reconcile() refuses the future date');
  }

  /* NC2 — health-math.js's debtInterestMonthly null-vs-zero guard. Without
     it, a blank Rate cell (which table-schema's money() reader turns into 0)
     reads as a MEASURED zero, and monthlyInterest(balance, 0) is 0 — full
     marks on "nothing lost to interest" for a book that never stated a rate. */
  {
    revert(dir, 'health-math.js',
      '  if (active.length && !stated.length) { return null; }\n', '');
    delete require.cache[require.resolve(path.join(dir, 'health-math.js'))];
    const debts = [{ status: 'active', balance: 250000, rate: 0 }];
    const redValue = require(path.join(dir, 'health-math.js')).debtInterestMonthly(debts);
    ok(redValue !== null, `NC2 RED as expected: without the guard, R250 000 with an unstated rate reports `
      + `${redValue} of monthly interest instead of "unmeasured"`);

    const mainValue = require('../src/health-math.js').debtInterestMonthly(debts);
    eq(mainValue, null, 'NC2 GREEN against main: an unstated rate stays unmeasured, never a measured zero');
  }

  /* NC3 — savings-math.js's monthOf realness guard. Without it, a malformed
     transaction date (2025-13-05, shape-valid, not a real calendar day) buckets
     under the unwalkable key '2025-13' instead of the undated-pending path, and
     growthSeries' own identity — closing = Σ(final point's capital+posted) +
     undated — breaks: the money is in `closing` (it is the account's real
     balance) but never reached by the calendar walk that builds the points. */
  {
    revert(dir, 'savings-math.js',
      "const monthOf = iso => (isRealIsoDate(iso) ? String(iso).slice(0, 7) : '');",
      "const monthOf = iso => (ISO_DATE.test(iso || '') ? String(iso).slice(0, 7) : '');");
    delete require.cache[require.resolve(path.join(dir, 'savings-math.js'))];
    const acct = { name: 'Fund', type: 'investment', balance: 10500, starting_amount: 10000, inception_date: '2025-01-01' };
    const rows = [
      { date: '2025-02-15', amount: 300, cat: '', split: '' },
      { date: '2025-13-05', amount: 200, cat: '', split: '' },
    ];
    const typeOf = () => null;

    const redOut = require(path.join(dir, 'savings-math.js')).growthSeries([{ account: acct, rows }], typeOf, { today: '2025-08-01' });
    const redLast = redOut.points[redOut.points.length - 1];
    const redTotal = (redLast ? redLast.capital + redLast.posted : 0) + redOut.undated;
    ok(Math.round(redTotal * 100) !== Math.round(redOut.closing * 100),
      `NC3 RED as expected: without the guard, the chart's own points sum to ${redTotal} against a closing `
      + `balance of ${redOut.closing} — the malformed-date row's 200 vanished from the walk`);

    const mainOut = require('../src/savings-math.js').growthSeries([{ account: acct, rows }], typeOf, { today: '2025-08-01' });
    const mainLast = mainOut.points[mainOut.points.length - 1];
    const mainTotal = (mainLast ? mainLast.capital + mainLast.posted : 0) + mainOut.undated;
    eq(Math.round(mainTotal * 100), Math.round(mainOut.closing * 100),
      'NC3 GREEN against main: the malformed-date row folds into the undated/pending path and the identity holds');
  }

  /* NC4 — acct-status.js's statusOf() consulting reconcile()'s OWN 'no-date'
     verdict, paired with reconcile.js's isStale() negative-day guard (the same
     guard NC1 above proves reconcile() itself needs). Before this pair,
     statusOf() asked `days === null` (a THIRD, independent test for date
     realness) and then, even where it fell through to isStale(), the shared
     function's own negative-day hole meant a future confirmation slipped past
     both checks: state came back 'ok', wantsALook 'false', and the account
     dropped out of the Accounts page's attention queue with real prior
     spending sitting unaccounted for. Reverting BOTH lines together in one
     fresh scratch copy, because reverting only one leaves the other still
     catching it and the red assertion never goes red. */
  {
    const dir4 = scratchCopy();
    const a = { balance: 12000, balance_updated: '2099-01-01' };
    const rows = [{ date: '2026-01-03', amount: -1200, excluded: false }];

    const before = require(path.join(dir4, 'acct-status.js'));
    eq(before.statusOf(a, rows, '2026-08-24', true).state, 'nodate',
      'NC4 sanity: the unmodified scratch copy still agrees with main before the revert');

    revert(dir4, 'reconcile.js',
      '  return d === null || d < 0 || d > STALE_DAYS;\n', '  return d === null || d > STALE_DAYS;\n');
    revert(dir4, 'acct-status.js',
      "  else if (rec.state === 'no-date') state = 'nodate';\n", '  else if (days === null) state = \'nodate\';\n');
    delete require.cache[require.resolve(path.join(dir4, 'reconcile.js'))];
    delete require.cache[require.resolve(path.join(dir4, 'acct-status.js'))];
    const reverted = require(path.join(dir4, 'acct-status.js'));
    const red = reverted.statusOf(a, rows, '2026-08-24', true);
    ok(red.state === 'ok' && reverted.wantsALook(red) === false,
      `NC4 RED as expected: without both fixes, statusOf() reports "${red.state}" `
      + `(wantsALook=${reverted.wantsALook(red)}) for a future-dated balance_updated with real prior `
      + 'spending — reintroducing the "a year typo silences the account completely" bug');

    const mainStatus = require('../src/acct-status.js');
    const mainState = mainStatus.statusOf(a, rows, '2026-08-24', true);
    ok(mainState.state === 'nodate' && mainStatus.wantsALook(mainState) === true,
      'NC4 GREEN against main: the pair holds, and a future-dated confirmation is refused and stays in the queue');
    fs.rmSync(dir4, { recursive: true, force: true });
  }

  /* NC5 — views/debts.js's second empty-state gate on activeDebts(), not row
     count. Reverted by disabling the branch's condition rather than deleting
     the block byte-for-byte: the block's own template literal nests a
     backtick-quoted string, and matching that exactly here would make this
     negative control go stale the moment the wording around it changes for
     any other reason. Disabling the gate reproduces the same fallthrough. */
  {
    const dir5 = scratchCopy();
    const f = files(['Budget/Settings.md', settings()],
      debtsFile([debtRow('Old card', 0, '20.00', '0.00', 'paid')]));

    const sane = await mount(f, undefined, path.join(dir5, 'views'));
    sane.ctx.renderDebts();
    ok(sane.nodes.get('#debtKpis').textContent.includes('Debt-free'),
      'NC5 sanity: the unmodified scratch copy still agrees with main before the revert');

    revert(dir5, 'views/debts.js', '    if (!activeDebts(S.debts).length) {', '    if (false) {');
    delete require.cache[require.resolve(path.join(dir5, 'views', 'debts.js'))];
    const red = await mount(f, undefined, path.join(dir5, 'views'));
    red.ctx.renderDebts();
    const redText = red.nodes.get('#debtKpis').textContent;
    ok(!redText.includes('Debt-free — every debt') && /Total debt/.test(redText),
      `NC5 RED as expected: without the second gate, a fully paid-off book falls through to the ordinary `
      + `tile path — got "${redText}"`);

    const clean = await mount(f);
    clean.ctx.renderDebts();
    const mainText = clean.nodes.get('#debtKpis').textContent;
    ok(mainText.includes('Debt-free — every debt') && !/Total debt/.test(mainText),
      'NC5 GREEN against main: the paid-off book gets its own empty state, not the four-hollow-zero-tile skeleton');
    fs.rmSync(dir5, { recursive: true, force: true });
  }

  /* NC6 — views/savings.js's typeIs() case/whitespace fold. Reverting the ONE
     function reproduces the bug everywhere it was scattered — the file's own
     header names this as the point of extracting it. Checked through the
     SAVINGS tile specifically (tileValue), not the card's whole text: the
     "Net worth" tile beside it states the same figure whether or not the fold
     works, because worth() sums by balance sign and never reads `type` at
     all — a whole-card substring match would pass even on the reverted code. */
  {
    const dir6 = scratchCopy();
    const f = files(['Budget/Settings.md', settings()],
      account('Pot', 'type: Savings\nbalance: 55000.00\nbalance_updated: 2026-01-01\n'));

    const sane = await mount(f, undefined, path.join(dir6, 'views'));
    sane.ctx.renderSavings();
    eq(tileValue(sane.nodes.get('#savingsKpis'), 'Savings'), 'R 55000.00',
      'NC6 sanity: the unmodified scratch copy still agrees with main before the revert');

    /* Phase 1 of ADR-0006 moved the fold into src/vocabulary.js; the scratch
       copy only holds views/, so the revert swaps the view's import for a raw
       local pair — the exact pre-fix shape, reproduced where it used to live. */
    revert(dir6, 'views/savings.js',
      "const { accountsOfType, accountType } = require('../vocabulary');",
      'const accountsOfType = (accounts, type) => (accounts || []).filter(a => a && a.type === type); const accountType = a => a && a.type;');
    delete require.cache[require.resolve(path.join(dir6, 'views', 'savings.js'))];
    const red = await mount(f, undefined, path.join(dir6, 'views'));
    red.ctx.renderSavings();
    const redVal = tileValue(red.nodes.get('#savingsKpis'), 'Savings');
    ok(redVal !== 'R 55000.00', `NC6 RED as expected: without the fold, the savings tile reads "${redVal}" `
      + 'for a type:"Savings" (capital) account that the net-worth tile right beside it already counts');

    const clean = await mount(f);
    clean.ctx.renderSavings();
    eq(tileValue(clean.nodes.get('#savingsKpis'), 'Savings'), 'R 55000.00',
      'NC6 GREEN against main: the fold holds, and the capitalised account reaches the savings tile itself');
    fs.rmSync(dir6, { recursive: true, force: true });
  }

  fs.rmSync(dir, { recursive: true, force: true });
  checks += 15;
}

/* ============================================================================
   §FIXED BUGS (formerly §LIVE BUG) — found while building this sweep and
   originally reported rather than fixed, per this file's brief at the time
   ("If you find a live bug, report it, do not fix it"). All three have SINCE
   been fixed elsewhere, and §NEGATIVE CONTROLS above (NC4/NC5/NC6) already
   proves each fix is load-bearing — reverted, red; restored, green. What
   follows just pins TODAY's (fixed) behaviour directly against main, the same
   way the deep dives above do, so a reader six months from now still learns
   what each bug was without having to reconstruct it from a scratch-copy
   revert. ============================================================================ */
async function confirmFixedBugsHold() {
  /* Formerly LIVE BUG 1 — src/acct-status.js's statusOf() now consults
     reconcile()'s own 'no-date' verdict for a future-dated balance_updated,
     instead of re-deriving `days` via reconcile.js's daysSince() and testing
     it a THIRD, independent way. A future confirmation date now resolves to
     'nodate' and stays in the Accounts page's attention queue, rather than
     resolving to 'ok' and silencing the account entirely with real prior
     spending unaccounted for. See NC4 above for the reverted-and-proved
     negative control. */
  {
    const { statusOf, wantsALook } = require('../src/acct-status.js');
    const a = { balance: 12000, balance_updated: '2099-01-01' };
    const rows = [{ date: '2026-01-03', amount: -1200, excluded: false }];
    const s = statusOf(a, rows, '2026-08-24', true);
    ok(s.state === 'nodate' && wantsALook(s) === true,
      `pins the fix for the former LIVE BUG 1: statusOf() reports "${s.state}" `
      + `(wantsALook=${wantsALook(s)}) for a future-dated balance_updated with real prior spending — `
      + 'fixed in src/acct-status.js, statusOf, and src/reconcile.js, isStale');
  }

  /* Formerly LIVE BUG 2 — views/savings.js's own tile filters now go through
     one case/whitespace-folded typeIs(), matching how worth.js sums every
     account's balance toward net worth by SIGN alone regardless of type.
     `type: Savings` (capital S) — the exact shape worth.js's own
     accountGroups() names as "the same bug wearing a hat" for the composition
     CHART — now reaches the savings TILE beside it too, through the REAL view
     (not a hand-mirrored filter), so this proves the actual render rather than
     a simulation of what it should do. See NC6 above for the reverted-and-
     proved negative control. */
  {
    const f = files(['Budget/Settings.md', settings()],
      account('Pot', 'type: Savings\nbalance: 55000.00\nbalance_updated: 2026-01-01\n'));
    const { ctx, nodes } = await mount(f);
    ctx.renderSavings();
    const savingsTile = tileValue(nodes.get('#savingsKpis'), 'Savings');
    ok(savingsTile === 'R 55000.00',
      `pins the fix for the former LIVE BUG 2: type:"Savings" (capital) reads "${savingsTile}" `
      + 'on the savings tile itself, matching the net-worth tile beside it — fixed in '
      + 'src/vocabulary.js, accountsOfType');
  }

  /* Formerly LIVE BUG 3 — renderDebtKpis (src/views/debts.js) only took its
     "No debt tracked" branch when `!S.debts.length` — zero ROWS. A book where
     every debt is marked paid still has S.debts.length === 1, so it used to
     fall through to the ordinary tile path and render "Total debt R0.00 · 0
     active · 1 tracked", "Paying per month R0.00 · nothing budgeted",
     "Interest this month R0.00" and "Debt-free — no debt tracked" — the exact
     four-hollow-zero-tiles shape the comment above that first branch names as
     the thing it was written to replace, aimed at the reader who most deserves
     a congratulation rather than four zeros. The original fix reached "no
     debts recorded" but not its sibling "every debt paid off"; a SECOND branch
     now gates on activeDebts(S.debts).length (zero debts still COSTING
     anything) rather than row count, with its own "Debt-free — every debt you
     tracked has been paid off" wording. See NC5 above for the reverted-and-
     proved negative control. */
  {
    const f = files(['Budget/Settings.md', settings()],
      debtsFile([debtRow('Old card', 0, '20.00', '0.00', 'paid')]));
    const { ctx, nodes } = await mount(f);
    ctx.renderDebts();
    const text = nodes.get('#debtKpis').textContent;
    ok(text.includes('Debt-free — every debt') && !/Total debt/.test(text),
      `pins the fix for the former LIVE BUG 3: a fully paid-off debt book gets its own "Debt-free" `
      + `empty state, not the four-hollow-zero-tile skeleton — got "${text}"`);
  }
  checks += 3;
}

(async () => {
  await runMatrix();
  await runDeepDives();
  await runNegativeControls();
  await confirmFixedBugsHold();
  console.log(`PASS — degenerate-vault sweep: ${SHAPES.length} shapes × ${DISPATCH.length} views, `
    + `2 deep dives, 6 negative controls, 3 formerly-live bugs pinned as fixed (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
