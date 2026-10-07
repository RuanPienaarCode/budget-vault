'use strict';
/* A period with NO budget: the API says so, the way the Dashboard hero does.

   The hero has said "New period — nothing budgeted yet" over what has been
   spent since the 2026-09-29 audit (views/dashboard.js renderHero: `noBudget`),
   because "Over budget" against a budget of nothing is a claim about a plan
   that does not exist. api.currentPeriod() kept the old arithmetic —
   budgeted 0, left = −spent, no flag — and Vista's card renders any negative
   `left` as "Over budget R X". The 2026-10-07 audit found the synthetic
   household reading "Over budget R 11 600" in Vista beside "New period —
   nothing budgeted yet" on the hero, and a real household reaches that state
   on the first day of every period whose budget file has not been made yet.

   What this suite pins:
     1. no Budgets/<period>.md: noBudget true, left null (nothing to be left
        of), budgeted 0, spent = periodFigures' used.spent — the number the
        hero's big figure prints in this state — and no over-budget rows.
     2. a budget file with no rows is no budget either: the hero's test is the
        period's rows (`S.budgets[period]`), not whether a file exists.
     3. with a budget: noBudget false, left = budgeted − spent, as before.
     4. the rendered hero agrees: it prints bud.fresh.title exactly when the
        API says noBudget, and never dash.hero.overspent in that state. api.js
        re-spells the hero's test rather than sharing it (its header says
        so), so this is the check that the two spellings still agree.

     node tests/api-no-budget.test.cjs
*/
const assert = require('assert');
const { stubObsidian, makeVault, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const { buildApi } = require('../src/api');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const plugin = files => ({ settings: { budgetFolder: B }, app: { vault: makeVault(files) }, _lastWrite: 0 });
const BUDGET = `${B}/Budgets/${PERIOD}.md`;
const withoutBudget = () => { const f = { ...SEED }; delete f[BUDGET]; return f; };
/* The same file with its table emptied: frontmatter and header row kept. */
const emptyBudget = () => ({
  ...SEED,
  [BUDGET]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n',
});

async function heroOf(files) {
  const { ctx, nodes } = await mountFor(files, { budgetFolder: B });
  ctx.renderDashboard();
  const txt = n => (n._text || '') + (n.children || []).map(txt).join(' ');
  return txt(nodes.get('#heroCard')).replace(/\s+/g, ' ').trim();
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const freshTitle = i18n.t('bud.fresh.title');
    const overTitle = i18n.t('dash.hero.overspent');
    ok(freshTitle !== 'bud.fresh.title' && overTitle !== 'dash.hero.overspent',
      'sanity: both hero labels resolve to real strings, so the text checks below cannot pass vacuously');

    /* ---- 1. no budget file ---- */
    {
      const files = withoutBudget();
      const got = await buildApi(plugin(files)).currentPeriod();
      const ctx = makeCtx(files, { budgetFolder: B });
      const S = await loadInto(ctx);
      const p = ctx.currentPeriod();
      eq(p, PERIOD, 'sanity: the fixture is still in the period whose budget was removed');
      eq((S.budgets[p] || []).length, 0, 'sanity: the loader sees no budget rows for it');
      const F = ctx.periodFigures(p);

      eq(got.noBudget, true, 'no budget file: the API says so');
      eq(got.left, null, 'and left is null — there is no budget for anything to be left of');
      eq(got.budgeted, 0, 'budgeted is still stated: nothing');
      eq(got.spent, F.used.spent, "spent is still stated — the hero's big number in this state (used.spent)");
      ok(got.spent > 0, 'sanity: the fixture really has spending in this period, so null-vs-number is a real distinction');
      eq(got.over, [], 'no category is "over" a budget of nothing');
    }

    /* ---- 2. a budget file with no rows ---- */
    {
      const got = await buildApi(plugin(emptyBudget())).currentPeriod();
      eq(got.noBudget, true, "a budget file with an empty table is no budget — the hero's test is rows, not the file");
      eq(got.left, null, 'and left is null there too');
    }

    /* ---- 3. with a budget, unchanged ---- */
    {
      const got = await buildApi(plugin(SEED)).currentPeriod();
      eq(got.noBudget, false, 'a period with budget rows: noBudget is false (always present from this version on)');
      eq(got.left, got.budgeted - got.spent, 'left is the hero\'s own subtraction, as before');
      ok(typeof got.left === 'number' && got.budgeted > 0, 'sanity: a real budget');
    }

    /* ---- 4. the rendered hero agrees with the flag ---- */
    for (const [name, files] of [['no budget file', withoutBudget()], ['empty budget file', emptyBudget()], ['a budget', SEED]]) {
      const got = await buildApi(plugin(files)).currentPeriod();
      const hero = await heroOf(files);
      eq(hero.includes(freshTitle), got.noBudget,
        `${name}: the hero prints "${freshTitle}" exactly when the API says noBudget (hero: ${hero.slice(0, 120)})`);
      if (got.noBudget) ok(!hero.includes(overTitle), `${name}: and never "${overTitle}" in that state`);
    }

    console.log(`PASS — api-no-budget: the API flags a period with no budget as the hero does (${checks} checks).`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
