'use strict';
/* THE STYLESHEET HAS ONE DECLARED ASSEMBLY, AND EVERYTHING SHIPPED IS IN IT.

   Root styles.css is the plain concatenation of scripts/css-sources.cjs's list,
   in that order, and every CSS guard test reads the same list through
   tests/helpers/css-sources.cjs. Four things must stay true for that to mean
   anything:

     1. THE ORDER IS THE CASCADE, AS DECLARED: fonts, the legacy sheet, the
        statement foundation, the three page lanes, the generated palettes LAST.
        Presets last is not cosmetic: they are the only block that must beat the
        base tokens, and a lane that ended up after them could re-point a token
        a palette had just set.
     2. NOTHING SHIPPED IS LEFT OUT. Every .css file under src/ is in the list. A
        lane file added but not listed would be written, reviewed, and silently
        never loaded.
     3. THE LANES ARE SEPARATE FILES. Three lanes can only work in parallel without
        ever editing the same file if each owns exactly one, named for it, so
        the list pins the names the page lanes were briefed with.
     4. EVERY FILE ENDS WITH A NEWLINE, because the assembly inserts no separator:
        a file that ended mid-line would glue its last rule to the next file's
        first, and the damage would appear as a rule that silently stopped
        applying somewhere else.

   And the helper the other guards use really does see the whole assembly: a rule
   planted in a lane file is found by readRules(), with the line it has in the
   shipped sheet.

   Pure node.  node tests/css-sources.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { CSS_SOURCES, assemble, readSources } = require('../scripts/css-sources.cjs');
const helper = require('./helpers/css-sources.cjs');

/* ---- 1. the declared order ---- */
eq(CSS_SOURCES, [
  'src/styles-fonts.css',
  'src/styles.css',
  'src/statement/foundation.css',
  'src/statement/dashboard.css',
  'src/statement/budget.css',
  'src/statement/transactions.css',
  'src/statement/phone.css',
  'src/statement/phone-tables.css',
  'src/styles-presets.css',
], 'fonts -> legacy -> foundation -> three lanes -> two phone lanes -> presets, in that order');
eq(CSS_SOURCES[CSS_SOURCES.length - 1], 'src/styles-presets.css', 'the generated palette blocks are last');

/* ---- 2. nothing under src/ is left out ---- */
const cssOnDisk = [];
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.css')) cssOnDisk.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
};
walk(path.join(ROOT, 'src'));
eq(cssOnDisk.sort(), [...CSS_SOURCES].sort(), 'every .css file under src/ is in the assembly, and every listed file exists');

/* ---- 3 + 4. each file: present, newline-terminated; lanes open with a header ---- */
for (const s of readSources()) {
  ok(s.text.length > 0, `${s.rel} is not empty`);
  ok(s.text.endsWith('\n'), `${s.rel} ends with a newline (the assembly adds no separator)`);
  if (/^src\/statement\/(?!foundation)/.test(s.rel)) {
    ok(/^\/\* Statement lane: .*\*\/\n/.test(s.text), `${s.rel} opens with its one-line lane header`);
  }
}
eq(assemble(), readSources().map(s => s.text).join(''), 'assemble() is the bare concatenation');

/* ---- the root file is that concatenation (also pinned by css-class-coverage) ---- */
ok(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8') === assemble(), 'root styles.css is the assembled sources — run npm run build');

/* ---- the shared helper sees every file, in order, with true line numbers ---- */
const sources = helper.sources();
const lane = sources.find(s => s.rel === 'src/statement/budget.css');
ok(lane && lane.start > sources.find(s => s.rel === 'src/styles.css').start, 'the helper reports each file with its start line, in cascade order');
const planted = helper.readRulesOf('.a { color: red; }\n\n.b { top: 0; }\n', 'planted');
eq(planted.map(r => [r.selectors[0], r.line]), [['.a', 1], ['.b', 3]], 'readRulesOf reports the line each rule is on');
const all = helper.readRules();
ok(all.length > 1000, `readRules() walks the whole assembly (${all.length} rules)`);
ok(all.some(r => r.selectors.includes('.budget-app-root .st-statement')), 'readRules() finds a rule that only the foundation file defines');
const foundationStart = sources.find(s => s.rel === 'src/statement/foundation.css').start;
const legacyHero = all.find(r => r.selectors.includes('.budget-app-root .hero-num'));
const foundationHero = all.filter(r => r.selectors.includes('.budget-app-root .hero-num')).pop();
ok(legacyHero.line < foundationStart && foundationHero.line > foundationStart,
  'a selector defined in both files is read legacy-first, foundation-last — the order the cascade uses');
ok(helper.locate(foundationHero.line).startsWith('src/statement/foundation.css:'), 'locate() turns an assembled line back into file:line');

console.log(`PASS css-sources — ${CSS_SOURCES.length} files in declared order, none left out, newline-terminated, helper sees them all (${checks} checks)`);
