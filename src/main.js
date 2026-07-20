'use strict';
/* ============================================================================
   SMART BUDGET — Obsidian plugin (entry point)
   Port of "Budget App.html". Reads and writes the markdown files in the
   Finances/Budget folder through the Vault API (no File System Access API,
   no Chrome, no permission prompts — works on desktop and iOS/Android).

   Source lives in src/ as plain-JS CommonJS modules; `./build.sh` bundles
   them with bun into the single main.js that Obsidian loads.
   ============================================================================ */

const { Plugin, TFile, TFolder, normalizePath } = require('obsidian');
const { VIEW_TYPE, DEFAULT_SETTINGS } = require('./constants');
const { parseFrontmatter } = require('./util');
const { BudgetView } = require('./view');
const { BudgetSettingTab } = require('./settings-tab');
const { OnboardingWizard } = require('./onboarding');

class BudgetPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0;   // shared write-guard timestamp (see io.js stampWrite)
    this.registerView(VIEW_TYPE, leaf => new BudgetView(leaf, this));
    this.addRibbonIcon('wallet', 'Open budget', () => this.activateView());
    this.addCommand({ id: 'open-budget', name: 'Open budget', callback: () => this.activateView() });
    this.addCommand({ id: 'setup-wizard', name: 'Set up budget (onboarding wizard)', callback: () => new OnboardingWizard(this.app, this).open() });
    this.addSettingTab(new BudgetSettingTab(this.app, this));
    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        if (!this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
      });
    }
    if (!this.settings.onboarded) {
      // First run: if the configured folder already holds a budget (existing
      // user, new device), adopt it silently; otherwise open the wizard.
      this.app.workspace.onLayoutReady(async () => {
        if (this.hasBudgetData()) {
          this.settings.onboarded = true;
          await this.saveSettings();
          return;
        }
        new OnboardingWizard(this.app, this).open();
      });
    }
  }

  /* True when the configured budget folder already contains budget files. */
  hasBudgetData() {
    const v = this.app.vault;
    return v.getAbstractFileByPath(this.settingsMdPath()) instanceof TFile ||
      v.getAbstractFileByPath(normalizePath(this.settings.budgetFolder + '/Categories')) instanceof TFolder;
  }

  async activateView() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) { ws.revealLeaf(existing); return; }
    const leaf = ws.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }

  forEachView(fn) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof BudgetView && leaf.view.appCtl) fn(leaf.view.appCtl);
    }
  }
  reloadViews() {
    // ctl.reload() is dirty-aware — it declines (with a Notice) rather than
    // discarding unsaved edits when a settings change triggers a reload.
    this.forEachView(ctl => ctl.reload());
  }

  /* ---- Settings.md (month_start_day / currency) read + in-place update ---- */
  settingsMdPath() {
    return normalizePath(this.settings.budgetFolder + '/Settings.md');
  }
  async readBudgetSettingsMd() {
    const f = this.app.vault.getAbstractFileByPath(this.settingsMdPath());
    if (!(f instanceof TFile)) return {};
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    return fm;
  }
  async updateBudgetSettingsMd(key, value) {
    const path = this.settingsMdPath();
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      let text = await this.app.vault.read(f);
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (m) {
        let block = m[1];
        const re = new RegExp('^(' + key + '\\s*:).*$', 'm');
        // Replacer function, not a string — so `$`-sequences in the value
        // (e.g. a "$" currency) are written literally, not as $-patterns.
        if (re.test(block)) block = block.replace(re, (whole, g1) => `${g1} ${value}`);
        else block += `\n${key}: ${value}`;
        text = `---\n${block}\n---` + text.slice(m[0].length);
      } else {
        text = `---\n${key}: ${value}\n---\n\n` + text;
      }
      this._lastWrite = Date.now();          // stamp the shared write-guard so
      await this.app.vault.modify(f, text);  // the watcher treats this as ours
      this._lastWrite = Date.now();          // (single intentional reloadViews)
    } else {
      // No Settings.md yet — create it with defaults plus the requested key,
      // whatever that key is (country/household included, not just the two
      // defaults).
      const defaults = { month_start_day: '23', currency: 'R', country: 'za' };
      defaults[key] = value;
      this._lastWrite = Date.now();
      await this.app.vault.create(path,
        '---\n' + Object.entries(defaults).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n\n# Budget Settings\n');
      this._lastWrite = Date.now();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

module.exports = BudgetPlugin;
