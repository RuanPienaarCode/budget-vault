'use strict';
/* A debt with no stated rate is a debt whose cost is unknown — not a 0% loan.

   Debts.md's Rate column reads a blank cell as 0 (table-schema's money()),
   and the add-debt dialog pre-filled the field with '0'. The Interest tile
   has treated that 0 as UNKNOWN since 1.35.0 (health-math's
   debtInterestCoverage: "a zero rate counts as unknown"), but every
   projection on the same page took it as a real 0% loan. On a household
   carrying a R900 000 bond with the Rate left blank, the page printed:

     · the bond's row: "Interest still to pay R 0", "Clear by Sep 2034";
     · the attack order: "Bond 0.00% · R 900 000", ranked as the cheapest debt;
     · the Debt-free headline: Sep 2034, "at your recorded payments", no
       word that one debt's cost had been assumed away;
     · an expected-balance chip working the schedule forward at 0%;

   directly under a tile saying "1 has no rate". At any plausible rate the
   same payment needs about twice as long. Two figures derived by different
   rules on one page — the repo's recurring bug shape.

   The rule now: a debt whose rate is unknown (the SAME predicate the
   Interest tile uses, asked of one row) is not projected. Its row says so,
   the plan and the attack order leave it out and name it, and the Debt-free
   tile states what it excludes. Totals that do not depend on a rate (Total
   debt, Paying per month) are untouched, and a fully rated book renders
   exactly as before.

     node tests/debt-rate-unknown.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
/* askFields opens a real Obsidian modal, which the harness cannot build. The
   views destructure it from modal.js when they are required, and mountFor
   purges src/ from the require cache before every mount — so the stub is
   installed at the loader rather than on one copy of modal.js's exports: any
   src/ module requiring '../modal' is handed modal.js with askFields swapped. */
const asked = [];
let answer = () => null;
const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  const mod = realLoad.call(this, request, parent, ...rest);
  return /(^|[\\/])modal$/.test(request) && parent && /[\\/]src[\\/]/.test(parent.filename || '')
    ? { ...mod, askFields: async (_app, title, fields) => { asked.push({ title, fields }); return answer(fields); } }
    : mod;
};
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { simulate, addMonths } = require('../src/debt-math');
const { MONTHS } = require('../src/constants');
const { SEED, B } = require('./figures/household.cjs');
global.__requestUrl = () => { throw new Error('network stubbed'); };

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const all = (n, pred, out = []) => {
  for (const c of (n && n.children) || []) { if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); } }
  return out;
};
const txt = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();
const has = (n, cls) => !!(n._cls && n._cls.has(cls));

const TODAY = '2026-10-07';
const today = () => new Date(2026, 9, 7);
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
/* A projected date as the page prints it ("Sep 2034"). No trailing \b: the
   cell's text runs the date straight into its "7 yr 11 mo" caption. */
const MONTH_YEAR = new RegExp(`\\b(${MONTHS.join('|')}) \\d{4}`);

/* A bond with every field but the rate — the shape a household that does
   not have its bond statement to hand writes. Synthetic figures. */
const BOND_BLANK = '| Bond | Lender A | home loan | 900000.00 | 1000000.00 |  | 9500.00 | 0.00 | 2020-03-01 |  | active |  |  |\n';
const BOND_ZERO = '| Bond | Lender A | home loan | 900000.00 | 1000000.00 | 0.00 | 9500.00 | 0.00 | 2020-03-01 |  | active |  |  |\n';
const DEBT_HEAD = SEED[`${B}/Debts.md`].split('\n').slice(0, 6).join('\n') + '\n';

async function mount(debtsMd) {
  const files = { ...SEED, [`${B}/Debts.md`]: debtsMd };
  const M = await mountFor(files, { period: '2026-10', budgetFolder: B });
  M.ctx.plugin.settings.chartDebtRange = '5y';
  M.ctx.renderDebts();
  return M;
}

function tile(M, label) {
  const t = all(M.nodes.get('#debtKpis'), n => has(n, 'mini'))
    .find(m => txt(all(m, n => has(n, 'l'))[0]) === label);
  if (!t) return null;
  return { value: txt(all(t, n => has(n, 'v'))[0]), sub: txt(all(t, n => has(n, 's'))[0]) };
}
const rowOf = (M, name) => all(M.nodes.get('#debtTable'), n => n.tagName === 'TR')
  .find(tr => txt(tr.children[0]).startsWith(name));
/* The minimum-only run over exactly these parsed rows, as the page itself
   would label it — so the expectation is the page's own arithmetic over the
   rows it SHOULD have projected, never a figure typed into this file. */
const minimumDate = debts => {
  const run = simulate(debts.map((d, key) => ({ ...d, key })), { strategy: 'minimum' });
  return monthLabel(addMonths(run.months, today()));
};

(async () => {
  const unpin = pinClock(TODAY);
  try {
    for (const [label, bond] of [['blank', BOND_BLANK], ['0.00', BOND_ZERO]]) {
      const M = await mount(SEED[`${B}/Debts.md`] + bond);
      const card = M.S.debts.find(d => d.name === 'Card');
      eq(M.S.debts.find(d => d.name === 'Bond').rate, 0, `fixture (${label}): the loader reads the bond's Rate as 0`);

      /* ---- the bond's own row ---- */
      const tr = rowOf(M, 'Bond');
      const cells = tr.children.map(td => txt(td));
      ok(/rate unknown/.test(cells[7]), `(${label}) Clear by says the rate is unknown: "${cells[7]}"`);
      ok(!MONTH_YEAR.test(cells[7]), `(${label}) and projects no date: "${cells[7]}"`);
      eq(cells[8], '—', `(${label}) Interest still to pay is unknown, not "R 0": "${cells[8]}"`);
      eq(all(tr, n => has(n, 'debt-implied')).length, 0,
        `(${label}) no expected-balance chip works the schedule forward at 0%`);

      /* ---- the card's row is still projected ---- */
      const cardCells = rowOf(M, 'Card').children.map(td => txt(td));
      ok(MONTH_YEAR.test(cardCells[7]) && !/unknown/.test(cardCells[7]),
        `(${label}) the rated debt beside it still gets its date: "${cardCells[7]}"`);

      /* ---- the Debt-free headline: the rated debts, and what it leaves out ---- */
      const df = tile(M, 'Debt-free');
      eq(df.value, minimumDate([card]), `(${label}) Debt-free is the date for the debts that CAN be projected`);
      ok(/excludes 1 debt with no rate/.test(df.sub), `(${label}) and says what it excludes: "${df.sub}"`);

      /* ---- the plan and the attack order ---- */
      const order = all(M.nodes.get('#debtOrder'), n => n.tagName === 'LI').map(txt);
      ok(order.length === 1 && order[0].startsWith('Card'), `(${label}) the attack order ranks the rated debt only: ${JSON.stringify(order)}`);
      ok(!/(^|\D)0\.00%/.test(txt(M.nodes.get('#debtOrder'))), `(${label}) nothing is ranked at 0.00% (the card's 20.00% aside)`);
      ok(/Bond/.test(txt(M.nodes.get('#debtOrder'))) && /no rate/.test(txt(M.nodes.get('#debtOrder'))),
        `(${label}) and the order names the debt it left out: "${txt(M.nodes.get('#debtOrder'))}"`);
      const planText = txt(M.nodes.get('#debtPlan'));
      ok(/Bond/.test(planText) && /no rate/.test(planText), `(${label}) the plan names it too`);
      const minimumCard = all(M.nodes.get('#debtPlan'), n => has(n, 'debt-plan'))[0];
      ok(txt(minimumCard).includes(minimumDate([card])), `(${label}) and the minimum-only run is the rated debt's alone`);

      /* ---- the figures that never depended on a rate ---- */
      eq(tile(M, 'Total debt').value, M.ctx.money(card.balance + 900000),
        `(${label}) Total debt still counts the bond — a balance needs no rate`);
    }

    /* ---- every debt unrated: no date to give ---- */
    {
      const M = await mount(DEBT_HEAD + BOND_BLANK);
      const df = tile(M, 'Debt-free');
      eq(df.value, '—', 'with no rated debt there is no debt-free date');
      ok(/add a rate/.test(df.sub), `and the tile says what would make one: "${df.sub}"`);
      eq(all(M.nodes.get('#debtOrder'), n => n.tagName === 'LI').length, 0, 'nothing is ranked');
      ok(/rate/.test(txt(M.nodes.get('#debtPlan'))) && !MONTH_YEAR.test(txt(M.nodes.get('#debtPlan'))),
        `the plan asks for the rate instead of projecting: "${txt(M.nodes.get('#debtPlan'))}"`);
    }

    /* ---- control: a fully rated book reads exactly as it always did ---- */
    {
      const M = await mount(SEED[`${B}/Debts.md`]);
      const df = tile(M, 'Debt-free');
      eq(df.value, minimumDate(M.S.debts), 'a rated book keeps its Debt-free date');
      ok(!/excludes/.test(df.sub), `and no exclusion caveat: "${df.sub}"`);
      ok(/at your recorded payments and extras, no what-if$/.test(df.sub), 'with the caption it always had');
    }

    /* ---- the add dialog: blank is a real answer, and it means unknown ---- */
    {
      const M = await mount(SEED[`${B}/Debts.md`]);
      asked.length = 0;
      answer = () => ({ name: 'Store card', lender: 'Shop A', type: 'store account', balance: '3000', original: '',
        rate: '', payment: '300', category: '', currency: '' });
      await M.ctx.addDebt();
      const rateField = asked[0].fields.find(f => f.key === 'rate');
      eq(rateField.value, '', 'the rate field is no longer pre-filled with 0');
      ok(!M.ctx._toasts.some(t => t.bad), `a blank rate is accepted, not refused: ${JSON.stringify(M.ctx._toasts)}`);
      const added = M.S.debts.find(d => d.name === 'Store card');
      ok(added && added.rate === 0, 'and the debt is added with its rate unknown');
      ok(/rate unknown/.test(txt(rowOf(M, 'Store card').children[7])), 'which its row then says');
    }
  } finally { unpin(); }
  console.log(`PASS debt-rate-unknown (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
