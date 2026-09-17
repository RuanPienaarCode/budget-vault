'use strict';
/* Budget export — one model, three renderings (PDF, workbook, CSV).

   exporter.js re-shapes TRANSACTIONS and report.js writes a whole-household
   report; neither answers the plainest request a budget gets: "give me my
   budget for the last three months as a file I can send someone". This does.

   ONE MODEL, BUILT ONCE. buildModel() is handed each period's rows exactly as
   figures.js's budgetVsActualRows() produced them — the same rows the Budget
   page and the Dashboard table print — and everything after that is
   arrangement: modelToCsv(), modelToSheets() and modelToDoc() all read the
   SAME object, the discipline views/report.js's own header describes for its
   Markdown/JSON pair. "Two figures derived by different rules" is this
   codebase's most-repeated bug shape; a PDF that disagreed with the workbook
   written by the same click would be that shape wearing a new hat.

   THE SUMMARY AND THE PERIOD TABLES SHARE ONE SOURCE, deliberately. The month
   columns could have come from categorySpendRows() (the donut's split), which
   nets refunds and drops income — and then the August column would not equal
   the August table two pages later, with nothing on either to say why. Every
   month cell is that period's own `actual`, so Total is the sum of the cells
   beside it and nothing else.

   WHAT THIS MODULE ADDS UP, AND WHAT IT DOES NOT. It sums ROWS — across
   periods for a category, across a type for a subtotal — because a category
   filter makes those sums something no ctx helper has computed. It never
   touches a transaction amount (the transactions ride along as a listing,
   through exporter.js's own columns) and never re-derives a row's status:
   `remaining` is read off the row, and a subtotal's comes from the same
   budgetRowStatus() rule over the summed operands. Subtotals are per TYPE and
   never combined — income plus expenses is not a figure.

   Pure — no DOM, no obsidian, no vault, no clock (`generated` is handed in) —
   so tests/budget-export.test.cjs drives it in bare node. */

const { csvCell } = require('./csv');
const { budgetRowStatus } = require('./money-flow');
const { splitRole } = require('./tx-role');
const { EXPORT_DIR, safeName, transactionsCsv } = require('./exporter');

/* The six spans the dialog offers, in calendar MONTHS — the same unit
   trend-math.js's periodsForMonths() converts for a weekly or fortnightly pay
   cycle, where "3 months" is thirteen periods rather than three. */
const RANGE_KEYS = ['1', '2', '3', '6', '12', 'all'];
/* "All" still needs a ceiling: the walk below stops at the earliest month
   with data, and a ceiling is what stops it if that guard is ever handed a
   period function that does not move. Fifty years of weekly periods. */
const MAX_PERIODS = 2600;
/* Past this many month columns a portrait page cannot hold the summary, and
   past PDF_MAX_PERIOD_COLS no page can — see modelToDoc. */
const PDF_LANDSCAPE_FROM = 5;
const PDF_MAX_PERIOD_COLS = 12;

/* Which periods to export, oldest first.

   The same walk views/report.js's periodsFromAnchor() and trend-math.js's
   trendPeriods() perform, with the one thing neither needed: a start that can
   be the LAST FINISHED period instead of the current one. Pure here, with the
   period arithmetic injected, because both of those copies carried the same
   bug (an empty vault got twelve invented zero-months) and this is the first
   of the three a bare-node test can reach.

   The current period is kept even when the vault has nothing in it yet — an
   export that silently drops "now" reads as broken. A FINISHED period with no
   data is not kept: it is a month that was never imported, not a month the
   household spent nothing. */
function exportPeriods({ range, includeCurrent, anchor, shiftPeriod, periodsForMonths, periodEndMonth, earliest }) {
  const months = range === 'all' ? null : (RANGE_KEYS.includes(String(range)) ? Number(range) : 1);
  const want = months === null ? MAX_PERIODS : Math.min(MAX_PERIODS, Math.max(1, periodsForMonths(months)));
  const start = includeCurrent ? anchor : shiftPeriod(anchor, -1);
  const out = [];
  for (let i = 0; i < want; i++) {
    const p = shiftPeriod(start, -i);
    const hasData = !!earliest && periodEndMonth(p) >= earliest;
    if (!hasData && !(i === 0 && includeCurrent)) break;
    out.push(p);
  }
  return out.reverse();
}

/* Which budget periods belong to a DATE range: those whose END falls inside it.

   A tax year (1 Mar – 28 Feb) and a payday period (23 Feb – 22 Mar) do not
   share edges, so "the periods in the range" needs a rule, and only one rule
   keeps two consecutive years from both claiming the straddling period: a
   period belongs to the range that contains its last day. (By START would
   work as well; by overlap would count the straddler twice — a month of
   income declared in two tax years.) The end, because that is the month a
   period is NAMED after (period.js's periodMonthName).

   Walks back from the current period, so a range running into the future
   stops at "now" rather than inventing months ahead, and never reaches before
   the first month with data — the two rules exportPeriods() above follows. */
function periodsEndingIn({ from, to, anchor, shiftPeriod, periodRange, earliest }) {
  const out = [];
  if (!from || !to || from > to) return out;
  for (let i = 0; i < MAX_PERIODS; i++) {
    const p = shiftPeriod(anchor, -i);
    const end = periodRange(p).end;
    if (end < from) break;
    if (!earliest || end.slice(0, 7) < earliest) break;
    if (end <= to) out.push(p);
  }
  return out.reverse();
}

/* The date ranges the dialog offers ready-made. `taxYearRange(y)` is the
   country profile's (locale.js) — this module does not know any country's
   tax year, and a profile without one gets calendar years only rather than a
   guess.

   "This tax year" is the one CONTAINING today. Deliberately not
   locale.currentTaxYear(): that answers "which return is being filed" — in
   March a US household is filing LAST year — which is the Tax page's question
   and the wrong one for "export this year so far". Found by trying the three
   candidate labels around today's calendar year, since a tax year's label can
   be the year it starts in or the year it ends in, per country. */
function datePresets({ today, taxYearRange }) {
  const y = Number(String(today).slice(0, 4));
  const out = [];
  if (typeof taxYearRange === 'function') {
    for (const cand of [y - 1, y, y + 1]) {
      const r = taxYearRange(cand);
      if (r && r.start <= today && today <= r.end) {
        const prev = taxYearRange(cand - 1);
        out.push({ key: 'taxThis', from: r.start, to: r.end, year: cand });
        out.push({ key: 'taxLast', from: prev.start, to: prev.end, year: cand - 1 });
        break;
      }
    }
  }
  out.push({ key: 'calThis', from: `${y}-01-01`, to: `${y}-12-31`, year: y });
  out.push({ key: 'calLast', from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, year: y - 1 });
  return out;
}

/* Per-type subtotals over the rows actually shown. `remaining` comes from
   budgetRowStatus over the summed operands — the row rule, applied to a row
   that happens to be a sum — so a subtotal can never disagree with the lines
   above it about what "remaining" means. */
function subtotalsOf(rows) {
  const byType = new Map();
  for (const r of rows) {
    const cur = byType.get(r.type) || { type: r.type, budget: 0, actual: 0 };
    cur.budget += Number(r.budget) || 0;
    cur.actual += Number(r.actual) || 0;
    byType.set(r.type, cur);
  }
  return [...byType.values()].map(s => ({ ...s, remaining: budgetRowStatus(s).remaining }));
}

/* `categories`: null means "no filter"; an ARRAY means "exactly these", and an
   empty array is therefore "none", not "all". The dialog refuses to submit an
   empty pick; the model must not quietly widen one into a full export. */
/* `exact`, when present, is a DATE-RANGE export (the owner's ruling of 17 Sep
   2026): money by exact dates, budgets by whole periods, both spans stated.
     { from, to, through, rows, txs }
   `rows` are figures.js's categoryActualsInRange() — the SAME row rule as the
   period tables, over an arbitrary window — and `through` is the last day they
   really cover: today, when the range runs on into the future, because the
   ledger counts what has happened and schedules the rest. `txs` replace the
   per-period lists, so the transactions are the exact-date ones too. */
function buildModel({ periods, content, categories, includeTx, generated, currency, inProgress, exact, typeOrder }) {
  const list = periods || [];
  const only = Array.isArray(categories) ? new Set(categories) : null;
  const keep = cat => !only || only.has(cat);

  const shown = list.map(p => (p.rows || []).filter(r => keep(r.cat)));

  /* Summary rows keyed by category, in first-seen order — which is figures.js's
     own type-then-name order within each period, so income stays above
     expenses without this module owning a second sort rule. Every row is
     created at full width, zero-filled: the month columns are positional, and
     a category that skipped a period must hold its place rather than slide
     every later month one column left. */
  const byCat = new Map();
  shown.forEach((rows, i) => {
    for (const r of rows) {
      /* Keyed by TYPE and name, not name alone. figures.js reads a type live,
         so within one export a category is normally one type throughout — but
         for a category since DELETED, budgetRowType falls back to the type each
         period's own budget file stored, and those can differ. Keyed by name,
         July's "savings" R90 was poured into the EXPENSE subtotal while July's
         own table printed it under savings. Two rows is the honest rendering:
         the category really was two things. */
      const key = `${r.type}\u0000${r.cat}`;
      let s = byCat.get(key);
      if (!s) { s = { cat: r.cat, type: r.type, byPeriod: list.map(() => 0), budget: 0 }; byCat.set(key, s); }
      s.byPeriod[i] += Number(r.actual) || 0;
      s.budget += Number(r.budget) || 0;
    }
  });
  const n = list.length || 1;
  const finish = s => {
    const total = s.byPeriod.reduce((t, v) => t + v, 0);
    return { ...s, total, average: total / n };
  };
  /* Grouped by TYPE, then by name. The first version kept first-seen order on
     the theory that it WAS type order — true only while every category exists
     in the first period. On the first real vault (twelve periods, seventeen
     types) "Household" first appeared in month three and landed after the
     luxuries. `typeOrder` is the household's own (groups.js, handed in by the
     view); a type it does not name follows in first-seen order, and either
     way a type is never split in two. */
  const seenTypes = [];
  for (const v of byCat.values()) if (!seenTypes.includes(v.type)) seenTypes.push(v.type);
  const order = [...(typeOrder || []).filter(t => seenTypes.includes(t)), ...seenTypes.filter(t => !(typeOrder || []).includes(t))];
  const rank = t => order.indexOf(t);
  const summaryRows = [...byCat.values()].map(finish)
    .sort((a, b) => rank(a.type) - rank(b.type) || String(a.cat).localeCompare(String(b.cat)));
  const subByType = new Map();
  for (const s of summaryRows) {
    const cur = subByType.get(s.type) || { type: s.type, byPeriod: list.map(() => 0), budget: 0 };
    s.byPeriod.forEach((v, i) => { cur.byPeriod[i] += v; });
    cur.budget += s.budget;
    subByType.set(s.type, cur);
  }

  const budgets = content === 'full'
    ? list.map((p, i) => ({
      period: { key: p.key, name: p.name, title: p.title, start: p.start, end: p.end },
      rows: shown[i],
      subtotals: subtotalsOf(shown[i]),
      /* The period's own income/spend/uncategorised line is a statement about
         the WHOLE period. Under a category filter it would sit above a table
         it no longer describes, so it is withheld rather than mislabelled. */
      summary: only ? null : (p.summary || null),
    }))
    : [];

  const txSource = exact ? (exact.txs || []) : list.reduce((all, p) => all.concat(p.txs || []), []);
  const transactions = includeTx ? txSource.filter(t => !only || only.has(t.cat)) : null;

  const exactRows = exact ? (exact.rows || []).filter(r => keep(r.cat)) : null;

  const foreignSymbols = [...new Set(list.reduce((all, p) =>
    all.concat(((p.summary || {}).foreign || {}).symbols || []), []))];

  const first = list[0], last = list[list.length - 1];
  return {
    content: content === 'full' ? 'full' : 'summary',
    generated, currency: currency || '',
    filtered: !!only, categories: only ? [...only] : null,
    periods: list.map(p => ({ key: p.key, name: p.name, title: p.title, start: p.start, end: p.end })),
    /* A date-range export is named for its DATES: the periods that happen to
       end inside it are a consequence, and "March 2025 to February 2026" would
       claim a span the money in the file does not cover. */
    rangeLabel: exact ? `${exact.from} to ${exact.to}`
      : (!first ? '' : (list.length === 1 ? first.name : `${first.name} to ${last.name}`)),
    exact: exact ? {
      from: exact.from, to: exact.to, through: exact.through || exact.to,
      rows: exactRows, subtotals: subtotalsOf(exactRows),
      /* The ledger's own tally for the window — income, gross spend and what
         of it is uncategorised. Withheld under a category filter for the
         reason the period headline is: it describes money the table no longer
         shows. */
      totals: only ? null : (exact.summary || null),
      periodFrom: first ? first.start : null, periodTo: last ? last.end : null,
    } : null,
    inProgress: inProgress && list.some(p => p.key === inProgress) ? inProgress : null,
    summary: { rows: summaryRows, subtotals: [...subByType.values()].map(finish).sort((a, b) => rank(a.type) - rank(b.type)) },
    budgets, transactions, foreignSymbols,
  };
}

/* ---------------------------------- CSV ---------------------------------- */

/* Raw, two decimals, never through csvCell — exporter.js's amountCell argues
   this at length: csvCell's formula guard turns "-250.50" into "'-250.50",
   which a spreadsheet reads as text and every SUM silently skips. */
const num = v => (Number(v) || 0).toFixed(2);
const csvLines = (head, body) => [head.map(csvCell).join(','), ...body].join('\n') + '\n';

/* NO SUBTOTAL ROWS in either CSV. A CSV is pivot-table input; a "Total" line
   inside the data double-counts under the first SUM anyone writes over the
   column. The workbook and the PDF carry subtotals, because those are read by
   a person. `Currency` rides on every row for the reason exporter.js gives
   for its own: the caveat IS the number's unit, and the file outlives the app. */
function modelToCsv(model, { symbolFor } = {}) {
  const cur = model.currency;
  const files = [];
  if (model.exact) {
    /* From/To on every row, and To is `through`: the day the figure really
       runs to. A row that said 2027-02-28 in September 2026 would be claiming
       five months that have not happened. */
    files.push({
      kind: 'exact',
      text: csvLines(['Category', 'Type', 'Currency', 'From', 'To', 'Actual'],
        model.exact.rows.map(r => [csvCell(r.cat), csvCell(r.type || ''), csvCell(cur),
          csvCell(model.exact.from), csvCell(model.exact.through), num(r.actual)].join(','))),
    });
  }
  /* No period ends inside a short range: there is no summary to write, and an
     empty file with a header is a file someone will open expecting data. */
  if (!model.exact || model.periods.length) files.push({
    kind: 'summary',
    text: csvLines(
      ['Category', 'Type', 'Currency', ...model.periods.map(p => p.name), 'Total', 'Average', 'Budgeted'],
      model.summary.rows.map(r => [csvCell(r.cat), csvCell(r.type || ''), csvCell(cur),
        ...r.byPeriod.map(num), num(r.total), num(r.average), num(r.budget)].join(','))),
  });
  if (model.content === 'full') {
    const body = [];
    for (const b of model.budgets) {
      for (const r of b.rows) {
        body.push([csvCell(b.period.name), csvCell(b.period.start || ''), csvCell(b.period.end || ''),
          csvCell(r.cat), csvCell(r.type || ''), csvCell(cur),
          num(r.budget), num(r.actual), num(r.remaining), csvCell(r.notes || '')].join(','));
      }
    }
    files.push({
      kind: 'budget',
      text: csvLines(['Period', 'From', 'To', 'Category', 'Type', 'Currency', 'Budget', 'Actual', 'Remaining', 'Notes'], body),
    });
  }
  if (model.transactions) files.push({ kind: 'transactions', text: transactionsCsv(model.transactions, symbolFor) });
  return files;
}

/* -------------------------------- workbook -------------------------------- */

const LABELS = {
  title: 'Budget', titleSummary: 'Budget summary',
  category: 'Category', type: 'Type', total: 'Total', average: 'Average', budgeted: 'Budgeted',
  period: 'Period', from: 'From', to: 'To', budget: 'Budget', actual: 'Actual', remaining: 'Remaining', used: 'Used', notes: 'Notes',
  date: 'Date', description: 'Description', account: 'Account', currency: 'Currency', amount: 'Amount', flag: 'Flag',
  excluded: 'excluded', splitParent: 'split parent', splitPart: 'split part',
  subtotal: 'Total {type}',
  summaryHeading: 'Summary by category', transactionsHeading: 'Transactions',
  generated: 'Generated', range: 'Range', categories: 'Categories', allCategories: 'All categories',
  periodLine: 'Income {income} · Spent {spend}', periodUncat: ' · Uncategorised {uncat}',
  noteFilter: 'Only these categories are included: {list}. Totals cover the listed categories, not the whole budget.',
  noteForeign: 'Accounts in {list} are not included in any figure here — there is no exchange rate in this file to combine them with.',
  noteInProgress: '{period} is still in progress, so its figures are for part of a period and pull the average down.',
  noteWide: 'The month-by-month columns do not fit on a page for this many periods — the Excel and CSV exports carry every month.',
  noteTx: 'Excluded, transfer and split-parent rows are listed and flagged; they are not part of the budget figures above.',
  amountsIn: 'Amounts in {currency}.',
  noteNoBudget: 'No budget was set for this period, so these are actual figures only.',
  exactHeading: 'Actual by category · {from} to {to}',
  noteExact: 'These figures cover exactly {from} to {to}. The budget tables further on cover whole budget periods, {pfrom} to {pto} — every period ending inside the range — so their totals differ at the edges. Budgets are never split across a date.',
  noteExactOnly: 'These figures cover exactly {from} to {to}. No budget period ends inside this range, so there are no budget tables.',
  noteExactThrough: 'The range ends on {to}; the figures run through {through}, the day this was made.',
  sheetExact: 'Exact dates',
  sheetSummary: 'Summary', sheetBudget: 'Budget', sheetTransactions: 'Transactions', sheetAbout: 'About',
};
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const labelsOf = over => Object.assign({}, LABELS, over || {});

/* The caveats, as sentences, built ONCE for the two renderings a person reads.
   A document must carry what its on-screen twin prints beside the number —
   and the screen names held-out currencies, flags a part-period, and would
   never show a filtered total without the filter beside it. */
/* The two spans, in words. The whole risk of a date-range export is that the
   reader takes the budget tables for the tax year, or the exact figures for
   whole periods — so every rendering a person reads says which is which. */
function exactNotes(model, L) {
  const x = model.exact;
  if (!x) return [];
  const out = [x.periodFrom
    ? fill(L.noteExact, { from: x.from, to: x.through, pfrom: x.periodFrom, pto: x.periodTo })
    : fill(L.noteExactOnly, { from: x.from, to: x.through })];
  if (x.through !== x.to) out.push(fill(L.noteExactThrough, { to: x.to, through: x.through }));
  return out;
}

function caveats(model, L) {
  const out = [];
  if (model.filtered) out.push(fill(L.noteFilter, { list: model.categories.join(', ') }));
  if (model.foreignSymbols.length) out.push(fill(L.noteForeign, { list: model.foreignSymbols.join(', ') }));
  if (model.inProgress) {
    const p = model.periods.find(x => x.key === model.inProgress);
    out.push(fill(L.noteInProgress, { period: p ? p.name : model.inProgress }));
  }
  return out;
}

const txFlag = (t, L) => {
  const role = splitRole(t.split);
  if (role === 'parent') return L.splitParent;
  return [t.excluded ? L.excluded : '', role === 'part' ? L.splitPart : ''].filter(Boolean).join(', ');
};

/* Rows with each type's subtotal directly UNDER its group, as [{row}|{sub}].

   One block of subtotals after the rows was fine for a fixture with two types
   and unreadable for a household with seventeen: seventeen "Total …" lines a
   page away from the rows they total, the block itself split across a page
   break. A group of ONE gets no subtotal — the row is its own total, and
   printing it twice is how a seventeen-type table grew eleven lines that said
   nothing. Rows must arrive grouped by type, which buildModel and figures.js
   both guarantee. */
function grouped(rows, subtotals) {
  const out = [];
  const subOf = t => (subtotals || []).find(s => s.type === t);
  let run = 0;
  rows.forEach((r, i) => {
    out.push({ row: r });
    run++;
    const next = rows[i + 1];
    if (!next || next.type !== r.type) {
      if (run > 1 && subOf(r.type)) out.push({ sub: subOf(r.type) });
      run = 0;
    }
  });
  return out;
}

/* The Dashboard's rule for the Remaining cell (views/dashboard.js's budget
   table): printed when the row has a budget, or is an unbudgeted overspend —
   and BLANK otherwise. Without it an income row with no budget line printed
   "R -32 400,55 remaining" under a pay cheque, which reads as a loss. The CSV
   keeps the raw number: it is for a program, and a blank there is a zero. */
const showsRemaining = r => Number(r.budget) > 0 || !!r.unbudgeted;

/* Amounts are NUMBERS here, with a money style — never a formatted string. A
   string looks identical in the cell and sums to zero. Text cells go in
   verbatim: xlsx.js writes inline strings, which a spreadsheet never
   evaluates, so the quote prefix csvCell needs would only corrupt the name. */
function modelToSheets(model, { symbolFor, labels } = {}) {
  const L = labelsOf(labels);
  /* Rounded to cents on the way in. The model's sums are honest floating
     point — 0.1 + 0.2 + 0.3 is 0.6000000000000001 — and the money FORMAT hides
     that in the cell, but the formula bar does not, and neither does anyone's
     `=C2=D2`. The CSV has always rounded (toFixed(2)); this is the same figure. */
  const cents = v => Math.round((Number(v) || 0) * 100) / 100;
  const m = v => ({ v: cents(v), s: 'money' });
  const mb = v => ({ v: cents(v), s: 'moneyBold' });
  const head = cells => cells.map(v => ({ v, s: 'head' }));
  const sym = symbolFor || (() => '');

  const sumRows = [head([L.category, L.type, ...model.periods.map(p => p.name), L.total, L.average, L.budgeted])];
  for (const g of grouped(model.summary.rows, model.summary.subtotals)) {
    if (g.row) { const r = g.row; sumRows.push([r.cat, r.type || '', ...r.byPeriod.map(m), m(r.total), m(r.average), m(r.budget)]); }
    else { const t = g.sub; sumRows.push([{ v: fill(L.subtotal, { type: t.type || '' }), s: 'bold' }, '', ...t.byPeriod.map(mb), mb(t.total), mb(t.average), mb(t.budget)]); }
  }
  const sheets = [];
  if (model.exact) {
    const rows = [head([L.category, L.type, L.from, L.to, L.actual])];
    for (const g of grouped(model.exact.rows, model.exact.subtotals)) {
      if (g.row) rows.push([g.row.cat, g.row.type || '', model.exact.from, model.exact.through, m(g.row.actual)]);
      else rows.push([{ v: fill(L.subtotal, { type: g.sub.type || '' }), s: 'bold' }, '', '', '', mb(g.sub.actual)]);
    }
    sheets.push({ name: L.sheetExact, rows, freezeRows: 1, widths: [28, 12, 12, 12, 14] });
  }
  if (!model.exact || model.periods.length) {
    sheets.push({ name: L.sheetSummary, rows: sumRows, freezeRows: 1, widths: [28, 12, ...model.periods.map(() => 14), 14, 14, 14] });
  }

  if (model.content === 'full' && model.budgets.length) {
    const rows = [head([L.period, L.from, L.to, L.category, L.type, L.budget, L.actual, L.remaining, L.notes])];
    for (const b of model.budgets) {
      for (const r of b.rows) rows.push([b.period.name, b.period.start || '', b.period.end || '', r.cat, r.type || '', m(r.budget), m(r.actual), showsRemaining(r) ? m(r.remaining) : null, r.notes || '']);
    }
    sheets.push({ name: L.sheetBudget, rows, freezeRows: 1, widths: [18, 12, 12, 28, 12, 14, 14, 14, 40] });
  }
  if (model.transactions) {
    const rows = [head([L.date, L.description, L.account, L.category, L.currency, L.amount, L.flag, L.notes])];
    for (const t of model.transactions) rows.push([t.date, t.desc || '', t.label || '', t.cat || '', sym(t), m(t.amount), txFlag(t, L), t.note || '']);
    sheets.push({ name: L.sheetTransactions, rows, freezeRows: 1, widths: [12, 40, 18, 22, 9, 14, 14, 30] });
  }
  const about = [
    [{ v: model.content === 'full' ? L.title : L.titleSummary, s: 'bold' }],
    [L.range, model.rangeLabel],
    [L.generated, model.generated || ''],
    [L.currency, model.currency],
    [L.categories, model.filtered ? model.categories.join(', ') : L.allCategories],
    [],
    ...exactNotes(model, L).map(c => [c]),
    ...caveats(model, L).map(c => [c]),
    ...(model.transactions ? [[L.noteTx]] : []),
  ];
  sheets.push({ name: L.sheetAbout, rows: about, widths: [16, 60] });
  return sheets;
}

/* ---------------------------------- PDF ----------------------------------- */

/* The document pdf.js lays out. Strings only — every amount goes through the
   injected money() so the page reads in the household's own separators, the
   same reason exporter.js's markdown takes one. `rowMoney(amount, row)` is the
   per-row formatter for transactions, whose rows can be in another currency.

   Past PDF_MAX_PERIOD_COLS periods the month columns are dropped and the page
   SAYS so: pdf.js will shrink a table's type to fit, but fifteen money columns
   on A4 shrink past reading, and an "all" export can be sixty. */
function modelToDoc(model, { money, rowMoney, plainMoney, labels } = {}) {
  const L = labelsOf(labels);
  const fmt = money || (v => num(v));
  const rfmt = rowMoney || ((v) => fmt(v));
  const headline = t => fill(L.periodLine, { income: fmt(t.income), spend: fmt(t.spend) })
    + ((Number(t.uncatSpend) || 0) ? fill(L.periodUncat, { uncat: fmt(t.uncatSpend) }) : '');
  const wide = model.periods.length > PDF_MAX_PERIOD_COLS;
  const cols = wide ? [] : model.periods;
  const blocks = [];

  for (const c of caveats(model, L)) blocks.push({ type: 'note', text: c });

  if (model.exact) {
    blocks.push({ type: 'heading', text: fill(L.exactHeading, { from: model.exact.from, to: model.exact.through }) });
    for (const c of exactNotes(model, L)) blocks.push({ type: 'note', text: c });
    if (model.exact.totals) blocks.push({ type: 'note', text: headline(model.exact.totals) });
    const xRows = [], xBold = [];
    for (const g of grouped(model.exact.rows, model.exact.subtotals)) {
      if (g.row) xRows.push([g.row.cat, g.row.type || '', fmt(g.row.actual)]);
      else { xBold.push(xRows.length); xRows.push([fill(L.subtotal, { type: g.sub.type || '' }), '', fmt(g.sub.actual)]); }
    }
    blocks.push({ type: 'table', head: [L.category, L.type, L.actual], rows: xRows, boldRows: xBold, align: ['left', 'left', 'right'] });
  }
  const hasPeriods = !model.exact || model.periods.length > 0;
  if (wide) blocks.push({ type: 'note', text: L.noteWide });

  const head = [L.category, ...cols.map(p => p.name), L.total, L.average, L.budgeted];
  const rows = [], boldRows = [];
  /* The month-by-month table is up to fifteen money columns wide, and "R " in
     every one of two hundred cells cost it a font size and truncated the
     category names ("Discovery 32 Day notice sa…"). With a plain formatter
     handed in, the cells carry the number and the unit is said ONCE, above. */
  const cell = plainMoney || fmt;
  for (const g of grouped(model.summary.rows, model.summary.subtotals)) {
    const x = g.row || g.sub;
    if (g.sub) boldRows.push(rows.length);
    rows.push([g.row ? x.cat : fill(L.subtotal, { type: x.type || '' }),
      ...(wide ? [] : x.byPeriod.map(v => cell(v))), cell(x.total), cell(x.average), cell(x.budget)]);
  }
  if (hasPeriods) {
    blocks.push({ type: 'heading', text: L.summaryHeading });
    if (plainMoney && model.currency) blocks.push({ type: 'note', text: fill(L.amountsIn, { currency: model.currency }) });
    blocks.push({ type: 'table', head, rows, boldRows, align: head.map((h, i) => (i === 0 ? 'left' : 'right')) });
  }

  for (const b of model.budgets) {
    /* A page of its own. A real period table is forty-odd rows; begun two rows
       from the foot of the summary's last page it reads as two tables, and
       "where does March start" becomes a search. */
    blocks.push({ type: 'pagebreak' });
    blocks.push({ type: 'heading', text: b.period.title ? `${b.period.name} · ${b.period.title}` : b.period.name });
    if (b.summary) blocks.push({ type: 'note', text: headline(b.summary) });
    /* A period nobody budgeted. Row by row the Dashboard's rule calls every
       expense in it an unbudgeted overspend — right for one stray category,
       wrong for a whole month with no plan, where it printed forty negative
       "remaining" figures. Said once, and the column left blank. */
    const planned = b.rows.some(r => Number(r.budget) > 0);
    if (!planned && b.rows.length) blocks.push({ type: 'note', text: L.noteNoBudget });
    const rem = x => (planned && showsRemaining(x) ? fmt(x.remaining) : '');
    const tRows = [], bold = [];
    for (const g of grouped(b.rows, b.subtotals)) {
      if (g.row) {
        const r = g.row;
        tRows.push([r.cat, r.type || '', fmt(r.budget), fmt(r.actual), rem(r),
          Number(r.budget) > 0 ? `${Math.round((Number(r.actual) || 0) / Number(r.budget) * 100)}%` : '']);
      } else {
        const t = g.sub;
        bold.push(tRows.length);
        tRows.push([fill(L.subtotal, { type: t.type || '' }), '', fmt(t.budget), fmt(t.actual), rem(t), '']);
      }
    }
    blocks.push({
      type: 'table', head: [L.category, L.type, L.budget, L.actual, L.remaining, L.used], rows: tRows, boldRows: bold,
      align: ['left', 'left', 'right', 'right', 'right', 'right'],
    });
  }

  if (model.transactions) {
    blocks.push({ type: 'heading', text: L.transactionsHeading });
    blocks.push({ type: 'note', text: L.noteTx });
    blocks.push({
      type: 'table', head: [L.date, L.description, L.account, L.category, L.amount, L.flag], boldRows: [],
      rows: model.transactions.map(t => [t.date, t.desc || '', t.label || '', t.cat || '', rfmt(t.amount, t), txFlag(t, L)]),
      align: ['left', 'left', 'left', 'left', 'right', 'left'],
      weights: [1.1, 3.2, 1.6, 1.8, 1.5, 1.2],
    });
  }

  return {
    title: model.content === 'full' ? L.title : L.titleSummary,
    subtitle: [model.rangeLabel, `${L.generated} ${model.generated || ''}`.trim()].filter(Boolean).join(' · '),
    footer: [model.content === 'full' ? L.title : L.titleSummary, model.rangeLabel].filter(Boolean).join(' · '),
    landscape: cols.length >= PDF_LANDSCAPE_FROM,
    blocks,
  };
}

/* ------------------------------- file names -------------------------------- */

/* Named by WHAT IS IN THEM — exportPaths()'s own rule — so re-exporting the
   same selection overwrites rather than accumulating "Budget (3).pdf". Which
   is exactly why content and filter are part of the name: a filtered summary
   that overwrote last week's full export would be that rule turned into data
   loss. Literal English words, never i18n: views/report.js's filenameLabel
   explains how a translated "to" made the same selection land on two paths. */
/* djb2 over the sorted names, base 36. Not a security hash: it only has to make
   "these four" and "those four" different file names, deterministically, in
   every engine — so no crypto.subtle (async) and no Node crypto. */
function pickTag(sortedCats) {
  let h = 5381;
  for (const ch of sortedCats.join('\u0000')) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36).padStart(4, '0');
}

function budgetExportPaths(model, folder) {
  const dir = String(folder || EXPORT_DIR).split('/')
    .filter(seg => seg.trim() && !/^\.+$/.test(seg.trim()))
    .map(safeName).join('/') || EXPORT_DIR;
  /* Which categories, not merely THAT there is a filter: "(selected
     categories)" would let an export of Groceries silently overwrite last
     week's export of Fuel. Up to three are named; past that the name counts
     them, because a file name has a length limit and a category list does not.
     The count alone is not enough — two different picks of four would share a
     path, and one would silently overwrite the other — so it carries a short
     tag of WHICH ones, over the SORTED list so the same pick ticked in another
     order still lands on, and replaces, its own earlier file. */
  const cats = (model.categories || []).slice().sort();
  const filterTag = !model.filtered ? ''
    : (cats.length && cats.length <= 3 ? `(${cats.join(', ')})` : `(${cats.length} categories ${pickTag(cats)})`);
  const name = safeName([
    model.content === 'full' ? 'Budget' : 'Budget summary',
    model.rangeLabel,
    filterTag,
  ].filter(Boolean).join(' '));
  const base = `${dir}/${name}`;
  return {
    dir, base,
    pdf: `${base}.pdf`,
    xlsx: `${base}.xlsx`,
    csv: { exact: `${base} - Exact dates.csv`, summary: `${base} - Summary.csv`, budget: `${base} - Budget.csv`, transactions: `${base} - Transactions.csv` },
  };
}

module.exports = {
  RANGE_KEYS, PDF_MAX_PERIOD_COLS, LABELS,
  exportPeriods, periodsEndingIn, datePresets, buildModel, modelToCsv, modelToSheets, modelToDoc, budgetExportPaths,
};
