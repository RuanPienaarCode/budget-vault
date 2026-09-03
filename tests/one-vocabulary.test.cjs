'use strict';
/* The type vocabulary has ONE owner: src/vocabulary.js. Phase 1 of ADR-0006.

   What this gate forbids, everywhere in src/ except the owner:
     1. the literal pair — 'savings' and 'investment' quoted on one line —
        which was spelled fifteen times under six names on 1.38.0;
     2. a hand-written fold of an account's `type:` (`.trim().toLowerCase()`
        applied to a type), which was copied four times, each copy carrying
        its own comment explaining the trap it guards;
     3. a second reading of a budget row's type (`catType(x.category) ??
        x.type`), which period.js's budgetRowType() already owns.
   And what it requires: every module that used to carry a copy now imports
   the owner, and the owner's sets are the frozen, single objects they claim
   to be.

   Two lines are allowed to name every type, because they ORDER or LIST them
   rather than decide anything: constants.js's TYPE_ORDER and onboarding.js's
   ACCOUNT_TYPE_KEYS (the wizard's account-type picker). Both are named here
   explicitly so a new exemption is a visible edit to this file, not a quiet
   regex widening.

   The check reads source text, the way tests/vocabulary.test.cjs and
   tests/declaration-not-default.test.cjs do, because the defect it guards is
   a SECOND SPELLING — something no behavioural fixture can see until the
   two spellings disagree, by which point it is a release note.

     node tests/one-vocabulary.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const OWNER = 'vocabulary.js';
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'lang') walk(p); continue; }
    if (e.name.endsWith('.js')) files.push(p);
  }
})(SRC);
const rel = p => path.relative(SRC, p);
const read = p => fs.readFileSync(p, 'utf8');

/* Strip block and line comments so a comment that NAMES the old spelling as
   history (there are several, on purpose) does not trip the gate. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ALLOWED = [
  { file: 'constants.js', line: /^const TYPE_ORDER = \[/ },
  { file: 'onboarding.js', line: /^const ACCOUNT_TYPE_KEYS = \[/ },
];
const allowed = (file, line) => ALLOWED.some(a => a.file === file && a.line.test(line));

/* ---- 1. the literal pair ---------------------------------------------- */
{
  const PAIR = /'savings'.*'investment'|'investment'.*'savings'/;
  const hits = [];
  for (const f of files) {
    if (rel(f) === OWNER) continue;
    code(read(f)).split('\n').forEach((line, i) => {
      if (PAIR.test(line) && !allowed(rel(f), line)) hits.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
    });
  }
  eq(hits, [], 'no file outside vocabulary.js spells the savings/investment pair as literals');
}

/* ---- 2. the account-type fold ---------------------------------------- */
{
  const FOLD = /type\)?\s*\|\|\s*''\)\s*\.trim\(\)\s*\.toLowerCase\(\)|\.type\s*\)?\.trim\(\)\.toLowerCase\(\)|typeIs\s*=\s*\(/;
  const hits = [];
  for (const f of files) {
    if (rel(f) === OWNER) continue;
    code(read(f)).split('\n').forEach((line, i) => {
      if (FOLD.test(line)) hits.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
    });
  }
  eq(hits, [], 'no file outside vocabulary.js folds an account type by hand');
}

/* ---- 3. a second reading of a budget row's type ----------------------- */
{
  const COPY = /catType\(\w+\.category\)\s*\?\?\s*\w+\.type/;
  const hits = [];
  for (const f of files) {
    code(read(f)).split('\n').forEach((line, i) => {
      if (COPY.test(line) && !(rel(f) === 'period.js' && /return catType\(b\.category\) \?\? b\.type;/.test(line))) {
        hits.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  eq(hits, [], 'budgetRowType() in period.js is the only reading of a budget row\'s type');
}

/* ---- 4. the former copies now import the owner ------------------------ */
{
  const consumers = [
    'period.js', 'committed.js', 'health-data.js', 'health-math.js', 'savings-math.js', 'money-flow.js',
    'onboarding.js', 'views/score.js', 'views/report.js', 'views/savings.js', 'views/dashboard.js',
  ];
  for (const c of consumers) {
    const s = read(path.join(SRC, c));
    ok(/require\('\.\.?\/vocabulary'\)/.test(s), `${c} imports the vocabulary owner`);
  }
  const budgets = read(path.join(SRC, 'views/budgets.js'));
  ok(/budgetRowType\(d\)/.test(budgets), 'views/budgets.js reads budgetRowType() off ctx rather than re-spelling it');
}

/* ---- 5. the owner is what it claims ----------------------------------- */
{
  const v = require('../src/vocabulary');
  ok(v.SET_ASIDE_TYPES === v.POOL_ACCOUNT_TYPES, 'set-aside categories and pool accounts are ONE Set object, not a copy');
  ok(Object.isFrozen(v.SET_ASIDE_TYPES) && Object.isFrozen(v.INTERNAL_LEG_TYPES) && Object.isFrozen(v.NON_ESSENTIAL_TYPES),
    'the sets are frozen');
  eq([...v.SET_ASIDE_TYPES].sort(), ['investment', 'savings'], 'the pair');
  ok([...v.SET_ASIDE_TYPES].every(t => v.INTERNAL_LEG_TYPES.has(t) && v.NON_ESSENTIAL_TYPES.has(t)),
    'the derived sets contain the pair — built from it, not restated');
  ok(v.isPoolAccount({ type: ' Savings ' }) && v.isPoolAccount({ type: 'INVESTMENT' }) && !v.isPoolAccount({ type: 'checking' }) && !v.isPoolAccount(null),
    'isPoolAccount folds case and whitespace, and a missing account is not a pool');
  ok(v.isSetAsideType('savings') && v.isSetAsideType('investment') && !v.isSetAsideType('expense') && !v.isSetAsideType(null),
    'isSetAsideType names the pair');
  ok(!v.isSetAsideType('Investment'),
    'and compares a CATEGORY type raw, as the loader hands it through and every income/transfer test reads it');
  eq(v.accountsOfType([{ type: 'Savings' }, { type: 'checking' }, { type: 'savings ' }], 'savings').length, 2,
    'accountsOfType folds both sides');
  eq(v.poolAccounts([{ type: 'Savings' }, { type: 'checking' }, { type: 'investment' }, null]).length, 2,
    'poolAccounts is the folded pool filter');
}

console.log(`PASS — one vocabulary: the type sets and the account-type fold have one owner (${checks} checks)`);
