'use strict';
/* Data/Categorisation Rules.csv survives the app writing it: every learned
   rule still matches after a save and a reload, and the household's own
   columns and line order are written back as they were.

   The rules file belongs to the household. They open it in a spreadsheet,
   they add a column to it, they put a rule above another on purpose. The
   app rewrites it whenever it learns a rule (import commit, Transactions
   Save), corrects one, or tidies. The 2026-10-07 audit found that rewrite
   losing three things, each on a synthetic file through the real loader:

   1. THE MATCH (L3-06 / MT-RULE-APOSTROPHE). csvCell guards a cell that
      starts with = + - @ by putting an apostrophe in front, and the loader
      kept the apostrophe. A learned `@PARKING …` went to disk as
      `'@PARKING …`, came back as that pattern, and never matched its own
      merchant again. Each later import then learned the same description as
      new and appended another dead copy, so the file grew by one dead line
      per import. The loader now strips the guard with uncsvCell.

   2. THE COLUMNS (L3-14). The file was read as two columns and rebuilt from
      two, so a `why` column was deleted by the first learn and the header was
      regenerated as `pattern,category`. Now every rule keeps the cells past
      its category, the file keeps its own header, and a new rule gets empty
      cells so it lines up with the rest.

   3. THE ORDER (L3-13). Learning one rule re-sorted the whole file
      alphabetically. Order decides which rule wins when two matches are the
      same length (rules.js matchRule keeps the first), so an unrelated learn
      could change how a merchant is filed from then on. The default decided
      with the audit: the file's own order is kept, and learned rules go at
      the end.

   Plus the C0 fold (L4A-11): csvCell now drops control characters, so the
   matcher drops them too. Otherwise a rule learned from a description
   carrying a NUL would go to disk without it, stop matching, and pile up dead
   copies the same way as in 1.

   Driven through the REAL loader (makeCtx + loadInto) and the REAL
   categories module (learnRules, correctRule, cleanupRules), reloading from
   the bytes the app wrote. Only the tidy's preview dialog is answered at the
   module loader. Synthetic merchants and categories only.
     node tests/rules-csv-roundtrip.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The tidy's preview is the only Obsidian dialog on these paths. Answered
   "yes" here so cleanupRules runs end to end. */
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null,
      confirmModal: async () => false,
      askRulesCleanup: async () => true,
    };
  }
  return realLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { prepareRules, autoCategorise } = require('../src/rules');
const { parseCsv } = require('../src/csv');
const registerCategories = require('../src/categories');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(['Groceries', 'Transport', 'Food', 'Liquor', 'Phone', 'Bank charges', 'Fuel'].map(c =>
    [`${B}/Categories/${c}.md`, '---\ntype: expense\ncolor: "#888888"\n---\n'])),
};

/* Boot the app's state from a set of files, the way the plugin does. */
async function boot(files) {
  const ctx = makeCtx(files, { budgetFolder: B });
  await loadInto(ctx);
  registerCategories(ctx);
  return ctx;
}
/* Reload from exactly the bytes the previous session left on disk. */
const reload = ctx => boot(Object.fromEntries(ctx.vault._store));
const onDisk = ctx => ctx.vault._store.get(RULES);
const answer = (ctx, desc) => autoCategorise(desc, prepareRules(ctx.S.rules));

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. a learned rule that starts with a formula sign keeps matching ---- */
    {
      let ctx = await boot({ ...BASE, [RULES]: 'pattern,category\nCORNER MART,Groceries\n' });
      const LEARN = [
        { desc: '@PARKING CITYVILLE 004211', cat: 'Transport' },
        { desc: '=EQUALS CAFE NORTHGATE', cat: 'Food' },
        { desc: '+CELL TOPUP 0821234567', cat: 'Phone' },
        { desc: '-ATM FEE 000123', cat: 'Bank charges' },
      ];
      eq(await ctx.learnRules(LEARN), 4, 'precondition: four new rules are learned');

      // The spreadsheet half of the guard still writes: the cells on disk are
      // guarded, which is what makes the reader's half matter.
      const raw = parseCsv(onDisk(ctx)).slice(1).map(r => r[0]);
      ok(['@PARKING CITYVILLE', '=EQUALS CAFE NORTHGATE', '+CELL TOPUP', '-ATM FEE']
        .every(p => raw.includes(`'${p}`)), 'on disk every one of them carries the formula guard');

      ctx = await reload(ctx);
      eq(ctx.S.rules.map(r => r.pattern),
        ['CORNER MART', '@PARKING CITYVILLE', '=EQUALS CAFE NORTHGATE', '+CELL TOPUP', '-ATM FEE'],
        'after a reload the patterns are the ones learned, in the order learned, with no apostrophe');
      eq(answer(ctx, '@PARKING CITYVILLE 009988'), 'Transport', 'the @ rule matches its merchant again');
      eq(answer(ctx, '=EQUALS CAFE NORTHGATE'), 'Food', 'so does the = rule');
      eq(answer(ctx, '+CELL TOPUP 0839876543'), 'Phone', 'and the + rule');
      eq(answer(ctx, '-ATM FEE 000999'), 'Bank charges', 'and the - rule');

      // The next import of the same merchants learns nothing and leaves the
      // file as it is. Before the fix each import added one more dead line.
      const before = onDisk(ctx);
      eq(await ctx.learnRules(LEARN), 0, 'a second import of the same descriptions learns nothing');
      eq(onDisk(ctx), before, 'and the rules file is not touched');
      for (let i = 0; i < 3; i++) {
        ctx = await reload(ctx);
        await ctx.learnRules(LEARN);
      }
      eq(onDisk(ctx), before, 'three more import-and-reload rounds leave the file byte-identical');
      eq(ctx.S.rules.length, 5, 'with exactly one line per rule');
    }

    /* ---- 1b. a file the OLD writer left behind reads correctly ---- */
    {
      // The shape the bug produced: one guarded rule plus the dead copies the
      // next imports appended. They load as working rules now; the dead
      // copies are exact duplicates, which the tidy collapses to one.
      const ctx = await boot({ ...BASE,
        [RULES]: "pattern,category\n\"'@PARKING CITYVILLE\",Transport\n\"'@PARKING CITYVILLE 7\",Transport\n\"'@PARKING CITYVILLE 7\",Transport\n" });
      eq(ctx.S.rules.map(r => r.pattern), ['@PARKING CITYVILLE', '@PARKING CITYVILLE 7', '@PARKING CITYVILLE 7'],
        'every guarded pattern loses its apostrophe on read');
      eq(answer(ctx, '@PARKING CITYVILLE 0042'), 'Transport', 'and matches its merchant');
    }

    /* ---- 1c. a category name that starts with a sign comes back too ---- */
    {
      let ctx = await boot({ ...BASE, [RULES]: 'pattern,category\n' });
      await ctx.learnRules([{ desc: 'HARBOUR DELI 0042', cat: '-Misc' }]);
      ctx = await reload(ctx);
      eq(ctx.S.rules[0].category, '-Misc', 'the category cell is unguarded on read like the pattern cell');
    }

    /* ---- 2. the household's own columns survive a learn, a fix and a tidy ---- */
    {
      const FILE = 'pattern,category,why\n'
        + 'CORNER MART,Groceries,weekly shop\n'
        + 'FUEL DEPOT,Transport,"garage, not snacks"\n'
        + 'HARBOUR DELI,Food\n';   // a short row: no `why` written for this one
      let ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(await ctx.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }]), 1, 'precondition: one rule learned');
      eq(onDisk(ctx), FILE + 'BAKEHOUSE NORTHGATE,Food,\n',
        'the header, every why cell and the short row are written back as they were; the new rule gets an empty why cell, at the end');

      ctx = await reload(ctx);
      const fuel = ctx.governingRule('FUEL DEPOT CITYVILLE');
      ok(await ctx.correctRule(fuel, 'Fuel'), 'precondition: a rule is corrected');
      eq(onDisk(ctx).split('\n')[2], 'FUEL DEPOT,Fuel,"garage, not snacks"',
        'correcting a rule changes its category and keeps its own why cell');

      // Tidy: CORNER MART CENTRAL is covered by CORNER MART and goes. The
      // survivors keep their cells, and so does the backup of the full set.
      ctx = await boot({ ...BASE,
        [RULES]: 'pattern,category,why\nCORNER MART,Groceries,weekly shop\nCORNER MART CENTRAL,Groceries,the big one\nFUEL DEPOT,Transport,garage\n',
        [`${B}/Transactions/Cheque/2026-09.md`]: '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
          + '| 2026-09-03 | CORNER MART CENTRAL 12 | Groceries | -112.40 |  |  |  |\n'
          + '| 2026-09-04 | FUEL DEPOT CITYVILLE | Transport | -287.65 |  |  |  |\n' });
      eq(await ctx.cleanupRules(), 1, 'precondition: the tidy removes the one covered rule');
      eq(onDisk(ctx), 'pattern,category,why\nCORNER MART,Groceries,weekly shop\nFUEL DEPOT,Transport,garage\n',
        'the tidied file keeps the header and the survivors\' why cells');
      const backup = [...ctx.vault._store.keys()].find(k => k.includes('pre-tidy'));
      eq(ctx.vault._store.get(backup),
        'pattern,category,why\nCORNER MART,Groceries,weekly shop\nCORNER MART CENTRAL,Groceries,the big one\nFUEL DEPOT,Transport,garage\n',
        'and the backup holds the full set, extra cells included');
    }

    /* ---- 2b. a header the household wrote is theirs ---- */
    {
      const ctx = await boot({ ...BASE, [RULES]: 'Pattern,Category,Added by\nCORNER MART,Groceries,me\n' });
      await ctx.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }]);
      eq(onDisk(ctx), 'Pattern,Category,Added by\nCORNER MART,Groceries,me\nBAKEHOUSE NORTHGATE,Food,\n',
        'a header that is not "pattern,category" is written back as it was');
    }

    /* ---- 3. learning one rule never reorders the others ---- */
    {
      // CORNER and CELLAR are the same length and both land on word
      // boundaries in this description, so file order decides: CORNER is
      // first, CORNER wins. Sorted, CELLAR would come first and win instead.
      const FILE = 'pattern,category\nCORNER,Food\nCELLAR,Liquor\n';
      const TIE = 'CELLAR CORNER CITYVILLE';
      let ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(answer(ctx, TIE), 'Food', 'precondition: file order settles the tie for the first rule');
      eq(await ctx.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }, { desc: 'ALPINE TAXI 0042', cat: 'Transport' }]), 2,
        'precondition: two unrelated rules are learned');
      eq(onDisk(ctx), FILE + 'BAKEHOUSE NORTHGATE,Food\nALPINE TAXI,Transport\n',
        'the existing lines keep their order and the new ones are appended in the order they were learned');
      ctx = await reload(ctx);
      eq(answer(ctx, TIE), 'Food', 'after the reload the same rule still wins the tie');
    }

    /* ---- 4. a control character cannot strand a learned rule ---- */
    {
      let ctx = await boot({ ...BASE, [RULES]: 'pattern,category\n' });
      const LEARN = [{ desc: 'POS\u0000PURCHASE CITYVILLE', cat: 'Fuel' }];
      eq(await ctx.learnRules(LEARN), 1, 'precondition: the rule is learned');
      ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(onDisk(ctx)), 'the rules file carries no control character');
      ctx = await reload(ctx);
      eq(answer(ctx, 'POS\u0000PURCHASE CITYVILLE'), 'Fuel', 'the description it came from still matches after a reload');
      const before = onDisk(ctx);
      eq(await ctx.learnRules(LEARN), 0, 'and the next import does not learn it again');
      eq(onDisk(ctx), before, 'so no dead copy is written');
    }

    console.log(`PASS — rules-csv-roundtrip: learned rules keep matching, the household's columns and order survive (${checks} assertions).`);
  } finally { unpin(); }
})().catch(err => { console.error(err); process.exit(1); });
