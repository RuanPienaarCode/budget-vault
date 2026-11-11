'use strict';
/* A row filed under the wrong month's file is DISCLOSED, not moved and not
   quietly counted (2026-11-11 audit, task 5; decision: keep the filename fast
   path, argue instead of correcting).

   The period walk reads a month file only when the period touches that month
   (period.js txInRange, figures.js unreadableAmounts), then filters rows by
   date. So a row dated 2026-09-03 sitting in 2026-08.md — a hand edit, or a
   row pasted across a month boundary — is out of August by its date and out
   of September by its file, while reconcile() still counts it: the implied
   balance moves and no period shows why.

   What this pins, in the order the money is looked for:

     1. the detection, pure and today-free (src/misfiled.js): which rows are
        dated outside their file's month, and which of those no period reads;
     2. the detection against the REAL walk: on three period shapes (calendar
        month, payday month, a 14-day cycle) the rows misfiledTx() names are
        exactly the rows that are in the vault and in no period's txInPeriod —
        an oracle spelled with the seam the pages read, not with the
        predicate under test;
     3. that the defect is disclosed and NOT repaired: the fast path still
        skips the file, reconcile() still counts the row, nothing is dirty;
     4. the rendered sentences, through the real views: the Dashboard hero of
        the period the money is missing from, and the Transactions page.

     node tests/misfiled-rows-disclosed.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { FakeEl } = require('./helpers/dom-stub.cjs');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { misfiledRows, fileOutsideWindow, uncountedRows, summariseMisfiled } = require('../src/misfiled');
const { reconcile } = require('../src/reconcile');

/* ---- 1. the detection, pure --------------------------------------------- */
{
  const file = {
    label: 'Cheque', month: '2026-08', rel: 'Transactions/Cheque/2026-08.md',
    rows: [
      { date: '2026-08-31', desc: 'in its own month', amount: -10 },
      { date: '2026-09-03', desc: 'next month', amount: -500 },
      { date: '2026-07-30', desc: 'previous month', amount: -20, excluded: true },
      { date: '2025-08-15', desc: 'same month, another year', amount: -30 },
      { date: '2026-13-05', desc: 'no such month', amount: -40 },
      { date: 'end of June', desc: 'not a date', amount: -50 },
      { date: '', desc: 'blank', amount: -60 },
      { date: '2026-09-04', desc: 'live split parent', amount: -900, excluded: true, split: 'parent' },
      { date: '2026-09-04', desc: 'its part', amount: -900, split: 'part' },
      { date: '2026-09-05', desc: 'reversed split', amount: -70, excluded: false, split: 'parent' },
    ],
  };
  eq(misfiledRows(file).map(r => r.desc), ['next month', 'previous month', 'same month, another year', 'its part', 'reversed split'],
    'a row is misfiled when its date is a real day in another calendar month than the file is named for');
  ok(!misfiledRows(file).some(r => /no such month|not a date|blank/.test(r.desc)),
    'a date that names no day is not "another month": it is the unreadable-date disclosure\'s subject (reconcile.js), and is not counted twice');
  ok(misfiledRows(file).some(r => r.excluded),
    'an Excluded row counts: the money still moved, and the Score and the Accounts chips read it by period too');
  ok(!misfiledRows(file).some(r => r.desc === 'live split parent'),
    'a superseded split parent does not (tx-role.js): its parts carry the money, and counting both would report one purchase as two rows');
  eq(misfiledRows({ month: '2026-08', rows: [] }), [], 'an empty file has nothing misfiled');
  eq(misfiledRows(null), [], 'and a missing file is not an error');

  ok(fileOutsideWindow('2026-08', '2026-09-01', '2026-09-30'), 'the walk\'s own veto: August\'s file is not read for a September window');
  ok(!fileOutsideWindow('2026-08', '2026-08-23', '2026-09-22'), 'and is read for a payday month that begins in August');

  /* Calendar months: every misfiled row is in no period. */
  const calendar = d => ({ start: `${d.slice(0, 7)}-01`, end: `${d.slice(0, 7)}-31` });
  eq(uncountedRows({ a: file }, calendar).map(x => x.row.desc),
    ['next month', 'previous month', 'same month, another year', 'its part', 'reversed split'],
    'under calendar months no period reads a row dated outside its file\'s month');
  /* A payday month beginning on the 23rd: the period that owns 3 September
     runs 23 Aug – 22 Sep and so reads August's file. That row is counted, and
     saying otherwise would be a caveat with no figure under it. */
  const payday = d => (d >= '2026-08-23' && d <= '2026-09-22' ? { start: '2026-08-23', end: '2026-09-22' }
    : d >= '2026-07-23' && d <= '2026-08-22' ? { start: '2026-07-23', end: '2026-08-22' }
      : { start: '2025-07-23', end: '2025-08-22' });
  eq(uncountedRows({ a: file }, payday).map(x => x.row.desc), ['same month, another year'],
    'under a payday month a misfiled row whose own period still reads its file is counted, and is not disclosed as missing');
  eq(uncountedRows({ a: file }, () => null).length, 5, 'a date no window owns is uncounted by definition');

  const sum = summariseMisfiled([
    { file, row: file.rows[1] }, { file, row: file.rows[2] },
    { file: { label: 'Card', month: '2026-07', rel: 'Transactions/Card/2026-07.md' }, row: { date: '2026-08-01' } },
  ]);
  eq(sum, { count: 3, files: [
    { label: 'Card', month: '2026-07', rel: 'Transactions/Card/2026-07.md', count: 1 },
    { label: 'Cheque', month: '2026-08', rel: 'Transactions/Cheque/2026-08.md', count: 2 },
  ] }, 'the summary names each file once with its own count, in path order');
  eq(summariseMisfiled([]), { count: 0, files: [] }, 'and is empty, not absent, when nothing is misfiled');

  /* today-free, as the decision asks: whether a row is misfiled is a fact
     about the file, and must read the same on any day. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'misfiled.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/todayIso|new Date\(\)|Date\.now/.test(src), 'src/misfiled.js never reads the clock');
  ok(!/require\('obsidian'\)|document\.|window\./.test(src), 'and is pure: no obsidian, no DOM');
}

/* ---- the household ------------------------------------------------------- */
const B = 'Budget';
const HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${Number(r[3]).toFixed(2)} | ${r[4] || ''} |  |  |\n`).join('');
const household = (settings = 'month_start_day: 1\n') => ({
  [`${B}/Settings.md`]: `---\n${settings}currency: "R"\ncountry: za\n---\n`,
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 10000.00\nbalance_updated: 2026-07-31\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit\ntx_label: "Card"\nbalance: -100.00\nbalance_updated: 2026-07-31\n---\n',
  [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: tx([
    ['2026-08-05', 'Shop A', 'Groceries', -300],
    ['2026-08-25', 'Salary', 'Salary', 30000],
    /* The audit's own scenario: dated 3 September, filed under August. */
    ['2026-09-03', 'Pasted across the boundary', 'Groceries', -500],
    /* And a row no payday period can reach from August's file either. */
    ['2026-09-27', 'Late September, still in August', 'Groceries', -70],
    /* Misfiled AND marked Excluded: missing from September's list like the
       others, but never part of September's budget figures. */
    ['2026-09-15', 'Vetoed and misfiled', 'Groceries', -40, 'yes'],
  ]),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-10', 'Shop B', 'Groceries', -200],
    ['2026-09-12', 'Shop C', 'Groceries', -150],
  ]),
  [`${B}/Transactions/Card/2026-10.md`]: tx([
    ['2026-10-02', 'Fuel', 'Groceries', -400],
    ['2026-09-30', 'Dated the day before the file starts', 'Groceries', -80],
  ]),
});

const allRows = ctx => {
  const out = [];
  for (const f of Object.values(ctx.S.txFiles)) for (const r of f.rows) out.push(r);
  return out;
};
/* Every period from well before the data to well after it, by the app's own
   stepping — whatever shape a period has under these settings. */
function periodsAcross(ctx, from, to) {
  const out = [];
  let p = ctx.currentPeriod(from);
  for (let i = 0; i < 80; i++) {
    out.push(p);
    if (ctx.periodRange(p).start > to) break;
    p = ctx.shiftPeriod(p, 1);
  }
  return out;
}

(async () => {
  /* ---- 2. the detection is exactly what the real walk loses -------------- */
  const SHAPES = [
    /* Calendar months lose all four misfiled rows. From the 23rd, the period
       running 23 Aug – 22 Sep reads August's file and the one running
       23 Sep – 22 Oct reads October's, so only "Late September, still in
       August" is in no period. The 14-day cycle from 7 August loses that one
       (its period 18 Sep – 1 Oct reads September and October) and the row
       dated 15 September, whose period 4 – 17 Sep reads September alone. The
       oracle above decides; these pin that it was not vacuous. */
    ['calendar months', 'month_start_day: 1\n', 4],
    ['a payday month from the 23rd', 'month_start_day: 23\n', 1],
    ['a 14-day cycle', 'month_start_day: 1\nperiod_days: 14\nperiod_anchor: 2026-08-07\n', 2],
  ];
  for (const [name, settings, expected] of SHAPES) {
    const ctx = makeCtx(household(settings), {});
    await loadInto(ctx);
    const seen = new Set();
    for (const p of periodsAcross(ctx, '2026-05-01', '2026-12-31')) for (const t of ctx.txInPeriod(p)) seen.add(t._row);
    const lost = allRows(ctx).filter(r => !seen.has(r)).map(r => r.desc).sort();
    const named = ctx.misfiledTx();
    eq(ctx.misfiledRowsIn().map(x => x.row.desc).sort(), lost,
      `${name}: the rows misfiledTx names are exactly the rows no period's txInPeriod returns`);
    eq(named.count, lost.length, `${name}: and the count it prints is that many`);
    eq(named.count, expected, `${name}: ${expected} on this household`);
    ok(named.files.every(f => /^Transactions\/(Cheque|Card)\/2026-\d\d\.md$/.test(f.rel)),
      `${name}: each is named by the path of the file it sits in (${named.files.map(f => f.rel).join(', ')})`);
  }

  /* ---- 3. disclosed, not repaired ---------------------------------------- */
  {
    const files = household();
    const before = JSON.stringify(files);
    const ctx = makeCtx(files, {});
    await loadInto(ctx);
    ok(!ctx.txInPeriod('2026-09').some(t => t.desc === 'Pasted across the boundary'),
      'the fast path is KEPT: September still does not read August\'s file (the decision, not an oversight)');
    ok(!ctx.txInPeriod('2026-08').some(t => t.desc === 'Pasted across the boundary'),
      'and August still drops the row by its date');
    eq(ctx.periodSummary('2026-09', '2026-11-11').spend, 350, 'so September\'s spend is still the two rows filed under it: nothing is silently counted');
    const cheque = ctx.S.accounts.find(a => a.name === 'Cheque');
    const rec = reconcile(cheque, ctx.accountIndex().get(cheque).rows, '2026-11-11');
    eq(rec.delta, -300 + 30000 - 500 - 70 - 40 - 200 - 150, 'while reconcile() counts it, as it always did — the disagreement the notice exists to explain');

    eq(ctx.misfiledTx('2026-09'), { count: 4, files: [
      { label: 'Card', month: '2026-10', rel: 'Transactions/Card/2026-10.md', count: 1 },
      { label: 'Cheque', month: '2026-08', rel: 'Transactions/Cheque/2026-08.md', count: 3 },
    ] }, 'September is told which files hold the four rows dated inside it that it does not read');
    eq(ctx.misfiledTx('2026-08').count, 0, 'August is missing nothing: no row dated in August sits in another month\'s file');
    eq(ctx.misfiledTx('2026-07').count, 0, 'nor is a period with no data at all');
    /* The hero's figures are short by the rows the BUDGET lens would have
       kept. The Excluded one was never going to be in them, so it is not in
       the count printed beside them — the same rule the unreadable-amount
       caveat on this card follows. */
    const sept = { count: 3, files: [
      { label: 'Card', month: '2026-10', rel: 'Transactions/Card/2026-10.md', count: 1 },
      { label: 'Cheque', month: '2026-08', rel: 'Transactions/Cheque/2026-08.md', count: 2 },
    ] };
    eq(ctx.misfiledTx('2026-09', { budgetOnly: true }), sept, 'budgetOnly leaves out the misfiled row the reader marked Excluded');
    eq(ctx.periodFigures('2026-09').misfiled, sept, 'and periodFigures carries THAT reading, so every page handed the snapshot gets the caveat for the figures in it');
    {
      /* Negative control: the same row without its Excluded tick is counted. */
      const f = ctx.S.txFiles['Cheque/2026-08'];
      const vetoed = f.rows.find(r => r.desc === 'Vetoed and misfiled');
      vetoed.excluded = false;
      eq(ctx.periodFigures('2026-09').misfiled.count, 4, 'unticked, the same row is one the budget figures are missing');
      vetoed.excluded = true;
    }

    ok(Object.values(ctx.S.txFiles).every(f => !f.dirty), 'no file is marked dirty by detecting it');
    eq(JSON.stringify(files), before, 'and no file in the vault was written: rows are not moved, dates are not corrected');
  }

  /* ---- 4. the sentences, through the real views -------------------------- */
  const unpin = pinClock('2026-11-11');
  try {
    const M = await mountFor(household(), { period: '2026-09' });
    const { ctx, nodes } = M;
    const { heroQualifiers } = require('../src/views/dashboard');
    const i18n = require('../src/i18n');
    const read = s => String(s).replace(/ /g, ' ');

    const q = heroQualifiers(ctx.periodFigures('2026-09'), ctx.money).find(x => x.key === 'misfiled');
    ok(q, 'the hero\'s qualifier list carries a `misfiled` entry for September');
    eq(q.count, 3, 'with the count as a raw figure, for the API\'s readers');
    eq(q.files, ['Transactions/Card/2026-10.md', 'Transactions/Cheque/2026-08.md'], 'and the files by path');
    ok(/\b3\b/.test(read(q.text)) && read(q.text).includes('Transactions/Card/2026-10.md'),
      `its sentence says how many and names a file: "${read(q.text)}"`);
    ok(!heroQualifiers(ctx.periodFigures('2026-08'), ctx.money).some(x => x.key === 'misfiled'),
      'a period missing nothing says nothing');

    ctx.renderDashboard();
    const hero = nodes.get('#heroCard').textContent;
    ok(hero.includes(read(q.text)), `the Dashboard hero prints that sentence beside the spend it qualifies — hero text: "${hero.slice(0, 400)}"`);

    /* The Transactions page. The note is a sibling the page inserts beside
       its other top-of-page notices, so the stub gives that region a parent
       the way the shell does. */
    const section = new FakeEl('section');
    section.append(nodes.get('#txUndoBar') || M.ctx.$('#txUndoBar'), M.ctx.$('#txScopeNote'));
    const noteText = () => section.children.filter(c => c.attrs && c.attrs['data-note'] === 'misfiled').map(c => c.textContent).join(' | ');
    ctx.S.period = '2026-09';
    ctx.renderTransactions();
    const septNote = noteText();
    ok(septNote.includes('Transactions/Cheque/2026-08.md') && septNote.includes('Transactions/Card/2026-10.md'),
      `September's Transactions page names both files holding rows it does not list: "${septNote}"`);
    ok(septNote.includes(read(i18n.t('tx.misfiled.file', { count: 3, file: 'Transactions/Cheque/2026-08.md' }))),
      'in the app\'s own sentence, with that file\'s own count — the Excluded row included: it is missing from this LIST like the others');
    ok(septNote.includes(read(i18n.t('tx.misfiled.why', { count: 4 }))), 'followed by what it means and what to do about it');
    eq(section.children.filter(c => c.attrs && c.attrs['data-note'] === 'misfiled').length, 1, 'one note');
    ctx.renderTransactions();
    eq(section.children.filter(c => c.attrs && c.attrs['data-note'] === 'misfiled').length, 1, 'still one after a second render: it is redrawn, not stacked');

    /* August: nothing dated in August is missing, but the FILE a reader of
       August's page is looking at holds two of the rows. */
    ctx.S.period = '2026-08';
    ctx.renderTransactions();
    const augNote = noteText();
    ok(augNote.includes('Transactions/Cheque/2026-08.md') && !augNote.includes('Transactions/Card/2026-10.md'),
      `August's page names the August file that holds them, and not October's: "${augNote}"`);

    ctx.S.period = '2026-06';
    ctx.renderTransactions();
    eq(noteText(), '', 'a period that neither owns the dates nor reads the files shows no note, and leaves no empty box behind');

    M.restore();
  } finally { unpin(); }

  console.log(`PASS — a row filed under the wrong month's file is disclosed where its money is missing, and never moved or quietly counted (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
