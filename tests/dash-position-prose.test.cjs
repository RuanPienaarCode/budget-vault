'use strict';
/* Where you stand, What's left and the Budget strip print what they mean
   (2026-10-20 audit: D2-06, MT-05 / D1-15, D2-01, D2-11 / MT-08, MT-12,
   M2-02, D2-13, D2-12).

   1. D2-06. The Debt tile printed "R -300" in rose, against its own comment
      ("owed money reads as a positive figure") and against the Debts page,
      which treats owing as not a red state. It prints the magnitude in the
      tile's ordinary ink.
   2. MT-05 / D1-15. A tile's sub-line ran a fragment straight into the next
      sentence: "R 10 501 savings · R 5 000 invested Your stated balances
      read R 500 less." Each part is its own fact now (the hero's one-fact-
      per-line pattern), so there is always a separator between them.
   3. D2-01. Each part under a whole-rand tile was rounded on its own, so the
      parts missed the figure above them by a rand: "R 1 000 owned · R 301
      owed" under a net worth of R 700. The parts are allocated against the
      printed whole (largest remainder), so they add to it as printed. The
      Budget page's "Left to budget" is the printed income less the printed
      plan, keeping its cents when a real remainder rounds to nothing.
   4. D2-11 / MT-08. Prose dates on the Dashboard read "as of 2026-09-26",
      "due 2026-10-01", "lands on 2026-07-25" beside "ends on Oct 21". They
      go through ctx.dateText.
   5. MT-12. "R 4 210 / month" and "R 870/day" on one page: one per-unit
      form, " a month" / " a day".
   6. M2-02. The stale note under Where you stand sits under IMPLIED figures
      and said the transactions "add up to R X more", as if they were not
      already in them. It uses the "already counted" sentences.
   7. D2-13. "{owed} owed" beside an "Owed to you" tile named the opposite
      direction: it reads "{owed} you owe".
   8. D2-12. CONTEXT.md reserves "set aside" for money moved under a savings
      or investment category in a period; the earmarked-funds term reads "in
      your funds".

   Synthetic households; every figure made up.
     node tests/dash-position-prose.test.cjs */
const assert = require('assert');
const { B, tx, base, account, cat, textOf, find, hasClass, figNumber, renderDash, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const { readable } = require('./helpers/figures.cjs');

let checks = 0;
const failures = [];
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
async function section(id, fn) {
  try { await fn(); console.log(`  ok   ${id}`); } catch (e) { failures.push(id); console.log(`  FAIL ${id}: ${e.message}`); }
}
/* The whole-rand digits of every "R …" in a string, in order. */
const rands = s => [...readable(s).matchAll(/(−|-)?R (\d[\d ]*)(?![\d,])/g)].map(m => (m[1] ? -1 : 1) * Number(m[2].replace(/ /g, '')));

const DEBTS = '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start | Category | Status | Notes |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
  + '| Store card | Store | store card | 200.50 | 1000 | 21 | 100 | 0 | 2025-01-01 | Car loan | active |  |\n';
const OWED = '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n'
  + '|---|---:|---|---|---|---:|---|---|\n'
  + '| Sam | 400.00 | Loan |  | paid | 400.00 | 2026-03-01 |  |\n'
  + '| Thabo | 2000.00 | Loan |  | outstanding | 500.00 | 2026-06-01 |  |\n'
  + '| Ana | 300.00 | Trip |  | outstanding | 0.00 | 2026-05-01 | € |\n';
/* Every part carries cents that make independent rounding miss its whole. */
const POSITION = {
  ...base(),
  [`${B}/Categories/Moves.md`]: cat('transfer'),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.40', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/Card.md`]: account('Card', { type: 'credit_card', balance: '-300.60', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/Rainy.md`]: account('Rainy', { type: 'savings', balance: '10000.50', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/Shares.md`]: account('Shares', { type: 'investment', balance: '5000.50', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/Dollar.md`]: account('Dollar', { currency: '"$"', balance: '1000.00', balance_updated: '2026-09-01' }),
  /* A deposit after the stated date: the implied savings run R 500 ahead. */
  [`${B}/Transactions/Rainy/2026-09.md`]: tx([['2026-09-05', 'Top-up', 'Moves', 500]]),
  [`${B}/Debts.md`]: DEBTS,
  [`${B}/Owed Money.md`]: OWED,
};
const tileOf = (nodes, fig) => {
  const btn = find(nodes.get('#dashPositionKpis'), n => n.attrs && n.attrs['data-fig'] === fig)[0];
  const sub = btn ? find(btn._parent, n => hasClass(n, 's'))[0] : null;
  return { btn, value: textOf(btn), sub, subText: textOf(sub), facts: sub ? find(sub, n => hasClass(n, 'fact')).map(textOf) : [] };
};

(async () => {
  /* ---- 1. D2-06 -------------------------------------------------------- */
  await section('D2-06 the Debt tile prints what is owed as a positive figure, in plain ink', async () => {
    const { nodes } = await renderDash(POSITION, { today: '2026-09-20', period: '2026-09' });
    const debt = tileOf(nodes, 'pos-debt');
    eq(figNumber(nodes.get('#dashPositionKpis'), 'pos-debt'), 501, 'R 300,60 on the card + R 200,50 on the Debt page, as a magnitude');
    ok(!hasClass(debt.btn, 'text-danger'), 'and not in the danger ink');
  });

  /* ---- 2. MT-05 / D1-15 ------------------------------------------------ */
  await section('MT-05 a tile\'s sub-line keeps its sentences apart', async () => {
    const { nodes } = await renderDash(POSITION, { today: '2026-09-20', period: '2026-09' });
    const sav = tileOf(nodes, 'pos-savings');
    ok(/Your stated balances read R 500 less\./.test(sav.subText), `premise: the drift sentence is there: ${sav.subText}`);
    ok(!/invested Your/.test(sav.subText), `not glued onto the fragment before it: ${sav.subText}`);
    ok(sav.facts.length >= 2 && /invested$/.test(sav.facts[0]) && /^Your stated balances/.test(sav.facts[sav.facts.length - 1]),
      `each part is its own fact: ${JSON.stringify(sav.facts)}`);
    const net = tileOf(nodes, 'pos-net');
    ok(!/owe Plus|owed Plus/.test(net.subText), `net worth: ${net.subText}`);
    ok(net.facts.length === 2 && /^Plus \$ 1 000 · € 300 held in other currencies/.test(net.facts[1]), `its currency sentence is its own fact: ${JSON.stringify(net.facts)}`);
    const owed = tileOf(nodes, 'pos-owed');
    ok(!/days Plus/.test(owed.subText), `owed to you: ${owed.subText}`);
    ok(owed.facts.length === 2 && /^Plus € 300 owed in other currencies/.test(owed.facts[1]), `its currency sentence is its own fact: ${JSON.stringify(owed.facts)}`);
  });

  /* ---- 3. D2-01 -------------------------------------------------------- */
  await section('D2-01 the parts under a whole-rand tile add up to it as printed', async () => {
    const { nodes } = await renderDash(POSITION, { today: '2026-09-20', period: '2026-09' });
    const net = tileOf(nodes, 'pos-net');
    const [owned, owe] = rands(net.facts[0] || net.subText);
    eq(owned - owe, rands(net.value)[0], `owned − owed = net worth as printed: ${net.subText} under ${net.value}`);
    const debt = tileOf(nodes, 'pos-debt');
    const [onAccounts, onDebtPage] = rands(debt.subText);
    eq(onAccounts + onDebtPage, rands(debt.value)[0], `accounts + debt page = debt as printed: ${debt.subText} under ${debt.value}`);
    const sav = tileOf(nodes, 'pos-savings');
    const [savings, invested] = rands(sav.facts[0] || sav.subText);
    eq(savings + invested, rands(sav.value)[0], `savings + invested = the tile as printed: ${sav.subText} under ${sav.value}`);
    /* No part is pushed further than rounding can take it. */
    ok(Math.abs(savings - 10500.50) < 1 && Math.abs(invested - 5000.50) < 1, `each part within a rand of itself: ${savings}, ${invested}`);

    /* The Budget page: Left to budget is the printed income less the printed plan. */
    const budget = rows => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + rows.map(([c, t, a]) => `| ${c} | ${t} | ${a.toFixed(2)} |  |\n`).join('');
    const strip = async rows => {
      const unpin = pinClock('2026-09-20');
      try {
        const M = await mountFor({ ...base(), [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-09-01' }),
          [`${B}/Budgets/2026-09.md`]: budget(rows) }, { period: '2026-09' });
        M.ctx.switchView = () => {};
        M.ctx.renderBudgets();
        const top = M.nodes.get('#budTotalsTop');
        const v = fig => textOf(find(top, n => n.attrs && n.attrs['data-fig'] === fig)[0]);
        return { income: v('bud-income'), budgeted: v('bud-budgeted'), left: v('bud-unallocated'), all: textOf(top) };
      } finally { unpin(); }
    };
    const s = await strip([['Salary', 'income', 24000.40], ['Groceries', 'expense', 8000.30], ['Phone', 'expense', 7999.30]]);
    eq([s.income, s.budgeted], ['R 24 000', 'R 16 000'], 'premise: the two tiles it is the difference of');
    eq(s.left, 'R 8 000', `Left to budget is 24 000 − 16 000 as printed, not the rounded 8 000,80: ${s.all}`);
    const c = await strip([['Salary', 'income', 1000.30], ['Groceries', 'expense', 1000.10]]);
    eq(c.left, 'R 0,20', 'a real remainder that rounds to nothing keeps its cents');
  });

  /* ---- 4. D2-11 / MT-08 ------------------------------------------------ */
  await section('D2-11 prose dates read as dates, not ISO keys', async () => {
    const svc = '---\nkind: services\n---\n\n'
      + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
      + '|---|---|---:|---|---|---|---|---|---|\n'
      + '| Gym | GymCo | 300.00 | monthly |  | Bills | yes |  |  |\n'
      + '| Stream | StreamCo | 100.00 | monthly |  | Bills | yes |  |  |\n';
    const files = {
      ...base(),
      [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Bills.md`]: cat('expense'),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-10' }),
      [`${B}/Services.md`]: svc,
      [`${B}/Transactions/Cheque/2026-07.md`]: tx([['2026-07-01', 'GYMCO DEBIT', 'Bills', -300], ['2026-07-15', 'STREAMCO', 'Bills', -100]]),
      [`${B}/Transactions/Cheque/2026-08.md`]: tx([['2026-08-01', 'GYMCO DEBIT', 'Bills', -300], ['2026-08-15', 'STREAMCO', 'Bills', -100]]),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-01', 'GYMCO DEBIT', 'Bills', -300], ['2026-09-15', 'STREAMCO', 'Bills', -100], ['2026-09-26', 'Corner shop', 'Groceries', -200]]),
    };
    const { t } = await renderDash(files, { today: '2026-10-07' });
    const left = t('#leftBody');
    ok(/as of Sep 26/.test(left), `the cash figure's date: ${left}`);
    ok(/due Oct 1 — not imported yet/.test(left), `a held order's date: ${left}`);
    ok(/expected Oct 15/.test(left), `an expected order's date: ${left}`);
    ok(!/\d{4}-\d{2}-\d{2}/.test(left), `no ISO key anywhere in the card's prose: ${left}`);

    const months = ['2026-04', '2026-05', '2026-06', '2026-07'];
    const card = await renderDash({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-07-14' }),
      [`${B}/Accounts/Card.md`]: account('Card', { type: 'credit_card', settle_monthly: 'true', balance: '-500.00', balance_updated: '2026-07-14' }),
      [`${B}/Transactions/Card/2026-07.md`]: tx([['2026-07-06', 'Checkers', 'Groceries', -500]]),
      ...Object.fromEntries(months.map(m => [`${B}/Transactions/Cheque/${m}.md`, tx([[`${m}-25`, 'Payday', 'Salary', 4000]])])),
    }, { today: '2026-07-15', period: '2026-07' });
    const cycle = card.t('#leftBody');
    ok(/on the card this cycle/.test(cycle), `premise: a settlement cycle: ${cycle}`);
    ok(!/\d{4}-\d{2}-\d{2}/.test(cycle), `the settlement and payday dates read as dates: ${cycle}`);
    ok(/Jul 25|Aug 25/.test(cycle), `named by month and day: ${cycle}`);
  });

  /* ---- 5. MT-12 -------------------------------------------------------- */
  await section('MT-12 one per-unit form: "a month", "a day"', async () => {
    const { t } = await renderDash(POSITION, { today: '2026-09-20', period: '2026-09' });
    const left = t('#leftBody');
    ok(/R [\d ]+ a day/.test(left), `the per-day rate: ${left}`);
    ok(!/\/day|\/ day/.test(left), 'never "/day"');
    const i18n = require('../src/i18n');
    i18n.setLanguage('en');
    eq(readable(i18n.t('dash.health.perMonth', { amount: 'R 4 210' })), 'R 4 210 a month', 'the health card\'s monthly figure');
    eq(readable(i18n.t('dash.left.perDay', { amount: 'R 870' })), 'R 870 a day', 'the what\'s-left daily figure');
  });

  /* ---- 6. M2-02 -------------------------------------------------------- */
  await section('M2-02 the stale note says the movement is already in the figures', async () => {
    const { t } = await renderDash({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-06-01' }),
      [`${B}/Transactions/Cheque/2026-06.md`]: tx([['2026-06-15', 'Checkers', 'Groceries', -200]]),
    }, { today: '2026-09-20', period: '2026-09' });
    const note = t('#dashStale');
    ok(/Transactions since then take off R 200, already counted in these figures\./.test(note), `the implied-basis sentence: ${note}`);
    ok(!/add up to/.test(note), 'not the stated-basis one');
  });

  /* ---- 7. D2-13 / 8. D2-12 --------------------------------------------- */
  await section('D2-13 the net-worth sub-line says which way the debt runs', async () => {
    const { nodes } = await renderDash(POSITION, { today: '2026-09-20', period: '2026-09' });
    const net = tileOf(nodes, 'pos-net');
    ok(/owned · R [\d ]+ you owe$/.test(net.facts[0] || ''), `"you owe": ${net.subText}`);
  });
  await section('D2-12 earmarked fund balances are "in your funds", not "set aside"', async () => {
    const { nodes } = await renderDash({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-09-18' }),
      [`${B}/Accounts/Rainy.md`]: account('Rainy', { type: 'savings', emergency_fund: 'true', balance: '4000.00', balance_updated: '2026-09-18' }),
    }, { today: '2026-09-20', period: '2026-09' });
    const tile = find(nodes.get('#leftBody'), n => hasClass(n, 'is-earmarked'))[0];
    ok(tile, 'premise: the earmark term is drawn');
    eq(textOf(find(tile, n => hasClass(n, 'll'))[0]), 'in your funds', 'the term\'s label');
    const bar = find(nodes.get('#leftBody'), n => hasClass(n, 'left-bar'))[0];
    ok(/is in your funds/.test(readable(bar.attrs['aria-label'])) && !/set aside/.test(readable(bar.attrs['aria-label'])),
      `the bar's label names it the same way: ${bar.attrs['aria-label']}`);
  });

  /* The Score lane's wording, carried onto the Dashboard tiles that print the
     same figures (2026-10-20 audit, alignment with L2): the emergency-fund
     earmarks are "in your emergency funds", the health shares are "of budget
     income" — the base both divide by. */
  await section('L2 alignment: the health tiles word their figures as the Score does', async () => {
    const i18n = require('../src/i18n');
    i18n.setLanguage('en');
    eq(readable(i18n.t('dash.health.monthsMeta', { count: 6, amount: 'R 14 500' })), 'Goal 6 months · R 14 500 in your emergency funds', 'the emergency-fund tile');
    ok(/in your emergency funds/.test(i18n.t('dash.health.meterTip', { count: 6, earmarked: 'R 1', goal: 'R 2' })), 'its meter label');
    eq(i18n.t('dash.health.savings'), 'of budget income saved on average', 'the saving tile names its base');
    eq(i18n.t('dash.health.debt'), 'of budget income to debt interest on average', 'the debt tile names its base');
  });

  if (failures.length) {
    console.error(`FAIL dash-position-prose — ${failures.length} finding(s) still open: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(`PASS dash-position-prose — debt as a magnitude, facts kept apart, parts add to the printed whole, prose dates, one per-unit form, implied-basis stale note, "you owe", "in your funds" (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
