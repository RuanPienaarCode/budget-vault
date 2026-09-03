'use strict';
/* loadVault — reads every budget file into the in-memory state S. */

const { TFile } = require('obsidian');
const { TYPE_ORDER, overspendLag, emergencyTarget, inputMode } = require('./constants');
const { periodDaysOrZero } = require('./dates');
const { parseNum, normalizeAmount } = require('./amount');
const { normalizeCode, normalizeCadence } = require('./fx');
const { parseFrontmatter, parseMdTable, unescMd } = require('./markdown');
const { parseCsv } = require('./csv');
/* One declaration per flat table drives this loader's reads AND the views'
   writes — ADR-0003. The generic reader is called here ONLY; downstream
   consumers of transaction rows still go through tx-role.js. */
const { SCHEMAS, rowToObject } = require('./table-schema');
const { setLanguage, defaultLanguage } = require('./i18n');
const { safeSeg } = require('./vault-path');
const { isRealIsoDate } = require('./dates');
const { parseOwners } = require('./owners');
const { parseGroups, parseNonEssential, typeOrder, typeRank } = require('./groups');
const { NOTES_DIR, parseNote, sortNotes } = require('./note-file');

/* ADR-0007 · fmNum: absent or unreadable is null, never 0. NOT parseNum — its fallback
   of 0 is a figure the file never claimed. */
function fmNum(v) {
  const s = (v ?? '').toString().trim();
  return s ? normalizeAmount(s) : null;
}

/* ADR-0007 · Heading slice before parseMdTable. The chunk under one `## Heading`,
   lower-cased and prefix-matched; the one definition Plans and Tax share. */
function section(body, name) {
  for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
    if (chunk.trim().toLowerCase().startsWith(name)) return chunk;
  }
  return '';
}

/* ADR-0007 · fmBool is tri-state. absent → undefined, written → true/false,
   unreadable → undefined (never false). */
function fmBool(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (!s) return undefined;
  if (/^(true|yes|on|1)$/.test(s)) return true;
  if (/^(false|no|off|0)$/.test(s)) return false;
  return undefined;
}

module.exports = function registerLoad(ctx) {
  const { S, vault, readFile, mdFilesIn, mdFilesUnder, subfoldersIn, currentPeriod, periodKeyValid, relPath } = ctx;

  /* ADR-0007 · Reads in parallel, parsing serial. The wait is I/O round trips, not work.
     ADR-0007 · read() is declared where loadNotes can reach it. Not inside loadVault. */
  const read = async files => {
    const texts = await Promise.all(files.map(f => vault.cachedRead(f)));
    return files.map((file, i) => ({ file, text: texts[i] }));
  };

  /* ADR-0007 · loadVault is single-flight. Overlapping loads duplicate the array sections;
     one latch joins a load already in flight instead of restarting it. */
  let loadInFlight = null;
  function loadVault() {
    if (!loadInFlight) {
      loadInFlight = doLoadVault().finally(() => { loadInFlight = null; });
    }
    return loadInFlight;
  }

  async function doLoadVault() {
    const settingsTxt = await readFile('Settings.md');
    if (settingsTxt) {
      const { fm } = parseFrontmatter(settingsTxt);
      if (fm.month_start_day) {
        // Clamp 1–28 even for hand-edited files: 29–31 skews period lengths and
        // misassigns rolled-over days (the settings UI already clamps).
        const n = parseInt(fm.month_start_day, 10) || 23;
        S.settings.month_start_day = Math.min(28, Math.max(1, n));
      }
      /* ADR-0007 · Pay cycle is a length in days with an anchor. Absent means payday months;
         a cycle without an anchor is dropped with it. */
      /* A real date, not merely a date-SHAPED string — the same test period.js
         gates the cycle on. A shape check accepted 2026-13-45 and stored the
         pair, while period.js refused it and ran payday months, so the settings
         screen sat there showing a cycle the app was not running. */
      const anchor = (fm.period_anchor || '').toString().trim();
      const anchorOk = isRealIsoDate(anchor);
      S.settings.period_days = anchorOk ? periodDaysOrZero(fm.period_days) : 0;
      S.settings.period_anchor = anchorOk ? anchor : '';
      if (fm.currency) S.settings.currency = fm.currency;
      /* ADR-0007 · Exchange rates are opt-in and normalised to a boolean. ISSUE 30 — absent
         means off: zero network requests. */
      S.settings.exchange_rates = String(fm.exchange_rates ?? '').trim().toLowerCase() === 'on';
      /* ADR-0007 · rate_refresh defaults to daily and is normalised. Through fx.normalizeCadence,
         so a hand-edited `hourly` falls back. */
      S.settings.rate_refresh = normalizeCadence(fm.rate_refresh);
      /* The ISO code the rate lookup asks for. The `currency` symbol above is
         what gets PRINTED; this says which currency that symbol means, because
         "$" is four of them. Blank is a complete answer — it just means rates
         cannot be fetched. */
      S.settings.currency_code = normalizeCode(fm.currency_code);
      // Country code (za/us/uk/…) — localeFor falls back to za for unknown
      // values, so a hand-edited Settings.md can't break the app.
      S.settings.country = (fm.country || 'za').toString().trim().toLowerCase();
      /* ADR-0007 · Language is independent of country. Absent follows Obsidian's display
         language; an unknown value falls back to English. */
      S.settings.language = setLanguage(fm.language || defaultLanguage());
      /* ADR-0007 · input_mode defaults to csv and is assigned unconditionally. inputMode() in
         constants.js is the one normaliser. */
      S.settings.input_mode = inputMode(fm.input_mode);
      S.settings.household = fm.household || '';
      /* The people the household's accounts can belong to. Absent means "one
         person", which is what every vault written before this key existed
         says — and the Accounts page then hides the owner controls entirely
         rather than offering a question with one possible answer. */
      S.settings.owners = parseOwners(fm.owners);
      /* The household's own category groups and which groups the emergency
         maths may drop — see src/groups.js for the shape and the rules. Both
         absent means the built-in types only, which is what every vault
         written before these keys existed says. */
      S.settings.groups = parseGroups(fm.groups);
      S.settings.nonessential_groups = parseNonEssential(fm.nonessential_groups, S.settings.groups);
      /* ADR-0007 · overspend_lag is clamped to 1–12. A credit card settles a month in arrears;
         0 would read a deficit that is still growing. */
      S.settings.overspend_lag = overspendLag(fm.overspend_lag);
      /* ADR-0007 · emergency_target_months is assigned unconditionally. The clamp lives in
         constants.js beside the settings tab's. */
      S.settings.emergency_target_months = emergencyTarget(fm.emergency_target_months);
    }
    S.categories = [];
    for (const { file, text } of await read(mdFilesIn('Categories'))) {
      const { fm } = parseFrontmatter(text);
      // Prefer the exact name from frontmatter — filenames drop filesystem-illegal
      // chars, so the frontmatter `name` is the source of truth.
      S.categories.push({
        name: fm.name || file.basename, type: fm.type || 'expense', color: fm.color || '#888',
        /* ADR-0007 · type_stated: an absent type is not an answer. `type` defaults to expense;
           ISSUE 32's pairing rule must not read the default as a statement. */
        type_stated: String(fm.type ?? '').trim() !== '',
        /* ADR-0007 · assume_spent: a category whose budget is its actual spend. The money left
           last period; fmBool, so unreadable is unset; `rel` below carries the path. */
        assumeSpent: fmBool(fm.assume_spent) === true,
        /* ADR-0007 · fixed is its own flag, not derived from type. Rent is an ordinary expense
           (19.9% vs 44.4% of income committed). */
        fixed: fmBool(fm.fixed) === true,
        /* ADR-0007 · interest marks income a fund itself earned. ITEM 2 (2026-08-26); opt-in,
           read by savings-math.js's classifyRow. */
        interest: fmBool(fm.interest) === true,
        /* Budget-folder-relative, because that is the currency readFile and
           writeFile deal in — file.path is absolute within the vault and would
           be re-prefixed by relPath into a path that does not exist. */
        rel: `Categories/${file.name}`,
      });
    }
    const order = typeOrder(S.settings.groups);
    S.categories.sort((a, b) => typeRank(a.type, order) - typeRank(b.type, order) || a.name.localeCompare(b.name));

    S.accounts = [];
    /* ADR-0007 · Nested account files are named, not loaded. ISSUE 60: every write site
       addresses Accounts/<name>.md, so loading them would fork the file on the next save. */
    const nested = mdFilesUnder('Accounts')
      .filter(f => f.path.slice(0, f.path.lastIndexOf('/')) !== relPath('Accounts'));
    S.accountsIgnored = nested.map(f => f.path);
    /* ADR-0007 · Two accounts claiming one transaction folder. ISSUE 72: keyed the way
       accountForLabel keys; filled after the accounts loop below. */
    S.accountsDuplicated = [];
    for (const { file: f, text: acctText } of await read(mdFilesIn('Accounts'))) {
      const { fm, body, raw } = parseFrontmatter(acctText);
      S.accounts.push({
        name: f.basename,
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        type: fm.type || 'other', institution: fm.institution || '',
        account_number: fm.account_number || '', tx_label: fm.tx_label || '',
        /* Which member of the household this account belongs to — a name from
           Settings.md's `owners:` line, the reserved word `joint`, or absent.
           Kept verbatim rather than matched against the declared list here:
           owners.js owns what the value means, so an owner since removed from
           the settings line keeps its account instead of quietly losing it. */
        owner: String(fm.owner || '').trim(),
        /* The symbol this account's OWN figures are printed in. Absent means
           the household's, so no existing vault renders differently on
           upgrade. It never converts and never excludes — see currency.js. */
        currency: String(fm.currency || '').trim(),
        /* ADR-0007 · currency_code is read at load. "$" is four currencies; absent means
           not convertible (docs/adr/0004). */
        currency_code: normalizeCode(fm.currency_code),
        /* ADR-0007 · currency_conflict is decided at load. A home symbol with a foreign code was
           HOME to currency.js and FOREIGN to fx.js (R1 000 vs R17 985,61); flagged here, where
           both halves are in scope, only for the contradictory case. */
        ...(((sym, code) => {
          const home = String(S.settings.currency || '').trim();
          const homeCode = normalizeCode(S.settings.currency_code);
          const claimsHome = !sym || sym === home;
          return (claimsHome && code && homeCode && code !== homeCode)
            ? { currency_conflict: { symbol: sym || home, code, homeCode } }
            : {};
        })(String(fm.currency || '').trim(), normalizeCode(fm.currency_code))),
        /* Warnings this account has been told to stay quiet about — `true`, or
           a list like [no-transactions, unconfirmed]. Kept as the raw string;
           acct-status.js owns what the words mean, so there is one parser
           rather than one here and another there. */
        ignore_warnings: String(fm.ignore_warnings || '').trim(),
        // parseNum, not parseFloat: a hand-edited "1,234.56" read as 1 would be
        // written straight back as 1.00 on the next balance edit, destroying the
        // real figure. balanceRaw preserves anything the strict parse rejected,
        // exactly as amountRaw does for transaction cells.
        ...(bal => ({ balance: bal.value, balanceRaw: bal.ok ? null : bal.raw }))(parseNum(fm.balance || '0')),
        balance_updated: fm.balance_updated || '',
        /* ADR-0007 · budget: false opts an account out; absent means in. So no vault's figures
           move on upgrade. */
        in_budget: !/^(false|no|off|0)$/i.test(String(fm.budget ?? '').trim()),
        /* ADR-0007 · in_budget_stated: an absent key is not consent. ISSUE 41: the earmark
           rule in period.js needs the difference. */
        in_budget_stated: String(fm.budget ?? '').trim() !== '',
        /* A card the household clears in full before interest. Its outstanding
           balance is money already spent that has not left the cheque account
           yet, so it counts as committed rather than as negative cash.
           `settle_day` narrows WHEN; it is optional and only ever narrows. */
        settle_monthly: /^(true|yes|on|1)$/i.test(String(fm.settle_monthly ?? '').trim()),
        settle_day: fmNum(fm.settle_day),
        /* ADR-0007 · Account numbers go through fmNum, never parseFloat. Every one is
           written back by saveAccount's FM_WRITERS. */
        credit_limit: fmNum(fm.credit_limit),
        /* ADR-0007 · emergency_fund is tri-state. true (whole balance), a number (that slice),
           null (never asked, or unreadable). */
        emergency_fund: (v => {
          if (fmBool(v) === true) { return true; }
          const n = fmNum(v);
          return n !== null && n > 0 ? n : null;
        })(fm.emergency_fund),
        goal_amount: fmNum(fm.goal_amount),
        target_date: fm.target_date || '',
        monthly_contribution: fmNum(fm.monthly_contribution),
        total_invested: fmNum(fm.total_invested),
        starting_amount: fmNum(fm.starting_amount),
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
    /* ADR-0007 · The undo receipt is cleared beside the state it depends on. It holds
       references to the rows just replaced. */
    S.lastImport = null;
    /* ADR-0007 · Every Transactions/ folder is recorded. S.txFiles is keyed per month
       file and cannot see an empty folder. */
    {
      const seen = new Map();
      for (const a of S.accounts) {
        const key = safeSeg(a.tx_label || a.name).toLowerCase();
        if (seen.has(key)) S.accountsDuplicated.push({ label: a.tx_label || a.name, first: seen.get(key), second: a.name });
        else seen.set(key, a.name);
      }
    }
    S.txFolders = [];
    // Flattened first so every month file across every account goes out in one
    // batch — this is the bulk of the read count on a real vault.
    const txFiles = [];
    for (const acct of subfoldersIn('Transactions')) {
      S.txFolders.push(acct.name);
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
        /* The Split column was added after these files started being written —
           absent on every row of every file that predates it, which the
           schema's read yields as '' exactly as it reads a blank cell. The
           truncation sweep in tests/table-schema-guards.test.cjs holds that
           property for every column, current and future. */
        rows: rows.slice(1).map(c => rowToObject(SCHEMAS.transactions, c)),
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
      S.owed.push(rowToObject(SCHEMAS.owed, c));
    }

    S.debts = []; S.debtsDirty = false;
    const debtTxt = await readFile('Debts.md');
    S.debtsFm = (debtTxt && parseFrontmatter(debtTxt).raw) || 'kind: debts';
    if (debtTxt) for (const c of parseMdTable(debtTxt).slice(1)) {
      if (!c[0]) continue;
      const d = rowToObject(SCHEMAS.debts, c);
      /* post() — the one fix-up a single cell cannot express (ADR-0003).
         Original is null when absent: a file written before the column
         existed, or a debt added without one. Fall back to the balance so
         the "paid off" bar reads 0% rather than dividing by zero. */
      /* ADR-0007 · A debt's original falls back for arithmetic only. ISSUE 68: originalStated
         lets the writer put the cell back empty. */
      if (d.original === null) { d.original = d.balance; d.originalStated = false; }
      else { d.originalStated = true; }
      S.debts.push(d);
    }

    /* Assets — what the household owns that is not an account. Columns,
       defaults and the strict-parse rules live in table-schema.js (ADR-0003):
       one declaration drives this read and the view's write. */
    S.assets = []; S.assetsDirty = false;
    const assetTxt = await readFile('Assets.md');
    S.assetsFm = (assetTxt && parseFrontmatter(assetTxt).raw) || 'kind: assets';
    if (assetTxt) for (const c of parseMdTable(assetTxt).slice(1)) {
      if (!c[0]) continue;
      S.assets.push(rowToObject(SCHEMAS.assets, c));
    }

    S.services = []; S.servicesDirty = false;
    const svcTxt = await readFile('Services.md');
    S.servicesFm = (svcTxt && parseFrontmatter(svcTxt).raw) || 'kind: services';
    if (svcTxt) for (const c of parseMdTable(svcTxt).slice(1)) {
      if (!c[0]) continue;
      S.services.push(rowToObject(SCHEMAS.services, c));
    }
    /* ADR-0007 · Plans: one file per plan, sliced by heading. The section names are
       load-bearing (plan.js writes them). */
    S.plans = {}; S.planDirty = false;
    for (const { file: f, text } of await read(mdFilesIn('Plans'))) {
      const { fm, raw, body } = parseFrontmatter(text);
      /* Every status falls back rather than throwing, the same way stepStatus
         does below: these files are hand-editable, and a typo in one cell must
         not cost the reader the other forty rows. */
      const srcStatus = s => (s || '').trim().toLowerCase() === 'expected' ? 'expected' : 'received';
      const itemStatus = s => {
        const t = (s || '').trim().toLowerCase();
        return t === 'done' ? 'done' : (t === 'part' || t === 'partial') ? 'part' : 'planned';
      };
      // Money columns go through normalizeAmount for the reason the debt
      // balances do: a hand-typed "40 000,00" read as 40 would be written
      // straight back over a figure nobody was editing.
      const amt = v => normalizeAmount(v) ?? 0;
      /* ADR-0007 · Plans and Tax cells keep <key>Raw when unreadable. ISSUE 59/63 —
         table-schema's money()/vocab() contract, applied by hand. */
      const cellMoney = (key, v) => {
        const raw = String(v ?? '').trim();
        const n = normalizeAmount(v);
        return n === null && raw ? { [key]: 0, [`${key}Raw`]: raw } : { [key]: n ?? 0 };
      };
      const cellVocab = (key, v, allowed, fallback) => {
        const raw = String(v ?? '').trim();
        const hit = allowed.find(a => a === raw.toLowerCase());
        return (!raw || hit) ? { [key]: hit || fallback } : { [key]: fallback, [`${key}Raw`]: raw };
      };

      S.plans[f.basename] = {
        /* ADR-0007 · Plans are keyed by basename, not display name. The file is the identity;
           writers derive the path from `file`. */
        file: f.basename,
        name: (fm.plan || '').toString().trim() || f.basename,
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back
        started: (fm.started || '').toString().trim(),
        status: (fm.status || 'active').toString().trim(),
        sources: parseMdTable(section(body, 'money in')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), kind: unescMd(c[1] || 'Other'), ...cellMoney('amount', c[2]),
          date: (c[3] || '').trim(), ...cellVocab('status', c[4], ['expected', 'received'], 'received'),
          notes: unescMd(c[5] || ''),
        })),
        // Tint is written back verbatim so a hand-picked colour survives, and
        // an absent one renders as no wash rather than as the string "".
        envelopes: parseMdTable(section(body, 'envelopes')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), ...cellMoney('amount', c[1]), note: unescMd(c[2] || ''),
          tint: (c[3] || '').trim(),
        })),
        items: parseMdTable(section(body, 'items')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), envelope: unescMd(c[1] || ''), ...cellMoney('amount', c[2]),
          ...cellMoney('spent', c[3]), ...cellVocab('status', c[4], ['planned', 'part', 'done'], 'planned'),
          category: unescMd(c[5] || ''), notes: unescMd(c[6] || ''),
        })),
      };
    }
    // Keep the open plan if it still exists; otherwise fall to the first by
    // name, or null — which is what renders the empty state.
    if (!S.planName || !S.plans[S.planName]) S.planName = Object.keys(S.plans).sort()[0] || null;

    S.tax = {}; S.taxDirty = false;
    for (const { file: f, text } of await read(mdFilesIn('Tax').filter(f => /^\d{4}$/.test(f.basename)))) {
      const { fm, raw, body } = parseFrontmatter(text);
      // The body holds three tables under "## Progress", "## Documents" and
      // "## Figures". parseMdTable reads every table row in the text it's
      // given, so slice the body by heading first and parse each on its own.
      const stepStatus = s => {
        const t = (s || '').trim().toLowerCase().replace(/[-\s]/g, '');
        return ['todo', 'busy', 'done', 'n/a', 'na'].includes(t) ? (t === 'na' ? 'n/a' : t) : 'todo';
      };
      const docStatus = s => {
        const t = (s || '').trim().toLowerCase().replace(/[-\s]/g, '');
        return t === 'uploaded' ? 'uploaded' : (t === 'n/a' || t === 'na') ? 'n/a' : 'needed';
      };
      /* ADR-0007 · Tax figures go through normalizeAmount. The one reader every hand-editable
         amount shares; coerce, do not throw. */
      const figAmount = s => normalizeAmount(s) ?? 0;
      /* ADR-0007 · Plans and Tax cells keep <key>Raw when unreadable. ISSUE 59/63, Tax half —
         the same contract as the Plans copy above. */
      const cellMoney = (key, v) => {
        const raw = String(v ?? '').trim();
        const n = normalizeAmount(v);
        return n === null && raw ? { [key]: 0, [`${key}Raw`]: raw } : { [key]: n ?? 0 };
      };
      const cellVocab = (key, v, allowed, fallback) => {
        const raw = String(v ?? '').trim();
        const hit = allowed.find(a => a === raw.toLowerCase());
        return (!raw || hit) ? { [key]: hit || fallback } : { [key]: fallback, [`${key}Raw`]: raw };
      };

      /* ADR-0007 · Assessment figures: normalizeAmount, not a digit-scraper. ISSUE 52:
         "-1 234,56" read as -123456; unreadable keeps its text in <key>Raw. */
      const signedNum = v => {
        if (v === undefined || v === null || String(v).trim() === '') return { value: null, raw: null };
        const n = normalizeAmount(v);
        return n === null ? { value: null, raw: String(v) } : { value: n, raw: null };
      };
      const assessResult = signedNum(fm.assessment_result);
      const assessIncome = signedNum(fm.assessment_income);
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
        assessment_result: assessResult.value,
        assessment_resultRaw: assessResult.raw,
        assessment_income: assessIncome.value,
        assessment_incomeRaw: assessIncome.raw,
        steps: parseMdTable(section(body, 'progress')).slice(1).filter(c => c[0]).map(c => ({
          step: unescMd(c[0]), ...cellVocab('status', c[1], ['todo', 'busy', 'done', 'n/a'], 'todo'),
          due: (c[2] || '').trim(), notes: unescMd(c[3] || ''),
        })),
        docs: parseMdTable(section(body, 'documents')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), source: unescMd(c[1] || ''),
          ...cellVocab('status', c[2], ['needed', 'uploaded', 'n/a'], 'needed'),
          file: unescMd(c[3] || ''), notes: unescMd(c[4] || ''),
        })),
        // Absent on every page written before the Figures table existed — an
        // empty list keeps those loading unchanged.
        figures: parseMdTable(section(body, 'figures')).slice(1).filter(c => c[0]).map(c => ({
          code: unescMd(c[0]), description: unescMd(c[1] || ''),
          source: unescMd(c[2] || ''), ...cellMoney('amount', c[3]),
        })),
      };
    }
    if (!S.taxYear || !S.tax[S.taxYear]) S.taxYear = Object.keys(S.tax).sort().pop() || null;

    // Prior-year certificates often land in Tax/<year>/ before anyone creates
    // the matching page, leaving the folder invisible to the view. Surface the
    // orphans so the Tax page can offer to seed a page for them.
    S.taxOrphanYears = subfoldersIn('Tax')
      .map(f => f.name).filter(n => /^\d{4}$/.test(n) && !S.tax[n]).sort();

    // The remembered period must still be one the current settings can address.
    // Changing the period length reaches this line via main.js's reload, and the
    // old name would otherwise survive it in a shape nothing can read.
    if (!S.period || !periodKeyValid(S.period)) S.period = currentPeriod();

    await loadNotes();
  }

  /* ADR-0007 · A note that cannot be read is skipped. Per-file catch, so one bad note cannot
     take the budget down; exposed on ctx because views/notes.js re-reads after every write.
     ADR-0007 · Notes read in parallel. 172ms of a 233ms load at thirty notes when sequential. */
  async function loadNotes() {
    /* Under, not in: a user who files a year of notes into Notes/2026/ has
       tidied a folder of markdown, not deleted it, and the page must not go
       blank because of it. See mdFilesUnder in io.js. */
    const files = mdFilesUnder(NOTES_DIR);
    const texts = await Promise.all(files.map(f => vault.cachedRead(f).catch(() => null)));
    const base = ctx.basePath();
    const notes = [];
    files.forEach((f, i) => {
      if (texts[i] == null) return;
      /* Derived from the file's OWN path rather than assembled from the folder
         and the name — the note may be several levels down, and every writer
         (readFile, writeFile, fileAt) takes a budget-folder-relative path. */
      const rel = f.path.slice(base.length + 1);
      notes.push({ rel, name: f.name, ...parseNote(texts[i], rel) });
    });
    S.notes = sortNotes(notes);
  }

  /* ADR-0007 · An existing transaction folder wins verbatim. Only a never-written label
     is sanitised into a new segment. */
  /* ADR-0007 · txSegment is case-folded. macOS, iOS and Windows resolve cheque/ and
     Cheque/ to one directory. */
  function txSegment(label) {
    const want = safeSeg(label);
    const key = want.toLowerCase();
    for (const f of Object.values(S.txFiles)) {
      if (f.label === label || safeSeg(f.label).toLowerCase() === key) return f.label;
    }
    return want;
  }

  ctx.provide({ loadVault, loadNotes, txSegment });
};
