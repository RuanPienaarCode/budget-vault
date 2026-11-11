'use strict';
/* The reconciliation gate, with exchange rates ON. 2026-11-11 audit, task 8.

   tests/reconcile-gate.test.cjs and its household2 sibling both run households
   with `exchange_rates` off, and until task 23 the mount they run on did not
   register fx-live at all. So the converted Accounts hero — the one caller of
   fxConvert, the one place a converted figure reaches a screen — sat outside
   the only test that can catch two figures derived by different rules. The
   audit found no defect there. It found that nobody had looked.

   tests/figures/household-fx.cjs is the first household with conversion
   switched on: a dollar and a euro account the table can convert, a yen
   account it cannot, and a FIXED rate table committed as the vault's own
   cache file. This suite runs the whole reconciliation over it and holds it to
   the first gate's standard — no disagreement, nothing unmeasurable, nothing
   explained away.

   WHAT IS NEW IN THE RECONCILIATION (scripts/reconcile-page.cjs)

   Three readings of the converted total, as for every other figure there:

     1. the PAGE   the hero's "Converted total" line, harvested from the DOM
     2. the SEAM   ctx.fxConvert over the live book, as the hero calls it
     3. an ORACLE  fxOracle(): the rate table read out of the file as text and
                   the conversion written out by hand, with nothing from
                   src/fx.js or fx-live.js behind it

   plus the figures printed AROUND the total, which is where "derived by
   different rules" would show: the converted line is the headline plus what
   each holding converts to; the sentence names each holding in its own
   currency and says how old the rates are; the account that cannot be
   converted is named beside the total and is in neither figure.

   WHAT THIS SUITE ADDS TO THAT

   A gate that has only ever been shown passing has not been shown to check
   anything, so each new check is handed a tampered reading and must fail; the
   oracle is shown to disagree with the app's rule exactly where a wrong rule
   would (typed balances instead of live ones; the sum converted once instead
   of each balance to the cent); and the network is counted, not trusted —
   src/fx-fetch.js swallows a failed request by design, so a fixture that
   quietly tried the provider on every run would otherwise look identical to
   one that never does.

     node tests/reconcile-gate-fx.test.cjs
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* Counted from before the first mount to the last assertion. harness.cjs's
   requestUrl stub hands every call to this when it is set. */
let networkCalls = 0;
global.__requestUrl = () => { networkCalls++; throw new Error('the reconciliation gate must not reach the network'); };

const { reconcile, householdVault, runChecks, fxOracle } = require('../scripts/reconcile-page.cjs');
const HX = require('./figures/household-fx.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Empty on purpose, all three, as in the first gate: the mixed-currency
   household was run for the first time on 2026-11-12 and every check agreed. */
const KNOWN_FAILURES = [];
const CANNOT_BE_MADE = [];
const EXPLAINED_DIFFERENCES = [];
const MIN_PASSING = 160;

/* The checks that exist only because rates are on. Named, so that a rename or
   a silently skipped branch in the script is a failure here and not a quieter
   gate. */
const FX_CHECKS = [
  'Oracle: conversion runs exactly when fxConvert does',
  'Hero: converted total',
  'Oracle converted total = fxConvert total',
  "Oracle: the home part of the converted total = the headline's live home total",
  'Converted total = headline + Σ converted holdings (as printed)',
  "Oracle converted holdings = fxConvert's, currency by currency",
  'Converted sentence names each holding in its own currency',
  'Stale rates: the sentence says how many days old',
  'Unconvertible holdings are named beside the total, in their own currency',
  "Oracle unconvertible accounts = fxConvert's",
  'Oracle rate age (days) = fxConvert age',
  'Oracle staleness = fxConvert stale',
];

const clone = v => JSON.parse(JSON.stringify(v));

(async () => {
  const t0 = Date.now();
  const { G, pages, checks: result, period, today } = await reconcile({
    files: { ...HX.SEED }, budgetFolder: HX.B, today: HX.TODAY, period: HX.PERIOD,
  });

  ok(pages.length >= 16, `all sixteen views were harvested (got ${pages.length})`);
  eq(pages.filter(p => p.error).map(p => `${p.view}: ${p.error}`), [], 'no page threw while rendering with exchange rates on');
  const figures = pages.reduce((t, p) => t + p.figures.length, 0);
  ok(figures > 500, `the harvest actually read figures off the pages (got ${figures})`);
  eq(period, HX.PERIOD, 'the fixture period is the one the household declares');
  eq(today, HX.TODAY, 'and the clock is the pinned one, not the wall clock');

  const idsOf = (list, status) => list.filter(c => c.status === status).map(c => `${c.page} :: ${c.name}`).sort();

  /* ---- the ratchet ------------------------------------------------------- */
  eq(idsOf(result, 'fail').filter(f => !KNOWN_FAILURES.includes(f)), [],
    'a figure disagrees with the total it is checked against on the mixed-currency household. '
    + 'Run `npm run reconcile -- --household fx` and read the page it writes. Do NOT pin it: '
    + 'report the three readings.');
  eq(idsOf(result, 'unverified').filter(f => !CANNOT_BE_MADE.includes(f)), [],
    'a check went QUIET with exchange rates on — a selector that stopped matching, or a '
    + 'figure this household cannot exercise. Find out which.');
  eq(idsOf(result, 'info').filter(f => !EXPLAINED_DIFFERENCES.includes(f)), [],
    'a new difference attributable to a documented gap — decide whether the page discloses it.');
  const passing = idsOf(result, 'pass').length;
  ok(passing >= MIN_PASSING, `the mixed-currency household makes at least ${MIN_PASSING} passing checks (got ${passing})`);

  /* ---- the conversion was really on, and really read --------------------- */
  ok(G.fx && G.fx.seam && G.fx.oracle, 'both readings of the conversion exist: fxConvert answered, and so did the oracle');
  for (const name of FX_CHECKS) {
    const c = result.find(x => x.page === 'accounts' && x.name === name);
    ok(c && c.status === 'pass', `the check "${name}" was made and agrees (${c ? c.status : 'not made'})`);
  }
  /* The fixture's own arithmetic, done in the head (see its header): the
     figures are pinned so that a gate in which all three readings moved
     TOGETHER — a rate file read wrong by app and oracle alike — still fails. */
  eq(G.fx.seam.total, 58900, 'converted total: R 28 900 home + $ 1 000 × 20 + € 400 × 25');
  eq(G.fx.oracle.total, 58900, 'and the oracle reads the same R 58 900 out of the rate file on its own');
  eq(G.fx.oracle.home, 28900, 'the home part is the live rand balances');
  eq(G.fx.oracle.converted.map(c => [c.code, c.amount, c.inHome]).sort(), [['EUR', 400, 10000], ['USD', 1000, 20000]],
    'the euro account converts at its LIVE balance (€ 400), not the € 500 typed on its balance line');
  eq(G.fx.oracle.unconvertible.map(u => [u.name, u.symbol, u.amount]), [['Yen wallet', '¥', 10000]],
    'the yen account has no currency code: named, and in neither total');
  eq([G.fx.oracle.date, G.fx.oracle.age, G.fx.oracle.stale], [HX.RATES_DATE, 10, true],
    'the table is ten days old on the pinned clock, which is stale');
  const hero = pages.find(p => p.view === 'accounts').figures.find(f => /acct-hero-converted/.test(f.address));
  ok(hero && hero.raw === 58900 && hero.text === 'R 58 900,00', `the page prints it: "${hero && hero.text}"`);

  /* ---- no other page converts --------------------------------------------
     ADR-0004: everywhere but that one line, the rule is "sum the household's
     currency and name the rest", with rates on as much as off (ISSUE 31 moved
     the converted figure OFF the hero's headline for exactly this). So the
     converted total and the two converted holdings appear on the Accounts
     page's converted line and nowhere else in the app. */
  {
    const leaked = [];
    for (const p of pages) {
      for (const f of p.figures) {
        if (f.kind !== 'money' || f.raw == null) continue;
        if (p.view === 'accounts' && /acct-hero-converted/.test(f.address)) continue;
        if ([58900, 20000, 10000].includes(f.raw) && /^R\s/.test(f.text)) leaked.push(`${p.view}: ${f.text} at ${f.address}`);
      }
    }
    /* R 20 000 and R 10 000 are also round rand figures this household prints
       for its own reasons (the Cheque account's typed balance; the plan's
       pot), so only figures the first household does NOT print count. */
    const base = householdVault();
    const { pages: basePages } = await reconcile({ files: base.files, budgetFolder: base.budgetFolder, today: base.today, period: base.period });
    const inBase = new Set(basePages.flatMap(p => p.figures.filter(f => f.kind === 'money').map(f => `${p.view}: ${f.text} at ${f.address}`)));
    eq(leaked.filter(l => !inBase.has(l)), [],
      'a converted amount is printed somewhere other than the Accounts hero\'s converted line — a page has started summing across currencies');
  }

  /* ---- each new check fails when its reading is wrong --------------------- */
  const failsWith = (label, mutate, expected) => {
    const G2 = clone(G), pages2 = clone(pages);
    mutate(G2, pages2);
    const failed = idsOf(runChecks(G2, pages2), 'fail').map(f => f.replace(/^accounts :: /, ''));
    for (const name of expected) ok(failed.includes(name), `${label}: "${name}" fails (failed: ${failed.join(' | ') || 'nothing'})`);
  };
  const acct = ps => ps.find(p => p.view === 'accounts');
  const heroSubMoney = (ps, text) => acct(ps).figures.find(f => /div\.hero-sub/.test(f.address) && f.text === text);

  failsWith('the page prints a converted total one rand out',
    (g, ps) => { acct(ps).figures.find(f => /acct-hero-converted/.test(f.address)).raw = 58901; },
    ['Hero: converted total', 'Converted total = headline + Σ converted holdings (as printed)']);
  failsWith('fxConvert returns a total one rand out',
    g => { g.fx.seam.total = 58901; },
    ['Hero: converted total', 'Oracle converted total = fxConvert total']);
  failsWith('fxConvert converts the euro at its TYPED balance',
    g => { const eur = g.fx.seam.converted.find(c => c.code === 'EUR'); eur.amount = 500; eur.inHome = 12500; },
    ["Oracle converted holdings = fxConvert's, currency by currency"]);
  failsWith('the home part is not what the headline sums',
    g => { g.fx.oracle.home = 28000; },
    ["Oracle: the home part of the converted total = the headline's live home total"]);
  failsWith('the sentence drops a holding',
    (g, ps) => { const f = heroSubMoney(ps, 'R 400'); f.text = 'R 0'; f.raw = 0; },
    ['Converted sentence names each holding in its own currency']);
  failsWith('the sentence does not say how old the rates are',
    (g, ps) => { acct(ps).figures.find(f => /div\.hero-sub/.test(f.address) && /, 10$/.test(f.text)).text = '23'; },
    ['Stale rates: the sentence says how many days old']);
  failsWith('the unconvertible account is not named',
    (g, ps) => { const p = acct(ps); p.figures = p.figures.filter(f => !(/div\.hero-sub/.test(f.address) && f.text === '¥ 10 000')); },
    ['Unconvertible holdings are named beside the total, in their own currency']);
  failsWith('fxConvert counts the yen account',
    g => { g.fx.seam.unconvertible = []; },
    ["Oracle unconvertible accounts = fxConvert's"]);
  failsWith('fxConvert reads the table a day younger',
    g => { g.fx.seam.age = 9; },
    ['Oracle rate age (days) = fxConvert age']);
  failsWith('fxConvert calls a ten-day-old table fresh',
    g => { g.fx.seam.stale = false; },
    ['Oracle staleness = fxConvert stale']);
  failsWith('the app converts and the oracle says it should not',
    g => { g.fx.oracle = null; },
    ['Oracle: conversion runs exactly when fxConvert does']);

  /* With rates OFF the page must print no converted line, and that absence is
     a check on every household — including the two that have always been in
     a gate. Shown failing on the first household with a line planted. */
  {
    const base = householdVault();
    const B = await reconcile({ files: base.files, budgetFolder: base.budgetFolder, today: base.today, period: base.period });
    eq([B.G.fx.seam, B.G.fx.oracle], [null, null], 'the first household has rates off: neither reading converts');
    const off = B.checks.find(c => c.name === 'Hero: no converted total while exchange rates are off');
    ok(off && off.status === 'pass', 'and the absence of a converted line there is a passing check');
    const pages2 = clone(B.pages);
    pages2.find(p => p.view === 'accounts').figures.push({ view: 'accounts', kind: 'money', text: 'R 1,00', raw: 1, ambiguous: false,
      address: 'acctSummary/div.card[0]/div.acct-hero-converted[2]', context: { own: 'Converted total R 1,00', parent: '' } });
    ok(idsOf(runChecks(clone(B.G), pages2), 'fail').includes('accounts :: Hero: no converted total while exchange rates are off'),
      'a converted line drawn while rates are off fails it');
  }

  /* ---- the oracle is independent, and its rule is the app's --------------- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reconcile-page.cjs'), 'utf8');
    const from = src.indexOf('---- the fx oracle');
    const to = src.indexOf('/* ---- the global totals', from);
    ok(from !== -1 && to > from, 'the fx oracle section was located, so the assertions below look at something');
    const oracleSrc = src.slice(src.indexOf('*/', from), to);
    for (const forbidden of ['require(', 'ctx.', 'fxConvert', 'convertAccounts', 'rateBetween', 'isForeign', 'symbolOf']) {
      eq(oracleSrc.includes(forbidden), false,
        `the fx oracle stays spelled without ${forbidden} — a third reading that calls the app's own conversion cannot catch a bug inside it`);
    }

    /* Where the candidate rules actually differ. Two dollar accounts of 33
       cents at R 18,8679… to the dollar: each converts to R 6,23 on its own
       (R 12,46), while 66 cents converted once is R 12,45. fx.js converts each
       balance to the cent; the oracle restates that rule and must land on the
       same side — and must be able to tell the two apart, or agreeing on round
       fixtures proves nothing. */
    const fx = require('../src/fx');
    const settings = { currency: 'R', currency_code: 'ZAR', exchange_rates: true };
    const ratesText = '---\nbase: "ZAR"\ndate: "2026-09-01"\n---\n\n| Currency | Rate |\n|---|---:|\n| USD | 0.053 |\n| ZAR | 1 |\n';
    const accounts = [
      { name: 'A', currency: '$', currency_code: 'USD', balance: 0.33 },
      { name: 'B', currency: '$', currency_code: 'USD', balance: 0.33 },
      { name: 'Home', balance: 100 },
      { name: 'No code', currency: '£', balance: 5 },
      { name: 'No rate', currency: 'kr', currency_code: 'SEK', balance: 7 },
    ];
    const O = fxOracle({ accounts, settings, ratesText, today: '2026-09-02' });
    const table = fx.normalizeTable({ base: 'ZAR', date: '2026-09-01', rates: { USD: 0.053 } });
    const A = fx.convertAccounts(accounts, { code: 'ZAR', symbol: 'R' }, table, '2026-09-02');
    eq(O.total, 112.46, 'each balance to the cent: 100 + 6,23 + 6,23');
    ok(Math.round(0.66 / 0.053 * 100) / 100 === 12.45, 'whereas the sum converted once would be 12,45 — the two rules differ here by a cent');
    eq([O.total, O.home, O.converted, O.age, O.stale], [A.total, A.home, A.converted, A.age, A.stale], 'the oracle and fx.js agree where the rules part');
    eq(O.unconvertible.map(u => u.name), A.unconvertible.map(u => u.account.name), 'and on which accounts are left out: no code, and a code the table does not quote');

    /* The basis. Handed the TYPED balances, the oracle is out by exactly the
       euro account's unconfirmed row — € 100 at R 25 — so a hero that
       converted stated balances could not agree with it. */
    const typed = fxOracle({
      accounts: [{ name: 'Cheque', balance: 14400 }, { name: 'Emergency fund', balance: 14500 },
        { name: 'Dollar savings', currency: '$', currency_code: 'USD', balance: 1000 },
        { name: 'Euro travel', currency: '€', currency_code: 'EUR', balance: 500 },
        { name: 'Yen wallet', currency: '¥', balance: 10000 }],
      settings: G.settings, ratesText: HX.SEED[`${HX.B}/Exchange Rates.md`], today: HX.TODAY,
    });
    eq(typed.total - G.fx.oracle.total, 2500, 'converting the typed euro balance instead of the live one moves the total by R 2 500');

    /* And it refuses on its own account, not because fxConvert did. */
    eq(fxOracle({ accounts, settings: { ...settings, exchange_rates: false }, ratesText, today: '2026-09-02' }), null, 'rates off: no conversion');
    eq(fxOracle({ accounts, settings: { ...settings, currency_code: '' }, ratesText, today: '2026-09-02' }), null, 'no household code: no conversion');
    eq(fxOracle({ accounts, settings, ratesText: '', today: '2026-09-02' }), null, 'no rate file: no conversion');
    eq(fxOracle({ accounts, settings: { ...settings, currency_code: 'GBP' }, ratesText, today: '2026-09-02' }), null,
      'a table that does not quote the household\'s own currency: no conversion');
  }

  /* ---- and none of it touched the network -------------------------------- */
  eq(networkCalls, 0,
    'requestUrl was called. The fixture\'s rate table is dated ten days before its pinned clock at a monthly '
    + 'cadence, so no refresh is due; if this fails, the fixture or fx.refreshDue moved and every run of this '
    + 'gate is now trying a live exchange-rate provider.');
  delete global.__requestUrl;

  console.log(`PASS — reconciliation gate with exchange rates on: ${figures} figures, ${result.length} checks, `
    + `${passing} agree, 0 disagree, ${FX_CHECKS.length} of them on the converted total, 0 network calls `
    + `(${Date.now() - t0}ms, ${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
