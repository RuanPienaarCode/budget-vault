'use strict';
/* The Score's "Where the money went" card tells ONE story about the income, and
   its "budgeted beyond income" agrees with the Budget page's (audit
   2026-10-14, L2a-N01 and L2a-N02).

   N02. Saving was one reading of "saved" (arrivals in a savings account, paired
   within the period) while the set-aside cut out of Living was another (rows
   under a savings or investment category). An investment debit order to an
   account the vault does not hold was in NO band; a car repair paired into a car
   fund was in Living AND Saving. On the vault this was found on, the bands and
   the Overspent row stopped adding to income in 17 of 21 periods. The rule now:
   every rand of gross spend lands in exactly one band — set-aside (Saving), else
   fixed (Committed), else Living — so
        committed + living + saving + not-yet-spent  = income        (surplus)
        committed + living + saving  − overspent     = income        (deficit)
   exactly, printed or raw.

   N01. "Income never budgeted" / "Budgeted beyond income" was measured against
   the income LANDED so far: on the audited vault it read one figure the day
   before payday, the whole plan before the salary landed, and a third on the
   Budget page for the same plan. It is measured against the PLAN's income (the base the same card's
   "Share of income budgeted" divides by); the income that has not landed is its
   own left, "Income still to come", so Together is still what is left of the
   income that has landed.

   Pure periodFlow() first, then the REAL Score and Budget views over both
   committed households (the clock pinned), then a negative control.

     node tests/score-flow-one-rule.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, leaves, ownText } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const H1 = require('./figures/household.cjs');
const H2 = require('./figures/household2.cjs');
const { periodFlow } = require('../src/money-flow');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-6, `${m} (got ${a}, want ${b})`); checks++; };

const catType = c => ({ Rent: 'housing', Groceries: 'expense', Car: 'expense', Saver: 'savings', Invest: 'investment' }[c] || null);

/* ---- 1. pure: the bands are a partition of gross spend ------------------- */
{
  /* The audited shape, in round numbers: a savings category that never reaches a
     savings account the vault holds (Saver 1 600), a car repair paired into a
     fund (Car 500, "moved" 500), rent flagged fixed. */
  const base = {
    income: 40000, spentTotal: 20000, setAsideSpent: 1600, assumedSpent: 0,
    budgeted: 25000, budgetSetAside: 2000, budgetIncome: 40000, periodFinished: false,
    grossOutByCat: { Rent: 9000, Groceries: 7900, Car: 500, Saver: 1600, Invest: 0 },
    fixedCats: new Set(['Rent']), catType, savingContribution: 500, debts: [],
  };
  const f = periodFlow(base);
  const b = f.bands;
  near(b.saving, 1600, 'Saving is the set-aside SENT, whatever the pairing found');
  near(b.committed, 9000, 'committed is the fixed spend');
  near(b.living, 20000 - 9000 - 1600, 'living is what is left of gross spend, so the car repair is counted once');
  near(b.committed + b.living + b.saving, f.budget.spentTotal, 'the three bands add up to gross spend');
  near(b.committed + b.living + b.saving + b.notYetSpent, f.income, 'and with Not yet spent, to income');
  near(f.movedToFunds, 500, 'money moved between the household\'s own accounts rides along, in no band');

  /* A fixed-flagged savings category is saving, not a committed bill. */
  const g = periodFlow({ ...base, fixedCats: new Set(['Rent', 'Saver']) });
  near(g.bands.saving, 1600, 'a fixed-flagged savings category is still Saving');
  near(g.bands.committed, 9000, 'and is not also committed (it would be counted twice)');
  near(g.bands.committed + g.bands.living + g.bands.saving, 20000, 'so the bands still add up to gross spend');

  /* The grid: surplus and deficit, with and without a provision, every printed
     figure too. */
  let n = 0;
  for (const income of [0, 15000, 40000]) for (const spentTotal of [0, 12000, 20000, 41234.56])
    for (const setAsideSpent of [0, 1600, 5000]) for (const assumedSpent of [0, 750]) {
      const x = periodFlow({ ...base, income, spentTotal, setAsideSpent, assumedSpent });
      const bb = x.bands, paid = bb.committed + bb.living + bb.saving;
      near(paid, Math.min(spentTotal, paid), 'bands never exceed gross spend');
      if (spentTotal >= setAsideSpent) { near(paid, spentTotal, `bands add to gross spend (inc ${income}, spent ${spentTotal}, set-aside ${setAsideSpent})`); }
      if (x.overspent > 0) {
        near(paid - x.overspent, income, 'deficit: bands less Overspent = income');
        near(bb.notYetSpent, 0, 'and nothing is "not yet spent"');
        eq(bb.display.committed + bb.display.living + bb.display.saving - x.overspentDisplay,
          Math.round(income), 'printed: the printed bands less the printed Overspent = the printed income');
      } else if (income > 0 && spentTotal >= setAsideSpent) {
        near(paid + bb.notYetSpent, income, 'surplus: bands + Not yet spent = income');
        eq(bb.display.committed + bb.display.living + bb.display.saving + bb.display.notYetSpent,
          Math.round(income), 'printed: the printed bands add to the printed income');
      }
      n++;
    }
  ok(n === 72, `the grid ran (${n} cases)`);
}

/* ---- 2. pure: "budgeted beyond income" is the plan's, and does not move with payday ---- */
{
  const plan = {
    spentTotal: 12000, setAsideSpent: 2000, assumedSpent: 0, budgeted: 35000, budgetSetAside: 6000,
    budgetIncome: 40000, periodFinished: false, grossOutByCat: {}, fixedCats: new Set(), catType, debts: [],
  };
  const beforePay = periodFlow({ ...plan, income: 0 }).lefts;
  const midMonth = periodFlow({ ...plan, income: 15000 }).lefts;
  const afterPay = periodFlow({ ...plan, income: 40000 }).lefts;
  for (const [name, L] of [['before payday', beforePay], ['mid-month', midMonth], ['after payday', afterPay]]) {
    near(L.neverBudgeted, 40000 - (35000 + 6000), `${name}: beyond-income is plan income less the whole plan (-1 000)`);
  }
  near(beforePay.incomeToCome, -40000, 'before payday: all of the plan income is still to come');
  near(midMonth.incomeToCome, -25000, 'mid-month: the rest of it');
  near(afterPay.incomeToCome, 0, 'after payday: nothing');
  near(periodFlow({ ...plan, income: 43000 }).lefts.incomeToCome, 3000, 'more arrived than planned: positive');
  for (const income of [0, 15000, 40000, 43000]) {
    const L = periodFlow({ ...plan, income }).lefts;
    near(L.leftInBudget + L.setAsideToMove + L.neverBudgeted + L.incomeToCome, L.together, 'the four lefts add to Together');
    near(L.together, income - 12000, 'Together is the income landed less gross spend');
    eq(L.display.leftInBudget + L.display.setAsideToMove + L.display.neverBudgeted + L.display.incomeToCome,
      L.display.together, 'and the printed ones add exactly');
  }
  /* No plan income and a running period: no plan to measure against, the landed
     income stands in (the Budget page prints no tile then). */
  const none = periodFlow({ ...plan, income: 15000, budgetIncome: 0 }).lefts;
  near(none.neverBudgeted, 15000 - 41000, 'no plan income: measured against what landed');
  near(none.incomeToCome, 0, 'and nothing is still to come');
}

/* ---- 3. on screen: both committed households ----------------------------- */
const num = t => Number(String(t).replace(/[^\d−-]/g, '').replace('−', '-'));
const text = (nodes, sel) => { const r = nodes.get(sel); return r ? [...leaves(r)].map(l => ownText(l).replace(/\s+/g, ' ').trim()).filter(Boolean) : []; };
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? e.textContent : '');
/* The phone tree's rows: name -> printed rand figure. */
const flowRows = root => {
  const out = {};
  for (const r of descend(root).filter(e => hasCls(e, 'score-flow-m-row'))) {
    out[textOf(descend(r).find(e => hasCls(e, 'score-flow-m-name')))] = num(textOf(descend(r).find(e => hasCls(e, 'score-flow-m-amt'))));
  }
  return out;
};
const chips = root => descend(root).filter(e => hasCls(e, 'score-flow-chip'))
  .map(c => ({ title: textOf(c.children.find(k => hasCls(k, 'l'))),
    rows: c.children.filter(k => hasCls(k, 'score-flow-row')).map(r => [textOf(r.children[0]), textOf(r.children[1])]) }));

async function score(files, { period, today, budgets }) {
  const unpin = pinClock(today);
  try {
    const { ctx, nodes } = await mountFor(files, { period });
    ctx.switchView = () => {};
    ctx.renderScore();
    const out = { ctx, root: nodes.get('#view-score') };
    if (budgets) { ctx.renderBudgets(); out.budTop = text(nodes, '#budTotalsTop'); }
    return out;
  } finally { unpin(); }
}
const N = () => ({
  committed: i18n.t('score.flow.committed'), living: i18n.t('score.flow.living'), saving: i18n.t('score.flow.saving'),
  notYet: i18n.t('score.flow.notYetSpent'), over: i18n.t('score.flow.overspent.name'),
});

function identity(rows, income, label) {
  const n = N();
  const paid = rows[n.committed] + rows[n.living] + rows[n.saving];
  if (n.over in rows) {
    eq(paid - rows[n.over], income, `${label}: printed bands less the printed Overspent = the printed Money in`);
  } else {
    eq(paid + rows[n.notYet], income, `${label}: printed bands + Not yet spent = the printed Money in`);
  }
}

(async () => {
  const n = N();
  /* household.cjs, 2 Sep: 30 000 in; rent 9 000, groceries 2 600, gym 200 and a
     2 000 investment order out = 13 600 gross; the investment order reaches no
     account the vault holds, and 1 000 moved to the emergency fund by Transfer. */
  {
    const { root } = await score(H1.SEED, { period: H1.PERIOD, today: H1.TODAY });
    const rows = flowRows(root);
    eq(rows[n.saving], 2000, 'household 1: Saving is the 2 000 set-aside order — the old pairing read 1 000, the order was in no band');
    eq(rows[n.living], 11600, 'household 1: Living is the rest of gross spend');
    eq(rows[n.notYet], 16400, 'household 1: Not yet spent is income less gross spend (30 000 - 13 600)');
    identity(rows, 30000, 'household 1');
  }
  /* Deficit on the same household: 20 000 more rent. */
  {
    const files = { ...H1.SEED };
    const k = `${H1.B}/Transactions/Cheque/2026-09.md`;
    files[k] = files[k].replace(/\n$/, '\n') + '| 2026-09-02 | Landlord top-up | Rent | -20000.00 |  |  |  |\n';
    const { root } = await score(files, { period: H1.PERIOD, today: H1.TODAY });
    const rows = flowRows(root);
    ok(n.over in rows, 'household 1 + 20 000 rent: the Overspent row replaces Not yet spent');
    eq(rows[n.over], 3600, 'Overspent is gross spend less income (33 600 - 30 000); the 500 assume-spent provision is the chip\'s Together');
    identity(rows, 30000, 'household 1 overspent');
  }
  /* household2.cjs, its own period. */
  {
    const { root } = await score(H2.SEED, { period: H2.PERIOD, today: H2.TODAY });
    const rows = flowRows(root);
    ok(Object.keys(rows).length >= 4, `household 2 draws the flow card (got ${JSON.stringify(rows)})`);
    if (n.committed in rows) {
      const income = num(textOf(descend(root).find(e => hasCls(e, 'score-flow-in'))).replace(/this period.*/, ''));
      identity(rows, income, 'household 2');
    }
  }

  /* N01 on screen: a plan claiming more than its income, the same label on both pages. */
  {
    const k = `${H1.B}/Budgets/${H1.PERIOD}.md`;
    const files = { ...H1.SEED, [k]: H1.SEED[k].replace(/\| Investing \| investment \| 2000\.00 \|/, '| Investing | investment | 20000.00 |') };
    const { ctx, root, budTop } = await score(files, { period: H1.PERIOD, today: H1.TODAY, budgets: true });
    const lefts = chips(root).find(c => c.title === i18n.t('score.flow.chip.leftsThree'));
    const beyond = lefts.rows.find(r => r[0] === i18n.t('score.flow.chip.overAllocated'));
    ok(beyond, 'the Score names "Budgeted beyond income"');
    const budget = budTop[budTop.indexOf('Over-budgeted') + 1];
    eq(Math.abs(num(beyond[1])), num(budget), `the Score (${beyond[1]}) and the Budget page (${budget}) print the same amount for the same label`);
    ok(beyond[1].startsWith('−'), `signed in the one house form, a minus before the symbol (got "${beyond[1]}")`);
    ok(!lefts.rows.some(r => r[0] === i18n.t('score.flow.chip.incomeToCome')), 'income all landed: no "still to come" row');
    void ctx;
  }

  /* N01 on screen: the day before the salary lands. */
  {
    const k = `${H1.B}/Transactions/Cheque/2026-09.md`;
    const files = { ...H1.SEED, [k]: H1.SEED[k].replace(/\| 2026-09-01 \| Salary \| Salary \| 30000\.00 \|[^\n]*\n/, '') };
    ok(files[k] !== H1.SEED[k], 'fixture check: the salary row was removed');
    const { root } = await score(files, { period: H1.PERIOD, today: H1.TODAY });
    const c = chips(root).find(x => x.rows.some(r => r[0] === i18n.t('score.flow.chip.together')));
    const row = label => (c.rows.find(r => r[0] === label) || [])[1];
    eq(num(row(i18n.t('score.flow.chip.neverBudgeted'))), 12500, 'before payday: never budgeted is still the plan\'s 30 000 - 17 500');
    eq(num(row(i18n.t('score.flow.chip.incomeToCome'))), -30000, 'and the salary not yet landed is its own row, signed');
    eq(num(row(i18n.t('score.flow.chip.together'))), -14100, 'Together is what is left of the income that HAS landed (nothing - 13 600 - 500 provision)');
    eq(c.title, i18n.t('score.flow.chip.leftsFour'), 'four kinds of left are named as four');
  }

  /* ---- 4. NEGATIVE CONTROL ---------------------------------------------- */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-one-rule-nc-'));
    fs.cpSync(path.join(__dirname, '..', 'src'), dir, { recursive: true });
    const file = path.join(dir, 'money-flow.js');
    let src = fs.readFileSync(file, 'utf8');
    const swap = (find, replace) => {
      if (!src.includes(find)) throw new Error(`negative control: "${find}" no longer in money-flow.js — update the control`);
      src = src.replace(find, replace);
    };
    /* The old pair of readings: Saving is the pairing, the set-aside cut out of
       Living is the category-type sum. */
    swap('const saving = Math.min(Math.max(0, Number(setAsideSpent) || 0), Math.max(0, spent - committed));',
      'const saving = Math.max(0, Number(savingContribution) || 0);');
    swap('const living = Math.max(0, spent - committed - saving);',
      'const living = Math.max(0, spent - committed - Object.entries(byCat).filter(([c, v]) => isSetAsideType(catType(c)) && v > 0).reduce((t, [, v]) => t + v, 0));');
    fs.writeFileSync(file, src);
    const old = require(file).periodFlow({
      income: 40000, spentTotal: 20000, setAsideSpent: 1600, budgeted: 25000, budgetSetAside: 2000, budgetIncome: 40000,
      grossOutByCat: { Rent: 9000, Groceries: 7900, Car: 500, Saver: 1600 }, fixedCats: new Set(['Rent']), catType,
      savingContribution: 500, debts: [],
    });
    const paid = old.bands.committed + old.bands.living + old.bands.saving;
    ok(Math.abs(paid - 20000) > 1, `NEGATIVE CONTROL: with the two readings restored the bands add to ${paid}, not 20000`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`PASS score-flow-one-rule (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
