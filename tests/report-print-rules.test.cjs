'use strict';
/* The Report prints its figures by the app's rules, whichever button made it
   (2026-10-20 audit, M1-08, M1-09, D2-03, D2-07, M2-09, D2-26).

   M1-08. The health note under the score named three of its parts —
   emergency-fund months, saving rate, debt interest share — while the score
   has five pillars (health-math.js PILLARS), and Spending and What you own
   carry 35 of its 100 points between them. A reader handed the document was
   told a third of the number did not exist. The note now names the pillars
   the score is built from, read off PILLARS in the Score page's own words.

   M1-09 / D2-03. A document that prints every figure to the cent printed two
   sentences in whole rands beside cents twins: the set-aside paid and the
   "R X of R Y saved so far" pair, both under a table of cents.

   D2-07 / M2-09. Two figures printed in a point decimal in a comma household:
   the emergency-fund months ("2.5 / 6", via toFixed) and each debt's rate
   (the raw number, "20%"). The Debt page prints a rate to two places; both
   now go through decimalText in the household's own mark.

   D2-26. The hand-formatted fallbacks for another currency
   (`${sym} ${Math.round(v)}`, `${sym} ${v.toFixed(2)}`) were not dead: the
   options card's "Copy report" button built the Markdown with no formatter
   at all, so the copy said "$ 1000" where the file the Create button wrote
   said "$ 1 000", and every decimal in it was a point. Both buttons now hand
   the serialiser the same formatter, and the fallback is the real formatter
   (currency.js formatAmount) rather than a hand-built string.

   Over the committed household (South African: "R 1 000,00"), through the
   REAL loader and views.

     node tests/report-print-rules.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, readable } = require('./helpers/figures.cjs');
const { mountFor, createReport, section } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const { PILLARS } = require('../src/health-math');
const { decimalText } = require('../src/locale');
const report = require('../src/report');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let copied = null;
function installClipboard() {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: { language: 'en-US', clipboard: { writeText(t) { copied = t; return Promise.resolve(); } } },
  });
}
function restoreClipboard() {
  if (realNav) Object.defineProperty(globalThis, 'navigator', realNav); else delete globalThis.navigator;
}

(async () => {
  const unpin = pinClock(TODAY);
  let r, M;
  try {
    M = await mountFor(SEED, { period: PERIOD, budgetFolder: B });
    r = await createReport(M);
    installClipboard();
    try { await M.ctx.copyReportNow(); } finally { restoreClipboard(); }
  } finally { unpin(); }
  const { ctx } = M;
  const money = ctx.money;
  const loc = ctx.locale();
  eq(loc.decimal, ',', 'fixture: the household writes a decimal comma');

  /* ---- M1-08: the note names every part of the score ---------------------- */
  const health = section(r.md, i18n.t('report.section.health'));
  ok(health, 'the Financial health section is present');
  const names = PILLARS.map(p => i18n.t(`dash.health.why.name.${p.key}`));
  eq(names.length, 5, 'fixture: the score has five pillars');
  for (const n of names) ok(health.includes(n), `the health note names "${n}"`);
  ok(!health.includes(i18n.t('report.health.note')), 'the three-part note is gone');
  for (const n of names) ok(r.json.health_score.note.includes(n), `and so does the JSON's note ("${n}")`);

  /* ---- M1-09 / D2-03: cents where the document prints cents --------------- */
  const inc = section(r.md, i18n.t('report.section.incomeSpend'));
  const bu = r.json.income_vs_spend.budget_used;
  ok(bu.set_aside >= 1 && bu.set_aside_planned >= 1, 'fixture: something was set aside, and the plan sets something aside');
  const setAside = i18n.t('dash.stat.setAside', { amount: money(bu.set_aside) });
  ok(inc.includes(setAside), `the set-aside paid is printed to the cent — expected "${setAside}" in:\n${inc}`);
  const saved = i18n.t('dash.stat.ofWhichSetAside', { amount: money(bu.set_aside_planned), moved: money(bu.set_aside_moved) });
  ok(inc.includes(saved), `"saved so far" is printed to the cent — expected "${saved}"`);
  ok(!inc.includes(i18n.t('dash.stat.setAside', { amount: money(bu.set_aside, 0) })), 'not in whole rands');

  /* ---- D2-07 / M2-09: the household's decimal mark ------------------------ */
  const snap = ctx.healthSnapshot();
  ok(snap.metrics.months !== null, 'fixture: the emergency fund is measured');
  const months = `${decimalText(snap.metrics.months, 1, loc)} / ${snap.target}`;
  ok(health.includes(`| ${months} |`), `months covered print in the household's mark — expected "${months}"`);
  ok(!/\| \d+\.\d \/ \d+ \|/.test(health), 'no point decimal in the months row');
  const debt = section(r.md, i18n.t('report.section.debt'));
  const rate = `${decimalText(20, 2, loc)}%`;
  ok(debt.includes(`| ${rate} |`), `a debt's rate prints to two places in the household's mark, as the Debt page does — expected "${rate}" in:\n${debt}`);

  /* ---- D2-26: the Copy button prints what the Create button wrote ---------- */
  ok(copied, 'Copy report put something on the clipboard');
  const body = readable(report.copyBody(ctx.vault._store.get(r.mdPath)));
  /* The generated stamp is read off the clock at each click; everything else
     is one `data` object through one serialiser and must not differ. */
  const strip = s => readable(s).replace(/^Generated .*$/m, 'Generated');
  eq(strip(copied), strip(body), 'the copied report is the written report, character for character');
  const other = i18n.t('acct.hero.otherCurrencies', { list: ctx.moneyIn('$', 1000, 0) }).trim();
  ok(readable(copied).includes(other), `and names the dollar account the way the file does — "${other}"`);

  /* ---- the bare serialiser's fallback is the real formatter ----------------- */
  {
    const data = {
      generated: 'g', periodLabel: 'p', rangeNote: 'r', detail: 'detail', periodCount: 1,
      income: 0, spend: 0, net: 0, budgetIncome: 0, budgetSpend: 0, categories: [], spendByCategory: [],
      categoryGap: { uncat: 0, netted: 0 }, savings: null, debts: null,
      netWorth: { net: 0, assets: 0, liabilities: 0 }, health: null, household: 'R',
      otherCurrencies: [['€', 200300.4]],
      transactions: [{ date: '2026-09-01', desc: 'Hotel', label: 'Euro', cat: '', amount: -900.5, currency: '€' }],
    };
    const md = readable(report.financialReportMarkdown(data, v => `R ${v.toFixed(2)}`));
    ok(md.includes('Plus € 200300 held'), 'with no formatter handed in, another currency is whole and ungrouped, as before');
    ok(md.includes('| € -900.50 |') || md.includes('€ -900.50'), 'and a foreign row prints to the cent with a point');
  }

  console.log(`PASS report-print-rules (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
