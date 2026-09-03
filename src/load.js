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

/* An optional numeric frontmatter key: absent or blank → null ("not set"),
   anything normalizeAmount can read → that number, anything it cannot → null.
   Deliberately NOT parseNum: its fallback resolves an unreadable cell to 0,
   which for a savings goal or a credit limit is a figure the file never
   claimed. Here "I could not read this" has to stay distinguishable from
   "the user wrote zero", because the writers skip null and keep the line. */
function fmNum(v) {
  const s = (v ?? '').toString().trim();
  return s ? normalizeAmount(s) : null;
}

/* Slice a body by `## Heading` into the chunk under one heading, lower-cased
   and matched by prefix. Plans and Tax each hold several tables in one file (a
   plan, or a tax year, is read as one thing) and parseMdTable reads every
   table row it's handed, so it would run them together into one malformed
   list without this cut first. One definition for both — it was written out
   twice, character for character, and a heading typo fixed in one copy would
   silently not be fixed in the other. */
function section(body, name) {
  for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
    if (chunk.trim().toLowerCase().startsWith(name)) return chunk;
  }
  return '';
}

/* An optional BOOLEAN frontmatter key, tri-state for the same reason fmNum is:
   absent → undefined ("not set, decide by the default"), written → true/false.
   Collapsing absent to false would turn every account in every existing vault
   into an explicit opt-out on upgrade, which is precisely the silent figure
   change a default is supposed to avoid. Anything unreadable is treated as
   unset rather than as false, so a typo cannot quietly exclude an account. */
function fmBool(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (!s) return undefined;
  if (/^(true|yes|on|1)$/.test(s)) return true;
  if (/^(false|no|off|0)$/.test(s)) return false;
  return undefined;
}

module.exports = function registerLoad(ctx) {
  const { S, vault, readFile, mdFilesIn, mdFilesUnder, subfoldersIn, currentPeriod, periodKeyValid } = ctx;

  /* Reads go out in parallel; parsing stays serial. Every loop below used to
     await one file at a time — ~163 sequential round trips on a real vault,
     and on mobile each one crosses the Capacitor bridge (an iCloud-backed
     file may have to be materialised first). Parsing all 5,700 transactions
     measures ~7ms, so the wait was almost entirely I/O latency. Ordering and
     results are unchanged: `read` keeps each file paired with its own text.

     Declared HERE rather than inside loadVault, where it lived until 1.16.1.
     Being a local of loadVault made it unreachable from loadNotes — a sibling
     function added later in the same file — so that loader re-invented the
     sequential loop this comment exists to warn about, and the notes read grew
     to three quarters of the whole vault load. A helper that documents a trap
     has to be in scope for the next person who would fall into it. */
  const read = async files => {
    const texts = await Promise.all(files.map(f => vault.cachedRead(f)));
    return files.map((file, i) => ({ file, text: texts[i] }));
  };

  /* Single-flight. Six sections below use the `S.x = [] … await … push()`
     shape, so two OVERLAPPING loads don't merely repeat work — they duplicate:
     run B clears the array run A is still filling, then both push, and the
     vault ends up with 2× categories/accounts/debts/assets/owed/services while
     the keyed-object sections (budgets, txFiles, plans, tax) survive. Partial
     corruption reads as "the maths is wrong", not "it loaded twice". Two live
     paths overlap today: the drawer's reload link stays tappable for the whole
     load, and unlockGate can race a pending scheduleReload timer. One latch
     covers every caller, so a load already in flight is joined, not restarted. */
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
      /* Pay cycle, as its own length in days — see the header of period.js for
         why it isn't a named type. Absent means the payday month, so a vault
         that has never heard of this setting behaves exactly as it always did.
         A cycle without an anchor has no way to place a boundary, so both are
         dropped together rather than deriving periods from a missing date;
         period.js clamps the length itself. */
      /* A real date, not merely a date-SHAPED string — the same test period.js
         gates the cycle on. A shape check accepted 2026-13-45 and stored the
         pair, while period.js refused it and ran payday months, so the settings
         screen sat there showing a cycle the app was not running. */
      const anchor = (fm.period_anchor || '').toString().trim();
      const anchorOk = isRealIsoDate(anchor);
      S.settings.period_days = anchorOk ? periodDaysOrZero(fm.period_days) : 0;
      S.settings.period_anchor = anchorOk ? anchor : '';
      if (fm.currency) S.settings.currency = fm.currency;
      /* ISSUE 30 — exchange rates, opt-in and off by default. Absent means
         off, so every vault written before this key existed keeps making
         ZERO network requests, which is the promise the README makes.
         Normalised to a real boolean here rather than left as the raw cell:
         `exchange_rates: yes` reads as YAML true while `exchange_rates: maybe`
         reads as a string, and fx.js's canConvert() deliberately refuses a
         truthy string — a hand-edited value must not switch money conversion
         on by accident. */
      S.settings.exchange_rates = String(fm.exchange_rates ?? '').trim().toLowerCase() === 'on';
      /* How often those rates may be re-asked for: daily, weekly or monthly.
         Absent resolves to daily, which is what the setting and the wizard
         have always described, so a vault written before this key existed
         keeps the behaviour its own Settings.md documents. Normalised through
         fx.normalizeCadence so a hand-edited `rate_refresh: hourly` falls back
         rather than reaching the refresh gate as an unknown. */
      S.settings.rate_refresh = normalizeCadence(fm.rate_refresh);
      /* The ISO code the rate lookup asks for. The `currency` symbol above is
         what gets PRINTED; this says which currency that symbol means, because
         "$" is four of them. Blank is a complete answer — it just means rates
         cannot be fetched. */
      S.settings.currency_code = normalizeCode(fm.currency_code);
      // Country code (za/us/uk/…) — localeFor falls back to za for unknown
      // values, so a hand-edited Settings.md can't break the app.
      S.settings.country = (fm.country || 'za').toString().trim().toLowerCase();
      /* Interface language, deliberately independent of country — see the
         header of i18n.js. Absent means "follow Obsidian's own display
         language", so a vault that has never heard of this setting reads in
         whatever language the rest of Obsidian is already in. resolveLanguage
         falls back to English for an unknown hand-edited value, the same
         contract localeFor gives country. */
      S.settings.language = setLanguage(fm.language || defaultLanguage());
      /* How this household gets transactions in: 'csv' or 'manual'. Absent
         means 'csv', so every vault written before this key existed keeps the
         import affordances it has always had — see inputMode() in constants.js,
         which is the ONE normaliser the loader, the settings tab and the wizard
         share. Assigned unconditionally, like emergency_target_months below: a
         hand-deleted line has to fall back to the default on the next load
         rather than leaving the old value alive in memory. */
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
      /* How many periods back "pull last period's overspend" reads from. 1 is
         the obvious answer and the default; it is a setting because a credit
         card settles a month in arrears, so the hole you are funding in August
         is often June's, not July's. Clamped to 1–12: a 0 would read the period
         you are standing in (whose deficit is still growing, so the figure
         would change every time you pressed the button) and a negative one
         would read the future. */
      S.settings.overspend_lag = overspendLag(fm.overspend_lag);
      /* Months of essential spending the emergency fund aims to cover.
         Assigned unconditionally, unlike month_start_day above: a hand-deleted
         line has to fall back to the default on the next load rather than
         keeping the old value alive in memory. The clamp lives in constants.js
         because the settings tab applies the same one on the way out — see
         emergencyTarget() there for what the bounds are protecting. */
      S.settings.emergency_target_months = emergencyTarget(fm.emergency_target_months);
    }
    S.categories = [];
    for (const { file, text } of await read(mdFilesIn('Categories'))) {
      const { fm } = parseFrontmatter(text);
      // Prefer the exact name from frontmatter — filenames drop filesystem-illegal
      // chars, so the frontmatter `name` is the source of truth.
      S.categories.push({
        name: fm.name || file.basename, type: fm.type || 'expense', color: fm.color || '#888',
        /* A category whose budgeted amount IS the actual spend — no transaction
           will ever arrive for it, because the money left in a previous period.
           "Previous month overspending" is the case it was written for: the hole
           is real, it has to be funded out of this period's income, and the
           bank line that dug it is sitting in last period's statement under some
           other category. Budgeting it as an ordinary row left it reading
           "R1 900 left" all month — the exact opposite of the truth.
           fmBool, so an unreadable value is "unset" rather than a silent false.
           The path travels with it so the Budget page can toggle the flag
           without re-deriving a filename from a display name (two names can
           sanitise to one file — see promptCreateCategory). */
        assumeSpent: fmBool(fm.assume_spent) === true,
        /* Money the household cannot stop paying this month — rent or a bond,
           medical aid, the debit orders. Its own flag rather than a guess from
           `type`, because the biggest fixed cost most households have is rent,
           and rent is an ordinary `expense`: deriving the set from type would
           have reported 19.9% of income committed on the vault this was built
           against, where the real figure including rent is 44.4%. A ratio that
           silently omits the largest term is worse than no ratio. */
        fixed: fmBool(fm.fixed) === true,
        /* ITEM 2 (2026-08-26): which `income`-typed categories the household
           has told us are what a savings/investment account itself EARNED —
           interest, dividends — rather than money the household put in.
           savings-math.js's classifyRow used to treat EVERY income-typed
           inflow as growth, which caught a salary, a client payment or a UIF
           payment landing directly in a pool account exactly as hard as it
           caught real interest — nothing in `type` alone tells them apart.
           Same additive-flag shape as `fixed` just above: opt-in, defaults
           false, so an existing "Interest" category (income-typed, this flag
           unset) now reads as an ordinary contribution until the household
           ticks it — a one-time, VISIBLE move (the category simply stops
           appearing under "growth from…" and starts appearing as money put
           in), not a silent one. See savings-math.js's own header for the
           full rule and why it lives on the category rather than being
           guessed from the category's name. */
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
        /* The ISO code that symbol MEANS, and the one thing an exchange-rate
           lookup can use — "$" is USD, AUD, CAD and SGD, so the symbol above
           cannot answer it. Absent is a complete answer: the account is then
           simply not convertible and is stated in its own symbol instead,
           which is exactly what every account did before this existed.

           Read here because it was written into Settings.md and the account
           dialog and read by NOTHING for a whole release — a field the user
           can fill in that has no effect is the precise failure this issue
           was opened about (see docs/adr/0004), and it very nearly shipped
           inside the fix for it. */
        currency_code: normalizeCode(fm.currency_code),
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
        // `budget: false` opts an account out of the household budget totals —
        // an investment or tax-free wrapper whose interest is not income and
        // whose debit orders are not spending. Absent means IN, so no existing
        // vault's Dashboard figures move on upgrade. The money still leaving
        // the cheque account is budgeted as normal; only the arriving leg here
        // is suppressed, which is what stops it being counted twice.
        in_budget: !/^(false|no|off|0)$/i.test(String(fm.budget ?? '').trim()),
        /* ISSUE 41. Whether the household ANSWERED the budget question, as
           distinct from the answer. `in_budget` cannot tell an explicit
           `budget: true` from a file that never mentions it — both are true —
           and the earmark rule in period.js needs exactly that difference: a
           savings account is held out of the budget's spend totals BY DEFAULT,
           and only a household that has written `budget: true` on it has said
           otherwise. An absent key is not consent. */
        in_budget_stated: String(fm.budget ?? '').trim() !== '',
        /* A card the household clears in full before interest. Its outstanding
           balance is money already spent that has not left the cheque account
           yet, so it counts as committed rather than as negative cash.
           `settle_day` narrows WHEN; it is optional and only ever narrows. */
        settle_monthly: /^(true|yes|on|1)$/i.test(String(fm.settle_monthly ?? '').trim()),
        settle_day: fmNum(fm.settle_day),
        /* Same parseNum reasoning as `balance` above, and for the same reason:
           every one of these is hand-editable and every one is WRITTEN BACK by
           saveAccount's FM_WRITERS. parseFloat reads "15,000" as 15 and
           "1.234,56" as 1.234, and the next edit to any field on the account
           serialises that back over the user's own figure — silent destruction
           of a number nobody was even editing. */
        credit_limit: fmNum(fm.credit_limit),
        /* Which part of this account is the household's emergency fund:
           `true` earmarks the whole balance, a number earmarks that slice,
           absent means "never asked" — three different answers, so all three
           survive the read. health-math.js owns what each one is worth (the
           cap at the held balance, the over-claim report); this only carries
           the claim across. An unreadable value is unset rather than zero,
           for the same reason fmNum refuses parseNum's fallback: "I could not
           read this" must stay distinguishable from "the user earmarked
           nothing". */
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
    /* The undo receipt goes with them. It holds references to the row objects
       about to be replaced, so after this line it could only ever remove
       nothing — and an undo button that quietly does nothing is worse than no
       button. Cleared HERE, beside the state it depends on, rather than in the
       caller: reloadFromDisk (controller.js) is loadVault's only call site
       today, but the reset belongs to loadVault regardless — a second caller
       added later must not have to remember this line too. */
    S.lastImport = null;
    /* Every folder under Transactions/, whether or not it holds a month file.

       S.txFiles cannot answer "does this account have a folder?" — it is keyed
       per month file, so a folder someone created and has not imported into yet
       contributes no entry and reads exactly like a folder that was never
       linked. Those are different situations with different next steps (import
       a statement vs. link a folder), and telling the second story to someone
       in the first sends them to re-link a folder they already have. */
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
      if (d.original === null) d.original = d.balance;
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
    /* Plans — one file per plan in Plans/, keyed by the file's basename. Same
       multi-file shape as Tax above, and read with the same heading-slice
       trick: the three tables ("Money in", "Envelopes", "Items") live in one
       file because a plan is read as one thing, and parseMdTable would happily
       run them together into a single malformed list if they were handed to it
       whole. The section names are load-bearing — plan.js's serializer writes
       exactly these headings. */
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
      S.plans[f.basename] = {
        /* KEYED BY BASENAME, not by display name, and `file` carries it back
           out. The two differ on purpose: a plan can be called "Baby &
           catch-up" while living in a filesystem-safe file, and frontmatter is
           hand-editable — so two files could name themselves the same thing.
           The file is the identity; the name is a label. Writers must derive
           the path from `file` and never re-sanitise the name, or a rename in
           frontmatter would fork the plan into a second file. */
        file: f.basename,
        name: (fm.plan || '').toString().trim() || f.basename,
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back
        started: (fm.started || '').toString().trim(),
        status: (fm.status || 'active').toString().trim(),
        sources: parseMdTable(section(body, 'money in')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), kind: unescMd(c[1] || 'Other'), amount: amt(c[2]),
          date: (c[3] || '').trim(), status: srcStatus(c[4]), notes: unescMd(c[5] || ''),
        })),
        // Tint is written back verbatim so a hand-picked colour survives, and
        // an absent one renders as no wash rather than as the string "".
        envelopes: parseMdTable(section(body, 'envelopes')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), amount: amt(c[1]), note: unescMd(c[2] || ''),
          tint: (c[3] || '').trim(),
        })),
        items: parseMdTable(section(body, 'items')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), envelope: unescMd(c[1] || ''), amount: amt(c[2]),
          spent: amt(c[3]), status: itemStatus(c[4]),
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
      /* Figures are written as raw numbers, but a hand-edited file may carry a
         currency symbol or either separator convention — coerce rather than
         throw, mirroring how stepStatus falls back instead of failing.
         normalizeAmount is the same reader the statement importer and every
         other hand-editable amount goes through; this used to be a fourth
         private copy of that logic, with a test that asserted against its own
         mirror of it rather than against the shipped function. */
      const figAmount = s => normalizeAmount(s) ?? 0;
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
        steps: parseMdTable(section(body, 'progress')).slice(1).filter(c => c[0]).map(c => ({
          step: unescMd(c[0]), status: stepStatus(c[1]), due: (c[2] || '').trim(), notes: unescMd(c[3] || ''),
        })),
        docs: parseMdTable(section(body, 'documents')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), source: unescMd(c[1] || ''), status: docStatus(c[2]),
          file: unescMd(c[3] || ''), notes: unescMd(c[4] || ''),
        })),
        // Absent on every page written before the Figures table existed — an
        // empty list keeps those loading unchanged.
        figures: parseMdTable(section(body, 'figures')).slice(1).filter(c => c[0]).map(c => ({
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

    // The remembered period must still be one the current settings can address.
    // Changing the period length reaches this line via main.js's reload, and the
    // old name would otherwise survive it in a shape nothing can read.
    if (!S.period || !periodKeyValid(S.period)) S.period = currentPeriod();

    await loadNotes();
  }

  /* Notes/ — one markdown file per note. Unlike every other file read above,
     the BODY is content rather than a serialized table, so the excerpt comes
     out of it; parseNote in src/notes.js owns that and is the same module the
     writer serializes through.

     Exposed on ctx as well as called from loadVault, because views/notes.js
     re-reads after every write it makes — so what the page lists always comes
     from the same parse as everything else, and a serializer/parser
     disagreement shows up on the first note rather than after the next reload.

     A note that cannot be read is SKIPPED rather than failing the load: these
     are files the user creates and edits by hand, and one unreadable note must
     not take the whole budget down with it. That is why this cannot simply
     call `read` above — a single rejection there takes the whole Promise.all
     down, and with it the entire budget. The catch is per file.

     Reads in parallel for the reason `read`'s own comment gives, and this
     loader is the case that proves it: measured against a Ruan-shaped vault it
     was 172ms of a 233ms load at THIRTY notes — three quarters of the wait, at
     a fraction of the files — because the cost is round trips, not work
     (parsing measures ~5.5µs a note). Sequential, it grew without bound in the
     one folder the user is invited to keep adding to. */
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

  /* Resolve an account label to the exact folder segment to key by AND write
     to. Both must be the same string: S.txFiles is keyed by the folder name as
     it exists on disk, so a writer that re-sanitises the label can miss the
     lookup while the write still lands on the existing file — rebuilding that
     month from scratch with only the new rows.

     A folder that already exists wins verbatim. Re-sanitising it would create a
     second, near-identical folder and split the account in half; and the name
     is self-evidently legal, because the filesystem is already holding it. Only
     a label that has never been written gets sanitised into a new segment. */
  /* Case-folded, because the filesystems this plugin ships on are. macOS, iOS
     and Windows all resolve `Transactions/cheque/` and `Transactions/Cheque/`
     to one directory, so a `tx_label` differing only in case — hand-editable
     frontmatter that syncs between devices — missed the in-memory lookup while
     the write still landed on the existing file. Folding here keeps the two
     sides agreeing, which is the whole contract vault-path.js exists to hold. */
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
