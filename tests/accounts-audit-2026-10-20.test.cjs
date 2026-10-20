'use strict';
/* The Accounts page findings of the 20 Oct 2026 audit, each pinned on the REAL
   Accounts view over the real loader, the clock fixed. Every figure is made up.

   M2-06  The overlap note reused the Dashboard's "…it is counted twice above",
          but the hero above it on THIS page leaves Debt-page rows out. Its own
          key now says where a card in both IS counted twice.
   M2-08 / D2-09  A goal at 99,6% printed "100%" (Math.round) where Savings
          printed "99%"; a card at 99,7% of its limit printed "100%" and one at
          0,3% printed "0%". One rule now: sharePercentLabel, through
          savings-math.js's goalPercentLabel for a goal.
   M2-12  "Available" on a card ignored a balance in credit: available is the
          limit PLUS the balance, whichever its sign.
   D2-01 / D2-03 / MT-07  The ring legend, the hero's drift line and the
          drawer's drift difference were whole rands beside a cents hero and
          cents group totals. Legends and drift figures are in cents now; the
          legend adds up to the ring's sum to the cent, and the ring CENTRE
          stays whole (it has no room in the hole).
   D2-10  Growth reads one decimal in the household's mark ("-13,7%"), as on
          Savings and the Report.
   D2-17  Negative growth is rose (bg-danger), as Savings paints it, not amber.
   D2-11  Prose dates read "Aug 1", not "2026-08-01"; the table's Confirmed
          column keeps its ISO date.
   D1-15  "Share of what these accounts hold. Plus € 640 held …", not glued.
   Sparkline  An Accounts sparkline is decorative (aria-hidden) and carries no
          aria-label="undefined" (chart.js set the attribute with no label).

     node tests/accounts-audit-2026-10-20.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend, readingI18n } = require('./helpers/dom-stub.cjs');
const i18n = readingI18n(require('../src/i18n'));

let checks = 0;
/* SOFT=1 lists every failing check instead of stopping at the first — how the
   red-before run was read. */
const soft = process.env.SOFT === '1';
const failed = [];
const guard = fn => (...a) => { try { fn(...a); } catch (e) { if (!soft) throw e; failed.push(e.message); } checks++; };
const ok = guard((c, m) => assert.ok(c, m));
const eq = guard((a, b, m) => assert.deepStrictEqual(a, b, m));

const B = 'Budget';
const TODAY = '2026-10-20';
const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => HEAD + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');
const acct = (name, fm) => ({ [`${B}/Accounts/${name}.md`]: `---\ntx_label: "${name}"\n${fm}\n---\n` });

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  // Drifting: R150 net since its stated date, two rows in the period.
  ...acct('Cheque', 'type: checking\nbalance: 1000.40\nbalance_updated: 2026-10-01'),
  [`${B}/Transactions/Cheque/2026-10.md`]: tx([['2026-10-05', 'Shop', '', -100], ['2026-10-12', 'Refund', '', 250]]),
  // A card in credit, one nearly at its limit, one barely used.
  ...acct('Card', 'type: credit_card\nbalance: 500.00\nbalance_updated: 2026-10-15\ncredit_limit: 30000.00'),
  ...acct('Card2', 'type: credit_card\nbalance: -29910.00\nbalance_updated: 2026-10-15\ncredit_limit: 30000.00'),
  ...acct('Card3', 'type: credit_card\nbalance: -30.00\nbalance_updated: 2026-10-15\ncredit_limit: 10000.00'),
  // A goal 99,6% of the way there.
  ...acct('Pot', 'type: savings\nbalance: 9960.00\nbalance_updated: 2026-10-15\ngoal_amount: 10000.00'),
  // A fund that lost 13,7% of what went in.
  ...acct('Fund', 'type: investment\nbalance: 8630.00\nbalance_updated: 2026-10-15\nstarting_amount: 10000.00\ninception_date: 2025-01-01'),
  // Unconfirmed since 1 Aug.
  ...acct('Old', 'type: savings\nbalance: 200.00\nbalance_updated: 2026-08-01'),
  [`${B}/Transactions/Old/2026-07.md`]: tx([['2026-07-10', 'Transfer in', '', 200]]),
  ...acct('Euro', 'type: checking\ncurrency: "€"\nbalance: 640.00\nbalance_updated: 2026-10-15'),
  // The same card on the Debt page, so the overlap note fires.
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card2 | Bank | credit card | 29910.00 |  | 20.00 | 900.00 |  |  | | active | |\n',
};

const flat = n => String(n.textContent).replace(/[\s  ]+/g, ' ').trim();
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const byCls = (root, c) => descend(root).filter(n => hasCls(n, c));
const rands = t => Number(String(t).replace(/[^\d,-]/g, '').replace(',', '.'));
const cents = t => /\d,\d\d$/.test(String(t).replace(/[\s  ]+/g, ' ').trim());

async function render(open) {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, S } = await mountFor(FILES, { period: '2026-10' });
    ctx.switchView = () => {};
    S.acctView = { open: open || null, grouped: false };
    ctx.renderAccounts();
    return ctx;
  } finally { unpin(); }
}
const rowOf = (ctx, name) => descend(ctx.$('#acctTable'))
  .find(n => n.tagName === 'TR' && hasCls(n, 'acct-row') && descend(n).some(c => hasCls(c, 'acct-name-btn') && String(c.textContent) === name));
const goalOf = (ctx, name) => flat(byCls(rowOf(ctx, name), 'acct-goal')[0]);
const drawerFields = ctx => {
  const out = {};
  for (const f of byCls(ctx.$('#acctTable'), 'acct-drawer-f')) out[flat(f.children[0])] = flat(f.children[1]);
  return out;
};

(async () => {
  const ctx = await render();
  const summary = ctx.$('#acctSummary');

  /* ---- M2-06 ---- */
  const caveat = byCls(summary, 'kpi-caveat').map(flat).join(' ');
  ok(caveat.includes(i18n.t('acct.overlap', { accounts: 2, debts: 1 })), `the note is the page's own sentence (got "${caveat}")`);
  ok(!caveat.includes(i18n.t('dash.overlap', { accounts: 2, debts: 1 })), 'not the Dashboard\'s "counted twice above"');
  ok(/counted twice in net worth on the Savings page and the Dashboard/.test(caveat), 'and it says where the double count is');

  /* ---- M2-08 / D2-09 ---- */
  ok(goalOf(ctx, 'Pot').startsWith(i18n.t('acct.goalOf', { pct: '99,6', amount: 'R 10 000' })),
    `a goal at 99,6% is not "100%" (got "${goalOf(ctx, 'Pot')}")`);
  ok(goalOf(ctx, 'Card2').startsWith(i18n.t('acct.limitOf', { pct: '99,7', amount: 'R 30 000' })),
    `a card at 99,7% of its limit is not "100%" (got "${goalOf(ctx, 'Card2')}")`);
  ok(goalOf(ctx, 'Card3').startsWith(i18n.t('acct.limitOf', { pct: '0,3', amount: 'R 10 000' })),
    `a card at 0,3% of its limit is not "0%" (got "${goalOf(ctx, 'Card3')}")`);

  /* ---- D2-10 + D2-17 ---- */
  ok(goalOf(ctx, 'Fund').startsWith(i18n.t('acct.growthOn', { pct: '-13,7', amount: 'R 10 000' })),
    `growth reads one decimal in the household's mark (got "${goalOf(ctx, 'Fund')}")`);
  const fundFill = descend(byCls(rowOf(ctx, 'Fund'), 'acct-mbar')[0]).find(n => n.tagName === 'I');
  ok(hasCls(fundFill, 'bg-danger') && !hasCls(fundFill, 'bg-warning'), 'a loss is rose, as Savings paints it, not amber');

  /* ---- D2-01 / D2-03 / MT-07: the ring ---- */
  const ring = byCls(summary, 'acct-ring')[0];
  const legend = byCls(ring, 'dl-val').map(n => flat(n).replace(/\s*plus .*$/, ''));
  ok(legend.length && legend.every(cents), `the ring legend is in cents, like the hero and the group totals (got ${JSON.stringify(legend)})`);
  const centre = descend(ring).find(n => n.tagName === 'TEXT');
  const sum = Math.round(legend.reduce((s, v) => s + rands(v), 0) * 100) / 100;
  eq(rands(flat(centre)), Math.round(sum), 'the centre is the legend\'s own total, rounded to the rand for the hole');
  ok(!cents(flat(centre)), 'and stays whole: there is no room in the hole');

  /* ---- D2-03: the hero's drift line ---- */
  const heroSub = flat(byCls(summary, 'hero-sub')[0]);
  ok(heroSub.includes(i18n.t('acct.hero.driftUp', { amount: 'R 150,00' }).trim()), `the hero drift line is in cents (got "${heroSub}")`);

  /* ---- D1-15 ---- */
  const ringSub = flat(byCls(ring, 'sub')[0]);
  ok(ringSub.startsWith(`${i18n.t('acct.where.subStop')} `) && ringSub.includes('€ 640'),
    `the ring's subtitle ends its sentence before the next one (got "${ringSub}")`);
  ok(!/hold Plus/.test(ringSub), 'not glued');

  /* ---- Sparkline aria ---- */
  const sparks = descend(ctx.$('#acctTable')).filter(n => n.tagName === 'SVG' && hasCls(n, 'acct-spark'));
  ok(sparks.length >= 1, 'the drifting account draws a sparkline');
  for (const s of sparks) {
    ok(s.getAttribute('aria-label') !== 'undefined', 'no aria-label="undefined"');
    eq(s.getAttribute('aria-hidden'), 'true', 'it is decorative');
  }

  /* ---- D2-11: the deck's stale line ---- */
  const why = flat(rowOf(ctx, 'Old'));
  ok(why.includes(i18n.t('acct.deck.why.stale', { count: 80, date: 'Aug 1' })), `the stale reason names a prose date (got "${why}")`);
  ok(why.includes('2026-08-01'), 'while the Confirmed column keeps its ISO date');

  /* ---- drawers ---- */
  {
    const c = await render('Card');
    eq(drawerFields(c)[i18n.t('acct.drawer.available')], 'R 30 500,00',
      'a card R500 in credit against a R30 000 limit has R30 500 available (M2-12)');
  }
  {
    const c = await render('Card2');
    eq(drawerFields(c)[i18n.t('acct.drawer.available')], 'R 90,00', 'one R29 910 down has R90 left');
  }
  {
    const c = await render('Cheque');
    const recon = flat(byCls(c.$('#acctTable'), 'acct-recon-txt')[0]);
    ok(recon.includes(i18n.t('acct.drawer.drift', { count: 2, date: 'Oct 1', implied: 'R 1 150,40', diff: 'R 150,00', dir: i18n.t('acct.drawer.higher') })),
      `the drawer's drift: prose date, and the difference in cents beside the cents implied figure (got "${recon}")`);
  }
  {
    const c = await render('Old');
    const recon = flat(byCls(c.$('#acctTable'), 'acct-recon-txt')[0]);
    ok(recon.includes(i18n.t('acct.drawer.recon.stale', { date: 'Aug 1' })), `the stale drawer line names a prose date (got "${recon}")`);
  }

  if (failed.length) { console.error(failed.join('\n')); process.exit(1); }
  console.log(`PASS accounts-audit-2026-10-20 (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
