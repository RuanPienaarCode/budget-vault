'use strict';
/* A row arrives pre-excluded as a transfer between the household's own
   accounts only when the OTHER leg of that transfer is in the vault.

   Counterparty detection reads the description: a run of digits equal to one
   of the reader's other account numbers marks the row as money moved between
   their own accounts, and it arrived with Excluded ticked. But whoever types
   the EFT reference writes the description — and an account number is
   exactly what a household hands out to be paid into. A client paying R5 000
   with the household's Savings number as the reference arrived excluded as a
   "transfer to Savings", and income counted half of what came in unless the
   reader noticed the badge and unticked it (2026-10-07 audit,
   L4B-TXT-COUNTERPARTY). The app was deciding, from text a stranger wrote,
   that money was not income.

   Now a number in the description is a SUGGESTION — the row is badged and
   explained, and stays counted — unless the account it names holds the
   opposite leg: the same amount the other way, dated within a few days. That
   one is money that left one of the household's accounts and arrived in
   another, which no reference can fake, and it arrives excluded as before.
   One leg answers for one row only, and a split PART is the reader's own
   slice of a line, never a bank leg.

   Pinned on statement.js's applyCounterparties/oppositeLeg, then end to end
   through the REAL import — file bytes, review, commit — over the real loader.
     node tests/import-transfer-needs-other-leg.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return false; }, async askFields() { return null; }, async askSplit() { return null; },
    async askRulesCleanup() { return false; }, async askBudgetReslice() { return null; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
  },
};

const { applyCounterparties, oppositeLeg, TRANSFER_LEG_DAYS } = require('../src/statement');

const CHEQUE = { name: 'Cheque', account_number: '62000000001' };
const SAVINGS = { name: 'Savings', account_number: '62000000002' };
const ACCOUNTS = [CHEQUE, SAVINGS];
const leg = (date, amount, extra = {}) => ({ date, desc: 'IB TRANSFER FROM 62000000001', amount, ...extra });
const legsIn = rows => acct => (acct === SAVINGS ? rows : []);
const income = items => items.filter(i => !i.excluded).reduce((s, i) => s + i.amount, 0);

(async () => {
  /* ---- 1. a number alone suggests, it does not decide -------------------- */
  {
    const items = [
      { date: '2026-09-25', desc: 'INVOICE 1043 ACME CO', amount: 5000 },
      { date: '2026-09-25', desc: 'ACME CO 62000000002', amount: 5000 },
    ];
    applyCounterparties(items, ACCOUNTS, 'Cheque');
    eq(items[1].transferTo, 'Savings', 'a description quoting the Savings number is still recognised and badged');
    eq(items[1].excluded, false, 'but with nothing in Savings to answer it, the row stays counted');
    eq(income(items), 10000, 'so both client payments are income by default (L4B-TXT-COUNTERPARTY: 5000)');
    applyCounterparties(items, ACCOUNTS, 'Cheque', legsIn([]));
    eq(items[1].excluded, false, 'likewise when Savings holds no matching row');
  }

  /* ---- 2. the other leg decides ------------------------------------------ */
  {
    const out = { date: '2026-09-25', desc: 'IB TRANSFER TO 62000000002', amount: -5000 };
    applyCounterparties([out], ACCOUNTS, 'Cheque', legsIn([leg('2026-09-26', 5000)]));
    eq(out.excluded, true, 'R5 000 out of Cheque, R5 000 into Savings the next day: a transfer, and it arrives excluded as before');
    eq(out.transferTo, 'Savings', 'naming where it went');
    eq(out.transferLeg, '2026-09-26', 'and carrying the date of the leg that proved it, so the review can say so');

    const probe = (rows, amount = -5000, date = '2026-09-25') =>
      applyCounterparties([{ date, desc: 'IB TRANSFER TO 62000000002', amount }], ACCOUNTS, 'Cheque', legsIn(rows))[0].excluded;
    eq(probe([leg('2026-09-25', -5000)]), false, 'the same sign is not the other leg — both sides left');
    eq(probe([leg('2026-09-25', 4999.99)]), false, 'nor a different amount, by even a cent');
    eq(probe([leg(`2026-09-${String(25 + TRANSFER_LEG_DAYS).padStart(2, '0')}`, 5000)]), true, `${TRANSFER_LEG_DAYS} days apart is still one transfer (an EFT across a weekend)`);
    eq(probe([leg(`2026-09-${String(25 + TRANSFER_LEG_DAYS + 1).padStart(2, '0')}`, 5000)]), false, 'further apart, it is not evidence');
    eq(probe([leg('2026-09-21', 5000)]), true, 'and the window runs both ways — the other statement may be dated first');
    eq(probe([leg('2026-09-25', 5000, { split: 'part', excluded: false })]), false, 'a split PART is the reader\'s slice of a line, never a bank leg');
    eq(probe([leg('2026-09-25', 5000, { split: 'parent', excluded: true })]), true, 'the parent IS the line the bank printed, and still counts');
  }

  /* ---- 3. one leg answers for one row ------------------------------------ */
  {
    const items = [
      { date: '2026-09-25', desc: 'IB TRANSFER TO 62000000002', amount: -5000 },
      { date: '2026-09-25', desc: 'IB TRANSFER TO 62000000002', amount: -5000 },
    ];
    applyCounterparties(items, ACCOUNTS, 'Cheque', legsIn([leg('2026-09-25', 5000)]));
    eq(items.map(i => i.excluded), [true, false], 'two identical transfers, one leg in Savings: only one is proven');
    applyCounterparties(items, ACCOUNTS, 'Cheque', legsIn([leg('2026-09-25', 5000), leg('2026-09-26', 5000)]));
    eq(items.map(i => i.excluded), [true, true], 'two legs, two transfers');
    applyCounterparties(items, ACCOUNTS, 'Cheque', legsIn([leg('2026-09-25', 5000), leg('2026-09-26', 5000)]));
    eq(items.map(i => i.excluded), [true, true], 'and re-running it (every review render does) changes nothing');
    const nearest = oppositeLeg({ date: '2026-09-25', amount: -5000 }, [leg('2026-09-28', 5000), leg('2026-09-25', 5000)]);
    eq(nearest.date, '2026-09-25', 'of two candidate legs, the nearest in date is the one taken');
  }

  /* ---- 4. a decision the reader made outranks all of it ------------------- */
  {
    const held = [{ date: '2026-09-25', desc: 'ACME CO 62000000002', amount: 5000, excluded: true, manualExclude: true, transferTo: '' }];
    applyCounterparties(held, ACCOUNTS, 'Cheque');
    eq(held[0].excluded, true, 'a row the reader excluded by hand stays excluded, leg or no leg');
  }

  /* ---- 5. end to end: statement bytes → review → commit ------------------- */
  {
    const B = 'Budget';
    const FILES = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\naccount_number: "62000000001"\nbalance: 0.00\nbalance_updated: 2026-09-01\n---\n',
      [`${B}/Accounts/Savings.md`]: '---\ntype: savings\naccount_number: "62000000002"\nbalance: 5000.00\nbalance_updated: 2026-09-30\n---\n',
      [`${B}/Transactions/Savings/2026-09.md`]: '---\naccount: "Savings"\nmonth: 2026-09\n---\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
        + '| 2026-09-26 | IB TRANSFER FROM 62000000001 |  | 5000.00 | yes |  |\n',
    };
    const CSV = 'Date,Description,Amount\n'
      + '2026-09-20,SALARY ACME PAYROLL,20000.00\n'
      + '2026-09-25,IB TRANSFER TO 62000000002,-5000.00\n'
      + '2026-09-27,ACME CO 62000000002,5000.00\n';
    const ctx = makeCtx(FILES);
    const S = await loadInto(ctx);
    S.period = '2026-09';
    const { $ } = makeDom();
    ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    const { el } = require('../src/dom');
    ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
    require('../src/categories')(ctx);
    for (const f of ['dashboard', 'transactions', 'import']) require(`../src/views/${f}`)(ctx);
    ctx.render = () => {}; ctx.switchView = () => {};

    await ctx.handleStatementFile({ name: 'cheque.csv', async arrayBuffer() { return Buffer.from(CSV, 'utf8'); } });
    const p = S.pendingImport;
    ok(p, 'the statement reached the review');
    p.label = 'Cheque';
    ctx.renderImportReview();
    const by = d => p.items.find(i => i.desc === d);
    eq([by('IB TRANSFER TO 62000000002').excluded, by('IB TRANSFER TO 62000000002').transferTo], [true, 'Savings'],
      'the transfer whose other leg is in Savings arrives excluded');
    eq([by('ACME CO 62000000002').excluded, by('ACME CO 62000000002').transferTo], [false, 'Savings'],
      'the client payment quoting the Savings number is badged, and counted');

    const badges = $('#impTable').querySelectorAll('.badge-transfer');
    eq(badges.map(b => b.textContent), ['transfer', 'transfer?'], 'the review tells the two apart: a proven transfer and a suggested one');
    ok(/2026-09-26/.test(badges[0].getAttribute('title')), 'the proven one cites the leg that proved it');
    ok(/not counted|tick Exclude/i.test(badges[1].getAttribute('title')), `the suggested one says it is still counted and how to exclude it: ${badges[1].getAttribute('title')}`);

    await ctx.commitImport();
    const disk = ctx.vault._store.get(`${B}/Transactions/Cheque/2026-09.md`);
    ok(/\| IB TRANSFER TO 62000000002 \|[^\n]*\| yes \| Excluded during import \|/.test(disk), 'on disk: the proven transfer is excluded');
    ok(/\| ACME CO 62000000002 \|[^\n]*\| 5000\.00 \|  \|  \|/.test(disk), 'and the client payment is not');
  }

  console.log(`PASS import-transfer-needs-other-leg — a number in a reference suggests a transfer; only the other leg proves one (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
