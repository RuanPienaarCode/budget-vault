'use strict';
/* Three ways the Accounts page described its own table wrongly (audit of
   7 Oct 2026), each pinned against the real view over the real loader.

     1. ONE SCOPE FOR "NEEDS A LOOK". With an owner filter on, the hero's
        "Needs attention" and the deck's "N accounts want a decision" counted
        every account in the vault while the "Needs a look" chip and the table
        under it counted one owner's — on the vault measured, 15 above a chip
        reading 2, and the deck's "Show them" opened a table of 2. The default
        decided on the day: every count follows the filter, and the page says
        once that it does, so the household total in the hero is not misread
        as the owner's.
     2. "GROUPED BY REASON", WHEN IT IS. The "Needs a look" filter groups the
        table by the reason each account was flagged — deliberately — while the
        sub-line went on saying "grouped by kind".
     3. NO RAND IS A EURO. "Sort by Balance" ranked a €640 wallet as though it
        held R640. Amounts in different currencies are never compared as equal:
        the household's accounts sort by value, and every other currency's
        follow them, a symbol at a time, in the direction chosen.

     node tests/accounts-page-scope-and-order.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n'
  + `|---|---|---|---:|---|---|\n${rows.map(r => `| ${r[0]} | ${r[1]} |  | ${r[2].toFixed(2)} |  |  |`).join('\n')}\n`;
const acctFile = fm => `---\n${fm}\n---\n`;
/* Who holds what, and which want a look on 7 Oct 2026:
     Alex   Cheque  R10 000  stale (confirmed in June)          flagged
            Card    −R2 000  a row after its confirmation       flagged
            Cash    R500     confirmed after its last row       ok
     Sam    Pot     R1 000   no folder                          flagged
            Fund    R5 000   confirmed after its last row       ok
            Dollar  $2 000   confirmed after its last row       ok
     Joint  Pot     R3 000   confirmed after its last row       ok
     —      Wallet  €640     no folder                          flagged      */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nowners: Alex, Sam\n---\n',
  [`${B}/Accounts/Alex Cheque.md`]: acctFile('type: checking\nowner: Alex\nbalance: 10000.00\nbalance_updated: 2026-06-01'),
  [`${B}/Transactions/Alex Cheque/2026-05.md`]: TX([['2026-05-15', 'Shop', -100]]),
  [`${B}/Accounts/Alex Card.md`]: acctFile('type: credit_card\nowner: Alex\nbalance: -2000.00\nbalance_updated: 2026-10-01'),
  [`${B}/Transactions/Alex Card/2026-10.md`]: TX([['2026-10-03', 'Shop', -300]]),
  [`${B}/Accounts/Small Cash.md`]: acctFile('type: cash\nowner: Alex\nbalance: 500.00\nbalance_updated: 2026-10-03'),
  [`${B}/Transactions/Small Cash/2026-10.md`]: TX([['2026-10-01', 'Top up', 500]]),
  [`${B}/Accounts/Sam Pot.md`]: acctFile('type: savings\nowner: Sam\nbalance: 1000.00\nbalance_updated: 2026-10-01'),
  [`${B}/Accounts/Sam Fund.md`]: acctFile('type: investment\nowner: Sam\nbalance: 5000.00\nbalance_updated: 2026-10-05'),
  [`${B}/Transactions/Sam Fund/2026-10.md`]: TX([['2026-10-01', 'Transfer in', 500]]),
  [`${B}/Accounts/Dollar Account.md`]: acctFile('type: savings\nowner: Sam\ncurrency: "$"\nbalance: 2000.00\nbalance_updated: 2026-10-02'),
  [`${B}/Transactions/Dollar Account/2026-09.md`]: TX([['2026-09-20', 'Transfer in', 100]]),
  [`${B}/Accounts/Joint Pot.md`]: acctFile('type: savings\nowner: joint\nbalance: 3000.00\nbalance_updated: 2026-10-02'),
  [`${B}/Transactions/Joint Pot/2026-09.md`]: TX([['2026-09-20', 'Transfer in', 100]]),
  [`${B}/Accounts/Pocket Wallet.md`]: acctFile('type: cash\ncurrency: "€"\nbalance: 640.00\nbalance_updated: 2026-10-02'),
};

async function mount(view) {
  const ctx = makeCtx({ ...FILES });
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
  require('../src/views/accounts')(ctx);
  S.acctView = { ...view };
  ctx.renderAccounts();
  return { ctx, S, $ };
}
const flat = n => String(n.textContent).replace(/\s+/g, ' ').trim();
const fact = ($, label) => {
  const f = descend($('#acctSummary')).find(n => n._cls.has('acct-fact') && flat(n.children[0]) === label);
  return f ? flat(f.children[1]) : null;
};
const deckText = $ => flat($('#acctDeck'));
const chipCount = ($, label) => {
  const c = descend($('#acctFilters')).find(n => n._cls.has('acct-seg') && flat(n).startsWith(label));
  return c ? flat(c.children.find(k => k._cls && k._cls.has('acct-seg-n'))) : null;
};
const rowNames = $ => descend($('#acctTable')).filter(n => n._cls.has('acct-row'))
  .map(tr => flat(descend(tr).find(n => n._cls.has('acct-name-btn'))));

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const ATT = i18n.t('acct.kpi.attention'), COUNT = i18n.t('acct.hero.count'), FLAG = i18n.t('acct.filter.flag');

    /* ---- 1. one scope ---- */
    {
      const { $ } = await mount({});
      eq(fact($, ATT), '4', 'fixture, unfiltered: four accounts want a look');
      eq(fact($, COUNT), '8', 'of eight');
      ok(deckText($).includes(i18n.t('acct.deck.title', { count: 4 })), 'and the deck says four');
      eq(chipCount($, FLAG), '4', 'as does the chip');
      ok(!flat($('#acctSummary')).includes(i18n.t('acct.hero.factsScope', { owner: 'Sam' })),
        'with no filter on, nothing says the counts are narrowed');
    }
    {
      const { $ } = await mount({ owner: 'sam' });
      eq(chipCount($, FLAG), '1', 'filtered to Sam, the chip counts Sam\'s one');
      eq(fact($, ATT), '1', 'and so does the hero — the same scope as the chip and the table');
      eq(fact($, COUNT), '3', 'its account count follows the same filter');
      ok(deckText($).includes(i18n.t('acct.deck.title', { count: 1 })),
        `and the deck counts what its "Show them" will show (got "${deckText($)}")`);
      ok(flat($('#acctSummary')).includes(i18n.t('acct.hero.factsScope', { owner: 'Sam' })),
        'and the hero says the counts are Sam\'s while its total is everyone\'s');
    }
    {
      const { $ } = await mount({ owner: 'joint' });
      ok(deckText($).includes(i18n.t('acct.deck.clearOwner', { owner: i18n.t('acct.owner.joint') })),
        `nothing of Joint's wants a look: the deck says so of Joint (got "${deckText($)}")`);
      ok(!deckText($).includes(i18n.t('acct.deck.clear')),
        'and never "Everything agrees" while three other accounts disagree');
    }

    /* ---- 2. grouped by reason ---- */
    {
      const { $ } = await mount({ filter: 'flag' });
      const sub = flat($('#acctTblSub'));
      ok(sub.includes(i18n.t('acct.table.byReason').trim()), `the "Needs a look" table says it is grouped by reason (got "${sub}")`);
      ok(!sub.includes(i18n.t('acct.table.grouped').trim()), 'not by kind');
      const groups = descend($('#acctTable')).filter(n => n._cls.has('type-row')).map(flat);
      ok(groups.some(g => g.startsWith(i18n.t('acct.deck.groupReason.nofolder'))), 'fixture: and its groups ARE reasons');
    }
    {
      const { $ } = await mount({ filter: 'all' });
      ok(flat($('#acctTblSub')).includes(i18n.t('acct.table.grouped').trim()), 'every other filter still groups by kind, and says so');
    }

    /* ---- 3. no rand is a euro ---- */
    {
      const { $ } = await mount({ grouped: false, sort: 'balance', dir: -1 });
      eq(rowNames($), ['Alex Cheque', 'Sam Fund', 'Joint Pot', 'Sam Pot', 'Small Cash', 'Alex Card', 'Dollar Account', 'Pocket Wallet'],
        'largest first: the household\'s accounts by value, then each other currency after them');
    }
    {
      const { $ } = await mount({ grouped: false, sort: 'balance', dir: 1 });
      eq(rowNames($), ['Alex Card', 'Small Cash', 'Sam Pot', 'Joint Pot', 'Sam Fund', 'Alex Cheque', 'Dollar Account', 'Pocket Wallet'],
        'smallest first: the same split — a €640 wallet is not "smaller" than R1 000');
    }

    /* ---- the words, once en.js carries them ---- */
    eq(i18n.t('acct.table.byReason'), ' · grouped by reason', 'the reason label reads as English, not as its key');
    eq(i18n.t('acct.hero.factsScope', { owner: 'Sam' }), 'These counts are for “Sam” only — the total above covers every account.',
      'the scope line reads as English');
    eq(i18n.t('acct.deck.clearOwner', { owner: 'Joint' }), 'Nothing for “Joint” needs a decision',
      'the scoped all-clear reads as English');
  } finally { unpin(); }
  console.log(`PASS — the Accounts page counts one scope, names its grouping, and never ranks a euro as a rand (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
