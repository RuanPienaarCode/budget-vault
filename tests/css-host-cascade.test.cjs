'use strict';
/* OBSIDIAN'S OWN STYLESHEET AND THEME DO NOT REACH THROUGH THE PLUGIN'S ROOT.

   The plugin's Theme is its own setting, so it legitimately runs Light under a
   dark Obsidian and the reverse — and that mismatch is where every bug in this
   file lived, because the developer's desktop runs the two matched and never
   shows them. Three ways the host got in, each found by the 7 Oct 2026 audit
   and each guarded here:

     1. A RULE INSIDE THE ROOT READ A HOST COLOUR. The Savings account sheet
        painted itself `var(--background-secondary)` — Obsidian's variable,
        set per OBSIDIAN theme, never redefined inside the root — behind ink
        from the PLUGIN's palette. Plugin Light under Obsidian dark put
        #12151c on #262626: the balance in that sheet at 1.21:1. The sealed-
        palette rule (CLAUDE.md) forbids exactly this; nothing enforced it.

     2. A HOST RULE OUT-RANKED A DIALOG'S WIDTH. `.is-mobile
        input[type='text'] { width: 100% }` (0,2,1) beat the split dialog's
        `.budget-split-amt { width: 90px }` (0,1,0) on every mobile device; in
        a row that does not wrap (an iPad, a phone held sideways) the amount
        field took the whole row and the category picker kept only its padding.

     3. HOST THEME VARIABLES STYLED PLUGIN HEADINGS. app.css colours and sets
        the face of bare h1-h6, b/strong and i/em from --h1-color, --h1-font,
        --bold-color, --italic-color, --bold-modifier. No plugin rule sets those
        on the page titles, the account drawer's h3 or the import help's
        emphasis, so a theme that styles headings restyled the plugin's.

   The dialogs mounted on document.body (export, split, tidy, re-slice,
   onboarding) are deliberately NOT sealed: they are Obsidian's furniture and
   follow Obsidian's theme, which is why check 1 only looks at rules scoped
   under `.budget-app-root`.

   Reads the build input — src/styles.css plus the generated
   src/styles-presets.css, byte-for-byte what ships as styles.css.
     node tests/css-host-cascade.test.cjs */

const fs = require('fs');
const path = require('path');

/* Every check runs and every failure is reported, rather than stopping at the
   first: the three bugs are independent, and a run should say which of them
   is back. */
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const ROOT = path.join(__dirname, '..');

/* ---- a minimal stylesheet reader ------------------------------------------
   Not a CSS parser: enough to walk rules and their declarations, which is all
   these checks ask. Comments are blanked first (length-preserving, so line
   numbers stay true); strings are skipped so the data: URL's own `;` cannot end
   a declaration early; @media/@supports are descended into and recorded as the
   context of the rules inside them; @keyframes frames are walked as rules. */
function readRules(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const skipString = i => { const q = src[i]; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; return i; };
  const closeOf = open => {
    let d = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'") i = skipString(i);
      else if (c === '{') d++;
      else if (c === '}' && --d === 0) return i;
    }
    throw new Error(`${rel}: unbalanced brace from line ${lineOf(open)}`);
  };
  const splitTop = s => {
    const out = []; let d = 0, cur = '';
    for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur);
    return out.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const rules = [];
  const walk = (from, to, context) => {
    let i = from, start = from;
    while (i < to) {
      const c = src[i];
      if (c === '"' || c === "'") { i = skipString(i) + 1; continue; }
      if (c === ';') { start = ++i; continue; }
      if (c !== '{') { i++; continue; }
      const prelude = src.slice(start, i).replace(/\s+/g, ' ').trim();
      const close = closeOf(i);
      if (/^@(media|supports|layer|container|document|(-webkit-)?keyframes)\b/.test(prelude)) {
        walk(i + 1, close, [...context, prelude]);
      } else {
        const decls = [];
        let ds = i + 1, depth = 0;
        for (let j = i + 1; j <= close; j++) {
          const d = src[j];
          if (d === '"' || d === "'") { j = skipString(j); continue; }
          if (d === '(') depth++;
          else if (d === ')') depth--;
          else if ((d === ';' && depth === 0) || j === close) {
            const text = src.slice(ds, j), colon = text.indexOf(':');
            if (text.trim() && colon > 0) {
              const prop = text.slice(0, colon).trim();
              decls.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
                value: text.slice(colon + 1).trim(), line: lineOf(ds + (text.length - text.trimStart().length)) });
            }
            ds = j + 1;
          }
        }
        rules.push({ file: rel, prelude, selectors: splitTop(prelude), context, decls, line: lineOf(i) });
      }
      i = start = close + 1;
    }
  };
  walk(0, src.length, []);
  return rules;
}

const rules = [...readRules('src/styles.css'), ...readRules('src/styles-presets.css')];
ok(rules.length > 1000, `the reader should find over a thousand rules, found ${rules.length}`);
const varsIn = value => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);

/* The plugin's root ELEMENT: `.budget-app-root` plus classes/negations on the
   same element (.bud-dark, a palette class, :not(.bud-dark)) — not a
   descendant. A custom property declared there is the plugin's own, whatever
   its name: --text-primary is a plugin token, and --background-modifier-border
   is a host variable the root deliberately RE-POINTS at the plugin's palette. */
const isRootElement = sel => /^\.budget-app-root(?:\.[\w-]+|:not\([^()]*\))*$/.test(sel);
const rootDefined = new Set();
for (const r of rules) {
  if (!r.selectors.some(isRootElement)) continue;
  for (const d of r.decls) if (d.prop.startsWith('--')) rootDefined.add(d.prop);
}
ok(rootDefined.has('--surface') && rootDefined.has('--text-primary'), 'sanity: the palette tokens are found on the root');
ok(rootDefined.has('--background-modifier-border') && rootDefined.has('--text-normal'),
  'sanity: the host variables the root re-points (form chrome) count as defined');

/* ---- 1. no rule inside the root reads a host theme variable ----------------
   The families are Obsidian's colour, surface and type variables (prefixes
   taken from app.css's own declarations). A variable in one of them that the
   root does not define resolves to the HOST theme's value, which is the bug.
   Deliberately not every unknown variable: --mobile-navbar-height is a host
   SIZE read on purpose (the floating toolbar), and --tint / --seg-* /
   --bud-drift are set inline by the views, not by any theme. */
const HOST_THEME = /^--(?:background|text|color|accent|interactive|h[1-6]|heading|bold|italic|link|icon|font|input|checkbox|dropdown|toggle|slider|button|modal|dialog|prompt|popover|menu|table|code|blockquote|hr|divider|tag|pill|nav|tab|titlebar|ribbon|status|scrollbar|shadow|caret|highlight|embed|callout|list|metadata|footnote|graph|canvas|search|setting|sidebar|textarea|radio|swatch)-/;
const inRoot = r => r.selectors.some(s => s.includes('.budget-app-root'));
const leaks = [];
let hostReadsOutside = 0;
for (const r of rules) {
  for (const d of r.decls) {
    for (const v of varsIn(d.value)) {
      if (!HOST_THEME.test(v) || rootDefined.has(v)) continue;
      if (inRoot(r)) leaks.push(`${r.file}:${d.line}  ${r.prelude.slice(0, 70)}  { ${d.prop}: … var(${v}) … }`);
      else hostReadsOutside++;
    }
  }
}
ok(leaks.length === 0,
  `${leaks.length} rule(s) inside .budget-app-root read an Obsidian theme variable the root never defines — ` +
  'it resolves to the HOST theme, so under a mismatched Theme setting the plugin paints its own ink on ' +
  'Obsidian\'s colour. Use a plugin token (--surface, --body-bg, --line-soft, …) or re-point the variable on ' +
  'the root:\n    ' + leaks.join('\n    '));
/* The exclusion is real and the check is not vacuous: the body-mounted dialogs
   do read host variables, on purpose, and the scan saw them and let them be. */
ok(hostReadsOutside > 10, `the scan should see the dialogs' deliberate host reads, saw ${hostReadsOutside}`);
ok(rules.some(r => !inRoot(r) && r.selectors.some(s => s.startsWith('.budget-onb-')) &&
  r.decls.some(d => varsIn(d.value).includes('--background-secondary'))),
  'sanity: the onboarding callout still reads --background-secondary and is (rightly) out of scope');

/* ---- 2. the split dialog's widths tie Obsidian's mobile input rule -----------
   Specificity of the selectors this file uses — :where() counts nothing,
   :not()/:is() count their argument — which is all a guard on two selectors
   needs. Plugin CSS loads after app.css, so a tie wins. */
function specificity(sel) {
  let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ''), a = 0, b = 0, c = 0;
  s = s.replace(/:(?:not|is)\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => {
    const [x, y, z] = specificity(inner); a += x; b += y; c += z; return '';
  });
  a += (s.match(/#[\w-]+/g) || []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length;
  c += (s.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) || []).length;
  return [a, b, c];
}
const atLeast = (x, y) => x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] >= y[2];
const HOST_MOBILE_INPUT = specificity(".is-mobile input[type='text']");
ok(String(HOST_MOBILE_INPUT) === '0,2,1', `sanity: the specificity counter should read app.css's rule as (0,2,1), read (${HOST_MOBILE_INPUT})`);
ok(String(specificity('.budget-split-amt')) === '0,1,0', 'sanity: and a lone class as (0,1,0)');
for (const [cls, want] of [['budget-split-amt', '90px'], ['budget-split-note', 'auto']]) {
  const winners = [];
  for (const r of rules) {
    if (r.context.length) continue;   // the host rule applies at every width, so must the answer
    const d = [...r.decls].reverse().find(x => x.prop === 'width');
    if (!d) continue;
    for (const s of r.selectors) {
      const last = s.split(/[\s>+~]+/).pop();
      if (new RegExp(String.raw`\.${cls}(?![\w-])`).test(last)) winners.push({ s, spec: specificity(s), value: d.value, line: d.line });
    }
  }
  const strong = winners.filter(w => atLeast(w.spec, HOST_MOBILE_INPUT));
  ok(strong.length > 0,
    `.${cls}: no width rule reaches (0,2,1), so Obsidian's \`.is-mobile input[type='text'] { width: 100% }\` ` +
    `wins on every phone and tablet. Rules found: ${winners.map(w => `${w.s} (${w.spec}) line ${w.line}`).join('; ') || 'none'}`);
  ok(strong.every(w => w.value === want), `.${cls}: the winning width should be ${want}, found ${strong.map(w => w.value).join(', ')}`);
}

/* ---- 3. the root pins Obsidian's heading and emphasis variables ------------
   On the root element, outside any @media/@supports, to a value that does not
   defer to the host. The trap this pins: a CSS-wide keyword written into a
   custom property applies to the PROPERTY — `--h1-color: inherit` copies the
   theme's value down from <body> and pins nothing (measured in Chromium: a
   theme's red heading stayed red). currentColor and the root's own tokens are
   resolved by the plugin, not the theme. */
const PINS = [
  ...[1, 2, 3, 4, 5, 6].flatMap(n => [`--h${n}-color`, `--h${n}-font`]),
  '--bold-color', '--italic-color', '--bold-modifier',
];
const rootPins = new Map();
for (const r of rules) {
  if (r.context.length || !r.selectors.includes('.budget-app-root')) continue;
  for (const d of r.decls) if (PINS.includes(d.prop)) rootPins.set(d.prop, d);
}
for (const p of PINS) {
  const d = rootPins.get(p);
  ok(d, `${p} is not pinned on .budget-app-root — Obsidian's app.css reads it for the plugin's own headings ` +
    'and emphasis, so a community theme that sets it restyles them');
  if (!d) continue;
  ok(!/^(inherit|initial|unset|revert|revert-layer)$/i.test(d.value),
    `${p}: "${d.value}" is a CSS-wide keyword, which applies to the custom property itself and so passes ` +
    'the theme\'s own value straight through. Use currentColor (colours) or var(--font-sans) (faces).');
  const host = varsIn(d.value).filter(v => !rootDefined.has(v));
  ok(host.length === 0, `${p}: reads ${host.join(', ')}, which the root does not define — that is the host's value`);
}
const mod = rootPins.get('--bold-modifier');
ok(mod && /^\d+$/.test(mod.value), `--bold-modifier must be a plain number (app.css adds it to --font-weight), found "${mod && mod.value}"`);

if (failures.length) {
  console.log(`FAIL — css-host-cascade: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-host-cascade: no host theme colour inside the root, split widths tie app.css, ` +
  `${PINS.length} heading/emphasis variables pinned (${checks} checks).`);
