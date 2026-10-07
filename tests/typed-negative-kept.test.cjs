'use strict';
/* A negative typed into an Assets value, an Owed amount or a Debt figure is
   kept — and the row says it counts as 0. Every total stays exactly as it was.

   The three editors floored what was typed with Math.max(0, v), wrote nothing
   to say so, and left the field showing the text the reader typed while the
   model and the next save held 0.00: a Value of -96000 went to disk as 0.00
   over a stated 96 000, an Owed amount of -450 as 0.00, a Debt payment of -250
   as 0.00. A credit balance on an overpaid card (Balance -250) is a real thing
   to write down, and the app silently correcting it is the opposite of this
   repo's rule — the app argues, it never silently corrects.

   The owner's decision (2026-10-07): keep what was typed, clamp only in the
   arithmetic, and say so beside the field. Each editor now leaves exactly the
   state the LOADER produces for the cell the serializer will write, so a
   figure means the same thing before and after a reload:

     · Assets Value and the four Debt figures are floored columns
       (table-schema's money(…, { floor: true })): the field holds the floored
       0 every total reads, and `<key>Raw` holds the typed text, which the
       serializer writes back while the field still holds that 0 (CONTRACT 2 —
       the tables lane keeps the raw on the READ side).
     · Owed Amount is not a floored column — the loader has always read a
       negative there as itself, and owed-math floors it in the arithmetic —
       so the editor keeps the typed number in the field, as a reload would.

   The rows show the typed figure and a note: "counts as 0 in the totals"
   (a rate: "counts as no rate", since a rate of 0 is unknown — see
   tests/debt-rate-unknown.test.cjs).

     node tests/typed-negative-kept.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const modal = require('../src/modal');
let answer = () => null;
modal.askFields = async (_app, _title, fields) => answer(fields);
const { makeDom } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');
const { typedBelowZero, assetTotal, worth } = require('../src/worth');
const { owedSummary } = require('../src/owed-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const all = (n, pred, out = []) => {
  for (const c of (n && n.children) || []) { if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); } }
  return out;
};
const txt = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const ASSETS = '---\nkind: assets\n---\n\n# Assets\n\n| Item | Kind | Value | Valued | Notes |\n| --- | --- | --- | --- | --- |\n'
  + '| Gold coins | precious metals | 96000.00 | 2026-01-01 |  |\n'
  + '| House | property | 1500000.00 | 2026-01-01 |  |\n';
const OWED = '---\nkind: owed\n---\n\n# owed\n\n| Person | Amount | Description | Due date | Status | Repaid | Lent |\n| --- | --- | --- | --- | --- | --- | --- |\n'
  + '| Sam | 450.00 | Split dinner |  | outstanding | 0.00 | 2026-08-10 |\n'
  + '| Lee | 1000.00 | Tickets |  | outstanding | 0.00 | 2026-09-01 |\n';
const DEBTS = '---\nkind: debts\n---\n\n# debts\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
  + '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
  + '| Store card | Shop A | store account | 3200.00 | 3200.00 | 25.50 | 250.00 | 0.00 | 2025-06-01 |  | active |  |\n';

async function mount(view, files) {
  const ctx = makeCtx({ 'Budget/Settings.md': SETTINGS, ...files });
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root');
  require(`../src/views/${view}`)(ctx);
  return { ctx, S, $, nodes };
}
const type = (input, value) => { input.value = value; input._fire('change', { target: input }); };
const lineOf = (text, start) => text.split('\n').find(l => l.startsWith(start));

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the rule, pure ---- */
    eq(typedBelowZero({ value: 0, valueRaw: '-96000' }, 'value'), -96000, 'a floored cell reads its typed text');
    eq(typedBelowZero({ amount: -450 }, 'amount'), -450, 'an unfloored one reads itself');
    eq(typedBelowZero({ value: 0, valueRaw: '12 000 R' }, 'value'), null, 'unreadable text is not a negative');
    eq(typedBelowZero({ value: 500 }, 'value'), null, 'nor is a positive figure');
    eq(typedBelowZero({ value: 0 }, 'value'), null, 'nor a stated zero');
    eq(typedBelowZero({ balance: 0, balanceRaw: '(250)' }, 'balance'), -250, 'every form normalizeAmount reads as negative counts');

    /* ---- 2. Assets: Value ---- */
    {
      const { ctx, S, $ } = await mount('assets', { 'Budget/Assets.md': ASSETS });
      ctx.renderAssets();
      const totalIfZero = assetTotal(S.assets.map(a => (a.name === 'Gold coins' ? { ...a, value: 0 } : a)), 'R');
      const input = $('#assetTable').querySelector('[aria-label="Value of Gold coins"]');
      type(input, '-96000');
      const gold = S.assets.find(a => a.name === 'Gold coins');
      eq([gold.value, gold.valueRaw], [0, '-96000'], 'the field holds the floored 0 and the raw holds what was typed');
      eq(assetTotal(S.assets, 'R'), totalIfZero, 'the total is exactly what a typed 0 would give');
      eq(worth([], [], S.assets, 'R', []).ownedAssets, totalIfZero, 'and so is net worth\'s asset side');
      eq(input.value, '-96000', 'the field still shows what was typed');
      const row = () => all($('#assetTable'), n => n.tagName === 'TR').find(tr => txt(tr).startsWith('Gold coins'));
      ok(/counts as 0 in the totals/.test(txt(row())), `the row says so, without a rebuild: "${txt(row())}"`);
      ok(!noted(all($('#assetTable'), n => n.tagName === 'TR').find(tr => txt(tr).startsWith('House'))), 'only on that row');

      eq(lineOf(ctx.serializeAssets(), '| Gold coins'), '| Gold coins | precious metals | -96000 | 2026-01-01 |  |',
        'the save writes the typed figure, not 0.00');
      ctx.renderAssets();
      const redrawn = $('#assetTable').querySelector('[aria-label="Value of Gold coins"]');
      eq(redrawn.attrs.value, '-96000', 'a redraw shows the typed figure, not a blank');
      ok(/counts as 0 in the totals/.test(txt(row())), 'and the note');

      /* Through the REAL loader: the cell reads back to the same floored 0,
         so every total after a reload is the one before it. (Whether the
         loader also keeps the raw on read is CONTRACT 2's other half, the
         tables lane's — asserted there, not here.) */
      const reloaded = makeCtx({ 'Budget/Settings.md': SETTINGS, 'Budget/Assets.md': ctx.serializeAssets() });
      const S2 = await loadInto(reloaded);
      eq(S2.assets.find(a => a.name === 'Gold coins').value, 0, 'the saved file loads back as the same floored 0');
      eq(assetTotal(S2.assets, 'R'), totalIfZero, 'so the total survives the round trip unchanged');

      type(redrawn, '5000');
      eq([gold.value, gold.valueRaw], [5000, null], 'a positive figure typed over it supersedes the raw');
      ok(!/counts as 0/.test(txt(row())), 'and the note goes');
    }

    /* ---- 3. Owed Money: Amount ---- */
    {
      const { ctx, S, $ } = await mount('owed', { 'Budget/Owed Money.md': OWED });
      ctx.renderOwed();
      const ifZero = owedSummary(S.owed.map(o => (o.person === 'Sam' ? { ...o, amount: 0 } : o)), '2026-10-07', 'R');
      const input = $('#owedTable').querySelector('[aria-label="Amount for Sam"]');
      type(input, '-450');
      const sam = S.owed.find(o => o.person === 'Sam');
      eq([sam.amount, sam.amountRaw], [-450, null], 'the field keeps the typed number, exactly as the loader reads that cell');
      const s = owedSummary(S.owed, '2026-10-07', 'R');
      eq([s.outstanding, s.recovered, s.open], [ifZero.outstanding, ifZero.recovered, ifZero.open],
        'outstanding, recovered and the open count are exactly what a typed 0 would give');
      eq(worth([], [], [], 'R', S.owed).ownedOwed, worth([], [], [], 'R', S.owed.map(o => ({ ...o, amount: o.person === 'Sam' ? 0 : o.amount }))).ownedOwed,
        'and so is net worth\'s receivable');
      const row = () => all($('#owedTable'), n => n.tagName === 'TR').find(tr => txt(tr).startsWith('Sam'));
      ok(/counts as 0 in the totals/.test(txt(row())), `the row says so: "${txt(row())}"`);
      eq(lineOf(ctx.serializeOwed(), '| Sam'), '| Sam | -450.00 | Split dinner |  | outstanding | 0.00 | 2026-08-10 |',
        'the save writes the typed figure, not 0.00');
      const reloaded = makeCtx({ 'Budget/Settings.md': SETTINGS, 'Budget/Owed Money.md': ctx.serializeOwed() });
      const S2 = await loadInto(reloaded);
      eq(S2.owed.find(o => o.person === 'Sam').amount, -450, 'it loads back as itself');
      const s2 = owedSummary(S2.owed, '2026-10-07', 'R');
      eq([s2.outstanding, s2.recovered, s2.open], [s.outstanding, s.recovered, s.open], 'with the same totals');
      ctx.renderOwed();
      eq($('#owedTable').querySelector('[aria-label="Amount for Sam"]').attrs.value, '-450', 'a redraw shows the typed figure');
      ok(/counts as 0 in the totals/.test(txt(row())), 'and the note');
    }

    /* ---- 4. Debts: Balance, Rate, Payment, Extra ---- */
    {
      const { ctx, S, $, nodes } = await mount('debts', { 'Budget/Debts.md': DEBTS });
      $('#debtExtra').value = ''; $('#debtStrategy').value = 'avalanche';
      ctx.renderDebts();
      const field = label => $('#debtTable').querySelector(`[aria-label="${label} Store card"]`);
      type(field('Balance owed on'), '-250');
      type(field('Annual interest rate on'), '-5');
      type(field('Monthly payment on'), '-100');
      type(field('Extra paid each month on'), '-20');
      const d = S.debts[0];
      eq([d.balance, d.balanceRaw, d.rate, d.rateRaw, d.payment, d.paymentRaw, d.extra, d.extraRaw],
        [0, '-250', 0, '-5', 0, '-100', 0, '-20'], 'each field holds its floored 0 and its raw holds what was typed');
      ok(nodes.get('#debtKpis').textContent.includes('Debt-free'), 'the totals render');
      const row = () => all($('#debtTable'), n => n.tagName === 'TR').find(tr => txt(tr.children[0]).startsWith('Store card'));
      eq((txt(row()).match(/counts as 0 in the totals/g) || []).length, 3,
        'balance, payment and extra each say they count as 0');
      ok(/counts as no rate/.test(txt(row().children[2])), `the rate says it counts as no rate: "${txt(row().children[2])}"`);
      eq(lineOf(ctx.serializeDebts(), '| Store card'),
        '| Store card | Shop A | store account | -250 | 3200.00 | -5 | -100 | -20 | 2025-06-01 |  | active |  |',
        'the save writes all four typed figures, not 0.00');
      ctx.renderDebts();
      eq(['Balance owed on', 'Annual interest rate on', 'Monthly payment on', 'Extra paid each month on'].map(l => field(l).attrs.value),
        ['-250', '-5', '-100', '-20'], 'a redraw shows every typed figure');
      const reloaded = makeCtx({ 'Budget/Settings.md': SETTINGS, 'Budget/Debts.md': ctx.serializeDebts() });
      const S2 = await loadInto(reloaded);
      const d2 = S2.debts[0];
      eq([d2.balance, d2.rate, d2.payment, d2.extra], [0, 0, 0, 0], 'the saved file loads back to the same floored zeros the totals read');
      type(field('Balance owed on'), '900');
      eq([d.balance, d.balanceRaw], [900, null], 'a positive figure typed over it supersedes the raw');
    }

    /* ---- 5. the three add dialogs keep what was typed too ---- */
    {
      const A = await mount('assets', { 'Budget/Assets.md': ASSETS });
      answer = () => ({ name: 'Timeshare', type: 'property', value: '-500', valued: '2026-09-01', currency: '' });
      await A.ctx.addAsset();
      const ts = A.S.assets.find(a => a.name === 'Timeshare');
      eq([ts.value, ts.valueRaw], [0, '-500'], 'New asset: a negative value is kept, not silently zeroed');

      const O = await mount('owed', { 'Budget/Owed Money.md': OWED });
      answer = () => ({ person: 'Kim', amount: '-50', currency: '' });
      await O.ctx.addOwed();
      eq(O.S.owed.find(o => o.person === 'Kim').amount, -50, 'New owed entry: likewise');

      const D = await mount('debts', { 'Budget/Debts.md': DEBTS });
      D.$('#debtExtra').value = ''; D.$('#debtStrategy').value = 'avalanche';
      answer = () => ({ name: 'Old card', lender: 'Bank B', type: 'credit card', balance: '-250', original: '',
        rate: '20', payment: '-10', category: '', currency: '' });
      await D.ctx.addDebt();
      const oc = D.S.debts.find(x => x.name === 'Old card');
      eq([oc.balance, oc.balanceRaw, oc.payment, oc.paymentRaw, oc.rate], [0, '-250', 0, '-10', 20],
        'New debt: likewise, and a positive rate is untouched');
    }
  } finally { unpin(); }
  console.log(`PASS typed-negative-kept (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });

function noted(tr) { return /counts as 0 in the totals/.test(txt(tr)); }
