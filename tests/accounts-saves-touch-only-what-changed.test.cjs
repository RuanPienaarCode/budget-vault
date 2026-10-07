'use strict';
/* An account save writes what CHANGED, in the reader's own spelling for
   everything else.

   saveAccount's patch branch promises "everything else byte for byte", and two
   callers broke it (audit of 7 Oct 2026):

     1. THE TILE'S THREE KEYS WERE ALWAYS REWRITTEN. `balance`, its date and
        the `budget` flag went out on every save, from every caller. So
        "Ignore" turned a hand-typed `balance: 640` into `640.00`, and —
        worse — `budget: a.in_budget ? null : 'false'` DELETED an explicit
        `budget: true` on every save: Confirm balance, Use this, the edit
        dialog, the mute toggles, the import's account-number adoption. That
        key is the household's opt-out from the earmark rule (ADR-0007,
        "in_budget_stated: an absent key is not consent"), so one balance
        confirmation moved a fund's outgoings out of the budget's spend, and
        nothing in the app could write the key back.
     2. THE EDIT DIALOG HANDED OVER EVERY KEY. OK with nothing changed
        re-quoted an unquoted institution and owner, wrote `30000` as
        `30000.00` and `[no-folder, no-transactions]` as `[notx, nofolder]` —
        twelve of eighteen real account files rewritten by a dialog nobody
        changed anything in.

   Each section drives the REAL view over the REAL loader; the file on disk is
   the evidence. Section 6 is a NEGATIVE CONTROL: accounts.js copied and
   reverted to always writing the three keys erases `budget: true` exactly as
   shipped, so this file cannot pass against the bug.

     node tests/accounts-saves-touch-only-what-changed.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

/* A programmable modal, installed BEFORE views/accounts.js is first required —
   it destructures askFields/confirmModal at require time. `answer(fields)`
   decides each dialog's result; the default answers every field with the
   value it was opened with, which is exactly "OK, nothing changed". */
const modalPath = require.resolve('../src/modal.js');
const asDefaults = fields => Object.fromEntries(fields.map(f => [f.key, f.value == null ? '' : f.value]));
const modal = { answer: asDefaults };
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return true; },
    async askFields(_app, _title, fields) { return modal.answer(fields); },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SRC = path.join(__dirname, '..', 'src');
const TODAY = '2026-10-07';
const TX = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n'
  + `|---|---|---|---:|---|---|\n${rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |`).join('\n')}\n`;

/* Every file here is written the way a person writes one by hand: unquoted
   strings, a whole-number balance, alias words in the mute list, a stated
   `budget: true` in the middle of the block, a key the app does not model. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nowners: Alex, Sam\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Pocket Wallet.md`]:
    '---\ntype: cash\ncurrency: €\nbalance: 640\nbalance_updated: 2026-08-15\n---\n\nNotes about this account.\n',
  [`${B}/Accounts/Holiday Pot.md`]:
    '---\ntype: savings\ninstitution: Capitec\nowner: Sam\ngoal_amount: 30000\n'
    + 'ignore_warnings: [no-folder, no-transactions]\nbalance: 1200\nbalance_updated: 2026-09-30\nbudget: no\n'
    + 'aliases: [holiday]\n---\n\n# Holiday Pot\n',
  /* The earmarked fund that runs real spending: emergency_fund marks it,
     `budget: true` says its outgoings are budget spend all the same. */
  [`${B}/Accounts/Rainy Day Fund.md`]:
    '---\ntype: savings\ninstitution: "Bank A"\nbalance: 8000.00\nbalance_updated: 2026-10-01\n'
    + 'emergency_fund: true\nbudget: true\ntags: [finance]\n---\n\n# Rainy Day Fund\n',
  [`${B}/Transactions/Rainy Day Fund/2026-10.md`]: TX([['2026-10-03', 'Pram', 'Groceries', -5000]]),
  /* A drifting account with `budget: true`, for "Use this". */
  [`${B}/Accounts/Joint Cheque.md`]:
    '---\ntype: checking\ninstitution: FNB\nowner: joint\nbalance: 2500\nbalance_updated: 2026-09-30\nbudget: true\n---\n',
  [`${B}/Transactions/Joint Cheque/2026-10.md`]: TX([['2026-10-02', 'Shop', 'Groceries', -300]]),
};

async function mount(files = FILES, viewPath = '../src/views/accounts') {
  const ctx = makeCtx({ ...files });
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.switchView = () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require(viewPath)(ctx);
  ctx.render = () => ctx.renderAccounts();
  return { ctx, S, $, file: name => ctx.vault._store.get(`${B}/Accounts/${name}.md`) };
}
const acct = (S, name) => S.accounts.find(a => a.name === name);
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* ---- 1. Ignore writes the one key it is about ---- */
    {
      const { ctx, $, file } = await mount();
      ctx.renderAccounts();
      const before = file('Pocket Wallet');
      const btn = descend($('#acctTable')).find(n => n.tagName === 'BUTTON'
        && n.getAttribute('aria-label') === 'Ignore this warning on Pocket Wallet');
      ok(btn, 'fixture: a wallet with no folder offers Ignore');
      btn._fire('click'); await tick(); await tick();
      const after = file('Pocket Wallet');
      eq(after.split('\n').filter(l => !before.split('\n').includes(l)), ['ignore_warnings: [nofolder]'],
        'Ignore adds the ignore_warnings line and nothing else');
      ok(/^balance: 640$/m.test(after), 'the hand-typed `balance: 640` keeps its spelling');
    }

    /* ---- 2. the edit dialog, OK with nothing changed, writes nothing ---- */
    {
      const { ctx, S, file } = await mount();
      modal.answer = asDefaults;
      for (const name of ['Pocket Wallet', 'Holiday Pot', 'Rainy Day Fund', 'Joint Cheque']) {
        const before = file(name);
        await ctx.editAccount(acct(S, name));
        eq(file(name), before, `${name}: an unchanged edit dialog leaves the file byte-identical`);
      }
    }

    /* ---- 3. a real edit writes that key, and only that key ---- */
    {
      const { ctx, S, file } = await mount();
      const before = file('Holiday Pot');
      modal.answer = fields => ({ ...asDefaults(fields), institution: 'Capitec Bank' });
      await ctx.editAccount(acct(S, 'Holiday Pot'));
      const after = file('Holiday Pot');
      const gone = before.split('\n').filter(l => !after.split('\n').includes(l));
      const added = after.split('\n').filter(l => !before.split('\n').includes(l));
      eq(gone, ['institution: Capitec'], 'only the institution line is replaced');
      eq(added, ['institution: "Capitec Bank"'], 'by the new value');
      ok(/^goal_amount: 30000$/m.test(after), '`goal_amount: 30000` is not rewritten as 30000.00');
      ok(/^ignore_warnings: \[no-folder, no-transactions\]$/m.test(after),
        'the alias words in the mute list survive, same warnings, the reader\'s own words');
      ok(/^budget: no$/m.test(after), '`budget: no` keeps its spelling and its place');

      /* Unmuting one warning IS a change, and is written in the canonical words. */
      modal.answer = fields => ({ ...asDefaults(fields), ignore_warnings: ['nofolder'] });
      await ctx.editAccount(acct(S, 'Holiday Pot'));
      ok(/^ignore_warnings: \[nofolder\]$/m.test(file('Holiday Pot')), 'a changed mute list is written');
    }

    /* ---- 4. `budget: true` survives every save path that is not about it ---- */
    {
      const { ctx, S, file } = await mount();
      /* R5 000 pram from the fund + R300 from the cheque account. Without the
         fund's `budget: true` the pram is earmarked out and spend reads R300. */
      const spendBefore = ctx.periodSummary('2026-10').spend;
      eq(spendBefore, 5300, 'fixture: with budget: true the fund\'s pram is budget spend');
      const fund = acct(S, 'Rainy Day Fund');
      const before = file('Rainy Day Fund');

      // Confirm balance with the same figure and the same as-at date.
      modal.answer = fields => ({ ...asDefaults(fields), as_at: fund.balance_updated });
      await ctx.editBalance(fund);
      eq(file('Rainy Day Fund'), before, 'Confirm balance, same figure and date: nothing to write');

      // Confirm balance with a NEW figure: balance + date change, budget stays.
      modal.answer = fields => ({ ...asDefaults(fields), balance: '8100.00', as_at: TODAY });
      await ctx.editBalance(fund);
      let now = file('Rainy Day Fund');
      ok(/^balance: 8100\.00$/m.test(now) && /^balance_updated: 2026-10-07$/m.test(now), 'a new figure is written');
      ok(/^budget: true$/m.test(now), 'and `budget: true` is still there');

      // The mute toggles and the import's adoption hand over one key each.
      await ctx.saveAccount(fund, ['ignore_warnings']);
      fund.account_number = '1234567';
      await ctx.saveAccount(fund, ['account_number']);
      now = file('Rainy Day Fund');
      ok(/^budget: true$/m.test(now), 'the mute toggles and the account-number adoption leave it too');

      // A real edit in the dialog.
      modal.answer = fields => ({ ...asDefaults(fields), institution: 'Bank B' });
      await ctx.editAccount(fund);
      ok(/^budget: true$/m.test(file('Rainy Day Fund')), 'an unrelated edit-dialog change leaves it');

      // "Use this" on a drifting account that states budget: true.
      const cheque = acct(S, 'Joint Cheque');
      const rec = ctx.accountReconcile(cheque, (ctx.accountIndex().get(cheque) || {}).rows || [], TODAY);
      eq(rec.state, 'drift', 'fixture: the cheque account drifts by one row');
      await ctx.acceptImplied(cheque, rec.implied, rec);
      const cq = ctx.vault._store.get(`${B}/Accounts/Joint Cheque.md`);
      ok(/^balance: 2200\.00$/m.test(cq) && /^budget: true$/m.test(cq), 'Use this writes the balance and keeps budget: true');
      ok(/^institution: FNB$/m.test(cq) && /^owner: joint$/m.test(cq), 'and leaves the unquoted strings alone');

      // Reload the fund through the REAL loader: the spend is where it was.
      const again = makeCtx({ ...FILES, [`${B}/Accounts/Rainy Day Fund.md`]: file('Rainy Day Fund') });
      await loadInto(again);
      eq(again.periodSummary('2026-10').spend, 5300, 'after every one of those saves the pram is still budget spend');
    }

    /* ---- 5. Exclude / Include still say what they always said, in place ---- */
    {
      const { ctx, S, file } = await mount();
      const fund = acct(S, 'Rainy Day Fund');
      fund.in_budget = false;                         // "Exclude from budget"
      await ctx.saveAccount(fund);
      const lines = file('Rainy Day Fund').split('\n');
      eq(lines.indexOf('budget: false'), FILES[`${B}/Accounts/Rainy Day Fund.md`].split('\n').indexOf('budget: true'),
        'excluding replaces the stated key where it stands rather than moving it to the end');
      eq(fund.in_budget_stated, true, 'and the model says the key is stated, as the loader would');
      fund.in_budget = true;                          // "Include in budget"
      await ctx.saveAccount(fund);
      ok(!/^budget:/m.test(file('Rainy Day Fund')), 'including removes the key, the documented default');
      eq(fund.in_budget_stated, false, 'and the model says nothing is stated any more');
    }

    /* ---- 6. NEGATIVE CONTROL: the shipped saveAccount, reverted in a copy ---- */
    {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-saves-nc-'));
      fs.cpSync(SRC, dir, { recursive: true });
      const target = path.join(dir, 'views', 'accounts.js');
      const src = fs.readFileSync(target, 'utf8');
      const find = 'for (const k of TILE_KEYS) if (!sameOnFile(k, a)) updates[k] = TILE_WRITERS[k](a);';
      if (!src.includes(find)) throw new Error('negative control: the tile-key diff is no longer in accounts.js — update the control');
      fs.writeFileSync(target, src.replace(find, 'for (const k of TILE_KEYS) updates[k] = TILE_WRITERS[k](a);'));
      const { ctx, S, file } = await mount(FILES, target);
      const before = file('Rainy Day Fund');
      ok(await ctx.saveAccount(acct(S, 'Rainy Day Fund')), 'NEGATIVE CONTROL: the reverted save lands');
      ok(/^budget: true$/m.test(before) && !/^budget: true$/m.test(file('Rainy Day Fund')),
        'NEGATIVE CONTROL: always writing the three tile keys erases budget: true, so section 4 would fail');
      ok(/^balance: 640\.00$/m.test((await (async () => { await ctx.saveAccount(acct(S, 'Pocket Wallet')); return file('Pocket Wallet'); })())),
        'NEGATIVE CONTROL: and re-spells balance: 640, so section 1 would fail');
      fs.rmSync(dir, { recursive: true, force: true });
    }

    /* ---- 7. a failed edit puts the model back, so a retry really retries ----
       The edit dialog now hands over only what differs from the model. If a
       failed write left the model holding the new values, the retry would see
       nothing to write and report success over a file that never changed. */
    {
      const { ctx, S, file } = await mount();
      const pot = acct(S, 'Holiday Pot');
      const realPatch = ctx.patchFile;
      ctx.patchFile = async () => { throw new Error('disk full'); };
      modal.answer = fields => ({ ...asDefaults(fields), institution: 'Capitec Bank' });
      await ctx.editAccount(pot);
      ok(ctx._toasts.some(t => t.bad && /disk full/.test(t.msg || '')), 'the failure is reported');
      eq(pot.institution, 'Capitec', 'and the model is put back to what the file holds');
      ctx.patchFile = realPatch;
      await ctx.editAccount(pot);
      ok(/^institution: "Capitec Bank"$/m.test(file('Holiday Pot')), 'so the retry writes the change');
    }
  } finally { unpin(); }

  console.log(`PASS — an account save writes what changed and nothing else (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
