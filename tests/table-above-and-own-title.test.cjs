'use strict';
/* Two ways a file's lead was misread (2026-10-14 audit, L3-10 and L3-12).

   L3-10 — which table is the plugin's. Every reader took the FIRST table in
   the file, so a small table a household put above the plugin's (an insurer
   and a policy number over Assets.md) was read as the Assets table: the real
   rows stopped counting, and the next Save rewrote the household's table under
   the plugin's header. The plugin's table is now the one whose first header is
   the schema's first header ("Item", "Category", "Date"), compared trimmed and
   case-folded; the table of the household's own is part of the lead and comes
   back byte for byte. When NO table starts with that header (one a household
   renamed or translated) the first table is still the plugin's, as before.

   L3-12 — a heading the household typed. withLeadExtra treated ANY level-1
   heading in the title slot as the plugin's own and replaced it with the
   fixed title on the next Save. Now only a title the plugin wrote (the one it
   writes now, or one the caller names as a previous one — a plan's earlier
   name) is regenerated; the household's own words stay.

   Through the REAL loader and serializers. Synthetic content only.
     node tests/table-above-and-own-title.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { serializeBudgetFile } = require('../src/budget-file');
const { withLeadExtra, freshLeadLines, parseMdTable, splitAroundTable } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const SMALL = '| Insurer | Policy |\n|---|---|\n| Discovery | 12345 |\n';
const ASSET_TABLE = '| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| House | property | 2000000.00 | 2026-03-01 |  |\n| Car | vehicle | 150000.00 | 2026-01-01 |  |\n';

async function mount(files) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, ...files });
  const S = await loadInto(ctx);
  return { ctx, S };
}

(async () => {
  /* ---- the readers, on their own ---- */
  {
    const text = `intro\n\n${SMALL}\nmiddle\n\n${ASSET_TABLE}\nafter\n`;
    eq(parseMdTable(text).map(r => r[0]), ['Insurer', 'Discovery'], 'precondition: with no hint the FIRST table is read (the household\'s)');
    eq(parseMdTable(text, 'Item').map(r => r[0]), ['Item', 'House', 'Car'], 'with the schema\'s first header the plugin\'s table is read');
    eq(parseMdTable(text, ['Nope', 'item']).map(r => r[0]), ['Item', 'House', 'Car'], 'a list of headers, case-folded');
    eq(parseMdTable(text, 'Naam').map(r => r[0]), parseMdTable(text).map(r => r[0]), 'no table starts with the header: the first table, as before');
    const { before, after } = splitAroundTable(text, 'Item');
    ok(before.includes('| Insurer | Policy |') && before.includes('middle') && !before.includes('| House'), 'everything above the plugin\'s table is lead');
    eq(after, '\nafter\n', 'everything below is trail');
  }

  /* ---- Assets: a household table above the plugin's ---- */
  {
    const text = `---\nkind: assets\n---\n\n# Assets\n\n${SMALL}\n${ASSET_TABLE}`;
    const { ctx, S } = await mount({ [`${B}/Assets.md`]: text });
    eq(S.assets.map(a => [a.name, a.value]), [['House', 2000000], ['Car', 150000]], 'the real assets are read, not the insurer table');
    S.assets[0].notes = 'edited';
    require('../src/views/assets')(ctx);
    const out = ctx.serializeAssets();
    ok(out.includes(SMALL.trim()), 'the household\'s table is written back');
    ok(out.includes('| House | property | 2000000.00 | 2026-03-01 | edited |') && out.includes('| Car | vehicle |'), 'the plugin\'s table keeps both rows');
    ok(out.indexOf('| Insurer') < out.indexOf('| Item'), 'above it, where it was');
    eq((out.match(/\| Item \|/g) || []).length, 1, 'with one plugin header');
    // stable on a second pass
    const { ctx: c2 } = await mount({ [`${B}/Assets.md`]: out });
    require('../src/views/assets')(c2);
    eq(c2.serializeAssets(), out, 'loading what was written and saving again changes no byte');
  }

  /* ---- a household's own title ---- */
  {
    const text = `---\nkind: assets\n---\n\n# Our house and cars\n\n${ASSET_TABLE}`;
    const { ctx } = await mount({ [`${B}/Assets.md`]: text });
    require('../src/views/assets')(ctx);
    const out = ctx.serializeAssets();
    ok(out.includes('\n# Our house and cars\n'), 'a title-only lead of the household\'s own keeps its heading');
    ok(!out.includes('\n# Assets\n'), 'and the plugin\'s fixed title is not written beside it');
    const own = `---\nkind: assets\n---\n\n# Our house and cars\n\nOur own sentence.\n\n${ASSET_TABLE}`;
    const { ctx: c2 } = await mount({ [`${B}/Assets.md`]: own });
    require('../src/views/assets')(c2);
    ok(c2.serializeAssets().includes('\n# Our house and cars\n'), 'so does one with a sentence of its own');
    for (const t of ['# Assets', '# assets']) {
      const mine = `---\nkind: assets\n---\n\n${t}\n\n${ASSET_TABLE}`;
      const { ctx: c3 } = await mount({ [`${B}/Assets.md`]: mine });
      require('../src/views/assets')(c3);
      ok(c3.serializeAssets().includes('\n# Assets\n'), `the plugin's own title (${t}) is still regenerated`);
    }
  }
  {
    // the unit rule: previous plugin titles are named by the caller
    const fresh = freshLeadLines('New', ['Plugin sentence.']);
    const cap = lines => '\n' + lines.join('\n');
    eq(withLeadExtra(cap(['', '# Mine', '', 'Plugin sentence.', '']), fresh), ['', '# Mine', '', 'Plugin sentence.', ''],
      'a heading nobody named as the plugin\'s is kept (the sentence beside it is regenerated to itself)');
    eq(withLeadExtra(cap(['', '# Old', '', 'Plugin sentence.', '']), fresh, ['Old']), fresh, 'a named previous title is regenerated');
    eq(withLeadExtra(cap(['', '# Mine', '']), fresh), ['', '# Mine', ''], 'a short lead holding only the household\'s heading keeps it');
  }

  /* ---- a plan: its own heading kept, a renamed plan's old heading followed ---- */
  {
    const plan = name => `---\nkind: plan\nplan: "Holiday"\nstatus: active\n---\n\n# ${name}\n\n## Money in\n\n| Source | Kind | Amount | Date | Status | Notes |\n|---|---|---:|---|---|---|\n\n## Envelopes\n\n| Envelope | Amount | Note | Tint |\n|---|---:|---|---|\n\n## Items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n|---|---|---:|---:|---|---|---|\n`;
    const a = await mount({ [`${B}/Plans/Holiday.md`]: plan('Our trip to the coast') });
    require('../src/views/plan')(a.ctx);
    a.S.planName = 'Holiday';
    ok(a.ctx.serializePlan('Holiday').includes('\n# Our trip to the coast\n'), 'Plan: a heading the household wrote is theirs');
    const b = await mount({ [`${B}/Plans/Holiday.md`]: plan('Holiday') });
    require('../src/views/plan')(b.ctx);
    b.S.planName = 'Holiday';
    b.S.plans.Holiday.name = 'Holiday 2027';
    ok(b.ctx.serializePlan('Holiday').includes('\n# Holiday 2027\n'), 'Plan: the plugin\'s own heading follows a rename');
  }

  /* ---- a budget period and a transactions month ---- */
  {
    const budget = `---\nperiod: 2026-10\n---\n\n# Budget — 2026-10\n\n${SMALL}\n| Category | Type | Amount | Notes |\n|----------|------|-------:|-------|\n| Food | expense | 4000.00 |  |\n`;
    const { S } = await mount({ [`${B}/Categories/Food.md`]: '---\ntype: expense\n---\n', [`${B}/Budgets/2026-10.md`]: budget });
    eq(S.budgets['2026-10'].map(r => [r.category, r.amount]), [['Food', 4000]], 'Budget: the real category table is read');
    ok(S.budgetMeta['2026-10'].leadRaw.includes('| Insurer | Policy |'), 'and the household\'s table is in the lead');
    const out = serializeBudgetFile({ period: '2026-10', rawFrontmatter: S.budgetMeta['2026-10'].raw, rows: S.budgets['2026-10'],
      rangeNote: 'note', leadRaw: S.budgetMeta['2026-10'].leadRaw, trailRaw: S.budgetMeta['2026-10'].trailRaw,
      extraCols: S.budgetMeta['2026-10'].extraCols, order: S.budgetMeta['2026-10'].order, unnamed: S.budgetMeta['2026-10'].unnamed });
    ok(out.includes('| Discovery | 12345 |') && out.includes('| Food | expense | 4000.00 |'), 'and both come back out');
  }
  {
    const tx = `---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n${SMALL}\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n| 2026-09-01 | Coffee | | -35.00 |  |  |\n`;
    const { S } = await mount({ [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\n---\n', [`${B}/Transactions/Cheque/2026-09.md`]: tx });
    const f = S.txFiles['Cheque/2026-09'];
    eq(f.rows.map(r => r.desc), ['Coffee'], 'Transactions: the real rows are read');
    ok(f.lead.includes('| Insurer | Policy |') && !f.lead.includes('| Date'), 'and the lead (CONTRACT 1) is the same table choice');
  }
  {
    // a household that renamed the header: the first table is still the plugin's
    const text = `---\nkind: assets\n---\n\n# Assets\n\n| Naam | Soort | Waarde | Gewaardeer | Notas |\n|---|---|---:|---|---|\n| Huis | property | 10.00 |  |  |\n`;
    const { S } = await mount({ [`${B}/Assets.md`]: text });
    eq(S.assets.map(a => a.name), ['Huis'], 'a renamed header still loads: no table matches, so the first is taken');
  }

  console.log(`PASS — the plugin's table is found by its header; a household's own title is kept (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
