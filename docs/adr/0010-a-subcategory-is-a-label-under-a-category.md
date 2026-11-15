# A subcategory is a label under a category: never budgeted, and found by its header

Status: accepted

Until 1.61 the finest thing a transaction could say about itself was its
category. Above the category there is a type, and `Settings.md` can declare
custom groups that slot into the type order (`src/groups.js`); below it there
was nothing.

The request is one **Car** budget with fuel, services and tolls visible under
it. The model offered two ways to get that, and both were wrong:

- **More categories under a group.** Every child needs its own note in
  `Categories/` and its own line in every period's budget, and the reader ends
  up budgeting three figures they only ever wanted to *see*. The Dashboard has
  no spending roll-up by group, so the parent figure would not exist either.
- **Free text in Note.** Searchable, but it cannot be filtered, summed or
  offered in a dropdown, and two spellings are two things.

## The decision

A transaction may carry one **subcategory**: an optional label saying which
part of its category the money went to.

### 1. One level, owned by one category

A subcategory belongs to exactly one category. "Home" under Insurance and
"Home" under Repairs are two subcategories that share a name. There is no
deeper nesting.

Any action that changes a row's category clears its subcategory, unless the
same action sets both (a categorisation rule does). A row with no category
cannot have one. Any category type may have them, income and transfer included.

### 2. It never carries a budget and never moves a figure

Budgets, Plan, the health score and Report stay per category. For any category
and any window, the figures of its subcategories plus the transactions that
have none add up to exactly the category's own figure, refunds signed. A test
pins that sum against the same ledger the Dashboard reads.

This is the property that lets the feature ship without re-auditing a single
number: nothing that existed before reads the new field.

### 3. The names live on the category's own note

`subcategories:` in the category note's frontmatter, comma-separated, the same
shape `groups:` has in `Settings.md`. That list is what the dropdowns offer, in
the order written.

A name found on a transaction but not on the list is still shown and still
offered, after the listed ones. Removing a name from the list only stops
offering it; no row is rewritten. Names match by exact text, as category names
do, and cannot contain a comma.

There is no rename. Categories have none either, and a rename is a rewrite of
many month files in one action.

### 4. The column is found by its header, not its position

`Subcategory` is declared once in `src/table-schema.js` (ADR-0003) and is not
written to a month's transaction file until a row in that file uses one
(ADR-0004). A file with no subcategories never changes by a byte.

Unlike every other declared column, it is located by its header name. This is
the part worth an ADR, because ADR-0003 says the parser is positional and a
reader would expect the next column to sit at position eight, after `Split`.

`Split` is itself optional: `serializeTxFile` writes six columns into a file
with no split. A positional `Subcategory` would have to sit behind it, so every
file that uses a subcategory and has never had a split would grow an empty
`Split` column to hold the place. And a hand-added `Subcategory` column already
survives load and save in 1.61 as an unknown extra, sitting directly after
`Note`, and moves one place right the day a split is first made in that file.
Three shapes of file are therefore already possible, and only a header lookup
reads all of them.

So: a `Subcategory` header found anywhere after the known columns is that
column and stays where it was found. When a file first needs one, it is
appended after every column the file already has.

### 5. A rule can set it, and learns it the way it learns a category

`Data/Categorisation Rules.csv` gains an optional third column. A rule with a
blank subcategory sets the category alone, as every rule does today. Saving a
row on Transactions with both set teaches the pair. The import review shows a
rule's subcategory as text beside the category; it is changed on Transactions.

### 6. Out of sight until used

No dropdown, filter or export column appears until the open book has a
subcategory. Once it does:

- **Transactions**: a second dropdown inside the existing category cell, shown
  on rows whose category has subcategories, ending in "＋ New subcategory…". A
  subcategory filter, and search matches the name.
- **Add transaction**: a dropdown under Category.
- **Budget page**: a Subcategories dialog per category, beside delete, where
  the list is edited and where the first one is created.
- **Dashboard, "Where it went"**: a category with subcategorised spending in
  the window expands in place. An "All transactions" row does what the click
  did before.
- **Exports**: CSV, Markdown, XLSX and the report's JSON gain a Subcategory
  column.

Each part of a split carries its own, set in the table like any other row.

## What this does not do

- **No budget per subcategory.** Whether a child's budget comes out of its
  parent's or adds to it has no obvious answer, and nobody has asked yet.
- **No link to the Food page.** A receipt itemises one slip; a subcategory
  labels one bank line. Joining them would let the Food page move a budget
  figure, which `src/views/food.js` is written never to do.
- **Nothing on the Budget page's figures, Plan, Report, the score or the PDF.**
  They stay per category.
- **Nothing in the headless API.** It exposes no transactions.

## Consequences

- **One existing behaviour changes.** Clicking a Dashboard category that has
  subcategorised spending expands it rather than opening its transactions; that
  is now the second click. Categories without subcategories, and the collapsed
  "Other" row, behave as before.
- **An older build on another device keeps the column but does not understand
  it.** Changing a row's category there leaves the old subcategory on the row.
  It is then a name in use under the new category, and section 3 shows it
  rather than dropping it.
- **Every new string ships in all twelve languages**; `tests/i18n.test.cjs`
  fails otherwise.
