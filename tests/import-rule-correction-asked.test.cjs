'use strict';
/* A category the reader changes on the import review, for a merchant whose
   pattern is already a rule pointing somewhere else, is ASKED about after the
   commit — never dropped without a word (2026-11-25 audit, RUL-3).

   learnRules skips a pattern the rules file already has ("an established rule
   is never silently overwritten"), which is right for automatic learning. But
   the import commit then said nothing at all: the toast only spoke when a NEW
   rule was saved, so a reader who refiled every "CHECKERS RONDEBOSCH" row from
   Food to Liquor saw "Imported 3 transactions" and got Food again on the next
   statement, and the one after that, with no trail to the rule doing it.

   Now the skipped corrections come back from the learn, and one confirm after
   the commit lists them (capped, "and N more"):
     - "Update the rules" repoints them through correctRule's path, one write
       of the rules file, the household's order and extra columns kept;
     - "Keep the rules" (the safe side, as on the Transactions page) leaves the
       file alone, and the toast says the rows were filed as chosen while the
       rules still point elsewhere.
   A pattern two review rows filed two different ways is listed as conflicting
   and never repointed. With "remember new categorisations" off nothing is
   asked and nothing changes, as before.

   Through the REAL loader, import view, commit and rules writer, reloading
   from the bytes the app wrote. Synthetic merchants only.
     node tests/import-rule-correction-asked.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const asked = [];
let answer = false;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null, askSplit: async () => null,
      confirmModal: async (app, opts) => { asked.push(opts); return answer; },
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { prepareRules, autoCategorise } = require('../src/rules');
const { parseCsv } = require('../src/csv');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const CATS = ['Food', 'Liquor', 'Groceries', 'Fuel', 'Clothing'];
const RULES_CSV = 'pattern,category,why\n'
  + 'CORNER MART,Groceries,\n'
  + 'CHECKERS RONDEBOSCH,Food,the big one\n'
  + 'ZED SHOP,Liquor,\n'
  + 'WOOLIES NORTHGATE,Food,\n';
const FILES = (rules = RULES_CSV) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(CATS.map(c => [`${B}/Categories/${c}.md`, '---\ntype: expense\ncolor: "#888888"\n---\n'])),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [RULES]: rules,
});
const CSV = ['Date,Description,Amount',
  '2026-10-03,CHECKERS RONDEBOSCH 123456,-410.00',
  '2026-10-09,CHECKERS RONDEBOSCH 778899,-95.50',
  '2026-10-11,ZED SHOP 0042,-120.00',
  '2026-10-12,WOOLIES NORTHGATE 778899,-60.00',
  '2026-10-13,WOOLIES NORTHGATE 112233,-75.00',
  '2026-10-14,BRAND NEW BAKERY 5521,-30.00'].join('\n');

async function mount(files) {
  const m = await mountFor(files, { period: '2026-10', budgetFolder: B });
  const { ctx } = m;
  ctx.render = () => {}; ctx.switchView = () => {}; ctx.renderTransactions = () => {};
  m.writes = { rules: 0 };
  for (const fn of ['create', 'modify']) {
    const real = ctx.vault[fn].bind(ctx.vault);
    ctx.vault[fn] = async (a, ...r) => {
      if ((typeof a === 'string' ? a : a.path) === RULES) m.writes.rules++;
      return real(a, ...r);
    };
  }
  m.open = async (csv = CSV) => {
    await ctx.handleStatementFile({ name: 'stmt.csv', async arrayBuffer() { return new TextEncoder().encode(csv).buffer; } });
    const p = ctx.S.pendingImport;
    p.label = 'Cheque';
    ctx.renderImportReview();
    return p;
  };
  m.lastToast = () => (ctx._toasts[ctx._toasts.length - 1] || {}).msg || '';
  return m;
}
/* The reader picking a category on the review: what the select's onchange does. */
const pick = (p, desc, cat) => { const it = p.items.find(i => i.desc === desc); it.cat = cat; it.manual = true; };
async function reload(ctx) {
  const c = makeCtx(Object.fromEntries(ctx.vault._store), { budgetFolder: B });
  await loadInto(c);
  return c;
}
const answerFor = (S, desc) => autoCategorise(desc, prepareRules(S.rules));

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    /* ---- 1. one correction, "Update the rules" ------------------------------ */
    {
      asked.length = 0; answer = true;
      const { ctx, S, open, lastToast, ...m } = await mount(FILES());
      ctx.$('#impRemember').checked = true;
      const p = await open();
      eq(p.items.find(i => i.desc.startsWith('CHECKERS')).cat, 'Food', 'precondition: the rule files Checkers as Food');
      pick(p, 'CHECKERS RONDEBOSCH 123456', 'Liquor');
      pick(p, 'CHECKERS RONDEBOSCH 778899', 'Liquor');
      await ctx.commitImport();
      eq(asked.length, 1, 'the commit asks once about the rule the reader disagreed with (RUL-3: it said nothing)');
      const msg = asked[0].message;
      ok(msg.includes('CHECKERS RONDEBOSCH') && msg.includes('Food') && msg.includes('Liquor'),
        'the question names the pattern, the category the rule has, and the one chosen');
      ok(/2 rows/.test(msg), 'and how many review rows chose it');
      eq(asked[0].primary, 'cancel', 'keeping the rule is the safe default, as on the Transactions page');
      eq(m.writes.rules, 1, 'Update writes the rules file once');
      const back = await reload(ctx);
      eq(answerFor(back.S, 'CHECKERS RONDEBOSCH 000111'), 'Liquor', 'after a reload the rule files Checkers as Liquor');
      eq(back.S.rules.map(r => r.pattern), ['CORNER MART', 'CHECKERS RONDEBOSCH', 'ZED SHOP', 'WOOLIES NORTHGATE'],
        'the household\'s order is kept (nothing re-sorted)');
      const row = parseCsv(ctx.vault._store.get(RULES)).find(r => r[0] === 'CHECKERS RONDEBOSCH');
      eq(row, ['CHECKERS RONDEBOSCH', 'Liquor', 'the big one'], 'and the rule\'s own extra cell survives the repoint');
      ok(/updated 1 rule/i.test(lastToast()), `the toast says the rule was updated: ${lastToast()}`);
      const rows = Object.values(S.txFiles).flatMap(f => f.rows).filter(r => r.desc.startsWith('CHECKERS'));
      eq(rows.map(r => r.cat), ['Liquor', 'Liquor'], 'the rows are filed as chosen');
    }

    /* ---- 2. "Keep the rules" ---------------------------------------------- */
    {
      asked.length = 0; answer = false;
      const { ctx, S, open, lastToast, ...m } = await mount(FILES());
      ctx.$('#impRemember').checked = true;
      const p = await open();
      pick(p, 'CHECKERS RONDEBOSCH 123456', 'Liquor');
      await ctx.commitImport();
      eq(asked.length, 1, 'asked once');
      eq(m.writes.rules, 0, 'Keep leaves the rules file unwritten');
      eq(ctx.vault._store.get(RULES), RULES_CSV, 'byte for byte');
      eq(answerFor(S, 'CHECKERS RONDEBOSCH 1'), 'Food', 'the rule still says Food');
      ok(/CHECKERS RONDEBOSCH/.test(lastToast()) && /still/i.test(lastToast()),
        `the toast says the row was filed as chosen but the rule still points elsewhere: ${lastToast()}`);
      eq(Object.values(S.txFiles).flatMap(f => f.rows).find(r => r.desc === 'CHECKERS RONDEBOSCH 123456').cat, 'Liquor',
        'the row itself keeps the reader\'s category');
    }

    /* ---- 3. two rows, one pattern, two categories: conflicting, left -------- */
    {
      asked.length = 0; answer = true;
      const { ctx, S, open, lastToast } = await mount(FILES());
      ctx.$('#impRemember').checked = true;
      const p = await open();
      pick(p, 'WOOLIES NORTHGATE 778899', 'Groceries');
      pick(p, 'WOOLIES NORTHGATE 112233', 'Clothing');
      pick(p, 'ZED SHOP 0042', 'Food');
      await ctx.commitImport();
      eq(asked.length, 1, 'one question for the commit');
      ok(/WOOLIES NORTHGATE/.test(asked[0].message) && /different/i.test(asked[0].message),
        'the conflicting pattern is listed as such');
      const back = await reload(ctx);
      eq(answerFor(back.S, 'ZED SHOP 9'), 'Food', 'the unambiguous correction is applied');
      eq(answerFor(back.S, 'WOOLIES NORTHGATE 9'), 'Food', 'the conflicting pattern\'s rule is never repointed');
      ok(/WOOLIES NORTHGATE/.test(lastToast()), `and the toast names it as left alone: ${lastToast()}`);
      void S;
    }

    /* ---- 4. only a conflict: nothing to ask, the toast says it ------------- */
    {
      asked.length = 0; answer = true;
      const { ctx, open, lastToast, ...m } = await mount(FILES());
      ctx.$('#impRemember').checked = true;
      const p = await open();
      pick(p, 'WOOLIES NORTHGATE 778899', 'Groceries');
      pick(p, 'WOOLIES NORTHGATE 112233', 'Clothing');
      await ctx.commitImport();
      eq(asked.length, 0, 'with no correction to make, no question');
      eq(m.writes.rules, 0, 'and no write');
      ok(/WOOLIES NORTHGATE/.test(lastToast()), `the toast still names the pattern it left: ${lastToast()}`);
    }

    /* ---- 5. "remember new categorisations" off: nothing asked or changed --- */
    {
      asked.length = 0; answer = true;
      const { ctx, open, ...m } = await mount(FILES());
      ctx.$('#impRemember').checked = false;
      const p = await open();
      pick(p, 'CHECKERS RONDEBOSCH 123456', 'Liquor');
      await ctx.commitImport();
      eq(asked.length, 0, 'the tick off means no question');
      eq(m.writes.rules, 0, 'and no rule change');
    }

    /* ---- 6. a long list is capped, and says how many more ------------------ */
    {
      asked.length = 0; answer = true;
      const names = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL'].map(n => `${n} STORE`);
      const rules = 'pattern,category\n' + names.map(n => `${n},Food`).join('\n') + '\n';
      const csv = 'Date,Description,Amount\n' + names.map((n, i) => `2026-10-${String(i + 2).padStart(2, '0')},${n} 1234,-10.00`).join('\n');
      const { ctx, open, ...m } = await mount(FILES(rules));
      ctx.$('#impRemember').checked = true;
      const p = await open(csv);
      for (const n of names) pick(p, `${n} 1234`, 'Fuel');
      await ctx.commitImport();
      eq(asked.length, 1, 'eight corrections, one question');
      const shown = names.filter(n => asked[0].message.includes(n)).length;
      ok(shown < names.length && shown >= 3, `only some are listed (${shown})`);
      ok(asked[0].message.includes(`and ${names.length - shown} more`), `with "and N more": ${asked[0].message}`);
      eq(m.writes.rules, 1, 'all eight are repointed in one write');
      const back = await reload(ctx);
      eq(names.map(n => answerFor(back.S, `${n} 9`)), names.map(() => 'Fuel'), 'every one of them, not only the listed ones');
    }

    /* ---- 7. the learn reports what it skipped -------------------------------- */
    {
      const ctx = makeCtx(FILES(), { budgetFolder: B });
      await loadInto(ctx);
      require('../src/categories')(ctx);
      const res = await ctx.learnRulesWithCorrections([
        { desc: 'CHECKERS RONDEBOSCH 1', cat: 'Liquor' },
        { desc: 'CHECKERS RONDEBOSCH 2', cat: 'Liquor' },
        { desc: 'CORNER MART 3', cat: 'Groceries' },
        { desc: 'WOOLIES NORTHGATE 4', cat: 'Groceries' },
        { desc: 'WOOLIES NORTHGATE 5', cat: 'Clothing' },
        { desc: 'BRAND NEW BAKERY 6', cat: 'Food' },
      ]);
      eq(res.added, 1, 'the one new pattern is learned, as before');
      eq(res.corrections.map(c => [c.pattern, c.from, c.to, c.count]), [['CHECKERS RONDEBOSCH', 'Food', 'Liquor', 2]],
        'the skipped disagreement comes back with the rule\'s category, the chosen one and the row count');
      eq(res.conflicts.map(c => [c.pattern, c.category, c.chosen.map(x => [x.cat, x.count])]),
        [['WOOLIES NORTHGATE', 'Food', [['Groceries', 1], ['Clothing', 1]]]], 'and the conflicting pattern separately');
      eq(await ctx.learnRules([{ desc: 'CHECKERS RONDEBOSCH 1', cat: 'Liquor' }]), 0,
        'learnRules itself still answers with the number added, for the Transactions page');
    }

    console.log(`PASS import-rule-correction-asked — a category that disagrees with an existing rule is asked about, not dropped (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
