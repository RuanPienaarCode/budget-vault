'use strict';
/* The reconciliation reads a real vault the way Obsidian holds it: the rules
   CSV and the empty folders included (2026-10-07 audit, harness finding H-1).

   scripts/reconcile-page.cjs readVault() kept `.md` files only. Two things a
   page reads were lost on the way in:
     - Data/Categorisation Rules.csv — the loader's rules file (load.js), so the
       census printed "rules: 0" for a vault holding hundreds;
     - every EMPTY folder. Obsidian's file tree holds a Transactions/<account>/
       folder with no month files in it, and the Accounts page reads that as
       "folder exists, no transactions yet" (state notx, which an account's
       ignore_warnings mutes); with the folder gone it read "no folder at all"
       (state nofolder, not muted). On the audited vault the reconciliation's
       Accounts page counted two muted accounts as needing attention.
   A checker that reads a different vault from the app's measures a page nobody
   sees. Empty folders are kept with the harness's own folder marker
   (`<folder>/.folder`, tests/helpers/harness.cjs), so the in-memory vault grows
   the same tree; dot-files and dot-folders stay out, as Obsidian keeps them out.

   Synthetic folder written to the OS temp directory and removed afterwards.

     node tests/reconcile-reads-vault-tree.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readVault, reconcile } = require('../scripts/reconcile-page.cjs');
const { mountFor, pinClock, dispatchedViews, leaves, ownText } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TX = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const TREE = {
  'Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  'Categories/Groceries.md': '---\ntype: expense\n---\n',
  'Accounts/Cheque.md': '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-08-10\ntx_label: "Cheque"\n---\n',
  /* A wallet the household has opened and not imported into yet, with that one
     warning ("nothing imported", notx) muted — the shape of the two accounts
     the audit found. A missing folder (nofolder) is a different warning, so the
     mute does not cover it. */
  'Accounts/Wallet.md': '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-08-10\ntx_label: "Wallet"\nignore_warnings: [notx]\n---\n',
  'Transactions/Cheque/2026-08.md': `${TX}| 2026-08-03 | Checkers | Groceries | -200.00 |  |  |  |\n`,
  'Data/Categorisation Rules.csv': 'Pattern,Category\nCHECKERS,Groceries\nCORNER SHOP,Groceries\n',
  /* Not markdown and not the rules file: never read, but its folder is real. */
  'Notes/Receipts/scan.pdf': '%PDF-1.4',
  /* Obsidian keeps these out of its tree, and so must the checker. */
  '.trash/old.md': '---\nkind: transactions\n---\n',
  '.DS_Store': 'x',
};
const EMPTY_DIRS = ['Transactions/Wallet', 'Plans'];

/* The rule this replaced, kept verbatim as the negative control. */
function mdOnly(root) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith('.md')) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root, '');
  return out;
}

const prefixed = (files, B) => Object.fromEntries(Object.entries(files).map(([k, v]) => [`${B}/${k}`, v]));
async function accountsFacts(files) {
  const unpin = pinClock('2026-08-15');
  try {
    const { ctx, S, nodes } = await mountFor(files, { period: '2026-08' });
    ctx[dispatchedViews().find(v => v.view === 'accounts').fn]();
    const facts = {};
    for (const n of nodes.values()) for (const f of descend(n).filter(e => e._cls && e._cls.has('acct-fact'))) {
      const [l, v] = f.children;
      facts[ownText(leaves(l)[0]) || l.textContent] = v.textContent;
    }
    return { S, facts };
  } finally { unpin(); }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-tree-'));
  const root = path.join(dir, 'Budget');
  try {
    for (const [rel, text] of Object.entries(TREE)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    for (const d of EMPTY_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });

    /* ---- 1. what readVault keeps ---------------------------------------- */
    const got = readVault(root);
    eq(got['Data/Categorisation Rules.csv'], TREE['Data/Categorisation Rules.csv'], 'the rules CSV is read');
    eq(got['Transactions/Wallet/.folder'], '', 'an empty transactions folder is kept, with the harness folder marker');
    eq(got['Plans/.folder'], '', 'so is any other empty folder');
    eq(got['Notes/Receipts/.folder'], '', 'and a folder holding only files the loader never reads');
    ok(!Object.keys(got).some(k => k.startsWith('.') || k.includes('/.trash') || k.endsWith('.DS_Store')), 'dot-files and dot-folders stay out');
    ok(!Object.keys(got).some(k => k.endsWith('.pdf')), 'a file type the loader never reads is not loaded');
    ok(!('Transactions/Cheque/.folder' in got), 'a folder with real files gets no marker');

    /* ---- 2. the app reads that tree the way it reads the vault ----------- */
    const B = 'Budget';
    const now = await accountsFacts(prefixed(got, B));
    eq(now.S.rules.length, 2, 'the loader sees both rules');
    ok(now.S.txFolders.includes('Wallet'), 'and the Wallet folder');
    eq(now.facts[i18n.t('acct.hero.muted')], '1', 'the muted wallet counts under "Warnings ignored", as in the app');
    const r = await reconcile({ files: prefixed(got, B), budgetFolder: B, today: '2026-08-15', period: '2026-08' });
    eq(r.G.census.rules, 2, 'and the reconciliation\'s census counts the rules');

    /* ---- 3. negative control: the old read loses both ---------------------- */
    const old = await accountsFacts(prefixed(mdOnly(root), B));
    eq(old.S.rules.length, 0, 'negative control: reading .md only, the rules vanish');
    ok(!old.S.txFolders.includes('Wallet'), 'and so does the empty folder');
    ok(old.facts[i18n.t('acct.hero.muted')] !== '1', 'so the wallet is no longer counted as muted — the miscount the audit measured');
    ok(Number(old.facts[i18n.t('acct.kpi.attention')]) > Number(now.facts[i18n.t('acct.kpi.attention')]),
      `and it needs attention instead (${old.facts[i18n.t('acct.kpi.attention')]} against ${now.facts[i18n.t('acct.kpi.attention')]})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`PASS reconcile-reads-vault-tree (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
