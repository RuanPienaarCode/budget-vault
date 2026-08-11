'use strict';
/* Notes — the pure half. Path building, the frontmatter contract, and reading
   a note back off disk. No DOM, no obsidian import, so it is requirable in
   bare node and guarded by tests/notes.test.cjs.

   WHAT A NOTE IS. One real markdown file per note, under <budget>/Notes/. Not
   a row in a table like Services.md or Owed Money.md, and that difference is
   the whole point: a note is prose the user writes, so it has to be editable
   in Obsidian, searchable by Obsidian, and linked into the graph like any
   other note in the vault. A table cell is none of those things.

   THE ONE INVARIANT THAT MATTERS. **The plugin writes a note's body exactly
   once, when it creates the file, and never touches it again.** Every other
   file this plugin owns is REBUILT from state on save — serializeTxFile,
   saveBudget and serializeServices all stamp a fixed template over whatever
   was there. Doing that to a note would eat the paragraph the user typed in
   Obsidian ten seconds earlier. So the only write this module's callers ever
   make to an existing note is patchFrontmatter, which preserves every line it
   does not model (see markdown.js) — including the entire body.

   HOW A NOTE POINTS AT WHAT IT IS ABOUT. Two keys, deliberately:

     note_kind     account | category | period | debt | asset | service |
                   owed | general — which list the subject lives in.
     note_subject  the subject's plain name ("Discovery Bank Credit Card"),
                   or a period key ("2026-08"), or empty for a general note.

   ...plus a THIRD key for the two kinds that have a note of their own:

     note_for      "[[Discovery Bank Credit Card]]"

   note_for is not read by anything here — note_subject is the machine truth
   and the only key the loader parses. note_for exists so Obsidian resolves a
   real link and the account's own note gets a backlink, which is the reason a
   note is a file rather than a row in the first place. Accounts/ and
   Categories/ have their own .md; debts, assets, services and owed entries are
   table rows with no file, so a wikilink for them would render as a permanent
   unresolved node in the graph. Hence: emitted only where it resolves.

   The cost of that split is that a rename has to move two keys, not one —
   repointNotes in views/notes.js rewrites both together, and rewriting only
   one is what tests/notes.test.cjs check 6 is pinning. */

const { parseFrontmatter, yamlStr } = require('./markdown');
const { safeSeg } = require('./vault-path');

/* The folder, relative to the budget folder. One constant because it is used
   by the loader, the writer and the containment guard's caller. */
const NOTES_DIR = 'Notes';

/* Every kind a note can be about. `general` is last because it is the absence
   of a subject rather than another kind of one, and the pickers render in this
   order. */
const NOTE_KINDS = ['account', 'category', 'period', 'debt', 'asset', 'service', 'owed', 'general'];

const KIND_LABELS = {
  account: 'Account',
  category: 'Category',
  period: 'Period',
  debt: 'Debt',
  asset: 'Asset',
  service: 'Service',
  owed: 'Owed money',
  general: 'General',
};

/* The two kinds whose subject is itself a note in the vault, and therefore the
   two that get a resolvable note_for wikilink. Everything else is a table row
   with no file of its own. */
const LINKED_KINDS = new Set(['account', 'category']);
const hasOwnNote = kind => LINKED_KINDS.has(kind);

/* A kind whose subject has to NAME SOMETHING THAT EXISTS, so a note pointing
   at a name that has since gone is a broken link worth showing.

   Accounts and categories are in the set even though Obsidian repairs the
   note_for wikilink on its own when their file is renamed — because it does
   not touch note_subject, which is the key everything here actually reads. A
   rename done while the plugin is open is caught and repaired by the vault
   rename watcher in controller.js; one done while it is closed is not, and
   this is what surfaces it.

   Out: `period`, whose keys are generated rather than named — a note about
   2025-03 is not broken merely because that period is off the end of the
   dropdown — and `general`, which has no subject at all. */
const TRACKED_KINDS = new Set(['account', 'category', 'debt', 'asset', 'service', 'owed']);
const isTracked = kind => TRACKED_KINDS.has(kind);

/* Normalise a kind read off disk. A hand-edited or future-version note_kind
   falls back to `general` rather than to a filter that matches nothing — the
   note still lists, still opens, and is not silently invisible. */
function normalizeKind(k) {
  const s = (k ?? '').toString().trim().toLowerCase();
  return NOTE_KINDS.includes(s) ? s : 'general';
}

/* A wikilink target, unwrapped. Accepts the "[[Name|Alias]]" form because a
   user editing the note by hand may well add an alias, and reading only the
   bare "[[Name]]" would drop the link on the floor. Returns '' for anything
   that is not a wikilink. */
function unwrapLink(v) {
  const m = /^\s*"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?\s*$/.exec((v ?? '').toString());
  return m ? m[1].trim() : '';
}

/* ------------------------------ file naming -----------------------------
   "2026-08-11 Discovery fee query.md". The date leads so the folder sorts
   chronologically in Obsidian's file explorer without anyone configuring a
   sort, and so two notes with the same title on different days do not collide
   at all. Same-day collisions are settled by uniqueNotePath below.

   Capped at 80 characters of title. A note titled with a pasted paragraph
   would otherwise build a filename past the 255-byte limit every filesystem
   here has — and iOS fails that write rather than truncating it. */
const TITLE_MAX = 80;
function noteFileName(created, title) {
  const seg = safeSeg((title ?? '').toString().trim()).slice(0, TITLE_MAX).trim().replace(/[. ]+$/, '');
  return `${created} ${seg || 'Note'}.md`;
}

/* Free path for a new note. `taken` answers "does this relative path already
   exist?" — the caller passes one backed by the vault. Two notes titled the
   same thing on the same day are a normal thing to do (two calls to the bank),
   so this suffixes rather than refusing. */
function uniqueNotePath(created, title, taken) {
  const base = noteFileName(created, title);
  let rel = `${NOTES_DIR}/${base}`;
  if (!taken(rel)) return rel;
  const stem = base.slice(0, -3);
  for (let n = 2; n < 1000; n++) {
    rel = `${NOTES_DIR}/${stem} ${n}.md`;
    if (!taken(rel)) return rel;
  }
  /* 999 notes with one title on one day is not a real vault, it is a loop
     writing into the plugin. Refuse rather than return a path that is about to
     overwrite note 999. */
  throw new Error('Too many notes with that title today');
}

/* ------------------------------ serializing ------------------------------ */

/* The frontmatter block for a NEW note, as an array of "key: value" lines.
   Everything user-supplied goes through yamlStr — an unescaped quote or a bare
   "Ref: ABC-1" in a title makes the whole block unparseable to Obsidian, which
   then drops the note's properties from the metadata cache while this module's
   own first-colon parser reads it back happily. That mismatch is invisible
   from inside the app, which is exactly what makes it worth spending a helper
   on. See the note above yamlStr in markdown.js. */
function noteFmLines({ kind, subject, created }) {
  const k = normalizeKind(kind);
  const subj = (subject ?? '').toString().trim();
  const lines = [
    'tags: [finance, finance/budget, finance/budget/notes]',
    `note_kind: ${k}`,
    `note_subject: ${yamlStr(subj)}`,
  ];
  /* Only where it resolves — see the header. An unresolvable wikilink is not
     a harmless extra, it is a permanent phantom node in the graph, once per
     note. */
  if (subj && hasOwnNote(k)) lines.push(`note_for: ${yamlStr(`[[${subj}]]`)}`);
  lines.push(`created: ${created}`);
  return lines;
}

/* The complete file text for a new note. The H1 repeats the title because
   Obsidian does not show the filename as a heading in reading view, and a note
   opened from the page should look like the thing that was just created. */
function serializeNote({ title, kind, subject, created, body }) {
  const t = (title ?? '').toString().trim() || 'Note';
  const text = (body ?? '').toString().trim();
  return ['---', ...noteFmLines({ kind, subject, created }), '---', '', `# ${t}`, '', text, ''].join('\n');
}

/* ------------------------------- reading -------------------------------- */

/* First real prose in the body, flattened to one line for the list.

   Deliberately crude: it strips the leading #-heading, list bullets, blockquote
   markers and table rows, and stops at the first blank line after it has found
   something. It does NOT try to render markdown — the excerpt is a hint to
   help you recognise a note you wrote, and anything cleverer here would be a
   second markdown renderer to keep correct for no gain. */
const EXCERPT_MAX = 180;
function noteExcerpt(body, max = EXCERPT_MAX) {
  const out = [];
  for (const raw of (body ?? '').toString().split('\n')) {
    const line = raw.trim();
    if (!line) { if (out.length) break; continue; }
    if (/^#{1,6}\s/.test(line)) continue;          // a heading, including the title
    if (/^-{3,}$/.test(line)) continue;            // a rule, or a stray fence
    if (/^\|/.test(line)) continue;                // a table
    out.push(line.replace(/^[>\-*+]\s*/, '').replace(/^\d+\.\s*/, ''));
    if (out.join(' ').length >= max) break;
  }
  const text = out.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/* Parse a note file into the shape the view lists.

   `path` is only used to recover a title when the body has no H1 — a note the
   user created in Obsidian by hand, or one whose heading they deleted. The
   date prefix comes off so the title reads as a title. */
function parseNote(text, path = '') {
  const { fm, body } = parseFrontmatter(text ?? '');
  const kind = normalizeKind(fm.note_kind);
  /* note_subject is the machine truth; note_for is only consulted when it is
     absent, which covers a note a user wired up by hand with a wikilink and no
     subject key. Reading them the other way round would let a stale wikilink
     win over the key the plugin maintains. */
  const subject = unyaml(fm.note_subject) || unwrapLink(fm.note_for);
  const base = (path.split('/').pop() || '').replace(/\.md$/, '');
  const h1 = /^#\s+(.+)$/m.exec(body || '');
  return {
    kind,
    subject,
    created: unyaml(fm.created) || firstDate(base),
    title: (h1 ? h1[1].trim() : base.replace(/^\d{4}-\d{2}-\d{2}\s+/, '')) || 'Untitled note',
    excerpt: noteExcerpt(body),
  };
}

/* The other half of yamlStr. parseFrontmatter already takes the outer quotes
   off a "…" scalar, but it leaves the ESCAPES inside — so a note about
   `Fee "query"`, written correctly as "Fee \"query\"", reads back with the
   backslashes still in it and renders them on the page.

   Applied unconditionally rather than only to values that arrived quoted,
   because parseFrontmatter does not report which those were. The cost is that
   a literal backslash-quote in an UNQUOTED hand-written value loses its
   backslash; YAML gives that sequence no meaning unquoted anyway, and the
   alternative is showing escape characters to everyone who ever types an
   apostrophe-free quotation mark. */
function unyaml(v) {
  return (v ?? '').toString().trim().replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
function firstDate(base) {
  const m = ISO_PREFIX.exec(base || '');
  return m ? m[1] : '';
}

/* --------------------------- matching & sorting -------------------------- */

/* Does this note belong to (kind, subject)? Subject comparison is
   case-insensitive and whitespace-trimmed, because the same account gets typed
   two different ways over a year and a note that does not show up on the
   account it is plainly about reads as a lost note. */
const fold = s => (s ?? '').toString().trim().toLowerCase();
function notesFor(notes, kind, subject) {
  const k = normalizeKind(kind);
  const s = fold(subject);
  return (notes || []).filter(n => n.kind === k && fold(n.subject) === s);
}

/* Newest first, then by title so the order is stable when several notes share
   a date — an unstable list reshuffles under the reader on every render. */
function sortNotes(notes) {
  return [...(notes || [])].sort((a, b) =>
    (b.created || '').localeCompare(a.created || '') || (a.title || '').localeCompare(b.title || ''));
}

/* A note whose subject no longer names anything — see TRACKED_KINDS. `known`
   is the set of live names for that kind, folded the same way notesFor folds.

   A note with no subject at all is never an orphan: that is a general note,
   which is a choice rather than a dangling reference. */
function isOrphan(note, known) {
  if (!isTracked(note.kind) || !note.subject) return false;
  return !known.has(fold(note.subject));
}

module.exports = {
  NOTES_DIR, NOTE_KINDS, KIND_LABELS, TITLE_MAX, EXCERPT_MAX,
  hasOwnNote, isTracked, normalizeKind, unwrapLink,
  noteFileName, uniqueNotePath, noteFmLines, serializeNote,
  noteExcerpt, parseNote, notesFor, sortNotes, isOrphan, fold,
};
