'use strict';
/* Two English literals in a translated view (2026-10-14 audit, L8-09, Dashboard
   half): the donut's collapsed slice was named `Other (${n})` and the legend's
   category-note button carried title="Open category note". In any other
   language the reader met an English word in the middle of a translated chart.

   Rendered here in German over a household with ten spending categories (the
   donut draws eight and folds the rest), so both literals are on the page.

     node tests/dashboard-donut-literals.test.cjs */
const assert = require('assert');
const { B, tx, base, cat, account, textOf, find, hasClass, renderDash } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The language is the household's own setting (Settings.md `language:`), read by
   the loader at mount — setLanguage() before the render would be undone by it. */
const household = lang => {
  const f = {
    ...base(`language: ${lang}\n`),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-09-01' }),
  };
  for (const n of names) f[`${B}/Categories/${n}.md`] = cat('expense');
  f[`${B}/Transactions/Cheque/2026-09.md`] = tx(names.map((n, i) => [`2026-09-0${(i % 8) + 1}`, `Shop ${n}`, n, -(1000 - i * 50)]));
  return f;
};
const names = Array.from({ length: 10 }, (_, i) => `Kat${i + 1}`);
const slice = async lang => {
  const d = await renderDash(household(lang), { today: '2026-09-20', period: '2026-09' });
  const split = d.nodes.get('#dashSplit');
  const titles = find(split, n => String(n.tagName).toLowerCase() === 'title').map(textOf);
  const legend = find(split, n => n.tagName === 'LI').map(textOf);
  const noteBtns = find(split, n => hasClass(n, 'dl-note'));
  return { titles, legend, noteBtns, all: textOf(split) };
};

(async () => {
  const en = await slice('en');
  ok(en.titles.some(t => /^Other \(2\):/.test(t)), `English still reads "Other (2)" — got: ${en.titles.join(' | ')}`);
  eq(en.noteBtns[0].attrs.title, 'Open the Kat1 category note', 'English title is the aria sentence for that category');

  const de = await slice('de');
  ok(!/Other \(/.test(de.all) && !de.titles.some(t => /^Other/.test(t)), `German has no English "Other (n)" — got: ${de.titles.join(' | ')}`);
  ok(de.titles.some(t => /^Sonstige \(2\):/.test(t)), `the slice is the German word with its count — got: ${de.titles.join(' | ')}`);
  ok(de.legend.some(t => /Sonstige \(2\)/.test(t)), 'and so is the legend row');
  ok(de.noteBtns.length > 0 && de.noteBtns.every(b => !/Open category note/.test(b.attrs.title)), 'no note button keeps the English title');
  const deTable = require('../src/lang/de');
  eq(de.noteBtns[0].attrs.title, deTable['dash.split.noteAria'].replace('{cat}', 'Kat1'), 'the title is the German aria sentence for that category');
  i18n.setLanguage('en');

  console.log(`PASS dashboard-donut-literals — the donut's "Other (n)" slice and the note button's title come from the translation tables (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
