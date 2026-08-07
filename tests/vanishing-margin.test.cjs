'use strict';
/* Spacing must not be hung on an element that can disappear.

   The bug this was written for: the Assets page put its 24px gap between the
   KPI tiles and the table card on the `mb-4` of the staleness caveat that sits
   between them — and a caveat with nothing to say is `display: none`. On a
   vault where every valuation was current the caveat rendered empty, the box
   left the layout, and the margin went with it: the tiles sat flush against the
   card. Savings was built the same way and had the same bug waiting for the
   first household with no stale savings figure.

   It is an easy shape to rebuild by accident, because it looks right in every
   state the author happens to be looking at — the caveat is usually there
   during development, and the page it breaks is the one where nothing is wrong.

   The shape that works, and what the dashboard's position band always did: the
   tiles and the caveat that qualifies them are ONE block, and the block owns
   the gap to whatever follows. Nothing that can vanish is load-bearing.

   Two invariants, both currently true:

     1. no element in the shell carries a spacing utility (`mb-N` / `mt-N`)
        while also carrying a class the stylesheet hides when empty. A margin on
        a `display: none` box is not a smaller margin, it is no margin.

     2. every such element sits inside a parent that owns a bottom margin, so
        the gap survives the element not being rendered — and the KPI grid it
        qualifies is inside that same parent, so the two cannot drift apart.

   Only the markup in src/shell.js is covered. A class added at runtime
   (`classList.add('mb-4')`) is invisible to this, and so is a gap hung on an
   element hidden by something other than :empty — both would want a rendered
   DOM, which the browser harness in _preview is for.

     node tests/vanishing-margin.test.cjs
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const shellRaw = fs.readFileSync(path.join(ROOT, 'src', 'shell.js'), 'utf8');
/* The built stylesheet, not src/ — it is what the engine actually parses, and
   ./build.sh runs the tests after writing it. Same choice as the
   :focus-visible fallback guard. */
const cssRaw = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

/* Comments out before anything is matched. A selector is "everything since the
   last brace", and this stylesheet documents itself heavily — leave the
   comments in and the rule above a selector is reported AS the selector. The
   shell's HTML comments go the same way, so they can't be parsed as markup. */
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const shell = shellRaw.replace(/<!--[\s\S]*?-->/g, '');

let fail = 0, checks = 0;
const check = (msg, cond) => { checks++; if (cond) return; fail++; console.log(`  FAIL ${msg}`); };

const SPACING = /\bm[bt]-\d+\b/;
/* The last class of a compound selector is the thing the rule is about:
   `.budget-app-root .kpi-caveat:empty` → kpi-caveat. */
const subject = sel => (sel.trim().split(/\s+/).pop().match(/\.([\w-]+)(?::|$)/) || [])[1];

/* ---- which selectors vanish when they have no content ----
   Only rules that actually remove the box. `.x:empty { margin-top: 0 }` leaves
   it in flow at zero height, which costs nothing and hides nothing.

   Kept as SELECTORS, not bare classes: `.section-h .sub:empty` hides a section
   header's subtitle and says nothing about the `.sub` inside a card header.
   Flattening the two to "sub" makes this guard fail on markup the rule it is
   quoting does not even reach. */
const vanishes = [];
for (const m of css.matchAll(/([^{}]+):empty\s*\{([^}]*)\}/g)) {
  const sel = m[1].trim();
  if (subject(sel) && /display\s*:\s*none/.test(m[2])) vanishes.push(`${sel}:empty`);
}

/* Does this element match that selector? Descendant combinators only — the
   stylesheet uses nothing else on an :empty rule, and `>` / `+` would want a
   real matcher rather than a walk up the parents. */
const matches = (node, selector) => {
  const parts = selector.replace(/:empty$/, '').trim().split(/\s+/)
    .filter(p => p !== '.budget-app-root');
  const wants = p => (p.match(/\.[\w-]+/g) || []).every(c => node.classes.includes(c.slice(1)));
  if (!wants(parts.pop())) return false;
  let up = node.parent;
  for (const part of parts.reverse()) {
    const needed = (part.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
    while (up && !needed.every(c => up.classes.includes(c))) up = up.parent;
    if (!up) return false;
    up = up.parent;
  }
  return true;
};

/* ---- which classes bring a bottom margin of their own ----
   A wrapper can own the gap through a utility class or through a rule of its
   own — .section-h carries 14px directly, and that is just as load-bearing. */
const hasBottomMargin = new Set();
for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const cls = subject(m[1]);
  const mb = m[2].match(/margin(?:-bottom)?\s*:\s*([^;]+)/);
  if (!cls || !mb || /^0\w*$/.test(mb[1].trim())) continue;
  // Shorthand `margin: 0 auto` sets a zero bottom; only the long form is read
  // for anything other than a single value.
  if (/^margin\s*:/.test(mb[0]) && mb[1].trim().split(/\s+/).length > 1) continue;
  hasBottomMargin.add(cls);
}

/* Sanity on the parse itself. Without this, a regex that quietly stops matching
   turns the invariants below into assertions about nothing. */
check(`the stylesheet still hides something when empty (found ${vanishes.length})`, vanishes.length > 0);
check(`classes with a bottom margin were found (${hasBottomMargin.size})`, hasBottomMargin.size > 5);

/* ---- parse the shell into a tree ----
   Stack-based over the tag stream: the shell is one well-formed HTML string, so
   parent/child is the only structure needed and a dependency would cost more
   than the bug. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const nodes = [];
const stack = [];
for (const m of shell.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)(\/?)>/g)) {
  const [, closing, tag, attrs, selfClose] = m;
  if (closing) { if (stack[stack.length - 1]?.tag === tag) stack.pop(); continue; }
  const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
  const node = {
    tag, cls, id: (attrs.match(/\bid="([^"]*)"/) || [])[1] || null,
    classes: cls.split(/\s+/).filter(Boolean),
    parent: stack[stack.length - 1] || null,
  };
  nodes.push(node);
  if (!VOID.has(tag) && !selfClose) stack.push(node);
}
check(`the shell parses into a tree (${nodes.length} elements)`, nodes.length > 50);
check('every tag the shell opens is closed (empty stack at the end)', stack.length === 0);

const describe = n => `<${n.tag}${n.id ? ` id="${n.id}"` : ''}${n.cls ? ` class="${n.cls}"` : ''}>`;
const owns = n => !!n && (SPACING.test(n.cls) || n.classes.some(c => hasBottomMargin.has(c)));

/* ---- 1. a margin on a box that can vanish ---- */
const vanishing = nodes.filter(n => vanishes.some(sel => matches(n, sel)));
check(`there are hide-when-empty elements to guard (${vanishing.length})`, vanishing.length > 0);
for (const n of vanishing) {
  const hidden = vanishes.find(sel => matches(n, sel));
  check(`${describe(n)} carries a spacing utility, but \`${hidden} ` +
        '{ display: none }\` removes the box — and the margin with it. Whatever gap ' +
        'this was providing disappears in exactly the state where the element has ' +
        'nothing to say. Put the gap on a block that is always rendered.',
    !SPACING.test(n.cls));
}

/* ---- 2. the gap comes from something that is always there ---- */
for (const n of vanishing) {
  check(`${describe(n)} can be removed from the layout, so its parent ` +
        `${n.parent ? describe(n.parent) : '(none — it is a top-level block)'} must ` +
        'own the bottom margin that separates this group from what follows it. ' +
        'Wrap the tiles and the caveat in a block carrying `mb-4`, as the ' +
        "dashboard's position band does.",
    owns(n.parent));
}

/* The three grid ↔ caveat pairings, pinned by name: same parent, so the caveat
   cannot be moved out of the block whose margin is standing in for it. */
const PAIRS = [
  { grid: 'assetKpis', caveat: 'assetStale', page: 'Assets' },
  { grid: 'savingsKpis', caveat: 'savingsStale', page: 'Savings' },
  { grid: 'dashPositionKpis', caveat: 'dashStale', page: 'Dashboard' },
];
for (const { grid, caveat, page } of PAIRS) {
  const g = nodes.find(n => n.id === grid);
  const c = nodes.find(n => n.id === caveat);
  check(`${page}: #${grid} and #${caveat} both exist in the shell`, !!g && !!c);
  if (!g || !c) continue;
  check(`${page}: #${caveat} must sit in the same block as #${grid} — it qualifies ` +
        'those tiles, and that block is what owns the gap to the next one',
    g.parent === c.parent);
  check(`${page}: the block holding #${grid} must own a bottom margin`, owns(g.parent));
}

console.log(fail
  ? `\nFAIL — ${fail} of ${checks} check(s) on vanishing margins`
  : `\nPASS — nothing load-bearing can vanish (${checks} checks, ${vanishing.length} ` +
    `hide-when-empty element(s), ${nodes.length} shell elements).`);
process.exit(fail ? 1 : 0);
