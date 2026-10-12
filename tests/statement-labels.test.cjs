'use strict';
/* LABELS ARE SENTENCE CASE: NO UPPERCASE EYEBROWS, NO SPACED-OUT CAPITALS.

   The October 2026 statement-type redesign drops the uppercase, letter-spaced label treatment
   the old sheet used on column headers, KPI captions and section eyebrows:
   labels read as ordinary sentence-case text in the new type. Nineteen rules in
   src/styles.css carried it and were stripped; this holds the line so a page lane
   cannot bring it back:

     1. nothing under .budget-app-root declares `text-transform: uppercase`
        anywhere in the assembled stylesheet. (The body-mounted dialogs —
        .budget-onb-* and .budget-export-* — are not under the root and are
        Obsidian's furniture, so they are out of scope, as they are for the
        host-cascade guard.)
     2. the statement files (foundation and the three lanes) declare no
        positive letter-spacing. Tight negative tracking on big figures is the
        design; open tracking on a label is the eyebrow this removes.

   The detector proves it can see both shapes before it is trusted.
     node tests/statement-labels.test.cjs */

const assert = require('assert');
const { readRules, readRulesOf, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const positive = v => {
  const m = /^\+?(\d*\.?\d+)(px|em|rem)\b/.exec(String(v).trim());
  return !!m && parseFloat(m[1]) > 0;
};

function findings(rules, isStatementFile) {
  const out = [];
  for (const r of rules) {
    for (const d of r.decls) {
      if (d.prop === 'text-transform' && /^uppercase$/i.test(d.value) && r.selectors.some(s => s.includes('.budget-app-root'))) {
        out.push(`${locate(d.line)}  ${r.prelude.slice(0, 70)}  { text-transform: uppercase }`);
      }
      if (d.prop === 'letter-spacing' && positive(d.value) && isStatementFile(d.line)) {
        out.push(`${locate(d.line)}  ${r.prelude.slice(0, 70)}  { letter-spacing: ${d.value} }`);
      }
    }
  }
  return out;
}

/* The detector sees what it guards against. */
{
  const planted = readRulesOf(
    '.budget-app-root .a { text-transform: uppercase; }\n' +
    '.budget-onb-step { text-transform: uppercase; }\n' +
    '.budget-app-root .b { letter-spacing: .06em; }\n' +
    '.budget-app-root .c { letter-spacing: -0.02em; }\n' +
    '.budget-app-root .d { letter-spacing: normal; }\n', 'planted');
  const hits = findings(planted, () => true);
  eq(hits.length, 2, 'finds the planted uppercase under the root and the planted positive tracking, and nothing else');
  ok(/\.a /.test(hits[0]) && /\.b /.test(hits[1]), 'and names the right two rules');
  ok(positive('0.5px') && positive('.06em') && !positive('-0.02em') && !positive('normal') && !positive('0'), 'positive() reads the values it should');
}

const rules = readRules();
const isStatement = line => /^src\/statement\//.test(locate(line));
const hits = findings(rules, isStatement);
ok(rules.length > 1000, `the whole assembled sheet was read (${rules.length} rules)`);
eq(hits, [], 'no uppercase under the root, and no positive letter-spacing in the statement files:\n    ' + hits.join('\n    '));

console.log(`PASS statement-labels — no uppercase under the root, no spaced-out labels in the statement files (${checks} checks)`);
