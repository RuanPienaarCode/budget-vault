'use strict';
/* An account's currency CODE, settable from the app.

   Conversion keys off `currency_code` on the account (fx.js codeOf): a symbol
   alone cannot say which currency it means, so an account without a code is
   named beside the totals and never converted. Until now the only way to set
   that code was to open the account's note and type the line by hand — the
   Edit account dialog had a Currency (symbol) field and nothing else, and its
   description said "nothing is converted" even with exchange rates switched
   on. Raised by issue #28's follow-up question: a reader with rates on could
   not get an RMB account into a rupiah total from inside the app.

   WHAT IS PINNED

     1. both dialogs offer the code beside the symbol, with a placeholder hint
        that is never written as a value
     2. the symbol's description says "nothing is converted" only while rates
        are off; with rates on it points at the code instead
     3. a typed code is upper-cased and written as that one line; clearing it
        removes the line; an unchanged dialog rewrites nothing, including a
        hand-typed code the loader could not read
     4. something that is not a three-letter code is refused, nothing written —
        normalising it to '' would have deleted the reader's code instead
     5. the symbol/code contradiction is re-judged after the save by the rule
        load.js applies (fx.currencyConflict), not left until the next reload
     6. the create dialog writes the code too, and the loader reads it back

   Bare node, the real loader and the real view; the file on disk is the
   evidence.
     node tests/account-currency-code-field.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

/* Installed before views/accounts.js is required: it destructures askFields
   at load time. `answer(fields)` decides each dialog's result; `seen` keeps
   the field list the view built. */
const modalPath = require.resolve('../src/modal.js');
const asDefaults = fields => Object.fromEntries(fields.map(f => [f.key, f.value == null ? '' : f.value]));
const modal = { answer: asDefaults, seen: null };
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return true; },
    async askFields(_app, _title, fields) { modal.seen = fields; return modal.answer(fields); },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const fx = require('../src/fx');
const en = require('../src/lang/en');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const settings = rates => `---\nmonth_start_day: 1\ncurrency: "R"\ncurrency_code: ZAR\ncountry: za\n${rates ? 'exchange_rates: on\n' : ''}---\n`;
const FILES = rates => ({
  [`${B}/Settings.md`]: settings(rates),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 2500\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Euro Pot.md`]: '---\ntype: savings\ncurrency: €\nbalance: 500\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Alipay.md`]: '---\ntype: savings\ncurrency: RMB\ncurrency_code: CNY\nbalance: 3956\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Typo.md`]: '---\ntype: savings\ncurrency: RMB\ncurrency_code: yuan\nbalance: 10\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Dollar.md`]: '---\ntype: savings\ncurrency: $\nbalance: 100\nbalance_updated: 2026-10-01\n---\n',
});

async function mount(rates = false) {
  const ctx = makeCtx(FILES(rates));
  const S = await loadInto(ctx);
  ctx.render = () => {};
  require('../src/views/accounts')(ctx);
  return { ctx, S, file: name => ctx.vault._store.get(`${B}/Accounts/${name}.md`) };
}
const acct = (S, name) => S.accounts.find(a => a.name === name);
const field = key => modal.seen.find(f => f.key === key);
const diff = (before, after) => ({
  gone: before.split('\n').filter(l => !after.split('\n').includes(l)),
  added: after.split('\n').filter(l => !before.split('\n').includes(l)),
});

(async () => {
  /* ---- 0. the shared rule, on its own ---- */
  eq(fx.currencyConflict('R', 'USD', 'R', 'ZAR'), { symbol: 'R', code: 'USD', homeCode: 'ZAR' },
    'a home symbol with a foreign code is a conflict');
  eq(fx.currencyConflict('', 'usd', 'R', 'ZAR'), { symbol: 'R', code: 'USD', homeCode: 'ZAR' },
    'a blank symbol claims home too, and the code is normalised');
  eq(fx.currencyConflict('$', 'USD', 'R', 'ZAR'), null, 'a foreign symbol with its code is not');
  eq(fx.currencyConflict('R', 'ZAR', 'R', 'ZAR'), null, 'the household code on a home account is not');
  eq(fx.currencyConflict('R', 'USD', 'R', ''), null, 'no household code means nothing to contradict');

  /* ---- 1. the edit dialog offers the code beside the symbol ---- */
  {
    const { ctx, S } = await mount();
    await ctx.editAccount(acct(S, 'Alipay'));
    const keys = modal.seen.map(f => f.key);
    eq(keys.indexOf('currency_code'), keys.indexOf('currency') + 1, 'the code sits directly after the symbol');
    eq(field('currency_code').value, 'CNY', 'an account with a code opens with it');
    eq(field('currency_code').label, en['acct.field.currencyCode'], 'labelled Currency code');

    await ctx.editAccount(acct(S, 'Cheque'));
    eq(field('currency_code').placeholder, 'ZAR', 'a household account is hinted the household code');
    await ctx.editAccount(acct(S, 'Euro Pot'));
    eq(field('currency_code').placeholder, 'EUR', '€ names one currency, so it is hinted EUR');
    await ctx.editAccount(acct(S, 'Dollar'));
    eq(field('currency_code').placeholder, '', '$ names four, so nothing is hinted');
    eq(field('currency_code').value, '', 'and the hint is never the value');
  }

  /* ---- 2. the symbol's description follows the rates switch ---- */
  {
    const off = await mount(false);
    await off.ctx.editAccount(acct(off.S, 'Cheque'));
    ok(/nothing is converted/.test(field('currency').desc), 'rates off: the symbol only relabels, and says so');
    const on = await mount(true);
    await on.ctx.editAccount(acct(on.S, 'Cheque'));
    ok(!/nothing is converted/.test(field('currency').desc), 'rates on: it no longer says nothing is converted');
    ok(/currency code below/.test(field('currency').desc), 'it points at the code field instead');
    await on.ctx.addAccount();
    ok(/currency code below/.test(field('currency').desc), 'the create dialog says the same');
  }

  /* ---- 3. writes: the one line, cleared cleanly, nothing on an unchanged OK ---- */
  {
    const { ctx, S, file } = await mount(true);
    const before = file('Euro Pot');
    modal.answer = fields => ({ ...asDefaults(fields), currency_code: ' eur ' });
    await ctx.editAccount(acct(S, 'Euro Pot'));
    eq(diff(before, file('Euro Pot')), { gone: [], added: ['currency_code: "EUR"'] },
      'a typed code is upper-cased and written as that one line');
    eq(acct(S, 'Euro Pot').currency_code, 'EUR', 'and the model holds it for the next render');

    modal.answer = fields => ({ ...asDefaults(fields), currency_code: '' });
    await ctx.editAccount(acct(S, 'Euro Pot'));
    eq(file('Euro Pot'), before, 'clearing the code removes the line again');

    modal.answer = asDefaults;
    for (const name of ['Alipay', 'Typo', 'Cheque']) {
      const was = file(name);
      await ctx.editAccount(acct(S, name));
      eq(file(name), was, `${name}: an unchanged dialog leaves the file byte-identical`);
    }
    ok(/^currency_code: yuan$/m.test(file('Typo')), 'a hand-typed code the loader cannot read is not erased');
  }

  /* ---- 4. not a code: refused, nothing written ---- */
  {
    const { ctx, S, file } = await mount(true);
    const before = file('Alipay');
    modal.answer = fields => ({ ...asDefaults(fields), currency_code: 'yuan', institution: 'Ant' });
    await ctx.editAccount(acct(S, 'Alipay'));
    eq(file('Alipay'), before, 'the whole save is refused, the institution included');
    eq(acct(S, 'Alipay').currency_code, 'CNY', 'and the model keeps the code it had');
    const t = ctx._toasts[ctx._toasts.length - 1];
    ok(t && t.bad && /three-letter code like CNY/.test(t.msg), 'the reader is told what a code looks like');
  }

  /* ---- 5. the contradiction is judged at once, by load.js's rule ---- */
  {
    const { ctx, S } = await mount(true);
    const cheque = acct(S, 'Cheque');
    ok(!cheque.currency_conflict, 'fixture: the cheque account starts clean');
    modal.answer = fields => ({ ...asDefaults(fields), currency_code: 'USD' });
    await ctx.editAccount(cheque);
    eq(cheque.currency_conflict, { symbol: 'R', code: 'USD', homeCode: 'ZAR' },
      'a dollar code on a rand-symbol account is flagged straight away, not counted at par until a reload');
    modal.answer = fields => ({ ...asDefaults(fields), currency: '$' });
    await ctx.editAccount(cheque);
    ok(!('currency_conflict' in cheque), 'giving it the dollar symbol clears the flag');

    const again = makeCtx({ ...FILES(true), [`${B}/Accounts/Cheque.md`]: ctx.vault._store.get(`${B}/Accounts/Cheque.md`) });
    await loadInto(again);
    const reloaded = again.S.accounts.find(a => a.name === 'Cheque');
    eq([reloaded.currency, reloaded.currency_code, !!reloaded.currency_conflict], ['$', 'USD', false],
      'and a reload reads the same account the dialog left behind');
  }

  /* ---- 6. the create dialog writes the code, and refuses a bad one ---- */
  {
    const { ctx, S, file } = await mount(true);
    modal.answer = fields => ({ ...asDefaults(fields), name: 'Yen', type: 'savings', balance: '1000',
      currency: '¥', currency_code: 'jpy', budget: 'yes' });
    const made = await ctx.addAccount();
    ok(made && made.currency_code === 'JPY', 'the new account carries its code');
    ok(/^currency: "¥"\ncurrency_code: "JPY"$/m.test(file('Yen')), 'written beside the symbol');
    const again = makeCtx({ ...FILES(true), [`${B}/Accounts/Yen.md`]: file('Yen') });
    await loadInto(again);
    eq(again.S.accounts.find(a => a.name === 'Yen').currency_code, 'JPY', 'and the loader reads it back');

    const count = S.accounts.length;
    modal.answer = fields => ({ ...asDefaults(fields), name: 'Bad', type: 'savings', balance: '1', currency_code: 'Y' });
    eq(await ctx.addAccount(), null, 'a bad code creates nothing');
    eq([S.accounts.length, file('Bad')], [count, undefined], 'no account, no file');
  }

  console.log(`PASS — an account's currency code is set from the dialogs (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
