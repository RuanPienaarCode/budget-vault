'use strict';
/* A YAML comment line in a frontmatter block survives a patch of the key
   above it.

   patchFrontmatter's contract is to rewrite only the keys it is handed and
   leave everything else verbatim. Its line grouping treated every line that
   was not a top-level key as a CONTINUATION of the key above — and a `#`
   comment is not a key, so a comment written under `balance:` belonged to
   `balance`, and replacing `balance` deleted it (2026-10-07 audit, L3-08):

       balance: 1234.56
       # per statement, before the card payment cleared   <- gone after the
       balance_updated: 2026-09-30                           next balance save

   A comment belongs to no key — YAML gives it no value and no owner — so it
   is now an entry of its own and is always written back where it stood. Two
   shapes that look like comments are not, and the test pins both:

     - a `#` line INDENTED inside a block scalar (`notes: |`) is text in that
       scalar; it goes with its key when the key is replaced, as the rest of
       the text does,
     - list items AFTER a comment still belong to the key above it. YAML lets
       a comment sit inside a block list, and if the comment took them over,
       replacing the key would leave them orphaned under a scalar — a parse
       error, so Obsidian would drop every property on the file.

   Every expected block in sections 1-3 was checked against a real YAML
   parser while this test was written (PyYAML: each one loads, to the values
   the messages here describe); the test itself stays bare node. Section 4
   pins BYTES for a block with no comment lines — including `cssclasses:wide`,
   which is not strict YAML but is the hand-typed shape the isTopKey comment
   in markdown.js promises to keep as a key of its own.

     node tests/frontmatter-comment-lines-kept.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { patchFrontmatter } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1: a comment line under a patched key -------------------------------- */
const C = 'balance: 1\n# per statement, before the card payment cleared\nother: 2';
eq(patchFrontmatter(C, { balance: '1' }), C, 'replaced with the same figure: the comment stays, byte for byte');
eq(patchFrontmatter(C, { balance: '5' }), 'balance: 5\n# per statement, before the card payment cleared\nother: 2',
  'replaced with a new figure: the comment stays where it stood');
eq(patchFrontmatter(C, { balance: null }), '# per statement, before the card payment cleared\nother: 2',
  'the key removed: the comment stays — it was never the key\'s');
eq(patchFrontmatter(C, { other: '3' }), 'balance: 1\n# per statement, before the card payment cleared\nother: 3',
  'a different key patched: everything else verbatim');
eq(patchFrontmatter('# written by hand\nbalance: 1', { balance: '2' }), '# written by hand\nbalance: 2',
  'a comment above the first key stays (it always did)');
eq(patchFrontmatter('a: 1\n# the end', { a: '2' }), 'a: 2\n# the end', 'a comment after the last key stays');
eq(patchFrontmatter('a: 1\n# the end', { b: 'x' }), 'a: 1\n# the end\nb: x',
  'a new key is still appended at the end, after a trailing comment, as before');
eq(patchFrontmatter('balance: 1\n  # an indented note\nother: 2', { balance: '2' }),
  'balance: 2\n  # an indented note\nother: 2',
  'an indented comment under a plain value is a comment too, and stays');

/* ---- 2: the lines after a comment still belong to the key above it -------- */
const LIST = 'aliases:\n# the old names\n  - Wallet\n  - Purse\ntype: cash';
eq(patchFrontmatter(LIST, { aliases: '[Pocket]' }), 'aliases: [Pocket]\n# the old names\ntype: cash',
  'replacing a block list drops ITS items — including the ones below the comment — and keeps the comment');
eq(patchFrontmatter(LIST, { type: 'savings' }), 'aliases:\n# the old names\n  - Wallet\n  - Purse\ntype: savings',
  'and with the list untouched, every line of it comes back in file order');
eq(patchFrontmatter('tags:\n  # finance tags\n  - finance\nother: 1', { tags: '[x]' }), 'tags: [x]\n  # finance tags\nother: 1',
  'an indented comment inside a list stays when the list is replaced; the items go with their key');

/* ---- 3: a `#` line inside a block scalar is text, not a comment ----------- */
const LIT = 'notes: |\n  line one\n  # part of the note, not a comment\nother: 1';
eq(patchFrontmatter(LIT, { notes: '"x"' }), 'notes: "x"\nother: 1',
  'an indented `#` line in a literal block is that block\'s text, replaced with it');
eq(patchFrontmatter(LIT, { other: '2' }), 'notes: |\n  line one\n  # part of the note, not a comment\nother: 2',
  'and kept verbatim when the block is not patched');
eq(patchFrontmatter('notes: >-\n  folded\n  # also text\nother: 1', { notes: '"y"' }), 'notes: "y"\nother: 1',
  'the same for a folded block with a chomping indicator');
eq(patchFrontmatter('notes: |\n  text\n# a real comment\nother: 1', { notes: '"x"' }), 'notes: "x"\n# a real comment\nother: 1',
  'an UNINDENTED `#` line ends a block scalar, so it is a comment, and stays');

/* ---- 4: a block with no comment lines patches exactly as it always did ---- */
const PLAIN = 'type: checking\nbalance: 10.00\nbalance_updated: 2026-09-30\ntags:\n  - finance\n  - bank\ncssclasses:wide';
eq(patchFrontmatter(PLAIN, { balance: '11.00' }), PLAIN.replace('balance: 10.00', 'balance: 11.00'), 'replace in place');
eq(patchFrontmatter(PLAIN, { budget: 'false' }), `${PLAIN}\nbudget: false`, 'a new key is appended');
eq(patchFrontmatter(PLAIN, { balance_updated: null }), PLAIN.replace('balance_updated: 2026-09-30\n', ''), 'a removed key goes');
eq(patchFrontmatter(PLAIN, { tags: '[finance]' }), 'type: checking\nbalance: 10.00\nbalance_updated: 2026-09-30\ntags: [finance]\ncssclasses:wide',
  'a block list collapses to the scalar it is replaced with, and `cssclasses:wide` is still its own key');
eq(patchFrontmatter('a: 1\na: 2', { a: '3' }), 'a: 3\na: 3', 'a duplicated key: both lines replaced, as before');

/* ---- 5: the account save that lost it ------------------------------------- */
(async () => {
  const B = 'Budget';
  const ACCT = '---\ntype: checking\nbalance: 1234.56\n# per statement, before the card payment cleared\n'
    + 'balance_updated: 2026-09-30\ntags: [finance]\n---\n\n# Cheque\n';
  const ctx = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Accounts/Cheque.md`]: ACCT,
  });
  const S = await loadInto(ctx);
  ctx.render = () => {};
  require('../src/views/accounts')(ctx);
  const a = S.accounts.find(x => x.name === 'Cheque');
  const file = () => ctx.vault._store.get(`${B}/Accounts/Cheque.md`);

  a.balance = 1500; a.balanceRaw = null; a.balance_updated = '2026-10-05';
  ok(await ctx.saveAccount(a), 'a new balance saves');
  eq(file(), '---\ntype: checking\nbalance: 1500.00\n# per statement, before the card payment cleared\n'
    + 'balance_updated: 2026-10-05\ntags: [finance]\n---\n\n# Cheque\n',
  'the balance and its date change; the comment written between them stays where it was');

  a.in_budget = false;
  ok(await ctx.saveAccount(a), 'Exclude saves');
  ok(file().includes('balance: 1500.00\n# per statement, before the card payment cleared\nbalance_updated: 2026-10-05'),
    'Exclude adds its key and leaves the comment alone');
  a.in_budget = true;
  ok(await ctx.saveAccount(a), 'Include saves');
  eq(file(), '---\ntype: checking\nbalance: 1500.00\n# per statement, before the card payment cleared\n'
    + 'balance_updated: 2026-10-05\ntags: [finance]\n---\n\n# Cheque\n',
  'and Include takes its key back out — the comment is still there, and nothing else moved');

  console.log(`PASS — a YAML comment line belongs to no key, and survives every patch around it (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
