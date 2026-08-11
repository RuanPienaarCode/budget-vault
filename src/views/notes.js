'use strict';
/* Notes — write something down about an account, a debt, a period, or nothing
   in particular, and find it again later.

   The prose half of a budget. Every other page here holds figures the vault
   can derive; this one holds the things it cannot: what the bank said on the
   phone, why last month looked wrong, which quote you are still waiting on.

   THE DIVISION OF LABOUR WITH OBSIDIAN. This page creates notes, lists them,
   filters them and opens them. It does not EDIT them — the Open button hands
   the file to a real Obsidian tab, which already has a markdown editor,
   wikilink completion, attachments, and sync. Rebuilding a worse one inside a
   view that re-renders on every vault change would be a lot of code to end up
   behind on features and at risk of writing over an edit made in the other
   tab a second earlier.

   Which is why the only write this module makes to an EXISTING note is
   patchFrontmatter (in repointNotes below), and why the body is never
   serialized from state. See the header of src/notes.js. */

const { el, kpiTiles, icoEl } = require('../dom');
const { askFields, confirmModal } = require('../modal');
const { patchFrontmatter, yamlStr } = require('../markdown');
const { todayIso } = require('../dates');
const {
  NOTES_DIR, KIND_LABELS, NOTE_KINDS, hasOwnNote, isTracked,
  uniqueNotePath, serializeNote, notesFor, sortNotes, isOrphan, fold,
} = require('../note-file');

/* Separates kind from subject inside one dropdown value ("account\u001FCash").

   A control character rather than punctuation, because the subject half is a
   name the USER chose: ':', '|', '/' and '-' all turn up in real account and
   debt names, and a separator that can occur inside a subject splits the value
   in the wrong place — filtering to a debt called "Car: Toyota" would go
   looking for a debt called "Car". safeSeg strips \x00-\x1F, so no filename
   this plugin writes can carry one either.

   Written as an escape, and U+001F rather than NUL: a literal control byte in
   the source makes grep treat this file as binary, and a NUL specifically is
   replaced with U+FFFD on some DOM attribute paths — which would break the
   round trip through the <option value> this is packed into. */
const SEP = '\u001F';

module.exports = function registerNotes(ctx) {
  const { S, $, app, vault, toast, writeFile, readFile, fileAt } = ctx;

  /* The filter's SHAPE belongs to this module, so this module seeds it — the
     same split accounts.js makes for S.acctView. It lived in controller.js's
     state block for exactly one build, which was long enough for the view to
     throw on `S.noteFilter.about` anywhere the controller had not run: the
     view module and the only thing that gave its state a value were two files
     apart, and nothing connected them. */
  S.notes = S.notes || [];
  S.noteFilter = S.noteFilter || { about: '', q: '' };

  /* ---------------------- what a note can be about ----------------------
     Read from live state on every call rather than cached: an account created
     on the Accounts page has to be pickable here without a reload, and this
     list is a few dozen strings. */
  function subjectsOf(kind) {
    switch (kind) {
      case 'account': return S.accounts.map(a => a.name);
      case 'category': return S.categories.map(c => c.name);
      case 'debt': return S.debts.map(d => d.name);
      case 'asset': return S.assets.map(a => a.name);
      case 'service': return S.services.map(s => s.name);
      case 'owed': return S.owed.map(o => o.person);
      /* Periods are not a list anyone maintains — they are generated. Offer
         the one being looked at plus the recent past, which is the whole range
         a "why was this month odd" note is ever written about. */
      case 'period': return periodChoices();
      default: return [];
    }
  }

  function periodChoices() {
    const out = [];
    let p = S.period;
    for (let i = 0; i < 12 && p; i++) { out.push(p); p = ctx.shiftPeriod(p, -1); }
    return out;
  }

  /* The flat "About" list behind the one dropdown in the New note dialog and
     the page's own filter.

     One list rather than a kind picker plus a dependent subject picker,
     because askFields builds its controls once and cannot repopulate a
     dropdown when another changes — and because on a phone one scrollable list
     of everything you own beats two taps and a dependency. */
  function aboutOptions({ includeAll = false } = {}) {
    const out = includeAll ? [{ value: '', label: 'Everything' }] : [];
    out.push({ value: `general${SEP}`, label: 'General — not about one thing' });
    for (const kind of NOTE_KINDS) {
      if (kind === 'general') continue;
      for (const name of subjectsOf(kind)) {
        if (!name) continue;
        out.push({ value: kind + SEP + name, label: `${KIND_LABELS[kind]} · ${name}` });
      }
    }
    /* A note whose subject no longer exists still has to be selectable in the
       filter, or the only notes you cannot reach are the ones that most need
       looking at. Added after the live entities so it reads as the tail. */
    const live = new Set(out.map(o => o.value));
    for (const n of S.notes) {
      const v = n.kind + SEP + n.subject;
      if (n.subject && !live.has(v)) {
        live.add(v);
        out.push({ value: v, label: `${KIND_LABELS[n.kind]} · ${n.subject} (missing)` });
      }
    }
    return out;
  }

  const splitAbout = v => {
    const i = (v || '').indexOf(SEP);
    return i === -1 ? { kind: 'general', subject: '' } : { kind: v.slice(0, i), subject: v.slice(i + 1) };
  };

  /* ------------------------------ the list ------------------------------- */

  /* Live names per kind, folded, for the orphan test. Built once per render —
     isOrphan is asked per note, and rebuilding the set inside that loop would
     walk every account for every note. */
  function knownNames() {
    const out = new Map();
    for (const kind of NOTE_KINDS) {
      if (!isTracked(kind)) continue;
      out.set(kind, new Set(subjectsOf(kind).map(fold)));
    }
    return out;
  }

  function visibleNotes() {
    const f = S.noteFilter;
    let list = S.notes;
    if (f.about) {
      const { kind, subject } = splitAbout(f.about);
      list = subject ? notesFor(list, kind, subject) : list.filter(n => n.kind === kind);
    }
    const q = fold(f.q);
    if (q) list = list.filter(n => fold(n.title).includes(q) || fold(n.excerpt).includes(q) || fold(n.subject).includes(q));
    return sortNotes(list);
  }

  function renderNotesKpis() {
    const known = knownNames();
    const tile = kpiTiles($('#notesKpis'));
    tile('Notes', String(S.notes.length));
    /* How many things you have written about, not how many things exist —
       "12 notes across 5 accounts" is the shape of the answer. */
    const subjects = new Set(S.notes.filter(n => n.subject).map(n => n.kind + SEP + fold(n.subject)));
    tile('Subjects', String(subjects.size));
    const orphans = S.notes.filter(n => isOrphan(n, known.get(n.kind) || new Set()));
    tile('Unmatched', String(orphans.length), orphans.length ? 'text-warning' : '',
      orphans.length ? 'subject no longer exists' : '');
  }

  function noteCard(n, known) {
    const orphan = isOrphan(n, known.get(n.kind) || new Set());
    const head = el('div', { class: 'note-card-h' },
      el('button', { type: 'button', class: 'note-title', onclick: () => openNote(n) }, n.title),
      el('span', { class: 'note-date num' }, n.created || ''));

    const meta = el('div', { class: 'note-meta' });
    if (n.subject) {
      meta.append(el('span', { class: `category-badge badge-${n.kind === 'general' ? 'transfer' : 'savings'}` },
        `${KIND_LABELS[n.kind]} · ${n.subject}`));
    } else {
      meta.append(el('span', { class: 'category-badge badge-transfer' }, KIND_LABELS[n.kind]));
    }
    if (orphan) {
      /* Named, not hidden and not auto-corrected. A rename the plugin can
         SEE is repaired for you (see repointNotes); a debt renamed by editing
         a cell in Debts.md, or an account renamed while the plugin was closed,
         cannot be observed at all — so the note says plainly that its subject
         has gone and puts the fix one tap away rather than pretending. */
      meta.append(el('button', {
        type: 'button', class: 'category-badge badge-dup note-orphan',
        title: `Nothing in your ${KIND_LABELS[n.kind].toLowerCase()} list is called "${n.subject}" any more — it was probably renamed. Tap to point this note at something else.`,
        onclick: () => repointOne(n),
      }, icoEl(['unlink', 'link-2off', 'alert-triangle']), 'unmatched'));
    }

    const card = el('div', { class: 'note-card' }, head, meta);
    if (n.excerpt) card.append(el('div', { class: 'note-excerpt' }, n.excerpt));
    card.append(el('div', { class: 'note-actions' },
      el('button', { class: 'btn-ghost btn-ghost-sm', onclick: () => openNote(n) },
        icoEl(['file-pen', 'file-edit', 'pencil']), 'Open'),
      el('button', { class: 'btn-ghost btn-ghost-sm', onclick: () => repointOne(n) },
        icoEl(['link', 'link-2']), 'Change subject'),
      el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Delete ${n.title}`, onclick: () => deleteNote(n) },
        icoEl(['trash-2', 'trash']), 'Delete')));
    return card;
  }

  function renderNotes() {
    renderNotesKpis();

    /* Rebuild the About filter from current state, holding the selection.
       Accounts and debts come and go while the app is open, so a list built
       once at mount goes stale — and a filter that silently drops the subject
       it was set to shows the reader "no notes" for a note that is right
       there. */
    const sel = $('#noteAbout');
    const keep = S.noteFilter.about;
    sel.empty();
    /* Collected as they are built rather than read back off the element
       afterwards: the list is already in hand, and asking the DOM what we just
       put into it is a round trip that answers a question we can answer. */
    const values = [];
    for (const o of aboutOptions({ includeAll: true })) {
      values.push(o.value);
      sel.append(el('option', { value: o.value }, o.label));
    }
    if (values.includes(keep)) sel.value = keep;
    else { sel.value = ''; S.noteFilter.about = ''; }
    $('#noteSearch').value = S.noteFilter.q;

    const list = $('#notesList');
    list.empty();
    const rows = visibleNotes();
    if (!rows.length) {
      const filtered = S.notes.length > 0;
      list.append(el('div', { class: 'note-empty text-muted' },
        filtered
          ? 'No notes match this filter.'
          : `No notes yet. Write one and it lands in ${NOTES_DIR}/ as an ordinary markdown note — editable in Obsidian, and linked to whatever it is about.`));
      return;
    }
    const known = knownNames();
    for (const n of rows) list.append(noteCard(n, known));
  }

  /* ------------------------------ creating ------------------------------- */

  /* `about` pre-selects a subject — passed by the note buttons on the Accounts,
     Debt, Services and Owed pages, so writing a note about the thing you are
     already looking at does not start with finding it in a dropdown. */
  async function addNote(about = '') {
    const options = aboutOptions();
    const preset = options.some(o => o.value === about) ? about : `general${SEP}`;
    const r = await askFields(app, 'New note', [
      { key: 'title', label: 'Title', type: 'text', placeholder: 'What is this about?' },
      { key: 'about', label: 'About', type: 'select', options, value: preset,
        desc: 'Pick an account, debt, service or period — or leave it general.' },
      { key: 'body', label: 'Note', type: 'textarea', rows: 6,
        placeholder: 'Write as much or as little as you like — you can carry on in Obsidian.' },
    ]);
    if (!r) return;
    const title = (r.title || '').trim();
    if (!title) return toast('A note needs a title', true);

    const { kind, subject } = splitAbout(r.about);
    const created = todayIso();
    let rel;
    try {
      rel = uniqueNotePath(created, title, p => !!fileAt(p));
    } catch (e) {
      return toast(e.message || String(e), true);
    }
    await writeFile(rel, serializeNote({ title, kind, subject, created, body: r.body || '' }));

    /* Re-read rather than pushing a hand-built object onto S.notes: what the
       page lists then comes from the same parse as everything else, so a
       serializer/parser disagreement shows up on the first note instead of
       after the next reload. */
    await ctx.loadNotes();
    renderNotes();
    toast(`Created ${NOTES_DIR}/${rel.split('/').pop()}`);
  }

  async function openNote(n) {
    const f = fileAt(n.rel);
    if (!f) { await ctx.loadNotes(); renderNotes(); return toast('That note is no longer in the vault', true); }
    // A new tab, not this one — the budget view is a workspace leaf like any
    // other, and opening in place would close the app the reader is using.
    await app.workspace.getLeaf('tab').openFile(f);
  }

  /* ---------------------------- re-subjecting ----------------------------
     Both the fix for an orphan and the ordinary "actually this belongs to the
     other account". Writes ONLY the frontmatter keys — patchFrontmatter
     re-emits every line it does not model verbatim, so the body, the tags and
     anything the user added by hand come through untouched. */
  async function writeSubject(note, kind, subject) {
    const text = await readFile(note.rel);
    if (text == null) return false;
    const { raw, body } = splitFm(text);
    const updates = {
      note_kind: kind,
      note_subject: yamlStr(subject),
      /* null REMOVES the key — patchFrontmatter's contract. Moving a note from
         an account to a debt has to take the wikilink with it, or the graph
         keeps a link to a note the file no longer claims any relationship to. */
      note_for: subject && hasOwnNote(kind) ? yamlStr(`[[${subject}]]`) : null,
    };
    await writeFile(note.rel, `---\n${patchFrontmatter(raw, updates)}\n---${body}`);
    return true;
  }

  function splitFm(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? { raw: m[1], body: text.slice(m[0].length) } : { raw: '', body: `\n${text}` };
  }

  async function repointOne(n) {
    const options = aboutOptions();
    const cur = n.kind + SEP + n.subject;
    const r = await askFields(app, `What is "${n.title}" about?`, [
      { key: 'about', label: 'About', type: 'select', options,
        value: options.some(o => o.value === cur) ? cur : `general${SEP}` },
    ]);
    if (!r) return;
    const { kind, subject } = splitAbout(r.about);
    if (kind === n.kind && subject === n.subject) return;
    if (!(await writeSubject(n, kind, subject))) return toast('That note is no longer in the vault', true);
    await ctx.loadNotes();
    renderNotes();
    toast('Note re-pointed');
  }

  /* Move every note on one subject to another name.

     The caller is the vault rename watcher in controller.js: an account or
     category note renamed in Obsidian's own file explorer. Obsidian repairs
     the note_for wikilink itself, but not note_subject — which is the key
     everything in here reads — so without this a rename leaves the notes
     looking correctly linked and attached to nothing.

     Returns how many moved, and is silent when nothing matches: the caller
     watches every rename in the vault and should not have to ask first. */
  async function repointNotes(kind, oldSubject, newSubject) {
    if (!oldSubject || oldSubject === newSubject) return 0;
    const hits = notesFor(S.notes, kind, oldSubject);
    if (!hits.length) return 0;
    for (const n of hits) await writeSubject(n, kind, newSubject);
    await ctx.loadNotes();
    return hits.length;
  }

  async function deleteNote(n) {
    const go = await confirmModal(app, {
      title: 'Delete note',
      message: `Move "${n.title}" to your vault trash? The note file goes with it — this does not touch the account or debt it is about.`,
      confirmText: 'Delete note',
    });
    if (!go) return;
    const f = fileAt(n.rel);
    // vault.trash(file, false) — the SYSTEM-trash flag is false, so the file
    // lands in the vault's own .trash and is recoverable from inside Obsidian.
    // Same call categories.js makes when a category file is deleted; a note is
    // prose the user typed, so it earns at least the same care.
    if (f) await vault.trash(f, false);
    await ctx.loadNotes();
    renderNotes();
    toast('Note deleted');
  }

  /* ------------------- the affordance on the other pages -------------------
     A count, and a way in. Rendered next to an account/debt/service name so
     "find the notes I made about this" does not start on a different page.
     Returns a single button either way: no notes yet means "write the first
     one", which is the same gesture. */
  function noteButton(kind, subject) {
    const n = notesFor(S.notes, kind, subject).length;
    const b = el('button', {
      type: 'button', class: 'note-chip' + (n ? ' has-notes' : ''),
      'aria-label': n ? `${n} note${n === 1 ? '' : 's'} about ${subject}` : `Write a note about ${subject}`,
      title: n ? `${n} note${n === 1 ? '' : 's'} about ${subject}` : `Write a note about ${subject}`,
    }, icoEl(['notebook-pen', 'sticky-note', 'file-text']), ...(n ? [String(n)] : []));
    b.addEventListener('click', e => {
      e.stopPropagation();          // these sit inside rows and cards that are themselves clickable
      if (n) showNotesFor(kind, subject);
      else addNote(kind + SEP + subject);
    });
    return b;
  }

  /* Jump to the Notes page with the filter already set. The point of the chip:
     one tap from the account to everything written about it. */
  function showNotesFor(kind, subject) {
    S.noteFilter = { about: kind + SEP + subject, q: '' };
    ctx.switchView('notes');
  }

  /* writeNoteSubject is published as the one primitive that moves a note from
     one subject to another — repointNotes (a whole rename) and repointOne (the
     reader picking from the dropdown) are both just callers of it. Exposed
     rather than kept private because its `note_for` branch is the only place
     the wikilink is REMOVED, and that branch is unreachable through
     repointNotes, which cannot change a note's kind. Untestable-through-the-
     front-door is how a graph fills up with links to files that do not exist. */
  ctx.provide({ renderNotes, addNote, openNote, deleteNote, repointNotes, writeNoteSubject: writeSubject, noteButton, showNotesFor });
};
