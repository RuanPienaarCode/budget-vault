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

     8 Jun export   2026-06-08 12:07  "Checkers Rondebosch SB002256 ZA"  Pending
     22 Jun export  2026-06-08 20:13  "Checkers Rondebosch RONDEBOSCH"   Apple Pay

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
   day apart ("Intl payment fee SpotifyZA" / "…APPLE.COM/BILL", both -0.38)
   would collide on their shared 14-character prefix. */

/* Window the bank actually needs: pending→settled has never been observed
   beyond 2 days in this vault's four years of statements; 4 is slack. */
const NEAR_DAYS = 4;
/* Shortest merchant stem we will accept as evidence. "SPOTIFYZA" is 9 and must
   match; dropping to 6 starts pulling in unrelated chain stores. */
const MIN_PREFIX = 8;

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
   ("Yoco *Plato" vs "Yoco   *Plato"); the prefix rule covers the rest. */
function descsLikelySame(a, b) {
  const x = normDesc(a), y = normDesc(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return commonPrefixLen(x, y) >= MIN_PREFIX;
}

function daysApart(a, b) {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(ms) ? Infinity : Math.abs(ms) / 86400000;
}

/* Index every existing row once per import: the exact keys, plus a
   `label|amount` bucket for the near pass so it stays a hash lookup instead of
   a scan over the whole vault per incoming row. */
function buildIndex(txFiles) {
  const exact = new Set();
  const byAmount = new Map();
  for (const f of Object.values(txFiles || {})) {
    const label = String(f.label || '').trim().toLowerCase();
    for (const r of f.rows || []) {
      const key = txKey(r.date, r.desc, r.amount, f.label);
      exact.add(key);
      const bucket = `${label}|${Number(r.amount).toFixed(2)}`;
      if (!byAmount.has(bucket)) byAmount.set(bucket, []);
      byAmount.get(bucket).push({ date: r.date, desc: r.desc, key });
    }
  }
  return { exact, byAmount };
}

function addToIndex(index, date, desc, amount, label) {
  const key = txKey(date, desc, amount, label);
  index.exact.add(key);
  const bucket = `${String(label).trim().toLowerCase()}|${Number(amount).toFixed(2)}`;
  if (!index.byAmount.has(bucket)) index.byAmount.set(bucket, []);
  index.byAmount.get(bucket).push({ date, desc, key });
  return key;
}

/* One incoming row against the vault. `incomingKeys` is every exact key in the
   file being imported; `consumed` carries across the whole file so two
   incoming rows can never both claim the same existing row.

   `range` is the incoming file's own [min,max] date span. A vault row outside
   it is absent for a boring reason — the export simply doesn't cover it — not
   because it settled, so it must not be treated as evidence. */
function findNearDuplicate(item, index, label, incomingKeys, consumed, range) {
  const lab = String(label || '').trim().toLowerCase();
  const bucket = index.byAmount.get(`${lab}|${Number(item.amount).toFixed(2)}`);
  if (!bucket) return null;
  let best = null, bestGap = Infinity;
  for (const cand of bucket) {
    if (consumed.has(cand.key)) continue;
    if (incomingKeys.has(cand.key)) continue;            // still in the file → accounted for
    if (range && (cand.date < range.min || cand.date > range.max)) continue;
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

  for (const it of items) {
    it.dup = index.exact.has(txKey(it.date, it.desc, it.amount, lab));
    if (it.dup) { it.include = false; it.autoExcluded = true; dupes++; }
    else if (it.autoExcluded) { it.include = true; it.autoExcluded = false; }  // no longer a dup for this account → re-include
  }

  const consumed = new Set();
  for (const it of items) {
    const hit = it.dup ? null : findNearDuplicate(it, index, lab, incomingKeys, consumed, range);
    if (hit) {
      consumed.add(hit.key);
      it.near = hit;
      nears++;
      if (!it.nearAuto) { it.include = false; it.nearAuto = true; }
    } else if (it.near && !it.dup) {
      it.near = null;
      if (it.nearAuto) { it.include = true; it.nearAuto = false; }
    }
  }
  return { dupes, nears };
}

module.exports = {
  txKey, buildIndex, addToIndex, findNearDuplicate, flagItems,
  descsLikelySame, normDesc, NEAR_DAYS, MIN_PREFIX,
};
