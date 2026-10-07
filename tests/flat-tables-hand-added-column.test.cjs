'use strict';
/* A column a household adds to the END of one of the four flat tables is
   THEIRS — never the app's own optional Currency column.

   `currency` was appended to Assets.md, Owed Money.md, Services.md and Debts.md
   as an OPTIONAL tail (ADR-0003 append, ADR-0004): a file that never states a
   currency never grows the column, so the slot after the frozen prefix is, on
   most files on disk, simply the next free position. That is exactly where a
   household puts a column of their own. The loader read that slot by POSITION
   (`known = SCHEMAS.<t>.columns.length`) and never looked at the header, so an
   Assets.md with a sixth column headed `Insured` read every `yes`/`no` as the
   asset's currency: both assets turned "foreign", left net worth (R2 150 000 →
   R0 on the audit's synthetic fixture), and the next save renamed the
   household's header to `Currency` (2026-10-07 round-trip audit, L3-21).

   The transactions loader already guarded the identical case for Split by
   reading the file's own header (load.js), and ISSUE 69's extra-columns
   machinery already carries any column the schema does not model. The rule now
   (the owner's default): only a header cell that says `Currency` (trimmed,
   case-folded) claims the optional slot. Any other header there is a column of
   the household's own, kept verbatim through attachExtraCells/extraColsOf.
   Where the header stops short of the slot, a cell there is claimed only if no
   row writes anything in it — blank is blank in either reading, and that keeps
   files with a trailing empty cell byte-stable.

   Every fixture is synthetic. Runs the REAL loader and the REAL serializers.
     node tests/flat-tables-hand-added-column.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { worth } = require('../src/worth');
const { owedSummary } = require('../src/owed-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

/* The exact prose each view writes, so a no-change save of a fixture built from
   it is a byte-for-byte question rather than a "did the prose move" one. */
const PROSE = {
  assets: ['# Assets', '',
    'What the household owns that is not an account — property, vehicles, contents,',
    'jewellery, metals. `Value` is what it would sell for today and `Valued` is when',
    'that was last worked out. Money owed against any of these lives on the Debt page.'],
  owed: ['# Owed Money', '',
    'Money owed to the household. `status` is `outstanding` or `paid`.',
    '`Repaid` is how much has come back; `Lent` is when it went out.'],
  services: ['# Services & Subscriptions', '',
    'Recurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.'],
  debts: ['# Debts', '',
    'Money the household owes. `rate` is the annual interest rate as a percentage,',
    '`payment` the contracted monthly amount and `extra` anything paid on top of it.',
    '`status` is `active` or `paid`.'],
};
const file = (kind, table) => ['---', `kind: ${kind}`, '---', '', ...PROSE[kind], '', ...table, ''].join('\n');

const VIEW = { assets: 'assets', owed: 'owed', services: 'services', debts: 'debts' };
const SER = { assets: 'serializeAssets', owed: 'serializeOwed', services: 'serializeServices', debts: 'serializeDebts' };
const PATH = { assets: 'Assets.md', owed: 'Owed Money.md', services: 'Services.md', debts: 'Debts.md' };
const STATE = { assets: 'assets', owed: 'owed', services: 'services', debts: 'debts' };

async function mount(kind, text) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/${PATH[kind]}`]: text });
  const S = await loadInto(ctx);
  require(`../src/views/${VIEW[kind]}`)(ctx);
  return { ctx, S, rows: S[STATE[kind]], save: () => ctx[SER[kind]]() };
}

/* One hand-added column per table, each sitting exactly in the slot the
   optional Currency column would occupy: position 5, 7, 8 and 12. */
const CASES = {
  assets: {
    table: ['| Item | Kind | Value | Valued | Notes | Insured |',
      '|------|------|------:|--------|-------|---------|',
      '| House | property | 2000000.00 | 2026-03-01 |  | yes |',
      '| Car | vehicle | 150000.00 | 2026-03-01 |  | no |'],
    extra: [['yes'], ['no']],
  },
  owed: {
    table: ['| Person | Amount | Description | Due date | Status | Repaid | Lent | Phone |',
      '|--------|-------:|-------------|----------|--------|-------:|------|-------|',
      '| Sam | 250.00 | lunch | 2026-10-31 | outstanding | 0.00 | 2026-09-01 | 082 555 0101 |'],
    extra: [['082 555 0101']],
  },
  services: {
    table: ['| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Card |',
      '|------|----------|-------:|-------|--------------|----------|--------|-------|------|',
      '| Streaming | StreamCo | 199.00 | monthly | 2026-10-05 | Fun | yes |  | Visa |'],
    extra: [['Visa']],
  },
  debts: {
    table: ['| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Account no. |',
      '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|-------------|',
      '| Store card | Shop Bank | credit card | 1200.00 | 3000.00 | 21.00 | 150.00 | 0.00 | 2024-01-01 |  | active |  | 4455-01 |'],
    extra: [['4455-01']],
  },
};

(async () => {
  /* ---- 1. the household's column is not read as Currency, on any table ---- */
  for (const [kind, c] of Object.entries(CASES)) {
    const text = file(kind, c.table);
    const { rows, save } = await mount(kind, text);
    eq(rows.map(r => r.currency), rows.map(() => ''),
      `${kind}: a hand-added last column is not the Currency column — every row is in the household's currency`);
    eq(rows.map(r => r.extraCells), c.extra,
      `${kind}: …it is a column of the household's own, carried verbatim`);
    eq(save(), text, `${kind}: a no-change save gives the file back byte for byte — header name included`);
  }

  /* ---- 2. what it cost: the figures read through it ---- */
  {
    const { S } = await mount('assets', file('assets', CASES.assets.table));
    eq(worth([], [], S.assets, 'R', []).net, 2150000,
      'both assets count in net worth — "yes"/"no" are not currencies that take them out');
    const { S: So } = await mount('owed', file('owed', CASES.owed.table));
    eq(owedSummary(So.owed, '2026-10-07', 'R').outstanding, 250,
      'a phone number in the last column is not a foreign currency that hides the loan');
  }

  /* ---- 3. control: a header that SAYS Currency still claims the slot ----
     The rule reads the header, so it must still recognise the real column —
     trimmed and case-folded — or every file that does state a currency would
     lose it to the extra-columns path. */
  {
    const t = file('assets', ['| Item | Kind | Value | Valued | Notes |  currency  |',
      '|------|------|------:|--------|-------|----------|',
      '| Flat | property | 900000.00 | 2026-03-01 |  | € |']);
    const { rows } = await mount('assets', t);
    eq(rows[0].currency, '€', 'a header reading "currency" (any case, any padding) is the Currency column');
    eq(rows[0].extraCells, undefined, '…and nothing is mistaken for an extra column');

    const t2 = file('assets', ['| Item | Kind | Value | Valued | Notes | Currency | Insured |',
      '|------|------|------:|--------|-------|----------|---------|',
      '| Flat | property | 900000.00 | 2026-03-01 |  | € | yes |']);
    const m2 = await mount('assets', t2);
    eq([m2.rows[0].currency, m2.rows[0].extraCells], ['€', ['yes']],
      'a real Currency column AND a household column after it are each read as what their header says');
    eq(m2.save(), t2, 'and that file round-trips byte for byte too');
  }

  /* ---- 4. a short header: an unnamed cell with something in it is kept, never read as Currency ---- */
  {
    const t = file('assets', ['| Item | Kind | Value | Valued | Notes |',
      '|------|------|------:|--------|-------|',
      '| Boat | vehicle | 50000.00 | 2026-03-01 |  | yes |']);
    const { rows, S } = await mount('assets', t);
    eq(rows[0].currency, '', 'a cell no header names is not a currency');
    eq(rows[0].extraCells, ['yes'], '…it is carried as a cell nobody named (ISSUE 69)');
    eq(worth([], [], S.assets, 'R', []).net, 50000, '…so the boat still counts in net worth');
  }

  /* ---- 5. a short header with a trailing EMPTY cell stays byte-stable ----
     Blank reads the same either way, so the slot is left to Currency exactly as
     before and the save writes the five columns it always wrote — no blank
     column appears in the header out of nothing. */
  {
    const t = file('assets', ['| Item | Kind | Value | Valued | Notes |',
      '|------|------|------:|--------|-------|',
      '| Boat | vehicle | 50000.00 | 2026-03-01 |  |  |']);
    const { rows, save } = await mount('assets', t);
    eq(rows[0].extraCells, undefined, 'a trailing empty cell under a short header is not an extra column');
    eq(save(), file('assets', ['| Item | Kind | Value | Valued | Notes |',
      '|------|------|------:|--------|-------|',
      '| Boat | vehicle | 50000.00 | 2026-03-01 |  |']), 'and the save writes the same five columns as before');
  }

  /* ---- 6. a currency set later lands in its own column, before the household's ---- */
  {
    const { S, save } = await mount('assets', file('assets', CASES.assets.table));
    S.assets[0].currency = '$';
    const out = save();
    ok(out.includes('| Item | Kind | Value | Valued | Notes | Currency | Insured |'),
      'the Currency column is written in its own slot with its own header, the household column after it');
    ok(out.includes('| House | property | 2000000.00 | 2026-03-01 |  | $ | yes |')
      && out.includes('| Car | vehicle | 150000.00 | 2026-03-01 |  |  | no |'),
      'every row shifts its own cell along with the header, so no value changes column');
    const again = await mount('assets', out);
    eq(again.rows.map(r => [r.currency, r.extraCells]), [['$', ['yes']], ['', ['no']]],
      'reloaded, the currency and the household column are each still what they were');
    eq(again.save(), out, 'and the rewritten file is a fixed point');
  }

  console.log(`PASS flat-tables-hand-added-column (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
