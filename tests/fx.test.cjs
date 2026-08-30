'use strict';
/* The exchange-rate engine — src/fx.js, in bare node.

   The point of these assertions is not that the multiplication works. It is
   that every way this feature could print a confident wrong number is closed:

     - an account with no ISO code is NAMED, never converted at par;
     - a code with no rate in the table is NAMED, never counted as zero;
     - a malformed or half-built cache file yields null, so the caller falls
       back to not converting rather than to a made-up figure;
     - a rate dated in the future is stale, not fresh;
     - the toggle being on is not on its own enough to convert.

   src/currency.js's objection to conversion was never the arithmetic, it was
   a figure that forgets when it was true. So the provenance fields are pinned
   as hard as the totals.

     node tests/fx.test.cjs */

const assert = require('assert');
const fx = require('../src/fx');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* Base IDR, the reporter's own vault in issue #28. One rupiah buys these. */
const TABLE = fx.normalizeTable({
  base: 'idr', date: '2026-08-29',
  rates: { CNY: 0.000379, ZAR: 0.000908, EUR: 0.0000524, JUNK: 'x', BAD: -1, ZERO: 0 },
});

/* ------------------------------ normalizeCode ---------------------------- */
eq(fx.normalizeCode('cny'), 'CNY', 'a lower-case hand-edited code is accepted and folded up');
eq(fx.normalizeCode('  ZAR '), 'ZAR', 'and trimmed');
eq(fx.normalizeCode('RMB'), 'RMB', 'three letters is the only test — RMB is wrong, but it is the provider that says so, not us');
eq(fx.normalizeCode('¥'), '', 'a SYMBOL in the code field is not a code');
eq(fx.normalizeCode('US'), '', 'nor is a two-letter country code');
eq(fx.normalizeCode(undefined), '', 'absent is absent, never "UNDEFINED"');

/* ------------------------------ normalizeTable --------------------------- */
ok(TABLE, 'a well-formed payload becomes a table');
eq(TABLE.base, 'IDR', 'the base is normalised like any other code');
eq(TABLE.rates.IDR, 1, 'the base is worth one of itself, stated rather than special-cased');
ok(!('JUNK' in TABLE.rates), 'a non-numeric rate is dropped at the boundary');
ok(!('BAD' in TABLE.rates), 'a negative rate is not a rate');
ok(!('ZERO' in TABLE.rates), 'nor is zero — it would divide the next figure into infinity');

eq(fx.normalizeTable(null), null, 'nothing at all is null, not an empty table');
eq(fx.normalizeTable({ base: 'IDR', rates: { CNY: 1 } }), null, 'a table with no DATE is refused — an undated rate is the exact thing currency.js warned about');
eq(fx.normalizeTable({ base: 'IDR', date: '29 Aug 2026', rates: { CNY: 1 } }), null, 'and a date that is not ISO is not a date');
eq(fx.normalizeTable({ base: '', date: '2026-08-29', rates: { CNY: 1 } }), null, 'a table with no base cannot be cross-rated, so it is refused whole');
eq(fx.normalizeTable({ base: 'IDR', date: '2026-08-29', rates: {} }), null, 'a table holding only its own base can convert nothing and is refused');

/* -------------------------------- rateBetween ---------------------------- */
eq(fx.rateBetween('CNY', 'CNY', TABLE), 1, 'a code is worth one of itself');
eq(fx.rateBetween('XXX', 'IDR', TABLE), null, 'an unknown code has no rate — null, never 1');
eq(fx.rateBetween('CNY', 'XXX', TABLE), null, 'in either direction');
{
  const r = fx.rateBetween('CNY', 'IDR', TABLE);
  ok(Math.abs(r - (1 / 0.000379)) < 1e-6, 'cross-rating through the base is exact: 1 CNY buys 1/0.000379 IDR');
}

/* ---------------------------------- convert ------------------------------ */
{
  const v = fx.convert(3956, 'CNY', 'IDR', TABLE);
  ok(Math.abs(v - 10438000) < 5000, '¥3 956 is about Rp 10.4m, not Rp 3 956');
  eq(fx.convert(3956, 'RMB', 'IDR', TABLE), null,
    'a SYMBOL passed where a code belongs converts to null — never silently through at par, which is issue #28 wearing a conversion\'s clothes');
  eq(fx.convert('not a number', 'CNY', 'IDR', TABLE), null, 'an unreadable amount is null, not NaN leaking into a total');
  eq(fx.convert(0, 'CNY', 'IDR', TABLE), 0, 'zero converts to zero, and to positive zero — never -0');
}

/* -------------------------------- staleness ------------------------------ */
{
  eq(fx.stalenessOf(TABLE, '2026-08-29'), { age: 0, stale: false }, 'a rate fetched today is fresh');
  eq(fx.stalenessOf(TABLE, '2026-09-04').stale, false, 'six days on it is still fresh');
  eq(fx.stalenessOf(TABLE, '2026-09-05').stale, true,
    'and on the seventh it is flagged — the boundary pinned on both sides, because an off-by-one here is a day of silently unlabelled money');
  eq(fx.stalenessOf(TABLE, '2026-08-28').stale, true,
    'a rate dated in the FUTURE is flagged too — the clock or the file is wrong, and either way the reader should see the date');
  eq(fx.stalenessOf(null, '2026-08-29'), { age: null, stale: true },
    'no table is stale, not fresh — an unknown age is never a good one');
}

/* ---------------------------------- codeOf ------------------------------- */
{
  const HH = { code: 'IDR', symbol: 'Rp' };
  eq(fx.codeOf({ balance: 1 }, HH), 'IDR',
    'an account that says nothing is household money — the single-currency default has to survive this feature being switched on');
  eq(fx.codeOf({ currency: 'Rp' }, HH), 'IDR',
    'and so does one that restates the household symbol');
  eq(fx.codeOf({ currency: 'RMB', currency_code: 'CNY' }, HH), 'CNY', 'a declared code wins');
  eq(fx.codeOf({ currency: 'RMB' }, HH), '',
    'but a foreign SYMBOL with no code is unknown, NOT household money — falling through to IDR here would count ¥3 956 as Rp 3 956 at par, which is issue #28 with a rate table sitting unused beside it');
  eq(fx.codeOf({ currency: '$' }, { code: 'IDR', symbol: 'Rp' }), '',
    'the ambiguous symbols are exactly the ones that must not be guessed');
}

/* ------------------------------ convertAccounts -------------------------- */
{
  /* The reporter's vault: Rp 200 000 cash, Rp 5 000 000 at BCA, ¥3 956 on
     Alipay — plus two accounts this feature must refuse to guess at. */
  const accounts = [
    { name: 'Cash', balance: 200000 },
    { name: 'BCA', balance: 5000000, currency_code: 'IDR' },
    { name: 'Alipay', balance: 3956, currency: 'RMB', currency_code: 'CNY' },
    { name: 'Mystery', balance: 999, currency: '$' },
    { name: 'Unquoted', balance: 500, currency: 'kr', currency_code: 'SEK' },
  ];
  const r = fx.convertAccounts(accounts, { code: 'IDR', symbol: 'Rp' }, TABLE, '2026-08-29');

  eq(r.home, 5200000, 'the household-currency part is exactly what the un-converted hero already showed');
  eq(r.converted.length, 1, 'one foreign code was convertible');
  eq(r.converted[0].code, 'CNY', 'named by its ISO code, so the reader can check the rate themselves');
  eq(r.converted[0].amount, 3956, 'the original amount survives alongside the converted one');
  ok(r.total > 15000000, 'the total is the rand-equivalent sum, well above the Rp 5.2m of home money alone');
  eq(r.total, Math.round((r.home + r.converted[0].inHome) * 100) / 100,
    'and the total is exactly home + converted, so a reader can add it up by hand');

  eq(r.unconvertible.length, 2, 'BOTH un-guessable accounts are returned');
  const names = r.unconvertible.map(u => u.account.name).sort();
  eq(names, ['Mystery', 'Unquoted'],
    'the account whose symbol is foreign but whose code is absent, and the one whose code has no rate in this table — neither is dropped and neither is counted at par');
  eq(r.home, 5200000,
    "and Mystery's $999 is NOT hiding inside the home figure — that regression is worth its own assertion, because it is silent");
  eq(r.date, '2026-08-29', 'the answer carries the date its rates are for');
  eq(r.stale, false, 'and whether that date is old enough to say so out loud');

  /* An account with NO code in a vault whose household code IS set counts as
     household money — that is the single-currency default, and it must not
     start landing in unconvertible the moment the feature is switched on. */
  ok(!r.unconvertible.some(u => u.account.name === 'Cash'),
    'an account with no code of its own is household money, exactly as it was before this feature existed');
}

/* ------------------------- seeding a code for the wizard ------------------ */
{
  eq(fx.codeForCountry('za'), 'ZAR', 'a country identifies its currency');
  eq(fx.codeForCountry('AU'), 'AUD', 'case-folded — and NOT the USD a "$" table would have handed an Australian');
  eq(fx.codeForCountry('other'), '', '"somewhere else" names no currency');
  eq(fx.codeForCountry(''), '', 'and neither does nothing');

  eq(fx.codeForSymbol('Rp'), 'IDR', 'an unambiguous symbol can seed a code');
  eq(fx.codeForSymbol('R$'), 'BRL', 'and R$ is a different string from R, so the two never collide');
  eq(fx.codeForSymbol('₹'), 'INR', '');
  eq(fx.codeForSymbol('$'), '',
    'but "$" is refused — it is USD, AUD, CAD and SGD, and a seed that is wrong is worse than a field left blank');
  eq(fx.codeForSymbol('R'), '',
    'and so is "R" — rand here, real in Brazil');
}

/* -------------------------------- canConvert ----------------------------- */
{
  const on = { exchange_rates: true, currency_code: 'IDR' };
  eq(fx.canConvert(on, TABLE), true, 'toggle on, code set, table present');
  eq(fx.canConvert({ exchange_rates: false, currency_code: 'IDR' }, TABLE), false, 'off is off');
  eq(fx.canConvert(on, null), false,
    'the toggle on its own is NOT enough — a view that asked only about it would print "converted at" over figures nothing converted');
  eq(fx.canConvert({ exchange_rates: true, currency_code: '' }, TABLE), false,
    'and there is nothing to convert TO without a household code');
  eq(fx.canConvert({ exchange_rates: 'yes', currency_code: 'IDR' }, TABLE), false,
    'the toggle is a boolean — a truthy string from a hand-edited file does not switch money conversion on');
}

/* ---- refresh cadence: how OFTEN we ask, kept apart from how old is OLD ----
   These were one constant until now, and that was the bug: refreshRates()
   gated on stalenessOf(), so online the refresh fired at exactly the age the
   "this rate is old" badge would have appeared, and the badge was therefore
   almost unreachable. They are now two questions with two answers. */
{
  const dated = d => fx.normalizeTable({ base: 'ZAR', date: d, rates: { USD: 0.055 } });

  eq(fx.normalizeCadence('daily'), 'daily', 'daily reads back as daily');
  eq(fx.normalizeCadence('WEEKLY'), 'weekly', 'case is normalised');
  eq(fx.normalizeCadence('  monthly  '), 'monthly', 'surrounding space is trimmed');
  eq(fx.normalizeCadence('hourly'), 'daily',
    'an unknown hand-edited cadence falls back to daily rather than reaching the refresh gate as an unknown');
  eq(fx.normalizeCadence(''), 'daily', 'blank means the default');
  eq(fx.normalizeCadence(undefined), 'daily',
    'ABSENT means daily — a vault written before this key existed keeps the behaviour its own Settings.md describes');

  eq(fx.refreshAfterDays('daily'), 1, 'daily asks after a day');
  eq(fx.refreshAfterDays('weekly'), 7, 'weekly asks after a week');
  eq(fx.refreshAfterDays('monthly'), 30, 'monthly asks after thirty days');

  /* A rate five days old: due on daily, not yet due on weekly or monthly. */
  const five = dated('2026-08-25');
  eq(fx.refreshDue(five, '2026-08-30', 'daily'), true, 'five days old is due at daily');
  eq(fx.refreshDue(five, '2026-08-30', 'weekly'), false, 'five days old is not yet due at weekly');
  eq(fx.refreshDue(five, '2026-08-30', 'monthly'), false, 'five days old is not yet due at monthly');

  /* The boundary, on both sides, the way STALE_AFTER_DAYS is pinned above. */
  eq(fx.refreshDue(dated('2026-08-29'), '2026-08-30', 'daily'), true, 'age 1 IS due at daily');
  eq(fx.refreshDue(dated('2026-08-30'), '2026-08-30', 'daily'), false, 'age 0 is not');
  eq(fx.refreshDue(dated('2026-08-23'), '2026-08-30', 'weekly'), true, 'age 7 IS due at weekly');
  eq(fx.refreshDue(dated('2026-08-24'), '2026-08-30', 'weekly'), false, 'age 6 is not');

  /* An unusable table is always due — an unknown age is not a fresh one, the
     same defensive reading stalenessOf() takes. */
  eq(fx.refreshDue(null, '2026-08-30', 'monthly'), true, 'no table at all is always due');
  eq(fx.refreshDue(dated('not-a-date'), '2026-08-30', 'monthly'), true, 'an unreadable date is always due');
  eq(fx.refreshDue(dated('2026-09-30'), '2026-08-30', 'monthly'), true,
    'a rate dated in the FUTURE is refetched rather than trusted');

  /* The decoupling itself, stated as an assertion rather than left implied:
     at twenty days a monthly vault has not asked again, AND the reader is
     told the rate is old. Both must be true at once — that is the whole
     point of splitting the two constants. */
  const twenty = dated('2026-08-10');
  eq(fx.refreshDue(twenty, '2026-08-30', 'monthly'), false, 'monthly has not asked again at twenty days');
  eq(fx.stalenessOf(twenty, '2026-08-30').stale, true, 'and the reader is still told that rate is old');
  ok(fx.REFRESH_AFTER_DAYS.monthly > fx.STALE_AFTER_DAYS,
    'monthly deliberately outlives the staleness badge — choosing to fetch rarely is not the same as being lied to about freshness');
}

console.log(`PASS — fx engine: conversion, provenance, and every refusal to guess (${checks} checks).`);
