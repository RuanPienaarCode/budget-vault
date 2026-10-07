'use strict';
/* A Valued date in the future is "ahead of today", not "over a year old".

   reconcile.js's isStaleValuation counts a date ahead of today as not current
   (`d < 0 || d > staleDays`) — rightly: a valuation dated next year is a typo,
   and a figure resting on a typo needs a fresh number as much as an old one
   does. The Assets page's caveat, though, worded every row that rule caught
   as "over a year old", so a house valued "2027-01-01" read

     "This value is over a year old — 100% of the total."

   directly above its own row caption, "valued ahead of today". Two
   statements about one date that cannot both be true. The caveat now says
   which it is; the badge count is untouched, because a future date still
   needs a new valuation.

     node tests/assets-valued-ahead-of-today.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { SEED, B } = require('./figures/household.cjs');
global.__requestUrl = () => { throw new Error('network stubbed'); };

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const txt = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

const HEAD = '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n';

async function caveat(rows) {
  const M = await mountFor({ ...SEED, [`${B}/Assets.md`]: HEAD + rows }, { period: '2026-10', budgetFolder: B });
  M.ctx.renderAssets();
  return { M, text: txt(M.nodes.get('#assetStale')), hero: txt(M.nodes.get('#assetKpis')) };
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the one asset, dated next year ---- */
    {
      const { text, hero } = await caveat('| Polo | vehicle | 80000.00 | 2027-01-01 |  |  |\n');
      ok(!/over a year old/.test(text), `a future date is not called old: "${text}"`);
      ok(/ahead of today/.test(text), `it is called what it is: "${text}"`);
      ok(/needs a new valuation/.test(hero), `and the badge still asks for a new valuation: "${hero}"`);
    }

    /* ---- 2. one old, one ahead: each sentence for its own row ---- */
    {
      const { text } = await caveat('| Polo | vehicle | 80000.00 | 2024-01-01 |  |  |\n'
        + '| Flat | property | 900000.00 | 2027-03-01 |  |  |\n');
      ok(/1 of 2 values are over a year old/.test(text), `the old row is counted as old, alone: "${text}"`);
      ok(/1 has a Valued date ahead of today/.test(text), `and the future one as ahead of today: "${text}"`);
    }

    /* ---- 3. control: an old date reads exactly as it always did ---- */
    {
      const { text } = await caveat('| Polo | vehicle | 80000.00 | 2024-01-01 |  |  |\n');
      eq(text, 'This value is over a year old — 100% of the total.', 'the committed fixture\'s caveat is unchanged');
    }
  } finally { unpin(); }
  console.log(`PASS assets-valued-ahead-of-today (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
