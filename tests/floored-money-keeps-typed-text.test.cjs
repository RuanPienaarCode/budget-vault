'use strict';
/* A negative typed into a column the arithmetic floors at zero is kept on disk.

   `money(..., { floor: true })` clamps at READ time — Assets.md Value and
   Debts.md Balance, Original, Rate, Payment and Extra are arithmetic input to
   net worth and the payoff maths, where a negative means nothing. But the
   clamped 0 was all the row kept, so the next save of the page (an edit to any
   other row) wrote `0.00` over what the household typed: an overpaid store card
   at `-250.00` (a real credit balance) or a timeshare valued at `-500.00`
   (levies above resale) silently became 0.00 on disk (2026-10-07 round-trip
   audit, L3-11). The app correcting a figure instead of arguing with it.

   The owner's decision, and the contract the schema shares with the page
   editors: keep what was typed, clamp only in the arithmetic. The field holds the
   floored number — so every total, ratio and payoff schedule is exactly what
   it was — and `<key>Raw` holds the typed text whenever flooring changed it.
   The serializer writes `<key>Raw` back while the field still holds the value
   that text produces (the existing money()/vocab() raw contract), so an edit
   to a real figure still wins. The editors on the Owed/Assets/Debts pages are
   the other half (they set both when a negative is typed, and say beside the
   row that it counts as 0).

   Synthetic. Schema sweep plus the real loader and serializers.
     node tests/floored-money-keeps-typed-text.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SCHEMAS, rowToObject, rowLine } = require('../src/table-schema');
const { worth } = require('../src/worth');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

const FULL = {
  assets: ['Flat', 'property', '900000.00', '2026-03-01', '', ''],
  debts: ['Card', 'Bank', 'credit card', '1200.00', '3000.00', '21.00', '150.00', '0.00', '2024-01-01', '', 'active', '', ''],
};
const cellAt = (schema, row, i) => rowLine(schema, row).slice(2, -2).split(' | ')[i];

/* ---- 1. every floored column, found by asking it ---- */
for (const [name, cells] of Object.entries(FULL)) {
  const schema = SCHEMAS[name];
  const floored = schema.columns.map((c, i) => [c, i])
    .filter(([c]) => c.align === 'right' && c.read('-5')[c.key] === 0);
  eq(floored.length > 0, true, `${name}: has floored money columns to guard`);
  for (const [col, i] of floored) {
    for (const typed of ['-500.00', '-250', '-1 234,56']) {
      const row = rowToObject(schema, Object.assign([...cells], { [i]: typed }));
      eq(row[col.key], 0, `${name}.${col.key} "${typed}": the field holds the floored 0, so every total is unchanged`);
      eq(row[col.key + 'Raw'], typed, `${name}.${col.key} "${typed}": …and the typed text is kept`);
      eq(cellAt(schema, row, i), typed, `${name}.${col.key} "${typed}": …and written back as typed, never 0.00`);
      row[col.key] = 75;
      eq(cellAt(schema, row, i), '75.00', `${name}.${col.key}: a real figure typed later wins over the kept text`);
    }
    const plain = rowToObject(schema, Object.assign([...cells], { [i]: '42.50' }));
    eq(plain[col.key + 'Raw'], undefined, `${name}.${col.key}: a positive cell keeps no raw (the golden bytes)`);
    const zero = rowToObject(schema, Object.assign([...cells], { [i]: '-0.00' }));
    eq(zero[col.key + 'Raw'], undefined, `${name}.${col.key}: "-0.00" floors to nothing new and keeps no raw`);
  }
}

(async () => {
  /* ---- 2. through the real loader and serializers: L3-11's two files ---- */
  const ASSETS = ['---', 'kind: assets', '---', '', '# Assets', '',
    'What the household owns that is not an account — property, vehicles, contents,',
    'jewellery, metals. `Value` is what it would sell for today and `Valued` is when',
    'that was last worked out. Money owed against any of these lives on the Debt page.', '',
    '| Item | Kind | Value | Valued | Notes |', '|------|------|------:|--------|-------|',
    '| Timeshare | property | -500.00 | 2026-09-01 | levies exceed resale |',
    '| Car | vehicle | 80000.00 | 2026-09-01 |  |', ''].join('\n');
  const DEBTS = ['---', 'kind: debts', '---', '', '# Debts', '',
    'Money the household owes. `rate` is the annual interest rate as a percentage,',
    '`payment` the contracted monthly amount and `extra` anything paid on top of it.',
    '`status` is `active` or `paid`.', '',
    '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |',
    '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|',
    '| Store card | Shop Bank | credit card | -250.00 | 3000.00 | 21.00 | 150.00 | 0.00 | 2024-01-01 |  | active | overpaid, credit balance |',
    '| Car loan | Car Bank | vehicle | 60000.00 | 90000.00 | 11.50 | 2500.00 | 0.00 | 2023-01-01 |  | active |  |', ''].join('\n');

  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Assets.md`]: ASSETS, [`${B}/Debts.md`]: DEBTS });
  const S = await loadInto(ctx);
  require('../src/views/assets')(ctx);
  require('../src/views/debts')(ctx);

  eq([S.assets[0].value, S.assets[0].valueRaw], [0, '-500.00'], 'the timeshare holds 0 for the arithmetic and its typed text for the file');
  eq([S.debts[0].balance, S.debts[0].balanceRaw], [0, '-250.00'], 'so does the overpaid card');
  const w = worth([], S.debts, S.assets, 'R', []);
  eq([w.net, w.assets, w.liabilities], [20000, 80000, 60000],
    'net worth counts the negatives as 0, exactly as before: 80 000 owned − 60 000 owed');
  eq(ctx.serializeAssets(), ASSETS, 'a no-change save keeps "-500.00" in Assets.md');
  eq(ctx.serializeDebts(), DEBTS, 'a no-change save keeps "-250.00" in Debts.md');

  S.assets[1].notes = 'serviced';
  eq(ctx.serializeAssets().includes('| Timeshare | property | -500.00 |'), true,
    'an edit to ANOTHER row — the save the audit found overwriting it — keeps the negative too');

  console.log(`PASS floored-money-keeps-typed-text (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
