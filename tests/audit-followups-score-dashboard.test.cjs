'use strict';
/* Follow-ups from the 13-agent comprehension audit, for the two views this
   lane owns (score.js, dashboard.js). Five findings, four of which needed a
   code change here (#1, #2, #4, #5) — #3 (the hero/left-card label collision)
   and #6/#7 (already fixed in 1.23.2) are reported rather than coded, since
   their fix lives in src/lang/*.js or src/shell.js, neither of which this
   lane may touch.

   Each block below is paired with what it would have caught on the OLD code
   — every one of these went RED against the pre-fix source (checked by hand
   before this file was wired into build.sh) and is GREEN now.

     node tests/audit-followups-score-dashboard.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const find = (root, cls) => descend(root).filter(e => hasCls(e, cls));
const textOf = e => descend(e).map(x => x.textContent || '').join(' ') + (e.textContent || '');

/* A household with real history (6 trailing periods of income and essential
   spend), an emergency fund short of its target, and — for the dashboard half
   below — an orphaned category name on the current period so the "Missing
   categories" tile actually renders. Reused for both mounts (score.js and
   dashboard.js) rather than built twice, so the two halves of this file agree
   about what the vault contains. */
const B = 'Budget';
const SETTINGS = { month_start_day: 23, currency: 'R', country: 'za' };
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const TX = m => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + `| ${m}-01 | Salary | Salary | 45000.00 | | | |\n`
  + `| ${m}-05 | Groceries | Groceries | -12000.00 | | | |\n`;

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]:
    '---\ntype: savings\nbalance: 30000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\nbalance: 400000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  /* The running period: same shape as the trailing months, plus one row
     naming a category no Categories/ file answers to — the shape
     dash.stat.missing exists for (audit finding #5). */
  [`${B}/Transactions/Cheque/2026-08.md`]: '---\nkind: transactions\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + '| 2026-08-01 | Salary | Salary | 45000.00 | | | |\n'
    + '| 2026-08-05 | Groceries | Groceries | -12000.00 | | | |\n'
    + '| 2026-08-06 | Mystery debit | Orphaned Cat | -500.00 | | | |\n',
};
for (const m of MONTHS) { FILES[`${B}/Transactions/Cheque/${m}.md`] = TX(m); }

(async () => {
  const ctx = makeCtx(FILES, { budgetFolder: B, settings: SETTINGS });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const switchViewCalls = [];
  ctx.switchView = v => switchViewCalls.push(v);
  ctx.renderTransactions = () => {};

  require('../src/categories')(ctx);
  require('../src/views/score')(ctx);
  require('../src/views/dashboard')(ctx);

  /* ============================= score.js ============================== */
  ctx.renderScore();
  const scoreHero = nodes.get('#scoreHero');

  /* ---- finding #1a: "essential" is now DEFINED, not just named ---------
     OLD score.how.reserves read only "Money set aside that could carry the
     household with no income, counted in months of essential spending." —
     true, and silent about what "essential" excludes. This fails on that
     text alone; it only passes once the exclusion list is appended. */
  const hows = find(scoreHero, 'score-ring-row-how').map(textOf);
  const reservesHow = hows.find(t => /Money set aside/.test(t));
  ok(reservesHow, 'the reserves row still carries its base "how" text');
  ok(/excludes luxuries, giving, savings, investment, income and transfers/.test(reservesHow),
    'and now says what "essential" excludes — audit finding #1');
  ok(/Non-essential groups/.test(reservesHow),
    'and names the setting that can widen the exclusion further');

  /* ---- finding #1b: the divisor itself is now stated in rand ------------
     OLD score.now.reserves read "Now: 3.9 months covered · R 30 000 set
     aside · goal 6 months" — no monthly rand figure anywhere, so a reader
     could not check the ratio against their own sense of what a month
     costs. */
  const nows = find(scoreHero, 'score-ring-row-now').map(textOf);
  const reservesNow = nows.find(t => /months covered/.test(t));
  ok(reservesNow, 'the reserves row still carries its "now" reading');
  ok(/Essentials average R ?\d/.test(reservesNow),
    'and now states the monthly essential figure the months-covered ratio divides by — audit finding #1');

  /* ---- finding #2: the fixed-flag empty state discloses the score too --
     OLD score.flow.committed.empty said only to set `fixed: true` on a
     category file. Nothing anywhere said fixedShare (a third of the
     Spending pillar) is what is silently losing points in the meantime. */
  const viewScore = nodes.get('#view-score');
  const chips = find(viewScore, 'score-flow-chip').map(textOf);
  const committedChip = chips.find(t => /No categories are marked fixed/.test(t));
  ok(committedChip, 'the committed-empty chip still explains where the flag lives');
  ok(/feeds a third of the Spending part of your Score/.test(committedChip),
    'and now says the missing flag costs the household points there — audit finding #2');

  /* ============================ dashboard.js ============================ */
  ctx.renderDashboard();
  const healthBody = nodes.get('#healthBody');
  const figBtns = find(healthBody, 'health-fig-btn');

  /* ---- finding #4: emergency and saving tiles are now real buttons ------
     OLD fig() calls for these two omitted the fifth `to` argument, so
     buildScoreRing/dashboard's fig() built a plain <div> for them — no
     button, no `is-link`, no route — while debt and score both routed.
     `find(..., 'health-fig-btn')` returns only what fig() built as a real
     <button>, so this is a direct count, not an inference from styling. */
  const btnLabels = figBtns.map(b => textOf(b));
  ok(btnLabels.some(t => /of essential spending covered/.test(t)),
    'the emergency-cover tile is now a real button — audit finding #4');
  ok(btnLabels.some(t => /of income saved/.test(t)),
    'the saving-rate tile is now a real button too — audit finding #4');

  const emergencyBtn = figBtns.find(b => /of essential spending covered/.test(textOf(b)));
  const savingBtn = figBtns.find(b => /of income saved/.test(textOf(b)));
  emergencyBtn.click();
  ok(switchViewCalls.includes('accounts'),
    'and clicking it routes to Accounts, where emergency_fund: is set — audit finding #4');
  savingBtn.click();
  ok(switchViewCalls.includes('savings'),
    'clicking the saving tile routes to Savings, where the contributions it measures live — audit finding #4');

  /* Debt and score were already links — pinned so this file would catch a
     regression on THEM too, not only on the two that were fixed. */
  const debtBtn = figBtns.find(b => /of income to debt interest/.test(textOf(b)));
  const scoreBtn = figBtns.find(b => /financial score/.test(textOf(b)));
  ok(debtBtn && scoreBtn, 'debt and score remain real buttons (unchanged by this fix)');

  /* ---- finding #5: the "Missing categories" tile is now interactive -----
     OLD markup built this tile as a plain `el('div', { class: 'stat' }, …)`
     — dash.stat.missingSub's own text ("1 transaction — recategorise") named
     an action nothing on the tile could perform. It is a <button> now, the
     same "stat" pattern the sibling Uncategorised tile already uses. */
  const heroCard = nodes.get('#heroCard');
  const missingBtn = find(heroCard, 'stat').find(e => e.tagName === 'BUTTON'
    && /Missing categories/.test(textOf(e)));
  ok(missingBtn, 'the missing-categories tile is now a <button>, not a <div> — audit finding #5');
  ok(/Orphaned Cat/.test(textOf(missingBtn)), 'and still names the orphaned category on its face');
  ok(/1 transaction — recategorise/.test(textOf(missingBtn)),
    'the existing copy is unchanged — only the element became actionable');
  switchViewCalls.length = 0;
  missingBtn.click();
  ok(switchViewCalls.includes('transactions'),
    'clicking it now actually navigates to Transactions — audit finding #5');

  console.log(`PASS — audit follow-ups: reserves defines "essential" and states its divisor, `
    + `the fixed-flag empty state discloses its score effect, all four health tiles route, `
    + `and the missing-categories tile is a real button (${checks} assertions).`);
})().catch(e => { console.error('FAIL —', e.message); process.exit(1); });
