'use strict';
/* An assessed tax year gets copy for an assessed year — on every country profile.

   Each profile's seasonMsgs(t) picks the Season card's message off
   t.assessment. The South African one had branches for "SARS asked me to
   submit" and "Auto-assessed" and sent everything else, ASSESSED included, to
   the not-yet-checked message: a household holding its ITA34 was told to
   "Check your auto-assessment status on the eFiling dashboard". The figures
   audit (7 Oct 2026) found exactly that on a real Tax/2026.md. Four other
   profiles had the same shape one branch over — the US, Australian and
   Canadian ones sent an assessed year the "file by the deadline" message, the
   UK, Chinese and generic ones the "find out whether you must file" message.

   The invariant, per profile: the assessed state's messages share nothing with
   any pre-assessment state's. Checked against each profile's OWN copy rather
   than against phrases typed out here, so a profile added later is held to it
   without anyone remembering this file — and the za regression is pinned once
   more through the real view.

     node tests/tax-assessed-season-copy.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { PROFILES } = require('../src/locale');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const STATES = ['submit-requested', 'auto-assessed', 'unknown'];

for (const [code, p] of Object.entries(PROFILES)) {
  for (const taxpayer_type of ['standard', 'provisional', 'unknown']) {
    const say = assessment => p.seasonMsgs({ assessment, taxpayer_type });
    const assessed = say('assessed');
    ok(Array.isArray(assessed) && assessed.length && assessed.every(m => typeof m === 'string' && m),
      `${code}/${taxpayer_type}: an assessed year gets a message`);
    /* The taxpayer-type line is shared across states by design (a provisional
       taxpayer files IRP6s whatever the assessment says), so only the
       assessment message — the first — is compared. */
    for (const state of STATES) {
      const before = say(state)[0];
      ok(assessed[0] !== before,
        `${code}/${taxpayer_type}: the assessed year must not be told what a "${state}" year is told ("${before}")`);
    }
  }
}

/* The live regression, through the real view: za, assessed. */
{
  const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
  stubObsidian();
  const { makeDom, descend } = require('./helpers/dom-stub.cjs');
  const B = 'Budget';
  const TAX = '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: assessed\n---\n\n'
    + '# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n\n'
    + '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n\n'
    + '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n';
  (async () => {
    const ctx = makeCtx({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Tax/2026.md`]: TAX }, { budgetFolder: B });
    await loadInto(ctx);
    const { $ } = makeDom();
    ctx.$ = $; ctx.$$ = () => [];
    ctx.root = $('#root');
    ctx.money = v => `R ${Number(v).toFixed(2)}`;
    require('../src/views/tax')(ctx);
    ctx.S.taxYear = '2026';
    ctx.renderTax();
    const msg = descend($('#taxSeasonBody')).find(n => n._cls.has('tax-season-msg'));
    const text = (msg && msg.textContent) || '';
    ok(text && !/Check your auto-assessment status/.test(text),
      `the za Season card no longer tells an assessed year to check its auto-assessment status (got "${text}")`);
    ok(/IRP6/.test(text), 'and still carries the provisional taxpayer\'s IRP6 reminder, which an assessment does not change');
    console.log(`tax-assessed-season-copy: ${checks} checks passed`);
  })().catch(e => { console.error(e); process.exit(1); });
}
