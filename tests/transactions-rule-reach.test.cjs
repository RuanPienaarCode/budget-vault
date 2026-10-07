'use strict';
/* Recategorising ONE row offered to repoint a rule that decides hundreds,
   without saying so — and made that the button to press.

   When a reader corrects a row's category on the Transactions page and the
   rule governing its description says otherwise, the page asks whether the
   rule should follow (offerRuleCorrection, views/transactions.js). The dialog
   read "Rows matching "X" are currently categorised as A. Also change that
   rule to B, so it gets this right next time too?" over [Cancel] [Update rule].
   It never said how far the rule reaches. On the vault this was audited
   against, one such rule decided hundreds of transactions, nearly all stored
   under the old category, and a single purchase that was an exception — one item
   bought at a grocer — looked exactly like a merchant filed wrong. One tap
   repointed every future import (2026-10-07 audit, MT-RULEFIX-REACH / OOL-2).

   Now the dialog states the reach — counted with the REAL matcher, so a
   longer rule that wins some of those descriptions takes them out, and a split
   part (the reader's own slice of a bank line, never something a rule filed)
   is not counted — and the safe answer is the default: "Just this row" is the
   button Escape and closing the dialog also give. Declining leaves the rule
   and the rules file untouched.

   The toast cannot offer an Undo: the app's toast is text only (controller.js
   toast(msg, bad)), so the success toast names the category the rule had,
   which is the way back.

   Driven through the real loader and the real Transactions page; the dialog is
   answered at the module loader (src/modal.js is the Obsidian-only piece).
     node tests/transactions-rule-reach.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
let nextConfirm = false;
const confirms = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null,
      confirmModal: async (_app, opts) => { confirms.push(opts); return nextConfirm; },
      askSplit: async () => null, askRulesCleanup: async () => false, askBudgetReslice: async () => false,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { matchRule, prepareRules } = require('../src/rules');

const B = 'Budget';
const TXH = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const RULES = 'pattern,category\nfreshmart,Groceries\nfreshmart fuel,Fuel\nspar,Groceries\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(['Groceries', 'Dining', 'Fuel', 'Household'].map(c =>
    [`${B}/Categories/${c}.md`, '---\ntype: expense\ncolor: "#888888"\n---\n'])),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit card\ntx_label: "Card"\nbalance: -500.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Data/Categorisation Rules.csv`]: RULES,
  [`${B}/Transactions/Cheque/2026-08.md`]: TXH
    + '| 2026-08-03 | FRESHMART CLAREMONT | Groceries | -100.00 |  |  |  |\n'
    + '| 2026-08-17 | FRESHMART CLAREMONT | Groceries | -120.00 |  |  |  |\n'
    + '| 2026-08-20 | FRESHMART FUEL RONDEBOSCH | Fuel | -500.00 |  |  |  |\n'
    + '| 2026-08-22 | SPARKLING WATERS | Household | -30.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: TXH
    + '| 2026-09-05 | FRESHMART CLAREMONT | Groceries | -90.00 |  |  |  |\n'
    + '| 2026-09-08 | FRESHMART FUEL RONDEBOSCH | Fuel | -450.00 |  |  |  |\n'
    // A split: the bank's line (parent, kept and excluded) and the reader's two slices.
    + '| 2026-09-12 | FRESHMART GARDENS | Groceries | -200.00 | yes | Split into 2 | parent |\n'
    + '| 2026-09-12 | FRESHMART GARDENS | Groceries | -150.00 |  |  | part |\n'
    + '| 2026-09-12 | FRESHMART GARDENS | Household | -50.00 |  |  | part |\n',
  [`${B}/Transactions/Card/2026-09.md`]: TXH
    + '| 2026-09-14 | FRESHMART ONLINE | Household | -60.00 |  |  |  |\n'
    + '| 2026-09-15 | SPAR TOPS | Groceries | -40.00 |  |  |  |\n',
};

const tick = () => new Promise(r => setTimeout(r, 20));
const rulesOnDisk = ctx => ctx.vault._store.get(`${B}/Data/Categorisation Rules.csv`);

/* Recategorise the 2026-09-05 FRESHMART CLAREMONT row the way a reader does:
   tap its category button (it becomes a real select), pick a category. */
async function recategorise(ctx, to) {
  ctx.renderTransactions();
  const btn = ctx.$('#txTable').querySelectorAll('.cat-cell-btn')
    .find(b => /2026-09-05/.test(b.getAttribute('aria-label') || '') && /FRESHMART CLAREMONT/.test(b.getAttribute('aria-label') || ''));
  ok(btn, 'the row renders its category control');
  btn._fire('click');
  const sel = btn._parent.querySelectorAll('.category-select')[0];
  ok(sel, 'which becomes a select on first use');
  sel.value = to;
  sel._fire('change');
  await tick();
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the reach, counted by the real matcher -------------------- */
    {
      const { ctx, S } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
      eq(S.rules.length, 3, 'precondition: the rules file is loaded');
      const rule = p => S.rules.find(r => r.pattern === p);
      eq(ctx.ruleReach(rule('freshmart')), 5,
        'freshmart decides 5: three CLAREMONT rows, the split parent, the ONLINE row filed elsewhere');
      eq(ctx.ruleReach(rule('freshmart fuel')), 2, 'the longer rule wins the two FUEL rows');
      eq(ctx.ruleReach(rule('spar')), 1, 'a short pattern lands on word boundaries — SPARKLING WATERS is not a SPAR row');

      /* Negative controls: the fixture tells a real count from the near
         misses. Counting every row whose description merely contains the
         pattern, or forgetting the shadowing rule, or counting the parts,
         gives a different number each time. */
      const rows = Object.values(S.txFiles).flatMap(f => f.rows);
      const naive = rows.filter(r => r.desc.toLowerCase().includes('freshmart')).length;
      const noShadow = rows.filter(r => r.split !== 'part' && matchRule(r.desc, prepareRules([rule('freshmart')]))).length;
      const withParts = rows.filter(r => (matchRule(r.desc, prepareRules(S.rules)) || {}).p === 'freshmart').length;
      eq([naive, noShadow, withParts], [9, 7, 7], 'negative control: each near miss gives another answer than 5');
    }

    /* ---- 2. the dialog says it, and "Just this row" is the default ----- */
    {
      const { ctx, S } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
      const before = rulesOnDisk(ctx);
      confirms.length = 0;
      nextConfirm = false;           // what Escape, closing, and "Just this row" all resolve to
      await recategorise(ctx, 'Dining');
      eq(confirms.length, 1, 'the correction asks about the rule, once');
      const q = confirms[0];
      ok(/decides 5 of your transactions/.test(q.message), `the dialog states the reach — got "${q.message}"`);
      ok(/every future import/.test(q.message), 'and that it reaches every future import');
      ok(/"freshmart"/.test(q.message) && /Groceries/.test(q.message) && /Dining/.test(q.message),
        'naming the rule and both categories');
      eq(q.cancelText, 'Just this row', 'the default, safe answer is "Just this row" — the button Escape gives');
      eq(q.confirmText, 'Update the rule', 'repointing is the deliberate, second choice');

      const row = S.txFiles['Cheque/2026-09'].rows.find(r => r.date === '2026-09-05');
      eq(row.cat, 'Dining', "the row's own category changed — declining is about the RULE only");
      eq(S.rules.find(r => r.pattern === 'freshmart').category, 'Groceries', 'declining leaves the rule untouched');
      eq(rulesOnDisk(ctx), before, 'and writes nothing to the rules file');
    }

    /* ---- 3. accepting repoints the rule and says how to go back -------- */
    {
      const { ctx, S } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
      confirms.length = 0;
      nextConfirm = true;
      await recategorise(ctx, 'Dining');
      eq(S.rules.find(r => r.pattern === 'freshmart').category, 'Dining', 'accepting repoints the governing rule');
      ok(/freshmart,Dining/.test(rulesOnDisk(ctx)), 'and the rules file says so');
      const toast = ctx._toasts.map(t => t.msg).find(m => /now points to/.test(m)) || '';
      ok(/"freshmart" now points to Dining/.test(toast) && /was Groceries/.test(toast),
        `the toast names the category it had, the only way back — got "${toast}"`);
    }
  } finally { unpin(); }

  console.log(`PASS — transactions: the rule-fix dialog states how many rows the rule decides, and defaults to just this row (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
