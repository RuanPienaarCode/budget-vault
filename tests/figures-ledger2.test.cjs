'use strict';
/* A SECOND numbers ledger, over tests/figures/household2.cjs. ISSUE 89.

   tests/figures-ledger.test.cjs pins household.cjs — `month_start_day: 1`,
   monthly cycles, one populated period. That household moved for none of
   three money rules a 2026-09-09 mutation pass found surviving: it has no
   month_start_day other than 1 (so the year-rollover branch of
   currentPeriod() is unreachable), no sub-monthly service, and no excluded
   row on a service's own account (so chargeIndex()'s deliberate choice not
   to filter `excluded` is never exercised).

   This is not a broader ledger — household2.cjs is deliberately narrower
   than household.cjs everywhere else. It exists to pin the three rules the
   first fixture cannot reach, the same way the first pins everything else:
   byte-golden, so ANY change to what these pages print is visible in the
   diff, not just the one line a hand-written assertion happened to check.

     node tests/figures-ledger2.test.cjs                 # verify
     node tests/figures-ledger2.test.cjs --bless         # rewrite after a change you meant
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { harvestAll } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household2.cjs');

const GOLDEN = path.join(__dirname, 'figures', 'ledger2.txt');
const BLESS = process.argv.includes('--bless');

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
    console.log(`Blessed tests/figures/ledger2.txt — ${n} figures across ${results.length} views.`);
    return;
  }

  const threw = results.filter(r => r.error);
  assert.strictEqual(threw.length, 0,
    `these views threw while being harvested: ${threw.map(r => `${r.view} (${r.error})`).join('; ')}`);

  assert.ok(results.length >= 16, `expected every dispatched view in the ledger, got ${results.length}`);

  if (!fs.existsSync(GOLDEN)) {
    assert.fail('tests/figures/ledger2.txt is missing. Run with --bless to create it, then read it before committing.');
  }
  const want = fs.readFileSync(GOLDEN, 'utf8');
  if (want !== ledger) {
    const a = want.split('\n'), b = ledger.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 40; i++) {
      if (a[i] !== b[i]) diff.push(`  line ${i + 1}\n    was: ${a[i] ?? '(end)'}\n    now: ${b[i] ?? '(end)'}`);
    }
    assert.fail('The second numbers ledger moved. Every line below is a figure the app now displays differently:\n\n'
      + diff.join('\n')
      + '\n\nIf every one of those is a change you meant, run:\n'
      + '  node tests/figures-ledger2.test.cjs --bless\n');
  }

  const n = results.reduce((s, r) => s + r.figures.length, 0);
  console.log(`figures-ledger2: ${n} figures across ${results.length} views, ledger unchanged.`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
