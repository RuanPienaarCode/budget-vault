# A table's columns are declared once, and append is the only cheap operation

Status: accepted

Every markdown-table entity is read positionally (`c[3]`) by `load.js`, written by a
hand-built header row, separator row and row template in its view, and — for
transactions — parsed a third time by a hand-written mirror inside
`tests/serializer-roundtrip.test.cjs`. Three copies of one column order, in three
files, none of which can tell when another moves. `CLAUDE.md` already names
`Debts.md`'s twelve positional columns as the cautionary tale; the 2026-08-13
architecture audit found the mirror comment politely asking future editors to keep
both copies in sync — which is the bug shape this repo keeps re-buying, written down
as policy.

The decision: each flat table's columns are declared **once**, in `src/table-schema.js`,
and that declaration drives the loader, the serializer, and the tests.

## The shape

- **Scope: the five flat tables** — transactions, debts, owed, assets, services.
  Plans, Tax and Budgets are excluded *on purpose*: Plans and Tax hold multiple
  `## section` tables per file with per-section parsing, and Budgets is coupled to
  categories/rules. Fitting them would grow the engine hooks that cost more than the
  duplication they remove. If that ever changes, this ADR changes first.
- **Fat columns.** Each column is `{ key, header, align, read: cell => value,
  write: row => cell }`. The escape pair (`escMd`/`unescMd`), the number pair
  (`parseNum`/`toFixed(2)`), and defaults live inside one declaration, so a write
  rule cannot drift from its read rule. Cross-column fix-ups that a single cell
  cannot express (debts' `original` defaulting to the parsed `balance`) stay in
  `load.js` as one named `post(obj)` step per entity, under the comment that already
  explains them.
- **The engine is pure.** `table-schema.js` sits at the `markdown.js`/`dates.js`
  layer: no Obsidian imports, testable in bare node. It builds header + separator
  lines, reads a cell row into an object, writes an object into a row line, and
  offers `mdTableFile({ fm, fallbackKind, title, prose, schema, rows })` for the four
  single-table files — frontmatter preserved verbatim, `kind:` fallback in one place
  instead of four. Transactions keeps `serializeTxFile`'s own document shape and
  consumes only the line builders.
- **One door stays one door.** The generic row reader is called by `load.js` only.
  Nothing downstream gains a new way to touch raw transaction rows; everything still
  goes through `tx-role.js`.

## Append-only, enforced rather than written down

Files written by older versions of this plugin are still on disk in user vaults —
that is why `splitRole(c[6])` guards a column that post-dates real files. So the
column *order* is history, not style: reordering or inserting mid-table silently
shears every later value into the wrong field of every file already written.

Two of the four `daysBetween` copies this audit found contradicted the rule written
beside the canonical one, so this rule gets tests, not prose:

- **The tripwire.** A guard test holds each entity's frozen historical column-key
  sequence and asserts the live schema *starts with* exactly that prefix. Appending
  passes silently; any reorder, rename or insertion goes red and forces a deliberate
  edit of the frozen list, citing this ADR. This is not the mirror anti-pattern being
  deleted — the mirror re-implemented parsing and could stay green while behaviour
  drifted; a frozen order list cannot drift silently, because going red is its whole
  job.
- **The truncation sweep.** The engine's test feeds every schema a row truncated at
  every possible length and asserts each read yields its documented default rather
  than throwing. "New columns must tolerate absence" stops being a review-time
  reminder and becomes a red build.

## Migration

Engine + both tests first, red-green. Then one entity per commit — assets, services,
owed, debts, transactions last (deleting the test mirror is only safe once the real
loader path demonstrably drives the test). Each entity lands behind a golden gate:
the **current** serializer's byte output and the current loader's parsed state are
captured for a populated fixture before the change, and the new path must produce
**byte-identical** serialization and deep-equal state. Byte-identical, not merely
semantically equal — these files live under iCloud sync, and a whitespace-only
rewrite of every table on first save after upgrade is user-visible churn and a sync
hazard.

Commits go to main per entity (small, always-green increments survive this repo's
concurrent sessions better than a long-lived branch); one release at the end, 1.18.0,
whose changelog honestly says nothing user-visible changed.

## The trap this exists to prevent

Someone adds a column to a serializer's template and header row, sees the table render
correctly, and ships. The loader, three hundred lines away in another file, still
reads the old positions; every file saved from then on loads with each later value in
the wrong field, and the guard tests stay green because the test parses with its own
private copy of the old order. Nothing fails until a user's data is already wrong.
After this ADR, that edit is impossible to make in one place: the column exists only
in the schema, both halves move together, and the tripwire demands the author say out
loud that history is being rewritten.
