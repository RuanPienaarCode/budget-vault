'use strict';
/* Data/Categorisation Rules.csv gains an optional subcategory column (ADR-0010
   section 5, issue #185), and a household that never uses one never sees the
   file change.

   Driven through the REAL loader (makeCtx + loadInto) and the REAL
   categories module (learnRules, learnRulesWithCorrections, correctRules,
   cleanupRules), reloading from the bytes the app wrote — the way
   tests/rules-csv-roundtrip.test.cjs does, which is the guard for two-column
   files and stays as it is. Only the tidy's preview dialog is answered at the
   module loader. Synthetic merchants and categories only.

   What is pinned:
     1. a file with no subcategory is written back byte for byte, learning a
        rule with none included — the third column is not added until a rule
        needs it;
     2. the column is found by its HEADER: a household's own `why` column in
        the third slot is never read as a subcategory, and when one is needed
        it goes after every column the file already has;
     3. matching: a blank cell sets the category alone, a filled one sets both;
     4. learning: a pair with both teaches them, a later pair for the same
        description with a different subcategory updates the rule, a blank one
        never takes a subcategory away, a different category is still only a
        correction that is reported;
     5. the shortening rule: a shorter rule that already answers category and
        subcategory absorbs a longer pair; one that answers a different
        subcategory does not, and neither does the tidy;
     6. repointing a rule at another category takes its subcategory with the
        old category.
     node tests/rules-subcategory-csv.test.cjs */

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
const { prepareRules, autoCategoriseWithSub } = require('../src/rules');
const registerCategories = require('../src/categories');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(['Groceries', 'Car', 'Home', 'Food'].map(c =>
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
const answer = (ctx, desc) => autoCategoriseWithSub(desc, prepareRules(ctx.S.rules));
const writes = ctx => {
  const n = { count: 0 };
  for (const fn of ['create', 'modify']) {
    const real = ctx.vault[fn].bind(ctx.vault);
    ctx.vault[fn] = async (a, ...r) => { if ((typeof a === 'string' ? a : a.path) === RULES) n.count++; return real(a, ...r); };
  }
  return n;
};

(async () => {
  const unpin = pinClock('2026-11-28');
  try {
    /* ---- 1. no subcategory anywhere: not a byte moves ------------------------ */
    {
      const FILE = 'pattern,category\nCORNER MART,Groceries\n';
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(ctx.S.rules.map(r => 'subcategory' in r), [false], 'a two-column rule has no subcategory field');
      eq(await ctx.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }]), 1, 'precondition: a rule with a category alone is learned');
      eq(onDisk(ctx), FILE + 'BAKEHOUSE NORTHGATE,Food\n', 'the file stays two columns: the header is not touched and no cell is added');
      eq(await ctx.learnRules([{ desc: 'ALPINE TAXI 0042', cat: 'Car', subcategory: '' }, { desc: 'RIVER DELI 0042', cat: 'Food', subcategory: '   ' }]), 2,
        'a blank or spaces-only subcategory is no subcategory');
      eq(onDisk(ctx), FILE + 'BAKEHOUSE NORTHGATE,Food\nALPINE TAXI,Car\nRIVER DELI,Food\n', 'so still two columns');
      const back = await reload(ctx);
      eq(answer(back, 'ALPINE TAXI 9'), { category: 'Car', subcategory: '' }, 'and a blank subcategory sets the category alone');
    }

    /* ---- 1b. a file that already has the column but uses none is not changed -- */
    {
      const FILE = 'pattern,category,subcategory\nCORNER MART,Groceries,\nHARBOUR DELI,Food\n';
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(await ctx.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }]), 1, 'precondition');
      eq(onDisk(ctx), FILE + 'BAKEHOUSE NORTHGATE,Food,\n',
        'a blank cell stays blank, the short row stays short, and the learned rule gets an empty cell to line up');
    }

    /* ---- 2. found by header: the household's third column is theirs ----------- */
    {
      const FILE = 'pattern,category,why\nCORNER MART,Groceries,weekly shop\nFUEL DEPOT,Car,"garage, not snacks"\n';
      let ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(answer(ctx, 'CORNER MART CITYVILLE'), { category: 'Groceries', subcategory: '' },
        'a `why` column is not read as a subcategory (the sentence would have been filed on every transaction)');
      eq(await ctx.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }]), 1, 'a category-only rule');
      eq(onDisk(ctx), FILE + 'BAKEHOUSE NORTHGATE,Food,\n', 'writes no subcategory column; the why column and its cells are as they were');
      eq(await ctx.learnRules([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car', subcategory: 'Fuel' }]), 1, 'a rule that needs one');
      eq(onDisk(ctx),
        'pattern,category,why,subcategory\nCORNER MART,Groceries,weekly shop\nFUEL DEPOT,Car,"garage, not snacks"\nBAKEHOUSE NORTHGATE,Food,,\nENGEN RONDEBOSCH,Car,,Fuel\n',
        'the column goes after every column the file already has; the household\'s rows are not padded, and a rule learned this session lines up with the new width, as it always has');
      ctx = await reload(ctx);
      eq(answer(ctx, 'ENGEN RONDEBOSCH 1'), { category: 'Car', subcategory: 'Fuel' }, 'after a reload the header finds it');
      eq(answer(ctx, 'FUEL DEPOT X'), { category: 'Car', subcategory: '' }, 'and why is still not one');
      eq(ctx.S.rules[0].extra, ['weekly shop'], 'the why cell is still the rule\'s own extra cell');
    }

    /* ---- 2b. an upper-case header gets an upper-case word -------------------- */
    {
      const ctx = await boot({ ...BASE, [RULES]: 'Pattern,Category\nCORNER MART,Groceries\n' });
      await ctx.learnRules([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car', subcategory: 'Fuel' }]);
      eq(onDisk(ctx), 'Pattern,Category,Subcategory\nCORNER MART,Groceries\nENGEN RONDEBOSCH,Car,Fuel\n', 'like the two beside it');
    }

    /* ---- 2c. no file yet --------------------------------------------------- */
    {
      const ctx = await boot({ ...BASE });
      await ctx.learnRules([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car', subcategory: 'Fuel' }]);
      eq(onDisk(ctx), 'pattern,category,subcategory\nENGEN RONDEBOSCH,Car,Fuel\n', 'a new file starts with the three columns when its first rule has one');
      const none = await boot({ ...BASE });
      await none.learnRules([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car' }]);
      eq(onDisk(none), 'pattern,category\nENGEN RONDEBOSCH,Car\n', 'and with two when it does not');
    }

    /* ---- 2d. the column is added once, and a cell typed by hand goes back as typed ---- */
    {
      const ctx = await boot({ ...BASE, [RULES]: 'pattern,category\nCORNER MART,Groceries\n' });
      await ctx.learnRules([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car', subcategory: 'Fuel' }]);
      await ctx.learnRules([{ desc: 'SHELL KLOOF 0042', cat: 'Car', subcategory: 'Fuel' }]);   // same session, no reload
      eq(onDisk(ctx), 'pattern,category,subcategory\nCORNER MART,Groceries\nENGEN RONDEBOSCH,Car,Fuel\nSHELL KLOOF,Car,Fuel\n',
        'a second learn in the same session does not add the column again');

      const typed = 'pattern,category,subcategory\nENGEN RONDEBOSCH,Car, Fuel \nCORNER MART,Groceries,\n';
      const ctx2 = await boot({ ...BASE, [RULES]: typed });
      eq(ctx2.S.rules[0].subcategory, 'Fuel', 'a cell with spaces around the name reads as the name');
      await ctx2.learnRules([{ desc: 'BAKEHOUSE NORTHGATE', cat: 'Food' }]);
      eq(onDisk(ctx2), typed + 'BAKEHOUSE NORTHGATE,Food,\n', 'and goes back as typed while it still means the same name');
    }

    /* ---- 3. matching: blank sets the category alone, filled sets both ---------- */
    {
      const ctx = await boot({ ...BASE, [RULES]: 'pattern,category,subcategory\nENGEN,Car,Fuel\nCORNER MART,Groceries,\nTOLL GATE,Car, Tolls\n' });
      eq(answer(ctx, 'ENGEN RONDEBOSCH'), { category: 'Car', subcategory: 'Fuel' }, 'a rule with a subcategory sets both');
      eq(answer(ctx, 'CORNER MART X'), { category: 'Groceries', subcategory: '' }, 'a rule with a blank cell sets the category alone');
      eq(answer(ctx, 'TOLL GATE N1'), { category: 'Car', subcategory: 'Tolls' }, 'a subcategory is trimmed');
    }

    /* ---- 4. learning --------------------------------------------------------- */
    {
      const FILE = 'pattern,category,subcategory\nENGEN RONDEBOSCH,Car,Fuel\nCORNER MART,Groceries,\n';
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      const w = writes(ctx);

      // 4a. the same description, a different subcategory: the rule is updated
      let res = await ctx.learnRulesWithCorrections([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car', subcategory: 'Services' }]);
      eq([res.added, res.updated, res.corrections.length, res.conflicts.length], [0, 1, 0, 0], 'a later save with a different subcategory updates the rule, adds none, asks nothing');
      eq(onDisk(ctx), 'pattern,category,subcategory\nENGEN RONDEBOSCH,Car,Services\nCORNER MART,Groceries,\n', 'one cell changed, nothing else');
      eq(w.count, 1, 'in one write');

      // 4b. a blank subcategory is "did not say", never "take it away"
      res = await ctx.learnRulesWithCorrections([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car' }]);
      eq([res.added, res.updated], [0, 0], 'a pair with no subcategory changes nothing');
      eq(w.count, 1, 'and writes nothing');
      ok(onDisk(ctx).includes('ENGEN RONDEBOSCH,Car,Services'), 'the rule keeps its subcategory');

      // 4c. a subcategory where the rule has none
      res = await ctx.learnRulesWithCorrections([{ desc: 'CORNER MART 0042', cat: 'Groceries', subcategory: 'Fresh' }]);
      eq([res.added, res.updated], [0, 1], 'a rule with a blank cell is taught one');
      eq(onDisk(ctx).split('\n')[2], 'CORNER MART,Groceries,Fresh', 'in its own cell');

      // 4d. the same subcategory again is not an update
      res = await ctx.learnRulesWithCorrections([{ desc: 'CORNER MART 0042', cat: 'Groceries', subcategory: 'Fresh' }]);
      eq([res.added, res.updated], [0, 0], 'saying what the rule already says is not an update');
      eq(w.count, 2, 'and writes nothing');

      // 4e. a different category is still only a correction, reported and not applied
      const before = onDisk(ctx);
      res = await ctx.learnRulesWithCorrections([{ desc: 'ENGEN RONDEBOSCH 0042', cat: 'Home', subcategory: 'Fuel' }]);
      eq([res.added, res.updated], [0, 0], 'a pair for another category updates nothing');
      eq(res.corrections.map(c => [c.pattern, c.from, c.to]), [['ENGEN RONDEBOSCH', 'Car', 'Home']], 'it is reported as a correction, as before');
      eq(onDisk(ctx), before, 'and the file is not touched');

      // 4f. learnRules counts what it taught: added and updated
      eq(await ctx.learnRules([
        { desc: 'ENGEN RONDEBOSCH 0042', cat: 'Car', subcategory: 'Fuel' },     // update
        { desc: 'NORTH GARAGE 0042', cat: 'Car', subcategory: 'Fuel' },         // add
      ]), 2, 'learnRules returns the rules it added and the rules it updated');

      // 4g. a pair with no category teaches nothing, a subcategory with it or not
      eq(await ctx.learnRules([{ desc: 'NOWHERE SHOP 0042', cat: '', subcategory: 'Fuel' }]), 0, 'a subcategory with no category is not learned');

      // 4h. everything survives a reload
      const back = await reload(ctx);
      eq(answer(back, 'NORTH GARAGE 7'), { category: 'Car', subcategory: 'Fuel' }, 'a rule learned with both applies both after a reload');
      eq(back.S.rules.map(r => r.pattern), ['ENGEN RONDEBOSCH', 'CORNER MART', 'NORTH GARAGE'], 'in the household\'s order, learned rules last');
    }

    /* ---- 5. the shortening rule holds when subcategories differ ------------------ */
    {
      const FILE = 'pattern,category,subcategory\nSHELL GARAGE,Car,Fuel\n';
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      eq(await ctx.learnRules([{ desc: 'SHELL GARAGE ROSEBANK 0042', cat: 'Car', subcategory: 'Fuel' }]), 0,
        'a shorter rule that already answers the category and the subcategory still absorbs the pair');
      eq(onDisk(ctx), FILE, 'and the file is untouched');
      eq(await ctx.learnRules([{ desc: 'SHELL GARAGE ROSEBANK 0042', cat: 'Car', subcategory: 'Services' }]), 1,
        'the same category with a different subcategory is not merged: a rule is learned');
      eq(await ctx.learnRules([{ desc: 'SHELL GARAGE NEWLANDS 0042', cat: 'Car' }]), 1,
        'nor is the same category with none');
      eq(onDisk(ctx), FILE + 'SHELL GARAGE ROSEBANK,Car,Services\nSHELL GARAGE NEWLANDS,Car,\n', 'both are in the file, each with its own answer');
      const back = await reload(ctx);
      eq(answer(back, 'SHELL GARAGE ROSEBANK 7'), { category: 'Car', subcategory: 'Services' }, 'and each answers its own merchant');
      eq(answer(back, 'SHELL GARAGE NEWLANDS 7'), { category: 'Car', subcategory: '' }, 'including the one that says none');
      eq(answer(back, 'SHELL GARAGE SOMEWHERE 7'), { category: 'Car', subcategory: 'Fuel' }, 'while the short rule still answers the rest');

      // Without any subcategory the old absorbing is what it was.
      const plain = await boot({ ...BASE, [RULES]: 'pattern,category\nSHELL GARAGE,Car\n' });
      eq(await plain.learnRules([{ desc: 'SHELL GARAGE ROSEBANK 0042', cat: 'Car' }]), 0, 'no subcategories anywhere: absorbed, as before');
    }

    /* ---- 5b. the tidy replays the answers, subcategory included ------------------- */
    {
      const TX = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n'
        + '| 2026-09-03 | SHELL GARAGE ROSEBANK 12 | Car | -112.40 |  |  |\n'
        + '| 2026-09-04 | SHELL GARAGE NEWLANDS 12 | Car | -287.65 |  |  |\n';
      const files = rules => ({ ...BASE, [RULES]: rules, [`${B}/Transactions/Cheque/2026-09.md`]: TX });

      const keep = 'pattern,category,subcategory\nSHELL GARAGE,Car,Fuel\nSHELL GARAGE ROSEBANK,Car,Services\nSHELL GARAGE NEWLANDS,Car,\n';
      const a = await boot(files(keep));
      eq(await a.cleanupRules(), 0, 'two rules for one category with different subcategories (or none) are not merged by the tidy');
      eq(onDisk(a), keep, 'and the file is untouched');

      const merge = 'pattern,category,subcategory\nSHELL GARAGE,Car,Fuel\nSHELL GARAGE ROSEBANK,Car,Fuel\nSHELL GARAGE NEWLANDS,Car,Services\n';
      const b = await boot(files(merge));
      eq(await b.cleanupRules(), 1, 'a longer rule that gives exactly the answer of the shorter one is still tidied');
      eq(onDisk(b), 'pattern,category,subcategory\nSHELL GARAGE,Car,Fuel\nSHELL GARAGE NEWLANDS,Car,Services\n', 'the survivors keep their subcategories');
      const backup = [...b.vault._store.keys()].find(k => k.includes('pre-tidy'));
      eq(b.vault._store.get(backup), merge, 'and the backup holds the full set, subcategories included');
    }

    /* ---- 6. repointing a rule takes its subcategory with the old category ---------- */
    {
      const FILE = 'pattern,category,why,subcategory\nENGEN RONDEBOSCH,Car,pump,Fuel\nCORNER MART,Groceries,,\n';
      const ctx = await boot({ ...BASE, [RULES]: FILE });
      const rule = ctx.governingRule('ENGEN RONDEBOSCH 0042');
      eq(await ctx.correctRules([{ rule, to: 'Home' }]), 1, 'precondition: one rule is repointed');
      ok(!('subcategory' in rule), 'the rule\'s subcategory went with its old category');
      eq(onDisk(ctx), 'pattern,category,why,subcategory\nENGEN RONDEBOSCH,Home,pump,\nCORNER MART,Groceries,,\n', 'the cell is blank, the why cell is kept');
      const same = ctx.governingRule('CORNER MART 1');
      eq(await ctx.correctRules([{ rule: same, to: 'Groceries' }]), 0, 'repointing at the category it has is no change');
    }

    console.log(`PASS — rules-subcategory-csv: a two-column file never moves, the column is found by header, a rule learns and applies its pair (${checks} assertions).`);
  } finally { unpin(); }
})().catch(err => { console.error(err); process.exit(1); });
