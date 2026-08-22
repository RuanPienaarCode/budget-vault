'use strict';
/* Budgets/<period>.md has exactly one serializer.

   The bytes of a period file used to be built inline inside saveBudget() in
   views/budgets.js — frontmatter patch, heading, range note, column header,
   separator and row template, all as literals inside a function no bare-node
   test could call. That was survivable while the Budget page was the only
   writer of the file. The setup wizard is now a second one: the manual path
   seeds a household's very first budget from the five lines it asks for. Two
   hand-built copies of one table format is this repo's recurring bug shape —
   two things derived by different rules, agreeing right up until one of them
   is edited — so the format moved into src/budget-file.js and both writers
   call it.

   Four claims, in the order they would break:

     1. what serializeBudgetFile writes, the REAL loader reads back — driven
        through loadVault(), never through a mirror of its column mapping
        pasted into this file (see the header of vault-roundtrip.test.cjs for
        the release that rule was bought with),
     2. the awkward cells survive: an unescaped pipe in a category name or a
        note, and an amount the strict parser rejected, which must go back as
        the verbatim string the reader typed rather than a number they did not,
     3. rows come out in the vault's own type order, custom groups included,
     4. neither writer still carries a copy of the table header — a source
        grep, the same shape settings-parity uses, because a second copy would
        pass every assertion above right up until someone edited one of them.

   Bare node. Wired into ./build.sh by the tests/*.test.cjs glob.
     node tests/budget-file.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

const { serializeBudgetFile, budgetRangeNote, BUDGET_HEADER } = require('../src/budget-file');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';

/* ---- 1+2+3: through the real loader ------------------------------------ */
/* Deliberately awkward: a pipe in a name and in a note (which would end the
   markdown cell early if it were not escaped), a `luxuries` row that has to
   sort BELOW savings, an income row that has to sort above everything, and an
   amount the strict parser rejects. Every figure is synthetic. */
const ROWS = [
  { category: 'Eating out', type: 'luxuries', amount: 900, amountRaw: null, notes: '' },
  { category: 'Salary', type: 'income', amount: 42000, amountRaw: null, notes: 'take-home' },
  { category: 'Kids | School', type: 'expense', amount: 0, amountRaw: '1 234,56', notes: 'hand | edited' },
  { category: 'Groceries', type: 'expense', amount: 5000.5, amountRaw: null, notes: '' },
];

const text = serializeBudgetFile({
  period: '2026-08',
  rawFrontmatter: 'tags: [finance, finance/budget, finance/budget/budgets]\naliases: [August budget]',
  rows: ROWS,
  rangeNote: budgetRangeNote({ monthStartDay: 25 }),
});

(async () => {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 25\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Budgets/2026-08.md`]: text,
  });
  const S = await loadInto(ctx);
  const back = S.budgets['2026-08'];
  ok(!!back, 'the serialized file is a budget file the loader recognises');

  eq(back.map(r => r.category), ['Salary', 'Groceries', 'Kids | School', 'Eating out'],
    'rows come back in the vault type order — income, then the expenses by name, then luxuries');
  eq(back.map(r => r.type), ['income', 'expense', 'expense', 'luxuries'],
    'and each row keeps the type it was written with');
  eq(back.map(r => r.amount), [42000, 5000.5, 1234.56, 900],
    'every amount survives, including the grouped one the loader reads and the strict parser did not');
  eq(back[2].amountRaw, '1 234,56',
    'an amount the strict parser rejected goes back out VERBATIM — never a number the reader never typed');
  eq(back[2].notes, 'hand | edited', 'a pipe in a note survives the round trip');
  eq(S.budgetMeta['2026-08'].raw.includes('aliases: [August budget]'), true,
    'frontmatter the in-memory model does not carry is preserved, not eaten');
  eq(S.budgetMeta['2026-08'].raw.includes('period: 2026-08'), true,
    'and the period key is patched in');

  /* A custom group declared in Settings.md sorts where groups.js puts it —
     just before `expense` — in the FILE as well as on the page. A file whose
     order disagreed with the page it was saved from is the kind of diff that
     looks like corruption when it opens in Obsidian. */
  const withGroup = serializeBudgetFile({
    period: '2026-09',
    rows: [
      { category: 'Other', type: 'expense', amount: 10, notes: '' },
      { category: 'Boat', type: 'treats', amount: 20, notes: '' },
      { category: 'Pay', type: 'income', amount: 30, notes: '' },
    ],
    groups: ['treats'],
    rangeNote: budgetRangeNote({ monthStartDay: 1 }),
  });
  const ctx2 = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ngroups: "treats"\n---\n',
    [`${B}/Budgets/2026-09.md`]: withGroup,
  });
  const S2 = await loadInto(ctx2);
  eq(S2.budgets['2026-09'].map(r => r.category), ['Pay', 'Boat', 'Other'],
    'a custom group sorts where the vault says it does — before `expense`, after income');

  /* ---- range notes: three shapes, none of them invented ---- */
  ok(/month_start_day: 25/.test(budgetRangeNote({ monthStartDay: 25 })),
    'the monthly note quotes the key it was derived from');
  ok(/25th/.test(budgetRangeNote({ monthStartDay: 25 })) && /24th/.test(budgetRangeNote({ monthStartDay: 25 })),
    'and works the window out with correct English ordinals');
  ok(/21st/.test(budgetRangeNote({ monthStartDay: 22 })),
    'including the ones the old hardcoded "rd"/"nd" got wrong');
  ok(/calendar month/.test(budgetRangeNote({ monthStartDay: 1 })),
    'day 1 is described as the calendar month, not as a period ending on the 0th');
  const cycle = budgetRangeNote({ monthStartDay: 25, intervalDays: 14, periodStart: '2026-08-06', periodAnchor: '2026-07-09' });
  ok(/period_days: 14/.test(cycle) && /2026-08-06/.test(cycle) && /2026-07-09/.test(cycle),
    'an interval period states its length, its start and the anchor it was counted from');
  ok(!/month_start_day/.test(cycle),
    'and never quotes a month start day it is not running on — the note only ever says what Settings.md says');

  /* ---- 4: nobody kept a copy of the format ---- */
  const SRC = path.join(__dirname, '..', 'src');
  for (const rel of ['views/budgets.js', 'onboarding.js']) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    ok(!src.includes(BUDGET_HEADER),
      `${rel} must not carry its own copy of "${BUDGET_HEADER}" — the format lives in budget-file.js`);
    ok(/serializeBudgetFile\(/.test(src),
      `${rel} writes budget files, so it must go through serializeBudgetFile()`);
  }

  console.log(`PASS — one budget serializer: both writers use it and the real loader reads it back (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
