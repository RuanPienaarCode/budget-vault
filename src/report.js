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
   nothing bare node cannot pay. JSON's KEYS carry no translated prose — they
   are a stable schema for a machine reader, not English sentences for a
   human one, and translating THOSE would break the one thing a schema
   promises: the same key name every time. Two VALUES are a deliberate,
   narrow exception (P2, 2026-08-29 audit): `disclaimer` and
   `health_score.note` are translated sentences, not raw data, because the
   whole reason they exist is to be read by whoever opens this file — a
   person debugging an AI's answer, or the AI itself reading in the
   household's own language — the same audience the file header two
   paragraphs up already names for the two-space formatting choice. A
   machine parsing `health_score.score` never looks at `.note`; a human or
   an AI answering one does, and is exactly who these two fields are for. */

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
   load.js's managed set even if it were dropped straight into Transactions/.

   That paragraph was only ever true of THIS default — M1, 2026-08-29 audit:
   the destination is a free-text field views/report.js hands to reportPaths()
   below, and nothing refused a reader pointing it AT one of those managed
   folders instead of away from them. managedFolderMatch() further down is
   the fix; REPORT_DIR here is unaffected, since it is not one of the seven
   managed names. */
const REPORT_DIR = 'Reports';

/* M1, 2026-08-29 audit — the folder field above (`folder` in views/report.js)
   is free text with no relationship to the folders load.js actually parses:
   Categories/, Accounts/, Budgets/, Plans/, Tax/, Transactions/, Notes/, each
   read off the SAME budget-relative root basePath() names — see load.js's
   own mdFilesIn/mdFilesUnder call sites for each. Point the field at
   `<budget folder>/Categories` and the very next Create writes a note that
   the next vault load parses back in as an ordinary category: it joins every
   category picker, the donut and budgetVsActualRows, silently — the exact
   opposite of this file's own header claim that a report is "kept OUT of
   load.js's allow-list", which is only true of the DEFAULT folder.

   MANAGED_SUBFOLDERS lists every folder name load.js reads FILES from off
   basePath() (not Notes/'s own NOTES_DIR constant, deliberately duplicated
   as a literal — importing note-file.js here for one string would be an odd
   dependency for a module that otherwise touches nothing else in this app).
   Deliberately BLUNT rather than precise: mdFilesIn() only reads one level
   for Categories/Accounts/Plans, and Budgets/Tax additionally filter by
   filename shape (a period or a year), so a report's own "<label> Financial
   Report.md" name would in fact miss some of these today — but a
   filename-shape argument for why THIS particular destination happens to be
   safe is exactly the kind of reasoning the next load.js edit could quietly
   invalidate without anyone remembering to revisit this guard. Refusing the
   whole named folder, at any depth, costs the reader one folder name they
   are unlikely to want anyway. */
const MANAGED_SUBFOLDERS = ['Categories', 'Accounts', 'Budgets', 'Plans', 'Tax', 'Transactions', 'Notes'];

/* L1, 2026-08-29 audit (Phase 4b) — a deliberate, small copy of
   views/dashboard.js's own SPLIT_SLICES, kept here ONLY to decide whether
   the in-document percent caveat prints (see categoryTable's own header
   above and financialReportMarkdown's `report.category.percentNote`
   comment) — never used for anything arithmetic, so a drift between the two
   constants would at worst mis-time a caveat, not mis-state a figure. Not
   imported from dashboard.js: that file is a DOM view (requires 'obsidian'
   transitively through chart.js), and this module's whole contract is
   running pure in bare node — see the file header. */
const REPORT_SPLIT_SLICES = 8;

function pathSegs(p) {
  return String(p || '').split('/').map(s => s.trim()).filter(Boolean);
}

/* Does `dir` (a report destination, already through reportPaths()'
   sanitisation) resolve INSIDE `budgetFolder` at one of the managed names
   above? Returns the matched name ('Categories', …) or null, rather than a
   bare boolean — the caller needs the name to say WHICH folder it refused,
   both in the on-page warning shown before the click and in the error
   createReport() throws if it is reached anyway. Segment-by-segment, the
   same shape io.js's own guardedPath uses to refuse a write escaping the
   budget folder the OTHER direction (out, not in) — string prefix comparison
   alone would wrongly catch "Budget/CategoriesOfSpending" as "Budget/Categories". */
function managedFolderMatch(dir, budgetFolder) {
  const dirSegs = pathSegs(dir);
  const baseSegs = pathSegs(budgetFolder);
  if (dirSegs.length <= baseSegs.length) return null;
  for (let i = 0; i < baseSegs.length; i++) {
    if (dirSegs[i] !== baseSegs[i]) return null;
  }
  const name = dirSegs[baseSegs.length];
  return MANAGED_SUBFOLDERS.includes(name) ? name : null;
}

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
/* "Plus € 100 000 held in other currencies, not converted." — the sentence
   this document uses to name money a figure could not include: the Net Worth
   total's held-out accounts, assets and debts (merged per symbol by
   worth.js's otherCurrencyNet), and, under Debt, that section's own foreign
   balances.

   One function, two KEYS. The first version used acct.hero.otherCurrencies
   at both sites on the argument that the two caveats should read
   identically — and under the Debt heading that printed "Plus € 100 000 HELD
   in other currencies" about money the household OWES. An advisor reading
   the forwarded report reads "held" as an asset; the figure was right and
   the verb inverted its sign. So the Debt site passes report.debt.
   otherCurrencies ("owed in other currencies"), and the Net Worth site keeps
   the hero's wording, where "held" is what a net position is. Rounded to
   whole units the way views/accounts.js's hero prints it: this is a "there
   is also this much, elsewhere, in another unit" figure, and cents would
   imply a precision the absence of a rate makes meaningless. Empty string
   for an empty list, so the caller's `if` is the only gate. */
function currencyLine(pairs, key = 'acct.hero.otherCurrencies') {
  return (pairs || []).length
    ? i18n.t(key, {
      list: pairs.map(([sym, v]) => `${sym} ${Math.round(v)}`).join(' · '),
    }).trim()
    : '';
}

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
   the exclusion dashboard.js applies for the same reason.

   `orphaned` — R5, 2026-08-29 audit. Same signal categoryTable's own
   `orphaned` already used for "Spend by Category" (a category name no
   current Categories/ file answers to), now applied here too: this table
   used to carry no such marker at all, so a category renamed mid-selection
   (its OLD name still sitting in an earlier period's own budget/transaction
   rows, unknown to any current Categories/ file) rendered as an ordinary,
   unmarked row here even though the identical fact was already flagged one
   section up. Marked the SAME way (`*`), for the SAME reason mergeCategoryRows'
   own header gives for not attempting a real merge across a rename: a
   category is its current name, nothing this app writes remembers what it
   used to be called, and a merge built on a guess would be exactly the kind
   of silent, plausible-looking wrong number this codebase's house rule
   refuses. See financialReportMarkdown's own R5 comment for the caveat this
   marker feeds. */
function budgetTable(rows, money) {
  const out = ['', `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.type')} | ${i18n.t('report.col.budget')} | ${i18n.t('report.col.actual')} | ${i18n.t('report.col.remaining')} |`,
    '|---|---|---:|---:|---:|'];
  for (const r of rows) {
    const remaining = r.budget - r.actual;
    const unbudgeted = r.type !== 'income' && !r.budget && r.actual > 0;
    out.push(`| ${escMd(r.cat)}${r.orphaned ? ' *' : ''} | ${escMd(r.type || '')} | ${r.budget ? money(r.budget) : '—'} | ${money(r.actual)} | ${(r.budget || unbudgeted) ? money(remaining) : ''} |`);
  }
  return out;
}

/* Spend by category — amounts already sorted biggest-first by the caller
   (dashboard.js's categorySpendRows, merged across periods the same way
   budgetTable's rows are). Percentages come from share-percents.js's
   largest-remainder allocation, the SAME function the Dashboard's own donut
   uses for its legend column — so the ROUNDING is never the reason the two
   disagree (share-percents.js's own header documents why an independent
   Math.round() per row does not sum to 100).

   L1, 2026-08-29 audit (Phase 4b) — that is NOT the same claim as "this
   column always equals the donut's own %", and an earlier version of this
   comment said so anyway. It only holds up to SPLIT_SLICES (=8,
   views/dashboard.js) spend categories: past that, the Dashboard collapses
   the tail into one "Other (N)" wedge and runs sharePercents() over THAT
   COLLAPSED list, so the largest-remainder allocation runs over a different
   set of numbers than this table's — a full, uncollapsed list, deliberately
   (a report is meant to be complete; collapsing it into an "Other" bucket
   the way a seven-inch donut has to would throw away exactly the detail a
   report exists to keep). Duplicating SPLIT_SLICES here to gate an
   in-document caveat is a small, deliberate copy of a magic number rather
   than importing views/dashboard.js (a DOM view) into this pure module for
   one constant — the same trade-off periodsFromAnchor() in views/report.js
   already accepts, and named the same way there. See
   financialReportMarkdown's own comment on `report.category.percentNote`
   for where that caveat actually prints.

   `orphaned` — C2 in the 2026-08-29 audit. A category name no `Categories/`
   file answers to gets a "Missing categories" tile on the Dashboard
   (views/dashboard.js's own comment on `sum.unknown` explains why: it is
   never counted as income and its sign can't be trusted) but used to print
   here as an ordinary slice with nothing marking it unrecognised. Each row
   already carries the flag (views/report.js sets it with the same
   `catKnown()` predicate period.js and dashboard.js both read), so this only
   has to say so — a trailing `*` on the row, and financialReportMarkdown
   prints the names it belongs to once, below the table.

   L4, 2026-08-29 audit — `rows` are expected to already carry `pct`
   (prepareReportData(), below), the SAME largest-remainder share every JSON
   consumer of `categories[].percent` reads too. This function no longer
   calls sharePercents() itself — see prepareReportData's own header for why
   the call moved rather than merely being duplicated a second place. */
function categoryTable(rows, money) {
  const out = ['', `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.amount')} | ${i18n.t('report.col.percent')} |`,
    '|---|---:|---:|'];
  for (const r of rows) out.push(`| ${escMd(r.cat)}${r.orphaned ? ' *' : ''} | ${money(r.amount)} | ${r.pct}% |`);
  return out;
}

function debtTable(rows, money) {
  const out = ['', `| ${i18n.t('report.col.debt')} | ${i18n.t('report.col.balance')} | ${i18n.t('report.col.rate')} | ${i18n.t('report.col.interest')} |`,
    '|---|---:|---:|---:|'];
  /* A row stating no rate prints '—' for its interest, not a formatted zero.
     The section total above this table was taught the difference between "no
     interest" and "interest unknown" in 1.35.0; this table was the same false
     claim one layer down, on a per-debt line where the rate cell RIGHT BESIDE
     IT already prints '—' for the very same missing figure. A reader who sees
     a dash under Rate and R0.00 under Monthly interest is being told the
     second was worked out from the first. */
  for (const d of rows) out.push(`| ${escMd(d.name)} | ${money(d.balance)} | ${d.rate ? `${d.rate}%` : '—'} | ${d.rate ? money(d.interest) : '—'} |`);
  return out;
}

/* L4, 2026-08-29 audit — the ONE place the "%" column (Spend by Category)
   and the savings growth rate are computed, so financialReportMarkdown()
   and financialReportJson() below can never disagree about either: both
   call this, on the SAME `data` a caller handed them, before doing
   anything else. Before this fix each figure was computed exactly once,
   inside financialReportMarkdown() only (categoryTable's own sharePercents()
   call; an inline `rate` expression in the savings section) — JSON never
   saw either, so a consumer who wanted them had no choice but to re-derive
   them, and share-percents.js's own header already documents what plain
   per-row rounding does to a percentage column (it does not sum to 100).
   That is "one object, two serialisers" failing for exactly the two figures
   that were never actually IN the object.

   Pure — reads sharePercents() and a ratio the identical way the code it
   replaced always did, moved rather than re-derived, so every existing
   rendered figure in tests/report.test.cjs stays byte-identical. Called
   from BOTH financialReportMarkdown() and financialReportJson() rather than
   once by the caller (views/report.js's buildReportData()) so a test that
   hand-builds a bare `data` fixture (as tests/report.test.cjs's own DATA
   constant does, never having gone through buildReportData() at all) still
   gets correct, non-`undefined` figures — a defensive normalisation, the
   same shape reportPaths() already sanitises ITS caller's free-text input
   rather than trusting every caller to have done it first. Idempotent and
   side-effect-free (never mutates `data`, only returns a new one), so
   calling it twice — once per serialiser — costs a little arithmetic and
   risks nothing: there is exactly ONE rule here, not two independently
   written ones, which is what "two figures derived by different rules"
   actually means (see this file's own top header). MUST STAY PURE — no
   Date.now(), no randomness, nothing that could make the two calls (one per
   serialiser) disagree with each other. */
function prepareReportData(data) {
  const spendByCategory = data.spendByCategory || [];
  const pct = sharePercents(spendByCategory.map(r => r.amount));
  const savings = data.savings
    ? { ...data.savings, rate: data.savings.rateCapital > 0 ? (data.savings.rateGrowth / data.savings.rateCapital) * 100 : null }
    : data.savings;
  return {
    ...data,
    spendByCategory: spendByCategory.map((r, i) => ({ ...r, pct: pct[i] })),
    savings,
  };
}

/* `data` — everything this module needs, already computed by the caller
   (views/report.js). See that module for exactly which ctx helper and which
   math module built each field; this header only names the shape.

   {
     generated: 'YYYY-MM-DD HH:MM',
     periodLabel: string,              // heading, e.g. "August 2026"
     rangeNote: string,                // exact date span, e.g. "23 Jul – 22 Aug 2026"
     detail: 'summary' | 'detail',
     periodCount: number,              // R5 — how many periods were merged; the rename
                                        // caveat below only ever prints when this is > 1
     income, spend, net: number,       // periodSummary(), summed across the selection
     budgetIncome, budgetSpend: number,// budgetTotals(), summed the same way
     categories: [{ cat, budget, actual, type, orphaned }],  // budgetVsActualRows(),
                                                     // merged, typeRank-sorted (see
                                                     // budgetTable); orphaned = !catKnown(cat)
     spendByCategory: [{ cat, amount, orphaned }],  // categorySpendRows(), merged;
                                                     // orphaned = !catKnown(cat). `pct` is
                                                     // NOT the caller's to supply — see
                                                     // prepareReportData() below, which adds
                                                     // it (L4, 2026-08-29 audit) before either
                                                     // serialiser reads this object.
     categoryGap: { uncat, netted },   // C2 — the SAME gap views/dashboard.js's own
                                        // donut discloses beside itself (sum.spend
                                        // minus what the category rows account for,
                                        // split into "uncategorised" and "netted off
                                        // inside a category"), summed per period the
                                        // same additive way every other figure above
                                        // is merged across the selection
     savings: null | { growth, rateGrowth, rateCapital, measured, unmeasured, negCapital, total },
                                        // `rate` is likewise prepareReportData()'s, not
                                        // the caller's — see its own header (L4).
     debts: null | { count, active, total, perMonth, interest, coverage,
                     rows: [{name,balance,rate,interest}] },
                                        // `interest` is NULL, not 0, when no active debt
                                        // states a rate — health-math.js's rule, and
                                        // `coverage` {shown,total,missing} is how much of
                                        // the book a stated figure actually covers
     netWorth: { net, assets, liabilities },
     health: null | { score, band, months, target, savingsRatePct, interestSharePct },
     transactions: null | rows[],      // detail mode only, exporter.js row shape
   }

   `money` is the household's own formatter, injected for the reason given in
   the file header. */
function financialReportMarkdown(data, money) {
  data = prepareReportData(data);
  const {
    generated, periodLabel, rangeNote, detail, periodCount,
    income, spend, net, budgetIncome, budgetSpend,
    categories, spendByCategory, categoryGap, savings, debts, netWorth, health, transactions,
    otherCurrencies, household, foreign,
  } = data;

  /* ISSUE 28. This document LEAVES the app: it is saved, shared, and read
     later by a person or a parser with none of the on-screen context. The
     house rule is that an exported document carries the caveats its
     on-screen twin prints beside the number — and that rule had been broken
     in the one place it mattered most. The Net Worth section printed a total
     that added unlike currencies, in silence, while BOTH of its screen twins
     disclosed or split it. */
  const otherLine = currencyLine(otherCurrencies);

  /* The three sections whose figures are NARROWED to the household's own
     currency by the same rule their on-screen twins apply, and which said
     nothing about it here.

     `foreignExcluded` reuses the Dashboard hero's own key rather than
     inventing a third wording of one sentence — dash.foreignExcluded is
     already the app's phrase for "N accounts in another currency are not in
     these figures", it is plural-aware in all twelve language tables, and
     both places it is used below are genuinely counting ACCOUNTS: the
     Income & Spend figures come from periodSummary(), which holds foreign
     transaction FOLDERS out, and the Savings figures come from growthTotals()
     over a pool of savings/investment accounts.

     The Debt section deliberately does NOT use it. A debt is not an account,
     and a document that leaves this app to be read by an advisor cannot call
     one the other; it takes currencyLine() instead — the same sentence the
     Net Worth section prints two sections down, which names the amount and
     its symbol rather than a count, and which is true of a liability
     ("held in euro") exactly as it is of an asset. */
  const foreignExcluded = f => (f && f.count
    ? i18n.t('dash.foreignExcluded', { count: f.count, symbols: (f.symbols || []).join(' · ') })
    : '');

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
    '',
    /* P2, 2026-08-29 audit — this document's stated purpose is to be read by
       an advisor or pasted into an AI chat, yet carried no caution at all
       while views/tax.js's own checklist (nothing this app calls "advice")
       does. Placed here, ABOVE every section, not only on the page around
       it — copyBody() only strips the frontmatter (see its own header), so
       this line rides along with every copy that leaves the app the same
       way report.rule does. */
    i18n.t('report.disclaimer'),
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
  /* period.js's periodSummary() returns `foreign` WITH the figures rather
     than beside them, and says in its own comment that every tile, table,
     chart and aria-label built from this object is expected to say something
     when foreign.count is non-zero. views/dashboard.js's hero does. This
     section read the same object and printed the same five figures with
     nothing — in the one document that gets forwarded to somebody who cannot
     open the app and check. */
  const incomeForeign = foreignExcluded(foreign);
  if (incomeForeign) out.push('', incomeForeign);

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
  /* L1, 2026-08-29 audit (Phase 4b) — see categoryTable's own header above
     for the full reasoning: this table is deliberately never collapsed, so
     past REPORT_SPLIT_SLICES rows its % column and the Dashboard donut's
     legend run largest-remainder over two different lists and can disagree.
     Said once, here, rather than left for a reader who trusts this table
     enough to hand it to an advisor to notice the mismatch on their own. */
  if (spendByCategory.length > REPORT_SPLIT_SLICES) out.push('', i18n.t('report.category.percentNote', { count: REPORT_SPLIT_SLICES }));

  /* -------------------------- budget vs actual --------------------------- */
  out.push('', `## ${i18n.t('report.section.budgetActual')}`);
  if (categories.length) out.push(...budgetTable(categories, money));
  else out.push('', i18n.t('report.budget.empty'));
  const budgetOrphanedNames = categories.filter(r => r.orphaned).map(r => escMd(r.cat));
  if (budgetOrphanedNames.length) out.push('', i18n.t('report.category.orphaned', { names: budgetOrphanedNames.join(', ') }));

  /* R5, 2026-08-29 audit — mergeCategoryRows (this file, above) keys on the
     category's DISPLAY STRING, and there is no stable identity behind that
     string to merge on instead: a category IS its current name (load.js
     prefers `fm.name`, falling back to the filename, and neither survives a
     rename as anything but itself — see controller.js's classifyRename), and
     nothing this app writes remembers what a category used to be called once
     the rename has happened. So a category renamed partway through a
     multi-period selection genuinely does split into two rows here — one
     under the old name, one under the new — and a real MERGE across that
     split would mean GUESSING two names are the same category from data
     alone, which is exactly the "silent, plausible-but-wrong" shape CLAUDE.md
     already names four other bugs after. Disclosed instead of guessed: both
     tables above already mark a row `*` when its name matches no CURRENT
     Categories/ file (the same signal a genuinely deleted category would
     also trigger — this cannot tell the two apart, and says so rather than
     claiming false precision), so a caveat here is only ever shown when
     there IS a `*` to explain AND more than one period could have split one. */
  const anyOrphaned = spendByCategory.some(r => r.orphaned) || categories.some(r => r.orphaned);
  if (periodCount > 1 && anyOrphaned) out.push('', i18n.t('report.category.renameCaveat'));

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
    /* L4, 2026-08-29 audit — `rate` is prepareReportData()'s figure now, not
       a second computation of the same ratio. See that function's own
       header for why financialReportJson() reads the identical value. */
    const { rate } = savings;
    out.push(...kvTable([
      [i18n.t('report.savings.growth'), money(savings.growth)],
      ...(rate !== null ? [[i18n.t('report.savings.rate'), `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`]] : []),
    ]));
    if (savings.unmeasured) out.push('', i18n.t('report.savings.partial', { count: savings.unmeasured, total: savings.total }));
    /* M4, 2026-08-29 audit — the exact disclosure views/savings.js's own
       growthTile() puts beside itself ("<n> taken out more than put in —
       left out of the rate"): a drawn-down account (a living annuity mid
       withdrawal) is still counted in the plain `growth` total above but
       excluded from `rateGrowth`/`rateCapital`, so the rate needs its own
       caveat, said plainly rather than left for the reader to notice the
       two figures don't add up the way they expect. Shown whenever any
       account is excluded from the rate this way, whether or not a rate
       row above ended up printing at all (rateCapital could be 0 because
       EVERY measured account is drawn down) — the same unconditional gate
       growthTile() itself uses. */
    if (savings.negCapital) out.push('', i18n.t('report.savings.negCapital', { count: savings.negCapital, total: savings.total }));
  }
  /* Outside the branches above on purpose: a pool that is ENTIRELY foreign
     falls into `!savings.total` and prints "No savings or investment accounts
     recorded", which would be a flat untruth about a household that has
     them. The caveat has to reach that branch too, and it is the only thing
     that makes the sentence above it survivable. */
  const savingsForeign = foreignExcluded(savings && savings.foreign);
  if (savingsForeign) out.push('', savingsForeign);

  /* ------------------------------- debt -----------------------------------
     Also present-tense — see the savings section's own note, same reasoning:
     a debt book is not paged by budget period any more than an account
     balance is. */
  out.push('', `## ${i18n.t('report.section.debt')}`, i18n.t('report.asOf'));
  /* ISSUE 30's rule, reaching this document at last. Every figure below —
     the total, the monthly commitment, the interest and each row of the
     table — is arithmetic that only means something inside ONE currency, and
     views/debts.js has narrowed its own page to the household's since ADR-0004
     landed. This section kept reading the UNFILTERED active list, so a
     €100 000 bond printed as "R 100000.00" and was added to the rand total
     beside it — and the SAME document's Net Worth section, three sections
     down, was already excluding that bond from `Owed`. One report,
     disagreeing with itself about one debt. */
  const debtForeign = currencyLine(debts && debts.foreign && debts.foreign.others, 'report.debt.otherCurrencies');
  if (!debts || !debts.count) {
    out.push('', i18n.t('report.debt.none'));
  } else if (!debts.active) {
    /* "Debt-free — N debts tracked, all paid off" is suppressed when a
       foreign debt is still live. The count-based sentence would be a claim
       about the household, not about this section's arithmetic, and the
       caveat underneath cannot take back a word like debt-free. The euro
       bond named below IS the whole story in that case. */
    if (!debtForeign) out.push('', i18n.t('report.debt.free', { count: debts.count }));
  } else {
    /* The interest row is DROPPED, not zeroed, when no active debt states a
       rate. This document is the one the app writes to be forwarded to an
       advisor or pasted into a chat, read by somebody who cannot open the
       app and check — so "Interest this month: R0,00" beside a R900 000
       bond is the most expensive place in the codebase to make that claim.
       health-math.js's aggregate returns null for exactly this, and a
       sentence saying what would make the figure knowable is a smaller,
       honest answer where a zero is a confident wrong one.

       Partial coverage keeps the row and adds a sentence, for the same
       reason the tile on the Debt page does: the number is real, and what it
       covers is a fact the reader cannot recover from the table (a blank
       Rate cell renders as '—' per row, which says the rate is missing but
       never says the total below it therefore isn't the whole bill). Nothing
       is added when the book is fully rated — a household that filled the
       column in reads exactly the document it read before. */
    const cov = debts.coverage;
    out.push(...kvTable([
      [i18n.t('report.debt.total'), money(debts.total)],
      [i18n.t('report.debt.perMonth'), money(debts.perMonth)],
      ...(debts.interest === null ? [] : [[i18n.t('report.debt.interest'), money(debts.interest)]]),
    ]), ...debtTable(debts.rows, money));
    if (debts.interest === null) {
      out.push('', i18n.t('report.debt.interestNone'));
    } else if (cov && cov.missing > 0) {
      out.push('', i18n.t('report.debt.interestPartial',
        { shown: cov.shown, total: cov.total, missing: cov.missing }));
    }
  }
  if (debtForeign) out.push('', debtForeign);

  /* ------------------------------ net worth -------------------------------- */
  out.push('', `## ${i18n.t('report.section.netWorth')}`, i18n.t('report.asOf'),
    ...kvTable([
      [i18n.t('report.col.netWorth'), money(netWorth.net)],
      [i18n.t('report.col.owned'), money(netWorth.assets)],
      [i18n.t('report.col.owed'), money(netWorth.liabilities)],
    ]));
  /* Built since issue #28 and never emitted — the line existed, correct, at
     the top of this function, and no `out.push` ever carried it into the
     document. So the fix that was supposed to stop this section printing a
     rand total that silently dropped a euro flat and a euro bond shipped as
     a computation with no reader. Under the kvTable rather than above it:
     the sentence is about the three figures it follows. */
  if (otherLine) out.push('', otherLine);

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
    /* P2, 2026-08-29 audit — a single number that combines emergency-fund
       months, saving rate and debt interest share ships into this document
       with no explanation of what it measures or where it stops, for a
       reader who did not build it and will reason from it confidently
       (an advisor, an AI chat). Said once, here, rather than assumed known
       from the score's own name. */
    out.push('', i18n.t('report.health.note'));
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
    /* Per-row currency: transactionRow hands the ROW to the formatter now, so
       a €900 charge prints in euro instead of being stamped "R -900,00" — an
       amount of rand that never moved. */
    for (const r of transactions) {
      out.push(transactionRow(r, (v, row) => (row && row.currency && row.currency !== household
        ? `${row.currency} ${Number(v).toFixed(2)}` : money(v)),
      /* The Currency CELL, from the same per-row field the formatter beside
         it already reads. transactionRow used to emit no such cell at all
         under a header that declared one (see its own comment in
         exporter.js), so this table's amounts rendered under "Currency" and
         everything after them one column left. Injected rather than left to
         that function's `_symbol` default because THIS caller stamps
         `currency` — views/report.js's buildReportData, from symbolOf() —
         and one fact answering to two field names is what the injection
         exists to stop. */
      row => (row && row.currency) || ''));
    }
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
    /* ISSUE 28: `currency` per row, beside the number it qualifies. The
       document declares a single top-level `currency` and used to carry rows
       in other currencies underneath it without a word, so a parser — this
       shape's stated audience — read -900 as rand when it was euro. The
       account name was the only hint and it is a free-text household label
       nothing outside this vault can resolve. */
    currency: r.currency || '',
    amount: Number(r.amount || 0), excluded: !!r.excluded, note: r.note || '',
    split: splitRole(r.split),
  };
}

/* The JSON shape of a "held out of these figures" fact — one spelling for
   the two sections that carry one, so a consumer writes one reader. Always
   an object with both keys, never null or absent: see income_vs_spend's own
   note on why a key that comes and goes is worse than a zeroed one. */
function foreignFact(f) {
  return { count: (f && f.count) || 0, symbols: (f && f.symbols) || [] };
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
  data = prepareReportData(data);
  const {
    generated, periodLabel, rangeNote, detail, periodCount, currency,
    income, spend, net, budgetIncome, budgetSpend,
    categories, spendByCategory, categoryGap, savings, debts, netWorth, health, transactions,
    otherCurrencies, foreign,
  } = data;

  const shape = {
    generated,
    period: periodLabel,
    range: rangeNote,
    detail,
    /* R5 — a raw fact, not the Markdown sibling's prose caveat (this file's
       own header explains why only `disclaimer` and `health_score.note` are
       translated sentences in JSON): a consumer already gets `orphaned` on
       every row of `categories` and `budgets_vs_actuals` below, so the same
       "more than one period + an orphaned row" signal the Markdown caveat
       gates on is fully reconstructable from data already here. This field
       only saves that consumer from having to also parse `range`. */
    period_count: periodCount,
    currency: currency || '',
    /* P2, 2026-08-29 audit — the Markdown sibling states this once, above
       every section (see financialReportMarkdown's own comment on the same
       line); a JSON consumer gets the identical sentence as a field rather
       than nothing, since a tool that "would rather parse than read" (this
       file's own header) still hands the parsed numbers to a human, or an
       AI answering one, eventually. */
    disclaimer: i18n.t('report.disclaimer'),
    income_vs_spend: {
      income, spend, net,
      budget_income: budgetIncome, budget_spend: budgetSpend,
      /* ISSUE 28 — the same fact the Markdown sibling states in prose
         (dash.foreignExcluded), as raw data. Always present and zeroed on a
         single-currency vault rather than absent, matching every other count
         in this object: a consumer testing `foreign.count > 0` must not have
         to also handle the key not being there. */
      foreign: foreignFact(foreign),
    },
    /* `orphaned` and `category_gap` are C2's fix — see categoryTable's own
       header in this file, and financialReportMarkdown's identical branch:
       the JSON reader gets the SAME two facts the Markdown prose states, not
       a table that quietly sums to less than income_vs_spend.spend with no
       field anywhere explaining why.

       `percent` — L4, 2026-08-29 audit. prepareReportData()'s largest-
       remainder share, the SAME figure the Markdown table's own % column
       prints — not left for a consumer to re-derive with a plain
       Math.round() per row, which is exactly the "does not sum to 100" trap
       share-percents.js's own header documents. Whole percent points,
       matching the Markdown column exactly rather than a higher-precision
       float a consumer might reasonably expect but that would no longer sum
       to 100 either. */
    categories: spendByCategory.map(r => ({ category: r.cat, amount: r.amount, percent: r.pct, orphaned: !!r.orphaned })),
    category_gap: {
      uncategorised: (categoryGap && categoryGap.uncat) || 0,
      netted: (categoryGap && categoryGap.netted) || 0,
    },
    /* `orphaned` — R5, 2026-08-29 audit. Same raw fact `categories` above
       already carries, added here too so the two arrays are equally
       interpretable (H1's own reasoning for carrying `type` in both). */
    budgets_vs_actuals: categories.map(r => ({
      category: r.cat, type: r.type || null, budget: r.budget, actual: r.actual, remaining: r.budget - r.actual,
      orphaned: !!r.orphaned,
    })),
    /* Present when there is a home-currency total OR a foreign pool held out
       of it. The gate used to be `savings.total` alone, and since
       savingsSummary() narrows `total` to the household's currency, a pool
       that is entirely foreign gave total 0 → `savings: null` → the
       `foreign` fact below never shipped — while the Markdown twin hoists
       its sentence outside the same branch precisely for that vault. One
       click, two documents, one of them silent about the household's
       savings. Now both say it. */
    savings: (savings && (savings.total || (savings.foreign && savings.foreign.count)))
      ? {
        growth: savings.growth,
        rate_growth: savings.rateGrowth,
        rate_capital: savings.rateCapital,
        /* L4, 2026-08-29 audit — the SAME ratio the Markdown sibling's rate
           row prints (`report.savings.rate`, rounded to one decimal there
           only for display), never a second division of rate_growth by
           rate_capital that a consumer would otherwise have had to write
           themselves. `null` exactly when the Markdown row is omitted
           (rate_capital <= 0 — every measured account drawn down) rather
           than 0 or NaN, which would read as "no growth" or silently break
           downstream arithmetic. */
        rate_pct: savings.rate,
        measured: savings.measured,
        unmeasured: savings.unmeasured,
        /* M4, 2026-08-29 audit — the SAME fact the Markdown prose discloses
           (`report.savings.negCapital`), so a JSON reader is never told
           less than a human reading the note beside it. Always a number
           (never absent), matching every other count in this object. */
        neg_capital: savings.negCapital || 0,
        total: savings.total,
        /* ISSUE 28 — which accounts the growth figures above were narrowed
           to one currency to produce. Without it `growth` and `rate_pct`
           read as covering the whole pool, which is exactly what they no
           longer do. */
        foreign: foreignFact(savings.foreign),
      }
      : null,
    debts: (debts && debts.count)
      ? {
        count: debts.count, active: debts.active, total: debts.total,
        per_month: debts.perMonth,
        /* NULL when no active debt states a rate — the same withholding the
           Markdown twin does in prose, because a machine reader deserves the
           distinction between "no interest" and "interest unknown" at least
           as much as a human one. `rate_coverage` is the same three counts
           the Markdown's sentence spends words on, as data. */
        interest: debts.interest,
        rate_coverage: debts.coverage
          ? { shown: debts.coverage.shown, total: debts.coverage.total, missing: debts.coverage.missing }
          : null,
        /* `interest: null` on a row stating no rate, matching the '—' its
           Markdown twin prints. Zero would tell a parsing consumer that this
           debt costs nothing to carry, which is the claim the section total
           above already refuses to make on the same evidence. */
        rows: debts.rows.map(d => ({
          name: d.name, balance: d.balance, rate: d.rate, interest: d.rate ? d.interest : null,
        })),
        /* ISSUE 30 — the debts every figure above holds out, per symbol.
           `others` rather than `symbols` because a foreign debt's BALANCE is
           the fact a reader of this section wants and cannot reconstruct
           from `rows` (which no longer carries it), where a foreign
           ACCOUNT's balance already reaches them through other_currencies. */
        foreign: {
          count: (debts.foreign && debts.foreign.count) || 0,
          others: ((debts.foreign && debts.foreign.others) || []).map(([symbol, amount]) => ({ symbol, amount })),
        },
      }
      : null,
    net_worth: { net: netWorth.net, assets: netWorth.assets, liabilities: netWorth.liabilities },
    /* The household's NET position in every other currency — accounts plus
       assets minus debts, per symbol, never converted (worth.js's
       otherCurrencyNet, the same list the Net Worth section's caveat prints).
       Not "what the household holds": a euro flat against a larger euro bond
       nets negative here, and a symbol that nets to exactly nothing is
       absent. Empty on the single-currency vaults that are nearly all of
       them. The per-ledger gross figures are in `debts.foreign` (balances
       owed) and the transaction rows' own `currency` field. */
    other_currencies: (otherCurrencies || []).map(([symbol, amount]) => ({ symbol, amount })),
    health_score: health
      ? {
        score: health.score, months: health.months, target_months: health.target,
        savings_rate_pct: health.savingsRatePct, interest_share_pct: health.interestSharePct,
        /* P2 — the same gloss the Markdown prints under this section
           (`report.health.note`), for the same reason `disclaimer` above
           rides along: a reader who never opens the Markdown still gets
           told what this number is and is not. */
        note: i18n.t('report.health.note'),
      }
      : null,
    transactions: (detail === 'detail' && transactions) ? transactions.map(jsonTransactionRow) : null,
  };
  return JSON.stringify(shape, null, 2) + '\n';
}

module.exports = {
  REPORT_DIR, REPORT_SPLIT_SLICES, reportPaths, mergeCategoryRows, managedFolderMatch,
  prepareReportData, financialReportMarkdown, financialReportJson, copyBody,
};
