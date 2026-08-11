'use strict';
/* An empty transactions folder is not a missing one — proved through the REAL
   loader, not a hand-built row list.

   This is the half that acct-status.test.cjs cannot reach. That suite hands
   statusOf a `hasFolder` boolean directly and checks the judgement; this one
   checks that the boolean ARRIVES, which is where the original defect lived.
   S.txFiles is keyed per month file, so a folder somebody created and has not
   imported into yet contributes no entry and used to read exactly like a folder
   that was never linked — and the page told both of them to "Link a folder",
   sending the first reader to re-link a folder already sitting on disk.

   Three accounts, one of each shape, loaded from one vault:

     Linked   a folder with a month file in it     -> ok / drift / stale
     Empty    a folder with nothing in it yet      -> notx     (import a statement)
     Missing  no folder anywhere                   -> nofolder (link a folder)

   The `/.folder` marker is the harness's way of writing a directory with no
   file in it, which is the entire point of the middle case and is not
   expressible as a path in a file map. */

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');

stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const { statusOf } = require(path.join(SRC, 'acct-status.js'));

/* Fixed, like every other date in these suites: a test that reads the wall
   clock passes in June and fails in July. Every balance below is confirmed on
   this day so nothing drifts or goes stale and the folder state is the ONLY
   thing separating the three accounts. */
const TODAY = '2026-08-10';

const acctFile = (extra = '') =>
  `---\ntype: checking\nbalance: 100.00\nbalance_updated: ${TODAY}\n${extra}---\n\n# Account\n`;

const txFile = () =>
  '---\nkind: transactions\n---\n\n# Transactions\n\n' +
  '| Date | Description | Category | Amount | Excluded | Note |\n' +
  '| --- | --- | --- | --- | --- | --- |\n' +
  '| 2026-08-02 | Coffee | Food | -30.00 |  |  |\n';

(async () => {
  const ctx = makeCtx({
    'Budget/Accounts/Linked.md': acctFile(),
    'Budget/Accounts/Empty.md': acctFile(),
    'Budget/Accounts/Missing.md': acctFile(),
    /* A fourth shape that must not regress: the folder is named differently
       from the account and reached only through tx_label. It is genuinely
       importing, so it must not be told to link anything. */
    'Budget/Accounts/Relabelled.md': acctFile('tx_label: "Old Name"\n'),

    'Budget/Transactions/Linked/2026-08.md': txFile(),
    'Budget/Transactions/Old Name/2026-08.md': txFile(),
    'Budget/Transactions/Empty/.folder': '',       // a directory, no month file
  });

  const S = await loadInto(ctx);

  /* ---- 1. the loader records folders, not just files ---- */
  ok(Array.isArray(S.txFolders), 'the loader publishes the folder list');
  ok(S.txFolders.includes('Empty'),
    'a folder with no month file in it is still recorded');
  ok(S.txFolders.includes('Linked') && S.txFolders.includes('Old Name'),
    'folders that do hold month files are recorded too');
  ok(!S.txFolders.includes('Missing'),
    'a folder that does not exist is not invented');

  /* The precise thing that made the two indistinguishable before: S.txFiles
     genuinely has nothing to say about the empty folder. */
  ok(!Object.keys(S.txFiles).some(k => k.startsWith('Empty/')),
    'S.txFiles has no entry for the empty folder — which is why it could not tell them apart');

  /* ---- 2. the folder set resolves through the same door as the rows ---- */
  const folders = ctx.accountsWithFolder();
  const byName = n => S.accounts.find(a => a.name === n);
  const idx = ctx.accountIndex();
  const rowsOf = a => (idx.get(a) ? idx.get(a).rows : []);

  ok(folders.has(byName('Empty')), 'the empty folder resolves to its account');
  ok(folders.has(byName('Relabelled')),
    'a tx_label folder resolves to its account, exactly as accountIndex resolves it');
  ok(!folders.has(byName('Missing')), 'an account with no folder is not in the set');

  /* ---- 3. and the three shapes land on three different answers ---- */
  const stateOf = n => statusOf(byName(n), rowsOf(byName(n)), TODAY, folders.has(byName(n))).state;

  eq(stateOf('Empty'), 'notx',
    'a linked but empty folder wants an import, not a second folder');
  eq(stateOf('Missing'), 'nofolder',
    'an account with no folder is the one that wants linking');
  eq(stateOf('Linked'), 'ok',
    'an account whose rows agree with its figure stays out of the queue');
  eq(stateOf('Relabelled'), 'ok',
    'a tx_label account is importing fine and is never told to link a folder');

  console.log(`PASS — an empty transactions folder is told apart from a missing one, through the real loader (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
