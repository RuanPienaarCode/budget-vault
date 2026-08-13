'use strict';
/* Import duplicate detection.

   Two layers, because banks give us two different kinds of "same transaction".

   EXACT — date + description + amount + account. Catches re-importing an
   overlapping statement, which is the common case. Hard skip: the row cannot
   be imported.

   NEAR — the same charge whose date AND/OR description the bank rewrote
   between exports. Card transactions land as `Pending` with the raw terminal
   descriptor and a provisional timestamp, then settle a few days later with a
   normalised merchant string and a new time:

     8 Jun export   2026-06-08 12:07  "GROCER ONE TERM0099 ZA"  Pending
     22 Jun export  2026-06-08 20:13  "GROCER ONE CITYVILLE"   Apple Pay

   Two of the four exact-key fields change, so the settled row reads as brand
   new and lands next to the pending one it was meant to replace. That is what
   put 61 duplicate rows into this vault across Jul 2025 – Jul 2026, spanning
   both flavours: description rewritten (Apr–Jul 2026) and date shifted by a
   day (Jul–Oct 2025, incl. a whole day of debit orders duplicated across 1/2
   Oct).

   NEAR is deliberately NOT a hard skip — it unticks the row and says why, so
   a genuine second identical purchase is still one click away. Silently
   dropping a real transaction is a worse failure than showing a duplicate.

   The load-bearing guard against false positives is `accounted`: a candidate
   only counts if the incoming file does NOT still contain it. A pending row
   VANISHES from later exports once it settles — that is the signal. If the
   old row is still in the file it matched exactly in layer one, so it can
   never be absorbed by a different row. Without this, two same-amount fees a
   day apart ("Intl payment fee MUSICCO" / "…APPLE.COM/BILL", both -1.20)
   would collide on their shared 14-character prefix. */

const { isSplitPart } = require('./tx-role');

/* Window the bank actually needs: pending→settled has never been observed
   beyond 2 days in this vault's four years of statements; 4 is slack. */
const NEAR_DAYS = 4;
/* Shortest merchant stem we will accept as evidence. "SPOTIFYZA" is 9 and must
   match; dropping to 6 starts pulling in unrelated chain stores. */
const MIN_PREFIX = 8;

/* Every bank glues a transaction-type verb onto the front of its descriptor,
   and that verb is IDENTICAL across every row of that type — "Card Purchase
   WOOLWORTHS" and "Card Purchase DIS-CHEM" share 12 characters before the
   merchant even starts. Against a fixed MIN_PREFIX that clears the bar on the
   verb alone: two different merchants under the same verb collide, and the
   merchant is never actually compared. No threshold on the RATIO of the
   shared prefix fixes this either — the false "Internet Payment TO ALICE" /
   "…TO BOBBY" collision shares 77% of the shorter string, well above the 56%
   a genuine "MusicCoZA Stockholm SE" / "MusicCoZA 94.99 ZAR" match clears, so
   a single ratio cannot separate them; the only thing that reliably
   distinguishes "shared verb, different merchant" from "shared merchant,
   different rewrite" is knowing which part of the string is the verb.
   Longest phrases first so "Internet Payment TO" strips whole, not as
   "Payment To" leaving a stray "Internet ". Stripping is applied to BOTH
   sides before comparing, so a genuine pending→settled pair that happens to
   share a verb ("Card Purchase GROCER ONE TERM0099" / "…CITYVILLE") still
   matches on the merchant stem underneath — only the verb itself stops
   counting as evidence. */
const VERB_PREFIXES = [
  'INTERNET PAYMENT TO', 'IMMEDIATE PAYMENT TO', 'EFT PAYMENT TO',
  'PAYSHAP PAYMENT TO', 'PAYSHAP TO', 'PAYMENT TO',
  'CARD PURCHASE', 'POS PURCHASE', 'INTERNET PURCHASE', 'ONLINE PURCHASE',
  'PREPAID PURCHASE',
  'AUTOBANK CASH WITHDRAWAL', 'CASH WITHDRAWAL', 'ATM WITHDRAWAL',
  'EFT CREDIT', 'EFT DEBIT',
];

/* Not a verb — a STATE, and the bank removes it rather than rewriting it.
   Capitec marks a card transaction that has not settled yet with a literal
   "(Pending)" in front of the description and leaves its Balance empty; when it
   settles, the next export carries the same purchase without the marker, on a
   later posting date. Two of the four exact-key fields change, so the settled
   row reads as brand new and lands beside the pending one — the same duplicate
   shape this module was written for, arriving through a marker rather than a
   rewrite. Stripped on BOTH sides before the merchant is compared, so a pending
   row and its settled twin match on the stem underneath. */
const PENDING_PREFIX = '(PENDING)';

function isPendingDesc(s) {
  return String(s == null ? '' : s).trim().toUpperCase().startsWith(PENDING_PREFIX);
}

function stripVerbPrefix(s) {
  let upper = String(s).toUpperCase();
  // Before the verbs, not instead of them: "(Pending) Card Purchase X" carries
  // both, and stopping at the marker would leave the verb standing as evidence.
  if (upper.trimStart().startsWith(PENDING_PREFIX)) {
    upper = upper.trimStart().slice(PENDING_PREFIX.length).trimStart();
  }
  for (const verb of VERB_PREFIXES) {
    if (upper.startsWith(verb)) return upper.slice(verb.length);
  }
  return upper;
}

/* The one true exact key. dedupSet, the review probe and commitImport all
   derive from this — they used to build the string inline in three places. */
function txKey(date, desc, amount, label) {
  return `${date}|${String(desc).trim().toLowerCase()}|${Number(amount).toFixed(2)}|${String(label).trim().toLowerCase()}`;
}

function normDesc(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/* Same merchant, allowing for the bank's own rewriting. Equality after
   stripping punctuation covers the whitespace-only variants Discovery emits
   ("Pay *Plato" vs "Pay   *Plato"); the prefix rule covers the rest — but the
   prefix rule runs on the verb-stripped strings (see VERB_PREFIXES above), not
   the raw ones, or the bank's own boilerplate is what gets "matched". Full
   equality is still checked on the UNSTRIPPED strings first: two identical
   verb-less descriptions ("Intl payment fee MUSICCO" vs itself) must not
   depend on the strip list knowing about them. */
function descsLikelySame(a, b) {
  const x = normDesc(a), y = normDesc(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const sx = normDesc(stripVerbPrefix(a)), sy = normDesc(stripVerbPrefix(b));
  if (!sx || !sy) return false;
  return commonPrefixLen(sx, sy) >= MIN_PREFIX;
}

function daysApart(a, b) {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(ms) ? Infinity : Math.abs(ms) / 86400000;
}

function shiftDate(d, days) {
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(ms)) return d;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

/* Index every existing row once per import: the exact keys, plus a
   `label|amount` bucket for the near pass so it stays a hash lookup instead of
   a scan over the whole vault per incoming row.

   `exact` is a COUNT per key, not a membership set. Some transactions really do
   repeat identically — three "Returned debit order fee" -9.00 on one day, two
   R120 shop visits — and a Set collapses them to one. The effect was silent and
   permanent data loss: when an early export listed a charge once and a later
   export listed it twice, the second copy matched the same single key, was
   flagged a duplicate, and never landed in any import. Counting means N copies
   on the statement reconcile against N copies in the vault.

   Bucket entries carry a unique `id` because duplicate rows share a key, and
   the near pass consumes candidates individually — keying consumption by the
   string would let one absorbed row block its identical twin.

   Split PARTS are left out, and the parent is what stands for the charge —
   which is the whole reason a split keeps its parent rather than deleting it.
   A part is a slice the reader drew after the fact; no statement ever carried
   that line, so indexing one lets it absorb a genuine future transaction that
   happens to share its date, description and amount. That is the same silent,
   permanent data loss the counting above exists to prevent, arriving by a
   different door. */
function buildIndex(txFiles) {
  const exact = new Map();
  const byAmount = new Map();
  const index = { exact, byAmount, seq: 0 };
  for (const f of Object.values(txFiles || {})) {
    for (const r of f.rows || []) {
      if (isSplitPart(r)) continue;
      addToIndex(index, r.date, r.desc, r.amount, f.label);
    }
  }
  return index;
}

function addToIndex(index, date, desc, amount, label) {
  const key = txKey(date, desc, amount, label);
  index.exact.set(key, (index.exact.get(key) || 0) + 1);
  const bucket = `${String(label).trim().toLowerCase()}|${Number(amount).toFixed(2)}`;
  if (!index.byAmount.has(bucket)) index.byAmount.set(bucket, []);
  index.byAmount.get(bucket).push({ id: index.seq++, date, desc, key });
  return key;
}

/* One incoming row against the vault. `incomingKeys` is every exact key in the
   file being imported; `consumed` carries across the whole file so two
   incoming rows can never both claim the same existing row.

   `range` is the incoming file's own [min,max] date span. A vault row outside
   it is absent for a boring reason — the export simply doesn't cover it — not
   because it settled, so it must not be treated as evidence. BUT widen that
   test by NEAR_DAYS on each side first: a pending row can be re-dated by the
   bank on settlement, which is exactly what this pass exists to catch, so a
   vault row sitting one day before range.min is not "outside the file" — it's
   the untouched half of the pair the settled row two days into the file was
   meant to replace. Testing the raw [min,max] rejected precisely the rows
   nearest the file's own edges, which is where a re-dated pending charge
   actually lands. */
function findNearDuplicate(item, index, label, incomingKeys, consumed, range) {
  const lab = String(label || '').trim().toLowerCase();
  const bucket = index.byAmount.get(`${lab}|${Number(item.amount).toFixed(2)}`);
  if (!bucket) return null;
  const lo = range ? shiftDate(range.min, -NEAR_DAYS) : null;
  const hi = range ? shiftDate(range.max, NEAR_DAYS) : null;
  let best = null, bestGap = Infinity;
  for (const cand of bucket) {
    if (consumed.has(cand.id)) continue;
    if (incomingKeys.has(cand.key)) continue;            // still in the file → accounted for
    if (range && (cand.date < lo || cand.date > hi)) continue;
    const gap = daysApart(item.date, cand.date);
    if (gap > NEAR_DAYS) continue;
    if (!descsLikelySame(item.desc, cand.desc)) continue;
    if (gap < bestGap) { best = cand; bestGap = gap; }
  }
  return best;
}

/* Set dup / near / include on every row of a pending import. Lives here rather
   than in the view because it is a state machine with a sticky bit, and the
   sticky bit is easy to get wrong: `nearAuto` records that we ALREADY did the
   automatic untick. It must survive re-renders (switching account, "show more"
   paging) so that whichever way the user then set the checkbox is what sticks.
   Clearing it on the checkbox handler re-unticked the row on the next render.

   Returns the counts the review header reports. */
function flagItems(items, index, label, range) {
  const lab = String(label || '').trim().toLowerCase();
  const incomingKeys = new Set(items.map(it => txKey(it.date, it.desc, it.amount, lab)));
  let dupes = 0, nears = 0;

  /* Match the statement's copies against the vault's copies one-for-one. The
     Nth identical row on the statement is only a duplicate while the vault
     still has an Nth identical row to pair it with; beyond that it is a real
     transaction the vault is missing. */
  const usedExact = new Map();
  for (const it of items) {
    const key = txKey(it.date, it.desc, it.amount, lab);
    const have = index.exact.get(key) || 0;
    const used = usedExact.get(key) || 0;
    it.dup = used < have;
    if (it.dup) {
      usedExact.set(key, used + 1);
      it.include = false; it.autoExcluded = true; dupes++;
    } else if (it.autoExcluded) { it.include = true; it.autoExcluded = false; }  // no longer a dup for this account → re-include
  }

  const consumed = new Set();
  for (const it of items) {
    const hit = it.dup ? null : findNearDuplicate(it, index, lab, incomingKeys, consumed, range);
    if (hit) {
      consumed.add(hit.id);
      it.near = hit;
      nears++;
      if (!it.nearAuto) { it.include = false; it.nearAuto = true; }
    } else if (it.near && !it.dup) {
      it.near = null;
      if (it.nearAuto) { it.include = true; it.nearAuto = false; }
    }
  }

  /* Rows the bank has not settled yet, unticked with the reason shown.
     Stripping the marker (above) makes a settled row RECOGNISE its pending
     twin, but only while the two agree on the amount — and they do not always:
     a card authorisation and its settlement differ by a tip, a currency
     conversion, a fuel pre-auth. The near pass buckets by exact amount, so
     those pairs cannot match by any rewriting rule, and the duplicate they
     leave behind is a phantom nobody can spot afterwards.

     So the honest answer is not to import a row the bank itself calls
     provisional. Nothing is lost: the same purchase arrives, settled and final,
     on the next export. It is an UNTICK and not a skip, on the same sticky bit
     the near pass uses — the reader can tick it, and their decision survives
     every re-render. */
  let pendings = 0;
  for (const it of items) {
    it.pending = !it.dup && isPendingDesc(it.desc);
    if (!it.pending) {
      if (it.pendingAuto) { it.include = true; it.pendingAuto = false; }
      continue;
    }
    pendings++;
    if (!it.pendingAuto) { it.include = false; it.pendingAuto = true; }
  }
  return { dupes, nears, pendings };
}

module.exports = {
  txKey, buildIndex, addToIndex, findNearDuplicate, flagItems,
  descsLikelySame, normDesc, isPendingDesc, NEAR_DAYS,
};
