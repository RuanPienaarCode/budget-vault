'use strict';
/* Split integrity — a split charge must be counted ONCE by every reader.

   The bug this exists to prevent, and which shipped:

     splitTransaction() keeps the bank's own row and marks it excluded, then
     appends parts that sum back to it. reconcile() and splitFlows() both read
     excluded rows DELIBERATELY — an internal transfer is out of the budget but
     the money did leave the account, and every row in a fund account is
     excluded. So both of them counted a split twice: a R1,000 charge split
     600 / 400 moved the implied balance by R2,000, and the Accounts page then
     offered "Use this" on a figure short by the whole charge. Accepting it
     stamped today's date, which is what stops those rows being counted again —
     so the wrong balance became permanent and invisible.

   The fix is a role, not another `excluded` check, because those two now mean
   different things (src/tx-role.js). The traps guarded here:

     - a reader that skips ALL excluded rows to dodge the double-count would
       zero every fund account. Excluded-but-not-a-parent must still count.
     - the parent must keep its amount on disk — that IS the importer's dedup
       key, so losing it lets a re-import re-add the line on top of its parts.
     - a file with no split must keep its exact six-column shape. The seventh
       column exists to record something; a vault-wide diff recording nothing
       is a cost paid by 280 installs for no benefit.

   src/tx-role.js, src/reconcile.js and src/savings-math.js are pure, so those
   run with no stub. The serializer needs the obsidian stub, same as
   tests/split-transaction.test.cjs.

     node tests/split-integrity.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const Module = require('module');

const origLoad = Module._load;
const STUB = {
  setIcon() {}, normalizePath: (p) => p,
  Notice: class {}, Modal: class {}, Setting: class {}, PluginSettingTab: class {},
  ItemView: class {}, Plugin: class {}, TFile: class {}, TFolder: class {},
};
Module._load = function (request) {
  if (request === 'obsidian') return STUB;
  return origLoad.apply(this, arguments);
};

const {
  SPLIT_PARENT, SPLIT_PART, splitRole, supersededBySplit, isSplitPart, applySplit,
} = require('../src/tx-role');
const { reconcile } = require('../src/reconcile');
const { splitFlows, accountFlows } = require('../src/savings-math');
const { buildIndex, flagItems } = require('../src/dedupe');
const { matchCharges, chargeStats } = require('../src/recurring');
const { parseNum } = require('../src/amount');
const { parseMdTable, unescMd } = require('../src/markdown');
const registerTransactions = require('../src/views/transactions');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-08-20';

/* ---- 1. splitRole reads a role, and refuses to invent one ---- */
{
  eq(splitRole('parent'), SPLIT_PARENT, 'the parent role reads back');
  eq(splitRole('part'), SPLIT_PART, 'the part role reads back');
  eq(splitRole(' Parent '), SPLIT_PARENT, 'case and padding are tolerated');
  eq(splitRole(undefined), '', 'a row from a file written before the column existed has no role');
  eq(splitRole(''), '', 'a blank cell is no role');
  eq(splitRole('yes'), '', 'a hand-typed word in that column is a note, not a role');
  eq(splitRole('parental leave'), '', 'a role is matched whole, never by prefix');

  ok(supersededBySplit({ split: 'parent', excluded: true }), 'a parent is superseded by its parts');
  ok(!supersededBySplit({ split: 'part', excluded: false }), 'a part is the money itself');
  ok(!supersededBySplit({ excluded: true }), 'excluded alone must NOT mean superseded');
  ok(!supersededBySplit(null), 'a missing row is not superseded, it is missing');

  /* The invariant: this NARROWS the excluded set and never reaches outside it,
     so no reader can skip a row the period totals are counting. A split is
     documented as reversible by hand — "untick Excluded, delete the parts" —
     and keyed on the role alone that reversal would leave a row the budget
     counts and reconciliation skips. */
  ok(!supersededBySplit({ split: 'parent', excluded: false }),
    'a parent whose Excluded tick was removed by hand is an ordinary row again');
  ok(isSplitPart({ split: 'part', excluded: true }),
    'a part stays a part even if the reader excludes it — it is still not a statement line');
}

/* ---- 2. applySplit assigns BOTH roles ---- */
// Every row set below is built by the real function rather than by hand, so a
// change that stopped marking the parent fails here first — and then fails
// again in every section after it, which is the point.
const freshParent = () => ({
  date: '2026-08-07', desc: 'CHECKERS HYPER', cat: 'Groceries', amount: -1000,
  amountRaw: null, excluded: false, note: '',
});
const THREE_WAY = [
  { amount: -600, cat: 'Groceries', note: '' },
  { amount: -280, cat: 'Household', note: '' },
  { amount: -120, cat: 'Pharmacy', note: '' },
];
{
  const p = freshParent();
  const rows = applySplit(p, THREE_WAY, 'Split into 3');
  eq(p.excluded, true, 'the parent is excluded, so budget totals are unchanged');
  eq(p.split, SPLIT_PARENT, 'the parent is MARKED — excluded alone was the bug');
  eq(p.amount, -1000, "the parent keeps its amount — that IS the importer's dedup key");
  eq(p.note, 'Split into 3', 'the parent says why it is excluded');
  eq(rows.length, 3, 'one row per part');
  ok(rows.every(r => r.split === SPLIT_PART), 'every part carries the part role');
  ok(rows.every(r => r.date === p.date && r.desc === p.desc), 'parts inherit date and description');
  ok(rows.every(r => !r.excluded), 'parts count toward the budget — that is the whole point of splitting');
  ok(rows.every(r => r.amountRaw === undefined), 'parts are computed numbers and must not inherit amountRaw');
  eq(rows.reduce((s, r) => s + r.amount, 0), -1000, 'the parts sum to the parent');

  const p2 = freshParent();
  p2.note = 'card ending 4471';
  applySplit(p2, THREE_WAY, 'Split into 3');
  eq(p2.note, 'card ending 4471 · Split into 3', 'an existing note is kept, not overwritten');
}

/* ---- 3. reconcile: the split charge moves the balance ONCE ---- */
// A cheque account confirmed at R5,000 on the 1st. One R1,000 grocery charge on
// the 7th, split three ways. Whatever the split, the account reads R4,000.
const parentRow = freshParent();
const partRows = applySplit(parentRow, THREE_WAY, 'Split into 3');
const acct = { balance: 5000, balance_updated: '2026-08-01' };

{
  const rec = reconcile(acct, [parentRow, ...partRows], TODAY);
  eq(rec.state, 'drift', 'the charge is after the balance date, so it drifts');
  eq(rec.delta, -1000, 'the split charge moves the balance by R1,000, not R2,000');
  eq(rec.implied, 4000, 'the implied balance is the one the bank would show');
  eq(rec.count, 3, 'the parts are what moved; the parent is not counted again');
}
{
  // The same money, unsplit. The two must agree — that is the whole invariant.
  const flat = [{ ...parentRow, excluded: false, note: '', split: '' }];
  eq(reconcile(acct, flat, TODAY).implied, 4000,
    'an unsplit charge and a split one must imply the SAME balance');
}
{
  /* Reversed by hand the way transactions.js documents it: untick Excluded,
     delete the parts. The charge must come straight back — a row the budget
     counts can never be one reconciliation ignores. */
  const byHand = [{ ...parentRow, excluded: false }];   // Split cell left behind
  const rec = reconcile(acct, byHand, TODAY);
  eq(rec.count, 1, 'the un-excluded parent counts again without clearing the Split cell');
  eq(rec.implied, 4000, 'a hand-reversed split still implies the right balance');
}
{
  // The trap in the other direction: filtering all excluded rows to dodge the
  // double-count would silently zero a fund account.
  const fund = { balance: 12000, balance_updated: '2026-08-01' };
  const fundRows = [
    { date: '2026-08-05', desc: 'MONTHLY DEBIT', cat: 'Savings', amount: 1000, excluded: true, note: '', split: '' },
    { date: '2026-08-06', desc: 'INTEREST', cat: 'Interest income', amount: 43.10, excluded: true, note: '', split: '' },
  ];
  const rec = reconcile(fund, fundRows, TODAY);
  eq(rec.count, 2, 'excluded rows that are NOT split parents must still count');
  eq(Math.round(rec.implied * 100) / 100, 13043.10, 'a fund account still reconciles');
}
{
  // A parent dated ahead must not sneak in through the `ahead` window either.
  const ahead = [
    { ...parentRow, date: '2026-08-25' },
    ...partRows.map(r => ({ ...r, date: '2026-08-25' })),
  ];
  const rec = reconcile(acct, ahead, TODAY);
  eq(rec.state, 'pending', 'nothing has moved yet');
  eq(rec.ahead, 3, 'three parts are dated ahead — the parent is not a fourth');
}

/* ---- 4. splitFlows: contributions counted once ---- */
{
  const typeOf = (c) => (c === 'Interest income' ? 'income' : 'savings');
  // R2,000 moved into a fund, split across two categories, plus real interest.
  const rows = [
    { date: '2026-08-03', desc: 'TRANSFER IN', cat: '', amount: 2000, excluded: true, note: '', split: SPLIT_PARENT },
    { date: '2026-08-03', desc: 'TRANSFER IN', cat: 'Emergency fund', amount: 1500, excluded: true, note: '', split: SPLIT_PART },
    { date: '2026-08-03', desc: 'TRANSFER IN', cat: 'Baby fund', amount: 500, excluded: true, note: '', split: SPLIT_PART },
    { date: '2026-08-06', desc: 'INTEREST', cat: 'Interest income', amount: 43.10, excluded: true, note: '', split: '' },
  ];
  const f = splitFlows(rows, typeOf);
  eq(f.contributions, 2000, 'the split contribution is counted once, not twice');
  eq(f.growth, 43.10, 'interest is growth and is untouched by any of this');
  eq(f.count, 3, 'the parent is not one of the movements');

  // The identity the Savings page renders must still hold.
  const flows = accountFlows({ balance: 12043.10 }, rows, typeOf);
  eq(flows.basis, 'derived', 'rows are present, so the split is derived');
  eq(Math.round((flows.opening + flows.contributions + flows.growth - flows.withdrawals) * 100) / 100,
    flows.closing, 'opening + contributions + growth − withdrawals = closing');
  eq(flows.opening, 10000, 'the opening balance is not overstated by a phantom R2,000');
}
{
  // A split WITHDRAWAL, which is the sign this could get wrong the other way.
  const typeOf = () => 'savings';
  const rows = [
    { date: '2026-08-03', desc: 'WITHDRAWAL', cat: '', amount: -800, excluded: true, note: '', split: SPLIT_PARENT },
    { date: '2026-08-03', desc: 'WITHDRAWAL', cat: 'Repairs', amount: -500, excluded: true, note: '', split: SPLIT_PART },
    { date: '2026-08-03', desc: 'WITHDRAWAL', cat: 'Medical', amount: -300, excluded: true, note: '', split: SPLIT_PART },
  ];
  eq(splitFlows(rows, typeOf).withdrawals, 800, 'a split withdrawal is counted once');
}

/* ---- 5. What the STATEMENT said: the parent stands in, the parts do not ---- */
{
  // The importer's index. The parent must be in it — that is the documented
  // reason a split keeps the parent — and the parts must not, or a part can
  // absorb a genuine future transaction that shares its date/desc/amount.
  const files = { 'FNB Cheque/2026-08': { label: 'FNB Cheque', rows: [parentRow, ...partRows] } };
  const index = buildIndex(files);
  eq(index.exact.size, 1, 'only the parent is indexed as a statement line');

  // Re-importing the same statement: the R1,000 line is still caught.
  const reimport = [{ date: '2026-08-07', desc: 'CHECKERS HYPER', amount: -1000, include: true }];
  flagItems(reimport, index, 'FNB Cheque', null);
  ok(reimport[0].dup, 're-importing the split charge is still caught as a duplicate');

  // A genuine later charge that happens to match a PART must import.
  const genuine = [{ date: '2026-08-07', desc: 'CHECKERS HYPER', amount: -600, include: true }];
  flagItems(genuine, buildIndex(files), 'FNB Cheque', null);
  ok(!genuine[0].dup, 'a real charge matching a part must not be swallowed as a duplicate');
}
{
  // A split subscription must read as ONE charge a month, not two. Everything
  // the Services page argues with — current price, cadence, next billing —
  // is a statistic over this list.
  const svc = { name: 'Fibre', provider: 'Cool Ideas', cycle: 'monthly', amount: 859 };
  const rows = [];
  for (const m of ['05', '06', '07']) {
    rows.push({ date: `2026-${m}-02`, desc: 'COOL IDEAS FIBRE', cat: '', amount: -859, excluded: true, note: '', split: SPLIT_PARENT });
    rows.push({ date: `2026-${m}-02`, desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -600, excluded: false, note: '', split: SPLIT_PART });
    rows.push({ date: `2026-${m}-02`, desc: 'COOL IDEAS FIBRE', cat: 'Home office', amount: -259, excluded: false, note: '', split: SPLIT_PART });
  }
  const kept = rows.filter(r => !isSplitPart(r));
  const stats = chargeStats(matchCharges(svc, kept).charges);
  eq(stats.count, 3, 'three months of a split subscription are three charges, not nine');
  eq(stats.recent, 859, 'the current price is what the merchant billed, not a slice of it');
  eq(stats.varies, false, 'a steady subscription does not read as varying');

  // What the bug looked like: feed the parts in and the same figures collapse.
  const naive = chargeStats(matchCharges(svc, rows).charges);
  eq(naive.count, 9, 'guard is meaningful — including parts triples the charge count');
  ok(naive.recent !== 859, 'guard is meaningful — including parts changes the reported price');
  ok(naive.varies, 'guard is meaningful — including parts makes a steady price look erratic');
}

/* ---- 6. The shape on disk ---- */
const ctx = { S: {}, registerDirty() {}, registerSaveButton: () => () => {}, provide(o) { Object.assign(ctx, o); } };
registerTransactions(ctx);
const { serializeTxFile } = ctx;

const readBack = (text) => parseMdTable(text).slice(1).map((c) => ({
  date: c[0], desc: unescMd(c[1]), cat: unescMd(c[2]), amount: parseNum(c[3]).value,
  excluded: (c[4] || '').toLowerCase() === 'yes', note: unescMd(c[5] || ''),
  split: splitRole(c[6]),
}));

{
  const text = serializeTxFile({
    label: 'FNB Cheque', month: '2026-08', fmRaw: 'kind: transactions',
    rows: [parentRow, ...partRows].map(r => ({ ...r, amountRaw: null })),
  });
  ok(/\| Date \| Description \| Category \| Amount \| Excluded \| Note \| Split \|/.test(text),
    'a file containing a split writes the Split column');

  const back = readBack(text);
  const parents = back.filter(r => r.split === SPLIT_PARENT);
  const parts = back.filter(r => r.split === SPLIT_PART);
  eq(parents.length, 1, 'exactly one parent survives the round trip');
  eq(parts.length, 3, 'all three parts survive the round trip');
  eq(parents[0].amount, -1000, "the parent keeps its amount — that IS the importer's dedup key");
  ok(parents[0].excluded, 'the parent stays excluded, so budget totals are unchanged');
  eq(Math.round(parts.reduce((s, r) => s + r.amount, 0) * 100) / 100, parents[0].amount,
    'the parts on disk sum to the parent on disk');

  // The reason this test exists: the round-tripped rows must reconcile the same
  // as the in-memory ones. A role that survives serialisation but not parsing
  // would reintroduce the bug on the next vault load.
  eq(reconcile(acct, back, TODAY).implied, 4000,
    'rows read back off disk imply the same balance as the rows in memory');
}
{
  // No split anywhere: the file must keep the exact shape it has always had.
  const plain = {
    label: 'FNB Cheque', month: '2026-08', fmRaw: 'kind: transactions',
    rows: [
      { date: '2026-08-04', desc: 'VIRGIN ACTIVE', cat: 'Gym', amount: -600, amountRaw: null, excluded: false, note: '', split: '' },
      { date: '2026-08-09', desc: 'ENGEN', cat: 'Fuel', amount: -940, amountRaw: null, excluded: false, note: '', split: '' },
    ],
  };
  const text = serializeTxFile(plain);
  ok(!/Split/.test(text), 'a file with no split gains no Split column');
  // A stray value must not decide the file's shape either: the loader would
  // drop it, so writing it would be a cell that does not survive a reload.
  const junk = serializeTxFile({ ...plain, rows: plain.rows.map(r => ({ ...r, split: 'maybe' })) });
  ok(!/Split/.test(junk), 'a value that is not a role does not summon the column');
  ok(/\| Date \| Description \| Category \| Amount \| Excluded \| Note \|\n/.test(text),
    'the six-column header is byte-identical to what it has always been');
  for (const line of text.split('\n').filter(l => l.startsWith('| 2026'))) {
    eq(line.split('|').length, 8, 'a row in a split-free file has exactly six cells');
  }
}
{
  // A file written before the column existed: six cells, and every row must
  // load as roleless rather than as anything else.
  const legacy = [
    '| Date | Description | Category | Amount | Excluded | Note |',
    '|------|-------------|----------|-------:|----------|------|',
    '| 2026-08-04 | VIRGIN ACTIVE | Gym | -600.00 |  |  |',
    '| 2026-08-07 | OLD TRANSFER | Transfer | -1000.00 | yes | moved to savings |',
  ].join('\n');
  const back = readBack(legacy);
  eq(back.map(r => r.split), ['', ''], 'no row in a legacy file has a role');
  eq(reconcile({ balance: 5000, balance_updated: '2026-08-01' }, back, TODAY).delta, -1600,
    'a legacy excluded transfer still counts, exactly as it did before this column existed');
}

console.log(`PASS — a split charge is counted once by reconcile, savings flows and the serializer (${checks} assertions).`);
