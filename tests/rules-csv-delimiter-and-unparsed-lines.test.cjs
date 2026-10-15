'use strict';
/* Data/Categorisation Rules.csv must survive a spreadsheet, and a file the
   loader cannot read must never be rewritten (2026-10-14 audit, L3-03).

   The household opens this file in a spreadsheet — the app says so itself
   (csv.js csvCell, categories.js rulesCsv). A spreadsheet in a comma-decimal
   locale (en-ZA, de, fr, nl) saves it `;`-separated, with a BOM and CRLF.
   load.js read it with a comma-only parser, found no rule with two cells,
   loaded ZERO rules, and the next learn (any Transactions Save that
   recategorised a row, any import commit) rewrote the file from S.rules: on
   the vault the audit ran against, several hundred rules became 1. Nothing said so.

   Three things are pinned here, each through the REAL loader and the REAL
   categories module, reading back the bytes the app wrote:

     1. a `;`-separated (and tab-separated) file reads every rule, and a
        learn keeps them all,
     2. a line the loader cannot turn into a rule — a comment, a pattern with
        no category yet, a category with no pattern — is kept where it stood
        on every rewrite, including through the tidy that drops rules around
        it,
     3. a file that has content but yields no rule at all is marked
        unreadable, and every rules write refuses with a plain toast and
        leaves the file byte-identical.

   Synthetic merchants only.
     node tests/rules-csv-delimiter-and-unparsed-lines.test.cjs */

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
const registerCategories = require('../src/categories');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(['Groceries', 'Coffee', 'Fuel', 'Food'].map(c =>
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

(async () => {
  const unpin = pinClock('2026-10-14');
  try {
    /* ---- 1. a spreadsheet's semicolons ---- */
    {
      const semi = '﻿' + 'pattern;category;why\r\nCORNER MART;Groceries;weekly shop\r\nSHELL;Fuel;\r\nBEAN BARN;Coffee;\r\n';
      const ctx = await boot({ ...BASE, [RULES]: semi });
      eq(ctx.S.rules.map(r => r.pattern), ['CORNER MART', 'SHELL', 'BEAN BARN'],
        'a ;-separated file with a BOM and CRLF reads every rule');
      eq(ctx.S.rules.map(r => r.category), ['Groceries', 'Fuel', 'Coffee'], 'with the right categories');
      eq(ctx.S.rulesHeader, ['pattern', 'category', 'why'], 'and its header, without the BOM');
      eq(await ctx.learnRules([{ desc: 'FRESH PRODUCE STALL 0042', cat: 'Food' }]), 1, 'a learn adds its rule');
      const back = await reload(ctx);
      eq(back.S.rules.map(r => r.pattern), ['CORNER MART', 'SHELL', 'BEAN BARN', 'FRESH PRODUCE STALL'],
        'after the rewrite and a reload every household rule is still there, the learned one at the end');
      eq(back.S.rules[0].extra, ['weekly shop'], 'and the household\'s own column came through the sniffed read');
      ok(!onDisk(ctx).startsWith('﻿'), 'the rewrite carries no BOM (nothing this app writes does)');
      eq(back.S.unreadableFiles.filter(u => /Rules/.test(u.rel)), [], 'a readable file is not reported unreadable');
    }
    {
      const tabs = 'pattern\tcategory\nCORNER MART\tGroceries\nSHELL\tFuel\n';
      const ctx = await boot({ ...BASE, [RULES]: tabs });
      eq(ctx.S.rules.length, 2, 'a tab-separated file reads too');
    }
    {
      /* The sniff must not talk an ordinary comma file out of being one, and a
         pattern holding a semicolon (quoted by csvCell) stays whole. */
      const comma = 'pattern,category\n"A;B STORE",Groceries\nSHELL,Fuel\n';
      const ctx = await boot({ ...BASE, [RULES]: comma });
      eq(ctx.S.rules.map(r => r.pattern), ['A;B STORE', 'SHELL'], 'a comma file with a quoted semicolon is still a comma file');
    }

    /* ---- 2. lines that are not rules stay where they stood ---- */
    {
      const hand = 'pattern,category\n# Fuel and transport\nSHELL,Fuel\nSPAR TOPS\nCORNER MART,Groceries\n,Groceries\n';
      const ctx = await boot({ ...BASE, [RULES]: hand });
      eq(ctx.S.rules.map(r => r.pattern), ['SHELL', 'CORNER MART'], 'only the two complete lines are rules');
      eq(ctx.S.unreadableFiles.filter(u => /Rules/.test(u.rel)), [], 'a file with rules in it is readable');
      await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]);
      eq(onDisk(ctx), 'pattern,category\n# Fuel and transport\nSHELL,Fuel\nSPAR TOPS\nCORNER MART,Groceries\n,Groceries\nBEAN BARN,Coffee\n',
        'the comment, the pattern with no category and the category with no pattern all stay in place; the learned rule goes last');
      const again = await reload(ctx);
      const before = onDisk(again);
      eq(await again.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]), 0, 'a second learn adds nothing');
      eq(onDisk(again), before, 'and a reload-and-learn round leaves the file byte-identical');
      /* Correcting a rule rewrites too. */
      const rule = again.governingRule('SHELL GARAGE');
      ok(rule && rule.pattern === 'SHELL', 'precondition: SHELL governs its garage');
      await again.correctRule(rule, 'Food');
      ok(onDisk(again).includes('# Fuel and transport\nSHELL,Food\nSPAR TOPS\n'), 'correcting a rule keeps the lines around it');
    }
    {
      /* A tidy that drops the rule a line was anchored to must not drop the line. */
      const hand = 'pattern,category\nCORNER MART,Groceries\nCORNER MART EXTRA,Groceries\n# keep me\nSHELL,Fuel\n';
      const ctx = await boot({ ...BASE, [RULES]: hand });
      ctx.S.rules = ctx.S.rules.filter(r => r.pattern !== 'SHELL' && r.pattern !== 'CORNER MART EXTRA');
      await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]);
      ok(onDisk(ctx).includes('# keep me'), 'a line anchored to a rule that was removed is still written');
      ok(onDisk(ctx).indexOf('CORNER MART,Groceries') < onDisk(ctx).indexOf('# keep me'), 'after the nearest rule that survived');
    }

    /* ---- 3. a file with content and no readable rule is never rewritten ---- */
    {
      const junk = 'pattern,category\nCORNER MART\nSHELL\n# a comment\n';
      const ctx = await boot({ ...BASE, [RULES]: junk });
      eq(ctx.S.rules.length, 0, 'precondition: nothing in it is a rule');
      eq(ctx.S.unreadableFiles.filter(u => /Rules/.test(u.rel)).length, 1, 'the file is reported unreadable');
      ctx._toasts.length = 0;
      eq(await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]), 0, 'a learn is refused');
      eq(onDisk(ctx), junk, 'the file is byte-identical');
      ok(ctx._toasts.length >= 1 && ctx._toasts[0].bad && /Categorisation Rules/.test(ctx._toasts[0].msg),
        'with a plain toast naming the file');
      ctx._toasts.length = 0;
      eq(await ctx.correctRule({ pattern: 'X', category: 'Fuel' }, 'Food'), false, 'a correction is refused');
      eq(onDisk(ctx), junk, 'and writes nothing');
      ok(ctx._toasts.length >= 1, 'with a toast');
    }
    {
      /* A header and nothing else is an empty rules file, not a broken one. */
      const ctx = await boot({ ...BASE, [RULES]: 'pattern,category\n' });
      eq(ctx.S.unreadableFiles.filter(u => /Rules/.test(u.rel)), [], 'a header-only file is empty, not unreadable');
      eq(await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]), 1, 'and learns normally');
    }
    {
      const ctx = await boot({ ...BASE });
      eq(ctx.S.unreadableFiles.filter(u => /Rules/.test(u.rel)), [], 'no rules file at all is not unreadable');
      eq(await ctx.learnRules([{ desc: 'BEAN BARN 0007', cat: 'Coffee' }]), 1, 'and learns normally');
    }

    console.log(`PASS — rules CSV: sniffed delimiters, unparsed lines kept in place, unreadable file never rewritten (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
