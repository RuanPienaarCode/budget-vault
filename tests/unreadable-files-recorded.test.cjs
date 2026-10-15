'use strict';
/* A file the loader fell back past is RECORDED, not silently absorbed
   (2026-10-14 audit, L8-03).

   The fallbacks themselves are unchanged and still right — the app has to
   open — but each used to be invisible. Through the real loader, over an
   in-memory copy of the shapes the audit injected one at a time:

     - Settings.md deleted, or its closing `---` lost to a hand edit, loaded
       as "no settings" and reverted month_start_day, currency and the rest to
       their defaults,
     - an account file whose closing `---` was lost read as type `other`,
       balance R0,
     - Assets.md holding prose and no table read as an empty list.

   S.unreadableFiles = [{ rel, why }] (why: 'missing' | 'frontmatter' |
   'table'; rel is budget-folder-relative) is what the page banner reads.
   It is rebuilt on every load, so fixing the file clears it.

   Also pinned: the cases that must NOT be reported — a hand-made account note
   with no frontmatter at all, a table file that was never written, one with a
   table, a header-only rules file.
     node tests/unreadable-files-recorded.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 5\ncurrency: "R"\ncountry: za\n---\n';
const BASE = {
  [`${B}/Settings.md`]: SETTINGS,
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1200.00\n---\n\n# Cheque\n',
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n# Assets\n\n| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| Car | vehicle | 90000.00 |  |  |\n',
};
async function load(files) {
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  return { ctx, S };
}

(async () => {
  {
    const { S } = await load(BASE);
    eq(S.unreadableFiles, [], 'a healthy vault reports nothing');
    eq(S.settings.month_start_day, 5, 'precondition: the setting was read');
  }
  {
    const files = { ...BASE }; delete files[`${B}/Settings.md`];
    const { S } = await load(files);
    eq(S.unreadableFiles, [{ rel: 'Settings.md', why: 'missing' }], 'a missing Settings.md is named');
    eq(S.settings.month_start_day, 23, 'and the default is still what the app runs on');
  }
  {
    const { S } = await load({ ...BASE, [`${B}/Settings.md`]: SETTINGS.replace(/\n---\n$/, '\n') });
    eq(S.unreadableFiles, [{ rel: 'Settings.md', why: 'frontmatter' }], 'a Settings.md whose closing fence is lost is named');
    eq(S.settings.month_start_day, 23, 'its settings still fall back, as they did');
  }
  {
    const { S } = await load({ ...BASE, [`${B}/Settings.md`]: '﻿' + SETTINGS });
    eq(S.unreadableFiles, [], 'a BOM in front of a good block is not a lost fence');
  }
  {
    const { S } = await load({ ...BASE, [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1200.00\n\n# Cheque\n' });
    eq(S.unreadableFiles, [{ rel: 'Accounts/Cheque.md', why: 'frontmatter' }], 'an account whose closing fence is lost is named');
    eq(S.accounts[0].type, 'other', 'and it still reads as the fallback type');
  }
  {
    const { S } = await load({ ...BASE, [`${B}/Accounts/Cheque.md`]: '# Cheque\n\nA hand-made note with no properties at all.\n' });
    eq(S.unreadableFiles, [], 'an account note with no frontmatter at all is a hand-made account, not a broken one');
  }
  {
    const { S } = await load({ ...BASE, [`${B}/Assets.md`]: '---\nkind: assets\n---\n\nI wrote my assets here as prose: house 1.5m, car 200k.\n' });
    eq(S.unreadableFiles, [{ rel: 'Assets.md', why: 'table' }], 'an Assets.md of prose with no table is named');
    eq(S.assets, [], 'and still reads as an empty list');
  }
  {
    const files = { ...BASE }; delete files[`${B}/Assets.md`];
    const { S } = await load({ ...files, [`${B}/Debts.md`]: '---\nkind: debts\n---\n' });
    eq(S.unreadableFiles, [], 'a table file that was never written, or holds only its frontmatter, is new, not broken');
  }
  {
    const { S } = await load({ ...BASE, [`${B}/Settings.md`]: SETTINGS.replace(/\n---\n$/, '\n'), [`${B}/Assets.md`]: '---\nkind: assets\n---\n\nprose\n' });
    eq(S.unreadableFiles.map(u => u.rel).sort(), ['Assets.md', 'Settings.md'], 'several are all listed');
    const { ctx, S: S2 } = await load({ ...BASE });
    eq(S2.unreadableFiles, [], 'a clean load of the same vault clears the list');
    ctx.vault._store.set(`${B}/Settings.md`, 'no properties here');
    await ctx.loadVault();
    eq(ctx.S.unreadableFiles, [{ rel: 'Settings.md', why: 'frontmatter' }], 'and a reload after a bad edit rebuilds it');
    ctx.vault._store.set(`${B}/Settings.md`, SETTINGS);
    await ctx.loadVault();
    eq(ctx.S.unreadableFiles, [], 'fixing the file empties it again');
  }

  console.log(`PASS — unreadable files are recorded on every load (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
