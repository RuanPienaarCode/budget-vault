'use strict';
/* Two wrong figures found by the 2026-11-03 math-accuracy pass, each pinned at
   the arithmetic a reader would check by hand.

   1. The Score popup's pillar points summed to one MORE than the ring. Two full
      pillars of 26.667 show 27 + 27 = 54 beside round(53.33) = 53, because
      largestRemainder can only hand points out, never take them back. The
      existing sweep in health-math.test.cjs drew continuous fractions, which
      never land on exact 0s and 1s — the scorer clamps, so real fractions do.

   2. A negative Repaid on Owed Money.md (a stray minus, or "(500)") was read
      raw: what is still owed grew past what was ever lent and Recovered went
      negative. Amount was already floored; Repaid now is too.

   3. The next charge and payday were stepped from the day the last one LANDED:
      a salary paid early on Friday the 23rd (the 25th was a Sunday) was due
      "23 November", a debit order on the 31st taken on 28 February "28 March".
   4. A larger salary that STOPPED beat the current one and then nulled it.
   5. An unlisted debit order collected on 31 July for 1 August read as a
      skipped month and fell out of "still committed".
   6. South African bank verbs counted as the merchant in the near-duplicate
      check, unticking a R500 to Dad as a copy of a R500 to Mom.
   7. "1.500.000 IDR" read nothing (the DR of IDR was taken as debit); "DB"
      was read as a currency, not a debit; Afrikaans/German/Indonesian month
      names did not parse.
   8. A re-anchored payday read as a 2-day old cycle (rent x7).
   9. Float sums of cents: exactly-on-budget read "R 0,00 over", a card paid
      to R0 read as owed, a fund emptied of its capital printed a 16-digit
      return.
  10. Two budget rows for one category: the table showed the last, the
      totals both.
  11. A transfer to a fund whose legs straddle a period boundary was counted
      in neither period.
  12. Spending past income: the bands summed to a rand LESS than the income. */
const assert = require('assert');
const { financialScore, scoreBreakdown, PILLARS } = require('../src/health-math');
const { largestRemainder, allocateWhole } = require('../src/share-percents');
const { owedSummary, outstandingOf } = require('../src/owed-math');
const { nextExpected, nextDue, chargeStats, findRecurringCredit } = require('../src/recurring');
const { debitOrderCommitments, whatsLeft } = require('../src/committed');
const { descsLikelySame } = require('../src/dedupe');
const { normalizeAmount } = require('../src/amount');
const { parseStatementDate } = require('../src/statement');
const { inferIntervalFromKeys } = require('../src/reslice');
const { reconcile } = require('../src/reconcile');
const { totalReturn } = require('../src/savings-math');
const { periodFlow } = require('../src/money-flow');
const { tally, stamp, LENSES } = require('../src/ledger');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

/* ---- 1. score breakdown adds up -------------------------------------- */
{
  const f = { cover: null, rate: 1, interest: 1, instalments: 1, fixed: 0, consumption: 0, budget: 0, networth: 0 };
  const bd = scoreBreakdown({ score: financialScore(f) }, 6);
  const sum = bd.pillars.reduce((s, p) => s + p.shownPoints, 0);
  ok(bd.total === 53, `headline is round(26.667 * 2) = 53, got ${bd.total}`);
  ok(sum === 53, `two full pillars + two empty ones print points summing to the ring (53), got ${sum}`);
  for (const p of bd.pillars) ok(p.shownLost >= 0 && p.shownPoints <= p.shownMax, `${p.key}: ${p.shownPoints} of ${p.shownMax}`);
}
const keys = PILLARS.flatMap(p => p.parts.map(q => q.key));
{
  // The fractions the scorer really emits: clamped, so exact 0, exact 1 and null are common.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = () => { const r = rnd(); return r < 0.35 ? 1 : r < 0.5 ? 0 : r < 0.6 ? null : rnd(); };
  let bad = 0, scored = 0;
  for (let n = 0; n < 20000; n++) {
    const f = {}; for (const k of keys) f[k] = pick();
    const sc = financialScore(f); if (!sc) continue; scored++;
    const b = scoreBreakdown({ score: sc }, 6);
    const s = b.pillars.reduce((t, p) => t + p.shownPoints, 0);
    if (s !== b.total || b.pillars.some(p => p.shownPoints < 0 || p.shownPoints > p.shownMax)) bad++;
  }
  ok(scored > 10000, `sweep scored enough vectors (${scored})`);
  ok(bad === 0, `every scored vector prints pillar points that add up to the ring (${bad} did not)`);
}
{
  // allocateWhole takes back where largestRemainder (whose precondition is
  // Σvalues <= target, pinned in chart-invariants C3) only hands out.
  // Exhaustive over unmeasured (null), empty, half and full parts: with a pillar
  // unmeasured the maxima are fractional, and a first fix let a full pillar
  // print "27 of 26, lost -1" (caught in review). Sum and bounds, every vector.
  {
    const vals = [null, 0, 0.5, 1];
    let n = 0, sumBad = 0, boundBad = 0;
    const rec = (i, f) => {
      if (i === keys.length) {
        const sc = financialScore(f); if (!sc) return; n++;
        const b = scoreBreakdown({ score: sc }, 6);
        if (b.pillars.reduce((t, p) => t + p.shownPoints, 0) !== b.total) sumBad++;
        if (b.pillars.some(p => p.shownPoints < 0 || p.shownPoints > p.shownMax || p.shownLost < 0)) boundBad++;
        return;
      }
      for (const v of vals) rec(i + 1, { ...f, [keys[i]]: v });
    };
    rec(0, {});
    ok(n > 50000, `exhaustive sweep scored ${n} vectors`);
    ok(sumBad === 0, `every vector's points add up to the ring (${sumBad} did not)`);
    ok(boundBad === 0, `no pillar prints more than its maximum or below zero (${boundBad} did)`);
  }
  ok(allocateWhole([27, 27, 0, 0], 53).reduce((s, v) => s + v, 0) === 53, 'surplus is taken back to the target');
  ok(allocateWhole([0.4, 0.4], 0).every(v => v === 0), 'never below zero');
  ok(JSON.stringify(largestRemainder([100 / 3, 100 / 3, 100 / 3], 100)) === '[34,33,33]', 'largestRemainder unchanged: thirds still 34/33/33');
}

/* ---- 2. negative Repaid is read as nothing repaid --------------------- */
{
  const today = '2026-11-03';
  const list = [
    { person: 'Thabo', amount: 2000, repaid: -500, status: 'outstanding', lent: '2026-09-01' },
    { person: 'Sipho', amount: 1000, repaid: 400, status: 'outstanding', lent: '2026-09-01' },
  ];
  const s = owedSummary(list, today);
  ok(outstandingOf(list[0]) === 2000, `Thabo still owes what was lent (2000), got ${outstandingOf(list[0])}`);
  ok(s.outstanding === 2600, `outstanding = 2000 + (1000 - 400) = 2600, got ${s.outstanding}`);
  ok(s.recovered === 400, `recovered = only Sipho's 400, got ${s.recovered}`);
}

/* ---- 3-5. cadence ---------------------------------------------------- */
{
  const charges = d => d.map(date => ({ date, desc: 'X', amount: -100 }));
  // salary paid early on the 23rd (the 25th was a Sunday): next is the 25th
  const sal = chargeStats(charges(['2026-08-25', '2026-09-25', '2026-10-23']));
  ok(nextExpected(sal, 'monthly') === '2026-11-25', `weekend-shifted payday steps to the usual 25th, got ${nextExpected(sal, 'monthly')}`);
  // the 31st, taken on 28 February: next is 31 March, and the Services hint agrees
  const eom = chargeStats(charges(['2025-12-31', '2026-01-31', '2026-02-28']));
  ok(nextExpected(eom, 'monthly') === '2026-03-31', `month-end biller after February is due the 31st, got ${nextExpected(eom, 'monthly')}`);
  ok(nextDue(eom, 'monthly', '2026-03-01').date === '2026-03-31', 'and the Services hint offers the 31st');
  // collected a day early across the month end: 31 July is August's charge
  const edge = chargeStats(charges(['2026-06-01', '2026-07-01', '2026-07-31']));
  ok(nextExpected(edge, 'monthly') === '2026-09-01', `31 July for 1 August steps to 1 September, got ${nextExpected(edge, 'monthly')}`);
  // a one-off far from the usual day keeps its own day (services-next-billing-hint pins this)
  const addon = chargeStats(charges(['2026-08-05', '2026-09-05', '2026-09-28']));
  ok(nextExpected(addon, 'monthly') === '2026-10-28', `an off-cycle last charge is not moved to the usual day, got ${nextExpected(addon, 'monthly')}`);
  // ordinary cadence unchanged
  ok(nextExpected(chargeStats(charges(['2026-09-15', '2026-10-15'])), 'monthly') === '2026-11-15', 'an on-day charge steps one month');

  const salRows = (dates, desc, amount) => dates.map(date => ({ date, desc, amount }));
  const rows = [...salRows(['2026-01-25', '2026-02-25', '2026-03-25', '2026-04-25', '2026-05-25', '2026-06-25'], 'ACME HOLDINGS SALARY', 42000),
    ...salRows(['2026-07-25', '2026-08-25', '2026-09-25', '2026-10-25'], 'NEWCO PAYROLL', 38500)];
  const c = findRecurringCredit(rows, '2026-11-03');
  ok(c && c.amount === 38500 && c.next === '2026-11-25', `a stopped larger salary does not hide the current one, got ${JSON.stringify(c)}`);

  const cheque = { name: 'Cheque', type: 'checking', dated: true, implied: 20000, importedTo: '2026-11-24' };
  const card = { name: 'Card', type: 'credit_card', settle_monthly: true, dated: true, implied: -12000, importedTo: '2026-11-24' };
  const w = whatsLeft({ accounts: [cheque, card], services: [], debts: [], rows: [], settleRows: [],
    incomeRows: salRows(['2026-07-24', '2026-08-25', '2026-09-25', '2026-10-23'], 'EMPLOYER SALARY', 40000),
    cardRows: [{ date: '2026-11-10', desc: 'SHOP', amount: -12000 }], cardRefundRows: [],
    accountOfRow: new Map(), periodStart: '2026-11-01', periodEnd: '2026-11-30', today: '2026-11-24' });
  ok(w.free === 20000 && !!w.cycle, `on 24 Nov the salary due on the 25th still settles the card (free ${w.free}, cycle ${!!w.cycle})`);

  const payer = { name: 'Cheque', type: 'checking', importedTo: '2026-10-25' };
  const mk = d => d.map(date => ({ date, desc: 'GYM DEBIT ORDER', cat: 'Gym', amount: -450 }));
  const orders = mk(['2026-06-01', '2026-07-01', '2026-07-31', '2026-09-01', '2026-10-01']);
  const due = debitOrderCommitments({ rows: orders, services: [], debts: [], from: '2026-10-25', to: '2026-11-21',
    periodStart: '2026-10-22', accountOfRow: new Map(orders.map(r => [r, payer])) });
  ok(due.length === 1 && due[0].due === '2026-11-01' && due[0].amount === 450, `a debit order taken a day early across the month end stays committed, got ${JSON.stringify(due.map(i => i.due))}`);
}

/* ---- 6-8. import parsing --------------------------------------------- */
{
  for (const [a, b] of [['FNB App Payment To Alice', 'FNB App Payment To Bob'], ['Banking App Payment: MOM', 'Banking App Payment: DAD'],
    ['DEBIT ORDER DISCOVERY LIFE', 'DEBIT ORDER DSTV'], ['Recurring Card Purchase NETFLIX.COM', 'Recurring Card Purchase SHOWMAX'],
    ['Immediate Trf To Alice', 'Immediate Trf To Bob'], ['Prepaid Airtime Vodacom', 'Prepaid Airtime MTN']]) {
    ok(!descsLikelySame(a, b), `"${a}" and "${b}" are different payees`);
  }
  ok(descsLikelySame('Card Purchase GROCER ONE TERM0099', 'Card Purchase GROCER ONE CITYVILLE'), 'a shared merchant still matches under a verb');
  for (const [raw, want] of [['1.500.000 IDR', 1500000], ['1 250,00 SCR', 1250], ['1,500,000.00 DB', -1500000],
    ['1,500,000.00 CR', 1500000], ['100.00 Dr', -100], ['DR 100.00', -100], ['IDR 1.500.000', 1500000],
    ['DrR100', -100], ['DRR 100', -100], ['100.00CR', 100], ['CRC 1 000', 1000]]) {
    ok(normalizeAmount(raw) === want, `"${raw}" reads ${want}, got ${normalizeAmount(raw)}`);
  }
  for (const [raw, want] of [['22 Okt 2026', '2026-10-22'], ['22 Mei 2026', '2026-05-22'], ['22 Des 2026', '2026-12-22'],
    ['22 Mrt 2026', '2026-03-22'], ['22 Agu 2026', '2026-08-22'], ['22 Dez 2026', '2026-12-22'], ['22 Mär 2026', '2026-03-22'],
    ['2 juin 2026', '2026-06-02'], ['2 juil. 2026', '2026-07-02'], ['22 Jul 2026', '2026-07-22'], ['12-Mar-2026', '2026-03-12']]) {
    ok(parseStatementDate(raw) === want, `"${raw}" reads ${want}, got ${parseStatementDate(raw)}`);
  }
  ok(inferIntervalFromKeys(['2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02', '2026-10-04']) === 14,
    'a payday that moved two days is not a 2-day cycle');
  ok(inferIntervalFromKeys(['2026-09-01', '2026-09-08', '2026-09-22']) === 7, 'a real 7-day cycle still reads 7');
}

/* ---- 9. cents, not float noise --------------------------------------- */
{
  const row = (amount, cat) => ({ date: '2026-08-10', desc: 'x', cat, amount, label: 'Cheque' });
  const t = tally(stamp([row(-762.37, 'Groceries'), row(-398.97, 'Groceries'), row(-9.66, 'Groceries'),
    row(-935.21, 'Gifts'), row(-166.61, 'Gifts'), row(1101.82, 'Gifts')],
  { catType: () => 'expense', catKnown: () => true }), LENSES.BUDGET);
  ok(t.byCat.Groceries === -1171, `three rows summing to R1 171,00 tally to exactly that, got ${t.byCat.Groceries}`);
  ok(t.byCat.Gifts === 0 && !('Gifts' in t.spendByCat), `a category refunded in full nets to 0 and is no spend slice, got ${t.byCat.Gifts}`);
  ok(t.spend === 2272.82, `gross spend in cents, got ${t.spend}`);

  const card = { name: 'Card', balance: -500, balance_updated: '2026-08-01' };
  const r = reconcile(card, [-762.37, -398.97, -9.66, 1671].map(amount => ({ date: '2026-08-10', amount })), '2026-08-20');
  ok(r.implied === 0, `a card paid to the cent implies R0, got ${r.implied}`);

  const fund = { name: 'Fund', type: 'savings', balance: 85.4, balance_updated: '2026-09-30', starting_amount: 0, inception_date: '2026-01-01' };
  const fRows = [['2026-02-01', 799.10, 'Saving'], ['2026-03-01', 4503.68, 'Saving'], ['2026-06-01', -5302.78, 'Saving'], ['2026-09-30', 85.40, 'Interest']]
    .map(([date, amount, cat]) => ({ date, amount, cat, desc: cat }));
  const tr = totalReturn(fund, fRows, c => (c === 'Interest' ? 'interest' : 'savings'), '2026-10-01');
  ok(tr && tr.capitalIn === 0 && tr.returnPct === null, `a fund emptied of its capital shows no return %, got ${tr && tr.capitalIn} / ${tr && tr.returnPct}`);
}

/* ---- 11. periods add up to their union -------------------------------
   savedFromOutside as period.js calls it (rows from PAIR_LEAD_DAYS = 14 before
   the window, countFrom = its start). Before the fix 1 380 of 20 000 random
   households disagreed; a first fix still let a pre-window inflow take an
   in-window leg (double count) — caught in review. */
{
  const { savedFromOutside } = require('../src/savings-math');
  const { isoDayNumber, isoFromDayNumber } = require('../src/dates');
  const pool = new Map([['Fund A', {}], ['Fund B', {}], ['Fund C', {}]]);
  const own = new Set(['Cheque', 'Card']);
  const funds = [...pool.keys()];
  const sortRows = rs => [...rs].sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc));
  const inRange = (rs, s0, e) => sortRows(rs.filter(r => r.date >= s0 && r.date <= e));
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const P = [['2026-09-22', '2026-10-21'], ['2026-10-22', '2026-11-21']];
  const day = d => isoFromDayNumber(isoDayNumber('2026-09-22') + d);
  let bad = 0;
  for (let t = 0; t < 10000; t++) {
    const rows = []; let k = 0;
    for (let i = 0, nTx = 1 + Math.floor(rnd() * 6); i < nTx; i++) {
      const amt = pick([500, 1000, 2000]), d = Math.floor(rnd() * 61), lag = Math.floor(rnd() * 6), kind = rnd();
      if (kind < 0.6) {
        rows.push({ date: day(d), desc: `o${k}`, amount: -amt, label: pick(['Cheque', 'Card']) });
        rows.push({ date: day(Math.min(60, d + lag)), desc: `i${k++}`, amount: amt, label: pick(funds) });
      } else if (kind < 0.85) {
        const a = pick(funds), b = pick(funds); if (a === b) continue;
        rows.push({ date: day(d), desc: `o${k}`, amount: -amt, label: a });
        rows.push({ date: day(Math.min(60, d + lag)), desc: `i${k++}`, amount: amt, label: b });
      } else {
        rows.push({ date: day(d), desc: `g${k++}`, amount: amt, label: pick(funds) });
      }
    }
    const per = P.map(([s0, e]) => savedFromOutside(inRange(rows, isoFromDayNumber(isoDayNumber(s0) - 14), e), pool, null, { ownLabels: own, regular: true, countFrom: s0 }));
    const union = savedFromOutside(inRange(rows, P[0][0], P[1][1]), pool, null, { ownLabels: own, regular: true });
    if (per[0] + per[1] !== union) bad++;
  }
  ok(bad === 0, `two consecutive periods count what one window over both counts (${bad} of 10 000 did not)`);
}

/* ---- 12. bands over income ------------------------------------------- */
{
  const f = periodFlow({ income: 100.6, spentTotal: 100.7, grossOutByCat: { Rent: 50.35, Food: 50.35 },
    spendByCat: { Rent: 50.35, Food: 50.35 }, fixedCats: ['Rent'], catType: () => 'expense' });
  const d = f.bands.display;
  ok(d.committed + d.living + d.saving - f.overspentDisplay === Math.round(f.income),
    `printed bands less Overspent equal the printed income (${d.committed}+${d.living}+${d.saving}-${f.overspentDisplay} vs ${Math.round(f.income)})`);
}

/* ---- 10-11. through the real loader ---------------------------------- */
(async () => {
  const B = 'Budget';
  const txFile = rows => '---\ntags: [finance]\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${Number(r[3]).toFixed(2)} |  |  |  |\n`).join('');
  const cat = type => `---\ntype: ${type}\ncolor: "#123456"\n---\n`;
  const mount = async (files, settings) => { const ctx = makeCtx(files, { settings }); await loadInto(ctx); return ctx; };
  {
    const ctx = await mount({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Groceries.md`]: cat('expense'),
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000\nbalance_updated: 2026-08-01\n---\n',
      [`${B}/Budgets/2026-08.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 3000.00 |  |\n| Groceries | expense | 1000.00 |  |\n',
      [`${B}/Transactions/Cheque/2026-08.md`]: txFile([['2026-08-09', 'Shop', 'Groceries', -3500]]),
    }, { month_start_day: 1 });
    const rows = ctx.budgetVsActualRows('2026-08');
    const g = rows.find(r => r.cat === 'Groceries');
    ok(g && g.budget === 4000 && !g.over, `two budget rows for one category are budgeted their sum, got ${g && g.budget}`);
  }
  {
    const files = legs => ({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Salary.md`]: cat('income'),
      [`${B}/Categories/Saving.md`]: cat('savings'),
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 35000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
      [`${B}/Accounts/Fund.md`]: '---\ntype: savings\nbalance: 1000.00\nbalance_updated: 2026-08-01\ntx_label: "Fund"\n---\n',
      [`${B}/Transactions/Cheque/2026-09.md`]: txFile([['2026-09-01', 'Salary', 'Salary', 30000], [legs[0], 'To fund', 'Saving', -2000]]),
      [`${B}/Transactions/Fund/2026-09.md`]: txFile([[legs[1], 'From cheque', 'Saving', 2000]]),
    });
    const ctx = await mount(files(['2026-09-21', '2026-09-23']), { month_start_day: 22 });
    const sep = ctx.movedToFunds('2026-09', '2026-11-03'), oct = ctx.movedToFunds('2026-10', '2026-11-03');
    ok(sep === 0 && oct === 2000, `a transfer straddling the boundary counts once, where it landed (Sep ${sep}, Oct ${oct})`);
    ok(ctx.savingContribution('2026-10', '2026-11-03') === 2000, 'and the saving rate counts it too');
  }
  console.log(`PASS math-audit-2026-11-03 — score points add up, Repaid floored, cadence on the usual day, import parsing, cents not float noise, straddling transfers counted (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
