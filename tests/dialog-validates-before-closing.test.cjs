'use strict';
/* The five dialogs that used to close first and complain afterwards now hand
   their checks to the dialog (2026-11-25 audit, FUN-1).

   modal-validate-keeps-dialog-open.test.cjs pins the hook itself. This file
   pins that each call site USES it, with the checks the audit named, by
   driving the real views through a dialog that behaves like the real one:
   it runs the `validate` it was given on every attempt, and only a passing
   attempt closes it. A site that still validates after `await askFields` can
   not pass: the first, refused attempt would close the dialog and the retry
   would never happen.

     1. Add transaction — a missing description keeps the amount, the note and
        the rest; a bad date, a zero amount and an unreadable amount are each
        refused in the form, naming the control
     2. New note — a missing title keeps the body (the paragraph that was
        thrown away)
     3. New account — a missing name, a taken name, an unreadable balance
     4. Edit account — an amount that is not a number, a currency code that is
        not three letters
     5. Update balance — a balance that is not a number
     6. through all five: nothing was toasted, nothing written for a refused
        attempt, and the corrected attempt writes exactly what was typed
     7. a caller handed the values some other way (a stub that never calls the
        hook) is held to the same rules after the dialog: the check is not
        only in the hook

     node tests/dialog-validates-before-closing.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A dialog that behaves like FieldModal for the purpose of validation: starts
   from the field defaults, applies one edit per attempt, asks the hook, and
   closes only on a pass. `attempts` is [[edit, edit, …]] per dialog opened;
   running out of edits is the reader pressing Cancel. */
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const dialogs = { queue: [], log: [], ignoreHook: false };
const defaults = fields => Object.fromEntries(fields.map(f => [f.key,
  f.type === 'toggles' ? [...(f.value || [])] : f.type === 'select' ? (f.value ?? (f.options[0].value ?? f.options[0])) : String(f.value ?? '')]));
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async (_app, title, fields, opts) => {
        const values = defaults(fields);
        const edits = dialogs.queue.shift() || [];
        const turn = { title, verdicts: [], hook: !!(opts && opts.validate) };
        dialogs.log.push(turn);
        for (const edit of edits) {
          Object.assign(values, edit);
          const verdict = opts && opts.validate && !dialogs.ignoreHook ? opts.validate({ ...values }) : null;
          turn.verdicts.push(verdict || null);
          if (!verdict) return values;          // passes: the dialog closes
        }
        return null;                            // Cancel
      },
      confirmModal: async () => true,
      askSplit: async () => null, askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const i18n = require('../src/i18n');

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const SEPT = `${B}/Transactions/Cheque/2026-09.md`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Accounts/Pot.md`]: '---\ntype: savings\nbalance: 500\nbalance_updated: 2026-09-30\ngoal_amount: 1000\n---\n',
  [SEPT]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD + '| 2026-09-01 | Coffee | Food | -35.00 |  |  |\n',
};
const SEP = '\u001F';
const mount = async () => {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.switchView = () => {};
  return m;
};
const toasts = ctx => ctx._toasts.length;
const acct = (S, name) => S.accounts.find(a => a.name === name);
const keyed = v => v && v.field;
const lastLog = () => dialogs.log[dialogs.log.length - 1];

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. Add transaction ---------------------------------------------- */
    {
      const { ctx, S } = await mount();
      dialogs.queue.push([
        { desc: '', amount: '20', note: 'cash', cat: 'Food', date: '2026-09-05', label: 'Cheque', dir: 'out' },
        { date: '2026-9-5' },
        { date: '2026-09-05', desc: 'Bakery', amount: '0' },
        { amount: 'abc' },
        { amount: '20' },
      ]);
      await ctx.addTransaction();
      const v = lastLog().verdicts;
      ok(lastLog().hook, 'Add transaction hands the dialog a validate hook');
      eq(v.map(keyed), ['desc', 'date', 'amount', 'amount', null],
        'each refusal names the control to put the cursor in, and the fifth attempt passes');
      eq(v[0].message, i18n.t('tx.err.desc'), 'a missing description says so in the dialog');
      eq(v[1].message, i18n.t('tx.err.date'), 'a malformed date likewise');
      eq(v[2].message, i18n.t('tx.err.amount'), 'a zero amount likewise');
      eq(toasts(ctx), 1, 'the only toast is the success one — refusals were said in the dialog, not after it closed');
      const disk = ctx.vault._store.get(SEPT);
      ok(disk.includes('| 2026-09-05 | Bakery | Food | -20.00 |  | cash |'),
        'and the row written carries everything typed before the first refusal: the category and the note');
    }

    /* ---- 2. New note ------------------------------------------------------ */
    {
      const { ctx, S } = await mount();
      dialogs.queue.push([
        { title: '   ', body: 'Rang the bank about the fee.\n\nThey said Tuesday.', about: `general${SEP}` },
        { title: 'Bank call' },
      ]);
      await ctx.addNote();
      const v = lastLog().verdicts;
      ok(lastLog().hook, 'New note hands the dialog a validate hook');
      eq(v.map(keyed), ['title', null], 'a blank title is refused in the dialog, then passes');
      eq(v[0].message, 'A note needs a title', 'saying so');
      const written = [...ctx.vault._store.entries()].filter(([k]) => k.startsWith(`${B}/Notes/`) && !k.endsWith('/.folder'));
      eq(written.length, 1, 'one note written');
      ok(written[0][1].includes('They said Tuesday.'), 'with the body that was typed before the title was missing');
      eq(S.notes.length, 1, 'and it is in S.notes');
    }

    /* ---- 3. New account --------------------------------------------------- */
    {
      const { ctx, S } = await mount();
      dialogs.queue.push([
        { name: '', institution: 'Acme Bank', balance: '100' },
        { name: 'Cheque' },
        { name: 'Holiday', balance: '1 5oo' },
        { balance: '250' },
      ]);
      const made = await ctx.addAccount();
      const v = lastLog().verdicts;
      ok(lastLog().hook, 'New account hands the dialog a validate hook');
      eq(v.map(keyed), ['name', 'name', 'balance', null], 'blank name, taken name, unreadable balance — then through');
      eq(v[0].message, i18n.t('acct.err.nameRequired'), 'a blank name says so');
      eq(v[1].message, i18n.t('acct.err.exists'), 'a taken name says so');
      ok(made && made.name === 'Holiday', 'the account is created');
      eq(made.institution, 'Acme Bank', 'with the institution typed before the first refusal');
      eq(made.balance, 250, 'and the corrected balance');
      eq(toasts(ctx), 1, 'one toast: the creation');
    }

    /* ---- 4. Edit account -------------------------------------------------- */
    {
      const { ctx, S } = await mount();
      dialogs.queue.push([
        { goal_amount: 'lots', institution: 'Acme Bank' },
        { goal_amount: '2000', currency_code: 'yuan' },
        { currency_code: 'cny' },
      ]);
      await ctx.editAccount(acct(S, 'Pot'));
      const v = lastLog().verdicts;
      ok(lastLog().hook, 'Edit account hands the dialog a validate hook');
      eq(v.map(keyed), ['goal_amount', 'currency_code', null], 'a non-number and a bad code are refused in the form');
      eq(v[0].message, i18n.t('acct.err.notNumber', { field: 'goal amount' }), 'the amount refusal names the field');
      eq(v[1].message, i18n.t('acct.err.code', { field: i18n.t('acct.field.currencyCode'), example: 'CNY' }), 'the code refusal gives an example');
      const a = acct(S, 'Pot');
      eq([a.goal_amount, a.currency_code, a.institution], [2000, 'CNY', 'Acme Bank'],
        'saved with the values typed across all three attempts');
      eq(toasts(ctx), 1, 'one toast: "updated"');
    }

    /* ---- 5. Update balance ------------------------------------------------ */
    {
      const { ctx, S } = await mount();
      dialogs.queue.push([
        { balance: 'one fifty', as_at: '2026-09-28' },
        { balance: '150' },
      ]);
      await ctx.editBalance(acct(S, 'Cheque'));
      const v = lastLog().verdicts;
      ok(lastLog().hook, 'Update balance hands the dialog a validate hook');
      eq(v.map(keyed), ['balance', null], 'an unreadable balance is refused in the form');
      eq(v[0].message, i18n.t('acct.err.nan', { field: i18n.t('acct.balance.field'), example: '1500.00' }), 'with an example');
      const a = acct(S, 'Cheque');
      eq([a.balance, a.balance_updated], [150, '2026-09-28'], 'and the date typed beside it survived the refusal');
    }

    /* ---- 7. the check is not only in the hook ----------------------------- */
    {
      const { ctx, S } = await mount();
      const before = ctx.vault._store.get(SEPT);
      dialogs.ignoreHook = true;       // values come back without the hook ever running
      dialogs.queue.push([{ desc: '', amount: '20', date: '2026-09-05', label: 'Cheque', dir: 'out' }]);
      await ctx.addTransaction();
      eq(ctx.vault._store.get(SEPT), before, 'a blank description that reached the caller writes nothing');
      eq(ctx._toasts[ctx._toasts.length - 1].msg, i18n.t('tx.err.desc'), 'and is said with the same words, as a toast');
      dialogs.queue.push([{ title: '', body: 'kept' }]);
      await ctx.addNote();
      eq(S.notes.length, 0, 'likewise a blank note title writes no note');
      dialogs.ignoreHook = false;
    }

    console.log(`PASS dialog-validates-before-closing — five dialogs refuse in the form, not after it (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
