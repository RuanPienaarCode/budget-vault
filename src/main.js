'use strict';
/* ============================================================================
   SMART BUDGET — Obsidian plugin (entry point)
   Port of "Budget App.html". Reads and writes the markdown files in the
   Finances/Budget folder through the Vault API (no File System Access API,
   no Chrome, no permission prompts — works on desktop and iOS/Android).

   Source lives in src/ as plain-JS CommonJS modules; `./build.sh` bundles
   them with bun into the single main.js that Obsidian loads.
   ============================================================================ */

const { Plugin, TFile, TFolder, Notice, normalizePath } = require('obsidian');
const { VIEW_TYPE, DEFAULT_SETTINGS } = require('./constants');
const { parseFrontmatter, patchFrontmatter } = require('./markdown');
const { makeIo } = require('./io');
const { defaultLanguage } = require('./i18n');
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
    this.addCommand({
      id: 'tidy-categorisation-rules',
      name: 'Tidy categorisation rules',
      callback: () => {
        // Needs the vault already read into memory — the cleanup is decided by
        // replaying real transaction descriptions, which only an open (and
        // unlocked) view has. Nothing is written without the preview's OK.
        let ran = false;
        this.forEachView(ctl => { if (!ran) { ran = true; ctl.cleanupRules(); } });
        if (!ran) new Notice('Budget: open the budget first, then run this again.', 5000);
      },
    });
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
    return !!v.getFileByPath(this.settingsMdPath()) ||
      !!v.getFolderByPath(normalizePath(this.settings.budgetFolder + '/Categories'));
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
    const f = this.app.vault.getFileByPath(this.settingsMdPath());
    if (!f) return {};
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    return fm;
  }
  async updateBudgetSettingsMd(key, value) {
    const f = this.app.vault.getFileByPath(this.settingsMdPath());
    /* One guarded writer for both branches. makeIo's writeFile is rooted at
       the budget folder ('Settings.md' resolves to settingsMdPath), does the
       create-or-modify split itself, carries the containment check this
       method used to lack, and stamps the shared write-guard — which was
       previously spelled out by hand four times here, where missing one
       means the watcher reloads over our own write. */
    const io = makeIo({ vault: this.app.vault, plugin: this });
    let text;
    if (f) {
      text = await this.app.vault.read(f);
      /* patchFrontmatter, not a line regex. The line regex this replaced could
         not collapse a BLOCK value: patching `owners:` written as a YAML list
         (`owners:` newline `  - Ruan` — the way a YAML-literate user writes a
         list of people) replaced the key line and orphaned the `- item` lines.
         That is invalid YAML; this plugin's first-colon parser reads it back
         happily, but Obsidian drops every property on the file, blanking the
         whole settings tab — on the one file every device syncs.
         patchFrontmatter collapses block→scalar by design and preserves
         unmodeled keys verbatim. It also treats the key as data, where the
         regex interpolated it into a pattern unescaped. */
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const block = patchFrontmatter(m ? m[1] : '', { [key]: value });
      text = m
        ? `---\n${block}\n---` + text.slice(m[0].length)
        : `---\n${block}\n---\n\n` + text;
    } else {
      // No Settings.md yet — create it with defaults plus the requested key,
      // whatever that key is (country/household included, not just the two
      // defaults).
      const defaults = { month_start_day: '23', currency: 'R', country: 'za', language: defaultLanguage() };
      defaults[key] = value;
      text = '---\n' + Object.entries(defaults).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n\n# Budget Settings\n';
    }
    await io.writeFile('Settings.md', text);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

module.exports = BudgetPlugin;
