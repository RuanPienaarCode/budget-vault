'use strict';
/* First-run onboarding wizard. Collects the budget folder, a display name,
   the period convention, currency and (for a fresh folder) starter categories
   plus a first account, then scaffolds every file the loader expects.
   Obsidian Modal + Setting controls only, so it works on iOS like the rest
   of the app. Nothing is written to disk until the final step's button. */

const { Modal, Setting, Notice, normalizePath, TFile, TFolder } = require('obsidian');

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

/* Same period math as period.js currentPeriod, but for a day chosen in the
   wizard (the view ctx doesn't exist yet). */
function currentPeriodFor(day) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  if (day > 1 && now.getDate() >= day) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}
const safeFileName = s => s.replace(/[\\/:*?"<>|]/g, '-').trim();

class OnboardingWizard extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.finished = false;
    this.stepIdx = 0;
    this.mode = 'create';           // 'create' | 'connect' — decided after the folder step
    this.data = {
      folder: plugin.settings.budgetFolder || 'Finances/Budget',
      name: '',
      periodMode: 'payday',         // 'calendar' | 'payday'
      payday: 25,
      currency: 'R',
      customCurrency: '',
      cats: new Set(STARTER_CATEGORIES.map(c => c.name)),
      acctName: '', acctType: 'checking', acctInstitution: '',
    };
  }

  steps() {
    return this.mode === 'connect'
      ? ['folder', 'existing', 'name', 'period', 'currency', 'finish']
      : ['folder', 'name', 'period', 'currency', 'categories', 'account', 'finish'];
  }

  onOpen() {
    this.titleEl.setText('Set up Smart Budget');
    this.renderStep();
  }
  onClose() {
    this.contentEl.empty();
    if (!this.finished) {
      new Notice('Setup skipped — run "Smart Budget: Set up budget" from the command palette anytime.', 6000);
      // Don't nag on every launch; the command and the settings-tab button remain.
      this.plugin.settings.onboarded = true;
      this.plugin.saveSettings();
    }
  }

  /* ------------------------------ navigation ------------------------------ */
  renderStep() {
    const c = this.contentEl;
    c.empty();
    const steps = this.steps();
    const step = steps[this.stepIdx];
    c.createDiv({ cls: 'budget-onb-step', text: `Step ${this.stepIdx + 1} of ${steps.length}` });
    this['render_' + step](c);

    const nav = new Setting(c);
    if (this.stepIdx > 0) nav.addButton(b => b.setButtonText('Back').onClick(() => { this.stepIdx--; this.renderStep(); }));
    nav.addButton(b => b.setButtonText('Cancel').onClick(() => this.close()));
    nav.addButton(b => b
      .setButtonText(step === 'finish' ? (this.mode === 'connect' ? 'Connect budget' : 'Create my budget') : 'Next')
      .setCta()
      .onClick(() => this.next()));
  }

  async next() {
    const step = this.steps()[this.stepIdx];
    if (step === 'folder') {
      const folder = normalizePath((this.data.folder || '').trim());
      if (!folder || folder === '/') { new Notice('Enter a folder path for the budget.'); return; }
      this.data.folder = folder;
      const wasConnect = this.mode === 'connect';
      this.mode = this.detectExisting(folder) ? 'connect' : 'create';
      if (this.mode === 'connect' && !wasConnect) await this.prefillFromSettingsMd();
    }
    if (step === 'period' && this.data.periodMode === 'payday') {
      const d = Number(this.data.payday);
      if (!Number.isInteger(d) || d < 1 || d > 28) { new Notice('Payday must be a day from 1 to 28.'); return; }
    }
    if (step === 'currency' && this.data.currency === '__custom__' && !this.data.customCurrency.trim()) {
      new Notice('Enter a currency symbol.'); return;
    }
    if (step === 'finish') { await this.apply(); return; }
    this.stepIdx++;
    this.renderStep();
  }

  detectExisting(folder) {
    const v = this.app.vault;
    return v.getAbstractFileByPath(normalizePath(folder + '/Settings.md')) instanceof TFile ||
           v.getAbstractFileByPath(normalizePath(folder + '/Categories')) instanceof TFolder;
  }
  async prefillFromSettingsMd() {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(this.data.folder + '/Settings.md'));
    if (!(f instanceof TFile)) return;
    const { parseFrontmatter } = require('./util');
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    const day = parseInt(fm.month_start_day, 10);
    if (day >= 1 && day <= 28) { this.data.payday = day; this.data.periodMode = day === 1 ? 'calendar' : 'payday'; }
    if (fm.currency) {
      if (CURRENCIES.some(([v]) => v === fm.currency)) this.data.currency = fm.currency;
      else { this.data.currency = '__custom__'; this.data.customCurrency = fm.currency; }
    }
    if (fm.household) this.data.name = fm.household;
  }

  /* -------------------------------- steps -------------------------------- */
  render_folder(c) {
    c.createEl('p', { text: 'Smart Budget stores everything — categories, accounts, budgets and transactions — as plain markdown files in your vault, so your data syncs with the vault and stays yours.' });
    new Setting(c)
      .setName('Budget folder')
      .setDesc('Vault path where the budget files live (created if it doesn\'t exist).')
      .addText(t => t
        .setPlaceholder('Finances/Budget')
        .setValue(this.data.folder)
        .onChange(v => { this.data.folder = v; }));
  }

  render_existing(c) {
    c.createEl('p', { text: `Found an existing budget in "${this.data.folder}" — connecting to it instead of creating new files. The next steps just confirm your settings; nothing else is touched.` });
  }

  render_name(c) {
    new Setting(c)
      .setName('Your name or nickname')
      .setDesc('Shown in the dashboard greeting and the top bar. Leave blank to skip.')
      .addText(t => t
        .setPlaceholder('e.g. Alex, or The Smiths')
        .setValue(this.data.name)
        .onChange(v => { this.data.name = v; }));
  }

  render_period(c) {
    new Setting(c)
      .setName('Budget month')
      .setDesc('Calendar runs 1st → end of month. Payday runs from your payday to the day before the next one.')
      .addDropdown(d => d
        .addOption('calendar', 'Calendar month (1st to end of month)')
        .addOption('payday', 'Payday to payday')
        .setValue(this.data.periodMode)
        .onChange(v => { this.data.periodMode = v; this.renderStep(); }));
    if (this.data.periodMode === 'payday') {
      new Setting(c)
        .setName('Payday')
        .setDesc('Day of the month you get paid (1–28).')
        .addText(t => {
          t.inputEl.type = 'number';
          t.setValue(String(this.data.payday));
          t.onChange(v => { this.data.payday = v; });
        });
    }
  }

  render_currency(c) {
    new Setting(c)
      .setName('Currency symbol')
      .setDesc('Shown before every amount.')
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

  render_categories(c) {
    c.createEl('p', { text: 'Start with a set of budget categories — untick any you don\'t want. You can add, rename or recolour categories later.' });
    const grid = c.createDiv({ cls: 'budget-onb-cats' });
    for (const cat of STARTER_CATEGORIES) {
      const label = grid.createEl('label');
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = this.data.cats.has(cat.name);
      cb.addEventListener('change', () => {
        if (cb.checked) this.data.cats.add(cat.name); else this.data.cats.delete(cat.name);
      });
      label.appendText(` ${cat.name}`);
      label.createEl('span', { cls: 'budget-onb-cat-type', text: cat.type });
    }
  }

  render_account(c) {
    c.createEl('p', { text: 'Transactions are stored per account. Add your main account now, or leave the name blank to skip.' });
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
  }

  render_finish(c) {
    const day = this.monthStartDay();
    const rows = [
      ['Folder', this.data.folder],
      ['Name', this.data.name.trim() || '—'],
      ['Budget month', day === 1 ? 'Calendar month' : `Payday to payday (day ${day})`],
      ['Currency', this.currencySymbol()],
    ];
    if (this.mode === 'create') {
      rows.push(['Categories', `${this.data.cats.size} starter categories`]);
      rows.push(['First account', this.data.acctName.trim() || '—']);
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
  }

  /* -------------------------------- apply --------------------------------- */
  monthStartDay() {
    return this.data.periodMode === 'calendar' ? 1 : Math.min(28, Math.max(1, parseInt(this.data.payday, 10) || 25));
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
        await p.updateBudgetSettingsMd('currency', `"${cur.replace(/"/g, '')}"`);
        if (name) await p.updateBudgetSettingsMd('household', `"${name.replace(/"/g, '')}"`);
      } else {
        for (const sub of ['Categories', 'Accounts', 'Budgets', 'Transactions', 'Tax', 'Data']) {
          await this.ensureFolder(normalizePath(`${folder}/${sub}`));
        }
        await this.writeIfAbsent(normalizePath(`${folder}/Settings.md`),
          `---\nmonth_start_day: ${day}\ncurrency: "${cur.replace(/"/g, '')}"\n` +
          (name ? `household: "${name.replace(/"/g, '')}"\n` : '') +
          `tags: [finance, finance/budget, vault-meta]\n---\n\n# Budget Settings\n\n` +
          `- **month_start_day** — the financial period starts on this day of the month.\n` +
          `- **currency** — symbol shown before every amount in the Smart Budget plugin.\n` +
          `- **household** — name shown in the dashboard greeting.\n\n` +
          `Edit the values above directly, or change them in **Settings → Smart Budget** —\n` +
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
          await this.writeIfAbsent(normalizePath(`${folder}/Accounts/${safe}.md`),
            `---\ntype: ${this.data.acctType}\n` +
            (this.data.acctInstitution.trim() ? `institution: ${this.data.acctInstitution.trim()}\n` : '') +
            `balance: 0.00\nbalance_updated: ${ymd}\ntags: [finance, finance/budget, finance/budget/accounts]\n---\n\n# ${acct}\n\nTransactions are stored under \`Transactions/${safe}/\` as monthly files.\n`);
          await this.ensureFolder(normalizePath(`${folder}/Transactions/${safe}`));
        }
        const period = currentPeriodFor(day);
        await this.writeIfAbsent(normalizePath(`${folder}/Budgets/${period}.md`),
          `---\nperiod: ${period}\ntags: [finance, finance/budget, finance/budget/budgets]\n---\n\n# Budget — ${period}\n\n` +
          `| Category | Type | Amount | Notes |\n|----------|------|-------:|-------|\n`);
        await this.writeIfAbsent(normalizePath(`${folder}/Owed Money.md`),
          `---\nkind: owed\ntags: [finance, finance/budget, finance/budget/owed-money]\n---\n\n# Owed Money\n\n` +
          `Money owed to the household. \`status\` is \`outstanding\` or \`paid\`.\n\n` +
          `| Person | Amount | Description | Due date | Status |\n|--------|-------:|-------------|----------|--------|\n`);
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
