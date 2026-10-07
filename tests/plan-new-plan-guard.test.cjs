'use strict';
/* "New plan" must not walk away from a plan with unsaved edits.

   The Plan page has ONE dirty flag (S.planDirty) and one Save button, and both
   only ever describe the plan on screen. The plan picker has always honoured
   that: changePlan refuses to switch while the flag is set ("Save this plan
   first"). newPlan did not. It switched S.planName to the new plan with the
   old plan's edits still sitting in memory, so the sequence

     edit plan A  ->  New plan "B"  ->  Save  ->  pick plan A again

   saved B, cleared the page's only dirty flag, and brought A back on screen
   showing the edit with Save DISABLED. Nothing on disk held it, nothing on the
   page said so, and the next reload (the vault watcher, a settings change,
   reopening the view) quietly put the old A back. Found by the 2026-10-07
   runtime audit; the same hole was reachable by typing the name of a plan that
   is already open (newPlan's "switch to it" path) and by deleting the new plan,
   whose deletePlan clears the flag on the way out.

   So the test is the invariant rather than one click path: after every step,
   any plan whose in-memory record differs from what the REAL loader reads off
   the in-memory vault must be the plan on screen, with the page flagged dirty.
   That is the only state in which Save can still rescue it.

     node tests/plan-new-plan-guard.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The dialogs, made answerable — injected into the require cache before any
   view loads, the same way tests/delete-and-undo.test.cjs does it. Each
   askFields call takes the next scripted answer; `asked` records the titles so
   a refusal can be told apart from a dialog that opened and was ignored. */
const answers = [];
const asked = [];
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async askFields(app, title) { asked.push(title); return answers.length ? answers.shift() : null; },
    async confirmModal() { return true; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

/* Two synthetic plans on disk. Nothing here is anyone's real money. */
const B = 'Budget';
const planFile = (name, source, amount) => [
  '---', 'kind: plan', `plan: "${name}"`, 'started: "2026-08-01"', 'status: active', '---', '',
  `# ${name}`, '', '## Money in', '',
  '| Source | Kind | Amount | Date | Status | Notes |', '|--------|------|-------:|------|--------|-------|',
  `| ${source} | Bonus | ${amount} | 2026-08-03 | received |  |`, '',
  '## Envelopes', '', '| Envelope | Amount | Note | Tint |', '|----------|-------:|------|------|',
  '| Keep back | 1000.00 |  |  |', '',
  '## Items', '', '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
  '|------|----------|-------:|------:|--------|----------|-------|', '',
].join('\n');
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Plans/Windfall.md`]: planFile('Windfall', 'Year-end bonus', '5000.00'),
  [`${B}/Plans/Spare cash.md`]: planFile('Spare cash', 'Sold the bike', '2000.00'),
};

async function mount() {
  const ctx = makeCtx({ ...FILES }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/plan')(ctx);
  ctx.S.planName = 'Windfall';
  ctx.renderPlan();
  return { ctx, $ };
}

/* What the plans look like on disk right now, read by the REAL loader over a
   copy of the in-memory vault — never a second parser in this file. */
async function diskPlans(ctx) {
  const store = Object.fromEntries(ctx.vault._store);
  const S2 = await loadInto(makeCtx(store, { budgetFolder: B }));
  return S2.plans;
}
const shape = p => p && JSON.stringify({ name: p.name, sources: p.sources, envelopes: p.envelopes, items: p.items });

/* THE INVARIANT. Unsaved work may exist only on the plan on screen, and only
   while the page is flagged dirty — anywhere else, nothing can save it. */
async function assertNoOrphanedEdits(ctx, step) {
  const disk = await diskPlans(ctx);
  const unsaved = Object.keys(ctx.S.plans).filter(k => shape(ctx.S.plans[k]) !== shape(disk[k]));
  for (const k of unsaved) {
    ok(k === ctx.S.planName && ctx.S.planDirty === true,
      `${step}: plan "${k}" holds edits nothing on disk has, so it must be the plan on screen with Save lit ` +
      `(on screen: "${ctx.S.planName}", dirty: ${ctx.S.planDirty})`);
  }
  if (!unsaved.length) ok(true, `${step}: nothing unsaved`);
}

const pickerButton = ($, label) => $('#planPicker').children.find(b => b.textContent === label);

(async () => {
  const { ctx, $ } = await mount();
  const toastsAfter = n => ctx._toasts.slice(n).map(t => t.msg);
  await assertNoOrphanedEdits(ctx, 'fresh mount');

  /* ---- 1. an edit to the plan on screen ---- */
  answers.push({ name: 'Garage sale', kind: 'Sale', amount: '750', date: '' });
  await ctx.addSource();
  ok(ctx.S.planDirty, 'precondition: adding a source lights Save');
  await assertNoOrphanedEdits(ctx, 'after editing Windfall');

  /* The picker's own refusal, captured so the New plan refusal can be held to
     the SAME words rather than a second spelling of the same rule. */
  let mark = ctx._toasts.length;
  pickerButton($, 'Spare cash').click();
  const pickerRefusal = toastsAfter(mark);
  eq(pickerRefusal, ['Save this plan first'], 'precondition: the picker refuses to switch away from unsaved edits');
  eq(ctx.S.planName, 'Windfall', 'precondition: and stays on the edited plan');

  /* ---- 2. New plan, with a brand-new name ---- */
  mark = ctx._toasts.length;
  answers.length = 0; answers.push({ name: 'Brand new' });
  await ctx.newPlan();
  eq(ctx.S.planName, 'Windfall', 'New plan must not switch away from a plan with unsaved edits');
  ok(!ctx.S.plans['Brand new'], 'and must not create the new plan behind it');
  eq(toastsAfter(mark), pickerRefusal, 'and says so in the same words the picker uses');
  ok(ctx.S.planDirty, 'the edited plan is still flagged dirty');
  await assertNoOrphanedEdits(ctx, 'after New plan with a new name');

  /* ---- 3. New plan, typing the name of a plan that already exists ----
     newPlan's "already open in memory — switch to it" path was a second,
     equally unguarded way off the edited plan. */
  mark = ctx._toasts.length;
  answers.length = 0; answers.push({ name: 'Spare cash' });
  await ctx.newPlan();
  eq(ctx.S.planName, 'Windfall', 'New plan with an existing name must not switch either');
  eq(toastsAfter(mark), pickerRefusal, 'and refuses the same way');
  await assertNoOrphanedEdits(ctx, 'after New plan with an existing name');

  /* ---- 4. Save, and the edit is on disk — so the guard cost nothing ---- */
  await ctx.savePlan();
  ok(!ctx.S.planDirty, 'saving the plan on screen clears the flag');
  ok((ctx.vault._store.get(`${B}/Plans/Windfall.md`) || '').includes('Garage sale'),
    'and the edit the guard protected is in the file');
  await assertNoOrphanedEdits(ctx, 'after Save');

  /* ---- 5. with nothing unsaved, New plan works exactly as before ---- */
  answers.length = 0; answers.push({ name: 'Brand new' });
  await ctx.newPlan();
  eq(ctx.S.planName, 'Brand new', 'positive control: New plan switches when nothing is unsaved');
  ok(ctx.S.plans['Brand new'], 'and creates the plan');
  ok(ctx.S.planDirty, 'a new plan is unsaved by definition, so Save is lit for it');
  await assertNoOrphanedEdits(ctx, 'after creating a plan');

  /* ---- 6. the NEW plan is itself unsaved work: New plan again must refuse ----
     Otherwise "Brand new" — in S.plans and in the picker, with no file behind
     it — is the orphan, and saving the next one clears its flag. */
  mark = ctx._toasts.length;
  answers.length = 0; answers.push({ name: 'Third' });
  await ctx.newPlan();
  eq(ctx.S.planName, 'Brand new', 'an unsaved new plan is protected by the same guard');
  ok(!ctx.S.plans.Third, 'so no third plan appears behind it');
  eq(toastsAfter(mark), pickerRefusal, 'with the same refusal');
  await assertNoOrphanedEdits(ctx, 'after New plan over an unsaved new plan');

  /* ---- 7. Delete the unsaved new plan: its flag belonged to it, and only to it ---- */
  await ctx.deletePlan();
  ok(!ctx.S.plans['Brand new'], 'the never-saved plan is dropped');
  ok(!ctx.S.planDirty, 'and the flag that described it goes with it');
  await assertNoOrphanedEdits(ctx, 'after deleting the new plan');

  /* ---- 8. a reload finds every edit the guard protected ---- */
  await ctx.loadVault();
  ok(ctx.S.plans.Windfall.sources.some(s => s.name === 'Garage sale'),
    'after a reload the edit is still there — it was saved, not stranded');

  console.log(`plan-new-plan-guard: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
