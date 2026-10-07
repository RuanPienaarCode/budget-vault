'use strict';
/* A quoted frontmatter value reads the way YAML — and Obsidian — reads it.

   unquoteYaml, parseFrontmatter's reader half of yamlStr, decoded only the
   escapes yamlStr writes (\n \r \t \" \\) and handed every other escape back
   as its bare letter, so the backslash was simply eaten. A household that
   typed `institution: "Caf\u00e9 Bank"` — the YAML way to write é in a
   double-quoted value — saw "Cafu00e9 Bank" on every page, and the next save
   of that key wrote `"Cafu00e9 Bank"` back, making the corruption permanent
   (2026-10-07 audit, L4a). A single-quoted value — `'Bob''s Bank'`, which is
   how YAML quotes a value holding a double quote — was never unquoted at
   all: the app showed the quotes, and a save of that key wrote them INTO the
   value.

   The reference is the reader Obsidian itself parses frontmatter with: the
   `yaml` package bundled in Obsidian 1.13.7 (its double-quoted escape table
   and its single-quoted rule were read out of the app bundle when this was
   written). For a one-line value this decoder now does what that one does:

     - every YAML 1.2 escape decodes: \0 \a \b \t \<TAB> \n \v \f \r \e
       \<space> \" \/ \\ \N \_ \L \P, and \xXX \uXXXX \UXXXXXXXX by code point,
     - an escape YAML does not define — `\q`, or `\x`/`\u`/`\U` without its
       full run of hex digits — is KEPT as written, backslash and all. That
       is what Obsidian's reader does with the value too (it also flags the
       file as invalid YAML); eating the backslash showed the household a
       value that is on neither page. Kept, the next save of the key writes it
       through yamlStr as `\\q` — valid YAML meaning exactly what was shown,
     - a code point past U+10FFFF is kept as written rather than thrown on,
     - a single-quoted value drops its quotes and reads `''` as `'`.

   yamlStr is unchanged and stays this decoder's exact inverse: everything it
   writes decodes as it did, which claim 3 sweeps.

     node tests/yaml-quoted-scalars.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { parseFrontmatter, unquoteYaml, yamlStr } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const read = v => parseFrontmatter(`---\nx: ${v}\n---\n`).fm.x;

/* ---- 1: every escape YAML defines ---------------------------------------- */
for (const [written, meant, what] of [
  ['"Caf\\u00e9 Bank"', 'Café Bank', '\\u with four hex digits — the audit\'s case'],
  ['"Caf\\u00E9"', 'Café', 'upper-case hex'],
  ['"\\x41\\x42"', 'AB', '\\x with two'],
  ['"\\U0001F600 ok"', '\u{1F600} ok', '\\U with eight, past the BMP'],
  ['"a\\0b"', 'a\0b', '\\0'],
  ['"\\a\\b\\v\\f\\e"', '\x07\b\v\f\x1b', '\\a \\b \\v \\f \\e'],
  ['"\\N\\_\\L\\P"', '\x85\xa0\u2028\u2029', '\\N \\_ \\L \\P'],
  ['"a\\/b"', 'a/b', '\\/'],
  ['"a\\ b"', 'a b', 'an escaped space'],
  ['"a\\\tb"', 'a\tb', 'an escaped TAB character'],
  ['"line\\nbreak\\r\\t"', 'line\nbreak\r\t', 'the three yamlStr writes'],
  ['"say \\"hi\\" \\\\ there"', 'say "hi" \\ there', 'an escaped quote and backslash'],
]) eq(read(written), meant, `${what}: ${written} reads as ${JSON.stringify(meant)}`);

/* ---- 2: an escape YAML does not define keeps its backslash ---------------- */
for (const [written, meant, what] of [
  ['"C:\\q"', 'C:\\q', 'an unknown letter'],
  ['"it\\\'s"', 'it\\\'s', 'a backslash-quote YAML does not define'],
  ['"\\x4G"', '\\x4G', '\\x without two hex digits'],
  ['"\\u12"', '\\u12', '\\u cut short at the end of the value'],
  ['"\\uZZZZ!"', '\\uZZZZ!', '\\u followed by no hex at all'],
  ['"\\UFFFFFFFF"', '\\UFFFFFFFF', 'a code point past U+10FFFF, kept rather than thrown on'],
  ['"ends with \\"', 'ends with \\', 'a lone backslash at the very end'],
]) eq(read(written), meant, `${what}: ${written} keeps what was written`);
eq(read('"Caf\\u00e9"'), 'Café', 'and once decoded, it is the character — not the escape');

/* ---- 3: yamlStr's exact inverse ------------------------------------------ */
const SAMPLES = ['', 'plain', 'Café Bank', 'C:\\new\\user', 'C:\\x41', '\\u00e9 literally', 'tab\there',
  'two\nlines', 'cr\ronly', 'quote " inside', 'back\\slash', '\\', '\\\\', 'ends \\', '\u2028', '\x07bell', 'emoji \u{1F600}',
  'Ref: ABC-1', '# not a comment', "it's", "'already single'", '"already double"'];
for (const v of SAMPLES) eq(read(yamlStr(v)), v, `yamlStr then read is the identity — ${JSON.stringify(v)}`);
/* and every pair of the awkward characters, so an escape next to an escape is covered */
const BITS = ['\\', '"', '\n', '\r', '\t', 'u', 'x', 'U', '0', 'e', 'N', '_', 'L', 'P', '/', ' ', 'a', '\'', 'é'];
let pairs = 0;
for (const a of BITS) for (const b of BITS) for (const c of BITS) {
  const v = a + b + c;
  assert.strictEqual(unquoteYaml(yamlStr(v)), v, `unquoteYaml(yamlStr(v)) === v — ${JSON.stringify(v)}`);
  pairs++;
}
ok(pairs === BITS.length ** 3, `every three-character string of those (${pairs}) round-trips exactly`);

/* ---- 4: single-quoted values ---------------------------------------------- */
eq(read("'Bob''s Bank'"), "Bob's Bank", "'' inside single quotes is one quote");
eq(read("'Kids \"school\" fees'"), 'Kids "school" fees', 'a double quote needs no escape inside single quotes');
eq(read("''"), '', 'an empty single-quoted value is empty');
eq(read("'C:\\new'"), 'C:\\new', 'a backslash means nothing inside single quotes');
eq(read("'a' b"), "'a' b", 'text that only STARTS with a quoted part is not a quoted value, and is left as typed');
eq(read("'it's'"), "'it's'", 'nor is one with an undoubled quote inside it');
eq(read('plain: value'), 'plain: value', 'an unquoted value is untouched');

/* ---- 5: through the real loader, and a save of the key -------------------- */
(async () => {
  const B = 'Budget';
  const files = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Accounts/Cafe.md`]: '---\ntype: checking\ninstitution: "Caf\\u00e9 Bank"\nbalance: 10.00\nbalance_updated: 2026-10-01\n---\n\n# Cafe\n',
    [`${B}/Accounts/Bobs.md`]: "---\ntype: checking\ninstitution: 'Bob''s Bank'\nbalance: 20.00\nbalance_updated: 2026-10-01\n---\n\n# Bobs\n",
    [`${B}/Accounts/Drive.md`]: '---\ntype: checking\ninstitution: "C:\\q Bank"\nbalance: 30.00\nbalance_updated: 2026-10-01\n---\n\n# Drive\n',
  };
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  ctx.render = () => {};
  require('../src/views/accounts')(ctx);
  const acct = n => S.accounts.find(a => a.name === n);
  eq(acct('Cafe').institution, 'Café Bank', 'an account written with \\u00e9 loads as Café Bank');
  eq(acct('Bobs').institution, "Bob's Bank", "a single-quoted institution loads without its quotes");
  eq(acct('Drive').institution, 'C:\\q Bank', 'an undefined escape loads exactly as written');

  for (const name of ['Cafe', 'Bobs', 'Drive']) ok(await ctx.saveAccount(acct(name), ['institution']), `${name}: a save that writes the institution lands`);
  const file = n => ctx.vault._store.get(`${B}/Accounts/${n}.md`);
  ok(file('Cafe').includes('\ninstitution: "Café Bank"\n'), 'Café Bank is written back as itself — never as "Cafu00e9 Bank"');
  ok(file('Bobs').includes('\ninstitution: "Bob\'s Bank"\n'), "Bob's Bank is written back without the quotes it was typed in");
  ok(file('Drive').includes('\ninstitution: "C:\\\\q Bank"\n'), 'the kept backslash is written escaped: valid YAML meaning what the page showed');

  const again = makeCtx({ ...files, ...Object.fromEntries(['Cafe', 'Bobs', 'Drive'].map(n => [`${B}/Accounts/${n}.md`, file(n)])) });
  const S2 = await loadInto(again);
  eq(S2.accounts.map(a => a.institution).sort().join(' | '), ["Bob's Bank", 'C:\\q Bank', 'Café Bank'].sort().join(' | '),
    'and all three reload as the same values: a fixed point');

  console.log(`PASS — quoted frontmatter values read the way YAML and Obsidian read them (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
