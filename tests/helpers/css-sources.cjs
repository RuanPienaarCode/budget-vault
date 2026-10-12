'use strict';
/* THE ONE WAY A GUARD TEST READS THE STYLESHEET.

   Root styles.css is the concatenation of the files scripts/css-sources.cjs
   lists (fonts, the legacy sheet, the statement foundation, three page lanes, the
   generated palettes), in that order. A guard that read src/styles.css alone
   would keep passing while a rule written into a lane file went unchecked, so
   every CSS guard goes through here and sees all of them, in cascade order.

     const { assembled, readRules, locate, sources } = require('./helpers/css-sources.cjs');

   assembled()   the shipped stylesheet as a string, built from the SOURCES (not
                 read from the root file, which may be stale mid-edit).
   sources()     [{ rel, text, start }] — each file and where it begins.
   readRules()   every rule of the assembled sheet as { selectors, prelude,
                 context, decls, line }. `line` is the 1-based line in the
                 ASSEMBLED sheet, so "this rule comes after that one" means what
                 the cascade means even across files.
   locate(line)  'src/statement/budget.css:42' for an assembled line, for messages.

   The reader is deliberately not a CSS parser: enough to walk rules and their
   declarations, which is all the guards ask. Comments are blanked first
   (length-preserving, so line numbers stay true); strings are skipped so a
   data: URL's own `;` cannot end a declaration early; @media/@supports are
   descended into and recorded as the context of the rules inside them;
   @keyframes frames are walked as rules. */

const path = require('path');
const { CSS_SOURCES, readSources, assemble } = require(path.join(__dirname, '..', '..', 'scripts', 'css-sources.cjs'));

const sources = () => readSources();
const assembled = () => assemble();

function locate(line) {
  let hit = null;
  for (const s of readSources()) if (s.start <= line) hit = s;
  return hit ? `${hit.rel}:${line - hit.start + 1}` : `styles.css:${line}`;
}

function readRulesOf(text, label) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
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
    throw new Error(`${label}: unbalanced brace from line ${lineOf(open)}`);
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
            const t = src.slice(ds, j), colon = t.indexOf(':');
            if (t.trim() && colon > 0) {
              const prop = t.slice(0, colon).trim();
              decls.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
                value: t.slice(colon + 1).trim(), line: lineOf(ds + (t.length - t.trimStart().length)) });
            }
            ds = j + 1;
          }
        }
        rules.push({ file: label, prelude, selectors: splitTop(prelude), context, decls, line: lineOf(i) });
      }
      i = start = close + 1;
    }
  };
  walk(0, src.length, []);
  return rules;
}

/* Over the whole assembled sheet — the only reading that keeps source order, and
   with it the cascade, true across file boundaries. */
const readRules = () => readRulesOf(assemble(), 'styles.css');

module.exports = { CSS_SOURCES, sources, assembled, readRules, readRulesOf, locate };
