'use strict';
/* Savings & Investments — the claims the cards make about money, pinned.

   Six invariants, each one a bug that shipped:

     1. NO ACCOUNT FALLS OUT OF THE CHART. `worth()` counts every account by
        sign; the composition chart used to walk a fixed list of six types. An
        account whose file says `type: tfsa` — or `type: Savings` with a capital
        S — was therefore inside the net-worth tile and absent from the chart
        beneath it: R740 000 in the tile, R660 000 in the chart's own label, one
        screen, nothing saying which was wrong. Guarded as an IDENTITY rather
        than a case, because the next unlisted type nobody thought of has to
        fail this too.

     2. AN UNLISTED TYPE KEEPS ITS OWN NAME. Folding it into "Other" would make
        the totals agree by renaming the reader's label, which is the quiet
        correction this app does not do.

     3. THE GROWTH SOURCE IS ALWAYS NAMED. Growth is recognised by category
        TYPE, so income the household earned and deposited — a salary routed to
        a fund, a consulting fee — counts as growth and nothing in the data
        tells them apart. The card named the categories only when MORE than one
        fed the figure, which withheld the disclosure exactly where one wrong
        category makes the whole figure wrong: "▲ R9 000" of consulting fees,
        unqualified.

     4. ZERO GROWTH IS NOT A MEASUREMENT OF ZERO GROWTH. A market-linked fund
        posts no transaction at all — the value moves, the balance is retyped.
        Printing "▲ R0" in green claims the fund went nowhere.

     5. THE IMPLIED BALANCE IS A FLOOR ON A FUND, NOT A CORRECTION. Confirmed at
        R200 000, three R2 000 debit orders since, market up R8 000: reconcile
        implies R206 000 while the real balance is R214 000. The offer stays —
        a fixed deposit that posts its interest reconciles exactly — but it may
        never read as a correction.

     6. A CAPITALISED SPELLING OF A KNOWN TYPE FOLDS INTO IT, NOT A GROUP OF ITS
        OWN. `type: Savings` used to earn a segment separate from every
        `type: savings` account beside it — an improvement on invariant 1's bug
        (it no longer vanished from the chart) that was still, in worth.js's own
        words, "the same bug wearing a hat": one household's savings split
        across two labels that differ only by a reader's capitalisation, which
        cost the composition chart R80 000 of a reader's confidence before it
        was case-folded to merge on read.

     node tests/savings-cards.test.cjs
*/

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const { worth, accountGroups } = require(path.join(SRC, 'worth.js'));
const { reconcile } = require(path.join(SRC, 'reconcile.js'));

/* ------------------------- 1 + 2 + 6: the grouping ----------------------- */
/* The six the chart carries labels and colours for. Duplicated from the view
   ON PURPOSE: if someone adds a type there and not here, invariant 1 below
   still holds (the new type simply arrives unlisted), which is the whole point
   of guarding the identity rather than the list. */
const KNOWN = ['investment', 'savings', 'checking', 'cash', 'credit_card', 'other'];

const ACCOUNTS = [
  { name: 'Cheque', type: 'checking', balance: 10000 },
  { name: 'Pot', type: 'savings', balance: 50000 },
  { name: 'UnitTrust', type: 'investment', balance: 200000 },
  { name: 'TFSA', type: 'tfsa', balance: 80000 },          // unlisted, hand-typed
  { name: 'Old', type: 'Savings', balance: 5000 },          // capitalised — folds into 'savings'
  { name: 'Visa', type: 'credit_card', balance: -12000 },
  { name: 'Store', type: 'store card', balance: -3000 },    // unlisted liability
];

{
  const g = accountGroups(ACCOUNTS, KNOWN);
  const w = worth(ACCOUNTS, [], []);
  const sum = list => list.reduce((t, x) => t + x.amount, 0);

  /* THE identity. Every cent worth() counts must land in a segment. */
  eq(sum(g.owned), w.ownedAccounts, 'every owned cent reaches a chart segment');
  eq(sum(g.owed), w.fromAccounts, 'every owed cent reaches a chart segment');

  const types = g.owned.map(x => x.type);
  ok(types.includes('tfsa'), 'an unlisted type is drawn, not dropped');
  /* Invariant 6: the capitalised 'Savings' account does NOT survive as its own
     group — it case-folds into the same bucket as every lowercase 'savings'
     account beside it. Asserting the negative here (no fifth/'Savings' group)
     alongside the positive (the folded total) is the negative control: either
     one alone would pass if the fold silently stopped working and the merge
     regressed back to a split. */
  ok(!types.includes('Savings'), 'a capitalised spelling does not survive as a group of its own');
  const savingsGroup = g.owned.find(x => x.type === 'savings');
  eq(savingsGroup.amount, 55000,
    'the capitalised account\'s balance lands in the SAME "savings" total (50000 + 5000), not a total of its own');
  ok(g.owed.map(x => x.type).includes('store card'), 'an unlisted liability is drawn too');
  eq(g.owned.find(x => x.type === 'tfsa').known, false, 'an unlisted type is marked unlisted');
  eq(savingsGroup.known, true, 'a listed type is marked listed');

  /* Known types keep the caller's order; the rest follow, largest first. The
     capitalised account is folded INSIDE 'savings' above, so it contributes no
     fifth entry here. */
  eq(types, ['investment', 'savings', 'checking', 'tfsa'],
    'listed types in the caller order, unlisted after, largest first');

  /* An account with no type at all is the one case that may be renamed: the
     loader already defaults it, and there is no reader label to preserve. */
  const untyped = accountGroups([{ balance: 100 }], KNOWN);
  eq(untyped.owned.map(x => x.type), ['other'], 'a missing type falls to other');

  /* Sign, not type: a card in credit is an asset, a cheque account overdrawn
     is a liability. */
  const signs = accountGroups(
    [{ type: 'credit_card', balance: 500 }, { type: 'checking', balance: -900 }], KNOWN);
  eq(signs.owned.map(x => x.type), ['credit_card'], 'a card in credit is owned');
  eq(signs.owed.map(x => x.type), ['checking'], 'an overdrawn cheque account is owed');

  /* A zero balance is not a segment of no width. */
  eq(accountGroups([{ type: 'cash', balance: 0 }], KNOWN).owned, [], 'a zero balance draws nothing');
}

/* ------------------------- 5: the implied floor ------------------------- */
{
  const acct = { type: 'investment', balance: 200000, balance_updated: '2026-06-01' };
  const rows = [
    { date: '2026-06-05', amount: 2000, cat: 'Savings' },
    { date: '2026-07-05', amount: 2000, cat: 'Savings' },
    { date: '2026-08-05', amount: 2000, cat: 'Savings' },
  ];
  const r = reconcile(acct, rows, '2026-08-20');
  eq(r.state, 'drift', 'recorded contributions drift the balance');
  eq(r.implied, 206000, 'the implied figure is the confirmed balance plus recorded movements');
  ok(r.implied < 214000, 'and it is BELOW the real balance whenever growth went unrecorded — '
    + 'which is why the card may never present it as a correction');
}

/* --------------------------- through the view --------------------------- */
class FakeText { constructor(t) { this.nodeType = 3; this.textContent = String(t); this.children = []; } }
class FakeEl {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this._cls = new Set(); this._text = '';
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._cls.add(x)),
      remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, on) => (on ? self._cls.add(c) : self._cls.delete(c)),
      contains: c => self._cls.has(c),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  /* Raw strings appended alongside elements are text nodes in a real DOM, and
     dropping them here would hide every separator the cards are built from. */
  get textContent() {
    return this._text + this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids) this.children.push(k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  getBoundingClientRect() { return { width: 1000, height: 210, left: 0, top: 0 }; }
}
global.document = {
  createElement: t => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  createTextNode: t => new FakeText(t),
};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.window = {};

function walk(el, pred, out = []) {
  for (const c of el.children) if (c instanceof FakeEl) { if (pred(c)) out.push(c); walk(c, pred, out); }
  return out;
}
const byCls = (el, cls) => walk(el, e => e._cls.has(cls));
const flat = el => String(el.textContent).replace(/\s+/g, ' ').trim();

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const acctFile = fm => `---\n${fm}\n---\n`;

/* Deliberately NOT the same vault as the pure section above: this one is built
   to make each card SAY something, and the numbers are chosen so a wrong one is
   recognisable rather than plausible. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  // interest: true (ITEM 2, 2026-08-26) — Pot's own "Interest" row (below) must
  // still read as growth now that income-typed no longer means growth on its
  // own; Fund's "Salary" row deliberately carries NO such flag — see the
  // updated comment on it below, the whole reason this category exists in
  // this fixture flipped with this change.
  [`${B}/Categories/Interest.md`]: '---\ntype: income\ninterest: true\ncolor: "#27ae60"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
  [`${B}/Categories/Savings.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',

  [`${B}/Accounts/Cheque.md`]: acctFile('type: checking\ntx_label: "Cheque"\nbalance: 10000\nbalance_updated: 2026-08-01'),
  [`${B}/Accounts/Pot.md`]: acctFile('type: savings\ntx_label: "Pot"\nbalance: 50000\nbalance_updated: 2026-08-01'),
  /* ITEM 2: was "one growth category, and it is a consulting fee — the case
     that used to go unqualified" — a client payment landing DIRECTLY in an
     investment account, income-typed, exactly the shape savings-math.js's
     classifyRow used to misread as growth. It is now the fixture for the
     OPPOSITE case: no `interest` flag on Salary, so the consulting fee joins
     "put in", not "growth from…" — see test 3 below. */
  [`${B}/Accounts/Fund.md`]: acctFile('type: investment\ntx_label: "Fund"\nbalance: 200000\nbalance_updated: 2026-08-01'),
  /* A market-linked fund: contributions recorded, growth never posted, and the
     balance confirmed BEFORE those contributions so it also drifts. */
  [`${B}/Accounts/Market.md`]: acctFile('type: investment\ntx_label: "Market"\nbalance: 200000\nbalance_updated: 2026-06-01'),
  /* The type nobody put on the list. */
  [`${B}/Accounts/TFSA.md`]: acctFile('type: tfsa\ntx_label: "TFSA"\nbalance: 80000\nbalance_updated: 2026-08-01'),

  [`${B}/Assets.md`]:
    '---\nkind: assets\n---\n\n| Name | Type | Value | Valued | Notes |\n|---|---|---:|---|---|\n' +
    '| House | property | 800000 | 2026-06-01 |  |\n',
  [`${B}/Debts.md`]:
    '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start | Category | Status | Notes |\n' +
    '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n' +
    '| Bond | Bank | home loan | 400000 | 600000 | 9.5 | 5000 | 0 | 2020-01-01 | Housing | active |  |\n',

  [`${B}/Transactions/Fund/2026-07.md`]:
    `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n` +
    '| 2026-07-05 | Debit order | Savings | 2000.00 | yes |  |\n' +
    '| 2026-07-28 | Consulting fee | Salary | 9000.00 | yes |  |\n',
  [`${B}/Transactions/Pot/2026-07.md`]:
    `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n` +
    '| 2026-07-05 | Transfer in | Savings | 1000.00 | yes |  |\n' +
    '| 2026-07-31 | Interest | Interest | 120.00 | yes |  |\n',
  [`${B}/Transactions/Market/2026-07.md`]:
    `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n` +
    '| 2026-07-05 | Debit order | Savings | 2000.00 | yes |  |\n',
};

const IDS = ['savingsKpis', 'savingsStale', 'savingsWorth', 'savingsWorthSub', 'savingsGoals', 'savingsSections'];

/* Rands with no grouping separator, so an assertion can match a figure without
   depending on which space character the locale formatter chose. */
const money = (v, dp = 2) => `R${Number(v).toFixed(dp)}`;

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const nodes = new Map(IDS.map(id => [id, new FakeEl('div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.money = money;
  ctx.saveAccount = async () => {};
  ctx.switchView = () => {};
  require('../src/views/savings')(ctx);
  ctx.renderSavings();
  return { S, nodes };
}

(async () => {
  const { S, nodes } = await mount(FILES);

  /* ---- 1. the tile and the chart state the SAME net worth ---- */
  const w = worth(S.accounts, S.debts, S.assets);
  const kpis = byCls(nodes.get('savingsKpis'), 'mini').map(flat);
  const netTile = kpis.find(t => t.startsWith('Net worth'));
  ok(netTile.includes(money(w.net)), `the tile states worth()'s net — got "${netTile}"`);

  const svg = walk(nodes.get('savingsWorth'), e => e.tagName === 'SVG')[0];
  const label = svg.getAttribute('aria-label');
  ok(label.includes(`Net worth ${money(w.net)}`),
    `the chart states the SAME net worth as the tile — got "${label}"`);
  ok(label.includes(`assets ${money(w.assets)}`), 'and the same owned total');
  ok(label.includes(`debts ${money(w.liabilities)}`), 'and the same owed total');

  /* ---- 2. the unlisted account is visible, under its own name ---- */
  const legend = walk(nodes.get('savingsWorth'), e => e.tagName === 'LI').map(flat);
  ok(legend.some(l => l.startsWith('tfsa')), `the tfsa account is a named segment — got ${JSON.stringify(legend)}`);
  ok(legend.some(l => l.includes(money(80000, 0))), 'carrying its own balance');

  /* ---- 3/4/5: what each card says ---- */
  const cards = {};
  for (const c of byCls(nodes.get('savingsSections'), 'mini')) {
    cards[String(c.children[0].textContent)] = flat(c);
  }

  /* ITEM 2 (2026-08-26): was "a single growth category is named" — Fund's
     Salary-categorised consulting fee used to read as growth on the strength
     of its income TYPE alone, which is exactly the misclassification this
     fixture now pins the FIX for instead: no `interest` flag on Salary, so
     the fee is a contribution, and with no flagged category posting anything
     the card honestly has no growth to report at all. */
  ok(/put in R11000/.test(cards.Fund),
    `the consulting fee joins "put in", not growth — got "${cards.Fund}"`);
  ok(!/growth from/.test(cards.Fund),
    `and with nothing flagged \`interest: true\`, no growth is fabricated from it — got "${cards.Fund}"`);
  ok(/no growth recorded/.test(cards.Fund),
    `so the card says plainly that none is recorded, same as an unmeasured fund would — got "${cards.Fund}"`);
  /* And more than one still is. */
  ok(/growth from .*Interest/.test(cards.Pot),
    `several growth categories are named — got "${cards.Pot}"`);

  /* A fund with no recorded growth claims none, and says why. */
  ok(!/▲/.test(cards.Market), `no green zero on an unmeasured fund — got "${cards.Market}"`);
  ok(/no growth recorded/.test(cards.Market),
    `and it says the growth is inside the balance — got "${cards.Market}"`);
  ok(/put in R2000/.test(cards.Market), 'while the contribution it CAN see is still reported');

  /* The drift offer on that same fund is marked as a floor. */
  ok(/add up to/.test(cards.Market), 'the drift offer is still made');
  ok(/recorded movements only/.test(cards.Market),
    `and is qualified as a floor, not a correction — got "${cards.Market}"`);

  /* A savings account keeps the plain offer: nothing about it is market-linked,
     and adding the caveat everywhere would make it wallpaper. */
  ok(!/recorded movements only/.test(cards.Pot), 'the caveat is investments-only');

  /* ---- one unlisted type, one colour, even across both bars ---- */
  /* Two accounts of the same unlisted type, one in credit and one overdrawn, so
     the type reaches the owned bar AND the owed bar in a single render. Walking
     the colour list by position would hand them different colours and say they
     were two different things. */
  {
    const both = await mount({
      [`${B}/Settings.md`]: FILES[`${B}/Settings.md`],
      [`${B}/Accounts/A.md`]: acctFile('type: tfsa\ntx_label: "A"\nbalance: 4000\nbalance_updated: 2026-08-01'),
      [`${B}/Accounts/B.md`]: acctFile('type: tfsa\ntx_label: "B"\nbalance: -1500\nbalance_updated: 2026-08-01'),
    });
    const swatches = walk(both.nodes.get('savingsWorth'), e => e.tagName === 'LI')
      .map(li => walk(li, e => e.tagName === 'I')[0])
      .map(i => (i.attrs.style || '').replace('background:', ''));
    eq(swatches.length, 2, 'both bars drew a tfsa segment');
    eq(swatches[0], swatches[1], 'and the same type wears the same colour in both');
  }

  /* ---- an empty vault says so rather than drawing an empty chart ---- */
  {
    const bare = await mount({ [`${B}/Settings.md`]: FILES[`${B}/Settings.md`] });
    ok(/Add a balance/.test(flat(bare.nodes.get('savingsWorth'))),
      'a vault with no accounts is invited to add one, not shown a blank chart');
    eq(walk(bare.nodes.get('savingsWorth'), e => e.tagName === 'SVG').length, 0,
      'and no chart is drawn at all');
  }

  console.log(`PASS — no account falls out of the chart, and every card says where its figure came from (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
