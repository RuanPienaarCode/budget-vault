'use strict';
/* The Dashboard hero and the Debts page must agree on "has this instalment
   been paid this period" — the critical ADR-0007's "Rule 2 asks the BUDGET
   lens" entry describes: the hero's rule 2 disagreed with the Debts page's
   own `tally(ledger(start, end), LENSES.BUDGET)` read of a category's paid
   amount, so a payment on an Excluded row, or from a `budget: false`
   account, or out of an earmarked fund settled the instalment on one page
   and left the debt outstanding on the other — dropping it from "still
   committed" and adding it to "actually free" at the exact moment the household
   most needs that figure right.

   Driven through the REAL loader and the REAL registerDashboard/registerDebts
   over the shared DOM stub, one household per veto, so this is a regression
   guard on the RENDERED pages agreeing — not on debtCommitments() agreeing
   with itself, which tests/instalment-one-rule.test.cjs already covers at the
   unit level for both the home band and a foreign one (ISSUE 85).

     node tests/hero-debts-parity.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const CATS = { [`${B}/Categories/Loan.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n' };
const DEBTS = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
  + '| Loan | Bank | personal loan | 9000.00 | 12000.00 | 15.00 | 900.00 | 0.00 | 2020-01-01 | Loan | active | |\n';
const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => TX_HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | |\n`).join('');

/* The clock, pinned — as dash-currency-partition.test.cjs does it: subclassed
   rather than replaced so the loader's own date maths still works. */
const RealDate = Date;
function atDate(iso, fn) {
  const [y, m, d] = iso.split('-').map(Number);
  const fixed = () => new RealDate(y, m - 1, d, 12, 0, 0);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed().getTime()); }
    static now() { return fixed().getTime(); }
  }
  global.Date = FakeDate;
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate; });
}

async function mount(files, period = '2026-09') {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = period;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  $('#debtExtra').value = '';
  $('#debtStrategy').value = 'avalanche';
  require('../src/views/dashboard')(ctx);
  require('../src/views/debts')(ctx);
  return { ctx, S, nodes, $ };
}

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));
const one = (root, cls) => byClass(root, cls)[0];
const num = text => {
  const m = /(-?[\d.]+)/.exec(String(text || '').replace(/\s/g, ''));
  return m ? Number(m[1]) : NaN;
};

/* One household per veto, plus a control where nothing vetoes the payment. In
   each, an active debt (900/month, category "Loan") has exactly one payment
   row on that category this period — settled only in the control. */
const households = {
  excluded: {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, [`${B}/Debts.md`]: DEBTS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-05', 'Instalment', 'Loan', -900, 'yes']]),
  },
  nonBudget: {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, [`${B}/Debts.md`]: DEBTS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Accounts/Savings.md`]: '---\ntype: savings\ntx_label: "Savings"\nbudget: false\nbalance: 5000.00\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Transactions/Savings/2026-09.md`]: tx([['2026-09-05', 'Instalment', 'Loan', -900, '']]),
  },
  earmarked: {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, [`${B}/Debts.md`]: DEBTS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Accounts/Fund.md`]: '---\ntype: savings\ntx_label: "Fund"\nemergency_fund: true\nbalance: 5000.00\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Transactions/Fund/2026-09.md`]: tx([['2026-09-05', 'Instalment', 'Loan', -900, '']]),
  },
  control: {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, [`${B}/Debts.md`]: DEBTS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-05', 'Instalment', 'Loan', -900, '']]),
  },
};

(async () => {
  for (const [name, files] of Object.entries(households)) {
    const stillOwing = name !== 'control';
    await atDate('2026-09-20', async () => {
      const { ctx, $ } = await mount(files);

      ctx.renderDashboard();
      const committedTile = one($('#leftBody'), 'is-committed');
      ok(committedTile, `[${name}] the what's-left card draws a committed tile`);
      const committed = num((one(committedTile, 'lv') || {}).textContent);

      ctx.renderDebts();
      const paidRow = one($('#debtPayments'), 'gv');
      ok(paidRow, `[${name}] the Debts page draws a paid/planned row for the linked category`);
      const paid = num((one(paidRow, 'b') || paidRow).textContent);

      if (stillOwing) {
        eq(committed, 900, `[${name}] the hero still counts the instalment as committed — got R${committed}`);
        eq(paid, 0, `[${name}] the Debts page must not credit the same vetoed payment — got R${paid} paid`);
      } else {
        eq(committed, 0, `[${name}] an ordinary payment settles the instalment on the hero — got R${committed} still committed`);
        eq(paid, 900, `[${name}] and the Debts page credits it in full — got R${paid} paid`);
      }
    });
  }

  console.log(`PASS — the Dashboard hero and the Debts page agree on every instalment, vetoed or not (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
