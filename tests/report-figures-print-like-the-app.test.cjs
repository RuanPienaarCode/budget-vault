'use strict';
/* The Report prints a figure the way the screen it came from does, and a
   currency symbol as text, not as markup (2026-10-14 audit: L2b-09, L4b-03,
   L4a-12).

   1. FOREIGN SUMS ARE GROUPED (L2b-09). The "Plus € 200 300 held in other
      currencies" sentence printed `${sym} ${Math.round(v)}` — "€ 200300" —
      beside a Net Worth in "R 111 500,00". The Dashboard, the Savings page,
      the Assets page and the Owed page print the same fact through
      moneyIn(sym, v, 0). The Report is handed that formatter now and does the
      same.

   2. ONE DECIMAL MARK (L2b-09). Percentages in the Markdown were written with
      a literal "." (sharePercentLabel(…, '.')) in a document whose money is
      "R 97,80": a budget 100.24% used printed "100.2%" beside rand in commas.
      They take the household's own decimal mark now, as the Budget page and
      the Dashboard do.

   3. A SYMBOL IS TEXT (L4b-03). An account's currency symbol is whatever the
      household typed into the account note, and the Report prints it inside
      its sentences ("Plus ![s](https://…) 1 000 held…", the stale-balance
      line, the score caveat, the detail table's amount cell). A symbol of
      `$![s](https://attacker.example/p.png)` fetched that URL every time the
      report was opened. It goes through escMdText — except a symbol's trailing
      "$", which is how "$", "R$" and "US$" end and which, printed before a
      space, cannot open inline maths; escaping it would put a backslash into
      every dollar household's document.

   4. THE JSON CARRIES CENTS (L4a-12). Money in the JSON was the raw float sum:
      a total like 123456.78999999999. Every money field is rounded once,
      by the same roundCents the exports use.

     node tests/report-figures-print-like-the-app.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, section, kids, text } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const report = require('../src/report');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';

async function run(files, opts, pill = 'current') {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
    const out = await createReport(M, { pill, ...(opts || {}) });
    return { M, ...out };
  } finally { unpin(); }
}

(async () => {
  /* ---- 1. grouped foreign sums ------------------------------------------------- */
  {
    const files = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Bills.md`]: '---\ntype: expense\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-09-01\ntx_label: "Cheque"\n---\n',
      [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n'
        + '| Car | vehicle | 100000.00 | 2026-09-01 |  |  |\n| Flat in Lisbon | property | 200000.00 | 2026-09-01 |  | € |\n',
      [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n|---|---:|---|---|---|---:|---|---|\n'
        + '| Ben | 300.00 | loan |  | outstanding | 0.00 | 2026-09-01 | € |\n',
    };
    const r = await run(files);
    const { ctx } = r.M;
    const printed = ctx.moneyIn('€', 200300, 0);
    ok(/200.300/.test(printed) && !/200300/.test(printed), `fixture: the app groups it — "${printed}"`);
    const nw = section(r.md, 'Net Worth');
    ok(nw.includes(`Plus ${printed} held in other currencies`), `the Report prints it the same way — got "${nw.replace(/\n+/g, ' | ')}"`);
    ok(!/200300/.test(r.md), 'and nowhere ungrouped');
  }

  /* ---- 2. one decimal mark -------------------------------------------------------- */
  {
    /* 100.24% of the spending budget: the boundary where a whole percent would
       state the opposite of the truth, so sharePercentLabel prints decimals. */
    const files = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
      [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-09-01\ntx_label: "Cheque"\n---\n',
      [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Salary | income | 30000.00 |  |\n| Groceries | expense | 5000.00 |  |\n',
      [`${B}/Transactions/Cheque/2026-09.md`]: HEAD + '| 2026-09-01 | Salary | Salary | 30000.00 |  |  |  |\n| 2026-09-02 | Checkers | Groceries | -5012.00 |  |  |  |\n',
    };
    const r = await run(files);
    const dec = r.M.ctx.locale().decimal;
    eq(dec, ',', 'fixture: a South African household writes a comma');
    ok(r.md.includes('100,2% of spending budget used'), `the percentage uses the household's mark — got "${(r.md.match(/\S+% of spending budget used/) || [''])[0]}"`);
    ok(!/100\.2%/.test(r.md), 'and not a dot beside rand written with commas');
    /* The bare serialiser, with no formatter handed in, keeps the dot: that is
       its documented default for a caller that knows no locale. */
    const bare = report.financialReportMarkdown({
      generated: 'g', periodLabel: 'p', rangeNote: 'r', detail: 'summary', periodCount: 1, income: 0, spend: 0, net: 0, budgetIncome: 0, budgetSpend: 0,
      budgetUsed: { spend: 5012, setAside: 0, assumed: 0, budgeted: 5000, moved: 0, setAsidePlanned: 0 }, categories: [], spendByCategory: [],
      netWorth: { net: 0, assets: 0, liabilities: 0 },
    }, v => `R ${v}`);
    ok(bare.includes('100.2%'), 'a caller that hands no locale gets the dot');
  }

  /* ---- 3. a symbol is text ------------------------------------------------------------ */
  {
    const P = 'https://attacker.example/p.png';
    const SYM = `$![s](${P})`;
    const ACC = 'Dollar savings';
    const files = { ...SEED };
    files[`${B}/Accounts/${ACC}.md`] = SEED[`${B}/Accounts/${ACC}.md`].replace('currency: "$"', `currency: "${SYM}"`);
    files[`${B}/Transactions/${ACC}/2026-09.md`] = HEAD + '| 2026-09-02 | Dollar shop | Groceries | -45.00 |  |  |  |\n';
    const r = await run(files, { detail: 'detail' });
    ok(r.md.includes('Dollar shop'), 'fixture: the foreign account\'s row reached the detail table');
    const active = r.md.split('\n').filter(l => /(^|[^\\])!\[/.test(l));
    eq(active, [], `no image survives anywhere in the document — ${active.slice(0, 2).join(' || ')}`);
    ok(!r.md.includes(`![s](${P})`), 'the payload is not present raw');
    ok(r.md.includes('\\!\\[s\\](https://attacker.example/p.png)'), 'it is present as text: escaped, so the reader sees what the household typed');
    const detail = section(r.md, 'Transaction Detail');
    const row = detail.split('\n').find(l => l.includes('Dollar shop'));
    /* escMdText writes a pipe as &#124;, so every "|" left in a row is a cell edge. */
    eq(row.split('|').length, detail.split('\n').find(l => l.startsWith('| Date')).split('|').length,
      'and the detail row keeps its column count');
    eq(r.json.transactions.find(t => t.description === 'Dollar shop').currency, SYM, 'while the JSON sibling keeps the raw symbol: JSON is not markdown');

    /* The ordinary dollar household is untouched: a trailing "$" stays "$". */
    const plain = await run(SEED, { detail: 'detail' });
    ok(/\$ 1[\s ]000/.test(plain.md), 'a plain "$" symbol prints as it always did');
    ok(!plain.md.split('\n').some(l => /held in other currencies/.test(l) && /\\\$/.test(l)), 'with no backslash in front of it');
  }

  /* ---- 5. a multi-period report does not say "this period" ------------------------ */
  {
    /* An uncategorised outflow and a row dated after today make the two
       sentences that used to say "this period" print; detail mode adds the row
       count. Three months: the report spans two periods, and "this period" is
       the one thing it cannot mean. */
    const files = {
      ...SEED,
      [`${B}/Transactions/Cheque/2026-09.md`]: SEED[`${B}/Transactions/Cheque/2026-09.md`]
        + '| 2026-09-02 | Mystery | | -50.00 |  |  |  |\n| 2026-09-20 | Debit order | Groceries | -777.00 |  |  |  |\n',
    };
    const r = await run(files, { detail: 'detail' }, '3m');
    eq(r.json.period_count, 2, 'fixture: two periods');
    ok(/uncategorised and does not appear/.test(r.md), 'fixture: the uncategorised sentence printed');
    ok(/dated after today/.test(r.md), 'fixture: the scheduled sentence printed');
    ok(/transactions? in this report/.test(r.md), 'fixture: the row count printed');
    ok(!/this period/i.test(r.md), `no "this period" in a two-period report — ${(r.md.match(/.{40}this period.{20}/i) || [''])[0]}`);
    const empty = await run({ ...SEED, [`${B}/Transactions/Cheque/2026-09.md`]: HEAD, [`${B}/Transactions/Cheque/2026-08.md`]: HEAD, [`${B}/Transactions/Emergency fund/2026-09.md`]: HEAD, [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n' }, {}, '3m');
    ok(/No spending recorded in this report/.test(empty.md) && /No budget or spending recorded in this report/.test(empty.md), 'fixture: the "nothing recorded" sentences printed');
    ok(!/this period/i.test(empty.md), 'and they do not say "this period" either');
  }

  /* ---- 4. cents in the JSON ---------------------------------------------------------------- */
  {
    const f = 0.1 + 0.2;   // 0.30000000000000004
    const money = f;
    const data = {
      generated: 'g', periodLabel: 'p', rangeNote: 'r', detail: 'detail', periodCount: 2, currency: 'R',
      income: money, spend: money, net: money, budgetIncome: money, budgetSpend: money, uncountedIncome: 0,
      budgetUsed: { spend: money, setAside: money, assumed: money, budgeted: money, moved: money, setAsidePlanned: money },
      categories: [{ cat: 'A', type: 'expense', budget: money, actual: money }],
      spendByCategory: [{ cat: 'A', amount: money }],
      categoryGap: { uncat: money, netted: money },
      fundedFromSavings: { spend: money, count: 1 }, scheduled: { income: money, spend: money, count: 1 },
      savings: { growth: money, rateGrowth: money, rateCapital: 100, measured: 1, unmeasured: 0, negCapital: 0, total: 1 },
      debts: { count: 1, active: 1, total: money, perMonth: money, interest: money, coverage: { shown: 1, total: 1, missing: 0 },
        rows: [{ name: 'D', balance: money, rate: 10, interest: money }], foreign: { count: 0, others: [] } },
      netWorth: { net: money, assets: money, liabilities: money, stale: { count: 1, total: 1, oldestDays: 3, movedSince: money, foreignAccounts: 0, undatedRows: 0 } },
      otherCurrencies: [['€', money]],
      health: { score: 50, months: 3, target: 6, savingsRatePct: 10, interestSharePct: 5, countedPeriods: 1, otherCurrencies: [{ symbol: '€', amount: money }], worthOther: [] },
      transactions: [{ date: '2026-09-01', desc: 'x', label: 'Cheque', cat: 'A', amount: money, excluded: false, note: '', split: '', currency: 'R' }],
    };
    const text = report.financialReportJson(data);
    /* Percentages are not money: rate_pct is a ratio of two of the figures, and
       this fixture makes it 0.3 on purpose-built float residue. */
    const bad = [...text.matchAll(/"([a-z_]+)": (-?\d+\.\d{3,})/g)].filter(m => !/_pct$/.test(m[1])).map(m => `${m[1]}=${m[2]}`);
    eq(bad, [], `no money field carries more than cents — ${bad.slice(0, 4).join(', ')}`);
    const j = JSON.parse(text);
    eq([j.income_vs_spend.income, j.income_vs_spend.net, j.net_worth.net], [0.3, 0.3, 0.3], 'the headline figures are 0.3, not 0.30000000000000004');
    eq(j.budgets_vs_actuals[0].remaining, 0, 'a derived remaining is rounded too');
  }

  console.log(`PASS report-figures-print-like-the-app (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
