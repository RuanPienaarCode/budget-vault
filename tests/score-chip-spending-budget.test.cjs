'use strict';
/* The Score's "Against the budget" chip prints, under "Spending budget", the
   spending budget — so the three figures it prints together divide the way a
   reader divides them (2026-10-07 audit, L2a-02; a 1.49.0 regression).

   1.49.0 relabelled the chip's first row from "Budgeted" to "Spending budget"
   (the 29 Sep 2026 decision: "budget" alone names the whole plan, a spend-only
   figure says "spending budget") but left the figure beside it as the WHOLE
   plan, spend envelopes plus set-aside. "Budget used this period" and "Left in
   the spending budget" on the same card were already measured on the spend
   envelopes alone (ADR-0005), so on the audited vault the printed Spent ÷ the
   printed "Spending budget" came out five points below the printed "Budget
   used" beside them. On this fixture it is 69% against 78%.

   Now: the whole plan sits beside "Share of income budgeted", the one figure
   it is the numerator of, under the Budget page's own name for it ("Total
   budgeted"); the spending budget sits beside Spent and Budget used. Each
   percentage is the quotient of the two figures printed above it.

   Rendered through the REAL views over the committed synthetic household, clock
   pinned. Every figure is read off the page, then divided the way a reader
   would.

     node tests/score-chip-spending-budget.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const { SEED, PERIOD, TODAY } = require('./figures/household.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? e.textContent : '');
/* The chip titled `title`, as [label, value, data-fig] rows in screen order. */
function chipRows(root, title) {
  const chip = descend(root).filter(e => hasCls(e, 'score-flow-chip'))
    .find(c => textOf(c.children.find(k => hasCls(k, 'l'))) === title);
  assert.ok(chip, `the "${title}" chip rendered`);
  return chip.children.filter(k => hasCls(k, 'score-flow-row'))
    .map(r => [textOf(r.children[0]), textOf(r.children[1]), r.children[1].getAttribute('data-fig')]);
}
/* What a reader does with the printed text: "R 15 500" -> 15500, "78%" -> 78. */
const num = t => Number(String(t).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(SEED, { period: PERIOD });
    ctx.renderScore();
    const cur = ctx.currentPeriod();
    const bud = ctx.budgetTotals(cur);
    const used = ctx.budgetUsed(cur);
    ok(bud.spend === 15500 && bud.setAside === 2000, `fixture check: spend envelopes 15 500, set-aside 2 000 (got ${bud.spend} / ${bud.setAside})`);
    ok(Math.abs(used.spent - 12100) < 1e-9, 'fixture check: the one numerator is 12 100');

    const rows = chipRows(nodes.get('#view-score'), i18n.t('score.flow.chip.budget'));
    const row = label => rows.find(r => r[0] === label);
    const spendingBudget = row(i18n.t('score.flow.chip.budgeted'));
    const spent = row(i18n.t('score.flow.chip.spent'));
    const usedRow = row(i18n.t('score.flow.chip.budgetUsed'));
    const whole = row(i18n.t('bud.total.budgeted'));
    const share = row(i18n.t('score.flow.chip.allocatedOfIncome'));

    /* ---- 1. the spending budget is what "Spending budget" prints -------- */
    eq(spendingBudget[1], ctx.money(bud.spend, 0), 'Spending budget prints the spend envelopes (R 15 500), not the whole plan');
    eq(spendingBudget[2], 'score-budgeted', 'and keeps its data-fig, so the reconciliation still addresses it by name');
    const q = num(spent[1]) / num(spendingBudget[1]) * 100;
    ok(Math.abs(q - num(usedRow[1])) <= 0.5,
      `printed Spent ÷ printed Spending budget = printed Budget used (${spent[1]} ÷ ${spendingBudget[1]} = ${q.toFixed(1)}% beside ${usedRow[1]})`);

    /* ---- 2. the whole plan is beside the share it divides into ---------- */
    ok(!!whole, 'the whole plan is still on the chip');
    eq(whole[1], ctx.money(bud.spend + bud.setAside, 0), 'under "Total budgeted": spend envelopes plus set-aside (R 17 500)');
    eq(whole[2], 'score-whole-plan', 'with a data-fig of its own');
    eq(rows.indexOf(share), rows.indexOf(whole) + 1, '"Share of income budgeted" sits directly under the whole plan it is the share of');
    const shareQ = num(whole[1]) / num(ctx.money(bud.income, 0)) * 100;
    ok(Math.abs(shareQ - num(share[1])) <= 0.5,
      `printed Total budgeted ÷ planned income = printed share (${whole[1]} ÷ ${ctx.money(bud.income, 0)} = ${shareQ.toFixed(1)}% beside ${share[1]})`);
    eq([rows.indexOf(spent), rows.indexOf(usedRow)], [rows.indexOf(spendingBudget) + 1, rows.indexOf(spendingBudget) + 2],
      'Spending budget, Spent and Budget used read in that order, one under the other');

    /* ---- 3. negative control: the pre-fix pairing fails the reader's check */
    const stale = num(spent[1]) / num(whole[1]) * 100;
    ok(Math.abs(stale - num(usedRow[1])) > 5,
      `negative control: Spent ÷ the whole plan (${stale.toFixed(1)}%) is NOT the printed ${usedRow[1]} — the check above can fail`);

    console.log(`PASS score-chip-spending-budget (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
