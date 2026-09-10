'use strict';
/* The reconciliation page: every page's figures beside ONE set of global totals.

     node scripts/reconcile-page.cjs --vault "<abs path to the budget folder>"
     node scripts/reconcile-page.cjs --obsidian-vault "<abs path to the vault root>"
     options: --today YYYY-MM-DD   --period YYYY-MM   --out <file.html>

   Why this exists. The recurring bug shape in this repo is "two figures
   derived by different rules" — nine occurrences by commit message, and the
   numbers ledger (scripts/figures.cjs) was built to LIST what each page
   prints. Listing is not judging. This script does the judging, on a real
   household, by putting three readings of the same money side by side:

     1. what each page RENDERED — the DOM harvest, exactly what the reader sees
     2. what the SEAMS hand back — periodSummary, budgetUsed, periodFigures,
        worth, healthSnapshot, the four lenses of ledger.js
     3. an INDEPENDENT ORACLE — this file's own loop over the raw rows, spelled
        without ledger.js, so a bug inside the ledger cannot agree with itself

   and writing one HTML page that says where the three agree, where they
   differ, and — where they differ — which documented gap (drift, set-aside,
   assumed spend, netted refunds, uncategorised spend, money funded from
   savings) accounts for the difference.

   Output is written to tests/figures/live/ by default. That folder is
   gitignored on purpose: the page embeds a real household's balances and
   rows, and this repo is public. Never commit the output; the script itself
   holds no data and is safe. */

const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('../tests/helpers/harness.cjs');
stubObsidian();
const { dispatchedViews, pinClock, mountFor, harvestView, leaves, ownText } = require('../tests/helpers/figures.cjs');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(`--${n}`); return i < 0 ? null : (argv[i + 1] || true); };

/* ---- reading a real vault ---------------------------------------------- */
function readVault(root) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith('.md')) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root, '');
  return out;
}

/* --household: the committed synthetic household instead of a real vault.

   This script was written for a real household and could only ever run on one,
   which is why it was in no gate — the vault it needs cannot be committed to a
   public repo. tests/figures/household.cjs is already a full vault in exactly
   the shape readVault() returns ({ 'Budget/Settings.md': text, … }), built to
   light up all sixteen views, so the reconciliation can run over it with no
   private data anywhere near it.

   It is not the same subject. The real vault is broader; this fixture is
   deliberately NARROW and deliberately exotic — one of each row shape the
   ADR-0005/0006 refactor settled (set-aside, assume-spent, a split, an
   earmarked outflow), which is more of that per row than a real household
   carries. Expect it to reconcile differently, and read tests/reconcile-gate
   for what is currently unexplained. */
function householdVault() {
  const { SEED, B, TODAY, PERIOD } = require('../tests/figures/household.cjs');
  return { files: { ...SEED }, budgetFolder: B, today: TODAY, period: PERIOD };
}

function resolveBudgetFolder() {
  const v = flag('vault');
  if (v && v !== true) return path.resolve(String(v));
  const ov = flag('obsidian-vault');
  if (ov && ov !== true) {
    const root = path.resolve(String(ov));
    const dataJson = path.join(root, '.obsidian', 'plugins', 'budget-app', 'data.json');
    if (!fs.existsSync(dataJson)) { console.error(`No plugin settings at ${dataJson}`); process.exit(1); }
    const settings = JSON.parse(fs.readFileSync(dataJson, 'utf8'));
    if (!settings.budgetFolder) { console.error('data.json names no budgetFolder'); process.exit(1); }
    return path.join(root, settings.budgetFolder);
  }
  console.error('Usage: node scripts/reconcile-page.cjs --household | --vault "<budget folder>" | --obsidian-vault "<vault root>" [--today YYYY-MM-DD] [--period YYYY-MM] [--out file.html]');
  process.exit(1);
}

/* The run itself, with no argv, no filesystem and no HTML — so a guard test can
   call it. main() below is this plus the page and the console summary.

   `files` is the vault as { path: text }; everything else is optional. Returns
   the three readings the page compares (rendered / seams / oracle) and the
   checks over them. */
async function reconcile({ files, budgetFolder, today, period: wantPeriod }) {
  const unpin = pinClock(today);
  try {
    const M = await mountFor(files, { budgetFolder });
    const period = String(wantPeriod || M.ctx.currentPeriod());
    M.S.period = period;
    const G = globals(M.ctx, M.S, period, today);
    M.restore();
    const pages = await harvestPages(files, { period, budgetFolder });
    return { G, pages, checks: runChecks(G, pages), matrix: presenceMatrix(G, pages), period, today };
  } finally { unpin(); }
}

const pad = n => String(n).padStart(2, '0');
function localToday() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/* ---- numbers -------------------------------------------------------------- */
const CENT = 0.006;
const cents = v => Math.round(v * 100);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const near = (a, b, tol = CENT) => isNum(a) && isNum(b) && Math.abs(a - b) <= tol;
/* The za locale prints "R 42 975,46" and "100,2%". Strip to digits, sign and
   separators; a comma is the decimal mark when present. */
function parseNum(text) {
  let s = String(text).replace(/[^\d,.\-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
const figValue = f => (f ? (f.raw != null ? f.raw : parseNum(f.text)) : null);
/* A figure printed with two decimals is exact to the cent; one printed
   rounded to the rand can only be checked to half a rand. A percent printed
   with one decimal is exact to 0.05. */
function figTol(f) {
  if (!f) return CENT;
  if (f.raw != null) return CENT;
  if (f.kind === 'percent') return /[,.]\d$/.test(f.text.replace('%', '').trim()) ? 0.06 : 0.51;
  return /[,.]\d{2}$/.test(f.text) ? CENT : 0.51;
}
function primitives(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}
const sortedPairs = m => Object.entries(m || {}).map(([k, v]) => ({ key: k, value: v })).sort((a, b) => a.value - b.value);

/* ---- the global totals ------------------------------------------------ */
function globals(ctx, S, period, today) {
  const { worth } = require('../src/worth');
  const { isForeign, symbolOf } = require('../src/currency');
  const { accountType, isPoolAccount } = require('../src/vocabulary');
  const { splitRole, SPLIT_PARENT, SPLIT_PART } = require('../src/tx-role');
  const { outstandingOf, isSettled } = require('../src/owed-math');
  const { activeDebts } = require('../src/worth');
  const cur = S.settings.currency;

  const { start, end } = ctx.periodRange(period);
  const summary = ctx.periodSummary(period);
  const asOf = summary.asOf || today;
  const running = period === ctx.currentPeriod() && today >= start && today < end;
  const budget = ctx.budgetTotals(period);
  const used = ctx.budgetUsed(period);
  const fig = ctx.periodFigures(period);
  const spend = ctx.periodSpend(period, null);
  const income = ctx.monthlyIncome(period);
  const deficit = ctx.periodDeficit(period);
  const moved = ctx.movedToFunds(period);

  /* Lens tallies over the window the hero reads (start..asOf) and the whole
     period, every lens, from the same stamped rows. */
  const LENSES = ctx.LENSES;
  const stampedSoFar = ctx.ledger(start, asOf);
  const stampedWhole = ctx.ledger(start, end);
  const tallyOf = (stamped, lens) => {
    const t = ctx.tally(stamped, lens);
    const spendByCatTotal = Object.values(t.spendByCat).reduce((a, b) => a + b, 0);
    return {
      lens: t.lens, count: t.count, kept: t.kept.length,
      income: t.income, spend: t.spend, net: t.net, setAside: t.setAside,
      inflow: t.inflow, outflow: t.outflow,
      uncategorised: t.uncategorised, uncatSpend: t.uncatSpend, uncatIncome: t.uncatIncome,
      unknownCount: t.unknown.count, unknownSpend: t.unknown.spend, unknownIncome: t.unknown.income, unknownNames: t.unknown.names,
      foreignCount: t.foreign.count, foreignLabels: t.foreign.labels,
      fundedFromSavings: t.fundedFromSavings.spend, fundedCount: t.fundedFromSavings.count,
      consumption: t.consumption, fixed: t.fixed, netIncome: t.netIncome,
      spendByCatTotal, byCatTotal: Object.values(t.byCat).reduce((a, b) => a + b, 0),
      byCat: sortedPairs(t.byCat), spendByCat: sortedPairs(t.spendByCat),
    };
  };
  const lensNames = Object.keys(LENSES);
  const lenses = {
    soFar: Object.fromEntries(lensNames.map(n => [n, tallyOf(stampedSoFar, LENSES[n])])),
    whole: Object.fromEntries(lensNames.map(n => [n, tallyOf(stampedWhole, LENSES[n])])),
  };

  /* ---- the independent oracle: this file's own loop, no ledger.js -------- */
  const nonBudget = ctx.nonBudgetLabels();
  const foreign = ctx.foreignLabels();
  const earmarked = ctx.earmarkedLabels();
  const rawRows = (from, to) => {
    const out = [];
    for (const f of Object.values(S.txFiles)) {
      for (const r of f.rows) if (r.date >= from && r.date <= to) out.push({ ...r, label: f.label });
    }
    return out;
  };
  const oracleBudget = rows => {
    const o = { count: 0, income: 0, spend: 0, net: 0, setAside: 0 };
    for (const r of rows) {
      const amount = Number(r.amount) || 0;
      if (r.excluded) continue;
      if (nonBudget.has(r.label)) continue;
      if (foreign.has(r.label)) continue;
      if (amount < 0 && earmarked.has(r.label)) continue;
      const type = ctx.catType(r.cat);
      o.count++;
      if (type === 'transfer') continue;
      o.net += amount;
      if (type === 'income') o.income += amount;
      else if (amount < 0) { o.spend += -amount; if (['savings', 'investment'].includes(String(type || '').toLowerCase())) o.setAside += -amount; }
    }
    return o;
  };
  const allOf = rows => {
    const o = { rows: rows.length, sum: 0, inflow: 0, outflow: 0, excluded: 0, splitParents: 0, splitParts: 0, sumNoParents: 0 };
    for (const r of rows) {
      const amount = Number(r.amount) || 0;
      const role = splitRole(r.split);
      o.sum += amount;
      if (amount > 0) o.inflow += amount; else o.outflow += amount;
      if (r.excluded) o.excluded++;
      if (role === SPLIT_PARENT) o.splitParents++; else o.sumNoParents += amount;
      if (role === SPLIT_PART) o.splitParts++;
    }
    return o;
  };
  const rowsSoFar = rawRows(start, asOf), rowsWhole = rawRows(start, end);
  const oracle = {
    soFar: { budget: oracleBudget(rowsSoFar), all: allOf(rowsSoFar) },
    whole: { budget: oracleBudget(rowsWhole), all: allOf(rowsWhole) },
  };

  /* The rows BUDGET and HOUSEHOLD disagree about, by name. */
  const stampNames = ['excluded', 'nonBudget', 'foreign', 'earmarkedOut', 'transfer', 'passthrough', 'splitParent', 'splitPart', 'setAside'];
  const rowOut = s => ({ date: s.date, label: s.label, desc: s.row.desc || '', cat: s.cat, type: s.type, amount: s.amount, stamps: stampNames.filter(k => s[k]) });
  const diff = ctx.lensDifference ? ctx.lensDifference(stampedSoFar, LENSES.BUDGET, LENSES.HOUSEHOLD) : null;
  const lensDiff = diff ? { BUDGET: diff.BUDGET.map(rowOut), HOUSEHOLD: diff.HOUSEHOLD.map(rowOut) } : null;
  const droppedByBudget = stampedSoFar.filter(s => !ctx.keeps || !ctx.keeps(LENSES.BUDGET, s)).map(rowOut);

  /* ---- balances: stated, implied, and the naive sum of each ---------------- */
  const readable = a => a.balanceRaw == null;
  const home = a => !isForeign(a, cur);
  const stated = S.accounts.filter(readable);
  const implied = ctx.impliedAccounts();
  const impliedHome = implied.filter(home);
  const statedHome = stated.filter(home);
  const W = worth(impliedHome, S.debts, S.assets, cur, S.owed);
  const Wstated = worth(statedHome, null, null);
  const sumPos = list => list.reduce((t, a) => t + Math.max(0, a.balance || 0), 0);
  const sumNeg = list => -list.reduce((t, a) => t + Math.min(0, a.balance || 0), 0);
  const naiveAssets = (S.assets || []).filter(x => !isForeign(x, cur)).reduce((t, x) => t + Math.max(0, Number(x.value) || 0), 0);
  const naiveOwed = (S.owed || []).filter(o => o && !isSettled(o) && !isForeign(o, cur)).reduce((t, o) => t + Math.max(0, Number(outstandingOf(o)) || 0), 0);
  const naiveDebts = activeDebts(S.debts).filter(d => !isForeign(d, cur)).reduce((t, d) => t + Math.max(0, d.balance || 0), 0);
  const naive = {
    impliedPositive: sumPos(impliedHome), impliedNegative: sumNeg(impliedHome),
    statedPositive: sumPos(statedHome), statedNegative: sumNeg(statedHome),
    assets: naiveAssets, owed: naiveOwed, debts: naiveDebts,
  };
  naive.net = Math.round((naive.impliedPositive + naive.assets + naive.owed - naive.impliedNegative - naive.debts) * 100) / 100;

  const byType = list => {
    const m = {};
    for (const a of list) { const t = accountType(a) || 'other'; m[t] = (m[t] || 0) + (a.balance || 0); }
    return m;
  };
  /* Bucketed over EVERY account but valued in home currency only, because that
     is what the page does: netByOwner() opens a bucket for each owner it finds
     and prints its home-currency net, so an owner holding nothing but a foreign
     account gets a row reading R 0,00 with the foreign amount named beside it.
     Bucketing over home accounts alone dropped that row from the seam and made
     a correct page look one row long.

     A blank owner keys on '' — src/owners.js labels it Unassigned. NOT 'joint':
     that is a reserved value a household can declare, and folding the two
     together would hide a real owner behind an absent one. */
  const byOwner = (list, valued) => {
    const m = {};
    const inHome = new Set((valued || list).map(a => a.file || a.name));
    for (const a of list) {
      const o = String(a.owner || '').trim().toLowerCase();
      m[o] = (m[o] || 0) + (inHome.has(a.file || a.name) ? (a.balance || 0) : 0);
    }
    return m;
  };

  const book = ctx.bookFigures();
  const idx = ctx.accountIndex();
  const impliedByName = new Map(implied.map(a => [a.name, a]));
  const accounts = S.accounts.map(a => {
    const rec = book.reconciled.get(a) || {};
    const labels = new Set((idx.get(a) || {}).labels || []);
    const mine = stampedWhole.filter(s => labels.has(s.label));
    const done = ctx.tally(mine.filter(s => s.date <= asOf), LENSES.ACCOUNT);
    const ahead = ctx.tally(mine.filter(s => s.date > asOf), LENSES.ACCOUNT);
    const im = impliedByName.get(a.name);
    return {
      name: a.name, type: accountType(a) || a.type || '', owner: a.owner || '', symbol: symbolOf(a, cur),
      foreign: !home(a), inBudget: a.in_budget !== false, pool: isPoolAccount(a), earmarked: [...earmarked].some(L => labels.has(L)),
      stated: a.balance, statedRaw: a.balanceRaw, balanceDate: a.balance_date || a.balanceDate || a.as_of || null,
      implied: im ? im.balance : null,
      rec: primitives(rec),
      labels: [...labels],
      activity: { inAmt: done.inflow, outAmt: -done.outflow, net: done.net, count: done.count,
        aheadIn: ahead.inflow, aheadOut: -ahead.outflow, aheadCount: ahead.count },
    };
  });
  const driftSum = accounts.filter(a => !a.foreign && a.rec.state === 'drift').reduce((t, a) => t + (a.rec.delta || 0), 0);

  const health = ctx.healthSnapshot();
  const debtsActive = activeDebts(S.debts);

  return {
    meta: { period, start, end, asOf, today, running, currency: cur,
      periodTitle: ctx.periodTitle ? ctx.periodTitle(period) : period },
    settings: primitives(S.settings),
    census: {
      accounts: S.accounts.length, categories: S.categories.length,
      txFiles: Object.keys(S.txFiles).length,
      txRows: Object.values(S.txFiles).reduce((t, f) => t + f.rows.length, 0),
      budgets: Object.keys(S.budgets).length, assets: (S.assets || []).length, owed: (S.owed || []).length,
      services: (S.services || []).length, debts: (S.debts || []).length, rules: (S.rules || []).length,
    },
    summary: { ...primitives(summary), scheduled: summary.scheduled, foreign: summary.foreign, unknown: summary.unknown,
      fundedFromSavings: summary.fundedFromSavings, byCat: sortedPairs(summary.byCat) },
    budget, used, deficit, moved, income,
    figures: {
      rows: fig.rows, split: fig.split, gap: fig.gap, scheduled: fig.scheduled, fundedFromSavings: fig.fundedFromSavings,
      uncountedIncome: fig.uncountedIncome,
      trend: { whole: sortedPairs(spend.whole), wholeTotal: Object.values(spend.whole).reduce((a, b) => a + b, 0), count: spend.count },
      planTotal: budget.spend + budget.setAside,
      allocated: budget.income > 0 ? (budget.spend + budget.setAside) / budget.income : null,
      /* periodFigures' OWN plan snapshot, carried through rather than
         re-derived. ADR-0007 registers `unallocated` as income − total; this
         script had spelled it total − income by hand a few lines away and so
         disagreed with the page by exactly twice itself. An instrument built
         to catch "two figures derived by different rules" is the last place
         that rule should be spelled twice. */
      plan: fig.plan,
    },
    lenses, oracle, lensDiff, droppedByBudget,
    worth: { implied: primitives(W), stated: primitives(Wstated), naive, driftSum,
      otherCurrencies: W.otherCurrencies,
      byTypeStated: byType(statedHome), byTypeImplied: byType(impliedHome), byOwnerStated: byOwner(stated, statedHome) },
    book: { drift: book.drift, stale: primitives(book.stale), overdrawn: book.overdrawn,
      unplaced: [...book.unplacedBy.entries()], confirmDay: [...book.confirmDayBy.entries()].map(([k, v]) => [k, v]) },
    accounts,
    health: { metrics: primitives(health.metrics), breakdown: health.breakdown, target: health.target,
      debtInterest: health.debtInterest, earmarks: primitives(health.earmarks), empty: health.empty, debtsRecorded: health.debtsRecorded },
    assets: (S.assets || []).map(x => ({ name: x.name, type: x.type, value: x.value, valued: x.valued || x.valued_on || null, foreign: isForeign(x, cur) })),
    owed: (S.owed || []).map(o => ({ who: o.who || o.name || '', amount: o.amount, outstanding: outstandingOf(o), settled: isSettled(o), direction: o.direction || o.type || '' })),
    owedTotals: { outstanding: naiveOwed, lent: (S.owed || []).reduce((t, o) => t + (Number(o.amount) || 0), 0) },
    debts: { active: debtsActive.length, total: naiveDebts, rows: debtsActive.map(d => ({ name: d.name, balance: d.balance, rate: d.rate, payment: d.payment })) },
    services: (S.services || []).map(s => primitives(s)),
  };
}

/* ---- the DOM harvest, with the words around each number ----------------- */
async function harvestPages(files, { period, budgetFolder }) {
  const out = [];
  for (const v of dispatchedViews()) {
    const m = await mountFor(files, { period, budgetFolder });
    const r = harvestView(m.ctx, m.nodes, m.raws, v);
    /* Address → the leaf's own text and its parent's, so a row in the page
       reads "R 13 038 · 36%  (Food)" rather than a bare number. */
    const context = new Map();
    const { addressOf } = require('../tests/helpers/figures.cjs');
    for (const [sel, root] of m.nodes) {
      const rootId = sel.replace(/^#/, '');
      for (const leaf of leaves(root)) {
        const p = leaf._parent;
        const parentText = p ? String(p.textContent || '').replace(/\s+/g, ' ').trim() : '';
        context.set(addressOf(leaf, rootId), { own: ownText(leaf).replace(/\s+/g, ' ').trim(), parent: parentText.slice(0, 140) });
      }
    }
    r.figures = r.figures.map(f => ({ ...f, context: context.get(f.address) || { own: '', parent: '' } }));
    m.restore();
    out.push(r);
  }
  return out;
}

/* ---- checks ---------------------------------------------------------- */
function makeChecker(G, pages) {
  const byView = Object.fromEntries(pages.map(p => [p.view, p]));
  const checks = [];
  const figs = (view, re, kind) => ((byView[view] || { figures: [] }).figures)
    .filter(f => re.test(f.address) && (!kind || f.kind === kind));
  const fig = (view, re, kind = 'money') => figs(view, re, kind)[0] || null;

  /* The documented gaps a difference may be made of. */
  const gaps = [
    ['reconcile drift (implied − stated balances)', G.worth.driftSum],
    ['set-aside spent this period', G.used.setAside],
    ['assume-spent provision', G.used.assumed],
    ['uncategorised spend', G.figures.gap.uncat],
    ['refunds netted inside categories', G.figures.gap.netted],
    ['spend funded from savings', G.figures.fundedFromSavings.spend],
    ['scheduled spend (rest of period)', G.figures.scheduled.spend],
    ['scheduled income (rest of period)', G.figures.scheduled.income],
    ['assets', G.worth.implied.ownedAssets],
    ['money owed to you', G.worth.implied.ownedOwed],
    ['active debts', G.worth.implied.fromDebts],
    ['budget set-aside envelopes', G.budget.setAside],
  ].filter(([, v]) => isNum(v) && Math.abs(v) >= 0.005);
  function explain(delta) {
    const d = Math.abs(delta);
    const out = [];
    for (const [n, v] of gaps) if (near(d, Math.abs(v), 0.011)) out.push(n);
    for (let i = 0; i < gaps.length; i++) for (let j = i + 1; j < gaps.length; j++) {
      if (near(d, Math.abs(gaps[i][1]) + Math.abs(gaps[j][1]), 0.011)) out.push(`${gaps[i][0]} + ${gaps[j][0]}`);
      if (near(d, Math.abs(Math.abs(gaps[i][1]) - Math.abs(gaps[j][1])), 0.011)) out.push(`${gaps[i][0]} − ${gaps[j][0]}`);
    }
    return out;
  }

  /* `expectDiff`: the two figures are derived by two DOCUMENTED rules (a
     stated balance against an implied one, a six-period average against one
     period) and are allowed to differ. Such a check reports `info` when they
     do and `pass` when they happen to agree — it is on the page so the reader
     can SEE the difference, not to count it as a defect. */
  function add({ page, name, formula, pageValue, pageSource, globalValue, globalSource, tol, kind = 'money', note = '', expectDiff = false }) {
    let status, delta = null, why = [];
    if (!isNum(pageValue)) status = 'unverified';
    else if (!isNum(globalValue)) status = 'unverified';
    else if (near(pageValue, globalValue, tol == null ? CENT : tol)) status = 'pass';
    else { status = expectDiff ? 'info' : 'fail'; delta = pageValue - globalValue; why = kind === 'money' ? explain(delta) : []; }
    checks.push({ page, name, formula, pageValue, pageSource, globalValue, globalSource, status, delta, why, kind, note });
  }
  /* A rendered figure against a global one. */
  function dom({ page, name, formula, re, globalValue, globalSource, kind = 'money', note, index = 0, expectDiff = false }) {
    const f = figs(page, re, kind)[index] || null;
    add({ page, name, formula, pageValue: figValue(f), pageSource: f ? `${f.address} = "${f.text}"` : `no ${kind} figure at /${re.source}/`,
      globalValue, globalSource, tol: figTol(f), kind, note, expectDiff });
  }
  /* A column of rendered figures against a list of seam values, as multisets
     in cents — the order a table draws its rows in is not the check.
     `allowExtraZero`: a table that draws EVERY category prints 0,00 for the
     ones the seam has no row for; those zeros are not a disagreement. */
  function column({ page, name, formula, re, seam, globalSource, note, decimals = 2, allowExtraZero = false }) {
    const fs_ = figs(page, re, 'money');
    const key = v => Math.round(v * Math.pow(10, decimals));
    const count = list => { const m = new Map(); for (const v of list) m.set(key(v), (m.get(key(v)) || 0) + 1); return m; };
    const pageVals = fs_.map(figValue).filter(isNum), seamVals = seam.filter(isNum);
    const a = count(pageVals), b = count(seamVals);
    const onlyPage = [], onlySeam = [];
    for (const [k, n] of a) { const d = n - (b.get(k) || 0); for (let i = 0; i < d; i++) if (!(allowExtraZero && k === 0)) onlyPage.push(k / Math.pow(10, decimals)); }
    for (const [k, n] of b) { const d = n - (a.get(k) || 0); for (let i = 0; i < d; i++) onlySeam.push(k / Math.pow(10, decimals)); }
    const status = !fs_.length ? 'unverified' : (!onlyPage.length && !onlySeam.length ? 'pass' : 'fail');
    checks.push({ page, name, formula, kind: 'column', status,
      pageValue: pageVals.length, globalValue: seamVals.length,
      pageSource: `${pageVals.length} figures at /${re.source}/`, globalSource,
      delta: status === 'fail' ? (onlyPage.length + onlySeam.length) : null,
      why: [], note: status === 'fail'
        ? `${note ? note + ' · ' : ''}only on page: [${onlyPage.slice(0, 12).join(', ')}]${onlyPage.length > 12 ? '…' : ''} · only in seam: [${onlySeam.slice(0, 12).join(', ')}]${onlySeam.length > 12 ? '…' : ''}`
        : (note || '') });
  }
  /* A seam-vs-seam or oracle identity, no DOM. */
  function identity({ page = 'global', name, formula, left, leftSource, right, rightSource, tol, kind = 'money', note }) {
    add({ page, name, formula, pageValue: left, pageSource: leftSource, globalValue: right, globalSource: rightSource, tol, kind, note });
  }
  return { checks, fig, figs, dom, column, identity, add, byView };
}

function runChecks(G, pages) {
  const C = makeChecker(G, pages);
  const { dom, column, identity } = C;
  const sf = G.lenses.soFar, or = G.oracle.soFar;
  const F = G.figures, S = G.summary, U = G.used, B = G.budget, W = G.worth;
  const splitTotal = F.split.reduce((t, r) => t + r.amount, 0);

  /* ---- global: the ledger against the oracle, and the seams against the lens */
  for (const k of ['income', 'spend', 'net']) {
    identity({ name: `Oracle ${k} = BUDGET lens ${k}`, formula: 'independent loop over raw rows (excluded, non-budget, foreign, earmarked outflow, transfer dropped) vs tally(ledger, BUDGET)',
      left: or.budget[k], leftSource: 'oracle (this script)', right: sf.BUDGET[k], rightSource: 'ledger.js tally BUDGET, start..asOf' });
  }
  identity({ name: 'Oracle row count = BUDGET lens count', formula: 'rows the lens kept before the transfer skip', kind: 'count',
    left: or.budget.count, leftSource: 'oracle', right: sf.BUDGET.count, rightSource: 'tally.count', tol: 0 });
  for (const k of ['income', 'spend', 'net', 'setAside', 'uncatSpend', 'count']) {
    identity({ name: `periodSummary.${k} = BUDGET lens ${k}`, formula: 'summaryInRange IS the BUDGET tally (ADR-0006 Phase 2)', kind: k === 'count' ? 'count' : 'money',
      left: S[k], leftSource: 'periodSummary(p)', right: sf.BUDGET[k], rightSource: 'tally BUDGET so far', tol: k === 'count' ? 0 : CENT });
  }
  for (const n of Object.keys(sf)) {
    identity({ name: `${n}: net = inflow + outflow`, formula: 'every kept rand lands in exactly one of the two signs',
      left: sf[n].net, leftSource: `${n}.net`, right: sf[n].inflow + sf[n].outflow, rightSource: `${n}.inflow + ${n}.outflow` });
    identity({ name: `${n}: Σ byCat = net`, formula: 'the per-category map conserves the total',
      left: sf[n].byCatTotal, leftSource: `Σ ${n}.byCat`, right: sf[n].net, rightSource: `${n}.net` });
  }
  identity({ name: 'BUDGET and TREND keep the same rows', formula: 'the two lenses differ by sign rule only (ADR-0006, closed 2026-09-03)', kind: 'count',
    left: sf.BUDGET.kept, leftSource: 'BUDGET.kept', right: sf.TREND.kept, rightSource: 'TREND.kept', tol: 0 });
  identity({ name: 'Σ split rows = Σ TREND spendByCat', formula: 'the donut and the comparison column are one net-per-category reading',
    left: splitTotal, leftSource: 'Σ periodFigures.split', right: sf.TREND.spendByCatTotal, rightSource: 'Σ tally(TREND).spendByCat' });
  identity({ name: 'Σ split rows = Σ periodSpend(p).whole', formula: 'identity 2 of tests/cross-page-consistency',
    left: splitTotal, leftSource: 'Σ periodFigures.split', right: F.trend.wholeTotal, rightSource: 'Σ periodSpend(p).whole' });
  identity({ name: 'Donut gap identity: split + uncat + netted = gross spend', formula: 'hero spend = donut total + uncategorised spend + refunds netted (identity 1)',
    left: splitTotal + F.gap.uncat + F.gap.netted, leftSource: 'Σ split + gap.uncat + gap.netted', right: S.spend, rightSource: 'periodSummary.spend' });
  identity({ name: 'budgetUsed.spent = max(0, spend − setAside) + assumed', formula: 'ADR-0005, the one rule',
    left: U.spent, leftSource: 'budgetUsed(p).spent', right: Math.max(0, S.spend - S.setAside) + Math.max(0, U.assumed), rightSource: 'restated from periodSummary + assumed' });
  identity({ name: 'budgetUsed.used = spent / budgeted', formula: 'ADR-0005', kind: 'ratio', tol: 1e-9,
    left: U.used, leftSource: 'budgetUsed(p).used', right: U.budgeted > 0 ? U.spent / U.budgeted : null, rightSource: 'spent / budgetTotals.spend' });
  identity({ name: 'periodDeficit = −net', formula: '0 − periodSummary.net',
    left: G.deficit, leftSource: 'periodDeficit(p)', right: 0 - S.net, rightSource: '0 − periodSummary.net' });
  identity({ name: 'Net worth (worth.js) = naive net worth', formula: 'Σ positive implied home balances + assets + owed − Σ negative balances − active home debts',
    left: W.implied.net, leftSource: 'worth(impliedAccounts…).net', right: W.naive.net, rightSource: 'naive sum (this script)' });
  identity({ name: 'Implied − stated account total = reconcile drift', formula: 'Σ(implied) − Σ(stated), home accounts vs Σ delta over accounts in state "drift"',
    left: (W.naive.impliedPositive - W.naive.impliedNegative) - (W.naive.statedPositive - W.naive.statedNegative), leftSource: 'implied net − stated net',
    right: W.driftSum, rightSource: 'Σ reconcile().delta where state = drift' });
  identity({ name: 'bookFigures.drift = Σ per-account drift', formula: 'one reconcile pass, read twice',
    left: G.book.drift.drift, leftSource: 'bookFigures().drift.drift', right: W.driftSum, rightSource: 'Σ accounts[].rec.delta (drift)' });

  /* ---- dashboard ---------------------------------------------------- */
  const D = 'dashboard';
  dom({ page: D, name: 'Hero: income', formula: 'periodSummary.income (BUDGET lens, income-typed rows, start..asOf)',
    re: /^heroCard\/.*stat-col.*\/div\.stat\[0\]\/.*div\.sv/, globalValue: S.income, globalSource: 'periodSummary.income' });
  dom({ page: D, name: 'Hero: whole plan (spend + set-aside envelopes)', formula: 'budgetTotals.spend + budgetTotals.setAside',
    re: /^heroCard\/.*stat-col.*\/div\.stat\[1\]\/.*div\.sv/, globalValue: F.planTotal, globalSource: 'budgetTotals(p)' });
  dom({ page: D, name: 'Hero: allocated of income', formula: 'plan / budgetTotals.income', kind: 'percent',
    re: /^heroCard\/.*stat-col.*\/div\.stat\[1\]\//, globalValue: F.allocated == null ? null : F.allocated * 100, globalSource: '(spend + setAside envelopes) / budget income × 100' });
  dom({ page: D, name: 'Hero: spent', formula: 'budgetUsed.spent = max(0, spend − setAside) + assumed',
    re: /^heroCard\/.*stat-col.*\/div\.stat\[2\]\/.*div\.sv/, globalValue: U.spent, globalSource: 'budgetUsed(p).spent' });
  dom({ page: D, name: 'Hero: budget used %', formula: 'budgetUsed.used × 100', kind: 'percent',
    re: /^heroCard\/.*stat-col.*\/div\.stat\[2\]\//, globalValue: U.used == null ? null : U.used * 100, globalSource: 'budgetUsed(p).used' });
  /* @hero-budget, not a sibling index: the greeting above this line renders
     only when Settings.md carries `household:`, so every index below it moved
     on a vault without one and these two read the set-aside note instead. */
  dom({ page: D, name: 'Hero sub: "spent X"', formula: 'dash.hero.sub {spent: used.spent}',
    re: /^heroCard\/@hero-budget$/, globalValue: U.spent, globalSource: 'budgetUsed(p).spent', index: 0 });
  dom({ page: D, name: 'Hero sub: "of budgeted Y"', formula: 'dash.hero.sub {budgeted: budgetTotals.spend}',
    re: /^heroCard\/@hero-budget$/, globalValue: B.spend, globalSource: 'budgetTotals(p).spend', index: 1 });
  dom({ page: D, name: 'Donut: total', formula: 'Σ categorySpendRows (named, non-income, non-transfer, net outflow)',
    re: /^dashSplit\/svg\.donut\/text\[1\]/, globalValue: splitTotal, globalSource: 'Σ periodFigures.split' });
  dom({ page: D, name: 'Donut note: total', formula: 'the note under the donut restates the total',
    re: /^dashSplitSub\//, globalValue: splitTotal, globalSource: 'Σ periodFigures.split', index: 0 });
  {
    /* The donut draws the largest N−1 categories and folds the rest into one
       "other" slice, so the last slice is a sum, not a row. */
    const slices = C.figs(D, /^dashSplit\/svg\.donut\/path[^/]*\/title/, 'money');
    const n = slices.length;
    const seam = n && F.split.length > n
      ? [...F.split.slice(0, n - 1).map(r => r.amount), F.split.slice(n - 1).reduce((t, r) => t + r.amount, 0)]
      : F.split.map(r => r.amount);
    column({ page: D, name: `Donut slices = split rows (${n ? n - 1 : 0} named + other)`, formula: 'slice i = split[i]; the last slice = Σ split[n−1..]',
      re: /^dashSplit\/svg\.donut\/path[^/]*\/title/, seam, globalSource: 'periodFigures.split[].amount, tail folded' });
  }
  /* dashboard.js:1669 prints a remaining figure for a budgeted row and for
     an `unbudgeted` one (budgetRowStatus: spend with no envelope, not income,
     not assumed) — never for an unbudgeted income row or a netted refund. */
  const drawn = F.rows.filter(r => r.budget || r.unbudgeted);
  /* budgets.js:621-648 prints the SAME rows, but an overspend as a magnitude
     ("over by R 197,60") where the Dashboard prints "R -197,60"; and an
     assume-spent row still inside its envelope prints words, not a number. */
  const drawnBudgetPage = F.rows
    .filter(r => (r.budget && !(r.assumed && r.actual <= r.budget)) || r.unbudgeted)
    .map(r => (r.remaining < 0 && r.type !== 'income') ? -r.remaining : r.remaining);
  column({ page: D, name: 'Budget table: Budget column = rows', formula: 'budgetVsActualRows[].budget',
    re: /^dashBudget\/tbody\/tr\[\d+\]\/td\.num\[1\]$/, seam: F.rows.map(r => r.budget).filter(v => v), globalSource: 'periodFigures.rows[].budget (non-zero)' , note: 'zero budgets print blank' });
  column({ page: D, name: 'Budget table: Actual column = rows', formula: 'budgetVsActualRows[].actual',
    re: /^dashBudget\/tbody\/tr\[\d+\]\/td\.num\[2\]$/, seam: F.rows.map(r => r.actual), globalSource: 'periodFigures.rows[].actual' });
  column({ page: D, name: 'Budget table: Remaining column = rows', formula: 'budgetRowStatus.remaining = budget − actual',
    re: /^dashBudget\/tbody\/tr\[\d+\]\/td\.num\[4\]$/, seam: drawn.map(r => r.remaining), globalSource: 'periodFigures.rows[].remaining (rows with a budget or an actual)' });
  {
    const bars = C.figs(D, /^trendChart\/svg\/rect\[\d+\]\/title/, 'money');
    const last = bars.reduce((m, f) => Math.max(m, Number((f.address.match(/rect\[(\d+)\]/) || [])[1])), -1);
    const vals = bars.filter(f => f.address.includes(`rect[${last}]`)).map(figValue);
    /* views/dashboard.js:1708 — the bar carries budgetUsed(p).spent, the
       ADR-0005 numerator, not gross spend. */
    const want = [['spent', U.spent, 'budgetUsed(p).spent'], ['budget', B.spend, 'budgetTotals.spend'], ['income', S.income, 'periodSummary.income']];
    for (const [n, v, src] of want) {
      C.add({ page: D, name: `Trend chart, current bar: ${n}`, formula: 'the last bar of the trend is this period (dashboard.js renderTrend data row)',
        pageValue: vals.find(x => near(x, v)) ?? (vals.length ? vals[0] : null), pageSource: `trendChart rect[${last}] titles: [${vals.join(', ')}]`,
        globalValue: v, globalSource: src });
    }
  }
  const poolsImplied = (W.byTypeImplied.savings || 0) + (W.byTypeImplied.investment || 0);
  dom({ page: D, name: 'Position: net worth', formula: 'worth(impliedAccounts, debts, assets, owed).net',
    re: /^dashPositionKpis\/@pos-net$/, globalValue: W.implied.net, globalSource: 'worth().net' });
  /* The tile prints −liabilities (a liability shown as a reduction of net
     worth, in red, deliberately) and liabilities is fromAccounts + fromDebts.
     This named fromDebts and dropped the sign: indistinguishable on a household
     with no overdrawn account, wrong on every household with one. */
  dom({ page: D, name: 'Position: debts', formula: '−worth().liabilities, as the tile prints it',
    re: /^dashPositionKpis\/@pos-debt$/, globalValue: -W.implied.liabilities, globalSource: '−worth().liabilities' });
  dom({ page: D, name: 'Position: owed to you', formula: 'worth().ownedOwed',
    re: /^dashPositionKpis\/@pos-owed$/, globalValue: W.implied.ownedOwed, globalSource: 'worth().ownedOwed' });
  dom({ page: D, name: 'Position: savings & investments (implied)', formula: 'Σ implied balances of savings- and investment-typed home accounts',
    re: /^dashPositionKpis\/@pos-savings$/, globalValue: poolsImplied, globalSource: 'byTypeImplied.savings + investment' });
  dom({ page: D, name: 'Position sub: savings (implied)', formula: 'Σ implied, type savings',
    re: /^dashPositionKpis\/div\.mini\[3\]\/div\.s/, globalValue: W.byTypeImplied.savings || 0, globalSource: 'byTypeImplied.savings', index: 0 });
  dom({ page: D, name: 'Position sub: invested (implied)', formula: 'Σ implied, type investment',
    re: /^dashPositionKpis\/div\.mini\[3\]\/div\.s/, globalValue: W.byTypeImplied.investment || 0, globalSource: 'byTypeImplied.investment', index: 1 });
  dom({ page: D, name: 'Stale note: drift', formula: 'Σ reconcile delta where state = drift (home currency)',
    re: /^dashStale\//, globalValue: W.driftSum, globalSource: 'bookFigures().drift.drift' });
  /* The health card: three figures off healthSnapshot(). */
  dom({ page: D, name: 'Health: emergency fund set aside', formula: 'resolveEarmarks(home accounts).total',
    re: /^healthBody\/.*health-fig\[1\]\//, globalValue: G.health.earmarks.total, globalSource: 'healthSnapshot().earmarks.total' });
  dom({ page: D, name: 'Health: months of essentials covered', formula: 'earmarks.total / monthlyEssential', kind: 'number',
    re: /^healthBody\/.*health-fig\[1\]\//, globalValue: G.health.metrics.months, globalSource: 'healthSnapshot().metrics.months', note: 'printed to one decimal' });
  dom({ page: D, name: 'Health: income saved on average', formula: 'monthlySavings / monthlyIncome over the trailing six periods', kind: 'percent',
    re: /^healthBody\/.*health-fig\[2\]\//, globalValue: isNum(G.health.metrics.savingsRate) ? G.health.metrics.savingsRate * 100 : null, globalSource: 'metrics.savingsRate' });
  dom({ page: D, name: 'Health: saved per month', formula: 'monthlySavings',
    re: /^healthBody\/.*health-fig\[2\]\//, globalValue: G.health.metrics.monthlySavings, globalSource: 'metrics.monthlySavings' });
  /* The what's-left card is a projection over commitments (committed.js), not
     a lens over rows; its own arithmetic is checked, and its cash figure is
     shown beside the implied bank balances it is a subset of. */
  {
    /* Every term by name. The strip is three to five tiles — the earmark and
       card terms are each conditional — and `left-op` separators are siblings
       too, so indexing tiles positionally read "still committed" as "actually
       free" the moment a household had an earmarked fund. The identity the
       card actually prints is cash − earmarked − committed − cardDue = free,
       not cash − committed; the old check's name was wrong as well as its
       addresses. A short household prints @left-short, and it is the same
       identity with the sign the label already carries. */
    const cash = C.fig(D, /^leftBody\/@left-cash$/);
    const earmarked = C.fig(D, /^leftBody\/@left-earmarked$/);
    const committed = C.fig(D, /^leftBody\/@left-committed$/);
    const cardDue = C.fig(D, /^leftBody\/@left-card$/);
    const freeFig = C.fig(D, /^leftBody\/@left-free$/);
    const shortFig = C.fig(D, /^leftBody\/@left-short$/);
    const free = freeFig || shortFig;
    const term = f => (f ? figValue(f) : 0);
    if (cash && free) C.add({
      page: D, name: "What's left: free = cash − earmarked − committed − card",
      formula: 'the equation the card prints, term by term',
      pageValue: shortFig ? -figValue(shortFig) : figValue(free), pageSource: free.address,
      globalValue: term(cash) - term(earmarked) - term(committed) - term(cardDue),
      globalSource: 'cash − earmarked − committed − cardDue, as the card prints them', tol: 1.01 });
    const bank = Object.entries(W.byTypeImplied).filter(([t]) => !['savings', 'investment'].includes(t)).reduce((t, [, v]) => t + v, 0);
    if (cash) C.add({ page: D, name: "What's left: cash in your accounts vs implied bank balances", formula: 'cashOnHand() counts confirmed, in-budget, non-pool accounts; the implied bank total counts every bank-type account', pageValue: figValue(cash), pageSource: cash.address,
      globalValue: bank, globalSource: 'Σ implied, non-pool types', tol: figTol(cash), expectDiff: true });
  }

  /* ---- budget page ---------------------------------------------------- */
  const BP = 'budgets';
  column({ page: BP, name: 'Actual column = budgetVsActualRows', formula: 'the same rows the Dashboard table draws; the Budget page draws EVERY category, so extra 0,00 cells are allowed',
    re: /^budTable\/tbody\/tr\[\d+\]\/td\.num\[3\]$/, seam: F.rows.map(r => r.actual), globalSource: 'periodFigures.rows[].actual', allowExtraZero: true });
  column({ page: BP, name: 'Remaining column = rows (overspend printed as a magnitude)', formula: 'budgetRowStatus.remaining; "over by R X" prints −remaining where the Dashboard prints the signed figure — same number, opposite sign on the two pages',
    re: /^budTable\/tbody\/tr\[\d+\]\/td\.num\[2\]\/div\.bud-amt-wrap\/div\.bud-remaining$/, seam: drawnBudgetPage, globalSource: 'periodFigures.rows[].remaining, sign folded for over rows', allowExtraZero: true });
  /* The totals strip, drawn twice (top and bottom) from one set of operands. */
  for (const strip of ['budTotalsTop', 'budTotalsBottom']) {
    /* Kept for any tile that has not earned a name yet; every check below
       addresses a data-fig instead, because the unallocated tile is omitted on
       a running period with no income row and every index after it moved. */
    const at = (i, cls) => new RegExp(`^${strip}/div\\.bud-total\\[${i}\\]/div\\.${cls}`);
    dom({ page: BP, name: `${strip}: total income (budgeted)`, formula: 'budgetTotals(p).income', re: new RegExp(`^${strip}/@bud-income$`), globalValue: B.income, globalSource: 'budgetTotals.income' });
    dom({ page: BP, name: `${strip}: income received so far`, formula: 'periodSummary.income', re: new RegExp(`^${strip}/@bud-income-note$`), globalValue: S.income, globalSource: 'periodSummary.income' });
    dom({ page: BP, name: `${strip}: total budgeted (whole plan)`, formula: 'budgetTotals.spend + setAside', re: new RegExp(`^${strip}/@bud-budgeted$`), globalValue: F.planTotal, globalSource: 'whole plan' });
    dom({ page: BP, name: `${strip}: % of budgeted income`, formula: 'whole plan / budget income', kind: 'percent', re: new RegExp(`^${strip}/@bud-budgeted-note$`), globalValue: F.allocated == null ? null : F.allocated * 100, globalSource: 'allocated share' });
    /* The tile prints a MAGNITUDE and its label carries the direction
       ("Left to budget" / "Over-budgeted"), so it is compared to |unallocated|
       off the registered seam. Named, too: this tile is omitted entirely on a
       running period with no income row, which silently shifted every index
       after it. */
    dom({ page: BP, name: `${strip}: unallocated (left to budget / over-budgeted)`, formula: '|periodFigures.plan.unallocated| = |income − whole plan|',
      re: new RegExp(`^${strip}/@bud-unallocated$`),
      globalValue: F.plan && F.plan.unallocated != null ? Math.abs(F.plan.unallocated) : null, globalSource: '|periodFigures.plan.unallocated|' });
    dom({ page: BP, name: `${strip}: total spent`, formula: 'budgetUsed(p).spent', re: new RegExp(`^${strip}/@bud-spent$`), globalValue: U.spent, globalSource: 'budgetUsed.spent' });
    dom({ page: BP, name: `${strip}: % of budget used`, formula: 'budgetUsed(p).used', kind: 'percent', re: new RegExp(`^${strip}/@bud-note-spent$`), globalValue: U.used == null ? null : U.used * 100, globalSource: 'budgetUsed.used' });
    /* WITHDRAWN, not pinned. This compared the Budget strip's gap against
       `periodFigures.gap.notShown`, which is the DONUT's gap: it sums
       categorySpendRows, which iterates sum.byCat and so includes categories
       with no .md file, while the strip sums budgetDraft(), which seeds a row
       only for declared categories and so excludes them. Two honest gaps, two
       different numbers, one check conflating them — and the strip's gap has
       no seam in the register at all (views/budgets.js recomputes grossGap by
       hand), so there is nothing correct to compare it to yet. A check with no
       right answer is worse than no check: it trains a reader to ignore a red
       line. Restore it when the strip's gap gets a seam — see ISSUE 96. */
    /* Both figures live in ONE named fragment ("R2 000 set aside, R1 000 moved
       so far"), so they are index 0 and 1 WITHIN it — stable however many other
       fragments the note carries. Addressed by ordinal across the whole note
       before, which is why both were passing by coincidence. */
    const setAsideNote = new RegExp(`^${strip}/@bud-note-setaside$`);
    dom({ page: BP, name: `${strip}: set-aside note`, formula: 'budgetUsed(p).setAside', re: setAsideNote, globalValue: U.setAside, globalSource: 'budgetUsed.setAside', index: 0 });
    dom({ page: BP, name: `${strip}: moved to funds`, formula: 'movedToFunds(p)', re: setAsideNote, globalValue: G.moved, globalSource: 'movedToFunds(p)', index: 1 });
  }

  /* ---- score ---------------------------------------------------------- */
  const SC = 'score';
  dom({ page: SC, name: 'Flow: income in', formula: 'periodSummary.income',
    re: /score-flow-in/, globalValue: S.income, globalSource: 'periodSummary(currentPeriod).income' });
  dom({ page: SC, name: 'Budget chip: budgeted (whole plan)', formula: 'budgetTotals.spend + setAside',
    re: /score-flow-chips\[\d+\]\/div\.mini\[1\]\/div\.score-flow-row\[1\]/, globalValue: F.planTotal, globalSource: 'budgetTotals(p)' });
  dom({ page: SC, name: 'Budget chip: allocated of income', formula: 'plan / budget income', kind: 'percent',
    re: /score-flow-chips\[\d+\]\/div\.mini\[1\]\/div\.score-flow-row\[2\]/, globalValue: F.allocated == null ? null : F.allocated * 100, globalSource: 'allocatedShare' });
  dom({ page: SC, name: 'Budget chip: spent', formula: 'budgetUsed.spent',
    re: /score-flow-chips\[\d+\]\/div\.mini\[1\]\/div\.score-flow-row\[3\]/, globalValue: U.spent, globalSource: 'budgetUsed(p).spent' });
  dom({ page: SC, name: 'Budget chip: budget used', formula: 'budgetUsed.used', kind: 'percent',
    re: /score-flow-chips\[\d+\]\/div\.mini\[1\]\/div\.score-flow-row\[4\]/, globalValue: U.used == null ? null : U.used * 100, globalSource: 'budgetUsed(p).used' });
  /* The ring legend, one row per pillar, every figure off healthSnapshot(). */
  const H = G.health.metrics;
  const ring = i => new RegExp(`score-ring-legend\\[\\d+\\]/button\\.score-ring-row\\[${i}\\]/`);
  dom({ page: SC, name: 'Ring: emergency fund set aside', formula: 'resolveEarmarks(home accounts).total', re: ring(0), globalValue: G.health.earmarks.total, globalSource: 'earmarks.total', index: 0 });
  dom({ page: SC, name: 'Ring: essentials per month', formula: 'monthlyEssential (HOUSEHOLD lens essential spend, six-period average)', re: ring(0), globalValue: H.monthlyEssential, globalSource: 'metrics.monthlyEssential', index: 1 });
  dom({ page: SC, name: 'Ring: % of income saved', formula: 'savingsRate', kind: 'percent', re: ring(1), globalValue: isNum(H.savingsRate) ? H.savingsRate * 100 : null, globalSource: 'metrics.savingsRate' });
  dom({ page: SC, name: 'Ring: saved per month', formula: 'monthlySavings', re: ring(1), globalValue: H.monthlySavings, globalSource: 'metrics.monthlySavings' });
  dom({ page: SC, name: 'Ring: % of income to interest', formula: 'interestShare', kind: 'percent', re: ring(2), globalValue: isNum(H.interestShare) ? H.interestShare * 100 : null, globalSource: 'metrics.interestShare' });
  dom({ page: SC, name: 'Ring: fixed bills % of income', formula: 'fixedShare', kind: 'percent', re: ring(3), globalValue: isNum(H.fixedShare) ? H.fixedShare * 100 : null, globalSource: 'metrics.fixedShare', index: 0 });
  dom({ page: SC, name: 'Ring: living costs % of income', formula: 'consumptionShare', kind: 'percent', re: ring(3), globalValue: isNum(H.consumptionShare) ? H.consumptionShare * 100 : null, globalSource: 'metrics.consumptionShare', index: 1 });
  dom({ page: SC, name: 'Ring: budget used (six-period average)', formula: 'metrics.budgetUsed', kind: 'percent', re: ring(3), globalValue: isNum(H.budgetUsed) ? H.budgetUsed * 100 : null, globalSource: 'metrics.budgetUsed', index: 2 });
  dom({ page: SC, name: 'Ring: net worth', formula: 'healthSnapshot → worth(impliedAccounts…).net', re: ring(4), globalValue: W.implied.net, globalSource: 'worth().net' });
  {
    /* Two "budget used" readings on one screen, by two documented rules. */
    const chip = C.fig(SC, /score-flow-chips\[\d+\]\/div\.mini\[1\]\/div\.score-flow-row\[4\]/, 'percent');
    C.add({ page: SC, name: 'Budget chip "budget used" (this period) vs ring (six-period average)', formula: 'budgetUsed(p).used vs healthMetrics.budgetUsed — same numerator rule, different window', kind: 'percent',
      pageValue: figValue(chip), pageSource: chip ? chip.address : 'no chip', globalValue: isNum(H.budgetUsed) ? H.budgetUsed * 100 : null, globalSource: 'metrics.budgetUsed × 100', tol: 0.51, expectDiff: true });
  }

  /* ---- transactions ---------------------------------------------------- */
  const T = 'transactions';
  {
    const cells = C.figs(T, /^txTable\/tbody\/tr\[\d+\]\/td\.num\[4\]$/, 'money');
    const shown = cells.length, total = G.oracle.whole.all.rows;
    C.add({ page: T, name: 'Rows rendered = rows in period', formula: 'txInPeriod(p).length; the table windows to PAGE rows and says so', kind: 'count',
      pageValue: shown, pageSource: `${shown} amount cells in txTable`, globalValue: total, globalSource: 'raw rows in period (this script)', tol: 0,
      note: shown < total ? 'the table is windowed — press "show more" in the app; the sum below is over the rendered window only' : '' });
    if (shown === total) {
      C.add({ page: T, name: 'Σ rendered amounts = Σ raw rows', formula: 'every row, excluded and split parents included',
        pageValue: cells.reduce((t, f) => t + (figValue(f) || 0), 0), pageSource: 'Σ txTable amounts', globalValue: G.oracle.whole.all.sum, globalSource: 'oracle Σ amount' });
    }
  }

  /* ---- savings -------------------------------------------------------- */
  const V = 'savings';
  dom({ page: V, name: 'KPI: net worth', formula: 'worth(impliedAccounts…).net', re: /^savingsKpis\/div\.mini\[0\]\/div\.v/, globalValue: W.implied.net, globalSource: 'worth().net' });
  dom({ page: V, name: 'KPI "Savings" (stated balances)', formula: 'Σ stated balance of savings-type home accounts (views/savings.js homeOnly(accountsOfType savings))', re: /^savingsKpis\/div\.mini\[1\]\/div\.v/, globalValue: W.byTypeStated.savings || 0, globalSource: 'Σ stated, type savings' });
  dom({ page: V, name: 'KPI "Investments" (stated balances)', formula: 'Σ stated balance of investment-type home accounts', re: /^savingsKpis\/div\.mini\[2\]\/div\.v/, globalValue: W.byTypeStated.investment || 0, globalSource: 'Σ stated, type investment' });
  /* The chart is TWO partitions, and neither of its bar totals is the net.
     This read the OWNED bar's total and compared it to worth().net, so it was
     always short by exactly the liabilities — which is the definition of net,
     not a disagreement. Each bar is now checked against its own total, and the
     net is checked as the identity between them. */
  dom({ page: V, name: 'Worth chart: "What you own" total', formula: 'worth().assets', re: /^savingsWorth\/@worth-owned-total$/, globalValue: W.implied.assets, globalSource: 'worth().assets' });
  dom({ page: V, name: 'Worth chart: "What you owe" total', formula: 'worth().liabilities', re: /^savingsWorth\/@worth-owed-total$/, globalValue: W.implied.liabilities, globalSource: 'worth().liabilities' });
  {
    const owned = C.fig(V, /^savingsWorth\/@worth-owned-total$/);
    const owed = C.fig(V, /^savingsWorth\/@worth-owed-total$/);
    if (owned) C.add({ page: V, name: 'Worth chart: own − owe = net worth', formula: 'the two bars the chart prints, subtracted', kind: 'money',
      pageValue: figValue(owned) - (owed ? figValue(owed) : 0), pageSource: 'owned bar − owed bar',
      globalValue: W.implied.net, globalSource: 'worth().net' });
  }
  {
    /* The old selector required an UNINDEXED band `g` and an INDEXED segment,
       which together describe exactly one shape: a vault with one bar and two
       or more segments in it — i.e. a household with no debts. Anywhere else it
       matched nothing, and Σ of nothing is 0, which the check then compared to
       the net as though the page had said zero. Named per bar now, and each bar
       is a partition of its OWN total; Σ of all segments across both bars
       equals no figure the page prints. */
    const ownedSegs = C.figs(V, /^savingsWorth\/@worth-owned-seg$/, 'money');
    const owedSegs = C.figs(V, /^savingsWorth\/@worth-owed-seg$/, 'money');
    const segFigs = [...ownedSegs, ...owedSegs];
    const sumOf = fs_ => fs_.map(figValue).reduce((a, b) => a + b, 0);
    if (ownedSegs.length) C.add({ page: V, name: 'Worth chart: Σ owned segments = "What you own"', formula: 'the owned bar is a partition of its own total', pageValue: sumOf(ownedSegs), pageSource: `Σ ${ownedSegs.length} segments`, globalValue: W.implied.assets, globalSource: 'worth().assets' });
    if (owedSegs.length) C.add({ page: V, name: 'Worth chart: Σ owed segments = "What you owe"', formula: 'the owed bar is a partition of its own total', pageValue: sumOf(owedSegs), pageSource: `Σ ${owedSegs.length} segments`, globalValue: W.implied.liabilities, globalSource: 'worth().liabilities' });
    /* Segments are named in their titles ("Investments: R …"), so each can be
       matched to the implied per-type total it is drawn from. */
    const segNamed = name => segFigs.find(f => new RegExp(`^${name}:`, 'i').test(f.context.parent || ''));
    for (const [label, type] of [['Investments', 'investment'], ['Savings', 'savings']]) {
      const f = segNamed(label);
      C.add({ page: V, name: `Worth chart: "${label}" segment (implied)`, formula: 'worth(impliedAccounts…) — accountGroups over implied balances', pageValue: figValue(f), pageSource: f ? f.address : `no segment titled ${label}`,
        globalValue: W.byTypeImplied[type] || 0, globalSource: `byTypeImplied.${type}`, tol: figTol(f) });
      /* The KPI above the chart reads STATED balances, the chart reads
         IMPLIED ones. One page, two bases; the difference is the drift. */
      const kpi = C.fig(V, type === 'savings' ? /^savingsKpis\/div\.mini\[1\]\/div\.v/ : /^savingsKpis\/div\.mini\[2\]\/div\.v/);
      C.add({ page: V, name: `KPI "${label}" (stated) vs chart "${label}" segment (implied)`, formula: 'the KPI sums S.accounts balances; the chart sums impliedAccounts() — same accounts, two bases', pageValue: figValue(kpi), pageSource: kpi ? kpi.address : 'no KPI',
        globalValue: figValue(f), globalSource: f ? f.address : 'no segment', tol: figTol(kpi), expectDiff: true });
    }
    C.add({ page: V, name: 'KPI "Investments" (stated) vs Dashboard tile "invested" (implied)', formula: 'views/savings.js totalInvest reads stated balances; the Dashboard position tile reads implied ones', pageValue: figValue(C.fig(V, /^savingsKpis\/div\.mini\[2\]\/div\.v/)), pageSource: 'savingsKpis mini[2]',
      globalValue: W.byTypeImplied.investment || 0, globalSource: 'byTypeImplied.investment (what the Dashboard prints)', expectDiff: true });
  }

  /* ---- accounts -------------------------------------------------------- */
  const A = 'accounts';
  const statedNet = W.naive.statedPositive - W.naive.statedNegative;
  dom({ page: A, name: 'Hero: accounts total (stated, home currency)', formula: 'worth(stated home accounts, null, null).net', re: /^acctSummary\/div\.card\[0\]\/div\.hero-num/, globalValue: statedNet, globalSource: 'Σ stated home balances' });
  {
    /* @acct-owner-net exactly: the foreign "plus $ 1 000" tag is a CHILD of
       this span, and an unanchored match summed it in as another owner. */
    const owners = C.figs(A, /^acctSummary\/@acct-owner-net$/, 'money').map(figValue);
    C.add({ page: A, name: 'Owner rows sum to the hero', formula: 'Σ per-owner net = accounts total', pageValue: owners.reduce((a, b) => a + b, 0), pageSource: `Σ ${owners.length} owner rows`, globalValue: statedNet, globalSource: 'Σ stated home balances' });
    column({ page: A, name: 'Owner rows = Σ by owner', formula: 'a.owner; a blank owner buckets under Unassigned, never "joint"', re: /^acctSummary\/@acct-owner-net$/, seam: Object.values(W.byOwnerStated), globalSource: 'Σ stated by owner (this script)' });
  }
  dom({ page: A, name: 'Donut: total', formula: 'Σ stated home balances', re: /^acctSummary\/div\.card\[2\]\/.*svg\.donut\/text/, globalValue: statedNet, globalSource: 'Σ stated home balances' });
  {
    /* The table groups every non-pool type under one "Bank accounts" header. */
    const groups = { bank: 0 };
    for (const [t, v] of Object.entries(W.byTypeStated)) { if (t === 'savings' || t === 'investment') groups[t] = v; else groups.bank += v; }
    column({ page: A, name: 'Group totals = Σ by group (bank / savings / investments)', formula: 'type-row totals; bank = every non-pool type', re: /^acctTable\/@acct-group-total$/, seam: Object.values(groups).filter(v => Math.abs(v) >= 0.005), globalSource: 'Σ stated by group (this script)' });
    for (const [label, type] of [['Savings', 'savings'], ['Investments', 'investment']]) {
      const f = C.figs(A, /^acctTable\/@acct-group-total$/, 'money').find(x => new RegExp(`^${label}`).test(x.context.parent || ''));
      C.add({ page: A, name: `Group "${label}" (stated) vs Dashboard tile (implied)`, formula: 'the Accounts page prints stated balances; the Dashboard position tile prints implied ones', pageValue: figValue(f), pageSource: f ? f.address : `no ${label} group`,
        globalValue: W.byTypeImplied[type] || 0, globalSource: `byTypeImplied.${type}`, tol: figTol(f), expectDiff: true });
    }
  }
  /* No `!a.foreign` on the seam: the column renders every account in its OWN
     symbol, converting and summing nothing, so narrowing the seam to home
     accounts left the foreign row with no counterpart. `statedRaw == null`
     stays — an unreadable balance renders as prose, not as a money figure. */
  column({ page: A, name: 'Balance column = stated balances', formula: 'button.acct-bal per row, each in its own currency', re: /^acctTable\/@acct-bal$/, seam: G.accounts.filter(a => a.statedRaw == null).map(a => a.stated), globalSource: 'S.accounts[].balance (readable)' });
  {
    /* The chip renders its sign as a separate glyph, so the harvested number is
       a magnitude and a naive compare accepted +500 for a −500. The direction
       is in the data-fig name instead, and the sign is rebuilt from it — so a
       chip that printed the wrong way round now fails, which is the whole
       point of checking it. */
    const inChips = C.figs(A, /^acctTable\/@acct-flow-in$/, 'money').map(f => ({ f, v: figValue(f) }));
    const outChips = C.figs(A, /^acctTable\/@acct-flow-out$/, 'money').map(f => ({ f, v: -figValue(f) }));
    const chips = [...inChips, ...outChips].map(x => x.f);
    const signed = [...inChips, ...outChips];
    const acts = G.accounts.flatMap(a => [a.activity.net, a.activity.inAmt, a.activity.outAmt]);
    let matched = 0; const miss = [];
    for (const { f, v } of signed) { if (acts.some(x => near(x, v, figTol(f)))) matched++; else miss.push(`${f.text} (as ${v})`); }
    C.add({ page: A, name: 'Flow chips = ACCOUNT-lens activity', formula: 'each chip equals one of net / in / out under tally(rows of that account, ACCOUNT), start..asOf', kind: 'count',
      pageValue: matched, pageSource: `${matched} of ${chips.length} chips matched${miss.length ? ` · unmatched: ${miss.join(', ')}` : ''}`, globalValue: chips.length, globalSource: 'chips on the page', tol: 0 });
  }

  /* ---- assets / owed / services / debts ---------------------------------- */
  dom({ page: 'assets', name: 'Hero: total', formula: 'assetTotal(assets, household)', re: /assets-hero-num/, globalValue: W.implied.ownedAssets, globalSource: 'worth().ownedAssets' });
  dom({ page: 'owed', name: 'KPI: outstanding', formula: 'Σ outstandingOf(o) over unsettled home rows', re: /^owedKpis\/div\.mini\[0\]\/div\.v/, globalValue: W.implied.ownedOwed, globalSource: 'worth().ownedOwed' });
  dom({ page: 'owed', name: 'KPI: recovered', formula: 'Σ amount − Σ outstanding', re: /^owedKpis\/div\.mini\[1\]\/div\.v/, globalValue: G.owedTotals.lent - G.owedTotals.outstanding, globalSource: 'Σ owed[].amount − Σ outstandingOf' });
  {
    const m = C.fig('services', /^servicesKpis\/div\.mini\[0\]\/div\.v/), y = C.fig('services', /^servicesKpis\/div\.mini\[1\]\/div\.v/);
    C.add({ page: 'services', name: 'Yearly = 12 × monthly', formula: 'the two KPIs are one figure at two cycles', pageValue: figValue(y), pageSource: y ? y.address : 'no yearly KPI', globalValue: isNum(figValue(m)) ? figValue(m) * 12 : null, globalSource: '12 × monthly KPI', tol: 0.06 });
  }
  if (G.debts.active) {
    dom({ page: 'debts', name: 'Debts total', formula: 'Σ active home debt balances', re: /debt/i, globalValue: G.debts.total, globalSource: 'activeDebts Σ balance' });
  }

  /* ---- plan / loans: the page's own arithmetic ------------------------------ */
  {
    const P = 'plan';
    const srcs = C.figs(P, /^planSources\/.*src2-amt/, 'money').map(figValue);
    const pot = C.fig(P, /^planPot\/div\.pot-sub/);
    C.add({ page: P, name: 'Σ sources = pot', formula: 'the pot is the sum of its sources', pageValue: srcs.reduce((a, b) => a + b, 0), pageSource: `Σ ${srcs.length} sources`, globalValue: figValue(pot), globalSource: 'planPot pot-sub', tol: figTol(pot) });
    const envs = C.figs(P, /^planEnvelopes\/.*env-sum-amt|^planEnvelopes\/div\.env\/button\.env-amt-btn\/div\.env-amt/, 'money').map(figValue);
    const free = C.fig(P, /^planFree\/h2/);
    C.add({ page: P, name: 'Σ envelopes + free = pot', formula: 'every rand in the pot has a job or is free', pageValue: envs.reduce((a, b) => a + b, 0) + (figValue(free) || 0), pageSource: `Σ ${envs.length} envelopes + free`, globalValue: figValue(pot), globalSource: 'planPot pot-sub', tol: figTol(pot) });
  }
  {
    const L = 'loans';
    const rows = new Map();
    for (const f of C.figs(L, /^loanHomeAmort\/tbody\/tr\[\d+\]\/td\.num\[\d\]$/, 'money')) {
      const [, r, c] = f.address.match(/tr\[(\d+)\]\/td\.num\[(\d)\]/);
      (rows.get(r) || rows.set(r, {}).get(r))[c] = figValue(f);
    }
    let ok = 0, bad = [];
    for (const [r, cols] of rows) {
      if (![1, 3, 4].every(c => isNum(cols[c]))) continue;
      if (near(cols[1] - cols[3], cols[4], 0.51)) ok++; else bad.push(`row ${r}`);
    }
    if (rows.size) C.add({ page: L, name: 'Amortisation: opening − principal = closing', formula: 'per row of the home-loan table', kind: 'count', pageValue: ok, pageSource: `${ok} rows hold${bad.length ? ` · failing: ${bad.join(', ')}` : ''}`, globalValue: ok + bad.length, globalSource: 'rows with all three cells', tol: 0 });
  }

  return C.checks;
}

/* ---- the presence matrix: which global figures appear on which page ---- */
function presenceMatrix(G, pages) {
  const F = G.figures, S = G.summary, U = G.used, B = G.budget, W = G.worth;
  const rows = [
    ['periodSummary.income', S.income], ['periodSummary.spend (gross)', S.spend], ['periodSummary.net', S.net],
    ['periodSummary.setAside', S.setAside], ['budgetUsed.spent', U.spent], ['budgetUsed.assumed', U.assumed],
    ['budgetTotals.spend', B.spend], ['budgetTotals.setAside', B.setAside], ['budgetTotals.income', B.income], ['whole plan', F.planTotal],
    ['Σ split (donut total)', F.split.reduce((t, r) => t + r.amount, 0)], ['gap.uncat', F.gap.uncat], ['gap.netted', F.gap.netted],
    ['fundedFromSavings', F.fundedFromSavings.spend], ['scheduled.spend', F.scheduled.spend], ['scheduled.income', F.scheduled.income],
    ['monthlyIncome', G.income.income], ['movedToFunds', G.moved], ['periodDeficit', G.deficit],
    ['worth.net (implied)', W.implied.net], ['accounts implied net', W.implied.ownedAccounts - W.implied.fromAccounts],
    ['accounts stated net', W.naive.statedPositive - W.naive.statedNegative], ['assets', W.implied.ownedAssets],
    ['owed to you', W.implied.ownedOwed], ['debts', W.implied.fromDebts], ['reconcile drift', W.driftSum],
    ['HOUSEHOLD.consumption', G.lenses.soFar.HOUSEHOLD.consumption], ['HOUSEHOLD.netIncome', G.lenses.soFar.HOUSEHOLD.netIncome],
    ['TREND Σ spendByCat', G.lenses.soFar.TREND.spendByCatTotal],
  ].filter(([, v]) => isNum(v));
  return rows.map(([name, value]) => ({
    name, value,
    pages: pages.map(p => {
      const hit = p.figures.find(f => f.kind === 'money' && near(figValue(f), value, figTol(f)) && Math.abs(value) >= 0.005);
      return { view: p.view, hit: !!hit, address: hit ? hit.address : '' };
    }),
  }));
}

/* ---- HTML -------------------------------------------------------------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function money(v, dp = 2) {
  if (!isNum(v)) return '—';
  const neg = v < 0; const a = Math.abs(v).toFixed(dp);
  const [i, d] = a.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '−' : ''}${grouped}${dp ? ',' + d : ''}`;
}
const pct = v => (isNum(v) ? `${(v).toFixed(1).replace('.', ',')}%` : '—');
const num = v => (isNum(v) ? (Number.isInteger(v) ? String(v) : money(v)) : v == null ? '—' : esc(v));
const pill = s => `<span class="pill ${s}">${s}</span>`;
function kv(rows) {
  return `<table class="kv"><tbody>${rows.map(([k, v, note]) => `<tr><th>${esc(k)}</th><td class="num">${v}</td>${note != null ? `<td class="muted">${note}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
function checksTable(list) {
  if (!list.length) return '<p class="muted">No checks on this page.</p>';
  return `<table class="checks"><thead><tr><th>Status</th><th>Check</th><th>Page value</th><th>Global value</th><th>Δ</th><th>Rule</th></tr></thead><tbody>${list.map(c => {
    const fmt = v => (c.kind === 'money' ? money(v) : c.kind === 'percent' ? pct(v) : c.kind === 'ratio' ? (isNum(v) ? v.toFixed(6) : '—') : num(v));
    const why = c.why && c.why.length ? `<div class="why">Δ equals: ${c.why.map(esc).join(' · ')}</div>` : '';
    return `<tr class="st-${c.status}"><td>${pill(c.status)}</td><td><b>${esc(c.name)}</b>${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}${why}</td>
      <td class="num">${fmt(c.pageValue)}<div class="src">${esc(c.pageSource || '')}</div></td>
      <td class="num">${fmt(c.globalValue)}<div class="src">${esc(c.globalSource || '')}</div></td>
      <td class="num">${c.delta == null ? '' : fmt(c.delta)}</td><td class="muted small">${esc(c.formula || '')}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function figuresTable(figs) {
  if (!figs.length) return '<p class="muted">Nothing numeric rendered.</p>';
  return `<table class="figs"><thead><tr><th>#</th><th>Kind</th><th>Shown</th><th>Raw</th><th>Around it</th><th>Address</th></tr></thead><tbody>${figs.map((f, i) =>
    `<tr data-kind="${f.kind}"><td class="muted">${i + 1}</td><td>${f.kind}</td><td class="num"><b>${esc(f.text)}</b></td><td class="num muted">${f.ambiguous ? '?' : f.raw == null ? '' : f.raw}</td><td class="ctx">${esc(f.context.parent || f.context.own)}</td><td class="addr">${esc(f.address)}</td></tr>`).join('')}</tbody></table>`;
}
function lensTable(L) {
  const names = Object.keys(L);
  const fields = ['count', 'kept', 'income', 'spend', 'net', 'setAside', 'inflow', 'outflow', 'uncategorised', 'uncatSpend', 'unknownCount', 'unknownSpend', 'foreignCount', 'fundedFromSavings', 'consumption', 'fixed', 'netIncome', 'spendByCatTotal'];
  const ints = new Set(['count', 'kept', 'uncategorised', 'unknownCount', 'foreignCount']);
  return `<table class="lens"><thead><tr><th>Field</th>${names.map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>${fields.map(f =>
    `<tr><th>${f}</th>${names.map(n => `<td class="num">${ints.has(f) ? L[n][f] : money(L[n][f])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function rowsTable(rows, limit = 400) {
  if (!rows.length) return '<p class="muted">None.</p>';
  return `<table class="rows"><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th><th>Stamps</th></tr></thead><tbody>${rows.slice(0, limit).map(r =>
    `<tr><td>${esc(r.date)}</td><td>${esc(r.label)}</td><td>${esc(r.desc)}</td><td>${esc(r.cat)}</td><td>${esc(r.type || '')}</td><td class="num">${money(r.amount)}</td><td class="muted small">${r.stamps.join(' ')}</td></tr>`).join('')}</tbody></table>${rows.length > limit ? `<p class="muted">… ${rows.length - limit} more</p>` : ''}`;
}

/* What each page reads, in words — the calculation beside the number. */
function pageCalcs(view, G) {
  const S = G.summary, U = G.used, B = G.budget, F = G.figures, W = G.worth, H = G.health.metrics;
  const period = [
    ['Income (so far)', money(S.income), 'BUDGET lens: income-typed rows, start..asOf'],
    ['Gross spend (so far)', money(S.spend), 'BUDGET lens: every outflow not income-typed, refunds NOT netted'],
    ['Set-aside spent', money(S.setAside), 'outflows under savings/investment-typed categories, inside gross spend'],
    ['Assume-spent provision', money(U.assumed), 'Σ max(budget, real) − real over assume-spent envelopes'],
    ['Budget used: spent', money(U.spent), 'max(0, spend − setAside) + assumed  (ADR-0005)'],
    ['Budget: spend envelopes', money(B.spend), 'budgetTotalsOf — income and set-aside types out'],
    ['Budget: set-aside envelopes', money(B.setAside), 'savings/investment-typed rows of the budget'],
    ['Budget: income', money(B.income), 'income-typed rows of the budget'],
    ['Whole plan', money(F.planTotal), 'spend + set-aside envelopes'],
    ['Budget used %', pct(U.used == null ? null : U.used * 100), 'spent / spend envelopes'],
    ['Allocated of income %', pct(F.allocated == null ? null : F.allocated * 100), 'whole plan / budget income'],
    ['Net (so far)', money(S.net), 'Σ kept amounts under BUDGET'],
    ['Deficit', money(G.deficit), '0 − net'],
    ['Donut total (Σ split)', money(F.split.reduce((t, r) => t + r.amount, 0)), 'named, non-income, non-transfer categories whose net is an outflow'],
    ['Gap: uncategorised', money(F.gap.uncat), 'gross outflows with no category'],
    ['Gap: netted refunds', money(F.gap.netted), 'gross spend − Σ split − uncategorised'],
    ['Funded from savings', money(F.fundedFromSavings.spend), `outflows from earmarked accounts, ${F.fundedFromSavings.count} rows, held out of spend`],
    ['Scheduled (rest of period)', `${money(F.scheduled.spend)} spend · ${money(F.scheduled.income)} income`, `${F.scheduled.count} rows dated after asOf`],
    ['Moved to funds', money(G.moved), 'movedToFunds(p)'],
    ['Monthly income', `${money(G.income.income)} over ${G.income.months} month(s)`, G.income.complete ? 'complete window' : 'partial — running period'],
  ];
  const balance = [
    ['Net worth', money(W.implied.net), 'worth(impliedAccounts, debts, assets, owed): positive balances + assets + owed − negative balances − active debts'],
    ['In accounts (implied)', money(W.implied.ownedAccounts - W.implied.fromAccounts), 'balances rolled forward from the stated balance by the rows after its date'],
    ['In accounts (stated)', money(W.naive.statedPositive - W.naive.statedNegative), 'the balance: line of each account file'],
    ['Reconcile drift', money(W.driftSum), 'Σ implied − stated over accounts in state "drift"'],
    ['Assets', money(W.implied.ownedAssets), 'Assets.md, home currency'],
    ['Owed to you', money(W.implied.ownedOwed), 'Owed Money.md, unsettled outstanding'],
    ['Debts', money(W.implied.fromDebts), 'Debts.md, active, home currency'],
    ['Savings-type accounts (stated / implied)', `${money(W.byTypeStated.savings || 0)} / ${money(W.byTypeImplied.savings || 0)}`, 'accountsOfType savings'],
    ['Investment-type accounts (stated / implied)', `${money(W.byTypeStated.investment || 0)} / ${money(W.byTypeImplied.investment || 0)}`, 'accountsOfType investment'],
  ];
  const health = Object.entries(H).filter(([, v]) => isNum(v)).map(([k, v]) => [k, Math.abs(v) < 5 && !Number.isInteger(v) ? v.toFixed(4) : money(v), 'healthSnapshot().metrics']);
  const household = [
    ['HOUSEHOLD consumption', money(G.lenses.soFar.HOUSEHOLD.consumption), 'net per category, excluded and non-budget rows KEPT, pass-throughs and split parents dropped'],
    ['HOUSEHOLD fixed', money(G.lenses.soFar.HOUSEHOLD.fixed), 'categories flagged fixed'],
    ['HOUSEHOLD net income', money(G.lenses.soFar.HOUSEHOLD.netIncome), 'income-typed categories netting positive'],
  ];
  const map = {
    dashboard: [...period, ...balance, ...health.slice(0, 8)],
    budgets: period,
    report: [...period, ...balance],
    score: [...period.slice(0, 11), ...household, ...balance.slice(0, 1), ...health],
    transactions: [
      ['Rows in period (all)', String(G.oracle.whole.all.rows), 'no veto applies on this page'],
      ['Σ amounts (all rows)', money(G.oracle.whole.all.sum), 'excluded and split parents included'],
      ['Σ without split parents', money(G.oracle.whole.all.sumNoParents), 'the money that moved'],
      ['Excluded rows', String(G.oracle.whole.all.excluded), ''], ['Split parents / parts', `${G.oracle.whole.all.splitParents} / ${G.oracle.whole.all.splitParts}`, ''],
    ],
    savings: balance,
    accounts: [...balance, ...Object.entries(W.byTypeStated).map(([t, v]) => [`Σ stated: ${t}`, money(v), 'by account type']), ...Object.entries(W.byOwnerStated).map(([o, v]) => [`Σ stated: owner ${o}`, money(v), 'by owner'])],
    assets: [balance[4], ...G.assets.map(a => [a.name, money(a.value), `${a.type || ''}${a.foreign ? ' · foreign, held out' : ''}`])],
    owed: [balance[5], ['Total lent', money(G.owedTotals.lent), 'Σ amount'], ...G.owed.map(o => [o.who, `${money(o.amount)} → ${money(o.outstanding)} outstanding`, o.settled ? 'settled' : 'open'])],
    debts: [balance[6], ...G.debts.rows.map(d => [d.name, money(d.balance), `rate ${d.rate ?? '—'} · payment ${money(d.payment)}`])],
    services: [['Services on file', String(G.services.length), 'the page projects each onto a monthly and yearly figure']],
    plan: [['Standalone', '—', 'the Plan page reads its own Plans/ files; checks below are its internal identities']],
    loans: [['Standalone', '—', 'calculator over the form inputs; checks below are the table\'s internal identities']],
    tax: [['Standalone', '—', 'reads Tax/ files; percentages only on this vault']],
    notes: [], import: [],
  };
  return map[view] || [];
}

function html({ G, pages, checks, matrix, vaultLabel, version, generated, cmd }) {
  const counts = { pass: 0, fail: 0, info: 0, unverified: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  const fails = checks.filter(c => c.status === 'fail');
  const infos = checks.filter(c => c.status === 'info');
  const unv = checks.filter(c => c.status === 'unverified');
  const totalFigs = pages.reduce((t, p) => t + p.figures.length, 0);
  const byPage = view => checks.filter(c => c.page === view);

  const css = `
  :root{--bg:#0f1115;--panel:#171a21;--panel-2:#1d212b;--line:#2a2f3a;--ink:#e7eaf0;--muted:#9aa3b2;--muted-2:#6f81a3;--accent:#5b9dff;--accent-2:#7c5cff;--crit:#f06464;--warn:#f5a524;--ok:#3ecf8e;--info:#5bb8ff;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--radius:12px;--maxw:1280px}
  *{box-sizing:border-box} html{scroll-behavior:smooth}
  body{margin:0;background:linear-gradient(180deg,#0c0e12,var(--bg) 240px);color:var(--ink);font-family:var(--sans);line-height:1.5;font-size:15px;padding-bottom:4rem}
  main{max-width:var(--maxw);margin:0 auto;padding:40px 24px 96px} a{color:var(--accent)}
  header.hero{padding:8px 0 24px;border-bottom:1px solid var(--line);margin-bottom:28px}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
  h1{font-size:30px;line-height:1.15;margin:10px 0 8px;letter-spacing:-.02em} h1 .accent{color:var(--accent-2)}
  .lede{color:var(--muted);font-size:16px;max-width:80ch;margin:0}
  h2{font-size:22px;margin:44px 0 12px;letter-spacing:-.01em;border-left:3px solid var(--accent);padding-left:.6rem}
  h3{font-size:16px;margin:22px 0 8px;color:var(--muted)}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0;list-style:none;padding:0}
  .toc a{font-size:13px;color:var(--muted);text-decoration:none;border:1px solid var(--line);padding:5px 11px;border-radius:999px}
  .toc a:hover{color:var(--ink);border-color:var(--accent)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;margin:14px 0}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
  .stat .v{font-size:28px;font-weight:700;letter-spacing:-.02em} .stat .l{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.06em}
  .stat.fail .v{color:var(--crit)} .stat.pass .v{color:var(--ok)} .stat.unverified .v{color:var(--warn)}
  code,.addr,.src{font-family:var(--mono);font-size:.84em} .addr{color:var(--muted-2);word-break:break-all} .src{color:var(--muted-2);font-size:11.5px;word-break:break-all}
  table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13.5px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted-2);font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.kv th{text-transform:none;letter-spacing:0;font-size:13.5px;color:var(--ink);font-weight:500;width:34%}
  table.kv td.num{text-align:left;font-weight:600}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
  .pill.pass{background:rgba(62,207,142,.15);color:var(--ok)} .pill.fail{background:rgba(240,100,100,.18);color:var(--crit)} .pill.unverified{background:rgba(245,165,36,.16);color:var(--warn)} .pill.info{background:rgba(91,184,255,.16);color:var(--info)}
  .stat.info .v{color:var(--info)}
  tr.st-fail td{background:rgba(240,100,100,.05)}
  .why{color:var(--info);font-size:12.5px;margin-top:3px} .muted{color:var(--muted)} .small{font-size:12.5px}
  details{border:1px solid var(--line);border-radius:var(--radius);padding:8px 14px;margin:10px 0;background:var(--panel-2)}
  summary{cursor:pointer;font-weight:600;color:var(--ink)} summary .muted{font-weight:400}
  a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}
  .tools input{background:#10131a;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:14px;min-width:280px}
  .tools button,.tools label{background:var(--panel-2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer}
  .matrix td.hit{color:var(--ok);text-align:center} .matrix td.miss{color:#3a4050;text-align:center}
  .matrix th.rot{writing-mode:vertical-rl;transform:rotate(180deg);text-align:left;padding:8px 4px;font-size:11px}
  body.money-only tr[data-kind="number"],body.money-only tr[data-kind="percent"]{display:none}
  .ctx{color:var(--muted);max-width:420px;font-size:12.5px}
  .card-fail{border-left:3px solid var(--crit);padding-left:12px;margin:10px 0}
  footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted-2);font-size:13px}
  .scroll{overflow-x:auto}
  `;

  const pageSections = pages.map(p => {
    const calcs = pageCalcs(p.view, G);
    const list = byPage(p.view);
    const f = list.filter(c => c.status === 'fail').length;
    return `<section id="page-${p.view}" class="page">
      <h2>${esc(p.view)} <span class="muted small">· ${p.figures.length} figures rendered · ${list.length} checks${f ? ` · <span style="color:var(--crit)">${f} differ</span>` : ''}</span></h2>
      ${p.error ? `<p class="card-fail">The view threw while rendering: <code>${esc(p.error)}</code></p>` : ''}
      ${calcs.length ? `<h3>Calculations this page reads</h3><div class="scroll">${kv(calcs)}</div>` : ''}
      <h3>Checks against the global totals</h3><div class="scroll">${checksTable(list)}</div>
      <details><summary>Every figure rendered on this page <span class="muted">(${p.figures.length} — money ${p.figures.filter(x => x.kind === 'money').length}, percent ${p.figures.filter(x => x.kind === 'percent').length}, number ${p.figures.filter(x => x.kind === 'number').length})</span></summary>
        <div class="scroll">${figuresTable(p.figures)}</div></details>
    </section>`;
  }).join('\n');

  const L = G.lenses.soFar;
  const matrixHtml = `<div class="scroll"><table class="matrix"><thead><tr><th>Global figure</th><th class="num">Value</th>${pages.map(p => `<th class="rot">${esc(p.view)}</th>`).join('')}</tr></thead><tbody>${matrix.map(r =>
    `<tr><th>${esc(r.name)}</th><td class="num">${money(r.value)}</td>${r.pages.map(c => `<td class="${c.hit ? 'hit' : 'miss'}" title="${esc(c.address)}">${c.hit ? '●' : '·'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Budget Vault — Page vs Global Reconciliation</title>
<style>${css}</style>
</head>
<body>
<main>
  <header class="hero">
    <div class="eyebrow">Budget Vault ${esc(version)} · numbers reconciliation · LOCAL ONLY, gitignored</div>
    <h1>Every page, <span class="accent">one set of totals</span></h1>
    <p class="lede">The real view modules were mounted over <b>${esc(vaultLabel)}</b> and rendered for <b>${esc(G.meta.periodTitle)}</b>
      (${esc(G.meta.start)} → ${esc(G.meta.end)}, figures close at <b>${esc(G.meta.asOf)}</b>, clock pinned to ${esc(G.meta.today)}).
      Each page's rendered figures are checked against the seams it reads and against an independent oracle that re-adds the raw rows without ledger.js.</p>
    <nav aria-label="Contents"><ul class="toc">
      <li><a href="#findings">Findings</a></li><li><a href="#global">Global totals</a></li><li><a href="#matrix">Where each figure appears</a></li>
      ${pages.map(p => `<li><a href="#page-${p.view}">${esc(p.view)}</a></li>`).join('')}
    </ul></nav>
  </header>

  <div class="stats">
    <div class="stat pass"><div class="v">${counts.pass}</div><div class="l">checks agree</div></div>
    <div class="stat fail"><div class="v">${counts.fail}</div><div class="l">checks differ</div></div>
    <div class="stat info"><div class="v">${counts.info}</div><div class="l">differ by documented rule</div></div>
    <div class="stat unverified"><div class="v">${counts.unverified}</div><div class="l">could not verify</div></div>
    <div class="stat"><div class="v">${totalFigs}</div><div class="l">figures rendered</div></div>
    <div class="stat"><div class="v">${pages.length}</div><div class="l">pages</div></div>
    <div class="stat"><div class="v">${G.oracle.whole.all.rows}</div><div class="l">rows in period</div></div>
  </div>

  <div class="tools">
    <input id="q" type="search" placeholder="Filter rows and checks (text, address, category)…" aria-label="Filter">
    <label><input type="checkbox" id="moneyOnly" checked> money figures only</label>
    <button type="button" id="openAll">Expand all</button><button type="button" id="closeAll">Collapse all</button>
  </div>

  <section id="findings">
    <h2>Findings <span class="muted small">· ${fails.length} differences, ${unv.length} unverified</span></h2>
    ${fails.length ? `<div class="scroll">${checksTable(fails)}</div>` : '<p class="muted">Every check that could be made agrees to the cent (or to the rounding the page prints).</p>'}
    ${infos.length ? `<h3>Differences by documented rule <span class="muted">(${infos.length}) — two bases or two windows, printed on purpose; the question is whether each page says so</span></h3><div class="scroll">${checksTable(infos)}</div>` : ''}
    ${unv.length ? `<details><summary>Could not verify <span class="muted">(${unv.length}) — a figure was not found at the address the check expects, or the seam returned null</span></summary><div class="scroll">${checksTable(unv)}</div></details>` : ''}
    <div class="panel small muted">A <b>fail</b> is a page figure that does not equal the global figure the check names. Where the difference equals one of the documented gaps
      (reconcile drift, set-aside, assume-spent, netted refunds, uncategorised spend, money funded from savings, scheduled rows), that gap is named beside the Δ —
      those are two rules printing two readings on purpose, and the question is whether the page says so. A difference with no named gap is the bug shape this repo keeps finding.</div>
  </section>

  <section id="global">
    <h2>Global totals</h2>
    <div class="panel"><h3 style="margin-top:0">Household</h3>
      ${kv([['Vault', esc(vaultLabel)], ['Currency', esc(G.meta.currency)], ['Period', `${esc(G.meta.period)} — ${esc(G.meta.start)} → ${esc(G.meta.end)}`, G.meta.running ? 'running' : 'finished'], ['Figures close at', esc(G.meta.asOf)],
        ['Month start day / cycle days', `${esc(G.settings.month_start_day)} / ${esc(G.settings.period_days ?? 0)}`], ['Owners', esc(G.settings.owners || '')],
        ['Files loaded', `${G.census.txFiles} transaction files · ${G.census.txRows} rows · ${G.census.accounts} accounts · ${G.census.categories} categories · ${G.census.budgets} budgets · ${G.census.assets} assets · ${G.census.owed} owed · ${G.census.services} services · ${G.census.debts} debts`]])}</div>

    <h3>The four lenses over the same rows (start → asOf)</h3>
    <div class="scroll">${lensTable(L)}</div>
    <details><summary>Whole period (start → end), the scheduled remainder included</summary><div class="scroll">${lensTable(G.lenses.whole)}</div></details>

    <h3>Independent oracle vs the ledger</h3>
    <div class="scroll">${kv([
      ['Oracle BUDGET income / spend / net', `${money(G.oracle.soFar.budget.income)} / ${money(G.oracle.soFar.budget.spend)} / ${money(G.oracle.soFar.budget.net)}`, 'this script\'s own loop: drop excluded, non-budget, foreign, earmarked outflow, transfer'],
      ['Ledger BUDGET income / spend / net', `${money(L.BUDGET.income)} / ${money(L.BUDGET.spend)} / ${money(L.BUDGET.net)}`, 'tally(ledger(start, asOf), BUDGET)'],
      ['Oracle set-aside spent', money(G.oracle.soFar.budget.setAside), 'outflows under savings/investment-typed categories'],
      ['All rows Σ / inflow / outflow', `${money(G.oracle.soFar.all.sum)} / ${money(G.oracle.soFar.all.inflow)} / ${money(G.oracle.soFar.all.outflow)}`, `${G.oracle.soFar.all.rows} rows, ${G.oracle.soFar.all.excluded} excluded, ${G.oracle.soFar.all.splitParents} split parents`],
    ])}</div>

    <h3>Period figures (what Dashboard, Budget and Report read)</h3>
    <div class="scroll">${kv(pageCalcs('report', G))}</div>

    <h3>Global checks</h3>
    <div class="scroll">${checksTable(byPage('global'))}</div>

    <details><summary>Rows BUDGET drops that HOUSEHOLD keeps <span class="muted">(${G.lensDiff ? G.lensDiff.HOUSEHOLD.length : 0}) — why the Score's pillars differ from the hero</span></summary>${rowsTable(G.lensDiff ? G.lensDiff.HOUSEHOLD : [])}</details>
    <details><summary>Rows HOUSEHOLD drops that BUDGET keeps <span class="muted">(${G.lensDiff ? G.lensDiff.BUDGET.length : 0})</span></summary>${rowsTable(G.lensDiff ? G.lensDiff.BUDGET : [])}</details>
    <details><summary>Every row the BUDGET lens holds out of the hero <span class="muted">(${G.droppedByBudget.length})</span></summary>${rowsTable(G.droppedByBudget)}</details>
    <details><summary>Budget vs actual rows (periodFigures.rows) <span class="muted">(${G.figures.rows.length})</span></summary><div class="scroll"><table><thead><tr><th>Category</th><th>Type</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Remaining</th><th>Flags</th></tr></thead><tbody>${G.figures.rows.map(r =>
      `<tr><td>${esc(r.cat)}</td><td>${esc(r.type)}</td><td class="num">${money(r.budget)}</td><td class="num">${money(r.actual)}</td><td class="num">${money(r.remaining)}</td><td class="muted small">${[r.assumed ? 'assumed' : '', r.unbudgeted ? 'unbudgeted' : '', r.over ? 'over' : '', r.near ? 'near' : ''].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody></table></div></details>
    <details><summary>Accounts: stated, implied, reconcile state and this period's activity <span class="muted">(${G.accounts.length})</span></summary><div class="scroll"><table><thead><tr><th>Account</th><th>Type</th><th>Owner</th><th>Flags</th><th class="num">Stated</th><th class="num">Implied</th><th class="num">Δ</th><th>State</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th><th class="num">Rows</th></tr></thead><tbody>${G.accounts.map(a =>
      `<tr><td>${esc(a.name)}</td><td>${esc(a.type)}</td><td>${esc(a.owner)}</td><td class="muted small">${[a.foreign ? a.symbol : '', a.inBudget ? '' : 'budget:false', a.pool ? 'pool' : '', a.earmarked ? 'earmarked' : ''].filter(Boolean).join(' ')}</td><td class="num">${a.statedRaw != null ? `<span class="muted">unreadable: ${esc(a.statedRaw)}</span>` : money(a.stated)}</td><td class="num">${money(a.implied)}</td><td class="num">${isNum(a.implied) && isNum(a.stated) ? money(a.implied - a.stated) : '—'}</td><td>${esc(a.rec.state || '')}</td><td class="num">${money(a.activity.inAmt)}</td><td class="num">${money(a.activity.outAmt)}</td><td class="num">${money(a.activity.net)}</td><td class="num">${a.activity.count}</td></tr>`).join('')}</tbody></table></div></details>
    <details><summary>Health snapshot (Score, Dashboard health card, Report)</summary><div class="scroll">${kv(Object.entries(G.health.metrics).map(([k, v]) => [k, isNum(v) ? (Math.abs(v) < 5 && !Number.isInteger(v) ? v.toFixed(4) : money(v)) : esc(String(v))]))}
      ${kv([['target months', String(G.health.target)], ['debt interest / month', money(G.health.debtInterest)], ['debts recorded', String(G.health.debtsRecorded)], ['earmarks', esc(JSON.stringify(G.health.earmarks))]])}</div></details>
  </section>

  <section id="matrix">
    <h2>Where each global figure appears</h2>
    <p class="muted small">A dot means a money figure on that page equals the global value (to the rounding the page prints). A figure that appears on no page is computed and never shown; a figure on many pages is one the reader can cross-check by eye.</p>
    ${matrixHtml}
  </section>

  ${pageSections}

  <footer>
    <p>Generated ${esc(generated)} by <code>${esc(cmd)}</code> · plugin ${esc(version)} · self-contained, no network at runtime.
      This file embeds real balances and transactions — it lives under <code>tests/figures/live/</code>, which is gitignored. Do not commit it.</p>
  </footer>
</main>
<script>
(function(){
  var q=document.getElementById('q'), body=document.body, mo=document.getElementById('moneyOnly');
  function apply(){
    var s=(q.value||'').trim().toLowerCase();
    body.classList.toggle('money-only', mo.checked);
    var rows=document.querySelectorAll('table.figs tbody tr, table.checks tbody tr, table.rows tbody tr, table.kv tbody tr, table.matrix tbody tr');
    for(var i=0;i<rows.length;i++){ var r=rows[i]; r.style.display = (!s || r.textContent.toLowerCase().indexOf(s)>=0) ? '' : 'none'; }
  }
  q.addEventListener('input', apply); mo.addEventListener('change', apply); apply();
  document.getElementById('openAll').addEventListener('click', function(){ document.querySelectorAll('details').forEach(function(d){ d.open=true; }); });
  document.getElementById('closeAll').addEventListener('click', function(){ document.querySelectorAll('details').forEach(function(d){ d.open=false; }); });
})();
</script>
</body>
</html>`;
}

/* ---- main --------------------------------------------------------------- */
/* Guarded so `require()`ing this file gives you reconcile() without running a
   whole reconciliation and writing a page — tests/reconcile-gate.test.cjs
   imports it. */
if (require.main === module) (async () => {
  /* --household runs over the committed fixture; everything else reads a real
     vault off disk. The fixture path writes its output beside the live one but
     under a different name, because only the live page holds real balances. */
  const useHousehold = !!flag('household');
  const H = useHousehold ? householdVault() : null;
  const abs = useHousehold ? 'tests/figures/household.cjs (synthetic)' : resolveBudgetFolder();
  if (!useHousehold && !fs.existsSync(abs)) { console.error(`No such budget folder: ${abs}`); process.exit(1); }
  const budgetFolder = useHousehold ? H.budgetFolder : path.basename(abs);
  let files;
  if (useHousehold) files = H.files;
  else {
    files = {};
    for (const [k, v] of Object.entries(readVault(abs))) files[`${budgetFolder}/${k}`] = v;
  }
  const today = String(flag('today') || (useHousehold ? H.today : localToday()));
  const defaultOut = useHousehold ? 'reconcile-household.html' : 'reconcile.html';
  const out = path.resolve(String(flag('out') || path.join(__dirname, '..', 'tests', 'figures', 'live', defaultOut)));
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).version;

  {
    const t0 = Date.now();
    const wantPeriod = flag('period') || (useHousehold ? H.period : null);
    const { G, pages, checks, matrix, period } = await reconcile({ files, budgetFolder, today, period: wantPeriod });
    const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' (pinned clock)';
    const page = html({ G, pages, checks, matrix, vaultLabel: abs, version, generated, cmd: `node scripts/reconcile-page.cjs ${argv.join(' ')}` });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, page);
    /* A machine-readable twin beside the page, for diffing two runs. */
    fs.writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify({ G, checks, matrix, pages: pages.map(p => ({ view: p.view, error: p.error, figures: p.figures })) }, null, 1));

    const c = { pass: 0, fail: 0, info: 0, unverified: 0 };
    for (const k of checks) c[k.status]++;
    console.log(`# ${abs}\n# period ${period} (${G.meta.start} → ${G.meta.end}), asOf ${G.meta.asOf}, today ${today}, ${Object.keys(files).length} files, ${Date.now() - t0}ms`);
    console.log(`# ${pages.reduce((t, p) => t + p.figures.length, 0)} figures across ${pages.length} pages; checks: ${c.pass} pass, ${c.fail} fail, ${c.info} differ by documented rule, ${c.unverified} unverified`);
    for (const k of checks.filter(x => x.status !== 'pass')) {
      console.log(`${k.status.toUpperCase().padEnd(10)} ${k.page.padEnd(12)} ${k.name}: page=${k.pageValue} global=${k.globalValue}${k.delta != null ? ` Δ=${k.delta}` : ''}${k.why && k.why.length ? `  [Δ = ${k.why.join(' | ')}]` : ''}`);
    }
    console.log(`\n→ ${out}`);
  }
})().catch(e => { console.error(e); process.exit(1); });

/* The reconciliation as a function, and the fixture it can run over without a
   real vault — see tests/reconcile-gate.test.cjs. */
module.exports = { reconcile, householdVault };
