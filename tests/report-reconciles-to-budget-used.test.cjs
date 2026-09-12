'use strict';
/* The Report export states the figures the app states — ADR-0005's, not a
   third pairing of its own.

   On 1.40.1 the generated report's "Income & Spend" table printed a THIRD
   reading of the same period. `Spend` was periodSummary().spend, gross: the
   set-aside contribution counted as money the household consumed. `Budgeted
   spend` was budgetTotals().spend PLUS budgetTotals().setAside, the whole
   plan: envelopes the household never meant to spend counted as budget to
   spend. Neither figure was wrong in isolation — the row labels say exactly
   what they hold — but the pair could not be reconciled to the Dashboard hero
   or the Budget page's totals strip without knowing the set-aside, which the
   document never named, and no "% used" was printed at all.

   That is this repo's most-repeated defect ("two figures derived by different
   rules") in the one document that LEAVES the app, where there is no second
   screen to check against — and it breaks the house rule the Net Worth and
   Savings sections already keep: an exported document carries the caveats its
   on-screen twin prints beside the number.

   The contract pinned here:

     · the report still prints gross Spend and the whole plan — nothing the
       document already carried is traded away;
     · it ALSO prints ADR-0005's numerator against the spend envelopes, the
       Dashboard hero's own sentence (dash.hero.sub) with the hero's own
       figures, so a reader can reconcile the two documents to the cent;
     · the "% used" is sharePercentLabel() of budgetUsed(p).used — the same
       label the hero's tag and the Budget page's tile print;
     · every amount held out of, or added into, that numerator is NAMED: the
       assume-spent provision (bud.total.spentNoteAssumed) and the set-aside
       (dash.stat.setAsideMoved), the same two sentences the Budget page's
       totals strip already prints;
     · the JSON sibling carries the identical figures as data, so the two
       documents one click produces cannot disagree with each other.

   Driven over the COMMITTED figures household (tests/figures/household.cjs)
   through the REAL loader and the REAL registerReport() — the one fixture in
   this repo that holds a set-aside envelope, an assume-spent category, an
   earmarked-fund outflow and a foreign account at once, which is exactly the
   household on which the three pairings disagree. Every expected figure is
   read back off ctx rather than typed in, so this suite pins that the report
   READS THE VIEW'S FIGURE and never that a particular number is 12 100.

     node tests/report-reconciles-to-budget-used.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const { sharePercentLabel } = require('../src/share-percents');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${m} (got ${a}, want ${b})`);

const money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;

/* Same registration set/order as tests/report-round-trip.test.cjs's mountAll —
   'report' right after 'dashboard', load-bearing because it reads the
   ctx.provide()'d budgetVsActualRows/categorySpendRows at register time. */
async function mountAll(files, period) {
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = period;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = money;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, S, nodes };
}

/* The clock is pinned to the household's own TODAY, for the reason
   report-round-trip.test.cjs's header gives at length: createReport()'s
   'current' branch reads currentPeriod() (the wall clock), never S.period, so
   on any day this suite ran outside the fixture's own month it would be
   asserting over an EMPTY document and could not fail on a wrong figure. */
const RealDate = Date;
const PINNED = new RealDate(`${TODAY}T12:00:00`).getTime();
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(PINNED); }
  static now() { return PINNED; }
}

(async () => {
  global.Date = PinnedDate;
  let md = '';
  let json = null;
  let expected = null;
  try {
    const { ctx, nodes } = await mountAll({ ...SEED }, PERIOD);

    /* Both formats from ONE click, so the two documents under test are the two
       documents a reader actually gets — built from one `data` object, which is
       the whole discipline src/report.js's header defends. */
    ctx.renderReport();
    const formatRow = nodes.get('#reportFormatPills').children[0];
    ok(formatRow && formatRow.children.length === 2, 'the format pills rendered (Markdown, JSON)');
    formatRow.children[1].click();

    /* Every expected figure read off ctx — the SAME calls the Dashboard hero
       and the Budget page's totals strip make. If the report ever re-derives
       one of these its own way, these are the assertions that go red. */
    const sum = ctx.periodSummary(PERIOD);
    const bt = ctx.budgetTotals(PERIOD);
    const bu = ctx.budgetUsed(PERIOD);
    expected = { sum, bt, bu, moved: ctx.movedToFunds(PERIOD) };

    /* Fixture check, and the negative control for the whole suite: on this
       household the ADR-0005 pair and the pair the report already printed are
       DIFFERENT numbers, so a report that simply reprinted the gross pair
       cannot pass the assertions below by coincidence. */
    ok(Math.abs(bu.spent - sum.spend) > 1, `fixture: the ADR-0005 numerator (${bu.spent}) differs from gross spend (${sum.spend})`);
    ok(Math.abs(bu.budgeted - (bt.spend + bt.setAside)) > 1,
      `fixture: the spend envelopes (${bu.budgeted}) differ from the whole plan (${bt.spend + bt.setAside})`);
    ok(bu.setAside > 0, 'fixture: something was actually set aside this period');
    ok(bu.assumed > 0, 'fixture: an assume-spent provision is actually in the numerator');

    let threw = null;
    try { await ctx.createReport(); } catch (e) { threw = e; }
    eq(threw, null, 'createReport() does not throw');

    const store = ctx.app.vault._store;
    const mdPath = [...store.keys()].find(k => /Reports\/.*Financial Report\.md$/.test(k));
    const jsonPath = [...store.keys()].find(k => /Reports\/.*Financial Report\.json$/.test(k));
    ok(mdPath, 'a Markdown report landed on disk');
    ok(jsonPath, 'a JSON report landed on disk');
    md = store.get(mdPath);
    json = JSON.parse(store.get(jsonPath));
  } finally {
    global.Date = RealDate;
  }

  const { sum, bt, bu, moved } = expected;

  /* ---- 1. nothing the document already carried is traded away ----------- */
  {
    ok(md.includes(`| ${i18n.t('report.col.spend')} | ${money(sum.spend)} |`),
      'the gross Spend row still states periodSummary().spend');
    ok(md.includes(`| ${i18n.t('report.col.budgetSpend')} | ${money(bt.spend + bt.setAside)} |`),
      'the Budgeted spend row still states the WHOLE plan — the reconciliation is added, not traded for it');
    ok(md.includes(`| ${i18n.t('report.col.income')} | ${money(sum.income)} |`), 'Income still reads periodSummary().income');
    ok(md.includes(`| ${i18n.t('report.col.net')} | ${money(sum.net)} |`), 'Net still reads periodSummary().net');
    ok(md.includes(`| ${i18n.t('report.col.budgetIncome')} | ${money(bt.income)} |`), 'Budgeted income still reads budgetTotals().income');
  }

  /* ---- 2. the hero's own pair, in the hero's own sentence --------------- */
  {
    const line = i18n.t('dash.hero.sub', { spent: money(bu.spent), budgeted: money(bu.budgeted) });
    ok(md.includes(line),
      `the report states ADR-0005's numerator against the spend envelopes, in the Dashboard hero's own words — expected "${line}"`);
  }

  /* ---- 3. the percentage, and the two amounts that move the numerator --- */
  {
    const pct = sharePercentLabel(bu.used, '.');
    ok(md.includes(i18n.t('bud.total.spentNoteAssumed', { pct, amount: money(bu.assumed) })),
      `"% used" is the label the hero and the Budget tile print (${pct}%), and the assume-spent provision added into it is named`);
    ok(md.includes(i18n.t('dash.stat.setAsideMoved', { amount: money(bu.setAside, 0), moved: money(moved, 0) })),
      'the set-aside held OUT of that numerator is named, in the Budget page\'s own sentence');
  }

  /* ---- 4. the reconciliation actually closes ---------------------------- */
  {
    near(bu.spent, Math.max(0, sum.spend - bu.setAside) + bu.assumed,
      'gross spend, less the named set-aside, plus the named provision, IS the numerator the report prints — a reader can do this arithmetic from the document alone');
    near(bu.budgeted + bt.setAside, bt.spend + bt.setAside,
      'and the spend envelopes plus the set-aside envelopes are the whole plan the row above states');
  }

  /* ---- 5. the JSON sibling says the same thing ------------------------- */
  {
    const iv = json.income_vs_spend;
    ok(iv && iv.budget_used, 'income_vs_spend carries a budget_used fact');
    near(iv.budget_used.spent, bu.spent, 'JSON budget_used.spent is the Markdown numerator');
    near(iv.budget_used.budgeted, bu.budgeted, 'JSON budget_used.budgeted is the spend envelopes');
    near(iv.budget_used.used_pct, bu.used * 100, 'JSON budget_used.used_pct is the same share, unrounded');
    near(iv.budget_used.set_aside, bu.setAside, 'JSON names the set-aside held out');
    near(iv.budget_used.set_aside_moved, moved, 'JSON names what actually moved into the funds');
    near(iv.budget_used.assumed, bu.assumed, 'JSON names the assume-spent provision');
    near(iv.spend, sum.spend, 'and JSON still carries gross spend');
    near(iv.budget_spend, bt.spend + bt.setAside, 'and the whole plan');
  }

  /* ---- 6. the report reaches the one rule, it does not re-spell it ------ */
  {
    const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    /* ISSUE 84 · Or through the period snapshot: periodFigures(p).used IS
       budgetUsed(p). The third literal-text pin widened rather than deleted —
       see tests/budget-used-one-rule.test.cjs for why they are widened and not
       removed. What must stay impossible is the report spelling the rule for
       itself, which the `F.used` reading does not do. */
    const rep = src('views/report.js');
    ok(rep.includes('budgetUsed(') || (rep.includes('periodFigures(') && rep.includes('F.used')),
      'views/report.js reads ctx.budgetUsed — the one period-level reading (ADR-0005)');
    ok(/budgetUsedShare|budgetSpent/.test(src('report.js')),
      'src/report.js derives the share and the numerator through money-flow.js, never with its own division');
    ok(!/spent\s*\/\s*budget/.test(src('report.js')),
      'src/report.js carries no private "spent / budgeted" of its own');
  }

  console.log(`report-reconciles-to-budget-used — ${checks} checks OK`);
})().catch(e => { global.Date = RealDate; console.error(e); process.exit(1); });
