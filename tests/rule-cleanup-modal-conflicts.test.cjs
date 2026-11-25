'use strict';
/* The Tidy preview lists rules that contradict each other, and does not call a
   file with a conflict "all earn their place" (2026-11-25 audit, RUL-11
   follow-up).

   analyseRules reports `conflicts` — a pattern the file answers with more than
   one category — and removes none of them: the later line is already dead, but
   which category the household meant is theirs to say. The preview dialog did
   not show them, and when there was nothing else to remove it opened on
   "Nothing to remove — all 40 rules earn their place", a sentence a file that
   contradicts itself cannot honestly have printed.

   Driven through the REAL analyseRules into the REAL dialog, over Obsidian's
   shipped markup (tests/helpers/modal-stub.cjs):

     1. nothing to remove + a conflict: no "earn their place" sentence; the
        conflict is listed with its pattern, every category it is given and the
        one that wins today (the earlier line); a sentence says the app will not
        choose and names the file; the only button is Close
     2. nothing to remove + no conflict: the old sentence, unchanged (control)
     3. removals + a conflict: the removals list is exactly as before, the
        conflict is listed after it and is NOT among the removals, and the
        Remove button still counts only what is removed
     4. a report from before conflicts existed (no `conflicts` key) renders as
        it always did
     The preview is English-only today, like the rest of that dialog; it is the
     one dialog in modal.js nobody keyed, and its wording here matches it.

     node tests/rule-cleanup-modal-conflicts.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag } = require('./helpers/modal-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

stubModalObsidian();
const { RulesCleanupModal } = require('../src/modal');
const { analyseRules } = require('../src/rule-cleanup');

const R = pairs => pairs.map(([pattern, category]) => ({ pattern, category }));
function open(report) {
  const m = new RulesCleanupModal({}, report, () => {});
  m.open();
  const text = m.contentEl.textContent;
  const buttons = byTag(m.contentEl, 'button').map(b => b.textContent);
  const cls = c => {
    const out = [];
    const walk = e => { if (e._cls && e._cls.has(c)) out.push(e); e.children.forEach(walk); };
    walk(m.contentEl);
    return out;
  };
  return { m, text, buttons, cls };
}

/* ---- 1. nothing to remove, one conflict ---- */
{
  const report = analyseRules(R([['spar', 'Food'], ['spar', 'Liquor'], ['shell', 'Fuel']]), ['SPAR NEWLANDS 1', 'SHELL ULTRA CITY']);
  eq(report.remove.length, 0, 'the fixture removes nothing — the conflict is not a removal');
  eq(report.conflicts.length, 1, 'and reports one conflict');
  const d = open(report);
  ok(!/earn their place/.test(d.text), 'the "all rules earn their place" sentence is not printed');
  ok(/Nothing to remove/.test(d.text), 'it still says there is nothing to remove');
  const rows = d.cls('budget-tidy-row');
  eq(rows.length, 1, 'one conflict row');
  const row = rows[0].textContent;
  ok(row.includes('spar'), 'naming the pattern');
  ok(row.includes('Food') && row.includes('Liquor'), 'and every category it is given');
  ok(/“Food” comes first, so it wins today/.test(row), 'and which one wins today: the earlier line, Food');
  ok(/will not choose/.test(d.text), 'a sentence says the app will not choose between them');
  ok(d.text.includes('Data/Categorisation Rules.csv'), 'and names the file the reader fixes it in');
  eq(d.buttons, ['Close'], 'the only button is Close — nothing here deletes anything');
  d.m.close();
}

/* ---- 2. nothing to remove, no conflict: the old sentence ---- */
{
  const report = analyseRules(R([['spar', 'Food'], ['shell', 'Fuel']]), ['SPAR 1', 'SHELL 2']);
  const d = open(report);
  ok(/Nothing to remove — all 2 rules earn their place against the 2 descriptions in your vault\./.test(d.text),
    'control: with no conflict the sentence is exactly what it was');
  eq(d.cls('budget-tidy-row').length, 0, 'and no conflict section');
  d.m.close();
}

/* ---- 3. removals AND a conflict ---- */
{
  const report = analyseRules(
    R([['spar', 'Food'], ['spar', 'Liquor'], ['corner mart', 'Groceries'], ['corner mart central', 'Groceries']]),
    ['SPAR NEWLANDS 1', 'CORNER MART CENTRAL 12']);
  eq(report.remove.map(r => r.pattern), ['corner mart central'], 'the fixture removes the longer rule a shorter one covers, and nothing of spar');
  eq(report.conflicts.map(c => c.pattern), ['spar'], 'and reports spar as a conflict');
  const d = open(report);
  ok(/1 of 4 rules can go/.test(d.text), 'the lead is still the removal lead');
  const rows = d.cls('budget-tidy-row').map(r => r.textContent);
  eq(rows.length, 2, 'two rows: the removal and the conflict');
  ok(rows[0].includes('corner mart central') && /already covered by/.test(rows[0]), 'the removal is listed first, as before');
  ok(rows[1].includes('spar') && /wins today/.test(rows[1]), 'the conflict after it');
  ok(!rows[0].includes('spar'), 'the conflicting pattern is not among the removals');
  eq(d.buttons, ['Cancel', 'Remove 1 rule'], 'and the button counts only what is removed');
  d.m.close();
}

/* ---- 4. a report without the key ---- */
{
  const d = open({ remove: [], redundant: [], blank: [], dormant: [], kept: 3, checked: 5, total: 3 });
  ok(/Nothing to remove — all 3 rules earn their place/.test(d.text), 'a report from before conflicts existed renders as it did');
  d.m.close();
}

console.log(`PASS rule-cleanup-modal-conflicts — the preview names rules that contradict each other (${checks} checks)`);
