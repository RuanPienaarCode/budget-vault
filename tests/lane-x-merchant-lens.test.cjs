'use strict';
/* ISSUE 85, finished: the what's-left hero's `rows` and `cardRows` come from
   the ledger through one named lens, not from a hand walk.

   The question those two row sets answer is "what did a merchant actually
   charge": a split's PARENT is the bank's own line (the amount that left the
   card), its PARTS are the household's re-description of the same money. So
   the lens keeps the parent and drops the parts - the OPPOSITE of the ACCOUNT
   lens, which drops parents. Feeding ACCOUNT in lost part of the card spend
   on the real vault, because a split whose parts sum to less than its parent
   (splitShortfall) leaves the remainder on no part at all.

   Pinned on synthetic households only. The fixture reproduces the SHAPE the
   audit measured (a settle card carrying a split with a shortfall, a service
   whose latest charge was split), not its figures.

     node tests/lane-x-merchant-lens.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { B, tx, base, account, textOf, renderDash } = require('./helpers/dash-audit.cjs');
const { stamp, LENSES, keeps, lensDifference } = require('../src/ledger');
const { whatsLeft, serviceCommitments } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. the lens, as data ------------------------------------------------- */
{
  ok(LENSES.MERCHANT, 'a MERCHANT lens exists');
  ok(Object.isFrozen(LENSES.MERCHANT) && Object.isFrozen(LENSES.MERCHANT.drop), 'and is frozen like the others');
  eq([...LENSES.MERCHANT.drop], ['splitPart'], 'it drops split parts and nothing else');

  const rows = [
    { label: 'Visa', date: '2026-07-03', amount: -1000, cat: 'Groceries', desc: 'W', excluded: true, split: 'parent' },
    { label: 'Visa', date: '2026-07-03', amount: -600, cat: 'Groceries', desc: 'W', split: 'part' },
    { label: 'Visa', date: '2026-07-03', amount: -300, cat: 'Groceries', desc: 'W', split: 'part' },
    { label: 'Visa', date: '2026-07-05', amount: -200, cat: 'Groceries', desc: 'C' },
    { label: 'Visa', date: '2026-07-06', amount: -50, cat: 'Groceries', desc: 'X', excluded: true },
    { label: 'Visa', date: '2026-07-07', amount: 500, cat: 'Transfer', desc: 'T' },
  ];
  const stamped = stamp(rows, { catType: n => (n === 'Transfer' ? 'transfer' : 'expense'), catKnown: () => true });
  const kept = stamped.filter(s => keeps(LENSES.MERCHANT, s)).map(s => s.amount);
  eq(kept, [-1000, -200, -50, 500],
    'the parent is kept, the two parts are not; excluded rows and transfers are still money a merchant moved');
  const diff = lensDifference(stamped, LENSES.MERCHANT, LENSES.ACCOUNT);
  eq(diff.MERCHANT.map(s => s.amount), [-1000], 'against ACCOUNT the parent is the row only MERCHANT keeps');
  eq(diff.ACCOUNT.map(s => s.amount), [-600, -300], 'and the parts are the rows only ACCOUNT keeps');
}

/* ---- 2. source shape: no raw-row walk, no private split filter ------------- */
{
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dash = stripComments(src('views/dashboard.js'));
  const committed = stripComments(src('committed.js'));
  ok(/LENSES\.MERCHANT/.test(dash), 'the hero asks the MERCHANT lens');
  ok(!/isSplitPart/.test(committed), 'committed.js keeps no private split filter beside the lens');
  ok(!/require\('\.\/tx-role'\)/.test(committed), 'and does not import the predicate at all');
  ok(/merchantKept\.has\(r\)\) \{\s*g\.rows\.push\(r\)/.test(dash) && (dash.match(/g\.rows\.push/g) || []).length === 1,
    'rows are pushed only behind the lens, in exactly one place');
}

/* ---- 3. the hero, over a settle card carrying a split with a shortfall -------
   Visa (settle-monthly) in July: a R1 000 Woolworths parent split into R600 +
   R300 parts (R100 shortfall), plus a plain R200 Checkers. What the card
   carried is R1 200: the parent once, the plain row once. */
const salary = ['2026-04', '2026-05', '2026-06', '2026-07'];
const household = (extra = {}, opts = {}) => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-07-14' }),
  [`${B}/Accounts/Visa.md`]: account('Visa', { type: 'credit_card', settle_monthly: 'true', balance: '-1000.00', balance_updated: '2026-07-14' }),
  ...Object.fromEntries(salary.map(m => [`${B}/Transactions/Cheque/${m}.md`, tx([[`${m}-25`, 'Payday', 'Salary', 20000]])])),
  [`${B}/Transactions/Visa/2026-07.md`]: tx(opts.visa || [
    ['2026-07-03', 'Woolworths', 'Groceries', -1000, 'yes', 'parent'],
    ['2026-07-03', 'Woolworths', 'Groceries', -600, '', 'part'],
    ['2026-07-03', 'Woolworths', 'Household', -300, '', 'part'],
    ['2026-07-05', 'Checkers', 'Groceries', -200],
  ]),
  ...extra,
});
const cardLine = text => {
  const m = /R[\s  ]?([\d\s  ]+) on the card this cycle/.exec(text);
  return m ? Number(m[1].replace(/[^\d]/g, '')) : null;
};

(async () => {
  {
    const files = household();
    files[`${B}/Categories/Household.md`] = '---\ntype: expense\ncolor: "#888888"\n---\n';
    const { t } = await renderDash(files, { today: '2026-07-15', period: '2026-07' });
    eq(cardLine(t('#leftBody')), 1200,
      `the card carried R1 200: the parent once, no parts, no ACCOUNT-lens shortfall (${t('#leftBody')})`);
  }

  /* ---- 4. a service whose latest charge was split ---------------------------
     Gym is R300 a month on the 20th; June's charge was split into R200 + R100
     under the same description. The price is R300: the parent stands for the
     charge and the parts do not muddy the description group. */
  {
    const gym = (m, amt, extra = []) => [`${m}-20`, 'VIRGIN ACTIVE', 'Phone', amt, ...extra];
    const files = household({
      [`${B}/Services.md`]: '---\nkind: services\n---\n\n'
        + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
        + '|---|---|---:|---|---|---|---|---|---|\n'
        + '| Gym | Virgin Active | 0.00 | monthly | 2026-07-20 | Phone | yes |  |  |\n',
      [`${B}/Transactions/Cheque/2026-04.md`]: tx([['2026-04-25', 'Payday', 'Salary', 20000], gym('2026-04', -300)]),
      [`${B}/Transactions/Cheque/2026-05.md`]: tx([['2026-05-25', 'Payday', 'Salary', 20000], gym('2026-05', -300)]),
      [`${B}/Transactions/Cheque/2026-06.md`]: tx([
        ['2026-06-25', 'Payday', 'Salary', 20000],
        gym('2026-06', -300, ['yes', 'parent']),
        gym('2026-06', -200, ['', 'part']),
        gym('2026-06', -100, ['', 'part']),
      ]),
    });
    const { t } = await renderDash(files, { today: '2026-07-15', period: '2026-07' });
    const left = t('#leftBody');
    ok(/usually about R[\s  ]?300\b/.test(left), `the split charge still prices the service at R300: ${left}`);
  }

  /* ---- 5. the seams still behave on rows handed straight in ------------------
     serviceCommitments/whatsLeft take whatever rows the caller built; the
     lens is the caller's job now, so a part handed in is a row like any
     other (the parts carry the description too - which is why the caller
     must not hand them over). */
  {
    const svc = { name: 'Gym', provider: 'Virgin Active', amount: 0, cycle: 'monthly', active: true };
    const rows = ['2026-04', '2026-05', '2026-06'].map(m => ({ date: `${m}-20`, amount: -300, desc: 'VIRGIN ACTIVE', cat: 'Phone' }));
    const [it] = serviceCommitments({ services: [svc], rows, from: '2026-07-15', to: '2026-07-31', periodStart: '2026-07-01' });
    eq(it.amount, 300, 'lens-shaped rows price the service');
    const L = whatsLeft({ accounts: [], services: [], debts: [], rows: [], incomeRows: [], cardRows: [], periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-15' });
    eq(L.cardSpend, 0, 'no card rows, no card spend');
  }

  /* ---- 6. a split debt payment settles the instalment ------------------------
     Rule 2 reads `settleRows`, the rows the BUDGET lens kept: the excluded
     parent is already out and the parts are in, so a payment split across
     categories is seen through its Car-loan part - exactly as the Debts page's
     BUDGET tally counts it. committed.js used to strip parts again on top of
     that lens, so the parent (excluded) AND the part (stripped) both vanished
     and the instalment stayed "still committed" against a Debts page that
     read it paid. */
  {
    const debt = { name: 'Car loan', lender: 'Bank', payment: 2000, extra: 0, status: 'active', category: 'Car loan' };
    const part = { date: '2026-07-03', amount: -2000, desc: 'Bank', cat: 'Car loan', split: 'part' };
    const L = whatsLeft({ accounts: [], services: [], debts: [debt], rows: [], settleRows: [part], incomeRows: [], cardRows: [],
      periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-15' });
    eq(L.items.filter(i => i.kind === 'debt').length, 0, 'the part of a split payment settles the instalment');
    const none = whatsLeft({ accounts: [], services: [], debts: [debt], rows: [], settleRows: [], incomeRows: [], cardRows: [],
      periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-15' });
    eq(none.items.filter(i => i.kind === 'debt').length, 1, '(control: with no payment it is still committed)');
  }

  console.log(`PASS - lane X, MERCHANT lens: hero rows and card rows come from the ledger (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
