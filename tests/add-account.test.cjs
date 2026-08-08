'use strict';
/* addAccount()'s CONTRACT, now that three screens other than the Accounts page
   call it.

   Creating an account used to be reachable only from the two pages that list
   accounts, so nothing depended on what the function returned or what it was
   passed. Both now matter:

     • the import review sets the destination for the rows already on screen
       from the returned account, so a cancelled dialog must return null rather
       than something falsy-by-accident, and a successful one must hand back
       the record it pushed — not a copy, and not undefined
     • callers preselect the account TYPE, and the same function is still wired
       straight to click handlers. A MouseEvent has its own `.type` ('click'),
       so an unvalidated default would put a type in the select that no group
       on the Accounts page renders — an account created into thin air

   Bare node. `askFields` is swapped for a scripted answer before accounts.js
   is required, because that module destructures it at load time.
     node tests/add-account.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

stubObsidian();

/* The dialog, scripted. `seen` captures the field list the caller built, which
   is where the preselected type shows up. */
const modal = require('../src/modal');
let answer = null;
let seen = null;
modal.askFields = async (app, title, fields) => { seen = fields; return answer; };
const typeField = () => seen.find(f => f.key === 'type');

async function main() {
  const ctx = makeCtx({
    'Budget/Settings.md': '---\nmonth_start_day: 1\ncurrency: R\n---\n',
  });
  await loadInto(ctx);
  ctx.render = () => {};                    // controller's, not under test here
  require('../src/views/accounts')(ctx);

  /* ---- 1. cancelling creates nothing and says so ---- */
  answer = null;
  const cancelled = await ctx.addAccount();
  eq(cancelled, null, 'a cancelled dialog returns null');
  eq(ctx.S.accounts.length, 0, 'a cancelled dialog creates no account');

  /* ---- 2. no defaults → savings, the standing default ---- */
  answer = null;
  await ctx.addAccount();
  eq(typeField().value, 'savings', 'with no caller preference the type stays savings');

  /* ---- 3. a caller preference is honoured ---- */
  answer = null;
  await ctx.addAccount({ type: 'checking' });
  eq(typeField().value, 'checking', 'Transactions and import ask for a bank account');

  /* ---- 4. a MouseEvent is NOT a preference ----
     addEventListener('click', ctx.addAccount) passes the event straight in.
     event.type === 'click', which is not an account type — the select must
     fall back rather than carry it. */
  answer = null;
  await ctx.addAccount({ type: 'click', bubbles: true });
  eq(typeField().value, 'savings', "a MouseEvent's own .type must not reach the select");
  answer = null;
  await ctx.addAccount({ type: 'not_a_type' });
  eq(typeField().value, 'savings', 'any unknown type falls back rather than being written');

  /* ---- 5. a successful create returns the record it pushed ---- */
  answer = { name: 'Nedbank Cheque', type: 'checking', institution: 'Nedbank',
    balance: '1200.50', goal_amount: '', total_invested: '', budget: 'yes' };
  const made = await ctx.addAccount({ type: 'checking' });
  ok(made, 'a completed dialog returns the account');
  eq(made.name, 'Nedbank Cheque', 'returns the account it created');
  eq(made.type, 'checking', 'the chosen type is what gets stored');
  eq(ctx.S.accounts.length, 1, 'exactly one account was added');
  ok(made === ctx.S.accounts[0],
    'returns the SAME object it pushed — the import review mutates nothing, but a ' +
    'copy would drift the moment anything else edited the account');
  ok(ctx.vault._store.has('Budget/Accounts/Nedbank Cheque.md'),
    'the account file is on disk, not only in memory');
  ok(ctx.vault.getFolderByPath('Budget/Transactions/Nedbank Cheque'),
    'the transactions folder is pre-created, so the account is importable at once');

  /* ---- 6. the label the import review will use resolves ---- */
  /* p.label is a FOLDER name, taken as tx_label || name. A fresh account has no
     tx_label, so it must fall through to the name — and that name is the
     sanitised segment, which is what the folder above is called. */
  eq(made.tx_label || made.name, 'Nedbank Cheque',
    'the import destination resolves to the folder that was just created');

  /* ---- 7. a rejected create returns null, not a half-made account ---- */
  answer = { name: 'Nedbank Cheque', type: 'checking', institution: '',
    balance: '0', goal_amount: '', total_invested: '', budget: 'yes' };
  const dup = await ctx.addAccount();
  eq(dup, null, 'a duplicate name is refused with null, not a second record');
  eq(ctx.S.accounts.length, 1, 'the refused create added nothing');

  answer = { name: 'Fine Name', type: 'checking', institution: '',
    balance: 'not a number', goal_amount: '', total_invested: '', budget: 'yes' };
  const bad = await ctx.addAccount();
  eq(bad, null, 'an unparseable balance is refused with null');
  eq(ctx.S.accounts.length, 1, 'the refused create added nothing');

  /* ---- 8. every screen that offers the button is wired to it ---- */
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '..', 'src');
  const shell = fs.readFileSync(path.join(SRC, 'shell.js'), 'utf8');
  const controller = fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8');
  const importView = fs.readFileSync(path.join(SRC, 'views', 'import.js'), 'utf8');
  for (const id of ['acctAdd', 'savAdd', 'txNewAccount', 'impNewAccount']) {
    ok(shell.includes(`id="${id}"`), `shell.js still carries #${id}`);
  }
  for (const id of ['acctAdd', 'savAdd', 'txNewAccount']) {
    ok(new RegExp(`#${id}'\\)\\.addEventListener`).test(controller),
      `#${id} is wired in controller.js — an unwired button silently does nothing`);
  }
  ok(/#impNewAccount'\)\.onclick/.test(importView),
    '#impNewAccount is wired inside renderImportReview, which owns the select it updates');
  /* The two listeners that pass the click event straight through were the bug
     class check 4 guards against — keep them wrapped. */
  for (const id of ['acctAdd', 'savAdd']) {
    ok(!new RegExp(`#${id}'\\)\\.addEventListener\\('click',\\s*ctx\\.addAccount\\s*\\)`).test(controller),
      `#${id} must not hand ctx.addAccount the MouseEvent directly`);
  }

  console.log(`add-account: ${checks} checks passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
