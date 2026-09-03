'use strict';
/* AN ACCOUNT'S TWO CURRENCY FIELDS, DISAGREEING — the last open thread from
   the 2026-09-02 audit, recorded under #31 as "also unresolved" and left
   because it only bites together with conversion.

   `currency` is a display SYMBOL. `currency_code` is an ISO code for rate
   lookup. Nothing had ever compared them, and they answer the same question by
   two routes:

     currency.js  isForeign(a, 'R')          symbol matches the household -> HOME
     fx.js        codeOf(a, {code:'ZAR'})    code is not the household's  -> FOREIGN

   So `currency: R` with `currency_code: USD` in a rand/ZAR vault was household
   money to one module and a dollar balance to the other. Measured on the
   Accounts page:

     split headline (added at par)   R  1 000
     converted line (at 0.0556)      R 17 985,61

   One account, one page, eighteen times apart — and the at-par reading is the
   dangerous one, because it is the number every other page's net worth is
   built from.

   WHERE THE FIX LIVES, and why not in isForeign(). That function takes a
   household SYMBOL and cannot see a code; teaching it to would mean threading
   a second argument through every one of its call sites, which is precisely
   how 1.36.0's fixes reached some consumers and not others — twice. Settings
   are parsed before accounts, so load.js compares the two fields ONCE, where
   both halves are already in scope, and stamps the answer on the account the
   way `in_budget_stated` and a category's `type_stated` already do. Every
   existing consumer then gets it with no signature change.

   THE SAFE READING IS FOREIGN. Held out of the household total and named,
   which is what currency.js has always done with money it cannot add. Counted
   at par is the alternative, and it is how R1 000 of dollars became R1 000 of
   rands.

   WHAT IS PINNED

     1. The conflict is detected, and ONLY in the contradictory case — an
        ordinary foreign account and an ordinary household account are both
        untouched.
     2. The two modules now agree about home-vs-foreign.
     3. The disclosure names it by its CODE, not by the household symbol it
        falsely claims.
     4. The household is TOLD, on the row and in the drawer — the app argues,
        it does not silently pick a winner.

     node tests/currency-fields-agree.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const i18n = require('../src/i18n');
const { isForeign, symbolOf, splitByCurrency } = require('../src/currency');
const { codeOf, convertAccounts, normalizeTable } = require('../src/fx');
const { worth } = require('../src/worth');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const HH = { code: 'ZAR', symbol: 'R' };
const acct = (name, fm) => ({ [`${B}/Accounts/${name}.md`]: `---\ntx_label: "${name}"\n${fm}---\n` });

const VAULT = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncurrency_code: "ZAR"\ncountry: za\n---\n',
  ...acct('Cheque', 'type: checking\nbalance: 20000\nbalance_updated: 2026-09-01\n'),
  ...acct('Broker', 'type: investment\ncurrency: "R"\ncurrency_code: "USD"\nbalance: 1000\nbalance_updated: 2026-09-01\n'),
  ...acct('Euro', 'type: savings\ncurrency: "€"\ncurrency_code: "EUR"\nbalance: 500\nbalance_updated: 2026-09-01\n'),
  ...acct('Silent', 'type: savings\ncurrency_code: "ZAR"\nbalance: 300\nbalance_updated: 2026-09-01\n'),
};

(async () => {
  const ctx = makeCtx(VAULT, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  const by = new Map(S.accounts.map(a => [a.name, a]));

  /* ---- 1. detected, and only where the two fields contradict ---- */
  eq(by.get('Broker').currency_conflict, { symbol: 'R', code: 'USD', homeCode: 'ZAR' },
    'the contradictory account is flagged, with both words it stated');
  eq(by.get('Cheque').currency_conflict, undefined,
    'an ordinary household account states neither and is untouched');
  eq(by.get('Euro').currency_conflict, undefined,
    'an ordinary foreign account agrees with itself — isForeign always caught it, and still does');
  eq(by.get('Silent').currency_conflict, undefined,
    'and a code matching the household is no conflict at all');

  /* ---- 2. the two modules agree ---- */
  for (const [name, want] of [['Cheque', false], ['Broker', true], ['Euro', true], ['Silent', false]]) {
    const a = by.get(name);
    const foreignToFx = codeOf(a, HH) !== HH.code;
    eq(isForeign(a, 'R'), want, `${name}: currency.js`);
    eq(foreignToFx, want, `${name}: fx.js reaches the same verdict`);
  }

  /* ---- 3. named by its code, and out of the household total ---- */
  {
    const split = splitByCurrency(S.accounts, 'R');
    eq(split.primary.map(a => a.name).sort(), ['Cheque', 'Silent'],
      'the conflicted account is not in the addable pile');
    eq(symbolOf(by.get('Broker'), 'R'), 'USD',
      'and is labelled by its code — "R 1 000 held in other currencies" in a rand vault reads as a bug, not a warning');
    ok(split.others.some(([sym, v]) => sym === 'USD' && v === 1000),
      `the disclosure names it: ${JSON.stringify(split.others)}`);

    eq(worth(split.primary, null, null, 'R').net, 20300,
      'net worth is cheque + the rand savings — NOT the 21 300 it was with the dollars at par');
  }

  /* ---- 4. conversion is unchanged, and now agrees with the split ---- */
  {
    const table = normalizeTable({ base: 'ZAR', date: '2026-09-03', rates: { USD: 0.0556, EUR: 0.0505, ZAR: 1 } });
    const conv = convertAccounts(S.accounts, HH, table, '2026-09-03');
    eq(conv.home, 20300, 'the converted view counts the same two accounts as home');
    ok(conv.converted.some(c => c.code === 'USD' && c.amount === 1000),
      'and converts the conflicted one, exactly as it always did');
  }

  /* ---- 5. and the household is told ---- */
  {
    const { $ } = makeDom();
    const c2 = makeCtx(VAULT, { settings: { month_start_day: 1 } });
    const S2 = await loadInto(c2);
    S2.period = '2026-09';
    c2.$ = $; c2.$$ = () => []; c2.root = $('#root'); c2.view = { containerEl: $('#root') };
    c2.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    c2.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    c2.typeBadge = t => el('span', {}, t);
    c2.switchView = () => {};
    require('../src/categories')(c2);
    require('../src/views/accounts')(c2);
    c2.renderAccounts();

    const walk = (n, fn) => { fn(n); for (const c of (n.children || [])) walk(c, fn); };
    /* The row is flagged at a glance — a contradiction in the file is not a
       figure that has merely aged. */
    let brokerRow = null;
    walk($('#acctTable'), n => {
      if (brokerRow || !n._cls || !n._cls.has('acct-row')) return;
      let isBroker = false;
      walk(n, m => { if (m._cls && m._cls.has('acct-name-btn') && m.textContent.trim() === 'Broker') isBroker = true; });
      if (isBroker) brokerRow = n;
    });
    ok(brokerRow, 'the Broker row is on the page');
    ok(brokerRow._cls.has('is-flag'), 'and is flagged for a look without being opened');

    /* And the drawer says WHICH of the two words won, so the file can be
       corrected rather than the reader left wondering why a rand account is
       listed under USD. */
    brokerRow.click();
    let txt = '';
    walk($('#acctTable'), n => { if (n._text) txt += n._text + ' | '; });
    const want = i18n.t('acct.badge.currencyClash', { code: 'USD', symbol: 'R' });
    ok(txt.includes(want),
      `the drawer names the conflict — wanted "${want}", got: ${txt.slice(-400)}`);
  }

  console.log(`PASS currency-fields-agree (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
