'use strict';
/* src/acct-inspector.js — the decisions behind the Accounts inspector, in bare
   node. No DOM, no obsidian: these are rules over data the view already holds,
   which is why they were pulled out of views/accounts.js (see the module's own
   header). The page that draws them is held by tests/accounts-inspector.test.cjs.

   WHAT IS PINNED

     pickSelection   the account the inspector shows: the reader's own choice if
                     the filter still shows it, else the first account that wants
                     a look, else the first row — never nothing while there are
                     rows.
     reconSteps      the reconciliation as three figures that add up TO THE CENT,
                     for a drift only, and never for a balance the loader could
                     not read.
     inspectorActions which buttons an account gets: the one-tap answer, the rows
                     behind it and Ignore for a flagged account (Ignore only for a
                     judgement, never for a typo); the two quiet-account buttons
                     for everything else, a MUTED account included.
     leadTrim        the " · " a sentence fragment carries to be glued on, trimmed
                     for a line of its own.

     node tests/acct-inspector.test.cjs */

const assert = require('assert');
const { pickSelection, reconSteps, inspectorActions, leadTrim } = require('../src/acct-inspector');
const { statusOf } = require('../src/acct-status');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* Rows shaped like the view's model(): the account, then statusOf()'s verdict.
   Built through the REAL statusOf so a state name that drifts from acct-status.js
   fails here rather than being agreed with by a hand-written copy. */
const TODAY = '2026-10-20';
const tx = (date, amount) => ({ date, amount, label: 'X', excluded: false });
const row = (name, a, rows, hasFolder = true) => {
  const acct = { name, balance: 1000, balance_updated: '2026-10-15', ...a };
  return { a: acct, ...statusOf(acct, rows, TODAY, hasFolder) };
};
const clean   = name => row(name, { balance_updated: '2026-10-19' }, [tx('2026-09-01', 5)]);
const drifted = (name, extra) => row(name, { balance: 1000, balance_updated: '2026-10-01', ...extra }, [tx('2026-10-05', -100), tx('2026-10-12', 250)]);
const stale   = name => row(name, { balance_updated: '2026-08-01' }, [tx('2026-07-01', 5)]);
const muted   = name => row(name, { balance_updated: '2026-08-01', ignore_warnings: 'true' }, [], false);

/* sanity: the fixtures are the states they claim to be */
eq([clean('a').state, drifted('b').state, stale('c').state, muted('d').state], ['ok', 'drift', 'stale', 'nofolder'], 'fixtures are in the states they name');
ok(muted('d').muted === true, 'and the muted one is muted');

/* ---- pickSelection ---- */
{
  const big = clean('Big Cheque'), flagged = drifted('Cheque'), pot = clean('Pot');
  eq(pickSelection([], 'x'), null, 'no rows: nothing to select');
  eq(pickSelection(null, null), null, 'and a missing list is the same');

  eq(pickSelection([big, flagged, pot], null).a.name, 'Cheque',
    'nothing chosen: the FIRST FLAGGED account, not the first row — the page is a decision queue');
  eq(pickSelection([big, pot], null).a.name, 'Big Cheque',
    'nothing flagged either: the first row, so the inspector is never empty while the list is not');
  eq(pickSelection([big, flagged, pot], 'Pot').a.name, 'Pot', 'the reader\'s own choice beats the default');
  eq(pickSelection([big, flagged, pot], 'Big Cheque').a.name, 'Big Cheque', 'even when something else is flagged');
  eq(pickSelection([flagged, pot], 'Big Cheque').a.name, 'Cheque',
    'a choice the current filter hides is ignored, not followed off-screen');

  /* "first" means first in the order the LIST draws, which is the order passed. */
  const f2 = stale('Old');
  eq(pickSelection([f2, flagged], null).a.name, 'Old', 'two flagged: the one the list draws first');
  eq(pickSelection([flagged, f2], null).a.name, 'Cheque', 'and in the other order, the other');

  /* a muted account does not want a look, so it is not the default while a real
     decision is on the page */
  eq(pickSelection([muted('Wallet'), flagged], null).a.name, 'Cheque', 'a muted account is not "flagged" for the default');
  eq(pickSelection([muted('Wallet'), big], null).a.name, 'Wallet', 'but is still the first row when that is all there is');
}

/* ---- reconSteps ---- */
{
  const s = reconSteps(drifted('Cheque'), false);
  eq(s, { stated: 1000, count: 2, delta: 150, implied: 1150 }, 'a drift: what was typed, how many rows, what they net, what that implies');
  eq(s.stated + s.delta, s.implied, 'and stated + delta = implied');

  const down = reconSteps(drifted('Card', { balance: -500 }), false);
  eq(down.delta, 150, 'the delta is signed by direction, not by sign of the balance');
  eq(down.stated + down.delta, down.implied, 'and still adds up on a negative balance');

  /* The stated figure may carry more than two decimals (a hand-typed 1000.005).
     reconcile() rounds its own delta and implied independently; printing its
     delta would put three figures on screen that do not add up. */
  const odd = drifted('Odd', { balance: 1000.005 });
  const o = reconSteps(odd, false);
  ok(Math.abs(o.stated + o.delta - o.implied) < 0.01,
    `a stated figure with a third decimal still ties to the implied one to the cent (${o.stated} + ${o.delta} vs ${o.implied})`);
  eq(o.delta, Math.round((o.implied - o.stated) * 100) / 100, 'because the delta is derived from the two figures beside it');

  eq(reconSteps(clean('Pot'), false), null, 'a clean account has no argument to show');
  eq(reconSteps(stale('Old'), false), null, 'neither does a stale one: its answer is a sentence');
  eq(reconSteps(muted('Wallet'), false), null, 'nor one with nothing to check against');
  eq(reconSteps(drifted('Cheque'), true), null,
    'a balance the loader could not read has NO lines: its stated figure is a fabricated 0 nobody typed');
  eq(reconSteps(null, false), null, 'and a missing row is not a crash');
}

/* ---- inspectorActions ---- */
{
  const a = inspectorActions(drifted('Cheque'), { hasTransactions: true });
  eq(a, { primary: 'answer', secondary: ['transactions', 'ignore'], tools: ['editBalance', 'edit', 'budget', 'note', 'delete'] },
    'a drift: the one-tap answer, the rows behind it, Ignore — and Edit balance among the small tools');
  eq(inspectorActions(drifted('Cheque'), { hasTransactions: false }).secondary, ['ignore'],
    'no folder to open rows from: no dead-end "See transactions"');

  const un = row('Typo', { balance_updated: '2026-10-15' }, [tx('2026-13-05', -2000)]);
  eq(un.state, 'unreadable', 'fixture: an undatable row makes the state `unreadable`');
  eq(inspectorActions(un, { hasTransactions: true }).secondary, ['transactions'],
    'an unreadable date is a typo, not a judgement: never offered Ignore');
  eq(inspectorActions(un, { hasTransactions: true }).primary, 'answer', 'but it still has its one answer (go and look at the rows)');

  eq(inspectorActions(stale('Old'), { hasTransactions: true }).secondary, ['transactions', 'ignore'], 'a stale figure is a judgement: Ignore is offered');

  const q = inspectorActions(clean('Pot'), { hasTransactions: true });
  eq(q, { primary: null, secondary: ['transactions', 'editBalance'], tools: ['edit', 'budget', 'note', 'delete'] },
    'a quiet account: look at its rows or correct its balance — and Edit balance is not printed twice');
  eq(inspectorActions(clean('Pot'), { hasTransactions: false }).secondary, ['editBalance'], 'with no folder, only the balance');

  const m = inspectorActions(muted('Wallet'), { hasTransactions: false });
  eq(m.primary, null, 'a MUTED account gets no decision button: the reader asked for the nagging to stop');
  ok(!m.secondary.includes('ignore'), 'and is not offered Ignore again');
}

/* ---- leadTrim ---- */
{
  eq(leadTrim(' · 2 dated ahead, not counted yet'), '2 dated ahead, not counted yet', 'the leading separator goes');
  eq(leadTrim(' · 1 transaction · in neither window'), '1 transaction · in neither window', 'and only the leading one');
  eq(leadTrim('Up to date'), 'Up to date', 'a fragment with none is untouched');
  eq(leadTrim(''), '', 'empty is empty');
  eq(leadTrim(undefined), '', 'and a missing fragment is not "undefined"');

  /* Every language's fragment really does start with the separator this trims —
     the claim the helper's comment makes. */
  const { TABLES } = require('../src/i18n');
  for (const [lang, table] of Object.entries(TABLES)) {
    for (const key of ['acct.recon.pending', 'acct.recon.undatable']) {
      const v = table[key];
      for (const form of typeof v === 'string' ? [v] : Object.values(v)) {
        ok(leadTrim(form) !== form && !/^[\s·]/.test(leadTrim(form)), `${lang} ${key}: the fragment opens with a separator that leadTrim removes (${JSON.stringify(form.slice(0, 12))})`);
      }
    }
  }
}

console.log(`PASS acct-inspector — selection, reconciliation lines, actions and fragment trimming, in bare node (${checks} checks)`);
