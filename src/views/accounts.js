'use strict';
/* Accounts — grouped balance tiles; clicking a balance updates the account's
   markdown file in place. */

const { el, patchFrontmatter, safeSeg } = require('../util');
const { askFields } = require('../modal');

module.exports = function registerAccounts(ctx) {
  const { S, $, app, money, toast, writeFile, ensureFolder, relPath } = ctx;

  // Every type the loader can produce must appear in exactly one group, or an
  // account renders nowhere on this page — including `other`, which is what a
  // file with no `type:` in its frontmatter falls back to (load.js).
  const ACCT_GROUPS = [
    ['Bank accounts', ['checking', 'credit_card', 'cash']],
    ['Savings', ['savings']],
    ['Investments', ['investment']],
    ['Other', ['other']],
  ];
  const ACCT_TYPES = ACCT_GROUPS.flatMap(([, types]) => types);
  // Same labels the setup wizard uses (onboarding.js ACCOUNT_TYPES), so a type
  // reads the same whether the account was created there or here.
  const ACCT_TYPE_LABELS = {
    checking: 'Cheque / current account', savings: 'Savings account',
    credit_card: 'Credit card', cash: 'Cash', investment: 'Investment', other: 'Other',
  };
  const ACCT_TYPE_OPTIONS = ACCT_TYPES.map(v => ({ value: v, label: ACCT_TYPE_LABELS[v] }));

  /* Blank → null (field left empty); unparseable → NaN. Callers decide which of
     the two they accept — the balance prompt rejects both, the optional fields
     on the create form treat blank as "not set". */
  function parseAmount(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    return parseFloat(s.replace(',', '.').replace(/[^\d.-]/g, ''));
  }

  function renderAccounts() {
    const wrap = $('#acctSections'); wrap.innerHTML = '';
    for (const [title, types] of ACCT_GROUPS) {
      const accounts = S.accounts.filter(a => types.includes(a.type));
      if (!accounts.length) continue;
      const grid = el('div', { class: 'mini-grid' });
      const total = accounts.reduce((a, b) => a + b.balance, 0);
      for (const a of accounts) {
        const v = el('button', { type: 'button', class: `v num${a.balance < 0 ? ' text-danger' : ''}`, 'aria-label': `Balance for ${a.name}, ${money(a.balance)} — click to update` }, money(a.balance));
        v.addEventListener('click', async () => {
          const r = await askFields(app, `Update balance — ${a.name}`, [
            { key: 'balance', label: 'New balance', type: 'number', value: a.balance.toFixed(2) },
          ]);
          if (!r) return;
          const num = parseAmount(r.balance);
          if (num === null || isNaN(num)) return toast('Not a number', true);
          a.balance = num;
          a.balance_updated = new Date().toISOString().slice(0, 10);
          await saveAccount(a);
          renderAccounts();
          toast(`${a.name} balance updated`);
        });
        grid.append(el('div', { class: 'mini' },
          el('div', { class: 'l' }, a.name),
          v,
          el('div', { class: 's' },
            [a.type.replace('_', ' '), a.institution].filter(Boolean).join(' · '),
            a.credit_limit ? ` · limit ${money(a.credit_limit, 0)}` : '',
            a.monthly_contribution ? ` · ${money(a.monthly_contribution, 0)}/m` : ''),
          el('div', { class: 's2' }, a.balance_updated ? `updated ${a.balance_updated}` : '')));
      }
      wrap.append(el('div', { class: 'card mb-4' },
        el('div', { class: 'card-h' },
          el('div', {}, el('h2', {}, title), el('div', { class: 'sub' }, `${accounts.length} accounts`)),
          el('div', { class: 'legend' }, el('span', {}, el('b', { class: 'num', style: 'font-size:15px;color:var(--text-primary)' }, money(total))))),
        el('div', { class: 'body-pad' }, grid)));
    }
    if (!S.accounts.length) {
      wrap.append(el('div', { class: 'card' }, el('div', { class: 'body-pad' },
        el('p', { class: 'text-muted', style: 'margin:0' },
          'No accounts yet. Use “New account” above to add a bank account, savings pot or investment.'))));
    }
  }

  async function saveAccount(a) {
    // Only the balance and its date are ever changed here (via the UI), so patch
    // just those two into the file's own frontmatter and leave everything else —
    // institution, limits, block-style tags, aliases, any hand-added key — byte
    // for byte. The body was already preserved via a.body.
    if (a.fmRaw) {
      const fm = patchFrontmatter(a.fmRaw, {
        balance: a.balance.toFixed(2),
        balance_updated: a.balance_updated || null,
      });
      await writeFile(`Accounts/${a.name}.md`, `---\n${fm}\n---` + (a.body || `\n\n# ${a.name}\n`));
      return;
    }
    // Legacy fallback: no captured frontmatter (a file the loader never saw) —
    // rebuild from the model.
    const lines = ['---', `type: ${a.type}`];
    if (a.institution) lines.push(`institution: ${a.institution}`);
    if (a.account_number) lines.push(`account_number: "${a.account_number}"`);
    lines.push(`balance: ${a.balance.toFixed(2)}`);
    if (a.balance_updated) lines.push(`balance_updated: ${a.balance_updated}`);
    if (a.credit_limit) lines.push(`credit_limit: ${a.credit_limit.toFixed(2)}`);
    if (a.goal_amount) lines.push(`goal_amount: ${a.goal_amount.toFixed(2)}`);
    if (a.target_date) lines.push(`target_date: ${a.target_date}`);
    if (a.monthly_contribution) lines.push(`monthly_contribution: ${a.monthly_contribution.toFixed(2)}`);
    if (a.total_invested) lines.push(`total_invested: ${a.total_invested.toFixed(2)}`);
    if (a.starting_amount) lines.push(`starting_amount: ${a.starting_amount.toFixed(2)}`);
    if (a.inception_date) lines.push(`inception_date: ${a.inception_date}`);
    if (a.tx_label) lines.push(`tx_label: "${a.tx_label}"`);
    if (a.tags) lines.push(`tags: ${a.tags}`);
    lines.push('---');
    await writeFile(`Accounts/${a.name}.md`, lines.join('\n') + (a.body || `\n\n# ${a.name}\n`));
  }

  /* Create an account file + its in-memory record. Reachable from both the
     Accounts page and Savings & Investments. */
  async function addAccount() {
    const r = await askFields(app, 'New account', [
      { key: 'name', label: 'Account name', type: 'text', placeholder: 'e.g. Easy Equities TFSA' },
      { key: 'type', label: 'Type', type: 'select', options: ACCT_TYPE_OPTIONS, value: 'savings' },
      { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g. Easy Equities' },
      { key: 'balance', label: 'Current balance', type: 'number', value: '0' },
      { key: 'goal_amount', label: 'Savings goal (optional)', type: 'number',
        desc: 'Shows a progress bar on Savings & Investments.' },
      { key: 'total_invested', label: 'Total invested (optional)', type: 'number',
        desc: 'What you have put in, so growth can be shown against it.' },
    ]);
    if (!r) return;

    // The loader takes an account's name from its FILENAME, and saveAccount
    // writes back to `Accounts/<name>.md` — so the name held in memory has to be
    // the sanitised path segment. Store anything else and the first balance edit
    // would write to a different file than the one created here.
    const name = safeSeg(r.name);
    if (!name) return toast('Account name required', true);
    if (S.accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) return toast('Account already exists', true);
    if (!ACCT_TYPES.includes(r.type)) return toast('Invalid type', true);

    const balance = parseAmount(r.balance) ?? 0;
    const goal = parseAmount(r.goal_amount);
    const invested = parseAmount(r.total_invested);
    if ([balance, goal, invested].some(n => n !== null && isNaN(n))) return toast('Not a number', true);

    const acct = {
      name, type: r.type, institution: (r.institution || '').trim(),
      account_number: '', tx_label: '',
      balance, balance_updated: new Date().toISOString().slice(0, 10),
      credit_limit: null, goal_amount: goal, target_date: '',
      monthly_contribution: null, total_invested: invested,
      starting_amount: null, inception_date: '',
      tags: '[finance, finance/budget, finance/budget/accounts]',
      body: `\n\n# ${name}\n\nTransactions are stored under \`Transactions/${name}/\` as monthly files.\n`,
    };
    // No fmRaw — saveAccount's build-from-model branch writes the full
    // frontmatter block and skips every null field.
    await saveAccount(acct);
    // Match the setup wizard: pre-create the account's transactions folder so
    // it's importable and visible in the file explorer right away.
    await ensureFolder(relPath(`Transactions/${name}`));
    S.accounts.push(acct);
    S.accounts.sort((a, b) => a.name.localeCompare(b.name));
    ctx.render();   // not renderAccounts — Savings & Investments has this button too
    toast(`Created Accounts/${name}.md`);
  }

  Object.assign(ctx, { renderAccounts, saveAccount, addAccount });
};
