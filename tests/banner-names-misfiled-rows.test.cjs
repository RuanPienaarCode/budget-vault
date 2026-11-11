'use strict';
/* The app-wide banner names rows filed under the wrong month's file
   (2026-11-11 audit, task 5 follow-up — wave 2).

   Wave 1 gave misfiled rows a rule (src/misfiled.js) and two disclosures: a
   qualifier on the Dashboard hero and a note on the Transactions page. Both
   are on a page the reader has to be on. The banner controller.js draws above
   EVERY page — the one that already says which files could not be read —
   said nothing, so a reader on Accounts, watching an implied balance that no
   period explains, was told nothing at all. ctx.misfiledTx() is the seam
   wave 1 published for exactly this.

   The banner now carries a second sentence, in its own register and with its
   own length discipline: how many transactions, each file once with its own
   count, four files and then an ellipsis. It ARGUES: it names the file and
   the count and what follows from them, and nothing is moved or counted by
   date behind the reader's back.

   What this suite pins:

     1. the sentence (pure): names every file and its count, totals them,
        truncates at four, says nothing when there is nothing, reads its
        argument defensively, and follows the unreadable-files sentence
        rather than replacing it — including on a fresh vault, where that
        sentence is held back and this one is not;
     2. through the real loader and period.js: a row typed into another
        month's file is found by ctx.misfiledTx(null), the banner names the
        file it sits in, and the file is byte-for-byte where the reader left
        it;
     3. all twelve tables carry the three keys, beside the load.unreadable.*
        family they belong to, with the placeholders the code fills and the
        plural forms that language's own misfiled keys use;
     4. the wiring: render() hands the banner the whole vault's misfiled rows.

     node tests/banner-names-misfiled-rows.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const { unreadableBannerText, unreadableSummary } = require('../src/controller');
const i18n = require('../src/i18n');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
i18n.setLanguage('en');

const file = (rel, count) => ({ label: rel.split('/')[1], month: rel.slice(-10, -3), rel, count });
const found = (...files) => ({ count: files.reduce((s, f) => s + f.count, 0), files });
const ONE = found(file('Transactions/Cheque/2026-08.md', 1));
const TWO = found(file('Transactions/Cheque/2026-08.md', 2), file('Transactions/Savings/2026-07.md', 1));
const SIX = found(...['01', '02', '03', '04', '05', '06'].map(m => file(`Transactions/Cheque/2026-${m}.md`, 1)));

/* ---- 1. the sentence ---- */
{
  const one = unreadableBannerText([], true, i18n.t, ONE);
  eq(one, '1 transaction is filed under another month than its date: Transactions/Cheque/2026-08.md (1). '
    + 'No period lists or counts it, while the account balance still does.',
    'one row: the file, the count, and what follows from it');
  const two = unreadableBannerText([], true, i18n.t, TWO);
  ok(/^3 transactions are filed under another month than their date: /.test(two), 'several rows are totalled, in the plural');
  ok(two.includes('Transactions/Cheque/2026-08.md (2); Transactions/Savings/2026-07.md (1).'), 'each file is named once, with its own count');
  ok(/No period lists or counts them, while the account balance still does\.$/.test(two), 'and the consequence is stated, in the plural');
  ok(!/\bmoved\b|\bcorrected\b|\bfixed\b/i.test(two), 'it claims no correction — nothing was moved');

  const six = unreadableBannerText([], true, i18n.t, SIX);
  ok(/^6 transactions/.test(six), 'the total counts every file, named or not');
  eq((six.match(/\.md \(1\)/g) || []).length, 4, 'four files are named — the unreadable list\'s own limit');
  ok(six.includes('2026-04.md (1); ….'), 'and the rest are an ellipsis, as there');
  ok(!six.includes('2026-05.md'), 'the fifth is not printed');

  for (const nothing of [undefined, null, {}, { count: 0, files: [] }, { files: 'x' }, { count: 3 }, found(), { files: [{ rel: '', count: 2 }, { rel: 'a.md', count: 0 }, null] }])
    eq(unreadableBannerText([], true, i18n.t, nothing), '', `nothing to say for ${JSON.stringify(nothing)}`);
  eq(unreadableBannerText([], true), '', 'and the old call, with no misfiled argument, is as it was');

  /* After the unreadable-files sentence, never instead of it. */
  const broken = [{ rel: 'Assets.md', why: 'table' }];
  const both = unreadableBannerText(broken, true, i18n.t, ONE);
  eq(both, `${unreadableSummary(broken)} ${one}`, 'with unreadable files too, both sentences print — unreadable first');
  eq(unreadableBannerText(broken, true, i18n.t, null), unreadableSummary(broken), 'and that sentence alone is unchanged');
  /* A fresh vault: the missing Settings.md is held back (see
     tests/unreadable-banner-fresh-vault), a misfiled row is not — it can only
     exist if a month file does. */
  eq(unreadableBannerText([{ rel: 'Settings.md', why: 'missing' }], false, i18n.t, ONE), one,
    'before setup has run, only the misfiled sentence prints');
}

/* ---- 3. twelve tables ---- */
{
  const LANG = path.join(__dirname, '..', 'src', 'lang');
  const codes = fs.readdirSync(LANG).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
  eq(codes.length, 12, 'twelve language tables');
  for (const code of codes) {
    const table = require(path.join(LANG, `${code}.js`));
    const src = fs.readFileSync(path.join(LANG, `${code}.js`), 'utf8');
    const forms = Object.keys(table['tx.misfiled.why']).sort();
    for (const key of ['load.misfiled.head', 'load.misfiled.tail']) {
      const entry = table[key];
      ok(entry && typeof entry === 'object', `${code}: ${key} is a plural entry`);
      eq(Object.keys(entry).sort(), forms, `${code}: ${key} has the plural forms this language's own misfiled keys use`);
      for (const [form, text] of Object.entries(entry)) {
        ok(typeof text === 'string' && text.trim(), `${code}: ${key}.${form} is written`);
        if (key.endsWith('head')) ok(text.includes('{count}') && text.includes('{list}'), `${code}: ${key}.${form} prints the count and the list`);
        eq((text.match(/\{(\w+)\}/g) || []).filter(p => !['{count}', '{list}'].includes(p)), [], `${code}: ${key}.${form} has no placeholder the code does not fill`);
      }
    }
    const item = table['load.misfiled.item'];
    ok(typeof item === 'string' && item.includes('{file}') && item.includes('{count}'), `${code}: load.misfiled.item names the file and its count`);
    /* Beside the family they belong to, not at the end of the table. */
    const at = k => src.indexOf(`'${k}'`);
    ok(at('load.unreadable.tail') > 0 && at('load.unreadable.tail') < at('load.misfiled.head')
      && at('load.misfiled.head') < at('load.misfiled.item') && at('load.misfiled.item') < at('load.misfiled.tail'),
    `${code}: the three keys sit after load.unreadable.tail, in order`);
    ok(src.slice(at('load.unreadable.tail'), at('load.misfiled.head')).split('\n').length <= 3, `${code}: …directly after it`);

    i18n.setLanguage(code);
    for (const f of [ONE, TWO, SIX]) {
      const text = unreadableBannerText([], true, i18n.t, f);
      ok(text && !/[{}]/.test(text), `${code}: the sentence fills every placeholder (${f.count})`);
      ok(text.includes('Transactions/Cheque/2026-08.md') || f === SIX, `${code}: and names the file`);
      ok(text.includes(String(f.count)), `${code}: and the count`);
      ok(!/load\.misfiled/.test(text), `${code}: no key is printed in place of its text`);
    }
    if (code !== 'en') {
      i18n.setLanguage('en');
      const en = unreadableBannerText([], true, i18n.t, TWO);
      i18n.setLanguage(code);
      ok(unreadableBannerText([], true, i18n.t, TWO) !== en, `${code}: it is a translation, not the English fallback`);
    }
  }
  i18n.setLanguage('en');
}

/* ---- 4. wiring ---- */
{
  const ctl = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  ok(/unreadableBannerText\(S\.unreadableFiles, plugin\.settings\.onboarded, i18n\.t,\s*typeof ctx\.misfiledTx === 'function' \? ctx\.misfiledTx\(null\) : null\)/.test(ctl),
    'render() hands the banner the whole vault\'s misfiled rows, through the seam period.js publishes');
}

/* ---- 2. through the real loader ---- */
(async () => {
  const MONTH = `${B}/Transactions/Cheque/2026-08.md`;
  const files = { ...SEED };
  /* Typed into August's file with a September date: out of August by its
     date, out of September by its file. */
  files[MONTH] = files[MONTH] + '| 2026-09-03 | pasted into the wrong month | Groceries | -42.00 |  |  |  |\n';
  const ctx = H.makeCtx(files, { budgetFolder: B });
  const S = await H.loadInto(ctx);
  const before = new Map(ctx.vault._store);
  const misfiled = ctx.misfiledTx(null);
  eq(misfiled.count, 1, 'the real loader and period.js find the one misfiled row in the whole vault');
  const text = unreadableBannerText(S.unreadableFiles, true, i18n.t, misfiled);
  eq(text, '1 transaction is filed under another month than its date: Transactions/Cheque/2026-08.md (1). '
    + 'No period lists or counts it, while the account balance still does.',
    'the banner names the file the row sits in, by the path it was read from');
  eq([...ctx.vault._store.entries()], [...before.entries()], 'and nothing in the vault moved: the row is where the reader typed it');
  ok(S.txFiles['Cheque/2026-08'].rows.some(r => r.date === '2026-09-03'), '…still in August\'s file, in memory too');

  const clean = H.makeCtx({ ...SEED }, { budgetFolder: B });
  await H.loadInto(clean);
  eq(unreadableBannerText(clean.S.unreadableFiles, true, i18n.t, clean.misfiledTx(null)), '', 'a household with no misfiled row has no banner');

  console.log(`PASS banner-names-misfiled-rows (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
