'use strict';
/* The two live-vault scripts read a vault off disk by ONE rule.

   L8-11 (15 Oct 2026 audit). scripts/reconcile-page.cjs readVault() was fixed on
   7 Oct (audit H-1) to keep the `.csv` files the loader reads and a marker for
   every folder that would otherwise vanish; scripts/figures.cjs kept its own
   copy of the loop, `.md` only. Run over the same real vault the two scripts then
   harvested different trees — the numbers ledger reported "rules: 0" and read
   empty account folders as missing, the exact miscount H-1 was fixed for — and
   nothing connected the two copies, so the next change to one would again leave
   the other behind. It is one function now, tests/helpers/figures.cjs readVault,
   used by both.

   Pinned here: the helper keeps what the loader reads and nothing else; the
   reconcile script re-exports the SAME function (its own suite imports it from
   there); and the figures script, run as a child over the same tree, loads the
   same number of files (it printed the md-only count before).

     node tests/figures-scripts-share-readvault.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const helper = require('./helpers/figures.cjs');
const reconcilePage = require('../scripts/reconcile-page.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TREE = {
  'Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  'Data/Categorisation Rules.csv': 'Pattern,Category\nSHOP,Food\n',
  'Notes/Receipts/scan.pdf': 'not text',
  '.hidden/secret.md': 'x',
  '.DS_Store': 'x',
};
const EMPTY_DIRS = ['Transactions/Wallet'];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-readvault-'));
const root = path.join(dir, 'Budget');
try {
  for (const [rel, text] of Object.entries(TREE)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  for (const d of EMPTY_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });

  ok(typeof helper.readVault === 'function', 'tests/helpers/figures.cjs exports readVault');
  ok(reconcilePage.readVault === helper.readVault, 'scripts/reconcile-page.cjs re-exports the SAME function, not a second copy');
  const got = helper.readVault(root);
  eq(Object.keys(got).sort(), [
    'Data/Categorisation Rules.csv', 'Notes/Receipts/.folder', 'Settings.md', 'Transactions/Wallet/.folder',
  ], 'markdown, csv, and a marker for each folder holding nothing the loader reads; dot-paths and pdf out');

  /* The script itself: its header prints how many files it loaded. */
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'figures.cjs'), '--vault', root, '--census'],
    { encoding: 'utf8', timeout: 120000 });
  eq(r.status, 0, `scripts/figures.cjs runs over the tree (${(r.stderr || '').slice(0, 200)})`);
  const m = /(\d+) files/.exec(r.stdout || '');
  ok(m && Number(m[1]) === Object.keys(got).length,
    `figures.cjs loads the same ${Object.keys(got).length} files as the shared reader (it printed "${m && m[0]}")`);
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'figures.cjs'), 'utf8');
  ok(!/function readVault\b|const readVault\b/.test(src), 'scripts/figures.cjs keeps no copy of the loop');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

console.log(`PASS figures-scripts-share-readvault (${checks} checks)`);
