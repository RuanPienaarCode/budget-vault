'use strict';
/* The import review prints amounts and counts the way the rest of the app
   does (2026-11-25 audit, VIS-5 and IMP-7).

   VIS-5. The review printed a row as "R -812.40", and income with no plus,
   while Transactions prints the same lines as "−R 812.40" and "+R 410.00"
   (transactions.js rowFlow; currency.js formatSigned documents −R as the form
   for a flow, "R -" as the form for a balance). The reader judging whether an
   import is right saw it in the balance form, then found it in the flow form a
   tap later.

   IMP-7. "N new" counted unticked near-duplicates, and "all N will import"
   counted duplicates and unticked rows. Both now count what commitImport
   actually writes: ticked and not a duplicate — and follow a tick as it
   changes.

     node tests/import-review-figures.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ACC = { name: 'Cheque', tx_label: 'Cheque', type: 'checking', in_budget: true };
const EUR = { name: 'Euro', tx_label: 'Euro', type: 'checking', in_budget: true, currency: '€' };
const allText = el => (el.rawText !== undefined ? el.rawText : el.textContent);
const findAll = (el, pred, out = []) => { if (pred(el)) out.push(el); for (const c of el.children || []) if (c && typeof c === 'object') findAll(c, pred, out); return out; };

(async () => {
  /* ---- VIS-5. the flow form, in the account's own symbol --------------------- */
  {
    const v = mountReview({ accounts: [ACC, EUR] });
    const p = await v.load('Date,Description,Amount\n2026-08-01,SALARY,1410.00\n2026-08-02,SHOP,-812.40\n', 'statement.csv');
    p.label = 'Cheque'; v.ctx.renderImportReview();
    const cells = findAll(v.els['#impTable'], e => e.tagName === 'TD' && /\bnum\b/.test(e.className)).map(allText);
    eq(cells, ['+R 1 410.00', '−R 812.40'], 'money in carries a plus, money out a minus BEFORE the symbol');
    const boxes = findAll(v.els['#impTable'], e => e.tagName === 'INPUT' && /^Import /.test(e.attrs['aria-label'] || ''))
      .map(e => e.attrs['aria-label'].replace(/\u00a0/g, ' '));
    ok(boxes.some(a => a.includes('−R 812.40')) && boxes.some(a => a.includes('+R 1 410.00')),
      `and the tick boxes are named with the same figure: ${boxes.join(' | ')}`);
    p.label = 'Euro'; v.ctx.renderImportReview();
    const eur = findAll(v.els['#impTable'], e => e.tagName === 'TD' && /\bnum\b/.test(e.className)).map(allText);
    eq(eur, ['+€ 1 410.00', '−€ 812.40'], 'a row bound for a euro account is printed in euros');
  }

  /* ---- IMP-7. counts that match what Import rows writes --------------------- */
  {
    const v = mountReview({ accounts: [ACC] });
    // Two months already in the vault: one exact twin, and one row the bank re-worded.
    v.ctx.S.txFiles = {
      'Cheque/2026-08': { label: 'Cheque', month: '2026-08', rows: [
        { date: '2026-08-01', desc: 'SALARY', amount: 1410, cat: '' },
        { date: '2026-08-03', desc: 'COFFEE SHOP 123', amount: -35, cat: '' },
      ] },
    };
    const rows = ['Date,Description,Amount', '2026-08-01,SALARY,1410.00', '2026-08-03,COFFEE SHOP 123 CAPE TOWN,-35.00'];
    for (let d = 0; d < 205; d++) rows.push(`2026-08-${String(4 + (d % 25)).padStart(2, '0')},SHOP ${d},-${d + 1}.00`);
    const p = await v.load(rows.join('\n'), 'statement.csv');
    p.label = 'Cheque'; v.ctx.renderImportReview();
    const writes = () => p.items.filter(i => i.include && !i.dup).length;
    const dup = p.items.find(i => i.desc === 'SALARY');
    const near = p.items.find(i => i.desc === 'COFFEE SHOP 123 CAPE TOWN');
    ok(dup.dup && !!near.near && !near.include, 'fixture: one duplicate, one unticked near-duplicate');
    eq(writes(), 205, 'fixture: Import rows would write 205');
    let stats = v.els['#impStats'].textContent;
    ok(/ 205 new /.test(stats), `"new" is what will be written, not counting the unticked near-duplicate: ${stats}`);
    ok(/all 205 will import/.test(stats), `"will import" counts neither the duplicate nor the unticked row: ${stats}`);
    // Untick one row by hand: the summary follows the tick.
    const box = findAll(v.els['#impTable'], e => e.tagName === 'INPUT' && /SHOP 0,/.test(e.attrs['aria-label'] || ''))[0];
    ok(!!box, 'fixture: the tick box of SHOP 0');
    box.checked = false; box._fire('change');
    eq(writes(), 204, 'fixture: unticked');
    stats = v.els['#impStats'].textContent;
    ok(/ 204 new /.test(stats) && /all 204 will import/.test(stats), `the summary follows a tick without a re-render: ${stats}`);
  }

  console.log(`PASS import-review-figures — the review prints flows as Transactions does and counts what Import rows writes (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
