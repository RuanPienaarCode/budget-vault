'use strict';
/* The "Where it went" card adds up AS PRINTED (2026-10-20 audit: M1-01, M1-10,
   MT-06 / D1-14 / D2-03).

   1. M1-01. Each legend row prints Spent, a baseline (3M / prev) and Change,
      and the header says Change is Spent against that baseline — a sum the
      reader does in their head with the two figures printed beside it. The
      Spent column is allocated by largest remainder so it sums to the centre
      total, and from 2026-10-14 the Change was taken from the category's
      UNROUNDED amount instead, so a row the allocation lifted printed
      "R 1 251 · R 1 250 · R 0". The repo's own reconciliation
      (scripts/reconcile-page.cjs, "Donut legend: Change = Spent − baseline")
      fails that row, and on the vault the audit ran against it failed two.
      Change is now exactly printed Spent − printed baseline, and the
      deadband reads the same printed difference — a one-unit lift reads flat,
      because one unit between two whole-unit figures is what rounding alone
      produces.

   2. M1-10. A slice that is not nothing but whose share rounds to 0 printed
      "0%" beside its own rand figure; it prints "<1%" in the legend, the
      wedge's tooltip, the slice button's label and the chart's aria-label.

   3. MT-06 / D1-14 / D2-03. The subtitle printed "R 9 164,00 across 3
      categories" under a centre and legend in whole rands; it and its gap
      notes print whole now, the tooltip keeps its cents.

   Synthetic households; every figure made up.
     node tests/dash-donut-printed-figures.test.cjs */
const assert = require('assert');
const { B, tx, base, account, textOf, find, hasClass, renderDash } = require('./helpers/dash-audit.cjs');
const { readable } = require('./helpers/figures.cjs');

let checks = 0;
const failures = [];
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
/* Each finding is its own section, so a run before the fix names every
   finding that is still open rather than stopping at the first. */
async function section(id, fn) {
  try { await fn(); console.log(`  ok   ${id}`); } catch (e) { failures.push(id); console.log(`  FAIL ${id}: ${e.message}`); }
}

const legendRows = nodes => find(nodes.get('#dashSplit'), n => n.tagName === 'LI' && n._parent
  && hasClass(n._parent, 'donut-legend') && !hasClass(n, 'donut-legend-head'));
const cellOf = (li, cls) => find(li, n => hasClass(n, cls))[0];
const cell = (li, cls) => textOf(cellOf(li, cls));
/* "R 1 251" → 1251, "+R 1" → 1, "−R 50" → -50, "R 0" → 0. The sign is the
   glyph the page printed, the digits are the digits it printed. */
const printed = s => {
  const t = readable(s).trim();
  const n = Number(t.replace(/[^\d]/g, ''));
  return /^[−-]/.test(t) ? -n : n;
};

(async () => {
  /* ---- 1. M1-01: Change = printed Spent − printed baseline --------------- */
  await section('M1-01 Change is the difference of the two printed figures', async () => {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
    };
    /* Groceries costs the same to the cent in every period, so the TRUE change
       is nothing; its .48 is the largest fraction, so the allocation lifts it. */
    for (const mm of ['06', '07', '08']) {
      files[`${B}/Transactions/Cheque/2026-${mm}.md`] = tx([
        [`2026-${mm}-02`, 'Checkers', 'Groceries', -1250.48],
        [`2026-${mm}-02`, 'Airtime', 'Phone', -100.40],
        [`2026-${mm}-02`, 'Instalment', 'Car loan', -100.30],
      ]);
    }
    files[`${B}/Transactions/Cheque/2026-09.md`] = tx([
      ['2026-09-03', 'Checkers', 'Groceries', -1250.48],
      ['2026-09-03', 'Airtime', 'Phone', -100.40],
      ['2026-09-03', 'Instalment', 'Car loan', -100.30],
    ]);
    const { nodes } = await renderDash(files, { today: '2026-09-10' });
    const rows = legendRows(nodes);
    const groceries = rows.find(li => /Groceries/.test(cell(li, 'dl-name')));
    ok(groceries, 'the Groceries row is drawn');
    eq(cell(groceries, 'dl-val'), 'R 1 251', 'premise: the allocation lifted Spent one unit above plain rounding');
    eq(cell(groceries, 'dl-base'), 'R 1 250', 'premise: the baseline is the plain rounded average');
    eq(cell(groceries, 'dl-delta'), '+R 1', 'Change is what the reader computes from the two figures beside it');
    ok(hasClass(cellOf(groceries, 'dl-delta'), 'is-flat'), 'and a one-unit lift reads flat: rounding is not a movement');
    let compared = 0;
    for (const li of rows) {
      if (!cellOf(li, 'dl-base') || cell(li, 'dl-base') === '—') continue;
      eq(printed(cell(li, 'dl-delta')), printed(cell(li, 'dl-val')) - printed(cell(li, 'dl-base')),
        `${cell(li, 'dl-name')}: ${cell(li, 'dl-val')} − ${cell(li, 'dl-base')} = ${cell(li, 'dl-delta')}`);
      compared++;
    }
    eq(compared, 3, 'every row with a baseline was held to the sum');

    /* The deadband reads the printed difference too, on a household so small
       that neither of its proportional floors covers one unit: a period of
       R 221 (0,25% is under a rand) and a category of R 10 (3% is 30c).
       Without the one-unit rule the lift would be coloured as a rise. */
    const small = { ...base(), [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-09-01' }) };
    for (const mm of ['06', '07', '08', '09']) {
      small[`${B}/Transactions/Cheque/2026-${mm}.md`] = tx([
        [`2026-${mm}-02`, 'Checkers', 'Groceries', -200.30],
        [`2026-${mm}-02`, 'Airtime', 'Phone', -10.48],
        [`2026-${mm}-02`, 'Instalment', 'Car loan', -10.40],
      ]);
    }
    const s = await renderDash(small, { today: '2026-09-10' });
    const phone = legendRows(s.nodes).find(li => /Phone/.test(cell(li, 'dl-name')));
    eq([cell(phone, 'dl-val'), cell(phone, 'dl-base'), cell(phone, 'dl-delta')], ['R 11', 'R 10', '+R 1'],
      'premise: a R 10 category lifted to R 11 by the allocation');
    ok(hasClass(cellOf(phone, 'dl-delta'), 'is-flat'), 'reads flat, not as a rise');

    /* Control: a real movement still prints and still earns its colour. */
    const moved = { ...files };
    moved[`${B}/Transactions/Cheque/2026-09.md`] = tx([
      ['2026-09-03', 'Checkers', 'Groceries', -2250.48],
      ['2026-09-03', 'Airtime', 'Phone', -50.40],
      ['2026-09-03', 'Instalment', 'Car loan', -100.30],
    ]);
    const m = await renderDash(moved, { today: '2026-09-10' });
    const by = n => legendRows(m.nodes).find(li => new RegExp(n).test(cell(li, 'dl-name')));
    /* 2 250,48 is lifted to R 2 251 by the allocation, and the change is the
       sum of what is printed: 2 251 − 1 250. */
    eq([cell(by('Groceries'), 'dl-val'), cell(by('Groceries'), 'dl-delta')], ['R 2 251', '+R 1 001'], 'a real rise prints as a signed part');
    ok(hasClass(cellOf(by('Groceries'), 'dl-delta'), 'is-up'), 'and is coloured as one');
    eq(cell(by('Phone'), 'dl-delta'), '−R 50', 'a real fall prints with the typographic minus');
    ok(hasClass(cellOf(by('Phone'), 'dl-delta'), 'is-down'), 'and is coloured as one');
  });

  /* ---- 2. M1-10: a non-zero slice never reads 0% ------------------------- */
  await section('M1-10 a slice that is not nothing prints <1%', async () => {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-01' }),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-03', 'Checkers', 'Groceries', -9100],
        ['2026-09-03', 'Instalment', 'Car loan', -61],
        ['2026-09-03', 'Airtime', 'Phone', -3],
      ]),
    };
    const { nodes } = await renderDash(files, { today: '2026-09-10' });
    const phone = legendRows(nodes).find(li => /Phone/.test(cell(li, 'dl-name')));
    eq(cell(phone, 'dl-val'), 'R 3', 'premise: R 3 of spend');
    eq(cell(phone, 'dl-pct'), '<1%', 'its share prints <1%, not 0%');
    const btn = find(phone, n => hasClass(n, 'dl-link'))[0];
    ok(/R 3,00, <1% of spending/.test(readable(btn.attrs['aria-label'])), `the row's label agrees: ${btn.attrs['aria-label']}`);
    const svg = find(nodes.get('#dashSplit'), n => n.tagName === 'SVG')[0];
    ok(/Phone <1%/.test(readable(svg.attrs['aria-label'])), `the chart's label agrees: ${svg.attrs['aria-label']}`);
    ok(/Phone: R 3,00 · <1%/.test(textOf(svg)), `the wedge's tooltip agrees: ${textOf(svg)}`);
    ok(!/\b0%/.test(textOf(nodes.get('#dashSplit'))), 'no slice anywhere on the card reads 0%');
    /* Control: a slice with a whole percent keeps it. */
    const car = legendRows(nodes).find(li => /Car loan/.test(cell(li, 'dl-name')));
    eq(cell(car, 'dl-pct'), '1%', 'a slice that earns a whole percent prints it');
  });

  /* ---- 3. MT-06 / D1-14 / D2-03: the subtitle prints whole --------------- */
  await section('MT-06 the subtitle and its gap notes print whole rands', async () => {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-01' }),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-03', 'Checkers', 'Groceries', -9100.40],
        ['2026-09-03', 'Checkers refund', 'Groceries', 300.30],
        ['2026-09-03', 'Instalment', 'Car loan', -61.25],
        ['2026-09-03', 'Something', '', -100.60],
      ]),
    };
    const { nodes, t } = await renderDash(files, { today: '2026-09-10' });
    const sub = t('#dashSplitSub');
    ok(/^R 8 861 across 2 categories/.test(sub), `the total prints whole, as the centre does: ${sub}`);
    ok(/R 101 uncategorised, not shown/.test(sub), `the uncategorised note prints whole: ${sub}`);
    ok(/R 300 in refunds netted off/.test(sub), `the refunds note prints whole: ${sub}`);
    ok(!/\d,\d\d\b/.test(sub), `no figure in the subtitle carries cents: ${sub}`);
    const centre = textOf(find(nodes.get('#dashSplit'), n => n.tagName === 'SVG')[0]);
    ok(/R 8 861\b/.test(centre), 'the centre it sits over is the same whole figure');
    ok(/Groceries: R 8 800,10/.test(centre), 'the hover tooltip keeps its cents');
  });

  if (failures.length) {
    console.error(`FAIL dash-donut-printed-figures — ${failures.length} finding(s) still open: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(`PASS dash-donut-printed-figures — Change = printed Spent − printed baseline, <1% for a sliver, whole-rand subtitle (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
