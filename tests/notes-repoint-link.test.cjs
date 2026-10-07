'use strict';
/* Re-pointing a note wrote a wikilink that creating one never would.

   A note's `note_for` key exists so Obsidian resolves a real link and the
   subject's own file gets a backlink; note-file.js writes it only where it
   RESOLVES — the kind must have a file of its own (accounts, categories) and
   the name must be that file's name, with nothing Obsidian's link syntax eats.
   A category called "Kids/School" lives at Categories/Kids-School.md, so
   `[[Kids/School]]` reaches nothing: a phantom node in the graph, once per note.

   Creation applied that rule (note-file.js noteFmLines). Re-pointing — the
   "Change subject" picker on the Notes page and repointNotes, which the vault
   rename watcher calls — wrote the link for ANY account or category subject:

     note_for: subject && hasOwnNote(kind) ? yamlStr(`[[${subject}]]`) : null

   so one key had two rules depending on which path last wrote it, and moving
   a note onto "Kids/School" planted exactly the phantom the creation rule
   exists to prevent. Both paths now ask one function, and this pins that they
   agree for every shape of name — including that a link which no longer
   resolves is REMOVED rather than left pointing at the old subject.

   Drives the real loader and the real views/notes.js over an in-memory vault.
     node tests/notes-repoint-link.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

const { serializeNote, noteFmLines, NOTES_DIR } = require('../src/note-file');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const BODY = '\n# Fees query\n\nAsked about the termly levy.\n\n- follow up on the 15th\n';
const files = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  /* A display name its file cannot carry: safeSeg turns the slash into a dash,
     so the loader takes the name from frontmatter. */
  [`${B}/Categories/Kids-School.md`]: '---\nname: "Kids/School"\ntype: education\ncolor: "#888888"\n---\n',
  [`${B}/${NOTES_DIR}/2026-10-01 Fees query.md`]:
    '---\ntags: [finance, finance/budget, finance/budget/notes]\nnote_kind: general\nnote_subject: ""\ncreated: 2026-10-01\n---\n' + BODY,
  [`${B}/${NOTES_DIR}/2026-10-02 Statement fee.md`]:
    '---\nnote_kind: account\nnote_subject: "Cheque"\nnote_for: "[[Cheque]]"\ncreated: 2026-10-02\n---\n\n# Statement fee\n\nR15 a month.\n',
});

async function mount() {
  const ctx = makeCtx(files());
  await loadInto(ctx);
  return ctx;
}
const noteForLine = text => (String(text).match(/^note_for: .*$/m) || [''])[0];
const bodyOf = t => t.slice(t.indexOf('\n---', 4) + 4);

(async () => {
  /* ---- 1. the reported case: a general note moved onto "Kids/School" ---- */
  {
    const ctx = await mount();
    const rel = `${NOTES_DIR}/2026-10-01 Fees query.md`;
    const note = ctx.S.notes.find(n => n.rel === rel);
    ok(note, 'the fixture note is loaded');
    const before = await ctx.readFile(rel);
    ok(await ctx.writeNoteSubject(note, 'category', 'Kids/School'), 'the re-point reports success');
    const after = await ctx.readFile(rel);
    ok(after.includes('note_kind: category'), 'the kind moved');
    ok(after.includes('note_subject: "Kids/School"'), 'the subject is recorded, so matching keeps working');
    eq(noteForLine(after), '', 'and NO note_for is written for a name that cannot resolve as a link');
    eq(bodyOf(after), bodyOf(before), 'the body is untouched, as on every note write');
  }

  /* ---- 2. a link that stops resolving is removed, not left stale ---------
     The account note carries [[Cheque]]. Moving it to "Kids/School" must take
     the old link away: left in place it would keep a backlink on an account
     the note no longer claims to be about. */
  {
    const ctx = await mount();
    const rel = `${NOTES_DIR}/2026-10-02 Statement fee.md`;
    const note = ctx.S.notes.find(n => n.rel === rel);
    ok(await ctx.writeNoteSubject(note, 'category', 'Kids/School'), 'the re-point reports success');
    const after = await ctx.readFile(rel);
    eq(noteForLine(after), '', 'the old [[Cheque]] link is removed with nothing phantom in its place');
    ok(!after.includes('[[Cheque]]'), 'no stale wikilink survives anywhere in the frontmatter');

    // ...and onto a name that DOES resolve, the link comes back.
    ok(await ctx.writeNoteSubject(note, 'category', 'Groceries'), 'the second re-point reports success');
    eq(noteForLine(await ctx.readFile(rel)), 'note_for: "[[Groceries]]"',
      'a category whose name is its own filename still gets its link');
  }

  /* ---- 3. one rule for one key: re-point writes what creation writes ------
     For every shape of name, the note_for line a re-point leaves behind is the
     line a freshly created note about the same subject would carry. Two
     writers of one key is this repo's recurring bug shape; this table is what
     keeps them one. */
  {
    const subjects = [
      ['account', 'Cheque'], ['category', 'Groceries'], ['category', 'Kids/School'],
      ['category', 'Home: rates'], ['category', 'Bond [2024]'], ['category', 'Fees|net'],
      ['category', 'Note#1'], ['category', 'Block^ref'], ['account', '  Cheque  '],
      ['debt', 'Car loan'], ['general', ''],
    ];
    for (const [kind, subject] of subjects) {
      const ctx = await mount();
      const rel = `${NOTES_DIR}/2026-10-01 Fees query.md`;
      const note = ctx.S.notes.find(n => n.rel === rel);
      await ctx.writeNoteSubject(note, kind, subject);
      const repointed = noteForLine(await ctx.readFile(rel));
      const created = (noteFmLines({ kind, subject, created: '2026-10-01' }).find(l => l.startsWith('note_for')) || '');
      eq(repointed, created, `re-point and creation agree on note_for for ${kind} "${subject}"`);
    }
    /* Negative control: the creation rule really does refuse "Kids/School",
       so the agreement above is not two empty strings by accident of the
       fixture. */
    ok(!serializeNote({ title: 'x', kind: 'category', subject: 'Kids/School', created: '2026-10-01', body: '' }).includes('note_for'),
      'negative control: creation writes no link for "Kids/School"');
    ok(serializeNote({ title: 'x', kind: 'category', subject: 'Groceries', created: '2026-10-01', body: '' }).includes('note_for: "[[Groceries]]"'),
      'negative control: and does write one for "Groceries"');
  }

  /* ---- 4. the rename path goes through the same writer ------------------- */
  {
    const ctx = await mount();
    const moved = await ctx.repointNotes('account', 'Cheque', 'Kids/School');
    eq(moved, 1, 'repointNotes moved the one note on that subject');
    eq(noteForLine(await ctx.readFile(`${NOTES_DIR}/2026-10-02 Statement fee.md`)), '',
      'and a rename onto an unresolvable name leaves no phantom link either');
  }

  console.log(`PASS — notes: re-pointing writes note_for by the same rule creation does (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
