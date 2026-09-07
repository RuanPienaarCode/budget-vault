'use strict';
/* Every label on the money-flow chart is readable and inside the plot.

   buildFlowSankey lays each row's text at its own BAND — `top + 18`, or the
   midpoint for a zero band. The bands are proportional and a real one may be a
   3-unit sliver, but the text beside it is 13px tall whatever the band does, so
   a household with two big bands and two small ones stacked its last labels on
   top of each other and pushed the final one out of the viewBox.

   Measured on a real household on 2026-09-07: income R42 813, committed 53%,
   living 47%, saving 0%, overspent 0%. "Saving" drew at y=262 and "Overspent"
   at y=284 inside a plot 280 units tall — the last row clipped away at the
   bottom edge of the card, its amount half-visible under the row above it.

   The function's own header already tells this story once, for 1.22.0, where
   four labels piled up 8px apart. That fix rescued the ALL-zero plot only, and
   this household takes the proportional branch, so the same defect came back
   through the door the fix did not cover. Hence an invariant rather than a
   third special case: whatever the proportions, no two labels may sit closer
   than a line apart, and nothing may be drawn below the viewBox.

     node tests/score-flow-labels-fit.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, dispatchedViews } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const tx = rows => HEAD + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

/* The shape that broke it: enough fixed and living spend to fill the plot, and
   a saving band that rounds to nothing beside them. `fixed: true` on Rent is
   what puts it in the committed band. */
const household = ({ rent, food, save }) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: housing\ncolor: "#aa3366"\nfixed: true\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Investing.md`]: '---\ntype: investment\ncolor: "#66aa33"\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Fund.md`]:
    '---\ntype: savings\ntx_label: "Fund"\nbalance: 1000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Budgets/2026-09.md`]:
    '---\nkind: budget\n---\n\n| Category | Type | Amount |\n|---|---|---:|\n'
    + '| Salary | income | 42813.00 |\n| Rent | housing | 22773.00 |\n| Food | expense | 20202.00 |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 42813],
    ['2026-09-01', 'Landlord', 'Rent', -rent],
    ['2026-09-02', 'Checkers', 'Food', -food],
    ...(save ? [['2026-09-02', 'To fund', 'Investing', -save]] : []),
  ]),
  ...(save ? { [`${B}/Transactions/Fund/2026-09.md`]: tx([['2026-09-02', 'From cheque', 'Investing', save]]) } : {}),
});

function walk(el, out = []) {
  out.push(el);
  for (const c of (el.children || [])) walk(c, out);
  return out;
}

async function labelsOf(files) {
  const unpin = pinClock('2026-09-02');
  try {
    const { ctx, nodes } = await mountFor(files, { period: '2026-09' });
    ctx[dispatchedViews().find(v => v.view === 'score').fn]();
    const texts = [];
    let viewBoxH = null;
    for (const [, root] of nodes) {
      for (const el of walk(root)) {
        const cls = typeof el.className === 'string' ? el.className : '';
        if (!el.getAttribute) continue;
        if (cls.includes('score-flow-sankey')) {
          const vb = el.getAttribute('viewBox');
          if (vb) viewBoxH = Number(vb.split(/\s+/)[3]);
        }
        if (/score-flow-(name|amt|caption)/.test(cls)) {
          texts.push({ cls, y: Number(el.getAttribute('y')), text: el._text || '' });
        }
      }
    }
    return { texts, viewBoxH };
  } finally { unpin(); }
}

(async () => {
  /* Three households: the one that broke, one with a small-but-real saving
     band, and one comfortably in surplus. The invariant is the same for all —
     it is a property of the layout, not of any household's numbers. */
  const cases = [
    ['overspent, two sliver bands', { rent: 22773, food: 20202, save: 0 }],
    ['a small but real saving band', { rent: 22773, food: 19702, save: 500 }],
    ['a healthy surplus', { rent: 9000, food: 8000, save: 5000 }],
  ];

  for (const [name, shape] of cases) {
    const { texts, viewBoxH } = await labelsOf(household(shape));
    ok(viewBoxH > 0, `${name}: the chart declares a viewBox height (got ${viewBoxH})`);
    ok(texts.length >= 6, `${name}: the chart drew its rows (${texts.length} text nodes)`);

    for (const t of texts) {
      ok(t.y <= viewBoxH,
        `${name}: "${t.text}" is drawn at y=${t.y}, inside the ${viewBoxH}-unit plot — nothing is clipped off the bottom`);
      ok(t.y >= 0, `${name}: "${t.text}" is not drawn above the plot (y=${t.y})`);
    }

    /* Names only: the amount shares each name's baseline by design, and the
       caption sits a fixed 16 under its own name. */
    const names = texts.filter(t => t.cls.includes('score-flow-name')).map(t => t.y).sort((a, b) => a - b);
    for (let i = 1; i < names.length; i++) {
      ok(names[i] - names[i - 1] >= 20,
        `${name}: row labels ${i - 1} and ${i} are ${(names[i] - names[i - 1]).toFixed(1)} apart — a 13px label needs a line's clearance, and they used to land 3 apart`);
    }
  }

  console.log(`score-flow-labels-fit — ${checks} checks OK`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
