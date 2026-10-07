'use strict';
/* Export budget — the Budget page's "give me this as a file" button.

   THIS FILE OWNS NO ARITHMETIC, and barely any logic. It gathers what other
   modules already compute and hands it on:

     which periods      budget-export.js's exportPeriods(), over period.js's
                        shiftPeriod / trend-math.js's periodsForMonths and
                        earliestDataMonth — the same walk the Report page and
                        the trend chart make, so "last 3 months" means one
                        thing on all three
     each period's rows figures.js's budgetVsActualRows(p) — the rows the
                        Budget page and the Dashboard table print, so a number
                        in the file is the number on the screen it came from
     the period line    periodSummary(p)
     the transactions   txInPeriod(p), listed and never summed here

   and then writes whichever of three renderings of ONE model the reader asked
   for (see budget-export.js's header on why one model).

   INTO THE VAULT, NOT A DOWNLOAD — views/transactions.js's exportTransactions
   argues this and nothing about it has changed: an <a download> blob is
   unreliable inside Obsidian's iOS WebView, this plugin ships with
   isDesktopOnly:false, and a button that quietly does nothing on a phone is
   worse than no button. Once the file is in the vault, the share sheet and the
   desktop file manager can both take it from there; the dialog that follows
   the write offers Open and Reveal, which are the two honest affordances a
   plugin has.

   REFUSES WHILE ANYTHING IS UNSAVED. The rows come from the saved budget
   files, not the Budget page's draft, so an export made over unsaved edits
   would match neither the vault nor the screen the reader is looking at — and
   the disagreement would surface later, in a spreadsheet, with nothing to
   explain it. */

const {
  exportPeriods, periodsEndingIn, datePresets, buildModel, modelToCsv, modelToSheets, modelToDoc, budgetExportPaths,
} = require('../budget-export');
const { askBudgetExport, showBudgetExportDone } = require('../budget-export-modal');
const { buildXlsx } = require('../xlsx');
const { PAGE, docEncodable, helveticaMeasure, layoutDocument, renderVectorPdf, renderImagePdf } = require('../pdf');
const { canvasMeasure, rasterisePages } = require('../pdf-raster');
const { symbolOf } = require('../currency');
const { nowLocalMinute, todayIso, isRealIsoDate } = require('../dates');
const { typeOrder } = require('../groups');
const i18n = require('../i18n');

/* Every label budget-export.js prints into a document, from the active
   language. Keyed exactly as that module's own LABELS so a key missing here
   falls back to its English rather than to `undefined` on a page. */
const DOC_LABEL_KEYS = [
  'title', 'titleSummary', 'category', 'type', 'total', 'average', 'budgeted', 'period', 'from', 'to',
  'budget', 'actual', 'remaining', 'used', 'notes', 'date', 'description', 'account', 'currency', 'amount',
  'flag', 'excluded', 'splitParent', 'splitPart', 'subtotal', 'summaryHeading', 'transactionsHeading',
  'generated', 'range', 'categories', 'allCategories', 'periodLine', 'periodUncat',
  'noteFilter', 'noteForeign', 'noteInProgress', 'noteWide', 'noteTx',
  'amountsIn', 'noteNoBudget', 'exactHeading', 'noteExact', 'noteExactOnly', 'noteExactThrough',
];

module.exports = function registerBudgetExport(ctx) {
  /* vaultPathTaken / destinationProblem — src/io.js's case-folded "is this
     path already used?" and its one answer to "may an export be written into
     the folder the reader typed?" (bound there to this vault's config folder
     and budget folder). The Report reads the same two. */
  const {
    S, app, plugin, money, toast, writeVaultFile, writeVaultBinary, fileAtVaultPath, vaultPathTaken, destinationProblem,
    currentPeriod, shiftPeriod, periodRange, periodMonthName, periodTitle, periodSummary, txInPeriod,
    periodsForMonths, earliestDataMonth, budgetVsActualRows, categoryActualsInRange, txInRange, locale,
  } = ctx;

  /* The same two per-row helpers views/transactions.js builds for its own
     export, for the same reason: a euro row printed through the household
     formatter asserts an amount of rand that was never spent. */
  const rowSymbol = r => symbolOf(
    typeof ctx.accountForLabel === 'function' ? ctx.accountForLabel(r && r.label) : null,
    (S.settings || {}).currency);
  const rowMoney = (v, r) => {
    const sym = r ? rowSymbol(r) : '';
    if (!sym || sym === (S.settings || {}).currency || typeof ctx.moneyIn !== 'function') return money(v);
    return ctx.moneyIn(sym, v);
  };

  /* {period}, {income} … survive as literal placeholders: budget-export.js
     fills them itself, per period and per note. Passing each name as its own
     value is what stops i18n.t() from consuming them first. */
  const KEEP = { currency: '{currency}', from: '{from}', to: '{to}', pfrom: '{pfrom}', pto: '{pto}', through: '{through}', type: '{type}', list: '{list}', period: '{period}', income: '{income}', spend: '{spend}', uncat: '{uncat}' };
  const docLabels = () => {
    const out = {};
    for (const k of DOC_LABEL_KEYS) out[k] = i18n.t(`bx.doc.${k}`, KEEP);
    /* Sheet names stay English on purpose: Excel forbids a handful of
       characters and caps them at 31, and a formula someone writes against
       'Summary'!C2 should survive the household changing its language. */
    return out;
  };

  /* Why the folder cannot take an export, in this dialog's words — or null.

     io.js's guardedVaultPath keeps a write inside the VAULT, and plenty inside
     the vault is still no destination. This used to be two checks of its own:
     Obsidian's config folder by its first segments, and load.js's managed
     folders by name. So "x/.obsidian", ".trash" and ".obsidian-notes" were
     all accepted — every one a folder Obsidian never indexes (any segment
     starting with a dot hides the path, app.js 1.13.7), so the export landed
     where Open and Reveal can never find it — and ".." was dropped by
     budgetExportPaths, so "../outside" quietly wrote to outside/. Now it is
     io.js's destinationProblem — traversal, config folder, managed folder,
     case-folded and NFC, the rule the Report already words — asked of the
     folder as TYPED (before budgetExportPaths sanitises away the ".." it
     should refuse) and of the folder actually written, a hidden segment
     included (one rule, vault-path.js hiddenSegment). Shared by describe() and
     runBudgetExport(), so the dialog and the write cannot disagree. */
  function folderProblem(typed, dir) {
    const p = destinationProblem(typed) || destinationProblem(dir);
    if (p && p.kind === 'traversal') return i18n.t('report.field.folderTraversal');
    if (p && p.kind === 'configDir') return i18n.t('bx.problem.configDir', { folder: p.folder });
    if (p && p.kind === 'hidden') return i18n.t('bx.problem.hiddenFolder', { folder: p.folder });
    return p ? i18n.t('report.field.folderManaged', { folder: p.folder }) : null;
  }

  /* `path` as the vault already spells it, when a file differing only by
     case is there.

     macOS and iOS resolve paths case-insensitively; Obsidian's index does
     not. An "exports/budget … - summary.csv" from an earlier export IS the
     file "Exports/Budget … - Summary.csv" names on those devices — and the
     write did not even replace it: writeVaultFile missed the index's exact
     key, called vault.create, and Vault.create (app.js 1.13.7) asks the
     ADAPTER whether the path exists — case-insensitively there — and throws
     "File already exists.", so the export stopped half-way (2026-10-07
     audit, L4A-07 a). An export replaces what is at its path; this finds the
     file that IS at its path, so the preview can name it and the write can
     modify it. Asked only when vaultPathTaken says the path is used and the
     exact key is not; Obsidian's own getAbstractFileByPathInsensitive does
     the finding, and an Obsidian without it keeps the path as asked (the
     preview still names it — vaultPathTaken is the warning). views/report.js
     carries the same four lines for the same reason. */
  function onDisk(path) {
    if (fileAtVaultPath(path) || !vaultPathTaken(path)) return path;
    const v = app.vault;
    const hit = v && typeof v.getAbstractFileByPathInsensitive === 'function' ? v.getAbstractFileByPathInsensitive(path) : null;
    return hit && hit.path && fileAtVaultPath(hit.path) ? hit.path : path;
  }

  /* Every category a TRANSACTION can carry — transfers included, though they
     are never a budget row (figures.js drops them). The first checklist left
     them out, which made "every box ticked" (no filter, transfers listed) and
     "one box unticked" (a filter no transfer could ever be in) differ by a
     whole class of transactions the reader never chose to remove. S.categories
     is already in type-then-name order (load.js), the grouping the list draws. */
  const budgetExportCategories = () => S.categories.map(c => ({ name: c.name, type: c.type }));

  /* `mode: 'dates'` is the tax-year / financial-year / custom range. A real
     calendar date both ends, in order — dates.js's isRealIsoDate, because
     "2026-02-30" matches the ISO shape and is not a day. */
  const isDates = answer => answer.mode === 'dates';
  const datesOk = answer => isRealIsoDate(answer.from) && isRealIsoDate(answer.to) && answer.from <= answer.to;

  /* The ready-made ranges, from the household's own country profile: a ZA
     vault is offered 1 Mar – end Feb, a UK one 6 Apr – 5 Apr, and a profile
     with no rule gets calendar years only. */
  const budgetExportPresets = () => datePresets({ today: todayIso(), taxYearRange: (locale() || {}).taxYearRange });

  function periodsFor(answer) {
    if (isDates(answer)) {
      return datesOk(answer) ? periodsEndingIn({
        from: answer.from, to: answer.to, anchor: currentPeriod(),
        shiftPeriod, periodRange, earliest: earliestDataMonth(),
      }) : [];
    }
    return exportPeriods({
      range: answer.range, includeCurrent: answer.includeCurrent, anchor: currentPeriod(),
      shiftPeriod, periodsForMonths,
      periodEndMonth: p => periodRange(p).end.slice(0, 7),
      earliest: earliestDataMonth(),
    });
  }

  function modelFor(answer, withRows) {
    const keys = periodsFor(answer);
    const now = currentPeriod();
    const periods = keys.map(p => {
      const { start, end } = periodRange(p);
      return {
        key: p, name: periodMonthName(p), title: periodTitle(p), start, end,
        rows: budgetVsActualRows(p),
        summary: periodSummary(p),
        /* In date mode the transactions are the exact-date ones, gathered once
           below — not each period's list, which would run past both ends. */
        txs: withRows && answer.includeTx && !isDates(answer) ? txInPeriod(p) : [],
      };
    });
    let exact = null;
    if (isDates(answer) && datesOk(answer)) {
      const { rows, through, summary } = categoryActualsInRange(answer.from, answer.to);
      exact = { from: answer.from, to: answer.to, through, rows, summary,
        txs: withRows && answer.includeTx ? txInRange(answer.from, through) : [] };
    }
    return buildModel({
      exact, typeOrder: typeOrder((S.settings || {}).groups),
      periods, content: answer.content, categories: answer.categories, includeTx: answer.includeTx,
      generated: nowLocalMinute(), currency: (S.settings || {}).currency || '',
      inProgress: keys.includes(now) ? now : null,
    });
  }

  /* The paths a click writes — budgetExportPaths' names, each as the vault
     already spells it (onDisk) — and the ordered list of the ones the chosen
     formats produce. describe() previews exactly this list and
     runBudgetExport() writes exactly these paths. */
  function filesFor(answer, model) {
    const named = budgetExportPaths(model, answer.folder);
    const csv = {};
    for (const k of Object.keys(named.csv)) csv[k] = onDisk(named.csv[k]);
    const paths = { ...named, pdf: onDisk(named.pdf), xlsx: onDisk(named.xlsx), csv };
    const out = [];
    if (answer.formats.includes('pdf')) out.push(paths.pdf);
    if (answer.formats.includes('xlsx')) out.push(paths.xlsx);
    if (answer.formats.includes('csv')) {
      if (model.exact) out.push(paths.csv.exact);
      if (!model.exact || model.periods.length) out.push(paths.csv.summary);
      if (model.content === 'full' && model.budgets.length) out.push(paths.csv.budget);
      if (model.transactions) out.push(paths.csv.transactions);
    }
    return { paths, list: out };
  }

  /* The dialog's preview line. Runs the real walk, the real model and the real
     path builder over the state on screen — what it names is what a click
     writes — and every reason the click would be pointless is a `problem`
     here, so the button is dead BEFORE it is pressed. */
  let memo = { key: null, model: null };
  function describe(answer) {
    /* Called on every keystroke in the folder field, and an "all" walk builds
       rows for every period the vault holds — so the model is kept for as long
       as the answers that shape it stand still. The folder is not one of them. */
    const key = JSON.stringify([answer.mode, answer.from, answer.to, answer.range, answer.includeCurrent, answer.content, answer.categories, answer.includeTx]);
    if (memo.key !== key) memo = { key, model: modelFor(answer, false) };
    const model = memo.model;
    if (isDates(answer) && !datesOk(answer)) return { problem: i18n.t('bx.problem.badDates') };
    if (!isDates(answer) && !model.periods.length) return { problem: i18n.t('bx.problem.noPeriods') };
    if (answer.categories && !answer.categories.length) return { problem: i18n.t('bx.problem.noCats') };
    const { paths, list } = filesFor(answer, model);
    /* views/report.js's M1: a file written into Categories/, Accounts/,
       Budgets/ … is parsed back in as vault data on the next load. None of
       these three is a .md, but the Rules CSV lives in a managed folder and a
       refusal that is one rule everywhere is easier to trust than one with
       exceptions. folderProblem() covers that, the config folder, a "..", and
       every folder Obsidian hides — see its header. */
    const folderBad = folderProblem(answer.folder, paths.dir);
    if (folderBad) return { problem: folderBad };
    const catCount = Math.max(model.summary.rows.length, model.exact ? model.exact.rows.length : 0);
    if (!catCount) return { problem: i18n.t('bx.problem.noRows') };
    return {
      what: i18n.t(model.exact ? 'bx.previewDates' : 'bx.preview', { count: model.periods.length, range: model.rangeLabel, cats: catCount }),
      files: list,
      /* An export REPLACES whatever is at its path — that is its contract, and
         what someone who just fixed a category and exported again wants. It is
         also how a hand-edited "Budget June 2026.xlsx" kept in the same folder
         would be lost without a word. views/tax.js can refuse to overwrite; an
         export cannot, so it says which files are already there, per file,
         before the click. Asked the filesystem's way — vaultPathTaken folds
         case and Unicode form, as macOS and iOS do — because the exact-key
         lookup this used missed the case-variant file the click then hit
         (2026-10-07 audit, L4A-07 a); `list` already carries the spelling the
         vault has for it, so the name shown is the reader's own file's. */
      replaces: list.filter(p => vaultPathTaken(p)),
    };
  }

  /* When the files were made, as both writers take it: `created` the
     household's wall-clock minute (the same `generated` the document prints)
     and `utcOffset` the zone that clock was read in, in minutes east of UTC.
     Both writers used to be handed the wall time alone and stamped it as UTC
     — an export made at 14:00 in Johannesburg claimed 14:00Z (2026-10-07
     audit, L4A-09). The offset is read off THAT minute, as a local date, not
     off a second look at the clock, so the two can never straddle a DST
     change between them. */
  function stampOf(model) {
    const created = model.generated.replace(' ', 'T');
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(created);
    const utcOffset = m ? -new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTimezoneOffset() : undefined;
    return { created, utcOffset };
  }

  /* One PDF, by whichever backend can carry its text. docEncodable() decides:
     true and the page is real, selectable Helvetica a few kilobytes long;
     false — a category in Chinese, a note in Devanagari — and the SAME layout
     is measured with the canvas's own font and painted (pdf-raster.js). The
     reader is told which one they got only when it is the image one, because
     that is the one with a consequence: the text in it cannot be searched. */
  async function pdfBytes(model) {
    /* The month-by-month table's cells go without the symbol — see modelToDoc.
       moneyIn('') rather than a second formatter: the household's separators
       are the point, only the unit is dropped. */
    const plainMoney = typeof ctx.moneyIn === 'function' ? v => String(ctx.moneyIn('', v)).trim() : null;
    const doc = modelToDoc(model, { money, rowMoney, plainMoney, labels: docLabels() });
    const page = doc.landscape ? PAGE.A4_LANDSCAPE : PAGE.A4;
    const meta = { title: `${doc.title} ${model.rangeLabel}`.trim(), ...stampOf(model), producer: 'Budget Vault' };
    const pageLabel = (n, m) => i18n.t('bx.doc.pageOf', { n, m });
    if (docEncodable(doc)) {
      return { bytes: renderVectorPdf(layoutDocument(doc, { measure: helveticaMeasure, page, pageLabel }), { meta }), raster: false };
    }
    const pages = layoutDocument(doc, { measure: canvasMeasure(), page, pageLabel });
    return { bytes: renderImagePdf(await rasterisePages(pages), { page, meta }), raster: true };
  }

  /* The export itself, apart from the dialog that asks for it — so
     tests/budget-export-view.test.cjs can run the REAL gather-and-write over
     an in-memory vault without a Modal, and so a command or another page can
     one day ask for an export without re-asking the questions. A failure
     carries `written`, the files that landed before it. */
  async function runBudgetExport(answer) {
    const written = [];
    let raster = false;
    try {
      const model = modelFor(answer, true);
      const { paths } = filesFor(answer, model);
      /* Refused here as well as in describe(): the dialog's refusal can be
         bypassed by anything that calls this directly; the write cannot. The
         reason travels in the error, so the failure toast says why. */
      const folderBad = folderProblem(answer.folder, paths.dir);
      if (folderBad) throw new Error(folderBad);
      if (answer.formats.includes('pdf')) {
        const pdf = await pdfBytes(model);
        raster = pdf.raster;
        written.push(await writeVaultBinary(paths.pdf, pdf.bytes));
      }
      if (answer.formats.includes('xlsx')) {
        const sheets = modelToSheets(model, { symbolFor: rowSymbol, labels: docLabels() });
        written.push(await writeVaultBinary(paths.xlsx, buildXlsx(sheets, stampOf(model))));
      }
      if (answer.formats.includes('csv')) {
        for (const f of modelToCsv(model, { symbolFor: rowSymbol })) written.push(await writeVaultFile(paths.csv[f.kind], f.text));
      }
      return { written, raster, model };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      err.written = written;
      throw err;
    }
  }

  async function exportBudget() {
    /* budgetDirty is late-bound: views/budgets.js registers after this module
       would need it at destructure time, the registration-order trap
       controller.js's own register chain warns about. */
    const unsaved = Object.values(S.txFiles || {}).some(f => f.dirty)
      || (typeof ctx.budgetDirty === 'function' && ctx.budgetDirty());
    if (unsaved) return toast(i18n.t('bx.dirty'), true);
    const remembered = plugin.settings.budgetExport || {};
    memo = { key: null, model: null };   // a fresh dialog reads the vault as it is NOW
    const answer = await askBudgetExport(app, {
      state: remembered,
      defaultFolder: plugin.settings.exportFolder || 'Exports',
      categories: budgetExportCategories(),
      presets: budgetExportPresets(),
      describe,
    });
    if (!answer) return;                       // cancelled — say nothing, do nothing

    let result;
    try {
      result = await runBudgetExport(answer);
    } catch (e) {
      console.error('Budget: budget export failed', e);
      /* Files written before the failure are real and stay; say how far it
         got rather than claim nothing happened. */
      const done = (e && e.written) || [];
      return toast(done.length
        ? i18n.t('bx.failedPartial', { count: done.length, error: e.message || e })
        : i18n.t('bx.failed', { error: e.message || e }), true);
    }
    const { written, raster } = result;

    /* Remembered only after a write succeeded — transactions.js's rule: a
       destination that failed must not come back prefilled. The category pick
       is deliberately NOT remembered: categories come and go between exports,
       and a stale tick list silently narrows next month's file. */
    plugin.settings.budgetExport = {
      /* A preset is remembered by NAME and re-resolved next time against that
         day's date; only a custom range is remembered as dates. */
      mode: answer.mode, preset: answer.preset,
      from: answer.preset === 'custom' ? answer.from : undefined,
      to: answer.preset === 'custom' ? answer.to : undefined,
      range: answer.range, includeCurrent: answer.includeCurrent, content: answer.content,
      includeTx: answer.includeTx, formats: answer.formats, folder: answer.folder,
    };
    try { await plugin.saveSettings(); } catch (e) {
      toast(i18n.t('settings.err.save', { error: e.message || e }), true);
    }

    toast(i18n.t('bx.done', { count: written.length, path: written[0].split('/').slice(0, -1).join('/') }));
    showBudgetExportDone(app, {
      files: written,
      note: raster ? i18n.t('bx.done.raster') : '',
      onOpen: openExported,
      onReveal: revealExported,
    });
  }

  async function openExported(path) {
    try {
      const f = fileAtVaultPath(path);
      if (!f) return toast(i18n.t('report.openFailed'), true);
      await app.workspace.getLeaf('tab').openFile(f);
    } catch (e) {
      toast(i18n.t('report.openFailed'), true);
    }
  }

  /* Obsidian's own file-explorer reveal, not the OS one — views/report.js's
     revealReportFolder explains why that is the call that works on a phone. */
  async function revealExported(path) {
    try {
      const f = fileAtVaultPath(path);
      const explorer = app.internalPlugins && typeof app.internalPlugins.getEnabledPluginById === 'function'
        ? app.internalPlugins.getEnabledPluginById('file-explorer') : null;
      if (f && explorer && typeof explorer.revealInFolder === 'function') return explorer.revealInFolder(f);
      toast(i18n.t('report.revealUnavailable'), true);
    } catch (e) {
      toast(i18n.t('report.revealFailed', { error: e.message || e }), true);
    }
  }

  ctx.provide({ exportBudget, runBudgetExport, describeBudgetExport: describe, budgetExportCategories, budgetExportPresets });
};
