'use strict';
/* ISSUE 77 — one column, one role.

   detectStatementColumns resolves six roles out of one header row, and five of
   them fall back to a SUBSTRING match when no alias matches exactly. So two
   roles can land on the same column index, and the function already knew that:
   the fee index has been checked against amount/debit/credit since the fee
   column was added. The BALANCE index was checked against nothing — one of
   four guarded, and the unguarded one is the column the importer checks itself
   against.

   What that cost, measured on the header below before the guard existed:

     Transaction Date,Narrative,Debits,Credit Balance
     -> map iDebit 2, iCredit 3, iBalance 3
     -> imported amounts 9750, 8850, 8805, 8185
        (the running balance, as every transaction)
     -> truth              +9750, -900, -45, -620

   Every expense in the file imports as income, three of the four rows are
   amounts that never happened, and the banner on screen reads "Could not check
   these amounts against the balance column — the balances don't line up",
   which blames the balances for a column-mapping failure. `credit` wins over
   `debit` in views/import.js, which is why the debit column never gets a say.

   Neither "Credit Balance" heading is an exact match, so nothing in
   detectStatementColumns can tell which of the two roles that column holds.
   The app argues, it does not correct: it returns null and the import view
   answers null with the manual column mapper.

   The negative control is the point of the file as much as the defect is — a
   guard that sends ORDINARY debit/credit/balance statements to the mapper
   would be a far worse bug than the one it fixes, so the same four rows are
   imported end-to-end through the real path under a header where the three
   columns are genuinely distinct.

     node tests/import-column-overlap-guard.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { detectStatementColumns, parseStatement } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const detect = csv => detectStatementColumns(parseStatement(csv.trim()), true);

/* The four rows, told three ways. Same money in all of them: a salary in, then
   three expenses, with the balance stepping down by each. */
const ROWS = [
  ['2026-01-05', 'OPENING PAY', '', '9750.00', '9750.00'],
  ['2026-01-06', 'PICK N PAY', '900.00', '', '8850.00'],
  ['2026-01-07', 'COFFEE', '45.00', '', '8805.00'],
  ['2026-01-08', 'FUEL', '620.00', '', '8185.00'],
];
const TRUTH = [9750, -900, -45, -620];

// The defect: one column answers both `includes('credit')` and `includes('balance')`.
const OVERLAP_CSV = ['Transaction Date,Narrative,Debits,Credit Balance']
  .concat(ROWS.map(r => [r[0], r[1], r[2], r[4]].join(','))).join('\n') + '\n';
// The negative control: the same money, three distinct columns.
const CLEAN_CSV = ['Date,Description,Debit,Credit,Balance']
  .concat(ROWS.map(r => r.join(','))).join('\n') + '\n';

/* ---- 1. the guard, at the seam it lives in ---------------------------- */
{
  eq(detect(OVERLAP_CSV), null,
    'a balance column that is ALSO the credit column resolves to null, so the import ' +
    'view opens the manual column mapper instead of importing the running balance as ' +
    'every transaction');

  const clean = detect(CLEAN_CSV);
  ok(!!clean, 'the negative control still auto-detects — the guard must not cost an ordinary statement');
  eq([clean.iDebit, clean.iCredit, clean.iBalance], [2, 3, 4],
    'with debit, credit and balance on three different columns');

  /* The -1 trap. Every Debit/Credit statement carries iAmount === -1, and a
     collision test written without an "is it even resolved" check would read
     -1 === -1 as an overlap and send all of them to the mapper. */
  eq(detect(CLEAN_CSV).iAmount, -1,
    'the negative control has NO signed amount column, which is what makes it the ' +
    'regression that a naive -1 === -1 comparison would cause');
  const noBalance = detect('Date,Description,Amount\n2026-01-06,PICK N PAY,-900.00\n');
  ok(!!noBalance && noBalance.iBalance === -1 && noBalance.iAmount === 2,
    'and a file with no balance column at all is unaffected — an unresolved role is not a collision');
}

/* ---- 2. the fee half of the rule is unchanged ------------------------- */
{
  /* The asymmetry is fixed by generalising, not by making balance behave like
     fee. A fee index that collides is still dropped silently, because iFee is
     never required and the collision that actually happens is a lone "Fee
     Amount" column — where the amount reading is the right one. */
  const feeAmount = detect('Date,Description,Fee Amount\n2026-01-06,SMS FEE,-0.35\n');
  ok(!!feeAmount, 'a lone "Fee Amount" column still imports rather than going to the mapper');
  eq([feeAmount.iAmount, feeAmount.iFee], [2, -1],
    'read as the amount, with the fee reading dropped — the two roles cannot both have it');

  const capitec = detect('Posting Date,Description,Money In,Money Out,Fee,Balance\n' +
    '2026-01-06,SMS FEE,,,-0.35,8850.00\n');
  eq([capitec.iCredit, capitec.iDebit, capitec.iFee, capitec.iBalance], [2, 3, 4, 5],
    'and a real three-amount-column export keeps all four indices distinct');
}

/* ---- 3. end to end, through the real import path ---------------------- */
const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-01-01\n---\n',
};

async function mount() {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = '2026-01';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  ctx.render = () => {};
  ctx.switchView = () => {};
  ctx.reloadFromDisk = async () => {};
  return { ctx, S, $ };
}

const fakeFile = (text, name = 'statement.csv') => ({
  name,
  async arrayBuffer() { return Buffer.from(text, 'utf8'); },
});

(async () => {
{
  const { ctx, S, $ } = await mount();
  await ctx.handleStatementFile(fakeFile(OVERLAP_CSV));
  ok(!S.pendingImport,
    'the overlapping header never reaches the review screen — nothing is queued for the vault');
  ok(!$('#importMap').classList.contains('hidden'),
    'the manual column mapper is what the reader gets instead: the guard is VISIBLE, ' +
    'not a silent column drop');
  ok($('#impMapNote').textContent.includes('statement.csv'),
    'and it names the file it could not read');
}

{
  const { ctx, S } = await mount();
  await ctx.handleStatementFile(fakeFile(CLEAN_CSV));
  const p = S.pendingImport;
  ok(!!p, 'the negative control imports — it reaches the review screen like any statement');
  eq(p.items.map(it => it.amount), TRUTH,
    'with the salary in and the three expenses out, signs intact');
  ok(!!p.reconcile && p.reconcile.verified && !p.reconcile.flipped,
    'and it still proves itself against its own balance column — the guard did not ' +
    'take the balance away from a file that has a real one');
}

console.log(`\nPASS — a column cannot hold two roles, and an ordinary debit/credit/balance statement still imports (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
