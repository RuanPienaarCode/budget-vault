'use strict';
/* The Report page finds its own earlier report the way the filesystem does,
   and "Re-create (overwrite)" then overwrites it.

   2026-10-07 audit (Phase 1 carry-over to Phase 2). The page's "Already
   exists" check and its write both asked Obsidian's index for the EXACT path.
   On macOS and iOS "reports/september 2026 financial report.md" — a report
   saved while the folder field said "reports" — is the very file
   "Reports/September 2026 Financial Report.md" names. The page said nothing
   (no "Already exists", the button said Create rather than Re-create), and
   the click did not overwrite either: writeVaultFile missed the exact key and
   called vault.create, and Vault.create (app.js 1.13.7) asks the adapter —
   case-insensitive there — whether the path exists and throws "File already
   exists.". So the reader got a failure with no warning before it.

   Now the existence check is io.js's vaultPathTaken (case-folded, NFC), and
   the page addresses the file by the spelling the vault already has for it —
   so the warning shows, Open and Copy reach the real file, and Re-create
   modifies it in place. The vault is helpers/case-insensitive-vault.cjs:
   the harness vault behaving as Obsidian 1.13.7 does on APFS. Synthetic data.

     node tests/report-file-case.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor } = require('./helpers/report-page.cjs');
const { caseInsensitive } = require('./helpers/case-insensitive-vault.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* What the 'current' selection names on TODAY, and an earlier report of the
   same selection saved under another case — folder and file both. */
const ASKED = 'Reports/September 2026 Financial Report.md';
const THEIRS = 'reports/september 2026 financial report.md';
const THEIRS_JSON = 'reports/september 2026 financial report.json';
const OLD = '---\ngenerated: 2026-09-01 08:00\n---\n\n# An earlier report\n';

async function mount(extra) {
  const M = await mountFor({ ...SEED, ...extra }, { period: PERIOD, budgetFolder: B });
  caseInsensitive(M.ctx.vault);
  const opened = [];
  M.ctx.app.workspace = { getLeaf: () => ({ openFile: async f => { opened.push(f.path); } }) };
  M.opened = opened;
  return M;
}
const text = (M, sel) => M.nodes.get(sel).textContent;

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const i18n = require('../src/i18n');
    i18n.setLanguage('en');

    /* ---- found: warned before the click, addressed by its own name ---- */
    {
      const M = await mount({ [THEIRS]: OLD });
      M.ctx.renderReport();
      eq(text(M, '#reportExistsNote'), i18n.t('report.exists', { formats: i18n.t('report.format.md') }),
        'the earlier report is found although it differs only by case — "Already exists" is shown');
      eq(text(M, '#reportCreateLabel'), i18n.t('report.recreate'), 'and the button says Re-create (overwrite), not Create');
      ok(!M.nodes.get('#reportResultCard').classList.contains('hidden'), 'the result panel offers it');
      eq(text(M, '#reportResultSub'), THEIRS, 'under the name it really has');
      await M.ctx.openReport();
      eq(M.opened, [THEIRS], 'Open reaches the real file');

      /* ---- re-created: overwritten in place, not refused, not doubled ---- */
      const before = new Set(M.ctx.vault._store.keys());
      await M.ctx.createReport();
      const bad = M.ctx._toasts.filter(t => t.bad).map(t => t.msg);
      eq(bad, [], 'Re-create does not fail with "File already exists." (what Obsidian\'s create says on APFS)');
      ok(M.ctx.vault._store.get(THEIRS) !== OLD && /Financial Report|Income/i.test(M.ctx.vault._store.get(THEIRS)), 'the earlier report was overwritten with the new one');
      eq([...M.ctx.vault._store.keys()].filter(k => !before.has(k) && !k.endsWith('/.folder')), [], 'and no second spelling of it appeared');
      eq(text(M, '#reportResultSub'), THEIRS, 'the panel still names the one real file');
    }

    /* ---- the JSON sibling follows the same rule ---- */
    {
      const M = await mount({ [THEIRS]: OLD, [THEIRS_JSON]: '{}\n' });
      M.ctx.renderReport();
      eq(text(M, '#reportExistsNote'), i18n.t('report.exists', { formats: `${i18n.t('report.format.md')}, ${i18n.t('report.format.json')}` }),
        'both formats are found, each by its own case-variant file');
    }

    /* ---- nothing there: unchanged ---- */
    {
      const M = await mount({});
      M.ctx.renderReport();
      eq(text(M, '#reportExistsNote'), '', 'no earlier report, no note');
      eq(text(M, '#reportCreateLabel'), i18n.t('report.create'), 'and the button says Create');
      await M.ctx.createReport();
      ok(M.ctx.vault._store.has(ASKED), 'a first report is written where the page said');
    }
  } finally {
    unpin();
  }
  console.log(`PASS report-file-case (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
