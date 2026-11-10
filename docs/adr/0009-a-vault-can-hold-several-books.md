# A vault can hold several books, one open at a time, chosen per device

Status: accepted

Until 1.59 a vault held exactly one budget: `settings.budgetFolder` in
`data.json`, read afresh by `basePath()` (`src/io.js`) on every call. A
bookkeeper keeping one book per client — or anyone with a personal and a
business book — had two options: a vault per book, or retyping the folder in
settings every time.

[Discussion #154](https://github.com/RuanPienaarCode/budget-vault/discussions/154)
showed the gap was real and how small the opening was. AyrXZ47's sibling plugin
`obsidian-budget-books` switches books by writing `settings.budgetFolder` and
calling `view.appCtl.reload()` — two private hooks, documented on their side as
unsupported and pinned to 1.54–1.58. It works, and it surfaced the one defect
the naive approach cannot avoid: `budgetFolder` lives in `data.json`, which
syncs, so the open book followed the user to every device and two devices
switching at once conflicted in that file.

## The decision

**A book is a budget folder** — one `Settings.md`, its own `Categories/`,
`Budgets/`, `Transactions/`, `Accounts/` and ledgers. Nothing about a book's
contents changes; this ADR is only about which folder is open.

### 1. The list of books is synced; the open book is not

- `settings.books` (`data.json`, synced): `[{ folder, label }]`. Empty — the
  state every existing vault is in — means **single-book mode**, which is
  byte-for-byte today's behaviour: no switcher, no new keys written.
- The open book is stored **per device**, in vault-scoped local storage
  (`app.loadLocalStorage`/`saveLocalStorage` where the host has them,
  feature-detected, else `window.localStorage` keyed by vault). It never syncs,
  so a phone and a laptop may have different clients open and cannot conflict.
- `settings.budgetFolder` keeps its meaning and becomes the **home book**: the
  first entry of the list, and the fallback whenever the stored open book is
  missing, removed from the list, or names a folder that no longer exists. It is
  never rewritten by a switch — an older build reading this `data.json` still
  opens a real budget, and switching on one device does not move another.

### 2. One seam resolves the open folder

`plugin.activeFolder()` returns the open book's folder, applying the fallback
above. Every reader of `settings.budgetFolder` goes through it — `basePath()`,
`settingsMdPath()`, `hasBudgetData()`, the settings tab's `Budgets/` paths, the
export guard. A second reader that consults `budgetFolder` directly is the
"two figures derived by different rules" defect under a new name: it would read
the home book while the screen shows a client's. A guard test greps `src/` for
direct reads outside the seam.

### 3. A switch is a reload, and it refuses while anything is unsaved

Switching rewrites only the per-device key and calls the existing reload path.
It **refuses** — does not defer — while any page reports unsaved edits through
`ctx.registerDirty`: a deferred switch is exactly how a row typed into client A
lands in client B's files. The reader is told why and nothing changes.

The privacy lock is **not** re-engaged by a switch. The splash exists so that a
glance at the vault shows nothing; it is a session gate, not a per-client
permission, and making it one would mean a tap on every switch. Subscribers to
the headless API are notified through `onChange` exactly as for any reload.

### 4. Books are isolated

No figure is ever computed across books. There is no combined net worth, no
cross-book transfer recognition, no shared categories. The point of the request
is that client numbers never mix, and a combined view would be a new reader of
several books' files with rules of its own — a separate decision if it ever
comes.

The export guard (`destinationProblem` in `src/io.js`) refuses the managed
folders of **every** listed book, not only the open one, so an export cannot be
written into a client's `Transactions/` while another book is open.

### 5. New books are made by the setup wizard

Settings → Books → *Add* asks for a folder and a label and runs the existing
wizard against that folder. The wizard's `apply()` currently assigns
`settings.budgetFolder`; in add-a-book mode it appends to `settings.books` and
sets the per-device open book instead, leaving the home book alone. Pointing
*Add* at a folder that already holds a `Settings.md` registers it without
rewriting it — the wizard's existing *connect* mode.

### 6. The headless API gains a write side (apiVersion 2)

Additive, so every apiVersion 1 consumer keeps working unchanged:

- `books()` → `[{ folder, label, active }]`. In single-book mode, one entry.
  While the privacy lock is closed it answers `{ locked: true }`, the same
  shape `currentPeriod()` uses: a book's label is usually a client's name, and
  the splash promises nothing is on show.
- `setActiveBook(folder)` → resolves `{ ok: true }` or
  `{ ok: false, reason }`, where `reason` is one of `'unknown'` (not in the
  list), `'dirty'` (a page has unsaved edits — rule 3), `'locked'` (the privacy
  lock is closed; a sibling must not be able to read which books exist past a
  lock by switching through them). Never throws for these.
- `currentPeriod()` keeps its three shapes; the figure gains
  `book: { folder, label }`.

This is the surface `obsidian-budget-books` asked for, and it replaces its
private coupling: the sibling becomes a second switcher over the same rules
rather than a writer of our `data.json`.

## What this does not do

- **No per-book display state.** Chart ranges, palette, theme and export folder
  stay global in `data.json`; they are preferences of the reader, not facts of a
  book. A book's own facts already live in its own `Settings.md`.
- **No moving or merging books.** Removing a book from the list forgets it; it
  never touches the folder.
- **No auto-discovery.** A folder becomes a book only by being added. Scanning
  for any folder holding a `Settings.md` would make a copied or archived folder
  appear unasked — and an archived client book is exactly the folder a reader
  copies.
