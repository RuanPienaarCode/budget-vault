'use strict';
/* Guard for the three-bug i18n pass (obsidian-plugin-engineer, 2026-08-24):

     1. bud.pull.title / acct.balance.impliedHint / acct.balance.updatedDrift
        carried a literal "(s)" instead of the plural object form lang/en.js's
        own header requires. Fixed in all seven shipped languages.
     2. controller.js's typeBadge rendered the raw TYPE_ORDER enum
        (`expense`, `housing`, …) instead of routing through the already-
        translated `wiz.type.*` keys — with a raw-value FALLBACK for a
        household's own custom group name, because t() returning the key
        itself ('wiz.type.mygroup') is worse than the raw word it replaced.
     3. views/dashboard.js built an English-only plural by string surgery
        (`categor${n===1?'y':'ies'}`) inside a view that IS translated —
        replaced by the dash.split.summary plural entry.

   Each assertion below is negative-controlled: the exact checker used against
   the real, fixed source is first run against a known-bad fixture that
   reproduces the ORIGINAL buggy text verbatim (captured from git history
   before this fix, not paraphrased), and is asserted to FAIL there. That
   proves the checker can actually see the bug it is guarding against, not
   just that the current file happens to pass it. Fixtures are NOT git
   checkouts of the working tree — this repo has concurrent sessions editing
   it live (see CLAUDE.md), and briefly reverting owner files on disk to take
   a "before" measurement would race whatever else is running. Everything
   here is in-memory.

     node tests/i18n-three-bugs-guard.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const i18n = require(path.join(SRC, 'i18n.js'));
const { TABLES, LANGUAGE_ORDER, pluralCategory } = i18n;

/* ============================================================================
   Bug 1 — literal "(s)" must not appear in ANY string value, in ANY table.
   Scoped to the checker function itself, not to the three known keys, so a
   FOURTH key carrying this shape (in any language, present or future) also
   fails here — the brief's three were found by inspection, not by this kind
   of scan, so nothing guaranteed they were the only three. ========================== */

/* Walks a table's values (plain strings and plural-object forms alike) and
   returns every (key, form, value) triple that contains the literal "(s)". */
function findLiteralS(table) {
  const hits = [];
  for (const [key, v] of Object.entries(table)) {
    if (typeof v === 'string') {
      if (v.includes('(s)')) hits.push({ key, form: '', value: v });
    } else if (v && typeof v === 'object') {
      for (const [form, s] of Object.entries(v)) {
        if (typeof s === 'string' && s.includes('(s)')) hits.push({ key, form, value: s });
      }
    }
  }
  return hits;
}

/* ---- negative control: the checker must catch the bug it is named for ---- */
const BAD_FIXTURE = {
  // Captured verbatim from lang/en.js before this fix (git blob 326b8ce).
  'bud.pull.title': 'Fill this in from the overspend {lag} period(s) back',
  'acct.balance.impliedHint': 'Your transactions imply {amount} after {count} row(s) since you last confirmed.',
  'acct.balance.updatedDrift': '{name} balance saved — but {count} row(s) since that date differ by {amount}. Open the account to see them.',
  'acct.balance.title': 'Update balance — {name}',   // a clean key must NOT be flagged
};
const badHits = findLiteralS(BAD_FIXTURE);
eq(badHits.map(h => h.key).sort(), ['acct.balance.impliedHint', 'acct.balance.updatedDrift', 'bud.pull.title'],
  'RED CHECK: findLiteralS must catch the exact pre-fix strings, and only those three keys — proves the ' +
  'checker actually detects the "(s)" bug rather than passing by construction');

/* ---- the real assertion: no table ships a literal "(s)" anywhere ---- */
const allHits = [];
for (const [lang, table] of Object.entries(TABLES)) {
  for (const h of findLiteralS(table)) allHits.push(`${lang}.js '${h.key}'${h.form ? ` (${h.form})` : ''}`);
}
eq(allHits, [], `no lang table may carry a literal "(s)" — found: ${allHits.join(', ')}`);

/* ---- the three keys specifically: object form, in every shipped language,
   with every category that language's own plural rule can ask for. Not just
   "not a string" — the exact three-way regression this bug shipped as: a
   translator (or the original author) flattening a plural key back to one
   string reads correctly at 1 and wrong everywhere else. ---- */
const THREE_KEYS = ['bud.pull.title', 'acct.balance.impliedHint', 'acct.balance.updatedDrift'];
for (const key of THREE_KEYS) {
  for (const lang of LANGUAGE_ORDER) {
    const v = TABLES[lang][key];
    ok(v && typeof v === 'object', `${lang}.js '${key}' must be a plural object form, not a plain string`);
    for (const n of [0, 1, 2, 5]) {
      const cat = pluralCategory(lang, n);
      ok(typeof v[cat] === 'string', `${lang}.js '${key}' is missing the '${cat}' form (n=${n})`);
    }
  }
}

/* ============================================================================
   Bug 3 — dash.split.summary must exist, be a plural object in every
   language, and carry {amount}/{count}/{month} in every form it defines. ==== */
for (const lang of LANGUAGE_ORDER) {
  const v = TABLES[lang]['dash.split.summary'];
  ok(v && typeof v === 'object', `${lang}.js must carry 'dash.split.summary' as a plural object`);
  for (const [form, s] of Object.entries(v)) {
    for (const ph of ['{amount}', '{count}', '{month}']) {
      ok(s.includes(ph), `${lang}.js 'dash.split.summary' (${form}) drops ${ph} — the value would vanish`);
    }
  }
}

/* ============================================================================
   Bug 3, source check — the hand-built English plural must be gone from
   dashboard.js, and the fixed call site must be there instead. ============== */
const dashboardSrc = fs.readFileSync(path.join(SRC, 'views', 'dashboard.js'), 'utf8');

/* ---- negative control: the checker must catch the exact old pattern ---- */
const OLD_DASHBOARD_LINE =
  "`${money(total)} across ${spend.length} categor${spend.length === 1 ? 'y' : 'ies'} · ${periodMonthName(S.period)}`";
const HAND_BUILT_PLURAL_RE = /categor\$\{[^}]*===\s*1\s*\?\s*'y'\s*:\s*'ies'\}/;
ok(HAND_BUILT_PLURAL_RE.test(OLD_DASHBOARD_LINE),
  'RED CHECK: the hand-built-plural regex must match the exact pre-fix dashboard.js line');

/* ---- the real assertion ---- */
ok(!HAND_BUILT_PLURAL_RE.test(dashboardSrc),
  'dashboard.js must not hand-build an English plural with string surgery (categor${n===1?...})');
ok(/i18n\.t\(\s*'dash\.split\.summary'/.test(dashboardSrc),
  'dashboard.js must render its spend-breakdown summary through the dash.split.summary key');

/* ============================================================================
   Bug 2 — controller.js's typeBadge must route through wiz.type.*, with a
   raw-value fallback (not the literal key) for a type with no translation. */
const controllerSrc = fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8');

/* ---- negative control: the OLD typeBadge, reproduced verbatim, must leak
   the raw enum for a type that DOES have a translation — that is the bug. */
function oldTypeBadgeText(type) {
  // el('span', { class: `category-badge badge-${type}` }, type) — the text
  // argument is `type` itself, unconditionally.
  return type;
}
ok(oldTypeBadgeText('housing') === 'housing' && oldTypeBadgeText('housing') !== i18n.t('wiz.type.housing'),
  "RED CHECK: the pre-fix typeBadge shape renders the raw enum even though 'wiz.type.housing' is translated");

/* ---- the real assertion: reproduce the FIXED typeBadge (kept in sync by
   hand with controller.js, same convention tests/i18n-render.test.cjs already
   uses for this exact function — controller.js has no standalone export to
   import, since typeBadge closes over ctx built inside the plugin's mount()),
   pinned against the source text so a drift between the two is itself a
   failure here rather than a silent divergence. ---- */
ok(/const typeBadge = type => \{/.test(controllerSrc),
  'controller.js must still define typeBadge as a block-bodied arrow function (not the old one-liner)');
ok(/i18n\.t\(key\)/.test(controllerSrc) && /'wiz\.type\.' \+ type/.test(controllerSrc),
  "controller.js's typeBadge must resolve the label through i18n.t('wiz.type.' + type)");
ok(/label === key \? type : label/.test(controllerSrc),
  'controller.js must fall back to the RAW type value when no wiz.type.* key matches — t() returning the ' +
  'key itself (e.g. "wiz.type.mygroup") would render worse than the raw word it replaced');

function fixedTypeBadgeText(type) {
  const key = 'wiz.type.' + type;
  const label = i18n.t(key);
  return label === key ? type : label;
}
i18n.setLanguage('en');
ok(fixedTypeBadgeText('housing') === i18n.t('wiz.type.housing') && fixedTypeBadgeText('housing') !== 'housing',
  "typeBadge('housing') must render the translated 'wiz.type.housing' label, not the raw enum");
ok(fixedTypeBadgeText('a household custom group') === 'a household custom group',
  'typeBadge() for a type with no wiz.type.* key must fall back to the raw value, not the raw i18n key ' +
  '("wiz.type.a household custom group" would be worse than the word it replaced)');

console.log(
  `PASS — i18n three-bug guard: ${checks} checks (literal-"(s)" scan across ${LANGUAGE_ORDER.length} ` +
  'languages, dash.split.summary plural coverage, dashboard.js source check, typeBadge fallback).');
