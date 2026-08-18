'use strict';
/* First-run onboarding wizard. Collects the budget folder, a display name,
   the period convention, currency and (for a fresh folder) starter categories
   plus a first account, then scaffolds every file the loader expects.
   Obsidian Modal + Setting controls only, so it works on iOS like the rest
   of the app. Nothing is written to disk until the final step's button. */

const { Modal, Setting, Notice, normalizePath, TFile, TFolder } = require('obsidian');
const { PROFILES, COUNTRY_ORDER, localeFor } = require('./locale');
/* Namespace import for the same reason settings-tab.js uses one: this file
   binds `t` as a parameter in several `.addText(t => …)` callbacks, so a bare
   `t` from i18n would be silently shadowed inside exactly those callbacks. */
const i18n = require('./i18n');
const { setLanguage, LANGUAGE_NAMES, LANGUAGE_ORDER } = i18n;
const { PERIOD_PRESETS, periodLengthOptions, TYPE_ORDER, MONTHS } = require('./constants');
const { periodDaysOrZero } = require('./dates');
const { normalizeAmount } = require('./amount');
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

/* The stored VALUE is the key on the left; only the label is translated, so a
   vault written in one language reads back identically in another. Resolved on
   call rather than at module load — the language can change mid-wizard. */
const ACCOUNT_TYPE_KEYS = ['checking', 'savings', 'credit_card', 'cash', 'investment'];
const accountTypes = () => ACCOUNT_TYPE_KEYS.map(k => [k, i18n.t('acctType.' + k)]);

/* The stored VALUE is the symbol; only the currency's NAME is translated, so a
   vault written in one language reads back identically in another. Resolved on
   call, like accountTypes() — the language can change mid-wizard. */
const CURRENCY_KEYS = [['R', 'rand'], ['$', 'dollar'], ['\u20ac', 'euro'], ['\u00a3', 'pound'], ['__custom__', 'other']];
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
    this.mode = 'create';           // 'create' | 'connect' — decided after the folder step
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
    /* Apply the language BEFORE the first render. On a first run nothing has
       read Settings.md yet (there is none), so without this the wizard would
       draw itself in whatever language was last set — while its own picker
       showed the user's actual language selected. Cheap, and it keeps the
       picker and the text it governs from ever disagreeing. */
    setLanguage(this.data.language);
    this.titleEl.setText(i18n.t('wiz.title'));
    this.renderStep();
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

  async next() {
    const step = this.steps()[this.stepIdx];
    if (step === 'folder') {
      const folder = normalizePath((this.data.folder || '').trim());
      if (!folder || folder === '/') { this.fail(i18n.t('wiz.err.folder')); return; }
      this.data.folder = folder;
      const wasConnect = this.mode === 'connect';
      this.mode = this.detectExisting(folder) ? 'connect' : 'create';
      if (this.mode === 'connect' && !wasConnect) await this.prefillFromSettingsMd();
    }
    if (step === 'period') {
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
    if (step === 'country' && this.data.currency === '__custom__' && !this.data.customCurrency.trim()) {
      this.fail(i18n.t('wiz.err.currency')); return;
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
    const { parseFrontmatter } = require('./markdown');
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
    // Absent stays as the Obsidian-derived default rather than snapping to
    // English: a vault predating this setting has no opinion, and Obsidian's
    // own language is the better guess than the fallback. Applied as well as
    // stored — this runs when an existing budget is adopted, and the rest of
    // the wizard should immediately be in that vault's language.
    if (fm.language) this.data.language = i18n.resolveLanguage(fm.language);
    setLanguage(this.data.language);
    if (fm.currency) {
      if (CURRENCY_KEYS.some(([v]) => v === fm.currency)) this.data.currency = fm.currency;
      else { this.data.currency = '__custom__'; this.data.customCurrency = fm.currency; }
    }
    if (fm.household) this.data.name = fm.household;
  }

  /* -------------------------------- steps -------------------------------- */
  render_welcome(c) {
    c.createEl('h2', { text: i18n.t('wiz.welcome.title') });
    c.createEl('p', { text: i18n.t('wiz.welcome.intro') });
    const intro = c.createEl('p');
    intro.createEl('b', { text: i18n.t('wiz.welcome.planLead') });
    const setup = c.createEl('ol', { cls: 'budget-onb-journey' });
    for (const t of [
      i18n.t('wiz.welcome.plan1'),
      i18n.t('wiz.welcome.plan2'),
      i18n.t('wiz.welcome.plan3'),
      i18n.t('wiz.welcome.plan4'),
      i18n.t('wiz.welcome.plan5'),
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

  render_folder(c) {
    c.createEl('p', { text: i18n.t('wiz.folder.hint') });
    /* Built before the field so the field's onChange can paint it, appended
       after so it reads underneath. Live feedback matters here: this is the
       first thing a new user types, by hand, often on a phone, and a typo
       silently scaffolds a whole budget in the wrong place — discovered much
       later, with a second half-built folder already sitting next to it. */
    const hint = document.createElement('div');
    hint.className = 'budget-onb-hint';
    const paint = () => {
      const raw = (this.data.folder || '').trim();
      if (!raw || raw === '/') { hint.textContent = i18n.t('wiz.folder.blank'); return; }
      const f = normalizePath(raw);
      if (this.detectExisting(f)) hint.textContent = i18n.t('wiz.folder.found', { folder: f });
      else if (this.app.vault.getFolderByPath(f)) hint.textContent = i18n.t('wiz.folder.exists', { folder: f });
      else hint.textContent = i18n.t('wiz.folder.willCreate', { folder: f });
    };
    new Setting(c)
      .setName(i18n.t('wiz.folder.name'))
      .setDesc(i18n.t('wiz.folder.desc'))
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
        text: i18n.t('wiz.folder.connected', { folder: this.data.folder }),
      });
    }
    new Setting(c)
      .setName(i18n.t('wiz.name.name'))
      .setDesc(i18n.t('wiz.name.desc'))
      .addText(t => t
        .setPlaceholder(i18n.t('wiz.name.placeholder'))
        .setValue(this.data.name)
        .onChange(v => { this.data.name = v; }));
  }

  /* Country and currency together: the country picks the currency, so splitting
     them meant the wizard asked the same question twice in a row and the second
     screen had to apologise for the first.

     Language sits FIRST on the same screen, because it governs everything the
     wizard says after it — but it is not a fourth thing the country decides.
     Country and language are separate axes on purpose, which is why changing
     the dropdown below leaves this one alone. */
  render_country(c) {
    new Setting(c)
      .setName(i18n.t('settings.language.name'))
      .setDesc(i18n.t('wiz.language.desc'))
      .addDropdown(d => {
        for (const id of LANGUAGE_ORDER) d.addOption(id, LANGUAGE_NAMES[id]);
        d.setValue(i18n.resolveLanguage(this.data.language));
        d.onChange(v => {
          this.data.language = v;
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
        d.onChange(v => { this.data.currency = v; this.renderStep(); });
      });
    if (this.data.currency === '__custom__') {
      new Setting(c)
        .setName(i18n.t('wiz.currency.custom'))
        .addText(t => t
          .setPlaceholder(i18n.t('wiz.currency.customPlaceholder'))
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
      .setName(i18n.t('wiz.period.howOften'))
      .setDesc(i18n.t('wiz.period.howOftenDesc'))
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
          t.onChange(v => { this.data.periodAnchor = v.trim(); paint(); });
        });
      c.appendChild(hint);
      paint();
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
      .setName('Bank / institution')
      .setDesc('Optional.')
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

  render_finish(c) {
    const day = this.monthStartDay();
    const cd = this.cycleDays();
    const rows = [
      [i18n.t('wiz.sum.folder'), this.data.folder],
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
      rows.push([i18n.t('wiz.sum.categories'), i18n.t('wiz.sum.catCount', { count: this.data.cats.size })]);
      rows.push([i18n.t('wiz.sum.account'), this.data.acctName.trim() || '—']);
      const bal = this.openingBalance();
      if (this.data.acctName.trim() && bal !== 0) rows.push([i18n.t('wiz.sum.opening'), `${this.currencySymbol()} ${bal.toFixed(2)}`]);
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
    next.appendText(i18n.t('wiz.finish.nextBody'));
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
    return normalizeAmount(this.data.acctBalance) ?? 0;
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
  async writeIfAbsent(path, content) {
    await this.io().createVaultFileIfAbsent(path, content);
  }
  async ensureFolder(path) {
    await this.io().ensureVaultFolder(path);
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
          if (!this.data.cats.has(cat.name)) continue;
          const safe = safeFileName(cat.name);
          const nameLine = safe !== cat.name ? `name: ${yamlStr(cat.name)}\n` : '';
          await this.writeIfAbsent(normalizePath(`${folder}/Categories/${safe}.md`),
            `---\n${nameLine}type: ${cat.type}\ncolor: ${yamlStr(cat.color)}\ntags: [finance, finance/budget, finance/budget/categories]\n---\n\n# ${cat.name}\n\nBudget category of type **${cat.type}**.\n`);
        }
        const acct = this.data.acctName.trim();
        if (acct) {
          const safe = safeFileName(acct);
          const ymd = todayIso();
          const bal = this.openingBalance();
          await this.writeIfAbsent(normalizePath(`${folder}/Accounts/${safe}.md`),
            `---\ntype: ${this.data.acctType}\n` +
            // Free text from a wizard field — quoted like every other scalar:
            // a bare colon-space in a bank's name would fork the key mid-value.
            (this.data.acctInstitution.trim() ? `institution: ${yamlStr(this.data.acctInstitution.trim())}\n` : '') +
            `balance: ${bal.toFixed(2)}\nbalance_updated: ${ymd}\ntags: [finance, finance/budget, finance/budget/accounts]\n---\n\n# ${acct}\n\nTransactions are stored under \`Transactions/${safe}/\` as monthly files.\n`);
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
      new Notice(i18n.t(this.mode === 'connect' ? 'wiz.done.connected' : 'wiz.done.created'));
      p.reloadViews();
      await p.activateView();
    } catch (e) {
      new Notice(i18n.t('wiz.failed', { error: e.message || e }), 8000);
    }
  }
}

module.exports = { OnboardingWizard, STARTER_CATEGORIES };
