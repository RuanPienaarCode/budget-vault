'use strict';
/* THE SHIPPED STYLESHEET IS THE SOURCES WITH THEIR COMMENTS AND WHITESPACE
   TAKEN OUT — AND NOTHING ELSE.

   The sources under src/ are commented far more heavily than most CSS, on
   purpose: the comments carry why a rule exists and what broke without it.
   They are for whoever edits src/, not for WebKit. Until November 2026 the
   build shipped them anyway — root styles.css was the bare concatenation, 598 KB
   of which 37.6% was comment, downloaded, synced and tokenised on every plugin
   load. The build now writes scripts/css-sources.cjs `shipped()`: the same
   assembly passed through esbuild with whitespace minification only, 332 KB.

   "Without changing behaviour" is the whole risk of that sentence, so it is
   the thing proved here, two ways that do not share a weakness:

     A. ROUND TRIP. The assembled sources and the shipped sheet are each
        re-printed by esbuild in its ordinary, un-minified form; the two
        printings must be identical. That is "they parse to the same rules, in
        the same order, with the same values" — and it is what notices a
        significant space going missing (`.a .b` printed as `.a.b` is a
        different selector, and re-prints differently).
     B. BY HAND, WITHOUT ESBUILD'S PARSER. Both texts have their comments,
        whitespace and quote marks removed by three regexes and must then be
        the same string. This cannot see a lost space, which is what A is for.
        It sees what A cannot: A trusts esbuild to read the sources correctly
        in the first place, and B does not use it to read anything.

   Quote marks are dropped in B because they are the one thing whitespace
   minification rewrites: `[role='table']` ships as `[role=table]` and
   `'Segoe UI'` as `"Segoe UI"`. Those are the same selector and the same
   string. When this was written they were all 269 differences between the
   two texts.

   WHITESPACE ONLY, DELIBERATELY. esbuild's full `minify` would also rewrite
   values and merge rules (`#ffffff` to `#fff`, longhands into shorthands), and
   with a `target` it would lower syntax it believes the floor lacks — in a
   sheet whose iOS 15 fallbacks are hand-written `@supports` pairs that
   css-scorecard-lint and focus-visible-fallback hold in a particular shape.
   Measured, the full pass saves a further 1,885 bytes, 0.6%. That is not worth
   a stylesheet no guard test has read: every CSS guard reads the SOURCES
   (tests/helpers/css-sources.cjs), and they can only speak for the shipped
   file while the shipped file is the sources, token for token. Proof B is what
   fails if someone turns the full pass on.

   The planted controls at the bottom show each proof firing on the damage it
   is there for.

   Nothing here asserts on the size of the root file on disk — that is build
   output and may be stale mid-edit. Sizes are computed from the sources.

   Needs the dev dependencies (esbuild).  node tests/css-shipped-minified.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const ROOT = path.join(__dirname, '..');
const { assemble, shipped, FONT_NOTICE } = require('../scripts/css-sources.cjs');
const esbuild = require('esbuild');

const source = assemble();
const out = shipped();

/* ---- 1. deterministic: the scorecard rebuilds this and compares bytes ---- */
eq(shipped(), out, 'shipped() gives the same bytes on every call');
eq(shipped(source), out, 'and is a pure function of the assembled text');

/* ---- 2. it is actually smaller, and holds no comment but the notice ---- */
const bytes = s => Buffer.byteLength(s, 'utf8');
const ratio = bytes(out) / bytes(source);
ok(ratio < 0.65, `the shipped sheet is under 65% of the assembled sources (${bytes(out)} of ${bytes(source)} bytes, ${(ratio * 100).toFixed(1)}%)`);
const comments = out.match(/\/\*[\s\S]*?\*\//g) || [];
eq(comments.length, 1, 'the shipped sheet carries exactly one comment');
ok(out.startsWith(comments[0] + '\n'), 'and it is the first thing in the file');
const body = out.slice(comments[0].length);
ok(body.startsWith('\n') && body.endsWith('\n') && !body.trim().includes('\n'),
  'the rules themselves are one line under it — no indentation or blank lines left');

/* ---- 3. the font's notice travels with the font ----
   The sheet embeds Geist, which is SIL OFL 1.1: a copy may be bundled with
   software provided the copyright notice and the licence travel with it, as a
   text file, a human-readable header, or the font's own metadata. The woff2's
   name table carries the copyright line and the licence URL, and NOTICE and
   assets/fonts/OFL-Geist.txt carry the rest — but styles.css is published as a
   release asset ON ITS OWN, with neither file beside it, so the header stays.
   The copyright line is read from the licence file, as tests/fonts.test.cjs
   reads it for NOTICE, so the two cannot drift. */
const copyright = fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'OFL-Geist.txt'), 'utf8').split('\n')[0].trim();
ok(/^Copyright /.test(copyright), 'the OFL text opens with the font\'s copyright line');
eq(comments[0], FONT_NOTICE(), 'the one comment is the notice scripts/css-sources.cjs builds');
ok(comments[0].includes(copyright), `the notice repeats Geist's copyright line verbatim: ${copyright.slice(0, 50)}…`);
ok(/SIL Open Font License, Version 1\.1/.test(comments[0]), 'names the licence');
ok(/https:\/\/openfontlicense\.org/.test(comments[0]), 'says where its text is');
ok(/build output/i.test(comments[0]) && /src\//.test(comments[0]),
  'and still tells whoever opens the file that it is build output, edited in src/');
ok(/^[\x20-\x7e\n]*$/.test(comments[0]), 'in plain ASCII, so the file needs no @charset to be read correctly');

/* ---- 4. proof A: both sides re-print identically ---- */
const pretty = css => esbuild.transformSync(css, { loader: 'css', charset: 'utf8', legalComments: 'none' }).code;
ok(pretty(source) === pretty(body),
  'the shipped sheet parses to exactly the rules the sources do, in the same order — '
  + 're-printed un-minified, the two differ. A rule, a value or a significant space was changed by minifying');

/* ---- 5. proof B: the same text once comments, whitespace and quotes go ---- */
const bare = css => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').replace(/;}/g, '}').replace(/['"]/g, '');
const firstDifference = (a, b) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? null : `at ${i}: sources "${a.slice(i - 40, i + 40)}" vs shipped "${b.slice(i - 40, i + 40)}"`;
};
eq(firstDifference(bare(source), bare(out)), null,
  'with comments, whitespace and quote marks removed, the shipped sheet is character for character the sources — '
  + 'if this fails the minifier rewrote a value or merged a rule, which the CSS guards (they read the sources) never saw');

/* ---- 6. what the deploy script looks for is still spelled that way ----
   ~/.claude/skills/obsidian-plugin-dev-loop/scripts/dev-loop.sh greps the
   SHIPPED file, not the sources, for the two iOS 15 fallbacks. It lives
   outside this repo and cannot be changed from here, so the spellings it
   matches are pinned where a change to the minifier would break them. */
ok(out.includes('@supports not selector(:focus-visible)'), 'the :focus-visible fallback keeps the spelling dev-loop.sh greps for');
ok(/@supports[^{]*color-mix\(/.test(out), 'and so does the color-mix() guard');

/* ---- 7. the build wrote exactly this ---- */
const built = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
ok(built === out, 'root styles.css is not what the build writes from the sources — run npm run build '
  + '(or it was hand-edited: it is build output, put the rule in src/)');

/* ---- controls: each proof fires on the damage it is there for ---- */
{
  /* A lost significant space. Invisible to B by construction; A must see it. */
  const at = body.indexOf('.budget-app-root .');
  ok(at >= 0, 'fixture: the shipped sheet has a descendant selector to damage');
  const glued = body.slice(0, at) + '.budget-app-root.' + body.slice(at + '.budget-app-root .'.length);
  ok(pretty(source) !== pretty(glued), 'proof A catches a descendant selector glued into a compound one');
  ok(bare(source) === bare(glued), '… which proof B cannot see, and is why there are two');

  /* A dropped declaration: both see it. */
  const decl = body.match(/position:relative;/);
  ok(decl, 'fixture: a declaration to drop');
  const dropped = body.slice(0, decl.index) + body.slice(decl.index + decl[0].length);
  ok(pretty(source) !== pretty(dropped), 'proof A catches a dropped declaration');
  ok(bare(source) !== bare(dropped), 'and so does proof B');

  /* What the full minify pass does to this sheet: B must refuse it. */
  const full = esbuild.transformSync(source, { loader: 'css', minify: true, charset: 'utf8', legalComments: 'none' }).code;
  ok(bare(source) !== bare(full),
    'proof B refuses esbuild\'s full minify — it rewrites values and merges rules the guards have not read');
}

console.log(`PASS css-shipped-minified — ${bytes(source)} -> ${bytes(out)} bytes (${(ratio * 100).toFixed(1)}%), `
  + `same rules by round trip and by hand, font notice kept (${checks} checks)`);
