'use strict';
/* ISSUE 97 — a nested Transactions/ folder loses its ROWS, silently.

   The family in #97 is "a folder read one level deep". This file holds the
   member the issue names as worse than the four it is titled for, and the one
   #60 made worse rather than better:

     before #60   a nested ACCOUNT file vanished from every figure while its
                  transactions still counted. Wrong, and loud in the sense that
                  the rows were there to notice.
     after  #60   the account loads and its balance counts. If its transaction
                  folder is ALSO nested, the ROWS vanish instead — money simply
                  absent from every figure, with no disclosure list to land in.

   Measured on dac6ac6 before the fix, one account filed under
   Transactions/Closed/Old Savings/:

     accounts : [ 'Cheque', 'Old Savings' ]     <- loaded, R88 000 counted
     txFiles  : [ 'Cheque/2026-09' ]            <- the R250 interest row is GONE
     disclosures: accountsIgnored 0, nothing else

   THE ORDER THIS FIX HAS TO FOLLOW is #60's, and it is the whole lesson of
   that issue: the writers ASSEMBLE `Transactions/<label>/<month>.md`. Teaching
   the loader to recurse without teaching the writers the path first does not
   fix the bug, it converts it into a worse one — a nested file read, then
   written back to a flat path, leaving two files holding one account's month.
   So the write-path assertions below are not extra credit; they are the half
   that has to be true before recursion is safe to turn on.

   node tests/nested-transaction-folders.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };
const tx = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |  |  |  |`).join('\n') + '\n';

const acct = (label, bal, type = 'savings') =>
  `---\ntype: ${type}\ntx_label: "${label}"\nbalance: ${bal}\n---\n`;

(async () => {
  /* ============ the rows of a nested folder are READ ==================== */
  {
    const F = {
      ...SETTINGS,
      [`${B}/Categories/Food.md`]: '---\nkind: category\ntype: spending\n---\n',
      [`${B}/Accounts/Cheque.md`]: acct('Cheque', 100, 'checking'),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-03', 'Shop', 'Food', '-50.00']]),
      [`${B}/Accounts/Closed/Old Savings.md`]: acct('Old Savings', 88000),
      [`${B}/Transactions/Closed/Old Savings/2026-09.md`]: tx([['2026-09-04', 'Interest', 'Food', '250.00']]),
    };
    const ctx = makeCtx(F, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);

    const keys = Object.keys(S.txFiles).sort();
    eq(keys, ['Cheque/2026-09', 'Old Savings/2026-09'],
      'a transaction folder one level down is read, keyed by its own label');
    eq(S.txFiles['Old Savings/2026-09'].rows.length, 1, 'the nested month file keeps its row');
    eq(S.txFiles['Old Savings/2026-09'].rows[0].amount, 250,
      'the R250 that used to vanish is present');

    /* The path it was READ from, which is the seam every writer needs. */
    eq(S.txFiles['Old Savings/2026-09'].rel, 'Transactions/Closed/Old Savings/2026-09.md',
      'the record carries the path it was read from, not one assembled from the label');
    eq(S.txFiles['Cheque/2026-09'].rel, 'Transactions/Cheque/2026-09.md',
      'a flat file records its flat path the same way');
  }

  /* ============ the writers address that path =========================== */
  {
    const F = {
      ...SETTINGS,
      [`${B}/Categories/Food.md`]: '---\nkind: category\ntype: spending\n---\n',
      [`${B}/Accounts/Closed/Old Savings.md`]: acct('Old Savings', 88000),
      [`${B}/Transactions/Closed/Old Savings/2026-09.md`]: tx([['2026-09-04', 'Interest', 'Food', '250.00']]),
    };
    const ctx = makeCtx(F, { settings: { month_start_day: 1 } });
    await loadInto(ctx);

    /* The seam itself: where does a write for this label and month land? */
    eq(ctx.txFileRel('Old Savings', '2026-09'), 'Transactions/Closed/Old Savings/2026-09.md',
      'an existing month is addressed at the folder it was read from');
    eq(ctx.txFileRel('Old Savings', '2026-10'), 'Transactions/Closed/Old Savings/2026-10.md',
      'a NEW month joins the folder its account already uses — the half a per-file rel cannot answer');
    eq(ctx.txFileRel('Brand New', '2026-09'), 'Transactions/Brand New/2026-09.md',
      'an account with no folder on disk still gets the flat default');
  }

  /* ============ two folders, one label: first wins, rest disclosed ====== */
  {
    const F = {
      ...SETTINGS,
      [`${B}/Categories/Food.md`]: '---\nkind: category\ntype: spending\n---\n',
      [`${B}/Accounts/Old Savings.md`]: acct('Old Savings', 88000),
      [`${B}/Transactions/Old Savings/2026-09.md`]: tx([['2026-09-04', 'Interest', 'Food', '250.00']]),
      [`${B}/Transactions/Closed/Old Savings/2026-09.md`]: tx([['2026-09-05', 'Interest', 'Food', '999.00']]),
    };
    const ctx = makeCtx(F, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);

    eq(S.txFiles['Old Savings/2026-09'].rows[0].amount, 250,
      'the shallower folder wins, deterministically');
    ok((S.txFoldersIgnored || []).some(p => p.includes('Closed/Old Savings')),
      'the folder that lost is NAMED rather than silently dropped');
    ok(!(S.txFoldersIgnored || []).some(p => p === 'Transactions/Old Savings'),
      'the folder that won is not in the ignored list');
  }

  /* ============ no writer assembles a path any more ===================== */
  {
    /* The static half of the order. A seam every caller ignores is the state
       ISSUE 84 is open about, and here it would be silent data loss rather
       than a stale figure — so assert the assembled form is GONE from the
       writers, not merely that a better one exists. */
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..', 'src');
    const offenders = [];
    for (const rel of ['views/transactions.js', 'views/import.js']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/writeFile\(`Transactions\/\$\{/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    eq(offenders, [], 'every transaction writer addresses txFileRel, not an assembled path');
  }

  /* ============ a nested month survives a round trip ==================== */
  {
    const F = {
      ...SETTINGS,
      [`${B}/Categories/Food.md`]: '---\nkind: category\ntype: spending\n---\n',
      [`${B}/Accounts/Closed/Old Savings.md`]: acct('Old Savings', 88000),
      [`${B}/Transactions/Closed/Old Savings/2026-09.md`]: tx([['2026-09-04', 'Interest', 'Food', '250.00']]),
    };
    const ctx = makeCtx(F, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);

    const f = S.txFiles['Old Savings/2026-09'];
    /* The serializer is not what is under test here — the PATH is — so write a
       marker rather than reaching for a view's provide(). */
    await ctx.writeFile(ctx.txFileRel(f.label, f.month), 'MARKER\n');

    const written = [...ctx.vault._store.keys()].filter(k => k.includes('Old Savings'));
    ok(written.includes(`${B}/Transactions/Closed/Old Savings/2026-09.md`),
      'the write lands on the file it was read from');
    ok(!written.includes(`${B}/Transactions/Old Savings/2026-09.md`),
      'and does NOT fork a flat twin — the R88 000/R90 000 failure ISSUE 60 measured');
  }

  console.log(`PASS nested-transaction-folders (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
