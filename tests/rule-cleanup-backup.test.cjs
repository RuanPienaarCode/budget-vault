'use strict';
/* The tidy leaves a way back — or it does not run.

   analyseRules is proved correct next door, and the preview modal is proved to
   list every removal. Neither of those is a safety net. A confirmed cleanup
   routinely deletes the majority of the file (832 of 1,342 on the vault this
   was built against), the file belongs to the user rather than to the plugin,
   and nobody audits eight hundred lines in a dialog before clicking the
   destructive button. The backup is what makes the click recoverable, so the
   ordering around it is load-bearing:

     • the pre-delete set is written BEFORE the live file is overwritten
     • it holds every rule, including the ones about to go
     • a failed backup ABANDONS the delete rather than proceeding without one
     • declining the preview writes nothing at all — not even a backup
     • a second tidy on the same day must not overwrite the first backup: the
       earlier file predates both deletes and is the more complete snapshot

   The last one is the easiest to get backwards, and getting it backwards
   trades the only full copy of the rules for a partial one.

   Drives the REAL cleanupRules with ./modal stubbed to answer the preview, so
   the ordering tested here is the ordering that ships.

   Runs in bare node. Wired into ./build.sh via the tests/*.test.cjs glob.
     node tests/rule-cleanup-backup.test.cjs
*/

const assert = require('assert');
const Module = require('module');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ------------------------------ modal stub ------------------------------ */
/* categories.js pulls askRulesCleanup in at module load, so the swap has to
   happen before the require below — same technique stubObsidian uses, chained
   onto it rather than replacing it. */
let answerPreview = true;
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === './modal') {
    return {
      askFields: async () => null,
      confirmModal: async () => false,
      askRulesCleanup: async () => answerPreview,
    };
  }
  return realLoad.call(this, request, ...rest);
};

const registerCategories = require('../src/categories');

/* A ctx with registerCategories wired on, seeded with rules and the vault
   descriptions the analysis replays. `written` doubles as the fake filesystem
   so fileAt() can see what writeFile() put there. */
function cleanupCtx({ rules, descs, failWriteOn = null, preexisting = {} }) {
  const ctx = makeCtx({});
  ctx.S.rules = rules.map(([pattern, category]) => ({ pattern, category }));
  ctx.S.txFiles = { 'Transactions/Acct/2026-01.md': { rows: descs.map(desc => ({ desc })) } };
  const written = { ...preexisting };
  const order = [];
  ctx.provide({
    writeFile: async (rel, content) => {
      if (failWriteOn && rel.includes(failWriteOn)) throw new Error('disk full');
      order.push(rel);
      written[rel] = content;
    },
    fileAt: rel => (Object.prototype.hasOwnProperty.call(written, rel) ? { path: rel } : null),
    mdFilesIn: () => [],
  });
  registerCategories(ctx);
  return { ctx, written, order };
}

const LIVE = 'Data/Categorisation Rules.csv';
const backupName = () => {
  const d = new Date();
  return `Data/Categorisation Rules.pre-tidy-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
};

/* A general rule and a longer one that can only ever agree with it: the
   specific one is redundant, the general one survives. */
const RULES = [['CORNER MART', 'Groceries'], ['CORNER MART CENTRAL', 'Groceries']];
const DESCS = ['CORNER MART CENTRAL 12'];

(async () => {
  /* ===================== the happy path, in order ====================== */
  {
    answerPreview = true;
    const { ctx, written, order } = cleanupCtx({ rules: RULES, descs: DESCS });
    const removed = await ctx.cleanupRules();

    eq(removed, 1, 'the redundant specific rule is the one removed');
    eq(order, [backupName(), LIVE],
      'the backup is written BEFORE the live file — the other order is a delete with no way back');

    const backup = written[backupName()];
    ok(backup, 'a backup exists');
    eq(backup.trim().split('\n').length, 3,
      'header plus BOTH rules — the backup holds the set as it was, including what was deleted');
    ok(backup.includes('CORNER MART CENTRAL'),
      'the deleted rule is in the backup, which is the entire point of it');

    const live = written[LIVE];
    eq(live.trim().split('\n').length, 2, 'the live file keeps the header and the surviving rule');
    ok(!live.includes('CORNER MART CENTRAL'), 'and no longer holds the removed one');
    ok(live.startsWith('pattern,category\n') && backup.startsWith('pattern,category\n'),
      'both go through the one serializer, so they cannot drift apart');
  }

  /* ================= declining writes absolutely nothing ================ */
  {
    answerPreview = false;
    const { ctx, written } = cleanupCtx({ rules: RULES, descs: DESCS });
    const removed = await ctx.cleanupRules();

    eq(removed, 0, 'declining the preview removes nothing');
    eq(Object.keys(written), [],
      'and writes nothing at all — a backup of a delete that never happened is just litter');
    eq(ctx.S.rules.length, 2, 'the in-memory rules are untouched');
  }

  /* ============ a failed backup abandons the delete entirely =========== */
  {
    answerPreview = true;
    const { ctx, written } = cleanupCtx({ rules: RULES, descs: DESCS, failWriteOn: 'pre-tidy' });
    const removed = await ctx.cleanupRules();

    eq(removed, 0, 'a tidy that cannot write its backup does not delete');
    ok(!written[LIVE], 'the live rules file is never touched');
    eq(ctx.S.rules.length, 2, 'and the rules survive in memory too');
  }

  /* ========= a second tidy the same day keeps the FIRST backup ========= */
  {
    answerPreview = true;
    const earlier = 'pattern,category\nEARLIER SNAPSHOT,Groceries\n';
    const { ctx, written, order } = cleanupCtx({
      rules: RULES, descs: DESCS, preexisting: { [backupName()]: earlier },
    });
    const removed = await ctx.cleanupRules();

    eq(removed, 1, 'the tidy still runs');
    eq(written[backupName()], earlier,
      'the first backup of the day is preserved — it predates both deletes and is the fuller copy');
    eq(order, [LIVE], 'only the live file is written the second time');
  }

  console.log(`PASS — the tidy cannot delete without a way back (${checks} assertions).`);
})().catch(err => { console.error(err); process.exit(1); });
