'use strict';
/* The numbers ledger, pinned: every figure the app displays, held byte-for-byte.

   What this guards is not any one number — each of those has a suite already.
   It is the SET. This repo's recurring defect is two figures derived by
   different rules (eight occurrences; the multi-currency audit found it on
   Savings, Dashboard, Report, Score and both exports in one pass), and it
   survives review because no artefact has ever listed what is on screen at
   once. A change that moves a figure on a page nobody thought to re-read now
   fails here, named, with its address.

   The ledger is byte-golden, the same contract tests/golden-tables.test.cjs
   holds over the flat-table columns and for the same reason: a diff a human
   reads is worth more than an assertion a human wrote, because the assertion
   only ever covers what its author already suspected.

     node tests/figures-ledger.test.cjs                 # verify
     node tests/figures-ledger.test.cjs --bless         # rewrite after a change you meant

   Blessing is deliberately a separate, explicit act. A ledger that regenerated
   itself would turn every regression into a silent no-op — which is exactly
   what "every suite stayed green" meant in the releases this file exists
   because of.

   The household is tests/figures/household.cjs, and the clock is pinned inside
   the harness. A LIVE household is harvested by scripts/figures.cjs --vault and
   is never written here: this repo is public and stays public, and a golden
   file harvested from a real vault would publish that vault. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { harvestAll } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

const GOLDEN = path.join(__dirname, 'figures', 'ledger.txt');
const BLESS = process.argv.includes('--bless');

/* One line per figure, and nothing in a line that a rerun could change on its
   own — no timings, no counts that shift when an unrelated view gains a row. */
function render(results) {
  const out = [];
  for (const r of results) {
    out.push(`## ${r.view}`);
    if (r.error) { out.push(`!! THREW: ${r.error}`); out.push(''); continue; }
    for (const f of r.figures) {
      out.push(`${f.kind}\t${f.text}\t${f.ambiguous ? '?' : f.raw == null ? '-' : f.raw}\t${f.address}`);
    }
    out.push('');
  }
  return out.join('\n');
}

(async () => {
  const results = await harvestAll(SEED, { period: PERIOD, today: TODAY, budgetFolder: B });
  const ledger = render(results);

  if (BLESS) {
    fs.writeFileSync(GOLDEN, ledger);
    const n = results.reduce((s, r) => s + r.figures.length, 0);
    console.log(`Blessed tests/figures/ledger.txt — ${n} figures across ${results.length} views.`);
    return;
  }

  /* A view that throws is a dead page, and 1.13.0 shipped one for a whole
     release. It fails here before the diff, because a ledger missing a whole
     page's figures diffs as "those numbers changed" and buries the reason. */
  const threw = results.filter(r => r.error);
  assert.strictEqual(threw.length, 0,
    `these views threw while being harvested: ${threw.map(r => `${r.view} (${r.error})`).join('; ')}`);

  /* Every view the app dispatches must be represented. A view that renders
     nothing numeric is allowed — Notes and Import legitimately show no figures
     — but it must be PRESENT, so a view dropped from the harvest is loud. */
  assert.ok(results.length >= 16, `expected every dispatched view in the ledger, got ${results.length}`);

  if (!fs.existsSync(GOLDEN)) {
    assert.fail('tests/figures/ledger.txt is missing. Run with --bless to create it, then read it before committing.');
  }
  const want = fs.readFileSync(GOLDEN, 'utf8');
  if (want !== ledger) {
    const a = want.split('\n'), b = ledger.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 40; i++) {
      if (a[i] !== b[i]) diff.push(`  line ${i + 1}\n    was: ${a[i] ?? '(end)'}\n    now: ${b[i] ?? '(end)'}`);
    }
    assert.fail('The numbers ledger moved. Every line below is a figure the app now displays differently:\n\n'
      + diff.join('\n')
      + '\n\nIf every one of those is a change you meant, run:\n'
      + '  node tests/figures-ledger.test.cjs --bless\n');
  }

  const n = results.reduce((s, r) => s + r.figures.length, 0);
  console.log(`figures-ledger: ${n} figures across ${results.length} views, ledger unchanged.`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
