'use strict';
/* Audit a vault's account <-> transaction-folder wiring.

   Two failures live here and NEITHER raises an error in the app, because the
   reading side is more forgiving than the writing side:

     accountForLabel()   (src/period.js)      accepts THREE names —
                                              tx_label, the account name, or the
                                              filesystem-cleaned account name.
     detectAccountLabel() (src/views/import.js) produces exactly ONE:
                                              `tx_label || name`.

   So an account can read its rows perfectly out of a folder that an import
   would never write to, and nothing on screen says so.

     MISROUTED  tx_label names a folder that does not exist, while the account's
                rows sit in a folder named after the account. Reading works.
                The next import creates a SECOND folder and re-imports every
                row as new, because the dedup key carries the label.

     ORPHAN     a folder no account claims by any of the three names. Its rows
                still show in Transactions and still count toward period totals,
                but they reach no account balance, never appear in a
                reconciliation, and are absent from the cash figure.

   An account with no folder at all is NOT a finding — that is simply an account
   nothing has been imported into yet, which is the normal state of a
   hand-tracked fund.

   Usage:
     node scripts/check-account-folders.cjs <path/to/vault/budget-folder>

   Exits non-zero if anything is misrouted or orphaned. Read-only. */

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/check-account-folders.cjs <budget folder>');
  process.exit(2);
}
const ACC = path.join(root, 'Accounts');
const TX = path.join(root, 'Transactions');
for (const d of [ACC, TX]) {
  if (!fs.existsSync(d)) { console.error(`not a budget folder — no ${path.basename(d)}/ under ${root}`); process.exit(2); }
}

/* Mirrors safeSeg() in src/vault-path.js closely enough for a name comparison:
   the characters a folder cannot carry, collapsed the same way. */
const safeSeg = s => String(s).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().normalize('NFC');

const fm = txt => {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  const o = {};
  if (!m) return o;
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    o[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return o;
};

const accounts = fs.readdirSync(ACC).filter(f => f.endsWith('.md')).map(f => {
  const o = fm(fs.readFileSync(path.join(ACC, f), 'utf8'));
  return { name: f.replace(/\.md$/, ''), tx_label: o.tx_label || '', account_number: o.account_number || '' };
});
const folders = fs.readdirSync(TX, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);

// The reading rule, verbatim.
const claims = label => accounts.find(a =>
  a.tx_label === label || a.name === label || safeSeg(a.name) === safeSeg(label)) || null;

const misrouted = [], orphans = [];

for (const a of accounts) {
  const target = a.tx_label || a.name;                    // the writing rule
  if (folders.includes(target)) continue;                 // fine
  // No folder anywhere for this account? Nothing has been imported into it. Fine.
  const elsewhere = folders.filter(f => claims(f) === a);
  if (!elsewhere.length) continue;
  misrouted.push({ account: a.name, target, holding: elsewhere });
}
for (const f of folders) if (!claims(f)) orphans.push(f);

const rows = fs.existsSync(TX) ? f => {
  const d = path.join(TX, f);
  let n = 0;
  for (const x of fs.readdirSync(d).filter(y => y.endsWith('.md')))
    for (const l of fs.readFileSync(path.join(d, x), 'utf8').split('\n'))
      if (/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l)) n++;
  return n;
} : () => 0;

console.log(`${accounts.length} accounts, ${folders.length} transaction folders\n`);

if (misrouted.length) {
  console.log('MISROUTED — tx_label names a folder that does not exist, but rows live elsewhere.');
  console.log('            The next import will create a second folder and duplicate every row.\n');
  for (const m of misrouted)
    console.log(`  ${m.account}\n     tx_label points at : ${m.target}  (does not exist)\n     rows actually in   : ${m.holding.join(', ')}\n     fix                : set tx_label to "${m.holding[0]}", or remove it\n`);
}
if (orphans.length) {
  console.log('ORPHAN — no account claims this folder. Its rows reach no account balance,');
  console.log('         never appear in a reconciliation, and are absent from the cash figure.\n');
  for (const o of orphans) console.log(`  ${o}  (${rows(o)} rows)`);
  console.log('');
}
if (!misrouted.length && !orphans.length) console.log('ok — every account routes to a folder that exists, and every folder has an account.');

process.exit(misrouted.length || orphans.length ? 1 : 0);
