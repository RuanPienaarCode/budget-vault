'use strict';
/* The Report is the one document this app writes that LEAVES it.

   Every other surface that narrows a figure to the household's own currency
   also says so on screen, right beside the number: the Accounts hero
   (acct.hero.otherCurrencies), the Dashboard hero (dash.foreignExcluded), the
   Savings growth tile, the Debt page's own "N in another currency, not in
   these figures" tag. The report — read by an advisor, pasted into an AI
   chat, opened months later by someone who cannot check it against the app —
   carried the fewest of those caveats and, in two sections, did not even do
   the narrowing.

   Four defects, all reproduced on 2026-09-02 and all pinned here:

     1. views/report.js's debtsSummary() read `w.active` — activeDebts(), a
        STATUS filter with no currency filter — so a euro bond was added into
        the rand total, ordered against rand cards in the per-debt table, and
        had its interest summed with theirs. The same document's Net Worth
        section, three sections below, already excluded that bond from `Owed`
        (worth.js filters), so one report disagreed with itself about one
        debt.
     2. savingsSummary() called growthTotals() over the whole pool.
        views/savings.js narrows to home-currency entries before the same call
        and its comment says it was narrowed THERE rather than inside
        growthTotals because report.js shares it — so the Report printed a
        rate whose numerator and denominator were in different currencies
        while the Savings page printed the honest one.
     3. src/report.js BUILT the Net Worth other-currency line and never pushed
        it into the document. The computation shipped with no reader.
     4. The Income & Spend section read periodSummary() — whose `foreign`
        field travels with the figures precisely so no consumer can print
        them without the caveat — and printed the five figures with nothing.

   THE SHAPE OF EVERY ASSERTION: one rand vault, then the SAME vault with a
   euro account, a euro savings pot, a euro debt and a euro asset added, and
   every rendered figure must be IDENTICAL — while the mixed report, and only
   the mixed report, names what it left out. Borrowed from
   tests/score-currency-isolation.test.cjs for the reason its own header
   gives: it needs no expected constant, so nothing about it can be tuned to
   whatever the code happens to do.

   Driven through the REAL loader and the REAL registerReport over
   tests/helpers/harness.cjs — a pure fixture handed to src/report.js cannot
   see any of these four, because all four are about what views/report.js
   puts INTO that fixture.

     node tests/report-currency.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = '---\nkind: transactions\n---';
const table = rows =>
  `${TX_FM}\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n${rows.join('\n')}\n`;

/* Both ledgers written with the FULL column list including the appended
   `currency` (ADR-0004), so the fixture exercises the real positional parse
   rather than a truncated row that happens to read the same. */
const DEBT_HEAD = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n';
const ASSET_HEAD = '---\nkind: assets\n---\n\n'
  + '| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n';

const MONTH = '2026-07';

function randVault() {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 50000.00\nbalance_updated: 2026-07-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Accounts/Unit Trust.md`]:
      '---\ntype: investment\nbalance: 121000.00\nbalance_updated: 2026-07-01\n'
      + 'starting_amount: 110000.00\ninception_date: 2025-07-01\ntx_label: "Unit Trust"\n---\n',
    [`${B}/Debts.md`]: DEBT_HEAD
      + '| Card | Bank A | credit card | 8000.00 | 10000.00 | 22.50 | 550.00 | 0.00 | 2025-01-01 | Debt | active |  |  |\n',
    [`${B}/Assets.md`]: ASSET_HEAD + '| Car | vehicle | 90000.00 | 2026-01-01 |  |  |\n',
    [`${B}/Budgets/${MONTH}.md`]:
      '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Groceries | expense | 5000.00 | |\n| Salary | income | 40000.00 | |\n',
    [`${B}/Transactions/Cheque/${MONTH}.md`]: table([
      `| ${MONTH}-01 | Salary | Salary | 40000.00 | | | |`,
      `| ${MONTH}-03 | Grocer | Groceries | -1200.00 | | | |`,
    ]),
  };
}

/* The SAME household, plus one euro corner of it in every ledger the report
   reads: an account with its own transactions, an investment pot, a bond and
   a flat. Each figure is large in rand terms precisely because nothing about
   it is wrong except that it is being added to rands. */
function plusEuro() {
  const files = randVault();
  files[`${B}/Accounts/Euro Current.md`] =
    '---\ntype: checking\nbalance: 20000.00\nbalance_updated: 2026-07-01\ncurrency: "€"\ntx_label: "Euro Current"\n---\n';
  files[`${B}/Accounts/Euro Fund.md`] =
    '---\ntype: investment\nbalance: 90000.00\nbalance_updated: 2026-07-01\ncurrency: "€"\n'
    + 'starting_amount: 30000.00\ninception_date: 2025-07-01\ntx_label: "Euro Fund"\n---\n';
  files[`${B}/Transactions/Euro Current/${MONTH}.md`] = table([
    `| ${MONTH}-02 | Freelance | Salary | 30000.00 | | | |`,
    `| ${MONTH}-05 | Rent Berlin | Groceries | -900.00 | | | |`,
  ]);
  files[`${B}/Debts.md`] = files[`${B}/Debts.md`]
    + '| Berlin bond | Bank B | mortgage | 100000.00 | 120000.00 | 3.50 | 700.00 | 0.00 | 2024-01-01 | Debt | active |  | € |\n';
  files[`${B}/Assets.md`] = files[`${B}/Assets.md`]
    + '| Berlin flat | property | 200000.00 | 2026-01-01 |  | € |\n';
  return files;
}

/* Same registration set and order as tests/report-round-trip.test.cjs's own
   mountAll — 'report' right after 'dashboard', load-bearing because it reads
   dashboard.js's ctx.provide()'d budgetVsActualRows/categorySpendRows at
   register time. */
async function mountAll(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = MONTH;
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return ctx;
}

/* The report markdown this vault actually writes, read back off the stub
   vault rather than returned from a helper — the same door
   tests/report-round-trip.test.cjs proves the app's own read path uses. */
async function reportOf(files, detail) {
  const ctx = await mountAll(files);
  ctx.renderReport();
  if (detail) ctx.setReportDetail('detail');
  await ctx.createReport();
  const path = [...ctx.app.vault._store.keys()].find(k => /Reports\/.*Financial Report\.md$/.test(k));
  assert.ok(path, 'the fixture actually wrote a report');
  return ctx.app.vault._store.get(path);
}

/* The `| label | value |` data lines under a `## Heading`, which is what the
   FIGURES in a section are. Prose caveats start with a letter, so comparing
   these between the two vaults compares only the numbers — the mixed vault
   is expected to carry an extra sentence, and expected NOT to carry a
   different figure. */
function figureRows(md, heading) {
  const lines = md.split('\n');
  const at = lines.indexOf(`## ${heading}`);
  assert.ok(at >= 0, `section "${heading}" not found`);
  const rows = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    if (lines[i].startsWith('|') && !lines[i].startsWith('|---')) rows.push(lines[i]);
  }
  return rows;
}

function sectionText(md, heading) {
  const rest = md.split(`## ${heading}`)[1] || '';
  return rest.split('\n## ')[0];
}

(async () => {
  i18n.setLanguage('en');

  /* The wall clock is pinned inside the fixture's own month for the same
     reason tests/report-round-trip.test.cjs pins it: createReport()'s
     'current' branch reads currentPeriod(), never S.period, so on any day
     this suite ran outside July 2026 every section below would be asserted
     over an empty document and every "identical" check would pass
     vacuously. */
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, 6, 15, 12, 0, 0); }
    static now() { return new PinnedDate().getTime(); }
  }
  global.Date = PinnedDate;
  try {
    const home = await reportOf(randVault());
    const mixed = await reportOf(plusEuro());

    // The fixture has to actually produce figures, or every check below is
    // an assertion about two empty documents.
    ok(home.includes('R 40000.00') && home.includes('R 1200.00'),
      'the rand vault really did report July\'s income and spend');

    const EUR_ACCOUNTS = i18n.t('dash.foreignExcluded', { count: 1, symbols: '€' });

    /* ---- 1. Income & Spend ---- */
    {
      const H = i18n.t('report.section.incomeSpend');
      eq(figureRows(mixed, H), figureRows(home, H),
        'every Income & Spend figure is the household\'s own currency only — a euro freelance payment is not rand income');
      ok(sectionText(mixed, H).includes(EUR_ACCOUNTS),
        'and the section says which account it left out — period.js hands `foreign` WITH the figures so no consumer can print them silently');
      ok(!sectionText(home, H).includes('not in these figures'),
        'while a single-currency vault is told nothing, because there is nothing to tell');
    }

    /* ---- 2. Savings ---- */
    {
      const H = i18n.t('report.section.savings');
      eq(figureRows(mixed, H), figureRows(home, H),
        'total growth and rate of growth are measured inside ONE currency — a rate dividing euro growth by rand capital is a percentage of a quantity that does not exist');
      ok(sectionText(mixed, H).includes(EUR_ACCOUNTS),
        'and the pool it narrowed to is disclosed, the same way views/savings.js\'s own growth tile discloses it');
      ok(!sectionText(home, H).includes('not in these figures'), 'silent on a rand-only vault');
    }

    /* ---- 3. Debt ---- */
    {
      const H = i18n.t('report.section.debt');
      eq(figureRows(mixed, H), figureRows(home, H),
        'the debt total, monthly commitment, interest AND the per-debt table are rand-only — a euro bond ordered by rate against rand cards is a schedule for a household that does not exist');
      ok(!sectionText(mixed, H).includes('Berlin bond'),
        'the euro bond is not listed as though its balance were rands');
      /* The liability-side key, not acct.hero.otherCurrencies: "held in other
         currencies" under a Debt heading read as an asset to an advisor,
         about a bond the household owes. Same figure, the verb that matches
         the section. */
      ok(sectionText(mixed, H).includes(i18n.t('report.debt.otherCurrencies', { list: '€ 100000' }).trim()),
        'it is named instead, in its own symbol and as money OWED — held out, never dropped');
      ok(!sectionText(mixed, H).includes(i18n.t('acct.hero.otherCurrencies', { list: '€ 100000' }).trim()),
        'and never with the asset-side verb ("held") under the Debt heading');
    }

    /* ---- 4. Net worth ---- */
    {
      const H = i18n.t('report.section.netWorth');
      eq(figureRows(mixed, H), figureRows(home, H),
        'net worth, owned and owed are unchanged by a euro flat, a euro bond and two euro accounts');
      /* The euro ACCOUNTS (20 000 + 90 000) plus the euro FLAT (200 000)
         less the euro BOND (100 000) = 210 000, merged per symbol by
         worth.js's otherCurrencyNet. Before this fix the document disclosed
         the accounts half only, when it disclosed anything at all — which it
         did not, because the line was built and never emitted. */
      ok(sectionText(mixed, H).includes(i18n.t('acct.hero.otherCurrencies', { list: '€ 210000' }).trim()),
        'and the section states the euro net it held out — accounts AND the flat AND the bond, not the accounts alone');
      ok(!sectionText(home, H).includes('held in other currencies'), 'silent on a rand-only vault');
    }

    /* ---- 5. transaction detail keeps each row in its own currency ---- */
    {
      const md = await reportOf(plusEuro(), true);
      const lines = md.split('\n');
      const head = lines.find(l => l.startsWith('| Date')).split('|').slice(1, -1).map(x => x.trim());
      const body = lines.filter(l => /^\| 2026-/.test(l));
      ok(body.length >= 3, 'the detail table lists the rand and euro rows together');
      for (const l of body) {
        eq(l.split('|').length - 2, head.length,
          'every detail row is exactly as wide as its header — one cell short files the amount under "Currency" in a table that still parses');
      }
      const CUR = head.indexOf('Currency');
      const berlin = body.find(l => l.includes('Rent Berlin'));
      ok(berlin, 'the euro row is listed, not dropped');
      eq(berlin.split('|')[CUR + 1].trim(), '€', 'and states its own symbol beside its own figure');
    }
  } finally {
    global.Date = RealDate;
  }

  console.log(`report-currency.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
