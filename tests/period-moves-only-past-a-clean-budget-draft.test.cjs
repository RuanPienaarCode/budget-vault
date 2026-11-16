'use strict';
/* S.period moves in three places, and none of them may move it past a dirty
   Budgets draft without the reader's say-so.

   The Budgets draft belongs to the period on screen: views/budgets.js
   budgetDraft() rebuilds it, silently, the first time it runs under a
   different S.period. The 16 Nov 2026 audit found the pill's arrows asked
   only on the Budgets page (fixed in controller.js makePeriodChanger, driven
   for real by tests/budget-period-change-confirm.test.cjs) — and then that a
   receipt save on the Food page moved the period with no guard at all.

   food.js needs the host and cannot run in bare node, so this is a source
   pin: every assignment to S.period in src/ is one of the known sites, and
   each is guarded the way its site requires. A NEW assignment anywhere fails
   here until it is listed and guarded.

   node tests/period-moves-only-past-a-clean-budget-draft.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

const SRC = path.join(__dirname, '../src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(SRC);

/* An assignment, not a comparison: "S.period =" not followed by "=". */
const ASSIGN = /\bS\.period\s*=(?!=)/;
const sites = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (ASSIGN.test(code) && !/^\s*(\/\*|\*)/.test(line)) {
      sites.push({ file: path.relative(SRC, f), line: i + 1, text: line.trim(), lines });
    }
  });
}

const byFile = name => sites.filter(s => s.file === name);
const known = ['controller.js', 'load.js', path.join('views', 'food.js')];
const strays = sites.filter(s => !known.includes(s.file));
ok(strays.length === 0, 'an unlisted assignment to S.period: ' + strays.map(s => `${s.file}:${s.line}`).join(', '));

/* controller.js — the pill. One assignment, inside makePeriodChanger, after
   the question about the draft. */
{
  const c = byFile('controller.js');
  ok(c.length === 1, 'controller.js moves the period in exactly one place');
  const src = c[0].lines.join('\n');
  const body = src.slice(src.indexOf('function makePeriodChanger'), src.indexOf('function mountApp'));
  ok(/S\.period = next;/.test(body), 'that place is makePeriodChanger');
  ok(body.indexOf('ctx.budgetDirty()') >= 0 && body.indexOf('ctx.budgetDirty()') < body.indexOf('S.period = next;'),
    'which asks about the draft before it moves');
  ok(!/S\.view\s*===\s*'budgets'\s*&&\s*ctx\.budgetDirty\(\)/.test(body), 'whatever page is showing');
}

/* load.js — the first period of a load that has none. Not a move. */
{
  const l = byFile('load.js');
  ok(l.length === 1, 'load.js sets the period in exactly one place');
  ok(/if \(!S\.period \|\| !periodKeyValid\(S\.period\)\) S\.period = currentPeriod\(\);/.test(l[0].text),
    'and only when there is no valid period yet');
}

/* views/food.js — the jump to a saved receipt's period. Skipped while the
   Budgets draft is dirty. */
{
  const f = byFile(path.join('views', 'food.js'));
  ok(f.length === 1, 'food.js moves the period in exactly one place');
  ok(/^if \(!budgetDraftDirty\) S\.period = currentPeriod\(got\.date\);$/.test(f[0].text),
    'and not past a dirty Budgets draft');
  const src = f[0].lines.join('\n');
  ok(/const budgetDraftDirty = typeof ctx\.budgetDirty === 'function' && ctx\.budgetDirty\(\);/.test(src),
    'the draft is asked through ctx.budgetDirty, late-bound as budget-export.js reads it');
}

console.log(`PASS period-moves-only-past-a-clean-budget-draft — every S.period assignment is listed and guarded (${checks} checks)`);
