'use strict';
/* ISSUE 37 — "debt interest 0%" on a household paying R148 a month of it.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs): an FNB card at 22.25% APR on R8 000, against a
   R35 000 salary month.

     debtInterestMonthly(...)              -> 148.33      (correct)
     interestShare                         -> 0.004238    (correct)
     `${Math.round(share * 100)}%`         -> "0%"        (the tile)

   Both halves of the maths are right and the label is a lie. The tile printed
   "0%" as its figure with its own meta line directly underneath reading
   "R 148 a month" — one tile, two opposite claims, and "0%" is the one that
   reads as a verdict. It is also precisely the claim health-math.js's
   null-vs-zero rule exists to prevent ("a debt whose rate nobody has typed is
   not a debt at 0%; it is a debt whose cost is unknown"), defeated at the last
   step by the formatter rather than by the maths — the rule survived every
   division and died in a template string.

   Three renderers had their own copy of that template string — the Dashboard
   health tile, the Score page's "now" line, and the Markdown report's health
   table — which is this repository's most-repeated bug shape ("two figures
   derived by different rules", 8+ occurrences) wearing a formatter. The fix is
   the one this repo already reached for at the OTHER boundary:
   share-percents.js's sharePercentLabel, which existed because 100.24% must
   not print "100%". 0.42% must not print "0%" for the identical reason, so the
   guard is now the boundary set rather than the literal 100.

   WHAT IS PINNED

     1. The pure rule, at both boundaries and in both directions, including
        that an ORDINARY share still prints exactly the whole percent every
        caller printed before this change — the regression that would make
        this fix cost more than it buys.
     2. A true zero still prints "0". "Small" and "none" are different claims;
        making one readable must not make the other unsayable.
     3. The Dashboard tile, driven through the REAL views/dashboard.js over the
        shared harness: the figure and the meta line under it cannot make
        opposite claims about the same debt.
     4. The Markdown report's health table, driven through the REAL
        src/report.js — the copy that leaves the app, where a rounded-away
        debt cost is what an advisor or a chat model reasons from with nothing
        on the page to contradict it.

     node tests/interest-share-rounding.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');
const { sharePercentLabel } = require('../src/share-percents');
const { debtInterestMonthly } = require('../src/health-math');
const { financialReportMarkdown, prepareReportData } = require('../src/report');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* ------------------------- 1. the pure rule ------------------------------ */
/* Ordinary shares are untouched: this fix buys honesty at two boundaries and
   must not cost a decimal point anywhere else. */
eq(sharePercentLabel(0.5, ','), '50', 'an ordinary share is still a plain whole percent');
eq(sharePercentLabel(0.053, ','), '5', 'small-but-roundable shares round as they always did');
eq(sharePercentLabel(0.316, ','), '32', 'a consumption share is still whole');

/* The 100 boundary, unchanged — the behaviour this helper was written for. */
eq(sharePercentLabel(1, ','), '100', 'exactly 100% still prints 100');
eq(sharePercentLabel(1.0024, ','), '100,2', 'over 100 does not round back onto the line');
eq(sharePercentLabel(0.997, ','), '99,7', 'and neither does under it');

/* The 0 boundary — ISSUE 37 itself. */
eq(sharePercentLabel(0, ','), '0', 'a true zero still prints 0 — none is a claim, and a real one');
eq(sharePercentLabel(0.0042380952, ','), '0,4', "the audit household's 0.42% is readable, not rounded away");
eq(sharePercentLabel(0.0004, ','), '0,04', 'and a smaller one takes the second decimal it needs');
eq(sharePercentLabel(-0.004, ','), '-0,4', 'symmetric below zero: a negative share keeps its sign and its digit');
/* Past two decimals a share IS zero at any precision this app renders — the
   same tolerance the 100 side has always used, from the same line. */
eq(sharePercentLabel(0.00001, ','), '0', 'and a share under half a hundredth of a percent is honestly 0');
/* The locale's own separator, so a percentage and a money figure on the same
   card cannot disagree about what a decimal looks like. */
eq(sharePercentLabel(0.0042380952, '.'), '0.4', "the separator is the caller's, not a hard-coded comma");

/* ---------------- 2. the tile, through the real dashboard ---------------- */
const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub',
  'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

/* Every rendered assertion below runs on 2026-09-02, the day of the audit —
   see atAuditDate's own note for why the real clock would make this file
   stop testing anything in October. */
atAuditDate(async () => {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;

  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();

  const snap = ctx.healthSnapshot();
  const monthly = debtInterestMonthly(S.debts, S.settings.currency);
  ok(monthly > 100 && monthly < 200,
    `the fixture really does carry a monthly interest bill (got ${monthly})`);
  ok(snap.metrics.interestShare > 0 && snap.metrics.interestShare < 0.005,
    `and a share small enough that a whole percent would erase it (got ${snap.metrics.interestShare})`);

  const body = nodes.get('healthBody').textContent;
  const debtLabel = i18n.t('dash.health.debt');
  const perMonth = i18n.t('dash.health.perMonth', { amount: ctx.money(monthly, 0) });
  /* The debt tile alone, sliced out by its own label and meta line, NOT the
     whole card. The savings tile on this same fixture legitimately reads "0%"
     over "R 0 / month" — the household really did save nothing in August — and
     a card-wide "no 0% anywhere" assertion would have called that a defect and
     pushed the fix into erasing the one zero that IS true. */
  ok(body.includes(`0,4%${debtLabel}`),
    `the debt tile shows the share it actually measured, not a rounded-away 0% — got: ${body}`);
  ok(!body.includes(`0%${debtLabel}`),
    `and never "0%" for a household paying real interest — got: ${body}`);
  /* The figure and the sentence under it are ONE claim. Asserted through
     i18n.t rather than an English literal: the keys are translated in a
     separate lane, and a hard-coded sentence would go red on the translation
     rather than on the defect. */
  ok(body.includes(`${debtLabel}${perMonth}`),
    `and the meta line under it still names the rand figure that share is of — got: ${body}`);
  /* The true zero the card-wide assertion would have destroyed, pinned so a
     future "never print 0%" edit goes red here instead of shipping. */
  ok(body.includes(`0%${i18n.t('dash.health.savings')}`),
    `a genuinely zero savings rate still prints 0% — none is a claim, and a real one — got: ${body}`);

  /* ------------- 3. the report, through the real serialiser -------------- */
  /* The smallest report src/report.js will serialise, carrying THIS
     household's own measured share rather than a copied literal — so the
     figure the exported document prints is provably the one the screen
     measured, not a second number that happens to round the same way. */
  const data = prepareReportData({
    generated: '2026-09-02 09:00',
    periodLabel: 'September 2026',
    rangeNote: '1 – 30 Sep 2026',
    detail: 'summary',
    currency: 'R',
    income: 40000, spend: 11590, net: 28410,
    budgetIncome: 35000, budgetSpend: 14500,
    categories: [], spendByCategory: [], categoryGap: { uncat: 0, netted: 0 },
    savings: null, debts: null, transactions: null,
    netWorth: { net: 120000, assets: 128000, liabilities: 8000 },
    health: {
      score: 48, months: 1.8, target: 6,
      savingsRatePct: 0,
      interestSharePct: snap.metrics.interestShare * 100,
    },
  });
  const md = financialReportMarkdown(data, (v, dp = 2) => `R ${Number(v).toFixed(dp)}`);
  const row = md.split('\n').find(l => l.includes(i18n.t('report.health.interestShare')));
  ok(row, 'the report prints an interest-share row at all');
  ok(row.includes('0.4%'),
    `the exported report carries the same readable share as the screen — got: ${row}`);
  ok(!/\|\s*0%\s*\|/.test(row),
    `and never the rounded-away "0%" a reader would take as debt-free — got: ${row}`);

  console.log(`PASS interest-share-rounding (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
