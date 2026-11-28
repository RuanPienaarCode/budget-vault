'use strict';
/* A categorisation rule that carries a subcategory files the import with both,
   the review shows what the rule chose as text, and choosing another category
   there clears it (ADR-0010 section 5, issue #185).

   The REAL import view, review, category control and commit, over the real
   loader and rules writer, in an in-memory vault, read through the DOM stub.
   The category control is driven the way a reader drives it: press the cell's
   button, pick in the <select> it becomes. Only the dialogs are scripted.
   Synthetic merchants only.

   Pinned:
     1. a rule with a subcategory sets both on the review's rows and on the
        rows written; a rule with a blank one sets the category alone, and an
        import that uses no subcategory writes a month file with no Subcategory
        column at all;
     2. the review prints the subcategory as text beside the category, only for
        the rows whose rule has one, and it is not an editable control;
     3. changing the category on the review clears it, on screen and in the
        row written; picking the category a row already has does not;
     4. the pair a reader chose by hand is learned with the subcategory it
        carries, and a rule repointed from the review loses its subcategory
        with its old category.
     node tests/import-rule-subcategory.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

let answer = false;
const asked = [];
const fakeModal = {
  askFields: async () => null, askSplit: async () => null, askSubcategories: async () => undefined,
  confirmModal: async (app, opts) => { asked.push(opts); return answer; },
  askRulesCleanup: async () => false, askBudgetReslice: async () => null,
};
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '../modal' || req === './modal') return fakeModal;
  return origLoad.call(this, req, ...rest);
};
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, hasClass, textOf } = require('./helpers/dash-audit.cjs');
const { parseCsv } = require('../src/csv');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const TX = `${B}/Transactions/Cheque/2026-10.md`;
const CATS = ['Car', 'Home', 'Groceries', 'Food'];
const FILES = rules => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(CATS.map(c => [`${B}/Categories/${c}.md`, '---\ntype: expense\ncolor: "#888888"\n---\n'])),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [RULES]: rules,
});
const RULES_3 = 'pattern,category,subcategory\nENGEN RONDEBOSCH,Car,Fuel\nCORNER MART,Groceries,\n';
const STATEMENT = ['Date,Description,Amount',
  '2026-10-03,ENGEN RONDEBOSCH 0042,-500.00',
  '2026-10-04,CORNER MART 778899,-60.00',
  '2026-10-05,BRAND NEW BAKERY 5521,-30.00'].join('\n');

async function open(rules, csv = STATEMENT) {
  const M = await mountFor(FILES(rules), { period: '2026-10', budgetFolder: B });
  const { ctx } = M;
  ctx.render = () => {}; ctx.switchView = () => {}; ctx.renderTransactions = () => {};
  ctx.$('#impRemember').checked = false;
  await ctx.handleStatementFile({ name: 'stmt.csv', async arrayBuffer() { return new TextEncoder().encode(csv).buffer; } });
  const p = ctx.S.pendingImport;
  p.label = 'Cheque';
  ctx.renderImportReview();
  M.p = p;
  return M;
}
const item = (M, start) => M.p.items.find(i => i.desc.startsWith(start));
const reviewRow = (M, start) => find(M.ctx.$('#impTable'), n => n.tagName === 'TR')
  .find(tr => find(tr, td => td.tagName === 'TD').some(td => textOf(td).startsWith(start)));
const subText = (M, start) => { const r = reviewRow(M, start); return find(r, n => hasClass(n, 'imp-rule-sub')).map(textOf); };
/* The reader changing a row's category: the cell is a button until pressed. */
function pickCategory(M, start, cat) {
  const cell = find(reviewRow(M, start), n => hasClass(n, 'cat-cell'))[0];
  find(cell, n => n.tagName === 'BUTTON')[0].click();
  const sel = find(cell, n => n.tagName === 'SELECT')[0];
  sel.value = cat;
  sel._fire('change');
}
const rowsOf = M => Object.values(M.ctx.S.txFiles).flatMap(f => f.rows);
const rowFor = (M, start) => rowsOf(M).find(r => r.desc.startsWith(start));

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    /* ---- 1. the rule files the import with both ---------------------------- */
    {
      const M = await open(RULES_3);
      eq([item(M, 'ENGEN').cat, item(M, 'ENGEN').subcategory], ['Car', 'Fuel'], 'a rule with a subcategory sets both on the review row');
      eq([item(M, 'CORNER').cat, subcategoryOrNone(item(M, 'CORNER'))], ['Groceries', ''], 'a rule with a blank subcategory sets the category alone');
      eq([item(M, 'BRAND').cat, subcategoryOrNone(item(M, 'BRAND'))], ['', ''], 'no rule: neither');

      await M.ctx.commitImport();
      eq([rowFor(M, 'ENGEN').cat, rowFor(M, 'ENGEN').subcategory], ['Car', 'Fuel'], 'the row written carries both');
      ok(!('subcategory' in rowFor(M, 'CORNER')), 'the blank rule\'s row carries no subcategory field');
      const file = M.ctx.vault._store.get(TX);
      ok(/\| Date \| Description \| Category \| Amount \| Excluded \| Note \| Subcategory \|/.test(file), 'the month file gains its Subcategory column, because a row uses one');
      ok(/\| ENGEN RONDEBOSCH 0042 \| Car \| -500\.00 \|  \|  \| Fuel \|/.test(file), 'and the row says Fuel in it');
    }

    /* ---- 1b. an import that uses none leaves the month file as it always was ------ */
    {
      const M = await open(RULES_3, ['Date,Description,Amount', '2026-10-04,CORNER MART 778899,-60.00', '2026-10-05,BRAND NEW BAKERY 5521,-30.00'].join('\n'));
      await M.ctx.commitImport();
      const file = M.ctx.vault._store.get(TX);
      ok(!/Subcategory/.test(file), 'no row uses a subcategory, so the month file has no Subcategory column');
      ok(/\| Date \| Description \| Category \| Amount \| Excluded \| Note \|\n/.test(file), 'it is the six columns it has always been');
    }

    /* ---- 1c. a two-column rules file imports exactly as before ------------------- */
    {
      const M = await open('pattern,category\nENGEN RONDEBOSCH,Car\nCORNER MART,Groceries\n');
      eq([item(M, 'ENGEN').cat, subcategoryOrNone(item(M, 'ENGEN'))], ['Car', ''], 'a two-column rule sets the category alone');
      eq(subText(M, '2026-10-03'), [], 'and the review shows no subcategory');
      await M.ctx.commitImport();
      ok(!/Subcategory/.test(M.ctx.vault._store.get(TX)), 'and writes none');
      eq(M.ctx.vault._store.get(RULES), 'pattern,category\nENGEN RONDEBOSCH,Car\nCORNER MART,Groceries\n', 'the rules file is untouched');
    }

    /* ---- 2. the review shows it as text, beside the category -------------------- */
    {
      const M = await open(RULES_3);
      eq(subText(M, '2026-10-03'), ['Fuel'], 'the row whose rule chose Fuel prints it');
      eq(subText(M, '2026-10-04'), [], 'a row whose rule chose none prints nothing');
      eq(subText(M, '2026-10-05'), [], 'nor does an uncategorised row');
      const row = reviewRow(M, '2026-10-03');
      const note = find(row, n => hasClass(n, 'imp-rule-sub'))[0];
      ok(!['SELECT', 'INPUT', 'BUTTON'].includes(note.tagName), 'it is text, not a control: the subcategory is changed on Transactions');
      const catTd = find(row, n => n.tagName === 'TD').find(td => find(td, n => hasClass(n, 'cat-cell')).length);
      ok(find(catTd, n => hasClass(n, 'imp-rule-sub')).length === 1, 'and it sits in the category cell');
      eq(find(catTd, n => n.tagName === 'SELECT').length, 0, 'the cell holds one category control and no second dropdown');
    }

    /* ---- 3. changing the category on the review clears it ------------------------ */
    {
      const M = await open(RULES_3);
      pickCategory(M, '2026-10-03', 'Home');
      eq(item(M, 'ENGEN').cat, 'Home', 'precondition: the category changed');
      ok(!('subcategory' in item(M, 'ENGEN')), 'the subcategory the rule chose is cleared with it');
      eq(subText(M, '2026-10-03'), [], 'and its text leaves the screen');
      await M.ctx.commitImport();
      eq([rowFor(M, 'ENGEN').cat, 'subcategory' in rowFor(M, 'ENGEN')], ['Home', false], 'the row written has the new category and no subcategory');
      ok(!/Subcategory/.test(M.ctx.vault._store.get(TX)), 'so no month file grows the column');
    }
    {
      const M = await open(RULES_3);
      pickCategory(M, '2026-10-03', 'Car');
      eq([item(M, 'ENGEN').cat, item(M, 'ENGEN').subcategory], ['Car', 'Fuel'], 'picking the category the row already has is not a change: Fuel stays');
      eq(subText(M, '2026-10-03'), ['Fuel'], 'and stays on screen');
      await M.ctx.commitImport();
      eq(rowFor(M, 'ENGEN').subcategory, 'Fuel', 'and in the row written');
    }

    /* ---- 4. what is learned from the review ------------------------------------- */
    {
      // A category picked by hand for a new merchant teaches the category alone, and does not
      // add a column to a rules file that has one but uses it for no new rule.
      const M = await open(RULES_3);
      M.ctx.$('#impRemember').checked = true;
      pickCategory(M, '2026-10-05', 'Food');
      await M.ctx.commitImport();
      eq(M.ctx.vault._store.get(RULES), RULES_3 + 'BRAND NEW BAKERY,Food,\n', 'a new rule from the review has an empty subcategory cell');
    }
    {
      // A rule repointed from the review takes its subcategory with the old category.
      asked.length = 0; answer = true;
      const M = await open(RULES_3);
      M.ctx.$('#impRemember').checked = true;
      pickCategory(M, '2026-10-03', 'Home');
      await M.ctx.commitImport();
      eq(asked.length, 1, 'the commit asks about the rule the reader disagreed with, as before');
      eq(M.ctx.vault._store.get(RULES), 'pattern,category,subcategory\nENGEN RONDEBOSCH,Home,\nCORNER MART,Groceries,\n',
        'Update repoints the rule and clears its subcategory — a rule must not file Home under Fuel');
      answer = false;
    }
    {
      // Declining leaves the rule, subcategory included, exactly as it was.
      asked.length = 0; answer = false;
      const M = await open(RULES_3);
      M.ctx.$('#impRemember').checked = true;
      pickCategory(M, '2026-10-03', 'Home');
      await M.ctx.commitImport();
      eq(M.ctx.vault._store.get(RULES), RULES_3, 'Keep the rules: the file is not touched');
    }
    {
      // A reader who re-picks a rule's own category teaches nothing new.
      const M = await open(RULES_3);
      M.ctx.$('#impRemember').checked = true;
      pickCategory(M, '2026-10-03', 'Car');
      await M.ctx.commitImport();
      eq(M.ctx.vault._store.get(RULES), RULES_3, 'the pair carries the subcategory the row has, so the rule already answers it: nothing is written');
      eq(parseCsv(M.ctx.vault._store.get(RULES))[1], ['ENGEN RONDEBOSCH', 'Car', 'Fuel'], 'and the rule is as it was');
    }

    {
      // The pair carries the subcategory when a SHORTER rule is what filed the row: the pattern the
      // review would learn is new, and it is redundant only if the pair says what that rule says.
      const SHORT = 'pattern,category,subcategory\nENGEN,Car,Fuel\n';
      const M = await open(SHORT);
      M.ctx.$('#impRemember').checked = true;
      eq([item(M, 'ENGEN').cat, item(M, 'ENGEN').subcategory], ['Car', 'Fuel'], 'precondition: the short rule filed the row under both');
      pickCategory(M, '2026-10-03', 'Car');
      await M.ctx.commitImport();
      eq(M.ctx.vault._store.get(RULES), SHORT, 'the reader re-picked the rule\'s own category: the pair (Car, Fuel) is already answered, so no second rule is learned');
    }

    console.log(`PASS — import-rule-subcategory: a rule sets both, the review shows it as text and clears it with the category (${checks} assertions).`);
  } finally { unpin(); }
})().catch(err => { console.error(err); process.exit(1); });

function subcategoryOrNone(it) { return typeof it.subcategory === 'string' ? it.subcategory : ''; }
