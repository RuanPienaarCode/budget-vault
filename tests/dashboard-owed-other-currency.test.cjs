'use strict';
/* The Dashboard's "Owed to you" tile names what it leaves out.

   owedSummary() holds an entry in another currency OUT of `outstanding` (a
   euro is not a rand, and this vault holds no rate to convert with) and
   hands it back in `otherCurrencies` for the caller to state. The Owed page's
   own tile states it ("plus € 300 owed in other currencies"). The Dashboard
   tile called the same function and dropped the list: it read "R 1 500 ·
   2 outstanding", counting the euro loan among the two while its €300
   appeared in no figure and no sentence — the silent exclusion currency.js
   forbids. Same household, same seam, now the same disclosure, in the
   sentence shape the net-worth tile beside it already uses.

     node tests/dashboard-owed-other-currency.test.cjs */

const assert = require('assert');
const { find, textOf, renderDash } = require('./helpers/dash-audit.cjs');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const OWED_HEAD = '---\nkind: owed\n---\n\n'
  + '| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n'
  + '|---|---:|---|---|---|---:|---|---|\n';

function tile(nodes) {
  const btn = find(nodes.get('#dashPositionKpis'), n => n.attrs && n.attrs['data-fig'] === 'pos-owed')[0];
  const mini = btn && btn._parent;
  const sub = mini ? find(mini, n => n._cls && n._cls.has('s'))[0] : null;
  return { value: textOf(btn), sub: textOf(sub), say: btn ? btn.attrs['aria-label'] : '' };
}

(async () => {
  /* ---- 1. a euro loan beside a rand one ---- */
  {
    const files = {
      ...SEED,
      [`${B}/Owed Money.md`]: OWED_HEAD
        + '| Thabo | 2000.00 | Loan |  | outstanding | 500.00 | 2026-06-01 |  |\n'
        + '| Ana | 500.00 | Lisbon |  | outstanding | 200.00 | 2025-09-01 | € |\n'
        /* Paid in full: not outstanding in any currency, so not named. */
        + '| Ben | 300.00 | Paid back |  | paid | 0.00 | 2025-01-01 | € |\n',
    };
    const { nodes } = await renderDash(files, { today: '2026-10-07', period: '2026-10' });
    const t = tile(nodes);
    ok(/1[  ]500/.test(t.value), `the figure is still the rand outstanding alone: ${t.value}`);
    ok(/2 outstanding · oldest out 401 days/.test(t.sub), `the count and the age still cover every open loan: ${t.sub}`);
    ok(/Plus € 300 owed in other currencies, not converted\./.test(t.sub),
      `the tile names the euro part it leaves out: ${t.sub}`);
    ok(/Plus € 300 owed in other currencies, not converted\./.test(t.say),
      `and so does the label a screen reader is handed with the figure: ${t.say}`);
    ok(!/€ 500|€ 800/.test(t.sub), 'net of the part-payment, and the settled entry is not in it');
  }

  /* ---- 2. control: one currency, no sentence ---- */
  {
    const { nodes } = await renderDash(SEED, { today: '2026-10-07', period: '2026-10' });
    const t = tile(nodes);
    ok(!/other currencies/.test(t.sub) && !/other currencies/.test(t.say),
      `a single-currency ledger has nothing to name: ${t.sub}`);
    eq(/1 outstanding/.test(t.sub), true, 'and the tile reads as it always did');
  }

  console.log(`PASS dashboard-owed-other-currency (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
