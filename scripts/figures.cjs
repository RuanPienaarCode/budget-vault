'use strict';
/* The numbers ledger: print every figure the app displays, one line each.

     node scripts/figures.cjs                          # the committed fixture
     node scripts/figures.cjs --vault "<abs path>"     # a real household, LOCAL ONLY
     node scripts/figures.cjs --view dashboard         # one page
     node scripts/figures.cjs --census                 # counts only

   Two modes, one harness, and the difference matters. The fixture is small,
   deterministic and safe to commit — it is what a diff in a pull request can
   be read against. A real vault is none of those things and catches what no
   fixture author invents: four years of months, blank rates, unreadable dates,
   valuations old enough to be stale, a category list that grew by hand.

   Live output is NEVER a committed golden. This repo is public and stays
   public (the community store's build verification clones the source), so a
   golden file harvested from a real household would publish that household.
   --vault therefore writes only to stdout or to the gitignored figures dir,
   and the bless step refuses it outright. */

const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('../tests/helpers/harness.cjs');
stubObsidian();
const { harvestAll } = require('../tests/helpers/figures.cjs');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(`--${n}`); return i < 0 ? null : (argv[i + 1] || true); };
const has = n => argv.includes(`--${n}`);

/* ---- reading a real vault off disk --------------------------------------
   The harness vault is a flat { 'path/to/file.md': contents } map, so a live
   run is just a recursive read. Only .md is loaded — the app reads nothing
   else, and slurping a vault's attachments into memory would be a lot of bytes
   to no purpose. */
function readVault(root) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith('.md')) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root, '');
  return out;
}

(async () => {
  const vaultPath = flag('vault');
  let files, budgetFolder, period, today, label;

  if (vaultPath && vaultPath !== true) {
    const abs = path.resolve(String(vaultPath));
    if (!fs.existsSync(abs)) { console.error(`No such vault folder: ${abs}`); process.exit(1); }
    /* The budget folder is the LEAF the plugin points at, and the harness
       vault is rooted there — so the map keys are relative to it and the
       folder name is the last segment. Reading the whole Obsidian vault and
       keeping the configured sub-path would work too, and would carry every
       unrelated note in the household into memory for nothing. */
    budgetFolder = path.basename(abs);
    files = {};
    for (const [k, v] of Object.entries(readVault(abs))) files[`${budgetFolder}/${k}`] = v;
    label = `live vault: ${abs}`;
  } else {
    const seed = require('../tests/figures/household.cjs');
    files = seed.SEED; budgetFolder = seed.B; period = seed.PERIOD; today = seed.TODAY;
    label = 'fixture: tests/figures/household.cjs';
  }

  period = String(flag('period') || period || '2026-09');
  today = String(flag('today') || today || '2026-09-02');
  const only = flag('view');

  const t0 = Date.now();
  const results = await harvestAll(files, { period, today, budgetFolder });
  const ms = Date.now() - t0;

  const shown = only && only !== true ? results.filter(r => r.view === only) : results;
  if (only && only !== true && !shown.length) {
    console.error(`No such view: ${only}. Known: ${results.map(r => r.view).join(', ')}`);
    process.exit(1);
  }

  console.log(`# ${label}`);
  console.log(`# period ${period}, today ${today}, ${Object.keys(files).length} files, harvested in ${ms}ms\n`);

  let total = 0, broken = 0;
  for (const r of shown) {
    if (r.error) { broken++; console.log(`## ${r.view}\n!! THREW: ${r.error}\n`); continue; }
    total += r.figures.length;
    if (has('census')) { console.log(`${String(r.figures.length).padStart(5)}  ${r.view}`); continue; }
    /* The SAME tab-separated shape tests/figures-ledger.test.cjs writes, so a
       live harvest and the committed one can be diffed directly against each
       other. A real household and a fixture will never agree on values — that
       is not what the comparison is for. What it shows is SHAPE: an address
       present in one and absent in the other is a figure the fixture never
       exercises, which is the ledger telling you where its own coverage ends. */
    console.log(`## ${r.view}`);
    for (const f of r.figures) {
      console.log(`${f.kind}\t${f.text}\t${f.ambiguous ? '?' : f.raw == null ? '-' : f.raw}\t${f.address}`);
    }
    console.log('');
  }
  console.log(`\n# ${total} figures across ${shown.length - broken} views${broken ? `, ${broken} view(s) threw` : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
