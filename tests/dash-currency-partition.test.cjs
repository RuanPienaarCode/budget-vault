'use strict';
/* The Dashboard's currency partition, pinned at the four places it leaked.

   ISSUE 30 partitioned the ACCOUNTS, the SERVICES and the DEBTS that reach
   whatsLeft() and stopped there. Everything else on the card kept reading one
   undivided pool, and every leak below was measured on a two-currency vault
   before it was fixed:

     1. `rows` / `incomeRows` / `cardRows` were built once over EVERY
        transaction folder and handed to both whatsLeft calls. A rand household
        with a rand settle-card at R1 000 and a euro settle-card at €500 read
        "R 1 500 on the card this cycle" — a euro added to a rand, in the one
        figure that is supposed to answer "did this cycle pay for itself". The
        euro band beneath it printed "still committed € 1 000 · actually free
        € 5 000" out of a cash of € 6 000, three terms of one equation that do
        not balance: the euro group formed a settlement CYCLE off the rand
        salary in the shared incomeRows, and a group inside a cycle drops
        cardDue from `free` while the band still prints it as committed.
        A €2 000 recurring credit into a euro account was announced on the
        household chain as "R 2 000 lands on …".

     2. The Debt tile's figure is home-only (worth() filters foreign debts) and
        its caption counted `w.active`, which is every active debt — so a
        household with one rand debt and one euro debt read the rand figure
        under the words "2 active".

     3. The Net worth tile disclosed splitByCurrency's ACCOUNT `others` only.
        worth().otherCurrencies — the foreign assets and foreign debts it held
        out — was read by nobody, so a €200 000 flat and a €100 000 bond
        vanished from the one figure that claims to be the whole picture with
        nothing said. That is the silent exclusion currency.js:14 forbids.

     4. The cash caveat ("adds accounts held in more than one currency")
        measured EVERY in-budget account while the figure above it had already
        become home-only. It therefore fired on a total that was no longer
        mixed — a disclosure that describes arithmetic the card stopped doing
        is worse than none, because a reader who acts on it changes nothing.

   Driven through the REAL loader and the REAL registerDashboard over the
   shared DOM stub — the arithmetic in committed.js and worth.js is already
   covered by its own suites, and none of these four defects is reachable from
   there: every one of them is in what the VIEW hands those functions or in
   what it prints beside their answers.
     node tests/dash-currency-partition.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const CATS = {
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#c0392b"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
};
const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n`
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

/* The clock, pinned — currentPeriod() and todayIso() both read `new Date()`,
   and every figure here is "what is left BETWEEN today and the period end".
   Subclassed rather than replaced so the loader's own date maths still works. */
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

async function mount(files, period = '2026-07') {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = period;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  /* Full precision regardless of the dp a call site passes: the card rounds to
     whole currency for a reader, and these assertions are about which CURRENCY
     a figure was printed in and whether three printed terms balance, both of
     which survive the rounding — but a stub that rounds would let a R1 500 and
     a R1 501 read alike. */
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/views/dashboard')(ctx);
  return { ctx, S, nodes, $ };
}

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));
const one = (root, cls) => byClass(root, cls)[0];
/* Every "<sym> <number>" pair in a rendered string, symbol kept. The whole
   subject of this file is which symbol a figure wore, so a reader that
   discarded it would pass on exactly the bug. */
function amounts(text) {
  const out = [];
  const re = /(R|€|\$)\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push([m[1], Number(m[2])]);
  return out;
}

(async () => {

/* --------------------------------------------------------------------------
   1. the settlement cycle, the euro band and the incoming line
   -------------------------------------------------------------------------- */
const salaryMonths = ['2026-04', '2026-05', '2026-06', '2026-07'];
const TWO_CARDS = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS,
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 9000\nbalance_updated: 2026-07-14\n---\n',
  [`${B}/Accounts/Visa.md`]:
    '---\ntype: credit_card\nsettle_monthly: true\ntx_label: "Visa"\nbalance: -1000\nbalance_updated: 2026-07-14\n---\n',
  /* The euro side: its own cash account and its own settle-monthly card, so
     the euro band has all three terms of the equation to print. */
  [`${B}/Accounts/EuroSave.md`]:
    '---\ntype: checking\ncurrency: "€"\ntx_label: "EuroSave"\nbalance: 6000\nbalance_updated: 2026-07-14\n---\n',
  [`${B}/Accounts/EuroCard.md`]:
    '---\ntype: credit_card\nsettle_monthly: true\ncurrency: "€"\ntx_label: "EuroCard"\nbalance: -500\nbalance_updated: 2026-07-14\n---\n',
  ...Object.fromEntries(salaryMonths.map(m => [
    `${B}/Transactions/Cheque/${m}.md`, txFile([[`${m}-25`, 'Payday', 'Salary', 20000]]),
  ])),
  [`${B}/Transactions/Visa/2026-07.md`]: txFile([['2026-07-05', 'Woolworths', 'Groceries', -1000]]),
  [`${B}/Transactions/EuroCard/2026-07.md`]: txFile([['2026-07-06', 'Lidl', 'Groceries', -500]]),
};

await atDate('2026-07-15', async () => {
  const { ctx, $ } = await mount(TWO_CARDS);
  ctx.renderDashboard();
  const body = $('#leftBody');

  /* (a) the cycle measures the HOME card only. R1 000 went on the rand card
     and €500 on the euro one; R1 500 is the two added. */
  const cycle = one(body, 'left-cycle');
  ok(cycle, "the settlement cycle band forms for the household's own card");
  const spend = amounts(one(cycle, 'lc-t').textContent)[0];
  eq(spend, ['R', 1000],
    `the cycle measures the household card's own spend, not a euro added to a rand — got ${JSON.stringify(spend)}`);

  /* (b) the euro band's own three terms balance. They are the SAME three terms
     as the headline chain — cash, committed, free — so cash − committed must
     equal free or the band contradicts itself in one line. */
  const fx = byClass(body, 'left-fx');
  eq(fx.length, 1, 'exactly one foreign band, for the one other currency in play');
  const fxAmounts = amounts(one(fx[0], 'left-fx-txt').textContent);
  eq(fxAmounts.map(a => a[0]), ['€', '€', '€'], 'every figure in the euro band is stated in euro');
  const [cash, committed, free] = fxAmounts.map(a => a[1]);
  eq(Math.round((cash - committed) * 100) / 100, free,
    `the euro band's own terms balance: ${cash} − ${committed} should be ${free}`);
  eq(committed, 500, "the euro card's settlement is the euro group's commitment");

  /* (c) the household chain is unpolluted in the other direction too: the euro
     card must not reach the rand "still committed" figure. Read off the
     figures themselves (.lv) rather than each tile's whole text, because a
     tile's meta line legitimately NAMES other symbols — naming them is the
     disclosure, and it is the arithmetic this leg is about. */
  const chainValues = byClass(body, 'left-fig').map(f => (one(f, 'lv') || {}).textContent || '');
  const chainSyms = chainValues.flatMap(v => amounts(v).map(a => a[0]));
  eq([...new Set(chainSyms)], ['R'],
    `every figure in the household chain is stated in rand — got ${JSON.stringify(chainValues)}`);
});

/* A euro salary is not household income arriving. */
const EURO_SALARY = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS,
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 4000\nbalance_updated: 2026-07-14\n---\n',
  [`${B}/Accounts/EuroSave.md`]:
    '---\ntype: checking\ncurrency: "€"\ntx_label: "EuroSave"\nbalance: 3000\nbalance_updated: 2026-07-14\n---\n',
  ...Object.fromEntries(salaryMonths.map(m => [
    `${B}/Transactions/EuroSave/${m}.md`, txFile([[`${m}-20`, 'Euro payday', 'Salary', 2000]]),
  ])),
};

await atDate('2026-07-15', async () => {
  const { ctx, $ } = await mount(EURO_SALARY);
  ctx.renderDashboard();
  const body = $('#leftBody');
  const incoming = one(body, 'left-incoming');
  ok(!incoming,
    'a euro salary is not "R 2 000 lands on the 20th" — the household chain announces nothing it cannot state in rand'
    + (incoming ? ` — got "${incoming.textContent}"` : ''));
});

/* --------------------------------------------------------------------------
   2. the Debt tile counts what its own figure was built from
   -------------------------------------------------------------------------- */
const DEBTS = rows =>
  '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start | Category | Status | Notes | Currency |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n' + rows.join('');

const MIXED_DEBTS = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS,
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000\nbalance_updated: 2026-07-14\n---\n',
  [`${B}/Debts.md`]: DEBTS([
    '| Bond | Bank | home loan | 40000 | 60000 | 9.5 | 1200 | 0 | 2020-01-01 | Housing | active |  |  |\n',
    '| Lisbon bond | Banco | home loan | 100000 | 120000 | 3.5 | 800 | 0 | 2021-01-01 | Housing | active |  | € |\n',
  ]),
  [`${B}/Assets.md`]:
    '---\nkind: assets\n---\n\n| Name | Type | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n'
    + '| House | property | 800000 | 2026-01-15 |  |  |\n'
    + '| Lisbon flat | property | 200000 | 2026-01-15 |  | € |\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-03', 'Shop', 'Groceries', -100]]),
};

{
  const { ctx, $ } = await mount(MIXED_DEBTS);
  ctx.renderDashboard();
  const tiles = byClass($('#dashPositionKpis'), 'mini');
  const tileByLabel = label => tiles.find(t => (one(t, 'l') || {}).textContent === label);

  const debt = tileByLabel('Debt');
  ok(debt, 'the position band draws a Debt tile');
  const debtSub = (one(debt, 's') || {}).textContent || '';
  ok(/1 active/.test(debtSub),
    `the Debt caption counts only the debts its own figure was built from — got "${debtSub}"`);

  /* The net-worth tile has to NAME the euro flat and the euro bond. Net of
     each other that is € 100 000 owned, which is the one honest thing to
     print beside a rand total: the tile is a NET WORTH, so "held" means "in
     the household's position", not "in a bank". */
  const net = tileByLabel('Net worth');
  ok(net, 'the position band draws a Net worth tile');
  const netSub = (one(net, 's') || {}).textContent || '';
  ok(/€/.test(netSub),
    `the Net worth tile names the euro assets and debts it could not add in — got "${netSub}"`);
  const euro = amounts(netSub).filter(a => a[0] === '€');
  eq(euro, [['€', 100000]],
    `and states them netted per symbol (€200 000 flat − €100 000 bond) — got ${JSON.stringify(euro)}`);
}

/* --------------------------------------------------------------------------
   3. the cash caveat describes the arithmetic the card actually did
   -------------------------------------------------------------------------- */
const MIXED_CASH = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS,
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 9000\nbalance_updated: 2026-07-14\n---\n',
  [`${B}/Accounts/EuroSave.md`]:
    '---\ntype: checking\ncurrency: "€"\ntx_label: "EuroSave"\nbalance: 6000\nbalance_updated: 2026-07-14\n---\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-03', 'Shop', 'Groceries', -100]]),
};

await atDate('2026-07-15', async () => {
  const { ctx, $ } = await mount(MIXED_CASH);
  ctx.renderDashboard();
  const cashFig = byClass($('#leftBody'), 'is-cash')[0];
  ok(cashFig, "the what's-left card draws its cash figure");
  const meta = (one(cashFig, 'lm') || {}).textContent || '';
  ok(!/more than one currency/.test(meta),
    'the cash figure is home-only, so it must not carry the caveat for a mixed total it no longer computes'
    + ` — got "${meta}"`);
  const printed = amounts((one(cashFig, 'lv') || {}).textContent);
  eq(printed, [['R', 9000]], 'and the figure itself is the household cash alone');
});

console.log(`PASS — the Dashboard partitions transactions, income and card rows by currency, its Debt caption counts what it added, its Net worth tile names the ledgers it held out, and its cash caveat describes the total it actually printed (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
