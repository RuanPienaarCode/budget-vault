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
  const sign = () => {
    if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); return true; }
    if (s.startsWith('+')) { s = s.slice(1).trim(); return true; }
    return false;
  };
  sign();
  const bare = s.replace(/^(zar|usd|gbp|eur|aud|cad|us\$|a\$|c\$|nz\$|r|[$\u00A3\u20AC])\s*/i, '');
  if (bare !== s) { s = bare; sign(); }
  s = s.replace(/[\s\u00A0\u202F']/g, '');
  if (/^\d+(\.\d{3})*,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');  // decimal comma
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
