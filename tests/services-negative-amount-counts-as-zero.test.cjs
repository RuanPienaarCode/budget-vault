'use strict';
/* A negative Amount typed into Services is kept, counts as 0 in the totals, and
   the row says so — the 7 Oct decision for Assets, Owed Money and Debts
   (tests/typed-negative-kept.test.cjs), which this page had not been given.

   monthlyEquiv() multiplied the typed Amount by the cycle factor and nothing
   floored it, so the figure typed as a typo (or as a credit) was SUBTRACTED
   from Per month and Per year: on a household paying R528 a month, typing -50
   into one row printed R279 — a 47% cut from a R50 slip — and a -96 000 printed
   "Per month R -95 671,00". The category subtotal bars took the same figure.
   Nothing on the row said the number was being used in any special way.

   The rule: keep what was typed (Amount is not a floored column — the loader
   reads a negative there as itself, as it does on Owed Money), floor it in
   the ARITHMETIC only, and say so beside the field, both when typed and when a
   hand-edited Services.md already carries one.

     node tests/services-negative-amount-counts-as-zero.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed, txt } = require('./helpers/services-page.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const all = (n, pred, out = []) => {
  for (const c of (n && n.children) || []) { if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); } }
  return out;
};
const noted = tr => /counts as 0 in the totals/.test(txt(tr));
const type = (input, value) => { input.value = value; input._fire('change', { target: input }); };

const ROWS = [
  '| Streaming | Netflix | 200.00 | monthly | 2026-10-20 | Bills | yes |  |  |',
  '| Fibre | Fastnet | 300.00 | monthly | 2026-10-01 | Bills | yes |  |  |',
  '| Gym | Fitco | 28.00 | monthly | 2026-10-05 | Health | yes |  |  |',
];

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. typed on the page ---- */
    {
      const page = await servicesPage(household({ services: ROWS }));
      eq(page.error, null, 'renders');
      ok(/R\s?528/.test(page.kpis[0]), `baseline Per month is R528 — got "${page.kpis[0]}"`);
      const { M } = page;
      const table = M.nodes.get('#svcTable');
      const input = table.querySelector('[aria-label="Amount for Gym"]');
      /* The DOM stub does not map data-* attributes onto .dataset, know
         lastElementChild, or match 'tr.type-row' — all of which
         renderServiceSubtotals (the in-place bar refresh) reads. Give the
         table and its bars those three so that path is the one measured. */
      const bars = all(table, n => n._cls && n._cls.has('type-row'));
      const queryAll = table.querySelectorAll.bind(table);
      table.querySelectorAll = sel => (sel === 'tr.type-row' ? bars : queryAll(sel));
      for (const r of bars) {
        r.dataset.cat = r.attrs['data-cat'];
        Object.defineProperty(r, 'lastElementChild', { get() { return this.children[this.children.length - 1]; } });
      }
      type(input, '-50');
      const gym = M.S.services.find(s => s.name === 'Gym');
      eq(gym.amount, -50, 'the typed figure is kept on the row, as the loader would read that cell');
      const kpis = all(M.nodes.get('#servicesKpis'), n => n._cls && n._cls.has('mini')).map(txt);
      ok(/R\s?500/.test(kpis[0]), `Per month counts the negative as 0 (R500), not R450 or R279 — got "${kpis[0]}"`);
      ok(/R\s?6[\s ,.]?000/.test(kpis[1]), `and Per year follows (R6 000) — got "${kpis[1]}"`);
      const bar = all(table, n => n._cls && n._cls.has('type-row')).find(r => txt(r).startsWith('Health'));
      ok(/R\s?0\/mo/.test(txt(bar)), `the Health subtotal bar counts it as R0/mo — got "${txt(bar)}"`);
      const row = () => all(table, n => n.tagName === 'TR' && txt(n).startsWith('Gym') && !(n._cls && n._cls.has('type-row')))[0];
      ok(noted(row()), `the row says so without a rebuild: "${txt(row())}"`);
      ok(!noted(all(table, n => n.tagName === 'TR' && txt(n).startsWith('Fibre'))[0]), 'and only on that row');
      ok(/-96000|-50/.test(M.ctx.serializeServices().split('\n').find(l => l.startsWith('| Gym'))),
        'the save writes the typed figure, not 0.00');
      type(table.querySelector('[aria-label="Amount for Gym"]'), '-96000');
      const big = all(M.nodes.get('#servicesKpis'), n => n._cls && n._cls.has('mini')).map(txt);
      ok(!/-/.test(big[0].replace(/^Per month/, '')), `a huge negative cannot print a negative Per month — got "${big[0]}"`);
      type(table.querySelector('[aria-label="Amount for Gym"]'), '30');
      eq(gym.amount, 30, 'a positive figure typed over it replaces it');
      ok(!noted(row()), 'and the note goes');
    }

    /* ---- 2. already in a hand-edited file ---- */
    {
      const page = await servicesPage(household({
        services: [ROWS[0], '| Gym | Fitco | -50.00 | weekly | 2026-10-05 | Health | yes |  |  |'],
      }));
      eq(page.error, null, 'renders a file that already carries a negative');
      ok(/R\s?200/.test(page.kpis[0]), `Per month is the other row alone (R200) — got "${page.kpis[0]}"`);
      ok(noted(rowNamed(page, 'Gym').tr), 'the row carries the note straight from the file');
      ok(!noted(rowNamed(page, 'Streaming').tr), 'the positive row does not');
    }

    /* ---- 3. other cycles floor the same way ---- */
    {
      const page = await servicesPage(household({
        services: ['| Gym | Fitco | -250.00 | weekly | 2026-10-05 | Health | yes |  |  |',
          '| Insurance | Cover | -1200.00 | annual | 2026-10-05 | Bills | yes |  |  |',
          '| Fibre | Fastnet | 300.00 | monthly | 2026-10-01 | Bills | yes |  |  |'],
      }));
      ok(/R\s?300/.test(page.kpis[0]), `weekly and annual negatives count as 0 too — got "${page.kpis[0]}"`);
    }

    console.log(`PASS services-negative-amount-counts-as-zero (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
