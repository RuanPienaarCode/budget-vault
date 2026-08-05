'use strict';
/* loadVault — reads every budget file into the in-memory state S. */

const { TFile } = require('obsidian');
const { TYPE_ORDER } = require('./constants');
const { parseFrontmatter, parseMdTable, parseCsv, unescMd, parseNum, safeSeg } = require('./util');

module.exports = function registerLoad(ctx) {
  const { S, vault, readFile, mdFilesIn, subfoldersIn, currentPeriod } = ctx;

  async function loadVault() {
    const settingsTxt = await readFile('Settings.md');
    if (settingsTxt) {
      const { fm } = parseFrontmatter(settingsTxt);
      if (fm.month_start_day) {
        // Clamp 1–28 even for hand-edited files: 29–31 skews period lengths and
        // misassigns rolled-over days (the settings UI already clamps).
        const n = parseInt(fm.month_start_day, 10) || 23;
        S.settings.month_start_day = Math.min(28, Math.max(1, n));
      }
      /* Pay cycle. An unknown or absent type is a payday month, so a vault that
         has never heard of this setting behaves exactly as it always did. An
         interval type without an anchor has no way to place a boundary, so it
         falls back to monthly rather than deriving periods from a missing date. */
      const type = (fm.period_type || 'monthly').toString().trim().toLowerCase();
      const anchor = (fm.period_anchor || '').toString().trim();
      const anchorOk = /^\d{4}-\d{2}-\d{2}$/.test(anchor);
      S.settings.period_type = (type !== 'monthly' && anchorOk) ? type : 'monthly';
      S.settings.period_anchor = anchorOk ? anchor : '';
      if (fm.currency) S.settings.currency = fm.currency;
      // Country code (za/us/uk/…) — localeFor falls back to za for unknown
      // values, so a hand-edited Settings.md can't break the app.
      S.settings.country = (fm.country || 'za').toString().trim().toLowerCase();
      S.settings.household = fm.household || '';
    }
    /* Reads go out in parallel; parsing stays serial. Every loop below used to
       await one file at a time — ~163 sequential round trips on a real vault,
       and on mobile each one crosses the Capacitor bridge (an iCloud-backed
       file may have to be materialised first). Parsing all 5,700 transactions
       measures ~7ms, so the wait was almost entirely I/O latency. Ordering and
       results are unchanged: `read` keeps each file paired with its own text. */
    const read = async files => {
      const texts = await Promise.all(files.map(f => vault.cachedRead(f)));
      return files.map((file, i) => ({ file, text: texts[i] }));
    };

    S.categories = [];
    for (const { file, text } of await read(mdFilesIn('Categories'))) {
      const { fm } = parseFrontmatter(text);
      // Prefer the exact name from frontmatter — filenames drop filesystem-illegal
      // chars, so the frontmatter `name` is the source of truth.
      S.categories.push({ name: fm.name || file.basename, type: fm.type || 'expense', color: fm.color || '#888' });
    }
    S.categories.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));

    S.accounts = [];
    for (const { file: f, text: acctText } of await read(mdFilesIn('Accounts'))) {
      const { fm, body, raw } = parseFrontmatter(acctText);
      S.accounts.push({
        name: f.basename,
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        type: fm.type || 'other', institution: fm.institution || '',
        account_number: fm.account_number || '', tx_label: fm.tx_label || '',
        // parseNum, not parseFloat: a hand-edited "1,234.56" read as 1 would be
        // written straight back as 1.00 on the next balance edit, destroying the
        // real figure. balanceRaw preserves anything the strict parse rejected,
        // exactly as amountRaw does for transaction cells.
        ...(bal => ({ balance: bal.value, balanceRaw: bal.ok ? null : bal.raw }))(parseNum(fm.balance || '0')),
        balance_updated: fm.balance_updated || '',
        // `budget: false` opts an account out of the household budget totals —
        // an investment or tax-free wrapper whose interest is not income and
        // whose debit orders are not spending. Absent means IN, so no existing
        // vault's Dashboard figures move on upgrade. The money still leaving
        // the cheque account is budgeted as normal; only the arriving leg here
        // is suppressed, which is what stops it being counted twice.
        in_budget: !/^(false|no|off|0)$/i.test(String(fm.budget ?? '').trim()),
        credit_limit: fm.credit_limit ? parseFloat(fm.credit_limit) : null,
        goal_amount: fm.goal_amount ? parseFloat(fm.goal_amount) : null,
        target_date: fm.target_date || '',
        monthly_contribution: fm.monthly_contribution ? parseFloat(fm.monthly_contribution) : null,
        total_invested: fm.total_invested ? parseFloat(fm.total_invested) : null,
        starting_amount: fm.starting_amount ? parseFloat(fm.starting_amount) : null,
        inception_date: fm.inception_date || '',
        tags: fm.tags || '',
        body,
      });
    }
    S.accounts.sort((a, b) => a.name.localeCompare(b.name));

    S.budgets = {};
    S.budgetMeta = {};
    /* Both period-name shapes load side by side. A vault that has switched
       between monthly and interval periods keeps both sets of files, and the
       one the active period type can't address simply never gets asked for —
       nothing is deleted, so switching back finds them where they were. */
    for (const { file: f, text } of await read(mdFilesIn('Budgets').filter(f => /^\d{4}-\d{2}(-\d{2})?$/.test(f.basename)))) {
      const period = f.basename;
      const { raw } = parseFrontmatter(text);
      S.budgetMeta[period] = { raw };   // verbatim frontmatter for lossless write-back
      const rows = parseMdTable(text);
      S.budgets[period] = rows.slice(1).map(c => {
        const amt = parseNum(c[2]);
        return { category: unescMd(c[0]), type: c[1] || '', amount: amt.value, amountRaw: amt.ok ? null : amt.raw, notes: unescMd(c[3] || '') };
      });
    }

    S.txFiles = {};
    // Flattened first so every month file across every account goes out in one
    // batch — this is the bulk of the read count on a real vault.
    const txFiles = [];
    for (const acct of subfoldersIn('Transactions')) {
      for (const f of acct.children) {
        if (!(f instanceof TFile) || f.extension !== 'md' || !/^\d{4}-\d{2}$/.test(f.basename)) continue;
        txFiles.push({ acct, f });
      }
    }
    const txTexts = await Promise.all(txFiles.map(({ f }) => vault.cachedRead(f)));
    txFiles.forEach(({ acct, f }, i) => {
      const month = f.basename;
      const text = txTexts[i];
      const { raw } = parseFrontmatter(text);
      const rows = parseMdTable(text);
      S.txFiles[`${acct.name}/${month}`] = {
        label: acct.name, month, dirty: false, fmRaw: raw,
        rows: rows.slice(1).map(c => {
          const amt = parseNum(c[3]);
          return { date: c[0], desc: unescMd(c[1]), cat: unescMd(c[2]),
            amount: amt.value, amountRaw: amt.ok ? null : amt.raw,
            excluded: (c[4] || '').toLowerCase() === 'yes', note: unescMd(c[5] || '') };
        }),
      };
    });

    S.rules = [];
    const rulesCsv = await readFile('Data/Categorisation Rules.csv');
    if (rulesCsv) for (const row of parseCsv(rulesCsv).slice(1)) {
      if (row.length >= 2 && row[0]) S.rules.push({ pattern: row[0], category: row[1] });
    }

    S.owed = []; S.owedDirty = false;
    const owedTxt = await readFile('Owed Money.md');
    // Keep the file's own frontmatter verbatim (tags etc.) for write-back.
    S.owedFm = (owedTxt && parseFrontmatter(owedTxt).raw) || 'kind: owed';
    if (owedTxt) for (const c of parseMdTable(owedTxt).slice(1)) {
      if (!c[0]) continue;
      S.owed.push({
        person: unescMd(c[0]), amount: parseFloat(c[1]) || 0, description: unescMd(c[2] || ''),
        due: (c[3] || '').trim(), status: (c[4] || 'outstanding').trim().toLowerCase() === 'paid' ? 'paid' : 'outstanding',
      });
    }

    S.debts = []; S.debtsDirty = false;
    const debtTxt = await readFile('Debts.md');
    S.debtsFm = (debtTxt && parseFrontmatter(debtTxt).raw) || 'kind: debts';
    if (debtTxt) for (const c of parseMdTable(debtTxt).slice(1)) {
      if (!c[0]) continue;
      // Money columns go through parseNum so a hand-edited "1 234,56" is read
      // rather than silently truncated to 1 — same reasoning as account
      // balances above. Unlike those there is no *Raw write-back here: every
      // figure in this table is arithmetic input (the payoff maths cannot run
      // on a string), so a rejected cell falls back to 0 and is rewritten
      // canonically rather than being preserved verbatim.
      const num = (v, min = 0) => Math.max(min, parseNum(v || '0').value || 0);
      const balance = num(c[3]);
      S.debts.push({
        name: unescMd(c[0]), lender: unescMd(c[1] || ''), type: unescMd(c[2] || 'other'),
        balance,
        // Absent on a file written before this column existed, and on a debt
        // added without one — fall back to the balance so the "paid off" bar
        // reads 0% rather than dividing by zero.
        original: c[4] !== undefined && c[4] !== '' ? num(c[4]) : balance,
        rate: num(c[5]), payment: num(c[6]), extra: num(c[7]),
        start: (c[8] || '').trim(), category: unescMd(c[9] || ''),
        status: (c[10] || 'active').trim().toLowerCase() === 'paid' ? 'paid' : 'active',
        notes: unescMd(c[11] || ''),
      });
    }

    S.services = []; S.servicesDirty = false;
    const svcTxt = await readFile('Services.md');
    S.servicesFm = (svcTxt && parseFrontmatter(svcTxt).raw) || 'kind: services';
    if (svcTxt) for (const c of parseMdTable(svcTxt).slice(1)) {
      if (!c[0]) continue;
      S.services.push({
        name: unescMd(c[0]), provider: unescMd(c[1] || ''), amount: parseFloat(c[2]) || 0,
        cycle: (c[3] || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly',
        next: (c[4] || '').trim(), category: unescMd(c[5] || ''),
        active: (c[6] || 'yes').trim().toLowerCase() !== 'no', notes: unescMd(c[7] || ''),
      });
    }
    S.tax = {}; S.taxDirty = false;
    for (const { file: f, text } of await read(mdFilesIn('Tax').filter(f => /^\d{4}$/.test(f.basename)))) {
      const { fm, raw, body } = parseFrontmatter(text);
      // The body holds three tables under "## Progress", "## Documents" and
      // "## Figures". parseMdTable reads every table row in the text it's
      // given, so slice the body by heading first and parse each on its own.
      const section = (name) => {
        for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
          if (chunk.trim().toLowerCase().startsWith(name)) return chunk;
        }
        return '';
      };
      const stepStatus = s => {
        const t = (s || '').trim().toLowerCase().replace(/[-\s]/g, '');
        return ['todo', 'busy', 'done', 'n/a', 'na'].includes(t) ? (t === 'na' ? 'n/a' : t) : 'todo';
      };
      const docStatus = s => {
        const t = (s || '').trim().toLowerCase().replace(/[-\s]/g, '');
        return t === 'uploaded' ? 'uploaded' : (t === 'n/a' || t === 'na') ? 'n/a' : 'needed';
      };
      // Figures are written as raw numbers, but a hand-edited file may carry a
      // currency symbol or either separator convention — coerce rather than
      // throw, mirroring how stepStatus falls back instead of failing.
      const figAmount = s => {
        const t = (s || '').toString().replace(/[^\d.,-]/g, '');
        if (!t) return 0;
        const norm = t.lastIndexOf(',') > t.lastIndexOf('.')
          ? t.replace(/\./g, '').replace(',', '.')   // 1.234,56 / 1 234,56
          : t.replace(/,/g, '');                     // 1,234.56 / 1234.56
        const n = Number(norm);
        return Number.isFinite(n) ? n : 0;
      };
      const signedNum = v => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(String(v).replace(/[^\d.-]/g, ''));
        return Number.isFinite(n) ? n : null;
      };
      S.tax[f.basename] = {
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        taxpayer_type: ['provisional', 'standard'].includes(fm.taxpayer_type) ? fm.taxpayer_type : 'unknown',
        assessment: ['auto-assessed', 'submit-requested', 'assessed'].includes(fm.assessment) ? fm.assessment : 'unknown',
        deadline_standard: fm.deadline_standard || '',
        deadline_provisional: fm.deadline_provisional || '',
        // Assessment outcome — only meaningful once `assessment` is 'assessed'.
        // Result is signed the way tax authorities print it: negative = refund.
        assessment_date: fm.assessment_date || '',
        assessment_ref: fm.assessment_ref || '',
        assessment_result: signedNum(fm.assessment_result),
        assessment_income: signedNum(fm.assessment_income),
        steps: parseMdTable(section('progress')).slice(1).filter(c => c[0]).map(c => ({
          step: unescMd(c[0]), status: stepStatus(c[1]), due: (c[2] || '').trim(), notes: unescMd(c[3] || ''),
        })),
        docs: parseMdTable(section('documents')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), source: unescMd(c[1] || ''), status: docStatus(c[2]),
          file: unescMd(c[3] || ''), notes: unescMd(c[4] || ''),
        })),
        // Absent on every page written before the Figures table existed — an
        // empty list keeps those loading unchanged.
        figures: parseMdTable(section('figures')).slice(1).filter(c => c[0]).map(c => ({
          code: unescMd(c[0]), description: unescMd(c[1] || ''),
          source: unescMd(c[2] || ''), amount: figAmount(c[3]),
        })),
      };
    }
    if (!S.taxYear || !S.tax[S.taxYear]) S.taxYear = Object.keys(S.tax).sort().pop() || null;

    // Prior-year certificates often land in Tax/<year>/ before anyone creates
    // the matching page, leaving the folder invisible to the view. Surface the
    // orphans so the Tax page can offer to seed a page for them.
    S.taxOrphanYears = subfoldersIn('Tax')
      .map(f => f.name).filter(n => /^\d{4}$/.test(n) && !S.tax[n]).sort();

    if (!S.period) S.period = currentPeriod();
  }

  /* Resolve an account label to the exact folder segment to key by AND write
     to. Both must be the same string: S.txFiles is keyed by the folder name as
     it exists on disk, so a writer that re-sanitises the label can miss the
     lookup while the write still lands on the existing file — rebuilding that
     month from scratch with only the new rows.

     A folder that already exists wins verbatim. Re-sanitising it would create a
     second, near-identical folder and split the account in half; and the name
     is self-evidently legal, because the filesystem is already holding it. Only
     a label that has never been written gets sanitised into a new segment. */
  function txSegment(label) {
    const want = safeSeg(label);
    for (const f of Object.values(S.txFiles)) {
      if (f.label === label || safeSeg(f.label) === want) return f.label;
    }
    return want;
  }

  ctx.provide({ loadVault, txSegment });
};
