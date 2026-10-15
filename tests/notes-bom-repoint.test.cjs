'use strict';
/* Re-pointing a note whose file starts with a UTF-8 BOM writes ONE frontmatter
   block (2026-10-14 audit, L3-08).

   views/notes.js carried its own frontmatter regex (splitFm) that did not
   strip a leading BOM, while the loader's parseFrontmatter does. A BOM'd note
   therefore LOADED with its subject and, on a re-point (the About chooser, the
   vault rename watcher's repointNotes), read as a note with no frontmatter:
   patchFile put a second block on top and the household's own properties
   became body text.

   Through the real loader and the real repointNotes. Synthetic note.
     node tests/notes-bom-repoint.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { parseFrontmatter } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const NOTE = '﻿---\nnote_kind: account\nnote_subject: "Cheque"\nnote_for: "[[Cheque]]"\ntags: [finance, call-log]\naliases: [Bank call]\ncreated: 2026-09-01\n---\n\n# Bank call\n\nThey reversed the fee.\n';

(async () => {
  for (const [label, text] of [['BOM', NOTE], ['no BOM', NOTE.slice(1)], ['BOM + CRLF', NOTE.replace(/\n/g, '\r\n')]]) {
    const ctx = makeCtx({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\n---\n',
      [`${B}/Notes/2026-09-01 Bank call.md`]: text,
    });
    const S = await loadInto(ctx);
    eq(S.notes.map(n => n.subject), ['Cheque'], `${label}: precondition: the note loads with its subject`);
    eq(await ctx.repointNotes('account', 'Cheque', 'Current account'), 1, `${label}: the re-point lands`);
    const out = ctx.vault._store.get(`${B}/Notes/2026-09-01 Bank call.md`);
    eq((out.match(/^﻿?---\r?$/mg) || []).length, 2, `${label}: exactly one frontmatter block (two fences)`);
    const fm = parseFrontmatter(out).fm;
    eq(Object.keys(fm).sort(), ['aliases', 'created', 'note_for', 'note_kind', 'note_subject', 'tags'], `${label}: every property is still a property`);
    eq(fm.note_subject, 'Current account', `${label}: the subject moved`);
    eq(fm.tags, '[finance, call-log]', `${label}: and the rest is untouched`);
    ok(out.includes('They reversed the fee.'), `${label}: and so is the body`);
  }
  console.log(`PASS — a BOM'd note re-points in place, one frontmatter block (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
