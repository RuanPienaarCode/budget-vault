'use strict';
/* THE STYLESHEET STAYS CLEAN FOR THE COMMUNITY SCORECARD, AND ITS iOS 15
   FALLBACKS STAY FALLBACKS.

   1.49.0 put three MEDIUM lint findings on the plugin's community listing
   that 1.48.0 did not have, all from the phone layout it added:
     - a property repeated inside one declaration block — `overflow-wrap:
       break-word; overflow-wrap: anywhere;` four times, and `content:
       attr(data-label); content: attr(data-label) / "";` once;
     - "multicolumn", from `column-gap` — on a GRID, where it means nothing
       multi-column at all; the lint maps the property, not the layout.
   The repeated declarations were not mistakes. They are the textbook
   fallback: an engine that cannot parse the second value drops it and keeps
   the first. Both second values are newer than this plugin's iOS 15.0 floor
   (`overflow-wrap: anywhere` is Safari 15.4, alt-text `content` 17.4), so the
   fallback has to stay — it just cannot live as a duplicate.

   So the newer value moves into an `@supports` block that tests for it, and
   the rule outside keeps the value every engine has. That shape is also what
   the 7 Oct 2026 audit asked for in eight dialog rules that had the NEWER value
   only (`overflow-wrap: anywhere` with no fallback at all, dropped on
   15.0-15.3), and check 3 holds every use of those values to it.

     1. no declaration block repeats a property;
     2. no multi-column property — `gap` does what `column-gap` did, unflagged;
     3. `overflow-wrap: anywhere` and alt-text `content` appear only inside an
        @supports that tests for them, AFTER an unconditional rule for the same
        selector (same @media) that carries the floor's value — after, because
        the two tie on specificity and the later one must be the newer value.

   Reads the build input — src/styles.css plus the generated
   src/styles-presets.css, byte-for-byte what ships as styles.css, which is
   the file the scorecard lints.
     node tests/css-scorecard-lint.test.cjs */

const fs = require('fs');
const path = require('path');

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
const where = (r, d) => `${r.file}:${d ? d.line : r.line}  ${r.prelude.slice(0, 80)}`;

/* ---- 1. no declaration block repeats a property ---------------------------- */
const repeats = [];
for (const r of rules) {
  const seen = new Map();
  for (const d of r.decls) {
    if (seen.has(d.prop)) repeats.push(`${where(r, d)}  repeats ${d.prop} (first at line ${seen.get(d.prop)})`);
    else seen.set(d.prop, d.line);
  }
}
ok(repeats.length === 0,
  `${repeats.length} declaration block(s) repeat a property — a scorecard finding. If the second one is a ` +
  'newer-engine value, move it into an @supports block that tests for it (see check 3):\n    ' + repeats.join('\n    '));

/* ---- 2. no multi-column-layout property ----------------------------------- */
const MULTICOL = /^(columns|column-(gap|count|width|rule|rule-color|rule-style|rule-width|span|fill))$/;
const multicol = [];
for (const r of rules) for (const d of r.decls) if (MULTICOL.test(d.prop)) multicol.push(`${where(r, d)}  ${d.prop}: ${d.value}`);
ok(multicol.length === 0,
  `${multicol.length} multi-column property(ies) — the scorecard flags "multicolumn" on the property name even ` +
  'in a grid. For a grid or flex gap write `gap: <row> <column>`:\n    ' + multicol.join('\n    '));

/* ---- 3. newer-engine values sit behind @supports, after their fallback ----- */
const norm = s => s.replace(/\s+/g, ' ').trim();
const plainContext = ctx => ctx.filter(c => !c.startsWith('@supports'));
const altText = v => /\//.test(v.replace(/"[^"]*"|'[^']*'/g, 's').replace(/\([^()]*\)/g, ''));
const GATED = [
  { name: 'overflow-wrap: anywhere', prop: 'overflow-wrap', is: v => norm(v) === 'anywhere',
    gate: c => /^@supports \(\s*overflow-wrap\s*:\s*anywhere\s*\)$/.test(c),
    floor: v => norm(v) === 'break-word', floorName: 'overflow-wrap: break-word' },
  { name: 'alt-text content', prop: 'content', is: altText,
    gate: c => /^@supports \(\s*content\s*:.*\/.*\)$/.test(c),
    floor: v => !altText(v), floorName: 'a plain `content`' },
];
let gatedSeen = 0;
for (const g of GATED) {
  for (const r of rules) {
    for (const d of r.decls) {
      if (d.prop !== g.prop || !g.is(d.value)) continue;
      gatedSeen += r.selectors.length;
      const gated = r.context.some(g.gate);
      ok(gated, `${where(r, d)}  ${g.name} outside an @supports that tests for it — on iOS 15.0-15.3 the ` +
        `declaration is dropped. Keep ${g.floorName} in the rule and add the newer value in @supports.`);
      if (!gated) continue;
      const ctx = JSON.stringify(plainContext(r.context));
      for (const sel of r.selectors) {
        const floor = rules.find(f => f.line < r.line && f.file === r.file && !f.context.some(c => c.startsWith('@supports')) &&
          JSON.stringify(f.context) === ctx && f.selectors.includes(sel) && f.decls.some(x => x.prop === g.prop && g.floor(x.value)));
        ok(floor, `${where(r, d)}  "${sel}" has ${g.name} behind @supports but no earlier unconditional rule for the ` +
          `same selector${plainContext(r.context).length ? ' in ' + plainContext(r.context).join(' ') : ''} with ${g.floorName} — ` +
          'iOS 15.0-15.3 gets nothing.');
      }
    }
  }
}
ok(gatedSeen >= 12, `sanity: these values reach at least twelve selectors, found ${gatedSeen}`);

if (failures.length) {
  console.log(`FAIL — css-scorecard-lint: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-scorecard-lint: no repeated property in ${rules.length} blocks, no multi-column property, ` +
  `${gatedSeen} selectors' newer-engine values each behind @supports with a floor fallback (${checks} checks).`);
