'use strict';
/* The ledger and its lenses. Phase 2 of ADR-0006.

   Every figure this plugin prints about a period is a sum over transaction
   rows, and on 1.38.0 there were five separate loops deciding WHICH rows,
   each with its own subset of the vetoes. Here the deciding and the adding
   are separated, and each is done once:

     stamp(rows, env)      every row is marked, once, with every reason it
                           might be held out of a total
     tally(stamped, LENS)  one loop, summing the rows a lens keeps

   A lens is data — the stamps it drops and the sign rule it sums under — so
   two figures can differ only by the lens they were taken under, and the
   difference is a list of named rows (lensDifference) rather than an
   argument between two comments. The lenses in LENSES are the ones that
   exist; a new one is a new entry here and nothing else.

   Behaviour-preserving on purpose: summaryInRange (period.js), periodSpend
   (trend-math.js) and the household walk in health-data.js are re-expressed
   as tallies under BUDGET, TREND and HOUSEHOLD, and every figure they hand
   back is the same to the cent. Where two of them disagree, the disagreement
   is now visible as a difference between two lens rows below; whether to
   close it is a product decision for a later phase, not a side effect of
   this one.

   Pure on purpose: no DOM, no ctx, no `require('obsidian')`. The env a caller
   hands to stamp() is the only way household facts reach it. */

const { isSetAsideType } = require('./vocabulary');
const { splitRole, SPLIT_PARENT, SPLIT_PART } = require('./tx-role');

/* ------------------------------------------------------------------------
   Stamps
   ------------------------------------------------------------------------ */

/* The key two rows must share to be the two legs of one pass-through. Kept
   identical to health-data.js's former rowKey so the pairing is unchanged. */
const rowKey = r => `${r.label}|${r.date}|${(r.amount || 0).toFixed(2)}|${r.desc || ''}`;

/* Pass-through pairing, exactly as health-data.js did it: among EXCLUDED
   rows, an outflow on one label and an equal inflow on another, each used at
   most once. Returns the keys of every paired row. */
function passthroughPairs(rows) {
  const drop = new Set();
  const ex = (rows || []).filter(r => r && r.excluded
    && typeof r.amount === 'number' && r.amount);
  const used = new Array(ex.length).fill(false);
  for (let i = 0; i < ex.length; i++) {
    if (used[i]) { continue; }
    for (let j = i + 1; j < ex.length; j++) {
      if (used[j]) { continue; }
      const a = ex[i], b = ex[j];
      if (a.label === b.label) { continue; }
      if (Math.abs(a.amount + b.amount) > 0.005) { continue; }
      used[i] = true; used[j] = true;
      drop.add(rowKey(a)); drop.add(rowKey(b));
      break;
    }
  }
  return drop;
}

/* The stamps a lens may drop on, in the order the former walks applied them. */
const STAMPS = Object.freeze(['excluded', 'nonBudget', 'foreign', 'earmarkedOut', 'transfer', 'passthrough', 'splitParent', 'splitPart']);

/* Stamp every row once.

   env:
     nonBudgetLabels  Set   labels of accounts with `budget: false`
     foreignLabels    Map   label → symbol, for accounts in another currency
     earmarkedLabels  Set   labels of accounts holding an earmark
     catType(name)          the category file's live type, or null
     catKnown(name)         whether a category file answers to the name
     fixedCats        Set   category names flagged `fixed` (optional)

   Each stamped row keeps `row` (the original) and the fields a tally reads,
   so nothing downstream touches the raw row again. */
function stamp(rows, env) {
  const e = env || {};
  const nonBudget = e.nonBudgetLabels || new Set();
  const foreign = e.foreignLabels || new Map();
  const earmarked = e.earmarkedLabels || new Set();
  const fixed = e.fixedCats || new Set();
  const catType = e.catType || (() => null);
  const catKnown = e.catKnown || (() => false);
  /* Paired over HOME rows only, as health-data.js's walk always did: a
     foreign account's excluded row is not the other leg of anything the
     household's own figures count. */
  const paired = passthroughPairs((rows || []).filter(r => r && !foreign.has(r.label)));
  const out = [];
  for (const r of rows || []) {
    if (!r) continue;
    const amount = typeof r.amount === 'number' ? r.amount : Number(r.amount) || 0;
    const cat = r.cat || '';
    const type = catType(r.cat);
    const role = splitRole(r.split);
    out.push({
      row: r,
      label: r.label, date: r.date, amount, cat, type,
      known: !!cat && catKnown(r.cat),
      excluded: !!r.excluded,
      nonBudget: nonBudget.has(r.label),
      foreign: foreign.has(r.label),
      symbol: foreign.get(r.label) || null,
      /* ISSUE 41: an outflow from an earmarked account is money leaving a
         fund, not spending from the budget. Sign-aware on purpose — a deposit
         INTO the fund is still counted. */
      earmarkedOut: amount < 0 && earmarked.has(r.label),
      transfer: type === 'transfer',
      splitPart: role === SPLIT_PART,
      splitParent: role === SPLIT_PARENT,
      passthrough: paired.has(rowKey(r)),
      setAside: amount < 0 && isSetAsideType(type),
      fixed: fixed.has(cat),
    });
  }
  return out;
}

/* ------------------------------------------------------------------------
   Lenses
   ------------------------------------------------------------------------ */

/* `drop`: stamps that hold a row out. `sign`: 'gross' sums an outflow as
   spend in full and a refund as its own row; 'net' folds refunds into the
   category first and only then reads the category's sign. Every tally
   returns both readings; `sign` records which one the lens's consumers
   print. */
const LENSES = Object.freeze({
  /* "How did I do against my plan." The Dashboard hero, the Budget page,
     the Report, the deficit carry. summaryInRange's own vetoes, in order. */
  BUDGET: Object.freeze({ name: 'BUDGET', drop: Object.freeze(['excluded', 'nonBudget', 'foreign', 'earmarkedOut', 'transfer']), sign: 'gross' }),
  /* The trend chart, the comparison column and the money rail's category
     map. BUDGET under a net sign rule — and WITHOUT the earmarkedOut veto,
     which ISSUE 41 taught summaryInRange and never taught periodSpend. That
     omission is preserved here so no figure moves in this phase; it is now a
     visible difference between two lens rows rather than between two loops,
     and closing it is a named decision for Phase 3. */
  TREND: Object.freeze({ name: 'TREND', drop: Object.freeze(['excluded', 'nonBudget', 'foreign', 'transfer']), sign: 'net' }),
  /* "What actually moved through this household." The Score's pillars.
     Keeps excluded and non-budget rows — a bill paid from a joint account the
     household marked out of the budget is still a bill the emergency fund
     must cover — and drops the second leg of money already counted once.
     `splitParent` is the one correction this phase makes rather than
     preserves: a split's parent row is excluded by construction and its parts
     carry the money, so a lens that keeps excluded rows counted both — one
     R900 purchase split 600/300 read R1 800 in the Score's consumption and
     essential spend on 1.38.0. The parent is not a pass-through (same label,
     so the pairing never saw it); it is a row superseded by its parts, and
     it is dropped by name. tests/ledger-lenses.test.cjs §5b pins it. */
  HOUSEHOLD: Object.freeze({ name: 'HOUSEHOLD', drop: Object.freeze(['foreign', 'transfer', 'passthrough', 'splitParent']), sign: 'net' }),
});

const dropsAnyOf = (lens, s, except) => lens.drop.some(k => k !== except && s[k]);
const keeps = (lens, s) => !dropsAnyOf(lens, s, null);

/* One loop. Returns every figure the three former walks produced, so a
   caller reads the field it needs and nothing computes a second time. */
function tally(stamped, lens) {
  const rows = stamped || [];
  const kept = [];
  const foreignHere = new Map();
  const fundedFromSavings = { spend: 0, count: 0 };
  const dropsForeign = lens.drop.includes('foreign');
  const dropsEarmarked = lens.drop.includes('earmarkedOut');
  /* `count` is the rows the lens kept BEFORE the transfer skip, as both
     summaryInRange and periodSpend counted it: a transfer is a row that
     happened, even though it leaves the arithmetic. */
  let count = 0;
  for (const s of rows) {
    /* Disclosures come off the rows the lens is ABOUT to drop, before the
       drop: the foreign accounts that actually contributed rows, and the
       spend a fund paid for. summaryInRange named both; the identity in
       tests/summary-conservation.test.cjs needs the second. */
    if (!s.excluded && !s.nonBudget) {
      if (dropsForeign && s.foreign) foreignHere.set(s.label, s.symbol);
      if (dropsEarmarked && !s.foreign && s.earmarkedOut && !s.transfer) {
        fundedFromSavings.spend += -s.amount; fundedFromSavings.count++;
      }
    }
    if (dropsAnyOf(lens, s, 'transfer')) continue;
    count++;
    if (s.transfer && lens.drop.includes('transfer')) continue;
    kept.push(s);
  }

  let income = 0, spend = 0, net = 0, setAside = 0, inflow = 0, outflow = 0;
  let uncategorised = 0, uncatSpend = 0, uncatIncome = 0;
  const unknown = { count: 0, spend: 0, income: 0, names: [] };
  const unknownSeen = new Set();
  const byCat = Object.create(null);
  const typeOf = Object.create(null);
  const fixedCat = Object.create(null);
  for (const s of kept) {
    net += s.amount;
    if (s.amount > 0) inflow += s.amount; else outflow += s.amount;
    if (s.setAside) setAside += -s.amount;
    byCat[s.cat] = (byCat[s.cat] || 0) + s.amount;
    typeOf[s.cat] = s.type;
    fixedCat[s.cat] = s.fixed;
    if (!s.cat) {
      uncategorised++;
      if (s.amount < 0) uncatSpend += -s.amount; else uncatIncome += s.amount;
    } else if (!s.known) {
      unknown.count++;
      if (s.amount < 0) unknown.spend += -s.amount; else unknown.income += s.amount;
      if (!unknownSeen.has(s.cat)) { unknownSeen.add(s.cat); unknown.names.push(s.cat); }
    }
    if (s.type === 'income') income += s.amount;
    else if (s.amount < 0) spend += -s.amount;
  }
  /* The net reading: per category first, then the category's own sign.
     A named category that netted a refund contributes nothing to spend, not
     a negative slice; an income-typed or uncategorised bucket is not spend. */
  /* A plain object, as periodSpend's `whole` always was — tests and the trend
     chart compare it structurally. `byCat` above stays null-prototyped, as
     summaryInRange's did, for the category-named-"constructor" case. */
  const spendByCat = {};
  let consumption = 0, fixed = 0, netIncome = 0;
  for (const [cat, amt] of Object.entries(byCat)) {
    const type = typeOf[cat];
    if (cat && type === 'income' && amt > 0) netIncome += amt;
    if (!cat || type === 'income' || type === 'transfer' || amt >= 0) continue;
    spendByCat[cat] = -amt;
    if (!isSetAsideType(type)) consumption += -amt;
    if (fixedCat[cat]) fixed += -amt;
  }
  return {
    lens: lens.name, count, kept,
    income, spend, net, setAside, byCat, inflow, outflow,
    uncategorised, uncatSpend, uncatIncome, unknown,
    foreign: { count: foreignHere.size, labels: [...foreignHere.keys()], symbols: [...new Set(foreignHere.values())] },
    fundedFromSavings,
    spendByCat, consumption, fixed, netIncome,
  };
}

/* The rows two lenses disagree about, by name — what a test asserts a
   difference against, and what a page could one day list. */
function lensDifference(stamped, a, b) {
  const out = { [a.name]: [], [b.name]: [] };
  for (const s of stamped || []) {
    const inA = keeps(a, s), inB = keeps(b, s);
    if (inA && !inB) out[a.name].push(s);
    if (inB && !inA) out[b.name].push(s);
  }
  return out;
}

module.exports = { stamp, tally, LENSES, STAMPS, lensDifference, passthroughPairs, rowKey, keeps };
