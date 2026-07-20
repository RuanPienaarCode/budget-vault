'use strict';
/* loadVault — reads every budget file into the in-memory state S. */

const { TFile } = require('obsidian');
const { TYPE_ORDER } = require('./constants');
const { parseFrontmatter, parseMdTable, parseCsv, unescMd, parseNum } = require('./util');

module.exports = function registerLoad(ctx) {
  const { S, vault, readFile, mdFilesIn, subfoldersIn, currentPeriod } = ctx;

  async function loadVault() {
    const settingsTxt = await readFile('Settings.md');
    if (settingsTxt) {
      const { fm } = parseFrontmatter(settingsTxt);
      if (fm.month_start_day) {
        // Clamp 1–28 even for hand-edited files: 29–31 skews period lengths and
        // misassigns rolled-over days (the settings UI already clamps).
        const n = parseInt(fm.month_start_day, 10) || 23;
        S.settings.month_start_day = Math.min(28, Math.max(1, n));
      }
      if (fm.currency) S.settings.currency = fm.currency;
      // Country code (za/us/uk/…) — localeFor falls back to za for unknown
      // values, so a hand-edited Settings.md can't break the app.
      S.settings.country = (fm.country || 'za').toString().trim().toLowerCase();
      S.settings.household = fm.household || '';
    }
    S.categories = [];
    for (const f of mdFilesIn('Categories')) {
      const { fm } = parseFrontmatter(await vault.cachedRead(f));
      // Prefer the exact name from frontmatter — filenames drop filesystem-illegal
      // chars, so the frontmatter `name` is the source of truth.
      S.categories.push({ name: fm.name || f.basename, type: fm.type || 'expense', color: fm.color || '#888' });
    }
    S.categories.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));

    S.accounts = [];
    for (const f of mdFilesIn('Accounts')) {
      const { fm, body, raw } = parseFrontmatter(await vault.cachedRead(f));
      S.accounts.push({
        name: f.basename,
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        type: fm.type || 'other', institution: fm.institution || '',
        account_number: fm.account_number || '', tx_label: fm.tx_label || '',
        balance: parseFloat(fm.balance || '0') || 0,
        balance_updated: fm.balance_updated || '',
        credit_limit: fm.credit_limit ? parseFloat(fm.credit_limit) : null,
        goal_amount: fm.goal_amount ? parseFloat(fm.goal_amount) : null,
        target_date: fm.target_date || '',
        monthly_contribution: fm.monthly_contribution ? parseFloat(fm.monthly_contribution) : null,
        total_invested: fm.total_invested ? parseFloat(fm.total_invested) : null,
        starting_amount: fm.starting_amount ? parseFloat(fm.starting_amount) : null,
        inception_date: fm.inception_date || '',
        tags: fm.tags || '',
        body,
      });
    }
    S.accounts.sort((a, b) => a.name.localeCompare(b.name));

    S.budgets = {};
    S.budgetMeta = {};
    for (const f of mdFilesIn('Budgets')) {
      if (!/^\d{4}-\d{2}$/.test(f.basename)) continue;
      const period = f.basename;
      const text = await vault.cachedRead(f);
      const { raw } = parseFrontmatter(text);
      S.budgetMeta[period] = { raw };   // verbatim frontmatter for lossless write-back
      const rows = parseMdTable(text);
      S.budgets[period] = rows.slice(1).map(c => {
        const amt = parseNum(c[2]);
        return { category: unescMd(c[0]), type: c[1] || '', amount: amt.value, amountRaw: amt.ok ? null : amt.raw, notes: unescMd(c[3] || '') };
      });
    }

    S.txFiles = {};
    for (const acct of subfoldersIn('Transactions')) {
      for (const f of acct.children) {
        if (!(f instanceof TFile) || f.extension !== 'md' || !/^\d{4}-\d{2}$/.test(f.basename)) continue;
        const month = f.basename;
        const text = await vault.cachedRead(f);
        const { raw } = parseFrontmatter(text);
        const rows = parseMdTable(text);
        S.txFiles[`${acct.name}/${month}`] = {
          label: acct.name, month, dirty: false, fmRaw: raw,
          rows: rows.slice(1).map(c => {
            const amt = parseNum(c[3]);
            return { date: c[0], desc: unescMd(c[1]), cat: unescMd(c[2]),
              amount: amt.value, amountRaw: amt.ok ? null : amt.raw,
              excluded: (c[4] || '').toLowerCase() === 'yes', note: unescMd(c[5] || '') };
          }),
        };
      }
    }

    S.rules = [];
    const rulesCsv = await readFile('Data/Categorisation Rules.csv');
    if (rulesCsv) for (const row of parseCsv(rulesCsv).slice(1)) {
      if (row.length >= 2 && row[0]) S.rules.push({ pattern: row[0], category: row[1] });
    }

    S.owed = []; S.owedDirty = false;
    const owedTxt = await readFile('Owed Money.md');
    // Keep the file's own frontmatter verbatim (tags etc.) for write-back.
    S.owedFm = (owedTxt && parseFrontmatter(owedTxt).raw) || 'kind: owed';
    if (owedTxt) for (const c of parseMdTable(owedTxt).slice(1)) {
      if (!c[0]) continue;
      S.owed.push({
        person: unescMd(c[0]), amount: parseFloat(c[1]) || 0, description: unescMd(c[2] || ''),
        due: (c[3] || '').trim(), status: (c[4] || 'outstanding').trim().toLowerCase() === 'paid' ? 'paid' : 'outstanding',
      });
    }

    S.services = []; S.servicesDirty = false;
    const svcTxt = await readFile('Services.md');
    S.servicesFm = (svcTxt && parseFrontmatter(svcTxt).raw) || 'kind: services';
    if (svcTxt) for (const c of parseMdTable(svcTxt).slice(1)) {
      if (!c[0]) continue;
      S.services.push({
        name: unescMd(c[0]), provider: unescMd(c[1] || ''), amount: parseFloat(c[2]) || 0,
        cycle: (c[3] || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly',
        next: (c[4] || '').trim(), category: unescMd(c[5] || ''),
        active: (c[6] || 'yes').trim().toLowerCase() !== 'no', notes: unescMd(c[7] || ''),
      });
    }
    S.tax = {}; S.taxDirty = false;
    for (const f of mdFilesIn('Tax')) {
      if (!/^\d{4}$/.test(f.basename)) continue;
      const text = await vault.cachedRead(f);
      const { fm, raw, body } = parseFrontmatter(text);
      // The body holds two tables under "## Progress" and "## Documents".
      // parseMdTable reads every table row in the text it's given, so slice
      // the body by heading first and parse each section on its own.
      const section = (name) => {
        for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
          if (chunk.trim().toLowerCase().startsWith(name)) return chunk;
        }
        return '';
      };
      const stepStatus = s => {
        const t = (s || '').trim().toLowerCase().replace(/[-\s]/g, '');
        return ['todo', 'busy', 'done', 'n/a', 'na'].includes(t) ? (t === 'na' ? 'n/a' : t) : 'todo';
      };
      const docStatus = s => {
        const t = (s || '').trim().toLowerCase().replace(/[-\s]/g, '');
        return t === 'uploaded' ? 'uploaded' : (t === 'n/a' || t === 'na') ? 'n/a' : 'needed';
      };
      S.tax[f.basename] = {
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        taxpayer_type: ['provisional', 'standard'].includes(fm.taxpayer_type) ? fm.taxpayer_type : 'unknown',
        assessment: ['auto-assessed', 'submit-requested'].includes(fm.assessment) ? fm.assessment : 'unknown',
        deadline_standard: fm.deadline_standard || '',
        deadline_provisional: fm.deadline_provisional || '',
        steps: parseMdTable(section('progress')).slice(1).filter(c => c[0]).map(c => ({
          step: unescMd(c[0]), status: stepStatus(c[1]), due: (c[2] || '').trim(), notes: unescMd(c[3] || ''),
        })),
        docs: parseMdTable(section('documents')).slice(1).filter(c => c[0]).map(c => ({
          name: unescMd(c[0]), source: unescMd(c[1] || ''), status: docStatus(c[2]),
          file: unescMd(c[3] || ''), notes: unescMd(c[4] || ''),
        })),
      };
    }
    if (!S.taxYear || !S.tax[S.taxYear]) S.taxYear = Object.keys(S.tax).sort().pop() || null;

    if (!S.period) S.period = currentPeriod();
  }

  Object.assign(ctx, { loadVault });
};
