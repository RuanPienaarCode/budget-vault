'use strict';
/* The Dashboard and the Budget page say one thing one way (2026-10-20 audit:
   M1-02, M1-11, M1-13 / D2-09, MT-14, D2-05, D1-07 / MT-04).

   1. M1-02. "R X in refunds not taken off this figure" sits beside the GROSS
      Total spent on the hero and the Budget strip, and named the donut's gap
      instead of the refunds: the gap floors each category at zero, so a
      refund bigger than its category's spend was cut down to that spend. On
      the vault the audit ran against, one month named about a third of the
      refunds that came in. Both now name periodSummary().refunds, every
      refund in full; the donut's own "netted off" note keeps its gap, which
      is the true figure for a net split.
   2. M1-11. The same refund makes the category's Actual negative, and the
      Dashboard's budget-vs-actual bar was drawn "width:-40%", which CSS
      drops: the bar rendered empty. Widths are clamped to 0–100; the figures
      are not touched.
   3. M1-13 / D2-09. The card-cycle percentage was a bare Math.round, so a
      card at 99,75% of the income that settles it printed "100%" beside
      "R 10 of headroom". It goes through sharePercentLabel.
   4. MT-14. "{pct}% of spending budget used" was always amber on the
      Dashboard (49% with a day left read as a warning) and always plain on
      the Budget page. One rule now, both pages: plain under the near mark,
      warning from 85% (budgetRowStatus's own `near`), danger past 100%.
   5. D2-05. An expense row's Remaining printed a red "R -500,00" on the
      Dashboard and "R 500,00 over" on the Budget page; the Dashboard now
      reads the Budget page's sentences, the way income rows already shared
      incomeRemainingText.
   6. D1-07 / MT-04. The Dashboard's group rows printed raw type keys
      ("income", "expense"); they print the Budget page's localised group
      label.

   Synthetic households; every figure made up.
     node tests/dash-budget-refunds-tones-words.test.cjs */
const assert = require('assert');
const { B, tx, base, account, cat, textOf, find, hasClass, pinClock, mountFor } = require('./helpers/dash-audit.cjs');

let checks = 0;
const failures = [];
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
async function section(id, fn) {
  try { await fn(); console.log(`  ok   ${id}`); } catch (e) { failures.push(id); console.log(`  FAIL ${id}: ${e.message}`); }
}

const budgetFile = rows => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + rows.map(([c, t, a]) => `| ${c} | ${t} | ${a.toFixed(2)} |  |\n`).join('');

/* Both pages over one mount, the clock pinned while each renders. */
async function renderBoth(files, { today, period }) {
  const unpin = pinClock(today);
  try {
    const M = await mountFor(files, { period });
    M.ctx.switchView = () => {};
    M.ctx.renderDashboard();
    M.ctx.renderBudgets();
    return { ...M, t: sel => textOf(M.nodes.get(sel)) };
  } finally { unpin(); }
}
const figNode = (root, fig) => find(root, n => n.attrs && n.attrs['data-fig'] === fig)[0];
/* The Dashboard budget table's body rows, by their first cell. */
const dashRow = (M, name) => find(M.nodes.get('#dashBudget'), n => n.tagName === 'TR' && !hasClass(n, 'type-row'))
  .find(tr => (textOf(tr.children[0]) || '').startsWith(name));
const budRemaining = (M, name) => {
  const tr = find(M.nodes.get('#budTable'), n => n.tagName === 'TR' && !hasClass(n, 'type-row'))
    .find(r => (textOf(r.children[0]) || '').startsWith(name));
  return tr ? textOf(find(tr, n => hasClass(n, 'bud-remaining'))[0]) : null;
};

/* A refund bigger than its category's spend, and one smaller. */
const REFUNDS = {
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '40000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: budgetFile([['Salary', 'income', 30000], ['Groceries', 'expense', 5000], ['Phone', 'expense', 1000]]),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 30000],
    ['2026-09-02', 'Checkers', 'Groceries', -1000],
    ['2026-09-04', 'Checkers refund', 'Groceries', 3000],
    ['2026-09-05', 'Airtime', 'Phone', -500],
    ['2026-09-06', 'Airtime refund', 'Phone', 200],
  ]),
};

(async () => {
  /* ---- 1. M1-02 -------------------------------------------------------- */
  await section('M1-02 the refunds sentence names every refund, in full', async () => {
    const M = await renderBoth(REFUNDS, { today: '2026-09-20', period: '2026-09' });
    eq(M.ctx.periodSummary('2026-09').refunds, 3200, 'premise: R 3 200 of refunds came in');
    eq(Math.round(M.ctx.categoryGap('2026-09').netted), 1200, 'premise: the donut\'s gap floors Groceries at its R 1 000 of spend');
    const hero = M.t('#heroCard');
    ok(/R 3 200 in refunds not taken off this figure/.test(hero), `the hero names all of them: ${hero}`);
    const strip = textOf(figNode(M.nodes.get('#budTotalsTop'), 'bud-note-netted'));
    ok(/R 3 200 in refunds not taken off this figure/.test(strip), `so does the Budget strip: ${strip}`);
    const sub = M.t('#dashSplitSub');
    ok(/R 1 200(,00)? in refunds netted off/.test(sub), `the donut keeps its own gap, the true figure for a net split: ${sub}`);
    const { heroQualifiers } = require('../src/views/dashboard');
    const q = heroQualifiers({ used: {}, summary: { refunds: 250 }, gap: { netted: 100 } }, (v, d) => `R ${Number(v).toFixed(d)}`);
    eq(q.map(x => [x.key, x.amount]), [['netted', 250]], 'the builder the API reads names summary.refunds, not the gap');
  });

  /* ---- 2. M1-11 -------------------------------------------------------- */
  await section('M1-11 a negative Actual draws an empty bar, not a dropped one', async () => {
    const M = await renderBoth(REFUNDS, { today: '2026-09-20', period: '2026-09' });
    const row = dashRow(M, 'Groceries');
    ok(row && /R -2 000,00/.test(textOf(row)), `premise: Groceries' Actual is negative and still printed: ${row && textOf(row)}`);
    const widths = find(M.nodes.get('#dashBudget'), n => hasClass(n, 'cat-bar-fill'))
      .map(n => Number((/width:\s*(-?[\d.]+)%/.exec(n.attrs.style || '') || [])[1]));
    ok(widths.length >= 3, 'every row draws a bar');
    for (const w of widths) ok(w >= 0 && w <= 100, `every bar width is inside 0–100, got ${w}`);
    const fill = find(row, n => hasClass(n, 'cat-bar-fill'))[0];
    eq(fill.attrs.style, 'width:0%', 'the refunded category draws an empty bar');
  });

  /* ---- 3. M1-13 / D2-09 ------------------------------------------------ */
  await section('M1-13 the card-cycle percentage reads its boundary', async () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07'];
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-07-14' }),
      [`${B}/Accounts/Card.md`]: account('Card', { type: 'credit_card', settle_monthly: 'true', balance: '-3990.00', balance_updated: '2026-07-14' }),
      [`${B}/Transactions/Card/2026-07.md`]: tx([['2026-07-06', 'Checkers', 'Groceries', -3990]]),
      ...Object.fromEntries(months.map(m => [`${B}/Transactions/Cheque/${m}.md`, tx([[`${m}-25`, 'Payday', 'Salary', 4000]])])),
    };
    const M = await renderBoth(files, { today: '2026-07-15', period: '2026-07' });
    const cycle = find(M.nodes.get('#leftBody'), n => hasClass(n, 'left-cycle'))[0];
    ok(cycle, 'premise: the card is inside a settlement cycle');
    ok(/R 3 990 on the card this cycle, of the R 4 000 that settles it/.test(textOf(cycle)), `premise: 3 990 of 4 000: ${textOf(cycle)}`);
    const pct = textOf(find(cycle, n => hasClass(n, 'lc-p'))[0]);
    eq(pct, '99,8%', 'a card under the income that settles it does not read 100%');
    const bar = find(cycle, n => hasClass(n, 'lc-bar'))[0];
    ok(/99,8 percent/.test(bar.attrs['aria-label']), `the bar's label agrees: ${bar.attrs['aria-label']}`);
  });

  /* ---- 4. MT-14 -------------------------------------------------------- */
  await section('MT-14 one tone rule for "% of spending budget used"', async () => {
    const at = async spend => renderBoth({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '40000.00', balance_updated: '2026-09-01' }),
      [`${B}/Budgets/2026-09.md`]: budgetFile([['Salary', 'income', 30000], ['Groceries', 'expense', 1000]]),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-01', 'Salary', 'Salary', 30000], ['2026-09-02', 'Checkers', 'Groceries', -spend]]),
    }, { today: '2026-09-29', period: '2026-09' });
    const tones = M => {
      const dashSpan = find(M.nodes.get('#heroCard'), n => n.tagName === 'SPAN' && /of spending budget used/.test(textOf(n)))[0];
      const budSpan = figNode(M.nodes.get('#budTotalsTop'), 'bud-note-spent');
      const tone = n => ['warn', 'text-warning', 'text-danger'].filter(c => hasClass(n, c));
      return { dash: tone(dashSpan), bud: tone(budSpan), text: [textOf(dashSpan), textOf(budSpan)] };
    };
    const low = tones(await at(490));
    eq(low.text, ['49% of spending budget used', '49% of spending budget used'], 'premise: 49% used on both pages');
    eq([low.dash, low.bud], [[], []], '49% used is not a warning on either page');
    const near = tones(await at(900));
    eq([near.dash, near.bud], [['text-warning'], ['text-warning']], '90% used is the warning tone on both pages');
    const over = tones(await at(1100));
    eq([over.dash, over.bud], [['text-danger'], ['text-danger']], 'past 100% is the danger tone on both pages');
  });

  /* ---- 5. D2-05 -------------------------------------------------------- */
  await section('D2-05 the Dashboard Remaining reads the Budget page\'s sentences', async () => {
    const M = await renderBoth({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '40000.00', balance_updated: '2026-09-01' }),
      [`${B}/Budgets/2026-09.md`]: budgetFile([['Salary', 'income', 30000], ['Groceries', 'expense', 1000], ['Phone', 'expense', 1000]]),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-01', 'Salary', 'Salary', 30000],
        ['2026-09-02', 'Checkers', 'Groceries', -1500],
        ['2026-09-03', 'Airtime', 'Phone', -400],
        ['2026-09-04', 'Instalment', 'Car loan', -300],
      ]),
    }, { today: '2026-09-20', period: '2026-09' });
    const remainingCell = name => { const tr = dashRow(M, name); return tr.children[4]; };
    for (const [name, want, red] of [['Groceries', 'R 500,00 over', true], ['Phone', 'R 600,00 left', false], ['Car loan', 'R 300,00 over', true]]) {
      const td = remainingCell(name);
      eq(textOf(td), want, `${name}: the Dashboard prints the sentence`);
      eq(hasClass(td, 'text-danger'), red, `${name}: red exactly when over`);
      eq(budRemaining(M, name), want, `${name}: word for word what the Budget page prints`);
    }
  });

  /* ---- 6. D1-07 / MT-04 ------------------------------------------------ */
  await section('D1-07 the Dashboard group rows print the Budget page\'s labels', async () => {
    const files = {
      ...REFUNDS,
      [`${B}/Categories/Rent.md`]: cat('housing'),
      [`${B}/Budgets/2026-09.md`]: budgetFile([['Salary', 'income', 30000], ['Groceries', 'expense', 5000], ['Rent', 'housing', 8000]]),
    };
    const M = await renderBoth(files, { today: '2026-09-20', period: '2026-09' });
    const groups = sel => find(M.nodes.get(sel), n => n.tagName === 'TR' && hasClass(n, 'type-row')).map(n => textOf(n).trim());
    const dash = groups('#dashBudget');
    ok(dash.includes('Income') && dash.includes('Housing') && dash.includes('Everyday expenses'), `localised, sentence-case labels: ${dash.join(' | ')}`);
    ok(!dash.some(g => /^(income|housing|expense)$/.test(g)), `no raw type key: ${dash.join(' | ')}`);
    const bud = new Set(groups('#budTable'));
    for (const g of dash) ok(bud.has(g), `"${g}" is the Budget page's own label`);
  });

  if (failures.length) {
    console.error(`FAIL dash-budget-refunds-tones-words — ${failures.length} finding(s) still open: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(`PASS dash-budget-refunds-tones-words — refunds named in full, bars clamped, cycle % at its boundary, one used-% tone, one Remaining wording, localised groups (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
