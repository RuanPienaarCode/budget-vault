'use strict';
/* Does the maths hold for households that are NOT the author's?
 
   Every fix in the 1.23.x–1.24.0 run was validated against one real vault. That
   vault has income every month, no debt carrying a stated rate, no budgeted
   amounts, month_start_day 1, and transfers that settle same-day. Whole branches
   of the maths never ran, and "the number looks right on my vault" cannot tell
   the difference between a rule that is correct and a rule that happens to agree
   with one household's shape.
 
   So: build households the author does not have, and apply the same invariants.
   Two shipped bugs were found this way and are pinned below.
 
   NEGATIVE-CONTROLLED. Reverting either fix makes this file fail:
     · drop MIN_LIVE_WEIGHT from financialScore and "a household with no income
       gets no score" fires (it scores 100 off one live pillar).
     · restore the day window in health-data.js and "the savings rate must not
       depend on how fast the bank settles" fires.

   THE SETTLEMENT-LAG DEFECT, and why the obvious fixes were wrong.

   The savings rate used to move with the calendar: R3 000 moved from a cheque
   account into a pot read as nothing when the two legs landed within three
   days and R3 000 when they landed four apart, the score stepping 66 -> 76 on
   nothing the household did. In the other direction a shuffle BETWEEN two
   savings accounts read as R3 000 of fresh saving once its legs fell outside
   the same window. One number, two cliffs, both set by a bank.

   Two fixes were tried and rejected against real data before the one below:
     · skipping transfer-TYPED rows in the savings walk. All four rows it
       dropped on a real vault were money moving from a transaction account
       into a fund — money crossing INTO the pool from outside, which is saving
       by this app's own definition. It halved a real rate, 8.8% -> 4.2%.
     · requiring the two legs to share a description. It threw away four real
       pairs, because two banks write one movement two ways: "Discovery Bank
       account...6397" against "Notice savings account payout".

   What actually holds is two rules that never consult a calendar:
     · a pool inflow whose matching outflow sits in ANOTHER POOL account is an
       internal move, at any distance inside the period.
     · nothing else. In particular a row is NOT skipped for being `excluded`,
       nor for being income-typed, because income does not skip those either —
       it is built from householdNet, which never consults `excluded`. A rule
       that dropped income-typed excluded inflows was written and reverted for
       exactly that reason: it moved the inconsistency to the other side of the
       ratio, taking R1 402 of interest out of the numerator while the
       denominator went on counting it.

     node tests/household-shapes.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tbl = rows => `---\nkind: transactions\n---\n\n${HEAD}${rows.join('\n')}\n`;
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const settings = (d = 1) => `---\nmonth_start_day: ${d}\ncurrency: "R"\ncountry: za\n---\n`;
const acct = (t, bal, extra = '') =>
  `---\ntype: ${t}\nbalance: ${bal}\nbalance_updated: 2026-08-01\n${extra}---\n`;

const CATS = {
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\nfixed: true\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: luxuries\n---\n',
  [`${B}/Categories/Move.md`]: '---\ntype: transfer\n---\n',
  [`${B}/Categories/Save.md`]: '---\ntype: savings\n---\n',
};

const snapOf = async (files, period = '2026-08') => {
  const ctx = makeCtx(files, { budgetFolder: B });
  await loadInto(ctx);
  ctx.S.period = period;
  return ctx.healthSnapshot();
};

/* ---------------------------------------------------------------------------
   1. THE SAVINGS RATE MUST NOT DEPEND ON HOW FAST THE BANK SETTLES.

   Six households that differ only in where the money came from, whether the
   reader marked the legs excluded, and what category it carries. Each is run
   at every settlement lag from same-day to seventeen days. Every one must give
   the same answer at every lag, and it must be the RIGHT answer.
--------------------------------------------------------------------------- */
function lagVault(lagDays) {
  const f = Object.assign({ [`${B}/Settings.md`]: settings() }, CATS, {
    [`${B}/Accounts/Cheque.md`]: acct('checking', 20000, 'tx_label: "Cheque"\n'),
    [`${B}/Accounts/Pot.md`]: acct('savings', 60000, 'emergency_fund: true\ntx_label: "Pot"\n'),
  });
  for (const m of MONTHS) {
    f[`${B}/Transactions/Cheque/${m}.md`] = tbl([
      `| ${m}-01 | Pay | Salary | 30000.00 | | | |`,
      `| ${m}-03 | Rent | Rent | -9000.00 | | | |`,
      `| ${m}-10 | To pot | Move | -3000.00 | yes | | |`,
    ]);
    f[`${B}/Transactions/Pot/${m}.md`] = tbl([
      `| ${m}-${String(10 + lagDays).padStart(2, '0')} | From cheque | Move | 3000.00 | yes | | |`,
    ]);
  }
  return f;
}

/* Same movement, but BOTH legs inside the pool: never new saving. */
function internalVault(lagDays) {
  const f = Object.assign({ [`${B}/Settings.md`]: settings() }, CATS, {
    [`${B}/Accounts/Cheque.md`]: acct('checking', 20000, 'tx_label: "Cheque"\n'),
    [`${B}/Accounts/Pot.md`]: acct('savings', 60000, 'emergency_fund: true\ntx_label: "Pot"\n'),
    [`${B}/Accounts/Pot2.md`]: acct('savings', 90000, 'tx_label: "Pot2"\n'),
  });
  for (const m of MONTHS) {
    f[`${B}/Transactions/Cheque/${m}.md`] = tbl([
      `| ${m}-01 | Pay | Salary | 30000.00 | | | |`,
      `| ${m}-03 | Rent | Rent | -9000.00 | | | |`,
    ]);
    f[`${B}/Transactions/Pot2/${m}.md`] = tbl([`| ${m}-10 | To pot | Move | -3000.00 | | | |`]);
    f[`${B}/Transactions/Pot/${m}.md`] = tbl([
      `| ${m}-${String(10 + lagDays).padStart(2, '0')} | From pot2 | Move | 3000.00 | | | |`]);
  }
  return f;
}

/* The R40 000 UIF shape: an income-typed category the reader marked excluded,
   passing through a non-pool account into a pot. */
function uifVault(lagDays) {
  const f = Object.assign({ [`${B}/Settings.md`]: settings() }, CATS, {
    [`${B}/Categories/Reimbursements.md`]: '---\ntype: income\n---\n',
    [`${B}/Accounts/Cheque.md`]: acct('checking', 20000, 'tx_label: "Cheque"\n'),
    [`${B}/Accounts/Pot.md`]: acct('savings', 60000, 'emergency_fund: true\ntx_label: "Pot"\n'),
  });
  for (const m of MONTHS) {
    f[`${B}/Transactions/Cheque/${m}.md`] = tbl([
      `| ${m}-01 | Pay | Salary | 30000.00 | | | |`,
      `| ${m}-03 | Rent | Rent | -9000.00 | | | |`,
      `| ${m}-08 | UIF in | Reimbursements | 3000.00 | yes | | |`,
      `| ${m}-09 | UIF out | Reimbursements | -3000.00 | yes | | |`,
    ]);
    f[`${B}/Transactions/Pot/${m}.md`] = tbl([
      `| ${m}-${String(9 + lagDays).padStart(2, '0')} | UIF | Reimbursements | 3000.00 | yes | | |`]);
  }
  return f;
}

/* ---------------------------------------------------------------------------
   2. AN UNMEASURABLE HOUSEHOLD MUST NOT SCORE WELL.

   Four of the five pillars are income-gated. With no income they all return
   null, the score renormalises over the single survivor — emergency cover —
   and a big pot against a small essential spend is full marks.

   The result before the fix: the SAME household with the SAME R500k pot and
   the SAME R14k rent scored 70 while earning R40 000 a month and 100 while
   earning nothing. Losing your income raised your score.

   Renormalising is right when a pillar genuinely does not apply — a vault with
   no debts should not carry a silent zero for debt. It is wrong when the
   pillar is unmeasurable because something is missing. The fix does not
   special-case income: it requires that the live pillars carry at least half
   the total weight before a score is reported at all.
--------------------------------------------------------------------------- */
function incomeVault(monthlyIncome, potBalance) {
  const f = Object.assign({ [`${B}/Settings.md`]: settings() }, CATS, {
    [`${B}/Accounts/Cheque.md`]: acct('checking', 5000, 'tx_label: "Cheque"\n'),
  });
  if (potBalance !== null) {
    f[`${B}/Accounts/Pot.md`] = acct('savings', potBalance, 'emergency_fund: true\ntx_label: "Pot"\n');
  }
  for (const m of MONTHS) {
    const rows = [`| ${m}-03 | Rent | Rent | -14000.00 | | | |`];
    if (monthlyIncome) { rows.unshift(`| ${m}-01 | Pay | Salary | ${monthlyIncome}.00 | | | |`); }
    f[`${B}/Transactions/Cheque/${m}.md`] = tbl(rows);
  }
  return f;
}

/* ---------------------------------------------------------------------------
   3. SHAPES THAT MUST SIMPLY NOT BREAK.
   Each is a legitimate way to keep a budget that the author's vault is not.
--------------------------------------------------------------------------- */
function plainVault({ startDay = 1, income = 30000, months = MONTHS, luxuries = true }) {
  const f = Object.assign({ [`${B}/Settings.md`]: settings(startDay) }, CATS, {
    [`${B}/Accounts/Cheque.md`]: acct('checking', 25000, 'tx_label: "Cheque"\n'),
  });
  for (const m of months) {
    const rows = [
      `| ${m}-${startDay === 1 ? '03' : '27'} | Rent | Rent | -9000.00 | | | |`,
      `| ${m}-09 | Food | Food | -6000.00 | | | |`,
    ];
    if (income) { rows.unshift(`| ${m}-${startDay === 1 ? '01' : '26'} | Pay | Salary | ${income}.00 | | | |`); }
    if (luxuries) { rows.push(`| ${m}-14 | Fun | Fun | -2000.00 | | | |`); }
    f[`${B}/Transactions/Cheque/${m}.md`] = tbl(rows);
  }
  return f;
}

/* The invariants, applied to whatever shape is handed over. */
function invariants(label, snap) {
  const m = snap.metrics;
  const fin = v => v === null || v === undefined || Number.isFinite(v);
  const has = v => v !== null && v !== undefined;

  for (const k of ['savingsRate', 'fixedShare', 'consumptionShare', 'budgetUsed',
    'interestShare', 'months', 'monthlyIncome', 'monthlyConsumption', 'monthlySavings']) {
    ok(fin(m[k]), `${label}: ${k} is a real number or null, never NaN/Infinity (got ${m[k]})`);
  }
  for (const k of ['savingsRate', 'fixedShare', 'consumptionShare', 'budgetUsed', 'interestShare']) {
    ok(!has(m[k]) || m[k] >= 0, `${label}: ${k} is a share of income and cannot be negative (got ${m[k]})`);
  }
  if (has(m.monthlyEssential) && has(m.monthlyConsumption)) {
    ok(m.monthlyEssential <= m.monthlyConsumption + 0.01,
      `${label}: essential (${m.monthlyEssential}) must not exceed consumption (${m.monthlyConsumption})`);
  }
  if (has(m.monthlyFixed) && has(m.monthlyConsumption)) {
    ok(m.monthlyFixed <= m.monthlyConsumption + 0.01,
      `${label}: fixed (${m.monthlyFixed}) must not exceed consumption (${m.monthlyConsumption})`);
  }
  const b = snap.breakdown;
  if (b) {
    const pts = b.pillars.reduce((s, p) => s + p.shownPoints, 0);
    const max = b.pillars.reduce((s, p) => s + p.shownMax, 0);
    ok(Math.abs(pts - b.total) <= 0.5, `${label}: pillar points (${pts}) sum to the headline (${b.total})`);
    ok(Math.abs(max - 100) <= 0.5, `${label}: pillar maxima sum to 100 (got ${max})`);
    ok(b.total >= -0.01 && b.total <= 100.01, `${label}: score is within 0..100 (got ${b.total})`);
    for (const p of b.pillars) {
      ok(p.shownPoints <= p.shownMax + 0.01, `${label}: ${p.key} cannot exceed its own maximum`);
      ok(p.shownPoints >= -0.01, `${label}: ${p.key} cannot score negative points`);
    }
  }
}

(async () => {
  /* ---- 1. settlement lag ---- */
  const byLag = [];
  for (const lag of [0, 1, 2, 3, 4, 5, 6, 7, 11, 17]) {
    const s = await snapOf(lagVault(lag));
    byLag.push({ lag, savings: s.metrics.monthlySavings, rate: s.metrics.savingsRate, score: s.breakdown.total });
    invariants(`transfer lag ${lag}d`, s);
  }
  ok(new Set(byLag.map(r => Math.round((r.rate || 0) * 1000))).size === 1,
    'the savings rate must not depend on how many days apart the two legs of a transfer land — '
    + byLag.map(r => `${r.lag}d:${((r.rate || 0) * 100).toFixed(1)}%`).join(' '));
  ok(byLag.every(r => Math.abs(r.savings - 3000) < 0.01),
    'and R3 000 moved from a cheque account into a pot is R3 000 saved at every lag, '
    + `because a cheque account is outside the pool (got ${byLag.map(r => r.savings).join(', ')})`);
  ok(new Set(byLag.map(r => r.score)).size === 1,
    `the score must not move with settlement lag either (got ${byLag.map(r => r.score).join(', ')})`);

  /* The other direction, and the one that OVERSTATED: a shuffle between two
     savings accounts is never new saving, however far apart its legs land. */
  const internal = [];
  for (const lag of [0, 3, 4, 7, 11, 17]) {
    const s2 = await snapOf(internalVault(lag));
    internal.push({ lag, savings: s2.metrics.monthlySavings });
    invariants(`internal shuffle ${lag}d`, s2);
  }
  ok(internal.every(r => Math.abs(r.savings) < 0.01),
    'money moved from one savings account to another is never fresh saving, at any lag — '
    + `it is the same rand in a different pot (got ${internal.map(r => r.savings).join(', ')})`);

  /* The R40 000 UIF shape: income-typed, excluded, arriving in a non-pool
     account and moving on into a pot.

     It COUNTS, on both sides. The rule that used to drop it was justified by
     "the same rand is not counted as income", and that was never true — income
     is built from householdNet, which filters transfer-typed rows and paired
     pass-throughs and does not look at `excluded` at all. So the household
     received the money and put it away, income sees it once, saving sees it
     once, and the two sides of the ratio agree.

     Asserted here on BOTH sides rather than on savings alone, because the
     whole defect was the two disagreeing: a savings figure is only meaningful
     next to the income it is a share of. */
  const uif = [];
  for (const lag of [0, 3, 4, 11]) {
    const s3 = await snapOf(uifVault(lag));
    uif.push({ lag, savings: s3.metrics.monthlySavings, income: s3.metrics.monthlyIncome });
    invariants(`uif passthrough ${lag}d`, s3);
  }
  ok(uif.every(r => Math.abs(r.savings - 3000) < 0.01),
    'money that arrived and was put away is saved, at every lag — the pass-through legs '
    + `cancel and the arrival does not (got ${uif.map(r => r.savings).join(', ')})`);
  ok(uif.every(r => Math.abs(r.income - 33000) < 0.01),
    'and the SAME rand is in the income base, which is why counting it as saving is '
    + `consistent rather than inflationary (got ${uif.map(r => r.income).join(', ')})`);
  ok(new Set(uif.map(r => Math.round(r.savings))).size === 1
     && new Set(uif.map(r => Math.round(r.income))).size === 1,
    'neither side moves with settlement lag');

  /* ---- 2. unmeasurable households ---- */
  const noIncome = await snapOf(incomeVault(0, 500000));
  const withIncome = await snapOf(incomeVault(40000, 500000));
  ok(noIncome.breakdown === null || noIncome.breakdown.total === null,
    'a household with no income has four of five pillars unmeasurable, so it gets no score at all '
    + `rather than a flattering one built on the survivor (got ${noIncome.breakdown && noIncome.breakdown.total})`);
  ok(withIncome.breakdown && withIncome.breakdown.total > 0,
    'the same household WITH income still scores normally');
  ok(noIncome.breakdown === null || noIncome.breakdown.total === null
    || noIncome.breakdown.total <= withIncome.breakdown.total,
    'losing your income must never RAISE your score');
  /* A vault with no debts keeps its score — renormalising is right when a
     pillar genuinely does not apply, and that behaviour must survive the fix. */
  ok(withIncome.breakdown.pillars.every(p => p.key !== 'debt') === false
    || withIncome.breakdown.total > 0,
    'a vault with no debt still scores out of 100 on the pillars it can answer');
  invariants('no income', noIncome);
  invariants('with income', withIncome);

  /* ---- 3. shapes that must not break ---- */
  const SHAPES = {
    'brand-new (one month)': plainVault({ months: ['2026-07'] }),
    'single account, no transfers': plainVault({}),
    'month_start_day 25': plainVault({ startDay: 25 }),
    'no luxuries at all': plainVault({ luxuries: false }),
  };
  for (const [name, files] of Object.entries(SHAPES)) {
    invariants(name, await snapOf(files));
  }

  /* ---- 4. ONE QUESTION, ONE ANSWER, ON EVERY CARD THAT ASKS IT ----
     "What share of income has the plan claimed?" is asked twice — the
     Dashboard's "N% allocated" and the Score page's "Allocated of income" —
     and on a real vault, mid-period, they answered 100% and 102% off the same
     files. One divided by the income the BUDGET states, the other by the
     income that happened to have landed by that morning, so the second drifted
     every day and the two never agreed except by coincidence.

     Both now call money-flow.js's allocatedShare(). This pins the behaviour
     AND the arrangement: a future reader who reintroduces a second, local
     calculation makes the last assertion here fail. */
  const { allocatedShare, periodFlow } = require('../src/money-flow');
  const CASES = [
    { budgeted: 40893, budgetIncome: 40795.2, actualIncome: 40240.21, periodFinished: false },
    { budgeted: 40893, budgetIncome: 0, actualIncome: 40240.21, periodFinished: false },
    { budgeted: 40893, budgetIncome: 0, actualIncome: 40240.21, periodFinished: true },
    { budgeted: 0, budgetIncome: 0, actualIncome: 40000, periodFinished: false },
    { budgeted: 0, budgetIncome: 0, actualIncome: 0, periodFinished: false },
  ];
  for (const c of CASES) {
    const direct = allocatedShare(c);
    const viaFlow = periodFlow({
      income: c.actualIncome, spentTotal: 0, budgeted: c.budgeted,
      budgetIncome: c.budgetIncome, periodFinished: c.periodFinished,
    }).budget.allocatedOfIncome;
    ok(direct === viaFlow || (direct !== null && viaFlow !== null && Math.abs(direct - viaFlow) < 1e-9),
      `the flow card and the shared rule agree on "allocated" for ${JSON.stringify(c)} `
      + `(${direct} vs ${viaFlow})`);
  }
  ok(allocatedShare({ budgeted: 40893, budgetIncome: 40795.2, actualIncome: 1, periodFinished: false })
     === allocatedShare({ budgeted: 40893, budgetIncome: 40795.2, actualIncome: 40240, periodFinished: false }),
    'and it does not move as the month\'s income lands — that drift is what made the '
    + 'two cards disagree in the first place');

  const fsMod = require('fs');
  for (const view of ['dashboard', 'score']) {
    const src = fsMod.readFileSync(`${__dirname}/../src/views/${view}.js`, 'utf8');
    ok(/allocatedShare|periodFlow/.test(src),
      `views/${view}.js reads the shared rule rather than computing "allocated" itself`);
  }

  /* ---- 5. "SAVED" MEANS ONE THING, ON BOTH CARDS THAT SAY IT ----
     The Score page's ring and the "Where the money went" card beside it used
     to measure saving two ways: the card read splitFlows' GROSS contributions
     and the ring counted only what crossed into the pool from outside. On a
     real vault the card reported R4 270 saved in a period whose only movement
     was R4 270 travelling from a baby fund into an emergency fund. The windows
     differ on purpose — one period against six — but the measure must not.

     Both now call savings-math.js's savedFromOutside(). */
  {
    const { savedFromOutside } = require('../src/savings-math');
    const { splitFlows } = require('../src/savings-math');
    const ctx2 = makeCtx(internalVault(0), { budgetFolder: B });
    await loadInto(ctx2);
    ctx2.S.period = '2026-08';
    const per = '2026-07';
    const idx2 = ctx2.accountIndex();
    const pool = ctx2.S.accounts.filter(a => a.type === 'savings' || a.type === 'investment');
    const labels = new Map();
    let gross = 0;
    for (const a of pool) {
      for (const L of ((idx2.get(a) || {}).labels || [])) { labels.set(L, a); }
      gross += splitFlows((idx2.get(a) || {}).rows || [], ctx2.catType,
        ctx2.periodRange(per)).contributions;
    }
    const shared = savedFromOutside(ctx2.txInPeriod(per), labels);
    ok(Math.abs(shared) < 0.01,
      'a move between two of your own savings accounts is R0 saved by the shared rule, '
      + `whatever the gross figure says (got ${shared})`);
    ok(gross > 0,
      'and the gross reading really does differ, so this is a live guard rather than '
      + `two names for the same number (gross ${gross})`);
    const src = require('fs').readFileSync(`${__dirname}/../src/views/score.js`, 'utf8');
    ok(/savedFromOutside/.test(src) && !/splitFlows\(/.test(src),
      'views/score.js feeds the flow card from savedFromOutside, not from a gross reading '
      + 'of its own');
  }

  console.log(`PASS — the maths holds for households that are not the author's (${checks} checks).`);
})().catch(e => { console.error(e.message); process.exit(1); });
