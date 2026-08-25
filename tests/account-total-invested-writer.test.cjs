'use strict';
/* total_invested: 0 through the WRITER, not just the reader.

   tests/null-vs-zero.test.cjs part 7 already pins savings-math.js's own
   reading of `total_invested: 0` as a real stated baseline (basis 'stated'),
   never "none". That is only half the loop: views/accounts.js's FM_WRITERS
   used a trailing truthiness test (`a.total_invested ? … : null`) to decide
   what to WRITE back to the file, and under that test a written 0 evaluated
   false — so saving an account holding an explicit `total_invested: 0`
   silently REMOVED the key. The next load then saw no total_invested at all,
   totalReturn() fell to basis 'none', and the Accounts/Savings growth cards
   that had shown "Growth on R0" a moment before offered "Add invested amount"
   again. `starting_amount` sits ten lines below `total_invested` in the same
   map and was already fixed this way — this file is the writer-path mirror of
   that fix, for the field that had drifted from it.

   Two writer paths, both patched:
     1. saveAccount's fmRaw PATCH branch — an existing account, loaded from a
        real file, edited and saved again. This is the path editAccount takes
        on every account this app did not just create.
     2. saveAccount's legacy REBUILD branch (no fmRaw) — a brand-new account,
        the path addAccount takes.

   Runs in bare node against the real view, same harness as
   tests/accounts-audit-fixes.test.cjs.
     node tests/account-total-invested-writer.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';

async function mount(files) {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    ...files,
  });
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const stubEl = { disabled: false, textContent: '', value: '', checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    empty() {}, append() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {} };
  ctx.$ = () => stubEl;
  ctx.$$ = () => [];
  ctx.root = stubEl;
  ctx.view = { containerEl: stubEl };
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.money = v => String(v);
  ctx.render = () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S };
}

(async () => {
  /* ---- 1. PATCH branch — an existing account's total_invested: 0 survives
     a save that touches it ---- */
  {
    const { ctx, S } = await mount({
      [`${B}/Accounts/Fund.md`]:
        '---\ntype: investment\nbalance: 5000.00\ntotal_invested: 0\nbalance_updated: 2026-07-01\n---\n',
    });
    const acct = S.accounts.find(a => a.name === 'Fund');
    eq(acct.total_invested, 0, 'sanity: the loader itself keeps the stated 0 (null-vs-zero.test.cjs pins this too)');
    ok(acct.fmRaw != null, 'a real file gives this account a captured fmRaw block, so saveAccount takes the PATCH branch');

    // Re-save every editable key unchanged — the ordinary shape of editAccount's
    // own save call, and the one that used to drop total_invested silently.
    const wrote = await ctx.saveAccount(acct, ctx.ACCOUNT_FM_KEYS);
    ok(wrote, 'the save reports success');

    const raw = ctx.vault._store.get(`${B}/Accounts/Fund.md`);
    ok(/total_invested:\s*0(\.0+)?\s*$/m.test(raw),
      `total_invested: 0 is still a line in the saved file, not dropped (raw frontmatter: ${raw})`);

    /* NEGATIVE CONTROL — the exact retired formula, verbatim from the old
       FM_WRITERS entry: `a.total_invested ? a.total_invested.toFixed(2) : null`.
       Proven to drop the key here, so a reader can see the guard above is not
       vacuous. */
    const buggyWriter = a => (a.total_invested ? a.total_invested.toFixed(2) : null);
    eq(buggyWriter(acct), null,
      'RED: the retired truthy-test writer treats a written 0 as absent and would have removed the key');
  }

  /* ---- 2. REBUILD branch — a brand-new account created with total_invested
     explicitly typed as 0 writes the key on its very first save ---- */
  {
    const { ctx, S } = await mount({});
    const fresh = {
      name: 'New Fund', type: 'investment', institution: '', owner: '',
      account_number: '', tx_label: '', currency: '', ignore_warnings: '',
      balance: 1000, balance_updated: '2026-07-01', in_budget: true,
      credit_limit: null, goal_amount: null, target_date: '',
      monthly_contribution: null, total_invested: 0,
      starting_amount: null, inception_date: '', tags: '',
      body: '\n\n# New Fund\n',
    };
    ok(!fresh.fmRaw, 'a freshly-built account has no fmRaw — saveAccount must take the REBUILD branch');
    const wrote = await ctx.saveAccount(fresh);
    ok(wrote, 'the save reports success');
    S.accounts.push(fresh);

    const raw = ctx.vault._store.get(`${B}/Accounts/New Fund.md`);
    ok(/total_invested:\s*0(\.0+)?\s*$/m.test(raw),
      `a new account's stated total_invested: 0 is written on creation, not skipped (raw frontmatter: ${raw})`);
  }

  console.log(`PASS — total_invested: 0 survives the writer (patch + rebuild), ${checks} checks.`);
})().catch(e => { console.error(e); process.exit(1); });
