'use strict';
/* Import duplicate detection guard.

   The bug this pins: Discovery (and other card issuers) emit a card charge
   twice across two statement exports — once as `Pending` with the raw terminal
   descriptor and a provisional timestamp, then again once it settles with a
   normalised merchant string and a new time. Date AND description change, so
   the exact date|desc|amount|account key misses and the settled row lands
   beside the pending one. This pattern put 61 duplicate rows into one real vault over a
   twelve-month span.

   Layer 1 drives the matcher directly with description pairs that MIRROR the
   rewrites observed on real statements (including the ones that MUST NOT
   match). Merchant names and amounts here are SYNTHETIC — chosen to preserve
   the properties that matter: the common-prefix lengths, the 9-character
   tightest case, the whitespace-only variant, and the 14-character shared-stem
   collision. Never put real statement data in this repo; it is public.
   Layer 2 is the one that matters: it replays overlapping statement exports in
   chronological order through the same functions src/views/import.js calls,
   and asserts the simulated vault ends up with exactly one row per
   transaction.

   Layer 2 is skipped (not failed) when the statement fixtures aren't present,
   so the suite still runs on a fresh clone.

   Runs in bare node — src/dedupe.js has no obsidian dependency. Wired into
   ./build.sh.
     node tests/import-dedupe.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  txKey, buildIndex, addToIndex, findNearDuplicate, flagItems, descsLikelySame, NEAR_DAYS,
} = require('../src/dedupe');

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

/* ------------------------------------------------------------------ layer 1
   Merchant matching. Synthetic names, real rewrite SHAPES — each pair mirrors
   a rewrite actually seen on a bank statement, with the prefix arithmetic
   preserved. */
const SAME = [
  // pending descriptor -> settled descriptor
  ['GROCER ONE TERM0099', 'GROCER ONE CITYVILLE'],
  ['MEGAMART NORTHGATE', 'MEGAMART CITYVILLE'],
  ['MEGAMART PALM ROAD', 'MEGAMART CITYVILLE'],
  ['SUBSCRIPTION SVC DUBLIN IE', 'SUBSCRIPTION SVC 59.00 ZAR'],
  ['PARKING CO CITYVILLE', 'PARKING CO NORTHGATE'],
  ['FUEL STOP TRUCKPORT Rivertown', 'FUEL STOP TRUCKPO Rivertown'],
  ['VILLAGE STORE HILLSIDE', 'VILLAGE STORE WESTERN REGION'],
  ['PARKS BOARD Cityville', 'PARKS BOARD'],
  ['TRAVEL CLUB Metroville', 'TRAVEL CLUB'],
  ['MusicCoZA Stockholm SE', 'MusicCoZA 94.99 ZAR'],           // 9-char stem — the tightest real case
  ['COMMUNITY TRUST CNORTHGATE', 'COMMUNITY TRUST NORTHGATE'],
  ['FUEL STOP CENTRAL STA Cityville', 'FUEL STOP CENTRAL S Cityville'],
  ['GROCER TWO TERM0173', 'GROCER TWO HILLSIDE'],
  ['Pay *Corner Cafe Cityville', 'Pay   *Corner Cafe Cityville'],   // whitespace only
  ['Intl payment fee MUSICCO', 'Intl payment fee MUSICCO'],             // identical, date shifted
];
for (const [a, b] of SAME) ok(descsLikelySame(a, b), `should match: "${a}" vs "${b}"`);

const DIFFERENT = [
  ['GROCER ONE CITYVILLE', 'MEGAMART CITYVILLE'],
  ['Pay   *Corner Cafe Cityville', 'Pay   *Harbour Deli Cityville'],
  ['CHARGE POINT NORTHGATE', 'PETROL BAY NORTHGATE CONV Cityville'],
  ['SUBSCRIPTION SVC 59.00 ZAR', 'MusicCoZA 94.99 ZAR'],
  /* Bank verb-prefix false positives (synthetic merchants, real rewrite
     SHAPE): every bank prefixes its descriptors, and those prefixes alone
     clear the old fixed MIN_PREFIX=8 — so two DIFFERENT merchants under the
     same "Card Purchase" / "POS Purchase" / "Internet Payment TO" verb
     collided and the merchant itself was never actually compared. */
  ['Card Purchase GROCER ONE', 'Card Purchase MEGAMART'],
  ['POS Purchase VILLAGE STORE', 'POS Purchase PARKING CO'],
  ['Internet Payment TO ALICE', 'Internet Payment TO BOBBY'],
];
for (const [a, b] of DIFFERENT) ok(!descsLikelySame(a, b), `should NOT match: "${a}" vs "${b}"`);

/* The verb-prefix strip must not stop a genuine pending->settled rewrite from
   matching just because both sides happen to share the same bank verb —
   stripping is symmetric, so the merchant stem underneath is still compared. */
ok(descsLikelySame('Card Purchase GROCER ONE TERM0099', 'Card Purchase GROCER ONE CITYVILLE'),
  'should match: shared verb prefix, shared merchant stem underneath');

/* The prefix rule alone would collide these two -1.20 fees on their shared
   14-char stem. They are only kept apart by the `accounted` guard in layer 2,
   so pin the hazard explicitly — if someone "fixes" descsLikelySame to reject
   them, the guard is still what we depend on. */
ok(descsLikelySame('Intl payment fee MUSICCO', 'Intl payment fee SUBSCRIPTION'),
  'shared-stem fee descriptions do collide on prefix alone — the accounted guard is load-bearing');

/* ------------------------------------------------------------- layer 1b
   findNearDuplicate: window, accounted-for guard, range guard, consumption. */
const LABEL = 'credit card';
function idx(rows) {
  return buildIndex({ cc: { label: LABEL, rows } });
}
const RANGE = { min: '2026-06-01', max: '2026-06-30' };

{ // the core case: pending row in the vault, settled row incoming
  const index = idx([{ date: '2026-06-08', desc: 'GROCER ONE TERM0099', amount: -250.00 }]);
  const item = { date: '2026-06-08', desc: 'GROCER ONE CITYVILLE', amount: -250.00 };
  const hit = findNearDuplicate(item, index, LABEL, new Set([txKey(item.date, item.desc, item.amount, LABEL)]), new Set(), RANGE);
  ok(hit && hit.desc === 'GROCER ONE TERM0099', 'settled row matches the pending row it replaces');
}
{ // date shifted a day, description identical (the Jul–Oct 2025 flavour)
  const index = idx([{ date: '2025-10-01', desc: 'UTILITY CO364844170 DEBIT', amount: -300.00 }]);
  const item = { date: '2025-10-02', desc: 'UTILITY CO364844170 DEBIT', amount: -300.00 };
  const hit = findNearDuplicate(item, index, LABEL, new Set(), new Set(), { min: '2025-10-01', max: '2025-10-31' });
  ok(hit && hit.date === '2025-10-01', 'one-day date shift is caught');
}
{ // the false positive the accounted guard exists to stop
  const vault = [{ date: '2025-09-22', desc: 'Intl payment fee MUSICCO', amount: -1.20 }];
  const index = idx(vault);
  const incoming = [
    { date: '2025-09-22', desc: 'Intl payment fee MUSICCO', amount: -1.20 },       // unchanged, exact dup
    { date: '2025-09-23', desc: 'Intl payment fee SUBSCRIPTION', amount: -1.20 },  // genuinely new
  ];
  const keys = new Set(incoming.map(i => txKey(i.date, i.desc, i.amount, LABEL)));
  const hit = findNearDuplicate(incoming[1], index, LABEL, keys, new Set(), { min: '2025-09-01', max: '2025-09-30' });
  ok(!hit, 'a vault row still present in the incoming file cannot be absorbed by a different row');
}
{ // outside the statement's own span → absent for a boring reason, not evidence
  const index = idx([{ date: '2026-05-08', desc: 'GROCER ONE TERM0099', amount: -250.00 }]);
  const item = { date: '2026-05-09', desc: 'GROCER ONE CITYVILLE', amount: -250.00 };
  const hit = findNearDuplicate(item, index, LABEL, new Set(), new Set(), RANGE);
  ok(!hit, 'vault rows outside the incoming file date range are not candidates');
}
{ // the range guard was blind at the incoming file's OWN date boundary — exactly
  // where a re-dated pending charge lands. The vault row sits one day before
  // range.min (2026-06-01), the settled row lands just inside the range, and
  // the gap between them is well within NEAR_DAYS: this must still be caught,
  // not silently treated as "outside the file's coverage".
  const index = idx([{ date: '2026-05-31', desc: 'GROCER ONE TERM0099', amount: -250.00 }]);
  const item = { date: '2026-06-01', desc: 'GROCER ONE CITYVILLE', amount: -250.00 };
  const hit = findNearDuplicate(item, index, LABEL, new Set(), new Set(), RANGE);
  ok(hit && hit.date === '2026-05-31', 'a candidate NEAR_DAYS before range.min is still evidence, not out of scope');
}
{ // symmetric on the top edge.
  const index = idx([{ date: '2026-07-02', desc: 'GROCER ONE TERM0099', amount: -250.00 }]);
  const item = { date: '2026-06-30', desc: 'GROCER ONE CITYVILLE', amount: -250.00 };
  const hit = findNearDuplicate(item, index, LABEL, new Set(), new Set(), RANGE);
  ok(hit && hit.date === '2026-07-02', 'a candidate NEAR_DAYS past range.max is still evidence');
}
{ // beyond the window
  const index = idx([{ date: '2026-06-01', desc: 'GROCER ONE TERM0099', amount: -250.00 }]);
  const item = { date: `2026-06-${String(1 + NEAR_DAYS + 1).padStart(2, '0')}`, desc: 'GROCER ONE CITYVILLE', amount: -250.00 };
  ok(!findNearDuplicate(item, index, LABEL, new Set(), new Set(), RANGE), `no match beyond ${NEAR_DAYS} days`);
}
{ // two genuine same-amount purchases must not both claim one vault row
  const index = idx([{ date: '2026-06-10', desc: 'MEGAMART NORTHGATE', amount: -200 }]);
  const consumed = new Set();
  const a = { date: '2026-06-10', desc: 'MEGAMART CITYVILLE', amount: -200 };
  const b = { date: '2026-06-11', desc: 'MEGAMART CITYVILLE', amount: -200 };
  const hitA = findNearDuplicate(a, index, LABEL, new Set(), consumed, RANGE);
  ok(hitA, 'first row matches');
  consumed.add(hitA.id);
  ok(!findNearDuplicate(b, index, LABEL, new Set(), consumed, RANGE), 'a consumed vault row cannot be matched twice');
}
{ // different account, same amount and merchant → never a match
  const index = idx([{ date: '2026-06-08', desc: 'GROCER ONE TERM0099', amount: -250.00 }]);
  const item = { date: '2026-06-08', desc: 'GROCER ONE CITYVILLE', amount: -250.00 };
  ok(!findNearDuplicate(item, index, 'transaction account', new Set(), new Set(), RANGE),
    'matching is per-account');
}

/* ------------------------------------------------------------- layer 1c
   flagItems' sticky bit. renderImportReview re-runs on every account switch
   and every "show more", so a decision the user made must survive a re-render.
   An earlier draft cleared nearAuto in the checkbox handler, which re-unticked
   the row the next time the table drew. */
{
  const vault = [{ date: '2026-06-08', desc: 'GROCER ONE TERM0099', amount: -250 }];
  const index = buildIndex({ f: { label: LABEL, rows: vault } });
  const items = [{ date: '2026-06-08', desc: 'GROCER ONE CITYVILLE', amount: -250, include: true }];
  const range = { min: '2026-06-01', max: '2026-06-30' };

  let counts = flagItems(items, index, LABEL, range);
  ok(counts.nears === 1 && items[0].near, 'near-dup detected');
  ok(items[0].include === false, 'near-dup is unticked automatically');

  items[0].include = true;                       // user ticks it back
  flagItems(items, index, LABEL, range);
  ok(items[0].include === true, 'a manual re-tick survives the next render');

  items[0].include = false;                      // user unticks by hand
  flagItems(items, index, LABEL, range);
  ok(items[0].include === false, 'a manual untick survives the next render');

  // Switching to an account with no such row clears the flag and re-includes.
  flagItems(items, buildIndex({}), 'other account', range);
  ok(!items[0].near, 'near flag clears when it no longer collides');

  // An exact dup must never be re-included by the near branch.
  const exactItems = [{ date: '2026-06-08', desc: 'GROCER ONE TERM0099', amount: -250, include: true, near: { date: 'x', desc: 'y', key: 'k' }, nearAuto: true }];
  flagItems(exactItems, index, LABEL, range);
  ok(exactItems[0].dup === true && exactItems[0].include === false,
    'a row that became an exact dup stays excluded even with a stale near flag');
}

/* ------------------------------------------------------------- layer 1d
   Multiplicity. Identical transactions genuinely repeat — three "Returned debit
   order fee" -9.00 on one day, two R120 shop visits. An exact-key membership
   Set collapsed them, so when an early export listed a charge once and a later
   one listed it twice, the second copy was flagged a duplicate and never landed
   in ANY import: silent, permanent loss. Counts must reconcile one-for-one. */
{
  const row = { date: '2026-06-12', desc: 'MARKET HALL CITYVILLE', amount: -120 };
  const stage = n => Array.from({ length: n }, () => ({ ...row, include: true }));

  // vault has one copy, the statement now lists two → exactly one is new.
  let items = stage(2);
  flagItems(items, buildIndex({ f: { label: LABEL, rows: [row] } }), LABEL, RANGE);
  ok(items.filter(i => i.dup).length === 1, 'vault 1 / statement 2 → one flagged duplicate');
  ok(items.filter(i => !i.dup).length === 1, 'vault 1 / statement 2 → one row still importable');

  // vault already has both → neither is new.
  items = stage(2);
  flagItems(items, buildIndex({ f: { label: LABEL, rows: [row, { ...row }] } }), LABEL, RANGE);
  ok(items.every(i => i.dup), 'vault 2 / statement 2 → both duplicates');

  // vault has more than the statement → still no false importables.
  items = stage(1);
  flagItems(items, buildIndex({ f: { label: LABEL, rows: [row, { ...row }] } }), LABEL, RANGE);
  ok(items[0].dup, 'vault 2 / statement 1 → duplicate');

  // first import of three identical rows: nothing in the vault, all three land.
  items = stage(3);
  flagItems(items, buildIndex({}), LABEL, RANGE);
  ok(items.every(i => !i.dup && i.include), 'empty vault / statement 3 → all three importable');

  // the near pass must not undo it: identical rows share a key, so consuming a
  // candidate by key rather than by identity would block the twin.
  const near = [{ date: '2026-06-12', desc: 'MARKET HALL TERM0042', amount: -120 }];
  items = stage(2);
  flagItems(items, buildIndex({ f: { label: LABEL, rows: [near[0], { ...near[0] }] } }), LABEL, RANGE);
  ok(items.filter(i => i.near).length === 2, 'two pending twins can each absorb one incoming row');
}

/* ------------------------------------------------------------------ layer 2
   Replay the author's real overlapping exports in order. This is the
   regression that would have caught the original bug. */
/* Committed fixtures are ANONYMISED — merchant names and amounts are synthetic.
   They preserve the only thing that matters here: the pending→settled rewrite
   across overlapping exports. Point BUDGET_TEST_STATEMENTS at a folder of real
   exports to replay those instead; never commit real statements. */
const FIXTURES = process.env.BUDGET_TEST_STATEMENTS || path.join(__dirname, 'fixtures', 'statements');

function parseCsvSimple(text) {
  // Fixtures are bank CSV: quoted fields, commas inside quotes, no embedded newlines.
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  });
}

function loadStatement(file) {
  const rows = parseCsvSimple(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map(h => h.toLowerCase().replace(/"/g, ''));
  const iDate = header.indexOf('value date'), iDesc = header.indexOf('description'), iAmt = header.indexOf('amount');
  const out = [];
  for (const r of rows.slice(1)) {
    const amt = parseFloat(r[iAmt]);
    if (!r[iDate] || !r[iDesc] || !Number.isFinite(amt) || amt === 0) continue;
    let desc = r[iDesc];
    if (desc.endsWith(' ZA')) desc = desc.slice(0, -3);   // loc.stripDescSuffix, za profile
    out.push({ date: r[iDate], desc, amount: parseFloat(amt.toFixed(2)) });
  }
  return out;
}

function fileRange(items) {
  let range = null;
  for (const it of items) {
    if (!range) range = { min: it.date, max: it.date };
    else { if (it.date < range.min) range.min = it.date; if (it.date > range.max) range.max = it.date; }
  }
  return range;
}

/* The import the plugin performs, minus the DOM: drives the REAL flagItems,
   then commits whatever is still ticked — i.e. what a user gets by importing a
   statement and pressing the button without overriding anything. */
function simulateNew(vaultRows, items, label) {
  const index = buildIndex({ f: { label, rows: vaultRows } });
  const staged = items.map(it => ({ ...it, include: true }));
  flagItems(staged, index, label, fileRange(staged));
  const landed = staged.filter(i => i.include && !i.dup)
    .map(it => ({ date: it.date, desc: it.desc, amount: it.amount }));
  return vaultRows.concat(landed);
}

/* The behaviour shipped before this fix: a membership Set of exact keys, no
   near pass. Written out longhand rather than flag-switching the real code, so
   the comparison stays honest even as dedupe.js changes. */
function simulateOld(vaultRows, items, label) {
  const seen = new Set(vaultRows.map(r => txKey(r.date, r.desc, r.amount, label)));
  const landed = items.filter(it => !seen.has(txKey(it.date, it.desc, it.amount, label)))
    .map(it => ({ date: it.date, desc: it.desc, amount: it.amount }));
  return vaultRows.concat(landed);
}

if (!fs.existsSync(FIXTURES)) {
  console.log(`import-dedupe: ${checks} matcher checks passed; replay skipped (no tests/fixtures/statements)`);
  process.exit(0);
}

const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.csv')).sort();
const byAccount = new Map();
for (const f of files) {
  const m = f.match(/_(\d{6,})_/);
  const acc = m ? m[1] : f;
  if (!byAccount.has(acc)) byAccount.set(acc, []);
  byAccount.get(acc).push(f);
}

/* A pending/settled pair: same account+amount, within the window, same
   merchant — and NOT justified by any single export listing it twice. A bank
   that lists one charge twice in one file (Discovery did, once, and corrected
   it in the next export) is indistinguishable from a real same-day repeat, so
   it is out of scope for import-time dedupe. */
function survivingPairs(vault, exports_) {
  const twiceInOneFile = (a) => exports_.some(rows =>
    rows.filter(r => r.amount === a.amount && descsLikelySame(r.desc, a.desc) &&
      Math.abs(Date.parse(r.date + 'T00:00:00Z') - Date.parse(a.date + 'T00:00:00Z')) / 86400000 <= NEAR_DAYS).length >= 2);
  const out = [];
  for (let i = 0; i < vault.length; i++) {
    for (let j = i + 1; j < vault.length; j++) {
      const a = vault[i], b = vault[j];
      if (a.amount !== b.amount) continue;
      const gap = Math.abs(Date.parse(a.date + 'T00:00:00Z') - Date.parse(b.date + 'T00:00:00Z')) / 86400000;
      if (gap > NEAR_DAYS || !descsLikelySame(a.desc, b.desc)) continue;
      if (twiceInOneFile(a)) continue;
      out.push(`${a.date} "${a.desc}" ${a.amount} <-> ${b.date} "${b.desc}"`);
    }
  }
  return out;
}

/* Real transactions from the final statement with no counterpart in the vault
   — i.e. rows the import lost. Measured for BOTH algorithms: the near pass is
   only acceptable if it loses nothing the exact pass didn't already lose. */
function missingVsFinal(vault, finalExport) {
  const pool = vault.map(r => ({ ...r, used: false }));
  let missing = 0;
  for (const r of finalExport) {
    let m = pool.find(v => !v.used && v.date === r.date && v.desc === r.desc && v.amount === r.amount);
    if (!m) m = pool.find(v => !v.used && v.amount === r.amount && descsLikelySame(v.desc, r.desc) &&
      Math.abs(Date.parse(v.date + 'T00:00:00Z') - Date.parse(r.date + 'T00:00:00Z')) / 86400000 <= NEAR_DAYS);
    if (m) m.used = true; else missing++;
  }
  return missing;
}

let replays = 0;
for (const [acc, list] of byAccount) {
  // Chronological by export date (the trailing YYYYMMDD), so each import sees
  // the vault the previous one left behind — exactly how the bug was created.
  list.sort((a, b) => (a.match(/_(\d{8})\.csv$/) || [])[1] > (b.match(/_(\d{8})\.csv$/) || [])[1] ? 1 : -1);
  const label = `acct-${acc}`;
  const exports_ = list.map(f => loadStatement(path.join(FIXTURES, f)));
  const finalExport = exports_[exports_.length - 1];

  let vaultNew = [], vaultOld = [];
  for (const rows of exports_) {
    vaultNew = simulateNew(vaultNew, rows, label);
    vaultOld = simulateOld(vaultOld, rows, label);
  }

  const pairsNew = survivingPairs(vaultNew, exports_);
  const pairsOld = survivingPairs(vaultOld, exports_);
  ok(pairsNew.length === 0,
    `${acc}: no pending/settled duplicates survive ${list.length} sequential imports ` +
    `(exact-only leaves ${pairsOld.length})` +
    (pairsNew.length ? `\n     ${pairsNew.slice(0, 8).join('\n     ')}` : ''));

  /* The safety half. Two claims, weakest first:
       - never worse than what shipped before (the near pass must not suppress
         a real transaction the old algorithm kept), and
       - actually lossless, which the multiplicity fix is what buys: counting
         exact keys instead of testing membership means N copies on the
         statement reconcile against N copies in the vault, so a charge listed
         once in an early export and twice in a later one no longer loses its
         second copy forever. */
  const missNew = missingVsFinal(vaultNew, finalExport);
  const missOld = missingVsFinal(vaultOld, finalExport);
  ok(missNew <= missOld,
    `${acc}: never loses more than the old algorithm (missing ${missNew}, old ${missOld})`);
  ok(missNew === 0,
    `${acc}: every transaction in the final statement survived ${list.length} sequential imports ` +
    `(missing ${missNew}; the old algorithm lost ${missOld})`);

  replays++;
  console.log(`  ${acc}: ${list.length} exports · duplicates ${pairsOld.length} → ${pairsNew.length} · rows ${vaultOld.length} → ${vaultNew.length} · lost ${missOld} → ${missNew}`);
}

console.log(`import-dedupe: ${checks} checks passed (${replays} account replay${replays === 1 ? '' : 's'} over ${files.length} statement exports)`);
