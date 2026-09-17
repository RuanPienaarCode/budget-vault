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
  exportPeriods, buildModel, modelToCsv, modelToSheets, modelToDoc, budgetExportPaths,
} = require('../budget-export');
const { askBudgetExport, showBudgetExportDone } = require('../budget-export-modal');
const { buildXlsx } = require('../xlsx');
const { PAGE, docEncodable, helveticaMeasure, layoutDocument, renderVectorPdf, renderImagePdf } = require('../pdf');
const { canvasMeasure, rasterisePages } = require('../pdf-raster');
const { managedFolderMatch } = require('../report');
const { symbolOf } = require('../currency');
const { nowLocalMinute } = require('../dates');
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
];

module.exports = function registerBudgetExport(ctx) {
  const {
    S, app, plugin, money, toast, writeVaultFile, writeVaultBinary, fileAtVaultPath,
    currentPeriod, shiftPeriod, periodRange, periodMonthName, periodTitle, periodSummary, txInPeriod,
    periodsForMonths, earliestDataMonth, budgetVsActualRows,
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
  const KEEP = { type: '{type}', list: '{list}', period: '{period}', income: '{income}', spend: '{spend}', uncat: '{uncat}' };
  const docLabels = () => {
    const out = {};
    for (const k of DOC_LABEL_KEYS) out[k] = i18n.t(`bx.doc.${k}`, KEEP);
    /* Sheet names stay English on purpose: Excel forbids a handful of
       characters and caps them at 31, and a formula someone writes against
       'Summary'!C2 should survive the household changing its language. */
    return out;
  };

  /* Obsidian's own config folder (".obsidian" unless the vault renamed it).
     io.js's guardedVaultPath keeps a write inside the VAULT, and the config
     folder is inside the vault — so a typed ".obsidian/plugins" was a legal
     destination: a real file, a success toast, and nothing visible anywhere,
     since the file explorer hides that folder. Compared by SEGMENT, so
     ".obsidian-notes" is still an ordinary folder. */
  const configDir = () => String((app.vault && app.vault.configDir) || '.obsidian');
  const inConfigDir = dir => {
    const segs = String(dir || '').split('/').filter(Boolean);
    const cfg = configDir().split('/').filter(Boolean);
    return cfg.length > 0 && cfg.every((seg, i) => (segs[i] || '').toLowerCase() === seg.toLowerCase());
  };

  /* Every category a TRANSACTION can carry — transfers included, though they
     are never a budget row (figures.js drops them). The first checklist left
     them out, which made "every box ticked" (no filter, transfers listed) and
     "one box unticked" (a filter no transfer could ever be in) differ by a
     whole class of transactions the reader never chose to remove. S.categories
     is already in type-then-name order (load.js), the grouping the list draws. */
  const budgetExportCategories = () => S.categories.map(c => ({ name: c.name, type: c.type }));

  function periodsFor(answer) {
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
        txs: withRows && answer.includeTx ? txInPeriod(p) : [],
      };
    });
    return buildModel({
      periods, content: answer.content, categories: answer.categories, includeTx: answer.includeTx,
      generated: nowLocalMinute(), currency: (S.settings || {}).currency || '',
      inProgress: keys.includes(now) ? now : null,
    });
  }

  function filesFor(answer, model) {
    const paths = budgetExportPaths(model, answer.folder);
    const out = [];
    if (answer.formats.includes('pdf')) out.push(paths.pdf);
    if (answer.formats.includes('xlsx')) out.push(paths.xlsx);
    if (answer.formats.includes('csv')) {
      out.push(paths.csv.summary);
      if (model.content === 'full') out.push(paths.csv.budget);
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
    const key = JSON.stringify([answer.range, answer.includeCurrent, answer.content, answer.categories, answer.includeTx]);
    if (memo.key !== key) memo = { key, model: modelFor(answer, false) };
    const model = memo.model;
    if (!model.periods.length) return { problem: i18n.t('bx.problem.noPeriods') };
    if (answer.categories && !answer.categories.length) return { problem: i18n.t('bx.problem.noCats') };
    const { paths, list } = filesFor(answer, model);
    /* views/report.js's M1: a file written into Categories/, Accounts/,
       Budgets/ … is parsed back in as vault data on the next load. None of
       these three is a .md, but the Rules CSV lives in a managed folder and a
       refusal that is one rule everywhere is easier to trust than one with
       exceptions. */
    const managed = managedFolderMatch(paths.dir, plugin.settings.budgetFolder);
    if (managed) return { problem: i18n.t('report.field.folderManaged', { folder: managed }) };
    if (inConfigDir(paths.dir)) return { problem: i18n.t('bx.problem.configDir', { folder: configDir() }) };
    if (!model.summary.rows.length) return { problem: i18n.t('bx.problem.noRows') };
    return {
      what: i18n.t('bx.preview', { count: model.periods.length, range: model.rangeLabel, cats: model.summary.rows.length }),
      files: list,
      /* An export REPLACES whatever is at its path — that is its contract, and
         what someone who just fixed a category and exported again wants. It is
         also how a hand-edited "Budget June 2026.xlsx" kept in the same folder
         would be lost without a word. views/tax.js can refuse to overwrite; an
         export cannot, so it says which files are already there, per file,
         before the click. */
      replaces: list.filter(p => !!fileAtVaultPath(p)),
    };
  }

  /* One PDF, by whichever backend can carry its text. docEncodable() decides:
     true and the page is real, selectable Helvetica a few kilobytes long;
     false — a category in Chinese, a note in Devanagari — and the SAME layout
     is measured with the canvas's own font and painted (pdf-raster.js). The
     reader is told which one they got only when it is the image one, because
     that is the one with a consequence: the text in it cannot be searched. */
  async function pdfBytes(model) {
    const doc = modelToDoc(model, { money, rowMoney, labels: docLabels() });
    const page = doc.landscape ? PAGE.A4_LANDSCAPE : PAGE.A4;
    const meta = { title: `${doc.title} ${model.rangeLabel}`.trim(), created: model.generated.replace(' ', 'T'), producer: 'Budget Vault' };
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
         bypassed by anything that calls this directly; the write cannot. */
      if (inConfigDir(paths.dir) || managedFolderMatch(paths.dir, plugin.settings.budgetFolder)) {
        throw new Error(`Refused export into ${paths.dir}`);
      }
      if (answer.formats.includes('pdf')) {
        const pdf = await pdfBytes(model);
        raster = pdf.raster;
        written.push(await writeVaultBinary(paths.pdf, pdf.bytes));
      }
      if (answer.formats.includes('xlsx')) {
        const sheets = modelToSheets(model, { symbolFor: rowSymbol, labels: docLabels() });
        written.push(await writeVaultBinary(paths.xlsx, buildXlsx(sheets, { created: model.generated.replace(' ', 'T') })));
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

  ctx.provide({ exportBudget, runBudgetExport, describeBudgetExport: describe, budgetExportCategories });
};
