'use strict';
/* Transactions — filterable table with inline category / exclude / note
   editing, saved back to Transactions/<account>/<month>.md files. */

const { el, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { patchFrontmatter, yamlStr } = require('../markdown');
const { SCHEMAS, headerLines, rowLine } = require('../table-schema');
const { csvCell } = require('../csv');
const { askFields, askSplit, confirmModal } = require('../modal');
const { transactionsCsv, categoriesCsv, transactionsMarkdown, categoriesMarkdown, exportPaths } = require('../exporter');
const { ISO_DATE, todayIso } = require('../dates');
const { applySplit, splitRole } = require('../tx-role');
/* Namespace import: this file binds `t` as a local (`const t = $('#txTable')`). */
const i18n = require('../i18n');

module.exports = function registerTransactions(ctx) {
  // lazyCatSelect (not catSelect): builds its full <option> list only on first
  // focus, so rendering up to 800 rows doesn't create ~20-30k option nodes up
  // front — the main source of jank on the phone at 5,700 transactions.
  const { S, $, app, plugin, money, toast, readFile, writeFile, writeVaultFile, periodTitle, periodMonthName, txInPeriod, deferredCatSelect, learnRules, txSegment } = ctx;

  /* Category changes made here teach the auto-categoriser too (not just the
     import review): desc → category, flushed to the rules CSV on save. A Map
     so re-picking the same transaction keeps only the final choice. */
  const pendingLearns = new Map();

  /* Not ctx.dirtyFlag: dirtiness here is per transaction FILE (f.dirty), and
     the matching predicate lives in controller.js alongside the import one.
     Only the button half is registered — and this is the registration that was
     missing when the reload list was written out by hand, which left Save lit
     after a reload had already discarded the edits it was offering to save. */
  const clearSaveButton = ctx.registerSaveButton('#txSave');

  /* Windowing state. `renderToken` changes whenever the FILTERS change, which
     is what resets the window — a plain re-render (a category edit, a reload)
     must not throw the reader back to the first page. */
  const PAGE = 100;
  let shown = PAGE, shownFor = null;

  /* The rows the current filters select — ALL of them, before the table's page
     window is applied.

     Extracted from renderTransactions so export cannot accidentally inherit
     that window. The table shows `shown` rows at a time (100, then more on
     request); an export built from what the table happens to have rendered
     would silently write 100 of 5,700 rows and look completely successful
     doing it. One source of truth for "which rows are we talking about", used
     by both.

     Also returns how to DESCRIBE the selection, because the export names its
     file after the range and lists the filters in the document — and deriving
     that separately is how a file ends up labelled with a range it doesn't
     contain. */
  function filteredRows() {
    let list;
    const whole = $('#txWholeHistory').checked;
    if (whole) {
      list = [];
      for (const f of Object.values(S.txFiles)) for (const r of f.rows) list.push({ ...r, label: f.label, _file: f, _row: r });
      list.sort((a, b) => b.date.localeCompare(a.date));
    } else {
      list = txInPeriod(S.period).reverse();
    }
    const acc = $('#txAccount').value, cat = $('#txCategory').value, q = $('#txSearch').value.trim().toLowerCase();
    const rows = list.filter(t =>
      (!acc || t.label === acc) &&
      (!cat || (cat === '__none__' ? !t.cat : t.cat === cat)) &&
      (!q || t.desc.toLowerCase().includes(q)));
    const filters = [];
    if (acc) filters.push(`account: ${acc}`);
    if (cat) filters.push(`category: ${cat === '__none__' ? 'Uncategorised' : cat}`);
    if (q) filters.push(`search: "${$('#txSearch').value.trim()}"`);
    return {
      rows,
      token: `${acc}|${cat}|${q}|${whole}|${S.period}`,
      range: whole ? i18n.t('tx.wholeHistory') : `${periodMonthName(S.period)} ${periodTitle(S.period)}`,
      filters,
    };
  }

  /* Rebuild these on CONTENT, not option count. Comparing counts meant a
     rename on another device (one label out, one in) left the select showing
     a name that no longer matches anything — the table then reads "0 rows"
     with no explanation and no way back short of reopening the view.
     The previous selection is re-applied, and falls back to "all" if the
     value it pointed at is gone.

     The skip-check has to look at the FIXED labels as well as the dynamic
     values, and that is not a refinement — it is the whole reason a language
     change used to leave this select behind. "All accounts" / "All categories"
     / "Uncategorised" are the only translated options here; the rest are
     account and category names, which a language switch does not touch. So
     comparing values alone made the guard hold on exactly the render that
     needed to run, and the filters kept the old language until something
     unrelated renamed a category. Every other page looked translated, which is
     what made it read as "some pages don't switch" rather than as a stale
     select.

     Published on ctx so a test can drive the REAL function — same reason
     accounts.js publishes accountReconcile. Nothing else on ctx calls it. */
  function syncOptions(sel, values, fixed) {
    const opts = [...sel.options];
    const current = opts.slice(fixed.length).map(o => o.value);
    const labels = opts.slice(0, fixed.length).map(o => o.textContent);
    const sameValues = current.length === values.length && current.every((v, i) => v === values[i]);
    const sameLabels = labels.length === fixed.length && fixed.every(([, l], i) => labels[i] === l);
    if (sameValues && sameLabels) return;
    const keep = sel.value;
    sel.empty();
    for (const [value, label] of fixed) sel.append(el('option', { value }, label));
    for (const v of values) sel.append(el('option', { value: v }, v));
    sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
  }

  /* The undo offer for the import that just landed on this page.
     Rebuilt on every render from S.lastImport, which import.js writes on commit
     and clears once it has been used or has become unusable — so there is
     exactly one place that decides whether an undo is still possible, and this
     only draws it. See undoImport in views/import.js for why the offer does not
     survive a vault re-read. */
  function renderUndoBar() {
    const bar = $('#txUndoBar');
    if (!bar) return;
    const r = S.lastImport;
    bar.empty();
    bar.classList.toggle('hidden', !r);
    if (!r) return;
    bar.append(el('div', { class: 'tx-undo-txt' },
      i18n.t('tx.undo.what', { count: r.count, label: r.label, at: r.at }),
      r.filename ? el('span', { class: 'tx-undo-file' }, r.filename) : '',
      el('div', { class: 'tx-undo-note' }, i18n.t('tx.undo.session'))));
    const undo = el('button', { type: 'button', class: 'tx-undo-btn' }, i18n.t('tx.undo.do'));
    undo.addEventListener('click', () => ctx.undoImport());
    const hide = el('button', { type: 'button', class: 'tx-undo-x',
      'aria-label': i18n.t('tx.undo.dismiss') }, '✕');
    /* Dismiss drops the receipt rather than only hiding the bar. Keeping it
       alive behind a closed banner would leave an undo that is still armed and
       no longer visible — and the next thing the reader does on this page is
       edit the rows it would silently take back. */
    hide.addEventListener('click', () => { S.lastImport = null; renderUndoBar(); });
    bar.append(el('div', { class: 'tx-undo-acts' }, undo, hide));
  }

  function renderTransactions() {
    renderUndoBar();
    $('#txSubNote').textContent = $('#txWholeHistory').checked ? i18n.t('tx.wholeHistory') : `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    syncOptions($('#txAccount'), [...new Set(Object.values(S.txFiles).map(f => f.label))].sort(),
      [['', i18n.t('tx.allAccounts')]]);
    syncOptions($('#txCategory'), S.categories.map(c => c.name),
      [['', i18n.t('tx.allCategories')], ['__none__', i18n.t('tx.uncategorised')]]);
    const { rows: filtered, token: renderToken } = filteredRows();
    let list = filtered;
    /* Window the table. The old shape sliced to 800 and built every one: ~13,600
       nodes and, before deferredCatSelect, 800 native <select>s — rebuilt in full
       on every search pause and filter change. Render a page at a time instead
       and let the reader ask for more; the data pipeline is not the cost here
       (building and sorting all 5,700 rows measures under a millisecond). */
    const total = list.length;
    if (shownFor !== renderToken) { shown = PAGE; shownFor = renderToken; }
    const visible = list.slice(0, shown);
    $('#txCount').textContent = total > visible.length
      ? i18n.t('tx.count.window', { shown: visible.length, total, count: total })
      : i18n.t('tx.count.all', { count: total });
    list = visible;
    const t = $('#txTable'); t.empty();
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, i18n.t('tx.col.date')), el('th', { scope: 'col' }, i18n.t('tx.col.desc')), el('th', { scope: 'col' }, i18n.t('tx.col.account')),
      el('th', { scope: 'col' }, i18n.t('tx.col.category')), el('th', { scope: 'col', class: 'num' }, i18n.t('tx.col.amount')), el('th', { scope: 'col' }, i18n.t('tx.col.excl')), el('th', { scope: 'col' }, i18n.t('tx.col.note')),
      /* One header for the whole action cell rather than one per button. Split
         and Delete share that cell deliberately: a ninth column costs width the
         phone does not have, and both colspans on this page — the empty state
         and the show-more row — would have to be kept in step with it. */
      el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, i18n.t('tx.col.actions'))))));
    const body = el('tbody', {});
    for (const item of list) {
      const r = item._row;
      const mark = () => { item._file.dirty = true; $('#txSave').disabled = false; };
      body.append(el('tr', {},
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, r.date),
        el('td', {}, r.desc),
        el('td', { class: 'text-muted' }, item.label),
        // deferredCatSelect: a button until first use. See categories.js — at a
        // full page of rows this is the difference between 0 and 100 native
        // selects, and a select is the priciest control in a mobile WebView.
        el('td', {}, deferredCatSelect(r.cat, v => {
          r.cat = v;
          if (v) pendingLearns.set(r.desc, v); else pendingLearns.delete(r.desc);
          mark();
        }, i18n.t('tx.aria.category', { date: r.date, desc: r.desc }))),
        el('td', { class: `num${r.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, money(r.amount)),
        el('td', {}, el('input', { type: 'checkbox', 'aria-label': i18n.t('tx.aria.exclude', { desc: r.desc }),
          ...(r.excluded ? { checked: '' } : {}), onchange: e => { r.excluded = e.target.checked; mark(); } })),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: r.note, style: 'width:130px',
          'aria-label': i18n.t('tx.aria.note', { date: r.date, desc: r.desc }),
          onchange: e => { r.note = e.target.value; mark(); } })),
        el('td', { style: 'white-space:nowrap' }, splitButton(item), deleteButton(item))));
    }
    if (!list.length) body.append(el('tr', {}, el('td', { colspan: '8', class: 'text-muted' }, i18n.t('tx.none'))));
    if (total > list.length) {
      const more = el('button', { class: 'btn-ghost', style: 'width:100%;padding:0.6rem' },
        i18n.t('tx.showMore', { n: Math.min(PAGE, total - list.length), remaining: total - list.length, count: total - list.length }));
      more.addEventListener('click', () => { shown += PAGE; renderTransactions(); });
      body.append(el('tr', {}, el('td', { colspan: '8', style: 'padding:0' }, more)));
    }
    t.append(body);
  }

  /* ------------------------------- splitting -------------------------------
     One bank line often covers several categories — a supermarket shop that
     is half groceries and half household, a card payment covering two people.
     A split carves it into parts that sum back to the original.

     The original row is KEPT and marked excluded rather than deleted. That is
     the whole design, and it is not squeamishness:

       • Every total (dashboard, budget-vs-actual, trend) is computed from
         non-excluded rows — periodSummary filters them out — so parking the
         parent as excluded leaves the arithmetic identical to before.
       • The CSV importer dedupes on `date|desc|amount|label`. Delete the
         parent and that key vanishes from the file, so re-importing the same
         statement would cheerfully re-add the original line ON TOP of the
         parts and silently double-count it. Keeping the parent keeps the key.
       • It is reversible by hand in the markdown: untick Excluded, delete the
         parts. Nothing about the split is a one-way door. */
  function splitButton(item) {
    const r = item._row;
    const b = el('button', {
      type: 'button', class: 'btn-ghost btn-ghost-sm',
      'aria-label': i18n.t('tx.aria.split', { date: r.date, desc: r.desc }), title: i18n.t('tx.title.split'),
    }, icoEl(['split', 'git-fork', 'scissors']));
    b.addEventListener('click', () => splitTransaction(item));
    return b;
  }

  async function splitTransaction(item) {
    const r = item._row;
    if (!r.amount) return toast(i18n.t('tx.split.zero'), true);
    if (r.excluded) return toast(i18n.t('tx.split.excluded'), true);
    /* Before the modal, not after: a part passes both guards above — it has a
       real amount and is not excluded — so without this the reader allocates a
       charge across categories and only then finds out it could not be done.
       applySplit refuses the same case as the authority on roles; this is the
       half that says so. */
    if (splitRole(r.split)) return toast(i18n.t('tx.split.part'), true);
    const parts = await askSplit(app, {
      tx: { date: r.date, desc: r.desc, label: item.label, amount: r.amount, cat: r.cat },
      categories: S.categories.map(c => c.name),
      money,
    });
    if (!parts) return;

    /* Both roles are assigned in applySplit, and deliberately not here: the
       parent must come out excluded AND marked. `excluded` keeps it out of the
       budget totals; the role keeps it out of the ACCOUNT totals, which read
       excluded rows on purpose. Setting only the first counted every split
       charge twice in every implied balance — see src/tx-role.js. */
    const rows = applySplit(r, parts, i18n.t('tx.split.marker', { n: parts.length }));
    // applySplit is the authority and can refuse. Unreachable while the guard
    // above matches it, and handled anyway so the two can never drift into a
    // dead button that spreads null into the file's rows.
    if (!rows) return toast(i18n.t('tx.split.part'), true);
    // Same file: every part shares the parent's date, so it shares its month.
    item._file.rows.push(...rows);
    item._file.dirty = true;
    $('#txSave').disabled = false;
    /* Deliberately NOT fed to pendingLearns: the parts share one description
       with different categories, so learning from them would teach the
       auto-categoriser a rule that contradicts itself on every import. */
    renderTransactions();
    toast(i18n.t('tx.split.done', { n: rows.length }));
  }

  /* ------------------------------- deleting --------------------------------
     The one control on this page that removes a line rather than describing it,
     so it says what that costs before doing it.

     Excluding a row was always the gentler answer and stays the default advice
     — the money still moved, and everything measuring the ACCOUNT deliberately
     reads excluded rows. But "there is a gentler answer" is not the same as
     "there is no honest reason", and there are three: a manual entry typed with
     the wrong amount, a row imported twice under two descriptions the dedup key
     could not match, and a statement imported into the wrong account. Excluding
     any of those leaves a line the reconciliation still counts and the reader
     cannot explain, which is how a page that argues about balances loses the
     argument.

     What the dialog has to say, because none of it is visible from the button:

       • The importer dedupes on `date|desc|amount|label`, and that key lives in
         the row and nowhere else. Delete it and re-importing the same statement
         re-adds the line as new — the exact trap tx-role.js documents as the
         reason a split parent is kept rather than deleted.
       • A split parent is not one row. Its parts carry the same money under
         finer categories, so they go with it — leaving them would leave rows
         marked `part` describing a line that no longer exists, and an unsplit
         has nothing left to reverse.
       • Deleting a single PART is the one case that moves a figure. The parent
         stays excluded and superseded, so the money that part carried leaves
         the account totals entirely rather than falling back to the parent —
         see supersededBySplit in tx-role.js, which requires BOTH columns. The
         way back is the one that module documents: untick Excluded on the
         original. */
  function deleteButton(item) {
    const r = item._row;
    const b = el('button', {
      type: 'button', class: 'btn-ghost btn-ghost-sm',
      'aria-label': i18n.t('tx.aria.delete', { date: r.date, desc: r.desc }), title: i18n.t('tx.title.delete'),
    }, icoEl(['trash-2', 'trash']));
    b.addEventListener('click', () => deleteTransaction(item));
    return b;
  }

  /* The parts belonging to one parent, matched on date + description within the
     parent's own file — the same three facts applySplit copies onto a part, and
     the only join there is: a part carries no id back to its parent. Narrow
     rather than clever: a file holding two identical charges on one day, both
     split, has no way to tell whose parts are whose, so this deliberately takes
     BOTH sets and the dialog states the count it found. Undercounting would
     strand rows; overcounting is visible in the number the reader agrees to. */
  function splitPartsOf(f, parent) {
    return f.rows.filter(x => x !== parent && splitRole(x.split) === 'part'
      && x.date === parent.date && x.desc === parent.desc);
  }

  async function deleteTransaction(item) {
    const r = item._row, f = item._file;
    const role = splitRole(r.split);
    const parts = role === 'parent' ? splitPartsOf(f, r) : [];
    const detail = role === 'parent' && parts.length ? i18n.t('tx.delete.parent', { count: parts.length })
      : role === 'part' ? i18n.t('tx.delete.part')
        : i18n.t('tx.delete.reimport');
    const go = await confirmModal(app, {
      title: i18n.t('tx.delete.title'),
      message: i18n.t('tx.delete.msg', {
        date: r.date, desc: r.desc, amount: money(r.amount), file: `Transactions/${f.label}/${f.month}.md`,
      }) + ' ' + detail,
      confirmText: i18n.t('tx.delete.confirm'),
    });
    if (!go) return;
    /* Removed from the in-memory rows and marked dirty rather than written
       straight to disk, unlike Add transaction. serializeTxFile writes the
       WHOLE file, so a delete that wrote immediately would also flush every
       unsaved category, note and Excluded edit sitting in the same month — a
       save the reader did not ask for, hidden inside a delete they did. The
       page's own Save button is the one door to disk, and until it is pressed
       "Reload from disk" is a working undo. */
    const doomed = new Set([r, ...parts]);
    f.rows = f.rows.filter(x => !doomed.has(x));
    f.dirty = true;
    $('#txSave').disabled = false;
    renderTransactions();
    toast(i18n.t('tx.deleted', { count: doomed.size }));
  }

  /* ---------------------- deleting what the filters select ------------------
     The tool for the mistake found LATER — a statement imported into the wrong
     account and noticed next week, when the session's undo is long gone. The
     filters on this page already describe that set exactly ("account: Cheque,
     search: Woolworths"), so the honest bulk delete is "remove what I am
     looking at" rather than a second selection mechanism to get wrong.

     Three gates, each there for its own reason:

       • At least one FILTER must be set. The period alone is not a
         description of anything — a button that removes every row in the
         current window because the reader happened to be looking at it is not
         a delete anyone asked for.
       • Nothing may be unsaved. serializeTxFile writes the whole file, so a
         delete over unsaved edits would flush them to disk as a side effect,
         and the reader would have no way to tell afterwards which of the two
         they had agreed to. Same rule the export follows, for the same reason.
       • The removed rows are written to a CSV beside the vault's own data
         FIRST, and the delete is abandoned if that write fails. Deleting rows
         is the one destructive act in this app the vault trash cannot undo —
         the file is modified, not removed — so this is the way back, and
         cleanupRules already established that a bulk delete which cannot leave
         one does not happen. Appended rather than overwritten: two deletes on
         one day must not cost the first one's record. */
  const DELETED_LOG = 'Data/Deleted transactions.csv';

  async function deleteFilteredTransactions() {
    if (Object.values(S.txFiles).some(f => f.dirty)) return toast(i18n.t('tx.bulk.dirty'), true);
    const { rows, range, filters } = filteredRows();
    if (!filters.length) return toast(i18n.t('tx.bulk.needFilter'), true);
    if (!rows.length) return toast(i18n.t('tx.bulk.none'), true);

    // Split rows in the selection are called out by number: the filters that
    // select a parent need not select its parts (they carry finer categories),
    // and parts left behind describe a line that no longer exists.
    const splits = rows.filter(t => splitRole(t._row.split)).length;
    const go = await confirmModal(app, {
      title: i18n.t('tx.bulk.title'),
      message: i18n.t('tx.bulk.msg', { count: rows.length, range, filters: filters.join(', ') })
        + ' ' + i18n.t('tx.bulk.backup', { path: DELETED_LOG })
        + (splits ? ' ' + i18n.t('tx.bulk.splits', { count: splits }) : ''),
      confirmText: i18n.t('tx.bulk.confirm', { count: rows.length }),
    });
    if (!go) return;

    /* The backup, before anything is touched. Appended by hand rather than
       through a writer that could overwrite: read what is there, keep it, and
       add today's rows under it. transactionsCsv owns the column shape, so the
       log reads the same as an export and can be imported straight back in. */
    try {
      const csv = transactionsCsv(rows);
      const existing = await readFile(DELETED_LOG);
      await writeFile(DELETED_LOG, existing
        ? existing.replace(/\n*$/, '\n') + csv.split('\n').slice(1).join('\n')
        : csv);
    } catch (e) {
      return toast(i18n.t('tx.bulk.backupFailed', { error: (e && e.message) || e }), true);
    }

    // Grouped per file so each one is written once. The row OBJECTS are what
    // identifies a row here — two identical lines in one month are two rows,
    // and only the one the filter selected may go.
    const perFile = new Map();
    for (const t of rows) {
      if (!perFile.has(t._file)) perFile.set(t._file, new Set());
      perFile.get(t._file).add(t._row);
    }
    let removed = 0, files = 0;
    try {
      for (const [f, doomed] of perFile) {
        const keep = f.rows.filter(x => !doomed.has(x));
        await writeFile(`Transactions/${f.label}/${f.month}.md`, serializeTxFile({ ...f, rows: keep }));
        f.rows = keep;
        removed += doomed.size;
        files++;
      }
    } catch (e) {
      renderTransactions();
      return toast(i18n.t('tx.bulk.failed', { count: files, error: (e && e.message) || e }), true);
    }
    /* The receipt describes rows this may just have removed, and it holds them
       by object identity — an undo run afterwards would find fewer than it
       promised. Dropped rather than reconciled: the reader has been given the
       CSV, which is the better way back. */
    S.lastImport = null;
    ctx.render();
    toast(i18n.t('tx.bulk.done', { count: removed, files, path: DELETED_LOG }));
  }

  function serializeTxFile(f) {
    // Preserve the file's own frontmatter (tags, any hand-added keys); patch only
    // the account label + month. amountRaw !== null means the loader could not
    // strictly parse that cell — write it back verbatim rather than corrupting it.
    const fm = patchFrontmatter(f.fmRaw || '', { account: yamlStr(f.label), month: f.month });
    /* The Split column is written ONLY into files that contain a split. Adding
       it unconditionally would rewrite every transaction file in the vault with
       an empty seventh column the first time anything saved — a diff in every
       month of every account, in a folder the user reads and syncs, to record
       nothing. A file with no split keeps the exact six-column shape it has
       always had. */
    /* Escaping, number formatting and the splitRole write (only two strings
       can ever occupy that cell, so writes always round-trip) live in the
       schema's column declarations — the same ones the loader reads with
       (table-schema.js, ADR-0003). This file keeps its own document shape:
       patched frontmatter, no title, no prose, so it consumes only the line
       builders rather than mdTableFile. A never-split file keeps the exact
       six-column shape it has always had by slicing the schema, not by
       hand-writing a second header. */
    const hasSplit = f.rows.some(r => splitRole(r.split));
    const schema = hasSplit ? SCHEMAS.transactions
      : { ...SCHEMAS.transactions, columns: SCHEMAS.transactions.columns.slice(0, 6) };
    const lines = ['---', fm, '---', '', ...headerLines(schema)];
    f.rows.sort((a, b) => a.date.localeCompare(b.date));
    for (const r of f.rows) lines.push(rowLine(schema, r));
    lines.push('');
    return lines.join('\n');
  }

  /* Manual entry — cash spends, transfers, savings deposits, anything that
     never reaches a bank CSV. Written to disk immediately (same lockstep
     pattern as the CSV import commit), so there's nothing extra to save. */
  async function addTransaction() {
    const labels = [...new Set([
      ...S.accounts.map(a => a.tx_label || a.name),
      ...Object.values(S.txFiles).map(f => f.label)])].sort();
    if (!labels.length) return toast(i18n.t('tx.add.noAccount'), true);
    const r = await askFields(app, i18n.t('tx.add.title'), [
      { key: 'date', label: i18n.t('tx.field.date'), type: 'date', value: todayIso() },
      { key: 'desc', label: i18n.t('tx.field.desc'), type: 'text', placeholder: i18n.t('tx.field.descPlaceholder') },
      { key: 'label', label: i18n.t('tx.field.account'), type: 'select', options: labels, value: $('#txAccount').value || labels[0] },
      { key: 'dir', label: i18n.t('tx.field.direction'), type: 'select', value: 'out', options: [
        { value: 'out', label: i18n.t('tx.dir.out') }, { value: 'in', label: i18n.t('tx.dir.in') }] },
      { key: 'amount', label: i18n.t('tx.field.amount'), type: 'number', placeholder: '0.00', desc: i18n.t('tx.field.amountDesc') },
      { key: 'cat', label: i18n.t('tx.field.category'), type: 'select', options: [
        { value: '', label: i18n.t('tx.field.none') }, ...S.categories.map(c => ({ value: c.name, label: c.name }))], value: '' },
      { key: 'note', label: i18n.t('tx.field.note'), type: 'text', placeholder: i18n.t('tx.field.notePlaceholder') },
    ]);
    if (!r) return;
    const date = r.date.trim();
    if (!ISO_DATE.test(date)) return toast(i18n.t('tx.err.date'), true);
    const desc = r.desc.trim();
    if (!desc) return toast(i18n.t('tx.err.desc'), true);
    // txSegment, not safeSeg: the key below and the path further down must be
    // the same string, and an existing folder keeps its on-disk name.
    const label = txSegment(r.label);
    if (!label) return toast(i18n.t('tx.err.account'), true);
    let amount = normalizeAmount(r.amount);
    if (amount == null || amount === 0) return toast(i18n.t('tx.err.amount'), true);
    amount = parseFloat((r.dir === 'in' ? Math.abs(amount) : -Math.abs(amount)).toFixed(2));

    const month = date.slice(0, 7);
    const key = `${label}/${month}`;
    const row = { date, desc, cat: r.cat, amount, excluded: false, note: (r.note || '').trim() };
    const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
    // Write first, then mirror into S.txFiles — memory never models a row the
    // disk doesn't have. serializeTxFile gets a cloned rows array (concat), so
    // a failed write leaves the live model untouched.
    const existing = S.txFiles[key];
    const fileModel = existing
      ? { ...existing, rows: existing.rows.concat([row]) }
      : { label, month, rows: [row], dirty: false, fmRaw: TX_FM };
    try {
      await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
    } catch (err) {
      return toast(i18n.t('tx.err.save', { error: err.message || err }), true);
    }
    if (!S.txFiles[key]) S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
    S.txFiles[key].rows.push(row);
    renderTransactions();
    toast(`Added ${money(amount)} · ${label} · ${month}`);
  }

  /* Guarded per-file, deliberately not around the whole loop-plus-learn: a
     rejected write used to be an UNHANDLED rejection — nothing caught it, so
     nothing told the user their save had failed. That was the whole bug, not
     a marking one: `f.dirty = false` only ever runs AFTER its own write
     resolves, so a file already written before the failure was correctly
     clean, and a throw stops a for-loop at the failing iteration, so every
     file after it was simply never reached and stayed exactly as dirty as it
     already was. The catch here does not fix a dirty-flag bug that never
     existed; it turns the silence into a toast and a controlled stop, so the
     file that actually failed is visible and a retry knows where to resume.
     clearSaveButton() and the success toast are skipped on that path since
     the button must stay lit while any file is still unsaved. */
  async function saveTransactions() {
    let n = 0;
    try {
      for (const f of Object.values(S.txFiles)) {
        if (!f.dirty) continue;
        await writeFile(`Transactions/${f.label}/${f.month}.md`, serializeTxFile(f));
        f.dirty = false; n++;
      }
    } catch (err) {
      // n===0 is the likeliest failure — a dirty batch saves in file order, so
      // the earliest file is the one most likely to still be locked or
      // mid-sync — and it gets its own key rather than saveMany's count:0
      // form: no count to state, so no language-specific zero handling
      // (French's ZERO_IS_SINGULAR rule) to get wrong.
      return toast(n
        ? i18n.t('tx.err.saveMany', { count: n, error: err.message || err })
        : i18n.t('tx.err.saveNone', { error: err.message || err }), true);
    }
    let learned = 0;
    if (pendingLearns.size) {
      learned = await learnRules([...pendingLearns].map(([desc, cat]) => ({ desc, cat })));
      pendingLearns.clear();
    }
    clearSaveButton();
    toast(i18n.t('tx.saved', { count: n }) + (learned ? i18n.t('tx.savedLearned', { count: learned }) : ''));
  }

  /* Write the current selection out as four files: CSV for a spreadsheet,
     markdown for reading and for Obsidian's own Export to PDF.

     Into the vault rather than a browser download. An <a download> with a blob
     URL is unreliable inside Obsidian's iOS WebView, and this plugin ships with
     isDesktopOnly:false — a button that works on the desktop and quietly does
     nothing on a phone is worse than no button. Writing a file behaves the same
     everywhere, reuses the containment-guarded writeFile, and leaves the result
     somewhere the vault's own sharing can pick it up.

     Refuses while there are unsaved edits. Exporting the in-memory rows would
     produce a file that matches neither the vault nor what the reader is about
     to save, and the disagreement would only surface later, in a spreadsheet,
     with nothing to explain it. */
  async function exportTransactions() {
    if (Object.values(S.txFiles).some(f => f.dirty)) {
      return toast(i18n.t('tx.export.dirty'), true);
    }
    const { rows, range, filters } = filteredRows();
    if (!rows.length) return toast(i18n.t('tx.export.empty'), true);

    /* Ask where, every time, with last time's answer prefilled.

       A folder INSIDE THE VAULT, not an OS save dialog. Obsidian's API has no
       cross-platform file picker; reaching Electron's showSaveDialog would mean
       a Node API in src/ and a button that silently does nothing on the phone
       this plugin ships to. Once the file is in the vault, the OS share sheet
       and the desktop file manager can both take it from there.

       Asked rather than assumed even when the answer is remembered: an export
       overwrites whatever it wrote last time, and a silent overwrite of a file
       someone has since edited is not something a toast can undo. */
    const answer = await askFields(app, i18n.t('tx.export.title'), [{
      key: 'folder',
      label: i18n.t('tx.export.folder'),
      desc: i18n.t('tx.export.desc', { count: rows.length, range, cats: S.categories.length }),
      value: plugin.settings.exportFolder || 'Exports',
      placeholder: 'Exports',
    }]);
    if (!answer) return;                       // cancelled — say nothing, do nothing

    const paths = exportPaths(range, answer.folder);
    const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');
    let written;
    try {
      written = await writeVaultFile(paths.txCsv, transactionsCsv(rows));
      await writeVaultFile(paths.txMd, transactionsMarkdown(rows, { range, filters, generated }, money));
      await writeVaultFile(paths.catCsv, categoriesCsv(S.categories));
      await writeVaultFile(paths.catMd, categoriesMarkdown(S.categories, generated));
    } catch (e) {
      console.error('Budget: export failed', e);
      return toast(i18n.t('tx.export.failed'), true);
    }
    /* Remembered only after a write actually succeeded. Storing the typed value
       up front would leave a destination that failed prefilled as the default
       for every future export. */
    if (plugin.settings.exportFolder !== paths.dir) {
      plugin.settings.exportFolder = paths.dir;
      // Guarded like every other write in this app: a rejected saveSettings()
      // used to be an unhandled rejection. The export itself already landed —
      // four real vault writes, above, none of them guarded by this branch —
      // so only remembering the folder for next time failed, and the export's
      // own success toast below must still be the last word on screen.
      try {
        await plugin.saveSettings();
      } catch (e) {
        toast(i18n.t('settings.err.save', { error: e.message || e }), true);
      }
    }
    toast(i18n.t('tx.export.done', { count: rows.length, cats: S.categories.length, path: written.split('/').slice(0, -1).join('/') }));
  }

  ctx.provide({ renderTransactions, serializeTxFile, saveTransactions, addTransaction, splitTransaction,
    deleteTransaction, deleteFilteredTransactions, exportTransactions, syncOptions });
};
