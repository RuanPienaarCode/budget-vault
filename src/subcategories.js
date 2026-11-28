'use strict';
/* Subcategories — the pure rules (ADR-0010).

   A subcategory is an optional label on a transaction saying which part of its
   category the money went to: fuel, services or tolls under Car. It is owned by
   one category, never carries a budget, and never moves a figure. Everything
   here is the small set of rules that more than one page has to agree on, kept
   out of the views so a guard test can run them in bare node:

     - the list on a category note (`subcategories:` — the same comma shape
       `groups:` has in Settings.md), read and written;
     - the name a reader types: what is refused and why;
     - a row's category and subcategory travelling together — the ONE place a
       row's category is changed, so no path can forget to clear the label;
     - which names a dropdown offers: the listed ones, then any a row carries
       that the list does not, because the plugin never hides what a file says;
     - whether the open book uses them at all, which is what keeps every control
       out of sight for the household that never wants them;
     - the filter's one sentinel;
     - the rows a Dashboard category expands into, and the whole-unit figures
       printed beside them.

   Names match by exact text, as category names do. There is no rename: a
   category has none either, and a rename is a rewrite of many month files in one
   action. Pure: no DOM, no Obsidian, no clock. */

/* "No subcategory" in the Transactions filter. Contains a comma, which no name
   can (checkSubcategoryName refuses one, and the list is comma-separated), so it
   can never be mistaken for a name the reader has used. */
const NO_SUBCATEGORY = '__no,subcategory__';

const { largestRemainder } = require('./share-percents');

const QUOTE_PAIRS = [['"', '"'], ["'", "'"]];

/* Unwrap ONE matching pair of quotes. For a whole scalar, only when the same
   quote does not also appear inside: `"Fuel", "Tolls"` starts and ends with a
   quote and is two quoted names, not one name containing quotes. */
function unwrap(s, whole) {
  for (const [open, close] of QUOTE_PAIRS) {
    if (s.length >= 2 && s[0] === open && s[s.length - 1] === close) {
      const inner = s.slice(1, -1);
      if (!whole || (!inner.includes(open) && !inner.includes(close))) return inner.trim();
    }
  }
  return s;
}

/* The names on a category note, in the order written.

   Takes what load.js's frontmatter reader hands back for the key: a comma
   string, the bracketed string it builds for a YAML block list, or a real array
   (metadataCache). A name is trimmed and loses the quotes it was written with;
   blanks and exact repeats are dropped; case is kept, so "Fuel" and "fuel" are
   two names. Never throws — an unreadable value is no names, not an error, the
   way an absent one is. */
function parseSubcategories(raw) {
  if (raw === undefined || raw === null) return [];
  let text = Array.isArray(raw) ? raw.map(v => String(v ?? '')).join(',') : String(raw);
  text = text.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim();
  text = unwrap(text, true);
  const out = [];
  for (const part of text.split(',')) {
    const name = unwrap(part.trim(), false);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/* The value written to the note. The caller quotes it (markdown.js yamlStr), as
   Settings.md's `groups:` is written. Empty for no names, which the writer reads
   as "remove the key" so a note that never had one never gains an empty one. */
function formatSubcategories(names) {
  return (names || []).join(', ');
}

/* What a reader typed as a new name: `{ name }` trimmed and ready, or
   `{ error }` naming why not, for the caller to say in the reader's language.
   A comma is refused because the list is comma-separated — it would come back
   as two names. A repeat is exact text, so only the same spelling is refused. */
function checkSubcategoryName(raw, existing) {
  const name = String(raw ?? '').trim();
  if (!name) return { error: 'empty' };
  if (name.includes(',')) return { error: 'comma' };
  if ((existing || []).includes(name)) return { error: 'duplicate' };
  return { name };
}

/* The label a row carries, '' for none. A row with no category cannot have one
   (ADR-0010 §1), so a hand-edited cell on an uncategorised row reads as none
   here — the file keeps the text, nothing counts it. */
function subcategoryOf(row) {
  if (!row || !row.cat || typeof row.subcategory !== 'string') return '';
  return row.subcategory.trim();
}

/* THE way a row's category is changed. A subcategory belongs to one category,
   so any change of category clears it — unless the same action sets both, which
   a categorisation rule does. Setting the category a row already has is not a
   change and leaves the label alone.

   The key is deleted, not blanked: a row that has none has no field, which is
   what a row loaded from a file with no Subcategory column looks like, so
   nothing downstream can tell the two apart. Returns whether the category
   changed. A subcategory offered with no category is dropped — it would belong
   to nothing. */
function setRowCategory(row, cat, subcategory) {
  const next = cat || '';
  const changed = (row.cat || '') !== next;
  if (changed) { row.cat = next; delete row.subcategory; }
  if (subcategory !== undefined) {
    const name = String(subcategory ?? '').trim();
    if (next && name) row.subcategory = name; else delete row.subcategory;
  }
  return changed;
}

/* THE way a categorisation rule's category is changed — setRowCategory's rule,
   for the object the rules file holds (`category`, not `cat`). A rule's
   subcategory belongs to its category exactly as a row's does, so repointing a
   rule at another category must not leave the old one's label on it: the next
   import would file a row under Home with Fuel, a name Home has never listed.

   Delegates rather than repeats: the same function decides what "a change" is
   and what a blank or a label with no category means, so a row and the rule
   that files it cannot disagree. Returns whether the category changed. */
function setRuleCategory(rule, category, subcategory) {
  const view = { cat: rule.category };
  if (typeof rule.subcategory === 'string') view.subcategory = rule.subcategory;
  const changed = setRowCategory(view, category, subcategory);
  rule.category = view.cat;
  if (typeof view.subcategory === 'string') rule.subcategory = view.subcategory; else delete rule.subcategory;
  return changed;
}

/* Every name rows carry, per category: Map(category -> sorted distinct names).
   `rows` is any iterable of raw rows. Built in one pass so a page drawing a
   hundred dropdowns asks once, not once per row. */
function inUseByCategory(rows) {
  const sets = new Map();
  for (const r of rows || []) {
    const sub = subcategoryOf(r);
    if (!sub) continue;
    if (!sets.has(r.cat)) sets.set(r.cat, new Set());
    sets.get(r.cat).add(sub);
  }
  const out = new Map();
  for (const [cat, set] of sets) out.set(cat, [...set].sort((a, b) => a.localeCompare(b)));
  return out;
}

/* What a dropdown offers for one category: the listed names in the order
   written, then the ones rows carry that the list does not. A name removed from
   the list therefore stays offered for as long as any row uses it. */
function offeredNames(listed, inUse) {
  const out = [];
  for (const n of listed || []) if (!out.includes(n)) out.push(n);
  for (const n of inUse || []) if (!out.includes(n)) out.push(n);
  return out;
}

/* Does this book use subcategories at all — a name on any category note, or on
   any categorised row. Until it does, no dropdown, filter or dialog entry point
   adds a control (the Budget page's Subcategories dialog is the exception: it
   is how the first name is made). */
function bookUsesSubcategories(categories, rows) {
  for (const c of categories || []) if (c && c.subcategories && c.subcategories.length) return true;
  for (const r of rows || []) if (subcategoryOf(r)) return true;
  return false;
}

/* The same question of a loaded book: `state` is the plugin's S, whose
   categories and per-month transaction files (S.txFiles, { key: { rows } }) are
   the whole book. The exports ask it, and the Transactions page asks the same of
   the same two lists, so a book that shows a Subcategory control also exports the
   column and one that does not never does. Never throws on a state with neither. */
function bookUsesSubcategoriesIn(state) {
  const s = state || {};
  function* rows() { for (const f of Object.values(s.txFiles || {})) for (const r of (f && f.rows) || []) yield r; }
  return bookUsesSubcategories(s.categories, rows());
}

/* The Transactions subcategory filter. '' keeps every row; NO_SUBCATEGORY keeps
   the rows with none (uncategorised rows included — they have none); any other
   value is an exact name. */
function matchesSubcategory(row, filter) {
  if (!filter) return true;
  const sub = subcategoryOf(row);
  return filter === NO_SUBCATEGORY ? sub === '' : sub === filter;
}

/* The rows a Dashboard category expands into (issue #186). `entry` is one value
   of ledger.subcategoryTotals(): the category's own figure split by subcategory,
   in byCat's sign. Taken from the ledger rather than recounted here, so the rows
   are the rows behind the category's printed figure, chosen once by the lens —
   and they add up to it, the ADR-0010 section 2 partition.

   Null unless at least one KEPT row carries a subcategory: a category whose only
   labelled rows are excluded, or sit in an account the budget holds out, is not
   expanded, because the figure being explained does not contain them. Such a
   category behaves exactly as it did before.

   Rows come back in the legend's own sign (money out positive) and order
   (biggest first, a tie by name so the order is the same on every render), with
   the rows that have none last: they are the remainder, not a part the reader
   chose. A subcategory that nets to nothing is still a row, because it has rows;
   the "none" row is shown only when what is left nets to something, since the
   ledger keeps no count to say otherwise. A refund-heavy subcategory is a
   negative amount, signed in rather than dropped. Never throws. */
function breakdownOf(entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.subs) || !entry.subs.length) return null;
  const spend = v => (v ? -v : 0);               // -0 would print as a sign
  const subs = entry.subs
    .filter(s => s && typeof s.name === 'string' && s.name)
    .map(s => ({ kind: 'sub', name: s.name, amount: spend(s.amount) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  if (!subs.length) return null;
  const none = spend(entry.none);
  if (none) subs.push({ kind: 'none', name: '', amount: none });
  return subs;
}

/* The whole-unit figures printed beside those rows, so the rows add up to the
   category's own printed figure AS PRINTED. Each amount rounded alone can miss
   the category by a unit, and the reader adding the rows up would find a figure
   the legend never claimed — the trap the legend's own money column closes the
   same way (dashboard.js, rowMoney). `printed` is that column's value for the
   category, which is itself an allocation and not necessarily round(x); the
   parts are distributed to it by largest remainder, so each stays within a unit
   of its own amount and the sum is exact. Input untouched; same order. */
function printedRows(rows, printed) {
  const shown = largestRemainder(rows.map(r => r.amount), printed);
  return rows.map((r, i) => ({ ...r, shown: shown[i] || 0 }));
}

module.exports = {
  NO_SUBCATEGORY, parseSubcategories, formatSubcategories, checkSubcategoryName,
  subcategoryOf, setRowCategory, setRuleCategory, inUseByCategory, offeredNames, bookUsesSubcategories, bookUsesSubcategoriesIn,
  matchesSubcategory, breakdownOf, printedRows,
};
