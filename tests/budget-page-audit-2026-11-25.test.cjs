'use strict';
/* The Budget page's five small findings from the 2026-11-25 audit, each
   pinned where a reader meets it. (BUD-1 and BUD-10a are in
   tests/category-delete-says-what-changes.test.cjs, NUM-7 in
   tests/assumed-note-one-threshold.test.cjs.)

   BUD-2  A category created elsewhere (Transactions "Add new category",
          the import review) did not appear on the Budget page until the period
          changed: budgetDraft() built its row list once per period. It now adds
          any category the draft lacks, on every draw, and touches nothing the
          reader has typed.
   BUD-3  The new-period banner and Copy previous period looked exactly one
          period back, so a skipped month meant no banner and "No budget found
          for the previous period" with an older budget on disk. They now take
          the most recent EARLIER period that has a budget, name it when it is
          not the one just before, and never look forward.
   BUD-8  An income row the reader had typed into a new period's draft was not
          an income row to the strip (it was still inFile: false), so it said
          "% of income" (the wording for RECEIVED income) beside "Planned
          income R 45 000". One rule for "this row will be written" now serves
          Save and the strip.
   BUD-9  A period created by Copy previous + Save was written with only the
          plugin's own frontmatter, dropping what the source file carried (a
          `hub:` link that joins the vault's graph). The copy carries it.

   Real loader, real views, real writers; the saved file is read back through
   the loader. Synthetic household.
     node tests/budget-page-audit-2026-11-25.test.cjs */

const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, mountFor, pinClock } = require('./helpers/dash-audit.cjs');
const { parseFrontmatter } = require('../src/markdown');
const { carriedFrontmatter, rowIsWritten, earlierBudgetKey, BUDGET_FRONTMATTER } = require('../src/budget-file');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const HEAD = '| Category | Type | Amount | Notes |\n|---|---|---:|---|\n';
const budgetFile = (rows, fm = 'kind: budget\n') => `---\n${fm}---\n\n${HEAD}${rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |  |\n`).join('')}`;
const files = extra => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-03', 'Checkers', 'Groceries', -100]]),
  ...extra,
});
const amountInput = (ctx, name) => find(ctx.$('#budTable'), n => n.tagName === 'INPUT' && n.attrs['aria-label'] === `Budget amount for ${name}`)[0];
const type = (ctx, name, v) => { const i = amountInput(ctx, name); i.value = String(v); i._fire('change', { target: i }); };
const banner = ctx => ctx.$('#budShapeNote');
const shown = ctx => !hasClass(banner(ctx), 'hidden');
const copyBtn = ctx => find(banner(ctx), n => n.tagName === 'BUTTON')[0];
const lastToast = ctx => (ctx._toasts.slice(-1)[0] || {}).msg || '';
const tile = (ctx, fig) => textOf(find(ctx.$('#budTotalsTop'), n => n.attrs && n.attrs['data-fig'] === fig)[0]);

(async () => {
  const unpin = pinClock('2026-09-10');
  try {
    /* ============ BUD-2: a category made elsewhere shows up ============ */
    {
      const { ctx, S } = await mountFor(files({ [`${B}/Budgets/2026-09.md`]: budgetFile([['Groceries', 'expense', '3000.00']]) }), { period: '2026-09' });
      ctx.renderBudgets();
      ok(!amountInput(ctx, 'Coffee'), 'control: no Coffee row yet');
      type(ctx, 'Groceries', 2500);                       // an unsaved edit, which must survive
      /* What promptCreateCategory does to the shared list, from another page. */
      S.categories.push({ name: 'Coffee', type: 'expense', color: '#888888', fixed: false, rel: 'Categories/Coffee.md' });
      ctx.renderBudgets();
      ok(amountInput(ctx, 'Coffee'), 'the new category has a row on the Budget page without a period change');
      eq(Number(amountInput(ctx, 'Groceries').attrs.value), 2500, 'and the unsaved Groceries edit is still there');
      ok(!ctx.$('#budSave').disabled, 'the page is still dirty from that edit');
      /* An untouched new row is display-only: it must not be written. */
      await ctx.saveBudget();
      const saved = ctx.vault._store.get(`${B}/Budgets/2026-09.md`);
      ok(!/Coffee/.test(saved), 'an untouched new row stays out of the file, as every zero row does');
      ok(/Groceries \| expense \| 2500\.00/.test(saved), 'the typed amount was saved');
      /* A second create, then a typed amount, is saved. */
      S.categories.push({ name: 'Gym', type: 'expense', color: '#888888', fixed: false, rel: 'Categories/Gym.md' });
      ctx.renderBudgets();
      type(ctx, 'Gym', 300);
      await ctx.saveBudget();
      ok(/Gym \| expense \| 300\.00/.test(ctx.vault._store.get(`${B}/Budgets/2026-09.md`)), 'a category created elsewhere can be budgeted and saved');
    }

    /* ============ BUD-3: the most recent EARLIER budget ============ */
    /* the pure rule */
    {
      const b = { '2026-03': [{}], '2026-06': [{}], '2026-08': [], '2026-11': [{}] };
      eq(earlierBudgetKey(b, '2026-09'), '2026-06', 'skips an empty file, never looks forward, newest earlier wins');
      eq(earlierBudgetKey(b, '2026-03'), null, 'nothing earlier, nothing offered');
      eq(earlierBudgetKey({ ...b, '2026-07-01': [{}] }, '2026-09', k => /^\d{4}-\d{2}$/.test(k)), '2026-06', 'keys of the other period shape are not candidates');
      eq(earlierBudgetKey({ '2026-05': [{}], '2026-07': [{}] }, '2026-07'), '2026-05', 'the period itself is not "earlier"');
    }
    /* the banner and Copy, over the real page: July and August were skipped */
    {
      const june = budgetFile([['Salary', 'income', '20000.00'], ['Groceries', 'expense', '3000.00']]);
      const { ctx, S } = await mountFor(files({ [`${B}/Budgets/2026-06.md`]: june }), { period: '2026-09' });
      ctx.renderBudgets();
      ok(shown(ctx), 'the banner is up although the month just before has no budget');
      const label = `${ctx.periodMonthName('2026-06')} · ${ctx.periodTitle('2026-06')}`;
      ok(textOf(banner(ctx)).includes(label), 'and it names the period it offers to copy from');
      copyBtn(ctx)._fire('click');
      ok(/Copied 2 categories from/.test(lastToast(ctx)) && lastToast(ctx).includes(label),
        `Copy fills from June and says so (toast: ${lastToast(ctx)})`);
      eq(Number(amountInput(ctx, 'Groceries').attrs.value), 3000, 'the older budget\'s amount is in the draft');
      eq((S.budgets['2026-09'] || []).length, 0, 'nothing is saved by the copy');
    }
    /* the immediate previous period still wins, and keeps its plain wording */
    {
      const { ctx } = await mountFor(files({
        [`${B}/Budgets/2026-06.md`]: budgetFile([['Groceries', 'expense', '1000.00']]),
        [`${B}/Budgets/2026-08.md`]: budgetFile([['Groceries', 'expense', '3000.00']]),
      }), { period: '2026-09' });
      ctx.renderBudgets();
      ctx.copyPreviousBudget();
      eq(lastToast(ctx), 'Copied 1 category from the previous period', 'the period just before is called "the previous period"');
      eq(Number(amountInput(ctx, 'Groceries').attrs.value), 3000, 'and is the one copied');
    }
    /* never forward: a LATER budget does not count as a previous one */
    {
      const { ctx } = await mountFor(files({ [`${B}/Budgets/2026-11.md`]: budgetFile([['Groceries', 'expense', '3000.00']]) }), { period: '2026-09' });
      ctx.renderBudgets();
      ok(!shown(ctx), 'no banner when the only budget on disk is a later one');
      ctx.copyPreviousBudget();
      eq(lastToast(ctx), 'No budget found for the previous period', 'and Copy answers that there is none');
    }

    /* ============ BUD-8: a typed income row is an income row ============ */
    {
      ok(rowIsWritten({ category: 'Salary', inFile: false, amount: 45000, notes: '' }), 'a draft row with an amount will be written');
      ok(rowIsWritten({ category: 'Salary', inFile: false, amount: 0, notes: ' a note ' }), 'so will one with only a note');
      ok(!rowIsWritten({ category: 'Salary', inFile: false, amount: 0, notes: '  ' }), 'an untouched zero row will not');
      ok(rowIsWritten({ category: 'Salary', inFile: true, amount: 0, notes: '' }), 'a row already in the file stays (a deliberate zero)');
      ok(rowIsWritten({ category: 'Salary', amount: 0, notes: '' }), 'a saved row, which carries no inFile flag, is in the file');
      ok(!rowIsWritten({ category: '', inFile: true, amount: 5, notes: '' }), 'a row with no category is never written');

      const { ctx } = await mountFor(files(), { period: '2026-10' });
      ctx.renderBudgets();
      type(ctx, 'Groceries', 20000);
      type(ctx, 'Salary', 45000);
      ok(/% of planned income/.test(tile(ctx, 'bud-budgeted-note')),
        `with Salary typed the share is of PLANNED income (note: ${tile(ctx, 'bud-budgeted-note')})`);
      eq(ctx.planFigures('2026-10', { rows: [{ category: 'Salary', type: 'income', amount: 45000, notes: '', inFile: false }] }).hasIncomeRow, true,
        'planFigures reads the same rule');
      eq(ctx.planFigures('2026-10', { rows: [{ category: 'Salary', type: 'income', amount: 0, notes: '', inFile: false }] }).hasIncomeRow, false,
        'and an untouched zero income row still does not count');
    }

    /* ============ BUD-9: Copy previous carries the file's own frontmatter ============ */
    {
      /* the pure half */
      const raw = 'period: 2026-08\nhub: "[[Smart Budget]]"\n# kept comment\naliases:\n  - Aug\ntags: [finance]';
      const fm = parseFrontmatter(`---\n${carriedFrontmatter(raw)}\n---\n`).fm;
      eq(fm.hub, '[[Smart Budget]]', 'hub is carried');
      ok(carriedFrontmatter(raw).includes('# kept comment') && /aliases:\n  - Aug/.test(carriedFrontmatter(raw)), 'comments and block lists ride along verbatim');
      ok(/tags: \[finance, finance\/budget, finance\/budget\/budgets\]/.test(carriedFrontmatter(raw)), 'the plugin\'s own tags line is the plugin\'s, not the source\'s');
      ok(/^period:/.test(carriedFrontmatter('hub: x')), 'a source with no period line still gets the slot first');
      eq(carriedFrontmatter(''), BUDGET_FRONTMATTER, 'a source with no frontmatter gives the default');

      /* and over the page, through the real loader */
      const src = budgetFile([['Groceries', 'expense', '3000.00']],
        'period: 2026-08\nhub: "[[Smart Budget]]"\ntags: [finance, finance/budget, finance/budget/budgets]\n');
      const { ctx } = await mountFor(files({ [`${B}/Budgets/2026-08.md`]: src }), { period: '2026-09' });
      ctx.renderBudgets();
      ctx.copyPreviousBudget();
      await ctx.saveBudget();
      const written = ctx.vault._store.get(`${B}/Budgets/2026-09.md`);
      const w = parseFrontmatter(written).fm;
      eq(w.period, '2026-09', 'the new file is its own period');
      eq(w.hub, '[[Smart Budget]]', 'and carries the hub link of the file it was copied from');
      const reread = {};
      for (const [p, c] of ctx.vault._store) reread[p] = c;
      const again = await mountFor(reread, { period: '2026-09' });
      eq((again.S.budgets['2026-09'] || []).map(r => [r.category, r.amount]), [['Groceries', 3000]], 'the loader reads the saved copy back');
      ok(/hub: "\[\[Smart Budget\]\]"/.test(again.S.budgetMeta['2026-09'].raw), 'with the hub line in the frontmatter it captured');
      /* saving the period again changes nothing */
      await again.ctx.saveBudget();
      eq(again.ctx.vault._store.get(`${B}/Budgets/2026-09.md`), written, 'a second save of that file is byte-identical');

      /* from scratch: only the plugin's own keys */
      const fresh = await mountFor(files({ [`${B}/Budgets/2026-08.md`]: src }), { period: '2026-09' });
      fresh.ctx.renderBudgets();
      type(fresh.ctx, 'Groceries', 100);
      await fresh.ctx.saveBudget();
      const f = parseFrontmatter(fresh.ctx.vault._store.get(`${B}/Budgets/2026-09.md`)).fm;
      ok(f.hub === undefined && f.period === '2026-09', 'a file made from scratch stays as it was: no hub invented');

      /* a copy that is discarded does not leak into a later save */
      const left = await mountFor(files({ [`${B}/Budgets/2026-08.md`]: src }), { period: '2026-09' });
      left.ctx.renderBudgets();
      left.ctx.copyPreviousBudget();
      left.ctx.invalidateBudgetDraft();
      left.ctx.renderBudgets();
      type(left.ctx, 'Groceries', 100);
      await left.ctx.saveBudget();
      ok(parseFrontmatter(left.ctx.vault._store.get(`${B}/Budgets/2026-09.md`)).fm.hub === undefined,
        'after the copy was thrown away the file is a from-scratch one');
    }
  } finally { unpin(); }
  console.log(`PASS budget-page-audit-2026-11-25 (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
