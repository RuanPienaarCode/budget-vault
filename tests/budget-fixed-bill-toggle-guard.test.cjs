'use strict';
/* The `fixed` category flag had no UI anywhere in the app before this change
   — src/load.js was its only reader, so "Committed & fixed bills" on the
   Score page always read R0 unless someone hand-edited `fixed: true` into a
   category file. This pins the UI that replaces that instruction: a per-row
   toggle on the Budget page (mirroring the existing assume-spent toggle,
   toggleAssumeSpent) and a field in the New category dialog.

   Four invariants, each one a way the earlier, UI-less state (or a half
   version of this fix) could still be wrong:

     1. The toggle writes `fixed: true` to the category's own note, and
        turning it off REMOVES the key rather than writing `fixed: false` —
        same null-removes-the-key idiom as assume_spent, so a file that never
        had the flag toggled on reads exactly as it always did.
     2. S.categories is updated in place, so the flag is visible immediately
        — no reload needed — and an unsaved budget draft on the page survives
        the toggle the same way it survives toggleAssumeSpent.
     3. A category created THIS session — via promptCreateCategory, which used
        to push { name, type, color } with no `rel` — is immediately
        toggleable, not just after a reload. Before the `rel` fix this test
        pins, toggleFixed (like toggleAssumeSpent) bailed with a "no file"
        toast and touched nothing.
     4. Income and transfer rows get no toggle at all: a fixed bill is a
        commitment to pay, and neither of those is one.

   Runs in bare node against the REAL loader, the REAL categories module and
   the REAL budgets view over the shared DOM stub. Wired into ./build.sh via
   scripts/run-tests.mjs (every tests/*.test.cjs is picked up automatically).
     node tests/budget-fixed-bill-toggle-guard.test.cjs

   Negative control: run this file against the code as it stood before this
   change (`git stash` the src/ edits, keep this test file) and it fails —
   there is no bud.fixed.* i18n, no toggleFixed, no button to find. Confirmed
   by hand for this change (see the session's final report); not re-run on
   every build, the way the other guard tests here aren't either. */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';

/* categories.js reaches askFields through its own require('./modal') binding,
   captured at require-time — so the stub has to be in place on modal.js's
   exports BEFORE categories.js is first required in this process. Obsidian's
   real FieldModal cannot run here at all (the obsidian stub's Setting class
   has none of the methods FieldModal calls), so this is the only way to drive
   promptCreateCategory in a bare-node test. */
const modal = require('../src/modal');
let nextAnswer = null;
modal.askFields = async () => nextAnswer;

function baseFiles() {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
    [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Categories/To savings.md`]: '---\ntype: transfer\ncolor: "#8888ff"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Rent | expense | 8000.00 | |\n| Salary | income | 20000.00 | |\n',
  };
}

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  require('../src/views/budgets')(ctx);
  return { ctx, S, $ };
}

const i18n = require('../src/i18n');

/* Find the fixed-bill toggle button for `category` in the rendered table —
   by its aria-label, same identifying attribute a screen reader (and this
   test) has, rather than by position, which shifts as other buttons in the
   row come and go. */
function findFixedToggle($, category) {
  return $('#budTable').querySelector(`[aria-label="${i18n.t('bud.aria.fixed', { category })}"]`);
}

(async () => {
  /* ---- 1 & 2: writes the key, removes it, and S.categories agrees ---- */
  {
    const { ctx, S, $ } = await mount(baseFiles());
    ctx.renderBudgets();

    const btn = findFixedToggle($, 'Rent');
    ok(!!btn, 'a fixed-bill toggle button is rendered for an ordinary expense row');

    btn.click();
    // toggleFixed is async (reads the file, patches it, then re-renders) —
    // give its promise chain a turn before asserting.
    await new Promise(r => setImmediate(r));

    ok(S.categories.find(c => c.name === 'Rent').fixed === true,
      'S.categories is updated in place immediately, same as toggleAssumeSpent');
    const afterOn = ctx.vault._store.get(`${B}/Categories/Rent.md`);
    ok(/^fixed:\s*true\s*$/m.test(afterOn), 'the category note now carries `fixed: true`');
    ok(!ctx._toasts.some(t => t.bad), 'no error toast on a category that has a file');

    // Toggle back off — must REMOVE the key, not write `fixed: false`, so a
    // file that has never had the flag on reads exactly as before.
    ctx.renderBudgets();
    const btnOff = findFixedToggle($, 'Rent');
    btnOff.click();
    await new Promise(r => setImmediate(r));

    ok(S.categories.find(c => c.name === 'Rent').fixed === false,
      'S.categories reflects the flag coming back off, in place, no reload');
    const afterOff = ctx.vault._store.get(`${B}/Categories/Rent.md`);
    ok(!/^fixed:/m.test(afterOff), 'turning the flag off removed the `fixed` key entirely — not `fixed: false`');
  }

  /* ---- 3: a category created THIS session is immediately toggleable ---- */
  {
    const { ctx, S, $ } = await mount(baseFiles());
    nextAnswer = { name: 'Medical aid', type: 'expense', fixed: [] };  // create WITHOUT the flag
    const created = await ctx.promptCreateCategory();
    ok(!!created, 'promptCreateCategory returns the new category');
    ok(!!created.rel, 'the pushed category object carries `rel` — the bug this change fixes');
    ok(created.fixed === false, 'fixed defaults to false when the create-dialog toggle was left off');

    ctx.renderBudgets();
    const btn = findFixedToggle($, 'Medical aid');
    ok(!!btn, 'the just-created category renders a fixed-bill toggle, same render pass, no reload');
    btn.click();
    await new Promise(r => setImmediate(r));

    ok(!ctx._toasts.some(t => t.bad && /no file|No category/i.test(t.msg)),
      'no "no file" toast — before the rel fix this bailed here every time');
    ok(S.categories.find(c => c.name === 'Medical aid').fixed === true,
      'the freshly-created category actually toggled, in memory, on the first click');
    const stored = ctx.vault._store.get(`${B}/Categories/Medical aid.md`);
    ok(/^fixed:\s*true\s*$/m.test(stored), 'and on disk, in its own note');
  }

  /* ---- 3b: ticking the create-dialog's own fixed field writes it up front ---- */
  {
    const { ctx } = await mount(baseFiles());
    nextAnswer = { name: 'Bond', type: 'expense', fixed: ['yes'] };
    const created = await ctx.promptCreateCategory();
    ok(created.fixed === true, 'ticking the New category dialog\'s fixed field is honoured immediately');
    const stored = ctx.vault._store.get(`${B}/Categories/Bond.md`);
    ok(/^fixed:\s*true\s*$/m.test(stored), 'and written to the note at creation time');
  }

  /* ---- 4: income and transfer rows get no toggle at all ---- */
  {
    const { ctx, $ } = await mount(baseFiles());
    ctx.renderBudgets();
    ok(!findFixedToggle($, 'Salary'), 'an income row renders no fixed-bill toggle');
    ok(!findFixedToggle($, 'To savings'), 'a transfer row renders no fixed-bill toggle');
    ok(!!findFixedToggle($, 'Rent'), 'sanity: an ordinary expense row still gets one, in the same render');
  }

  console.log(`PASS — the fixed-bill flag has a working toggle on the Budget page (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
