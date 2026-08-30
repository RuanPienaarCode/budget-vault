'use strict';
/* Plugin settings tab. Folder / theme / startup are plugin data; month start
   day and currency live in Settings.md inside the budget folder (so they sync
   to every device with the vault) — the tab edits that file in place. */

const { PluginSettingTab, Setting, TFile, Notice, normalizePath } = require('obsidian');
const { DEFAULT_SETTINGS, TYPE_ORDER, FEEDBACK_URL, SUPPORT_URL, PALETTE_PRESETS, periodLengthOptions, overspendLag, OVERSPEND_LAG_DEFAULT, OVERSPEND_LAG_MAX, emergencyTarget, EMERGENCY_TARGET_DEFAULT, EMERGENCY_TARGET_MAX, INPUT_MODE_DEFAULT, inputMode } = require('./constants');
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
const { parseOwners } = require('./owners');
const { parseGroups, parseNonEssential, typeOrder } = require('./groups');
const { NON_ESSENTIAL_TYPES } = require('./health-math');
const { normalizeCode, normalizeCadence } = require('./fx');
const { ISO_DATE, isoDayNumber, isRealIsoDate } = require('./dates');

/* Date-SHAPED, used only to recognise budget filenames. An anchor the user
   types or a file stores must be a real calendar date, so those go through
   isRealIsoDate — 2026-13-45 is shaped like a date and is not one. */

/* Setting keys backed by Settings.md rather than plugin data. The declarative
   API binds a control to this.plugin.settings[key] by default, so these
   route through the getControlValue/setControlValue overrides instead. */
/* Exchange rates are stored as 'off'/'on' rather than a YAML boolean for the
   same reason input_mode is a string: the value is read back into a dropdown,
   and a hand-edited `exchange_rates: yes` (which YAML reads as true, while
   `exchange_rates: maybe` is a string) would otherwise leave the control
   showing something the app is not running. Absent means off, so every vault
   written before this key existed keeps making zero network requests. */
const fxMode = v => (String(v == null ? '' : v).trim().toLowerCase() === 'on' ? 'on' : 'off');
const FX_OPTIONS = () => ({
  off: i18n.t('settings.exchangeRates.off'),
  on: i18n.t('settings.exchangeRates.on'),
});

/* Resolved on call like FX_OPTIONS above, so the labels follow the interface
   language rather than the language the tab first rendered in. */
const CADENCE_OPTIONS = () => ({
  daily: i18n.t('settings.rateRefresh.daily'),
  weekly: i18n.t('settings.rateRefresh.weekly'),
  monthly: i18n.t('settings.rateRefresh.monthly'),
});

const MD_KEYS = new Set(['household', 'owners', 'month_start_day', 'country', 'language', 'currency', 'currency_code', 'exchange_rates', 'rate_refresh', 'input_mode', 'period_days', 'period_anchor', 'overspend_lag', 'emergency_target_months', 'groups', 'nonessential_groups']);

/* Shared by display() and getSettingDefinitions(), same as OWNERS_DESC below.
   It has to say what the setting HIDES as well as what it stores: choosing
   "Type them in myself" takes the Import CSV link out of the menu and the
   import button off the top bar, and someone hunting for a link that has
   quietly gone would otherwise have nothing to read that explains it. */
const INPUT_MODE_DESC = 'Whether this household imports bank statements or types its spending in by hand. "Type them in myself" hides the Import CSV link in the menu and the import button in the top bar — nothing is deleted, and the import screen is still reachable from the command palette ("Budget: Import a bank statement (CSV)") or by setting this back to "Import bank statements".';
const INPUT_MODE_OPTIONS = { csv: 'Import bank statements (CSV)', manual: 'Type them in myself' };

/* Shared by display() and getSettingDefinitions(), same as PALETTE_DESC above.
   It has to explain what the setting TURNS ON as well as what it stores: an
   empty owners line is why the Accounts page shows no owner control at all, and
   a reader hunting for that field would otherwise have no way to find this. */
/* Shared by display() and getSettingDefinitions(), like OWNERS_DESC. Says
   where the groups APPEAR, because a reader who typed one and then cannot
   find it on the page needs to know it sits with the household buckets, just
   before "expense". */
const GROUPS_DESC = 'Your own category groups, separated by commas — e.g. "property, treats". Each becomes a header on the Budget page (placed just before "expense") and a Type you can give a category. Built-in names are ignored here; leave blank to use only the built-in groups.';
/* Tick what the household would stop paying if income stopped. Deliberately
   NOT a comma box any more: the valid answers are a closed set — the built-in
   types plus this vault's own groups — so a free-text field made the reader
   retype a word they had already typed one row above, and silently dropped
   anything it did not recognise. A typo cost you the setting with nothing on
   screen to say so.

   The six types health-math.js already treats as non-essential come what may
   are not offered at all, rather than shown ticked and disabled: a control
   that cannot be changed is noise in a list of controls that can. */
const NONESSENTIAL_DESC = 'Tick the groups the emergency-fund sums may leave out — what you would stop paying if income stopped. Income, transfers, luxuries, giving, savings and investments are always left out and are not listed here; this can only add to that.';

const OWNERS_DESC = 'The people this household\'s accounts can belong to, separated by commas — e.g. "Alex, Sam". Each account then gets an Owner dropdown offering these plus Joint, and the Accounts page gains a per-person breakdown and filter. Leave blank if the budget is one person\'s.';

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
const PERIOD_LENGTH_NO_ANCHOR = ' Periods are running monthly: set a last payday below to start the cycle.';

/* A cycle length with no usable anchor. The loader drops BOTH keys in that
   pairing (src/load.js), so the vault runs payday months — but the control
   reads Settings.md through mdSettings(), not the loaded state, so it goes on
   showing "Every 2 weeks" from the file. The value is deliberately left alone:
   periodLengthOptions() exists so a hand-set length still appears truthfully
   rather than being snapped to a preset behind the user's back, and forcing the
   control to 0 would contradict the file they edit. So the description carries
   the correction instead.

   Only reachable by hand-editing Settings.md — the pickers can't produce it —
   but until this existed the only warning fired on CHANGING the dropdown, so
   someone opening settings on an already-broken file saw nothing at all. */
function periodNeedsAnchor(md) {
  return !!periodDaysOrZero(md?.period_days)
    && !isRealIsoDate(((md?.period_anchor ?? '').toString().trim()));
}

/* Shared by both tabs so the warning can never appear on one and not the other
   — tests/settings-parity.test.cjs pins that neither side may inline the bare
   constant instead. */
function periodLengthDesc(md) {
  return periodNeedsAnchor(md) ? PERIOD_LENGTH_DESC + PERIOD_LENGTH_NO_ANCHOR : PERIOD_LENGTH_DESC;
}
const OVERSPEND_LAG_DESC = 'How many periods back the Budget page reads when you press "Pull overspend" on an already-spent category. 1 is the previous period. Set it higher when the hole you are funding is older than that — a credit card settles in arrears, so August is often covering June. 1–12.';

/* Like OWNERS_DESC, this has to say what the setting TURNS ON as well as what
   it stores: the months figure is meaningless until an account is earmarked,
   and a reader who has not found that control yet would have no way to learn
   the two belong together. */
const EMERGENCY_TARGET_DESC = 'How many months of essential spending your emergency fund is aiming to cover — the target the Dashboard\'s Financial health card measures against. 6 is the usual goal, 3 the common first milestone. Essential spending is everything except luxuries, giving, savings and investments. Mark which account holds the fund with "Emergency fund" on the Accounts page — until you do, the card has nothing to measure. 1–24.';
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
          // Guarded like every other write in this tab: a rejected
          // saveSettings() used to be an unhandled rejection. reloadViews()
          // still runs either way — the folder picked is real in memory even
          // if it did not reach data.json, and refusing to reload the views
          // over a persistence failure would make one problem look like two.
          try {
            await this.plugin.saveSettings();
          } catch (e) {
            new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
          }
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
          try {
            await this.plugin.saveSettings();
          } catch (e) {
            new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
          }
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
            try {
              await this.plugin.saveSettings();
            } catch (e) {
              new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
            }
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
          try {
            await this.plugin.saveSettings();
          } catch (e) {
            new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
          }
        }));

    new Setting(containerEl)
      .setName('Privacy splash screen')
      .setDesc('Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.')
      .addToggle(t => t
        .setValue(this.plugin.settings.privacyLock)
        .onChange(async v => {
          this.plugin.settings.privacyLock = v;
          try {
            await this.plugin.saveSettings();
          } catch (e) {
            new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
          }
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
  /* Obsidian calls this when the tab closes. The six text fields below debounce
     their Settings.md write by 800ms, so closing the tab mid-keystroke otherwise
     left a write + reloadViews() to fire against a tab that no longer exists —
     the same teardown discipline the view controller applies in destroy(). */
  hide() {
    clearTimeout(this._hhTimer);
    clearTimeout(this._ownersTimer);
    clearTimeout(this._groupsTimer);
    clearTimeout(this._nonEssTimer);
    clearTimeout(this._msdTimer);
    clearTimeout(this._curTimer);
    clearTimeout(this._lagTimer);
    clearTimeout(this._anchorTimer);
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
            // quotes rather than escaping them, so 'Alex "The General"' saved
            // as 'Alex The General'.
            await this.plugin.updateBudgetSettingsMd('household', yamlStr(v.trim()));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Household members')
      .setDesc(OWNERS_DESC)
      .addText(t => {
        t.setPlaceholder('Alex, Sam');
        // Re-serialised from the parse rather than echoed back raw, so the field
        // shows the list the app is actually running — a stray comma or a
        // duplicate reads back tidied instead of sitting there looking accepted.
        t.setValue(parseOwners(md.owners).join(', '));
        t.onChange(v => {
          clearTimeout(this._ownersTimer);
          this._ownersTimer = setTimeout(async () => {
            await this.plugin.updateBudgetSettingsMd('owners', yamlStr(parseOwners(v).join(', ')));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Category groups')
      .setDesc(GROUPS_DESC)
      .addText(t => {
        t.setPlaceholder('property, treats');
        // Re-serialised from the parse, like owners: a built-in name or a
        // duplicate reads back dropped instead of sitting there looking accepted.
        t.setValue(parseGroups(md.groups).join(', '));
        t.onChange(v => {
          clearTimeout(this._groupsTimer);
          this._groupsTimer = setTimeout(async () => {
            await this.plugin.updateBudgetSettingsMd('groups', yamlStr(parseGroups(v).join(', ')));
            this.plugin.reloadViews();
            /* A new group is a new row below, and a removed one takes its row
               with it — without this the list underneath describes the groups
               this tab opened with, not the ones the vault now has. */
            if (this._redrawNonEssential) await this._redrawNonEssential();
          }, 800);
        });
      });

    /* Its own container so the group list can be redrawn on its own when
       Category groups above changes. Rebuilding the WHOLE tab would be the
       obvious fix and is the wrong one: the groups field debounces at 800ms,
       so the tab would rebuild under a reader who is still typing in it and
       take the focus out of the box mid-word. */
    const nonEssSection = containerEl.createDiv();
    /* The snapshot each toggle reads and writes through. Kept in the closure
       and updated after every write, because `md` was read once when the tab
       opened: the shipped bug was that adding "treats" above and then naming
       it here in the same visit validated the second against the group list
       from BEFORE the first, so the word was silently dropped. */
    let live = md;
    const drawNonEssential = () => {
      nonEssSection.empty();
      new Setting(nonEssSection).setName('Non-essential groups').setHeading().setDesc(NONESSENTIAL_DESC);
      for (const row of this.nonEssentialRows(live)) {
        new Setting(nonEssSection)
          .setName(row.label)
          .addToggle(t => t
            .setValue(row.on)
            .onChange(async v => {
              live = { ...live, nonessential_groups: await this.setNonEssential(live, row.key, v) };
            }));
      }
    };
    drawNonEssential();
    this._redrawNonEssential = async () => {
      live = await this.plugin.readBudgetSettingsMd();
      drawNonEssential();
    };

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
            // Read the previous value before the write, same ordering as the
            // anchor field below — afterwards there is nothing to compare against.
            this.noticeMonthStartReslices(md, Number(md.month_start_day ?? 23), n);
            await this.plugin.updateBudgetSettingsMd('month_start_day', String(n));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Overspend lag')
      .setDesc(OVERSPEND_LAG_DESC)
      .addText(t => {
        t.inputEl.type = 'number';
        t.setValue(String(overspendLag(md.overspend_lag)));
        t.onChange(v => {
          clearTimeout(this._lagTimer);
          this._lagTimer = setTimeout(async () => {
            const n = parseInt(v, 10);
            // Say so, same as the month start day above — a bare return leaves
            // the rejected value sitting in the field looking saved.
            if (!Number.isFinite(n) || n < 1 || n > OVERSPEND_LAG_MAX) {
              new Notice(`Budget: "${v}" is not a valid overspend lag — enter a number from 1 to ${OVERSPEND_LAG_MAX}.`, 6000);
              return;
            }
            await this.plugin.updateBudgetSettingsMd('overspend_lag', String(n));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Emergency fund target')
      .setDesc(EMERGENCY_TARGET_DESC)
      .addText(t => {
        t.inputEl.type = 'number';
        t.setValue(String(emergencyTarget(md.emergency_target_months)));
        t.onChange(v => {
          clearTimeout(this._emergencyTimer);
          this._emergencyTimer = setTimeout(async () => {
            const n = parseInt(v, 10);
            // Say so, same as the two above — a bare return leaves the rejected
            // value sitting in the field looking saved.
            if (!Number.isFinite(n) || n < 1 || n > EMERGENCY_TARGET_MAX) {
              new Notice(`Budget: "${v}" is not a valid emergency fund target — enter a number of months from 1 to ${EMERGENCY_TARGET_MAX}.`, 6000);
              return;
            }
            await this.plugin.updateBudgetSettingsMd('emergency_target_months', String(n));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName('Period length')
      .setDesc(periodLengthDesc(md))
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
            /* Period length's description is derived from this value, so fixing
               the anchor here has to redraw it — otherwise the tab goes on
               claiming periods are monthly after they stopped being. Only when
               the warning actually flips: display() rebuilds the whole tab, and
               doing that on every keystroke-settled edit would yank the focus
               out of this very field. */
            if (periodNeedsAnchor(md) !== periodNeedsAnchor({ ...md, period_anchor: next })) this.display();
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
      .setName('How you add transactions')
      .setDesc(INPUT_MODE_DESC)
      .addDropdown(d => {
        for (const [v, label] of Object.entries(INPUT_MODE_OPTIONS)) d.addOption(v, label);
        // Through inputMode(), so the control shows the mode the app is
        // actually running rather than whatever a hand-edited file says —
        // the same rule period_days and overspend_lag follow.
        d.setValue(inputMode(md.input_mode));
        d.onChange(async v => {
          await this.plugin.updateBudgetSettingsMd('input_mode', inputMode(v));
          // reloadViews() routes through connectVault(), which is where the
          // drawer link and top-bar button are gated — so the change lands on
          // an open view rather than at the next mount, the same way country
          // does.
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

    /* The currency CODE, beside the symbol it belongs to. Two fields for one
       currency is a cost, and it is paid on purpose: the symbol is what gets
       printed, the code is what an exchange-rate provider understands, and no
       reliable mapping exists between them — "$" is USD, AUD, CAD or SGD
       depending on whose vault it is. Guessing is how the wrong number gets
       printed with total confidence, so the app asks instead. Blank is a
       perfectly good answer; it just means rates cannot be fetched. */
    new Setting(containerEl)
      .setName(i18n.t('settings.currencyCode.name'))
      .setDesc(i18n.t('settings.currencyCode.desc'))
      .addText(t => {
        t.setPlaceholder('ZAR');
        t.setValue(md.currency_code ?? '');
        t.onChange(v => {
          clearTimeout(this._codeTimer);
          this._codeTimer = setTimeout(async () => {
            await this.plugin.updateBudgetSettingsMd('currency_code', yamlStr(normalizeCode(v)));
            this.plugin.reloadViews();
          }, 800);
        });
      });

    new Setting(containerEl)
      .setName(i18n.t('settings.exchangeRates.name'))
      .setDesc(i18n.t('settings.exchangeRates.desc'))
      .addDropdown(d => {
        for (const [v, label] of Object.entries(FX_OPTIONS())) d.addOption(v, label);
        d.setValue(fxMode(md.exchange_rates));
        d.onChange(async v => {
          await this.plugin.updateBudgetSettingsMd('exchange_rates', fxMode(v));
          this.plugin.reloadViews();
          this.display();
        });
      });

    /* Only worth showing when rates are actually on: a cadence for a feature
       that makes no requests is a control over nothing, and this tab already
       hides the rest of the currency block the same way. display() re-runs on
       every exchange_rates change above, so the row appears and disappears
       with it. */
    if (fxMode(md.exchange_rates) === 'on') {
      new Setting(containerEl)
        .setName(i18n.t('settings.rateRefresh.name'))
        .setDesc(i18n.t('settings.rateRefresh.desc'))
        .addDropdown(d => {
          for (const [v, label] of Object.entries(CADENCE_OPTIONS())) d.addOption(v, label);
          d.setValue(normalizeCadence(md.rate_refresh));
          d.onChange(async v => {
            await this.plugin.updateBudgetSettingsMd('rate_refresh', normalizeCadence(v));
            this.plugin.reloadViews();
          });
        });
    }
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

  /* Month start day is the gap the two controls above already cover: neither
     strandedBudgetCount's monthly-monthly branch nor period_anchor's own
     warning fires here, because a YYYY-MM file's NAME never changes — only the
     window period.js reads it against does. On the vault this was built
     against, moving the day from 23 to 1 pulled 2026-08.md's window from
     2026-07-23..2026-08-22 (R16,200 actual spend, 3 rows) to
     2026-08-01..2026-08-31 (R6,800, 2 rows) — a 2.4x change in a figure that
     looked untouched because the file it came from was. Split from the Notice
     purely so it can be tested, same as strandedBudgetCount above.
     Ignored outside monthly mode: periodLengthDesc() already tells the reader
     the day is unused once a pay-cycle length is active, so warning about it
     here too would fire on a setting with zero effect on anything shown. */
  monthStartReslicesCount(md, before, after) {
    if (before === after) return 0;
    if (periodDaysOrZero(md.period_days)) return 0;
    return this.monthBudgetCount();
  }
  noticeMonthStartReslices(md, before, after) {
    const n = this.monthStartReslicesCount(md, before, after);
    if (!n) return;
    new Notice(i18n.t('settings.monthStartReslices', { count: n }), 10000);
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
    // Through the parse, so the control shows the list the app runs rather than
    // whatever the file happens to say — and so a YAML flow list, which
    // metadataCache hands over as a real array, reaches a text control as text.
    if (key === 'owners') return parseOwners(md.owners).join(', ');
    if (key === 'groups') return parseGroups(md.groups).join(', ');
    if (key === 'nonessential_groups') return parseNonEssential(md.nonessential_groups, parseGroups(md.groups)).join(', ');
    if (key === 'month_start_day') return Number(md.month_start_day ?? 23);
    // Clamped on the way out, like period_days below: the control shows what
    // the app is actually running, not what a hand-edited file happens to say.
    if (key === 'overspend_lag') return overspendLag(md.overspend_lag);
    // Clamped on the way out for the same reason as overspend_lag above.
    if (key === 'emergency_target_months') return emergencyTarget(md.emergency_target_months);
    // Dropdown values are strings; the banded number keeps the control honest
    // about what the app is running rather than what the file happens to say.
    if (key === 'period_days') return String(periodDaysOrZero(md.period_days));
    if (key === 'period_anchor') return (md.period_anchor ?? '').toString().trim();
    if (key === 'currency') return md.currency ?? 'R';
    // Normalised on the way out, like country and input_mode above: the field
    // shows the code the app will actually SEND, not whatever was typed. A
    // symbol pasted in here reads back as blank rather than sitting in the box
    // looking accepted while no rate is ever fetched for it.
    if (key === 'currency_code') return normalizeCode(md.currency_code);
    // Same contract as input_mode: absent means off, and an unknown
    // hand-edited value reads as the mode the app is running.
    if (key === 'exchange_rates') return fxMode(md.exchange_rates);
    /* Same contract as exchange_rates: absent means the default the app is
       actually running (daily), and a hand-edited `rate_refresh: hourly`
       reads back as daily rather than leaving the dropdown on nothing. */
    if (key === 'rate_refresh') return normalizeCadence(md.rate_refresh);
    // Normalised on the way out for the same reason period_days is: absent
    // means 'csv', and an unknown hand-edited value has to READ as the mode
    // the app is running rather than leaving the dropdown on nothing.
    if (key === 'input_mode') return inputMode(md.input_mode);
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
    if (key === 'month_start_day') {
      const n = parseInt(value, 10);
      if (n >= 1 && n <= 28) {
        this.noticeMonthStartReslices(this.mdSettings(), Number(this.mdSettings().month_start_day ?? 23), n);
      }
    }
    const raw = key === 'owners' ? yamlStr(parseOwners(value).join(', '))
      : key === 'groups' ? yamlStr(parseGroups(value).join(', '))
      : key === 'nonessential_groups' ? yamlStr(parseNonEssential(value, parseGroups(this.mdSettings().groups)).join(', '))
      : key === 'household' || key === 'currency' ? yamlStr(String(value).trim())
      : key === 'currency_code' ? yamlStr(normalizeCode(value))
      : key === 'exchange_rates' ? fxMode(value)
      : key === 'rate_refresh' ? normalizeCadence(value)
      : key === 'month_start_day' ? String(parseInt(value, 10))
      : key === 'overspend_lag' ? String(overspendLag(value))
      : key === 'emergency_target_months' ? String(emergencyTarget(value))
      : key === 'period_days' ? String(periodDaysOrZero(value))
      : key === 'period_anchor' ? String(value).trim()
      : key === 'country' ? String(value)
      : key === 'input_mode' ? inputMode(value)
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

  /* One row per group this household could plausibly stop paying for, in the
     order the Budget page shows them. Built-in types are labelled with the
     same words the wizard and the Type column use (wiz.type.*), so the toggle
     and the header it governs read alike; a custom group is its own key,
     which is also its label — groups.js has no key=Label syntax on purpose.

     The six in NON_ESSENTIAL_TYPES are filtered out rather than rendered
     ticked-and-disabled. health-math.js drops them whatever this setting
     says, so offering a switch would promise a choice that does not exist. */
  nonEssentialRows(md) {
    const groups = parseGroups(md && md.groups);
    const current = new Set(parseNonEssential(md && md.nonessential_groups, groups));
    const builtin = new Set(TYPE_ORDER);
    return typeOrder(groups)
      .filter(k => !NON_ESSENTIAL_TYPES.has(k))
      .map(k => ({
        key: k,
        label: builtin.has(k) ? i18n.t('wiz.type.' + k) : k,
        on: current.has(k),
      }));
  }

  /* Flip one group and write the whole list back, re-ordered to typeOrder so
     the file reads the way the page does rather than in click order. Returns
     the value written, so the caller can keep its own snapshot current
     instead of re-reading the vault after every tap. */
  async setNonEssential(md, key, on) {
    const groups = parseGroups(md && md.groups);
    const next = new Set(parseNonEssential(md && md.nonessential_groups, groups));
    if (on) next.add(key); else next.delete(key);
    const ordered = typeOrder(groups).filter(k => next.has(k)).join(', ');
    await this.plugin.updateBudgetSettingsMd('nonessential_groups', yamlStr(ordered));
    this.plugin.reloadViews();
    return ordered;
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
        name: 'Household members',
        desc: OWNERS_DESC,
        control: { type: 'text', key: 'owners', placeholder: 'Alex, Sam' },
      },
      {
        name: 'Category groups',
        desc: GROUPS_DESC,
        control: { type: 'text', key: 'groups', placeholder: 'property, treats' },
      },
      /* The declarative twin of drawNonEssential() above. This method re-runs
         on every update(), and mdSettings() is a synchronous metadataCache
         read, so the list here is rebuilt from current state each time — the
         stale-snapshot bug the imperative side needs its own redraw for
         cannot arise on this path.

         `render` rather than a bound `control`: a control binds ONE storage
         key, and these rows are many switches over one comma list. Their
         names are built from the vault's own groups, so they are deliberately
         invisible to tests/settings-parity.test.cjs's literal-name scan —
         absent from both halves, therefore consistent. The heading below is
         the static name that IS pinned on both sides. */
      {
        name: 'Non-essential groups',
        desc: NONESSENTIAL_DESC,
        render: setting => { setting.setHeading(); },
      },
      ...this.nonEssentialRows(this.mdSettings()).map(row => ({
        name: row.label,
        render: setting => setting.addToggle(t => t
          .setValue(row.on)
          .onChange(v => { this.setNonEssential(this.mdSettings(), row.key, v); })),
      })),
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
        name: 'Overspend lag',
        desc: OVERSPEND_LAG_DESC,
        control: {
          type: 'number', key: 'overspend_lag', defaultValue: OVERSPEND_LAG_DEFAULT, min: 1, max: OVERSPEND_LAG_MAX,
          validate: v => {
            const n = parseInt(v, 10);
            return n >= 1 && n <= OVERSPEND_LAG_MAX ? undefined : `Pick a number between 1 and ${OVERSPEND_LAG_MAX}.`;
          },
        },
      },
      {
        name: 'Emergency fund target',
        desc: EMERGENCY_TARGET_DESC,
        control: {
          type: 'number', key: 'emergency_target_months', defaultValue: EMERGENCY_TARGET_DEFAULT,
          min: 1, max: EMERGENCY_TARGET_MAX,
          validate: v => {
            const n = parseInt(v, 10);
            return n >= 1 && n <= EMERGENCY_TARGET_MAX ? undefined : `Pick a number of months between 1 and ${EMERGENCY_TARGET_MAX}.`;
          },
        },
      },
      {
        name: 'Period length',
        desc: periodLengthDesc(this.mdSettings()),
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
        name: 'How you add transactions',
        desc: INPUT_MODE_DESC,
        control: {
          type: 'dropdown', key: 'input_mode', defaultValue: INPUT_MODE_DEFAULT,
          options: INPUT_MODE_OPTIONS,
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
      {
        name: i18n.t('settings.currencyCode.name'),
        desc: i18n.t('settings.currencyCode.desc'),
        control: {
          type: 'text', key: 'currency_code', placeholder: 'ZAR',
          /* Blank is valid — it means "do not fetch rates", which is the
             default and a complete answer. Only a non-blank value that is not
             a code is rejected, because that one is a mistake the reader
             cannot see the consequence of: the field looks filled in and no
             rate is ever fetched. */
          validate: v => (!String(v).trim() || normalizeCode(v) ? undefined
            : 'Use a three-letter code like ZAR, USD or EUR — not a symbol.'),
        },
      },
      {
        name: i18n.t('settings.exchangeRates.name'),
        desc: i18n.t('settings.exchangeRates.desc'),
        control: {
          type: 'dropdown', key: 'exchange_rates', defaultValue: 'off',
          options: FX_OPTIONS(),
        },
      },
      {
        name: i18n.t('settings.rateRefresh.name'),
        desc: i18n.t('settings.rateRefresh.desc'),
        control: {
          type: 'dropdown', key: 'rate_refresh', defaultValue: 'daily',
          options: CADENCE_OPTIONS(),
        },
      },
    ];
  }
}

module.exports = { BudgetSettingTab };
