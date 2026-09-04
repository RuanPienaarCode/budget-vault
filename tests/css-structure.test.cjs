'use strict';
/* The stylesheet parses as a stylesheet.

   WHY THIS EXISTS. 1.22.5 shipped a broken styles.css. A rule was removed by
   deleting the lines that began with its selector — which for a multi-line
   rule deletes the selector and LEAVES the body:

     /* comment *​/
       display: block; width: 100%; padding: 0;
     }

   That is not a syntax error a build catches. `esbuild` copies the file, the
   plugin loads it, and the browser's CSS parser hits the orphaned declarations,
   discards input until it can resynchronise, and silently drops the RULES THAT
   FOLLOW. The visible symptom was three screens away from the cause: the
   dashboard's `.hero-meter` lost `position: relative` and `overflow: hidden`,
   so the pace mark inside it — `position: absolute; top: -2px; bottom: -2px` —
   resolved against the CARD instead and painted a 2px line down the whole hero
   and out the other side. Nobody looking at that line would think to check a
   deleted popup's CSS sixty lines earlier.

   Every gate this repo already had passed: 77 suites green, a clean-room
   reproduction, and a byte-identical release. None of them ever asked whether
   the CSS was well-formed, because nothing had ever broken it before.

   TWO CLAIMS:

     1. braces balance — every `{` closes, and no `}` appears with nothing open.
        A negative running depth is the tell for an orphaned body, and it is
        checked as the file is walked rather than only at the end, so two
        errors cannot cancel out to a passing total.
     2. no declaration sits outside a rule. This is the shape the 1.22.5 bug
        actually took: the braces after it were unbalanced, but a body whose
        stray `}` happens to pair with another mistake would balance and still
        be wrong.

   Deliberately NOT a full CSS parser. It reads the two files the plugin ships
   and asks the one structural question a hand-edit can get wrong; anything
   more would be a dependency to keep in step with the language.

   Runs in bare node. Wired into ./build.sh by the tests/*.test.cjs glob.
     node tests/css-structure.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const ROOT = path.join(__dirname, '..');

/* Comments are blanked rather than stripped so line numbers still point at the
   real line — a failure that reports the wrong line is a failure someone has to
   re-find by hand. A brace inside a comment must not count, and this file's own
   header contains both an escaped comment marker and stray braces for exactly
   that reason. */
const blankComments = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

function scan(rel) {
  const src = blankComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const lines = src.split('\n');
  let depth = 0;
  const orphans = [];
  let wentNegativeAt = 0;

  lines.forEach((line, i) => {
    const startDepth = depth;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0 && !wentNegativeAt) wentNegativeAt = i + 1; }
    }
    const t = line.trim();
    if (!t || startDepth !== 0) return;
    if (t.startsWith('@') || t.endsWith(',') || t.includes('{')) return;   // at-rule, or a selector
    /* A declaration is `prop: value;`. The `[^:]` guard keeps `::before` and a
       lone `:hover` line out, and the trailing `;` keeps out anything that is
       still plausibly a selector. */
    if (/^[a-z-]+\s*:[^:]/i.test(t) && t.endsWith(';')) orphans.push({ line: i + 1, text: t.slice(0, 70) });
  });

  return { depth, orphans, wentNegativeAt };
}

/* Both are shipped: src/styles.css is the hand-written source and the root
   styles.css is what the plugin actually loads in the vault. Checking only the
   source would miss a build that mangled it; checking only the build would
   report the fault at a line nobody edits. */
for (const rel of ['src/styles.css', 'styles.css']) {
  const { depth, orphans, wentNegativeAt } = scan(rel);
  eq(wentNegativeAt, 0,
    `${rel}: a '}' closes a rule that was never opened, at line ${wentNegativeAt} — ` +
    'the signature of a rule body whose selector line was deleted');
  eq(depth, 0, `${rel}: ${depth > 0 ? depth + ' unclosed' : -depth + ' unmatched closing'} brace(s)`);
  ok(orphans.length === 0,
    `${rel}: ${orphans.length} declaration(s) sit outside any rule — the browser discards ` +
    'input until it resynchronises, silently dropping the rules that follow. First: ' +
    (orphans[0] ? `line ${orphans[0].line} "${orphans[0].text}"` : ''));
}

/* The rule the 1.22.5 break actually cost, pinned by name. The generic checks
   above would have caught that bug, but they would not say what it broke; this
   says it, and fails loudly if a future edit drops the containing block that
   keeps the pace mark inside its own meter. */
{
  const css = blankComments(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'));
  const meter = css.match(/\.budget-app-root \.hero-meter\s*\{([^}]*)\}/);
  ok(!!meter, 'the shipped stylesheet still declares .hero-meter');
  ok(/position:\s*relative/.test(meter[1]),
    '.hero-meter is the containing block for .hero-mark — without position:relative the ' +
    'mark resolves against the card and paints a line down the whole hero');
  ok(/overflow:\s*hidden/.test(meter[1]),
    'and it clips the mark, which is deliberately taller than the bar (top/bottom: -2px)');
}

/* ---- 3. comment delimiters pair up ----
   1.40.0 shipped a line reading `(…) *\/` after a comment had already closed.
   Braces balanced, no declaration was orphaned, and the directory review's
   real parser rejected the file ("CSS parse error"). A `*\/` with no open
   comment, or a `/*` never closed, is the same class of hand-edit as the
   orphaned body above, so it is pinned here the same way. */
for (const rel of ['src/styles.css', 'styles.css']) {
  const file = path.join(ROOT, rel);
  const css = fs.readFileSync(file, 'utf8');
  let open = false, line = 1;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '\n') line++;
    if (!open && css.startsWith('/*', i)) { open = true; i++; continue; }
    if (open && css.startsWith('*/', i)) { open = false; i++; continue; }
    if (!open && css.startsWith('*/', i)) {
      assert.fail(`${path.relative(ROOT, file)}: a '*/' at line ${line} closes a comment that was never opened`);
    }
  }
  eq(open, false, `${path.relative(ROOT, file)}: a comment is never closed`);
}

console.log(`PASS — stylesheets are well-formed: braces balance, no rule body is orphaned (${checks} assertions).`);
