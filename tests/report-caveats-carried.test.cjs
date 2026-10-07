'use strict';
/* The exported Net Worth and Health sections carry the caveats their
   on-screen twins print beside the same figures.

   The house rule is that a document which leaves the app says what the
   screen says beside the number, because its reader — an advisor, an AI
   chat — has no second screen to check against. Two sections broke it:

     · Net Worth printed the implied-balance total the Dashboard's tile
       prints, and none of the sentence the Dashboard (#dashStale) and the
       Savings page (#savingsStale) put under it — "Built from N balances
       nobody has confirmed recently — the oldest D days ago. Transactions
       since then add up to R X more." On the vault this was found on, the
       oldest was half a year old and the rows since then moved the total by
       tens of thousands.
     · Health printed a score, a saving rate and a debt-interest share that
       are averages, with nothing saying over what: the Dashboard's health
       card and the Score page both say "Averaged over your last N completed
       periods".

   Pinned here, over the committed household read on 2026-10-07 — 36 days
   after its balances were confirmed, so every one is stale — through the
   REAL loader and views:

     1. CONTROL: the Dashboard really does print a staleness sentence here;
     2. the Report's Net Worth section carries that exact sentence, built
        from the same seams (bookFigures().stale / .drift) and the same keys;
     3. the JSON sibling carries the same facts as data, and every figure
        the Markdown sentence prints equals its JSON field;
     4. the Health section carries the Dashboard health card's own window
        sentence, and the JSON carries the period count it is built from;
     5. a household whose balances are fresh gets no staleness sentence.

     node tests/report-caveats-carried.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, section, kids } = require('./helpers/report-page.cjs');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const DAY = '2026-10-07';
const raw = n => String((n && n.textContent) || '').trim();

async function run(files) {
  const unpin = pinClock(DAY);
  try {
    const M = await mountFor(files, { period: '2026-10', budgetFolder: B });
    const out = await createReport(M);
    M.ctx.renderDashboard();
    const caveat = kids(M.nodes.get('#dashStale'), n => n.classList && n.classList.contains('kpi-caveat-txt'))[0];
    return {
      M, ...out, i18n: require('../src/i18n'),
      dashStale: raw(caveat), healthSub: raw(M.nodes.get('#healthSub')),
      book: M.ctx.bookFigures(), snap: M.ctx.healthSnapshot(),
    };
  } finally { unpin(); }
}

(async () => {
  const r = await run({ ...SEED });
  const { ctx } = r.M;
  const i18n = r.i18n;
  ok(r.md && r.json, 'both documents were written');
  const nw = section(r.md, i18n.t('report.section.netWorth'));
  const health = section(r.md, i18n.t('report.section.health'));
  ok(nw && health, 'the Net Worth and Financial Health sections are present');

  /* ---- 1. CONTROL ------------------------------------------------------- */
  ok(r.book.stale.stale > 0, `fixture: balances are stale on ${DAY} (${r.book.stale.stale} of ${r.book.stale.total})`);
  ok(r.dashStale.length > 0, 'CONTROL: the Dashboard prints a staleness sentence under its net worth');

  /* ---- 2. the twin's own sentence ---------------------------------------- */
  ok(nw.includes(r.dashStale), `the Net Worth section carries the Dashboard's sentence — expected "${r.dashStale}" in:\n${nw}`);

  /* ---- 3. the JSON says the same, figure for figure ---------------------- */
  const ub = r.json.net_worth.unconfirmed_balances;
  ok(ub && typeof ub === 'object', 'JSON net_worth carries an unconfirmed_balances fact');
  eq([ub.count, ub.total, ub.oldest_days], [r.book.stale.stale, r.book.stale.total, r.book.stale.oldestDays],
    'count, total and oldest age are stalenessSummary()\'s, the Dashboard\'s own reading');
  eq([ub.moved_since, ub.foreign_accounts, ub.undated_rows],
    [r.book.drift.drift, r.book.drift.driftForeign, r.book.drift.driftUnplaced],
    'and what the rows since then add up to is bookFigures().drift, the same pass the Dashboard reads');
  const line = ub.count === ub.total
    ? i18n.t('dash.stale.all', { count: ub.total })
    : i18n.t('dash.stale.some', { stale: ub.count, total: ub.total });
  ok(nw.includes(line), `the Markdown's count is the JSON's (${line})`);
  ok(nw.includes(i18n.t('dash.stale.oldest', { days: ub.oldest_days, count: ub.oldest_days })), 'the Markdown\'s age is the JSON\'s');
  ok(Math.abs(ub.moved_since) >= 1, 'fixture: the rows since then moved the balances by more than a rand');
  ok(nw.includes(i18n.t(ub.moved_since > 0 ? 'dash.stale.driftUp' : 'dash.stale.driftDown', { amount: ctx.money(Math.abs(ub.moved_since), 0) })),
    'and the Markdown\'s amount and direction are the JSON\'s');

  /* ---- 4. the averaging window ------------------------------------------- */
  ok(r.healthSub.length > 0, 'CONTROL: the Dashboard health card states its window');
  ok(health.includes(r.healthSub), `the Health section carries it — expected "${r.healthSub}"`);
  eq(r.json.health_score.counted_periods, r.snap.metrics.countedPeriods, 'JSON health_score.counted_periods is the window the score averaged over');
  ok(r.snap.metrics.countedPeriods > 0, 'fixture: at least one completed period was averaged');
  ok(health.includes(i18n.t('dash.health.sub', { count: r.json.health_score.counted_periods })),
    'the Markdown sentence\'s count is the JSON field');

  /* ---- 5. fresh balances, no caveat ------------------------------------- */
  {
    const fresh = {};
    for (const [k, v] of Object.entries(SEED)) fresh[k] = v.replace(/balance_updated: 2026-09-01/g, 'balance_updated: 2026-10-06');
    const f = await run(fresh);
    eq(f.book.stale.stale, 0, 'fixture: every balance was confirmed yesterday');
    eq(f.dashStale, '', 'the Dashboard prints no staleness sentence');
    const fnw = section(f.md, f.i18n.t('report.section.netWorth'));
    ok(!fnw.includes(f.i18n.t('dash.stale.all', { count: f.book.stale.total })) && !/nobody has confirmed/.test(fnw),
      'and neither does the Report');
    eq(f.json.net_worth.unconfirmed_balances.count, 0, 'JSON states nothing unconfirmed, as a zero rather than an absent key');
  }

  console.log(`PASS report-caveats-carried (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
