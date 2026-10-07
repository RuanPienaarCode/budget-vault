'use strict';
/* The spending-bucket accordion: Collapse collapses, and a renamed bucket stays open.

   The Plan page shows one bucket expanded and the rest as one-line rows. Which
   one is open is view state (`expandedEnvelope` in views/plan.js), and a guard
   in renderEnvelopes resets it to the FIRST bucket whenever it is empty or
   names a bucket that no longer exists — so deleting the open bucket, or
   switching plans, never leaves the page pointing at nothing.

   Two controls fed that guard a value it read as "nothing chosen yet":

     - the expanded card's Collapse button set the open bucket to null, which
       the guard immediately turned back into the first bucket. Collapsing the
       first bucket left it open; collapsing any other opened the first one;
     - renaming the open bucket changed its name but not the view state, so the
       guard saw a name that no longer existed and opened the first bucket.

   The 2026-10-07 runtime audit found the second one the expensive way: the
   card moved under the pointer, and the next amount and slider edits landed on
   the first bucket (R 11 600 became R 900). So "collapsed" is now a state of
   its own that the guard leaves alone, and a rename carries the open state
   with it. The guard's own job — a deleted bucket or a different plan opens the
   first bucket — is pinned here too, so the fix cannot quietly undo it.

   Driven through the REAL view over the REAL loader; synthetic plans only.
     node tests/plan-accordion-collapse.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const answers = [];
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async askFields() { return answers.length ? answers.shift() : null; },
    async confirmModal() { return true; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const B = 'Budget';
const planFile = (name, envelopes, items = []) => [
  '---', 'kind: plan', `plan: "${name}"`, 'started: "2026-08-01"', 'status: active', '---', '',
  `# ${name}`, '', '## Money in', '',
  '| Source | Kind | Amount | Date | Status | Notes |', '|--------|------|-------:|------|--------|-------|',
  '| Payout | Other | 20000.00 | 2026-08-03 | received |  |', '',
  '## Envelopes', '', '| Envelope | Amount | Note | Tint |', '|----------|-------:|------|------|',
  ...envelopes.map(([n, a]) => `| ${n} | ${a} |  |  |`), '',
  '## Items', '', '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
  '|------|----------|-------:|------:|--------|----------|-------|',
  ...items.map(([n, e, a]) => `| ${n} | ${e} | ${a} | 0.00 | planned |  |  |`), '',
].join('\n');
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Plans/Alpha.md`]: planFile('Alpha',
    [['Settle up', '11600.00'], ['Coming up', '4500.00'], ['For us', '1200.00']],
    [['Dinner out', 'For us', '1200.00']]),
  [`${B}/Plans/Beta.md`]: planFile('Beta', [['First of Beta', '3000.00'], ['Second of Beta', '2000.00']]),
};

const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const ctx = makeCtx({ ...FILES }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/plan')(ctx);
  ctx.S.planName = 'Alpha';
  ctx.renderPlan();

  const host = () => $('#planEnvelopes');
  /* The expanded card is `.env`; every other bucket is a `.env-sum` row. */
  const openName = () => {
    const card = host().querySelector('.env');
    const n = card && card.querySelector('.env-name');
    return n ? n.textContent : null;
  };
  const rowNames = () => host().querySelectorAll('.env-sum')
    .map(r => (r.querySelector('.env-sum-name') || {}).textContent);
  const row = name => host().querySelectorAll('.env-sum')
    .find(r => (r.querySelector('.env-sum-name') || {}).textContent === name);
  const collapse = () => host().querySelector('.env-collapse').click();

  /* ---- the default the guard exists for ---- */
  eq(openName(), 'Settle up', 'nothing chosen yet: the first bucket opens');

  /* ---- 1. Collapse on the first bucket ---- */
  collapse();
  eq(openName(), null, 'Collapse on the open first bucket closes it — no bucket is expanded');
  eq(rowNames(), ['Settle up', 'Coming up', 'For us'], 'every bucket is a collapsed row, in plan order');

  /* A render for some unrelated reason must not undo the reader's choice. */
  ctx.renderPlan();
  eq(openName(), null, 'and it stays collapsed across a re-render');

  /* ---- 2. Collapse on a bucket that is not the first ---- */
  row('Coming up').click();
  eq(openName(), 'Coming up', 'tapping a collapsed row opens that bucket');
  collapse();
  eq(openName(), null, 'Collapse on it closes it rather than opening the first bucket instead');

  /* ---- 3. Rename the open bucket ---- */
  row('For us').click();
  eq(openName(), 'For us', 'precondition: For us is the open bucket');
  answers.push({ name: 'For the two of us', note: '' });
  host().querySelector('.env').querySelector('.env-name').click();
  await tick();
  eq(openName(), 'For the two of us', 'a renamed bucket stays open under its new name');
  ok(rowNames().includes('Settle up'),
    'and the first bucket is still a collapsed row — not opened in its place, under the pointer');
  eq(ctx.S.plans.Alpha.items.map(i => i.envelope), ['For the two of us'],
    'the bucket\'s items follow the rename, as they always did');

  /* ---- 4. the guard's own job, unchanged: a deleted open bucket opens the first ---- */
  host().querySelector('.env').querySelector('.env-del-ico').click();
  await tick();
  ok(!ctx.S.plans.Alpha.envelopes.some(e => e.name === 'For the two of us'), 'precondition: the open bucket was removed');
  eq(openName(), 'Settle up', 'with the open bucket gone, the first bucket opens again');

  /* ---- 5. and a different plan opens on its own first bucket, even after a collapse ---- */
  collapse();
  eq(openName(), null, 'precondition: Alpha is fully collapsed');
  await ctx.savePlan();                       // the picker refuses to leave unsaved edits
  $('#planPicker').children.find(b => b.textContent === 'Beta').click();
  eq(ctx.S.planName, 'Beta', 'precondition: switched to Beta');
  eq(openName(), 'First of Beta', 'a plan switched in opens on its first bucket, not collapsed from the last one');

  console.log(`plan-accordion-collapse: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
