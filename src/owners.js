'use strict';
/* Who an account belongs to.

   A household budget is not always one person's. Two people can keep separate
   cheque accounts, share a bond, and each run their own retirement annuity —
   and the Accounts page, which showed every account in one list, could answer
   "what are we worth" but never "what is on my side of it".

   Three decisions worth stating plainly, because each one is the kind that is
   painful to reverse once files carry the key:

   • The NAMES come from Settings.md, not from the account files. `owners: Ruan,
     Christine` declares the household's people once, and the account form
     offers a dropdown built from it. A free-text box on every account would let
     "Ruan" and "ruan" and "Ruan " become three people who each own part of the
     total, and no filter chip could put them back together.

   • An account whose file names an owner the settings do NOT declare is still
     that owner's. It keeps its value, appears under its own chip, and is
     offered in the dropdown so that editing some other field cannot silently
     reassign it. Settings declare the people the form OFFERS; they do not get
     to overrule what a file says. This is the same rule fieldsForType applies
     to a savings goal on a re-typed account: hiding a field is not deleting it.

   • `joint` is a reserved value, written to the file as that literal word and
     translated only on the way to the screen. Storing the translated label
     would mean an account created in English and read in Afrikaans belonged to
     someone called "Joint" who is not on the list — a file's meaning must not
     depend on the language the app happened to be in when it was written.

   Nothing here converts, excludes or reallocates. An owner is a label on an
   account; every household total still counts every account, exactly as it did
   before this key existed. Splitting the net worth by owner is a READING of the
   same figures, offered beside them and never instead of them. */

const i18n = require('./i18n');

/* The reserved value for an account both people share. Lower-case because that
   is what gets written; everything compares through ownerKey() below, so a
   hand-typed `owner: Joint` still lands here. */
const JOINT = 'joint';

/* Settings.md's `owners:` line → the declared people, in the order written.

   Takes a string or an array, because the two readers of Settings.md disagree
   about which one they hand over: load.js parses frontmatter line by line and
   always produces a string, while the settings tab reads Obsidian's own
   metadataCache, which turns `owners: [Ruan, Christine]` into a real array.
   Both spellings mean the same thing, so both are accepted rather than one of
   them quietly reading as a single person named "[Ruan, Christine]".

   Deduped case-insensitively and FIRST SPELLING WINS: a settings line reading
   "Ruan, ruan" declares one person, spelled the way they first wrote it. */
function parseOwners(raw) {
  const parts = Array.isArray(raw)
    ? raw.map(v => String(v ?? ''))
    // A flow list arrives here as the literal text when load.js did the
    // parsing, so the brackets come off before the split.
    : String(raw ?? '').replace(/^\s*\[/, '').replace(/\]\s*$/, '').split(',');
  const out = [];
  for (const p of parts) {
    const name = p.trim().replace(/^["']|["']$/g, '').trim();
    if (!name) continue;
    if (out.some(x => x.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

/* The comparison key for an owner value. Everything that groups, filters or
   totals goes through this, so "Ruan" in one file and "ruan" in another are one
   person on this page — the settings dropdown makes that rare, but a
   hand-edited vault is a supported way to use this app. '' means unassigned. */
function ownerKey(v) {
  return String(v ?? '').trim().toLowerCase();
}

const isJoint = v => ownerKey(v) === JOINT;

/* What an owner reads as on screen.

   A declared owner is shown with the spelling Settings.md gave it rather than
   the one the account file happens to carry, so fixing the capitalisation in
   one place fixes every tile. An owner the settings do not declare is shown
   exactly as its file spells it — this app has nothing better to offer than
   what the reader typed. */
function ownerLabel(v, declared = []) {
  const key = ownerKey(v);
  if (!key) return i18n.t('acct.owner.none');
  if (key === JOINT) return i18n.t('acct.owner.joint');
  return declared.find(d => d.toLowerCase() === key) || String(v).trim();
}

/* Every owner an account could be given, in the order the dropdown offers them:
   the declared people, then Joint, then any owner already written into an
   account file that the settings do not know about.

   That last group is the whole reason this takes `accounts` at all. Without it,
   opening the edit dialog on an account owned by someone since removed from the
   settings line would show a dropdown that cannot represent its current value —
   and saving any other field on that form would reassign the account to
   whichever option the control fell back to. */
function ownerOptions(declared, accounts = []) {
  const out = [...declared];
  const seen = new Set(out.map(v => v.toLowerCase()));
  seen.add(JOINT);
  for (const a of accounts) {
    const key = ownerKey(a && a.owner);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(a.owner).trim());
  }
  // Joint sits after the people and before the strays: it is a real choice on
  // the form, not an afterthought, but it is not a person.
  const people = out.slice(0, declared.length);
  const strays = out.slice(declared.length);
  return [...people, JOINT, ...strays];
}

/* What each owner's accounts come to, for the owners that actually have any.

   Net, by the SIGN of the balance, exactly as the hero figure above it is
   computed — an owner whose card debt exceeds their cash is worth a negative
   number here, and rounding that up to zero would make the per-owner column
   stop adding up to the household total the reader can see two lines away.

   `unassigned` is included as its own row when any account has no owner: a
   breakdown that quietly omitted them would print a set of figures that do not
   sum to the total, which is the one thing a breakdown must never do. */
function netByOwner(accounts, declared = []) {
  const order = [...declared.map(d => d.toLowerCase()), JOINT];
  const rows = new Map();
  for (const a of accounts) {
    const key = ownerKey(a.owner);
    if (!rows.has(key)) {
      rows.set(key, { key, label: ownerLabel(a.owner, declared), net: 0, count: 0 });
    }
    const row = rows.get(key);
    row.net += a.balance;
    row.count++;
  }
  return [...rows.values()].sort((x, y) => {
    // Unassigned last, whatever it is called: it is the absence of an answer,
    // not one of the answers.
    if (!x.key !== !y.key) return x.key ? -1 : 1;
    const xi = order.indexOf(x.key), yi = order.indexOf(y.key);
    if (xi !== yi) return (xi < 0 ? order.length : xi) - (yi < 0 ? order.length : yi);
    return x.label.localeCompare(y.label);
  });
}

/* Is there anything for an owner control to DO? One owner — or none — means
   every account answers the question the same way, and a filter row offering a
   single chip is a control that cannot change what is on screen. The Accounts
   page uses this to decide whether the owner band exists at all. */
function ownersWorthShowing(accounts) {
  const keys = new Set(accounts.map(a => ownerKey(a.owner)));
  keys.delete('');
  return keys.size > 0 && new Set(accounts.map(a => ownerKey(a.owner))).size > 1;
}

module.exports = {
  JOINT, parseOwners, ownerKey, isJoint, ownerLabel, ownerOptions, netByOwner,
  ownersWorthShowing,
};
