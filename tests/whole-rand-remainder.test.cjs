'use strict';
/* Whole-rand printing (1.51.0) made three remainders say something their own
   cards did not (2026-10-14 audit, L2a-N07).

     A  A spend R0,30 over its spending budget printed "0" under the label
        "Over the spending budget": the label claims a breach, the figure
        states none. Same on the Budget page: "Over-budgeted R 0".
     B  A spend of R400,50 against R1 000: the true remainder 599,50 rounded
        on its own to 600, beside "R 401 spent of R 1 000" — and 401 + 600 is
        not 1 000. Three numbers on one card that do not add.

   The rule: the big remainder is the difference of the two figures printed
   beside it; and a real remainder that would round to nothing is printed to
   the cent (the boundary rule sharePercentLabel already applies to 0% / 100%).

   Synthetic households throughout; every figure is typed into the fixture.

     node tests/whole-rand-remainder.test.cjs */
const assert = require('assert');
const { B, tx, account, textOf, renderDash, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const { printedRemainder, remainderDecimals } = require('../src/figures');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the pure helpers ---- */
eq(printedRemainder(1000, 1000.30), { value: -0.3, decimals: 2 }, 'R0,30 over prints to the cent, signed');
eq(printedRemainder(1000, 999.70), { value: 0.3, decimals: 2 }, 'R0,30 left prints to the cent');
eq(printedRemainder(1000, 400.50), { value: 599, decimals: 0 }, 'the difference of the PRINTED parts: 1000 - 401');
eq(printedRemainder(1000, 1000), { value: 0, decimals: 0 }, 'exactly on the line is a clean zero');
eq(printedRemainder(1000, 1000 + 1e-12), { value: 0, decimals: 0 }, 'float dust is not a breach');
eq(printedRemainder(1000, 1500), { value: -500, decimals: 0 }, 'an ordinary overspend is whole units');
eq(printedRemainder(1000.4, 1000.6), { value: -1, decimals: 0 }, 'parts that round apart keep their sign (never flips)');
eq(remainderDecimals(0.3), 2, 'a real remainder that rounds to R0 keeps its cents');
eq(remainderDecimals(-0.3), 2, '... over or under');
eq(remainderDecimals(0.49), 2, '49c is still a real remainder');
eq(remainderDecimals(0.5), 0, 'a half rounds UP to R1 the way formatAmount prints it, so it needs no cents');
eq(remainderDecimals(0), 0, 'nothing is nothing');
eq(remainderDecimals(1e-12), 0, 'dust is nothing');
eq(remainderDecimals(1234.5), 0, 'a large remainder is whole units');

/* ---- the rendered cards ---- */
const vault = ({ income, food, spent }) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: food\n---\n',
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-09-30' }),
  [`${B}/Budgets/2026-10.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + `| Salary | income | ${income.toFixed(2)} |  |\n| Food | food | ${food.toFixed(2)} |  |\n`,
  [`${B}/Transactions/Cheque/2026-10.md`]: tx([['2026-10-01', 'Pay', 'Salary', income], ['2026-10-05', 'Shop', 'Food', -spent]]),
});
const num = s => Number(String(s).replace(/[\s ]/g, '').replace(',', '.'));

async function hero(files) {
  const d = await renderDash(files, { today: '2026-10-31', period: '2026-10' });
  const text = d.t('#heroCard');
  const big = /(Over the spending budget|Spending budget remaining) this period ([\d\s ,]+?) R /.exec(text);
  const sub = /R ([\d\s ,]+?) spent of R ([\d\s ,]+?) spending budget/.exec(text);
  assert.ok(big && sub, `the hero's remainder and sub-line were found — got: ${text}`);
  return { label: big[1], big: big[2].trim(), spent: sub[1].trim(), budget: sub[2].trim(), text };
}

async function budgetTiles(files) {
  const unpin = pinClock('2026-10-31');
  try {
    const M = await mountFor(files, { period: '2026-10' });
    M.ctx.switchView = () => {};
    M.ctx.renderBudgets();
    return textOf(M.nodes.get('#budTotalsTop'));
  } finally { unpin(); }
}

(async () => {
  /* A. R0,30 over a whole-rand budget. */
  {
    const h = await hero(vault({ income: 2000, food: 1000, spent: 1000.30 }));
    eq(h.label, 'Over the spending budget', 'A: the hero says it is over');
    eq(h.big, '0,30', `A: and says by how much, to the cent — got: ${h.text}`);
  }
  /* B. The parts of the card add up. */
  {
    const h = await hero(vault({ income: 2000, food: 1000, spent: 400.50 }));
    eq(h.label, 'Spending budget remaining', 'B: under budget');
    eq(num(h.big) + num(h.spent), num(h.budget),
      `B: ${h.big} left + ${h.spent} spent = ${h.budget} budget, as printed`);
  }
  /* Control: ordinary whole-unit figures are untouched. */
  {
    const h = await hero(vault({ income: 2000, food: 1000, spent: 400 }));
    eq(h.big, '600', 'control: R400 spent of R1 000 leaves R 600, no cents');
    const o = await hero(vault({ income: 2000, food: 1000, spent: 1500 }));
    eq([o.label, o.big], ['Over the spending budget', '500'], 'control: a real overspend is whole units');
  }
  /* C. The Budget page: plan exceeds planned income by 30c. Since the
     2026-10-20 audit (D2-01) the tile is the difference of the Income and
     Budgeted tiles AS PRINTED (printedRemainder, the hero's rule), so the
     cents case is the one where both tiles print the same whole figure —
     R 1 000 and R 1 000 — and the true remainder is still 30c. */
  {
    const t = await budgetTiles(vault({ income: 1000.10, food: 1000.40, spent: 10 }));
    ok(/Over-budgeted R 0,30 /.test(t), `C: the over-budgeted tile states R 0,30, not R 0 — got: ${t}`);
    const left = await budgetTiles(vault({ income: 1000.40, food: 1000.10, spent: 10 }));
    ok(/Left to budget R 0,30 /.test(left), `C: and the mirror, left to budget — got: ${left}`);
    /* And where the two tiles print different whole figures, the tile is
       their difference: R 1 000 planned against R 1 001 budgeted is R 1 over,
       not the R 0,30 a reader cannot find on the strip. */
    const apart = await budgetTiles(vault({ income: 1000.20, food: 1000.50, spent: 10 }));
    ok(/Planned income R 1 000 .*Total budgeted R 1 001 .*Over-budgeted R 1 /.test(apart),
      `D2-01: the tile is the printed income less the printed plan — got: ${apart}`);
    const clean = await budgetTiles(vault({ income: 2000, food: 1500, spent: 10 }));
    ok(/Left to budget R 500 /.test(clean), `control: a whole-unit remainder has no cents — got: ${clean}`);
  }

  console.log(`PASS whole-rand-remainder — the hero's remainder is the difference of its printed parts, and a real remainder that rounds to R0 is printed to the cent on the hero and the Budget page (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
