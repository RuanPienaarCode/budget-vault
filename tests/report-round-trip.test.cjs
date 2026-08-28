'use strict';
/* The Report page's write-then-read round trip — the guard for the 1.28.0
   dead-button bug.

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

   Three things pinned:

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

  console.log(`report-round-trip.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
