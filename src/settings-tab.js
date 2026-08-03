'use strict';
/* Plugin settings tab. Folder / theme / startup are plugin data; month start
   day and currency live in Settings.md inside the budget folder (so they sync
   to every device with the vault) — the tab edits that file in place. */

const { PluginSettingTab, Setting, TFile, normalizePath } = require('obsidian');
const { DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL } = require('./constants');
const { OnboardingWizard } = require('./onboarding');
const { PROFILES, COUNTRY_ORDER } = require('./locale');
const { yamlStr } = require('./util');

/* Setting keys backed by Settings.md rather than plugin data. The declarative
   API binds a control to this.plugin.settings[key] by default, so these four
   route through the getControlValue/setControlValue overrides instead. */
const MD_KEYS = new Set(['household', 'month_start_day', 'country', 'currency']);

/* Shared by display() and getSettingDefinitions() so the two tabs can't drift. */
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
  async renderMdSettings(containerEl) {
    const md = await this.plugin.readBudgetSettingsMd();

    new Setting(containerEl)
      .setName('Name / household')
      .setDesc('Shown in the dashboard greeting and top bar. Leave blank for none.')
      .addText(t => {
        t.setValue(md.household ?? '');
        t.onChange(v => {
          clearTimeout(this._hhTimer);
          this._hhTimer = setTimeout(async () => {
            await this.plugin.updateBudgetSettingsMd('household', `"${v.trim().replace(/"/g, '')}"`);
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Month start day')
      .setDesc('Day of the month each financial period begins on (payday). 1–28.')
      .addText(t => {
        t.inputEl.type = 'number';
        t.setValue(String(md.month_start_day ?? 23));
        t.onChange(v => {
          clearTimeout(this._msdTimer);
          this._msdTimer = setTimeout(async () => {
            const n = parseInt(v, 10);
            if (!n || n < 1 || n > 28) return;
            await this.plugin.updateBudgetSettingsMd('month_start_day', String(n));
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

  /* Obsidian's own warning for a missing binding points here: override these
     two for non-standard storage. Only ever called by 1.13+, so the super
     calls are safe despite the 1.4.0 minAppVersion. */
  getControlValue(key) {
    if (!MD_KEYS.has(key)) return super.getControlValue(key);
    const md = this.mdSettings();
    if (key === 'household') return md.household ?? '';
    if (key === 'month_start_day') return Number(md.month_start_day ?? 23);
    if (key === 'currency') return md.currency ?? 'R';
    if (key === 'country') {
      const c = (md.country ?? 'za').toString().trim().toLowerCase();
      return PROFILES[c] ? c : 'za';
    }
    return undefined;
  }
  async setControlValue(key, value) {
    if (!MD_KEYS.has(key)) {
      // validate() rejects a bad value but never rewrites a good one, so the
      // folder path is normalised on the way to disk here.
      if (key === 'budgetFolder') value = normalizePath(String(value).trim() || DEFAULT_SETTINGS.budgetFolder);
      await super.setControlValue(key, value);
      if (key === 'theme') this.plugin.forEachView(ctl => ctl.applyTheme());
      else if (key === 'privacyLock') this.plugin.forEachView(ctl => ctl.applyPrivacyLock());
      else if (key === 'budgetFolder') this.plugin.reloadViews();
      return;
    }
    // yamlStr escapes embedded quotes, so unlike display()'s hand-rolled
    // quoting a household name containing a " survives instead of losing it.
    const raw = key === 'household' || key === 'currency' ? yamlStr(String(value).trim())
      : key === 'month_start_day' ? String(parseInt(value, 10))
      : key === 'country' ? String(value)
      : null;
    if (raw === null) return;
    await this.plugin.updateBudgetSettingsMd(key, raw);
    this.plugin.reloadViews();
  }

  getSettingDefinitions() {
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
        desc: 'Day of the month each financial period begins on (payday). 1–28.',
        control: {
          type: 'number', key: 'month_start_day', defaultValue: 23, min: 1, max: 28,
          validate: v => {
            const n = parseInt(v, 10);
            return n >= 1 && n <= 28 ? undefined : 'Pick a day between 1 and 28.';
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
