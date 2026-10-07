'use strict';
/* A row stated in another currency prints its own figures in its own symbol —
   on the Owed Money page and on the Debt page, as the Assets page already
   does (views/assets.js's aMoney()).

   Owed Money.md and Debts.md gained a Currency column in ISSUE 30 (ADR-0004
   append), and both pages hold those rows OUT of their household totals and
   name them beside the figure. But each row's own figures still went through
   money(), the household formatter: a €500 loan to a relative, €200 of it
   back, showed a pill reading "R 300 left" — titled "R 500,00 lent · R 200,00
   back · R 300,00 outstanding" — directly under the tile that correctly said
   "plus € 300 owed in other currencies". A euro bond's row read "Interest
   still to pay R 29 575". A true figure under a false symbol is a claim the
   household holds rand it does not, and there is nothing on screen to
   disbelieve.

   Committed household plus one foreign row on each page; the rand rows are
   the control. Expected text is built with the page's own ctx.moneyIn, so the
   assertion is about WHICH symbol, never about the formatter's spacing.

     node tests/ledger-rows-own-currency.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
/* The repayment dialog is an Obsidian modal the harness cannot build, and
   mountFor purges src/ from the require cache before it mounts — so the stub
   is installed at the loader (see tests/debt-rate-unknown.test.cjs): any src/
   module requiring '../modal' is handed modal.js with askFields swapped. */
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
const { amortise, expectedBalance } = require('../src/debt-math');
const { debtMonthly } = require('../src/committed');
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
const rowOf = (table, name) => all(table, n => n.tagName === 'TR').find(tr => txt(tr.children[0]).startsWith(name));

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const files = {
      ...SEED,
      [`${B}/Owed Money.md`]: SEED[`${B}/Owed Money.md`]
        + '| Ana | 500.00 | Lisbon |  | outstanding | 200.00 | 2025-09-01 | € |\n',
      /* Original, start and payment chosen so the schedule disagrees with the
         balance by more than the 2% the page treats as noise — the chip that
         says so must speak euro too. */
      [`${B}/Debts.md`]: SEED[`${B}/Debts.md`]
        + '| Flat abroad | Bank E | home loan | 140000.00 | 150000.00 | 4.00 | 800.00 | 0.00 | 2022-01-01 |  | active |  | € |\n',
    };
    const M = await mountFor(files, { period: '2026-10', budgetFolder: B });
    const { ctx } = M;
    const eur = (v, dp) => ctx.moneyIn('€', v, dp);

    /* ---- Owed Money: the pill and its title ---- */
    ctx.renderOwed();
    const owedTable = M.nodes.get('#owedTable');
    const anaPill = all(rowOf(owedTable, 'Ana'), n => has(n, 'status-pill'))[0];
    eq(txt(anaPill), txt({ textContent: `${eur(300, 0)} left` }), 'the euro loan reads "€ 300 left", not "R 300 left"');
    eq(anaPill.attrs.title, `${eur(500)} lent · ${eur(200)} back · ${eur(300)} outstanding`,
      'and its title states all three in euro');
    const thaboPill = all(rowOf(owedTable, 'Thabo'), n => has(n, 'status-pill'))[0];
    eq(txt(thaboPill), txt({ textContent: `${ctx.money(1500, 0)} left` }), 'control: the rand loan still reads in rand');

    /* ---- Owed Money: the repayment dialog and its toast ---- */
    asked.length = 0;
    answer = () => ({ amount: '100' });
    const repay = all(rowOf(owedTable, 'Ana'), n => n.attrs && n.attrs['aria-label'] === 'Record a repayment from Ana')[0];
    repay._fire('click');
    await new Promise(r => setTimeout(r, 0));
    eq(asked[0].fields[0].desc, `${eur(500)} lent · ${eur(200)} back so far.`, 'the repayment dialog speaks euro');
    eq(ctx._toasts.map(t => t.msg).pop(), `${eur(100)} back from Ana`, 'and so does the toast after it');

    /* ---- Debt page: the row's projections and the schedule chip ---- */
    ctx.plugin.settings.chartDebtRange = '5y';
    ctx.renderDebts();
    const flat = M.S.debts.find(d => d.name === 'Flat abroad');
    const flatRow = rowOf(M.nodes.get('#debtTable'), 'Flat abroad');
    const a = amortise(flat.balance, flat.rate, debtMonthly(flat));
    eq(txt(flatRow.children[8]), txt({ textContent: eur(a.interest, 0) }),
      'the euro bond\'s Interest still to pay is in euro');
    const exp = expectedBalance(flat, '2026-10-07');
    ok(exp && Math.abs(flat.balance - exp.expected) > Math.max(50, flat.original * 0.02), 'fixture: the schedule chip renders');
    const chip = all(flatRow, n => has(n, 'caveat-chip-btn'))[0];
    eq(txt(chip), txt({ textContent: `on this plan it would be ${eur(exp.expected, 0)} by now` }),
      'the expected-balance chip is in euro');
    ok(chip.attrs.title.startsWith(`From ${eur(flat.original)} at 4% paying ${eur(debtMonthly(flat))} a month`),
      `and so is its explanation: ${chip.attrs.title}`);
    ok(!/R\s/.test(txt(flatRow.children[8])) && !/R\s/.test(chip.attrs.title), 'no rand symbol anywhere on the euro row');

    const cardRow = rowOf(M.nodes.get('#debtTable'), 'Card');
    const card = M.S.debts.find(d => d.name === 'Card');
    const ca = amortise(card.balance, card.rate, debtMonthly(card));
    eq(txt(cardRow.children[8]), txt({ textContent: ctx.money(ca.interest, 0) }), 'control: the rand card still reads in rand');
  } finally { unpin(); }
  console.log(`PASS ledger-rows-own-currency (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
