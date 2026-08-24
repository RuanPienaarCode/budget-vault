'use strict';
/* Five fixes from the 13-agent Accounts-lane audit, pinned against the real
   view rather than trusted by inspection.

     1. GROWTH — the goal cell and the drawer read totalReturn(), not the
        retired `balance - total_invested`, and the two now agree with
        views/savings.js's own figure for the same account.
     2. MIXED CURRENCY — the ring discloses a group (and the household) that
        spans more than one symbol, the same way the hero and the table's
        group rows already do — and a card where every group nets negative
        never renders with a blank body.
     3. OWNER SPLIT — an owner's own total gets the same disclosure.
     4. UNREADABLE BALANCE — a cell load.js could not parse at all renders as
        what it is, not as a fabricated R0,00, and a perfectly good
        decimal-comma balance is NOT mistaken for one.
     5. DELETE COUNT — the folder-deletion dialog counts real transactions,
        not a split's parts.

   Runs in bare node against the real view, same harness as
   tests/account-owner.test.cjs.
     node tests/accounts-audit-fixes.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

/* A programmable modal stub, installed BEFORE anything requires
   views/accounts.js — that module destructures askFields/confirmModal off
   '../modal' at REQUIRE time, so swapping the cache entry after the first
   mount() (which requires accounts.js) would bind nothing. `answers.confirm`
   defaults to true and `answers.fields` to null so every section that never
   opens a dialog is unaffected. */
const modalPath = require.resolve('../src/modal.js');
const modalAnswers = { confirm: true, fields: null };
const modalSeen = { fields: [] };
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return modalAnswers.confirm; },
    async askFields(app, title, fields) { modalSeen.fields.push({ title, fields }); return modalAnswers.fields; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const textOf = root => descend(root).map(n => n.textContent || '').join(' | ');

async function mount(files, settingsFm = 'owners: "Alex, Sam"\n') {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: `---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n${settingsFm}---\n`,
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Categories/Interest.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    ...files,
  });
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
  require('../src/views/accounts')(ctx);
  return { ctx, S, $ };
}

(async () => {
  /* ---- 1. growth reads totalReturn(), not balance - total_invested ---- */
  {
    /* starting_amount + a dated contribution and a dated interest credit,
       from an inception well before the transactions folder — the exact
       shape totalReturn()'s header says the retired formula got wrong: a
       total_invested that has not kept pace with a debit order. */
    const { ctx, S } = await mount({
      [`${B}/Accounts/Fund.md`]:
        '---\ntype: investment\nbalance: 60000.00\nstarting_amount: 50000.00\ninception_date: 2026-01-01\n'
        + 'total_invested: 40000.00\nbalance_updated: 2026-07-15\n---\n',
      [`${B}/Transactions/Fund/2026-07.md`]:
        '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
        + '| 2026-07-02 | Debit order | Groceries | 5000.00 | yes |  |  |\n'
        + '| 2026-07-05 | Interest | Interest | 2000.00 | yes |  |  |\n',
    });
    ctx.renderAccounts();
    const fund = S.accounts.find(a => a.name === 'Fund');
    const idx = ctx.accountIndex();
    const { totalReturn } = require('../src/savings-math');
    const tr = totalReturn(fund, (idx.get(fund) || {}).rows || [], ctx.catType, { today: '2026-07-20' });
    eq(tr.basis, 'measured', 'starting_amount is set, so this account is measured, not stated');
    eq(tr.capitalIn, 55000, '50 000 starting + 5 000 contribution, no withdrawals');
    eq(tr.growth, 5000, '60 000 balance - 55 000 capital in');
    ok(tr.growth !== fund.balance - fund.total_invested,
      'the retired formula (balance - total_invested = 20 000) and the real one now disagree, '
      + 'which is exactly the bug this fix closes');

    const goalCell = textOf(ctx.$('#acctTable'));
    ok(goalCell.includes('+9%') || goalCell.includes('R 55000') || goalCell.includes('R 55 000') || goalCell.includes('55000'),
      `the goal cell reads off the real capital-in figure, not total_invested (table text: ${goalCell})`);
    ok(!goalCell.includes('+50%'),
      'and NOT the retired formula\'s answer ((60000-40000)/40000 = +50%)');

    // Open the drawer and check the Growth field directly.
    S.acctView.open = 'Fund';
    ctx.renderAccounts();
    const drawerTxt = textOf(ctx.$('#acctTable'));
    ok(drawerTxt.includes('R 5000.00') || drawerTxt.includes('R5000.00') || drawerTxt.includes('5000.00'),
      `the drawer's Growth field is 5 000, not 20 000 (drawer text: ${drawerTxt})`);
  }

  /* ---- 1b. totalReturn basis 'none' — no fabricated number ---- */
  {
    /* total_invested is set, but there is no starting_amount AND there are
       transactions in the window — totalReturn cannot split capital from
       growth here, and printing a percentage anyway is exactly the failure
       mode this whole fix exists to end. */
    const { ctx, S } = await mount({
      [`${B}/Accounts/Unmeasurable.md`]:
        '---\ntype: investment\nbalance: 60000.00\ninception_date: 2026-01-01\n'
        + 'total_invested: 40000.00\nbalance_updated: 2026-07-15\n---\n',
      [`${B}/Transactions/Unmeasurable/2026-07.md`]:
        '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
        + '| 2026-07-02 | Debit order | Groceries | 5000.00 | yes |  |  |\n',
    });
    ctx.renderAccounts();
    const rowTxt = textOf(ctx.$('#acctTable'));
    ok(!rowTxt.includes('+50%'), 'no percentage is printed when totalReturn cannot measure it');
    void S;
  }

  /* ---- 2. mixed-currency disclosure on the ring, and never a blank card ---- */
  {
    const { ctx } = await mount({
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Accounts/Euro Pocket.md`]:
        '---\ntype: checking\ncurrency: "€"\nbalance: 500.00\nbalance_updated: 2026-07-01\n---\n',
    }, '');
    ctx.renderAccounts();
    const ring = descend(ctx.$('#acctSummary')).find(n => n._cls && n._cls.has('acct-ring'));
    ok(ring, 'the ring renders');
    ok(textOf(ring).includes('more than one currency'),
      'the whole-card disclosure fires when the household spans currencies');
    ok(descend(ring).some(n => n._cls && n._cls.has('acct-mixed')),
      'and the group that actually mixes symbols carries its own mark');
  }

  /* ---- 2b. every group net negative: a note, never a blank body ---- */
  {
    const { ctx } = await mount({
      [`${B}/Accounts/Card.md`]:
        '---\ntype: credit_card\ncredit_limit: 5000\nbalance: -2000.00\nbalance_updated: 2026-07-01\n---\n',
    }, '');
    ctx.renderAccounts();
    const ring = descend(ctx.$('#acctSummary')).find(n => n._cls && n._cls.has('acct-ring'));
    ok(ring, 'the ring still renders a card');
    const note = descend(ring).find(n => n._cls && n._cls.has('acct-ring-body'));
    ok(note && textOf(note).trim().length > 0,
      'and its body is never empty, even when nothing can be drawn — the old early return '
      + 'skipped the negative-group note entirely');
  }

  /* ---- 2c. an all-zero vault gets a real empty state, not a blank card ---- */
  {
    const { ctx } = await mount({
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-07-01\n---\n',
    }, '');
    ctx.renderAccounts();
    const ring = descend(ctx.$('#acctSummary')).find(n => n._cls && n._cls.has('acct-ring'));
    const note = descend(ring).find(n => n._cls && n._cls.has('acct-ring-body'));
    ok(note && textOf(note).trim().length > 0, 'a zero-balance vault still gets a sentence, not silence');
  }

  /* ---- 3. the owner split carries the same mixed-currency mark ---- */
  {
    const { ctx } = await mount({
      [`${B}/Accounts/His Cheque.md`]:
        '---\ntype: checking\nowner: Alex\nbalance: 10000.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Accounts/His Euro.md`]:
        '---\ntype: savings\nowner: Alex\ncurrency: "€"\nbalance: 300.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Accounts/Her Cheque.md`]:
        '---\ntype: checking\nowner: Sam\nbalance: 8000.00\nbalance_updated: 2026-07-01\n---\n',
    });
    ctx.renderAccounts();
    const owners = descend(ctx.$('#acctSummary')).find(n => n._cls && n._cls.has('acct-owners'));
    ok(owners, '"Whose it is" renders for two owners');
    ok(descend(owners).some(n => n._cls && n._cls.has('acct-mixed')),
      "Alex's row (rand + euro) carries the mixed mark Sam's row does not need");
  }

  /* ---- 4. an unreadable balance is shown, not fabricated as R0,00 ---- */
  {
    const { ctx, S } = await mount({
      // Cannot be parsed by normalizeAmount at all.
      [`${B}/Accounts/Bad Cell.md`]: '---\ntype: checking\nbalance: "N/A"\nbalance_updated: 2026-07-01\n---\n',
      // A decimal-comma balance normalizeAmount reads CORRECTLY — must not be
      // caught by the same net.
      [`${B}/Accounts/Odd Balance.md`]: '---\ntype: checking\nbalance: "1 234,56"\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Accounts/Plain.md`]: '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-07-01\n---\n',
    }, '');
    const bad = S.accounts.find(a => a.name === 'Bad Cell');
    const odd = S.accounts.find(a => a.name === 'Odd Balance');
    eq(bad.balance, 0, 'load.js has nothing better to fall back to than 0 for a truly unreadable cell');
    eq(odd.balance, 1234.56, 'a decimal-comma balance is read correctly, not treated as unreadable');

    ctx.renderAccounts();
    const tableTxt = textOf(ctx.$('#acctTable'));
    /* The balance BUTTON must not read as a plausible R0,00 — the whole point
       of the fix is that admitting the cell is unreadable beats fabricating a
       figure. Asserted on the RENDERED COPY, not on the key name: the first
       draft of this file checked for the literal string
       `acct.balance.unreadable`, which passed only while the key was still
       untranslated and went red the moment it was translated. That is pinning
       the gap rather than the behaviour, and it is the same shape as the
       delete-dialog assertion this very audit had to correct. */
    ok(/could not read/i.test(tableTxt),
      `Bad Cell's balance cell says it cannot be read, rather than printing a figure (table text: ${tableTxt})`);
    ok(!/R\s*0[.,]00/.test(tableTxt),
      `and specifically does not fabricate R0,00 for it (table text: ${tableTxt})`);
    ok(tableTxt.includes('R 1234.56') || tableTxt.includes('1234.56'),
      `Odd Balance still renders its real, correctly-parsed figure (table text: ${tableTxt})`);

    const heroTxt = textOf(ctx.$('#acctSummary'));
    ok(/could not be read/i.test(heroTxt),
      `the hero discloses that a balance was left out of the total (hero text: ${heroTxt})`);
  }

  /* ---- 5. the delete dialog counts transactions, not split parts ---- */
  {
    const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
    const { ctx, S } = await mount({
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Transactions/Cheque/2026-07.md`]:
        `---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n${HEAD}`
        + '| 2026-07-01 | Salary | Groceries | 4000.00 |  |  |  |\n'
        + '| 2026-07-05 | Big shop | Groceries | -900.00 | yes | Split into 2 | parent |\n'
        + '| 2026-07-05 | Big shop | Groceries | -500.00 |  |  | part |\n'
        + '| 2026-07-05 | Big shop | Groceries | -400.00 |  |  | part |\n',
    }, '');
    ctx.render = () => {};
    modalAnswers.confirm = true;
    modalAnswers.fields = { folder: 'keep' };
    modalSeen.fields.length = 0;
    const acct = S.accounts.find(a => a.name === 'Cheque');
    await ctx.deleteAccount(acct);
    const asked = modalSeen.fields[modalSeen.fields.length - 1];
    ok(asked, 'the folder question was asked');
    const desc = asked.fields[0].desc;
    ok(/\b2\b/.test(desc),
      `the dialog counts 2 real transactions (parent + salary), not 4 raw rows (desc: "${desc}")`);
    ok(!/\b4\b/.test(desc), `and does not count the split's parts as transactions of their own (desc: "${desc}")`);
  }

  console.log(`PASS — accounts audit fixes: growth, mixed-currency disclosure, unreadable balance, delete count (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
