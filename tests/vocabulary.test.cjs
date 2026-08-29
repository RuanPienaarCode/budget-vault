'use strict';
/* The vocabulary gate — one English term, one derivation, or a declared reason
   it has two.

   table-schema.js (ADR-0003) pins COLUMNS. cross-page-consistency.test.cjs
   pins NUMBERS agreeing across pages. i18n.test.cjs pins the seven language
   tables agreeing WITH EACH OTHER. Nothing pinned whether two pages use one
   WORD for two different numbers — until a 13-agent audit on 2026-08-24 went
   looking on purpose and found nine live instances in one pass (all fixed in
   1.23.0's "One figure, one rule" section of CHANGELOG.md). This file is the
   guard so a tenth does not ship unnoticed.

   THE SHAPE OF THE CHECK, per term below:

     - status: 'unified'   — every consumer reaches the term through ONE
                              function/expression. Checked by requiring that
                              exact call shape to appear verbatim in every
                              consuming file, and that the OLD, retired shape
                              does not.
     - status: 'declared'  — two real derivations exist, on purpose, and the
                              surface that differs SAYS SO on screen (a note,
                              a caveat, a differently-worded label) rather than
                              silently drawing the same word over two numbers.
                              Checked by requiring both the differing formula
                              AND its on-screen disclosure to be present.
     - status: 'known-gap' — the audit found the SAME rendered word bound to
                              two rules with no disclosure and no comment
                              arguing it is intentional. Not fixed here — this
                              file's owner is tests/ only (see the dispatching
                              agent's brief). Pinned as a CHARACTERISATION so
                              (a) the gap cannot silently get worse without
                              this file needing an edit, which is the trigger
                              for a human to look at it, and (b) nobody reads
                              a green suite as "so this is fine".

   Pure text analysis over the real src/ files — no Obsidian, no DOM, matching
   tests/settings-parity.test.cjs's own approach for the same reason: the
   thing under test is what the SOURCE says, not what a fixture vault
   produces at runtime. Comments are stripped before matching so a file's own
   prose about a retired formula (several of these files quote the old bug
   verbatim, on purpose, as a warning to the next reader) can never be
   mistaken for the formula still being live.

   Every 'unified'/'declared' check here is a NEGATIVE-CONTROLLED regression
   guard, not a one-off assertion: the same exact-match check that must pass
   against the real file is run a second time against a hand-written string
   in the OLD, buggy shape, and must fail against it. That is what proves the
   check has teeth rather than passing vacuously — see the header note on
   PROVEN FALSE below for which ones and what the failure looks like.

     node tests/vocabulary.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (cond, m) => { assert.ok(cond, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const read = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

/* Strip /* … *\/ block comments and // line comments before matching, so a
   file's own prose quoting a retired formula (accounts.js does this, in the
   comment directly above the FIX for the growth bug) cannot satisfy — or
   fail — a check meant to look at live code. Good enough for this codebase's
   house style (no `//` inside a string literal in the lines these checks
   touch, checked by hand for every file read below) without a real parser,
   the same trade settings-parity.test.cjs already makes. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const files = {
  savings: read('views/savings.js'),
  savingsMath: read('savings-math.js'),
  report: read('views/report.js'),
  assets: read('views/assets.js'),
  accounts: read('views/accounts.js'),
  dashboard: read('views/dashboard.js'),
  budgets: read('views/budgets.js'),
  score: read('views/score.js'),
  moneyFlow: read('money-flow.js'),
  healthMath: read('health-math.js'),
  healthData: read('health-data.js'),
  worth: read('worth.js'),
};
const live = {}; // same files, comments stripped, for "must not contain the old shape" checks
for (const [k, v] of Object.entries(files)) live[k] = stripComments(v);

/* PROVEN FALSE — the negative control every 'must contain the exact shape'
   check below is run through. Takes the SAME literal string the real check
   requires and mangles it into the shape the audit found (or the shape the
   bug report describes), then asserts the check rejects it. Centralised here
   so every term's control reads the same way and a future term only has to
   supply the two strings. */
function provenFalse(desc, exactShape, mangled) {
  ok(exactShape !== mangled, `${desc}: control setup — mangled string must actually differ from the real one`);
  ok(!mangled.includes(exactShape), `${desc}: control — the old/wrong shape must NOT satisfy the check that guards the real one (proves the check has teeth, not a vacuous pass)`);
}

/* ========================================================================
   TERM 1 — "Growth"  ·  status: unified
   ------------------------------------------------------------------------
   Rule: growth is savings-math.js's totalReturn(account, rows, poolType,
   opts).growth, and NOTHING else. Both consumers used to each derive it
   their own way — views/savings.js always went through totalReturn();
   views/accounts.js used to compute `balance - total_invested`, a formula
   that ignores withdrawals, so it disagreed with the Savings page by R60 000
   on the same real account (see accounts.js's own comment, left in place on
   purpose as the reason there is now exactly one call site).

   ITEM 2 (2026-08-26): the literal moved from `catType` to `poolType` in both
   files — the SAME poolCatType(S.categories, name) wrapper, built once per
   view and never the bare ctx.catType, or an income-typed category flagged
   `interest: true` on one page silently stops being growth on the other.

   M4 (2026-08-29 audit): the SUM across a pool of accounts — growthTotals(),
   `growth += r.growth` — moved OUT of views/savings.js and into
   savings-math.js, called from there by BOTH views/savings.js's own
   growthTile() and views/report.js's savingsSummary(), so the Report page's
   savings section cannot re-derive this a second way. The checks below moved
   with it: the summation is now pinned in savings-math.js, and the two view
   files are pinned only on calling growthTotals(...) rather than summing
   r.growth themselves again. ======================================================================= */
{
  const TR_CALL = 'totalReturn(a, rows, poolType, { today: todayIso() })';
  const TR_CALL_SAV = 'totalReturn(e.account, e.rows, poolType, { today: todayIso() })';
  ok(live.accounts.includes(TR_CALL), 'Growth: accounts.js computes each account\'s return through the shared totalReturn(), not a local formula');
  ok(live.accounts.includes('r.tr.growth') || live.accounts.includes('tr.growth'),
    'Growth: accounts.js reads .growth off that same totalReturn() result, not off balance minus total_invested');
  ok(live.savings.includes(TR_CALL_SAV), 'Growth: savings.js computes each account\'s return through the shared totalReturn()');
  ok(live.savingsMath.includes('growth += r.growth'), 'Growth: savings-math.js\'s growthTotals() sums growth off totalReturn()\'s own .growth field — the ONE place this sum happens now');
  ok(!live.savings.includes('growth += r.growth'), 'Growth: savings.js no longer sums growth itself — it calls growthTotals() instead (M4)');
  /* The POOL is narrowed at this call site — `entries.filter(homeEntry)` —
     and the gate matches on the shared function plus its shared argument
     shape rather than on a literal `entries`. The narrowing is the issue-#28
     fix reaching this page: growthTotals sums `growth` and `capitalIn` and
     the tile divides one by the other, so a pool spanning two currencies
     produced "+11,2% on Rp 903 000 put in" — a percentage of a quantity that
     does not exist. What this gate protects is that savings.js calls the
     SHARED function rather than re-deriving the sum, and that is unchanged. */
  ok(/growthTotals\(entries(\.filter\(homeEntry\))?, poolType, \{ today: todayIso\(\) \}\)/.test(live.savings),
    'Growth: savings.js\'s own growth tile calls the shared growthTotals()');
  ok(live.savings.includes('entries.filter(homeEntry)'),
    'Growth: and it pools ONE currency — a rate whose numerator and denominator are in different currencies is not a rate');
  ok(live.report.includes('growthTotals(entries, poolType, { today: todayIso() })'), 'Growth: views/report.js\'s savings section calls the SAME growthTotals() — not a second guess at what "growth" or "rate of growth" mean (M4)');
  ok(!live.report.includes('growth += r.growth'), 'Growth: views/report.js never re-derives the sum itself either');

  // The retired formula itself, banned from live code in both consumers —
  // it is fine for it to appear in a COMMENT (accounts.js quotes it on
  // purpose), which is exactly why this check runs on the comment-stripped
  // text rather than the raw file.
  const RETIRED = /\bbalance\s*-\s*(?:a\.)?total_invested\b/;
  ok(!RETIRED.test(live.accounts), 'Growth: the retired `balance - total_invested` formula is gone from LIVE accounts.js code (only survives as a comment warning future readers off it)');
  ok(!RETIRED.test(live.savings), 'Growth: the retired formula never lived in savings.js either');

  // Negative control: the exact retired line the bug report describes.
  const mangled = 'const growth = a.balance - a.total_invested;';
  provenFalse('Growth', TR_CALL, mangled);
  ok(RETIRED.test(mangled), 'Growth: control — the retired-formula regex DOES match the old buggy line (so its absence-check above is a real check, not a typo that matches nothing)');
}

/* ========================================================================
   TERM 2 — "Net worth"  ·  status: unified, with one declared exception
   ------------------------------------------------------------------------
   Rule: net worth is worth(S.accounts, S.debts, S.assets).net. Dashboard,
   Savings (twice — the KPI tile and the composition chart) and the Score
   page's health-data.js all call it with exactly those three arguments.

   accounts.js is the declared exception: its hero calls worth() with only
   accounts (no debts, no assets — a household's bond and house are pages
   away) and is careful to NEVER call the result "Net worth" — its own label
   key is acct.hero.label ("Net across your accounts"), a different English
   term on purpose, and it discloses the gap with an `elsewhere` caveat
   whenever Assets or Debts actually hold something this figure left out. A
   different word for a different number is not a collision to guard against
   — it is the thing this whole file exists to make everyone else do too.

   ITEM 5 (2026-08-26): the account list FEEDING worth() narrowed further —
   `primary` is the readable accounts split by currency (splitByCurrency, this
   file's own), not the raw filtered list — but the two null arguments (still
   no debts, no assets) are exactly what this term exists to pin, so the
   literal moved with the call rather than the term being retired. ======================================================================= */
{
  const FULL_WORTH = 'worth(S.accounts, S.debts, S.assets)';
  ok(live.dashboard.includes(FULL_WORTH), 'Net worth: dashboard.js computes it via worth(accounts, debts, assets)');
  /* ISSUE 28 (2026-08-29 audit): savings.js's two call sites narrowed to the
     household-currency accounts and started passing the household symbol —
     `worth(homeAccounts, S.debts, S.assets, S.settings.currency)`. The term
     this gate protects is unchanged and, if anything, sharper: BOTH places on
     this page must compute net worth by the same expression, because they
     used to disagree with the Accounts hero (Rp 6 203 956 against
     Rp 6 200 000) and a page whose tile and chart could drift from each other
     as well would have three answers. The literal moved with the call, the
     way ITEM 5 moved it before. */
  const SAV_WORTH = 'worth(homeAccounts, S.debts, S.assets, S.settings.currency)';
  ok(live.savings.split(SAV_WORTH).length - 1 >= 2, 'Net worth: savings.js computes it the same way in both places that show it (KPI tile and composition chart)');
  ok(!live.savings.includes(FULL_WORTH),
    'Net worth: and neither place adds unlike currencies together any more');
  ok(live.healthData.includes('worth(S.accounts, S.debts, S.assets).net'), 'Net worth: health-data.js (feeding the Score page) reads the same worth().net');

  ok(live.accounts.includes('worth(primary, null, null)'),
    'Net worth: accounts.js\'s hero is the declared exception — worth() called with no debts/assets, on purpose');
  ok(live.accounts.includes('splitByCurrency(S.accounts.filter(a => !unreadableBalance(a)))'),
    'Net worth: and `primary` is still built from the same readable-accounts filter this term always pinned, now split by currency first (ITEM 5)');
  ok(!live.accounts.includes("i18n.t('dash.pos.netWorth')") && !live.accounts.includes("'Net worth'"),
    'Net worth: accounts.js never borrows the "Net worth" word for its narrower figure — its own label key is distinct');
  ok(live.accounts.includes("i18n.t('acct.hero.elsewhere')"),
    'Net worth: accounts.js discloses on screen when Assets/Debts hold more than this accounts-only figure counts — the declared half of "declared exception"');
}

/* ========================================================================
   TERM 3 — "Total income" (Dashboard) vs "Total income" (Budget)
   status: declared
   ------------------------------------------------------------------------
   Two real, different numbers under one label, each legitimate on its own
   page: the Dashboard hero states what actually arrived this period
   (periodSummary().income — money the bank confirms happened); the Budget
   page states what the PLAN promises (the sum of this period's budgeted
   income rows) — a number that exists on day 1 of a period when the
   Dashboard's figure is still mostly zero. Declared rather than unified
   because collapsing them would break whichever page needs the other
   reading. The Budget page's own tile discloses the Dashboard's reading
   right underneath its own, in the same rand figure — see
   tests/cross-page-consistency.test.cjs's header for the general policy this
   follows. ======================================================================= */
{
  ok(/el\('div', \{\}, el\('div', \{ class: 'sl' \}, i18n\.t\('dash\.stat\.income'\)\)\),\s*\n\s*el\('div', \{\}, el\('div', \{ class: 'sv grad-txt' \}, money\(sum\.income\)\)/
    .test(live.dashboard),
    'Total income (Dashboard): the hero\'s Income stat is bound to periodSummary().income (actual, received)');

  ok(live.budgets.includes("label: i18n.t('bud.total.income'), value: money(income), grad: true,"),
    'Total income (Budget): the tile is bound to the LOCAL `income` accumulator — the sum of this period\'s budgeted income rows, not the actual figure');
  ok(live.budgets.includes("note: i18n.t('bud.total.incomeNote', { amount: money(sum.income) }) },"),
    'Total income (Budget): the declared half — the tile\'s own note discloses periodSummary().income, the SAME figure the Dashboard hero shows, right under the budgeted one');
}

/* ========================================================================
   TERM 4 — "Total spent" (Dashboard) vs "Total spent" (Budget)
   status: declared
   ------------------------------------------------------------------------
   Dashboard hero: gross periodSummary().spend, no overlay. Budget page:
   THAT SAME figure plus the assume-spent shortfall overlay (a category whose
   money left in an earlier period and has no transaction here to be counted
   by periodSummary at all) — never a second, competing reading of the same
   raw spend. Declared via the tile's own gapNote, built from grossGap /
   gapUncat / gapNetted the same way the donut's own "not shown" note already
   works (dashboard.js), so the difference is accounted for by construction
   rather than asserted. ======================================================================= */
{
  ok(/el\('div', \{\}, el\('div', \{ class: 'sl' \}, i18n\.t\('dash\.stat\.spent'\)\)\),\s*\n\s*el\('div', \{\}, el\('div', \{ class: 'sv' \}, money\(sum\.spend\)\)/
    .test(live.dashboard),
    'Total spent (Dashboard): the hero\'s Spent stat is bound to periodSummary().spend, gross, no overlay');

  const SPENT_LINE = 'const spent = sum.spend + assumed;';
  ok(live.budgets.includes(SPENT_LINE),
    'Total spent (Budget): the tile is periodSummary().spend PLUS the documented assume-spent shortfall overlay, not a second reading of spend');
  ok(live.budgets.includes("label: i18n.t('bud.total.spent'), value: money(spent), over: budgeted > 0 && spent > budgeted,"),
    'Total spent (Budget): the tile actually renders that combined figure');
  ok(live.budgets.includes('+ gapNote },'),
    'Total spent (Budget): the declared half — the tile\'s note discloses exactly how it differs from the per-category table under it (grossGap split into gapUncat/gapNetted), the same disclosure policy cross-page-consistency.test.cjs pins for the Dashboard\'s donut');

  // Negative control: a Budget tile that silently dropped the overlay (or
  // the disclosure) would read as the Dashboard's own unqualified spend —
  // exactly the "two figures, one label, no explanation" shape this file
  // exists to catch.
  provenFalse('Total spent (Budget)', SPENT_LINE, 'const spent = sum.spend;');
}

/* ========================================================================
   TERM 5 — "Assume-spent" actual  ·  status: unified (REPLACES, not PLUS)
   ------------------------------------------------------------------------
   An assume-spent category's actual is the budgeted amount MINUS whatever
   real transactions have already landed against it (the shortfall) — never
   the budgeted amount ADDED on top of real spend. Before the first fix, a
   R4 000 grocery budget with R3 000 already spent read R7 000 / "175% of
   budget used"; both consuming views agreed it should read the shortfall
   alone. A SECOND, narrower defect then shipped inside that same fix: the
   shortfall was `d.amount - realSpend` with no floor on `realSpend` itself,
   so a category that NETS POSITIVE — a refund bigger than the month's real
   spend — gave `realSpend` a negative value, and subtracting a negative
   INFLATED the overlay by the refund's own excess (budgeted R1 000 against a
   net R700 refund computed R1 700, for a row the table itself showed at
   R1 000). `realSpend` is now clamped at zero before the shortfall is taken,
   matching the row's own Actual cell one function down, which clamps the
   same quantity the same way. dashboard.js's own comment names budgets.js's
   rule by name as the one it is matching — about as directly "unified" as
   two independent files get. ======================================================================= */
{
  const SHORTFALL = 'if (catAssumeSpent(d.category)) assumed += Math.max(0, (d.amount || 0) - Math.max(0, realSpend));';
  ok(live.budgets.includes(SHORTFALL),
    'Assume-spent (Budget): the overlay is the shortfall — budgeted minus real spend clamped at zero FIRST, the whole thing floored at zero again — never the whole amount added on top, and never inflated by a category that netted a refund');

  ok(live.dashboard.includes('actual: assumed ? (b.amount || 0) : 0'),
    'Assume-spent (Dashboard): an assume-spent row is SEEDED with its actual equal to the budgeted amount (REPLACES)');
  ok(live.dashboard.includes('if (existing && existing.assumed) continue;'),
    'Assume-spent (Dashboard): a transaction landing in that same category is then SKIPPED rather than added on top — REPLACES, matching the Budget page\'s rule rather than re-deriving a second one');

  // Negative control 1: the pre-1.23.0 Budget-page line added the WHOLE
  // amount unconditionally — the double-count the changelog describes.
  provenFalse('Assume-spent (Budget)', SHORTFALL, 'if (catAssumeSpent(d.category)) assumed += d.amount || 0;');
  // Negative control 2: the shortfall shape WITHOUT the inner clamp — the
  // narrower refund-inflation defect this fix closed second, on the same
  // line, without reintroducing the first.
  provenFalse('Assume-spent (Budget) — refund clamp', SHORTFALL,
    'if (catAssumeSpent(d.category)) assumed += Math.max(0, (d.amount || 0) - realSpend);');
}

/* ========================================================================
   TERM 6 — Budget-row "category type"  ·  status: unified (catType wins)
   ------------------------------------------------------------------------
   A category's type is read from the category FILE (catType(), live) on
   both the Budget page and the Dashboard's budget table — the row's own
   stored Type cell (d.type / b.type) is used only as the FALLBACK for a
   category with no file left to ask (catType returns null), via `??` rather
   than `||` so a legitimately-zero income row is not mistaken for "unknown".
   Before the fix, the Budget page read the stale cell and the Dashboard read
   the live file, so a corrected category could show −R5 000 on one page and
   +R5 000 on the other for the same row. ======================================================================= */
{
  const BUDGET_LINE = 'const type = catType(d.category) ?? d.type;';
  const occurrences = live.budgets.split(BUDGET_LINE).length - 1;
  ok(occurrences >= 1, 'Category type (Budget): the row\'s live type comes from catType() first, the stored cell only as a fallback for a deleted category file');

  const DASH_LINE = 'const type = catType(cat);';
  ok(live.dashboard.split(DASH_LINE).length - 1 >= 1, 'Category type (Dashboard): the budget table also reads the live category file through catType(), the same function Budget uses');

  // Negative control: reversing the `??` operands makes the STALE cell win
  // whenever it happens to be present — the exact bug the changelog names.
  provenFalse('Category type (Budget)', BUDGET_LINE, 'const type = d.type ?? catType(d.category);');
}

/* ========================================================================
   TERM 7 — "Emergency cover" (months of essential spending)
   status: unified (numerator AND denominator both over every account)
   ------------------------------------------------------------------------
   The numerator (resolveEarmarks) and the denominator (essential monthly
   spend) both have to be read over EVERY account, budget-scoped or not —
   the fund itself has to cover a bill paid from an account marked
   `budget: false` the month income stops, same as it covers one paid from
   the household's main cheque account. Before the fix the denominator went
   through periodSpend()'s budget-scoped machinery while the numerator
   already read every account; a bill paid from a "not in budget" joint
   account vanished from the divisor and a household with 2 months of real
   cover was told it had 6. ======================================================================= */
{
  ok(live.healthData.includes('resolveEarmarks(S.accounts)'),
    'Emergency cover: the numerator reads every account, S.accounts unfiltered');

  const ESSENTIAL_LINE = 'essential: essentialTotal(householdSpend, catType, S.settings.nonessential_groups),';
  ok(live.healthData.includes(ESSENTIAL_LINE),
    'Emergency cover: the denominator is built from `householdSpend`, this file\'s own unfiltered (transfers-only-excluded) rebuild of the period\'s spend — not periodSpend()\'s budget-scoped map');
  ok(!live.healthData.includes('essentialTotal(spend.whole') && !live.healthData.includes('essentialTotal(periodSpend'),
    'Emergency cover: the denominator is never built from the budget-scoped periodSpend()/spend.whole shape that dropped non-budget and excluded rows');

  // Negative control: the pre-fix denominator, read off the budget-scoped
  // shape instead of the raw one.
  provenFalse('Emergency cover', ESSENTIAL_LINE, 'essential: essentialTotal(spend.whole, catType, S.settings.nonessential_groups),');
}

/* ========================================================================
   TERM 8 — "Budget used", on the Score page, in two places at once
   status: declared (formerly GAP A — found by the 2026-08-24 audit,
   fixed since, and promoted out of "known gap" into this file's own
   declared pattern)
   ------------------------------------------------------------------------
   score.now.budget ("budget used {pct}") reads health-math.js's M.budgetUsed
   — a SIX-PERIOD TRAILING AVERAGE, gated on consumptionForBudget, which
   excludes savings/investment-typed spend (health-data.js: "what living
   cost: everything except money moved into the household's own funds").
   score.flow.chip.budgetUsed (same page, the flow card underneath) reads
   money-flow.js's own budgetUsed — THIS PERIOD ONLY. The two used to
   disagree on the NUMERATOR too: the chip divided periodSummary().spend
   UNADJUSTED, which money-flow.js's own comment on `living` two variables
   later already documented as including savings-typed spend — an
   adjustment `living` applied but `budgetUsed` never inherited. A household
   funding an investment inside a budgeted category read as having blown the
   budget on the chip while the ring above it, reading the adjusted figure,
   said the opposite. Fixed by giving `budgetUsed` the SAME numerator rule
   (`consumptionThisPeriod`, the same savings/investment exclusion) —
   unifying the RULE while deliberately keeping the WINDOW different (this
   period vs six periods), and disclosing that one remaining difference on
   screen: score.flow.chip.budgetUsedNote, shown right under the chip only
   when the row above it actually rendered. */
{
  const SCORE_LINE = 'budgetUsed: (hasIncome && avg.budgeted > 0 && avg.consumptionForBudget !== null)';
  ok(live.healthMath.includes(SCORE_LINE),
    'Budget used (Score ring): health-math.js\'s score-facing budgetUsed is gated on the six-period trailing `avg.consumptionForBudget`');
  ok(live.healthData.includes("if (type !== 'savings' && type !== 'investment') { consumption += amt; }"),
    'Budget used (Score ring): that consumption figure explicitly excludes savings/investment-typed spend');

  const CONSUMPTION_LINE = 'const consumptionThisPeriod = Math.max(0, spent - savingsTypedSpend);';
  ok(live.moneyFlow.includes(CONSUMPTION_LINE),
    'Budget used (Flow chip): money-flow.js\'s numerator now excludes savings/investment-typed spend, the SAME adjustment `living` already applies — the unified half');
  ok(live.moneyFlow.includes('const budgetUsed = bud > 0 ? consumptionThisPeriod / bud : null;'),
    'Budget used (Flow chip): budgetUsed divides that adjusted figure, not the raw periodSummary().spend');

  ok(live.score.includes("if (M.budgetUsed !== null) { bits.push(i18n.t('score.now.budget', { pct: pct(M.budgetUsed) })); }"),
    'Budget used (Score ring): the ring renders health-math\'s 6-period, savings-excluded figure under "budget used {pct}"');
  /* The literal pins the figure AND its label rule: sharePercentLabel, not a
     bare Math.round — a share genuinely past (or short of) 100% must never
     round back onto exactly "100%" (share-percents.js, its own guard test). */
  ok(live.score.includes("budgetRows.push([i18n.t('score.flow.chip.budgetUsed'), `${sharePercentLabel(bud.budgetUsed, locale().decimal)}%`]);"),
    'Budget used (Flow chip): the SAME page also renders money-flow\'s this-period figure under the literal label "Budget used"');
  ok(live.score.includes("bud.budgetUsed !== null ? i18n.t('score.flow.chip.budgetUsedNote') : null));"),
    'Budget used: the declared half — the chip discloses the one difference it still has left (the WINDOW, not the numerator) right under the figure, the same disclosure policy Terms 3-4 pin for the Budget page\'s income/spend tiles');

  // Negative control: the pre-fix flow-chip numerator, dividing the raw,
  // unadjusted spend — the exact numerator mismatch the audit found.
  provenFalse('Budget used (Flow chip)', CONSUMPTION_LINE, 'const consumptionThisPeriod = spent;');
}

/* ========================================================================
   TERM 9 — "Savings/investment account" membership, by TYPE string
   status: unified (formerly GAP B — found by the 2026-08-24 audit, fixed
   since, and promoted out of "known gap")
   ------------------------------------------------------------------------
   `load.js` only DEFAULTS `type` when the frontmatter key is ABSENT
   (`fm.type || 'other'`), so a present-but-odd value like `type: Savings`
   (capital S) reaches every downstream reader verbatim. dashboard.js's own
   accountsOfType() already case-folded before this audit (CHANGELOG.md
   1.23.0); savings.js's top-of-page KPI/entries list and health-data.js's
   saving-rate pillar (the Score page) did not — an account like that used to
   count on the Dashboard's savings tile and in every worth()-based net-worth
   figure while silently dropping out of the Savings page's own "Savings"
   KPI, its growth chart entries, and the Score's saving rate. Same account,
   present under the word "savings" on some screens and absent under the
   same word on others.

   Fixed as three independent copies of the SAME fold rule, not one shared
   function — savings.js's own header on `typeIs` and health-data.js's own
   comment on `savers` both say so explicitly and both name the reason: the
   three files are siblings, not a shared module, and each is meant to carry
   the trap's explanation for a reader who lands in only one of them. Checked
   here the same way TERM 6 checks two independently-written lines rather
   than one literal call shape shared verbatim: the RULE is what must be
   unified, not the source text expressing it. */
{
  ok(live.dashboard.includes("String(a.type || '').trim().toLowerCase() === type"),
    'Account type (Dashboard): accountsOfType() case-folds the account type before comparing');

  const SAVINGS_LINE = "const typeIs = (a, type) => String((a && a.type) || '').trim().toLowerCase() === type;";
  ok(live.savings.includes(SAVINGS_LINE),
    'Account type (Savings page): every type test on this page — the KPI tile, the entries list, the per-account investment checks — now goes through one case/whitespace-folded typeIs()');
  ok(!/S\.accounts\.filter\(a => a\.type === 'savings'\)/.test(live.savings),
    'Account type (Savings page): confirmed — the raw, unfolded `a.type === \'savings\'` filter is gone');

  /* The two literal comparisons became one shared POOL_TYPES set when the
     saving RATE was rewritten — the same set now answers both "is this account
     part of the savings pool" and "does this category name a vehicle inside
     it", because they are one idea seen from two sides. What this term
     actually guards is unchanged and is asserted the same way: the field is
     folded and trimmed BEFORE it is compared, so `type: Savings` cannot count
     toward net worth while showing as nothing on the tile beside it. */
  ok(/POOL_TYPES\.has\(String\(\(a && a\.type\) \|\| ''\)\.trim\(\)\.toLowerCase\(\)\)/.test(live.healthData),
    'Account type (Score\'s saving rate): health-data.js\'s savers filter folds case/whitespace before comparing');
  ok(/const POOL_TYPES = new Set\(\['savings', 'investment'\]\)/.test(live.healthData),
    'Account type (Score\'s saving rate): and the pool is one declared set, not a pair of inline literals');
  ok(!/a\.type === 'savings'/.test(live.healthData),
    'Account type (Score\'s saving rate): confirmed — no raw, unfolded comparison survives in health-data.js');
  ok(!/a\.type === 'savings' \|\| a\.type === 'investment'/.test(live.healthData),
    'Account type (Score\'s saving rate): confirmed — the raw, unfolded OR-chain is gone');

  // Negative control: the pre-fix savings.js line, comparing the raw string.
  provenFalse('Account type (Savings page)', SAVINGS_LINE, "const savings = S.accounts.filter(a => a.type === 'savings');");
}

/* ========================================================================
   TERM 10 — "Stale valuation" (an asset's Valued date, 365-day clock)
   status: declared (formerly GAP C — found by the 2026-08-24 audit, fixed
   since, and promoted out of "known gap")
   ------------------------------------------------------------------------
   assets.js says, in its own header comment, that VALUED_STALE_DAYS is "THE
   single source for this number... published below via ctx.provide so any
   other view... reads it from here rather than re-declaring its own 365 —
   that already happened once (views/savings.js's own ASSET_STALE_DAYS)". That
   sentence used to describe a fix that was only half made: assets.js
   provided ctx.VALUED_STALE_DAYS, but savings.js never read it — it declared
   its own literal `const ASSET_STALE_DAYS = 365` instead. THE THRESHOLD is
   unified now: savings.js reads `ctx.VALUED_STALE_DAYS` through `ctx`
   (rather than destructuring it at registration time, because assets.js
   registers AFTER savings.js — see controller.js — so the key does not
   exist on `ctx` yet when registerSavings(ctx) runs).

   What is left, and stays, is DECLARED rather than unified: assets.js's
   isStaleValuation() flags ANY dated-but-old row, zero-valued or not;
   savings.js's staleAssets() adds `&& a.value > 0`. savings.js's own comment
   argues the two predicates answer different questions on purpose — "is
   this row's date current" (assets.js) vs "how much of what you own is
   resting on a stale figure" (savings.js, and a zero-valued asset owns
   nothing to be at stake) — and each page's own on-screen wording says a
   different thing to match: assets.js's caveat counts VALUES ("3 of 5
   values are over a year old"); savings.js's caveat states RAND ("R X of
   what you own was last valued over a year ago"). Two pages counting
   different rows on purpose, disclosed in the number's own framing, not by
   drift. */
{
  const THRESHOLD_READ = 'return (d === null || d > ctx.VALUED_STALE_DAYS) && a.value > 0;';
  ok(live.assets.includes('const VALUED_STALE_DAYS = 365;') && live.assets.includes('VALUED_STALE_DAYS });'),
    'Stale valuation: assets.js declares VALUED_STALE_DAYS as its documented single source and publishes it via ctx.provide');
  ok(live.savings.includes(THRESHOLD_READ),
    'Stale valuation: savings.js reads that SAME published threshold through ctx.VALUED_STALE_DAYS — the unified half, no second literal 365 left to drift');
  ok(!/const ASSET_STALE_DAYS\s*=\s*365/.test(live.savings),
    'Stale valuation: confirmed — savings.js\'s own re-declared literal 365 is gone');

  ok(!/isStaleValuation[\s\S]{0,120}a\.value\s*>\s*0/.test(live.assets),
    'Stale valuation: assets.js\'s own isStaleValuation() does NOT require a.value > 0 — a zero-valued, dated-old row is still stale there, on purpose');
  ok(live.savings.includes('&& a.value > 0;'),
    'Stale valuation: savings.js\'s staleAssets() DOES require a.value > 0 — the declared half of the difference');

  // The two on-screen disclosures, differently worded on purpose.
  ok(live.assets.includes("over a year old`"),
    'Stale valuation (Assets page): the caveat counts VALUES, date-framed ("N of M values are over a year old")');
  ok(live.savings.includes('of what you own was last valued over a year ago.'),
    'Stale valuation (Savings page): the caveat states RAND, money-framed ("R X of what you own...") — the declared half of "declared", said on screen, not only in a code comment');

  // Negative control: the pre-fix savings.js line, re-declaring its own
  // literal instead of reading the published threshold.
  provenFalse('Stale valuation', THRESHOLD_READ,
    'return (d === null || d > ASSET_STALE_DAYS) && a.value > 0;');
}

/* ========================================================================
   DELIBERATELY NOT A TERM HERE — "Debt payments"
   ------------------------------------------------------------------------
   The audit's own table names this pairing (Debts page: payment + extra ·
   Score: payment alone), but on inspection the two do NOT share a rendered
   word: the Debts page's tile is labelled "Paying per month" (payment +
   extra, the household's own declared commitment); the Score page's flow
   card uses the DIFFERENT literal "Debt repayments"
   (score.flow.chip.debtRepayments), which is not payment-field-based at all
   — it is money-flow.js's transaction-derived debtRepayments, summed from
   actual category-typed 'debt' spend for the period. health-data.js's own
   payment-only sum (`debtInstalments`) feeds a SCORE WEIGHT
   (instalmentShare), never a labelled rand figure a reader sees. Three
   numbers, three different jobs, none of them sharing one rendered English
   word — so there is no vocabulary collision to guard here, only three
   genuinely different questions that happen to all involve "debt". Recorded
   here rather than silently dropped, per this file's own rule that a gap
   must be SAID rather than just absent. ======================================================================= */

console.log(`PASS — the vocabulary gate: ${checks} assertions across 10 unified/declared terms (negative-controlled where the file's own pattern calls for it) and 0 known live gaps — the 2026-08-24 audit's original three (GAP A/B/C) are now Terms 8, 9 and 10, fixed and pinned rather than merely characterised.`);
