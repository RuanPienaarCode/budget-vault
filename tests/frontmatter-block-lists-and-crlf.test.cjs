'use strict';
/* Frontmatter lists written the way Obsidian writes them, and the patcher that
   must not eat what it cannot read (2026-10-14 audit, L3-09 and the
   patchFrontmatter half of L3-11).

   L3-09 — a YAML BLOCK list (`ignore_warnings:` then `  - item` lines), the
   shape Obsidian's own Properties panel writes for any list, was read as an
   EMPTY value: parseFrontmatter looked at the `key:` line only. Mutes on an
   account stopped applying, `owners:`/`groups:` in Settings.md read as nothing,
   and the Ignore button then wrote one word over the whole block, deleting
   every word the household had muted. The reader now returns the list the
   one-line form gives (`[a, b]`), so every list reader takes it unchanged, and
   the patcher leaves alone a key whose lines under it it cannot read (a block
   scalar, a nested map) instead of replacing the key and deleting them.

   L3-11 (this half) — patchFrontmatter read CRLF and wrote LF. A block that
   arrives with CRLF leaves with CRLF, added keys included.
     node tests/frontmatter-block-lists-and-crlf.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { parseFrontmatter, patchFrontmatter } = require('../src/markdown');
const { mutedWarnings } = require('../src/acct-status');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const fmOf = block => parseFrontmatter(`---\n${block}\n---\n`).fm;

(async () => {
  /* ---- the reader ---- */
  eq(fmOf('type: cash\nignore_warnings:\n  - no-transactions\n  - unconfirmed\nbalance: 5').ignore_warnings,
    '[no-transactions, unconfirmed]', 'an indented block list reads as the bracketed list');
  eq(fmOf('type: cash\nbalance: 5').balance, '5', 'a key after the list is still read');
  eq(fmOf('owners:\n- Alex\n- Sam\ntype: x').owners, '[Alex, Sam]', 'an unindented block list reads too');
  eq(fmOf('tags:\n  - finance\n  # a note\n\n  - "two words"\nz: 1').tags, '[finance, "two words"]', 'comments and blanks inside the list are skipped, quotes kept');
  eq(fmOf('aliases:\n  - note: with colon\nz: 1'), { aliases: '[note: with colon]', z: '1' }, 'a list item holding a colon is not a key of its own');
  eq(fmOf('a:\nb: 2'), { a: '', b: '2' }, 'a key with nothing under it is still empty');
  eq(fmOf('a: [x, y]\nb: 2'), { a: '[x, y]', b: '2' }, 'the one-line list is untouched');
  eq(fmOf('notes: |\n  text here\nz: 1').notes, '|', 'a block scalar is not mistaken for a list');

  /* the loader, and the consumer that matters */
  const B = 'Budget';
  const ctx = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nowners:\n  - Alex\n  - Sam\n---\n',
    [`${B}/Accounts/Cash.md`]: '---\ntype: cash\nbalance: 500.00\nignore_warnings:\n  - no-transactions\n  - unconfirmed\ntags:\n  - finance\n---\n\n# Cash\n',
  });
  const S = await loadInto(ctx);
  eq(mutedWarnings(S.accounts[0]).size, 2, 'both muted words apply from a block-list file');
  eq(S.settings.owners, ['Alex', 'Sam'], 'Settings.md owners written as a block list are read');

  /* ---- the patcher: a block list is replaced WHOLE by the merged one-line list ---- */
  {
    const raw = 'type: cash\nignore_warnings:\n  - no-transactions\n  - unconfirmed\ntags:\n  - finance';
    const merged = `[${[...mutedWarnings(S.accounts[0]), 'nofolder'].join(', ')}]`;
    const out = patchFrontmatter(raw, { ignore_warnings: merged });
    const back = fmOf(out);
    // no-transactions -> notx, unconfirmed -> stale: acct-status's canonical names
    eq([...mutedWarnings({ ignore_warnings: back.ignore_warnings })].sort(), ['nofolder', 'notx', 'stale'],
      'Ignore on a block-list account keeps the words already muted and adds the new one');
    eq(back.tags, '[finance]', 'and the block list beside it is untouched');
    ok(!/^\s+- (no-transactions|unconfirmed)/m.test(out), 'the old items are not left orphaned under the new value');
  }

  /* ---- the patcher refuses to clobber what it cannot read ---- */
  {
    // A block scalar IS replaced when its key is edited: that is the deliberate
    // collapse tests/frontmatter-comment-lines-kept.test.cjs pins, and a caller
    // only updates a key the household changed.
    const scalar = 'type: cash\ninstitution: >-\n  Long folded\n  bank name\nbalance: 5';
    const out = patchFrontmatter(scalar, { institution: '"New"', balance: '9' });
    eq(out, 'type: cash\ninstitution: "New"\nbalance: 9', 'a block scalar the caller edits is replaced whole');
    const nested = 'type: cash\nmeta:\n  a: 1\n  b: 2\nbalance: 5';
    const outN = patchFrontmatter(nested, { meta: '"x"', balance: '9' });
    ok(outN.includes('meta:\n  a: 1\n  b: 2'), 'a nested map is left as written');
    eq((outN.match(/^meta:/mg) || []).length, 1, 'and the key is not appended a second time');
    ok(/^balance: 9$/m.test(outN), 'while the keys it can read are still patched');
    ok(patchFrontmatter(nested, { meta: null }).includes('meta:\n  a: 1\n  b: 2'), 'and is not removed by a null either');
    const multi = 'title: first line\n  second line\nz: 1';
    ok(patchFrontmatter(multi, { title: '"t"' }).includes('title: first line\n  second line'), 'a plain scalar continued on the next line is left as written');
    // ordinary replacement still works, and the collapse of a LIST is deliberate
    eq(patchFrontmatter('a: 1\nb: 2', { a: '9' }), 'a: 9\nb: 2', 'an ordinary key is still replaced');
    eq(patchFrontmatter('a:\n  - x\n  - y\nb: 2', { a: '[z]' }), 'a: [z]\nb: 2', 'a block list is replaced whole');
    eq(patchFrontmatter('a:\n  - x\nb: 2', { a: null }), 'b: 2', 'and removed whole by a null');
  }

  /* ---- CRLF ---- */
  {
    const crlf = 'type: cash\r\nbalance: 5\r\n# keep\r\nz: 1';
    const out = patchFrontmatter(crlf, { balance: '9', added: '1' });
    eq(out, 'type: cash\r\nbalance: 9\r\n# keep\r\nz: 1\r\nadded: 1', 'a CRLF block comes back CRLF, the added key too');
    ok(!/[^\r]\n/.test(out), 'with no bare LF in it');
    eq(patchFrontmatter('type: cash\nbalance: 5', { balance: '9', added: '1' }), 'type: cash\nbalance: 9\nadded: 1', 'an LF block is joined as it always was');
    eq(patchFrontmatter('', { a: '1', b: '2' }), 'a: 1\nb: 2', 'an empty block is unchanged');
  }

  console.log(`PASS — block lists read, unreadable continuations preserved, CRLF kept by patchFrontmatter (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
