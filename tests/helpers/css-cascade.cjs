'use strict';
/* WHICH RULE WINS, ASKED OF THE STYLESHEET ITSELF.

   Most CSS bugs this plugin has shipped were not a wrong value but a right
   value that lost: a phone rule written before the base rule it meant to
   override (the Plan bucket rows, 2026-10-20 audit D1-01), a tone class
   out-ranked by the component's own colour (an overdrawn balance in neutral
   ink, D1-11), Obsidian's `button { justify-content: center }` beating a
   `text-align` that cannot move a flex item (D1-02). A guard that only checks
   "the declaration is present" passes all three. This resolver answers the
   question the browser answers: for this element, at this width, which
   declaration of this property wins.

     const { computed } = require('./helpers/css-cascade.cjs');
     computed(path, 'display', { width: 375 })   // -> { value, line, selector } | null

   `path` is the element and its ancestors, outermost first, each node
   { tag, classes, id, attrs }. Pass only what the rules can see; a node you
   leave out is a node no selector can match.

   Deliberately small, not a CSS engine:
     - selectors: tag, .class, #id, [attr], [attr=value], :not()/:is()/:where()
       of a compound list, descendant and child combinators; :first-child,
       :last-child and :nth-child(N) for a node that gives { nth, of }. Any
       other pseudo-class (:hover, :focus-visible, :nth-child(an+b) ...) does
       not match, and a pseudo-element matches only when asked for
       (opts.pseudo: '::first-letter').
     - @media: (max-width|min-width: Npx|rem|em), (pointer: coarse|fine),
       (hover: hover|none), (prefers-reduced-motion: reduce),
       (prefers-color-scheme: ...), joined by `and`; a list (comma) matches if
       any part does. Unknown features do not match.
     - @supports: a positive condition holds (every engine this suite models
       has what the sheet tests for), a `not (...)` one does not.
   Specificity as css-host-cascade counts it: :where() is zero, :not()/:is()
   take their argument's. Ties go to the later rule, as in the browser; there
   is no !important in this sheet (a guard forbids it), so it is not modelled. */

const { readRules } = require('./css-sources.cjs');

function splitTop(s, sep) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
    if (c === sep && d === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

function specificity(sel) {
  let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ''), a = 0, b = 0, c = 0;
  s = s.replace(/:(?:not|is)\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => {
    const best = splitTop(inner, ',').map(specificity).sort(cmp).pop() || [0, 0, 0];
    a += best[0]; b += best[1]; c += best[2]; return '';
  });
  c += (s.match(/::[\w-]+/g) || []).length;
  s = s.replace(/::[\w-]+/g, '');
  a += (s.match(/#[\w-]+/g) || []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?/g) || []).length;
  c += (s.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [a, b, c];
}
function cmp(x, y) { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }

/* One compound ("button.acct-bal:not(.x)") against one node. */
function matchCompound(comp, node, pseudoWanted) {
  let rest = comp;
  const pe = /::[\w-]+(\([^)]*\))?$/.exec(rest);
  if (pe) { if (pe[0] !== pseudoWanted) return false; rest = rest.slice(0, pe.index); }
  else if (pseudoWanted) return false;
  const tag = /^[a-z][\w-]*|^\*/i.exec(rest);
  if (tag) { if (tag[0] !== '*' && tag[0].toLowerCase() !== (node.tag || 'div')) return false; rest = rest.slice(tag[0].length); }
  while (rest) {
    let m;
    if ((m = /^\.([\w-]+)/.exec(rest))) { if (!(node.classes || []).includes(m[1])) return false; }
    else if ((m = /^#([\w-]+)/.exec(rest))) { if (node.id !== m[1]) return false; }
    else if ((m = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(['"]?)(.*?)\3)?\s*\]/.exec(rest))) {
      const v = (node.attrs || {})[m[1]];
      if (v === undefined) return false;
      if (m[2] === '=' && String(v) !== m[4]) return false;
      if (m[2] && m[2] !== '=') return false;
    } else if ((m = /^:(not|is|where)\(((?:[^()]|\([^()]*\))*)\)/.exec(rest))) {
      const any = splitTop(m[2], ',').some(c => matchCompound(c, node, null));
      if (m[1] === 'not' ? any : !any) return false;
    } else if ((m = /^:(first-child|last-child|nth-child\(\s*(\d+)\s*\))/.exec(rest))) {
      // Structural, answered only for a node that says where it sits
      // ({ nth, of }: 1-based position among its siblings, and their count).
      if (node.nth === undefined) return false;
      if (m[1] === 'first-child' && node.nth !== 1) return false;
      if (m[1] === 'last-child' && node.nth !== node.of) return false;
      if (m[2] !== undefined && node.nth !== Number(m[2])) return false;
    } else if ((m = /^:[\w-]+(\([^)]*\))?/.exec(rest))) {
      return false;                       // a state or other pseudo-class: not modelled, so no match
    } else return false;
    rest = rest.slice(m[0].length);
  }
  return true;
}

/* A full selector against the path (target last), right to left. */
function matches(sel, path, pseudo) {
  const parts = [];
  let buf = '', d = 0;
  for (const ch of sel.trim()) {
    if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--;
    if (d === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      if (ch !== ' ') parts.push(ch);
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  const comps = [], combs = [];
  for (const p of parts) {
    if (p === '>' || p === '+' || p === '~') combs[comps.length - 1] = p;
    else comps.push(p);
  }
  if (combs.some(c => c === '+' || c === '~')) return false;   // sibling combinators: not modelled
  const walk = (ci, ni) => {
    if (ci < 0) return true;
    if (ni < 0) return false;
    if (!matchCompound(comps[ci], path[ni], ci === comps.length - 1 ? pseudo : null)) return false;
    if (ci === 0) return true;
    if (combs[ci - 1] === '>') return walk(ci - 1, ni - 1);
    for (let k = ni - 1; k >= 0; k--) if (walk(ci - 1, k)) return true;
    return false;
  };
  return walk(comps.length - 1, path.length - 1);
}

function mediaHolds(prelude, env) {
  const q = prelude.replace(/^@media\s*/, '');
  return splitTop(q, ',').some(part => part.split(/\s+and\s+/i).every(f => {
    f = f.trim();
    if (/^(screen|all)$/i.test(f)) return true;
    let m;
    if ((m = /^\(\s*(max|min)-width\s*:\s*([\d.]+)(px|rem|em)\s*\)$/.exec(f))) {
      const n = Number(m[2]) * (m[3] === 'px' ? 1 : 16);
      return m[1] === 'max' ? env.width <= n : env.width >= n;
    }
    if ((m = /^\(\s*pointer\s*:\s*(coarse|fine)\s*\)$/.exec(f))) return (env.pointer || 'fine') === m[1];
    if ((m = /^\(\s*hover\s*:\s*(hover|none)\s*\)$/.exec(f))) return (env.hover || 'hover') === m[1];
    if ((m = /^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/.exec(f))) return !!env.reducedMotion;
    if ((m = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/.exec(f))) return (env.scheme || 'light') === m[1];
    return false;
  }));
}
const contextHolds = (ctx, env) => ctx.every(c =>
  c.startsWith('@media') ? mediaHolds(c, env)
    : c.startsWith('@supports') ? !/^@supports\s+not\b/.test(c)
      : true);

let RULES = null;
const rules = () => RULES || (RULES = readRules());

/* Every declaration of `prop` that applies to the path, in cascade order
   (loser first). `prop` may be a longhand: a shorthand that sets it counts
   (padding for padding-left, flex for flex-basis ...). */
const SHORTHAND = {
  padding: /^padding-(top|right|bottom|left)$/, margin: /^margin-(top|right|bottom|left)$/,
  'padding-inline': /^padding-(left|right)$/, 'margin-inline': /^margin-(left|right)$/,
  gap: /^(row|column)-gap$/, background: /^background-color$/, font: /^font-(size|weight|family)$/,
  'grid-column': /^grid-column-(start|end)$/, 'place-self': /^(align|justify)-self$/,
  'border': /^border-(top|right|bottom|left)$/,
};
function candidates(path, prop, env = {}) {
  const out = [];
  for (const r of rules()) {
    if (!contextHolds(r.context, env)) continue;
    const decl = [...r.decls].reverse().find(d => d.prop === prop || (SHORTHAND[d.prop] && SHORTHAND[d.prop].test(prop)));
    if (!decl) continue;
    let best = null;
    for (const s of r.selectors) {
      if (!matches(s, path, env.pseudo || null)) continue;
      const sp = specificity(s);
      if (!best || cmp(sp, best.spec) > 0) best = { selector: s, spec: sp };
    }
    if (best) out.push({ ...best, value: decl.value, prop: decl.prop, line: decl.line, context: r.context });
  }
  return out.sort((x, y) => cmp(x.spec, y.spec) || x.line - y.line);
}
const computed = (path, prop, env) => { const c = candidates(path, prop, env); return c.length ? c[c.length - 1] : null; };

/* Path builders: the plugin root inside an Obsidian body. */
const node = (tag, classes = [], extra = {}) => ({ tag, classes, ...extra });
const ROOT = (...more) => [node('body', more.includes('phone') ? ['is-mobile', 'is-phone'] : []), node('div', ['budget-app-root', 'bv-cur-1', ...more.filter(m => m !== 'phone')])];

module.exports = { computed, candidates, matches, specificity, cmp, node, ROOT, mediaHolds };
