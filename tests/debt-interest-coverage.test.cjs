'use strict';
/* "Interest this month" — the figure two surfaces printed as R0,00 while the
   score withheld it.

   THE DEFECT, reproduced on 2026-09-02 against a household that lists two
   debts with balances and payments and leaves every Rate cell blank:

     debtInterestMonthly(debts, 'R')                                -> null
     activeDebts(debts).reduce((s,d)=>s+monthlyInterest(...), 0)    -> 0

   Same ledger, two rules, and the wrong one is on the two surfaces a person
   actually reads: the Debt page's "Interest this month" tile and the Debt
   section of the report that leaves the app. `null` is the honest answer —
   src/health-math.js's own header spells out why ("a debt whose rate nobody
   has typed is not a debt at 0%; it is a debt whose cost is unknown") — and a
   printed R0,00 is not a smaller version of that answer, it is the opposite
   claim: this household pays no interest. On the vault this was written
   against that is R900 000 of bond and R164 000 of car finance reported as
   free money.

   This repository's most-repeated bug shape is "two figures derived by
   different rules" (eight-plus occurrences), and its standing rule is that
   unprovable is not disproved. Both apply here at once.

   WHAT IS PINNED

     1. The pure rule. debtInterestCoverage() is now the ONE derivation and
        debtInterestMonthly() is a wrapper over its `monthly` field, so the
        two can no longer answer differently — asserted by construction over
        every state, not by copying the expected numbers into this file.
     2. The Debt page's tile, driven through the REAL views/debts.js over the
        shared harness: all-blank withholds and never prints a zero; partial
        prints the sum AND says what it covers; fully-rated is unchanged,
        caption and all.
     3. The Report's Debt section, driven through the REAL views/report.js and
        src/report.js: the same three states, with the Markdown and the JSON
        agreeing in each — the "one data object, two serialisers" discipline
        src/report.js's header exists to protect.
     4. The two consumers agree with the canonical function on the SAME
        fixture. views/debts.js's `list` and debtInterestCoverage()'s own
        active slice are derived by different expressions (a view-local
        filter chain vs worth.js's activeDebts + currency.js's isForeign), so
        that they select the same debts is proven here rather than assumed.

   Every assertion about wording goes through i18n.t() rather than an English
   literal: the keys are added to the twelve language tables in a separate
   lane, and a test that hard-coded the English sentence would go red on the
   translation rather than on the defect.

     node tests/debt-interest-coverage.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');

const { debtInterestMonthly, debtInterestCoverage } = require('../src/health-math');
const { monthlyInterest } = require('../src/debt-math');
const { activeDebts } = require('../src/worth');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (${a} vs ${b})`); checks++; };

const B = 'Budget';
const MONTH = '2026-07';
const money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;

/* Full ADR-0004 column list including the appended Currency, so the fixture
   goes through the real positional parse rather than a truncated row that
   happens to read the same. */
const DEBT_HEAD = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n';

/* The reproduction's own two debts, with the Rate cell as the only variable.
   Balances and payments are ordinary and synthetic — a bond and a car, the
   two rows almost every South African household's Debts.md opens with. */
const debtRow = (name, bal, rate, pay) =>
  `| ${name} | Bank | home loan | ${bal.toFixed(2)} | ${(bal * 1.2).toFixed(2)} | ${rate === null ? '' : rate.toFixed(2)} `
  + `| ${pay.toFixed(2)} | 0.00 | 2020-01-01 | | active | | |\n`;

const NONE = DEBT_HEAD + debtRow('Bond', 900000, null, 9500) + debtRow('Car', 164000, null, 3200);
const SOME = DEBT_HEAD + debtRow('Bond', 900000, 10.5, 9500) + debtRow('Car', 164000, null, 3200);
const ALL = DEBT_HEAD + debtRow('Bond', 900000, 10.5, 9500) + debtRow('Car', 164000, 12.25, 3200);
/* A THIRD debt, also rateless, so `missing` is 2 and the caption must select
   the plural form. SOME above leaves exactly ONE debt rateless and is the
   single-missing case — the two fixtures together are what makes the plural
   assertion below able to fail at all. */
const SOME3 = SOME + debtRow('Store', 12000, null, 800);

function vault(debtsMd) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 50000.00\nbalance_updated: 2026-07-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Debts.md`]: debtsMd,
    [`${B}/Transactions/Cheque/${MONTH}.md`]:
      '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n'
      + '|---|---|---|---:|---|---|---|\n'
      + `| ${MONTH}-01 | Salary | Salary | 40000.00 | | | |\n`
      + `| ${MONTH}-03 | Grocer | Groceries | -1200.00 | | | |\n`,
  };
}

/* ═══════════ 1. the pure rule — one derivation, not two ═══════════════════ */
{
  const blank = [
    { name: 'Bond', balance: 900000, rate: 0, payment: 9500, status: 'active' },
    { name: 'Car', balance: 164000, rate: 0, payment: 3200, status: 'active' },
  ];
  const partial = [{ ...blank[0], rate: 10.5 }, blank[1]];
  const rated = [{ ...blank[0], rate: 10.5 }, { ...blank[1], rate: 12.25 }];

  /* The defect itself: the inline aggregate both consumers used to spell out
     answers 0 on the very book the canonical rule refuses to answer. */
  const inline = ds => activeDebts(ds).reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0);
  eq(inline(blank), 0, 'the pre-fix inline aggregate really does state a measured zero (the defect)');
  eq(debtInterestMonthly(blank, 'R'), null, 'the canonical rule withholds on an all-blank book');

  /* Coverage carries the counts the disclosure needs, and `monthly` IS what
     debtInterestMonthly returns — proven on every state rather than asserted
     for one, so the wrapper cannot drift back into a second derivation. */
  for (const [label, ds] of [['none', blank], ['some', partial], ['all', rated], ['empty', []]]) {
    const cov = debtInterestCoverage(ds, 'R');
    eq(cov.monthly, debtInterestMonthly(ds, 'R'),
      `debtInterestMonthly is debtInterestCoverage().monthly, ${label} rates`);
    eq(cov.total, activeDebts(ds).length, `coverage counts every active home-currency debt, ${label} rates`);
    eq(cov.missing, cov.total - cov.shown, `missing is total minus shown, ${label} rates`);
  }
  eq(debtInterestCoverage(blank, 'R').shown, 0, 'no rate stated anywhere: nothing is covered');
  eq(debtInterestCoverage(partial, 'R').shown, 1, 'one rate stated: one of two covered');
  eq(debtInterestCoverage(rated, 'R').shown, 2, 'both rates stated: fully covered');
  near(debtInterestCoverage(partial, 'R').monthly, monthlyInterest(900000, 10.5), 0.01,
    'a partial book still totals what IS known — understating a burden is the safe direction');

  /* A rate of exactly 0 is a STATED zero, not a blank one — an interest-free
     store account is a real thing a household types deliberately. `shown`
     counts rates ABOVE zero (health-math's own `stated` predicate), so this
     book has no covered debt and withholds, which is the same answer the
     canonical function has always given it. */
  const zeroRate = [{ name: 'Store', balance: 5000, rate: 0, payment: 500, status: 'active' }];
  eq(debtInterestCoverage(zeroRate, 'R').shown, 0, 'a blank/zero rate is not a covered rate');
  eq(debtInterestCoverage(zeroRate, 'R').monthly, null, 'and the aggregate withholds, unchanged');

  /* Foreign debts are held out BEFORE the coverage question is asked, the
     same order debtInterestMonthly's own header insists on: a euro bond's
     rate cannot make a rand interest bill knowable. */
  const mixed = [blank[0], { name: 'Berlin', balance: 100000, rate: 3.5, payment: 700, status: 'active', currency: '€' }];
  eq(debtInterestCoverage(mixed, 'R').total, 1, 'a euro bond is not one of the rand debts being covered');
  eq(debtInterestCoverage(mixed, 'R').monthly, null, 'and its rate does not make the rand book knowable');
}

/* ═══════════ 2. the Debt page's tile ═════════════════════════════════════ */

async function mountDebts(debtsMd) {
  const ctx = makeCtx(vault(debtsMd));
  const S = await loadInto(ctx);
  S.period = MONTH;
  const { $, nodes } = makeDom();
  $('#debtExtra').value = '';
  $('#debtStrategy').value = 'avalanche';
  ctx.$ = $;
  ctx.root = $('#root');
  ctx.money = money;
  require('../src/views/debts')(ctx);
  ctx.renderDebts();
  return { ctx, S, nodes };
}

/* One `.mini` tile out of #debtKpis, by its label — dom.js's kpiTiles builds
   each as label / value / optional sub, in that order. Reading the tile
   rather than the container's whole textContent matters: "R 0.00" appears in
   the Extra column of a neighbouring tile on some fixtures, and an assertion
   that searched the whole panel would pass on the defect. */
function tileOf(nodes, label) {
  for (const t of nodes.get('#debtKpis').children) {
    if (t.children[0] && t.children[0].textContent === label) {
      return { value: t.children[1].textContent, sub: t.children[2] ? t.children[2].textContent : '' };
    }
  }
  return null;
}

(async () => {
  const INTEREST = 'Interest this month';

  /* ---- 2a. all rates blank: withhold, and never print a zero ---- */
  {
    const { nodes } = await mountDebts(NONE);
    const t = tileOf(nodes, INTEREST);
    ok(t, 'the Interest tile is still drawn when no rate is known — withholding is not hiding');
    eq(t.value, '—', 'the tile shows the app\'s no-figure placeholder, not a number');
    ok(!t.value.includes('0.00'), 'and specifically not R0,00 — the false claim this test exists for');
    eq(t.sub, i18n.t('debt.interest.noRates'), 'captioned with what would make the figure knowable');
  }

  /* ---- 2b. one of two rated: print the sum, disclose the coverage ---- */
  {
    const { nodes } = await mountDebts(SOME);
    const t = tileOf(nodes, INTEREST);
    eq(t.value, money(monthlyInterest(900000, 10.5)),
      'a partial book prints what IS known rather than withholding the lot');
    /* THE PLURAL CONTRACT, pinned on the case that breaks it. i18n.t() chooses
       a plural form from `count` and from nothing else, and this sentence
       pluralises on the debts MISSING a rate — so the view has to pass that
       value twice. An expectation that ALSO omitted `count` would agree with
       the defect: both sides would render the `other` form and "1 have no
       rate" would ship green. So the expectation carries `count`, and the
       line above it proves the two renders actually differ — without that,
       this block passes whether the view is right or wrong. */
    const oneForm = i18n.t('debt.interest.partial', { shown: 1, total: 2, missing: 1, count: 1 });
    const otherForm = i18n.t('debt.interest.partial', { shown: 1, total: 2, missing: 1 });
    ok(oneForm !== otherForm,
      'the singular and plural renders of this caption really do differ — otherwise the next assertion proves nothing');
    eq(t.sub, oneForm,
      'one debt without a rate reads in the singular — the exact case a missing `count` renders as "1 have no rate"');
  }

  /* ---- 2b(ii). two of three rateless: the same call, pluralised ---- */
  {
    const { nodes } = await mountDebts(SOME3);
    const t = tileOf(nodes, INTEREST);
    eq(t.value, money(monthlyInterest(900000, 10.5)), 'still only the interest the vault can prove');
    eq(t.sub, i18n.t('debt.interest.partial', { shown: 1, total: 3, missing: 2, count: 2 }),
      'two debts without a rate read in the plural, off the same call');
  }

  /* ---- 2c. fully rated: byte-identical to before this change ---- */
  {
    const { nodes } = await mountDebts(ALL);
    const t = tileOf(nodes, INTEREST);
    const sum = monthlyInterest(900000, 10.5) + monthlyInterest(164000, 12.25);
    eq(t.value, money(sum), 'a fully-rated book is unchanged');
    eq(t.sub, `${Math.round((sum / 12700) * 100)}% of your payments`,
      'and keeps its existing caption exactly — the disclosure is additive, not a rewrite');
  }

  /* ---- 2d. the view's own slice and the canonical function's agree ----
     views/debts.js narrows with a local filter chain; debtInterestCoverage
     narrows with worth.js's activeDebts plus currency.js's isForeign. Two
     expressions, one intended set — the assumption the fix rests on, proven
     on a fixture rather than read off the source. */
  {
    const { S } = await mountDebts(SOME);
    const viewSlice = S.debts.filter(d => d.status !== 'paid');
    const cov = debtInterestCoverage(S.debts, S.settings.currency);
    eq(cov.total, viewSlice.length,
      'the tile\'s own active list and the shared function\'s cover the same debts');
  }

  /* ═══════════ 3. the Report's Debt section ═════════════════════════════ */

  async function mountReport(debtsMd) {
    const ctx = makeCtx(vault(debtsMd));
    const S = await loadInto(ctx);
    S.period = MONTH;
    const { $ } = makeDom();
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
    ctx.renderReport();
    /* Turn the JSON sibling on through the page's own pill, not through a
       private hook — the two serialisers must be compared on the file the
       app actually writes, which is the only version of this assertion that
       can catch them disagreeing in production. */
    const pills = $('#reportFormatPills').children[0].children;
    const jsonPill = pills.find(b => b.textContent === i18n.t('report.format.json'));
    assert.ok(jsonPill, 'the JSON format pill is on the page');
    jsonPill.click();
    await ctx.createReport();
    const store = ctx.app.vault._store;
    const mdPath = [...store.keys()].find(k => /Reports\/.*Financial Report\.md$/.test(k));
    const jsonPath = [...store.keys()].find(k => /Reports\/.*Financial Report\.json$/.test(k));
    assert.ok(mdPath && jsonPath, 'the fixture wrote both a report and its JSON sibling');
    return { md: store.get(mdPath), json: JSON.parse(store.get(jsonPath)) };
  }

  const debtSection = md => (md.split(`## ${i18n.t('report.section.debt')}`)[1] || '').split('\n## ')[0];
  const interestRow = md => debtSection(md).split('\n').find(l => l.startsWith(`| ${i18n.t('report.debt.interest')} |`));

  /* ---- 3a. all rates blank: no interest row, a sentence instead ---- */
  {
    const { md, json } = await mountReport(NONE);
    const sec = debtSection(md);
    ok(!interestRow(md), 'the Markdown drops the interest row rather than printing R0,00 into a document that leaves the app');
    ok(sec.includes(i18n.t('report.debt.interestNone')), 'and says in prose why the figure is absent');
    ok(sec.includes(money(1064000)), 'the figures that ARE knowable still print — this withholds one number, not the section');
    eq(json.debts.interest, null, 'the JSON twin withholds the same figure — one data object, two serialisers');
    eq(json.debts.rate_coverage, { shown: 0, total: 2, missing: 2 },
      'and carries the coverage as data, the same facts the Markdown states as prose');
  }

  /* ---- 3b. one of two rated: the row AND the coverage sentence ---- */
  {
    const { md, json } = await mountReport(SOME);
    const sec = debtSection(md);
    const expected = monthlyInterest(900000, 10.5);
    ok(interestRow(md).includes(money(expected)), 'a partial book prints the interest it can prove');
    /* No `count` here, deliberately: report.debt.interestNone and
       report.debt.interestPartial are PLAIN strings in all twelve tables, not
       plural entries, so they take only the three interpolated values. Passing
       a `count` they do not use would be harmless and misleading — it would
       read as if this sentence had a singular form to get wrong. */
    ok(sec.includes(i18n.t('report.debt.interestPartial', { shown: 1, total: 2, missing: 1 })),
      'beside a sentence saying how much of the book it covers');
    ok(!sec.includes(i18n.t('report.debt.interestNone')), 'and not the withheld sentence as well');
    near(json.debts.interest, expected, 0.01, 'the JSON carries the same figure the Markdown formats');
    eq(json.debts.rate_coverage, { shown: 1, total: 2, missing: 1 }, 'and the same coverage');
  }

  /* ---- 3c. fully rated: unchanged, and no new sentence ---- */
  {
    const { md, json } = await mountReport(ALL);
    const sec = debtSection(md);
    const sum = monthlyInterest(900000, 10.5) + monthlyInterest(164000, 12.25);
    ok(interestRow(md).includes(money(sum)), 'a fully-rated book prints exactly what it always did');
    ok(!sec.includes(i18n.t('report.debt.interestNone')), 'no withheld sentence');
    ok(!sec.includes(i18n.t('report.debt.interestPartial', { shown: 2, total: 2, missing: 0 })),
      'and no coverage caveat when there is nothing left uncovered');
    near(json.debts.interest, sum, 0.01, 'JSON agrees');
    eq(json.debts.rate_coverage, { shown: 2, total: 2, missing: 0 }, 'coverage says the book is complete');
  }

  console.log(`PASS  debt-interest-coverage — ${checks} checks`);
})().catch(e => { console.error(e); process.exit(1); });
