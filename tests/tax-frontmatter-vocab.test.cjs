'use strict';
/* Tax frontmatter words survive a save that did not touch them.

   `taxpayer_type` and `assessment` are a closed vocabulary in the data model
   (provisional|standard|unknown, submit-requested|auto-assessed|assessed|
   unknown — see locale.js's header), and the loader read them through an
   exact-match allow-list: anything else became `unknown`, and serializeTax
   wrote `unknown` back on the next save of the page — an edit to any row of
   any table on it. So `taxpayer_type: Provisional` (capitalised, as a person
   types it into Obsidian's Properties panel) and `assessment: verification`
   (a word copied off a SARS letter) both became `unknown` on disk, and the
   provisional taxpayer was shown the STANDARD deadline in the meantime. Found
   by the 2026-10-07 round-trip audit.

   The vocab contract every table cell already has (table-schema.js's vocab(),
   load.js's cellVocab):
     - case and surrounding space are folded, so `Provisional` IS provisional;
     - a word outside the vocabulary reads as `unknown` with the reader's own
       text kept beside it, and is written back exactly as it was — here, by
       leaving its frontmatter line alone, quoting and all — until the reader
       chooses another value.

   Through the REAL loader, the rendered page and the REAL serializer.
     node tests/tax-frontmatter-vocab.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const taxFile = fm => [
  '---', 'kind: tax', 'tax_year: 2026', ...fm,
  'deadline_standard: "2026-10-20"', 'deadline_provisional: "2027-01-22"', 'aliases: [tax 2026]', '---', '',
  '# Tax Year 2026', '',
  '## Progress', '', '| Step | Status | Due | Notes |', '|------|--------|-----|-------|',
  '| File the return | todo |  |  |', '',
  '## Documents', '', '| Document | Source | Status | File | Notes |', '|----------|--------|--------|------|-------|', '',
  '## Figures', '', '| Source code | Description | Source | Amount |', '|------|-------------|--------|--------|', '',
].join('\n');

async function mount(text) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: text }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/tax')(ctx);
  ctx.S.taxYear = '2026';
  ctx.renderTax();
  return { ctx, $ };
}
const fmLine = (text, key) => (text.match(new RegExp(`^${key}:.*$`, 'm')) || [null])[0];
const reload = async text => (await loadInto(makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: text },
  { budgetFolder: B }))).tax['2026'];

(async () => {
  /* ---- 1. a capitalised word and a word off a letter ---- */
  {
    const TEXT = taxFile(['taxpayer_type: Provisional', 'assessment: verification']);
    const { ctx, $ } = await mount(TEXT);
    const t = ctx.S.tax['2026'];
    eq(t.taxpayer_type, 'provisional', '"Provisional" is the provisional taxpayer type — case is folded');
    eq(t.assessment, 'unknown', 'an assessment word outside the vocabulary reads as unknown, so the page can branch on it');
    eq(t.assessmentRaw, 'verification', 'with the reader\'s own word kept beside it');
    /* What that misreading cost on screen: za picks the deadline by taxpayer
       type, so a provisional taxpayer read as `unknown` was counted down to the
       standard deadline. */
    const tiles = $('#taxKpis').textContent;
    ok(/Provisional/.test(tiles), `the Taxpayer tile names the provisional taxpayer (got "${tiles}")`);

    /* An edit somewhere else entirely, then Save. */
    t.steps[0].notes = 'asked the accountant';
    await ctx.saveTax();
    const out = ctx.vault._store.get(`${B}/Tax/2026.md`);
    eq(fmLine(out, 'assessment'), 'assessment: verification', 'the unknown word is written back exactly as typed');
    eq(fmLine(out, 'taxpayer_type'), 'taxpayer_type: provisional', 'and the folded word in its canonical spelling, as every vocab cell is');
    ok(/^aliases: \[tax 2026\]$/m.test(out), 'unmodelled frontmatter still survives the save');

    const back = await reload(out);
    eq([back.taxpayer_type, back.assessment, back.assessmentRaw], ['provisional', 'unknown', 'verification'],
      'and the REAL loader reads the saved file exactly as it read the original');
    const { ctx: c2 } = await mount(out);
    await c2.saveTax();
    eq(c2.vault._store.get(`${B}/Tax/2026.md`), out, 'a second save is byte-identical');
  }

  /* ---- 2. the reader's own quoting survives too ---- */
  {
    const TEXT = taxFile(['taxpayer_type: standard', 'assessment: "verification: documents sent"']);
    const { ctx } = await mount(TEXT);
    eq(ctx.S.tax['2026'].assessmentRaw, 'verification: documents sent', 'precondition: the quoted word is kept');
    await ctx.saveTax();
    eq(fmLine(ctx.vault._store.get(`${B}/Tax/2026.md`), 'assessment'), 'assessment: "verification: documents sent"',
      'its frontmatter line is left as it was — quotes included, so the colon inside cannot break the YAML');
  }

  /* ---- 3. a choice made on the page replaces the word ---- */
  {
    const { ctx, $ } = await mount(taxFile(['taxpayer_type: Provisional', 'assessment: verification']));
    const select = descend($('#taxSeasonBody'))
      .find(n => n.tagName === 'SELECT' && n.children.some(o => o.attrs.value === 'assessed'));
    select._fire('change', { target: { value: 'assessed' } });
    await ctx.saveTax();
    const out = ctx.vault._store.get(`${B}/Tax/2026.md`);
    eq(fmLine(out, 'assessment'), 'assessment: assessed', 'picking Assessed writes "assessed" over the old word');
    eq((await reload(out)).assessmentRaw, undefined, 'and nothing of the old word is left to read back');
  }

  /* ---- 4. the vocabulary's own words, in any case, are those words ---- */
  {
    const { ctx } = await mount(taxFile(['taxpayer_type: " STANDARD "', 'assessment: Auto-Assessed']));
    const t = ctx.S.tax['2026'];
    eq([t.taxpayer_type, t.assessment], ['standard', 'auto-assessed'], 'case and surrounding space never hide a known word');
    eq([t.taxpayer_typeRaw, t.assessmentRaw], [undefined, undefined], 'and a known word needs no raw');
    const { ctx: blank } = await mount(taxFile([]));
    eq([blank.S.tax['2026'].taxpayer_type, blank.S.tax['2026'].assessment], ['unknown', 'unknown'],
      'an absent key is unknown, as it always was');
    await blank.saveTax();
    const out = blank.vault._store.get(`${B}/Tax/2026.md`);
    eq([fmLine(out, 'taxpayer_type'), fmLine(out, 'assessment')], ['taxpayer_type: unknown', 'assessment: unknown'],
      'and is written as unknown, as it always was');
  }

  console.log(`tax-frontmatter-vocab: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
