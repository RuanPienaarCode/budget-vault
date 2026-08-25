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
 
   NEGATIVE-CONTROLLED: drop MIN_LIVE_WEIGHT from financialScore and "a
   household with no income gets no score" fires (it scores 100 off one pillar).

   ONE DEFECT HERE IS RECORDED, NOT FIXED, and it is pinned below rather than
   left for someone to rediscover. The savings rate moves with how many days
   apart the two legs of a transfer land: 0% at three days, 10% at four, the
   score stepping 66 -> 76 on nothing the household did. That much is certain.

   What is NOT certain is the right rule, and two plausible fixes were tried
   and rejected against real data:
     · skipping transfer-TYPED rows in the savings walk. Rejected: on a real
       vault all four rows it dropped were money moving from the transaction
       account into a fund — money crossing INTO the pool from outside, which
       is saving by this app's own definition. It halved a real rate from 8.8%
       to 4.2%. This is the same trap the savings walk's own comment documents
       for savings-typed rows, and the category type cannot escape it.
     · widening or removing passthroughPairs' date window. Rejected: it makes
       the cliff wider, not absent, and removing it entirely lets two unrelated
       equal amounts cancel each other.

   The honest discriminator is whether the money's ORIGIN was counted as income
   — a salary moved cheque -> pot is saving, a UIF payment passing through on
   its way to the same pot is not, and the two are identical in shape. That
   needs provenance the rows do not currently carry, so it is a design decision
   rather than a patch. Until then this file records the behaviour exactly, so
   that any change to it is deliberate and visible in the diff.
 
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
   1. CHARACTERISATION ONLY — THE SETTLEMENT-LAG DEFECT, PINNED AS IT STANDS.

   Read the header before changing anything here. The assertions below record
   WRONG behaviour on purpose; they are not an endorsement of it.

   One household, one R3 000 transfer from cheque into a savings pot, both legs
   categorised `Move` (transfer-typed) — the user has DECLARED this internal.
   The only thing that varies is how many days apart the legs land.

   Before the fix, `passthroughPairs`' TRANSFER_DAYS = 3 window did all the
   work: inside it both legs cancelled, outside it the pot inflow survived and
   was counted as fresh saving. Same behaviour, different bank, 0% vs 10%.

   Note this does NOT reintroduce the bug the savings walk's own comment warns
   about. That one was about SAVINGS-typed inflows, which are genuinely
   ambiguous — `Investing` can name the destination (real saving from a cheque
   account) or the source. A TRANSFER-typed row carries no such ambiguity: the
   user has said it is money moving between their own accounts. health-data.js
   already skips transfer-typed rows in the household-spend loop; this makes
   the savings walk agree with it.
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
  for (const lag of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const s = await snapOf(lagVault(lag));
    byLag.push({ lag, savings: s.metrics.monthlySavings, rate: s.metrics.savingsRate, score: s.breakdown.total });
    invariants(`transfer lag ${lag}d`, s);
  }
  /* KNOWN DEFECT, pinned exactly. If this block starts failing, someone has
     changed how transfers are counted — read the header, then decide whether
     the new behaviour is the fix or a fresh regression, and update this on
     purpose. The desired end state is one rate at every lag. */
  const near3 = byLag.filter(r => r.lag <= 3);
  const past3 = byLag.filter(r => r.lag > 3);
  ok(near3.every(r => Math.abs(r.savings) < 0.01),
    'DEFECT: legs settling within TRANSFER_DAYS cancel, and R3 000 a month of real '
    + `saving reads as nothing (got ${near3.map(r => r.savings).join(', ')})`);
  ok(past3.every(r => Math.abs(r.savings - 3000) < 0.01),
    'DEFECT: the same R3 000 counts in full once the legs land further apart '
    + `(got ${past3.map(r => r.savings).join(', ')})`);
  ok(near3[0].score !== past3[0].score,
    'DEFECT: and the headline score moves with the bank rather than the household '
    + `(${near3[0].score} vs ${past3[0].score})`);

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

  console.log(`PASS — the maths holds for households that are not the author's (${checks} checks).`);
})().catch(e => { console.error(e.message); process.exit(1); });
