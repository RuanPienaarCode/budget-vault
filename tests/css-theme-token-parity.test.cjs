'use strict';
/* A token the dark palette defines must not be read by a light-theme rule
   (runtime test of the 7 Oct 2026 audit, D1).

   `--ink-on-accent` was defined only in `.budget-app-root.bud-dark`. Every
   rule that read it was scoped to `.bud-dark` too, until the caveat chip's
   expanded state read it in both themes. In the light theme the variable is
   undefined, so the colour fell back to the inherited text colour: dark ink on
   the dark primary fill, 1.02:1 on Accounts and 1.35:1 on Savings.

   The rule pinned here: for every custom property defined in the dark palette
   block and NOT in a light `.budget-app-root` block, every rule that reads it
   without a fallback must be scoped to `.bud-dark` in every selector of its
   list. A light-only token cannot have the same hole: the dark root is also a
   `.budget-app-root`, so it inherits the light value.

   Pure text — no DOM, no bundle.
     node tests/css-theme-token-parity.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

/* Innermost rules only: a body with no braces in it. A rule nested in
   @media or @supports still yields its own selector, because the captured
   selector is the text after the previous brace. */
function audit(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selectors: m[1].trim().split(',').map(s => s.trim()).filter(Boolean), body: m[2] }));
  const defined = sel => {
    const out = new Set();
    for (const r of rules) if (r.selectors.length === 1 && r.selectors[0] === sel) {
      for (const [, k] of r.body.matchAll(/(--[a-z0-9-]+)\s*:/g)) out.add(k);
    }
    return out;
  };
  const light = defined('.budget-app-root');
  const dark = defined('.budget-app-root.bud-dark');
  const darkOnly = [...dark].filter(t => !light.has(t));
  const holes = [];
  for (const t of darkOnly) {
    const bare = new RegExp(`var\\(\\s*${t.replace(/-/g, '\\-')}\\s*\\)`);
    for (const r of rules) {
      if (!bare.test(r.body)) continue;
      for (const s of r.selectors) if (!/\.bud-dark\b/.test(s)) holes.push(`${t} read by "${s}"`);
    }
  }
  return { light, dark, darkOnly, holes };
}

/* The guard first proves it can see the shape it guards against, so it
   cannot pass vacuously on a stylesheet with no dark-only token today. */
const planted = audit(`.budget-app-root { --a: #fff; }
.budget-app-root.bud-dark { --a: #000; --only-dark: #111; }
@media (max-width: 600px) { .budget-app-root .x, .budget-app-root.bud-dark .y { color: var(--only-dark); } }
.budget-app-root.bud-dark .z { color: var(--only-dark); }
.budget-app-root .w { color: var(--only-dark, #222); }`);
ok(planted.holes.length === 1 && /"\.budget-app-root \.x"/.test(planted.holes[0]),
  `the guard finds a planted hole inside @media, and only that one (got ${JSON.stringify(planted.holes)})`);

const { light, dark, darkOnly, holes } = audit(css);
ok(light.size > 20 && dark.size > 20, `both palette blocks parse (light ${light.size}, dark ${dark.size} tokens)`);
ok(holes.length === 0,
  `a dark-only token is read by a rule that also applies in the light theme: ${holes.join('; ')}`);

/* The one this audit found, by name, so the guard cannot pass by the token
   moving somewhere the parser does not look. */
ok(light.has('--ink-on-accent'), 'the light palette defines --ink-on-accent');

console.log(`PASS css-theme-token-parity (${checks} checks, ${darkOnly.length} dark-only tokens checked)`);
