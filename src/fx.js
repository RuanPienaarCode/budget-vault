'use strict';
/* Exchange rates — the arithmetic, and the honesty rules that go with it.

   src/currency.js says the plugin never converts, and the reasoning there
   still stands unamended: "a rate is a fact about a day that this vault does
   not hold. Storing one would mean every figure derived from it silently ages,
   and a household total that was right last month is the worst kind of wrong —
   it looks the same."

   This module does not refute that. It answers it. The objection is not to
   conversion, it is to a converted figure that has forgotten WHEN it was true.
   So the unit this file traffics in is never a bare number: it is a rate, the
   date that rate is FOR, and the age of that date in days. Every figure this
   file produces can state its own provenance, and the views are written so
   that it always does. A converted total whose rate has gone stale says so on
   the same line as the number.

   The rest of currency.js's contract is untouched:
     - conversion is OPT-IN and off by default (`exchange_rates: no`);
     - with it off, this file is never called and every total behaves exactly
       as it did before it existed;
     - nothing is ever silently excluded. An account this file CANNOT convert
       (no code, or no rate for its code) is returned in `unconvertible`, for
       the caller to name — never dropped, and never quietly counted at par.

   ISO codes, not symbols. `currency:` on an account is a display symbol and
   deliberately stays one — "$" is USD, AUD, CAD or SGD depending on whose
   vault it is, and "R" is rand or real. Guessing is how the wrong number gets
   printed with total confidence. An account opts IN to conversion by carrying
   `currency_code: CNY`; one that does not is reported, not guessed at.

   Pure — no DOM, no obsidian import, no network. The fetch lives in
   src/fx-fetch.js so that this file can be run in bare node by
   tests/fx.test.cjs, and so the network call has exactly one home. */

const { isForeign } = require('./currency');
/* Pure as well — the local calendar date of an instant, for requestAllowed's
   "once a local day". */
const { isoOf } = require('./dates');

/* The ISO code for each country profile this app ships (src/locale.js's
   PROFILES). A SEED for the wizard's code field, and nothing more — the
   reader can always correct it, and `other` deliberately has no entry because
   "somewhere else" names no currency.

   This is the one direction the mapping is safe in. Country -> code is a fact;
   symbol -> code is a guess, which is why nothing here maps "$" to anything.
   A reader in Australia whose country profile is `au` gets AUD offered rather
   than the USD a symbol table would have handed them. */
const CODE_BY_COUNTRY = {
  za: 'ZAR', us: 'USD', uk: 'GBP', eu: 'EUR', au: 'AUD', ca: 'CAD', cn: 'CNY',
};
const codeForCountry = c => CODE_BY_COUNTRY[String(c || '').trim().toLowerCase()] || '';

/* The symbols that identify exactly ONE currency, and only those.

   This is the direction the module header warns about, so the list earns its
   place by being strictly the unambiguous half. "$" is missing on purpose —
   the US, Australia, Canada and Singapore all use it — and so is "R", which
   is rand here and real in Brazil. "R$" IS listed and is a different string
   from "R"; the wizard stores the symbol verbatim, so the two never collide.

   Used only to SEED the wizard's code field after the country has had its
   turn, never to decide an account's currency at render time. A seed the
   reader can see and correct is a different thing from a guess made silently
   inside an arithmetic path — the second is what codeOf() refuses to do. */
const CODE_BY_SYMBOL = {
  '€': 'EUR', '£': 'GBP', '¥': 'CNY', '₹': 'INR', 'Rp': 'IDR', 'R$': 'BRL',
  '₩': 'KRW', '₺': 'TRY', '฿': 'THB', '₪': 'ILS', '₽': 'RUB', '₫': 'VND',
  'zł': 'PLN', 'CHF': 'CHF',
};
const codeForSymbol = sym => CODE_BY_SYMBOL[String(sym == null ? '' : sym).trim()] || '';

/* A rate this old is still USED — refusing to convert because the network was
   down for a week would be the app deciding it knows better than the reader —
   but it is labelled everywhere it appears. Seven days, because that is one
   weekend plus the working week around it: a rate that has survived a full
   business week without refreshing is no longer news. The boundary is
   inclusive (age 7 IS flagged), which tests/fx.test.cjs pins on both sides —
   an off-by-one here is a day of silently unlabelled figures. */
const STALE_AFTER_DAYS = 7;

/* How often the app may ASK for new rates. Deliberately a different number
   from STALE_AFTER_DAYS above, because they answer different questions:
   STALE_AFTER_DAYS is "how old before the reader is warned", this is "how old
   before we spend a network request". Tying them to one constant — which is
   what shipped until now — made the warning almost unreachable online, since
   the refresh fired at exactly the age the badge would have appeared.

   `monthly` is deliberately allowed to sit past STALE_AFTER_DAYS: a household
   that asks for monthly rates gets monthly rates, and every figure drawn from
   one keeps saying how old it is. Choosing to fetch rarely is not the same as
   being lied to about how fresh the answer is. */
const REFRESH_AFTER_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const DEFAULT_CADENCE = 'daily';

/* Any hand-edited or absent value resolves to daily rather than throwing —
   the same contract resolveLanguage() and localeFor() give. Daily is the
   default because it is what the setting and the wizard have always promised,
   and a vault written before this key existed should keep the behaviour its
   own copy describes. */
function normalizeCadence(raw) {
  const k = String(raw ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(REFRESH_AFTER_DAYS, k) ? k : DEFAULT_CADENCE;
}

function refreshAfterDays(cadence) {
  return REFRESH_AFTER_DAYS[normalizeCadence(cadence)];
}

/* Whether a cached table is old enough to be worth re-asking for, at this
   vault's cadence. Same defensive shape as stalenessOf: no date, or a date in
   the future, is a reason to refetch rather than to trust it. */
function refreshDue(table, todayIso, cadence) {
  const age = table ? daysBetweenIso(table.date, todayIso) : null;
  return age === null || age < 0 || age >= refreshAfterDays(cadence);
}

/* How long after a FAILED request the app waits before asking again: fifteen
   minutes, doubling with every failure in a row, and never longer than the
   refresh interval itself — so a long outage still gets one try a day at a
   daily cadence, and a household that just came back online waits minutes,
   not a day. */
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

/* May the app send a request NOW? Asked after refreshDue says the table is
   due — and it is the half that question cannot answer, because refreshDue
   compares the PROVIDER'S date with the device's local one, and the answer
   that just arrived can itself be due: east of Greenwich before the
   provider's 00:02 UTC update (01:30 in Johannesburg, 12:30 in Auckland),
   with a provider stuck on an old date or one dated in the future, or
   offline. refreshRates() runs after every vault reload, so each of those
   asked again on every reload — 5 requests over 5 reloads in the 2026-10-07
   audit, against fx-live.js's promise of one lookup per interval.

   `state` is what the caller remembers, every time an epoch millisecond (or
   absent): lastSuccessAt — the last request that brought back a usable
   table; lastFailureAt and failures — the last failed one and how many have
   failed in a row.
     - After a success: no request until the refresh interval has passed,
       counted in LOCAL calendar days (dates.js's isoOf), the unit refreshDue
       and the cadence setting are counted in — so "daily" is once a local
       day, whatever the hour the last one happened to be.
     - After a failure: RETRY_AFTER_FAILURE_MS, doubling, capped at the
       interval.
     - A stamp in the future is not believed, as a rate dated in the future
       is not (refreshDue, stalenessOf): it means a wrong clock on whichever
       device wrote it, and believing it would stop this one asking at all. */
function requestAllowed(state, nowMs, cadence) {
  const s = state || {};
  const days = refreshAfterDays(cadence);
  const believable = t => typeof t === 'number' && Number.isFinite(t) && t <= nowMs;
  if (believable(s.lastSuccessAt)) {
    const age = daysBetweenIso(isoOf(new Date(s.lastSuccessAt)), isoOf(new Date(nowMs)));
    if (age !== null && age < days) return false;
  }
  const failures = Math.max(0, Math.floor(Number(s.failures) || 0));
  if (failures > 0 && believable(s.lastFailureAt)) {
    const wait = Math.min(RETRY_AFTER_FAILURE_MS * Math.pow(2, Math.min(failures, 30) - 1), days * 86400000);
    if (nowMs - s.lastFailureAt < wait) return false;
  }
  return true;
}

/* Whole days between two ISO dates, or null if either is not a real date.
   UTC throughout, for the same reason the rest of this app is: a rate dated
   "2026-08-29" is not a moment, and pulling it through a local timezone is how
   a rate fetched this morning reads as a day old in Auckland. */
function daysBetweenIso(fromIso, toIso) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(fromIso || '')) || !re.test(String(toIso || ''))) return null;
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* An ISO 4217 code, or ''. Upper-cased and trimmed so `currency_code: cny`
   in a hand-edited file works; length-checked so a symbol accidentally typed
   into the code field ("RMB" is not a code, "¥" certainly is not) is rejected
   as absent rather than sent to the provider as a currency it will not know.
   Three letters exactly — every ISO 4217 alphabetic code is. */
function normalizeCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : '';
}

/* The code an ACCOUNT's balance is denominated in, or '' when this vault has
   not said enough for anyone to know.

   The fallback to the household's code is the subtle part, and getting it
   wrong reintroduces issue #28 through the back door. An account that says
   nothing at all is household money — that is the single-currency default
   almost every vault runs on, and it must survive this feature being switched
   on. But an account that declares a foreign SYMBOL and no code has said
   something: it has said "this is not your currency", without saying which one
   it is. Falling through to the household code there would take a `$` balance
   and count it as rupiah at par, which is the original bug with a rate table
   sitting unused beside it. So a declared-foreign symbol with no code returns
   '' — unconvertible, to be named by the caller — and never the household's.

   `household` is {code, symbol}: the code is what we convert TO, the symbol is
   what isForeign() needs to tell "R" in a rand vault (same) from "R" in a
   rupiah one (foreign). */
function codeOf(a, household) {
  const own = normalizeCode(a && a.currency_code);
  if (own) return own;
  const h = household || {};
  if (isForeign(a, h.symbol)) return '';
  return normalizeCode(h.code);
}

/* The widest gap between two currencies this file will believe: a trillion
   to one.

   A provider can always lie with a plausible number, and nothing here can
   catch a rate that is wrong by a few percent. What can be refused is a rate
   no currency has ever had — and those are not hypothetical. The 2026-10-07
   audit fed the real chain two: `CNY: 5e-324` (the smallest double there is,
   finite and above zero, so it passed), under which one yuan bought Infinity
   rand and the Accounts hero printed the converted household total as
   "R 0,00"; and `CNY: 1e300`, under which ¥3 956 "converted" to R 0 and
   vanished from the total without a word. Both were written to the cache and
   read back on every launch.

   The widest real gap is far inside this bound. A Gulf dinar against the
   Iranian rial is a few hundred thousand to one; the bolívar in its 2021
   hyperinflation reached a few million to the dollar. A trillion leaves five
   orders of magnitude above the worst of those. A currency that really did go
   further — Zimbabwe's dollar in 2008 did — would get its table refused,
   which degrades to the un-converted split: the behaviour this feature is
   opt-in on top of, never a wrong number.

   One rule for any cross-rate, wherever it is asked: normalizeTable applies
   it to the WIDEST pair a table implies, rateBetween to every answer it
   gives. */
const MAX_CROSS_RATE = 1e12;
const plausibleRate = r => Number.isFinite(r) && r > 0 && r <= MAX_CROSS_RATE && r >= 1 / MAX_CROSS_RATE;

/* A rate table, validated into the one shape the rest of this file accepts:
     { base: 'IDR', date: '2026-08-29', rates: { CNY: 0.000379, ... } }
   `rates` maps a code to "one unit of BASE is this many units of the code".

   Returns null rather than a half-built table on anything malformed. A caller
   that gets null falls back to not converting at all — which is the behaviour
   this whole feature is opt-in on top of, so a broken cache file degrades to
   the honest un-converted split rather than to a wrong number or a crash. */
function normalizeTable(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = normalizeCode(raw.base);
  const date = String(raw.date || '').trim();
  if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const src = raw.rates;
  if (!src || typeof src !== 'object') return null;
  const rates = {};
  for (const k of Object.keys(src)) {
    const code = normalizeCode(k);
    const v = Number(src[k]);
    /* Zero and negative are not rates, and a non-finite one poisons every
       figure downstream — dropped here, at the boundary, so nothing past this
       function has to defend against them. */
    if (code && Number.isFinite(v) && v > 0) rates[code] = v;
  }
  /* The base is always worth one of itself. Stated explicitly rather than
       special-cased in rateBetween(), so the table is complete on its own and
       a caller reading it directly cannot miss the identity. */
  rates[base] = 1;
  /* The widest cross-rate this table implies — its largest rate over its
     smallest, the base's 1 included, so it bounds every pair at once — must be
     one a currency could have (MAX_CROSS_RATE). Refused WHOLE, not by dropping
     the one bad code: a provider that answers 1e300 for the yuan has said
     nothing a reader should trust about the dollar either. Zero, negative and
     non-numeric values above are different: those are "no rate", which a
     provider sends for a code it does not quote, and they are dropped alone as
     they always were. */
  const values = Object.values(rates);
  if (!plausibleRate(Math.max(...values) / Math.min(...values))) return null;
  return Object.keys(rates).length > 1 ? { base, date, rates } : null;
}

/* How many units of `to` one unit of `from` buys, or null when the table
   cannot answer. Cross-rated through the table's own base, which is exact for
   this shape of table: rates[X] is "base -> X", so from -> to is
   rates[to] / rates[from]. */
function rateBetween(from, to, table) {
  const f = normalizeCode(from), t = normalizeCode(to);
  if (!f || !t || !table || !table.rates) return null;
  if (f === t) return 1;
  const rf = table.rates[f], rt = table.rates[t];
  if (!Number.isFinite(rf) || !Number.isFinite(rt) || rf <= 0) return null;
  /* The same bound normalizeTable holds a whole table to, for a table handed
     in directly without it: rt / rf of a denormal is Infinity, and of 1e300
     is a rate that turns any balance into nothing. */
  const r = rt / rf;
  return plausibleRate(r) ? r : null;
}

/* One amount, converted, rounded to the cent. null when it cannot be done —
   never 0, and never the un-converted amount passed through. Returning the
   input unchanged would be the single most dangerous thing this file could
   do: ¥3 956 silently becoming "Rp 3 956" is exactly the bug that started
   all of this, wearing a conversion's clothes.

   A product that overflows is null too. The rate is bounded, but the amount
   is the household's own, and a balance typed with a stray exponent times a
   believable rate can still leave the doubles — an Infinity that
   formatAmount would print as "R 0,00". */
function convert(amount, from, to, table) {
  const r = rateBetween(from, to, table);
  const v = Number(amount);
  if (r === null || !Number.isFinite(v)) return null;
  const cents = Math.round(v * r * 100) / 100;
  return Number.isFinite(cents) ? (cents || 0) : null;
}

/* Is this rate table old enough that a figure derived from it should say so?
   `null` for age means "no usable date", which is treated as stale — an
   unknown age is not a fresh one. */
function stalenessOf(table, todayIso) {
  const age = table ? daysBetweenIso(table.date, todayIso) : null;
  /* A NEGATIVE age — a rate dated in the future — is as much a reason to
     flag the figure as an old one. It means the cache file was hand-edited or
     the device clock is wrong, and either way the reader should see the date
     rather than trust the number. */
  return { age, stale: age === null || age < 0 || age >= STALE_AFTER_DAYS };
}

/* The whole answer for a set of accounts, in one pass.

   Returns:
     total          the sum in the household's currency, conversions included
     home           the part that needed no conversion
     converted      [{ code, amount, inHome }] per foreign code, so a caller can
                    say "including ¥ 3 956 (Rp 8 987 000)" and show its working
     unconvertible  [{ account, symbol }] — balances that could not be converted
     rate/date/age/stale  the provenance every figure above must be printed with

   `unconvertible` is the load-bearing return value. Everything else here is
   arithmetic; that array is the promise that no money went missing quietly. */
function convertAccounts(accounts, household, table, todayIso) {
  const h = typeof household === 'string' ? { code: household, symbol: '' } : (household || {});
  const home = normalizeCode(h.code);
  const { age, stale } = stalenessOf(table, todayIso);
  const out = {
    total: 0, home: 0, converted: [], unconvertible: [],
    date: (table && table.date) || '', age, stale,
  };
  const byCode = new Map();
  for (const a of accounts || []) {
    const v = Number(a && a.balance) || 0;
    const code = codeOf(a, h);
    if (code && code === home) { out.home += v; continue; }
    const inHome = code ? convert(v, code, home, table) : null;
    /* A balance that is not zero (to the cent, in its own currency) and comes
       out as zero after conversion has not been converted — it has gone
       missing. That happens when the balance is worth less than half a cent
       of the household's currency at the rate given: at a real rate, a few
       rupiah left in a dormant account; at a wrong one that still passes
       MAX_CROSS_RATE (1e-11 rand a yuan), every balance a household holds.
       Either way "not converted" is true, where "converted: R 0,00" is the
       silence this array exists to prevent. */
    const vanished = inHome === 0 && Math.round(v * 100) !== 0;
    if (inHome === null || vanished) {
      /* No code, no rate for it, or a conversion to nothing. Named, never
         counted — at par or at all. */
      out.unconvertible.push({ account: a, symbol: (a && a.currency) || '' });
      continue;
    }
    const seen = byCode.get(code) || { code, amount: 0, inHome: 0 };
    seen.amount += v;
    seen.inHome += inHome;
    byCode.set(code, seen);
  }
  out.home = (Math.round(out.home * 100) / 100) || 0;
  out.converted = [...byCode.values()].map(c => ({
    code: c.code,
    amount: (Math.round(c.amount * 100) / 100) || 0,
    inHome: (Math.round(c.inHome * 100) / 100) || 0,
  }));
  out.total = (Math.round(
    (out.home + out.converted.reduce((s, c) => s + c.inHome, 0)) * 100) / 100) || 0;
  return out;
}

/* Is conversion switched on AND able to run? Both halves, in one place, so no
   view has to remember the second one. A vault with the toggle on but no
   household code, or no usable table, is not converting — and a view that
   asked only about the toggle would print "converted at" over figures that
   were never converted. */
function canConvert(settings, table) {
  return !!(settings && settings.exchange_rates === true
    && normalizeCode(settings.currency_code) && table && table.rates);
}

module.exports = {
  STALE_AFTER_DAYS, REFRESH_AFTER_DAYS, normalizeCadence, refreshAfterDays, refreshDue,
  RETRY_AFTER_FAILURE_MS, requestAllowed,
  codeForCountry, CODE_BY_SYMBOL, codeForSymbol, daysBetweenIso, normalizeCode, codeOf, normalizeTable,
  rateBetween, convert, stalenessOf, convertAccounts, canConvert,
  MAX_CROSS_RATE,
};
