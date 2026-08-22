'use strict';
/* Custom category groups — the household's own headers on the Budget page.

   Settings.md carries two one-line keys, both optional:

     groups: "property, treats"
     nonessential_groups: "treats, personal"

   `groups` is a comma list of group KEYS. A key is also its label — there is
   deliberately no `key=Label` syntax, because the group header on the Budget
   page, the badge, the Type column in every period file and the dropdown all
   show the same word, and one word the user chose needs no translation table.
   Keys are normalised the way category filenames are (lower-case, runs of
   anything that is not a letter, digit, `_` or `-` become one `-`), and a key
   that collides with a built-in type is dropped rather than shadowing it.

   Custom groups sit in the written order, spliced in just before `expense`:
   that keeps them with the household buckets they are most likely to extend,
   and keeps `expense` the catch-all at the end of the bills. An unknown type —
   a hand-edited note naming a group nobody declared — sorts LAST, not first:
   `indexOf === -1` used to put it above income, which read as a bug.

   `nonessential_groups` names the groups (custom OR built-in) the emergency
   fund maths may drop: what the household stops paying when income stops.
   Built-in luxuries/giving/savings/investment are always non-essential
   (health-math NON_ESSENTIAL_TYPES); this list only ever adds to that set,
   so a hand-edited file can make the cover figure read fewer months, never
   more. Keys here that name no known group are dropped on load. */

const { TYPE_ORDER } = require('./constants');

const BUILTIN = new Set(TYPE_ORDER);

function normaliseKey(raw) {
  return String(raw ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Same list shape parseOwners accepts: a comma string, or a real array when
   metadataCache has already parsed a YAML flow list. */
function splitList(raw) {
  const parts = Array.isArray(raw)
    ? raw.map(v => String(v ?? ''))
    : String(raw ?? '').replace(/^\s*\[/, '').replace(/\]\s*$/, '').split(',');
  const out = [];
  for (const p of parts) {
    const k = normaliseKey(p);
    if (!k || out.includes(k)) continue;
    out.push(k);
  }
  return out;
}

/* Custom group keys only — built-in names are dropped, not duplicated. */
function parseGroups(raw) {
  return splitList(raw).filter(k => !BUILTIN.has(k));
}

/* The full type order this vault runs: built-ins with the custom groups
   spliced in before `expense`. Pure; the callers that sort pass
   S.settings.groups. */
function typeOrder(groups) {
  const custom = Array.isArray(groups) ? groups : parseGroups(groups);
  const i = TYPE_ORDER.indexOf('expense');
  return [...TYPE_ORDER.slice(0, i), ...custom, ...TYPE_ORDER.slice(i)];
}

/* Sort key for a type: its position in the order, with unknown types last. */
function typeRank(type, order) {
  const i = order.indexOf(type);
  return i < 0 ? order.length : i;
}

/* Keys the emergency maths may drop, validated against the groups this vault
   actually has. Accepts built-ins too, so `personal` can be declared
   non-essential without inventing a custom group for it. */
function parseNonEssential(raw, groups) {
  const known = new Set(typeOrder(groups));
  return splitList(raw).filter(k => known.has(k));
}

module.exports = { parseGroups, parseNonEssential, typeOrder, typeRank, normaliseKey };
