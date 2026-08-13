'use strict';
/* The three-amount-column statement, end to end.

   A Capitec export has THREE mutually exclusive amount columns — Money In,
   Money Out and Fee — and the importer read only the first two. Every bank
   charge therefore vanished: on one real 25-month statement, 553 rows and
   R1,542.50, all of it spending, none of it visible anywhere to be missed. The
   import reported success, and the vault's "bank fees" baseline was built from
   data that was missing R62 a month of bank fees.

   Pinned here as a RECONCILIATION rather than a row count, because a count
   catches only omissions: the multiset of (date, amount) from the CSV must
   equal the multiset the importer produced, in both directions, and the sums
   must agree to the cent. That is the same check that found the bug, and it
   fails just as loudly on a double-count or a flipped sign as on a dropped row.

   Also pinned, in the same file because they are the same statement's
   properties:

     • a positive Fee is a REVERSAL and must stay positive
     • rows with no amount in any of the three columns are informational and
       must still be skipped
     • the fee rows are what let the file reconcile against its own balance
       column — with them dropped, the balance steps across rows nobody read
     • a statement whose account number disagrees with the account picked
       cannot be imported at all
     • a row the bank still calls (Pending) arrives unticked

   Drives the REAL import path from bytes — decode, parse, detect columns,
   review, commit — over the shared harness. Every figure is synthetic.

     node tests/import-fee-column.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The dialogs, made answerable — the only one this file reaches is the offer to
   record an account number on an account that has none. */
const answers = { confirm: true };
const seen = { confirms: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return answers.confirm; },
    async askFields() { return null; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    async askBudgetReslice() { return null; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
  },
};

const B = 'Budget';
const ACCT_NO = '1768000098';

/* A Capitec-shaped export: three amount columns, an Account column in every
   row, a running balance, one informational row and one pending card row. */
const CSV = [
  'Nr,Account,Posting Date,Transaction Date,Description,Original Description,Parent Category,Category,Money In,Money Out,Fee,Balance',
  `1,${ACCT_NO},2026-07-01,2026-07-01,Salary,Salary,Income,Salary,40000.00,,,40000.00`,
  `2,${ACCT_NO},2026-07-02,2026-07-02,Grocer One Cityville,Grocer One,Food,Groceries,,-515.00,,39485.00`,
  `3,${ACCT_NO},2026-07-03,2026-07-03,SMS Notification Fee: 1 notification(s),SMS,Fees,Fees,,,-0.35,39484.65`,
  `4,${ACCT_NO},2026-07-04,2026-07-04,Correction: SMS Notification Fee,Correction,Fees,Fees,,,0.35,39485.00`,
  `5,${ACCT_NO},2026-07-05,2026-07-05,Monthly Account Admin Fee,Admin,Fees,Fees,,,-7.50,39477.50`,
  `6,${ACCT_NO},2026-07-06,2026-07-06,Exc W/lim Checkers Kloof Street Za,Exc,,,,,,`,
  `7,${ACCT_NO},2026-07-07,2026-07-07,(Pending) Jack Hammers Gardens,Jack,,,,-52.25,,`,
  '',
].join('\n');

/* What the file SAYS, read independently of the importer — the other half of
   the reconciliation. Deliberately a dumb re-read of the CSV text rather than a
   call into src/: a fixture parsed by the code under test proves nothing. */
function csvTruth(text) {
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(',');
    const date = c[2];
    const amt = [c[8], c[9], c[10]].map(v => (v || '').trim()).find(v => v && Number(v) !== 0);
    if (!amt) continue;                       // informational: no amount anywhere
    out.push(`${date}|${Number(amt).toFixed(2)}`);
  }
  return out;
}

const FILES = (acctFm) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: `---\ntype: checking\n${acctFm}balance: 0.00\nbalance_updated: 2026-07-01\n---\n`,
});

async function mount(acctFm = '') {
  const ctx = makeCtx(FILES(acctFm));
  const S = await loadInto(ctx);
  S.period = '2026-07';
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
  return { ctx, S };
}

/* The real entry point takes a File: bytes plus a name. */
const fakeFile = (text, name = 'account_statement_2026.csv') => ({
  name,
  async arrayBuffer() { return Buffer.from(text, 'utf8'); },
});

(async () => {
/* ---- 1. every amount column is read, and the file reconciles ---- */
{
  const { ctx, S } = await mount(`account_number: "${ACCT_NO}"\n`);
  await ctx.handleStatementFile(fakeFile(CSV));
  const p = S.pendingImport;
  ok(!!p, 'the statement parsed and reached the review');

  const truth = csvTruth(CSV).sort();
  const got = p.items.map(it => `${it.date}|${it.amount.toFixed(2)}`).sort();
  eq(got, truth, 'every row carrying an amount in ANY of the three columns is read — ' +
    'the fee rows used to be dropped here, silently and one-directionally');

  const sum = a => a.reduce((n, k) => n + Number(k.split('|')[1]), 0);
  ok(Math.abs(sum(got) - sum(truth)) < 0.005, 'and the totals agree to the cent');

  const fee = p.items.find(it => it.desc.startsWith('SMS Notification Fee'));
  eq(fee.amount, -0.35, 'a charge in the Fee column keeps the file\'s own negative sign');
  const rev = p.items.find(it => it.desc.startsWith('Correction:'));
  eq(rev.amount, 0.35, 'and a REVERSAL stays positive — negating by magnitude would ' +
    'turn every refunded charge into a second charge');

  ok(!p.items.some(it => it.desc.startsWith('Exc W/lim')),
    'a row with no amount in any of the three columns is still skipped');

  ok(!!p.reconcile && p.reconcile.verified,
    'the file now reconciles against its own balance column — with the fee rows ' +
    'dropped, the balance stepped across rows nothing had read, and it could not');
  eq(p.reconcile.flipped, false, 'and nothing needed flipping');
}

/* ---- 2. a pending row arrives unticked, and says why ---- */
{
  const { ctx, S } = await mount(`account_number: "${ACCT_NO}"\n`);
  await ctx.handleStatementFile(fakeFile(CSV));
  const pend = S.pendingImport.items.find(it => it.desc.startsWith('(Pending)'));
  eq(pend.pending, true, 'the bank\'s own (Pending) marker is recognised');
  eq(pend.include, false, 'and the row is unticked — its amount can still change on settlement');

  /* The reader's own decision survives a re-render, like every other sticky bit
     on this screen. Driven through flagItems, which is what a re-render (an
     account switch, "show more") actually re-runs over the same items. */
  const { flagItems } = require('../src/dedupe');
  pend.include = true;
  const p = S.pendingImport;
  // The account the review screen settles by hand — detectAccountLabel reads
  // the filename and the preamble, and this fixture's header names neither.
  p.label = 'Cheque';
  flagItems(p.items, p.index, 'cheque', p.range);
  eq(pend.include, true, 'ticking it by hand sticks — the auto-untick happens once, not every render');

  await ctx.commitImport();
  const written = ctx.vault._store.get(`${B}/Transactions/Cheque/2026-07.md`);
  ok(written.includes('Jack Hammers'), 'and it imports when the reader says so');
}

/* ---- 3. a settled row recognises the pending one it replaces ---- */
{
  const { descsLikelySame } = require('../src/dedupe');
  ok(descsLikelySame('(Pending) Jack Hammers Gardens Western Cape', 'Jack Hammers Gardens Western Cape'),
    'the marker is stripped before the merchant is compared, so the near-duplicate ' +
    'pass can absorb a settled row into its pending twin');
  ok(!descsLikelySame('(Pending) Jack Hammers Gardens', '(Pending) Willow Feathers Newlands'),
    'and stripping it does not make two different merchants match');
}

/* ---- 4. the wrong account is refused, not warned about ---- */
{
  const { ctx, S } = await mount('account_number: "9999888877"\n');
  await ctx.handleStatementFile(fakeFile(CSV));
  S.pendingImport.label = 'Cheque';
  await ctx.commitImport();
  eq(ctx.vault._store.has(`${B}/Transactions/Cheque/2026-07.md`), false,
    'a statement whose own account number disagrees with the account picked writes nothing');
  ok(ctx._toasts.some(t => t.bad && /9999888877|1768000098/.test(t.msg)),
    'and the refusal names both numbers rather than failing quietly');
}

/* ---- 5. a masked number still matches, and a blank one is offered ---- */
{
  const { sameAccountNumber } = require('../src/statement');
  eq(sameAccountNumber('1768000098', '0098'), true, 'a hand-typed masked tail matches the full number');
  eq(sameAccountNumber('1768000098', '1768000098'), true, 'identical numbers match');
  eq(sameAccountNumber('1768000098', '9999888877'), false, 'different numbers do not');
  eq(sameAccountNumber('1768000098', ''), null, 'nothing recorded is "cannot say", never a mismatch');
  eq(sameAccountNumber('12', '12'), null, 'and two digits are not evidence of anything');

  seen.confirms.length = 0;
  answers.confirm = true;
  const { ctx, S } = await mount('');                 // no account_number recorded
  await ctx.handleStatementFile(fakeFile(CSV));
  S.pendingImport.label = 'Cheque';
  await ctx.commitImport();
  ok(seen.confirms.some(c => /1768000098/.test(c.message)),
    'an account with no number is OFFERED the one the statement carries');
  eq(S.accounts.find(a => a.name === 'Cheque').account_number, ACCT_NO, 'and accepting records it');
  ok(ctx.vault._store.get(`${B}/Accounts/Cheque.md`).includes(ACCT_NO), 'on disk, not only in memory');
  ok(ctx.vault._store.has(`${B}/Transactions/Cheque/2026-07.md`), 'the import itself still went through');
}

/* ---- 6. the committed file holds exactly what was ticked ---- */
{
  const { ctx, S } = await mount(`account_number: "${ACCT_NO}"\n`);
  await ctx.handleStatementFile(fakeFile(CSV));
  S.pendingImport.label = 'Cheque';
  await ctx.commitImport();
  const rows = S.txFiles['Cheque/2026-07'].rows;
  const got = rows.map(r => `${r.date}|${r.amount.toFixed(2)}`).sort();
  // Everything the CSV carries an amount for, less the pending row this time
  // left unticked.
  const truth = csvTruth(CSV).filter(k => !k.startsWith('2026-07-07')).sort();
  eq(got, truth, 'the vault ends up holding exactly the statement, minus what was unticked');
  ok(rows.some(r => r.amount === -0.35) && rows.some(r => r.amount === 0.35),
    'fees and their reversals both survive the round trip to disk');
}

console.log(`\nPASS — three-column statements reconcile row-for-row, and a statement cannot land in the wrong account (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
