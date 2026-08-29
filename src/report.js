'use strict';
/* Financial report — one Markdown note a reader can hand to an advisor or
   paste into an AI chat, and optionally one JSON file alongside it for
   feeding a tool that would rather parse than read, built from figures the
   app has already computed somewhere else.

   Still no PDF, no HTML — the same trade exporter.js already made and argues
   in its own header, for the same reason: Markdown renders in Obsidian, the
   iOS share sheet hands it to anything, and desktop Obsidian's own Export to
   PDF already covers the polished-document case. A second PDF library for
   this one feature would be the identical 85% bundle increase exporter.js
   was refused for in 1.4.0. JSON is a different trade: it costs nothing to
   generate (JSON.stringify, already in the runtime) and is not a rendering
   format at all, so none of that argument applies to it.

   ONE DATA OBJECT, TWO SERIALISERS — never two computations. Both
   financialReportMarkdown() and financialReportJson() below read the exact
   same `data` argument; the JSON path RESHAPES it into named sections and
   `JSON.stringify`s the result, it does not re-derive a single figure. See
   the next paragraph for why that discipline is the whole point.

   THIS MODULE OWNS THE WORDS, NOT THE ARITHMETIC. Every number handed to
   financialReportMarkdown()/financialReportJson() below has already been
   computed by the same function the screen that shows it calls —
   views/report.js assembles `data` off ctx.periodSummary, ctx.budgetTotals,
   dashboard.js's budgetVsActualRows/categorySpendRows, worth(),
   totalReturn(), debt-math.js's monthlyInterest() and
   ctx.healthSnapshot(). This module never sums a transaction, a balance or a
   category itself — see CLAUDE.md's note that "two figures derived by
   different rules" is this codebase's most-repeated bug shape (four
   occurrences before this file existed). A report that disagreed with the
   Dashboard it was generated from, OR whose own Markdown and JSON disagreed
   with EACH OTHER, would be exactly that shape again, in the one document
   meant to be trusted enough to leave the app.

   Pure — no DOM, no obsidian import, no vault access — so tests/report.test
   drives it in bare node, the same contract exporter.js documents for
   itself. `money` is injected into the Markdown path for the same reason it
   is there: it is the household's own locale-aware formatter, not something
   a pure module can know. The JSON path takes no `money` — "formatting is
   the reader's job in JSON" is the brief that shaped it, so every number in
   it is the raw one `data` already carries, alongside the currency CODE
   (`data.currency`, e.g. "R") so a reader who parses it still knows what the
   numbers mean. i18n IS required directly for the Markdown path, unlike
   exporter.js's English-only markdown — the brief for this feature asks for
   a report generated in the reader's own language, and src/i18n.js is
   itself pure (no DOM, no obsidian import), so requiring it here costs
   nothing bare node cannot pay. JSON carries no translated prose at all —
   its keys are a stable schema for a machine reader, not English sentences
   for a human one, and translating THOSE would break the one thing a
   schema promises: the same key name every time. */

const { escMd } = require('./markdown');
const { safeName, txHeaderLines, transactionRow } = require('./exporter');
const { sharePercents } = require('./share-percents');
/* splitRole only, for the JSON transaction rows — same reason exporter.js
   reads it instead of a raw r.split test: see src/tx-role.js's own header
   and exporter.js's "3b" test for the parent/transfer distinction a plain
   Excluded flag can never make on its own. */
const { splitRole } = require('./tx-role');
const i18n = require('./i18n');

/* Where a report lands. Its own folder for the same reason Exports/ is its
   own folder in exporter.js: a generated note is never mistaken for one of
   the vault's own data files, and deleting the lot is one action. Also kept
   OUT of load.js's allow-list of folders it reads (Categories/, Accounts/,
   Budgets/, Plans/, Tax/, Transactions/, Notes/) — a report note (or a
   report's .json sibling) is never parsed back in, so nothing here needs to
   guard against the vault watcher trying to. The .json file has a second,
   independent reason to be invisible to the loader: io.js's own
   mdFilesIn()/mdFilesUnder() filter on `extension === 'md'` before they ever
   look at which folder a file sits in, so a .json path could not join
   load.js's managed set even if it were dropped straight into Transactions/. */
const REPORT_DIR = 'Reports';

/* Named by WHAT SPAN IT COVERS, not by when it was generated — same
   reasoning as exportPaths(): re-generating the same selection overwrites
   the earlier file(s), which is what a reader who fixed a category and asked
   for a fresh report expects, rather than a folder accumulating a dated copy
   every time the button is pressed. `label` is caller-built (views/report.js
   turns the chosen period(s) into e.g. "2026-08" or "2026-06 to 2026-08")
   because only the view layer knows which period shape (payday month vs
   interval) it is naming — this module only sanitises and joins. `mdPath`
   and `jsonPath` are ALWAYS both returned (not gated on which formats the
   reader picked) — a plain path computation costs nothing, and views/report.js
   is where "which of these two do I actually write" belongs, the same way it
   already owns every other reader-facing choice on this page.

   Each path SEGMENT of `folder` is sanitised rather than the whole string,
   so a nested destination survives while a traversal segment cannot — the
   identical two-ring shape exportPaths() documents (safeName defuses the
   segment here, io.js's guardedVaultPath refuses anything that still
   resolves outside the vault on the write). */
function reportPaths(label, folder) {
  const dir = String(folder || REPORT_DIR).split('/')
    .filter(seg => seg.trim() && !/^\.+$/.test(seg.trim()))
    .map(safeName).join('/') || REPORT_DIR;
  const base = `${dir}/${safeName(label)} Financial Report`;
  return { dir, mdPath: `${base}.md`, jsonPath: `${base}.json` };
}

/* Add one category field across several periods' worth of rows, where each
   period's own row list already came from the SAME per-period function
   (dashboard.js's budgetVsActualRows or categorySpendRows) — this never
   re-derives what belongs to a category or which sign a row carries, only
   sums what is already there. `type` is kept from whichever period first
   named the category, since a category's type does not change between
   periods (it lives on the category's own file, not on a budget row).

   Why this belongs here rather than in views/report.js: it is exercised by
   tests/report.test.cjs in bare node, and view modules cannot be required
   there (they pull in `obsidian`) — the same reason exportPaths/safeName
   live in a pure module instead of inside views/transactions.js. */
function mergeCategoryRows(periodRows, fields) {
  const byCat = new Map();
  for (const rows of periodRows || []) {
    for (const r of rows || []) {
      const cur = byCat.get(r.cat) || { cat: r.cat, type: r.type };
      for (const f of fields) cur[f] = (cur[f] || 0) + (r[f] || 0);
      byCat.set(r.cat, cur);
    }
  }
  return [...byCat.values()];
}

/* One row of the two two-column money tables below (Income vs Spend,
   Savings). `label` is already-translated text; `value` is a formatted
   money string. Kept this small rather than a generic table builder because
   a two-column key/value table and an N-column data table read differently
   in Markdown and gain nothing from sharing one function. */
function kvTable(rows) {
  const out = ['', '|  |  |', '|---|---:|'];
  for (const [label, value] of rows) out.push(`| ${escMd(label)} | ${value} |`);
  return out;
}

/* Budget vs Actual — one row per category, in the order the caller already
   sorted them (views/report.js hands over dashboard.js's own
   budgetVsActualRows() output, merged across periods where the report spans
   more than one — see that module's own header for why a merge across
   periods is safe: it sums two totals under the same rule per period rather
   than re-deriving the rule itself).

   THE TYPE COLUMN — H1 in the 2026-08-29 audit. `renderBudgetTable`
   (views/dashboard.js) groups income/expense/transfer/custom-group rows
   under a type header and sorts by typeRank; this table used to throw that
   away with an alphabetical re-sort and no type at all, so an income row
   that beat its budget by R5,000 rendered `Remaining: R -5000.00` —
   indistinguishable from an overspend — and a transfer budget row (whose
   `actual` is always 0 by design, see budgetVsActualRows's own header on why
   a transfer never accumulates one) read as a category nothing was spent on.
   `rows` is now handed over ALREADY sorted by typeRank (views/report.js
   builds that order the same way dashboard.js does, off the same
   S.settings.groups), so this only has to print the type it was given — the
   JSON path already carried `type` per row; this closes the gap between the
   two formats rather than opening a second copy of the sort rule.

   `unbudgeted` mirrors renderBudgetTable's own test (views/dashboard.js) —
   spending in a category nobody budgeted for is over budget by the whole
   amount, and a blank Remaining cell there reads as "nothing to report",
   which dashboard.js's own comment on this exact line calls out as the
   opposite of the truth. Missing `!r.assumed` on purpose: an assumed-spend
   row always carries r.budget > 0 (it is seeded FROM the budget amount — see
   budgetVsActualRows), so it can never satisfy `!r.budget` and never needs
   the exclusion dashboard.js applies for the same reason. */
function budgetTable(rows, money) {
  const out = ['', `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.type')} | ${i18n.t('report.col.budget')} | ${i18n.t('report.col.actual')} | ${i18n.t('report.col.remaining')} |`,
    '|---|---|---:|---:|---:|'];
  for (const r of rows) {
    const remaining = r.budget - r.actual;
    const unbudgeted = r.type !== 'income' && !r.budget && r.actual > 0;
    out.push(`| ${escMd(r.cat)} | ${escMd(r.type || '')} | ${r.budget ? money(r.budget) : '—'} | ${money(r.actual)} | ${(r.budget || unbudgeted) ? money(remaining) : ''} |`);
  }
  return out;
}

/* Spend by category — amounts already sorted biggest-first by the caller
   (dashboard.js's categorySpendRows, merged across periods the same way
   budgetTable's rows are). Percentages come from share-percents.js's
   largest-remainder allocation, the SAME function the Dashboard's own donut
   uses for its legend column, so a reader comparing "32%" here against the
   donut on screen is comparing the same number, not two independent
   roundings of it (share-percents.js's own header documents why an
   independent Math.round() per row does not sum to 100).

   `orphaned` — C2 in the 2026-08-29 audit. A category name no `Categories/`
   file answers to gets a "Missing categories" tile on the Dashboard
   (views/dashboard.js's own comment on `sum.unknown` explains why: it is
   never counted as income and its sign can't be trusted) but used to print
   here as an ordinary slice with nothing marking it unrecognised. Each row
   already carries the flag (views/report.js sets it with the same
   `catKnown()` predicate period.js and dashboard.js both read), so this only
   has to say so — a trailing `*` on the row, and financialReportMarkdown
   prints the names it belongs to once, below the table. */
function categoryTable(rows, money) {
  const shares = sharePercents(rows.map(r => r.amount));
  const out = ['', `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.amount')} | ${i18n.t('report.col.percent')} |`,
    '|---|---:|---:|'];
  rows.forEach((r, i) => out.push(`| ${escMd(r.cat)}${r.orphaned ? ' *' : ''} | ${money(r.amount)} | ${shares[i]}% |`));
  return out;
}

function debtTable(rows, money) {
  const out = ['', `| ${i18n.t('report.col.debt')} | ${i18n.t('report.col.balance')} | ${i18n.t('report.col.rate')} | ${i18n.t('report.col.interest')} |`,
    '|---|---:|---:|---:|'];
  for (const d of rows) out.push(`| ${escMd(d.name)} | ${money(d.balance)} | ${d.rate ? `${d.rate}%` : '—'} | ${money(d.interest)} |`);
  return out;
}

/* `data` — everything this module needs, already computed by the caller
   (views/report.js). See that module for exactly which ctx helper and which
   math module built each field; this header only names the shape.

   {
     generated: 'YYYY-MM-DD HH:MM',
     periodLabel: string,              // heading, e.g. "August 2026"
     rangeNote: string,                // exact date span, e.g. "23 Jul – 22 Aug 2026"
     detail: 'summary' | 'detail',
     income, spend, net: number,       // periodSummary(), summed across the selection
     budgetIncome, budgetSpend: number,// budgetTotals(), summed the same way
     categories: [{ cat, budget, actual, type }],   // budgetVsActualRows(), merged,
                                                     // typeRank-sorted (see budgetTable)
     spendByCategory: [{ cat, amount, orphaned }],  // categorySpendRows(), merged;
                                                     // orphaned = !catKnown(cat)
     categoryGap: { uncat, netted },   // C2 — the SAME gap views/dashboard.js's own
                                        // donut discloses beside itself (sum.spend
                                        // minus what the category rows account for,
                                        // split into "uncategorised" and "netted off
                                        // inside a category"), summed per period the
                                        // same additive way every other figure above
                                        // is merged across the selection
     savings: null | { growth, rateGrowth, rateCapital, measured, unmeasured, total },
     debts: null | { count, active, total, perMonth, interest, rows: [{name,balance,rate,interest}] },
     netWorth: { net, assets, liabilities },
     health: null | { score, band, months, target, savingsRatePct, interestSharePct },
     transactions: null | rows[],      // detail mode only, exporter.js row shape
   }

   `money` is the household's own formatter, injected for the reason given in
   the file header. */
function financialReportMarkdown(data, money) {
  const {
    generated, periodLabel, rangeNote, detail,
    income, spend, net, budgetIncome, budgetSpend,
    categories, spendByCategory, categoryGap, savings, debts, netWorth, health, transactions,
  } = data;

  const out = [
    '---',
    'generated: ' + generated,
    'period: ' + JSON.stringify(String(periodLabel)),
    'detail: ' + detail,
    '---',
    '',
    `# ${i18n.t('report.title', { period: periodLabel })}`,
    '',
    i18n.t('report.generatedLine', { date: generated }),
    '',
    /* The one sentence CLAUDE.md's own house style asks every export to
       carry — see exporter.js's own "EXCLUDED ROWS ARE EXPORTED" note. A
       report a reader forwards to someone who has never opened the app has
       no other way to learn that a figure here is not simply "every
       transaction added up". */
    i18n.t('report.rule'),
  ];

  /* --------------------------- income & spend --------------------------- */
  out.push('', `## ${i18n.t('report.section.incomeSpend')}`, `_${rangeNote}_`,
    ...kvTable([
      [i18n.t('report.col.income'), money(income)],
      [i18n.t('report.col.spend'), money(spend)],
      [i18n.t('report.col.net'), money(net)],
      [i18n.t('report.col.budgetIncome'), money(budgetIncome)],
      [i18n.t('report.col.budgetSpend'), money(budgetSpend)],
    ]));

  /* ------------------------- spend by category ---------------------------
     C2 in the 2026-08-29 audit: this section used to run sharePercents() over
     whatever rows it was handed and call the result "100%", even on a period
     where R900 of R2,400 spend never appeared in any row — the same gap the
     Dashboard's own donut has always disclosed beside itself (that comment,
     views/dashboard.js:1698 on, is the fuller account of why leaving it
     unsaid reads as a chart that stopped updating). The two sentences below
     print whenever there is a gap to explain, table or no table — a period
     that is ENTIRELY uncategorised spend has NO rows here (spendByCategory
     only ever holds recognised, non-transfer, non-income categories), so
     "No spending recorded" would be a straight lie about a period that in
     fact spent every rand; skip that line rather than print it under a
     figure disclosing the opposite. */
  const gapStated = categoryGap && (categoryGap.uncat >= 1 || categoryGap.netted >= 1);
  out.push('', `## ${i18n.t('report.section.category')}`);
  if (spendByCategory.length) out.push(...categoryTable(spendByCategory, money));
  else if (!gapStated) out.push('', i18n.t('report.category.empty'));
  if (gapStated) {
    if (categoryGap.uncat >= 1) out.push('', i18n.t('report.category.uncat', { amount: money(categoryGap.uncat) }));
    if (categoryGap.netted >= 1) out.push('', i18n.t('report.category.netted', { amount: money(categoryGap.netted) }));
  }
  const orphanedNames = spendByCategory.filter(r => r.orphaned).map(r => escMd(r.cat));
  if (orphanedNames.length) out.push('', i18n.t('report.category.orphaned', { names: orphanedNames.join(', ') }));

  /* -------------------------- budget vs actual --------------------------- */
  out.push('', `## ${i18n.t('report.section.budgetActual')}`);
  if (categories.length) out.push(...budgetTable(categories, money));
  else out.push('', i18n.t('report.budget.empty'));

  /* --------------------- savings & investment growth ---------------------
     NOT scoped to the chosen period — growth is measured from an account's
     own inception, the same way views/savings.js's own growthTile() reads
     it, so this section is "as of today" whatever period the reader picked
     for the sections above. Said explicitly rather than left for the reader
     to notice the two disagree about what "as of" means. */
  out.push('', `## ${i18n.t('report.section.savings')}`, i18n.t('report.asOf'));
  if (!savings || !savings.total) {
    out.push('', i18n.t('report.savings.none'));
  } else if (!savings.measured) {
    out.push('', i18n.t('report.savings.unmeasured'));
  } else {
    const rate = savings.rateCapital > 0 ? (savings.rateGrowth / savings.rateCapital) * 100 : null;
    out.push(...kvTable([
      [i18n.t('report.savings.growth'), money(savings.growth)],
      ...(rate !== null ? [[i18n.t('report.savings.rate'), `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`]] : []),
    ]));
    if (savings.unmeasured) out.push('', i18n.t('report.savings.partial', { count: savings.unmeasured, total: savings.total }));
  }

  /* ------------------------------- debt -----------------------------------
     Also present-tense — see the savings section's own note, same reasoning:
     a debt book is not paged by budget period any more than an account
     balance is. */
  out.push('', `## ${i18n.t('report.section.debt')}`, i18n.t('report.asOf'));
  if (!debts || !debts.count) {
    out.push('', i18n.t('report.debt.none'));
  } else if (!debts.active) {
    out.push('', i18n.t('report.debt.free', { count: debts.count }));
  } else {
    out.push(...kvTable([
      [i18n.t('report.debt.total'), money(debts.total)],
      [i18n.t('report.debt.perMonth'), money(debts.perMonth)],
      [i18n.t('report.debt.interest'), money(debts.interest)],
    ]), ...debtTable(debts.rows, money));
  }

  /* ------------------------------ net worth -------------------------------- */
  out.push('', `## ${i18n.t('report.section.netWorth')}`, i18n.t('report.asOf'),
    ...kvTable([
      [i18n.t('report.col.netWorth'), money(netWorth.net)],
      [i18n.t('report.col.owned'), money(netWorth.assets)],
      [i18n.t('report.col.owed'), money(netWorth.liabilities)],
    ]));

  /* --------------------------- financial health ---------------------------
     Only when healthSnapshot() itself has something honest to say — the same
     gate the Dashboard's own health card uses (snap.empty), so a vault too
     new to measure gets no section rather than a page of dashes. */
  if (health) {
    out.push('', `## ${i18n.t('report.section.health')}`, i18n.t('report.asOf'));
    const rows = [[i18n.t('report.health.score'), health.score !== null ? String(health.score) : '—']];
    if (health.months !== null) rows.push([i18n.t('report.health.months'), `${health.months.toFixed(1)} / ${health.target}`]);
    if (health.savingsRatePct !== null) rows.push([i18n.t('report.health.savingsRate'), `${Math.round(health.savingsRatePct)}%`]);
    if (health.interestSharePct !== null) rows.push([i18n.t('report.health.interestShare'), `${Math.round(health.interestSharePct)}%`]);
    out.push(...kvTable(rows));
  }

  /* --------------------------- transaction detail --------------------------
     Only in detail mode, and every row that composed the totals above —
     EXCLUDED ROWS ARE INCLUDED, marked, for the same reason exporter.js
     includes them in its own export: this document must not disagree with
     the app it came from about which rows exist, only about which of them
     were counted. Same column order, same row template as exporter.js's own
     CSV/Markdown export (txHeaderLines/transactionRow), not a second copy of
     either. */
  if (detail === 'detail' && transactions) {
    out.push('', `## ${i18n.t('report.section.transactions')}`,
      i18n.t('report.transactions.count', { count: transactions.length }),
      ...txHeaderLines());
    for (const r of transactions) out.push(transactionRow(r, money));
  }

  return out.join('\n') + '\n';
}

/* The Markdown that reaches a clipboard starts at the H1, not at the
   frontmatter above it — "no leading junk" is the brief's own words for
   views/report.js's Copy affordance. The FILE on disk keeps its
   frontmatter, same as every other markdown export in this app (see
   exporter.js); only the COPY is trimmed, because a paste into a chat or an
   email is not a vault note and has no use for `generated:`/`period:` YAML
   sitting above the words a human is meant to read first. Pure string work,
   so it lives here rather than in the view — the same "if it can be pure,
   it is" rule as everything else in this module. */
function copyBody(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
}

/* One transaction row, RAW — the JSON sibling of exporter.js's own
   transactionRow()/transactionsCsv() shape (Date, Description, Account,
   Category, Amount, Excluded, Note, Split), field-named instead of
   column-ordered because a JSON consumer addresses by key, not position.
   Amount is the parsed number (same one transactionRow's `money(r.amount)`
   formats and transactionsCsv's amountCell() already argues for) — never
   r.amountRaw, for the identical reason exporter.js gives: a spreadsheet or
   a script summing this column needs a real number, and amountRaw is the
   loader's "could not strictly parse this cell" flag, not a value meant for
   arithmetic. */
function jsonTransactionRow(r) {
  return {
    date: r.date, description: r.desc, account: r.label, category: r.cat || '',
    amount: Number(r.amount || 0), excluded: !!r.excluded, note: r.note || '',
    split: splitRole(r.split),
  };
}

/* The JSON sibling of financialReportMarkdown() — same `data`, reshaped into
   named sections and stringified, never re-derived. See this file's own
   header for why that discipline is the whole point of splitting the two
   this way instead of, say, building the JSON by walking the Markdown back
   apart. `loans` is deliberately ABSENT rather than a null placeholder:
   views/loans.js is a what-if scratchpad with nothing persisted behind it
   (see that file's own header), so there is no household data a "loans"
   section could ever hold — inventing one that is always null would be a
   schema promising a fact this app never has. Two spaces, human-openable —
   the brief's own words for it — not minified: this file is meant to be
   read by a person debugging an AI's answer as often as it is parsed by
   the AI itself. */
function financialReportJson(data) {
  const {
    generated, periodLabel, rangeNote, detail, currency,
    income, spend, net, budgetIncome, budgetSpend,
    categories, spendByCategory, categoryGap, savings, debts, netWorth, health, transactions,
  } = data;

  const shape = {
    generated,
    period: periodLabel,
    range: rangeNote,
    detail,
    currency: currency || '',
    income_vs_spend: {
      income, spend, net,
      budget_income: budgetIncome, budget_spend: budgetSpend,
    },
    /* `orphaned` and `category_gap` are C2's fix — see categoryTable's own
       header in this file, and financialReportMarkdown's identical branch:
       the JSON reader gets the SAME two facts the Markdown prose states, not
       a table that quietly sums to less than income_vs_spend.spend with no
       field anywhere explaining why. */
    categories: spendByCategory.map(r => ({ category: r.cat, amount: r.amount, orphaned: !!r.orphaned })),
    category_gap: {
      uncategorised: (categoryGap && categoryGap.uncat) || 0,
      netted: (categoryGap && categoryGap.netted) || 0,
    },
    budgets_vs_actuals: categories.map(r => ({
      category: r.cat, type: r.type || null, budget: r.budget, actual: r.actual, remaining: r.budget - r.actual,
    })),
    savings: (savings && savings.total)
      ? {
        growth: savings.growth,
        rate_growth: savings.rateGrowth,
        rate_capital: savings.rateCapital,
        measured: savings.measured,
        unmeasured: savings.unmeasured,
        total: savings.total,
      }
      : null,
    debts: (debts && debts.count)
      ? {
        count: debts.count, active: debts.active, total: debts.total,
        per_month: debts.perMonth, interest: debts.interest,
        rows: debts.rows.map(d => ({ name: d.name, balance: d.balance, rate: d.rate, interest: d.interest })),
      }
      : null,
    net_worth: { net: netWorth.net, assets: netWorth.assets, liabilities: netWorth.liabilities },
    health_score: health
      ? {
        score: health.score, months: health.months, target_months: health.target,
        savings_rate_pct: health.savingsRatePct, interest_share_pct: health.interestSharePct,
      }
      : null,
    transactions: (detail === 'detail' && transactions) ? transactions.map(jsonTransactionRow) : null,
  };
  return JSON.stringify(shape, null, 2) + '\n';
}

module.exports = { REPORT_DIR, reportPaths, mergeCategoryRows, financialReportMarkdown, financialReportJson, copyBody };
