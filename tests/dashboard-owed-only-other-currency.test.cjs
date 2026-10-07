'use strict';
/* The Dashboard's "Owed to you" tile when the only money still out is in
   another currency.

   owedSummary() holds a foreign loan OUT of `outstanding` and hands it back
   in `otherCurrencies`, and the tile states that list beside its figure
   (tests/dashboard-owed-other-currency.test.cjs). With nothing outstanding in
   the household's own currency, though, the tile fell to its "nothing out"
   branch and then appended the list, so a screen reader was told

     "Nothing outstanding. Open Owed Money. Plus € 300 owed in other
      currencies, not converted."

   — a sentence that denies the money and then names it — and the sub-line
   read "R 2 000 recovered Plus € 300 owed …" under a figure of R 0. The
   figure is right (nothing is out in rand); the words have to say which
   currency "nothing" is in, and lead with what IS out.

     node tests/dashboard-owed-only-other-currency.test.cjs */

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
const flat = s => String(s).replace(/\s+/g, ' ').trim();

(async () => {
  /* ---- 1. the rand loan repaid in full, a euro loan still out ---- */
  {
    const files = {
      ...SEED,
      [`${B}/Owed Money.md`]: OWED_HEAD
        + '| Thabo | 2000.00 | Loan |  | paid | 2000.00 | 2026-06-01 |  |\n'
        + '| Ana | 500.00 | Lisbon |  | outstanding | 200.00 | 2025-09-01 | € |\n',
    };
    const { nodes, ctx } = await renderDash(files, { today: '2026-10-07', period: '2026-10' });
    const t = tile(nodes);
    const eur300 = flat(ctx.moneyIn('€', 300, 0));
    eq(flat(t.value), flat(ctx.money(0, 0)), 'the figure is still the household-currency outstanding: nothing');
    ok(!/Nothing outstanding\. Open Owed Money\./.test(t.say),
      `the label no longer denies the euro loan it then names: ${t.say}`);
    ok(!/recovered/.test(t.sub), `the sub-line leads with what is out, not with what came back: ${t.sub}`);
    eq(flat(t.sub), `Nothing outstanding in R · ${eur300} owed in other currencies, not converted · oldest out 401 days`,
      'the sub-line says which currency "nothing" is in, names the euro, and keeps the age of the loan');
    eq(flat(t.say), `Nothing outstanding in R. ${eur300} owed to you in other currencies, not converted. Open Owed Money.`,
      'and the label a screen reader is handed says the same');
  }

  /* ---- 2. control: nothing out in any currency reads as it always did ---- */
  {
    const files = {
      ...SEED,
      [`${B}/Owed Money.md`]: OWED_HEAD
        + '| Thabo | 2000.00 | Loan |  | paid | 2000.00 | 2026-06-01 |  |\n'
        + '| Ana | 500.00 | Lisbon |  | paid | 500.00 | 2025-09-01 | € |\n',
    };
    const { nodes } = await renderDash(files, { today: '2026-10-07', period: '2026-10' });
    const t = tile(nodes);
    ok(/recovered/.test(t.sub) && !/other currencies/.test(t.sub), `everything back: the recovered line, no list: ${t.sub}`);
    eq(t.say, 'Nothing outstanding. Open Owed Money.', 'and the plain label');
  }

  /* ---- 3. control: rand outstanding beside the euro loan is untouched ---- */
  {
    const files = {
      ...SEED,
      [`${B}/Owed Money.md`]: OWED_HEAD
        + '| Thabo | 2000.00 | Loan |  | outstanding | 500.00 | 2026-06-01 |  |\n'
        + '| Ana | 500.00 | Lisbon |  | outstanding | 200.00 | 2025-09-01 | € |\n',
    };
    const { nodes } = await renderDash(files, { today: '2026-10-07', period: '2026-10' });
    const t = tile(nodes);
    ok(/^2 outstanding · oldest out 401 days Plus € 300 owed in other currencies, not converted\.$/.test(flat(t.sub)),
      `the mixed case keeps the Phase-1 sentence: ${t.sub}`);
  }

  console.log(`PASS dashboard-owed-only-other-currency (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
