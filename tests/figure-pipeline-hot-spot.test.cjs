'use strict';
/* The measured hot spot in the figure pipeline, guarded by COUNTS rather than
   by a stopwatch (2026-11-11 audit, task 9).

   The audit profiled a Dashboard paint over five years of history (60 months
   x 300 rows) and found the date-validity check was 41% of render CPU:
   isRealIsoDate split the string, built a Date and read it back for every row
   inside reconcile() — 162 317 calls per paint — and bookFigures() reconciled
   every account and then had balanceBook → impliedAccounts reconcile them all
   again, 24 reconcile() calls per paint over three accounts.

   A timing assertion would flake on a loaded CI box and say nothing useful
   when it did. What made the paint slow is countable, so this counts:

     1. isRealIsoDate does its Date arithmetic ONCE per distinct string, and
        gives the answer the uncached rule gives — on every calendar shape,
        on junk, before and after the cache has turned over;
     2. its cache is bounded, and holds nothing for a value that could never
        be a date;
     3. bookFigures() reconciles each account exactly once, and the implied
        balance book it hands back is still impliedAccounts()'s own;
     4. one Dashboard paint reconciles each account at most four times — a
        ratchet (it was eight), which may only come down.

   What is deliberately NOT here: a memo of bookFigures() across calls. The
   audit suggested "once per load and day"; section 5 pins why that is not
   safe as things stand — a figure has to move on an edit that never reloads.

     node tests/figure-pipeline-hot-spot.test.cjs */
const assert = require('assert');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* reconcile() is counted where the module is LOADED, not on one module
   object: period.js and figures.js take it at require time, and the figures
   harness purges src/ from the require cache on every mount (so the money
   recorder reaches each view), which would leave a wrapper installed on the
   first copy counting nothing. */
const Module = require('module');
const realLoad = Module._load;
let reconciles = 0;
Module._load = function (request, parent, isMain) {
  const exports = realLoad.apply(this, arguments);
  if (exports && typeof exports.reconcile === 'function' && !exports.__counted
    && /[\\/]src[\\/]reconcile(\.js)?$/.test(Module._resolveFilename(request, parent, isMain))) {
    const real = exports.reconcile;
    exports.reconcile = function (...args) { reconciles++; return real.apply(this, args); };
    exports.__counted = true;
  }
  return exports;
};

const dates = require('../src/dates');
const { isRealIsoDate, REAL_DATE_CACHE_MAX, realDateCacheSize } = dates;

/* The rule as it was written before the cache, restated here so the memo is
   checked against something that is not itself. */
function oracle(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(t)) return false;
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() + 1 === m && back.getUTCDate() === d;
}

/* How many times the Date arithmetic actually ran: the check builds exactly
   one `Date.UTC` per computed answer, and nothing else in a call does. */
function countingUtc(fn) {
  const real = Date.UTC;
  let n = 0;
  Date.UTC = function (...a) { n++; return real.apply(this, a); };
  try { fn(); } finally { Date.UTC = real; }
  return n;
}

/* ---- 1. once per distinct string, and the same answer -------------------- */
{
  ok(typeof REAL_DATE_CACHE_MAX === 'number' && REAL_DATE_CACHE_MAX >= 366 * 10,
    `the bound is a real number that holds at least a decade of distinct days (${REAL_DATE_CACHE_MAX})`);

  const n = countingUtc(() => { for (let i = 0; i < 1000; i++) isRealIsoDate('2031-03-17'); });
  ok(n <= 1, `1 000 checks of one date run the Date arithmetic once, not 1 000 times (ran ${n})`);

  /* Every date-shaped string over a century of years, months 00–14 and days
     00–32 — so month 13, day 0, 30 February and 29 February in and out of leap
     years are all in it — asked twice: once cold, once from the cache. */
  let disagree = 0, asked = 0;
  for (const pass of [1, 2]) {
    for (let y = 1999; y <= 2100; y++) for (let m = 0; m <= 14; m++) for (let d = 0; d <= 32; d++) {
      const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      asked++;
      if (isRealIsoDate(s) !== oracle(s)) disagree++;
    }
    eq(disagree, 0, `pass ${pass}: the cached answer is the uncached rule's answer on every one of ${asked / pass} shapes`);
  }
  for (const junk of ['', 'end of June', '2026-13-05', '2026-02-30', '2026-2-3', '20260203', '2026-02-03T10:00', ' 2026-02-03',
    '0000-01-01', '9999-12-31', '2024-02-29', '2023-02-29', '1900-02-29', '2000-02-29', null, undefined, 20260203, {}, [], true]) {
    eq(isRealIsoDate(junk), oracle(junk), `isRealIsoDate(${JSON.stringify(junk)}) is ${oracle(junk)}, as before`);
    eq(isRealIsoDate(junk), oracle(junk), 'and the same when asked again');
  }
}

/* ---- 2. bounded, and it keeps only what could be a date ------------------ */
{
  const before = realDateCacheSize();
  for (const junk of ['', 'end of June', 'a much longer cell that somebody pasted a paragraph into', '2026-2-3', null, undefined, 42]) isRealIsoDate(junk);
  eq(realDateCacheSize(), before, 'a value that is not ten characters long is answered without being kept: the cache cannot be filled with pasted prose');

  /* More distinct date-shaped strings than the bound holds. */
  let top = 0;
  for (let i = 0; i < REAL_DATE_CACHE_MAX * 3; i++) {
    const s = `${String(1000 + Math.floor(i / 372)).padStart(4, '0')}-${String(1 + Math.floor((i % 372) / 31)).padStart(2, '0')}-${String(1 + (i % 31)).padStart(2, '0')}`;
    isRealIsoDate(s);
    if (realDateCacheSize() > top) top = realDateCacheSize();
  }
  ok(top <= REAL_DATE_CACHE_MAX, `the cache never holds more than its bound (peaked at ${top} of ${REAL_DATE_CACHE_MAX}) after ${REAL_DATE_CACHE_MAX * 3} distinct strings`);
  ok(top > 0, 'and it did hold something, so the bound above was tested against a cache in use');
  eq(isRealIsoDate('2026-02-30'), false, 'a date asked again after the cache turned over still gets the rule\'s answer');
  eq(isRealIsoDate('2026-02-28'), true, 'in both directions');
  /* Pure: the same argument, the same answer, whatever was asked in between. */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'dates.js'), 'utf8');
  const body = src.slice(src.indexOf('function isRealIsoDate'), src.indexOf('const MIN_PERIOD_DAYS'));
  ok(!/todayIso|new Date\(\)|Date\.now/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')), 'the check reads no clock: its result depends on its argument alone, which is what makes a cache of it safe');
}

/* ---- 3 & 4. one reconcile per account, through the real loader ----------- */
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { householdVault } = require('../scripts/reconcile-page.cjs');

(async () => {
  const H = householdVault();
  const unpin = pinClock(H.today);
  try {
    const M = await mountFor(H.files, { period: H.period, budgetFolder: H.budgetFolder });
    const { ctx, S } = M;
    const accounts = S.accounts.length;
    ok(accounts >= 3, `the household holds several accounts (${accounts})`);

    reconciles = 0;
    const book = ctx.bookFigures();
    eq(reconciles, accounts, `bookFigures() reconciles each account ONCE (${accounts}), not once for the verdicts and again for the implied balances (${accounts * 2})`);

    /* The implied book must still be impliedAccounts()'s — the saved pass may
       not become a second rule for "what an account reads now". */
    const { balanceReadable } = require('../src/figures');
    const { splitByCurrency } = require('../src/currency');
    const viaSeam = splitByCurrency(ctx.impliedAccounts().filter(balanceReadable), S.settings.currency).primary;
    eq(book.balances.implied.accounts.map(a => [a.name, a.balance]), viaSeam.map(a => [a.name, a.balance]),
      'the implied accounts in the balance book are exactly what impliedAccounts() hands back, account for account');
    for (const a of S.accounts) {
      const rec = book.reconciled.get(a);
      const implied = ctx.impliedAccounts().find(x => x.name === a.name);
      eq(implied.balance, rec.state === 'drift' ? rec.implied : a.balance, `${a.name}: implied balance is its own verdict's (${rec.state})`);
    }
    ok(S.accounts.some(a => book.reconciled.get(a).state === 'drift'), 'at least one account has drifted, so the saved pass was not trivially equal to the stated one');

    reconciles = 0;
    ctx.renderDashboard();
    const perPaint = reconciles;
    /* A RATCHET. Eight per account before this change; four now, one for each
       of the four bookFigures() calls the Dashboard's cards make. The number
       comes down when the views share one snapshot per render — it must not
       go up. */
    ok(perPaint <= accounts * 4, `one Dashboard paint reconciles each account at most 4 times (${perPaint} calls over ${accounts} accounts; it was ${accounts * 8})`);
    ok(perPaint >= accounts, 'and it did reconcile, so the ceiling above was measured on a real paint');

    /* ---- 5. why bookFigures() is not memoised across calls ---------------- */
    /* An edit in memory moves the figure on the very next call, with no load
       in between: the Transactions page marks a row and re-renders, and
       accounts.js writes into S.accounts in place. A snapshot kept "per load
       and day" would print the old balance until something reloaded. */
    const drifting = S.accounts.find(a => book.reconciled.get(a).state === 'drift');
    const rows = ctx.accountIndex().get(drifting).rows;
    const before = ctx.bookFigures().balances.implied.net;
    const moved = rows.find(r => r.date > drifting.balance_updated && r.date <= H.today);
    ok(moved, 'the drifting account has a row dated after its balance');
    moved.amount -= 123.45;
    const after = ctx.bookFigures().balances.implied.net;
    eq(Math.round((after - before) * 100), -12345, 'a row edited in memory moves the implied net on the next bookFigures() call — no reload, no stale snapshot');
    moved.amount += 123.45;
    const stated = drifting.balance;
    drifting.balance = stated + 1000;
    eq(Math.round((ctx.bookFigures().balances.stated.net - book.balances.stated.net) * 100), 100000, 'and so does a balance typed into the account in place');
    drifting.balance = stated;

    M.restore();
  } finally { unpin(); Module._load = realLoad; }
  console.log(`PASS — the figure pipeline's hot spot: one date computation per distinct string (bounded), one reconcile per account per bookFigures() (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
