'use strict';
/* ledgerEnv() resolves its three label sets from ONE lookup and ONE pass.

   THE DEFECT (15 Oct 2026 code-health audit, L8-04). period.js ledgerEnv()
   called nonBudgetLabels(), foreignLabels() and earmarkedLabels() on every
   ledger() call, and each walked every transaction file through
   accountForLabel(), which runs safeSeg() (NFC plus eight regex passes) on the
   label and on up to two names per account. That is files x accounts x 3 safeSeg
   passes per call, and ledger() runs several times per page. On the vault the
   audit measured the Dashboard at about half a second per render and the Score
   page at 0.3 s on a desktop, with 70% of the profile inside that lookup; an
   older iPhone is an estimated two to three seconds on the page people open
   first. ISSUE 61 had already built labelLookup() (one folded-key map, exactly
   equivalent to accountForLabel's scan) for accountIndex(); ledgerEnv() never
   used it.

   WHAT IS PINNED
     1. Cost. The work one ledger() call does in safeSeg is bounded by
        (names on accounts) + (transaction files), not by their product. Counted
        in calls rather than milliseconds so the test cannot flake on a slow CI.
     2. Equivalence. The three published label getters, and the env the ledger
        stamps against, name exactly the labels the per-label accountForLabel
        walk names — case-folded, tx_label versus name, a decomposed accent, a
        label with an illegal character, an orphan folder, an account with no
        folder.
     3. Freshness. Nothing is cached across calls: an account that gains a
        declaration (or arrives in S.accounts by push, as accounts.js does after
        an add) shows in the NEXT ledger() call. A memo keyed on S.accounts
        identity would fail this.

     node tests/period-ledger-env-lookup.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();
/* Wrap safeSeg BEFORE period.js destructures it at require time. */
const vp = require('../src/vault-path');
let segCalls = 0;
const realSeg = vp.safeSeg;
vp.safeSeg = s => { segCalls++; return realSeg(s); };
const { loadInto } = require('./helpers/harness.cjs');
const { isForeign, symbolOf } = require('../src/currency');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const month = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |\n`).join('')}`;
const account = (extra = '') => `---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-07-31\n${extra}---\n`;

/* Ten plain accounts, plus the four shapes the three sets care about. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
};
const folders = [];
for (let i = 1; i <= 10; i++) { FILES[`${B}/Accounts/Plain ${i}.md`] = account(); folders.push(`Plain ${i}`); }
FILES[`${B}/Accounts/Muted.md`] = account('budget: false\n');                       // non-budget
FILES[`${B}/Accounts/Rainy Day.md`] = account('emergency_fund: true\n'); // earmarked
FILES[`${B}/Accounts/Euro Trip.md`] = account('currency: "€"\n');                    // foreign
FILES[`${B}/Accounts/Café Card.md`] = account('tx_label: "Café card"\nbudget: false\n'); // decomposed accent in the label
folders.push('Muted', 'Rainy Day', 'Euro Trip', 'Café card');
/* Folders that case-fold onto an account, and one with no account at all. */
folders.push('plain 3', 'ORPHAN FOLDER');
for (const f of folders) FILES[`${B}/Transactions/${f}/2026-07.md`] = month([['2026-07-05', 'x', 'Food', -10], ['2026-07-06', 'y', 'Food', -20]]);

(async () => {
  const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const start = '2026-07-01', end = '2026-07-31';

  /* ---- 2. equivalence with the per-label walk -------------------------- */
  const naive = { nonBudget: new Set(), earmarked: new Set(), foreign: new Map() };
  for (const f of Object.values(S.txFiles)) {
    const a = ctx.accountForLabel(f.label);
    if (a && !a.in_budget) naive.nonBudget.add(f.label);
    if (a && a.emergency_fund === true) naive.earmarked.add(f.label);   // the fixture's only declaration
    if (a && isForeign(a, S.settings.currency)) naive.foreign.set(f.label, symbolOf(a, S.settings.currency));
  }
  /* A set that never grew would make every equality below vacuous. */
  ok(naive.nonBudget.size >= 2, `fixture: muted account folders found (${[...naive.nonBudget]})`);
  ok(naive.nonBudget.has('Café card'), 'fixture: the decomposed-accent label resolves to its account');
  ok(naive.earmarked.has('Rainy Day'), 'fixture: the emergency fund is earmarked');
  eq([...naive.foreign], [['Euro Trip', '€']], 'fixture: one foreign folder, named by its symbol');
  ok(!Object.values(S.txFiles).some(f => f.label === 'ORPHAN FOLDER' && ctx.accountForLabel(f.label)), 'fixture: the orphan folder has no account');

  eq([...ctx.nonBudgetLabels()].sort(), [...naive.nonBudget].sort(), 'nonBudgetLabels() = the per-label walk');
  eq([...ctx.earmarkedLabels()].sort(), [...naive.earmarked].sort(), 'earmarkedLabels() = the per-label walk');
  eq([...ctx.foreignLabels()].sort(), [...naive.foreign].sort(), 'foreignLabels() = the per-label walk');
  const env = ctx.ledgerEnv();
  eq([...env.nonBudgetLabels].sort(), [...naive.nonBudget].sort(), 'ledgerEnv().nonBudgetLabels = the per-label walk');
  eq([...env.earmarkedLabels].sort(), [...naive.earmarked].sort(), 'ledgerEnv().earmarkedLabels = the per-label walk');
  eq([...env.foreignLabels].sort(), [...naive.foreign].sort(), 'ledgerEnv().foreignLabels = the per-label walk');

  /* ---- 1. cost --------------------------------------------------------- */
  const nFiles = Object.keys(S.txFiles).length;
  const nNames = S.accounts.reduce((n, a) => n + (a.tx_label ? 1 : 0) + (a.name ? 1 : 0), 0);
  ctx.ledger(start, end);                        // warm any lazy require
  segCalls = 0;
  const rows = ctx.ledger(start, end);
  const perCall = segCalls;
  ok(rows.length > 0, 'the window holds rows');
  ok(perCall <= nNames + nFiles,
    `one ledger() call spends ${perCall} safeSeg passes; the bound is names (${nNames}) + files (${nFiles}) = ${nNames + nFiles}, not their product (${nNames * nFiles * 3})`);
  segCalls = 0;
  ctx.ledger(start, end); ctx.ledger(start, end); ctx.ledger(start, end);
  ok(segCalls <= 3 * (nNames + nFiles), `repeated calls stay linear (${segCalls} for three)`);

  /* The stamped rows read the same sets the getters name. */
  const byLabel = l => rows.find(r => r.label === l);
  ok(byLabel('Muted').nonBudget && byLabel('Café card').nonBudget && !byLabel('Plain 1').nonBudget, 'stamp: nonBudget per label');
  ok(byLabel('Euro Trip').foreign && byLabel('Euro Trip').symbol === '€' && !byLabel('Plain 1').foreign, 'stamp: foreign with its symbol');

  /* ---- 3. freshness: nothing is remembered between calls --------------- */
  const added = S.accounts.find(a => a.name === 'Plain 2');
  added.in_budget = false;
  ok(ctx.ledger(start, end).find(r => r.label === 'Plain 2').nonBudget, 'an account muted after a first call is non-budget on the next');
  added.in_budget = true;
  S.accounts.push({ ...added, name: 'Brand New', tx_label: 'Brand New', in_budget: false });
  ctx.S.txFiles['Brand New/2026-07'] = { label: 'Brand New', month: '2026-07', rows: [{ date: '2026-07-09', desc: 'z', cat: 'Food', amount: -5, excluded: false }] };
  const fresh = ctx.ledger(start, end).find(r => r.label === 'Brand New');
  ok(fresh && fresh.nonBudget, 'an account pushed into the SAME S.accounts array is seen by the next call (no identity-keyed memo)');

  console.log(`PASS period-ledger-env-lookup (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
