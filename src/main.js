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
const { buildApi } = require('./api');
const books = require('./books');

class BudgetPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0;   // shared write-guard timestamp (see io.js stampWrite)
    /* The privacy splash's session flag, shared by every Budget view and the
       headless API: false until "Enter budget" is tapped in this session.
       setBudgetUnlocked() below is how the gate moves it; api.js's header
       has the whole contract. */
    this.budgetUnlocked = false;
    /* Headless read API for a sibling plugin — app.plugins.plugins['budget-app'].api.
       Built here, before any view can exist, so the gate's hook always has an
       API to tell. Building it reads nothing and registers no vault handler:
       api.js registers its watcher when a sibling first subscribes
       (registerEvent works at any point while the plugin is loaded and is
       still undone at unload), and builds its own ctx (io + period + load +
       trend-math + figures — no view, no DOM) on first real use. */
    this.api = buildApi(this);
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
    this.addCommand({
      id: 'import-transactions',
      name: 'Import a bank statement (CSV)',
      callback: async () => {
        /* The way back to the import screen when the drawer is not offering
           it. Manual mode HIDES that link and the top-bar button, and the
           Accounts page's own "Import transactions" button only appears on an
           account with nothing in it yet — so without this command a manual
           household that later gets a CSV, on an account that already has
           rows, has no route to the screen at all. The setting is the other
           way back, and both are named in the setting's own description.

           Opens the view first, unlike tidy-categorisation-rules above: that
           one needs a vault already read into memory to have anything to
           replay, while this one is a navigation and should work from a cold
           start rather than telling the reader to go and open the budget. */
        await this.activateView();
        let went = false;
        this.forEachView(ctl => { if (!went) { went = true; ctl.showImport(); } });
        if (!went) new Notice('Budget: open the budget first, then run this again.', 5000);
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
          // Guarded like every other write in this app: this callback is
          // fired by onLayoutReady and never awaited by anything, so a
          // rejected saveSettings() used to be an unhandled rejection with
          // nothing on screen. `onboarded` is already true in memory, so the
          // wizard will not open this session regardless of whether the write
          // landed — a failed save only means the adoption is retried (and
          // may fail the same way) on the next launch. No i18n import here,
          // same as the rest of this file — see settings.err.save for the
          // string this mirrors.
          try {
            await this.saveSettings();
          } catch (e) {
            new Notice(`Budget: could not save that setting (${e.message || e})`, 5000);
          }
          return;
        }
        new OnboardingWizard(this.app, this).open();
      });
    }
  }

  /* True when the open book's folder already contains budget files. With no
     book list (every vault before ADR 0009, and any vault that never adds one)
     the open book IS the home book, so the first-run adoption below asks the
     same question it always has. */
  hasBudgetData() {
    const v = this.app.vault;
    return !!v.getFileByPath(this.settingsMdPath()) ||
      !!v.getFolderByPath(normalizePath(this.activeFolder() + '/Categories'));
  }

  /* ---- Books (ADR 0009) ----------------------------------------------------
     The plugin's one door to the folder every path starts from: settings plus
     this device's stored choice, resolved to the open book. io.js basePath(), settingsMdPath(), the
     settings tab's Budgets/ counts and the export guard all ask here; a second
     reader of settings.budgetFolder would read the home book while the screen
     shows a client's, and tests/books-one-seam.test.cjs fails the build on one.
     The rule and its wiring are src/books.js (resolveOpenBook, activeFolderOf),
     pure and tested there; these methods only hand it the host's normalizePath
     and localStorage. Called on every relPath(), so single-book mode — an
     empty list — returns before local storage or the vault is consulted: a
     1.59 vault pays no read for books existing. */
  activeFolder() {
    return books.activeFolderOf(this, { normalize: normalizePath, getStorage: () => window.localStorage });
  }
  /* Every book's folder — home first — normalised the way activeFolder()
     returns one. The export guard refuses all of them, not only the open one,
     so an export cannot land in client B's Transactions/ while A is open. */
  allBookFolders() {
    return books.allBookFoldersOf(this, { normalize: normalizePath });
  }
  /* Remember `folder` as THIS device's open book (null forgets it, so the home
     book opens). Writes vault-scoped local storage only — never data.json,
     never settings.budgetFolder — so a switch on the phone does not move the
     laptop. It neither validates nor reloads: an unlisted or deleted folder
     simply resolves to the home book in activeFolder(), and refusing a switch
     while a page has unsaved edits is the switcher's job (#167, ADR 0009 §3).
     Returns whether the choice was stored. */
  setOpenBookLocal(folder) {
    return books.writeStoredBook(this.app, () => window.localStorage, folder);
  }

  /* switchBook(folder) → { ok: true } | { ok: false, reason }

     The ONE safe way to change the open book (ADR 0009 §3): the top-bar
     switcher calls it, and so will Settings → Books and the headless API, so
     the refusals live here once. `reason` is 'locked' (the privacy splash is
     up and not yet opened this session), 'unknown' (not the home book and not
     listed — or listed but its folder is gone, which would resolve straight
     back to the home book), or 'dirty' (a Budget view has unsaved edits).
     None of them throws, and every refusal leaves the open book, the stored
     choice and the unsaved edits exactly as they were. The order of the checks
     is src/books.js switchDecision's, with its reasons.

     DIRTY IS ASKED, AND THE KEY WRITTEN, WITH NO AWAIT BETWEEN. ctl.reload()
     below declines while a page is dirty — right for a settings change, wrong
     for a switch, where the key would already be written and the screen would
     keep showing one client over another's files — so dirtiness is read first,
     here, and the write follows in the same tick. A row typed in the gap
     cannot exist.

     On ok: the per-device key is written (never data.json, never
     budgetFolder), every open view reloads from the new book, and the headless
     API's subscribers are told — a switch produces no vault event, so the
     watcher that normally tells them would never fire. The privacy lock is NOT
     re-engaged: the splash is a session gate, not a per-client permission. A
     switch to the book that is already open does none of it. */
  async switchBook(folder) {
    const s = this.settings || {};
    let dirty = false;
    this.forEachView(ctl => { if (ctl.hasDirty()) dirty = true; });
    const decision = books.switchDecision({
      books: s.books,
      homeFolder: this.allBookFolders()[0],
      open: this.activeFolder(),
      target: folder,
      dirty,
      locked: !!s.privacyLock && !this.budgetUnlocked,
      folderExists: f => !!this.app.vault.getFolderByPath(normalizePath(f)),
    });
    if (!decision.ok) return { ok: false, reason: decision.reason };
    if (decision.noop) return { ok: true };
    /* No vault id, no per-device key (src/books.js writeStoredBook): nothing
       was stored, so nothing switched. Said as the closest of the three
       reasons rather than as a success that the next paint would contradict. */
    if (!this.setOpenBookLocal(decision.stored)) return { ok: false, reason: 'unknown' };
    try {
      await this.reloadViews();
      /* The API read its own copy of the budget folder under the previous
         book: _syncLock() retires any read it is holding as fresh (the same
         call saveData makes for a settings change), then _reload() re-reads
         the new book and notifies subscribers once. Both are no-ops with no
         subscribers or while locked. */
      if (this.api) { this.api._syncLock(); await this.api._reload(); }
    } catch (e) {
      /* The key is written and the views were asked to reload; a failure
         reading the new book is the reload's own to report (connectVault shows
         it on the connect screen), not a reason to claim the switch failed. */
      console.error('Budget: reloading after a book switch failed', e);
    }
    return { ok: true };
  }
  /* The home book's household name, from ITS Settings.md, or '' — for the
     switcher's label when the home folder is not itself in the book list. The
     open book's Settings.md is the controller's own S.settings; this is the
     one book whose file nobody has loaded while a client is open. Read-only,
     and any failure is "no name": a label must never take the top bar down. */
  async homeBookName() {
    try {
      const f = this.app.vault.getFileByPath(normalizePath(this.allBookFolders()[0] + '/Settings.md'));
      if (!f) return '';
      const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
      return typeof fm.household === 'string' ? fm.household.trim() : '';
    } catch (e) { return ''; }
  }
  /* Tell every open Budget view to redraw its book switcher — after a change
     to the list, which is a settings write and produces no reload. Guarded for
     the bare-node plugins that have no workspace, and for a view caught
     mid-mount. */
  refreshBookSwitchers() {
    const ws = this.app && this.app.workspace;
    if (!ws || typeof ws.getLeavesOfType !== 'function') return;
    try { this.forEachView(ctl => { if (typeof ctl.applyBooks === 'function') ctl.applyBooks(); }); } catch (e) { /* cosmetic */ }
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
  /* Resolves when every open view has finished its reload, so a caller that
     must act AFTER the screen shows the new data (switchBook telling the API's
     subscribers) can wait for it. Callers that do not care still ignore the
     return value, as before. */
  reloadViews() {
    // ctl.reload() is dirty-aware — it declines (with a Notice) rather than
    // discarding unsaved edits when a settings change triggers a reload.
    const pending = [];
    this.forEachView(ctl => pending.push(ctl.reload()));
    return Promise.all(pending);
  }

  /* ---- Settings.md (month_start_day / currency) read + in-place update ---- */
  settingsMdPath() {
    return normalizePath(this.activeFolder() + '/Settings.md');
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
      /* #76 item 3, the second reader of the same shape: with a leading BOM
         the match below misses, and the save PREPENDED a fresh block ahead of
         the real one — two frontmatter blocks, the user's properties buried
         below the first. Dropped here for the reason markdown.js's
         parseFrontmatter drops it: nothing this app writes carries one. */
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      /* patchFrontmatter, not a line regex. The line regex this replaced could
         not collapse a BLOCK value: patching `owners:` written as a YAML list
         (`owners:` newline `  - Alex` — the way a YAML-literate user writes a
         list of people) replaced the key line and orphaned the `- item` lines.
         That is invalid YAML; this plugin's first-colon parser reads it back
         happily, but Obsidian drops every property on the file, blanking the
         whole settings tab — on the one file every device syncs.
         patchFrontmatter collapses block→scalar by design and preserves
         unmodeled keys verbatim. It also treats the key as data, where the
         regex interpolated it into a pattern unescaped. */
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const eol = m && m[0].includes('\r\n') ? '\r\n' : '\n';
      const block = patchFrontmatter(m ? m[1] : '', { [key]: value });
      text = m
        ? `---${eol}${block}${eol}---` + text.slice(m[0].length)
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

  /* The privacy gate's way to the plugin-level session flag: controller.js
     calls this from unlockGate (true) and lockGate (false), and the headless
     API answers { locked: true } while the flag is false and the splash
     setting is on. Through the API rather than a bare assignment, so a sibling
     plugin already showing a figure is told the lock moved (api.js's
     header). */
  setBudgetUnlocked(open) {
    this.api._setUnlocked(open);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    /* A fresh list per load. Object.assign copies DEFAULT_SETTINGS.books by
       REFERENCE when data.json has none, and the default is frozen so that a
       push onto it throws instead of quietly adding a book to every later
       load of the defaults. */
    if (this.settings.books === DEFAULT_SETTINGS.books) this.settings.books = [];
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /* Every write of data.json passes through here: saveSettings() above, and
     Obsidian 1.13's declarative settings tab, whose
     PluginSettingTab.setControlValue writes with plugin.saveData(settings)
     directly (read in the 1.13.7 app.js). That is the path the Privacy splash
     toggle takes on 1.13, and it never reaches saveSettings(). settings-tab.js
     tells open VIEWS about the toggle (applyPrivacyLock); with no view open,
     this is the only place a toggled privacyLock reaches the headless API, so
     a sibling showing a figure hears that the splash went on. Checked before
     the write: the new value is already live in memory, and stays live if the
     write fails (settings.err.save). */
  async saveData(data) {
    if (this.api) this.api._syncLock();
    /* An empty book list is single-book mode and is not written: ADR 0009 has
       single-book mode put no new key into data.json, and every save of every
       existing vault would otherwise add `"books": []` (src/books.js
       persistableSettings). Here rather than in saveSettings() for the reason
       above — 1.13's settings tab reaches this method directly. */
    const out = await super.saveData(books.persistableSettings(data));
    /* A settings write is how the book list changes (Settings → Books), and a
       list change produces no vault event and no reload, so an open view's
       switcher would go on showing the old list until something else redrew
       it. Idempotent and cheap, so it runs on every write rather than only on
       the ones that touch `books`. */
    this.refreshBookSwitchers();
    return out;
  }
}

module.exports = BudgetPlugin;
