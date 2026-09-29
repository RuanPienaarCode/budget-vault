'use strict';
/* "Budget" printed beside a SPEND-ONLY figure (2026-09-29 totals audit, lane Y
   items 5 and 6).

   The Dashboard hero's remaining figure is `budgetTotals.spend - spent`: the
   spending envelopes only, set-aside (savings, investment) left out of both
   sides (ADR-0005). Ruan's decision: label a spend-only figure "spending
   budget", so the word "budget" alone is left to mean the whole plan.
   dash.hero.remaining read "Budget remaining this period" beside a figure that
   is not the plan's remainder. Every other key that names the spend-only
   figure is pinned here too - the trend chart plots `budgetTotals(p).spend`
   against spend, so its subtitle and tooltips say the same.

   Not reworded, deliberately: "Budget used" (a defined term in CONTEXT.md, a
   share, not a figure), "Total budgeted" / dash.stat.budgeted (the whole plan)
   and the Budget-vs-actual column headers (per category, either type).

   Item 6 - key hygiene - is the i18n inventory test's job (every table has
   English's key set; every key src/ calls exists) plus the checks below: each
   key this lane added or reworded is present in all twelve tables, is called
   from src/, and has the plural shape its call site relies on.

   Synthetic household.
     node tests/lane-y-spending-budget-wording.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { B, tx, base, account, find, hasClass, textOf, renderDash } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const LANGS = ['en', 'af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu'];
const TABLES = Object.fromEntries(LANGS.map(l => [l, require(`../src/lang/${l}.js`)]));
const SRC = path.join(__dirname, '..', 'src');

/* What each language already calls the spend-only budget (dash.hero.sub, set
   by the earlier wave) - the reworded keys must use the same word, so one
   figure is not named two ways in one language. xh and zu inflect the noun
   (ibhajethi / kwebhajethi, isabelomali / kwesabelomali), so they are matched
   on the stem. */
const TERM = {
  en: 'spending budget', af: 'bestedingsbegroting', de: 'ausgabenbudget', es: 'presupuesto de gastos',
  fr: 'budget de dépenses', hi: 'खर्च बजट', id: 'anggaran pengeluaran', ja: '支出予算',
  pt: 'orçamento de gastos', xh: 'bhajethi yokuchitha', zh: '支出预算', zu: 'sabelomali sokuchitha',
};
const flat = v => typeof v === 'string' ? v : Object.values(v).join(' | ');

/* ---- the English wording, pinned -------------------------------------------- */
const en = TABLES.en;
eq(en['dash.hero.remaining'], 'Spending budget remaining this period', 'the hero label (item 5)');
eq(en['dash.hero.overspent'], 'Over the spending budget this period', 'its overspent twin');
eq(en['shell.dash.trendSub'], 'Spent vs spending budget', 'the trend chart subtitle');
eq(en['dash.trend.sub'], { one: 'Spent vs spending budget · {count} period', other: 'Spent vs spending budget · {count} periods' },
  'the same subtitle once the count is known');
eq(en['dash.trend.tip.over'], '{amount} over the spending budget', 'the trend tooltip, over');
eq(en['dash.trend.tip.under'], '{amount} under the spending budget', 'and under');

/* ---- every key that names the spend-only figure says so, in every language --- */
const SPEND_ONLY = ['dash.hero.remaining', 'dash.hero.overspent', 'dash.hero.sub', 'dash.stat.used',
  'bud.total.spentNote', 'bud.total.spentNoteAssumed', 'shell.legend.budget', 'shell.dash.trendSub',
  'dash.trend.sub', 'dash.trend.aria', 'dash.trend.tip.over', 'dash.trend.tip.under',
  /* The Score flow card: money-flow.js leftInBudget = budgetSpend - spent. */
  'score.flow.chip.leftInBudget', 'score.flow.sub.notYetSpent', 'score.flow.subA.overBudget'];
for (const lang of LANGS) {
  for (const key of SPEND_ONLY) {
    ok(key in TABLES[lang], `${lang}: ${key} exists`);
    ok(flat(TABLES[lang][key]).toLowerCase().includes(TERM[lang]),
      `${lang}: ${key} names the spending budget as "${TERM[lang]}" - got ${flat(TABLES[lang][key])}`);
  }
}

/* ---- the hero prints it ------------------------------------------------------- */
const plan = (groceries, salary = 20000) => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + `| Salary | income | ${salary}.00 |  |\n| Groceries | expense | ${groceries}.00 |  |\n`;
const household = (groceriesBudget, spent) => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '30000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: plan(groceriesBudget),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 20000],
    ['2026-09-03', 'Checkers', 'Groceries', -spent],
  ]),
});
const heroLabel = nodes => textOf(find(nodes.get('#heroCard'), n => hasClass(n, 'hero-lbl'))[0]);

(async () => {
  {
    const { nodes } = await renderDash(household(5000, 1000), { today: '2026-09-10' });
    eq(heroLabel(nodes), 'Spending budget remaining this period', 'under the spending budget: the reworded label');
  }
  {
    const { nodes } = await renderDash(household(1000, 1500), { today: '2026-09-10' });
    eq(heroLabel(nodes), 'Over the spending budget this period', 'over it: the reworded twin');
  }

  /* ---- item 6: the keys this lane touched -------------------------------------- */
  const NEW = ['bud.remaining.incomeAsPlanned', 'tx.future.hidden', 'tx.showRest'];
  const REWORDED = ['dash.hero.remaining', 'dash.hero.overspent', 'shell.dash.trendSub', 'dash.trend.sub',
    'dash.trend.tip.over', 'dash.trend.tip.under'];
  const PLURAL = ['tx.future.hidden', 'tx.showRest', 'dash.trend.sub'];
  const ONE_FORM = new Set(['id', 'ja', 'zh']);
  const srcText = [];
  for (const d of [SRC, path.join(SRC, 'views')]) {
    for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) srcText.push(fs.readFileSync(path.join(d, f), 'utf8'));
  }
  const srcAll = srcText.join('\n');

  for (const key of [...NEW, ...REWORDED]) {
    for (const lang of LANGS) ok(key in TABLES[lang], `${lang}.js has ${key}`);
    ok(srcAll.includes(`'${key}'`) || srcAll.includes(`"${key}"`), `${key} is called from src/ (not staged, not orphaned)`);
  }
  for (const key of PLURAL) {
    for (const lang of LANGS) {
      const v = TABLES[lang][key];
      ok(v && typeof v === 'object' && 'other' in v, `${lang}: ${key} is a plural table`);
      if (!ONE_FORM.has(lang)) ok('one' in v, `${lang}: ${key} has a singular`);
    }
  }
  /* The call sites hand t() a `count`, because it selects the form on count ALONE. */
  ok(/i18n\.t\('tx\.future\.hidden', \{ count: future \}\)/.test(fs.readFileSync(path.join(SRC, 'views/transactions.js'), 'utf8')),
    'tx.future.hidden is called with count');
  ok(/i18n\.t\('tx\.showRest', \{ remaining, count: remaining \}\)/.test(fs.readFileSync(path.join(SRC, 'views/transactions.js'), 'utf8')),
    'tx.showRest is called with count, and the number it prints');

  /* The singular is what a wrong plural rule breaks. */
  i18n.setLanguage('en');
  eq(i18n.t('tx.future.hidden', { count: 1 }), '1 row dated after today is hidden', 'singular');
  eq(i18n.t('tx.future.hidden', { count: 2 }), '2 rows dated after today are hidden', 'plural');
  eq(i18n.t('tx.showRest', { remaining: 1, count: 1 }), 'Show the remaining row', 'singular');
  eq(i18n.t('tx.showRest', { remaining: 55, count: 55 }), 'Show the remaining 55 rows', 'plural');

  /* No table carries a placeholder English does not (a stray {n} would print raw). */
  for (const key of [...NEW, ...REWORDED]) {
    const want = new Set([...flat(en[key]).matchAll(/\{(\w+)\}/g)].map(m => m[1]));
    for (const lang of LANGS) {
      const got = new Set([...flat(TABLES[lang][key]).matchAll(/\{(\w+)\}/g)].map(m => m[1]));
      for (const g of got) ok(want.has(g), `${lang}: ${key} uses {${g}}, which English does not`);
    }
  }
  console.log(`PASS lane-y-spending-budget-wording (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
