'use strict';
/* A THIRD numbers ledger, over tests/figures/household-fx.cjs: the first
   household with exchange rates switched on. 2026-11-11 audit, task 8.

   tests/figures-ledger.test.cjs and its second sibling both pin households
   with `exchange_rates` off, which is the default and the common case — and
   meant that no committed artefact listed what the app prints once a
   household turns conversion on. The Accounts hero grows a "Converted total"
   line and a sentence naming each holding and the age of its rates; every
   OTHER page is supposed to print exactly what it did before, because the
   rule everywhere else is "sum the household's currency and name the rest"
   (ADR-0004), with rates on as much as off. A conversion leaking into the
   Dashboard's net worth or the Savings KPIs would be a figure moving in this
   ledger and in neither of the other two.

   Byte-golden, like its siblings: any change to what these pages print is a
   line in the diff, not just the one a hand-written assertion happened to
   check. The fixture's rate table is a file in the fixture; nothing here
   reaches the network, and tests/reconcile-gate-fx.test.cjs fails if anything
   tries.

     node tests/figures-ledger-fx.test.cjs                 # verify
     node tests/figures-ledger-fx.test.cjs --bless         # rewrite after a change you meant
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { harvestAll } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household-fx.cjs');

const GOLDEN = path.join(__dirname, 'figures', 'ledger-fx.txt');
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
    console.log(`Blessed tests/figures/ledger-fx.txt — ${n} figures across ${results.length} views.`);
    return;
  }

  const threw = results.filter(r => r.error);
  assert.strictEqual(threw.length, 0,
    `these views threw while being harvested: ${threw.map(r => `${r.view} (${r.error})`).join('; ')}`);

  assert.ok(results.length >= 16, `expected every dispatched view in the ledger, got ${results.length}`);

  /* Not vacuous: the one line this ledger exists for is in it. A fixture
     whose rates quietly stopped loading would still harvest, still match a
     golden blessed in that state, and pin nothing about conversion. */
  const accounts = results.find(r => r.view === 'accounts');
  assert.ok(accounts && accounts.figures.some(f => /acct-hero-converted/.test(f.address) && f.raw === 58900),
    'the Accounts hero prints the converted total, R 58 900 — if this is missing the rate table did not load and the ledger is pinning the un-converted page');

  if (!fs.existsSync(GOLDEN)) {
    assert.fail('tests/figures/ledger-fx.txt is missing. Run with --bless to create it, then read it before committing.');
  }
  const want = fs.readFileSync(GOLDEN, 'utf8');
  if (want !== ledger) {
    const a = want.split('\n'), b = ledger.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 40; i++) {
      if (a[i] !== b[i]) diff.push(`  line ${i + 1}\n    was: ${a[i] ?? '(end)'}\n    now: ${b[i] ?? '(end)'}`);
    }
    assert.fail('The mixed-currency numbers ledger moved. Every line below is a figure the app now displays differently:\n\n'
      + diff.join('\n')
      + '\n\nIf every one of those is a change you meant, run:\n'
      + '  node tests/figures-ledger-fx.test.cjs --bless\n');
  }

  const n = results.reduce((s, r) => s + r.figures.length, 0);
  console.log(`figures-ledger-fx: ${n} figures across ${results.length} views, ledger unchanged.`);
})().catch(e => { console.error(e); process.exit(1); });
