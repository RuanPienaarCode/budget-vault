'use strict';
/* A yes/no cell the household filled in with their OWN word keeps the word,
   and the word means what it says.

   Two flat-file columns were two-valued without the raw-text contract every
   other closed vocabulary in table-schema.js carries (money(), vocab(),
   vocabSet()):

   - Services.md `Active` read "anything but `no` is active" and wrote
     `r.active ? 'yes' : 'no'`. A household that typed `cancelled` or `paused`
     had the service counted as committed spending on the Dashboard, and the
     next save — an edit to any other row — wrote `yes` over their word
     (2026-10-07 round-trip audit, L3-09).
   - A transaction's `Excluded` read true for exactly `yes`. A hand-typed `x`
     or `true` loaded as NOT excluded — on the audit's fixture a R10 500
     windfall went back into income — and the next write of the month erased
     the mark to '' (L3-10, the schema half).

   Both now read a small vocabulary — the truthy words fmBool() in load.js
   already accepts (true/yes/on/1) plus `x` for Excluded; the falsy ones plus
   `cancelled`, `canceled`, `paused` and `inactive` for Active — and keep the
   reader's own text in `<key>Raw`, written back while the field still holds
   the value that text produced. The canonical spellings (`yes`/'' and
   `yes`/`no`) keep no raw, so every file already on disk writes the bytes it
   always did. An unknown word keeps the old reading (Excluded: no; Active:
   yes) and is no longer erased.

   The Split cell gets the same raw (an unknown word like `todo` used to be
   erased by the schema read itself), so the transactions serializer has the
   reader's text to write back whenever it writes the Split column.

   Synthetic. Schema-level sweeps plus the real loader and serializers.
     node tests/schema-flag-words-kept.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SCHEMAS, rowToObject, rowLine } = require('../src/table-schema');
const { serviceCommitments } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

const colIndex = (schema, key) => schema.columns.findIndex(c => c.key === key);
const cellOf = (schema, row, key) => rowLine(schema, row).slice(2, -2).split(' | ')[colIndex(schema, key)];

/* ---- 1. Services `Active` at the schema ---- */
{
  const S = SCHEMAS.services;
  const i = colIndex(S, 'active');
  const read = word => { const cells = ['Gym', 'GymCo', '450.00', 'monthly', '2026-10-01', 'Fun', word, '']; return rowToObject(S, cells); };
  for (const w of ['cancelled', 'Cancelled', 'canceled', 'paused', 'PAUSED', 'inactive', 'off', 'false', '0']) {
    const r = read(w);
    eq(r.active, false, `Active "${w}" reads as NOT active`);
    eq(r.activeRaw, w, `…and keeps the reader's own word`);
    eq(cellOf(S, r, 'active'), w, `…which the save writes back, not "no"`);
  }
  for (const [w, v] of [['no', false], ['No', false], ['yes', true], ['YES', true], ['', true]]) {
    const r = read(w);
    eq(r.active, v, `Active "${w}" reads ${v}`);
    eq(r.activeRaw, undefined, `"${w}" is a canonical spelling (or absent) and keeps no raw`);
  }
  eq(cellOf(S, read(''), 'active'), 'yes', 'a blank Active cell is written "yes", as it always was');
  for (const w of ['active', 'on', 'true', 'maybe']) {
    const r = read(w);
    eq([r.active, r.activeRaw, cellOf(S, r, 'active')], [true, w, w],
      `"${w}" reads active (an unknown word keeps the old reading) and is written back as typed`);
  }
  // The checkbox beats the kept word: the raw stands only while the value is the one it produced.
  const r = read('cancelled');
  r.active = true;
  eq(cellOf(S, r, 'active'), 'yes', 'ticking a cancelled service active writes "yes"');
  r.active = false;
  eq(cellOf(S, r, 'active'), 'cancelled', 'unticking it again gives the reader\'s own word back');
  // Truncation: a raw exists only where a cell did.
  for (let len = 0; len <= i; len++) {
    const t = rowToObject(S, ['Gym', 'GymCo', '450.00', 'monthly', '2026-10-01', 'Fun', 'paused'].slice(0, len));
    eq([t.active, t.activeRaw], [true, undefined], `a row cut at ${len} columns reads active with no raw`);
  }
}

/* ---- 2. transaction `Excluded` (and Split) at the schema ---- */
{
  const T = SCHEMAS.transactions;
  const read = (excl, split = '') => rowToObject(T, ['2026-09-01', 'Payout', 'Salary', '9000.00', excl, '', split]);
  for (const w of ['x', 'X', 'true', 'TRUE', '1', 'on']) {
    const r = read(w);
    eq([r.excluded, r.excludedRaw, cellOf(T, r, 'excluded')], [true, w, w],
      `Excluded "${w}" reads as excluded and is written back as typed`);
  }
  for (const [w, v] of [['yes', true], ['Yes', true], ['', false]]) {
    const r = read(w);
    eq([r.excluded, r.excludedRaw], [v, undefined], `Excluded "${w}" is canonical and keeps no raw`);
  }
  for (const w of ['no', 'false', 'maybe']) {
    const r = read(w);
    eq([r.excluded, r.excludedRaw, cellOf(T, r, 'excluded')], [false, w, w],
      `Excluded "${w}" reads as not excluded, and the word is kept rather than blanked`);
  }
  const r = read('x');
  r.excluded = false;
  eq(cellOf(T, r, 'excluded'), '', 'including the row again writes the canonical blank');
  r.excluded = true;
  eq(cellOf(T, r, 'excluded'), 'x', 'excluding it again gives the reader\'s own mark back');

  const s = read('', 'todo');
  eq([s.split, s.splitRaw, cellOf(T, s, 'split')], ['', 'todo', 'todo'],
    'an unknown Split word reads as no role (the single door, tx-role.splitRole) and is written back as typed');
  s.split = 'parent';
  eq(cellOf(T, s, 'split'), 'parent', 'a real split role, once set, wins over the kept word');
  eq(read('', 'part').splitRaw, undefined, 'a known role keeps no raw');
  eq(read('', '').splitRaw, undefined, 'nor does a blank cell');
}

(async () => {
  /* ---- 3. Services through the real loader, the real serializer, and committed.js ---- */
  const SVC = ['---', 'kind: services', '---', '', '# Services & Subscriptions', '',
    'Recurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.', '',
    '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |',
    '|------|----------|-------:|-------|--------------|----------|--------|-------|',
    '| Streaming | StreamCo | 199.00 | monthly | 2026-10-15 | Fun | yes |  |',
    '| Gym | GymCo | 450.00 | monthly | 2026-10-20 | Fun | cancelled | cancelled 30 Sep |',
    '| Music | MusicCo | 99.00 | monthly | 2026-10-25 | Fun | paused |  |', ''].join('\n');
  {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Services.md`]: SVC });
    const S = await loadInto(ctx);
    require('../src/views/services')(ctx);
    eq(S.services.map(s => s.active), [true, false, false], 'cancelled and paused load as inactive');
    eq(serviceCommitments({ services: S.services, rows: [], from: '2026-10-07', to: '2026-10-31', periodStart: '2026-10-01' })
      .map(c => c.name), ['Streaming'], 'so only the active service is still committed this period');
    eq(ctx.serializeServices(), SVC, 'a no-change save keeps `cancelled` and `paused`, byte for byte');
  }

  /* ---- 4. Excluded through the real loader, the period figures and the real serializer ---- */
  const TX = ['---', 'account: "Cheque"', 'month: 2026-09', '---', '',
    '| Date | Description | Category | Amount | Excluded | Note |',
    '|------|-------------|----------|-------:|----------|------|',
    '| 2026-09-01 | Payout | Salary | 9000.00 | x | windfall |',
    '| 2026-09-02 | Tax refund | Salary | 1500.00 | true |  |',
    '| 2026-09-03 | Salary | Salary | 30000.00 |  |  |', ''].join('\n');
  {
    const ctx = makeCtx({
      [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#888888"\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-09-30\n---\n',
      [`${B}/Transactions/Cheque/2026-09.md`]: TX,
    });
    const S = await loadInto(ctx);
    require('../src/views/transactions')(ctx);
    const f = S.txFiles['Cheque/2026-09'];
    eq(f.rows.map(r => r.excluded), [true, true, false], '`x` and `true` load as excluded');
    eq(ctx.periodSummary('2026-09').income, 30000, 'so the windfall and the refund stay out of the period\'s income');
    const out = ctx.serializeTxFile(f);
    ok(out.includes('| 2026-09-01 | Payout | Salary | 9000.00 | x | windfall |'), 'the save writes `x` back');
    ok(out.includes('| 2026-09-02 | Tax refund | Salary | 1500.00 | true |  |'), '…and `true`');
    eq(out, TX, 'a no-change save of the month is byte-identical');
  }

  console.log(`PASS schema-flag-words-kept (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
