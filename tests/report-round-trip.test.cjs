'use strict';
/* The Report page's write-then-read round trip — the guard for the 1.28.0
   dead-button bug, and (2026-08-29 audit) for C1/C2/H1 driven through the
   REAL modules rather than a hand-fed `data` object.

   THE WALL CLOCK IS PINNED for every block after the io.js proof (section 1)
   — same Date-subclass pattern trend-math.test.cjs already uses for
   elapsedDays(). Before this, `mountAll(files, period)`'s `period` argument
   only ever set S.period, and createReport()'s 'current' branch has ALWAYS
   read currentPeriod() (the real wall clock), never S.period — so on any day
   this suite ran outside the fixture's July window, the "regression" and
   "found-on-disk" blocks below were asserting over an EMPTY report by
   construction, checking only that a panel un-hid, never that a figure in
   it was right. Pinning "now" to a date inside the fixture's own month is
   what turns those into real assertions, and is also the negative control
   H2 named: a round-trip test that can't fail on a wrong figure isn't
   guarding one.

   ROOT CAUSE (confirmed by an independent Node+jsdom harness, then pinned
   here): writeVaultFile() (src/io.js) writes at the VAULT ROOT — Reports/ is
   a deliberate sibling of the budget folder, not a child of it (see
   src/report.js's own header). refreshResult() (src/views/report.js) then
   looked the same file up through fileAt(), which resolves through
   relPath() — PREFIXING the budget folder unconditionally. So the write
   landed at the real `Reports/…`, the read checked
   `<budget folder>/Reports/…`, found nothing, and refreshResult() cleared
   the `result` createReport() had just set — every single time, because
   refreshResult() is the FIRST line of renderReport(), which createReport()
   calls immediately after a successful write. The result panel stayed
   `class="hidden"` forever; Open/Copy were never wired; the only feedback
   was a toast that fades in under three seconds. Fixed by giving fileAt/
   readFile/folderAt vault-root SIBLINGS (fileAtVaultPath/readVaultFile/
   folderAtVaultPath, src/io.js) and switching every lookup in
   views/report.js that reads back its OWN writes to them.

   Five things pinned:

     1. io.js: fileAtVaultPath/readVaultFile/writeVaultFile/ensureVaultFolder
        all agree on ONE root — vault-root — regardless of what the budget
        folder is configured to. fileAt (budget-relative) does NOT find a
        vault-root write, proven directly rather than assumed, which is the
        negative control for the whole bug class: if a future edit swapped
        fileAtVaultPath back for fileAt anywhere in views/report.js, this
        assertion is what would go red.
     2. views/report.js: createReport() → the result panel loses its
        "hidden" class in the SAME render pass, Open/Copy become reachable,
        and the path shown is the real vault-root path.
     3. A report already on disk from an earlier session (a fresh mount,
        nothing in memory) is found on the very first render — the founded-
        on-disk path report.js's own header documents, which the root
        mismatch broke exactly as badly as the just-created path.
     4. C1 (2026-08-29 audit): 'current' and '3m' anchor on the SAME clock —
        moving S.period (the header pill) cannot change what "Last 3 months"
        means, or silently drop a month off the span it claims to cover.
     5. C2 + H1 (2026-08-29 audit): the uncategorised/orphaned disclosure and
        the Budget-vs-Actual Type column, both driven through the real
        loader, categories.js and dashboard.js's own row builders — not the
        pure-module fixture tests/report.test.cjs hand-feeds.

   Phase 4b (2026-08-29 audit, content-polish pass) adds two more, both
   driven through the REAL modules for the same reason as 4/5 above:

     6. L2: the WRITTEN filename stays the same regardless of which
        interface language generated it — the ROOT CAUSE this file's own M1/
        M2/M3 sections already prove end-to-end is a real risk class here
        (a fact true at write time that a hand-fed fixture could accidentally
        assume rather than prove).
     7. L3: budgetVsActualRows()'s own invariant that an assume-spent row's
        `actual` always equals its `budget` — the fact src/report.js's
        budgetTable() comment leans on to omit a `!r.assumed` guard mirrored
        from renderBudgetTable() (views/dashboard.js) — pinned directly
        against the real function, with a genuinely-unbudgeted row alongside
        it as the negative control.

   Drives the REAL registerReport() over the shared bare-node harness —
   tests/helpers/harness.cjs's makeCtx()/loadInto() register the REAL io.js,
   so `ctx.fileAt`/`ctx.fileAtVaultPath`/`ctx.writeVaultFile` here are the
   actual functions, not a hand-rolled mirror of them.

     node tests/report-round-trip.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const BASE_FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ninstitution: "Bank A"\naccount_number: "12345678901"\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | |\n| Salary | income | 40000.00 | |\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n',
};

/* Same registration set/order as views-render.test.cjs's mountAll — 'report'
   right after 'dashboard', load-bearing for the same reason (it reads
   dashboard.js's ctx.provide()'d budgetVsActualRows/categorySpendRows at
   register time). */
async function mountAll(files, period = '2026-07') {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = period;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, S, nodes };
}

(async () => {
  /* ---- 1. io.js: one root, proven both ways ---- */
  {
    // A budget folder that is NOT the default 'Budget', so a test that
    // accidentally passed because the two roots happen to collide (a bare
    // 'Reports/x.md' sitting where 'Budget/Reports/x.md' would too, if
    // budgetFolder were '') cannot sneak past this the way it could with
    // the harness's default settings.
    const ctx = makeCtx({}, { budgetFolder: 'MyMoney' });
    await loadInto(ctx);

    const written = await ctx.writeVaultFile('Reports/Aug 2026 Financial Report.md', '# hi\n');
    eq(written, 'Reports/Aug 2026 Financial Report.md', 'writeVaultFile writes at the vault root, not under the budget folder');

    const viaVaultPath = ctx.fileAtVaultPath('Reports/Aug 2026 Financial Report.md');
    ok(viaVaultPath, 'fileAtVaultPath finds a vault-root write');

    const viaBudgetRelative = ctx.fileAt('Reports/Aug 2026 Financial Report.md');
    // THE NEGATIVE CONTROL for the whole bug class: fileAt is budget-relative
    // by design (every OTHER caller in this app wants that), so it must NOT
    // find a file writeVaultFile put at the vault root. If a future edit in
    // views/report.js swapped fileAtVaultPath back for fileAt, this is the
    // assertion that would have caught it — proven by the fact that it is
    // exactly what the 1.28.0 bug did, and exactly what this line pins
    // against recurring.
    eq(viaBudgetRelative, null,
      'fileAt (budget-relative) must NOT find a vault-root write — that mismatch is the 1.28.0 bug, reproduced here on purpose');

    const text = await ctx.readVaultFile('Reports/Aug 2026 Financial Report.md');
    eq(text, '# hi\n', 'readVaultFile reads the same vault-root file back');

    await ctx.ensureVaultFolder('Reports/Nested');
    ok(ctx.folderAtVaultPath('Reports/Nested'), 'ensureVaultFolder + folderAtVaultPath agree on the same root too');

    // And the OTHER direction: a budget-relative write is invisible to the
    // vault-root door, proving neither helper silently widens its own root.
    await ctx.writeFile('Categories/Rent.md', '---\ntype: expense\n---\n');
    eq(ctx.fileAtVaultPath('Categories/Rent.md'), null,
      'a budget-relative write is not visible through the vault-root door either — the split runs both ways');
    ok(ctx.fileAt('Categories/Rent.md'), 'and IS visible through the budget-relative door it was written for');
  }

  /* Wall clock pinned to 15 Jul 2026 for every block below — see this file's
     header. BASE_FILES' Settings.md sets month_start_day: 1, so a period IS
     its calendar month and currentPeriod() resolves to exactly '2026-07',
     matching BASE_FILES' own fixture data. */
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, 6, 15, 12, 0, 0); }
    static now() { return new PinnedDate().getTime(); }
  }
  global.Date = PinnedDate;
  try {
    /* ---- 2. the actual regression: createReport() -> the result panel ---- */
    {
      const { ctx, nodes } = await mountAll({ ...BASE_FILES });
      ctx.renderReport();
      const before = nodes.get('#reportResultCard');
      ok(before._cls.has('hidden'), 'before any report exists, the result panel starts hidden');

      let threw = null;
      try { await ctx.createReport(); } catch (e) { threw = e; }
      eq(threw, null, 'createReport() does not throw');
      eq(ctx._toasts.length, 1, 'exactly one toast fires');
      ok(!ctx._toasts[0].bad, 'and it is the SUCCESS toast, not an error');

      const after = nodes.get('#reportResultCard');
      ok(!after._cls.has('hidden'),
        'THE REGRESSION: the result panel loses "hidden" in the SAME render pass a successful create causes — ' +
        '1.28.0 shipped with this permanently true (refreshResult() cleared what createReport() had just set)');
      ok(!nodes.get('#reportOpen')._cls.has('hidden'), 'Open report becomes reachable');
      ok(!nodes.get('#reportCopy')._cls.has('hidden'), 'Copy report becomes reachable');
      ok(!nodes.get('#reportReveal')._cls.has('hidden'), 'Open report folder becomes reachable');

      const shownPath = nodes.get('#reportResultSub')._text;
      ok(shownPath.startsWith('Reports/') && !shownPath.startsWith('Budget/'),
        `the path shown is the real vault-root path, not a budget-relative miss (got "${shownPath}")`);

      const onDisk = [...ctx.app.vault._store.keys()].filter(k => /Reports\/.*Financial Report\.md$/.test(k));
      eq(onDisk.length, 1, 'exactly one report file actually landed on disk');
      eq(onDisk[0], shownPath, 'and it is the SAME path the result panel shows — one file, one truth');

      // The wall clock is pinned inside the fixture's own month now, so this
      // is a real figure, not an empty document asserted only for shape —
      // the entanglement H2 named in the 2026-08-29 audit.
      const body = ctx.app.vault._store.get(shownPath);
      ok(body.includes('R 40000.00') && body.includes('R 1200.00'),
        'the report actually carries July\'s real income and spend, not an empty document from a period nothing landed in');
    }

    /* ---- 3. found-on-disk: a report from an earlier session, fresh mount ---- */
    {
      const { ctx } = await mountAll({ ...BASE_FILES });
      await ctx.createReport();
      const reportPath = [...ctx.app.vault._store.keys()].find(k => /Reports\/.*Financial Report\.md$/.test(k));
      const reportBody = ctx.app.vault._store.get(reportPath);
      ok(reportPath && reportBody, 'the fixture step actually produced a file to re-discover');

      const FILES_WITH_REPORT = { ...BASE_FILES, [reportPath]: reportBody };
      const { ctx: fresh, nodes: freshNodes } = await mountAll(FILES_WITH_REPORT);
      // No createReport() call here — this is what happens on an ordinary app
      // open/switch to the Report page, nothing generated this session.
      fresh.renderReport();
      ok(!freshNodes.get('#reportResultCard')._cls.has('hidden'),
        'a report already on disk from an earlier session is found on the very FIRST render — no click required');
      eq(freshNodes.get('#reportResultSub')._text, reportPath, 'and the panel names the real file');

      // copyReport() on a report that was FOUND, not freshly generated — the
      // in-memory `text` is null until copyEntry reads it back, through the
      // same vault-root door.
      let copyThrew = null;
      try { await fresh.copyReport(); } catch (e) { copyThrew = e; }
      eq(copyThrew, null, 'copyReport() does not throw for a found-on-disk report either');
    }

    /* ---- 4. C1: 'current' and '3m'/'12m' all anchor on the SAME clock ----
       The regression this file's header describes: 'current' has always
       read currentPeriod() (the wall clock); '3m'/'12m' used to read
       trendPeriods(), anchored on S.period — the header pill a reader can
       move independently, and which used to stay visible (and functional)
       on the Report page too. S.period is deliberately parked on May here —
       a different month from "now" (July, pinned above) — the way a reader
       browsing an old month before switching to the Report page would leave
       it, so this can only pass if the report ignores S.period entirely. */
    {
      const files = {
        ...BASE_FILES,
        [`${B}/Transactions/Cheque/2026-05.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
          + '| 2026-05-01 | Salary | Salary | 40000.00 |  |  |  |\n'
          + '| 2026-05-03 | Grocer | Groceries | -1100.00 |  |  |  |\n',
        [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
          + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n'
          + '| 2026-06-03 | Grocer | Groceries | -1300.00 |  |  |  |\n',
      };
      const { ctx } = await mountAll(files, '2026-05');
      ctx.setReportPeriod('3m');
      await ctx.createReport();

      const path = [...ctx.app.vault._store.keys()].find(k => /Financial Report\.md$/.test(k));
      ok(path, 'a report file landed on disk');
      ok(path.includes('May 2026') && path.includes('July 2026'),
        `THE C1 REGRESSION: "Last 3 months" must span May-July (anchored on the wall clock, now = July), not a ` +
        `single month anchored on S.period (parked on May) — got "${path}"`);

      const body = ctx.app.vault._store.get(path);
      // income: 3 x R40,000 = R120,000; spend: 1100 + 1300 + 1200 (BASE_FILES'
      // own July row) = R3,600 — June's figures are the ones the old bug
      // silently dropped, so they are the ones that have to show up here.
      ok(body.includes('R 120000.00'), 'three months of income are summed, not one');
      ok(body.includes('R 3600.00'), 'three months of spend are summed — June is not silently dropped');
    }

    /* ---- 5. C2 + H1: the disclosure and the Type column survive the REAL
       loader, categories.js and dashboard.js's own row builders — not just
       the pure-module fixture in tests/report.test.cjs. ---- */
    {
      const i18n = require('../src/i18n');
      i18n.setLanguage('en');
      const files = {
        ...BASE_FILES,
        [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
          + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
          + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n'
          // Ghost answers to no Categories/ file — an orphaned category.
          + '| 2026-07-05 | Mystery | Ghost | -300.00 |  |  |  |\n',
      };
      const { ctx } = await mountAll(files, '2026-07');
      await ctx.createReport();
      const path = [...ctx.app.vault._store.keys()].find(k => /Financial Report\.md$/.test(k));
      const body = ctx.app.vault._store.get(path);

      ok(body.includes('Ghost *'), 'C2: the orphaned category is marked in the real, end-to-end generated report');
      ok(body.includes(i18n.t('report.category.orphaned', { names: 'Ghost' })),
        'C2: the orphaned name is named in prose, not just marked with an unexplained *');

      ok(body.includes(i18n.t('report.col.type')), 'H1: the Budget vs Actual table carries a Type column');
      const budgetHeadingIdx = body.indexOf(`## ${i18n.t('report.section.budgetActual')}`);
      const salaryIdx = body.indexOf('| Salary |', budgetHeadingIdx);
      const groceriesIdx = body.indexOf('| Groceries |', budgetHeadingIdx);
      ok(salaryIdx > budgetHeadingIdx && groceriesIdx > salaryIdx,
        'H1: typeRank order survives end-to-end — income (Salary) before expense (Groceries), not an alphabetical re-sort');
    }

    /* ---- 6. M1 (Phase 3, 2026-08-29 audit): the folder guard, end-to-end ----
       BASE_FILES' budget folder is 'Budget' (see makeCtx's default in
       harness.cjs). Pointing the report folder at 'Budget/Categories' is the
       EXACT reproduction the audit verified by hand: without the guard, the
       generated .md would be parsed back in as a category on the next load. */
    {
      const { ctx, nodes } = await mountAll({ ...BASE_FILES });
      ctx.setReportFolder('Budget/Categories');   // setReportFolder calls renderReport()

      ok(nodes.get('#reportCreate').disabled,
        'THE GUARD, before any click: Create is disabled while the folder resolves into a managed subfolder');
      const i18n = require('../src/i18n');
      i18n.setLanguage('en');
      eq(nodes.get('#reportFolderDesc')._text, i18n.t('report.field.folderManaged', { folder: 'Categories' }),
        'the folder description warns BEFORE the click, naming which managed folder it is');
      ok(nodes.get('#reportFolderDesc')._cls.has('text-danger'), 'and is visibly flagged, not just differently worded');

      // Independent, write-time refusal — proven by calling createReport()
      // directly rather than trusting the disabled attribute alone (a real
      // <button disabled> still blocks a click in a browser, but this proves
      // the SECOND ring holds even if something else reached this function).
      const before = ctx.app.vault._store.size;
      let threw = null;
      try { await ctx.createReport(); } catch (e) { threw = e; }
      eq(threw, null, 'createReport() does not throw — the refusal is a toast, not an unhandled rejection');
      eq(ctx.app.vault._store.size, before, 'THE REGRESSION THIS GUARDS: nothing was written at all — no .md landed inside Budget/Categories');
      ok(ctx._toasts.length >= 1 && ctx._toasts[ctx._toasts.length - 1].bad,
        'the refusal surfaces as the SAME createFailed error toast every other write failure uses');

      // A folder OUTSIDE any managed subfolder is unaffected — the guard is
      // narrow, not a blanket "no custom folder" refusal.
      ctx.setReportFolder('Budget/MyOwnReports');
      ok(!nodes.get('#reportCreate').disabled, 'an unrelated folder inside the budget folder is never blocked');
      let threw2 = null;
      try { await ctx.createReport(); } catch (e) { threw2 = e; }
      eq(threw2, null, 'and a report actually writes there');
      ok([...ctx.app.vault._store.keys()].some(k => k.startsWith('Budget/MyOwnReports/')), 'landed at the chosen, unmanaged folder');
    }

    /* ---- 7. M2 (Phase 3, 2026-08-29 audit): an empty vault does not invent
       12 months of zero history, through the REAL periodsFromAnchor() in
       views/report.js — not trend-math.test.cjs's own pure trendPeriods()
       copy. A vault with a Settings.md/Categories/Accounts but genuinely no
       transaction file at all (no S.txFiles entries) is exactly the "brand
       new household's very first report" case the audit reproduced. ---- */
    {
      const NO_TX_FILES = {
        [`${B}/Settings.md`]: BASE_FILES[`${B}/Settings.md`],
        [`${B}/Categories/Groceries.md`]: BASE_FILES[`${B}/Categories/Groceries.md`],
        [`${B}/Categories/Salary.md`]: BASE_FILES[`${B}/Categories/Salary.md`],
        [`${B}/Accounts/Cheque.md`]: BASE_FILES[`${B}/Accounts/Cheque.md`],
        // Deliberately NO Transactions/ files and NO Budgets/2026-07.md —
        // a household that has not imported a single statement yet.
      };
      const { ctx } = await mountAll(NO_TX_FILES);
      ctx.setReportPeriod('12m');
      await ctx.createReport();

      const path = [...ctx.app.vault._store.keys()].find(k => /Financial Report\.md$/.test(k));
      ok(path, 'a report still writes for an empty vault — it should not fail, only cover less');
      // Twelve months, oldest first — the invented-history bug named every
      // one from "September 2025" through "August 2026". THE FIX: only the
      // current period (July 2026, the pinned wall clock) is on offer.
      ok(path.includes('July 2026') && !path.includes(' to '),
        `THE M2 REGRESSION: "Last 12 months" on an empty vault must name a SINGLE period (the current one), ` +
        `never a 12-month span with 11 invented zero-months — got "${path}"`);
    }

    /* ---- 8. M3 (Phase 3, 2026-08-29 audit): the "Generated" stamp is local,
       through the REAL createReport() — wiring proof that buildReportData()
       actually calls nowLocalMinute() and not a second, UTC expression of its
       own. The local-vs-UTC DIVERGENCE itself (the actual bug) is pinned
       deterministically in tests/dates.test.cjs, independent of whatever
       timezone this suite happens to run in. ---- */
    {
      const { nowLocalMinute } = require('../src/dates');
      const { ctx } = await mountAll({ ...BASE_FILES });
      await ctx.createReport();
      const path = [...ctx.app.vault._store.keys()].find(k => /Financial Report\.md$/.test(k));
      const body = ctx.app.vault._store.get(path);
      const stamp = nowLocalMinute();
      ok(body.includes(`generated: ${stamp}`), `the frontmatter stamp is nowLocalMinute()'s own value ("${stamp}"), not a second UTC-derived one`);
      const i18n = require('../src/i18n');
      i18n.setLanguage('en');
      ok(body.includes(i18n.t('report.generatedLine', { date: stamp })), 'and the visible "Generated" line carries the identical value');
    }

    /* ---- 9. L2 (Phase 4b, 2026-08-29 audit): the WRITTEN PATH is stable
       across an interface-language change, through the REAL createReport().
       Before the fix, periodLabelFor() (i18n.t('report.to') embedded) fed
       BOTH the document's heading AND reportPaths()' `label`, so switching
       Settings.md's `language` between two reports of the exact SAME
       multi-period selection changed the path on disk — silently breaking
       "regenerating overwrites the earlier file" (src/report.js's own
       reportPaths() comment) and leaving an orphan in Reports/ the
       "Already exists" note never mentions, because it only ever checks the
       ONE path the CURRENT language would produce. 'ja' is the sharpest
       negative control on offer — its word for "to" (〜) is not even the
       same alphabet as English's, so any leak through the old code path
       could not be missed by an eyeball, let alone this assertion. ---- */
    {
      const files = {
        ...BASE_FILES,
        [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
          + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n'
          + '| 2026-06-03 | Grocer | Groceries | -1300.00 |  |  |  |\n',
      };
      const i18n = require('../src/i18n');

      /* mountAll()'s own loadInto() sets the language from Settings.md's
         `language:` frontmatter (falling back to defaultLanguage(), which
         resolves to 'en' with no window/navigator in this harness) — so the
         REAL language switch has to happen AFTER mount, not before it, or
         loadInto() silently undoes it before createReport() ever runs. */
      const { ctx: enCtx } = await mountAll(files, '2026-06');
      i18n.setLanguage('en');
      enCtx.setReportPeriod('3m');   // a genuine multi-period span — the only shape 'report.to' ever appeared in
      await enCtx.createReport();
      const enPath = [...enCtx.app.vault._store.keys()].find(k => /Financial Report\.md$/.test(k));
      ok(enPath && enPath.includes(' to '), 'the English-language report landed on disk, spanning more than one period');

      const { ctx: jaCtx } = await mountAll(files, '2026-06');
      i18n.setLanguage('ja');
      jaCtx.setReportPeriod('3m');
      await jaCtx.createReport();
      const jaPath = [...jaCtx.app.vault._store.keys()].find(k => /Financial Report\.md$/.test(k));
      ok(jaPath, 'the Japanese-language report landed on disk too');

      eq(jaPath, enPath,
        `THE L2 REGRESSION: the SAME period selection must write the SAME path regardless of interface language — ` +
        `got English "${enPath}" and Japanese "${jaPath}"`);
      ok(!jaPath.includes(i18n.t('report.to')),
        `and the path never carries the TRANSLATED word for "to" (Japanese's own is "${i18n.t('report.to')}") — ` +
        'that leak is the exact regression this test exists to catch');

      // The document's own HEADING may still translate — L2 only pins the
      // FILENAME. Read back through the (now stable) shared path.
      const jaBody = await jaCtx.readVaultFile(jaPath);
      ok(jaBody.includes(`period: "June 2026 ${i18n.t('report.to')} July 2026"`),
        'the visible document still states the period in the reader\'s own language — only the path stopped moving');

      i18n.setLanguage('en');
    }

    /* ---- 10. L3 (Phase 4b, 2026-08-29 audit): the invariant
       src/report.js's budgetTable() comment leans on to omit a `!r.assumed`
       guard — an assume-spent row's `actual` always equals its `budget`,
       even at R0, so mergeCategoryRows dropping `assumed` off the merged
       row can never let report.js's `!r.budget && r.actual > 0` unbudgeted
       test fire falsely on one. Pinned directly against the REAL
       budgetVsActualRows() (ctx.budgetVsActualRows, published by
       views/dashboard.js), not a reimplementation — with a genuinely
       unbudgeted category alongside it as the negative control, proving the
       same expression correctly fires TRUE elsewhere, so the guard is doing
       real work, not simply unreachable everywhere. ---- */
    {
      const files = {
        ...BASE_FILES,
        [`${B}/Categories/Provision.md`]: '---\ntype: expense\ncolor: "#dc3545"\nassume_spent: true\n---\n',
        [`${B}/Categories/Impulse.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
        [`${B}/Budgets/2026-07.md`]: BASE_FILES[`${B}/Budgets/2026-07.md`] + '| Provision | expense | 0.00 | |\n',
        [`${B}/Transactions/Cheque/2026-07.md`]: BASE_FILES[`${B}/Transactions/Cheque/2026-07.md`]
          + '| 2026-07-10 | Impulse buy | Impulse | -300.00 |  |  |  |\n',
      };
      const { ctx } = await mountAll(files);
      const rows = ctx.budgetVsActualRows('2026-07');

      const provision = rows.find(r => r.cat === 'Provision');
      ok(provision, 'the assume-spent, zero-budget row exists in the real, end-to-end computed rows');
      eq(provision.assumed, true, 'and is flagged assumed');
      eq(provision.actual, provision.budget,
        'THE INVARIANT: an assume-spent row\'s actual always equals its budget, even at R0 — never actual > budget');
      ok(!(provision.type !== 'income' && !provision.budget && provision.actual > 0),
        'so report.js\'s budgetTable() unbudgeted test — !r.budget && r.actual > 0 — can never fire for it, ' +
        'the exact reasoning its own comment gives for omitting a !r.assumed guard');

      // Negative control: a genuinely unbudgeted category (never assumed,
      // no budget row at all, real spend) DOES trip the identical
      // expression — proof the guard is real work elsewhere, not dead code.
      const impulse = rows.find(r => r.cat === 'Impulse');
      ok(impulse, 'the genuinely unbudgeted category exists too');
      eq(impulse.assumed, undefined, 'never assumed — no budget row seeded it');
      eq(impulse.budget, 0, 'and never budgeted at all');
      ok(impulse.type !== 'income' && !impulse.budget && impulse.actual > 0,
        'THE NEGATIVE CONTROL: a real unbudgeted spend DOES trip !r.budget && r.actual > 0 — ' +
        'the guard is not simply unreachable everywhere, only for the assumed case the comment argues');
    }
  } finally { global.Date = RealDate; }

  console.log(`report-round-trip.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
