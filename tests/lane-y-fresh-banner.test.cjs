'use strict';
/* The new-period banner outlived the thing it offered (2026-09-29 totals
   audit, lane Y item 4).

   "New period - nothing budgeted yet / Copy previous period" keys off the
   SAVED budget. Pressing Copy fills the draft and lights Save, but nothing is
   saved, so the banner stayed up offering the same copy, and a second click
   answered "Nothing to copy". It now steps aside as soon as the draft holds
   rows that Save would write - the same predicate saveBudget uses - and stays
   away after the save.

   The smaller of the two honest options: hiding needs no new string, and the
   lit Save button already says the period is unsaved.

   Synthetic household.
     node tests/lane-y-fresh-banner.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, mountFor, pinClock } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const august = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + '| Salary | income | 20000.00 |  |\n| Groceries | expense | 3000.00 | weekly shop |\n';
const files = () => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-08.md`]: august,
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-03', 'Checkers', 'Groceries', -100]]),
});
const banner = ctx => ctx.$('#budShapeNote');
const shown = ctx => !hasClass(banner(ctx), 'hidden');
const copyBtn = ctx => find(banner(ctx), n => n.tagName === 'BUTTON')[0];

(async () => {
  const unpin = pinClock('2026-09-10');
  try {
    /* ---- control: a fresh period with a budgeted predecessor offers the copy ------ */
    {
      const { ctx } = await mountFor(files(), { period: '2026-09' });
      ctx.renderBudgets();
      ok(shown(ctx), 'the banner is up on a fresh period');
      ok(copyBtn(ctx) && /Copy previous period/.test(textOf(copyBtn(ctx))), 'and offers the copy');
    }

    /* ---- pressing Copy takes the offer away ----------------------------------------- */
    {
      const { ctx, S } = await mountFor(files(), { period: '2026-09' });
      ctx.renderBudgets();
      copyBtn(ctx)._fire('click');
      ok(!shown(ctx), 'after Copy the banner is gone, though nothing is saved');
      eq(textOf(banner(ctx)), '', 'and holds no copy offer');
      eq((S.budgets['2026-09'] || []).length, 0, 'nothing was saved (the banner keys off the draft, not the file)');
      ok(!ctx.$('#budSave').disabled, 'Save is lit: the unsaved state is still visible');
      /* a re-render (any edit) keeps it away */
      ctx.renderBudgets();
      ok(!shown(ctx), 'a later render does not bring it back');
      /* Save, and it stays away */
      await ctx.saveBudget();
      ctx.renderBudgets();
      ok(!shown(ctx), 'after Save the period has a budget, so the banner has nothing to say');
      ok((S.budgets['2026-09'] || []).length > 0, 'and it was saved');
    }

    /* ---- typing an amount is a draft with rows too --------------------------------- */
    {
      const { ctx } = await mountFor(files(), { period: '2026-09' });
      ctx.renderBudgets();
      const input = find(ctx.$('#budTable'), n => n.tagName === 'INPUT' && n.attrs['aria-label'] === 'Budget amount for Groceries')[0];
      ok(input, 'the Groceries amount input is on the page');
      input.value = '2500';
      input._fire('change', { target: input });
      ok(!shown(ctx), 'an amount typed into the draft ends the offer as well');
    }

    /* ---- clearing the draft brings it back ------------------------------------------ */
    {
      const { ctx } = await mountFor(files(), { period: '2026-09' });
      ctx.renderBudgets();
      copyBtn(ctx)._fire('click');
      ok(!shown(ctx), 'copied: gone');
      ctx.invalidateBudgetDraft();
      ctx.renderBudgets();
      ok(shown(ctx), 'a draft rebuilt from the (empty) file offers the copy again');
    }

    /* ---- a period with no predecessor budget never showed it ------------------------- */
    {
      const f = files(); delete f[`${B}/Budgets/2026-08.md`];
      const { ctx } = await mountFor(f, { period: '2026-09' });
      ctx.renderBudgets();
      ok(!shown(ctx), 'nothing before it, nothing to offer');
    }
  } finally { unpin(); }
  console.log(`PASS lane-y-fresh-banner (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
