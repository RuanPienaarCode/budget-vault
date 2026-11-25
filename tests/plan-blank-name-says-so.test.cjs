'use strict';
/* A Plan dialog confirmed with a blank name says so (2026-11-25 audit, FUN-2).

   "New source", "New spending bucket", "Rename spending bucket" and "New plan"
   all ended on `if (!r || !r.name.trim()) return;` — so pressing the dialog's
   confirm button with the name empty closed it and did nothing, with no word
   on screen. Every other add dialog in the app toasts what is missing
   (acct.err.nameRequired, cat.err.nameRequired, tx.err.desc). The fix splits
   the two cases the one line had joined:

     - the dialog was CANCELLED (askFields resolves null): silent, as before;
     - it was CONFIRMED with a blank or whitespace-only name: a bad-toned toast
       from i18n ('plan.err.nameRequired'), and nothing is added, renamed or
       marked dirty.

   Driven through the REAL view over the REAL loader; synthetic plans only. The
   dialog is the only stub: it hands back the scripted answer.

     node tests/plan-blank-name-says-so.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');

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
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Plans/Windfall.md`]: [
    '---', 'kind: plan', 'plan: "Windfall"', 'started: "2026-08-01"', 'status: active', '---', '',
    '# Windfall', '', '## Money in', '',
    '| Source | Kind | Amount | Date | Status | Notes |', '|--------|------|-------:|------|--------|-------|',
    '| Year-end bonus | Bonus | 5000.00 | 2026-08-03 | received |  |', '',
    '## Envelopes', '', '| Envelope | Amount | Note | Tint |', '|----------|-------:|------|------|',
    '| Keep back | 1000.00 |  |  |', '',
    '## Items', '', '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
    '|------|----------|-------:|------:|--------|----------|-------|', '',
  ].join('\n'),
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
  ctx.S.planName = 'Windfall';
  ctx.renderPlan();

  const want = i18n.t('plan.err.nameRequired');
  ok(want && want !== 'plan.err.nameRequired', 'the message is a real i18n string, not the key echoed back');
  const plan = () => ctx.S.plans.Windfall;
  const before = () => JSON.stringify({ s: plan().sources, e: plan().envelopes });
  const snapshot = before();
  const sawToasts = async (fn, answer) => {
    answers.length = 0; if (answer !== undefined) answers.push(answer);
    const n = ctx._toasts.length;
    await fn(); await tick();
    return ctx._toasts.slice(n);
  };
  const renameBtn = () => $('#planEnvelopes').querySelector('.env').querySelector('.env-edit-ico');

  const cases = [
    ['New source', () => ctx.addSource(), { name: '', kind: 'Other', amount: '10', date: '' }],
    ['New spending bucket', () => ctx.addEnvelope(), { name: '', amount: '10', note: '' }],
    ['Rename spending bucket', async () => { renameBtn().click(); }, { name: '', note: '' }],
    ['New plan', () => ctx.newPlan(), { name: '' }],
  ];
  for (const [label, run, blank] of cases) {
    /* blank, and whitespace-only: both are "no name" to trim() */
    for (const name of ['', '   ']) {
      const t = await sawToasts(run, { ...blank, name });
      eq(t.map(x => x.msg), [want], `${label}: confirmed with ${JSON.stringify(name)} says it needs a name`);
      ok(t[0] && t[0].bad === true, `${label}: and the toast is the warning tone`);
    }
    /* cancelled: askFields resolves null — no toast, as before */
    const t = await sawToasts(run, null);
    eq(t, [], `${label}: a cancelled dialog stays silent`);
  }
  eq(before(), snapshot, 'no blank-name dialog added or renamed anything');
  ok(!ctx.S.planDirty, 'and none lit Save');
  eq(Object.keys(ctx.S.plans), ['Windfall'], 'and New plan created no plan');

  /* The guard is not "any confirm toasts": a named dialog still goes through. */
  const t = await sawToasts(() => ctx.addEnvelope(), { name: 'Holiday', amount: '10', note: '' });
  eq(t.map(x => x.msg), [], 'a named bucket adds without a name complaint');
  ok(plan().envelopes.some(e => e.name === 'Holiday'), 'and it was added');

  /* All twelve languages carry the string (the suite's parity test also checks
     the key set; this one checks the text is not the English left in place). */
  const dir = path.join(__dirname, '..', 'src', 'lang');
  let langs = 0;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    ok(/'plan\.err\.nameRequired':/.test(src), `${f} has plan.err.nameRequired`);
    langs++;
  }
  eq(langs, 12, 'twelve language files');

  console.log(`PASS — plan-blank-name-says-so: a confirmed blank name toasts in all four Plan dialogs, a cancel stays silent (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
