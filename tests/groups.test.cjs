'use strict';
/* Custom category groups (src/groups.js): the Settings.md `groups` and
   `nonessential_groups` lines, the order they produce, and the emergency
   maths they feed. Pure functions — no DOM, no obsidian. */
const assert = require('node:assert/strict');
const path = require('node:path');
const SRC = path.join(__dirname, '..', 'src');
const { parseGroups, parseNonEssential, typeOrder, typeRank, normaliseKey } = require(path.join(SRC, 'groups.js'));
const { TYPE_ORDER } = require(path.join(SRC, 'constants.js'));
const { essentialTotal } = require(path.join(SRC, 'health-math.js'));
const { serializeBudgetFile } = require(path.join(SRC, 'budget-file.js'));

let n = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

/* ---- 1. parsing: keys are normalised, deduped, and never shadow a built-in ---- */
eq(parseGroups(''), [], 'blank line → no custom groups');
eq(parseGroups(undefined), [], 'absent key → no custom groups');
eq(parseGroups('property, treats'), ['property', 'treats'], 'plain comma list');
eq(parseGroups('Kids School, treats, TREATS'), ['kids-school', 'treats'], 'lower-cased, spaces folded to -, duplicates dropped');
eq(parseGroups('["property", "treats"]'), ['property', 'treats'], 'a YAML flow list arriving as text parses the same');
eq(parseGroups(['property', 'treats']), ['property', 'treats'], 'a real array (metadataCache) parses the same');
eq(parseGroups('housing, expense, property'), ['property'], 'built-in names are dropped, not duplicated');
eq(parseGroups(' , ,'), [], 'only separators → nothing');
eq(normaliseKey('  Héllo World! '), 'h-llo-world', 'non-ascii and punctuation become one dash, edges trimmed');

/* ---- 2. order: customs sit before expense; unknown types sort last ---- */
{
  const order = typeOrder(['property', 'treats']);
  const iExp = order.indexOf('expense');
  eq(order.slice(iExp - 2, iExp), ['property', 'treats'], 'custom groups spliced in, in written order, just before expense');
  eq(order.length, TYPE_ORDER.length + 2, 'nothing else added or lost');
  eq(typeOrder([]), TYPE_ORDER, 'no customs → the built-in order exactly');
  eq(typeOrder('property'), typeOrder(['property']), 'accepts the raw line too');
  assert.ok(typeRank('income', order) < typeRank('property', order), 'income still first'); n++;
  assert.ok(typeRank('nobody-declared', order) > typeRank('transfer', order), 'an undeclared type sorts AFTER transfer, not above income'); n++;
}

/* ---- 3. nonessential: validated against what exists; built-ins allowed ---- */
eq(parseNonEssential('treats, personal, ghost', ['treats']), ['treats', 'personal'], 'custom and built-in keys kept, unknown dropped');
eq(parseNonEssential('treats', []), [], 'a key naming no declared group is dropped');
eq(parseNonEssential('', ['treats']), [], 'blank → nothing extra');

/* ---- 4. the emergency divisor honours the list, and only ever shrinks ---- */
{
  const types = { Rent: 'housing', Coffee: 'treats', Hair: 'personal', TFSA: 'savings' };
  const typeOf = c => types[c] || null;
  const spend = { Rent: 9000, Coffee: 800, Hair: 400, TFSA: 2000 };
  eq(essentialTotal(spend, typeOf), 10200, 'without the list a custom group counts as essential (bills over treats)');
  eq(essentialTotal(spend, typeOf, ['treats']), 9400, 'a listed custom group drops out');
  eq(essentialTotal(spend, typeOf, new Set(['treats', 'personal'])), 9000, 'a Set works, and a built-in can be listed too');
  eq(essentialTotal(spend, typeOf, ['savings', 'housing-no']), 10200, 'listing an already-non-essential or unknown key changes nothing');
}

/* ---- 5. the period file is written in the vault's order ---- */
{
  const rows = [
    { category: 'Other', type: 'expense', amount: 1, notes: '' },
    { category: 'Flat', type: 'property', amount: 2, notes: '' },
    { category: 'Pay', type: 'income', amount: 3, notes: '' },
    { category: 'Mystery', type: 'zzz', amount: 4, notes: '' },
  ];
  const text = serializeBudgetFile({ period: '2026-08', rows, groups: ['property'] });
  const names = text.split('\n').filter(l => /^\| [A-Z]/.test(l) && !l.startsWith('| Category')).map(l => l.split('|')[1].trim());
  eq(names, ['Pay', 'Flat', 'Other', 'Mystery'], 'income, then the custom group, then expense, then the undeclared type last');
}

/* ---- the Non-essential picker: a closed set, offered as toggles ----------
   This setting was a comma-separated TEXT box until 30 Aug 2026, and it made
   the reader type a group name they had already typed one row above, then
   silently discarded anything it did not recognise — including, thanks to a
   stale snapshot of Settings.md, the group they had JUST declared. The rows
   below are the model behind the toggles that replaced it. Pinned here rather
   than in settings-tab.js, which cannot be required without Obsidian. */
{
  const fs = require('node:fs');
  const i18n = require(path.join(SRC, 'i18n.js'));
  const { NON_ESSENTIAL_TYPES } = require(path.join(SRC, 'health-math.js'));
  /* This file declares only eq() at the top; these checks want a truth test. */
  const ok = (c, msg) => { assert.ok(c, msg); n++; };
  i18n.setLanguage('en');

  /* Mirrors BudgetSettingTab.nonEssentialRows(). */
  const rows = md => {
    const groups = parseGroups(md.groups);
    const current = new Set(parseNonEssential(md.nonessential_groups, groups));
    const builtin = new Set(TYPE_ORDER);
    return typeOrder(groups)
      .filter(k => !NON_ESSENTIAL_TYPES.has(k))
      .map(k => ({ key: k, label: builtin.has(k) ? i18n.t('wiz.type.' + k) : k, on: current.has(k) }));
  };
  const md = { groups: 'treats, property', nonessential_groups: 'treats, personal' };
  const r = rows(md);

  /* A switch that cannot be flipped is not offered at all. */
  for (const k of NON_ESSENTIAL_TYPES) {
    ok(!r.some(x => x.key === k),
      `'${k}' is non-essential whatever this setting says, so it must not appear as a toggle that pretends otherwise`);
  }
  ok(r.some(x => x.key === 'treats') && r.some(x => x.key === 'property'),
    'the vault\'s own custom groups are offered, which is the whole reason the old box made you retype them');
  eq(r.filter(x => x.on).map(x => x.key), ['personal', 'treats'],
    'what is already in nonessential_groups comes back ticked, built-in and custom alike');
  ok(r.every(x => x.label && x.label !== 'wiz.type.' + x.key),
    'every built-in row is labelled with the same words the Budget page uses, not a raw key or a missing translation');
  eq(r.map(x => x.key), typeOrder(parseGroups(md.groups)).filter(k => !NON_ESSENTIAL_TYPES.has(k)),
    'rows follow the Budget page order, custom groups spliced in before expense');

  /* Mirrors BudgetSettingTab.setNonEssential(): flip one, rewrite the list. */
  const flip = (m, key, on) => {
    const groups = parseGroups(m.groups);
    const next = new Set(parseNonEssential(m.nonessential_groups, groups));
    if (on) next.add(key); else next.delete(key);
    return typeOrder(groups).filter(k => next.has(k)).join(', ');
  };
  eq(flip(md, 'property', true), 'personal, treats, property', 'ticking adds, in page order');
  eq(flip(md, 'treats', false), 'personal', 'unticking removes');
  eq(flip(md, 'housing', true), 'housing, personal, treats',
    'the written order follows typeOrder, not the order the switches were tapped');
  eq(flip(md, 'treats', true), 'personal, treats', 'ticking something already on is a no-op, not a duplicate');

  /* And the text box must not come back: it is the thing that made the reader
     type "treats" twice and lost it when they did. */
  const tab = fs.readFileSync(path.join(SRC, 'settings-tab.js'), 'utf8');
  ok(!/type:\s*'text',\s*key:\s*'nonessential_groups'/.test(tab),
    'nonessential_groups must not be bound to a free-text control again');
  ok(!/placeholder\('treats, personal'\)/.test(tab),
    'the old comma-list placeholder is gone with it');
  ok(/nonEssentialRows\(/.test(tab) && /setNonEssential\(/.test(tab),
    'both halves of the tab drive the toggles through the shared helpers');
}

console.log(`groups.test.cjs — ${n} checks OK`);
