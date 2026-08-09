'use strict';
/* Accounts — grouped balance tiles backed by the transaction history, so a
   hand-typed balance can be checked against what has actually moved since it
   was entered. Clicking a balance updates the account's markdown file in place. */

const { el, kpiTiles, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { patchFrontmatter, yamlStr } = require('../markdown');
const { safeSeg } = require('../vault-path');
/* Namespace import: this file binds `t` in askFields callbacks. */
const i18n = require('../i18n');
const { askFields } = require('../modal');
/* The reconciliation engine was written here first and now lives in its own
   module, because Savings, Services and Debt all need to make the same argument
   about a hand-typed figure. Behaviour on this page is unchanged. */
const { STALE_DAYS, daysSince, isStale, reconcile } = require('../reconcile');
const { supersededBySplit } = require('../tx-role');
const { ISO_DATE, todayIso } = require('../dates');

module.exports = function registerAccounts(ctx) {
  const { S, $, app, money, toast, writeFile, ensureFolder, relPath, fileAt,
    txInPeriod, accountForLabel, accountIndex, periodMonthName } = ctx;

  // Every type the loader can produce must appear in exactly one group, or an
  // account renders nowhere on this page — including `other`, which is what a
  // file with no `type:` in its frontmatter falls back to (load.js).
  /* Key on the left, translated at render time — a group heading must follow
     the language, and these are resolved on call rather than at module load. */
  const ACCT_GROUPS = [
    ['acct.group.bank', ['checking', 'credit_card', 'cash']],
    ['acct.group.savings', ['savings']],
    ['acct.group.investments', ['investment']],
    ['acct.group.other', ['other']],
  ];
  const ACCT_TYPES = ACCT_GROUPS.flatMap(([, types]) => types);
  // Same labels the setup wizard uses (onboarding.js ACCOUNT_TYPES), so a type
  // reads the same whether the account was created there or here.
  /* Shared with the setup wizard under acctType.* — one label, two screens, so
     they cannot drift. Built per call so a language change is picked up. */
  const acctTypeOptions = () => ACCT_TYPES.map(v => ({ value: v, label: i18n.t('acctType.' + v) }));

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
     on the create form treat blank as "not set".

     normalizeAmount rather than a local parseFloat: the old one mapped ',' to
     '.' and then stripped everything else, so a reader who typed a grouped
     "1,234.56" got 1.23456 and one who typed "15,000" got 15.0 — and this is
     the parser standing between the edit dialog and a value that gets written
     straight back to the account file. It also reads what the loader reads,
     so a figure cannot change meaning by being opened and re-saved. */
  function parseAmount(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = normalizeAmount(s);
    return n === null ? NaN : n;
  }

  /* Money in / out for the period the header is showing. Separate from the
     reconciliation window on purpose — one answers "is this figure right", the
     other "what happened this month".

     Counts excluded rows deliberately, like reconcile() and for the same
     reason: an internal transfer is out of the budget but it did leave this
     account, and a card reporting "what happened" that omits it is describing
     a month that did not occur. Which is exactly why a split parent has to go
     — its parts are in the same list, so it would be counted, and counted
     twice. */
  function periodActivity(labels) {
    let inAmt = 0, outAmt = 0, count = 0;
    for (const t of txInPeriod(S.period)) {
      if (!labels.has(t.label)) continue;
      if (supersededBySplit(t)) continue;
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
    if (!f) return toast(i18n.t('acct.noteMissing', { name: a.name }), true);
    // A new tab, not this one: the budget view is a workspace leaf like any
    // other, and opening in place would close the app the reader is using.
    await app.workspace.getLeaf('tab').openFile(f);
  }

  async function editBalance(a) {
    const r = await askFields(app, i18n.t('acct.balance.title', { name: a.name }), [
      { key: 'balance', label: i18n.t('acct.balance.field'), type: 'number', value: a.balance.toFixed(2) },
    ]);
    if (!r) return;
    const num = parseAmount(r.balance);
    if (num === null || isNaN(num)) return toast(i18n.t('acct.err.nan'), true);
    a.balance = num;
    a.balanceRaw = null;   // the user just gave us a clean figure
    a.balance_updated = todayIso();
    await saveAccount(a);
    renderAccounts();
    toast(i18n.t('acct.balance.updated', { name: a.name }));
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
    toast(i18n.t('acct.reconciled', { name: a.name, amount: money(implied) }));
  }

  /* Everything about the account EXCEPT its balance and its name. The balance
     has its own affordance on the tile; the name is the filename the loader
     keys on and the folder transactions live under, so renaming here would
     silently orphan the history — that is a move-the-files operation, not a
     form field. */
  async function editAccount(a) {
    const r = await askFields(app, i18n.t('acct.edit.title', { name: a.name }), [
      { key: 'type', label: i18n.t('acct.field.type'), type: 'select', options: acctTypeOptions(), value: a.type },
      { key: 'institution', label: i18n.t('acct.field.institution'), type: 'text', value: a.institution },
      { key: 'account_number', label: i18n.t('acct.field.number'), type: 'text', value: a.account_number,
        desc: i18n.t('acct.field.numberDesc') },
      { key: 'tx_label', label: i18n.t('acct.field.folder'), type: 'text', value: a.tx_label,
        desc: i18n.t('acct.field.folderDesc', { name: a.name }) },
      { key: 'budget', label: i18n.t('acct.field.counts'), type: 'select',
        value: a.in_budget ? 'yes' : 'no',
        options: [{ value: 'yes', label: i18n.t('acct.counts.yes') },
          { value: 'no', label: i18n.t('acct.counts.no') }] },
      { key: 'credit_limit', label: i18n.t('acct.field.limit'), type: 'number',
        value: a.credit_limit != null ? String(a.credit_limit) : '',
        desc: i18n.t('acct.field.limitDesc') },
      { key: 'goal_amount', label: i18n.t('acct.field.goal'), type: 'number',
        value: a.goal_amount != null ? String(a.goal_amount) : '' },
      { key: 'target_date', label: i18n.t('acct.field.goalDate'), type: 'date', value: a.target_date },
      { key: 'monthly_contribution', label: i18n.t('acct.field.monthly'), type: 'number',
        value: a.monthly_contribution != null ? String(a.monthly_contribution) : '' },
      { key: 'total_invested', label: i18n.t('acct.field.invested'), type: 'number',
        value: a.total_invested != null ? String(a.total_invested) : '',
        desc: i18n.t('acct.field.investedDesc') },
      { key: 'starting_amount', label: i18n.t('acct.field.starting'), type: 'number',
        value: a.starting_amount != null ? String(a.starting_amount) : '' },
      { key: 'inception_date', label: i18n.t('acct.field.opened'), type: 'date', value: a.inception_date },
    ]);
    if (!r) return;

    if (!ACCT_TYPES.includes(r.type)) return toast(i18n.t('acct.err.type'), true);
    const nums = {};
    for (const k of ['credit_limit', 'goal_amount', 'monthly_contribution', 'total_invested', 'starting_amount']) {
      const n = parseAmount(r[k]);
      if (n !== null && isNaN(n)) return toast(i18n.t('acct.err.notNumber', { field: k.replace(/_/g, ' ') }), true);
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
    toast(i18n.t(a.in_budget ? 'acct.budget.on' : 'acct.budget.off', { name: a.name }));
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
        el('span', {}, i18n.t('acct.creditUsed')),
        el('span', { class: 'num' }, i18n.t('acct.creditOf', { used: money(used, 0), limit: money(a.credit_limit, 0) }))),
      el('div', { class: 'cat-bar' },
        el('i', { class: `cat-bar-fill${over ? ' bg-danger' : near ? ' bg-warning' : ''}`,
          style: `width:${Math.min(100, pct).toFixed(1)}%` })),
      el('div', { class: `acct-util-sub${over ? ' text-danger' : near ? ' text-warning' : ''}` },
        over
          ? i18n.t('acct.overLimit', { amount: money(-available, 0) })
          : i18n.t('acct.utilised', { pct: Math.round(pct), available: money(available, 0) })));
  }

  function renderKpis() {
    const wrap = $('#acctKpis');
    if (!wrap) return;
    wrap.empty();
    /* By the SIGN of the balance rather than by account type: a credit card in
       credit is not a liability, and an overdrawn cheque account is one.

       Scoped to THIS PAGE's accounts, and says so. Savings & Investments
       reports a whole-household net worth that also carries the Assets page
       and the Debt page, so the two figures legitimately differ — but a tile
       labelled "Net worth" with no qualifier reads as the household's, and a
       reader who spots the two disagreeing has no way to tell which is wrong.
       The sub-line is what makes them both true at once. */
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

    // Only qualify the tile when there IS something elsewhere for it to
    // disagree with — on a vault with no assets and no debts the two pages
    // report the same number, and a caveat about a difference that does not
    // exist is just noise.
    const elsewhere = (S.assets || []).some(a => a.value > 0)
      || (S.debts || []).some(d => d.status !== 'paid' && d.balance > 0);

    const tile = kpiTiles(wrap);
    tile(i18n.t('acct.kpi.inCredit'), money(assets), 'text-success');
    tile(i18n.t('acct.kpi.overdrawn'), money(liabilities), liabilities > 0 ? 'text-danger' : '');
    tile(i18n.t('acct.kpi.netWorth'), money(assets - liabilities), assets - liabilities >= 0 ? 'grad-txt' : 'text-danger',
      elsewhere ? i18n.t('acct.kpi.netWorthNote') : null);
    tile(i18n.t('acct.kpi.attention'), String(attention), attention > 0 ? 'text-warning' : '',
      i18n.t(attention > 0 ? 'acct.kpi.attentionNote' : 'acct.kpi.allGood'));
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
        'aria-label': i18n.t('acct.aria.showTx', { name: a.name }) }, a.name);
      nameBtn.addEventListener('click', () => openTransactions(primary));
      card.append(nameBtn);
    } else {
      card.append(el('div', { class: 'l' }, a.name));
    }

    const v = el('button', { type: 'button', class: `v num${a.balance < 0 ? ' text-danger' : ''}`,
      'aria-label': i18n.t('acct.aria.balance', { name: a.name, amount: money(a.balance) }) }, money(a.balance));
    v.addEventListener('click', () => editBalance(a));
    card.append(v);

    // The limit is dropped from this line when the utilisation bar below is
    // going to state it in full — saying it twice just crowds the tile.
    const util = utilisation(a);
    card.append(el('div', { class: 's' },
      [a.type.replace('_', ' '), a.institution].filter(Boolean).join(' · '),
      !util && a.credit_limit ? i18n.t('acct.limitSuffix', { amount: money(a.credit_limit, 0) }) : '',
      a.monthly_contribution ? i18n.t('acct.monthlySuffix', { amount: money(a.monthly_contribution, 0) }) : ''));
    if (util) card.append(util);

    /* Badges — the state of the figure above, not the account's details. */
    const days = daysSince(a.balance_updated);
    const badges = el('div', { class: 'acct-badges' });
    if (!a.in_budget) badges.append(badge(i18n.t('acct.badge.notInBudget'), 'muted'));
    if (!rows.length) badges.append(badge(i18n.t('acct.badge.noTx'), 'warn'));
    if (a.balance_updated && days === null) badges.append(badge(i18n.t('acct.badge.asOf', { date: a.balance_updated }), 'muted'));
    else if (days === null) badges.append(badge(i18n.t('acct.badge.neverConfirmed'), 'warn'));
    else if (days > STALE_DAYS) badges.append(badge(i18n.t('acct.badge.unconfirmed', { count: days }), 'warn'));
    if (badges.childElementCount) card.append(badges);

    /* Activity in the period the header is showing. */
    const act = periodActivity(labels);
    if (act.count) {
      card.append(el('div', { class: 'acct-act' },
        el('span', { class: 'text-success' }, `+${money(act.inAmt, 0)}`), i18n.t('acct.act.in'),
        el('span', { class: 'text-danger' }, `-${money(act.outAmt, 0)}`), i18n.t('acct.act.out'),
        i18n.t('acct.act.count', { count: act.count, month: periodMonthName(S.period) })));
    }

    /* Reconciliation — the stated figure measured against what has moved. */
    const rec = reconcile(a, rows);
    // Rows dated ahead of today are named wherever they exist, so "matches your
    // transactions" is never quietly hiding a scheduled debit order.
    const pending = n => (n ? i18n.t('acct.recon.pending', { count: n }) : '');
    if (rec.state === 'drift') {
      const line = el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt' },
          i18n.t('acct.recon.since', { count: rec.count }),
          el('b', { class: 'num' }, money(rec.implied)),
          pending(rec.ahead)));
      const btn = el('button', { type: 'button', class: 'acct-recon-btn',
        'aria-label': i18n.t('acct.aria.useThis', { name: a.name, amount: money(rec.implied) }) },
        icoEl(['check']), i18n.t('acct.recon.useThis'));
      btn.addEventListener('click', () => acceptImplied(a, rec.implied));
      line.append(btn);
      card.append(line);
    } else if (rec.state === 'clean') {
      card.append(el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt text-success' }, i18n.t('acct.recon.matches'))));
    } else if (rec.state === 'pending') {
      card.append(el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt text-muted' },
          i18n.t('acct.recon.upToDate', { count: rec.ahead }))));
    } else if (rec.state === 'no-date' && rows.length) {
      card.append(el('div', { class: 'acct-recon' },
        el('div', { class: 'acct-recon-txt text-muted' },
          i18n.t('acct.recon.setDate'))));
    }

    /* Footer — the two actions that are about the FILE rather than the figure. */
    const foot = el('div', { class: 'acct-foot' });
    const updated = a.balance_updated ? i18n.t('acct.foot.updated', { date: a.balance_updated }) : i18n.t('acct.foot.noDate');
    foot.append(el('span', { class: 's2' }, updated));
    const acts = el('span', { class: 'acct-foot-acts' });
    const budgetBtn = el('button', { type: 'button', class: 'acct-link',
      'aria-label': i18n.t(a.in_budget ? 'acct.aria.exclude' : 'acct.aria.include', { name: a.name }) },
      i18n.t(a.in_budget ? 'acct.btn.exclude' : 'acct.btn.include'));
    budgetBtn.addEventListener('click', () => toggleBudget(a));
    const editBtn = el('button', { type: 'button', class: 'acct-link',
      'aria-label': i18n.t('acct.aria.edit', { name: a.name }) }, i18n.t('acct.btn.edit'));
    editBtn.addEventListener('click', () => editAccount(a));
    const openBtn = el('button', { type: 'button', class: 'acct-link',
      'aria-label': i18n.t('acct.aria.openNote', { name: a.name }) }, i18n.t('acct.btn.openNote'));
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
    for (const [titleKey, types] of ACCT_GROUPS) {
      const accounts = S.accounts.filter(a => types.includes(a.type));
      if (!accounts.length) continue;
      const grid = el('div', { class: 'mini-grid' });
      const total = accounts.reduce((a, b) => a + b.balance, 0);
      for (const a of accounts) grid.append(accountTile(a, idx.get(a)));
      wrap.append(el('div', { class: 'card mb-4' },
        el('div', { class: 'card-h' },
          el('div', {}, el('h2', {}, i18n.t(titleKey)), el('div', { class: 'sub' }, i18n.t('acct.group.count', { count: accounts.length }))),
          el('div', { class: 'legend' }, el('span', {}, el('b', { class: 'num', style: 'font-size:15px;color:var(--text-primary)' }, money(total))))),
        el('div', { class: 'body-pad' }, grid)));
    }
    if (!S.accounts.length) {
      wrap.append(el('div', { class: 'card' }, el('div', { class: 'body-pad' },
        el('p', { class: 'text-muted', style: 'margin:0' },
          i18n.t('acct.empty')))));
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
    /* Opt-in, so only a set value is written — an absent key is the default and
       materialising it here would freeze today's default into the file. The
       fmRaw patch branch above preserves these without help; this branch
       rebuilds from the model, so it has to name them. */
    if (a.settle_monthly) lines.push('settle_monthly: true');
    if (a.settle_day) lines.push(`settle_day: ${a.settle_day}`);
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

  /* Create an account file + its in-memory record. Reachable from the Accounts
     page, Savings & Investments, the Transactions toolbar and the import review.

     Returns the account it created, or null if the user cancelled or the form
     failed validation. The import review needs that return value: it selects
     the new account as the destination for the rows on screen, and inferring
     "did one get made" from S.accounts.length would credit this call for an
     account a sync from another device happened to land mid-dialog.

     `defaults.type` preselects the kind of account, because the two callers
     that pass it are both about bank statements, where `savings` is the wrong
     first guess. Validated rather than trusted — the same function is wired
     straight to click handlers elsewhere, and a MouseEvent's own `.type` is
     the string 'click', which would silently land in the select as a type no
     group on this page renders. */
  async function addAccount(defaults) {
    const preType = defaults && ACCT_TYPES.includes(defaults.type) ? defaults.type : 'savings';
    const r = await askFields(app, i18n.t('acct.new.title'), [
      { key: 'name', label: i18n.t('acct.field.name'), type: 'text', placeholder: 'e.g. Easy Equities TFSA' },
      { key: 'type', label: i18n.t('acct.field.type'), type: 'select', options: acctTypeOptions(), value: preType },
      { key: 'institution', label: i18n.t('acct.field.institution'), type: 'text', placeholder: 'e.g. Easy Equities' },
      { key: 'balance', label: i18n.t('acct.field.balance'), type: 'number', value: '0' },
      { key: 'goal_amount', label: i18n.t('acct.field.goalOpt'), type: 'number',
        desc: i18n.t('acct.field.goalOptDesc') },
      { key: 'total_invested', label: i18n.t('acct.field.investedOpt'), type: 'number',
        desc: i18n.t('acct.field.investedDesc') },
      { key: 'budget', label: i18n.t('acct.field.counts'), type: 'select', value: 'yes',
        options: [{ value: 'yes', label: i18n.t('acct.counts.yes') },
          { value: 'no', label: i18n.t('acct.counts.no') }],
        desc: i18n.t('acct.field.countsDesc') },
    ]);
    if (!r) return null;

    // The loader takes an account's name from its FILENAME, and saveAccount
    // writes back to `Accounts/<name>.md` — so the name held in memory has to be
    // the sanitised path segment. Store anything else and the first balance edit
    // would write to a different file than the one created here.
    const name = safeSeg(r.name);
    if (!name) { toast(i18n.t('acct.err.nameRequired'), true); return null; }
    if (S.accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) { toast(i18n.t('acct.err.exists'), true); return null; }
    if (!ACCT_TYPES.includes(r.type)) { toast(i18n.t('acct.err.type'), true); return null; }

    const balance = parseAmount(r.balance) ?? 0;
    const goal = parseAmount(r.goal_amount);
    const invested = parseAmount(r.total_invested);
    if ([balance, goal, invested].some(n => n !== null && isNaN(n))) { toast(i18n.t('acct.err.nan'), true); return null; }

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
    ctx.render();   // not renderAccounts — three other pages have this button too
    toast(`Created Accounts/${name}.md`);
    return acct;
  }

  // accountReconcile is published so a test can drive the REAL arithmetic — the
  // same reason owed.js publishes its serializer. Nothing else on ctx calls it.
  // accountIndex used to be published here too; it now lives on period.js,
  // which is where Savings reaches it from as well. Publishing it twice would
  // be a duplicate ctx key, which shell-contract.test.cjs rejects.
  ctx.provide({ renderAccounts, saveAccount, addAccount, editAccount,
    accountReconcile: reconcile, accountUtilisation: utilisationOf, ACCOUNT_FM_KEYS: EDITABLE_KEYS });
};
