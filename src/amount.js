'use strict';
/* Reading a money value that a HUMAN or a BANK wrote.

   Every amount in this app arrives as text somebody else formatted — a bank's
   CSV export, a hand-edited markdown cell, a value typed into a modal — and the
   formats genuinely differ: SA and EU write "1 234,56", the US and UK write
   "1,234.56", and a bank may add a currency symbol, parentheses or a Cr/Dr
   marker. Bare parseFloat reads "1,234.56" as 1 and "R150.00" as 0, which is
   the worst possible failure here: not an error, a plausible wrong number.

   So there is exactly one reader, and everything goes through it. Four private
   near-copies of this logic had grown across the views, the loader and the
   onboarding wizard, and they disagreed on the grouped-thousands case.

   Pure — no DOM, no obsidian import. */

/* Parse a statement amount cell to a Number, or null if empty/unparseable.
   Tolerates the spread of bank export styles: "R 1 234.56", "$1,234.56",
   decimal-comma "1 234,56" / "1.234,56", parenthesised negatives "(123.45)",
   trailing minus "123.45-", and Cr/Dr markers (Cr → credit/positive,
   Dr → debit/negative). Zero is a valid return — callers decide to skip it. */
function normalizeAmount(raw) {
  let s = (raw ?? '').toString().trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  // A Dr/Cr marker can lead ("DR 100.00") or trail ("100.00 Dr") — both are
  // routine across statement exports, and only the trailing form used to be
  // read. Checked before the trailing form so a marker on ONE side of a bare
  // cell is consumed exactly once, from whichever side it's actually on.
  const leadMarker = s.match(/^(cr|dr)\.?\s*/i);
  if (leadMarker) { if (leadMarker[1].toLowerCase() === 'dr') neg = true; s = s.slice(leadMarker[0].length).trim(); }
  const marker = s.match(/(cr|dr)\.?\s*$/i);
  if (marker) { if (marker[1].toLowerCase() === 'dr') neg = true; s = s.slice(0, marker.index).trim(); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1).trim(); }
  /* Sign, symbol, sign - because banks write it both ways round. "-R100" puts
     the minus outside the symbol and "R-100" puts it inside, and a single pass
     can only catch one of them: stripping the sign first leaves "R-100" as
     "-100" AFTER the symbol goes, which fails the final numeric test and comes
     back as null - which parseNum then serves to every total as ZERO. A missing
     sign is a wrong number; a missing amount is a wrong number wearing an empty
     cell.

     The second pass runs ONLY where a symbol was actually removed, and that
     condition is the whole guard. Run unconditionally it also accepts "--100"
     and "+-100" as -100, because each pass sees a fresh leading sign - turning
     junk into a confident number, which is the one thing this file exists to
     refuse. A doubled sign is not a format any bank writes; it is a damaged
     cell, and null is the honest answer. */
  // ASCII hyphen-minus is not the only minus a real cell carries: U+2212 MINUS
  // SIGN is what copy-pasting a PDF bank statement or a formatted online-
  // banking page actually yields, and U+FF0D FULLWIDTH HYPHEN-MINUS shows up
  // from CJK-locale exports. Both were silently falling through to null here,
  // which parseNum then serves to every total as a plausible zero.
  const sign = () => {
    if (/^[-−－]/.test(s)) { neg = true; s = s.slice(1).trim(); return true; }
    if (s.startsWith('+')) { s = s.slice(1).trim(); return true; }
    return false;
  };
  sign();
  /* The symbols and codes a statement actually leads with. Widened after an
     audit found the reporter of issue #28 — an Indonesian household — unable
     to import at all: "Rp 1.500.000" failed this test, came back null, and
     views/import.js counted the row into `skipped`. So a Chinese or
     Indonesian statement imported ZERO rows and reported them as skipped
     rather than saying "I cannot read your currency", which is the plausible
     silent failure this whole file exists to refuse.

     Ordered longest-first within the alternation so "R$" (Brazilian real) is
     consumed whole rather than leaving a stray "$", and so "RMB" is not read
     as an "R" followed by junk. `r` stays last of the letter forms for the
     same reason it always was: it is the shortest and would otherwise shadow
     every code beginning with it. */
  const bare = s.replace(
    /^(zar|usd|gbp|eur|aud|cad|cny|rmb|jpy|inr|idr|chf|sek|nok|dkk|pln|brl|try|krw|sgd|nzd|hkd|us\$|a\$|c\$|nz\$|hk\$|r\$|rp|kr|zł|fr|r|[$\u00A3\u20AC\u00A5\u20B9\u20A9\u20BA\u0E3F\u20AA\u20BD\u20AB\u20B1])\s*/i, '');
  if (bare !== s) { s = bare; sign(); }
  s = s.replace(/[\s\u00A0\u202F']/g, '');
  /* A trailing percent is a unit suffix, exactly like the currency prefix
     stripped above, and it is dropped for the same reason. Debts.md's `Rate`
     column reads through this function under a header literally named "Rate",
     next to prose describing it as "the annual interest rate as a percentage"
     \u2014 so "18.5%" is the obvious hand-edit. Without this it failed the decimal
     test below, came back null, and was served as a rate of ZERO: no interest
     on the Debts page, no interest in the score, and full marks for the debt
     pillar on a quarter-million rand of debt. */
  s = s.replace(/%$/, '');
  if (/^\d+(\.\d{3})*,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');  // decimal comma
  /* Dot-grouped thousands with NO decimal part at all — "1.500.000", the way
     Indonesia, Germany, Brazil and much of Europe write it. Two or more groups
     is required, and that requirement is the whole reason this is safe to do
     without knowing the reader's locale: "1.500" on its own is genuinely
     ambiguous (one and a half, or one thousand five hundred?) and is left
     exactly as it always parsed, but "1.500.000" cannot be a decimal — no
     money has two decimal points. Guessing at the ambiguous case is how a
     confident wrong number gets printed, which this file refuses; declining
     to read the UNambiguous one was simply a gap. */
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');                                                       // thousands comma
  // A bare ".50" is a real cell (some exports drop the leading zero), and it
  // must parse rather than fall to null and be served as zero by parseNum.
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/* Strict numeric-cell parse. Returns { ok, value, raw }. `ok` is true only for
   a plain decimal (the app's on-disk format); anything else (e.g. "1 234,56",
   "R100") is preserved verbatim in `raw` so a serializer can write it back
   unchanged instead of silently coercing it to a wrong number.

   The fallback `value` still has to be the reader's best guess, because it
   feeds every total and KPI — but it must not be a *plausible wrong number*.
   Bare parseFloat reads "1,234.56" as 1 and "R150.00" as 0, which shows up as
   a quietly wrong balance rather than an obvious error. normalizeAmount knows
   both separator conventions and every statement flavour, so use it. */
function parseNum(s) {
  const t = (s ?? '').toString().trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: parseFloat(t) };
  return { ok: false, value: normalizeAmount(t) ?? 0, raw: t };
}

module.exports = { normalizeAmount, parseNum };
