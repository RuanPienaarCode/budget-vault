'use strict';
/* "Show 55 more of 55 remaining" (2026-09-29 totals audit, lane Y item 3).

   The Transactions table windows at 100 rows. The button said "Show {n} more of
   {remaining} remaining" always, so when what was left fitted in one page it
   printed the same number twice. When the remainder is a page or less the
   button now says it takes the rest; over a page it keeps the old sentence,
   which is the only case where the two numbers differ. Both are plural through
   `count`, and the singular is pinned: "1 remaining" is where a wrong plural
   form shows.

   Synthetic rows.
     node tests/lane-y-show-rest.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, textOf, mountFor, pinClock } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* n rows in September, one per description, dated the 1st..28th cyclically. */
const files = n => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx(Array.from({ length: n }, (_, i) =>
    [`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, `Shop ${i}`, 'Groceries', -1])),
});
/* The window's button is the only row with a single full-width cell; a data
   row's own controls (the category picker) are buttons too. */
const moreButton = ctx => {
  const rows = find(ctx.$('#txTable'), n => n.tagName === 'TR');
  const last = rows[rows.length - 1];
  if (!last || find(last, n => n.tagName === 'TD').length !== 1) return null;
  return find(last, n => n.tagName === 'BUTTON')[0] || null;
};

async function page(n) {
  const unpin = pinClock('2026-09-29');
  try {
    const M = await mountFor(files(n), { period: '2026-09' });
    M.ctx.renderTransactions();
    return M.ctx;
  } finally { unpin(); }
}

(async () => {
  /* ---- 155 rows: 55 left after the first page ---------------------------------- */
  {
    const ctx = await page(155);
    const b = moreButton(ctx);
    eq(textOf(b), 'Show the remaining 55 rows', 'a remainder that fits in one page says it takes the rest');
    ok(!/55 more of 55/.test(textOf(b)), 'and never the same number twice');
    b._fire('click');
    eq(moreButton(ctx), null, 'taking it shows everything: no button is left');
    eq(textOf(ctx.$('#txCount')), '155 rows', 'all 155 rows are listed');
  }
  /* ---- exactly one page left ---------------------------------------------------- */
  {
    const ctx = await page(200);
    eq(textOf(moreButton(ctx)), 'Show the remaining 100 rows', 'a remainder of exactly one page is still "the remaining"');
  }
  /* ---- more than a page left: the old wording, where the numbers differ --------- */
  {
    const ctx = await page(250);
    const b = moreButton(ctx);
    eq(textOf(b), 'Show 100 more of 150 remaining', 'over a page left keeps the old sentence');
    b._fire('click');
    eq(textOf(moreButton(ctx)), 'Show the remaining 50 rows', 'and after one click the rest fits, so it changes');
  }
  /* ---- one row left: the singular ------------------------------------------------ */
  {
    const ctx = await page(101);
    eq(textOf(moreButton(ctx)), 'Show the remaining row', 'the singular, through count');
  }
  /* ---- no button when everything fits -------------------------------------------- */
  {
    const ctx = await page(100);
    eq(moreButton(ctx), null, 'a full page and nothing over has no button');
  }
  /* ---- every language has both forms where the language has two ------------------- */
  const ONE_FORM = new Set(['id', 'ja', 'zh']);
  for (const lang of ['en', 'af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu']) {
    i18n.setLanguage(lang);
    const many = i18n.t('tx.showRest', { remaining: 55, count: 55 });
    const one = i18n.t('tx.showRest', { remaining: 1, count: 1 });
    ok(many !== 'tx.showRest' && /55/.test(many), `${lang}: the plural form names the number`);
    ok(one !== 'tx.showRest', `${lang}: the singular resolves`);
    if (!ONE_FORM.has(lang)) ok(one !== many, `${lang}: singular differs from plural`);
  }
  i18n.setLanguage('en');
  console.log(`PASS lane-y-show-rest (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
