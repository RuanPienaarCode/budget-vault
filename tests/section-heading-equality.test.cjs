'use strict';
/* A `## ` section of a Plan or a Tax year is the plugin's only when its
   heading IS the section's name (2026-10-14 audit, L3-04).

   load.js's section() took the first heading that STARTED with the name, and
   markdown.js extraContent decided "is this a section we own" the same way. A
   household's own `## Documents still to request`, placed above or below the
   real `## Documents`, was therefore read as the Documents table (the real
   list came back empty or wrong) and, on the next Save of the page, was
   written over the real one — in the same Save its own prose was thrown away
   as "the table's trailing text". Same for `## Items to return` over a plan's
   `## Items`.

   Through the REAL loader and the REAL serializers, with the household's
   section placed both after and before the real one, and with a duplicate of
   a real heading. Synthetic content only.
     node tests/section-heading-equality.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { extraContent } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

/* ---- the rule, on its own ---- */
{
  const body = '\n# T\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| a | todo | | |\n\n'
    + '## Progress notes\n\nOur own words.\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| x | y | needed | | |\n';
  const { extras } = extraContent(body, ['progress', 'documents', 'figures']);
  eq(extras.map(e => e.raw), ['## Progress notes\n\nOur own words.'], 'a heading that merely starts with a known name is the household\'s, kept whole');
  eq(extras[0].after, 'progress', 'in the place it was found');
  const dup = extraContent('\n## Documents\n\n| Document | S | S | F | N |\n|-|-|-|-|-|\n\n## documents  \n\nSecond copy.\n', ['documents']);
  eq(dup.extras.map(e => e.raw), ['## documents  \n\nSecond copy.'.trim()], 'a known heading that repeats is an extra: only the first is ever read');
}

const head = '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: assessed\n---\n\n# Tax Year 2026\n\n';
const prog = '## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | |\n\n';
const docs = '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | uploaded | irp5.pdf | |\n| IT3(b) | Bank | needed | | |\n\n';
const figs = '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Interest | Bank | 15000.00 |\n';
const mine = '## Documents still to request\n\nAsk the broker for the IT3(c) and the RA certificate.\n- broker: call Tuesday\n\n';

(async () => {
  for (const [label, text] of [['after', head + prog + docs + mine + figs], ['before', head + prog + mine + docs + figs]]) {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: text });
    const S = await loadInto(ctx);
    require('../src/views/tax')(ctx);
    S.taxYear = '2026';
    eq(S.tax['2026'].docs.map(d => d.name), ['IRP5', 'IT3(b)'], `Tax, household section ${label} the real one: the real Documents are read`);
    S.tax['2026'].figures[0].description = 'Interest (edited)';
    const out = ctx.serializeTax('2026');
    for (const keep of ['Ask the broker for the IT3(c) and the RA certificate.', '- broker: call Tuesday', '## Documents still to request',
      '| IRP5 | Employer | uploaded | irp5.pdf |', '| IT3(b) | Bank | needed |', 'Interest (edited)']) {
      ok(out.includes(keep), `Tax, ${label}: ${JSON.stringify(keep)} is still in the file after a Save`);
    }
    ok(out.indexOf('## Documents still to request') < out.indexOf('## Figures'), 'and it still sits ahead of Figures, where the household put it');
    eq((out.match(/^## Documents$/mg) || []).length, 1, 'with exactly one real Documents heading');
  }

  const plan = '---\nkind: plan\nplan: "Holiday"\nstatus: active\n---\n\n# Holiday\n\n## Money in\n\n| Source | Kind | Amount | Date | Status | Notes |\n|---|---|---:|---|---|---|\n| Bonus | Bonus | 10000.00 | 2026-09-01 | received | |\n\n'
    + '## Envelopes\n\n| Envelope | Amount | Note | Tint |\n|---|---:|---|---|\n| Travel | 6000.00 | | |\n\n'
    + '## Items to return after the trip\n\n- the borrowed tent\n\n'
    + '## Items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n|---|---|---:|---:|---|---|---|\n| Flights | Travel | 4000.00 | 0.00 | planned | | |\n| Hotel | Travel | 2000.00 | 0.00 | planned | | |\n';
  {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/Holiday.md`]: plan });
    const S = await loadInto(ctx);
    require('../src/views/plan')(ctx);
    S.planName = 'Holiday';
    eq(S.plans.Holiday.items.map(i => i.name), ['Flights', 'Hotel'], 'Plan: the real Items are read past "## Items to return…"');
    S.plans.Holiday.sources[0].notes = 'edited';
    const out = ctx.serializePlan('Holiday');
    for (const keep of ['## Items to return after the trip', '- the borrowed tent', '| Flights | Travel |', '| Hotel | Travel |']) {
      ok(out.includes(keep), `Plan: ${JSON.stringify(keep)} survives a Save`);
    }
  }

  console.log(`PASS — section headings match by equality: a household's "## Documents still to request" is kept, never read as Documents (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
