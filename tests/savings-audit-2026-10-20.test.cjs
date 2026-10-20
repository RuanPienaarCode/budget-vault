'use strict';
/* The Savings page findings of the 20 Oct 2026 audit, each pinned on the REAL
   Savings view over the real loader, the clock fixed. Every figure is made up.

   M2-07  The growth chart's "N accounts left out" caveat gave a reason that is
          not the reason ("their growth carries no date it can be placed at").
          An account is left out for want of a starting amount or a date to
          measure from — the card's own sub-line already says so.
   D2-03  Cents beside cents. The growth legend printed whole rands under a
          cents total; the composition list and the bar totals printed whole
          rands under a cents KPI; the KPI drift line was whole under a cents
          tile.
   D2-01  Printed parts add up to the printed total they sit under: each bar's
          rows, as printed, sum to that bar's total, as printed.
   MT-11  The composition list runs in the order the bar draws its segments —
          what you own first, then what you owe, each in bar order — rather
          than one size ranking that interleaves the two.
   D1-08  Asset kinds and Debt-page types are sentence case beside "Savings"
          and "Cheque": "Vehicle", "Precious metals", "Credit card (owed)".
   D1-20  One colour per row in the composition list, and the same colour for
          a row in the light and the dark theme.
   D1-15  The Net worth tile's sentences are not glued: "…what you owe. Plus
          € 640 held in other currencies, not converted."
   D2-11  Prose dates read "Mar 1, 2027", not "2027-03-01".
   M2-08  A goal 99,6% of the way there reads 99,6% — the same rule (and the
          same label) the Accounts goal cell prints, via sharePercentLabel.

     node tests/savings-audit-2026-10-20.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
/* SOFT=1 lists every failing check instead of stopping at the first — how the
   red-before run was read. */
const soft = process.env.SOFT === '1';
const failed = [];
const guard = fn => (...a) => { try { fn(...a); } catch (e) { if (!soft) throw e; failed.push(e.message); } checks++; };
const ok = guard((c, m) => assert.ok(c, m));
const eq = guard((a, b, m) => assert.deepStrictEqual(a, b, m));

const B = 'Budget';
const TODAY = '2026-10-20';
const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => HEAD + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');
const acct = (name, fm) => ({ [`${B}/Accounts/${name}.md`]: `---\ntx_label: "${name}"\n${fm}\n---\n` });

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Interest.md`]: '---\ntype: income\ninterest: true\ncolor: "#27ae60"\n---\n',
  // Measured, drifting R250 since its stated date.
  ...acct('Fund', 'type: investment\nbalance: 11000.40\nbalance_updated: 2026-09-01\nstarting_amount: 10000.00\ninception_date: 2025-01-01'),
  [`${B}/Transactions/Fund/2025-02.md`]: tx([['2025-02-03', 'Debit order', '', 500]]),
  [`${B}/Transactions/Fund/2026-09.md`]: tx([['2026-09-15', 'Debit order', '', 250]]),
  // A goal 99,6% of the way there, with a target next year.
  ...acct('Pot', 'type: savings\nbalance: 4980.30\nbalance_updated: 2026-10-01\ngoal_amount: 5000.00\ntarget_date: 2027-03-01'),
  // No starting amount: left out of the growth chart.
  ...acct('Wrapper', 'type: investment\nbalance: 2000.00\nbalance_updated: 2026-10-01\ntotal_invested: 1500.00'),
  ...acct('Cheque', 'type: checking\nbalance: 1500.25\nbalance_updated: 2026-10-01'),
  ...acct('Euro', 'type: checking\ncurrency: "€"\nbalance: 640.00\nbalance_updated: 2026-10-01'),
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
    + '| Car | vehicle | 90000.40 | 2026-06-01 |  |\n'
    + '| Coins | precious metals | 15000.20 | 2026-06-01 |  |\n'
    + '| Stuff | household contents | 3000.00 | 2026-06-01 |  |\n',
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card | Bank | credit card | 2000.55 |  | 20.00 | 300.00 |  |  | | active | |\n'
    + '| Car loan | Bank | vehicle | 50000.00 |  | 12.00 | 2500.00 |  |  | | active | |\n',
  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid | Lent |\n'
    + '|---|---:|---|---|---|---:|---|\n| Sam | 1000.00 | Loan |  | outstanding | 0.00 | 2026-06-01 |\n',
};

const flat = n => String(n.textContent).replace(/[\s  ]+/g, ' ').trim();
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const byCls = (root, c) => descend(root).filter(n => hasCls(n, c));
/* "R 1 234,56" → 1234.56; the za mark is a comma, groups a space. */
const rands = t => Number(String(t).replace(/[^\d,-]/g, '').replace(',', '.'));
const cents = t => /\d,\d\d$/.test(String(t).replace(/[\s  ]+/g, ' ').trim());

/* A stylesheet stand-in: the light and dark readings of the sealed tokens on
   the default palette. Only --color-accent and --ink-faint move with the
   theme (src/styles.css, src/styles-presets.css); that is enough to show
   whether a row's colour is decided by the theme. */
const THEMES = {
  light: { '--color-accent': '#0d9488', '--ink-faint': '#5f6779' },
  dark: { '--color-accent': '#6ee7b7', '--ink-faint': '#7d85a7' },
};
const SEALED = { '--color-success': '#22c55e', '--color-info': '#0ea5e9', '--color-danger': '#f43f5e',
  '--color-investment': '#6f42c1', '--color-warning': '#f59e0b' };

async function render(theme) {
  const prev = global.getComputedStyle;
  const vars = { ...SEALED, ...THEMES[theme] };
  global.getComputedStyle = () => ({ getPropertyValue: k => vars[k] || '' });
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(FILES, { period: '2026-10' });
    ctx.switchView = () => {};
    ctx.renderSavings();
    return nodes;
  } finally { unpin(); global.getComputedStyle = prev; }
}

(async () => {
  const nodes = await render('light');
  const worth = nodes.get('#savingsWorth');

  /* ---- M2-07: the reason an account is left out of the growth chart ---- */
  const growth = flat(nodes.get('#savingsGrowth'));
  ok(/2 accounts left out — missing a starting amount or an opening date/.test(growth),
    `the caveat names the real reason (got "${growth}")`);
  ok(!/carries no date/.test(growth), 'and not a reason it is not');

  /* ---- D2-03: the growth legend in cents, under a cents total ---- */
  const gVals = byCls(nodes.get('#savingsGrowth'), 'dl-val').map(flat);
  ok(gVals.length >= 1 && gVals.every(cents), `every growth legend figure carries cents (got ${JSON.stringify(gVals)})`);
  ok(cents(flat(nodes.get('#savingsGrowthTotal'))), 'as the total beside it does');

  /* ---- D2-03: the KPI drift line in cents, under a cents tile ---- */
  const kpis = byCls(nodes.get('#savingsKpis'), 'mini').map(flat);
  const inv = kpis.find(t => t.startsWith('Investments'));
  ok(/Transactions since then add up to R 250,00 more/.test(inv), `the drift line is in cents (got "${inv}")`);

  /* ---- D1-15: the Net worth tile's sentences ---- */
  const net = kpis.find(t => t.startsWith('Net worth'));
  ok(/what you own minus what you owe\. Plus € 640 held in other currencies, not converted\./.test(net),
    `the two sentences are separated (got "${net}")`);
  ok(!/owe Plus/.test(net), 'not glued');

  /* ---- composition: segments in bar order, rows in list order ---- */
  const segLabels = fig => descend(worth)
    .filter(n => n.attrs && n.attrs['data-fig'] === fig)
    .map(g => descend(g).find(n => n.tagName === 'TITLE'))
    .map(t => String(t.textContent).split(':')[0]);
  const owned = segLabels('worth-owned-seg'), owedSegs = segLabels('worth-owed-seg');
  const rows = byCls(worth, 'sav-worth-btn');
  const names = rows.map(r => flat(byCls(r, 'sav-worth-name')[0]));
  const vals = rows.map(r => flat(byCls(r, 'sav-worth-val')[0]));

  /* MT-11 */
  eq(names, [...owned, ...owedSegs.map(l => `${l} (owed)`)],
    'the list runs in the bar\'s own order: what you own, then what you owe');

  /* D1-08 */
  for (const want of ['Vehicle', 'Precious metals', 'Household contents', 'Credit card (owed)', 'Vehicle (owed)']) {
    ok(names.includes(want), `"${want}" is sentence case (got ${JSON.stringify(names)})`);
  }
  ok(names.every(n => !/^[a-z]/.test(n)), 'no row starts lower case beside "Savings" and "Cheque"');

  /* D2-03 + D2-01: rows and bar totals in cents, and the rows add up to the total AS PRINTED */
  ok(vals.every(cents), `every row carries cents (got ${JSON.stringify(vals)})`);
  const total = fig => flat(descend(worth).find(n => n.attrs && n.attrs['data-fig'] === fig));
  const ownTotal = total('worth-owned-total'), oweTotal = total('worth-owed-total');
  ok(cents(ownTotal) && cents(oweTotal), `the bar totals carry cents (got "${ownTotal}", "${oweTotal}")`);
  const sum = list => Math.round(list.reduce((s, v) => s + rands(v), 0) * 100) / 100;
  eq(sum(vals.slice(0, owned.length)), rands(ownTotal), 'what you own: the rows add up to the total as printed');
  eq(sum(vals.slice(owned.length)), rands(oweTotal), 'what you owe: the rows add up to the total as printed');

  /* D1-20: one colour per row, and the same colour in both themes */
  const swatches = n => byCls(n, 'sav-worth-swatch').map(i => String(i.attrs.style || '').replace('background:', ''));
  const light = swatches(worth);
  eq(new Set(light).size, light.length, `no two rows share a swatch (got ${JSON.stringify(light)})`);
  const dark = swatches((await render('dark')).get('#savingsWorth'));
  const walked = names.map((n, i) => [n, i]).filter(([n]) => !['Investments', 'Savings', 'Cheque', 'Cash', 'Credit cards', 'Other']
    .some(k => n === k || n === `${k} (owed)`));
  ok(walked.length >= 5, 'the fixture walks asset, debt and owed-to-you rows');
  for (const [n, i] of walked) eq(dark[i], light[i], `"${n}" wears the same colour in the dark theme`);

  /* Nine non-account rows — six asset kinds, money owed to you, two debt
     types — still wear nine colours, each one a full SLICE_MIN_DISTANCE (130,
     chart.js) from every sealed account-type colour and from each other. The
     four fixed walks this replaced repeated a colour by the fifth. */
  {
    const { parseColor, colorDistance } = require('../src/chart');
    const many = { ...FILES,
      [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
        + ['property', 'vehicle', 'household contents', 'jewellery', 'precious metals', 'electronics']
          .map((k, i) => `| Thing ${i} | ${k} | ${(90000 - i * 9000).toFixed(2)} | 2026-06-01 |  |\n`).join('') };
    const prev = global.getComputedStyle;
    global.getComputedStyle = () => ({ getPropertyValue: () => '' });
    const unpin = pinClock(TODAY);
    let w2;
    try {
      const m = await mountFor(many, { period: '2026-10' });
      m.ctx.switchView = () => {};
      m.ctx.renderSavings();
      w2 = m.nodes.get('#savingsWorth');
    } finally { unpin(); global.getComputedStyle = prev; }
    const SEALED_HEX = ['#6f42c1', '#22c55e', '#0ea5e9', '#0d9488', '#f43f5e', '#5f6779'];
    const rows2 = byCls(w2, 'sav-worth-btn');
    const sw = rows2.map(r => String(byCls(r, 'sav-worth-swatch')[0].attrs.style).replace('background:', ''));
    const nm = rows2.map(r => flat(byCls(r, 'sav-worth-name')[0]));
    const walkedSw = sw.filter((c, i) => !SEALED_HEX.includes(c) && !/^(Savings|Cheque|Investments)( \(owed\))?$/.test(nm[i]));
    eq(walkedSw.length, 9, `nine non-account rows (got ${JSON.stringify(nm)})`);
    eq(new Set(walkedSw).size, 9, `nine colours (got ${JSON.stringify(walkedSw)})`);
    for (const c of walkedSw) {
      const far = SEALED_HEX.every(s => colorDistance(parseColor(c), parseColor(s)) >= 130);
      ok(far, `${c} is a full slice distance from every sealed account colour`);
      ok(walkedSw.every(o => o === c || colorDistance(parseColor(c), parseColor(o)) >= 130), `${c} is apart from the other rows`);
    }
  }

  /* ---- D2-11 + M2-08: the goal line ---- */
  const goals = flat(nodes.get('#savingsGoals'));
  ok(/99,6% · target Mar 1, 2027/.test(goals), `the goal reads 99,6% and the target as a prose date (got "${goals}")`);
  ok(!/2027-03-01/.test(goals), 'not the ISO cell');

  /* ---- D2-11: "since" on a measured card ---- */
  const fund = flat(byCls(nodes.get('#savingsSections'), 'mini')
    .find(n => String(n.children[0] && n.children[0].textContent) === 'Fund'));
  ok(/since Jan 1, 2025/.test(fund), `the opening date reads as prose (got "${fund}")`);

  if (failed.length) { console.error(failed.join('\n')); process.exit(1); }
  console.log(`PASS savings-audit-2026-10-20 (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
