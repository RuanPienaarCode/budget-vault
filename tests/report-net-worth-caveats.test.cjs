'use strict';
/* The Report's Net Worth section says what its figure already includes, and
   that a card may be counted twice (2026-10-20 audit, M2-02, M2-05).

   M2-02. The section prints the IMPLIED net worth — every stated balance
   carried forward by the transactions dated after it (bookFigures().balances
   .implied) — and under it the staleness sentence ended "Transactions since
   then add up to R X more." That is the sentence for a STATED balance, where
   the rows since are NOT in the figure. Under an implied one they already
   are, and a reader adds them a second time: on the vault this was found on,
   a five-figure drift read as money still to come on top of a net worth that
   already held it. The implied surfaces now say "already counted in these
   figures" (dash.stale.driftUpIncluded / driftDownIncluded), and the amount
   prints to the cent like the figures above it.

   M2-05. A credit card can be tracked as an account AND as a Debt-page row,
   and then the net worth counts it twice. The Dashboard and the Savings page
   say so beside their net worth (worth.js cardOverlap, the dash.overlap
   sentence); the Report printed the same total with nothing.

   Over the committed household through the REAL loader and views: read on
   2026-10-07, every balance is 36 days old and the rows since have moved the
   book; a "Visa" credit-card account with a negative balance is added beside
   the household's "Card" credit-card debt for the overlap.

     node tests/report-net-worth-caveats.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, section, kids } = require('./helpers/report-page.cjs');
const { SEED, B } = require('./figures/household.cjs');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));
const { worth } = require('../src/worth');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const DAY = '2026-10-07';
const VISA = { [`${B}/Accounts/Visa.md`]: '---\ntype: credit_card\ntx_label: "Visa"\nowner: Alex\nbalance: -3000.00\nbalance_updated: 2026-09-01\n---\n' };

async function run(files) {
  const unpin = pinClock(DAY);
  try {
    const M = await mountFor(files, { period: '2026-10', budgetFolder: B });
    const out = await createReport(M);
    M.ctx.renderDashboard();
    const note = kids(M.nodes.get('#dashPositionNote'), n => n.classList && n.classList.contains('kpi-caveat-txt'))[0];
    return { M, ...out, nw: section(out.md, i18n.t('report.section.netWorth')), dashOverlap: String((note && note.textContent) || '').trim() };
  } finally { unpin(); }
}

(async () => {
  /* ---- M2-02: the drift is already in the figure --------------------------- */
  {
    const r = await run({ ...SEED });
    const { ctx } = r.M;
    const book = ctx.bookFigures();
    const moved = book.drift.drift;
    ok(book.stale.stale > 0 && Math.abs(moved) >= 1, `fixture: balances are stale and the rows since moved them (${moved})`);
    /* The figure the sentence sits under already holds the drift: worked over
       the STATED balances the same way, it is exactly `moved` less. */
    const S = ctx.S;
    const fromStated = worth(book.balances.stated.accounts, S.debts, S.assets, S.settings.currency, S.owed).net;
    ok(Math.abs(r.json.net_worth.net - (fromStated + moved)) < 0.01,
      `fixture: the section prints the IMPLIED net worth — stated ${fromStated} + moved ${moved} = ${r.json.net_worth.net}`);
    const key = moved > 0 ? 'dash.stale.driftUpIncluded' : 'dash.stale.driftDownIncluded';
    const included = i18n.t(key, { amount: ctx.money(Math.abs(moved)) });
    ok(r.nw.includes(included.trim()), `the sentence says the rows are already counted, to the cent — expected "${included.trim()}" in:\n${r.nw}`);
    const stated = i18n.t(moved > 0 ? 'dash.stale.driftUp' : 'dash.stale.driftDown', { amount: ctx.money(Math.abs(moved), 0) });
    ok(!r.nw.includes(stated.trim()), 'and no longer says they "add up to" more, the stated-balance sentence');
    eq(r.json.net_worth.unconfirmed_balances.moved_since_counted, true, 'the JSON says moved_since is already inside net');
    eq(r.json.net_worth.card_overlap, null, 'no card is both an account and a debt here');
    ok(!r.nw.includes(i18n.t('dash.overlap', { accounts: 0, debts: 1 }).slice(0, 20)), 'and no overlap sentence is printed');
  }

  /* ---- M2-05: a card tracked twice ------------------------------------------ */
  {
    const r = await run({ ...SEED, ...VISA });
    const want = i18n.t('dash.overlap', { accounts: 1, debts: 1 });
    eq(r.dashOverlap, want, 'CONTROL: the Dashboard prints the overlap sentence under its net worth');
    ok(r.nw.includes(want), `the Report's Net Worth carries the same sentence — expected "${want}" in:\n${r.nw}`);
    eq(r.json.net_worth.card_overlap, { card_accounts: 1, card_debts: 1 }, 'and the JSON carries the two counts');
  }

  console.log(`PASS report-net-worth-caveats (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
