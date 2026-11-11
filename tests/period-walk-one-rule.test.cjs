'use strict';
/* One period walk, one file-month rule. 2026-11-11 audit, task 23.

   Two pairs of duplicated arithmetic, each collapsed to one pure function
   with its callers delegating:

   THE WALK BACK OVER PERIODS. trendPeriods (trend-math.js) and
   periodsFromAnchor (views/report.js) were the same loop, copied so that the
   Report could anchor on the wall clock without loosening the trend's
   contract — and the copy carried the original's empty-vault bug, which was
   then fixed twice (M2, 2026-08-29). There is one loop now,
   trend-math.js walkPeriodsBack, and the anchor is an ARGUMENT: the two
   callers still hand it different anchors, on purpose, and section 2 holds
   them to that.

   THE FILE-MONTH RULE. "A month file is not read for a window that does not
   touch its calendar month" was spelled inline in period.js txInRange and in
   figures.js unreadableAmounts, and a third time as misfiled.js
   fileOutsideWindow. All three must agree or the page that names the rows a
   period lost (task 5) names the wrong ones. Both readers call
   fileOutsideWindow now.

   Each section compares the function with the code it replaced, restated here
   from the commit before, so a wrong extraction fails — not merely a changed
   one.

     node tests/period-walk-one-rule.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { walkPeriodsBack } = require('../src/trend-math');
const { fileOutsideWindow } = require('../src/misfiled');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = rel => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

let seed = 23;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

(async () => {
  /* ---- 1. the walk, against both copies it replaced ----------------------- */
  {
    /* trend-math.js trendPeriods and views/report.js periodsFromAnchor at
       9a68c18: one body, two anchors. Months as integers, so a period is a
       number and its end month is itself. */
    const asItWas = (anchor, want, earliest, shiftPeriod, endMonth) => {
      const out = [];
      for (let i = 0; i < want; i++) {
        const p = shiftPeriod(anchor, -i);
        if (i > 0 && (!earliest || endMonth(p) < earliest)) break;
        out.push(p);
      }
      return out.reverse();
    };
    const key = n => `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
    const num = k => (Number(k.slice(0, 4)) - 2000) * 12 + Number(k.slice(5, 7)) - 1;
    const shiftPeriod = (p, d) => key(num(p) + d);
    const endMonth = p => p;
    let n = 0;
    for (let i = 0; i < 3000; i++) {
      const anchor = key(120 + Math.floor(rnd() * 120));
      const want = Math.floor(rnd() * 30);
      const earliest = rnd() < 0.15 ? null : key(100 + Math.floor(rnd() * 160));   // sometimes AFTER the anchor
      eq(walkPeriodsBack({ anchor, want, shiftPeriod, periodEndMonth: endMonth, earliest }),
        asItWas(anchor, want, earliest, shiftPeriod, endMonth),
        `the walk equals the loop it replaced (anchor ${anchor}, want ${want}, earliest ${earliest})`);
      n++;
    }
    ok(n === 3000, 'three thousand walks compared');

    const w = (anchor, want, earliest) => walkPeriodsBack({ anchor, want, shiftPeriod, periodEndMonth: endMonth, earliest });
    eq(w('2026-07', 6, '2026-05'), ['2026-05', '2026-06', '2026-07'], 'oldest first, and no further back than the first month with data');
    eq(w('2026-07', 2, '2020-01'), ['2026-06', '2026-07'], '`want` at most');
    eq(w('2026-07', 12, null), ['2026-07'], 'an EMPTY vault: the anchor and nothing else — never twelve invented zero-months (M2)');
    eq(w('2026-07', 12, '2026-09'), ['2026-07'], 'data that starts after the anchor: still only the anchor, which is always kept');
    eq(w('2026-07', 0, '2020-01'), [], 'and asked for none, none');
  }

  /* ---- 2. two callers, two anchors, on purpose ---------------------------- */
  {
    const H = require('./figures/household2.cjs');
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const { ctx, S } = M;
      const now = ctx.currentPeriod();
      eq(S.period, now, 'the fixture opens on the current period');
      const parked = ctx.shiftPeriod(now, -3);

      eq(ctx.trendPeriods(4), ctx.periodsBack(now, 4), 'with the pill on the current period the trend and a walk from the clock are the same periods');
      ok(ctx.trendPeriods(4).length === 4, `and the household has the history to make that four periods (${ctx.trendPeriods(4).join(', ')})`);

      /* Move the header pill. The trend follows it; a walk from the wall clock
         — what the Report page asks for — does not. */
      S.period = parked;
      const trend = ctx.trendPeriods(4);
      eq(trend[trend.length - 1], parked, 'the Dashboard trend answers to the period ON SCREEN');
      eq(trend, ctx.periodsBack(parked, 4), 'it is the one walk, handed S.period');
      const fromClock = ctx.periodsBack(ctx.currentPeriod(), 4);
      eq(fromClock[fromClock.length - 1], now, 'a walk from the wall clock still ends at the current period, wherever the pill is');
      ok(trend.join() !== fromClock.join(), 'so the two anchors give two different answers — the difference is kept, as a parameter');
      S.period = now;
      M.restore();
    } finally { unpin(); }

    const report = code('src/views/report.js');
    ok(/periodsBack\(anchor, periodsForMonths\(months\)\)/.test(report) && /const anchor = currentPeriod\(\);/.test(report),
      'views/report.js asks for the walk from currentPeriod() — the wall clock its pills promise');
    eq(/shiftPeriod\(anchor, -i\)/.test(report) || /function periodsFromAnchor/.test(report), false,
      'and no longer carries a loop of its own');
    const trendSrc = code('src/trend-math.js');
    ok(/function trendPeriods\(want\) \{\s*return periodsBack\(S\.period, want\);\s*\}/.test(trendSrc), 'trend-math.js trendPeriods is the walk handed S.period');
    eq((trendSrc.match(/shiftPeriod\(anchor, -i\)/g) || []).length, 1, 'the loop is written once');
  }

  /* ---- 3. the file-month rule, against the comparison it replaced --------- */
  {
    const inline = (month, start, end) => month < start.slice(0, 7) || month > end.slice(0, 7);   // period.js / figures.js at 9a68c18
    const day = () => `${2024 + Math.floor(rnd() * 4)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    for (let i = 0; i < 5000; i++) {
      const a = day(), b = day();
      const month = rnd() < 0.05 ? undefined : day().slice(0, 7);
      const [start, end] = rnd() < 0.9 ? [a, b].sort() : [a, b];        // sometimes an inverted, empty window
      eq(fileOutsideWindow(month, start, end), inline(month, start, end), `the veto equals the inline comparison (${month}, ${start}..${end})`);
    }
    /* The windows the app really hands it that are not plain dates. */
    eq([fileOutsideWindow('2026-09', '', '￿'), inline('2026-09', '', '￿')], [false, false], "the whole-vault window ('' .. \\uffff) reads every file");
    eq([fileOutsideWindow('2026-09', '0000-01-01', '9999-12-31'), inline('2026-09', '0000-01-01', '9999-12-31')], [false, false], 'and so does the all-time window');

    for (const f of ['src/period.js', 'src/figures.js']) {
      eq(/\.month\s*[<>]/.test(code(f)), false, `${f} no longer compares a file's month itself`);
      ok(/fileOutsideWindow\(f\.month, start, end\)/.test(code(f)), `${f} asks misfiled.js fileOutsideWindow`);
    }
  }

  /* ---- 4. one rule, so the three readers agree about the same row --------- */
  {
    /* A row dated 3 September typed into AUGUST's file, with an amount nobody
       can read. Under calendar months no period reads it: the period walk does
       not list it, the unreadable count does not count it, and the misfiled
       notice names it. If any one of the three used a different month rule the
       row would be in two of these and missing from the third. */
    const B = 'Budget';
    const TX = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
    const files = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Food.md`]: '---\ntype: expense\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-01\n---\n',
      [`${B}/Transactions/Cheque/2026-08.md`]: TX + '| 2026-08-10 | Shop | Food | -100.00 |  |  |  |\n| 2026-09-03 | Misfiled | Food | about 50 |  |  |  |\n',
      [`${B}/Transactions/Cheque/2026-09.md`]: TX + '| 2026-09-05 | Shop | Food | -200.00 |  |  |  |\n| 2026-09-06 | Unreadable here | Food | ten |  |  |  |\n',
    };
    const ctx = makeCtx(files);
    await loadInto(ctx);
    const september = ctx.txInPeriod('2026-09').map(r => r.desc);
    eq(september, ['Shop', 'Unreadable here'], 'September reads its own file, and not the September-dated row sitting in August\'s');
    eq(ctx.txInPeriod('2026-08').map(r => r.desc), ['Shop'], 'August reads its file and drops that row by its date');
    eq(ctx.periodFigures('2026-09').unreadable.tx, 1, 'the unreadable count sees the one unreadable amount September reads — not the misfiled one');
    eq(ctx.periodFigures('2026-08').unreadable.tx, 0, 'and August counts none');
    const lost = ctx.misfiledTx('2026-09');
    eq([lost.count, lost.files.map(f => f.month)], [1, ['2026-08']], 'the misfiled notice names exactly the row the other two left out, and the file it is in');

    /* A payday month reads both files, so the same row is read, counted and
       not called missing — by the same three readers. */
    const payday = makeCtx({ ...files, [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n---\n' });
    await loadInto(payday);
    const p = payday.currentPeriod('2026-09-03');
    ok(payday.txInPeriod(p).some(r => r.desc === 'Misfiled'), `under a payday month (${p}) the period that owns 3 September reads August's file, and the row with it`);
    eq(payday.periodFigures(p).unreadable.tx, 2, 'its unreadable amount is counted there, beside the one in September\'s own file');
    eq(payday.misfiledTx(p).count, 0, 'and it is not reported as missing from a period that reads it');
  }

  console.log(`PASS period-walk-one-rule — one walk with the anchor a parameter, one file-month rule read by three callers (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
