'use strict';
/* Plugin settings tab. Folder / theme / startup are plugin data; month start
   day and currency live in Settings.md inside the budget folder (so they sync
   to every device with the vault) — the tab edits that file in place. */

const { PluginSettingTab, Setting, TFile, Notice, normalizePath } = require('obsidian');
const { DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, PALETTE_PRESETS, periodLengthOptions } = require('./constants');
const { OnboardingWizard } = require('./onboarding');
const { PROFILES, COUNTRY_ORDER } = require('./locale');
/* Namespace import, not `const { t }`: this codebase already binds `t` as a
   parameter name in 22 places (`.addText(t => …)`, `el('tr', …)` neighbours in
   the views), so a bare `t` would be shadowed exactly where translation is most
   needed, silently and without a runtime error. `i18n.t(...)` cannot be. */
const i18n = require('./i18n');
const { setLanguage, LANGUAGE_NAMES, LANGUAGE_ORDER } = i18n;
const { periodDaysOrZero } = require('./dates');
const { yamlStr } = require('./markdown');
const { ISO_DATE, isoDayNumber, isRealIsoDate } = require('./dates');

/* Date-SHAPED, used only to recognise budget filenames. An anchor the user
   types or a file stores must be a real calendar date, so those go through
   isRealIsoDate — 2026-13-45 is shaped like a date and is not one. */

/* Setting keys backed by Settings.md rather than plugin data. The declarative
   API binds a control to this.plugin.settings[key] by default, so these
   route through the getControlValue/setControlValue overrides instead. */
const MD_KEYS = new Set(['household', 'month_start_day', 'country', 'language', 'currency', 'period_days', 'period_anchor']);

/* Language dropdown options, as {id: nativeName}. Built off LANGUAGE_ORDER —
   itself derived from the tables that actually ship — so the dropdown can never
   offer a language with no strings behind it, the same way palette.test.cjs
   stops PALETTE_PRESETS offering a palette with no CSS behind it. */
const languageOptions = () =>
  Object.fromEntries(LANGUAGE_ORDER.map(id => [id, LANGUAGE_NAMES[id]]));

/* Shared by display() and getSettingDefinitions() so the two tabs can't drift. */
const PALETTE_DESC = 'Which colours the budget is drawn in. Each palette has its own light and dark version, so this is independent of the Theme setting above.';
const MONTH_START_DESC = 'Day of the month each financial period begins on — usually your payday. Choose 1 for an ordinary calendar month. 1–28.';
const PERIOD_LENGTH_DESC = 'How long each budget period runs. Monthly uses the month start day above. The other options line periods up with a pay cycle instead, counting from the date below.';
const PERIOD_ANCHOR_DESC = 'When were you last paid? Any recent payday works — only the day it falls on within the cycle matters, so an earlier or later one gives the same result. Ignored when the period length is monthly.';
const FEEDBACK_DESC = 'Report a bug, flag an issue or request a feature. Opens a Google Form in your browser — nothing from your budget is attached or sent.';
const SUPPORT_DESC = 'Budget Vault is free and always will be. If you\'d like to say thanks, this opens PayPal in your browser — entirely optional, and nothing in the plugin changes either way.';

class BudgetSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Budget folder')
      .setDesc('Vault path of the folder holding Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.')
      .addText(t => t
        .setPlaceholder(DEFAULT_SETTINGS.budgetFolder)
        .setValue(this.plugin.settings.budgetFolder)
        .onChange(async v => {
          this.plugin.settings.budgetFolder = normalizePath(v.trim() || DEFAULT_SETTINGS.budgetFolder);
          await this.plugin.saveSettings();
          this.plugin.reloadViews();
        }));

    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Follow Obsidian\'s light/dark mode, or force the Airy Glass dark or light palette.')
      .addDropdown(d => d
        .addOption('auto', 'Follow Obsidian')
        .addOption('dark', 'Always dark')
        .addOption('light', 'Always light')
        .setValue(this.plugin.settings.theme)
        .onChange(async v => {
          this.plugin.settings.theme = v;
          await this.plugin.saveSettings();
          this.plugin.forEachView(ctl => ctl.applyTheme());
        }));

    new Setting(containerEl)
      .setName('Colour palette')
      .setDesc(PALETTE_DESC)
      .addDropdown(d => {
        for (const [id, label] of Object.entries(PALETTE_PRESETS)) d.addOption(id, label);
        d.setValue(this.plugin.settings.palette)
          .onChange(async v => {
            this.plugin.settings.palette = v;
            await this.plugin.saveSettings();
            this.plugin.forEachView(ctl => ctl.applyTheme());
          });
      });

    new Setting(containerEl)
      .setName('Setup wizard')
      .setDesc('Re-run the first-run wizard — folder, name, budget period, currency, starter files.')
      .addButton(b => b
        .setButtonText('Run setup wizard')
        .onClick(() => new OnboardingWizard(this.app, this.plugin).open()));

    new Setting(containerEl)
      .setName('Open on startup')
      .setDesc('Open the budget view automatically when Obsidian starts.')
      .addToggle(t => t
        .setValue(this.plugin.settings.openOnStartup)
        .onChange(async v => {
          this.plugin.settings.openOnStartup = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Privacy splash screen')
      .setDesc('Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.')
      .addToggle(t => t
        .setValue(this.plugin.settings.privacyLock)
        .onChange(async v => {
          this.plugin.settings.privacyLock = v;
          await this.plugin.saveSettings();
          this.plugin.forEachView(ctl => ctl.applyPrivacyLock());
        }));

    new Setting(containerEl)
      .setName('Send feedback')
      .setDesc(FEEDBACK_DESC)
      .addButton(b => b
        .setButtonText('Open feedback form')
        .onClick(() => window.open(FEEDBACK_URL, '_blank')));

    new Setting(containerEl)
      .setName('Support Budget Vault')
      .setDesc(SUPPORT_DESC)
      .addButton(b => b
        .setButtonText('Send a thank you')
        .onClick(() => window.open(SUPPORT_URL, '_blank')));

    new Setting(containerEl).setName('Budget data').setHeading()
      .setDesc('Stored in Settings.md inside the budget folder, so they apply on every device.');

    const fmSection = containerEl.createDiv();
    this.renderMdSettings(fmSection);
  }
  /* Obsidian calls this when the tab closes. The three text fields below debounce
     their Settings.md write by 800ms, so closing the tab mid-keystroke otherwise
     left a write + reloadViews() to fire against a tab that no longer exists —
     the same teardown discipline the view controller applies in destroy(). */
  hide() {
    clearTimeout(this._hhTimer);
    clearTimeout(this._msdTimer);
    clearTimeout(this._curTimer);
  }
  async renderMdSettings(containerEl) {
    const md = await this.plugin.readBudgetSettingsMd();
    /* The settings tab can be opened before any budget view has ever loaded, so
       it cannot rely on load.js having set the language. Set it here off the
       file we have just read — otherwise the one screen carrying the language
       picker is the one screen guaranteed to render in the wrong language. */
    setLanguage(md.language || i18n.defaultLanguage());

    new Setting(containerEl)
      .setName('Name / household')
      .setDesc('Shown in the dashboard greeting and top bar. Leave blank for none.')
      .addText(t => {
        t.setValue(md.household ?? '');
        t.onChange(v => {
          clearTimeout(this._hhTimer);
          this._hhTimer = setTimeout(async () => {
            // yamlStr, same as the currency field below and the declarative tab
            // above: the hand-rolled quoting this replaced DELETED embedded
            // quotes rather than escaping them, so 'Ruan "The General"' saved
            // as 'Ruan The General'.
            await this.plugin.updateBudgetSettingsMd('household', yamlStr(v.trim()));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Month start day')
      .setDesc(MONTH_START_DESC)
      .addText(t => {
        t.inputEl.type = 'number';
        t.setValue(String(md.month_start_day ?? 23));
        t.onChange(v => {
          clearTimeout(this._msdTimer);
          this._msdTimer = setTimeout(async () => {
            const n = parseInt(v, 10);
            // Say so. A bare return left the rejected value sitting in the field
            // looking saved, and the period silently kept its old start day.
            if (!n || n < 1 || n > 28) {
              new Notice(`Budget: "${v}" is not a valid month start day — enter a number from 1 to 28.`, 6000);
              return;
            }
            await this.plugin.updateBudgetSettingsMd('month_start_day', String(n));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Period length')
      .setDesc(PERIOD_LENGTH_DESC)
      .addDropdown(d => {
        const cur = periodDaysOrZero(md.period_days);
        for (const [days, label] of Object.entries(periodLengthOptions(cur))) d.addOption(days, label);
        d.setValue(String(cur));
        d.onChange(async v => {
          const n = periodDaysOrZero(v);
          await this.plugin.updateBudgetSettingsMd('period_days', String(n));
          if (n && !isRealIsoDate((md.period_anchor ?? '').toString().trim())) {
            new Notice('Budget: set "Last payday" below so periods know where to start — until then they stay monthly.', 8000);
          }
          this.noticeBudgetsKept(periodDaysOrZero(md.period_days), n);
          this.plugin.reloadViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Last payday')
      .setDesc(PERIOD_ANCHOR_DESC)
      .addText(t => {
        t.inputEl.type = 'date';
        t.setValue((md.period_anchor ?? '').toString().trim());
        t.onChange(v => {
          clearTimeout(this._anchorTimer);
          this._anchorTimer = setTimeout(async () => {
            const next = v.trim();
            if (next && !isRealIsoDate(next)) {
              new Notice(i18n.t('settings.dateNotReal', { value: next }), 6000);
              return;
            }
            await this.warnIfAnchorReslices(md, next);
            await this.plugin.updateBudgetSettingsMd('period_anchor', next);
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Country')
      .setDesc('Drives amount formatting, bank-statement date order and the Tax view\'s checklist (tailored to your country\'s tax authority). Existing tax years keep their data — only labels and new-year seeds change.')
      .addDropdown(d => {
        for (const code of COUNTRY_ORDER) d.addOption(code, PROFILES[code].label);
        const cur = (md.country ?? 'za').toString().trim().toLowerCase();
        d.setValue(PROFILES[cur] ? cur : 'za');
        d.onChange(async v => {
          await this.plugin.updateBudgetSettingsMd('country', v);
          this.plugin.reloadViews();
        });
      });

    new Setting(containerEl)
      .setName(i18n.t('settings.language.name'))
      .setDesc(i18n.t('settings.language.desc'))
      .addDropdown(d => {
        for (const [id, label] of Object.entries(languageOptions())) d.addOption(id, label);
        d.setValue(i18n.resolveLanguage(md.language ?? i18n.defaultLanguage()));
        d.onChange(async v => {
          // Set the live language BEFORE the write so the redraw below is
          // already in the new language — the settings tab is the one screen
          // guaranteed to be open when this changes, so leaving it in the old
          // language until the next open reads as if nothing happened.
          setLanguage(v);
          await this.plugin.updateBudgetSettingsMd('language', v);
          // Re-translate any OPEN budget view. reloadViews() re-reads the vault
          // but does not re-mount, and the shell is translated at mount — so
          // without this the drawer and page titles sit in the old language
          // until the view is closed and reopened.
          this.plugin.forEachView(ctl => ctl.applyLanguage());
          this.plugin.reloadViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Currency symbol')
      .setDesc('Shown before every amount, e.g. R.')
      .addText(t => {
        t.setValue(md.currency ?? 'R');
        t.onChange(v => {
          clearTimeout(this._curTimer);
          this._curTimer = setTimeout(async () => {
            if (!v.trim()) return;
            await this.plugin.updateBudgetSettingsMd('currency', yamlStr(v.trim()));
            this.plugin.reloadViews();
          }, 800);
        });
      });
  }

  /* ---- Declarative settings (Obsidian 1.13+) -----------------------------
     1.13 renders a tab from getSettingDefinitions() and only falls back to
     display() when it returns an empty array, so every older version keeps
     the imperative tab above, untouched and unversion-checked. Both describe
     the same settings — add one here and you must add it there too, or the
     two versions drift apart for users.

     getSettingDefinitions() runs on every update(), so it stays cheap: no
     vault reads, no awaits. mdSettings() reads the already-parsed frontmatter
     out of metadataCache, which is a synchronous cache hit, rather than
     re-reading Settings.md the way display() has to. */
  mdSettings() {
    const f = this.app.vault.getAbstractFileByPath(this.plugin.settingsMdPath());
    if (!(f instanceof TFile)) return {};
    const cache = this.app.metadataCache.getFileCache(f);
    return (cache && cache.frontmatter) || {};
  }

  /* Budget files named by date — the ones an anchor move can strand. Counted
     off getMarkdownFiles rather than walking the folder so no TFolder import
     is needed, and so a Budgets/ folder that doesn't exist yet reads as zero
     instead of throwing. */
  datedBudgetCount() {
    const base = `${this.plugin.settings.budgetFolder}/Budgets/`;
    return this.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(base) && ISO_DATE.test(f.basename)).length;
  }

  /* Date-named budgets the INCOMING cycle length can't address. A length change
     redraws the set of real period starts: every start of a 14-day cycle is
     also a start of a 7-day one, so 14 → 7 strands nothing, but 7 → 14 leaves
     half of them sitting between the new boundaries. Same phase rule period.js
     validates a remembered period against — if the two ever disagreed, this
     would promise a file was reachable that the app then refused to open. */
  offPhaseBudgetCount(days) {
    const anchor = (this.mdSettings().period_anchor ?? '').toString().trim();
    if (!days || !isRealIsoDate(anchor)) return 0;
    const a = isoDayNumber(anchor);
    const base = `${this.plugin.settings.budgetFolder}/Budgets/`;
    return this.app.vault.getMarkdownFiles().filter(f =>
      f.path.startsWith(base) && ISO_DATE.test(f.basename) &&
      (isoDayNumber(f.basename) - a) % days !== 0).length;
  }

  /* Changing the period length is where the surprise is manufactured, so it is
     where the reassurance belongs — the Budgets page carries the same message
     again, because most people don't read a settings notice carefully. Only
     fires when files are genuinely stranded. Cycle → cycle used to say nothing
     at all on the reasoning that date-named files stay addressable; that only
     holds when the new length divides the old, so it went silent through
     exactly the 7 → 14 case that strands every second fortnight. */
  /* Split from the Notice purely so it can be tested: how many budget files a
     switch from `before` to `after` puts out of reach. */
  strandedBudgetCount(before, after) {
    if (!before && after) return this.monthBudgetCount();
    if (before && !after) return this.datedBudgetCount();
    if (before && after) return this.offPhaseBudgetCount(after);
    return 0;                                       // both monthly — nothing moves
  }
  noticeBudgetsKept(before, after) {
    const n = this.strandedBudgetCount(before, after);
    if (!n) return;
    new Notice(i18n.t('settings.budgetsKept', { count: n }), 10000);
  }
  monthBudgetCount() {
    const base = `${this.plugin.settings.budgetFolder}/Budgets/`;
    return this.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(base) && /^\d{4}-\d{2}$/.test(f.basename)).length;
  }

  /* ADR 0001: an anchor is meaningful only modulo the period length, so moving
     it by a whole number of cycles describes the same periods and must stay
     silent — warning there would train the user to ignore the warning that
     matters. An off-cycle move genuinely re-slices every boundary, and then the
     honest thing is to say how much it touched and how to undo it. Nothing is
     deleted either way, so this is information, not a refusal. */
  async warnIfAnchorReslices(md, next) {
    const days = periodDaysOrZero(md.period_days);
    const prev = (md.period_anchor ?? '').toString().trim();
    if (!days || !isRealIsoDate(prev) || !isRealIsoDate(next)) return;
    if ((isoDayNumber(next) - isoDayNumber(prev)) % days === 0) return;
    const n = this.datedBudgetCount();
    if (!n) return;
    new Notice(i18n.t('settings.anchorReslices', { count: n, prev }), 12000);
  }

  /* Obsidian's own warning for a missing binding points here: override these
     two for non-standard storage. Only ever called by 1.13+, so the super
     calls are safe despite the 1.4.0 minAppVersion. */
  getControlValue(key) {
    if (!MD_KEYS.has(key)) return super.getControlValue(key);
    const md = this.mdSettings();
    if (key === 'household') return md.household ?? '';
    if (key === 'month_start_day') return Number(md.month_start_day ?? 23);
    // Dropdown values are strings; the banded number keeps the control honest
    // about what the app is running rather than what the file happens to say.
    if (key === 'period_days') return String(periodDaysOrZero(md.period_days));
    if (key === 'period_anchor') return (md.period_anchor ?? '').toString().trim();
    if (key === 'currency') return md.currency ?? 'R';
    if (key === 'country') {
      const c = (md.country ?? 'za').toString().trim().toLowerCase();
      return PROFILES[c] ? c : 'za';
    }
    // Absent means "follow Obsidian" rather than a stored 'en' — the control
    // has to show what the app is actually running, which for an untouched
    // vault is Obsidian's own display language, not English.
    if (key === 'language') return i18n.resolveLanguage(md.language ?? i18n.defaultLanguage());
    return undefined;
  }
  async setControlValue(key, value) {
    if (!MD_KEYS.has(key)) {
      // validate() rejects a bad value but never rewrites a good one, so the
      // folder path is normalised on the way to disk here.
      if (key === 'budgetFolder') value = normalizePath(String(value).trim() || DEFAULT_SETTINGS.budgetFolder);
      await super.setControlValue(key, value);
      // Both axes of the look are applied by the same call: applyTheme() sets
      // the dark class and the palette class together.
      if (key === 'theme' || key === 'palette') this.plugin.forEachView(ctl => ctl.applyTheme());
      else if (key === 'privacyLock') this.plugin.forEachView(ctl => ctl.applyPrivacyLock());
      else if (key === 'budgetFolder') this.plugin.reloadViews();
      return;
    }
    // yamlStr escapes embedded quotes, so unlike display()'s hand-rolled
    // quoting a household name containing a " survives instead of losing it.
    // The anchor's warning has to fire BEFORE the write, while the previous
    // value is still readable — afterwards there is nothing to compare against.
    if (key === 'period_anchor') {
      const next = String(value).trim();
      if (next && !isRealIsoDate(next)) return;
      await this.warnIfAnchorReslices(this.mdSettings(), next);
    }
    if (key === 'period_days') {
      this.noticeBudgetsKept(periodDaysOrZero(this.mdSettings().period_days), periodDaysOrZero(value));
    }
    const raw = key === 'household' || key === 'currency' ? yamlStr(String(value).trim())
      : key === 'month_start_day' ? String(parseInt(value, 10))
      : key === 'period_days' ? String(periodDaysOrZero(value))
      : key === 'period_anchor' ? String(value).trim()
      : key === 'country' ? String(value)
      : key === 'language' ? i18n.resolveLanguage(value)
      : null;
    if (raw === null) return;
    // Same ordering as display()'s dropdown: the live language moves before the
    // write, so whatever redraws next is already in the new language.
    if (key === 'language') setLanguage(raw);
    await this.plugin.updateBudgetSettingsMd(key, raw);
    // Same as display()'s dropdown: re-translate open views in place, because
    // reloadViews() re-reads the vault without re-mounting the shell.
    if (key === 'language') this.plugin.forEachView(ctl => ctl.applyLanguage());
    this.plugin.reloadViews();
  }

  getSettingDefinitions() {
    /* Same reason renderMdSettings() does it, via the synchronous cache read
       this half is restricted to: the names and descriptions below are
       translated at call time, so the language has to be current before the
       list is built. */
    setLanguage(this.mdSettings().language || i18n.defaultLanguage());
    return [
      {
        name: 'Budget folder',
        desc: 'Vault path of the folder holding Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.',
        control: { type: 'folder', key: 'budgetFolder', placeholder: DEFAULT_SETTINGS.budgetFolder },
      },
      {
        name: 'Theme',
        desc: 'Follow Obsidian\'s light/dark mode, or force the Airy Glass dark or light palette.',
        control: {
          type: 'dropdown', key: 'theme', defaultValue: DEFAULT_SETTINGS.theme,
          options: { auto: 'Follow Obsidian', dark: 'Always dark', light: 'Always light' },
        },
      },
      {
        name: 'Colour palette',
        desc: PALETTE_DESC,
        control: {
          type: 'dropdown', key: 'palette', defaultValue: DEFAULT_SETTINGS.palette,
          options: PALETTE_PRESETS,
        },
      },
      {
        name: 'Setup wizard',
        desc: 'Re-run the first-run wizard — folder, name, budget period, currency, starter files.',
        render: setting => {
          setting.addButton(b => b
            .setButtonText('Run setup wizard')
            .onClick(() => new OnboardingWizard(this.app, this.plugin).open()));
        },
      },
      {
        name: 'Open on startup',
        desc: 'Open the budget view automatically when Obsidian starts.',
        control: { type: 'toggle', key: 'openOnStartup', defaultValue: DEFAULT_SETTINGS.openOnStartup },
      },
      {
        name: 'Privacy splash screen',
        desc: 'Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.',
        control: { type: 'toggle', key: 'privacyLock', defaultValue: DEFAULT_SETTINGS.privacyLock },
      },
      {
        name: 'Send feedback',
        desc: FEEDBACK_DESC,
        render: setting => {
          setting.addButton(b => b
            .setButtonText('Open feedback form')
            .onClick(() => window.open(FEEDBACK_URL, '_blank')));
        },
      },
      {
        name: 'Support Budget Vault',
        desc: SUPPORT_DESC,
        render: setting => {
          setting.addButton(b => b
            .setButtonText('Send a thank you')
            .onClick(() => window.open(SUPPORT_URL, '_blank')));
        },
      },
      {
        name: 'Budget data',
        desc: 'Stored in Settings.md inside the budget folder, so they apply on every device.',
        render: setting => { setting.setHeading(); },
      },
      {
        name: 'Name / household',
        desc: 'Shown in the dashboard greeting and top bar. Leave blank for none.',
        control: { type: 'text', key: 'household', placeholder: 'Leave blank for none' },
      },
      {
        name: 'Month start day',
        desc: MONTH_START_DESC,
        control: {
          type: 'number', key: 'month_start_day', defaultValue: 23, min: 1, max: 28,
          validate: v => {
            const n = parseInt(v, 10);
            return n >= 1 && n <= 28 ? undefined : 'Pick a day between 1 and 28.';
          },
        },
      },
      {
        name: 'Period length',
        desc: PERIOD_LENGTH_DESC,
        control: {
          type: 'dropdown', key: 'period_days', defaultValue: '0',
          options: periodLengthOptions(periodDaysOrZero(this.mdSettings().period_days)),
        },
      },
      {
        name: 'Last payday',
        desc: PERIOD_ANCHOR_DESC,
        control: {
          type: 'text', key: 'period_anchor', placeholder: 'YYYY-MM-DD',
          validate: v => {
            const s = String(v).trim();
            return !s || isRealIsoDate(s) ? undefined : 'Use a real date as YYYY-MM-DD, e.g. 2026-08-07.';
          },
        },
      },
      {
        name: 'Country',
        desc: 'Drives amount formatting, bank-statement date order and the Tax view\'s checklist (tailored to your country\'s tax authority). Existing tax years keep their data — only labels and new-year seeds change.',
        control: {
          type: 'dropdown', key: 'country', defaultValue: 'za',
          options: Object.fromEntries(COUNTRY_ORDER.map(code => [code, PROFILES[code].label])),
        },
      },
      {
        name: i18n.t('settings.language.name'),
        desc: i18n.t('settings.language.desc'),
        control: {
          type: 'dropdown', key: 'language', defaultValue: i18n.defaultLanguage(),
          options: languageOptions(),
        },
      },
      {
        name: 'Currency symbol',
        desc: 'Shown before every amount, e.g. R.',
        control: {
          type: 'text', key: 'currency', placeholder: 'R',
          validate: v => (String(v).trim() ? undefined : 'Enter a currency symbol.'),
        },
      },
    ];
  }
}

module.exports = { BudgetSettingTab };
