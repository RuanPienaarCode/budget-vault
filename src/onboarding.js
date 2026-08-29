'use strict';
/* First-run onboarding wizard.

   ONE QUESTION PER SCREEN, and only the questions that are really questions.
   It used to be seven screens — folder, name, country, period, categories,
   account, finish — and the folder came first, which is the one thing a brand
   new reader has no basis for an opinion about. That screen is gone: the
   folder is a field on the finish screen for the tenth reader who cares, and
   what is left is three short questions (what to call you, when you are paid,
   how you will add your spending) and then only the setup the answers made
   necessary.

   One question per screen is the rule here from now on. A screen carrying four
   controls reads as a form to be endured; the same four across four screens,
   each with its own sentence and its own worked example, reads as a
   conversation — and the counter tells the reader how much is left.

   The screen also asks how the household will get its transactions in. A CSV
   household ends the wizard where it always did — categories, a first account,
   then an import. A MANUAL household never sees the import path at all: the
   whole starter pack is created, an account is created silently for the rows
   to land in, and the last question is their actual first budget, so setup
   ends on a budget file rather than on an empty dashboard and a homework
   assignment.

   Obsidian Modal + Setting controls only, so it works on iOS like the rest of
   the app. Nothing is written to disk until the final step's button. */

const { Modal, Setting, Notice, normalizePath, TFile, TFolder } = require('obsidian');
const { PROFILES, COUNTRY_ORDER, localeFor } = require('./locale');
/* Namespace import for the same reason settings-tab.js uses one: this file
   binds `t` as a parameter in several `.addText(t => …)` callbacks, so a bare
   `t` from i18n would be silently shadowed inside exactly those callbacks. */
const i18n = require('./i18n');
const { setLanguage, LANGUAGE_NAMES, LANGUAGE_ORDER } = i18n;
const { PERIOD_PRESETS, periodLengthOptions, TYPE_ORDER, MONTHS, inputMode } = require('./constants');
/* The Budgets/<period>.md format, shared with the Budget page's own save — see
   the header of budget-file.js. The wizard used to seed an EMPTY table out of
   its own literals, which was survivable while nothing else built the file
   from scratch; the manual path now seeds real rows into it, so a second copy
   of the format would be two writers of one file derived by different rules. */
const { serializeBudgetFile, budgetRangeNote, BUDGET_FRONTMATTER } = require('./budget-file');
const { periodDaysOrZero } = require('./dates');
const { normalizeAmount } = require('./amount');
const { normalizeCode, codeForCountry } = require('./fx');
const { todayIso, isoDayNumber, isoFromDayNumber, isRealIsoDate } = require('./dates');
const { safeSeg } = require('./vault-path');
/* yamlStr, not hand-rolled quoting. This file used to write currency and
   household as `"${v.replace(/"/g, '')}"` — which deletes quotes and escapes
   nothing else, so a backslash in a household name produced an invalid YAML
   escape and Obsidian silently dropped every property on Settings.md. The
   wizard is the FIRST writer a new user meets; it follows the same rule
   markdown.js enforces for every other frontmatter scalar. */
const { yamlStr } = require('./markdown');
const { makeIo } = require('./io');


/* Generic starter pack — types come from TYPE_ORDER in constants.js. The
   user unticks what they don't want; more can be added in-app afterwards. */
const STARTER_CATEGORIES = [
  { name: 'Salary', type: 'income', color: '#22c55e' },
  { name: 'Other income', type: 'income', color: '#4ade80' },
  { name: 'Rent / Bond', type: 'housing', color: '#dc3545' },
  { name: 'Levies, rates & taxes', type: 'housing', color: '#e11d48' },
  { name: 'Cleaning & domestic help', type: 'housing', color: '#f43f5e' },
  { name: 'Maintenance & repairs', type: 'housing', color: '#be123c' },
  { name: 'Security', type: 'housing', color: '#9f1239' },
  { name: 'Electricity & water', type: 'utilities', color: '#fbbf24' },
  { name: 'Gas & refuse', type: 'utilities', color: '#f59e0b' },
  { name: 'Groceries', type: 'food', color: '#84cc16' },
  { name: 'Household consumables', type: 'food', color: '#a3e635' },
  { name: 'Transport & fuel', type: 'transport', color: '#60a5fa' },
  { name: 'Car maintenance & licences', type: 'transport', color: '#3b82f6' },
  { name: 'Medical', type: 'health', color: '#f87171' },
  { name: 'Pharmacy & gym', type: 'health', color: '#ef4444' },
  { name: 'School fees & childcare', type: 'family', color: '#fb7185' },
  { name: 'Kids\' activities', type: 'family', color: '#fda4af' },
  { name: 'Clothing', type: 'personal', color: '#c084fc' },
  { name: 'Hair & toiletries', type: 'personal', color: '#d8b4fe' },
  { name: 'Bank fees', type: 'fees', color: '#94a3b8' },
  { name: 'Other expenses', type: 'expense', color: '#a1a1aa' },
  { name: 'Home loan / bond repayment', type: 'debt', color: '#fb923c' },
  { name: 'Car repayment', type: 'debt', color: '#f97316' },
  { name: 'Credit card & other debt', type: 'debt', color: '#ea580c' },
  { name: 'Subscriptions', type: 'services', color: '#818cf8' },
  { name: 'Cellphone & internet', type: 'services', color: '#38bdf8' },
  { name: 'Insurance', type: 'insurance', color: '#2dd4bf' },
  { name: 'Giving', type: 'giving', color: '#fb923c' },
  { name: 'Savings', type: 'savings', color: '#34d399' },
  { name: 'Eating out', type: 'luxuries', color: '#f472b6' },
  { name: 'Entertainment', type: 'luxuries', color: '#a78bfa' },
  { name: 'Transfer between accounts', type: 'transfer', color: '#888888' },
];

/* The five lines the manual path's first budget asks for.

   Five, and always the same five, because this screen is the LAST thing between
   a non-technical household and a working budget: a picker offering all thirty
   starter categories at that moment is the wall the whole manual path exists to
   avoid. Everything else is added on the Budgets page afterwards, which is what
   the step's own intro says.

   `prefer` is a category NAME with a type-filtered fallback rather than a
   hardcoded index into the pack. The starter pack is edited (it has been twice),
   and a name that quietly stops existing would leave a dropdown showing nothing
   selected while `this.data.firstBudget` still carried it — a line the writer
   would then silently drop. The type lists are deliberately wider than the
   preferred category's own type: rent is `housing` in today's pack and was
   `expense` in yesterday's, and a household that pays a bond rather than rent
   should be able to point the line at the debt category instead. */
const FIRST_BUDGET_LINES = [
  { key: 'income', label: 'wiz.first.income', prefer: 'Salary', types: ['income'] },
  { key: 'housing', label: 'wiz.first.housing', prefer: 'Rent / Bond', types: ['housing', 'expense', 'debt'] },
  { key: 'food', label: 'wiz.first.food', prefer: 'Groceries', types: ['food', 'expense'] },
  { key: 'services', label: 'wiz.first.services', prefer: 'Electricity & water', types: ['utilities', 'services', 'expense'] },
  { key: 'savings', label: 'wiz.first.savings', prefer: 'Savings', types: ['savings', 'investment'] },
];
const firstBudgetOptions = line => STARTER_CATEGORIES.filter(c => line.types.includes(c.type));
const firstBudgetDefault = line => {
  const opts = firstBudgetOptions(line);
  const pick = opts.find(c => c.name === line.prefer) || opts[0];
  return pick ? pick.name : '';
};

/* The stored VALUE is the key on the left; only the label is translated, so a
   vault written in one language reads back identically in another. Resolved on
   call rather than at module load — the language can change mid-wizard. */
const ACCOUNT_TYPE_KEYS = ['checking', 'savings', 'credit_card', 'cash', 'investment'];
const accountTypes = () => ACCOUNT_TYPE_KEYS.map(k => [k, i18n.t('acctType.' + k)]);

/* The stored VALUE is the symbol; only the currency's NAME is translated, so a
   vault written in one language reads back identically in another. Resolved on
   call, like accountTypes() — the language can change mid-wizard. */
/* Symbols are written as escapes, not literals: this list is read in a diff
   far more often than the strings around it, and a bare rupee or rupiah
   glyph beside a Latin one is the kind of thing a careless editor drops.
   R$ is a real two-character symbol, and distinct from the bare R above —
   the stored value is the symbol string, so the two never collide. */
const CURRENCY_KEYS = [
  ['R', 'rand'], ['$', 'dollar'], ['\u20ac', 'euro'], ['\u00a3', 'pound'],
  ['\u20b9', 'rupee'], ['Rp', 'rupiah'], ['R$', 'real'],
  ['__custom__', 'other'],
];
const currencies = () => CURRENCY_KEYS.map(([sym, k]) => [sym, i18n.t('wiz.ccy.' + k)]);

/* Plain-English headings for the category step. The starter pack is grouped
   under these rather than listed flat with a type tag per row: twenty ticked
   checkboxes in one run is a wall, and the type is the thing that tells a new
   user why "Savings" and "Groceries" are not the same kind of line. */
const typeLabel = type => i18n.t('wiz.type.' + type);

/* Every step past the welcome screen gets a name. "Step 3 of 7" on its own
   tells the user how far they are but not what they are being asked. */
const stepTitle = step => i18n.t('wiz.step.' + step);
/* "2026-08" -> "Aug 2026", for the worked examples on the period step. */
const monthLabel = period => {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

/* Same period math as period.js currentPeriod, but for a day chosen in the
   wizard (the view ctx doesn't exist yet). */
function currentPeriodFor(day) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  if (day > 1 && now.getDate() >= day) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}
/* The interval equivalent, for the same reason. A real floor, not a
   truncation: the anchor the wizard collects is the user's LAST payday, so
   today is normally after it — but nothing stops someone entering their next
   one, and a truncating divide would put them a period out. */
function currentPeriodForCycle(days, anchor) {
  const today = isoDayNumber(todayIso());
  const a = isoDayNumber(anchor);
  return isoFromDayNumber(a + Math.floor((today - a) / days) * days);
}
/* safeSeg, not a local sanitiser. vault-path.js is the ONE canonicaliser for
   path segments and says so at length: a name turned into a path by two
   different functions is a lookup that misses while the write still lands on
   the existing file. The local copy that used to live here dropped NFC
   normalisation, NBSP folding, control and bidi stripping, dot-run collapsing,
   leading-dot stripping, trailing dot/space stripping and Windows reserved
   names — so the wizard could create `Savings.` or `CON` as a folder that every
   later lookup would name differently. This is the first folder a new install
   ever gets, which makes it the worst place to have a second rule. */
const safeFileName = safeSeg;

class OnboardingWizard extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.finished = false;
    this.stepIdx = 0;
    this.mode = 'create';           // 'create' | 'connect' — decided by adoptFolder()
    this._prefilledFrom = '';       // the folder prefillFromSettingsMd() last read
    /* Which answers the READER has given, as opposed to which ones this class
       filled in on their behalf.

       An explicit set rather than "does it still equal the constructor
       default": the default payday is 25, and a reader who deliberately types
       25 is indistinguishable from one who never touched the field. Adopting
       an existing budget then quietly replaced their 25 with the vault's 15 —
       the wizard silently un-answering a question it had already asked. Every
       control that writes into `data` marks its key here. */
    this.touched = new Set();
    this.error = '';                // one-shot inline validation message (see renderStep)
    this.data = {
      folder: plugin.settings.budgetFolder || 'Finances/Budget',
      name: '',
      country: 'za',
      /* Interface language — an axis of its own, NOT derived from country (see
         the header of i18n.js). Starts from Obsidian's own display language
         rather than from `country`, so a German-speaking user in South Africa
         gets a German interface and South African tax handling, and neither
         choice drags the other with it. */
      language: i18n.defaultLanguage(),
      /* Shape and phase, exactly as Settings.md stores them — NOT a three-way
         "calendar | payday | cycle" mode. A calendar month is not a third kind
         of period; it is a payday month whose start day happens to be the 1st,
         and modelling it as its own mode meant the wizard offered two options
         that ran the same code and produced the same file, while the settings
         tab (which exposes these two keys directly) offered neither. */
      periodDays: 0,                // 0 = payday month; 7/14/28… = an interval
      payday: 25,                   // month_start_day, used when periodDays is 0
      periodAnchor: '',             // blank on purpose — see render_period
      currency: 'R',
      customCurrency: '',
      cats: new Set(STARTER_CATEGORIES.map(c => c.name)),
      acctName: '', acctType: 'checking', acctInstitution: '', acctBalance: '',
      /* How this household will get transactions in. Its own axis, like
         language: a question about the PERSON, not about the folder, which is
         why it is asked in both modes and before anything is detected. 'csv' by
         default, so a wizard closed at the how screen leaves a vault behaving
         exactly as every vault written before this existed. */
      inputMode: 'csv',
      /* Exchange rates, asked outright on their own screen. 'off' by default
         and 'off' if the wizard is closed, because this is the single thing
         in the plugin that makes a network request and the README's promise
         is that it makes none — quietly turning that on over somebody's
         financial vault is not a default anyone else gets to pick for them.
         `currencyCode` is the ISO code the rate lookup needs; it is asked
         alongside because no symbol identifies a currency on its own. */
      exchangeRates: 'off',
      currencyCode: '',
      /* The manual path's first budget, one entry per FIRST_BUDGET_LINES key.
         Amounts are kept as the RAW typed string, not a number: normalizeAmount
         is the reader, and parsing early would throw away "1 234,56" before the
         validation on Next ever got to complain about it. */
      firstBudget: Object.fromEntries(FIRST_BUDGET_LINES.map(line =>
        [line.key, { category: firstBudgetDefault(line), amount: '' }])),
    };
  }

  /* Manual mode, asked once and read everywhere. A bare
     `this.data.inputMode === 'manual'` spread across nine call sites is how the
     step list and the writer end up disagreeing about which path is running. */
  isManual() { return inputMode(this.data.inputMode) === 'manual'; }

  /* Rates ON *and* usable. Both halves in one place for the same reason
     isManual() exists: the screen, the validator and the writer must not each
     decide separately what "on" means. A yes with no code is not a setting
     this wizard is willing to write — it would be a vault configured to fetch
     something it can never name. */
  fxOn() {
    return this.data.exchangeRates === 'on' && !!normalizeCode(this.data.currencyCode);
  }

  /* The path being walked, recomputed on every render rather than stored.

     It has to be recomputed: the folder field on the finish screen can flip
     `mode` after the list has already been walked, which drops three screens
     out of it — see the clamp in renderStep() and goTo() below. */
  steps() {
    /* The three questions are asked on every path and in the same order, so
       the counter's total is the only thing that moves under the reader.
       `how` is last of the three because it is the one that decides the rest
       of the list — asking it earlier would leave the reader watching the
       total change while they still had questions in front of them. */
    /* `rates` sits after `how` and before anything path-specific, so it is
       asked once, on every path, in the same position — including `connect`,
       where the reader is adopting a vault that may well already hold foreign
       accounts. It is the last of the questions about the PERSON, before the
       screens about their files begin. */
    const asked = ['welcome', 'name', 'period', 'how', 'rates'];
    /* Connecting adopts a folder that already holds a budget: there are no
       categories to pick, no first account to add and no first budget to seed,
       because all three exist already and not touching them is the point. */
    if (this.mode === 'connect') return [...asked, 'finish'];
    /* The manual path swaps the CSV path's two scaffolding screens for one
       that produces something. Categories are not asked because the whole
       starter pack is created — the honest answer to "which of these thirty"
       on day one is "I don't know yet". The account is not asked because
       manual mode creates one silently; every manual transaction needs an
       account to land in. What is left is the household's own first budget. */
    return this.isManual()
      ? [...asked, 'firstBudget', 'finish']
      : [...asked, 'categories', 'account', 'finish'];
  }

  onOpen() {
    /* Apply the language BEFORE the first render. On a first run nothing has
       read Settings.md yet (there is none), so without this the wizard would
       draw itself in whatever language was last set — while its own picker
       showed the user's actual language selected. Cheap, and it keeps the
       picker and the text it governs from ever disagreeing. */
    setLanguage(this.data.language);
    this.titleEl.setText(i18n.t('wiz.title'));
    this.renderStep();
    /* Detection runs BEFORE the questions, because the questions come first.
       The three of them carry the household name, the period, the country and
       the currency — and on connect apply() writes every one of them into the
       existing Settings.md. So a wizard that discovered the existing budget
       afterwards would offer its own defaults as the answers and then write
       them over a vault that already had real ones. Adopting here means the
       first screen already shows what that vault actually says.

       Deliberately not awaited: onOpen() is called synchronously by Obsidian
       and the welcome screen is already on the glass while this reads one
       file. It re-renders itself when it lands. */
    this.adoptFolder(this.data.folder).then(mode => {
      // Only when it actually found something. Re-rendering the welcome screen
      // on the common path would be a free way to throw away an inline error
      // that a fast reader had already provoked.
      if (mode === 'connect') this.renderStep();
    }, () => {});
  }
  // async, though Obsidian never awaits a Modal's onClose(): the shared
  // Plugin.onClose() precedent (view.js) already runs async, and returning a
  // promise here is harmless since nothing reads it — the alternative is a
  // fire-and-forget saveSettings() call with nowhere to attach a catch.
  async onClose() {
    this.contentEl.empty();
    if (this.finished) return;
    // Closing on the welcome screen is not a decision — it's a tap outside the
    // modal, or an Escape from someone who hasn't read it yet. Retiring the
    // wizard there strands a brand-new user with no visible way back in, so
    // leave `onboarded` alone and ask again next launch. Past the welcome
    // screen it IS a choice: take it, and say where the wizard lives.
    if (this.stepIdx === 0) return;
    new Notice(i18n.t('wiz.skipped'), 8000);
    this.plugin.settings.onboarded = true;
    // Guarded like every other write in this app: a rejected saveSettings()
    // used to be an unhandled rejection. Nothing else here depends on it
    // landing — onboarded is already true in memory, so the wizard will not
    // reopen this session regardless; a failed write only means it reopens
    // again next launch, which the toast below explains rather than hides.
    try {
      await this.plugin.saveSettings();
    } catch (e) {
      new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
    }
  }

  /* ------------------------------ navigation ------------------------------ */
  renderStep() {
    const c = this.contentEl;
    // One-shot: taken here so any re-render (a dropdown change, Back, a
    // successful Next) clears it, and the message never outlives the mistake.
    const err = this.error;
    this.error = '';
    c.empty();
    const steps = this.steps();
    /* The list can SHRINK underneath the reader: editing the folder on the
       finish screen into one that already holds a budget takes `categories`,
       `account` and `firstBudget` out of it. Clamp rather than trust the
       index, so Back can never land past the end and `render_undefined` is
       never called. goTo() keeps the reader on the screen they were actually
       looking at; this is the backstop underneath it. */
    if (this.stepIdx >= steps.length) this.stepIdx = steps.length - 1;
    if (this.stepIdx < 0) this.stepIdx = 0;
    const step = steps[this.stepIdx];
    // The welcome screen isn't a "step" in the user's mind — no counter there.
    if (step !== 'welcome') {
      c.createDiv({ cls: 'budget-onb-step', text: i18n.t('wiz.stepOf', { n: this.stepIdx, total: steps.length - 1 }) });
      c.createEl('h3', { cls: 'budget-onb-title', text: stepTitle(step) });
    }
    this['render_' + step](c);
    if (err) c.createDiv({ cls: 'budget-onb-error', text: err });

    const nav = new Setting(c);
    nav.settingEl.addClass('budget-onb-nav');
    // Cancel first so the CSS can push it to the far left: wedged between Back
    // and Next it is a mis-tap away from leaving the wizard, on a phone, with
    // both hands busy.
    nav.addButton(b => b.setButtonText(i18n.t('wiz.cancel')).onClick(() => this.close()));
    if (this.stepIdx > 0) nav.addButton(b => b.setButtonText(i18n.t('wiz.back')).onClick(() => { this.stepIdx--; this.renderStep(); }));
    nav.addButton(b => b
      .setButtonText(step === 'finish' ? i18n.t(this.mode === 'connect' ? 'wiz.connectBtn' : 'wiz.createBtn')
        : step === 'welcome' ? i18n.t('wiz.letsGo') : i18n.t('wiz.next'))
      .setCta()
      .onClick(() => this.next()));
  }

  /* Inline, inside the modal, under the fields it is about. A corner Notice is
     easy to miss on a phone, can land behind the modal, and never says which
     field it means. */
  fail(msg) { this.error = msg; this.renderStep(); }

  /* Move to a step BY NAME. Index arithmetic is only safe while the list is
     fixed, and it is not: after the folder field flips the mode, index 2 means
     "categories" on one list and "finish" on another, so a reader who was
     looking at the summary would find themselves back among the tick-boxes. */
  goTo(name) {
    const i = this.steps().indexOf(name);
    this.stepIdx = i < 0 ? 0 : i;
    this.renderStep();
  }

  /* Point the wizard at a folder and work out what that folder means.

     The one place `mode` is decided, so create and connect can never be
     decided two ways. Prefilling is keyed on the folder rather than on a
     "was it already connect" flag: a reader who corrects the path from one
     existing budget to another must get the SECOND vault's settings, and a
     boolean cannot tell those two cases apart. */
  async adoptFolder(raw) {
    const folder = normalizePath(String(raw == null ? '' : raw).trim());
    this.data.folder = folder;
    this.mode = folder && this.detectExisting(folder) ? 'connect' : 'create';
    if (this.mode === 'connect' && this._prefilledFrom !== folder) {
      this._prefilledFrom = folder;
      await this.prefillFromSettingsMd();
    }
    return this.mode;
  }

  async next() {
    const step = this.steps()[this.stepIdx];
    /* The currency lives on the name screen, under the locale group — so a
       custom symbol left blank is caught there rather than three screens on,
       where the reader would have to work out which field it meant. */
    if (step === 'name' && this.data.currency === '__custom__' && !this.data.customCurrency.trim()) {
      this.fail(i18n.t('wiz.err.currency')); return;
    }
    if (step === 'period') {
      /* Both of these answers LOOK answered — a day of 31 and a cycle with no
         anchor are typed values, not empty fields — and both silently produce
         periods the reader never asked for. */
      if (!periodDaysOrZero(this.data.periodDays)) {
        const d = Number(this.data.payday);
        if (!Number.isInteger(d) || d < 1 || d > 28) {
          this.fail(i18n.t('wiz.err.monthStart')); return;
        }
      } else if (!isRealIsoDate(this.data.periodAnchor)) {
        // An interval with no anchor has nothing to count from — the loader
        // drops both keys and quietly hands back monthly periods, which is a
        // confusing thing to discover after finishing a wizard that asked.
        this.fail(i18n.t('wiz.err.anchor')); return;
      }
    }
    if (step === 'how') {
      /* Detection sits on the LAST of the three questions, on the way out of
         it: `how` is the answer that decides which list is walked next, so
         `mode` — the other thing that decides it — has to be settled in the
         same breath. Re-detected here rather than trusted from onOpen()
         because the reader may well have created the folder in Obsidian
         alongside the wizard while answering. */
      await this.adoptFolder(this.data.folder);
    }
    /* Zero categories scaffolds a folder the app cannot then recognise as its
       own: connectVault gates on `!S.categories.length && !txFiles`, so the
       reader got "Budget folder created — welcome!" and, one second later, an
       error card reading "Looked in Finances/Budget but found no Categories/
       or Transactions/ inside it" — which is not even true. The folder WAS
       found and Categories/ does exist; it is merely empty. Adding an account
       does not rescue it either, because its transactions folder is created
       empty too. Caught here, the way firstBudget catches five blank lines,
       and naming the way out rather than only the problem. */
    /* Only when they said yes. A blank code with rates OFF is the default and
       needs no complaint; a blank or malformed code with rates ON is a screen
       that would silently never fetch anything, which is the failure the
       reader cannot see. */
    if (step === 'rates' && this.data.exchangeRates === 'on'
      && !normalizeCode(this.data.currencyCode)) {
      this.fail(i18n.t('wiz.err.code')); return;
    }
    if (step === 'categories' && !this.data.cats.size) {
      this.fail(i18n.t('wiz.err.catsEmpty')); return;
    }
    if (step === 'firstBudget') {
      if (this.firstBudgetInvalid()) { this.fail(i18n.t('wiz.err.amount')); return; }
      /* Five blank lines is not a first budget, and the celebration that
         follows would be congratulating the reader on a file with no rows in
         it. Names the way out as well as the problem: someone with no figures
         to hand wanted the CSV path. */
      if (!this.firstBudgetRows().length) { this.fail(i18n.t('wiz.err.firstBudgetEmpty')); return; }
    }
    if (step === 'finish') {
      /* The folder is a field on THIS screen now, so this is where an empty
         one is caught. Without it a cleared field would scaffold Settings.md,
         Categories/ and Transactions/ at the root of the reader's vault. */
      if (!this.data.folder || this.data.folder === '/') { this.fail(i18n.t('wiz.err.folder')); return; }
      await this.apply(); return;
    }
    this.stepIdx++;
    this.renderStep();
  }

  detectExisting(folder) {
    const v = this.app.vault;
    return !!v.getFileByPath(normalizePath(folder + '/Settings.md')) ||
           !!v.getFolderByPath(normalizePath(folder + '/Categories'));
  }
  async prefillFromSettingsMd() {
    const f = this.app.vault.getFileByPath(normalizePath(this.data.folder + '/Settings.md'));
    if (!f) return;
    const { parseFrontmatter } = require('./markdown');
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    // Shape and phase read independently, the same way Settings.md stores them.
    // They no longer compete: a fortnightly vault keeps its cycle AND its month
    // start day, where the old mode-based read had to pick one and could
    // present a fortnightly vault as monthly, then write that back.
    /* NOTHING the reader has already answered is overwritten. This can run
       after the questions as well as before them — correcting the folder on
       the finish screen onto an existing budget adopts it right there — and
       the first version of that filled every field, so a reader who had typed
       their name, their payday and their currency watched all three change
       under them (and the modal switch language) on the keystroke that
       completed a matching path. The mode flip is the useful half; replacing
       given answers is not. */
    const untouched = k => !this.touched.has(k);
    const day = parseInt(fm.month_start_day, 10);
    if (untouched('payday') && day >= 1 && day <= 28) this.data.payday = day;
    const cycleDays = periodDaysOrZero(fm.period_days);
    const cycleAnchor = (fm.period_anchor || '').toString().trim();
    if (untouched('period') && cycleDays && isRealIsoDate(cycleAnchor)) {
      this.data.periodDays = cycleDays;
      this.data.periodAnchor = cycleAnchor;
    }
    if (untouched('country') && fm.country && PROFILES[fm.country.toString().trim().toLowerCase()]) {
      this.data.country = fm.country.toString().trim().toLowerCase();
    }
    // Absent stays as the Obsidian-derived default rather than snapping to
    // English: a vault predating this setting has no opinion, and Obsidian's
    // own language is the better guess than the fallback. Applied as well as
    // stored — this runs when an existing budget is adopted, and the rest of
    // the wizard should immediately be in that vault's language. But only when
    // the reader has not chosen one: re-rendering the modal in another
    // language mid-sentence is the most disorienting thing this class can do.
    if (untouched('language')) {
      if (fm.language) this.data.language = i18n.resolveLanguage(fm.language);
      setLanguage(this.data.language);
    }
    if (untouched('currency') && fm.currency) {
      if (CURRENCY_KEYS.some(([v]) => v === fm.currency)) this.data.currency = fm.currency;
      else { this.data.currency = '__custom__'; this.data.customCurrency = fm.currency; }
    }
    if (untouched('name') && fm.household) this.data.name = fm.household;
  }

  /* -------------------------------- steps -------------------------------- */
  render_welcome(c) {
    c.createEl('h2', { text: i18n.t('wiz.welcome.title') });
    c.createEl('p', { text: i18n.t('wiz.welcome.intro') });
    const intro = c.createEl('p');
    intro.createEl('b', { text: i18n.t('wiz.welcome.planLead') });
    const setup = c.createEl('ol', { cls: 'budget-onb-journey' });
    /* One line per question, in the order they are asked, then one for the
       setup those answers produce. The list must never promise MORE screens
       than the wizard walks — it used to promise five while the wizard asked
       seven, and a reader counts screens against it. The last line covers both
       paths in one sentence rather than branching on an answer that has not
       been given yet. */
    for (const t of [
      i18n.t('wiz.welcome.plan1'),
      i18n.t('wiz.welcome.plan2'),
      i18n.t('wiz.welcome.plan3'),
      i18n.t('wiz.welcome.plan4'),
    ]) setup.createEl('li', { text: t });
    const then = c.createEl('p');
    then.createEl('b', { text: i18n.t('wiz.welcome.thenLead') });
    const inApp = c.createEl('ol', { cls: 'budget-onb-journey' });
    for (const t of [
      i18n.t('wiz.welcome.app1'),
      i18n.t('wiz.welcome.app2'),
      i18n.t('wiz.welcome.app3'),
      i18n.t('wiz.welcome.app4'),
    ]) inApp.createEl('li', { text: t });
    c.createEl('p', { text: i18n.t('wiz.welcome.close') });
  }

  /* --------------------------- the three questions ----------------------- */
  /* What to call you, and — underneath, small, already filled in — the
     language, country and currency.

     The locale group rides along on this screen rather than getting one of its
     own because it is not really a question: the language comes from
     Obsidian's own, the country from the default and the currency from the
     country, so for most readers all three are already right and the screen is
     still a one-question screen. It sits BELOW the name for the same reason —
     the old wizard opened setup with those three dropdowns, spending its first
     screen on the questions nobody needed to answer. */
  render_name(c) {
    this.nameField(c);
    this.localeGroup(c);
  }

  nameField(c) {
    new Setting(c)
      .setName(i18n.t('wiz.name.name'))
      .setDesc(i18n.t('wiz.name.desc'))
      .addText(t => t
        .setPlaceholder(i18n.t('wiz.name.placeholder'))
        .setValue(this.data.name)
        .onChange(v => { this.data.name = v; this.touched.add('name'); }));
  }

  /* Two questions, because Settings.md holds two keys. "How often" picks the
     SHAPE (a month named YYYY-MM, or an interval named by its start date);
     the follow-up picks the PHASE (which day of the month, or which payday to
     count from). A calendar month falls out of the first question answered
     "monthly" and the second answered "the 1st" — it is not a third shape. */
  render_period(c) {
    const days = periodDaysOrZero(this.data.periodDays);
    new Setting(c)
      .setName(i18n.t('wiz.period.howOften'))
      .setDesc(i18n.t('wiz.period.howOftenDesc'))
      .addDropdown(d => {
        // periodLengthOptions, not PERIOD_PRESETS: re-running the wizard over a
        // vault whose Settings.md was hand-set to, say, 10 days must SHOW that
        // rather than silently display "Every week" over a value it kept.
        for (const [v, label] of Object.entries(periodLengthOptions(days))) d.addOption(v, label);
        d.setValue(String(days));
        d.onChange(v => { this.data.periodDays = periodDaysOrZero(v); this.touched.add('period'); this.renderStep(); });
      });
    if (!days) {
      /* A payday month is named after the month it ENDS in — start on the 25th
         and 25 Aug – 24 Sep is "September". That is the convention the whole
         app uses, and nobody derives it from a number field, so show it worked
         out with the day they actually chose. Day 1 is the calendar month, and
         says so rather than describing a period ending on "the 0th". */
      const hint = document.createElement('div');
      hint.className = 'budget-onb-hint';
      const paint = () => {
        const d = parseInt(this.data.payday, 10);
        if (!(d >= 1 && d <= 28)) {
          hint.textContent = i18n.t('wiz.period.badDay');
          return;
        }
        /* Day numbers go through i18n.day(), never a bare English "25th" —
           German wants "25.", Japanese "25日", Spanish a plain "25". */
        hint.textContent = d === 1
          ? i18n.t('wiz.period.calendarEg', { first: i18n.day(1), month: monthLabel(currentPeriodFor(1)) })
          : i18n.t('wiz.period.paydayEg', {
            start: i18n.day(d), end: i18n.day(d - 1), month: monthLabel(currentPeriodFor(d)),
          });
      };
      new Setting(c)
        .setName(i18n.t('wiz.period.startDay'))
        .setDesc(i18n.t('wiz.period.startDayDesc'))
        .addText(t => {
          t.inputEl.type = 'number';
          t.inputEl.min = '1';
          t.inputEl.max = '28';
          t.inputEl.step = '1';
          t.inputEl.inputMode = 'numeric';
          t.setValue(String(this.data.payday));
          t.onChange(v => { this.data.payday = v; this.touched.add('payday'); paint(); });
        });
      c.appendChild(hint);
      paint();
    }
    if (days) {
      const hint = document.createElement('div');
      hint.className = 'budget-onb-hint';
      const paint = () => {
        if (!isRealIsoDate(this.data.periodAnchor)) {
          hint.textContent = i18n.t('wiz.period.anchorBlank');
          return;
        }
        hint.textContent = i18n.t('wiz.period.anchorEg', { date: currentPeriodForCycle(days, this.data.periodAnchor) });
      };
      /* Deliberately blank rather than pre-filled with today or the most recent
         Friday. Nobody re-examines a date the app already filled in, so a
         confident wrong guess buys one less tap and costs a budget window
         that's silently days out — noticed weeks later, cause long forgotten.
         The wizard also runs before any transactions exist, so there is no
         history to infer a real payday from. */
      new Setting(c)
        .setName(i18n.t('wiz.period.anchorName'))
        .setDesc(i18n.t('wiz.period.anchorDesc'))
        .addText(t => {
          t.inputEl.type = 'date';
          t.setValue(this.data.periodAnchor);
          t.onChange(v => { this.data.periodAnchor = v.trim(); this.touched.add('period'); paint(); });
        });
      c.appendChild(hint);
      paint();
    }
  }

  /* Two big radio cards rather than a dropdown. This is the decision the whole
     manual path hangs off, it is asked of someone who may never have seen a
     CSV, and a one-line dropdown option cannot carry the sentence that tells
     them which one they are. Plain label + input[type=radio] + two divs — no
     innerHTML, and the whole card is the hit target on a phone.

     Re-renders on change because the step counter's TOTAL depends on the
     answer: manual is a five-step path and CSV a six-step one, and a counter
     still promising "of 6" after the answer that made it 5 is the wizard
     contradicting itself on the screen where trust is cheapest to lose. */
  render_how(c) {
    /* No Setting header above the cards: the step title IS the question now
       that this has a screen to itself, and repeating it two lines apart reads
       as a stutter. The desc stays — it is the sentence that says the answer
       is not final. */
    c.createEl('p', { text: i18n.t('wiz.how.desc') });
    const chosen = inputMode(this.data.inputMode);
    const cards = c.createDiv({ cls: 'budget-onb-choices' });
    for (const mode of ['csv', 'manual']) {
      const label = cards.createEl('label', { cls: 'budget-onb-choice' + (chosen === mode ? ' is-on' : '') });
      const radio = label.createEl('input', { type: 'radio', attr: { name: 'budget-onb-how', value: mode } });
      radio.checked = chosen === mode;
      radio.addEventListener('change', () => {
        this.data.inputMode = mode;
        this.renderStep();
      });
      const body = label.createDiv({ cls: 'budget-onb-choice-body' });
      body.createDiv({ cls: 'budget-onb-choice-title', text: i18n.t('wiz.how.' + mode + '.title') });
      body.createDiv({ cls: 'budget-onb-choice-desc', text: i18n.t('wiz.how.' + mode + '.desc') });
    }
  }

  /* The one screen that asks about the network, and the only one that has to
     earn a "no" as readily as a "yes".

     Two controls rather than one, which breaks this wizard's own one-question
     rule — deliberately, and only in the branch where the second question
     exists at all. A reader who answers "yes" has to supply an ISO code
     before a single rate can be fetched, and asking for it on a screen of its
     own would mean a whole extra step for the majority who answer "no" and a
     dead-end screen for anyone who reaches it by mistake. So the code field
     appears only once "yes" is chosen, which is the one arrangement where
     nobody is asked something that cannot apply to them. */
  render_rates(c) {
    const symbol = this.currencySymbol();
    c.createEl('p', { text: i18n.t('wiz.rates.desc', { symbol }) });
    const chosen = this.data.exchangeRates === 'on' ? 'on' : 'off';
    const cards = c.createDiv({ cls: 'budget-onb-choices' });
    /* 'off' FIRST. The order of two radio cards is an argument about which
       one is normal, and for a plugin whose headline claim is that it makes
       no network requests, the normal answer is the one that keeps that
       true. */
    for (const mode of ['off', 'on']) {
      const label = cards.createEl('label', { cls: 'budget-onb-choice' + (chosen === mode ? ' is-on' : '') });
      const radio = label.createEl('input', { type: 'radio', attr: { name: 'budget-onb-rates', value: mode } });
      radio.checked = chosen === mode;
      radio.addEventListener('change', () => {
        this.data.exchangeRates = mode;
        /* Seed the code from the country the reader already chose, so the
           common case is a field that is already right rather than a blank
           box and a puzzle. Only ever a SEED: it is theirs to correct, and
           anything they have typed is left alone. */
        if (mode === 'on' && !this.data.currencyCode) {
          this.data.currencyCode = codeForCountry(this.data.country);
        }
        this.renderStep();
      });
      const body = label.createDiv({ cls: 'budget-onb-choice-body' });
      body.createDiv({ cls: 'budget-onb-choice-title', text: i18n.t('wiz.rates.' + mode + '.title') });
      body.createDiv({ cls: 'budget-onb-choice-desc', text: i18n.t('wiz.rates.' + mode + '.desc') });
    }
    if (chosen !== 'on') return;
    new Setting(c)
      .setName(i18n.t('wiz.rates.code'))
      .setDesc(i18n.t('wiz.rates.codeDesc', { symbol }))
      .addText(t => t
        .setPlaceholder('ZAR')
        .setValue(this.data.currencyCode)
        .onChange(v => { this.data.currencyCode = v; }));
  }

  /* Language, country and currency, in that order and under one heading.

     The country picks the currency, so splitting them meant the wizard asked
     the same question twice in a row and the second control had to apologise
     for the first. Language sits first because it governs everything the
     wizard says after it — but it is NOT a fourth thing the country decides.
     Country and language are separate axes on purpose (see the header of
     i18n.js), which is why changing the country dropdown leaves this one
     alone: someone living in Germany may still want the app in English. */
  localeGroup(c) {
    c.createDiv({ cls: 'budget-onb-group', text: i18n.t('wiz.locale.group') });
    new Setting(c)
      .setName(i18n.t('settings.language.name'))
      .setDesc(i18n.t('wiz.language.desc'))
      .addDropdown(d => {
        for (const id of LANGUAGE_ORDER) d.addOption(id, LANGUAGE_NAMES[id]);
        d.setValue(i18n.resolveLanguage(this.data.language));
        d.onChange(v => {
          this.data.language = v;
          this.touched.add('language');
          // Apply immediately so the rest of the wizard — and the summary on
          // the final step — is already in the chosen language, rather than
          // only taking effect once the budget is created.
          setLanguage(v);
          this.renderStep();
        });
      });
    new Setting(c)
      .setName(i18n.t('settings.country.name'))
      .setDesc(i18n.t('wiz.country.desc'))
      .addDropdown(d => {
        for (const code of COUNTRY_ORDER) d.addOption(code, PROFILES[code].label);
        d.setValue(this.data.country);
        d.onChange(v => {
          this.data.country = v;
          /* The currency counts as answered too: it is the country's, and the
             reader accepted it by choosing the country. Adopting a vault must
             not then swap in a third symbol neither of them named. */
          this.touched.add('country'); this.touched.add('currency');
          this.data.currency = CURRENCY_KEYS.some(([cv]) => cv === PROFILES[v].currency) ? PROFILES[v].currency : '__custom__';
          if (this.data.currency === '__custom__') this.data.customCurrency = PROFILES[v].currency;
          // Re-render so the currency control below actually shows the country's
          // currency. Without this the two controls silently disagree, and the
          // one the user can see is the wrong one.
          this.renderStep();
        });
      });
    new Setting(c)
      .setName(i18n.t('settings.currency.name'))
      .setDesc(i18n.t('wiz.currency.desc'))
      .addDropdown(d => {
        for (const [v, label] of currencies()) d.addOption(v, label);
        d.setValue(this.data.currency);
        d.onChange(v => { this.data.currency = v; this.touched.add('currency'); this.renderStep(); });
      });
    if (this.data.currency === '__custom__') {
      new Setting(c)
        .setName(i18n.t('wiz.currency.custom'))
        .addText(t => t
          .setPlaceholder(i18n.t('wiz.currency.customPlaceholder'))
          .setValue(this.data.customCurrency)
          .onChange(v => { this.data.customCurrency = v; this.touched.add('currency'); }));
    }
  }

  render_categories(c) {
    c.createEl('p', { text: i18n.t('wiz.cats.intro') });

    const boxes = [];
    const bar = c.createDiv({ cls: 'budget-onb-catbar' });
    const count = bar.createEl('span', { cls: 'budget-onb-catcount' });
    const paintCount = () => {
      count.textContent = i18n.t('wiz.cats.selected', { count: this.data.cats.size, total: STARTER_CATEGORIES.length });
    };
    const setAll = on => {
      for (const { cb, cat } of boxes) {
        cb.checked = on;
        if (on) this.data.cats.add(cat.name); else this.data.cats.delete(cat.name);
      }
      paintCount();
    };
    bar.createEl('button', { text: i18n.t('wiz.cats.selectAll'), cls: 'budget-onb-catbtn', attr: { type: 'button' } })
      .addEventListener('click', () => setAll(true));
    bar.createEl('button', { text: i18n.t('wiz.cats.selectNone'), cls: 'budget-onb-catbtn', attr: { type: 'button' } })
      .addEventListener('click', () => setAll(false));

    // Grouped by type, in the app's own type order. The colour swatch is the
    // one shown on every chart and pill later, so this doubles as a preview.
    for (const type of TYPE_ORDER) {
      const inType = STARTER_CATEGORIES.filter(x => x.type === type);
      if (!inType.length) continue;
      c.createDiv({ cls: 'budget-onb-cat-group', text: typeLabel(type) });
      const grid = c.createDiv({ cls: 'budget-onb-cats' });
      for (const cat of inType) {
        const label = grid.createEl('label');
        const cb = label.createEl('input', { type: 'checkbox' });
        cb.checked = this.data.cats.has(cat.name);
        cb.addEventListener('change', () => {
          if (cb.checked) this.data.cats.add(cat.name); else this.data.cats.delete(cat.name);
          paintCount();
        });
        label.createEl('span', { cls: 'budget-onb-swatch' }).style.background = cat.color;
        label.appendText(` ${cat.name}`);
        boxes.push({ cb, cat });
      }
    }
    paintCount();
  }

  render_account(c) {
    c.createEl('p', { text: i18n.t('wiz.acct.intro') });
    new Setting(c)
      .setName(i18n.t('wiz.acct.name'))
      .addText(t => t
        .setPlaceholder(i18n.t('wiz.acct.namePlaceholder'))
        .setValue(this.data.acctName)
        .onChange(v => { this.data.acctName = v; }));
    new Setting(c)
      .setName(i18n.t('wiz.acct.type'))
      .addDropdown(d => {
        for (const [v, label] of accountTypes()) d.addOption(v, label);
        d.setValue(this.data.acctType);
        d.onChange(v => { this.data.acctType = v; });
      });
    new Setting(c)
      .setName(i18n.t('wiz.acct.institution'))
      .setDesc(i18n.t('wiz.acct.institutionDesc'))
      .addText(t => t
        .setValue(this.data.acctInstitution)
        .onChange(v => { this.data.acctInstitution = v; }));
    new Setting(c)
      .setName(i18n.t('wiz.acct.balance'))
      .setDesc(i18n.t('wiz.acct.balanceDesc'))
      .addText(t => {
        t.inputEl.type = 'number';
        t.inputEl.step = '0.01';
        t.setPlaceholder('0.00')
          .setValue(this.data.acctBalance)
          .onChange(v => { this.data.acctBalance = v; });
      });
    c.createDiv({ cls: 'budget-onb-hint', text: i18n.t('wiz.acct.balanceHint') });
  }

  /* The manual path's whole reason for existing: a household that has typed
     nothing yet leaves this wizard with a real budget file already on disk.

     Five fixed lines, each a category and an amount. Blank is a legitimate
     answer — the intro says so — and a blank line is simply not written.

     ONE reader for the amounts, firstBudgetRows(), used by the live hint here,
     the summary on the finish step and the writer in apply(). The wizard has
     already been bitten by exactly this: the opening-balance figure was parsed
     one way for the confirmation screen and another way for the file, so
     someone typing "15,000" was shown 15.00 and then had 15.00 written. */
  render_firstBudget(c) {
    c.createEl('p', { text: i18n.t('wiz.first.intro') });

    const hint = document.createElement('div');
    hint.className = 'budget-onb-hint';
    const paint = () => {
      const { income, spend, left } = this.firstBudgetTotals();
      /* Only once income has a figure. "Income R 0.00 − planned R 4 500.00 =
         −R 4 500.00 left over" is arithmetic the reader never asked for, on a
         screen they are still filling in, and it reads as a verdict. */
      hint.textContent = income > 0
        ? i18n.t('wiz.first.left', {
          income: this.moneyText(income), spend: this.moneyText(spend), left: this.moneyText(left),
        })
        : i18n.t('wiz.first.blank');
    };

    for (const line of FIRST_BUDGET_LINES) {
      const entry = this.data.firstBudget[line.key];
      const row = new Setting(c)
        .setName(i18n.t(line.label))
        .addDropdown(d => {
          /* Category NAMES stay English — they are vault data, the same rule
             the category step and every account type follow. Only the LABEL to
             the left of this control is translated. */
          for (const cat of firstBudgetOptions(line)) d.addOption(cat.name, cat.name);
          d.setValue(entry.category);
          d.onChange(v => { entry.category = v; paint(); });
        })
        .addText(t => {
          /* Text, not a number input, even though the account-balance field
             next door is one. A number input hands back an empty string for
             anything it cannot parse, so "1 234,56" — which normalizeAmount and
             the loader both read perfectly — would VANISH silently on the way
             to the writer, and the validation below would never get to say so.
             inputMode decimal still brings up the numeric keypad on iOS. */
          t.inputEl.type = 'text';
          t.inputEl.inputMode = 'decimal';
          t.inputEl.setAttribute('aria-label', i18n.t(line.label));
          t.setPlaceholder('0.00')
            .setValue(entry.amount)
            .onChange(v => { entry.amount = v; paint(); });
        });
      /* Obsidian's own stacking class, not a rule of ours. On a phone the host
         stylesheet gives every control inside .modal .setting-item-control a
         width of 100%, and this is the only row in the wizard that carries TWO
         of them — a category dropdown and an amount — so the pair get squeezed
         side by side into half a field each. mod-vertical is what the host
         ships for exactly this, so the fix survives the next app.css revision
         in a way a counter-rule of our own would not. */
      row.controlEl.addClass('mod-vertical');
    }
    c.appendChild(hint);
    paint();
  }

  /* Every non-blank amount must be readable and not negative. Blank is fine.
     Zero is fine and simply is not written — "we don't spend anything on this"
     and "I haven't decided" produce the same file, and neither is an error. */
  firstBudgetInvalid() {
    for (const line of FIRST_BUDGET_LINES) {
      const raw = ((this.data.firstBudget[line.key] || {}).amount || '').toString().trim();
      if (!raw) continue;
      const n = normalizeAmount(raw);
      if (n == null || !(n >= 0)) return true;
    }
    return false;
  }

  /* The five lines as they will be WRITTEN: blank and zero dropped, amounts
     read by normalizeAmount (the loader's own reader), and two lines pointed at
     one category MERGED rather than emitted twice. The merge is not tidiness —
     load.js reads a budget file straight into a list, so a duplicate category
     would show up twice on the Budget page and be counted twice in every total
     derived from it. */
  firstBudgetRows() {
    const byName = new Map();
    for (const line of FIRST_BUDGET_LINES) {
      const entry = this.data.firstBudget[line.key] || {};
      const amount = normalizeAmount(entry.amount);
      if (!amount || amount < 0) continue;
      const cat = STARTER_CATEGORIES.find(x => x.name === entry.category);
      if (!cat) continue;
      const prev = byName.get(cat.name);
      if (prev) prev.amount += amount;
      else byName.set(cat.name, { category: cat.name, type: cat.type, amount, notes: '' });
    }
    return [...byName.values()];
  }

  /* Income, planned spend and what is left, off the SAME rows the writer uses.
     `spend` is everything that is not income — including savings, which is
     money leaving the current account whatever else it is. */
  firstBudgetTotals() {
    const rows = this.firstBudgetRows();
    let income = 0, spend = 0;
    for (const r of rows) {
      if (r.type === 'income') income += r.amount; else spend += r.amount;
    }
    return { rows, income, spend, left: income - spend };
  }

  /* One money formatter for the wizard, so the hint, the summary and the
     opening-balance line cannot disagree about how a figure reads. Deliberately
     plainer than the app's money(): the locale profile the app formats with
     belongs to a vault that does not exist yet. */
  moneyText(n) {
    return `${this.currencySymbol()} ${(Number(n) || 0).toFixed(2)}`;
  }

  /* The budget folder, on the LAST screen rather than the first.

     It was the wizard's opening question for eleven versions, and it is the
     one question a brand-new reader has no basis for answering: they have not
     seen the app, they do not know what goes in the folder, and the default is
     right for nine of ten. Asking it first spent the wizard's most valuable
     screen — the one where somebody is still deciding whether to bother — on a
     text field. It is still here, still editable, still with the live hint
     that says exactly what is about to happen, for the tenth.

     Re-renders only when the MODE changes, never on every keystroke:
     rebuilding the step under a text field takes the focus with it, which on a
     phone dismisses the keyboard mid-path. A mode change is a different
     matter — the callout, the summary and the button all become wrong at
     once — and it can only happen on the keystroke that completes a path to a
     budget that already exists. */
  finishFolder(c) {
    const hint = document.createElement('div');
    hint.className = 'budget-onb-hint';
    const paint = () => {
      const f = this.data.folder;
      if (!f || f === '/') { hint.textContent = i18n.t('wiz.folder.blank'); return; }
      if (this.mode === 'connect') hint.textContent = i18n.t('wiz.folder.found', { folder: f });
      else if (this.app.vault.getFolderByPath(f)) hint.textContent = i18n.t('wiz.folder.exists', { folder: f });
      else hint.textContent = i18n.t('wiz.folder.willCreate', { folder: f });
    };
    new Setting(c)
      .setName(i18n.t('wiz.folder.name'))
      .setDesc(i18n.t('wiz.folder.desc'))
      .addText(t => t
        .setPlaceholder('Finances/Budget')
        .setValue(this.data.folder)
        .onChange(async v => {
          const before = this.mode;
          await this.adoptFolder(v);
          /* goTo, not stepIdx++/--: connect and create number their steps
             differently, so the index that meant "finish" a moment ago can
             mean "categories" now. */
          if (this.mode !== before) { this.goTo('finish'); return; }
          paint();
        }));
    c.appendChild(hint);
    paint();
  }

  render_finish(c) {
    this.finishFolder(c);
    /* The callout, not the hint above it, is where connecting is EXPLAINED —
       what it rewrites and, more importantly, what it leaves alone. It lives
       on this screen now because this is the screen the folder is chosen on;
       it used to sit on the step after the folder step, which no longer
       exists. */
    if (this.mode === 'connect') {
      c.createDiv({
        cls: 'budget-onb-callout',
        text: i18n.t('wiz.folder.connected', { folder: this.data.folder }),
      });
    }
    const day = this.monthStartDay();
    const cd = this.cycleDays();
    const rows = [
      [i18n.t('wiz.sum.name'), this.data.name.trim() || '—'],
      [i18n.t('wiz.sum.language'), LANGUAGE_NAMES[i18n.resolveLanguage(this.data.language)]],
      [i18n.t('wiz.sum.country'), localeFor(this.data.country).label],
      [i18n.t('wiz.sum.period'), cd
        ? i18n.t('wiz.sum.cycleFrom', {
          preset: PERIOD_PRESETS[cd] || `Every ${cd} days`, date: this.data.periodAnchor,
        })
        : day === 1 ? i18n.t('wiz.sum.monthlyCalendar')
          : i18n.t('wiz.sum.monthlyOn', { day: i18n.day(day) })],
      [i18n.t('wiz.sum.currency'), this.currencySymbol()],
    ];
    if (this.mode === 'create') {
      rows.push([i18n.t('wiz.sum.categories'), i18n.t('wiz.sum.catCount', { count: this.chosenCategories().size })]);
      rows.push([i18n.t('wiz.sum.account'), this.accountName() || '—']);
      const bal = this.openingBalance();
      if (this.accountName() && bal !== 0) rows.push([i18n.t('wiz.sum.opening'), this.moneyText(bal)]);
      if (this.isManual()) {
        /* Off firstBudgetRows(), the same list the writer emits — so a line
           the summary counts is a line that lands in the file, and a merged
           pair counts once here exactly as it is written once there. */
        const { rows: budgetRows, spend } = this.firstBudgetTotals();
        rows.push([i18n.t('wiz.sum.firstBudget'),
          i18n.t('wiz.sum.firstBudgetLines', { count: budgetRows.length, amount: this.moneyText(spend) })]);
      }
    }
    c.createEl('p', {
      text: i18n.t(this.mode === 'connect' ? 'wiz.finish.connectLead' : 'wiz.finish.createLead'),
    });
    const ul = c.createEl('ul');
    for (const [k, v] of rows) {
      const li = ul.createEl('li');
      li.createEl('b', { text: k + ': ' });
      li.appendText(v);
    }
    /* The welcome screen promised "then the fun starts in the app" and then the
       modal closes onto an empty dashboard. Name the first two moves, and warn
       about the privacy splash — otherwise the very first thing after finishing
       setup is an unexplained lock screen. */
    const next = c.createEl('p');
    next.createEl('b', { text: i18n.t('wiz.finish.nextLead') });
    /* A manual household has no CSV to import and no Import page in front of
       them, so the CSV wording would end setup by pointing at a door this path
       deliberately closed. */
    next.appendText(i18n.t(this.isManual() ? 'wiz.finish.nextBody.manual' : 'wiz.finish.nextBody'));
    c.createDiv({ cls: 'budget-onb-hint', text: i18n.t('wiz.finish.privacy') });
  }

  /* -------------------------------- apply --------------------------------- */
  /* Always the phase of the month shape — including when an interval is chosen,
     where month_start_day is still written so that turning the interval off
     later lands on a sensible month rather than the 1st by accident. */
  monthStartDay() {
    return Math.min(28, Math.max(1, parseInt(this.data.payday, 10) || 25));
  }
  /* 0 unless an interval was chosen AND has an anchor to count from. Both keys
     are written together or not at all, mirroring the loader, which drops both
     when either is unusable. Choosing "monthly" sets periodDays to 0, so a
     stale anchor left by a back-step can no longer resurrect a cycle — that
     used to need an explicit mode check here. */
  cycleDays() {
    return isRealIsoDate(this.data.periodAnchor) ? periodDaysOrZero(this.data.periodDays) : 0;
  }
  cycleAnchor() { return this.cycleDays() ? this.data.periodAnchor : ''; }
  /* The period the seeded budget file is named for — a date for a cycle, a
     month otherwise. This is what pins the first file to the shape the rest of
     the app will look for; getting it wrong leaves a new user staring at an
     empty Budgets page on the day they finish the wizard. */
  firstPeriod() {
    const d = this.cycleDays();
    return d ? currentPeriodForCycle(d, this.cycleAnchor()) : currentPeriodFor(this.monthStartDay());
  }
  currencySymbol() {
    return (this.data.currency === '__custom__' ? this.data.customCurrency.trim() : this.data.currency) || 'R';
  }
  /* The typed opening balance as a number, 0 if it can't be read. One method
     rather than the same expression on the summary step and again in the
     writer: those two used a local parser that mapped ',' to '.' and stripped
     the rest, so someone typing a grouped "15,000" was SHOWN 15.00 on the
     confirmation screen and then had 15.00 written into their account file.
     normalizeAmount reads what the loader reads, so the figure the summary
     promises is the figure that lands on disk. */
  openingBalance() {
    if (this.isManual()) return 0;    // see accountInstitution() for why
    return normalizeAmount(this.data.acctBalance) ?? 0;
  }

  /* The category names the create path will write.

     Manual mode creates the WHOLE starter pack and ignores `data.cats`, which
     is the promise the module header makes and which the tick-boxes could
     quietly break: the categories screen is not on the manual path, but its
     state survives a visit to it, so a reader who unticked twenty categories
     on the CSV path and then switched to manual would have had a first budget
     written whose rows point at categories that were never created —
     firstBudgetRows() draws from STARTER_CATEGORIES, not from this set. One
     reader for both, so the budget and the categories cannot disagree. */
  chosenCategories() {
    return this.isManual() ? new Set(STARTER_CATEGORIES.map(c => c.name)) : this.data.cats;
  }

  /* The account the create path will write, and the type it will carry.

     Manual mode never shows the account step, and creates one silently instead
     of none. That is not a convenience: every manual transaction has to land in
     an account (the Transactions page refuses with tx.add.noAccount when there
     is none), so a manual household finishing this wizard with no account would
     hit that wall on their very first action — the one moment the whole path
     exists to make painless. Checking, zero balance, no institution: nothing is
     claimed about a bank the wizard never asked about, and the balance is a
     figure the household can state later on the Accounts page. */
  accountName() {
    return this.isManual() ? i18n.t('wiz.manual.defaultAccount') : this.data.acctName.trim();
  }
  /* Institution and opening balance, gated the same way the name and type are.

     `data.cats`, `acctInstitution` and `acctBalance` all survive a visit to a
     screen the reader then backed out of: tick through the CSV path, type a
     bank and a balance, go back to "how will you add your spending" and choose
     manual, and those two values are still sitting in `data`. They would then
     have been written onto an account the manual reader never saw a form for —
     an institution and an opening balance appearing out of nowhere on "My
     account". Manual mode claims nothing about a bank it never asked about. */
  accountInstitution() {
    return this.isManual() ? '' : this.data.acctInstitution.trim();
  }
  accountType() {
    return this.isManual() ? 'checking' : this.data.acctType;
  }

  /* The wizard's writes go through the SAME machinery as everyone else's.
     These used to be hand-rolled copies of io.js's ensureFolder and
     `_lastWrite` stamping — the only writes in the app with no containment
     check, on a folder that comes from a text field. makeIo needs only
     { vault, plugin }, both of which exist before any view does; the method
     names stay so call sites don't change. */
  io() {
    return makeIo({ vault: this.app.vault, plugin: this.plugin });
  }
  /* Returns whether it actually wrote. io.js has always reported this and the
     wizard has always thrown it away, which was harmless for the empty
     scaffold files and is not for the manual path's first budget: a folder
     that already held Budgets/<period>.md kept its own file, correctly, while
     the celebration screen told the reader theirs had been saved. */
  async writeIfAbsent(path, content) {
    return this.io().createVaultFileIfAbsent(path, content);
  }
  async ensureFolder(path) {
    await this.io().ensureVaultFolder(path);
  }

  /* Only the manual CREATE path celebrates. Connecting to an existing budget
     is not a first budget, and the CSV path ends on an import the household
     still has to do — a confetti burst over "now go and find a CSV" would be
     congratulating them on work not yet done. */
  celebrates() {
    return this.mode === 'create' && this.isManual();
  }

  /* The last screen: the budget is already on disk when this renders.

     No step counter — this is not a step, it is the end. One CTA, and closing
     the modal any other way is equally fine (finished is already true). The
     button, not apply(), calls activateView(): opening the pane is the reader's
     move, and doing it underneath a celebration they have not read yet just
     yanks the modal's backdrop out from under them. */
  renderCelebrate() {
    const c = this.contentEl;
    c.empty();
    const hero = c.createDiv({ cls: 'budget-onb-celebrate' });
    hero.createEl('h2', { cls: 'budget-onb-celebrate-title', text: i18n.t('wiz.celebrate.title') });
    /* Two sentences, and which one is the truth depends on what happened on
       disk. writeIfAbsent declines when a budget for that period is already
       there — the reader pointed the wizard at a folder that had one — and
       saying "your budget is saved" over a file the wizard deliberately did
       not touch would be the app's first statement to this household, and
       false. The app argues; it never quietly claims. */
    hero.createEl('p', {
      cls: 'budget-onb-celebrate-body',
      text: i18n.t(this.budgetWritten === false ? 'wiz.celebrate.bodyKept' : 'wiz.celebrate.body',
        { period: this.periodLabel() }),
    });
    this.confetti(hero);
    const nav = new Setting(c);
    nav.settingEl.addClass('budget-onb-nav');
    nav.addButton(b => b
      .setButtonText(i18n.t('wiz.celebrate.cta'))
      .setCta()
      .onClick(async () => {
        this.close();
        await this.plugin.activateView();
      }));
  }

  /* "Aug 2026" for a month-shaped period, the start date itself for a cycle —
     a cycle's period IS named by its start date, and rewriting that as a month
     would name a window the app does not use. */
  periodLabel() {
    const period = this.firstPeriod();
    return this.cycleDays() ? period : monthLabel(period);
  }

  /* A confetti burst, deliberately the same shape as celebrate() in
     views/score.js — read its header for why this is CSS keyframes and not
     requestAnimationFrame (rAF is starved to nothing while the pane is hidden,
     which would freeze a half-drawn shower on screen).

     Pieces are derived from the index rather than drawn at random so the same
     screen celebrates the same way twice; a shower that reshuffles on a
     re-render reads as a glitch. Asked live rather than cached, because a
     reader who turns reduced motion on means it now. The window guards are not
     ceremony: this class is constructed in bare node by the wizard's own guard
     test, where neither window nor a real document exists. */
  confetti(hero) {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') { return; }

    const burst = hero.createDiv({ cls: 'budget-onb-confetti', attr: { 'aria-hidden': 'true' } });
    for (let i = 0; i < 28; i++) {
      const left = ((i * 37) % 100);
      const delay = ((i % 6) * 90);
      const drift = ((i % 5) - 2) * 24;
      const spin = 180 + ((i % 4) * 120);
      burst.createEl('i', { cls: `budget-onb-confetti-bit tone-${i % 4}` })
        .setAttribute('style', `left:${left}%;animation-delay:${delay}ms;--bud-drift:${drift}px;--bud-spin:${spin}deg`);
    }
    /* Taken down rather than left in the DOM, same as the score page's: the
       modal can sit open for as long as the reader likes, and a hundred spent
       nodes under it is this screen's own small leak. */
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(() => { if (burst.remove) { burst.remove(); } }, 2600);
    }
  }

  async apply() {
    const p = this.plugin;
    const folder = this.data.folder;
    const day = this.monthStartDay();
    const cur = this.currencySymbol();
    const name = this.data.name.trim();
    try {
      p.settings.budgetFolder = folder;
      if (this.mode === 'connect') {
        await p.saveSettings();
        await p.updateBudgetSettingsMd('month_start_day', String(day));
        // Written even when 0/'' so that connecting a fortnightly vault and
        // choosing a monthly period actually clears the cycle, rather than
        // leaving the old keys behind to win over the answer just given.
        await p.updateBudgetSettingsMd('period_days', String(this.cycleDays()));
        await p.updateBudgetSettingsMd('period_anchor', this.cycleAnchor());
        await p.updateBudgetSettingsMd('currency', yamlStr(cur));
        await p.updateBudgetSettingsMd('country', this.data.country);
        await p.updateBudgetSettingsMd('language', i18n.resolveLanguage(this.data.language));
        /* Written on connect too, and unconditionally: the how screen asked,
           so the answer belongs in the file. An existing CSV vault whose owner
           answers "CSV" gets the key stated rather than left absent — same
           value, but now visible to anyone reading Settings.md. */
        await p.updateBudgetSettingsMd('input_mode', inputMode(this.data.inputMode));
        /* Only when the reader turned it ON. An adopted vault that has been
           running happily with no `exchange_rates` key must not have one
           written just because the wizard walked past the screen — an absent
           key is the off state, and writing "off" into somebody else's
           Settings.md is a change where none was asked for. */
        if (this.fxOn()) {
          await p.updateBudgetSettingsMd('exchange_rates', 'on');
          await p.updateBudgetSettingsMd('currency_code', yamlStr(normalizeCode(this.data.currencyCode)));
        }
        if (name) await p.updateBudgetSettingsMd('household', yamlStr(name));
      } else {
        for (const sub of ['Categories', 'Accounts', 'Budgets', 'Transactions', 'Tax', 'Data']) {
          await this.ensureFolder(normalizePath(`${folder}/${sub}`));
        }
        await this.writeIfAbsent(normalizePath(`${folder}/Settings.md`),
          `---\nmonth_start_day: ${day}\n` +
          (this.cycleDays() ? `period_days: ${this.cycleDays()}\nperiod_anchor: ${this.cycleAnchor()}\n` : '') +
          `currency: ${yamlStr(cur)}\ncountry: ${this.data.country}\n` +
          `language: ${i18n.resolveLanguage(this.data.language)}\n` +
          `input_mode: ${inputMode(this.data.inputMode)}\n` +
          (this.fxOn()
            ? `exchange_rates: on\ncurrency_code: ${yamlStr(normalizeCode(this.data.currencyCode))}\n`
            : '') +
          (name ? `household: ${yamlStr(name)}\n` : '') +
          `tags: [finance, finance/budget, vault-meta]\n---\n\n# Budget Settings\n\n` +
          `- **month_start_day** — the financial period starts on this day of the month.\n` +
          (this.cycleDays()
            ? `- **period_days** — periods run this many days instead of a month. Remove it to go back to monthly.\n` +
              `- **period_anchor** — a payday every period is counted from. Only where it falls within the cycle matters.\n`
            : '') +
          `- **currency** — symbol shown before every amount in the Budget Vault plugin.\n` +
          `- **country** — drives amount formatting, statement date order and the Tax view (za, us, uk, eu, au, ca, cn, other).\n` +
          `- **language** — the language the app is written in (${LANGUAGE_ORDER.join(', ')}). Separate from country: neither decides the other.\n` +
          `- **input_mode** — how transactions get in: \`csv\` (import bank statements) or \`manual\` (type them in). Manual hides the Import CSV link and the top-bar import button; nothing is deleted either way.\n` +
          (this.fxOn()
            ? `- **exchange_rates** — \`on\` lets the plugin fetch daily rates so accounts in other currencies can be added into your totals. It is the only thing here that uses the internet, and it sends nothing but a currency code. Remove the key or set it to \`off\` to stop.\n` +
              `- **currency_code** — the ISO code the rate lookup asks for. The \`currency\` symbol above is what gets printed; this says which currency that symbol means.\n`
            : '') +
          `- **household** — name shown in the dashboard greeting.\n` +
          /* Documented although the wizard does not WRITE it: absent means the
             default of 6, and materialising a line that says nothing would
             freeze today's default into the file. A reader learns which keys
             exist from this list, so a settable key left out of it is a key
             nobody finds — and this one only does anything once an account is
             earmarked, which is the half that needs saying out loud. */
          `- **emergency_target_months** — months of essential spending your emergency fund aims to cover (default 6). Mark the account holding it with "Emergency fund" on the Accounts page.\n\n` +
          `Edit the values above directly, or change them in **Settings → Budget Vault** —\n` +
          `the plugin writes them back to this file, so they sync to every device with the vault.\n`);
        for (const cat of STARTER_CATEGORIES) {
          if (!this.chosenCategories().has(cat.name)) continue;
          const safe = safeFileName(cat.name);
          const nameLine = safe !== cat.name ? `name: ${yamlStr(cat.name)}\n` : '';
          await this.writeIfAbsent(normalizePath(`${folder}/Categories/${safe}.md`),
            `---\n${nameLine}type: ${cat.type}\ncolor: ${yamlStr(cat.color)}\ntags: [finance, finance/budget, finance/budget/categories]\n---\n\n# ${cat.name}\n\nBudget category of type **${cat.type}**.\n`);
        }
        const acct = this.accountName();
        if (acct) {
          const safe = safeFileName(acct);
          const ymd = todayIso();
          const bal = this.openingBalance();
          await this.writeIfAbsent(normalizePath(`${folder}/Accounts/${safe}.md`),
            `---\ntype: ${this.accountType()}\n` +
            // Free text from a wizard field — quoted like every other scalar:
            // a bare colon-space in a bank's name would fork the key mid-value.
            (this.accountInstitution() ? `institution: ${yamlStr(this.accountInstitution())}\n` : '') +
            `balance: ${bal.toFixed(2)}\nbalance_updated: ${ymd}\ntags: [finance, finance/budget, finance/budget/accounts]\n---\n\n# ${acct}\n\nTransactions are stored under \`Transactions/${safe}/\` as monthly files.\n`);
          await this.ensureFolder(normalizePath(`${folder}/Transactions/${safe}`));
        }
        const period = this.firstPeriod();
        /* The SAME serializer the Budget page saves with — see budget-file.js.
           For an interval-shaped period the period name IS its start date,
           which is what the range note needs; for a monthly one the note reads
           off month_start_day and never mentions a start date at all. So the
           note is honest in both shapes without the wizard inventing a range. */
        this.budgetWritten = await this.writeIfAbsent(normalizePath(`${folder}/Budgets/${period}.md`),
          serializeBudgetFile({
            period,
            rawFrontmatter: BUDGET_FRONTMATTER,
            rows: this.isManual() ? this.firstBudgetRows() : [],
            rangeNote: budgetRangeNote({
              monthStartDay: day,
              intervalDays: this.cycleDays(),
              periodStart: period,
              periodAnchor: this.cycleAnchor(),
            }),
          }));
        await this.writeIfAbsent(normalizePath(`${folder}/Owed Money.md`),
          `---\nkind: owed\ntags: [finance, finance/budget, finance/budget/owed-money]\n---\n\n# Owed Money\n\n` +
          `Money owed to the household. \`status\` is \`outstanding\` or \`paid\`.\n\n` +
          `| Person | Amount | Description | Due date | Status |\n|--------|-------:|-------------|----------|--------|\n`);
        await this.writeIfAbsent(normalizePath(`${folder}/Debts.md`),
          `---\nkind: debts\ntags: [finance, finance/budget, finance/budget/debts]\n---\n\n# Debts\n\n` +
          `Money the household owes. \`rate\` is the annual interest rate as a percentage,\n` +
          `\`payment\` the contracted monthly amount and \`extra\` anything paid on top of it.\n` +
          `\`status\` is \`active\` or \`paid\`.\n\n` +
          `| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n` +
          `|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|\n`);
        await this.writeIfAbsent(normalizePath(`${folder}/Services.md`),
          `---\nkind: services\ntags: [finance, finance/budget, finance/budget/services]\n---\n\n# Services & Subscriptions\n\n` +
          `Recurring services and subscriptions. \`cycle\` is \`monthly\` or \`annual\`.\n\n` +
          `| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|------|----------|-------:|-------|--------------|----------|--------|-------|\n`);
        await this.writeIfAbsent(normalizePath(`${folder}/Data/Categorisation Rules.csv`), 'pattern,category\n');
      }
      p.settings.onboarded = true;
      await p.saveSettings();
      /* Before any early return below: onClose() reads this to decide whether
         a dismissal was a "not now". Dismissing the celebration screen is not
         skipping setup — setup is done — and toasting that it had been skipped
         would be the wizard's last word to a household that just finished it. */
      this.finished = true;
      /* The manual create path stays open on a celebration screen instead of
         closing onto a dashboard the reader has to work out for themselves.
         reloadViews() still runs here so the new files are read; activateView()
         moves to the button, which is the reader's own "I'm ready". Nothing
         about the CSV path changes. */
      if (this.celebrates()) {
        p.reloadViews();
        this.renderCelebrate();
        return;
      }
      this.close();
      new Notice(i18n.t(this.mode === 'connect' ? 'wiz.done.connected' : 'wiz.done.created'));
      p.reloadViews();
      /* Land a freshly-created CSV vault on Budgets, not the Dashboard. The
         manual path already ends somewhere with something on it — it wrote
         real budget rows and gets a celebration screen — but the CSV path is
         the DEFAULT, and it finished on a hero reading R0,00, three zero tiles
         and three empty states, thirty seconds after being told to "give your
         categories an amount on the Budgets page". Budgets is already seeded
         with every category the reader just picked, so it is the one screen
         where the setup they just did is visible. */
      /* Guarded, and deliberately not awaited into the failure path: where the
         reader LANDS is a courtesy, and a courtesy must never be able to
         report a completed setup as "Setup failed". */
      if (this.mode === 'create' && !this.isManual() && typeof p.forEachView === 'function') {
        try { p.forEachView(ctl => ctl.parkView && ctl.parkView('budgets')); } catch (_) { /* land wherever */ }
      }
      await p.activateView();
    } catch (e) {
      new Notice(i18n.t('wiz.failed', { error: e.message || e }), 8000);
    }
  }
}

module.exports = { OnboardingWizard, STARTER_CATEGORIES };
