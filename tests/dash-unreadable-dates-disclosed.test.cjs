'use strict';
/* A ROW NOTHING CAN DATE, AND THE DASHBOARD FIGURES BUILT AS IF IT DID NOT
   EXIST.

   src/reconcile.js counts rows whose date names no day — `2026-13-05` is the
   ordinary day/month-swap typo, `2026-02-30` a month-length slip, "end of
   June" what a person types into a column nothing validated — and hands the
   count back as `unreadable` on every verdict that walked the rows. It cannot
   PLACE them: `since` would fold money of unknown date into an offer the
   reader accepts in one tap (and, because the row stays undatable, count it
   again on every subsequent accept), and `ahead` is the bug that made this
   class of row invisible in the first place.

   tests/reconcile-unreadable-dates.test.cjs pins the count and pins the
   ACCOUNTS page refusing to call such an account settled. What nothing pinned
   is the page a reader actually lands on. Two Dashboard surfaces are built
   out of implied balances and both went on printing them with nothing said:

     · the "what's left" chain — cash, committed, card due, free — whose
       `implied` comes straight from reconcile() (views/dashboard.js's
       renderLeft)
     · the position tile's drift note, which sums reconcile()'s own deltas to
       say how far the transactions have already moved the stated balances

   CLAUDE.md: the app argues, it never silently corrects. src/currency.js:14
   forbids the identical omission for a foreign account, and the Dashboard
   already prints `dash.foreignExcluded` for that one. An undatable row is the
   same kind of exclusion from the same figures.

   WHAT THIS FILE PINS, AND THE ONE THING IT DELIBERATELY DOES NOT.

   The FIGURE excluding the row, and the caveat appearing beside it, are
   pinned here against the real loader and the real view. The WORDS are not
   this lane's to write: `acct.drawer.recon.unreadable` is one of the three
   keys views/accounts.js names in its own deckWhy() comment as the right home
   for them, and a key added to English alone renders its own dotted name on
   screen in the other eleven languages — which is what
   tests/i18n-render.test.cjs's first and highest-value assertion exists to
   stop. So views/dashboard.js's unreadableNote() prints the sentence when the
   tables carry it and NOTHING when they do not.

   Both halves of that are asserted, in that order: first that no raw key
   leaks while the tables are silent, then — with the key installed into the
   in-memory English table for the length of one render — that the caveat
   actually reaches both surfaces. The second assertion is what stops the
   fallback from being a permanently-dead branch nobody notices is unwired the
   day the translations land.

     node tests/dash-unreadable-dates-disclosed.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The Accounts page's own wording for this state, borrowed rather than
   reworded — see the unreadableNote() comment in src/views/dashboard.js for
   why this one and not the drawer's (`acct.drawer.recon.unreadable`, which
   carries no count because the drawer is already showing the reader which
   account the rows are in). */
const KEY = 'acct.deck.why.unreadable';
/* A stand-in for whatever the twelve language tables end up carrying, in the
   shape views/accounts.js's inline English uses (its deckWhy() is the
   reference). The MARKER is the only thing the assertions match on, so this
   file pins the WIRING and never a wording — the words belong to the accounts
   lane and to the translators, and a test that spelled them out here would
   turn every improvement to the sentence into a red suite in a file that has
   no opinion about it.

   BOTH STATES ARE DRIVEN EXPLICITLY, rather than whichever one the language
   tables happen to be in on the day this runs. The key's arrival is another
   lane's work in flight; a file that asserted "nothing leaks" only while the
   tables were empty would stop testing the fallback the hour it landed, and
   one that asserted "the caveat prints" only after would have been red before
   it. So `withKey` installs the marker sentence and `withoutKey` removes
   whatever is there, each restoring the table's previous contents exactly —
   including the difference between "held a different value" and "was absent",
   which a naive delete-afterwards would flatten into the second. */
const MARKER = 'ZZ-UNPLACED-ROWS';

/* AWAITS `fn` before restoring. Written synchronously first — `try { return
   fn(); } finally { … }` — which restored the entry the instant the callback
   handed back its promise, i.e. before a single render inside it had run.
   Every assertion then measured a table in the wrong state, and the file
   failed on the surface it was proving rather than on the code it was proving
   it about. */
async function withTable(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(i18n.TABLES.en, KEY);
  const prev = i18n.TABLES.en[KEY];
  if (value === undefined) delete i18n.TABLES.en[KEY];
  else i18n.TABLES.en[KEY] = value;
  try {
    return await fn();
  } finally {
    if (had) i18n.TABLES.en[KEY] = prev; else delete i18n.TABLES.en[KEY];
  }
}
const withKey = fn => withTable({
  one: `${MARKER} {count} transaction carries a date this app cannot read`,
  other: `${MARKER} {count} transactions carry dates this app cannot read`,
}, fn);
const withoutKey = fn => withTable(undefined, fn);

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---:|---|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n\n${HEAD}`
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');

/* The clock, pinned. renderLeft() draws nothing but a "not this period" note
   unless S.period IS the current one, and every figure on it is measured
   between today and the period end — so a suite that read the wall clock
   would assert something different every morning and stop rendering the card
   at all next month. Same subclassing trick as
   tests/dash-currency-partition.test.cjs, so the loader's own date maths
   still works. */
const RealDate = Date;
function atDate(iso, fn) {
  const [y, m, d] = iso.split('-').map(Number);
  const fixed = () => new RealDate(y, m - 1, d, 12, 0, 0);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed().getTime()); }
    static now() { return fixed().getTime(); }
  }
  global.Date = FakeDate;
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate; });
}

/* One account, one readable row, one row a person typo'd. `balance_updated`
   is 35 days before the pinned clock so the account is genuinely STALE — the
   position tile's whole caveat band, drift note included, only prints when
   something is stale, and the unplaced-row sentence qualifies that drift
   figure. */
const STATED = 10000;
const READABLE = -1000;
const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\n'
    + `balance: ${STATED.toFixed(2)}\nbalance_updated: 2026-07-11\n---\n`,
  [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
    ['2026-08-05', 'Grocer', 'Groceries', READABLE],
    // 13 is not a month. The writer meant 2026-05-13 — or 2026-08-13, or
    // anything; the point is that no reader and no comparison can say.
    ['2026-13-05', 'Grocer again', 'Groceries', -2000],
  ]),
};

async function mount() {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  /* Exactly invertible, so a rendered figure can be read back without
     fighting the locale's separators — the same stub every other view test in
     this repo installs for the same reason. */
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/views/dashboard')(ctx);
  return { ctx, S, $ };
}

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));

(async () => {

/* ---- 0. the borrowed key is really there ----
   unreadableNote() prints nothing when no table carries the sentence, which
   is the right behaviour for a raw key that would otherwise appear on screen
   in eleven languages — and it is also a way for this caveat to disappear
   silently if the Accounts lane renames or retires its own string. That is
   the one failure the fallback cannot report on its own, so it is reported
   here: a rename becomes a red suite naming the file that has to follow it,
   rather than a Dashboard that quietly stops disclosing.

   Only English is checked, because tests/i18n.test.cjs's first invariant
   already requires every one of the twelve tables to carry exactly English's
   key set — checking the other eleven here would be that assertion written a
   second time, in a file with no standing to own it. */
ok(KEY in i18n.TABLES.en,
  `${KEY} is the sentence views/dashboard.js borrows for its unplaced-row caveat — if the Accounts lane has moved it, move that reference with it`);

await atDate('2026-08-15', async () => {

  /* ---- 1. the figure. The row is not in it, and could not honestly be ----
     Cash is the implied balance: the stated figure plus everything DATED
     after it. R10 000 − R1 000 = R9 000, and the R2 000 row is absent
     because nothing can place it in or out of that window. Anchored as an
     exact figure rather than a comparison, because the whole question here
     is which rows the arithmetic reached. */
  {
    const { ctx, $ } = await mount();
    ctx.renderDashboard();
    const cashFig = byClass($('#leftBody'), 'is-cash')[0];
    ok(cashFig, 'the "what\'s left" chain rendered its cash figure');
    const shown = /R\s*(-?[\d.]+)/.exec(byClass(cashFig, 'lv')[0].textContent);
    ok(shown, `the cash figure is a readable amount — got ${JSON.stringify(cashFig.textContent)}`);
    eq(Number(shown[1]), STATED + READABLE,
      'cash is the stated balance moved by the rows that can be placed, and by no others');
  }

  /* ---- 2. with no sentence to print, nothing leaks ----
     The failure this guards is not a missing caveat, it is a VISIBLE
     `acct.drawer.recon.unreadable` sitting in the middle of a card, in every
     language including English. That is exactly what a translation lookup
     returns for a key no table carries — deliberately, so the gap is
     greppable in a bug report — and it is why unreadableNote() tests the
     returned string against the key rather than trusting the lookup to have
     found something. Driven with the entry removed, so this stays a live
     check of the fallback after the tables have been filled in. */
  await withoutKey(async () => {
    const { ctx, $ } = await mount();
    ctx.renderDashboard();
    for (const id of ['#leftBody', '#dashStale']) {
      ok(!$(id).textContent.includes(KEY),
        `${id} does not print the raw key when no table carries the sentence`);
    }
  });

  /* ---- 3. with the sentence available, both surfaces say it ----
     One row, so the caveat reads in the singular — which is why the key is a
     plural entry and `count` is passed rather than interpolated into a
     pre-built string. */
  await withKey(async () => {
    const { ctx, $ } = await mount();
    ctx.renderDashboard();

    const cash = byClass($('#leftBody'), 'is-cash')[0];
    ok(cash.textContent.includes(MARKER),
      `the caveat sits beside the cash figure — got ${JSON.stringify(cash.textContent)}`);
    ok(/ZZ-UNPLACED-ROWS 1 transaction carries/.test(cash.textContent),
      'and it names the count, in the form the count selects');

    const stale = $('#dashStale').textContent;
    ok(stale.includes(MARKER),
      `and beside the position tile's drift note, which is summed from the same reconcile() verdicts — got ${JSON.stringify(stale)}`);
  });

  /* ---- 4. a vault with nothing unplaceable says nothing at all ----
     The negative control, and it is not decoration: a caveat that fires
     unconditionally is one readers learn to stop seeing, which
     summaryInRange's own `foreignHere` comment already argues at length for
     the currency disclosure next to it. Same vault, same clock, with the
     typo'd row corrected to a real day. */
  await withKey(async () => {
    const fixed = {
      ...files,
      [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
        ['2026-08-05', 'Grocer', 'Groceries', READABLE],
        ['2026-08-06', 'Grocer again', 'Groceries', -2000],
      ]),
    };
    const ctx = makeCtx(fixed, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    S.period = '2026-08';
    const { $ } = makeDom();
    ctx.$ = $;
    ctx.$$ = () => [];
    ctx.root = $('#root');
    ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
    const { el } = require('../src/dom');
    ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
    require('../src/views/dashboard')(ctx);
    ctx.renderDashboard();

    ok(!$('#leftBody').textContent.includes(MARKER),
      'a vault whose every row carries a real date gets no caveat on the cash figure');
    ok(!$('#dashStale').textContent.includes(MARKER),
      'nor on the position tile');
    /* And the row it CAN now place really did move the figure, so the control
       is a vault the arithmetic reached rather than one it silently skipped
       for some unrelated reason. */
    const shown = /R\s*(-?[\d.]+)/.exec(byClass(byClass($('#leftBody'), 'is-cash')[0], 'lv')[0].textContent);
    eq(Number(shown[1]), STATED + READABLE - 2000,
      'and the corrected row is now inside the implied balance');
  });
});

console.log(`PASS  dash-unreadable-dates-disclosed.test.cjs  (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
