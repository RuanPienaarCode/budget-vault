'use strict';
/* Every word the split dialog and the shared form buttons show is a language
   key (2026-11-25 audit, TXN-6).

   The split dialog — title, "+ Add part", the Split and Cancel buttons, the
   "none" category option, the note placeholder, the Unallocated / Allocated /
   "Every part needs an amount" footer and the hint paragraph — was plain
   English in a view that otherwise speaks twelve languages, and so were the OK
   and Close buttons every form dialog carries. Cancel already had a key
   (bx.cancel), reused here.

   Pinned by opening the real dialogs over Obsidian's shipped markup
   (tests/helpers/modal-stub.cjs) under Japanese and Afrikaans and reading what
   is on screen:

     1. each visible string equals the language table's entry for the key the
        dialog is meant to use, in the active language
     2. none of them is the English sentence (checked for every key whose
        translation is not the same word as English — "OK" is "OK" in several
        languages, so that one is checked against the table only)
     3. the footer's three states, the hint and the Cancel/Close/OK buttons are
        covered, with their {amount} placeholder filled
     4. in English nothing moved: the exact words the dialogs always showed

     node tests/modal-words-are-keyed.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag } = require('./helpers/modal-stub.cjs');
const { readable } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { Modal } = stubModalObsidian();
const i18n = require('../src/i18n');
const { SplitModal, askFields, RulesCleanupModal } = require('../src/modal');

const money = v => `R ${Number(v).toFixed(2)}`;
const texts = root => {
  const out = [];
  const walk = e => { if (e._text) out.push(e._text); if (e.attrs && e.attrs.placeholder) out.push(e.attrs.placeholder); e.children.forEach(walk); };
  walk(root);
  return out;
};

function openSplit() {
  const m = new SplitModal({}, {
    tx: { date: '2026-07-30', desc: 'CHECKERS', label: 'Cheque', amount: -100, cat: 'Groceries' },
    categories: ['Groceries'], money,
  }, () => {});
  m.open();
  return m;
}

const KEYS = {
  title: 'tx.split.title', add: 'tx.split.addPart', submit: 'tx.split.submit', hint: 'tx.split.hint',
  note: 'tx.split.notePlaceholder', none: 'tx.field.none', cancel: 'bx.cancel',
};

for (const lang of ['ja', 'af']) {
  i18n.setLanguage(lang);
  const T = (k, p) => i18n.t(k, p);
  const en = (k, p) => { i18n.setLanguage('en'); const v = i18n.t(k, p); i18n.setLanguage(lang); return v; };

  const m = openSplit();
  const all = texts(m.modalEl);
  const buttons = byTag(m.modalEl, 'button').map(b => b.textContent);

  eq(m.titleEl.textContent, T(KEYS.title), `${lang}: the title is the keyed one`);
  ok(buttons.includes(T(KEYS.add)), `${lang}: the add-part button is keyed`);
  ok(buttons.includes(T(KEYS.submit)), `${lang}: the Split button is keyed`);
  ok(buttons.includes(T(KEYS.cancel)), `${lang}: the Cancel button is the shared bx.cancel`);
  ok(all.includes(T(KEYS.hint)), `${lang}: the hint paragraph is keyed`);
  ok(all.includes(T(KEYS.note)), `${lang}: the note placeholder is keyed`);
  ok(all.includes(T(KEYS.none)), `${lang}: the none option is the shared tx.field.none`);

  // Footer: all three states, with the amount filled in.
  m.parts[0].mag = 40; m.parts[1].mag = 0; m.refresh();
  eq(m.footEl.textContent, readable(T('tx.split.unallocated', { amount: money(-60) })), `${lang}: the unallocated state is keyed and filled`);
  m.parts[1].mag = 60; m.refresh();
  eq(m.footEl.textContent, readable(T('tx.split.balanced', { amount: money(-100) })), `${lang}: the balanced state is keyed and filled`);
  // Balanced, but one part still empty: three parts, the last at zero.
  m.parts.push({ mag: 0, cat: '', note: '' }); m.refresh();
  eq(m.footEl.textContent, T('tx.split.needAmount'), `${lang}: "every part needs an amount" is keyed`);

  // None of it is the English sentence.
  for (const k of [KEYS.title, KEYS.add, KEYS.submit, KEYS.hint, KEYS.note, 'tx.split.needAmount']) {
    ok(T(k) !== en(k), `${lang}: ${k} is translated, not the English text`);
  }
  ok(!buttons.includes('Cancel') && !buttons.includes('Split') && !all.includes('Split transaction'),
    `${lang}: no English button or title is left on screen`);
  m.close();

  // The generic form buttons.
  askFields({}, 'x', [{ key: 'a', label: 'A', type: 'text' }]);
  const form = Modal.last;
  const formButtons = byTag(form.contentEl, 'button').map(b => b.textContent);
  eq(formButtons, [T('bx.cancel'), T('modal.ok')], `${lang}: a form dialog's buttons are keyed`);
  form.close();

  // The tidy preview's Close (the only keyed word in that English-only dialog).
  const tidy = new RulesCleanupModal({}, { remove: [], redundant: [], blank: [], dormant: [], conflicts: [], kept: 0, checked: 0, total: 0 }, () => {});
  tidy.open();
  eq(byTag(tidy.contentEl, 'button').map(b => b.textContent), [T('modal.close')], `${lang}: Close is keyed`);
}

/* ---- 4. English is exactly what it always was ---- */
i18n.setLanguage('en');
{
  const m = openSplit();
  const buttons = byTag(m.modalEl, 'button').map(b => b.textContent);
  eq(m.titleEl.textContent, 'Split transaction', 'en: title');
  eq(buttons, ['＋ Add part', 'Cancel', 'Split'], 'en: buttons');
  m.parts[0].mag = 40; m.parts[1].mag = 60; m.refresh();
  eq(m.footEl.textContent, 'Allocated R -100.00 — balanced', 'en: balanced footer');
  m.parts[0].mag = 40; m.parts[1].mag = 0; m.refresh();
  eq(m.footEl.textContent, 'Unallocated: R -60.00', 'en: unallocated footer');
  m.parts.push({ mag: 0, cat: '', note: '' }); m.parts[1].mag = 60; m.refresh();
  eq(m.footEl.textContent, 'Every part needs an amount', 'en: needs-an-amount footer');
  ok(texts(m.modalEl).includes('Amounts are entered as positive — the split keeps the original’s direction. '
    + 'The original line stays in the file marked Excluded, so the totals are unchanged '
    + 'and re-importing this statement will not duplicate it.'),
  'en: the hint sentence, character for character');
  ok(texts(m.modalEl).includes('Note (optional)'), 'en: note placeholder');
  m.close();
  askFields({}, 'x', [{ key: 'a', label: 'A', type: 'text' }]);
  eq(byTag(Modal.last.contentEl, 'button').map(b => b.textContent), ['Cancel', 'OK'], 'en: OK and Cancel');
}

console.log(`PASS modal-words-are-keyed — the split dialog and the shared buttons speak the active language (${checks} checks)`);
