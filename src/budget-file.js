'use strict';
/* Budgets/<period>.md — the one serializer.

   The bytes of a period file used to be built inline inside saveBudget() in
   views/budgets.js: the frontmatter patch, the heading, the range note, the
   column header, the separator and the row template, all as literals in a
   function no bare-node test can call. That was survivable while the Budget
   page was the only writer. The setup wizard is now a second one — it seeds a
   household's very first budget — and two hand-built copies of a table format
   is precisely the shape of bug this repo keeps finding: two figures (here,
   two files) derived by different rules, agreeing right up until one of them
   is edited.

   So the format lives here, once, and both writers call it. Pure — no DOM, no
   `require('obsidian')`, nothing read off the clock — so tests/ can drive it
   directly and round-trip the result through the REAL loader.

   NOT (yet) on table-schema.js. Budgets are the one flat table whose loader
   still reads positionally in load.js rather than through a declared schema,
   so declaring the columns here as well would give the format two doors again
   — the exact thing ADR-0003 closes. Migrating budgets onto table-schema is a
   real piece of work with a frozen-order list of its own; this module is
   deliberately the smaller move, and the header/separator literals below match
   what headerLines() would derive for these four columns character for
   character, so that migration stays a pure refactor when someone takes it on. */

const { escMd, patchFrontmatter, freshLeadLines, withLeadExtra } = require('./markdown');
const { typeOrder, typeRank } = require('./groups');
const { parseNum } = require('./amount');

/* The shipped column order and the shipped separator, byte for byte — files
   written by every past version of the plugin are on disk in user vaults, so
   a whitespace-only change here rewrites every budget file in every vault on
   the next save. That is user-visible churn and, under iCloud sync, a hazard. */
const BUDGET_HEADER = '| Category | Type | Amount | Notes |';
const BUDGET_SEPARATOR = '|----------|------|-------:|-------|';

/* The frontmatter a period file is BORN with, for the case where there is no
   existing block to patch.

   `rawFrontmatter` is normally the verbatim block the loader captured, and
   patching it is what keeps tags, aliases, `hub` and any hand-added key
   through a save. But S.budgetMeta only holds an entry for a period whose
   file was on disk at load, so the very first save of a NEW period arrives
   here with nothing to patch — and patchFrontmatter's empty-input branch
   builds a block out of `updates` alone, i.e. `period:` and not one thing
   more. Every budget file this vault has ever written carries the tag line;
   the ones the Budget page creates for a new month did not, so a new period
   silently dropped out of every `finance/budget/budgets` search while looking
   fine on the page that made it.

   The wizard already knew the right answer and wrote this exact string as a
   literal of its own — which is the same two-spellings-of-one-format shape
   this whole module exists to close, just in the frontmatter instead of the
   table. One declaration; both writers reach it through here.

   Deliberately tags ONLY. `hub:` is in this vault's files because a human put
   it there, and the plugin has no notion of a hub note to derive it from —
   patchFrontmatter preserves it once present, which is the whole contract. A
   default that invented a wikilink would be asserting a note exists.

   The valueless `period:` is a PLACEHOLDER, not an empty key that ships: it
   reserves the slot so patchFrontmatter fills the period IN PLACE, at the top,
   where every budget file already on disk carries it. Without it, `period` is
   an unknown key and gets appended BELOW the tags — leaving a household with
   two shapes of the same file depending on which month created which, forever,
   since every later save preserves the order it found. */
const BUDGET_FRONTMATTER = 'period:\ntags: [finance, finance/budget, finance/budget/budgets]';

/* The sentence under the heading that says what window this period covers.

   Pure in its inputs — the month start day, the interval length, the period's
   own start date and the anchor it was counted from — because both writers
   know those and neither should be re-deriving the prose. The Budget page
   passes the start it gets from periodRange(); the wizard passes the period it
   is about to create, which for an interval-shaped period IS its start date.

   Never invent a range you cannot stand behind: every branch here states only
   what the two Settings.md keys actually say, which is why the interval branch
   quotes the anchor rather than working out an end date the loader would
   disagree with. */
function budgetRangeNote({ monthStartDay, intervalDays = 0, periodStart = '', periodAnchor = '' }) {
  const iv = Number(intervalDays) || 0;
  if (iv) {
    return 'With `period_days: ' + iv + '`, this period runs for ' + iv + ' days from ' +
      periodStart + ', counted from `period_anchor: ' + periodAnchor + '`.';
  }
  const n = Number(monthStartDay) || 1;
  if (n === 1) {
    return 'With `month_start_day: 1`, this period is the calendar month — the 1st to the last day of the month.';
  }
  return 'With `month_start_day: ' + n + '`, this period runs from the ' + ordinal(n) +
    ' of the previous month to the ' + ordinal(n - 1) + ' of this month.';
}

/* Correct English ordinal for any day (1st, 2nd, 3rd, 21st, 22nd, 23rd, …).
   The version this replaced hardcoded "rd"/"nd" and only read right for the
   default day 23. English on purpose: this string is the CONTENT of a file in
   the user's vault, not interface copy, and the same rule keeps every other
   line the serializers write out of lang/. */
function ordinal(d) {
  const v = d % 100;
  return d + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th');
}

/* One budget row's amount cell. amountRaw !== null means the strict parser
   rejected what was in the file, so the verbatim original goes back rather
   than a number the user never typed — the same contract the transactions
   schema states for its own money column.

   amountText is the L3-17 half (2026-10-07 round-trip audit): a figure two
   decimals cannot hold (`1234.567`) keeps the cell's own text, written back
   while the row still holds the number it produced. toFixed(2) used to round
   it on any Save of the period. Anything the page sets is written at two
   decimals, as before. */
function amountCell(row) {
  if (row.amountRaw != null) return row.amountRaw;
  const n = Number(row.amount) || 0;
  if (row.amountText != null && parseNum(row.amountText).value === n) return row.amountText;
  return n.toFixed(2);
}

/* The rows of a period file, in the order the file is written (2026-10-07
   round-trip audit, L3-22).

   `order` is the file's own row order as load.js read it — each row's
   category, or null for a row with no category — and `unnamed` the rows with
   no category, in file order (L3-12; they never enter S.budgets, see
   load.js). A row the file already had keeps its place; a row it did not have
   is placed by the type-then-name rule this function used to apply to every
   row, at the last place that rule allows (after the last row that sorts at
   or before it). On a file already in that order this is exactly the old
   full sort, byte for byte; on a file the household ordered by hand, nothing
   they placed moves. It used to re-sort every row, so a Save that changed
   nothing rewrote 7 of the 10 period files on the vault the audit read.

   With no `order` — a new period, or the setup wizard seeding a household's
   first budget — every row is new, and this is the old sort exactly
   (tests/budget-file.test.cjs pins that). */
function budgetFileRows({ rows = [], order = null, unnamed = [], groups = [] }) {
  const types = typeOrder(groups);
  const cmp = (a, b) => typeRank(a.type, types) - typeRank(b.type, types)
    || String(a.category ?? '').localeCompare(String(b.category ?? ''));
  const pool = [...rows];
  const out = [];
  let u = 0;
  for (const key of order || []) {
    if (key == null) { if (u < unnamed.length) out.push(unnamed[u++]); continue; }
    const i = pool.findIndex(r => r.category === key);
    if (i >= 0) out.push(pool.splice(i, 1)[0]);
  }
  while (u < unnamed.length) out.push(unnamed[u++]);
  for (const r of pool) {
    let i = out.length;
    while (i > 0 && cmp(out[i - 1], r) > 0) i--;
    out.splice(i, 0, r);
  }
  return out;
}

/* ISSUE 69, reaching budgets at last (L3-25). A column the household added
   after Notes is carried, never interpreted: `extraCols` (load.js, from
   table-schema.js's extraColsOf) holds its header and separator cells, each
   row its own `extraCells`, and the four cells this file owns are written
   first exactly as before. A row the file did not have (a new category, a row
   copied from another period) writes a blank cell under each extra header;
   a row LONGER than the header keeps its surplus cells too. The same shape as
   table-schema.js's headerLinesWithExtras/rowLineWithExtras, written out here
   because budgets are not on a declared schema (see this module's header). */
function budgetHeaderLines(extraCols) {
  if (!extraCols) return [BUDGET_HEADER, BUDGET_SEPARATOR];
  return [`${BUDGET_HEADER} ${extraCols.headers.join(' | ')} |`, `${BUDGET_SEPARATOR}${extraCols.sep.join('|')}|`];
}
function budgetRowLine(r, extraCols) {
  /* Type goes through escMd like every other text cell. It was the one that
     did not, and a type is as hand-typed as a category name — it comes off a
     category's `type:` frontmatter, and groups.js lets a household name its
     own. A `|` in one sheared the row into five cells: the reader then took
     `wants` as the amount (R4 500 → R0, the strict parser rejecting it into
     amountRaw) and `4500.00` as the note. The next save wrote that back, so
     the amount column permanently held the word `wants`. Escaping only
     changes bytes for a type that actually holds a pipe or a newline —
     parseMdTable already trims every cell, so `expense` writes identically
     and no vault gets a churn diff out of this. */
  const cells = [escMd(r.category), escMd(r.type), amountCell(r), escMd(r.notes)];
  if (extraCols) {
    const extra = r.extraCells || [];
    cells.push(...extraCols.headers.map((_, i) => extra[i] ?? ''));
    if (extra.length > extraCols.headers.length) cells.push(...extra.slice(extraCols.headers.length));
  }
  return `| ${cells.join(' | ')} |`;
}

/* The whole file. `rawFrontmatter` is the verbatim block the loader captured
   (S.budgetMeta[period].raw), so tags, aliases and any hand-added key survive;
   `period` is patched in rather than rewritten around, which is what keeps a
   save from eating frontmatter the in-memory model does not carry.

   Row order is budgetFileRows' (above): the file's own order for rows it
   already had, and the vault's type order then name — the order the Budget
   page shows them in — for every row it did not. `groups` is
   S.settings.groups (src/groups.js): the household's custom groups slot in
   before `expense`, and a type nobody declared sorts last rather than above
   income. `order`, `unnamed` and `extraCols` are S.budgetMeta[period]'s,
   null/empty for a period whose file was never loaded. */
/* ISSUE 67 — leadRaw/trailRaw: a paragraph a household hand-typed above or
   below the table, captured by load.js (splitAroundTable) and replayed here.
   The title and range note are NEVER frozen from disk — rangeNote must keep
   tracking month_start_day/period_days, which is exactly why withLeadExtra
   regenerates freshLeadLines() fresh every save and only reaches past it for
   whatever a reader's own file held beyond that fixed shape. */
function serializeBudgetFile({ period, rawFrontmatter = '', rows = [], rangeNote = '', groups = [], leadRaw = null, trailRaw = null,
  extraCols = null, order = null, unnamed = [] }) {
  /* Defaulted HERE rather than at each call site, so a writer that forgets
     cannot produce a file the vault's own tag searches never see — see
     BUDGET_FRONTMATTER above. A caller with a real block still patches it. */
  const fm = patchFrontmatter(rawFrontmatter || BUDGET_FRONTMATTER, { period });
  const leadLines = withLeadExtra(leadRaw, freshLeadLines(`Budget — ${period}`, [rangeNote]));
  const lines = ['---', fm, '---', ...leadLines, ...budgetHeaderLines(extraCols)];
  for (const r of budgetFileRows({ rows, order, unnamed: unnamed || [], groups })) lines.push(budgetRowLine(r, extraCols));
  lines.push(...(trailRaw ? trailRaw.split(/\r?\n/) : ['']));
  return lines.join('\n');
}

module.exports = { serializeBudgetFile, budgetFileRows, budgetRangeNote, BUDGET_HEADER, BUDGET_FRONTMATTER };
