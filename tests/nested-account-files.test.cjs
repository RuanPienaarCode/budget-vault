'use strict';
/* ISSUE 60 — an account file in a sub-folder vanished from every figure while
   its transactions kept counting.

   `src/io.js`'s `mdFilesIn` reads one level, and its own comment defends that
   for `Accounts/` on the grounds the folder is "flat by construction, because
   the plugin names the files itself" — the same argument that comment then
   narrates as having been wrong for `Notes/`. The vault is user-writable
   markdown; filing dormant accounts into `Accounts/Closed/` is an ordinary
   tidy-up.

   Measured: `Accounts/Closed/Old Savings.md` holding R88 000 with its own
   transactions folder —

     accounts loaded : [ 'Cheque' ]
     net worth       : R 12 000        (truth R 100 000)
     period income   : R 250           <- its interest DID count

   The rows count because transaction folders are read by LABEL; the balance
   does not because the account file was never read. The vault looks
   internally inconsistent and nothing explained it.

   WHY THIS DISCLOSES RATHER THAN LOADS. Every write site addresses an account
   as `Accounts/<name>.md` (`views/accounts.js:396, 2125, 2169, 2320`). Loading
   a nested file without also teaching those sites its real path would have the
   next save create a duplicate at the top level and silently strand the
   original — a worse bug than this one, and the same class. Reading them in is
   the fuller fix and needs path-aware writes; #60 stays open for it.

   WHAT IS PINNED: the omission is detected exactly where it happens and
   nowhere else, and the page that owns accounts says so.

     node tests/nested-account-files.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 12000\nbalance_updated: 2026-01-01\n---\n',
};

(async () => {
  /* ---- 1. detected, and named ---- */
  {
    const ctx = makeCtx({ ...BASE,
      [`${B}/Accounts/Closed/Old Savings.md`]: '---\ntype: savings\ntx_label: "Old Savings"\nbalance: 88000\n---\n',
      [`${B}/Accounts/Closed/2019/Older.md`]: '---\ntype: savings\ntx_label: "Older"\nbalance: 100\n---\n',
    }, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    /* ISSUE 60 closed: they are LOADED now, at any depth, because the writers
       learned to address the path each account was read from before the loader
       began recursing (tests/account-file-paths.test.cjs holds that order).
       This file's own subject — the disclosure — survives by retiring itself:
       `accountsIgnored` is found-minus-read, so it names nothing once nothing
       is skipped. A caveat that outlives the thing it qualifies is how a real
       one stops being believed. */
    eq(S.accounts.map(a => a.name).sort(), ['Cheque', 'Older', 'Old Savings'].sort(),
      'the nested files are loaded, at any depth');
    eq(S.accountsIgnored, [],
      'and nothing is named as skipped, because nothing is');
  }

  /* ---- 2. and NOT reported when there is nothing to report ---- */
  {
    const ctx = makeCtx(BASE, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    eq(S.accountsIgnored, [],
      'a flat Accounts/ folder reports nothing — a caveat qualifying nothing is how a real one stops being read');
  }

  /* A file directly in Accounts/ is not "nested" however it is named, and a
     folder that merely SHARES the prefix is a different folder. */
  {
    const ctx = makeCtx({ ...BASE,
      [`${B}/AccountsArchive/Old.md`]: '---\ntype: savings\nbalance: 5\n---\n',
    }, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    eq(S.accountsIgnored, [], 'a sibling folder with a similar name is not Accounts/');
  }

  /* ---- 3. the page says it ---- */
  {
    const { $ } = makeDom();
    const ctx = makeCtx({ ...BASE,
      [`${B}/Accounts/Closed/Old Savings.md`]: '---\ntype: savings\ntx_label: "Old Savings"\nbalance: 88000\n---\n',
    }, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    S.period = '2026-01';
    ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    ctx.typeBadge = t => el('span', {}, t);
    ctx.switchView = () => {};
    require('../src/categories')(ctx);
    require('../src/views/accounts')(ctx);
    ctx.renderAccounts();

    let txt = '';
    const walk = n => { if (n._text) txt += n._text + ' '; for (const c of (n.children || [])) walk(c); };
    walk($('#acctSummary'));
    /* The banner used to be the point of this file: name the file we are not
       reading. We read it now (ISSUE 60), so the honest assertion is the
       opposite one — no caveat, and the nested account's money in the totals.
       The banner is now UNREACHABLE, and saying so plainly matters: its only
       call site reads `S.accountsIgnored`, which is found-minus-read over
       Accounts/ alone, and that list is now always empty. Categories/,
       Budgets/, Plans/ and Tax/ are still read one level and drop a nested
       file with NO disclosure at all — they have no equivalent of this list.
       The machinery is kept rather than deleted because it is exactly what
       those folders need pointed at them (ISSUE 97); it retires itself here
       instead of naming a file the loader has started reading. */
    const stale = i18n.t('acct.ignoredFiles', { count: 1, names: 'Old Savings' });
    ok(!txt.includes(stale),
      `the page no longer says it is skipping a file it now reads — got: ${txt.slice(0, 200)}`);
    ok(/R 100000\.00/.test(txt),
      `and the nested account's R88 000 is in the total — got: ${txt.slice(0, 200)}`);
  }

  console.log(`PASS nested-account-files (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
