'use strict';
/* The Debt page, read the way a South African household reads it.

   The 20 Oct 2026 audit (lanes D1, D2, M2) found the page printing its
   figures by three rules at once. The Rate % field in the table showed
   "22,25" — the household's own decimal comma — while the attack order two
   cards up read "22.25% · R 17 000" and the debt-to-income line "13.9%",
   both through a bare toFixed. A share of payments that rounds to nothing
   printed "0%" over an interest figure that is not nothing. The "Paying per
   month" tile was in cents and its own "a year" line in whole rand; the
   Interest still to pay column was whole rand inside a table of cents. The
   planner said "/mo" where every other sentence on the page says "a month",
   and the schedule note quoted its start date as a raw "2024-03-01" in the
   middle of a sentence.

   Each block below is one finding, mounted through the REAL loader and the
   REAL view with the REAL formatter and the ZA locale (tests/helpers/
   figures.cjs mountFor), on a synthetic household — every figure here is
   made up.

     node tests/debts-printed-figures.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const B = 'Budget';
const TODAY = '2026-10-20';
const PERIOD = '2026-10';
const DEBT_HEAD = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n';
const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';

function household(debtRows) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 5000.00\nbalance_updated: 2026-10-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Transactions/Cheque/2026-10.md`]: `${TX_HEAD}| 2026-10-01 | Employer | Salary | 28000.00 |  |  |  |\n`,
    [`${B}/Debts.md`]: DEBT_HEAD + debtRows.join('\n') + '\n',
  };
}

/* A card behind its schedule (so the implied-balance note shows), and a
   vehicle loan. Both rated, both clearing. */
const ORDINARY = [
  '| Card | Bank A | credit card | 17000.00 | 20000.00 | 22.25 | 400.00 | 0.00 | 2024-03-01 | | active | |',
  '| Vehicle | Bank B | vehicle | 150000.00 | 200000.00 | 11.25 | 3500.00 | 0.00 | 2023-01-15 | | active | |',
];

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));
const tiles = nodes => {
  const out = new Map();
  for (const t of byClass(nodes.get('#debtKpis'), 'mini')) {
    out.set(byClass(t, 'l')[0].textContent, {
      v: byClass(t, 'v')[0].textContent, s: (byClass(t, 's')[0] || { textContent: '' }).textContent,
    });
  }
  return out;
};

async function render(rows, { extra = '' } = {}) {
  const M = await mountFor(household(rows), { period: PERIOD, budgetFolder: B });
  M.ctx.$('#debtExtra').value = extra;
  M.ctx.$('#debtStrategy').value = 'avalanche';
  M.ctx.renderDebts();
  return M;
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* ---- D2-07 / D1-06 / M2-09: decimals in the household's own mark ----
       The table's Rate % input already showed "22,25"; the attack order, the
       debt-to-income ratio and the schedule note printed a full stop. */
    {
      const { nodes } = await render(ORDINARY);
      const order = byClass(nodes.get('#debtOrder'), 'do-m').map(n => n.textContent);
      ok(order.some(t => t.startsWith('22,25% · ')),
        `the attack order prints the card's rate with the decimal comma — got ${JSON.stringify(order)}`);
      ok(order.some(t => t.startsWith('11,25% · ')), 'and the vehicle loan\'s the same way');
      ok(order.every(t => !/\d\.\d/.test(t)), `no full-stop decimal anywhere in the attack order — got ${JSON.stringify(order)}`);

      const dti = byClass(nodes.get('#debtPayments'), 'debt-dti')[0];
      const ratio = descend(dti).find(n => n.tagName === 'B').textContent;
      // 3 900 of 28 000 is 13.928…%: one decimal, in the household's mark.
      eq(ratio, '13,9%', 'the debt-to-income ratio prints its decimal comma');

      const chip = byClass(nodes.get('#debtTable'), 'caveat-chip-detail')
        .map(n => n.textContent).find(t => t.startsWith('From R 20 000,00'));
      ok(chip, 'the card\'s implied-balance note is drawn (the fixture is behind its schedule)');
      ok(/ at 22,25% paying /.test(chip), `the schedule note quotes the rate with the decimal comma — got "${chip}"`);

      /* ---- D2-11: a date inside a sentence reads as a date ----
         The same note said "since 2024-03-01" — a table's ISO form in prose.
         ctx.dateText names the day, and the year because it is not this one. */
      ok(/ since Mar 1, 2024, /.test(chip), `the schedule note names its start date in words — got "${chip}"`);
      ok(!/\d{4}-\d{2}-\d{2}/.test(chip), 'no ISO date left in the sentence');
    }

    /* ---- D2-03: "Paying per month" and its own "a year" line agree on cents ---- */
    {
      const { nodes } = await render(ORDINARY);
      const paying = tiles(nodes).get('Paying per month');
      eq(paying.v, 'R 3 900,00', 'sanity: the tile itself prints cents');
      eq(paying.s, 'R 46 800,00 a year', 'and its "a year" line prints cents too, not "R 46 800"');
    }

    /* ---- D2-18 / D1-13: the Interest still to pay column is a table of cents ---- */
    {
      const { nodes } = await render(ORDINARY);
      const tbody = descend(nodes.get('#debtTable')).find(n => n.tagName === 'TBODY');
      const interestCells = tbody.children.map(tr => tr.children[8].textContent);
      eq(interestCells.length, 2, 'one Interest still to pay cell per debt');
      for (const t of interestCells) {
        ok(/^R [\d ]+,\d{2}$/.test(t), `an Interest still to pay cell prints cents, like Balance and Payment beside it — got "${t}"`);
      }
    }

    /* ---- D2-26: one per-unit form, " a month" ----
       The planner card and the not-clearing row said "/mo" while the attack
       order on the same page says "R 500 extra a month". */
    {
      const { nodes } = await render(ORDINARY, { extra: '500' });
      const plan = nodes.get('#debtPlan').textContent;
      ok(!/\/mo\b/.test(plan), `the planner card never says "/mo" — got "${plan}"`);
      ok(/with R 500 extra a month/.test(plan), 'the projected line reads "with R 500 extra a month"');
      ok(/includes your R 500 extra a month/.test(plan), 'the plan card\'s source line reads the same way');
      ok(/R 500 extra a month/.test(nodes.get('#debtOrder').textContent),
        'and agrees with the attack order\'s own wording');

      // R10 000 at 30% accrues R250 a month against a R100 payment: it does not clear.
      const stalled = await render(['| Store | Shop | store account | 10000.00 | 10000.00 | 30.00 | 100.00 | 0.00 | 2026-09-01 | | active | |']);
      const tbody = descend(stalled.nodes.get('#debtTable')).find(n => n.tagName === 'TBODY');
      const cell = tbody.children[0].children[8].textContent;
      eq(cell, '+R 250,00 a month', 'a debt that is not clearing says what it grows by "a month", in cents');
    }

    /* ---- D2-09: a share of payments that rounds to nothing is not "0%" ----
       R10 000 at 0.1% accrues R0,83 a month against a R1 000 payment: 0.083%
       of the payments. Math.round printed "0% of your payments" under a
       "R 0,83" interest figure; sharePercentLabel takes the fewest decimals
       that leave the boundary, here one. */
    {
      const { nodes } = await render(['| Family | Family | personal loan | 10000.00 | 10000.00 | 0.10 | 1000.00 | 0.00 | 2026-09-01 | | active | |']);
      const interest = tiles(nodes).get('Interest this month');
      eq(interest.v, 'R 0,83', 'sanity: the interest tile is not zero');
      eq(interest.s, '0,1% of your payments', 'its share of the payments is not printed as 0%');
      // An ordinary share is still a whole percent: 1 721,46 of 3 900 is 44%.
      eq(tiles((await render(ORDINARY)).nodes).get('Interest this month').s, '44% of your payments',
        'away from the boundaries the share stays a whole percent');
    }
  } finally {
    unpin();
  }
  console.log(`PASS debts-printed-figures — rates and ratios in the household's decimal mark, cents in the table and beside cents, one per-unit form, a date in words, and no "0%" over real interest (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
