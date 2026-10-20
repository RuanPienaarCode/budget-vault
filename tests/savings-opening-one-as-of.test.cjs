'use strict';
/* A Savings card with no starting amount names what the account held "before
   your records begin" — and that figure must be measured at ONE as-of date
   (2026-10-20 audit, M2-01).

   accountFlows() set every row the vault holds against the STATED balance:
   rows dated after `balance_updated` were subtracted from a balance that never
   contained them. So a fund confirmed in April with six debit orders since
   printed an opening short by exactly those six, and one whose records ran
   past its balance printed "its records add up to R X more than the balance"
   by the same amount — on the vault the audit ran against, three funds were
   wrong by the rows since their stated date.

   The fix is totalReturn()'s own ONE AS-OF rule (savings-math.js): the balance
   is the stated one rolled forward by reconcile() to today, the flows stop at
   today, and the card says when the figure it adds up to is not the one typed.
   The opening itself is the same at either as-of — it is a fact about the
   account's past — which is what section 1 pins.

   Pure arithmetic first, then the REAL Savings view over the real loader with
   the clock pinned. Every figure is made up.

     node tests/savings-opening-one-as-of.test.cjs */

const assert = require('assert');
const { accountFlows, splitFlows } = require('../src/savings-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const typeOf = c => (c === 'Interest' ? 'interest' : null);
const row = (date, amount, cat) => ({ date, amount, cat: cat || '' });
const TODAY = '2026-10-20';

/* ---- 1. rows after the stated date are not taken off the stated balance ---- */
{
  // Confirmed R10 000 on 30 Jun; R3 000 put in before it, R3 000 after it,
  // and R500 scheduled for next month (in no balance yet).
  const a = { balance: 10000, balance_updated: '2026-06-30' };
  const rows = [row('2026-03-01', 2000), row('2026-05-01', 1000), row('2026-07-15', 3000), row('2026-11-01', 500)];
  const f = accountFlows(a, rows, typeOf, { today: TODAY });
  near(f.opening, 7000, 'the opening is the stated balance less only the rows it already holds');
  near(f.closing, 13000, 'the closing is the balance as of today — R10 000 plus the R3 000 since');
  near(f.contributions, 6000, 'and the contributions run to the same day, the row after today held out');
  near(f.opening + f.contributions + f.growth - f.withdrawals, f.closing,
    'opening + put in + growth − taken out = the closing it names');
  eq(f.balanceBasis, 'implied', 'the card can tell the figure is not the one typed');
  eq(f.sinceStated, 1, 'and how many rows moved it');
  near(f.statedBalance, 10000, 'the typed balance travels with it');
  eq(f.asOf, TODAY, 'measured as of today');

  /* The same opening, read the other way: the stated balance against the rows
     up to the stated date. Two as-ofs, one opening. */
  near(a.balance - splitFlows(rows, typeOf, { to: a.balance_updated }).net, f.opening,
    'the opening is the same at the stated date as at today');
}

/* ---- 2. "its records add up to more" is measured the same way ---- */
{
  // Confirmed R500 on 30 Jun after R600 went in; R400 more since.
  const a = { balance: 500, balance_updated: '2026-06-30' };
  const f = accountFlows(a, [row('2026-05-01', 600), row('2026-07-10', 400)], typeOf, { today: TODAY });
  near(f.opening, -100, 'records exceed the balance by R100, not by R500');
}

/* ---- 3. nothing moved since the stated date: unchanged ---- */
{
  const a = { balance: 12084.41, balance_updated: '2026-02-01' };
  const f = accountFlows(a, [row('2026-01-03', 2000), row('2026-01-31', 84.41, 'Interest')], typeOf, { today: TODAY });
  near(f.opening, 10000, 'a clean account opens where it always did');
  near(f.closing, 12084.41, 'and closes on the typed balance');
  eq(f.balanceBasis, 'stated', 'which it says it measured on');
  eq(f.sinceStated, 0, 'with nothing since');
}

/* ---- 4. no readable balance date: today, on the typed balance ---- */
{
  const a = { balance: 5000 };
  const f = accountFlows(a, [row('2026-01-03', 2000), row('2027-01-01', 900)], typeOf, { today: TODAY });
  near(f.opening, 3000, 'a row dated after today is in no balance yet, so it is not subtracted');
  eq(f.balanceBasis, 'stated', 'and nothing is rolled forward without a date to roll from');
}

/* ---- 5. the REAL Savings card ---- */
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');

const B = 'Budget';
const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => HEAD + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Pot.md`]: '---\ntype: investment\ntx_label: "Pot"\nbalance: 10000.00\nbalance_updated: 2026-06-30\n---\n',
  [`${B}/Transactions/Pot/2026-03.md`]: tx([['2026-03-01', 'Debit order', '', 2000]]),
  [`${B}/Transactions/Pot/2026-05.md`]: tx([['2026-05-01', 'Debit order', '', 1000]]),
  [`${B}/Transactions/Pot/2026-07.md`]: tx([['2026-07-15', 'Debit order', '', 3000]]),
  [`${B}/Accounts/Over.md`]: '---\ntype: investment\ntx_label: "Over"\nbalance: 500.00\nbalance_updated: 2026-06-30\n---\n',
  [`${B}/Transactions/Over/2026-05.md`]: tx([['2026-05-01', 'Debit order', '', 600]]),
  [`${B}/Transactions/Over/2026-07.md`]: tx([['2026-07-10', 'Debit order', '', 400]]),
};
const flat = n => String(n.textContent).replace(/[\s ]+/g, ' ').trim();
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));

(async () => {
  const unpin = pinClock(TODAY);
  let nodes;
  try {
    const m = await mountFor(FILES, { period: '2026-10' });
    m.ctx.switchView = () => {};
    m.ctx.renderSavings();
    nodes = m.nodes;
  } finally { unpin(); }
  const card = name => flat(descend(nodes.get('#savingsSections')).find(n => hasCls(n, 'mini')
    && String(n.children[0] && n.children[0].textContent) === name));

  const pot = card('Pot');
  ok(/put in R 6 000/.test(pot), `the card states what the records put in up to today (got "${pot}")`);
  ok(/R 7 000 before your records begin/.test(pot), `and the opening at one as-of: R 7 000, not R 4 000 (got "${pot}")`);
  ok(!/R 4 000 before your records begin/.test(pot), 'the rows since the stated date are no longer taken off it');
  ok(/these add up to R 13 000 — your Jun 30 balance plus 1 transaction since/.test(pot),
    `and it names the balance those add up to, since it is not the one typed (got "${pot}")`);

  const over = card('Over');
  ok(/its records add up to R 100 more than the balance/.test(over), `R 100, not R 500 (got "${over}")`);

  console.log(`PASS savings-opening-one-as-of (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
