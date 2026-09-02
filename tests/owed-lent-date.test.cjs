'use strict';
/* The Owed page must be able to WRITE the field it reads.

   `views/owed.js` prints "out N days" under a person's name and
   `owed-math.js` returns `oldestDays`, both measured from an entry's `lent`
   date, and the view states the reasoning: a due date "asks for something you
   do not have when you lend to family", while how long the money has been
   gone "is the figure that actually applies pressure".

   That argument is sound. What was missing is that nothing could set `lent`.
   The column has always existed in `SCHEMAS.owed` (header "Lent"), so the
   loader read it and the serializer wrote it back — but the table rendered no
   field for it and `addOwed` pushed `lent: ''`, so an entry created in the app
   could never carry one. `daysSince('')` is null, so the caption never
   rendered and `oldestDays` was null on any vault built through the UI, no
   matter how long money had been out. Measured on a real vault before the fix:
   0 of 6 entries carried a lent date, while the only unsettled one carried a
   due date already in the past — the inverse of the premise the design rests
   on. Issue #34.

   This pins the WAY IN, not the arithmetic: `owed-math.js` was always correct
   about a date it was never given. Section 4 is the negative control, because
   a test that only checks "the field exists" would pass on a field wired to
   nothing.

   Drives the REAL view over the DOM stub.
     node tests/owed-lent-date.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { todayIso } = require('../src/dates');
const { owedSummary } = require('../src/owed-math');
const { SCHEMAS } = require('../src/table-schema');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'owed.js'), 'utf8');
const B = 'Budget';
/* One unsettled entry with NO lent date — the state every in-app entry was
   stuck in. Synthetic: nobody's real loan. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n|---|---:|---|---|---|---:|---|---|\n'
    + '| Pieter | 500.00 | petrol | 2026-08-26 | outstanding | 0.00 |  |  |\n',
};

async function mount(files = FILES) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.noteButton = () => null;
  require('../src/views/owed')(ctx);
  ctx.renderOwed();
  return { ctx, S, table: $('#owedTable') };
}

/* Every input the table renders, keyed by aria-label — the label is how a
   reader and a screen reader both find a field, so asserting on it rather
   than on a column index survives a reordering that keeps the meaning. */
function inputsByLabel(root) {
  const out = new Map();
  for (const n of descend(root)) {
    if (n.tagName !== 'INPUT') continue;
    const l = n.attrs && n.attrs['aria-label'];
    if (l) out.set(l, n);
  }
  return out;
}

/* ---- 1. the column exists in the file format, and always did ---- */
{
  const keys = SCHEMAS.owed.columns.map(c => c.key);
  ok(keys.includes('lent'), 'Owed Money.md declares a lent column — the fix is the way in, not the format');
}

/* ---- 2. a row renders an editable Lent field that writes through ---- */
(async () => {
const { S, table } = await mount();
const row = S.owed[0];
eq(row.lent, '', 'the fixture starts in the state every in-app entry was stuck in');

const fields = inputsByLabel(table);
const lent = fields.get('Date lent to Pieter');
ok(lent, 'the table renders a Lent field for the row — this is what did not exist');
ok(fields.get('Due date for Pieter'), 'and the due-date field is still there beside it');

/* Write through it the way a real change event does, and prove the model moved.
   _fire is the stub's documented way in; it is not a DOM event. */
lent.value = '2026-06-01';
lent._fire('change');
eq(row.lent, '2026-06-01', 'editing the field sets `lent` on the entry');

/* ---- 2b. and the caption it feeds appears, which is the point ---- */
const text = descend(table).map(n => n.textContent || '').join(' ');
ok(/out \d+ days/.test(text),
  'the age caption now renders for this row — before the fix it was unreachable for any in-app entry');

/* ---- 3. once set, the pressure figures come alive ---- */
{
  const before = owedSummary([{ person: 'A', amount: 500, repaid: 0, status: 'outstanding', lent: '' }], '2026-09-02', 'R');
  const after = owedSummary([{ person: 'A', amount: 500, repaid: 0, status: 'outstanding', lent: '2026-06-01' }], '2026-09-02', 'R');
  eq(before.open, 1, 'an entry with no lent date is still counted as open — the count never depended on the date');
  eq(before.oldestDays, null, '…but it can state no age, which is what the empty field cost');
  eq(after.open, 1, 'the same entry with a date is still one open obligation');
  eq(after.oldestDays, 93, 'and now reports its real age (1 Jun to 2 Sep 2026)');
}

/* ---- 4. NEGATIVE CONTROL: a new entry is stamped, not left empty ----
   The whole defect was a field that existed and was never populated, so
   "the field renders" is not enough on its own. addOwed goes through
   askFields, which needs a modal; the shipped contract is asserted against
   the source, and the exact string that WAS the bug is asserted absent. */
ok(!/repaid: 0, lent: ''/.test(SRC),
  'addOwed no longer hardcodes an empty lent date — that exact string was the bug');
ok(/repaid: 0, lent: todayIso\(\)/.test(SRC),
  'a new entry is stamped with today, so the age caption works from its first render');
ok(/const \{ todayIso \} = require\('\.\.\/dates'\);/.test(SRC),
  'and it reads the LOCAL calendar date, not a UTC-parsed one');
ok(/^\d{4}-\d{2}-\d{2}$/.test(todayIso()),
  'todayIso() yields the shape SCHEMAS.owed round-trips');

/* ---- 5. the empty-state row still spans the whole table ---- */
{
  const headers = (SRC.match(/scope: 'col'/g) || []).length;
  const colspan = (SRC.match(/colspan: '(\d+)'/) || [])[1];
  eq(String(headers), colspan,
    'the "No entries yet" row spans every column — adding one without moving the colspan is how that row silently narrows');
}

console.log(`PASS — the Owed page can write the lent date it reads (${checks} checks).`);
})().catch(e => { console.error(e.stack); process.exit(1); });
