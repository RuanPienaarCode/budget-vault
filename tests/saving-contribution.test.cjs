'use strict';
/* One measure of "saved", read by the ring and the flow card.

   health-data.js's household walk and views/score.js's buildFlow() each
   assembled the same inputs for savedFromOutside — the pool of savings and
   investment accounts, the label map over their folders, the period's rows —
   in their own loop, with a comment in score.js admitting the copy was
   deliberate. The two copies had already drifted once by 1.41.1: the walk
   narrowed to household-currency rows and a household-currency pool (ISSUE
   28) and the card never did, so a euro deposit into a euro fund counted as
   R200 of saving on the card and as nothing on the ring beside it.

   savingContribution(p), published by health-data.js, is the one assembly.
   Expected values are worked by hand from the fixture:

     Cheque → Emergency Fund   5 000   crossed into the pool from outside
     Emergency Fund → Save B   3 000   a shuffle inside the pool — not saving
     Euro Savings              €200    not household money — not a rand of it

   so the period's saving is exactly 5 000.

   Runs in bare node against the REAL loader, period, health-data and views.
     node tests/saving-contribution.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(a !== null && Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r} |`).join('\n') + '\n';

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Categories/Saving.md`]: '---\ntype: savings\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 40000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]: '---\ntype: savings\nbalance: 20000.00\nbalance_updated: 2026-08-01\ntx_label: "Emergency Fund"\nemergency_fund: true\n---\n',
  [`${B}/Accounts/Save B.md`]: '---\ntype: savings\nbalance: 1000.00\nbalance_updated: 2026-08-01\ntx_label: "Save B"\n---\n',
  [`${B}/Accounts/Euro Savings.md`]: '---\ntype: savings\nbalance: 800.00\nbalance_updated: 2026-08-01\ncurrency: "€"\ntx_label: "Euro Savings"\n---\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: TX([
    '2026-08-01 | Salary | Salary | 45000.00 | | | ',
    '2026-08-05 | Groceries | Groceries | -9000.00 | | | ',
    '2026-08-06 | To emergency fund | Saving | -5000.00 | | | ',
  ]),
  [`${B}/Transactions/Emergency Fund/2026-08.md`]: TX([
    '2026-08-06 | From cheque | Saving | 5000.00 | | | ',
    '2026-08-10 | To Save B | Saving | -3000.00 | | | ',
  ]),
  [`${B}/Transactions/Save B/2026-08.md`]: TX([
    '2026-08-10 | From emergency fund | Saving | 3000.00 | | | ',
  ]),
  [`${B}/Transactions/Euro Savings/2026-08.md`]: TX([
    '2026-08-12 | Deposit | Saving | 200.00 | | | ',
  ]),
};

async function mount(period) {
  const ctx = makeCtx(FILES, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = period;
  return { ctx, S };
}
async function mountScore(period) {
  const { ctx, S } = await mount(period);
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  require('../src/categories')(ctx);
  require('../src/views/score')(ctx);
  ctx.renderScore();
  return { ctx, S, nodes };
}
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textsOf = (root, cls) => descend(root).filter(e => hasCls(e, cls)).map(e => e.textContent || '');

(async () => {
  /* ---- 1. the seam ------------------------------------------------------- */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { ctx } = await mount('2026-08');
      near(ctx.savingContribution('2026-08'), 5000,
        'saved = what crossed into the pool from outside: the shuffle pairs away and the euro deposit is not rand');
    } finally { unpin(); }
  }

  /* ---- 2. the ring: the six-period average reads the same measure --------- */
  {
    const unpin = pinClock('2026-09-05');
    try {
      const { ctx } = await mount('2026-09');
      const H = ctx.healthSnapshot().metrics;
      eq(H.countedPeriods, 1, 'August is the one counted period behind the ring');
      near(H.monthlySavings, 5000, 'so the ring\'s "saved per month" IS the period\'s savingContribution');
      near(H.monthlySavings, ctx.savingContribution('2026-08'), 'read through the same seam, not a second assembly');
    } finally { unpin(); }
  }

  /* ---- 3. the flow card beside the ring prints the same figure ----------- */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { nodes } = await mountScore('2026-08');
      /* The flow card is appended to the view's own container (#view-score),
         so every node the stub handed out is scanned. */
      const amounts = [...nodes.values()].flatMap(n => [...textsOf(n, 'score-flow-m-amt'), ...textsOf(n, 'score-flow-amt')]);
      ok(amounts.some(t => /^R 5000\b/.test(t.trim())),
        `the flow card's saving band is R 5 000 — not R 5 200 with the euro deposit folded in (bands: ${amounts.join(' | ')})`);
      ok(!amounts.some(t => /^R 5200\b/.test(t.trim())), 'and the euro figure appears nowhere on the card');
    } finally { unpin(); }
  }

  /* ---- 4. the gate: no view assembles the pool itself -------------------- */
  {
    const SRC = path.join(__dirname, '..', 'src', 'views');
    const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = [];
    for (const f of fs.readdirSync(SRC)) {
      if (!f.endsWith('.js')) continue;
      code(fs.readFileSync(path.join(SRC, f), 'utf8')).split('\n').forEach((line, i) => {
        if (/savedFromOutside\(|saverLabels/.test(line)) hits.push(`views/${f}:${i + 1}: ${line.trim()}`);
      });
    }
    eq(hits, [], 'no view assembles the saver pool or calls savedFromOutside itself (health-data.js owns savingContribution)');
  }

  console.log(`PASS — one measure of saved: the ring and the flow card read savingContribution(p) (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
