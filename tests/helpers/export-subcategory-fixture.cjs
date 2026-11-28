'use strict';
/* Synthetic transaction rows for tests/export-subcategory.test.cjs, shaped as
   the loader hands them over (src/load.js): one of each thing a transaction
   export has to get right, with a subcategory on some and not others.

   - a subcategory containing a comma and one that opens with a formula
     character, so the CSV's own escape and formula guard are what is tested
   - a subcategory on a row with NO category (a hand-edited cell: ADR-0010
     section 1 says a row with no category has none), which must read blank
   - an excluded row in another currency, and a split parent with its parts,
     so the columns that already exist are all populated around the new one
   - a pipe in a Description and a Note, which Markdown must not let split a cell
   - a Description that opens with "=" (the formula guard on text cells). */
const ROWS = [
  { date: '2026-09-01', desc: 'Engen', label: 'Cheque', cat: 'Car', amount: -500, excluded: false, note: '', split: '', subcategory: 'Fuel' },
  { date: '2026-09-02', desc: '=SUM(A1)', label: 'Cheque', cat: 'Car', amount: -65.5, excluded: false, note: '', split: '', subcategory: 'Tolls, e-tag' },
  { date: '2026-09-03', desc: 'Servicing | full', label: 'Cheque', cat: 'Car', amount: -900, excluded: false, note: 'a|b', split: '' },
  { date: '2026-09-04', desc: 'Cash', label: 'Cheque', cat: '', amount: -300, excluded: false, note: '', split: '', subcategory: 'Ghost' },
  { date: '2026-09-05', desc: 'Rent Berlin', label: 'Euro Savings', cat: 'Home', amount: -900, excluded: true, note: 'moved', split: '', subcategory: '@levy' },
  { date: '2026-09-06', desc: 'Takealot', label: 'Cheque', cat: 'Home', amount: -300, excluded: false, note: '', split: 'parent' },
  { date: '2026-09-06', desc: 'Takealot kettle', label: 'Cheque', cat: 'Home', amount: -200, excluded: false, note: '', split: 'part', subcategory: 'Kitchen' },
  { date: '2026-09-06', desc: 'Takealot lamp', label: 'Cheque', cat: 'Home', amount: -100, excluded: false, note: '', split: 'part' },
];
const clone = rows => rows.map(r => ({ ...r }));
/* The same rows as a book that has no subcategory anywhere. */
const withoutSubcategories = rows => clone(rows).map(r => { delete r.subcategory; return r; });
const symbolFor = r => (r.label === 'Euro Savings' ? '€' : 'R');
const money = (v, r) => `${r && r.label === 'Euro Savings' ? '€' : 'R'} ${Number(v).toFixed(2)}`;
const META = { range: '2026-09', filters: ['category Car'], generated: '2026-10-01 12:00', household: 'R' };
module.exports = { ROWS, clone, withoutSubcategories, symbolFor, money, META };
