'use strict';
/* The sentence under "Not yet spent" adds up to its band, every part named
   (2026-10-20 audit, M1-07).

   score.js promised it ("the parts named here are the parts of the chip's
   Together"), and it did not keep the promise twice over.

   1. Income still to come was left out. The chip below names it ("Income still
      to come −R 640") and Together counts it, but the caption under the band
      did not: on the audited vault the caption added up to more than the band
      by exactly the income still to come.
   2. An assume-spent category. The band is income less what really went out;
      Together also takes off the assume-spent provision, money the budget
      counts as spent that has not left yet (money-flow.js periodFlow). On the
      committed household the band read R 16 400 and its caption and Together
      R 15 900, with nothing on screen naming the R 500 between them.

   The rule now: band = Together + the assume-spent provision, printed or raw.
   The caption names every part the band holds, the provision included, and
   the lefts chip names the provision where Together and the band differ.
   Printed figures obey it too: the band's printed rand is DERIVED from the
   printed parts, and the three spent bands are allocated around it so the
   four still add to the printed income.

   Pure periodFlow() first, then the REAL Score over the committed household
   (clock pinned) in three shapes: as committed, with planned income still to
   come, and with that plus a plan that claims more than its income (the
   audited vault's shape, in made-up figures).

     node tests/score-flow-caption-adds-up.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend, readable } = require('./helpers/dom-stub.cjs');
const { SEED, PERIOD, TODAY, B } = require('./figures/household.cjs');
const { periodFlow } = require('../src/money-flow');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-6, `${m} (got ${a}, want ${b})`); checks++; };

/* ---- 1. pure: band = Together + provision, raw and printed --------------- */
{
  const catType = c => ({ Rent: 'housing', Groceries: 'expense', Saver: 'savings' }[c] || null);
  let n = 0, surplus = 0;
  for (const income of [0, 15000.4, 33310.27]) for (const spentTotal of [0, 1873.69, 12000.5, 41234.56])
    for (const setAsideSpent of [0, 1600.35]) for (const assumedSpent of [0, 499.5, 750.25])
      for (const budgetIncome of [0, 33650.8]) for (const budgetSetAside of [0, 2950.4]) {
        if (setAsideSpent > spentTotal) continue;   // set-aside is a slice of gross spend (ledger.js tally)
        const rent = Math.min(9000.25, spentTotal - setAsideSpent);
        const f = periodFlow({
          income, spentTotal, setAsideSpent, assumedSpent, budgeted: 28410.3, budgetSetAside,
          grossOutByCat: { Rent: rent, Groceries: spentTotal - setAsideSpent - rent, Saver: setAsideSpent },
          fixedCats: new Set(['Rent']), catType, savingContribution: 0, debts: [],
          budgetIncome, periodFinished: false,
        });
        const L = f.lefts, D = L.display, bd = f.bands.display;
        n++;
        near(L.alreadySpent, assumedSpent, 'the provision is named on the lefts');
        /* No band to caption: no income, an Overspent row in its place, or
           nothing paid out yet (score.js buildFlowCard draws one sentence then,
           not the bands). */
        if (!(income > 0) || f.overspent > 0.005 || spentTotal <= 0.005) continue;
        surplus++;
        const tag = `(in ${income}, out ${spentTotal}, set-aside ${setAsideSpent}, provision ${assumedSpent}, plan income ${budgetIncome})`;
        near(f.bands.notYetSpent, L.together + L.alreadySpent, `raw: Not yet spent = Together + provision ${tag}`);
        eq(bd.notYetSpent, D.together + D.alreadySpent, `printed: Not yet spent = printed Together + printed provision ${tag}`);
        eq(D.leftInBudget + D.setAsideToMove + D.neverBudgeted + D.incomeToCome, D.together, `printed: the lefts still add to Together ${tag}`);
        eq(bd.committed + bd.living + bd.saving + bd.notYetSpent, Math.round(income), `printed: the four bands still add to the printed income ${tag}`);
        for (const k of ['committed', 'living', 'saving']) {
          ok(Number.isInteger(bd[k]) && bd[k] >= 0, `printed ${k} is a whole, non-negative rand ${tag}`);
          ok(Math.abs(bd[k] - f.bands[k]) <= 2, `printed ${k} stays within two rand of the raw band ${tag}`);
          if (f.bands[k] < 0.005) eq(bd[k], 0, `a band that is nothing prints nothing ${tag}`);
        }
      }
  ok(n > 100 && surplus > 40, `the grid ran (${n} cases, ${surplus} with a Not-yet-spent band)`);
}

/* ---- 2. on screen -------------------------------------------------------- */
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? readable(e.textContent) : '');
const money = v => `R ${Math.abs(v).toLocaleString('en-US').replace(/,/g, ' ')}`;
const amountOf = t => Number(String(t).replace(/[^\d]/g, ''));
const rowOf = (root, name) => descend(root).filter(e => hasCls(e, 'score-flow-m-row'))
  .find(r => textOf(descend(r).find(e => hasCls(e, 'score-flow-m-name'))) === name);
const chips = root => descend(root).filter(e => hasCls(e, 'score-flow-chip'))
  .map(c => ({
    rows: c.children.filter(k => hasCls(k, 'score-flow-row')).map(r => [textOf(r.children[0]), textOf(r.children[1])]),
    note: textOf(c.children.find(k => hasCls(k, 's'))),
  }));

async function render(files) {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(files, { period: PERIOD });
    ctx.switchView = () => {};
    ctx.renderScore();
    return nodes.get('#view-score');
  } finally { unpin(); }
}

/* The household's own figures, by hand: 30 000 landed, 13 600 went out (rent
   9 000, groceries 2 400, gym 200, the 2 000 investment order), spending
   envelopes 15 500 with a 500 assume-spent envelope (Carry) nothing has been
   paid against yet, 2 000 set aside and all of it sent. So Not yet spent is
   30 000 − 13 600 = 16 400, and of it 15 500 − (11 600 + 500) = 3 400 is still
   inside the spending budget and 500 is Carry's.

   `clauses` is the caption, clause by clause, as [key, params]; `signed` is
   each printed figure with the sign its words give it. */
async function check(label, files, clauses, signed) {
  const root = await render(files);
  const row = rowOf(root, i18n.t('score.flow.notYetSpent'));
  ok(!!row, `${label}: the Not yet spent row is drawn`);
  const band = amountOf(textOf(descend(row).find(e => hasCls(e, 'score-flow-m-amt'))));
  const caption = textOf(descend(row).find(e => hasCls(e, 'score-flow-m-sub')));
  eq(caption, clauses.map(([key, params]) => i18n.t(key, params)).join(' · '), `${label}: the caption names every part`);
  const sum = signed.reduce((s, v) => s + v, 0);
  eq(sum, band, `${label}: and its parts add up to the band as printed (${signed.join(' + ')} = ${band})`);
  /* The desktop Sankey draws the same caption a line per part: one SVG text
     run cannot wrap, and the parts named last are the ones that make it add
     up. Each line within the ~80 characters the 11px caption column holds, and
     inside the viewBox. */
  const svg = descend(root).find(e => hasCls(e, 'score-flow-sankey'));
  const vbH = Number(svg.getAttribute('viewBox').split(/\s+/)[3]);
  const texts = descend(svg).filter(e => e.tagName === 'TEXT' || e.tagName === 'text');
  const nameAt = texts.findIndex(e => hasCls(e, 'score-flow-name') && textOf(e) === i18n.t('score.flow.notYetSpent'));
  const lines = texts.slice(nameAt + 1).filter(e => hasCls(e, 'score-flow-caption')).map(e => ({ t: textOf(e), y: Number(e.getAttribute('y')) }));
  eq(lines.map(l => l.t).join(' · '), caption, `${label}: the Sankey prints the same parts, a line each`);
  eq(lines.length, clauses.length, `${label}: one line per part`);
  for (const l of lines) {
    ok(l.t.length <= 80, `${label}: "${l.t}" fits the caption column (${l.t.length} characters)`);
    ok(l.y <= vbH, `${label}: and is drawn inside the ${vbH}-unit plot (y=${l.y})`);
  }
  const lefts = chips(root).find(c => c.rows.some(r => r[0] === i18n.t('score.flow.chip.together')));
  const together = amountOf(lefts.rows.find(r => r[0] === i18n.t('score.flow.chip.together'))[1]);
  return { band, together, note: lefts.note };
}

const salaryPlan = (files, amount) => {
  const k = `${B}/Budgets/${PERIOD}.md`;
  const out = { ...files, [k]: files[k].replace('| Salary | income | 30000.00 |', `| Salary | income | ${amount.toFixed(2)} |`) };
  ok(out[k] !== files[k], 'fixture check: the planned salary was rewritten');
  return out;
};

(async () => {
  for (const k of ['score.flow.sub.incomeToCome', 'score.flow.sub.incomeAbovePlan', 'score.flow.sub.alreadySpent',
    'score.flow.sub.setAsideOver', 'score.flow.chip.alreadySpentNote']) ok(i18n.t(k) !== k, `en.js carries ${k}`);

  /* 2a. As committed: the provision is the part the caption and Together missed. */
  {
    const r = await check('committed household', SEED, [
      ['score.flow.sub.notYetSpent', { inBudget: money(3400), neverBudgeted: money(12500) }],
      ['score.flow.sub.alreadySpent', { amount: money(500) }],
    ], [3400, 12500, 500]);
    eq(r.band, 16400, 'the band is income less what went out, 30 000 − 13 600');
    eq(r.together, 15900, 'Together takes the provision off as well');
    eq(r.note, i18n.t('score.flow.chip.alreadySpentNote', { amount: money(500) }),
      'and the lefts chip names the 500 between Together and the band');
  }

  /* 2b. Planned income still to come: the plan says 30 640, 30 000 has landed. */
  {
    const r = await check('income still to come', salaryPlan(SEED, 30640), [
      ['score.flow.sub.notYetSpent', { inBudget: money(3400), neverBudgeted: money(13140) }],
      ['score.flow.sub.incomeToCome', { amount: money(640) }],
      ['score.flow.sub.alreadySpent', { amount: money(500) }],
    ], [3400, 13140, -640, 500]);
    eq(r.band, 16400, 'the band does not move with the plan');
  }

  /* 2c. The audited vault's shape: over-allocated, set-aside still to move,
     income still to come and an assume-spent envelope, all at once. */
  {
    const k = `${B}/Budgets/${PERIOD}.md`;
    const big = { ...SEED, [k]: SEED[k].replace('| Investing | investment | 2000.00 |', '| Investing | investment | 20000.00 |') };
    ok(big[k] !== SEED[k], 'fixture check: the investment envelope was rewritten');
    await check('over-allocated, set aside, to come', salaryPlan(big, 30640), [
      ['score.flow.sub.overAllocated', { inBudget: money(3400), beyond: money(4860) }],
      ['score.flow.sub.setAsideToMove', { amount: money(18000) }],
      ['score.flow.sub.incomeToCome', { amount: money(640) }],
      ['score.flow.sub.alreadySpent', { amount: money(500) }],
    ], [3400, -4860, 18000, -640, 500]);
  }

  /* 2d. More arrived than the plan said, and no assume-spent envelope. */
  {
    const files = salaryPlan(SEED, 29000);
    const k = `${B}/Budgets/${PERIOD}.md`;
    files[k] = files[k].replace('| Carry | expense | 500.00 |  |\n', '');
    const r = await check('income above the plan', files, [
      ['score.flow.sub.notYetSpent', { inBudget: money(3400), neverBudgeted: money(12000) }],
      ['score.flow.sub.incomeAbovePlan', { amount: money(1000) }],
    ], [3400, 12000, 1000]);
    eq(r.together, r.band, 'with no provision, Together and the band are one figure');
    eq(r.note, '', 'and the chip carries no note about a provision that is not there');
  }

  console.log(`PASS score-flow-caption-adds-up (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
