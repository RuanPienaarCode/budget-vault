'use strict';
/* The New owed entry dialog asks the question the page can answer.

   Owed Money is money owed TO the household: owedSummary() counts every
   entry as a receivable and worth.js adds what is outstanding to net worth.
   The dialog asked "Who owes / is owed?", inviting the other direction too —
   and a debt the household owes, entered there, RAISED its net worth by the
   amount it owes. No arithmetic here can tell the two apart (the file has no
   direction column), so the honest fix is the question: ask "Who owes you?",
   and send money the household owes to the Debt page, where it is counted
   against it. No figure changes.

     node tests/owed-dialog-direction.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const modal = require('../src/modal');
const asked = [];
modal.askFields = async (_app, title, fields) => { asked.push({ title, fields }); return null; };
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

(async () => {
  const ctx = makeCtx({ 'Budget/Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root');
  require('../src/views/owed')(ctx);
  await ctx.addOwed();
  const person = asked[0].fields.find(f => f.key === 'person');
  eq(person.label, 'Who owes you?', 'the dialog asks who owes the household — the only direction the page counts');
  ok(/Debt page/.test(person.desc || ''), `and points money the household owes to the Debt page: "${person.desc}"`);
  eq(ctx.S.owed.length, 0, 'a cancelled dialog adds nothing');
  console.log(`PASS owed-dialog-direction (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
