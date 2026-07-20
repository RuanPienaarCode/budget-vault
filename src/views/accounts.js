'use strict';
/* Accounts — grouped balance tiles; clicking a balance updates the account's
   markdown file in place. */

const { el, patchFrontmatter } = require('../util');
const { askFields } = require('../modal');

module.exports = function registerAccounts(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  const ACCT_GROUPS = [
    ['Bank accounts', ['checking', 'credit_card', 'cash']],
    ['Savings', ['savings']],
    ['Investments', ['investment']],
  ];

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
          const num = parseFloat(String(r.balance).replace(',', '.').replace(/[^\d.-]/g, ''));
          if (isNaN(num)) return toast('Not a number', true);
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

  Object.assign(ctx, { renderAccounts, saveAccount });
};
