'use strict';
/* First-run onboarding wizard. Collects the budget folder, a display name,
   the period convention, currency and (for a fresh folder) starter categories
   plus a first account, then scaffolds every file the loader expects.
   Obsidian Modal + Setting controls only, so it works on iOS like the rest
   of the app. Nothing is written to disk until the final step's button. */

const { Modal, Setting, Notice, normalizePath, TFile, TFolder } = require('obsidian');
const { PROFILES, COUNTRY_ORDER, localeFor } = require('./locale');
const { PERIOD_PRESETS, periodLengthOptions, TYPE_ORDER, MONTHS } = require('./constants');
const { isoDayNumber, periodDaysOrZero, isRealIsoDate } = require('./util');


/* Generic starter pack — types come from TYPE_ORDER in constants.js. The
   user unticks what they don't want; more can be added in-app afterwards. */
const STARTER_CATEGORIES = [
  { name: 'Salary', type: 'income', color: '#22c55e' },
  { name: 'Other income', type: 'income', color: '#4ade80' },
  { name: 'Groceries', type: 'expense', color: '#f59e0b' },
  { name: 'Rent / Bond', type: 'expense', color: '#dc3545' },
  { name: 'Electricity & water', type: 'expense', color: '#fbbf24' },
  { name: 'Transport & fuel', type: 'expense', color: '#60a5fa' },
  { name: 'Cellphone & internet', type: 'expense', color: '#38bdf8' },
  { name: 'Medical', type: 'expense', color: '#f87171' },
  { name: 'Clothing', type: 'expense', color: '#c084fc' },
  { name: 'Bank fees', type: 'expense', color: '#94a3b8' },
  { name: 'Home loan / bond repayment', type: 'debt', color: '#fb923c' },
  { name: 'Car repayment', type: 'debt', color: '#f97316' },
  { name: 'Credit card & other debt', type: 'debt', color: '#ea580c' },
  { name: 'Subscriptions', type: 'services', color: '#818cf8' },
  { name: 'Insurance', type: 'insurance', color: '#2dd4bf' },
  { name: 'Giving', type: 'giving', color: '#fb923c' },
  { name: 'Savings', type: 'savings', color: '#34d399' },
  { name: 'Eating out', type: 'luxuries', color: '#f472b6' },
  { name: 'Entertainment', type: 'luxuries', color: '#a78bfa' },
  { name: 'Transfer between accounts', type: 'transfer', color: '#888888' },
];

const ACCOUNT_TYPES = [
  ['checking', 'Cheque / current account'],
  ['savings', 'Savings account'],
  ['credit_card', 'Credit card'],
  ['cash', 'Cash'],
  ['investment', 'Investment'],
];

const CURRENCIES = [
  ['R', 'R — South African Rand'],
  ['$', '$ — Dollar'],
  ['€', '€ — Euro'],
  ['£', '£ — Pound'],
  ['__custom__', 'Other…'],
];

/* Plain-English headings for the category step. The starter pack is grouped
   under these rather than listed flat with a type tag per row: twenty ticked
   checkboxes in one run is a wall, and the type is the thing that tells a new
   user why "Savings" and "Groceries" are not the same kind of line. */
const TYPE_LABELS = {
  income: 'Income', expense: 'Everyday expenses', debt: 'Debt repayments',
  services: 'Services & subscriptions', insurance: 'Insurance', giving: 'Giving',
  savings: 'Savings', investment: 'Investments', luxuries: 'Nice-to-haves',
  transfer: 'Transfers',
};

/* Every step past the welcome screen gets a name. "Step 3 of 7" on its own
   tells the user how far they are but not what they are being asked. */
const STEP_TITLES = {
  folder: 'Where your budget lives',
  name: 'What should we call you?',
  country: 'Country & currency',
  period: 'Your budget period',
  categories: 'Your budget categories',
  account: 'Your first account',
  finish: 'Ready to go',
};

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
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
  const now = new Date();
  const today = isoDayNumber(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  const a = isoDayNumber(anchor);
  const start = a + Math.floor((today - a) / days) * days;
  const d = new Date(start * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const safeFileName = s => s.replace(/[\\/:*?"<>|]/g, '-').trim();

class OnboardingWizard extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.finished = false;
    this.stepIdx = 0;
    this.mode = 'create';           // 'create' | 'connect' — decided after the folder step
    this.error = '';                // one-shot inline validation message (see renderStep)
    this.data = {
      folder: plugin.settings.budgetFolder || 'Finances/Budget',
      name: '',
      country: 'za',
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
    };
  }

  /* Country and currency share a step: the country already picks the currency,
     so asking again on its own screen reads as the wizard forgetting it just
     asked. "Found an existing budget" is likewise a callout on the next step
     rather than a screen of its own — it has nothing to fill in. */
  steps() {
    return this.mode === 'connect'
      ? ['welcome', 'folder', 'name', 'country', 'period', 'finish']
      : ['welcome', 'folder', 'name', 'country', 'period', 'categories', 'account', 'finish'];
  }

  onOpen() {
    this.titleEl.setText('Set up Budget Vault');
    this.renderStep();
  }
  onClose() {
    this.contentEl.empty();
    if (this.finished) return;
    // Closing on the welcome screen is not a decision — it's a tap outside the
    // modal, or an Escape from someone who hasn't read it yet. Retiring the
    // wizard there strands a brand-new user with no visible way back in, so
    // leave `onboarded` alone and ask again next launch. Past the welcome
    // screen it IS a choice: take it, and say where the wizard lives.
    if (this.stepIdx === 0) return;
    new Notice('Setup skipped — you can run it again from Settings → Budget Vault → Run setup wizard, or the command palette.', 8000);
    this.plugin.settings.onboarded = true;
    this.plugin.saveSettings();
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
    const step = steps[this.stepIdx];
    // The welcome screen isn't a "step" in the user's mind — no counter there.
    if (step !== 'welcome') {
      c.createDiv({ cls: 'budget-onb-step', text: `Step ${this.stepIdx} of ${steps.length - 1}` });
      c.createEl('h3', { cls: 'budget-onb-title', text: STEP_TITLES[step] });
    }
    this['render_' + step](c);
    if (err) c.createDiv({ cls: 'budget-onb-error', text: err });

    const nav = new Setting(c);
    nav.settingEl.addClass('budget-onb-nav');
    // Cancel first so the CSS can push it to the far left: wedged between Back
    // and Next it is a mis-tap away from leaving the wizard, on a phone, with
    // both hands busy.
    nav.addButton(b => b.setButtonText('Cancel').onClick(() => this.close()));
    if (this.stepIdx > 0) nav.addButton(b => b.setButtonText('Back').onClick(() => { this.stepIdx--; this.renderStep(); }));
    nav.addButton(b => b
      .setButtonText(step === 'finish' ? (this.mode === 'connect' ? 'Connect budget' : 'Create my budget')
        : step === 'welcome' ? 'Let\'s go!' : 'Next')
      .setCta()
      .onClick(() => this.next()));
  }

  /* Inline, inside the modal, under the fields it is about. A corner Notice is
     easy to miss on a phone, can land behind the modal, and never says which
     field it means. */
  fail(msg) { this.error = msg; this.renderStep(); }

  async next() {
    const step = this.steps()[this.stepIdx];
    if (step === 'folder') {
      const folder = normalizePath((this.data.folder || '').trim());
      if (!folder || folder === '/') { this.fail('Enter a folder path for the budget — for example Finances/Budget.'); return; }
      this.data.folder = folder;
      const wasConnect = this.mode === 'connect';
      this.mode = this.detectExisting(folder) ? 'connect' : 'create';
      if (this.mode === 'connect' && !wasConnect) await this.prefillFromSettingsMd();
    }
    if (step === 'period') {
      if (!periodDaysOrZero(this.data.periodDays)) {
        const d = Number(this.data.payday);
        if (!Number.isInteger(d) || d < 1 || d > 28) {
          this.fail('The month start day must be from 1 to 28. Not every month has a 29th, 30th or 31st, so if you are paid on the last day of the month, use 28.'); return;
        }
      } else if (!isRealIsoDate(this.data.periodAnchor)) {
        // An interval with no anchor has nothing to count from — the loader
        // drops both keys and quietly hands back monthly periods, which is a
        // confusing thing to discover after finishing a wizard that asked.
        this.fail('Enter the date you were last paid — every pay cycle is counted from it, so without it the budget falls back to monthly periods.'); return;
      }
    }
    if (step === 'country' && this.data.currency === '__custom__' && !this.data.customCurrency.trim()) {
      this.fail('Enter a currency symbol, or pick one from the list above.'); return;
    }
    if (step === 'finish') { await this.apply(); return; }
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
    const { parseFrontmatter } = require('./util');
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    // Shape and phase read independently, the same way Settings.md stores them.
    // They no longer compete: a fortnightly vault keeps its cycle AND its month
    // start day, where the old mode-based read had to pick one and could
    // present a fortnightly vault as monthly, then write that back.
    const day = parseInt(fm.month_start_day, 10);
    if (day >= 1 && day <= 28) this.data.payday = day;
    const cycleDays = periodDaysOrZero(fm.period_days);
    const cycleAnchor = (fm.period_anchor || '').toString().trim();
    if (cycleDays && isRealIsoDate(cycleAnchor)) {
      this.data.periodDays = cycleDays;
      this.data.periodAnchor = cycleAnchor;
    }
    if (fm.country && PROFILES[fm.country.toString().trim().toLowerCase()]) {
      this.data.country = fm.country.toString().trim().toLowerCase();
    }
    if (fm.currency) {
      if (CURRENCIES.some(([v]) => v === fm.currency)) this.data.currency = fm.currency;
      else { this.data.currency = '__custom__'; this.data.customCurrency = fm.currency; }
    }
    if (fm.household) this.data.name = fm.household;
  }

  /* -------------------------------- steps -------------------------------- */
  render_welcome(c) {
    c.createEl('h2', { text: 'Welcome to Budget Vault!' });
    c.createEl('p', { text: 'Your whole budget, living right here in your vault as plain markdown — no accounts, no cloud, no one else\'s server. If your vault syncs to your phone, your budget rides along for free.' });
    const intro = c.createEl('p');
    intro.createEl('b', { text: 'Here\'s the plan — this wizard sets you up:' });
    const setup = c.createEl('ol', { cls: 'budget-onb-journey' });
    for (const t of [
      'Choose your budget folder — we scaffold the whole structure for you',
      'Pick your country & currency — so amounts, dates and tax stuff look right',
      'Tell us when you get paid — your budget periods run from payday, if you like',
      'Choose your budget categories — tick the ones that fit your life',
      'Add your first account — and what\'s in it right now',
    ]) setup.createEl('li', { text: t });
    const then = c.createEl('p');
    then.createEl('b', { text: 'Then the fun starts in the app:' });
    const inApp = c.createEl('ol', { cls: 'budget-onb-journey' });
    for (const t of [
      'Set your budget — give every category a number to aim for',
      'Import your bank\'s CSV — transactions sort themselves as you teach it',
      'Add new categories anytime — your budget grows with you',
      'Review as you go — the dashboard shows exactly where the money went',
    ]) inApp.createEl('li', { text: t });
    c.createEl('p', { text: 'About two minutes of setup. You can change any of it later. Ready?' });
  }

  render_folder(c) {
    c.createEl('p', { text: 'Everything lives as plain markdown files inside one folder of your vault.' });
    /* Built before the field so the field's onChange can paint it, appended
       after so it reads underneath. Live feedback matters here: this is the
       first thing a new user types, by hand, often on a phone, and a typo
       silently scaffolds a whole budget in the wrong place — discovered much
       later, with a second half-built folder already sitting next to it. */
    const hint = document.createElement('div');
    hint.className = 'budget-onb-hint';
    const paint = () => {
      const raw = (this.data.folder || '').trim();
      if (!raw || raw === '/') { hint.textContent = 'Enter a folder path — for example Finances/Budget.'; return; }
      const f = normalizePath(raw);
      if (this.detectExisting(f)) hint.textContent = `Found an existing budget in "${f}" — the wizard will connect to it rather than create new files.`;
      else if (this.app.vault.getFolderByPath(f)) hint.textContent = `"${f}" already exists — the budget files will be added inside it.`;
      else hint.textContent = `"${f}" doesn't exist yet — it will be created for you.`;
    };
    new Setting(c)
      .setName('Budget folder')
      .setDesc('Where the categories, accounts, budgets and transactions are kept.')
      .addText(t => t
        .setPlaceholder('Finances/Budget')
        .setValue(this.data.folder)
        .onChange(v => { this.data.folder = v; paint(); }));
    c.appendChild(hint);
    paint();
  }

  render_name(c) {
    if (this.mode === 'connect') {
      c.createDiv({
        cls: 'budget-onb-callout',
        text: `Found an existing budget in "${this.data.folder}" — connecting to it instead of creating new files. Your categories, accounts and transactions are left exactly as they are; the remaining steps only confirm the settings kept in its Settings.md.`,
      });
    }
    new Setting(c)
      .setName('Your name or nickname')
      .setDesc('Shown in the dashboard greeting and the top bar. Leave blank to skip.')
      .addText(t => t
        .setPlaceholder('e.g. Alex, or The Smiths')
        .setValue(this.data.name)
        .onChange(v => { this.data.name = v; }));
  }

  /* Country and currency together: the country picks the currency, so splitting
     them meant the wizard asked the same question twice in a row and the second
     screen had to apologise for the first. */
  render_country(c) {
    new Setting(c)
      .setName('Country')
      .setDesc('Sets amount formatting, the date order used when reading bank statements, and the Tax view\'s return checklist for your country\'s tax authority.')
      .addDropdown(d => {
        for (const code of COUNTRY_ORDER) d.addOption(code, PROFILES[code].label);
        d.setValue(this.data.country);
        d.onChange(v => {
          this.data.country = v;
          this.data.currency = CURRENCIES.some(([cv]) => cv === PROFILES[v].currency) ? PROFILES[v].currency : '__custom__';
          if (this.data.currency === '__custom__') this.data.customCurrency = PROFILES[v].currency;
          // Re-render so the currency control below actually shows the country's
          // currency. Without this the two controls silently disagree, and the
          // one the user can see is the wrong one.
          this.renderStep();
        });
      });
    new Setting(c)
      .setName('Currency symbol')
      .setDesc('Shown before every amount. Starts from your country — change it if you budget in something else.')
      .addDropdown(d => {
        for (const [v, label] of CURRENCIES) d.addOption(v, label);
        d.setValue(this.data.currency);
        d.onChange(v => { this.data.currency = v; this.renderStep(); });
      });
    if (this.data.currency === '__custom__') {
      new Setting(c)
        .setName('Custom symbol')
        .addText(t => t
          .setPlaceholder('e.g. CHF')
          .setValue(this.data.customCurrency)
          .onChange(v => { this.data.customCurrency = v; }));
    }
  }

  /* Two questions, because Settings.md holds two keys. "How often" picks the
     SHAPE (a month named YYYY-MM, or an interval named by its start date);
     the follow-up picks the PHASE (which day of the month, or which payday to
     count from). A calendar month falls out of the first question answered
     "monthly" and the second answered "the 1st" — it is not a third shape. */
  render_period(c) {
    const days = periodDaysOrZero(this.data.periodDays);
    new Setting(c)
      .setName('How often are you paid?')
      .setDesc('Monthly periods are named by month and start on the day you choose below. The others line up with a pay cycle instead, counted from your last payday.')
      .addDropdown(d => {
        // periodLengthOptions, not PERIOD_PRESETS: re-running the wizard over a
        // vault whose Settings.md was hand-set to, say, 10 days must SHOW that
        // rather than silently display "Every week" over a value it kept.
        for (const [v, label] of Object.entries(periodLengthOptions(days))) d.addOption(v, label);
        d.setValue(String(days));
        d.onChange(v => { this.data.periodDays = periodDaysOrZero(v); this.renderStep(); });
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
          hint.textContent = 'Pick a day from 1 to 28. Not every month has a 29th, 30th or 31st, so if you are paid on the last day of the month, use 28.';
          return;
        }
        hint.textContent = d === 1
          ? `An ordinary calendar month: each period runs from the 1st to the end of the month, and is named after that month. Right now you are in ${monthLabel(currentPeriodFor(1))}.`
          : `Each period runs from the ${ordinal(d)} to the ${ordinal(d - 1)} of the next month, and is named after the month it ends in. Right now you are in ${monthLabel(currentPeriodFor(d))}.`;
      };
      new Setting(c)
        .setName('Which day does your budget month start?')
        .setDesc('Usually your payday. Choose 1 for an ordinary calendar month. (1–28)')
        .addText(t => {
          t.inputEl.type = 'number';
          t.inputEl.min = '1';
          t.inputEl.max = '28';
          t.inputEl.step = '1';
          t.inputEl.inputMode = 'numeric';
          t.setValue(String(this.data.payday));
          t.onChange(v => { this.data.payday = v; paint(); });
        });
      c.appendChild(hint);
      paint();
    }
    if (days) {
      const hint = document.createElement('div');
      hint.className = 'budget-onb-hint';
      const paint = () => {
        if (!isRealIsoDate(this.data.periodAnchor)) {
          hint.textContent = 'Enter the date you were last paid and the periods are worked out from there.';
          return;
        }
        hint.textContent = `Counting from there, the period you are in right now started on ${currentPeriodForCycle(days, this.data.periodAnchor)}. Budget files are named by that start date.`;
      };
      /* Deliberately blank rather than pre-filled with today or the most recent
         Friday. Nobody re-examines a date the app already filled in, so a
         confident wrong guess buys one less tap and costs a budget window
         that's silently days out — noticed weeks later, cause long forgotten.
         The wizard also runs before any transactions exist, so there is no
         history to infer a real payday from. */
      new Setting(c)
        .setName('When were you last paid?')
        .setDesc('Any recent payday will do — only where it falls within the cycle matters, so an earlier or later one gives the same periods.')
        .addText(t => {
          t.inputEl.type = 'date';
          t.setValue(this.data.periodAnchor);
          t.onChange(v => { this.data.periodAnchor = v.trim(); paint(); });
        });
      c.appendChild(hint);
      paint();
    }
  }

  render_categories(c) {
    c.createEl('p', { text: 'Start with a set of budget categories — untick any you don\'t want. You can add, rename or recolour them later, so nothing here is final.' });

    const boxes = [];
    const bar = c.createDiv({ cls: 'budget-onb-catbar' });
    const count = bar.createEl('span', { cls: 'budget-onb-catcount' });
    const paintCount = () => { count.textContent = `${this.data.cats.size} of ${STARTER_CATEGORIES.length} selected`; };
    const setAll = on => {
      for (const { cb, cat } of boxes) {
        cb.checked = on;
        if (on) this.data.cats.add(cat.name); else this.data.cats.delete(cat.name);
      }
      paintCount();
    };
    bar.createEl('button', { text: 'Select all', cls: 'budget-onb-catbtn', attr: { type: 'button' } })
      .addEventListener('click', () => setAll(true));
    bar.createEl('button', { text: 'Select none', cls: 'budget-onb-catbtn', attr: { type: 'button' } })
      .addEventListener('click', () => setAll(false));

    // Grouped by type, in the app's own type order. The colour swatch is the
    // one shown on every chart and pill later, so this doubles as a preview.
    for (const type of TYPE_ORDER) {
      const inType = STARTER_CATEGORIES.filter(x => x.type === type);
      if (!inType.length) continue;
      c.createDiv({ cls: 'budget-onb-cat-group', text: TYPE_LABELS[type] || type });
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
    c.createEl('p', { text: 'Transactions are stored per account. Add your main account now, or leave the name blank to skip — you can add accounts any time.' });
    new Setting(c)
      .setName('Account name')
      .addText(t => t
        .setPlaceholder('e.g. Cheque account')
        .setValue(this.data.acctName)
        .onChange(v => { this.data.acctName = v; }));
    new Setting(c)
      .setName('Type')
      .addDropdown(d => {
        for (const [v, label] of ACCOUNT_TYPES) d.addOption(v, label);
        d.setValue(this.data.acctType);
        d.onChange(v => { this.data.acctType = v; });
      });
    new Setting(c)
      .setName('Bank / institution')
      .setDesc('Optional.')
      .addText(t => t
        .setValue(this.data.acctInstitution)
        .onChange(v => { this.data.acctInstitution = v; }));
    new Setting(c)
      .setName('Current balance')
      .setDesc('Optional — what\'s in the account right now.')
      .addText(t => {
        t.inputEl.type = 'number';
        t.inputEl.step = '0.01';
        t.setPlaceholder('0.00')
          .setValue(this.data.acctBalance)
          .onChange(v => { this.data.acctBalance = v; });
      });
    c.createDiv({ cls: 'budget-onb-hint', text: 'Use your latest statement\'s closing balance, or whatever your banking app shows. The balance is a snapshot you keep up to date yourself — importing only recent transactions never throws it off — and you can change it any time by tapping the balance on the Accounts page.' });
  }

  render_finish(c) {
    const day = this.monthStartDay();
    const cd = this.cycleDays();
    const rows = [
      ['Folder', this.data.folder],
      ['Name', this.data.name.trim() || '—'],
      ['Country', localeFor(this.data.country).label],
      ['Budget period', cd
        ? `${PERIOD_PRESETS[cd] || `Every ${cd} days`}, counted from ${this.data.periodAnchor}`
        : day === 1 ? 'Monthly (calendar month)' : `Monthly, starting on the ${ordinal(day)}`],
      ['Currency', this.currencySymbol()],
    ];
    if (this.mode === 'create') {
      rows.push(['Categories', `${this.data.cats.size} starter categories`]);
      rows.push(['First account', this.data.acctName.trim() || '—']);
      const bal = parseFloat(String(this.data.acctBalance).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (this.data.acctName.trim() && !isNaN(bal) && bal !== 0) rows.push(['Opening balance', `${this.currencySymbol()} ${bal.toFixed(2)}`]);
    }
    c.createEl('p', {
      text: this.mode === 'connect'
        ? 'Connecting to the existing budget folder and saving these settings into its Settings.md:'
        : 'This will create the budget folder with Settings.md, your categories, the first budget file and empty Owed Money / Services files:',
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
    next.createEl('b', { text: 'What to do next: ' });
    next.appendText('give your categories an amount on the Budgets page, then import your bank\'s CSV on the Transactions page.');
    c.createDiv({ cls: 'budget-onb-hint', text: 'Your budget opens behind a tap-to-enter privacy screen, so nothing is on show if someone glances at your vault. Turn it off in Settings → Budget Vault → Privacy splash screen.' });
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

  /* Write-guard stamped create: skip files that already exist so re-running
     the wizard (or racing device sync) never overwrites real data. */
  async writeIfAbsent(path, content) {
    const vault = this.app.vault;
    if (vault.getAbstractFileByPath(path)) return;
    const parent = path.split('/').slice(0, -1).join('/');
    await this.ensureFolder(parent);
    this.plugin._lastWrite = Date.now();
    try { await vault.create(path, content); } catch (e) { /* raced into existence */ }
    this.plugin._lastWrite = Date.now();
  }
  async ensureFolder(path) {
    if (!path || path === '/') return;
    if (this.app.vault.getAbstractFileByPath(path)) return;
    await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
    try { await this.app.vault.createFolder(path); } catch (e) { /* raced into existence */ }
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
        await p.updateBudgetSettingsMd('currency', `"${cur.replace(/"/g, '')}"`);
        await p.updateBudgetSettingsMd('country', this.data.country);
        if (name) await p.updateBudgetSettingsMd('household', `"${name.replace(/"/g, '')}"`);
      } else {
        for (const sub of ['Categories', 'Accounts', 'Budgets', 'Transactions', 'Tax', 'Data']) {
          await this.ensureFolder(normalizePath(`${folder}/${sub}`));
        }
        await this.writeIfAbsent(normalizePath(`${folder}/Settings.md`),
          `---\nmonth_start_day: ${day}\n` +
          (this.cycleDays() ? `period_days: ${this.cycleDays()}\nperiod_anchor: ${this.cycleAnchor()}\n` : '') +
          `currency: "${cur.replace(/"/g, '')}"\ncountry: ${this.data.country}\n` +
          (name ? `household: "${name.replace(/"/g, '')}"\n` : '') +
          `tags: [finance, finance/budget, vault-meta]\n---\n\n# Budget Settings\n\n` +
          `- **month_start_day** — the financial period starts on this day of the month.\n` +
          (this.cycleDays()
            ? `- **period_days** — periods run this many days instead of a month. Remove it to go back to monthly.\n` +
              `- **period_anchor** — a payday every period is counted from. Only where it falls within the cycle matters.\n`
            : '') +
          `- **currency** — symbol shown before every amount in the Budget Vault plugin.\n` +
          `- **country** — drives amount formatting, statement date order and the Tax view (za, us, uk, eu, au, ca, cn, other).\n` +
          `- **household** — name shown in the dashboard greeting.\n\n` +
          `Edit the values above directly, or change them in **Settings → Budget Vault** —\n` +
          `the plugin writes them back to this file, so they sync to every device with the vault.\n`);
        for (const cat of STARTER_CATEGORIES) {
          if (!this.data.cats.has(cat.name)) continue;
          const safe = safeFileName(cat.name);
          const nameLine = safe !== cat.name ? `name: "${cat.name}"\n` : '';
          await this.writeIfAbsent(normalizePath(`${folder}/Categories/${safe}.md`),
            `---\n${nameLine}type: ${cat.type}\ncolor: "${cat.color}"\ntags: [finance, finance/budget, finance/budget/categories]\n---\n\n# ${cat.name}\n\nBudget category of type **${cat.type}**.\n`);
        }
        const acct = this.data.acctName.trim();
        if (acct) {
          const safe = safeFileName(acct);
          const today = new Date();
          const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const bal = parseFloat(String(this.data.acctBalance).replace(',', '.').replace(/[^\d.-]/g, ''));
          await this.writeIfAbsent(normalizePath(`${folder}/Accounts/${safe}.md`),
            `---\ntype: ${this.data.acctType}\n` +
            (this.data.acctInstitution.trim() ? `institution: ${this.data.acctInstitution.trim()}\n` : '') +
            `balance: ${(isNaN(bal) ? 0 : bal).toFixed(2)}\nbalance_updated: ${ymd}\ntags: [finance, finance/budget, finance/budget/accounts]\n---\n\n# ${acct}\n\nTransactions are stored under \`Transactions/${safe}/\` as monthly files.\n`);
          await this.ensureFolder(normalizePath(`${folder}/Transactions/${safe}`));
        }
        const period = this.firstPeriod();
        await this.writeIfAbsent(normalizePath(`${folder}/Budgets/${period}.md`),
          `---\nperiod: ${period}\ntags: [finance, finance/budget, finance/budget/budgets]\n---\n\n# Budget — ${period}\n\n` +
          `| Category | Type | Amount | Notes |\n|----------|------|-------:|-------|\n`);
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
      this.finished = true;
      this.close();
      new Notice(this.mode === 'connect' ? 'Connected to your budget folder.' : 'Budget folder created — welcome!');
      p.reloadViews();
      await p.activateView();
    } catch (e) {
      new Notice('Setup failed: ' + (e.message || e), 8000);
    }
  }
}

module.exports = { OnboardingWizard, STARTER_CATEGORIES };
