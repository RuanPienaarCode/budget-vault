'use strict';
/* ONE HOST VARIABLE, ONE FALLBACK (2026-11-25 audit, CSS-17).

   The body-mounted dialogs (export, onboarding, receipt import) read Obsidian's
   own variables on purpose and write a literal after the comma, for the moment
   a host does not define one. Obsidian always does, so the literal is never
   painted in practice — which is exactly how three different ones piled up
   unnoticed: --interactive-accent as #7c6cf5, #5b6cff and #7c5cff, --text-error
   as #e5534b and #d33, --text-warning as #b7791f and #d4a017. The day a host
   does drop one, the same dialog would then show a different colour in each of
   its parts. #7c6cf5 is Obsidian's own default accent, hsl(254, 80%, 68%), so
   it is the one the others were converged on.

   Pinned for the three variables the audit measured. Not every host variable:
   the border and fill variables (--background-modifier-border and friends)
   carry different ALPHAS on purpose — a hairline, a quieter hairline, a tint —
   so a literal that differs there is a design, not drift.

   Also pinned: a plugin token (one the root defines, --color-warning and its
   -light pair) is not given a fallback. The root always defines it, and a
   literal beside it only ever recorded the colour the token had BEFORE a
   palette change (#f5a524 against the token's #f59e0b).

     node tests/css-host-fallbacks-agree.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const rules = readRules();
const HOST = ['--interactive-accent', '--text-warning', '--text-error'];
const PLUGIN_TOKENS = ['--color-warning', '--color-warning-light'];

const seen = new Map(HOST.map(v => [v, new Map()]));
const stray = [];
for (const r of rules) {
  for (const d of r.decls) {
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)\s*,\s*([^()]*?)\s*\)/g)) {
      const [, name, fb] = m;
      if (seen.has(name) && /^#[0-9a-f]{3,8}$/i.test(fb)) {
        const by = seen.get(name), k = fb.toLowerCase();
        by.set(k, [...(by.get(k) || []), locate(d.line)]);
      }
      if (PLUGIN_TOKENS.includes(name)) stray.push(`${locate(d.line)}  var(${name}, ${fb})`);
    }
  }
}
for (const [name, by] of seen) {
  ok([...by.values()].flat().length >= 2, `sanity: the sheet should still read ${name} with a hex fallback in several places`);
  ok(by.size <= 1,
    `${name} has ${by.size} different hex fallbacks — ` +
    [...by].map(([hex, at]) => `${hex} (${at.slice(0, 3).join(', ')}${at.length > 3 ? ', …' : ''})`).join(' vs ') +
    '. Use one (the host never reaches it, but a host that omits the variable would paint each part of a dialog differently).');
}
ok(stray.length === 0,
  `${stray.length} read of a plugin token carries a literal fallback — the root always defines it, so the literal can only ` +
  `drift from the palette:\n    ` + stray.join('\n    '));

if (failures.length) {
  console.error(`FAIL — css-host-fallbacks-agree: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-host-fallbacks-agree: ${HOST.map(v => v + ' ' + [...seen.get(v).keys()][0]).join(', ')}; no plugin token carries a fallback (${checks} checks).`);
