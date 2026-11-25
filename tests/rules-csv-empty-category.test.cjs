'use strict';
/* A rules line with an empty category is not a rule (2026-11-25 audit, RUL-12).

   A spreadsheet writes `spotify,` for a pattern whose category cell is empty.
   load.js read any line with two cells and a pattern as a LIVE rule, so that
   line became a rule with a blank category. Three things followed, each shown
   below through the real loader and the real rules writer:

     1. It beat a broader correct rule. Matching is longest-pattern-wins, so
        `spar newlands,` outranked `spar,Food` and left every SPAR NEWLANDS row
        uncategorised.
     2. Its key blocked the merchant from ever being learned: learnRules sees a
        rule for "spotify" already and adds nothing, so the household's own
        half-finished line was the reason the merchant stayed uncategorised.
     3. A tidy counted it as an ordinary rule.

   The loader now treats such a line like the lines it already keeps and
   replays verbatim (a comment, a pattern with one cell, a category with no
   pattern): it goes to S.rulesExtras, anchored to the rule above it, and
   rulesCsv writes it back exactly where it stood. Nothing about those lines is
   new for the writer; this file pins that the empty-category shape takes that
   path and round-trips byte for byte.

   Synthetic merchants only.
     node tests/rules-csv-empty-category.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return { askFields: async () => null, confirmModal: async () => false, askRulesCleanup: async () => true };
  }
  return realLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { prepareRules, autoCategorise } = require('../src/rules');
const registerCategories = require('../src/categories');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(['Food', 'Subscriptions', 'Coffee', 'Fuel'].map(c =>
    [`${B}/Categories/${c}.md`, '---\ntype: expense\ncolor: "#888888"\n---\n'])),
};
async function boot(files) {
  const ctx = makeCtx(files, { budgetFolder: B });
  await loadInto(ctx);
  registerCategories(ctx);
  return ctx;
}
const reload = ctx => boot(Object.fromEntries(ctx.vault._store));
const onDisk = ctx => ctx.vault._store.get(RULES);
const answer = (ctx, desc) => autoCategorise(desc, prepareRules(ctx.S.rules));

(async () => {
  const unpin = pinClock('2026-11-25');
  try {
    const FILE = 'pattern,category\nspar,Food\nspar newlands,\nspotify,\nSHELL,Fuel\n';

    /* ---- 1. the line is not a rule, so it cannot outrank a real one ---- */
    {
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(ctx.S.rules.map(r => r.pattern), ['spar', 'SHELL'], 'only the two lines with a category are rules');
      eq(answer(ctx, 'SPAR NEWLANDS 004211'), 'Food', 'the broader correct rule still answers (before: blank, uncategorised)');
      eq(ctx.S.rulesExtras.map(e => e.cells), [['spar newlands', ''], ['spotify', '']],
        'both lines are kept as lines the loader does not read as rules');
      eq(ctx.S.unreadableFiles.filter(u => /Rules/.test(u.rel)), [], 'a file with rules in it is readable');
    }

    /* ---- 2. the merchant can be learned, and the line stays where it was ---- */
    {
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(await ctx.learnRules([{ desc: 'SPOTIFY 0004711', cat: 'Subscriptions' }]), 1,
        'the merchant the blank line named is learned (before: blocked by its key)');
      eq(onDisk(ctx), FILE + 'SPOTIFY,Subscriptions\n',
        'the household\'s lines are byte-identical and in place; the learned rule goes last');
      const back = await reload(ctx);
      eq(answer(back, 'SPOTIFY 0009999'), 'Subscriptions', 'and it matches after a reload');
      eq(onDisk(back), FILE + 'SPOTIFY,Subscriptions\n', 'reloading does not change the bytes');
      const before = onDisk(back);
      eq(await back.learnRules([{ desc: 'SPOTIFY 0009999', cat: 'Subscriptions' }]), 0, 'a second learn adds nothing');
      eq(onDisk(back), before, 'and writes the same bytes');
    }

    /* ---- 3. byte-for-byte through the writer, whatever the shape ---- */
    {
      const hand = 'pattern,category,why\nspar,Food,weekly\nspar newlands,,half done\nbean barn,   ,\nspotify,\nSHELL,Fuel,\n';
      const ctx = await boot({ ...BASE, [RULES]: hand });
      eq(ctx.S.rules.map(r => r.pattern), ['spar', 'SHELL'],
        'an empty category with extra cells after it, a blank-looking category and a bare comma are all not rules');
      await ctx.learnRules([{ desc: 'FRESH PRODUCE STALL 0042', cat: 'Food' }]);
      eq(onDisk(ctx), hand + 'FRESH PRODUCE STALL,Food,\n',
        'every one of them is written back exactly as it stood, under the rule it followed');
    }

    /* ---- 4. a correction and a tidy keep the lines ---- */
    {
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      const rule = ctx.governingRule('SPAR NEWLANDS 004211');
      ok(rule && rule.pattern === 'spar', 'precondition: spar governs SPAR NEWLANDS');
      await ctx.correctRule(rule, 'Coffee');
      eq(onDisk(ctx), 'pattern,category\nspar,Coffee\nspar newlands,\nspotify,\nSHELL,Fuel\n',
        'correcting a rule keeps the blank-category lines where they were');
    }
    {
      // A tidy that removes the rule a line hangs under moves the line up; it never drops it.
      const dup = 'pattern,category\nspar,Food\nspar,Food\nspotify,\nSHELL,Fuel\n';
      const ctx = await boot({ ...BASE, [RULES]: dup });
      ctx.S.rules = ctx.S.rules.filter((r, i) => i !== 1);
      await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]);
      ok(onDisk(ctx).includes('spotify,\n'), 'the line survives when the rule it followed is gone');
    }

    /* ---- 5. a file whose every line lacks a category is not rewritten ---- */
    {
      const only = 'pattern,category\nspar,\nspotify,\n';
      const ctx = await boot({ ...BASE, [RULES]: only });
      eq(ctx.S.rules.length, 0, 'precondition: nothing in it is a rule');
      eq(ctx.S.unreadableFiles.filter(u => /Rules/.test(u.rel)).length, 1,
        'it is reported, as any file with content and no rule is');
      eq(await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]), 0, 'a learn is refused');
      eq(onDisk(ctx), only, 'and the file is byte-identical');
    }

    console.log(`PASS rules-csv-empty-category (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
