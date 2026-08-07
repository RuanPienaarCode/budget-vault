'use strict';
/* Accounts — grouped balance tiles backed by the transaction history, so a
   hand-typed balance can be checked against what has actually moved since it
   was entered. Clicking a balance updates the account's markdown file in place. */

const { el, icoEl, patchFrontmatter, safeSeg, yamlStr } = require('../util');
const { askFields } = require('../modal');
/* The reconciliation engine was written here first and now lives in its own
   module, because Savings, Services and Debt all need to make the same argument
   about a hand-typed figure. Behaviour on this page is unchanged. */
const { ISO_DATE, STALE_DAYS, todayIso, daysSince, isStale, reconcile } = require('../reconcile');

module.exports = function registerAccounts(ctx) {
  const { S, $, app, money, toast, writeFile, ensureFolder, relPath, fileAt,
    txInPeriod, accountForLabel, periodMonthName } = ctx;

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

  /* Frontmatter key → the line to write for this account's current value, or
     null to REMOVE the key. saveAccount only patches the keys it is handed, so
     a field nobody edited is never reformatted — that is what keeps the
     "everything else byte for byte" promise of the fmRaw branch honest.
     Balance is deliberately absent: it has its own affordance and its own date
     stamp, and folding it in here would make balance_updated meaningless. */
  const FM_WRITERS = {
    type: a => a.type,
    institution: a => (a.institution ? yamlStr(a.institution) : null),
    account_number: a => (a.account_number ? yamlStr(a.account_number) : null),
    tx_label: a => (a.tx_label ? yamlStr(a.tx_label) : null),
    credit_limit: a => (a.credit_limit ? a.credit_limit.toFixed(2) : null),
    goal_amount: a => (a.goal_amount ? a.goal_amount.toFixed(2) : null),
    target_date: a => a.target_date || null,
    monthly_contribution: a => (a.monthly_contribution ? a.monthly_contribution.toFixed(2) : null),
    total_invested: a => (a.total_invested ? a.total_invested.toFixed(2) : null),
    starting_amount: a => (a.starting_amount ? a.starting_amount.toFixed(2) : null),
    inception_date: a => a.inception_date || null,
  };
  const EDITABLE_KEYS = Object.keys(FM_WRITERS);

  /* Blank → null (field left empty); unparseable → NaN. Callers decide which of
     the two they accept — the balance prompt rejects both, the optional fields
     on the create form treat blank as "not set". */
  function parseAmount(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    return parseFloat(s.replace(',', '.').replace(/[^\d.-]/g, ''));
  }

  /* ------------------------- transaction linkage -------------------------
     One pass over S.txFiles, grouped onto the account each folder belongs to.
     Built once per render: resolving per account instead would walk every
     month file once per account. */
  function accountIndex() {
    const idx = new Map();   // account -> { rows, labels:Set }
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (!a) continue;      // an orphan folder with no account file
      let e = idx.get(a);
      if (!e) { e = { rows: [], labels: new Set() }; idx.set(a, e); }
      e.labels.add(f.label);
      for (const r of f.rows) e.rows.push(r);
    }
    return idx;
  }

  /* Money in / out for the period the header is showing. Separate from the
     reconciliation window on purpose — one answers "is this figure right", the
     other "what happened this month". */
  function periodActivity(labels) {
    let inAmt = 0, outAmt = 0, count = 0;
    for (const t of txInPeriod(S.period)) {
      if (!labels.has(t.label)) continue;
      count++;
      if (t.amount >= 0) inAmt += t.amount; else outAmt += -t.amount;
    }
    return { inAmt, outAmt, count };
  }

  /* ------------------------------ actions ------------------------------- */
  /* Jump to Transactions filtered to this account. switchView renders the view
     first, which is what rebuilds the account <select>'s options — so the label
     is on the list by the time it is selected. The other two filters are reset
     because a search left over from a previous visit would land the reader on
     "0 rows" with no visible reason. */
  function openTransactions(label) {
    ctx.switchView('transactions');
    const sel = $('#txAccount');
    if ([...sel.options].some(o => o.value === label)) sel.value = label;
    $('#txCategory').value = '';
    $('#txSearch').value = '';
    ctx.renderTransactions();
  }

  async function openAccountFile(a) {
    const f = fileAt(`Accounts/${a.name}.md`);
    if (!f) return toast(`Accounts/${a.name}.md not found`, true);
    // A new tab, not this one: the budget view is a workspace leaf like any
    // other, and opening in place would close the app the reader is using.
    await app.workspace.getLeaf('tab').openFile(f);
  }

  async function editBalance(a) {
    const r = await askFields(app, `Update balance — ${a.name}`, [
      { key: 'balance', label: 'New balance', type: 'number', value: a.balance.toFixed(2) },
    ]);
    if (!r) return;
    const num = parseAmount(r.balance);
    if (num === null || isNaN(num)) return toast('Not a number', true);
    a.balance = num;
    a.balanceRaw = null;   // the user just gave us a clean figure
    a.balance_updated = todayIso();
    await saveAccount(a);
    renderAccounts();
    toast(`${a.name} balance updated`);
  }

  /* Accept the implied figure. Stamping today is what stops the rows just
     absorbed from being counted a second time: reconcile() only ever folds in
     rows dated on or before today, so the next window starts clear of them. */
  async function acceptImplied(a, implied) {
    a.balance = implied;
    a.balanceRaw = null;
    a.balance_updated = todayIso();
    await saveAccount(a);
    renderAccounts();
    toast(`${a.name} reconciled to ${money(implied)}`);
  }

  /* Everything about the account EXCEPT its balance and its name. The balance
     has its own affordance on the tile; the name is the filename the loader
     keys on and the folder transactions live under, so renaming here would
     silently orphan the history — that is a move-the-files operation, not a
     form field. */
  async function editAccount(a) {
    const r = await askFields(app, `Edit account — ${a.name}`, [
      { key: 'type', label: 'Type', type: 'select', options: ACCT_TYPE_OPTIONS, value: a.type },
      { key: 'institution', label: 'Institution', type: 'text', value: a.institution },
      { key: 'account_number', label: 'Account number', type: 'text', value: a.account_number,
        desc: 'Used to match a downloaded statement to this account on import.' },
      { key: 'tx_label', label: 'Transactions folder', type: 'text', value: a.tx_label,
        desc: `Leave blank to use “${a.name}”. Set it only when the folder under Transactions/ has a different name.` },
      { key: 'budget', label: 'Counts toward the budget', type: 'select',
        value: a.in_budget ? 'yes' : 'no',
        options: [{ value: 'yes', label: 'Yes — normal spending account' },
          { value: 'no', label: 'No — investment or savings wrapper' }] },
      { key: 'credit_limit', label: 'Credit limit', type: 'number',
        value: a.credit_limit != null ? String(a.credit_limit) : '',
        desc: 'Shows a utilisation bar on credit cards.' },
      { key: 'goal_amount', label: 'Savings goal', type: 'number',
        value: a.goal_amount != null ? String(a.goal_amount) : '' },
      { key: 'target_date', label: 'Goal target date', type: 'date', value: a.target_date },
      { key: 'monthly_contribution', label: 'Monthly contribution', type: 'number',
        value: a.monthly_contribution != null ? String(a.monthly_contribution) : '' },
      { key: 'total_invested', label: 'Total invested', type: 'number',
        value: a.total_invested != null ? String(a.total_invested) : '',
        desc: 'What you have put in, so growth can be shown against it.' },
      { key: 'starting_amount', label: 'Starting amount', type: 'number',
        value: a.starting_amount != null ? String(a.starting_amount) : '' },
      { key: 'inception_date', label: 'Opened on', type: 'date', value: a.inception_date },
    ]);
    if (!r) return;

    if (!ACCT_TYPES.includes(r.type)) return toast('Invalid type', true);
    const nums = {};
    for (const k of ['credit_limit', 'goal_amount', 'monthly_contribution', 'total_invested', 'starting_amount']) {
      const n = parseAmount(r[k]);
      if (n !== null && isNaN(n)) return toast(`${k.replace(/_/g, ' ')} is not a number`, true);
      nums[k] = n;
    }
    // Validate everything BEFORE assigning any of it: a half-applied edit would
    // be written to disk by the save below with no way to tell what changed.
    a.type = r.type;
    a.institution = (r.institution || '').trim();
    a.account_number = (r.account_number || '').trim();
    a.tx_label = (r.tx_label || '').trim();
    a.in_budget = r.budget !== 'no';
    Object.assign(a, nums);
    a.target_date = (r.target_date || '').trim();
    a.inception_date = (r.inception_date || '').trim();

    await saveAccount(a, EDITABLE_KEYS);
    // ctx.render, not renderAccounts: a type change moves the account between
    // groups here AND changes whether Savings & Investments shows it at all.
    ctx.render();
    toast(`${a.name} updated`);
  }

  async function toggleBudget(a) {
    a.in_budget = !a.in_budget;
    await saveAccount(a);
    renderAccounts();
    toast(a.in_budget
      ? `${a.name} counts toward the budget again`
      : `${a.name} no longer counts toward budget totals`);
  }

  /* ------------------------------ rendering ------------------------------ */
  function badge(text, cls) { return el('span', { class: `acct-badge${cls ? ' ' + cls : ''}` }, text); }

  /* Credit-card utilisation, or null when it would mean nothing (not a card, or
     no limit recorded). A card's balance is stored negative when money is owed,
     so "used" is the magnitude of a negative balance — a card sitting in credit
     has used nothing, not a negative amount of its limit.

     Thresholds match the dashboard's budget bars — over at 100%, near at 85% —
     so a bar means the same thing wherever it appears in this app. Kept apart
     from the markup below so the arithmetic can be tested without a DOM. */
  function utilisationOf(a) {
    if (a.type !== 'credit_card' || !a.credit_limit || a.credit_limit <= 0) return null;
    const used = Math.max(0, -a.balance);
    const pct = (used / a.credit_limit) * 100;
    const over = used > a.credit_limit;
    return { used, pct, over, near: !over && pct >= 85, available: a.credit_limit - used };
  }
  function utilisation(a) {
    const u = utilisationOf(a);
    if (!u) return null;
    const { used, pct, over, near, available } = u;
    return el('div', { class: 'acct-util' },
      el('div', { class: 'acct-util-top' },
        el('span', {}, 'Credit used'),
        el('span', { class: 'num' }, `${money(used, 0)} of ${money(a.credit_limit, 0)}`)),
      el('div', { class: 'cat-bar' },
        el('i', { class: `cat-bar-fill${over ? ' bg-danger' : near ? ' bg-warning' : ''}`,
          style: `width:${Math.min(100, pct).toFixed(1)}%` })),
      el('div', { class: `acct-util-sub${over ? ' text-danger' : near ? ' text-warning' : ''}` },
        over
          ? `Over limit by ${money(-available, 0)}`
          : `${Math.round(pct)}% used · ${money(available, 0)} available`));
  }

  function renderKpis() {
    const wrap = $('#acctKpis');
    if (!wrap) return;
    wrap.empty();
    // Assets and liabilities by the SIGN of the balance rather than by account
    // type: a credit card in credit is not a liability, and an overdrawn cheque
    // account is one. Net worth is then simply the sum, which is the same
    // figure Savings & Investments reports.
    let assets = 0, liabilities = 0;
    for (const a of S.accounts) {
      if (a.balance >= 0) assets += a.balance; else liabilities += -a.balance;
    }
    const idx = accountIndex();
    const attention = S.accounts.filter(a => {
      const e = idx.get(a);
      if (!e) return true;                                   // nothing importing into it
      if (isStale(a.balance_updated)) return true;            // never confirmed, or long ago
      return reconcile(a, e.rows).state === 'drift';
    }).length;

    const tile = (l, v, cls, sub) => {
      const t = el('div', { class: 'mini' },
        el('div', { class: 'l' }, l), el('div', { class: `v num ${cls || ''}` }, v));
      if (sub) t.append(el('div', { class: 's' }, sub));
      wrap.append(t);
    };
    tile('Assets', money(assets), 'text-success');
    tile('Liabilities', money(liabilities), liabilities > 0 ? 'text-danger' : '');
    tile('Net worth', money(assets - liabilities), assets - liabilities >= 0 ? 'grad-txt' : 'text-danger');
    tile('Needs attention', String(attention), attention > 0 ? 'text-warning' : '',
      attention > 0 ? 'unverified or drifting balances' : 'every balance checks out');
  }

  function accountTile(a, entry) {
    const labels = entry ? entry.labels : new Set();
    const rows = entry ? entry.rows : [];
    const card = el('div', { class: 'mini' });

    // The name is the drill-through. A button rather than a link: this moves
    // the view, it does not navigate anywhere a URL could describe.
    const primary = [...labels][0];
    if (primary) {
      const nameBtn = el('button', { type: 'button', class: 'l acct-name-btn',
        'aria-label': `Show ${a.name} transactions` }, a.name);
      nameBtn.addEventListener('click', () => openTransactions(primary));
      card.append(nameBtn);
    } else {
      card.append(el('div', { class: 'l' }, a.name));
    }

    const v = el('button', { type: 'button', class: `v num${a.balance < 0 ? ' text-danger' : ''}`,
      'aria-label': `Balance for ${a.name}, ${money(a.balance)} — click to update` }, money(a.balance));
    v.addEventListener('click', () => editBalance(a));
    card.append(v);

    // The limit is dropped from this line when the utilisation bar below is
    // going to state it in full — saying it twice just crowds the tile.
    const util = utilisation(a);
    card.append(el('div', { class: 's' },
      [a.type.replace('_', ' '), a.institution].filter(Boolean).join(' · '),
      !util && a.credit_limit ? ` · limit ${money(a.credit_limit, 0)}` : '',
      a.monthly_contribution ? ` · ${money(a.monthly_contribution, 0)}/m` : ''));
    if (util) card.append(util);

    /* Badges — the state of the figure above, not the account's details. */
    const days = daysSince(a.balance_updated);
    const badges = el('div', { class: 'acct-badges' });
    if (!a.in_budget) badges.append(badge('not in budget', 'muted'));
    if (!rows.length) badges.append(badge('no transactions', 'warn'));
    if (a.balance_updated && days === null) badges.append(badge(`as of ${a.balance_updated}`, 'muted'));
    else if (days === null) badges.append(badge('never confirmed', 'warn'));
    else if (days > STALE_DAYS) badges.append(badge(`unconfirmed ${days} days`, 'warn'));
    if (badges.childElementCount) card.append(badges);

    /* Activity in the period the header is showing. */
    const act = periodActivity(labels);
    if (act.count) {
      card.append(el('div', { class: 'acct-act' },
        el('span', { class: 'text-success' }, `+${money(act.inAmt, 0)}`), ' in · ',
        el('span', { class: 'text-danger' }, `-${money(act.outAmt, 0)}`), ' out · ',
        `${act.count} ${act.count === 1 ? 'transaction' : 'transactions'} in ${periodMonthName(S.period)}`));
    }

    /* Reconciliation — the stated figure measured against what has moved. */
    const rec = reconcile(a, rows);
    // Rows dated ahead of today are named wherever they exist, so "matches your
    // transactions" is never quietly hiding a scheduled debit order.
    const pending = n => n ? ` · ${n} dated ahead, not counted yet` : '';
    if (rec.state === 'drift') {
      const line = el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt' },
          `${rec.count} ${rec.count === 1 ? 'transaction' : 'transactions'} since · implies `,
          el('b', { class: 'num' }, money(rec.implied)),
          pending(rec.ahead)));
      const btn = el('button', { type: 'button', class: 'acct-recon-btn',
        'aria-label': `Set ${a.name} balance to ${money(rec.implied)}` },
        icoEl(['check']), 'Use this');
      btn.addEventListener('click', () => acceptImplied(a, rec.implied));
      line.append(btn);
      card.append(line);
    } else if (rec.state === 'clean') {
      card.append(el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt text-success' }, 'Matches your transactions')));
    } else if (rec.state === 'pending') {
      card.append(el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt text-muted' },
          `Up to date · ${rec.ahead} ${rec.ahead === 1 ? 'transaction' : 'transactions'} dated ahead`)));
    } else if (rec.state === 'no-date' && rows.length) {
      card.append(el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt text-muted' },
          'Set a balance date to check this against your transactions')));
    }

    /* Footer — the two actions that are about the FILE rather than the figure. */
    const foot = el('div', { class: 'acct-foot' });
    const updated = a.balance_updated ? `updated ${a.balance_updated}` : 'no balance date';
    foot.append(el('span', { class: 's2' }, updated));
    const acts = el('span', { class: 'acct-foot-acts' });
    const budgetBtn = el('button', { type: 'button', class: 'acct-link',
      'aria-label': a.in_budget
        ? `Stop counting ${a.name} toward budget totals`
        : `Count ${a.name} toward budget totals again` },
      a.in_budget ? 'Exclude from budget' : 'Include in budget');
    budgetBtn.addEventListener('click', () => toggleBudget(a));
    const editBtn = el('button', { type: 'button', class: 'acct-link',
      'aria-label': `Edit ${a.name}` }, 'Edit');
    editBtn.addEventListener('click', () => editAccount(a));
    const openBtn = el('button', { type: 'button', class: 'acct-link',
      'aria-label': `Open the ${a.name} note` }, 'Open note');
    openBtn.addEventListener('click', () => openAccountFile(a));
    acts.append(editBtn, budgetBtn, openBtn);
    foot.append(acts);
    card.append(foot);

    return card;
  }

  function renderAccounts() {
    renderKpis();
    const idx = accountIndex();
    const wrap = $('#acctSections'); wrap.empty();
    for (const [title, types] of ACCT_GROUPS) {
      const accounts = S.accounts.filter(a => types.includes(a.type));
      if (!accounts.length) continue;
      const grid = el('div', { class: 'mini-grid' });
      const total = accounts.reduce((a, b) => a + b.balance, 0);
      for (const a of accounts) grid.append(accountTile(a, idx.get(a)));
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

  /* `keys` names the extra frontmatter fields to write from the model — the
     edit form passes EDITABLE_KEYS, everything else passes nothing. The balance,
     its date and the budget flag are always patched, because they are the only
     three the tile itself can change. */
  async function saveAccount(a, keys = []) {
    // Everything NOT patched — block-style tags, aliases, any hand-added key —
    // is left byte for byte. The body was already preserved via a.body.
    if (a.fmRaw) {
      const updates = {
        // Write the original cell back untouched when the loader could not
        // strictly parse it and the user has not since edited the balance.
        balance: a.balanceRaw != null ? a.balanceRaw : a.balance.toFixed(2),
        balance_updated: a.balance_updated || null,
        // null REMOVES the key: in-budget is the default, so an account that
        // has never been excluded keeps a frontmatter block free of a line
        // saying nothing.
        budget: a.in_budget ? null : 'false',
      };
      for (const k of keys) updates[k] = FM_WRITERS[k](a);
      const fm = patchFrontmatter(a.fmRaw, updates);
      await writeFile(`Accounts/${a.name}.md`, `---\n${fm}\n---` + (a.body || `\n\n# ${a.name}\n`));
      /* Re-capture. Every patch is computed against fmRaw, so leaving it at the
         block read from disk at LOAD time makes each save undo the one before
         it: edit the credit limit, then click the balance, and the limit goes
         back to whatever the file said when the vault was opened. Our own
         writes are deliberately not re-read by the file watcher, so nothing
         else would put this back in step. */
      a.fmRaw = fm;
      return;
    }
    // Legacy fallback: no captured frontmatter (a file the loader never saw) —
    // rebuild from the model.
    const lines = ['---', `type: ${a.type}`];
    if (a.institution) lines.push(`institution: ${yamlStr(a.institution)}`);
    if (a.account_number) lines.push(`account_number: ${yamlStr(a.account_number)}`);
    lines.push(`balance: ${a.balance.toFixed(2)}`);
    if (a.balance_updated) lines.push(`balance_updated: ${a.balance_updated}`);
    if (!a.in_budget) lines.push('budget: false');
    if (a.credit_limit) lines.push(`credit_limit: ${a.credit_limit.toFixed(2)}`);
    if (a.goal_amount) lines.push(`goal_amount: ${a.goal_amount.toFixed(2)}`);
    if (a.target_date) lines.push(`target_date: ${a.target_date}`);
    if (a.monthly_contribution) lines.push(`monthly_contribution: ${a.monthly_contribution.toFixed(2)}`);
    if (a.total_invested) lines.push(`total_invested: ${a.total_invested.toFixed(2)}`);
    if (a.starting_amount) lines.push(`starting_amount: ${a.starting_amount.toFixed(2)}`);
    if (a.inception_date) lines.push(`inception_date: ${a.inception_date}`);
    if (a.tx_label) lines.push(`tx_label: ${yamlStr(a.tx_label)}`);
    if (a.tags) lines.push(`tags: ${a.tags}`);
    lines.push('---');
    await writeFile(`Accounts/${a.name}.md`, lines.join('\n') + (a.body || `\n\n# ${a.name}\n`));
    // Adopt what was just written, so the NEXT save takes the patch branch
    // above and preserves anything the user has added to the file since.
    a.fmRaw = lines.slice(1, -1).join('\n');
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
      { key: 'budget', label: 'Counts toward the budget', type: 'select', value: 'yes',
        options: [{ value: 'yes', label: 'Yes — normal spending account' },
          { value: 'no', label: 'No — investment or savings wrapper' }],
        desc: 'Choose No for an account whose interest is not household income and whose contributions are not household spending. Its transactions still import and show in Transactions.' },
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
      balance, balance_updated: todayIso(),
      in_budget: r.budget !== 'no',
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

  // accountIndex and accountReconcile are published so a test can drive the
  // REAL linkage and arithmetic — the same reason owed.js publishes its
  // serializer. Nothing else on ctx calls them.
  ctx.provide({ renderAccounts, saveAccount, addAccount, editAccount, accountIndex,
    accountReconcile: reconcile, accountUtilisation: utilisationOf, ACCOUNT_FM_KEYS: EDITABLE_KEYS });
};
