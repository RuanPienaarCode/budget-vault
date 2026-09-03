'use strict';
/* A TRANSACTION DATE THAT NAMES NO DAY — the hole that turned R2 000 of
   spending into a green pill.

   src/reconcile.js placed every row by comparing `r.date` as a raw STRING
   against `a.balance_updated` and against today. Both comparisons are correct
   for a real ISO date and meaningless for anything else, and "anything else"
   is not exotic: `2026-13-05` is the ordinary day/month-swap typo (the writer
   meant 2026-05-13), `2026-02-30` is a month-length slip, and "end of June" is
   what a person types into a column the app never validated.

   Sorted as a string, all three land AFTER today — so the row went into
   `ahead`, reconcile answered 'clean', acct-status answered 'ok', the Accounts
   pill went green on "agrees", the account dropped out of the decision queue
   and out of the attention count, and the R2 000 the row records was absent
   from the implied balance with nothing on screen saying so. Measured:

     rows [{ date: '2026-08-25', amount: -2000 }]  → drift, wants a look, R8 000
     rows [{ date: '2026-13-05', amount: -2000 }]  → ok,    no look,     undefined

   Same money, same account, one character apart.

   savings-math.js:283 had already learned this lesson the hard way — its
   `monthOf` routes an unwalkable key into a visible UNDATABLE bucket rather
   than letting the row fall off the chart — and reconcile.js already imported
   `isRealIsoDate` at line 25 for the BALANCE date without ever pointing it at
   the rows.

   The fix this file pins is not "place the row better". Nothing can place it.
   It is that an unplaceable row is COUNTED and REPORTED (`unreadable`) and
   that no surface is allowed to read as agreement while one exists — the app
   argues, it never silently corrects.

   Also pinned here: isStaleValuation(), lifted OUT of views/assets.js so the
   "is this date still current" rule has one spelling. reconcile.js:63 closed
   the future-dated hole for a bank balance in 1.23.1 (`d === null || d < 0 ||
   d > STALE_DAYS`); views/assets.js and views/savings.js were each answering
   the same question about a VALUATION by their own rule, and both had the
   1.23.1 hole still open — a `valued:` date typo'd into next year read as
   current, so "Needs a new valuation: 0, every value is current" sat above a
   row whose own caption said "valued ahead of today".

     node tests/reconcile-unreadable-dates.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

const SRC = path.join(__dirname, '..', 'src');
const { reconcile, isStaleValuation } = require(path.join(SRC, 'reconcile.js'));
const { statusOf, wantsALook, queueOrder } = require(path.join(SRC, 'acct-status.js'));
/* The rendered assertions in section 8 go through the SAME call the view makes
   rather than against an English literal. views/accounts.js is in
   tests/i18n.test.cjs's TRANSLATED_VIEWS, so a literal here would pin the page
   to English and go red the moment someone reads this vault in Afrikaans —
   which is the whole point of section 9 below. */
const i18n = require(path.join(SRC, 'i18n.js'));

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-09-02';
const ACCT = { name: 'Cheque', balance: 10000, balance_updated: '2026-08-20' };
const row = (date, amount) => ({ date, amount });

/* ---- 1. the control: a readable date still behaves exactly as it did ----
   Everything below is only meaningful if the ordinary path is untouched, so
   the ordinary path is asserted first and in full. */
{
  const r = reconcile(ACCT, [row('2026-08-25', -2000)], TODAY);
  eq(r.state, 'drift', 'a real date after the balance date still drifts');
  eq(r.count, 1, 'and still counts the row that moved it');
  eq(r.implied, 8000, 'and still offers the arithmetic');
  eq(r.unreadable, 0, 'with nothing held out');

  const before = reconcile(ACCT, [row('2026-08-01', -2000)], TODAY);
  eq(before.state, 'clean', 'a row dated before the confirmation is already in the figure');
  eq(before.unreadable, 0, 'and is readable, so nothing is held out');

  const after = reconcile(ACCT, [row('2026-09-20', -2000)], TODAY);
  eq(after.state, 'pending', 'a row genuinely dated ahead is pending, not drift');
  eq(after.ahead, 1, 'and is reported as dated ahead');
  eq(after.unreadable, 0, 'a real future date is READABLE — it is not this bucket');
}

/* ---- 2. the three shapes of an unplaceable date ----
   All three used to sort ABOVE today as strings and land in `ahead`. None of
   them is a date, and none of them may be presented as "dated ahead" — that is
   a specific claim about the future which the vault has no evidence for. */
{
  for (const bad of ['2026-13-05', '2026-02-30', 'end of June', '']) {
    const r = reconcile(ACCT, [row(bad, -2000)], TODAY);
    eq(r.unreadable, 1, `"${bad}" is counted as unplaceable`);
    eq(r.ahead || 0, 0, `"${bad}" is NOT reported as dated ahead — the vault cannot know that`);
    ok(r.state !== 'drift', `"${bad}" cannot produce an implied balance, so it is not a drift`);
    eq(r.implied, undefined, `"${bad}" contributes to no implied figure`);
  }
}

/* ---- 3. the account may not read as agreeing ----
   This is the assertion the whole file exists for. `ok` is the one state that
   takes the account out of the queue, out of the attention count and out of
   the "Needs a look" filter, and paints the pill green on "agrees". */
{
  const s = statusOf(ACCT, [row('2026-13-05', -2000)], TODAY, true);
  ok(s.state !== 'ok', 'an account carrying a row nothing can date does NOT agree with its transactions');
  eq(s.state, 'unreadable', 'it is named for what is actually wrong: a date this app cannot read');
  ok(wantsALook(s), 'and it stays in the decision queue');
  eq(s.rec.unreadable, 1, 'with the count travelling on the reconciliation for the view to state');

  /* The negative control, and the exact pair the bug was measured on. */
  const good = statusOf(ACCT, [row('2026-08-25', -2000)], TODAY, true);
  eq(good.state, 'drift', 'one character away, the same money reads as a drift');
  ok(wantsALook(good), 'which also wants a look');
}

/* ---- 4. drift still outranks it, because drift has a one-tap answer ----
   An account with BOTH a readable row that moved the balance and an
   unreadable one is handed the arithmetic it can act on; the unplaceable row
   rides along on the same verdict so the drawer can say it is there. Reporting
   `unreadable` INSTEAD would hide a settleable disagreement behind a data
   error, which is the mistake acct-status's own header warns about for
   drift-versus-stale. */
{
  const r = reconcile(ACCT, [row('2026-08-25', -2000), row('2026-13-05', -3000)], TODAY);
  eq(r.state, 'drift', 'a real movement is still the headline');
  eq(r.count, 1, 'counted from the rows that could actually be placed');
  eq(r.implied, 8000, 'and the offer excludes the R3 000 nothing can date');
  eq(r.unreadable, 1, 'which is reported rather than dropped');

  const s = statusOf(ACCT, [row('2026-08-25', -2000), row('2026-13-05', -3000)], TODAY, true);
  eq(s.state, 'drift', 'the account is asked about the answerable half first');
  eq(s.rec.unreadable, 1, 'and still carries the unanswerable half');
}

/* ---- 5. it sorts into the queue rather than off the end of it ---- */
{
  const undated = statusOf(ACCT, [row('2026-13-05', -2000)], TODAY, true);
  const drifting = statusOf({ name: 'B', balance: 100, balance_updated: '2026-08-20' },
    [row('2026-08-25', -50)], TODAY, true);
  const order = queueOrder([undated, drifting]).map(s => s.state);
  eq(order, ['drift', 'unreadable'], 'the account with a one-tap answer is asked about first');
}

/* ---- 6. a split parent is still skipped before any of this ----
   supersededBySplit runs first, and must keep running first: a parent's own
   date is irrelevant because its parts carry the money. A parent with a typo'd
   date must not be counted as an unplaceable row on top of being skipped. */
{
  const parent = { date: '2026-13-05', amount: -900, excluded: true, split: 'parent' };
  const part = { date: '2026-08-25', amount: -900, split: 'part' };
  const r = reconcile(ACCT, [parent, part], TODAY);
  eq(r.unreadable, 0, 'a split parent is out of the reckoning before its date is read');
  eq(r.state, 'drift', 'and its parts still move the balance');
  eq(r.implied, 9100, 'by their own amount, once');
}

/* ---- 7. isStaleValuation — one spelling of "this date is not current" ----
   The threshold is passed in rather than defaulted here: views/assets.js
   declares VALUED_STALE_DAYS = 365 as its documented single source (see
   tests/vocabulary.test.cjs, TERM 10) and publishes it on ctx, and a default
   in this module would be a second home for the number the whole term exists
   to keep in one place. What is shared is the RULE, not the constant. */
{
  const Y = 365;
  eq(isStaleValuation('2026-08-01', TODAY, Y), false, 'a month-old valuation is current');
  eq(isStaleValuation('2025-09-02', TODAY, Y), false, 'exactly a year old is still inside the window');
  eq(isStaleValuation('2025-09-01', TODAY, Y), true, 'a day past the year is not');
  /* The 1.23.1 hole, still open on both valuation sites until now: a date
     typo'd into the FUTURE is not a fresh valuation. `d > 365` is false for a
     negative d, so "valued 2027-01-01" read as current while the row's own
     caption said "valued ahead of today". */
  eq(isStaleValuation('2027-01-01', TODAY, Y), true, 'a valuation dated ahead of today is not a current figure');
  /* null is NOT this function's answer. "I cannot read this date" and "this
     date is old" are two different claims, and views/assets.js keeps them
     apart on purpose (its own dateUnreadable) so a row it cannot date is not
     told to its face that its figure is a specific kind of old. */
  eq(isStaleValuation('', TODAY, Y), false, 'a blank date is unreadable, which is a different claim');
  eq(isStaleValuation('when we bought it', TODAY, Y), false, 'and so is a hand-typed phrase');
  eq(isStaleValuation('2026-13-45', TODAY, Y), false, 'and so is an impossible one');
}

/* ---- 8. and the page actually says it ----
   Everything above is arithmetic. This drives the REAL Accounts view over the
   REAL loader, because the harm the whole fix exists to undo was a rendering:
   a green pill reading "agrees" and an account absent from the decision queue.
   A pure-module assertion cannot tell you the pill changed colour. */
(async () => {
  const B = 'Budget';
  const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
  const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
    + '|---|---|---|---:|---|---|---|\n';
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    /* Confirmed a fortnight before the wall clock can matter: `balance_updated`
       is far enough in the past that this is never `stale` and near enough that
       nothing here depends on the day the suite runs. views/accounts.js calls
       statusOf with `today` null (the live page reads the clock), which is why
       the fixture rather than the assertion carries that guarantee. */
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\n'
      + 'balance: 10000.00\nbalance_updated: 2026-08-20\n---\n',
    // The typo, in a file a person could have written by hand: 13 is not a month.
    [`${B}/Transactions/Cheque/2026-08.md`]: `---\n${TX_FM}\n---\n\n${HEAD}`
      + '| 2026-13-05 | Grocer | Groceries | -2000.00 |  |  |  |\n',
  };

  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts',
    'savings', 'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }

  eq(S.accounts.length, 1, 'the fixture loaded one account');
  ctx.renderAccounts();

  /* The pill. `acct.state.ok` is the all-clear label and `acct-pill ok` is the
     green class; neither may be on this row. Both strings are asked of i18n
     rather than typed out, so this holds in whatever language the pill is
     rendering in — see the note beside the i18n require above. */
  const table = $('#acctTable').textContent;
  ok(!table.includes(i18n.t('acct.state.ok')),
    `the row does not claim the figure agrees with its transactions — got: ${JSON.stringify(table)}`);
  ok(table.includes(i18n.t('acct.state.unreadable')), 'it says what is actually wrong with it');
  const pills = $('#acctTable').querySelectorAll('.acct-pill');
  ok(pills.length >= 1, 'the row carries a state pill at all');
  ok(!pills.some(p => p._cls.has('ok')), 'and none of them is the green one');

  /* The queue. This is the surface the account vanished from: an attention
     count of 0 and an empty deck reading "nothing needs a look". The count is
     1 because the fixture carries exactly one undatable row — which is also
     what makes this the SINGULAR form, the one the old inline concatenation
     rendered as "1 transaction … against them". */
  /* Since the 3 Sep 2026 redesign (variant B) the deck is a one-line banner
     carrying the count, and the per-account "why" sentence sits on the
     account's own row in the table. The invariant is unchanged, so both
     surfaces are read together. */
  const deck = $('#acctDeck').textContent + ' ' + $('#acctTable').textContent;
  ok(!/is-clear/.test($('#acctDeck').attrs.class || ''), 'the deck is not in its all-clear state');
  ok(deck.includes(i18n.t('acct.deck.why.unreadable', { count: 1 })),
    `the queue names the account and says why — got: ${JSON.stringify(deck)}`);

  /* ---- 9. and it says it in the reader's own language ----
     The states above were reported in inline English for one wave, because
     `unreadable` was newer than the twelve lang tables. views/accounts.js is
     in tests/i18n.test.cjs's TRANSLATED_VIEWS, so English on this page is a
     regression for eleven of the twelve languages — and one nobody sees while
     every assertion in the file is written in English.

     Afrikaans is the check language for the ordinary reason: it is the
     longest-standing non-English table here, so an untranslated string stands
     out against a page that is otherwise fully translated. The language is
     restored afterwards because i18n keeps ONE module-global current
     language — leaving it set would silently re-language any suite that ran
     in the same process. */
  const wasLang = 'en';
  try {
    i18n.setLanguage('af');
    ctx.renderAccounts();
    const afTable = $('#acctTable').textContent;
    const afDeck = $('#acctDeck').textContent + ' ' + afTable;
    ok(afTable.includes(i18n.t('acct.state.unreadable')),
      `the Afrikaans pill states the Afrikaans label — got: ${JSON.stringify(afTable)}`);
    ok(!/date unreadable/.test(afTable),
      'and not the English one left standing beside it');
    ok(afDeck.includes(i18n.t('acct.deck.why.unreadable', { count: 1 })),
      `the Afrikaans queue explains it in Afrikaans — got: ${JSON.stringify(afDeck)}`);
    ok(!/cannot read/.test(afDeck),
      'with no English sentence surviving into the same line');
    /* The raw key is the OTHER way this fails: a key called before every table
       carries it renders its own dotted name, in every language at once. */
    ok(!/acct\.\w+\./.test(afTable + afDeck),
      'and no key renders as its own dotted name');
  } finally {
    i18n.setLanguage(wasLang);
  }

  console.log(`reconcile-unreadable-dates.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
