'use strict';
/* "Held in other currencies" names ONE amount for one account, and the basis
   when the two readings differ (audit 2026-10-14, L8-05).

   A foreign account has two honest balances: the one the reader typed (stated)
   and that balance rolled forward through the transactions since (implied).
   The Accounts hero sentence printed the stated one and Savings and the Score
   the implied one, so the same dollar account read "$ 1 000" on one page and
   "$ 1 500" on the next with nothing to say why. currency.js's otherHoldings()
   is now the one place the amount is picked; each page prints its own headline's
   basis and, only when the other reading is a different figure, names it.

   Pinned: the helper itself; then the REAL Accounts, Savings and Score views
   over the committed household (a dollar account with a deposit dated after its
   typed balance, and one without). Its negative control is the audit's own
   1.52.0 tree: the two assertions per page that name both amounts fail there.

     node tests/other-currencies-one-basis.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, leaves, ownText } = require('./helpers/figures.cjs');
const { SEED, PERIOD, TODAY, B } = require('./figures/household.cjs');
const { otherHoldings } = require('../src/currency');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. the helper ------------------------------------------------------ */
{
  const typed = [['$', 1000], ['€', 0]], rolled = [['$', 1500], ['€', 0]];
  const imp = otherHoldings(typed, rolled, 'implied');
  eq(imp.shown, rolled, 'implied: the rolled-forward amount is the one printed');
  eq(imp.other, [['$', 1000], ['€', 0]], 'and the typed one rides along over the same symbols');
  ok(imp.differs && imp.basis === 'implied' && imp.otherBasis === 'stated', 'it differs, and names the basis shown');
  const st = otherHoldings(typed, rolled, 'stated');
  eq(st.shown, typed, 'stated: the typed amount is the one printed');
  ok(st.differs && st.basis === 'stated', 'and the same helper says it differs');
  ok(!otherHoldings(typed, typed.map(([s, v]) => [s, v + 0.001]), 'stated').differs, 'under a cent is not a difference');
  /* A fold (the Savings/Score merge with assets and debts) is applied to BOTH readings. */
  const fold = list => list.map(([s, v]) => [s, v + 10]);
  eq(otherHoldings(typed, rolled, 'implied', fold).other, [['$', 1010], ['€', 10]], 'the fold is applied to both readings');
  /* A symbol only one reading holds is listed, with 0 on the other. */
  eq(otherHoldings([], [['$', 500]], 'implied').other, [['$', 0]], 'a symbol the other reading lacks reads 0 there, not missing');
}

/* ---- 2. the three pages ------------------------------------------------- */
const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const sentences = (nodes, sel) => {
  const r = nodes.get(sel);
  const t = r ? [...leaves(r)].map(l => ownText(l)).join(' ').replace(/\s+/g, ' ') : '';
  return t.match(/Plus [^.]*held in other currencies, not converted\.[^.]*\./) || t.match(/Plus [^.]*held in other currencies, not converted\./) || [''];
};

async function pages(files) {
  const unpin = pinClock(TODAY);
  try {
    const out = {};
    for (const [view, sel] of [['renderAccounts', '#acctSummary'], ['renderSavings', '#savingsKpis'], ['renderScore', '#scoreWork']]) {
      const { ctx, nodes } = await mountFor(files, { period: PERIOD });
      ctx.switchView = () => {};
      ctx[view]();
      out[view] = { text: sentences(nodes, sel)[0], ctx };
    }
    return out;
  } finally { unpin(); }
}

(async () => {
  /* Dollar savings: typed $1 000 on 1 Sep, and a $500 deposit dated 2 Sep. */
  const withDeposit = { ...SEED, [`${B}/Transactions/Dollar savings/2026-09.md`]: HEAD + '| 2026-09-02 | Invoice | Salary | 500.00 |  |  |  |\n' };
  const p = await pages(withDeposit);
  const money = p.renderAccounts.ctx.moneyIn;
  const typed = money('$', 1000, 0), rolled = money('$', 1500, 0);
  /* Accounts prints the rolled-forward amount since its headline went
     implied (discussion #124) — all three pages on one basis now, and the
     typed figure named beside it, exactly as Savings and the Score do. */
  ok(p.renderAccounts.text.includes(`Plus ${rolled} held in other currencies`),
    `Accounts prints the rolled-forward amount, like its headline (got "${p.renderAccounts.text}")`);
  ok(p.renderAccounts.text.includes(typed), `and names the typed one beside it (got "${p.renderAccounts.text}")`);
  ok(p.renderSavings.text.includes(`Plus ${rolled} held in other currencies`),
    `Savings prints the rolled-forward amount (got "${p.renderSavings.text}")`);
  ok(p.renderSavings.text.includes(typed), `and names the typed one (got "${p.renderSavings.text}")`);
  ok(p.renderScore.text.includes(`Plus ${rolled} held in other currencies`),
    `the Score prints the rolled-forward amount (got "${p.renderScore.text}")`);
  ok(p.renderScore.text.includes(typed), `and names the typed one (got "${p.renderScore.text}")`);
  for (const k of ['acct.hero.otherAsStated', 'acct.hero.otherAsImplied']) { ok(i18n.t(k) !== k, `${k} is keyed`); }

  /* No deposit: the two readings agree, and nothing is added. */
  const quiet = await pages(SEED);
  for (const [view, v] of Object.entries(quiet)) {
    ok(/held in other currencies/.test(v.text), `${view}: the foreign balance is still named`);
    ok(v.text.includes(money('$', 1000, 0)), `${view}: as $ 1 000 on every page (got "${v.text}")`);
    ok(!/as typed|counting the transactions|That counts/.test(v.text), `${view}: and no basis note where the readings agree (got "${v.text}")`);
  }

  console.log(`PASS other-currencies-one-basis (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
