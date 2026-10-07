'use strict';
/* Tax/<year>.md cells keep their escaping across saves — no backslash drift.

   A pipe inside a markdown table cell is written `\|`. Every Tax column is
   written through escMd and must therefore be read back through its inverse,
   unescMd — and a cell kept VERBATIM because nobody could read it must be
   written back as the same bytes it was read as, which is still `\|`-escaped
   (parseMdTable hands cells back escaped; table-schema.js's money()/vocab()
   comments explain why writing such a raw WITHOUT escMd is load-bearing).

   Tax broke both rules. A step's Due was read with a bare .trim() and written
   through escMd, and an unreadable amount or status word was written through
   escMd again on top of its own escaping. So each load → save added one
   backslash before every pipe —

     June \| maybe  ->  June \\| maybe  ->  June \\\| maybe  ->  …

   — until a cell that was merely unparseable became unreadable. ISSUE 76 fixed
   the identical defect in plan.js and left tax.js; the 2026-10-07 round-trip
   audit counted it 1 → 2 → 3 → 4 over three saves.

   Three full cycles here, each a REAL loader read of the previous REAL save.
     node tests/tax-escape-stable.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TAX = [
  '---', 'kind: tax', 'tax_year: 2026', 'taxpayer_type: standard', 'assessment: unknown', '---', '',
  '# Tax Year 2026', '',
  '## Progress', '', '| Step | Status | Due | Notes |', '|------|--------|-----|-------|',
  '| File the return | todo | June \\| maybe | ask \\| twice |',
  '| Gather certificates | waiting \\| bank | 2026-07-01 |  |', '',
  '## Documents', '', '| Document | Source | Status | File | Notes |', '|----------|--------|--------|------|-------|',
  '| Interest certificate | Bank \\| A | posted \\| late |  |  |', '',
  '## Figures', '', '| Source code | Description | Source | Amount |', '|------|-------------|--------|--------|',
  '| 4201 | Interest | Bank | about R1 200 \\| est |', '',
].join('\n');
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

async function saveOnce(text) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: text }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/tax')(ctx);
  ctx.S.taxYear = '2026';
  await ctx.saveTax();
  return { out: ctx.vault._store.get(`${B}/Tax/2026.md`), t: ctx.S.tax['2026'] };
}

/* Backslashes immediately before the pipe after `word` — 1 is correct. */
const slashes = (text, word) => {
  const i = text.indexOf(`${word} `);
  if (i < 0) return -1;
  let n = 0;
  for (let k = i + word.length + 1; text[k] === '\\'; k++) n++;
  return text[i + word.length + 1 + n] === '|' ? n : -1;
};

(async () => {
  /* What the loader made of the file: the Due is plain text, the unreadable
     cells keep their raw still escaped. */
  {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: TAX }, { budgetFolder: B });
    const S = await loadInto(ctx);
    const t = S.tax['2026'];
    eq(t.steps[0].due, 'June | maybe', 'a Due is read through unescMd — the pipe is a pipe, not "\\|"');
    eq(t.steps[1].statusRaw, 'waiting \\| bank', 'an unknown status keeps its raw, still escaped as parseMdTable hands it over');
    eq(t.figures[0].amountRaw, 'about R1 200 \\| est', 'and so does an unreadable amount');
  }

  const gens = [TAX];
  for (let i = 0; i < 3; i++) gens.push((await saveOnce(gens[i])).out);

  for (const [word, what] of [['June', 'a Due'], ['waiting', 'an unknown status word'],
    ['R1 200', 'an unreadable amount'], ['posted', 'an unknown document status'],
    ['ask', 'a step note'], ['Bank', 'a document source']]) {
    eq(gens.map(g => slashes(g, word)), [1, 1, 1, 1],
      `${what} keeps exactly one backslash before its pipe across three saves`);
  }
  eq(gens[2], gens[1], 'a second save is byte-identical to the first');
  eq(gens[3], gens[2], 'and a third to the second');

  /* A Due typed IN THE APP with a pipe in it starts stable, too: the in-memory
     value is plain text, written once through escMd and read back unescaped. */
  {
    const first = await saveOnce(TAX);
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: first.out }, { budgetFolder: B });
    await loadInto(ctx);
    const { $ } = makeDom();
    ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root');
    ctx.money = v => `R ${Number(v).toFixed(2)}`;
    require('../src/views/tax')(ctx);
    ctx.S.taxYear = '2026';
    ctx.S.tax['2026'].steps[1].due = 'end of Oct | if the bank sends it';
    const once = ctx.serializeTax('2026');
    const again = (await saveOnce(once)).out;
    eq(again, once, 'a Due typed with a pipe survives a save → load → save unchanged');
    ok(once.includes('| end of Oct \\| if the bank sends it |'), 'written with one backslash before its pipe');
  }

  console.log(`tax-escape-stable: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
