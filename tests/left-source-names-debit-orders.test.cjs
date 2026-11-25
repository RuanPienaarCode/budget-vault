'use strict';
/* The footnote under "Still committed" says what the list really counts
   (2026-11-25 audit, NUM-5).

   It said the list was "Read from your Services list and Debt page only — a
   recurring charge on neither is not counted here". Since the 2026-10-20 audit
   (L2a-N05 / L1-10) the list ALSO holds debit orders the app found in the
   transactions themselves (committed.js debitOrderCommitments: the same amount,
   about the same day, three months running). A reader told "only" those two
   lists would look for a row that is not on either and conclude the card was
   wrong. The note now names all three sources and the one shape still not
   counted — a charge paid by hand on varying days — in every language.

   Each language is checked in its own words: the "only those two lists"
   clause it used to carry is gone, and it names debit orders with the same
   word its own "Still committed" count uses (dash.left.orders), so the note
   and the figure beside it describe one list.

     node tests/left-source-names-debit-orders.test.cjs */

const assert = require('assert');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The clause each language carried that said "these two lists only". */
const OLD_ONLY = {
  af: 'Dit lees net uit', de: 'Gelesen wird nur aus', en: 'Debt page only', es: 'Solo se leen de',
  fr: 'Lus uniquement depuis', hi: 'सिर्फ़ आपकी सेवाओं', id: 'Dibaca hanya dari', ja: 'のみを読み取ります',
  pt: 'Lidos apenas da', xh: 'nakwiphepha lamaTyala kuphela', zh: '只读取', zu: 'nasekhasini lezikweletu kuphela',
};
/* The word for a debit order in each language's own "{count} debit orders". */
const ORDER_WORD = {
  af: 'debietorder', de: 'Lastschrift', en: 'debit order', es: 'domiciliaci', fr: 'prélèvements constatés',
  hi: 'ऑटो-डेबिट', id: 'autodebet', ja: '口座振替', pt: 'débitos automáticos', xh: 'debit order', zh: '代扣', zu: 'debit order',
};

for (const lang of Object.keys(OLD_ONLY)) {
  const table = require(path.join(__dirname, '..', 'src', 'lang', `${lang}.js`));
  const text = table['dash.left.source'];
  ok(typeof text === 'string' && text.length > 0, `${lang}: the note exists`);
  ok(!text.includes(OLD_ONLY[lang]), `${lang}: no longer says the list is read from Services and Debt only: ${text}`);
  ok(text.includes(ORDER_WORD[lang]), `${lang}: names the debit orders the list also holds (${ORDER_WORD[lang]}): ${text}`);
}

const en = require('../src/lang/en.js')['dash.left.source'];
ok(/same amount on about the same day each month/.test(en), 'en: says how a debit order is recognised');
ok(/paid by hand on different days/.test(en) && /unless it is on your Services list/.test(en),
  'en: and what is still not counted, with the way to get it counted');

console.log(`PASS left-source-names-debit-orders (${checks} checks)`);
