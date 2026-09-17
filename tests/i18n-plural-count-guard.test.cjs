'use strict';
/* #79 item 2 — nothing checked that a PLURAL key's call site actually passes
   `count:`. i18n.js's t() selects the plural form off `params.count` ALONE
   (see its own header): a key that pluralises on `{lag}`, `{days}` or
   `{shown}` still needs `count` passed BESIDE that variable, or every
   language's plural rule falls through to whatever `Number(undefined) || 0`
   resolves to. The 2026-09-09 mutation-testing pass found this by DELETING
   `count:` from two shipped call sites (dash.pos.owedOldest and
   dash.stale.oldest) and watching all 181 suites stay green while the
   Dashboard rendered "the oldest 1 days ago" — a real, rendered, wrong
   sentence with nothing to catch it. Both are correct today; this file is
   the guard that keeps them that way.

   A PLURAL key, for this file's purposes, is exactly the shape src/i18n.js's
   own lookup() branches on: `typeof v === 'string'` is an ordinary key,
   anything else (an object carrying `one`/`other`) is plural and needs a
   count to choose between them.

   Static analysis, not a runtime render sweep — tests/i18n-render.test.cjs
   and tests/views-render.test.cjs already prove every view renders; this
   file's job is narrower and cheaper: prove every call site that COULD ask
   for a plural form is holding out a `count` for it to ask with, before the
   render ever happens. src/ is scanned as text (comments and strings
   stripped first — the earlier draft of this scan flagged
   "i18n.t() returns the key itself when nothing matches", a sentence in a
   controller.js COMMENT, as a real call site with no arguments, which is
   exactly the kind of false alarm that trains a reader to stop reading this
   suite's output).

   Four call-site shapes are resolved MECHANICALLY, in order of how much of
   the key they pin down:
     1. a plain string literal                         i18n.t('debt.interest.partial', …)
     2. a two-way ternary of two string literals        i18n.t(a ? 'x' : 'y', …)
     3. a local `const NAME = 'literal'` (or 'literal' + expr) binding,
        resolved back to its RHS                        i18n.t(UNREADABLE_KEY, …)
     4. a template literal / concatenation with a static leading prefix
        ('foo.' + x, `foo.${x}`) — checked as a PREFIX against every plural
        key, the same two-sided idea tests/i18n.test.cjs's own invariant 6
        already uses for "does this prefix have anything behind it".

   What is left after all four — a bare property access with no traceable
   local literal behind it (`g.key`, `line.label`) or a nested ternary this
   scan's deliberately narrow pattern doesn't parse — is NOT silently passed.
   Each one is named in MANUAL_AUDIT or PREFIX_AUDIT below, with the actual
   enumeration or branch it was checked against, and the count of unaudited
   leftovers must be exactly zero: a new dynamic call site anyone adds to
   src/ without extending one of those two lists fails this test, rather than
   being invisibly absorbed into "dynamic, therefore fine".

   Runs in bare node. Wired into ./build.sh via scripts/run-tests.mjs.
     node tests/i18n-plural-count-guard.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the plural-key set, off the exact shape lookup() switches on ---- */
const en = i18n.TABLES.en;
const PLURAL_KEYS = new Set(Object.keys(en).filter(k => {
  const v = en[k];
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}));
ok(PLURAL_KEYS.size > 50, `sanity: expected dozens of plural entries in en.js, found ${PLURAL_KEYS.size}`);

/* ================================ scanning ================================= */

/* Blank out comments and (separately) leave string/template contents intact
   but string-delimited, so `i18n.t(` inside a `/* … i18n.t() … *‍/` comment is
   never mistaken for a call, while `i18n.t(` nested inside another call's own
   template-literal argument (`` `${i18n.t('x')}` ``) is still found — it is
   simply a second, independent match of the same top-level regex below.
   Hand-rolled char-by-char, like markdown.js's own splitBarePipes, rather than
   a lookbehind: no lookbehind literal may ship in src/, and this file's own
   patterns are held to the same iOS 15 floor as a matter of house style, even
   though tests/ is not shipped. */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const two = text[i] + (text[i + 1] || '');
    if (two === '//') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (two === '/*') {
      out += '  '; i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] || ''); i += 2; continue; }
        if (text[i] === quote) { out += text[i]; i++; break; }
        out += text[i]; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/* Every `i18n.t(` call, with its balanced argument text and 1-based line. */
function findCalls(text) {
  const calls = [];
  const re = /i18n\.t\(/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    let depth = 1, i = start, inStr = null;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    calls.push({ line: text.slice(0, m.index).split('\n').length, argsText: text.slice(start, i - 1) });
  }
  return calls;
}

/* Top-level comma split — respects (), [], {} nesting and every quote style,
   so a params object's own nested braces never get mistaken for the end of
   the second argument. */
function splitTop(s, sepChars = ',') {
  const out = [];
  let depth = 0, cur = '', inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += s[++i]; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; cur += c; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; cur += c; continue; }
    if (depth === 0 && sepChars.includes(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/* Does this params-object BODY (the text between its outer `{`/`}`) name
   `count` as one of its OWN top-level keys — `{ count: n, … }` or the
   shorthand `{ count, … }`? Top-level only, deliberately: a `count` buried
   inside a NESTED object one property down is not what `params.count` reads. */
function hasTopLevelCount(inner) {
  return splitTop(inner).some(entry => {
    const e = entry.trim();
    return /^count\s*:/.test(e) || /^count\s*$/.test(e);
  });
}

const LOCAL_LITERAL_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:\\.|(?!\2).)*)\2\s*;/g;
/* `const key = 'wiz.type.' + type;` — a local binding whose RHS starts with a
   literal and then concatenates something dynamic. Resolved to a PREFIX
   (mechanism 4 below), not a whole key. */
const LOCAL_PREFIX_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:\\.|(?!\2).)*)\2\s*\+/g;
function localBindings(text) {
  const literal = new Map(), prefix = new Map();
  let m;
  LOCAL_LITERAL_RE.lastIndex = 0;
  while ((m = LOCAL_LITERAL_RE.exec(text))) literal.set(m[1], m[3]);
  LOCAL_PREFIX_RE.lastIndex = 0;
  while ((m = LOCAL_PREFIX_RE.exec(text))) if (!literal.has(m[1])) prefix.set(m[1], m[3]);
  return { literal, prefix };
}

const LITERAL_RE = /^(['"])((?:\\.|(?!\1).)*)\1$/;
const TERNARY_LITERAL_RE = /^[\s\S]+?\?\s*(['"])((?:\\.|(?!\1).)*)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3\s*$/;
const CONCAT_PREFIX_RE = /^(['"])((?:\\.|(?!\1).)*)\1\s*\+/;
const TEMPLATE_PREFIX_RE = /^`([^`$]*)\$\{/;

/* Resolve the first argument of one i18n.t() call to either a set of exact
   candidate KEYS (mechanisms 1–3) or a static PREFIX (mechanism 4), or
   neither (opaque — property access, an un-parsed nested ternary, …). */
function resolveKey(first, bindings) {
  const lit = first.match(LITERAL_RE);
  if (lit) return { keys: [lit[2]] };
  const tern = first.match(TERNARY_LITERAL_RE);
  if (tern) return { keys: [tern[2], tern[4]] };
  if (bindings.literal.has(first)) return { keys: [bindings.literal.get(first)] };
  if (bindings.prefix.has(first)) return { prefix: bindings.prefix.get(first) };
  const concat = first.match(CONCAT_PREFIX_RE);
  if (concat) return { prefix: concat[2] };
  const tmpl = first.match(TEMPLATE_PREFIX_RE);
  if (tmpl) return { prefix: tmpl[1] };
  return { opaque: first };
}

/* ============================================================================
   PREFIX_AUDIT — a dynamic key built as `'prefix.' + x` / `` `prefix.${x}` ``
   whose prefix DOES have at least one plural key behind it (most prefixes in
   src/ have none, and need no entry here at all — see the assertion below
   that checks every OTHER prefix has zero plural keys under it automatically).
   Each entry records what was actually read to confirm the plural branch is
   unreachable from this call site. Keyed by prefix; a prefix used at more
   than one call site (dash.health. is) is audited once and covers all of
   them, since the reasoning is about the ENUMERATION driving it, not the
   line it happens to be read from. ============================================================================ */
const PREFIX_AUDIT = {
  'acct.deck.why.': 'src/views/accounts.js deckWhy() — r.state === \'drift\' and \'stale\' (the two plural '
    + 'members of this family besides \'unreadable\', which is also handled explicitly) are both matched by '
    + 'their OWN literal-keyed branch, each passing count, before the template fallback runs; the fallback is '
    + 'reached only for nodate/notx/nofolder, none of which is plural.',
  'acct.state.': 'src/views/accounts.js statePill() — its own comment names \'stale\' as "the only state whose '
    + 'pill states a number", handled by its own literal-keyed branch with count; the template fallback runs '
    + 'only for the remaining (non-plural) states.',
  'dash.health.': 'src/views/dashboard.js renderDashboard() and src/views/score.js showTotal() both feed this '
    + 'template from scoreBand()/the pre-computed band field, whose only possible values are strong/steady/'
    + 'attention (see BAND_TONE\'s key set) — none of which is plural; dash.health.sub/meterTip/monthsMeta (the '
    + 'plural members of this family) are reached only through their own literal-keyed call sites elsewhere.',
};
for (const p of Object.keys(PREFIX_AUDIT)) {
  ok([...PLURAL_KEYS].some(k => k.startsWith(p)),
    `PREFIX_AUDIT entry '${p}' names a prefix with no plural key behind it any more — remove the now-dead entry`);
}

/* ============================================================================
   MANUAL_AUDIT — a call site this scan's four mechanisms cannot resolve to
   even a prefix (a bare property access, or a nested ternary its
   deliberately narrow two-way pattern does not parse), matched by the file it
   lives in and the exact (whitespace-trimmed) first-argument text. Each entry
   records the finite enumeration actually read to reach its conclusion. A
   call site not on this list, and not resolved by one of the four mechanisms
   above, fails the "every opaque site is accounted for" assertion below —
   the mechanism that keeps this honest rather than a silent skip. ============================================================================ */
const MANUAL_AUDIT = [
  { file: 'src/onboarding.js', first: 'line.label',
    note: 'FIRST_BUDGET_LINES\'s five label keys (wiz.first.income/housing/food/services/savings) are all '
      + 'plain strings in en.js — none plural.' },
  { file: 'src/views/accounts.js', first: 'g.key',
    note: 'ACCT_GROUPS\'s four key literals (acct.group.bank/savings/investments/other) are all plain strings '
      + 'in en.js — none plural. (acct.group.count, the one plural member of this family, is a DIFFERENT key, '
      + 'read only via its own literal-keyed call site with count.)' },
  { file: 'src/views/accounts.js', first: 'key',
    note: 'the SAME ACCT_GROUPS enumeration as g.key above, destructured directly (`for (const [key] of '
      + 'ACCT_GROUPS)` / `.map(([key]) => …)`) rather than read off a row object — same four literals, none plural.' },
  { file: 'src/report.js', first: 'key',
    note: 'currencyLine(pairs, key = \'acct.hero.otherCurrencies\') is called with no second argument (using '
      + 'the default) or explicitly with \'report.debt.otherCurrencies\' — both plain strings in en.js.' },
  { file: 'src/views/score.js',
    first: "noHistory\n            ? (S.settings.input_mode === 'manual' ? 'score.empty.body.manual' : 'score.empty.body')\n            : 'score.empty.unmeasured.body'",
    note: 'all three literal branches (score.empty.body.manual / score.empty.body / score.empty.unmeasured.body) '
      + 'are plain strings in en.js — a nested ternary this scan\'s two-way pattern does not parse.' },
  { file: 'src/views/score.js',
    first: "p.key === 'debt' && !debtsRecorded ? 'score.win.debtNone'\n              : p.key === 'debt' && debtRateUnknown ? 'score.win.debtNoRate'\n                : `score.win.${p.key}`",
    note: 'the two literal branches (score.win.debtNone/debtNoRate) are plain strings in en.js, and the '
      + 'template-literal fallback\'s prefix (score.win.) has no plural key behind it at all.' },
];
const auditKey = (file, first) => `${file}::${first.trim()}`;
const AUDITED = new Set(MANUAL_AUDIT.map(e => auditKey(e.file, e.first)));

/* ================================== walk src/ ================================ */

const SRC = path.join(__dirname, '..', 'src');
function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    // src/lang/*.js is DATA (the tables themselves) — no i18n.t() call sites
    // live there, and en.js's own plural VALUES contain literal "{count}"
    // text that would otherwise be misread as call-site params.
    else if (e.name.endsWith('.js') && path.basename(dir) !== 'lang') out.push(p);
  }
  return out;
}
const FILES = walk(SRC);
ok(FILES.length > 20, `sanity: expected dozens of src/ files to scan, found ${FILES.length}`);

/* The actual sweep, factored so the negative control can run it over a
   synthetic in-memory "file" instead of anything on disk. Returns
   { failures, auditedOpaque, unauditedOpaque, prefixSafe }. */
function auditText(relFile, rawText) {
  const failures = [];
  const unauditedOpaque = [];
  let auditedOpaque = 0, prefixSafe = 0, pluralCallsChecked = 0;

  const text = stripComments(rawText);
  const bindings = localBindings(text);
  for (const call of findCalls(text)) {
    const args = splitTop(call.argsText);
    const first = (args[0] || '').trim();
    if (!first) continue; // nothing left after stripping — not a real call
    const resolved = resolveKey(first, bindings);
    const second = args[1] ? args[1].trim() : '';

    if (resolved.opaque !== undefined) {
      if (AUDITED.has(auditKey(relFile, first))) auditedOpaque++;
      else unauditedOpaque.push({ file: relFile, line: call.line, first });
      continue;
    }
    if (resolved.prefix !== undefined) {
      const hits = [...PLURAL_KEYS].some(k => k.startsWith(resolved.prefix));
      if (!hits) { prefixSafe++; continue; }
      if (!(resolved.prefix in PREFIX_AUDIT)) {
        failures.push(`${relFile}:${call.line}: dynamic key with prefix '${resolved.prefix}' now has a plural `
          + 'key behind it and is NOT in PREFIX_AUDIT — verify the plural branch is unreachable here, or fix it');
      }
      continue;
    }
    for (const key of resolved.keys) {
      if (!PLURAL_KEYS.has(key)) continue;
      pluralCallsChecked++;
      if (!second) {
        failures.push(`${relFile}:${call.line}: i18n.t('${key}') is a PLURAL key but this call passes no params `
          + 'at all — every language falls through to whatever count the missing {count} resolves to');
        continue;
      }
      if (!second.startsWith('{')) {
        failures.push(`${relFile}:${call.line}: i18n.t('${key}', ${second}) passes its params via a variable/`
          + 'expression this scan cannot see into — allowlist it here with the count: verified by hand, or '
          + 'pass an inline { … } literal so this guard can check it directly');
        continue;
      }
      if (!hasTopLevelCount(second.slice(1, -1))) {
        failures.push(`${relFile}:${call.line}: i18n.t('${key}', ${second}) is a PLURAL key with no top-level `
          + 'count: in its params — the #79 mutation-testing shape ("the oldest 1 days ago")');
      }
    }
  }
  return { failures, auditedOpaque, unauditedOpaque, prefixSafe, pluralCallsChecked };
}

/* ================================ the real sweep ================================ */

let allFailures = [];
let totalAuditedOpaque = 0, totalUnaudited = [], totalPrefixSafe = 0, totalPluralChecked = 0;
for (const file of FILES) {
  const rel = path.relative(path.join(SRC, '..'), file);
  const { failures, auditedOpaque, unauditedOpaque, prefixSafe, pluralCallsChecked } =
    auditText(rel, fs.readFileSync(file, 'utf8'));
  allFailures = allFailures.concat(failures);
  totalAuditedOpaque += auditedOpaque;
  totalUnaudited = totalUnaudited.concat(unauditedOpaque);
  totalPrefixSafe += prefixSafe;
  totalPluralChecked += pluralCallsChecked;
}

ok(totalPluralChecked > 50, `sanity: expected dozens of plural-key call sites to have been checked, found ${totalPluralChecked}`);

eq(totalUnaudited.map(u => `${u.file}:${u.line}: ${JSON.stringify(u.first)}`), [],
  'every i18n.t() call site whose key this scan cannot resolve to a literal or a safe prefix must be named in '
  + 'MANUAL_AUDIT with the enumeration it was checked against — a NEW one here means either extend a resolver '
  + 'or add an audited entry, not silently trust it');

eq(allFailures, [],
  `${allFailures.length} i18n.t() call site(s) name a PLURAL key without a working count: — see the list above`);

console.log(`i18n-plural-count-guard: ${totalPluralChecked} plural-key call sites checked, `
  + `${totalPrefixSafe} dynamic-prefix sites cleared by having no plural key behind them, `
  + `${Object.keys(PREFIX_AUDIT).length} prefixes and ${totalAuditedOpaque} opaque call sites hand-audited, `
  + '0 failures.');

/* ============================================================================
   NEGATIVE CONTROL — the scan must actually go red on the shapes it claims to
   catch, run over a synthetic snippet rather than anything shipped in src/,
   so this proves the MACHINERY, not today's (already-clean) codebase. ============================================================================ */
{
  // A real plural key (debt.interest.partial has one/other forms — see en.js)
  // called three broken ways, plus one correct call as the sanity check that
  // the scanner does not simply flag everything.
  const snippet = `
    function ok1() {
      return i18n.t('debt.interest.partial', { shown, total, missing, count: missing });
    }
    function bad1() {
      return i18n.t('debt.interest.partial');
    }
    function bad2() {
      return i18n.t('debt.interest.partial', { shown, total, missing });
    }
    function bad3(params) {
      return i18n.t('debt.interest.partial', params);
    }
  `;
  const { failures } = auditText('NEGATIVE-CONTROL.js', snippet);
  eq(failures.length, 3, `NEGATIVE CONTROL: expected exactly 3 flagged call sites (no args / no count: / a `
    + `variable params object), got ${failures.length}:\n${failures.join('\n')}`);
  ok(failures.some(f => f.includes('passes no params at all')), 'NC1: the no-arguments-at-all shape is caught');
  ok(failures.some(f => f.includes('no top-level')), 'NC2: the params-without-count shape is caught');
  ok(failures.some(f => f.includes('variable/expression')), 'NC3: the variable-params-object shape is caught');
  checks += 3;
}

/* A second negative control: an UNAUDITED opaque call site must be reported,
   not silently absorbed — proving MANUAL_AUDIT is load-bearing rather than
   decorative. */
{
  const snippet = `function f(g) { return i18n.t(g.someRandomProperty); }`;
  const { unauditedOpaque } = auditText('NEGATIVE-CONTROL-2.js', snippet);
  eq(unauditedOpaque.length, 1, 'NEGATIVE CONTROL: an opaque call site with no MANUAL_AUDIT entry is reported, not swallowed');
  checks += 1;
}

console.log(`PASS — i18n-plural-count-guard.test.cjs (${checks} checks).`);
