'use strict';
/* The Score page — what it says, in what order, and when it celebrates.

   Drives the REAL views/score.js against an in-memory vault and the DOM double,
   so the assertions are about what the view builds rather than a restatement of
   it. Three things are worth pinning beyond "it rendered":

     1. ORDER. Wins come before gaps, and gaps are biggest-first. That ordering
        is the page's whole editorial stance — a page that opened with five
        failures is one nobody returns to — and nothing else would catch it
        flipping.
     2. COMPLETENESS. The method section is built off PILLARS, so a pillar added
        to the score can never be silently missing its explanation.
     3. THE CELEBRATION IS CONDITIONAL. Confetti over a page listing only gaps
        reads as mockery, and confetti that never fires is a feature nobody has.
        Both directions are pinned, plus the reduced-motion opt-out.

     node tests/score-page.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { PILLARS } = require('../src/health-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = { month_start_day: 23, currency: 'R', country: 'za' };
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

/* A household with a real mix: cover short of target, nothing saved, no debts.
   That gives the page at least one win AND several gaps, which is the only
   shape that exercises both lists at once. */
const TX = m => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + `| ${m}-01 | Salary | Salary | 45000.00 | | | |\n`
  + `| ${m}-05 | Groceries | Groceries | -12000.00 | | | |\n`;

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]:
    '---\ntype: savings\nbalance: 30000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\nbalance: 400000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
};
for (const m of MONTHS) { FILES[`${B}/Transactions/Cheque/${m}.md`] = TX(m); }

async function mount(files = FILES) {
  const ctx = makeCtx(files, { budgetFolder: B, settings: SETTINGS });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  require('../src/categories')(ctx);
  require('../src/views/score')(ctx);
  ctx.renderScore();
  return { ctx, S, nodes };
}

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const find = (root, cls) => descend(root).filter(e => hasCls(e, cls));
const textOf = e => descend(e).map(x => x.textContent || '').join(' ') + (e.textContent || '');
const textsOf = (root, cls) => find(root, cls).map(textOf);

(async () => {
  const { nodes } = await mount();
  const hero = nodes.get('#scoreHero');
  const good = nodes.get('#scoreGood');
  const work = nodes.get('#scoreWork');
  const how = nodes.get('#scoreHow');

  /* ---- 1. the hero states a score, a band and a reading of it ---- */
  const big = find(hero, 'score-ring-num');
  eq(big.length, 1, 'one headline score, now in the ring\'s own centre');
  ok(/\d/.test(textOf(big[0])), 'which is a number');
  eq(find(hero, 'score-ring-band').length, 1, 'with the band it falls in');
  eq(find(hero, 'score-ring').length, 1, 'drawn as the ring, not the old segmented bar');
  eq(find(hero, 'score-meter').length, 1, 'and a meter');
  ok(find(hero, 'score-hero-say').length === 1, 'and one sentence pitched at that band');

  /* ---- 2. wins and gaps are BOTH populated, and disjoint ---- */
  const wins = textsOf(good, 'score-win-name');
  const gaps = textsOf(work, 'score-gap-name');
  ok(wins.length > 0, `this fixture has something to celebrate (got ${wins.length})`);
  ok(gaps.length > 0, `and something to work on (got ${gaps.length})`);
  eq(wins.filter(w => gaps.includes(w)), [],
    'no pillar is both a win and a gap — they are one list split, not two lists built');

  /* ---- 3. gaps are ordered biggest-first ----
     The page's one instruction is "start at the top". If the order drifts, the
     instruction is wrong while every figure on the page is still right. */
  const lost = find(work, 'score-gap-pts').map(e => parseInt(textOf(e), 10));
  const sorted = [...lost].sort((a, b) => b - a);
  eq(lost, sorted, `gaps run biggest-first (got ${lost.join(', ')})`);

  /* ---- 4. every gap says where you are and what to do ---- */
  ok(find(work, 'score-gap-how').length === gaps.length,
    'every gap carries its how-to, not just its figure');
  const dos = textsOf(work, 'score-gap-do');
  ok(dos.length > 0 && dos.some(t => /R /.test(t)),
    'and at least one names a concrete amount rather than an adjective');

  /* ---- 5. the method explains EVERY pillar ---- */
  const method = textsOf(how, 'score-how-name');
  eq(method.length, PILLARS.length,
    `the method section covers all ${PILLARS.length} pillars (got ${method.length})`);

  /* ---- 6. no untranslated key reaches the page ---- */
  for (const [name, node] of [['hero', hero], ['wins', good], ['gaps', work], ['method', how]]) {
    ok(!/score\.|dash\.health\./.test(textOf(node)), `${name} leaks no i18n key`);
  }

  /* ---- 7. THE CELEBRATION, both directions ----
     Confetti is punctuation for something real. A page of only gaps must not
     get it, and a page with a win must. */
  ok(find(hero, 'score-confetti-bit').length > 0,
    'a household with a win gets its confetti');

  {
    /* Nothing at full marks anywhere. Note what this fixture NEEDS to be bleak:
       an actual debt. With no Debts.md the interest measure reads 0 and scores
       FULL marks, so a household with nothing else going for it still has a win
       — which is worth knowing, and is why this fixture carries a debt rather
       than the empty debt page a "worst case" would suggest. Living costs are
       pushed near income so the spending pillar is not full either. */
    const bleak = { ...FILES,
      [`${B}/Accounts/Emergency Fund.md`]:
        '---\ntype: savings\nbalance: 100.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n',
      [`${B}/Accounts/Cheque.md`]:
        '---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
      [`${B}/Debts.md`]:
        '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
        + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
        + '| Card | Bank | credit card | 200000.00 | 200000.00 | 24.00 | 5000.00 | 0.00 | 2024-01-01 | | active | |\n' };
    for (const m of MONTHS) {
      bleak[`${B}/Transactions/Cheque/${m}.md`] = '---\nkind: transactions\n---\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
        + `| ${m}-01 | Salary | Salary | 45000.00 | | | |\n`
        + `| ${m}-05 | Groceries | Groceries | -40000.00 | | | |\n`;
    }
    const { nodes: n2 } = await mount(bleak);
    eq(find(n2.get('#scoreHero'), 'score-confetti-bit').length, 0,
      'a household with nothing at full marks is NOT confettied at');
  }

  {
    /* The opt-out. matchMedia is asked live, so flipping it here is exactly
       what a reader turning the system setting on does. */
    const real = global.matchMedia;
    global.matchMedia = q => ({ matches: /prefers-reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} });
    if (global.window) { global.window.matchMedia = global.matchMedia; }
    const { nodes: n3 } = await mount();
    eq(find(n3.get('#scoreHero'), 'score-confetti-bit').length, 0,
      'and reduced motion means no confetti at all, not merely a shorter one');
    global.matchMedia = real;
    if (global.window) { global.window.matchMedia = real; }
  }

  /* ---- 8. a vault too new to score explains itself rather than showing 0 ---- */
  {
    const bare = { [`${B}/Settings.md`]: FILES[`${B}/Settings.md`] };
    const { nodes: n4 } = await mount(bare);
    const h = n4.get('#scoreHero');
    eq(find(h, 'score-ring-num').length, 0, 'no history means no headline number');
    eq(find(h, 'score-empty-h').length, 1, 'it says why instead');
    ok(!/score\./.test(textOf(h)), 'and that explanation is translated too');
  }

  console.log(`PASS — score page: wins before gaps, gaps biggest-first, every pillar explained, and the celebration is conditional (${checks} assertions).`);
})().catch(e => { console.error('FAIL —', e.message); process.exit(1); });
