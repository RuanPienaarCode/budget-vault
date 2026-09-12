'use strict';
/* ISSUE 97 — the four folders the issue is titled for.

   Categories/, Budgets/, Plans/ and Tax/ are read one level deep. A file filed
   one folder down — Budgets/2025/2025-03.md, Categories/Archive/Old.md — is
   simply not there: no toast, no caveat, no equivalent of S.accountsIgnored.

   THE ORDER IS #60's, held here the same way tests/account-file-paths.test.cjs
   and tests/nested-transaction-folders.test.cjs hold it: the writers ASSEMBLE
   `<Folder>/<name>.md`, so recursion without a real `rel` first converts a
   silent drop into a silent FORK — the file read from one path and written to
   another, two files holding one record and the loaded one stale. So every
   folder below is asserted twice: the nested file is read, AND the path the
   record carries is the path it came from.

   Tax/ carries a hazard the other three do not, and it is the reason this is
   not a one-line change per folder. `Tax/<year>/` is a DOCUMENTS folder — tax
   attachments live in it (views/tax.js writes `Tax/${S.taxYear}/${name}`). The
   year-file filter tests the basename only, so a recursing loader would read
   `Tax/2026/2025.md` — an attachment that happens to be named like a year — as
   a tax YEAR, inventing a year the household never created. The rule that
   settles it: a year file is one whose PARENT is not itself a year folder.

     node tests/nested-metadata-folders.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };

const budgetFile = amt => `---\nkind: budget\n---\n\n| Category | Type | Planned | Notes |\n|---|---|---:|---|\n| Food | spending | ${amt} |  |\n`;
const planFile = name => `---\nkind: plan\nname: "${name}"\n---\n\n# ${name}\n\n## Items\n\n| Item | Status | Cost |\n|---|---|---:|\n| Flights | planned | 500.00 |\n`;
const taxFile = year => `---\nkind: tax\nyear: ${year}\n---\n\n# ${year}\n\n## Figures\n\n| Figure | Amount |\n|---|---:|\n`;

(async () => {
  const F = {
    ...SETTINGS,
    // flat — read today
    [`${B}/Categories/Food.md`]: '---\nkind: category\nname: Food\ntype: spending\n---\n',
    [`${B}/Budgets/2026-09.md`]: budgetFile('1000.00'),
    [`${B}/Plans/Trip.md`]: planFile('Trip'),
    [`${B}/Tax/2026.md`]: taxFile(2026),
    // one level down — the claim under test
    [`${B}/Categories/Archive/Old Car.md`]: '---\nkind: category\nname: Old Car\ntype: spending\n---\n',
    [`${B}/Budgets/2025/2025-03.md`]: budgetFile('777.00'),
    [`${B}/Plans/Archive/Old Trip.md`]: planFile('Old Trip'),
    [`${B}/Tax/Archive/2024.md`]: taxFile(2024),
    // the Tax hazard: an ATTACHMENT named like a year, inside a year's docs folder
    [`${B}/Tax/2026/2023.md`]: '---\nkind: whatever\n---\n\nA receipt, not a tax year.\n',
  };
  const ctx = makeCtx(F, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);

  /* ---- Categories ---------------------------------------------------- */
  {
    const names = S.categories.map(c => c.name).sort();
    eq(names, ['Food', 'Old Car'], 'a category one level down is read');
    const old = S.categories.find(c => c.name === 'Old Car');
    eq(old.rel, 'Categories/Archive/Old Car.md',
      'and carries the path it was READ from, not one assembled from its name');
    eq(S.categories.find(c => c.name === 'Food').rel, 'Categories/Food.md',
      'a flat category records its flat path the same way');
  }

  /* ---- Budgets ------------------------------------------------------- */
  {
    eq(Object.keys(S.budgets).sort(), ['2025-03', '2026-09'], 'a budget one level down is read');
    eq(S.budgets['2025-03'][0].amount, 777, 'with its rows');
    eq(S.budgetMeta['2025-03'].rel, 'Budgets/2025/2025-03.md',
      'the period carries the path it was read from');
    eq(S.budgetMeta['2026-09'].rel, 'Budgets/2026-09.md', 'flat periods too');
  }

  /* ---- Plans --------------------------------------------------------- */
  {
    const keys = Object.keys(S.plans).sort();
    eq(keys.length, 2, `a plan one level down is read (got ${keys.join(', ')})`);
    const nested = Object.values(S.plans).find(p => (p.rel || '').includes('Archive'));
    ok(nested, 'the nested plan is present');
    eq(nested.rel, 'Plans/Archive/Old Trip.md', 'and carries the path it was read from');
  }

  /* ---- Tax ----------------------------------------------------------- */
  {
    const years = Object.keys(S.tax).sort();
    eq(years, ['2024', '2026'], 'a tax year one level down is read, and an ATTACHMENT is not');
    ok(!years.includes('2023'),
      'Tax/2026/2023.md is a document inside a year folder, never a tax year of its own');
    eq(S.tax['2024'].rel, 'Tax/Archive/2024.md', 'the year carries the path it was read from');
    eq(S.tax['2026'].rel, 'Tax/2026.md', 'flat years too');
  }

  /* ---- no writer assembles a path for a record it loaded -------------- */
  {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..', 'src');
    /* The static half — a seam every caller ignores is the state #84 is open
       about, and here it would be silent data loss rather than a stale figure.

       An assembled path is not banned outright: a name no loaded record claims
       has no `rel` to offer, and creating a NEW record flat is correct. What is
       banned is an assembled path REACHED FIRST — resolution that never
       consults `rel` at all. So a match is an offender only when neither it nor
       the two lines above it mention `rel`, which is the window the fallback
       form occupies. */
    const banned = [
      ['categories.js', /fileAt\(`Categories\/\$\{/],
      ['views/budgets.js', /writeFile\(`Budgets\/\$\{/],
      ['views/plan.js', /fileAt\(`Plans\/\$\{/],
      ['views/tax.js', /writeFile\(`Tax\/\$\{[^}]*\}\.md`/],
      ['views/tax.js', /fileAt\(`Tax\/\$\{year\}\.md`/],
      ['views/dashboard.js', /fileAt\(`Categories\/\$\{/],
    ];
    const offenders = [];
    for (const [rel, re] of banned) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!re.test(line)) return;
        const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
        if (!/\brel\b/.test(window)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    eq(offenders, [], 'every writer reaches a loaded record through its own rel');
  }

  console.log(`PASS nested-metadata-folders (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
