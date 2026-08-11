'use strict';
/* Notes — the file contract, and the one invariant that would eat a user's
   prose if it broke.

   Every OTHER file this plugin owns is rebuilt from state on save:
   serializeTxFile, saveBudget and serializeServices all stamp a fixed template
   over whatever was on disk. A note is the exception — it holds paragraphs the
   user typed in Obsidian, so the only write the plugin is allowed to make to
   an existing one is a frontmatter patch. If that ever regresses into "rebuild
   the file from the model", the model has no body to rebuild it from, and the
   note comes back as its own title.

   So the load-bearing check here is 4: re-point a note at a different subject
   and the BODY MUST COME BACK BYTE-IDENTICAL — prose, extra frontmatter, list,
   second heading and all. It carries a negative control, because "the body is
   still there" is easy to assert vacuously against a fixture that never had
   anything in it worth losing.

   The rest pins the contract that makes the page work at all: what the
   serializer writes, the real loader reads back (checks 1-3); a wikilink is
   emitted only where it RESOLVES, or the graph gains a phantom node per note
   (check 3); and a subject that no longer names anything is reported rather
   than hidden (check 6).

   Runs in bare node against the real modules. Wired into ./build.sh.
     node tests/notes.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const notes = require('../src/note-file');
const {
  NOTES_DIR, KIND_LABELS, NOTE_KINDS, hasOwnNote, isTracked, normalizeKind,
  noteFileName, uniqueNotePath, serializeNote, parseNote, noteExcerpt,
  notesFor, sortNotes, isOrphan, unwrapLink,
} = notes;

const B = 'Budget';

/* A vault with one account, one debt, and notes about each. The bodies are
   deliberately awkward — a list, a second heading, a table, a blank line — so
   "the body survived" is a claim with something behind it. */
const ACCOUNT_NOTE_BODY = `
# Discovery fee query

Called the bank on the 3rd. They say the R60 is the monthly account fee and
it does not fall away on this plan.

## What to do next

- ask about the switch to the other plan
- check whether the fee is charged pro-rata

| Month | Fee |
|---|---:|
| July | 60.00 |
`;

function vaultFiles() {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1200.00\nbalance_updated: 2026-07-01\n---\n',

    /* Written the way the plugin writes one, plus two keys it does not model
       (`aliases`, `cssclasses`) — patchFrontmatter has to re-emit those
       verbatim, and a note is precisely the file a user is most likely to have
       added their own frontmatter to. */
    [`${B}/${NOTES_DIR}/2026-08-11 Discovery fee query.md`]:
      '---\n'
      + 'tags: [finance, finance/budget, finance/budget/notes]\n'
      + 'aliases: ["The fee thing"]\n'
      + 'note_kind: account\n'
      + 'note_subject: "Cheque"\n'
      + 'note_for: "[[Cheque]]"\n'
      + 'cssclasses: wide\n'
      + 'created: 2026-08-11\n'
      + '---\n'
      + ACCOUNT_NOTE_BODY,

    // A note about a debt that no longer exists — S.debts is empty below.
    [`${B}/${NOTES_DIR}/2026-08-09 Toyota settlement.md`]:
      '---\nnote_kind: debt\nnote_subject: "Toyota loan"\ncreated: 2026-08-09\n---\n\n# Toyota settlement\n\nThey quoted a settlement figure.\n',

    // No subject at all. Never an orphan, whatever else is missing.
    [`${B}/${NOTES_DIR}/2026-08-10 Ideas.md`]:
      '---\nnote_kind: general\nnote_subject: ""\ncreated: 2026-08-10\n---\n\n# Ideas\n\nMove the emergency fund.\n',
  };
}

async function mount(files = vaultFiles()) {
  const ctx = makeCtx(files);
  await loadInto(ctx);
  return ctx;
}

(async () => {
  /* ---- 1. the real loader reads what the serializer writes ---------------- */
  {
    const ctx = await mount();
    const S = ctx.S;
    eq(S.notes.length, 3, 'every file in Notes/ is loaded');

    const fee = S.notes.find(n => n.title === 'Discovery fee query');
    ok(fee, 'the title comes from the body H1');
    eq(fee.kind, 'account', 'note_kind is read');
    eq(fee.subject, 'Cheque', 'note_subject is read');
    eq(fee.created, '2026-08-11', 'created is read');
    eq(fee.rel, `${NOTES_DIR}/2026-08-11 Discovery fee query.md`, 'the note carries its own relative path');

    /* The excerpt is the first PROSE, not the heading above it and not the
       table below — a card showing "# Discovery fee query" twice, or a row of
       pipes, tells the reader nothing about which note this is. */
    ok(fee.excerpt.startsWith('Called the bank on the 3rd'), `excerpt starts at the prose (got: ${fee.excerpt})`);
    ok(!fee.excerpt.includes('#'), 'the excerpt skips headings');
    ok(!fee.excerpt.includes('|'), 'the excerpt skips table rows');

    // Newest first — the list must not reshuffle between renders.
    eq(S.notes.map(n => n.created), ['2026-08-11', '2026-08-10', '2026-08-09'], 'notes load newest-first');
  }

  /* ---- 2. serialize -> parse round trip, including the nasty scalars ------
     A title with a quote in it makes the whole YAML block unparseable to
     Obsidian if it is written raw — and this plugin's own first-colon parser
     reads it back happily either way, so the breakage is invisible from
     inside the app. That asymmetry is why it is tested. */
  {
    const cases = [
      { title: 'Fee "query" — 3rd', kind: 'account', subject: 'Cheque', created: '2026-08-11', body: 'Body text.' },
      { title: 'Ref: ABC-1', kind: 'debt', subject: 'Car: Toyota', created: '2026-01-02', body: 'Colons everywhere.' },
      { title: 'Back\\slash', kind: 'general', subject: '', created: '2026-03-04', body: '' },
      { title: 'Plain', kind: 'period', subject: '2026-08', created: '2026-08-01', body: 'Odd month.' },
    ];
    for (const c of cases) {
      const round = parseNote(serializeNote(c), `${NOTES_DIR}/${noteFileName(c.created, c.title)}`);
      eq(round.title, c.title, `title survives the round trip: ${c.title}`);
      eq(round.kind, c.kind, `kind survives: ${c.kind}`);
      eq(round.subject, c.subject, `subject survives: ${JSON.stringify(c.subject)}`);
      eq(round.created, c.created, `created survives: ${c.created}`);
    }
  }

  /* ---- 3. note_for is emitted ONLY where it resolves ----------------------
     An unresolvable wikilink is not a harmless extra key: Obsidian draws it as
     a node, so a vault with 40 debt notes gains 40 permanent phantom nodes in
     the graph. Accounts and categories have their own .md; debts, assets,
     services and owed entries are table rows with no file. */
  {
    const withLink = serializeNote({ title: 'A', kind: 'account', subject: 'Cheque', created: '2026-08-11', body: '' });
    ok(withLink.includes('note_for: "[[Cheque]]"'), 'an account note carries a resolvable wikilink');

    const noLink = serializeNote({ title: 'A', kind: 'debt', subject: 'Toyota loan', created: '2026-08-11', body: '' });
    ok(!noLink.includes('note_for'), 'a debt note carries NO wikilink — there is no file for it to resolve to');

    const general = serializeNote({ title: 'A', kind: 'general', subject: '', created: '2026-08-11', body: '' });
    ok(!general.includes('note_for'), 'a general note carries no wikilink');

    eq([...NOTE_KINDS].filter(hasOwnNote), ['account', 'category'],
      'exactly the two kinds backed by a real file get a wikilink');
    // Every kind the picker offers has a label, or the page renders "undefined ·".
    eq(NOTE_KINDS.filter(k => !KIND_LABELS[k]), [], 'every kind has a display label');
  }

  /* ---- 4. THE ONE THAT MATTERS: re-pointing preserves the body ------------ */
  {
    const ctx = await mount();
    const rel = `${NOTES_DIR}/2026-08-11 Discovery fee query.md`;
    const before = await ctx.readFile(rel);

    const moved = await ctx.repointNotes('account', 'Cheque', 'Current account');
    eq(moved, 1, 'the one note on that subject moved');

    const after = await ctx.readFile(rel);
    const bodyOf = t => t.slice(t.indexOf('\n---', 4) + 4);

    eq(bodyOf(after), bodyOf(before),
      'THE INVARIANT: the body comes back byte-identical — prose, list, second heading and table');
    ok(bodyOf(after).includes('| July | 60.00 |'), 'the table in the body is still there');
    ok(bodyOf(after).includes('- ask about the switch'), 'the list in the body is still there');

    // Both keys move together. Rewriting one and not the other is the exact
    // drift that made note_for worth its own comment in src/notes.js.
    ok(after.includes('note_subject: "Current account"'), 'note_subject is re-pointed');
    ok(after.includes('note_for: "[[Current account]]"'), 'note_for is re-pointed with it');
    ok(!after.includes('[[Cheque]]'), 'no stale wikilink is left behind');

    // Unmodeled frontmatter is not collateral damage.
    ok(after.includes('aliases: ["The fee thing"]'), 'an unmodeled frontmatter key survives verbatim');
    ok(after.includes('cssclasses: wide'), 'and so does the second one');
    ok(after.includes('tags: [finance, finance/budget, finance/budget/notes]'), 'tags survive');

    /* Negative control. If the writer ever regressed to rebuilding the file
       from the model — the way every other serializer here works — this is
       what the note would come back as. Asserting the two DIFFER is what stops
       the check above from passing vacuously against an empty body. */
    const rebuilt = serializeNote({
      title: 'Discovery fee query', kind: 'account', subject: 'Current account', created: '2026-08-11', body: '',
    });
    ok(bodyOf(after) !== bodyOf(rebuilt),
      'negative control: a template rebuild would NOT produce this file, so the check above is not vacuous');
    ok(!rebuilt.includes('| July | 60.00 |'), 'negative control: the rebuild really does lose the table');
  }

  /* ---- 5. re-pointing across kinds drops the link; a miss writes nothing --- */
  {
    const ctx = await mount();
    const rel = `${NOTES_DIR}/2026-08-11 Discovery fee query.md`;
    const note = ctx.S.notes.find(n => n.rel === rel);

    /* account -> debt. A debt is a table row with no file of its own, so the
       wikilink has to GO — not be re-pointed at a target that cannot resolve,
       which would leave a permanent phantom node in the graph. This is the
       branch repointNotes cannot reach: it moves a subject, never a kind. */
    ok(await ctx.writeNoteSubject(note, 'debt', 'Toyota loan'), 'the write reports success');
    let after = await ctx.readFile(rel);
    ok(after.includes('note_kind: debt'), 'the kind moved');
    ok(after.includes('note_subject: "Toyota loan"'), 'the subject moved with it');
    ok(!after.includes('note_for'), 'and the now-unresolvable wikilink was REMOVED, not re-pointed');
    ok(after.includes('| July | 60.00 |'), 'the body is still intact across a kind change too');

    // …and back again: moving to a kind that DOES have a file puts it back.
    ok(await ctx.writeNoteSubject(note, 'account', 'Cheque'), 'the write reports success');
    after = await ctx.readFile(rel);
    ok(after.includes('note_for: "[[Cheque]]"'), 'moving back to an account restores the wikilink');

    // A note whose file has gone (deleted in Obsidian mid-session) reports
    // failure rather than throwing or writing a new file at that path.
    eq(await ctx.writeNoteSubject({ rel: `${NOTES_DIR}/gone.md` }, 'debt', 'X'), false,
      'a missing file is reported, not resurrected');

    const ctx2 = await mount();
    const untouched = await ctx2.readFile(`${NOTES_DIR}/2026-08-09 Toyota settlement.md`);
    eq(await ctx2.repointNotes('debt', 'Nothing called this', 'Whatever'), 0, 'a miss moves nothing');
    eq(await ctx2.repointNotes('debt', 'Toyota loan', 'Toyota loan'), 0, 'renaming to the same name is a no-op');
    eq(await ctx2.readFile(`${NOTES_DIR}/2026-08-09 Toyota settlement.md`), untouched,
      'a no-op does not rewrite the file');
  }

  /* ---- 6. an orphan is reported, and only a real one ---------------------- */
  {
    const ctx = await mount();
    const S = ctx.S;
    const known = new Set(S.accounts.map(a => a.name.toLowerCase()));

    const toyota = S.notes.find(n => n.subject === 'Toyota loan');
    ok(isOrphan(toyota, new Set()), 'a debt note whose debt is gone is an orphan (S.debts is empty here)');

    const ideas = S.notes.find(n => n.kind === 'general');
    ok(!isOrphan(ideas, new Set()), 'a general note is never an orphan — having no subject is a choice');

    ok(!isOrphan({ kind: 'period', subject: '2019-04' }, new Set()),
      'a note about an old period is not an orphan — period keys are generated, not named');

    const fee = S.notes.find(n => n.subject === 'Cheque');
    ok(!isOrphan(fee, known), 'an account note whose account exists is not an orphan');
    ok(isOrphan(fee, new Set()), 'and it IS one once that account is gone');

    eq(NOTE_KINDS.filter(isTracked), ['account', 'category', 'debt', 'asset', 'service', 'owed'],
      'exactly the kinds whose subject must name something that exists');
  }

  /* ---- 7. finding a subject's notes tolerates how it was typed ------------ */
  {
    const list = [
      { kind: 'account', subject: 'Cheque' },
      { kind: 'account', subject: ' cheque ' },
      { kind: 'account', subject: 'Savings' },
      { kind: 'debt', subject: 'Cheque' },
    ];
    eq(notesFor(list, 'account', 'CHEQUE').length, 2, 'subject matching folds case and trims');
    eq(notesFor(list, 'debt', 'Cheque').length, 1, 'the kind still has to match');
    eq(notesFor(list, 'account', 'nothing').length, 0, 'a subject with no notes finds none');
    eq(notesFor([], 'account', 'Cheque').length, 0, 'an empty list is not an error');
  }

  /* ---- 8. filenames: unique, legal, and bounded --------------------------- */
  {
    eq(noteFileName('2026-08-11', 'Discovery fee query'), '2026-08-11 Discovery fee query.md', 'the date leads the filename');
    eq(noteFileName('2026-08-11', 'a/b:c'), '2026-08-11 a-b-c.md', 'filesystem-illegal characters are replaced');
    eq(noteFileName('2026-08-11', '   '), '2026-08-11 Note.md', 'a blank title still produces a usable filename');

    /* 255 bytes is the filename limit on every filesystem this ships to, and
       iOS FAILS the write rather than truncating — so a note titled with a
       pasted paragraph must not reach it. */
    const long = noteFileName('2026-08-11', 'x'.repeat(400));
    ok(long.length < 120, `a very long title is capped (got ${long.length} chars)`);
    ok(long.endsWith('.md'), 'and still ends in .md');

    // Two notes with one title on one day is an ordinary thing to do.
    const taken = new Set([`${NOTES_DIR}/2026-08-11 Call.md`, `${NOTES_DIR}/2026-08-11 Call 2.md`]);
    eq(uniqueNotePath('2026-08-11', 'Call', p => taken.has(p)), `${NOTES_DIR}/2026-08-11 Call 3.md`,
      'a same-day, same-title note is suffixed rather than overwriting');
    eq(uniqueNotePath('2026-08-11', 'Call', () => false), `${NOTES_DIR}/2026-08-11 Call.md`,
      'the first one takes the bare name');
  }

  /* ---- 9. odds and ends that would misread a hand-edited note ------------- */
  {
    eq(normalizeKind('Account'), 'account', 'a kind is case-insensitive');
    eq(normalizeKind('nonsense'), 'general', 'an unknown kind falls back to general rather than to nothing');
    eq(normalizeKind(undefined), 'general', 'a missing kind falls back too');

    eq(unwrapLink('[[Cheque]]'), 'Cheque', 'a bare wikilink is unwrapped');
    eq(unwrapLink('[[Cheque|the current one]]'), 'Cheque',
      'an ALIASED wikilink resolves to its target — a user adding an alias must not drop the link');
    eq(unwrapLink('Cheque'), '', 'plain text is not a wikilink');

    eq(noteExcerpt(''), '', 'an empty body has no excerpt');
    eq(noteExcerpt('# Only a heading'), '', 'a body that is only a heading has no excerpt');
    eq(noteExcerpt('# T\n\n- first bullet\n- second'), 'first bullet second', 'bullets are flattened, markers dropped');
    ok(noteExcerpt('x'.repeat(500)).endsWith('…'), 'a long excerpt is elided');
    ok(noteExcerpt('x'.repeat(500)).length <= 181, 'and bounded');

    // A note whose H1 was deleted still needs a title to show on the card.
    const noH1 = parseNote('---\nnote_kind: general\n---\n\nJust prose.\n', `${NOTES_DIR}/2026-08-11 Fallback.md`);
    eq(noH1.title, 'Fallback', 'a missing H1 falls back to the filename, minus the date prefix');
    eq(noH1.created, '2026-08-11', 'a missing created key falls back to the date in the filename');

    // Sorting must be total, or the list reshuffles under the reader.
    const same = [{ created: '2026-01-01', title: 'b' }, { created: '2026-01-01', title: 'a' }];
    eq(sortNotes(same).map(n => n.title), ['a', 'b'], 'notes sharing a date sort by title, stably');
  }

  console.log(`PASS — notes: the body is never rebuilt, and the file contract round-trips (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
