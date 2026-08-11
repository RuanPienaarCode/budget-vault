'use strict';
/* Accounts — grouped balance tiles backed by the transaction history, so a
   hand-typed balance can be checked against what has actually moved since it
   was entered. Clicking a balance updates the account's markdown file in place. */

const { el, icoEl } = require('../dom');
/* The ring reuses the Dashboard's own chart primitives rather than a second
   donut implementation — same arc maths, same tooltip, same theme lookup, so
   the two rings on this app cannot drift apart visually. */
const { createChart, arcPath, tip, themeColors } = require('../chart');
const { normalizeAmount } = require('../amount');
/* A display symbol per account, and the disclosure when a total spans more
   than one of them. It converts nothing — see the module header. */
const { symbolOf, currenciesIn } = require('../currency');
const { patchFrontmatter, yamlStr } = require('../markdown');
const { safeSeg } = require('../vault-path');
/* Namespace import: this file binds `t` in askFields callbacks. */
const i18n = require('../i18n');
const { askFields } = require('../modal');
/* The reconciliation engine was written here first and now lives in its own
   module, because Savings, Services and Debt all need to make the same argument
   about a hand-typed figure. Behaviour on this page is unchanged. */
/* reconcile is published on ctx for the tests that drive the REAL arithmetic;
   the page itself now reaches it through acct-status below. */
const { reconcile } = require('../reconcile');
/* The state machine behind the decision queue — which accounts land in it, in
   what order, and why. Pure, and tested without a DOM. */
const { statusOf, wantsALook, staleRank, queueOrder, WARNINGS, mutedWarnings } = require('../acct-status');
const { supersededBySplit } = require('../tx-role');
const { ISO_DATE, todayIso } = require('../dates');

module.exports = function registerAccounts(ctx) {
  const { S, $, app, root, money, toast, writeFile, ensureFolder, relPath, fileAt,
    txInPeriod, accountForLabel, accountIndex, accountsWithFolder, periodMonthName } = ctx;

  /* One account's own figures, in its own symbol. Used for everything that
     describes a SINGLE account — its balance, its limit, its goal, its month.
     Cross-account totals keep plain money(), because they are stated in the
     household currency; where that spans more than one symbol the summary
     says so rather than converting. */
  const acctMoney = (a, v, decimals = 2) =>
    ctx.moneyIn(symbolOf(a, S.settings.currency), v, decimals);

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

  /* Which optional fields belong to which kind of account.

     The form used to offer all eleven to every type, so opening a cash wallet
     asked for its credit limit, its savings target date and the total invested
     in it — three questions with no answer, above the two that mattered. A
     wallet is a bank account with fewer moving parts, not a different species,
     so it gets the bank set: what it is, where it is, what is in it.

     Everything NOT listed here is still WRITTEN and still READ — this hides
     the input, it does not drop the key. `other` is deliberately absent from
     the map and falls through to the full set, because a type this app has no
     opinion about is not one it should be narrowing questions for. */
  const TYPE_FIELDS = {
    checking:    [],
    cash:        [],
    credit_card: ['credit_limit'],
    savings:     ['goal_amount', 'target_date', 'monthly_contribution', 'starting_amount', 'inception_date'],
    investment:  ['total_invested', 'starting_amount', 'inception_date', 'goal_amount', 'target_date', 'monthly_contribution'],
  };
  const ALL_OPTIONAL = ['credit_limit', 'goal_amount', 'target_date',
    'monthly_contribution', 'total_invested', 'starting_amount', 'inception_date'];

  /* A field is shown when the type calls for it — OR when the account already
     holds a value for it, whatever the type.

     That second half is not politeness, it is the difference between hiding a
     field and deleting one. editAccount saves every key in EDITABLE_KEYS from
     the form's result, so a field the form never rendered comes back
     `undefined`, parses to null, and FM_WRITERS removes the line. Retype a
     savings pot as cash and its goal would be silently erased by a dialog that
     never showed it. Anything already set stays on screen, where the reader
     can see it and clear it deliberately if that is what they meant. */
  function fieldsForType(type, a) {
    const forType = TYPE_FIELDS[type] || ALL_OPTIONAL;
    const set = new Set(forType);
    if (a) for (const k of ALL_OPTIONAL) if (hasValue(a[k])) set.add(k);
    return ALL_OPTIONAL.filter(k => set.has(k));
  }
  const hasValue = v => v != null && String(v).trim() !== '' && v !== 0;

  /* Frontmatter key → the line to write for this account's current value, or
     null to REMOVE the key. saveAccount only patches the keys it is handed, so
     a field nobody edited is never reformatted — that is what keeps the
     "everything else byte for byte" promise of the fmRaw branch honest.
     Balance is deliberately absent: it has its own affordance and its own date
     stamp, and folding it in here would make balance_updated meaningless. */
  const FM_WRITERS = {
    type: a => a.type,
    institution: a => (a.institution ? yamlStr(a.institution) : null),
    // Absent means "the household's", so an account left on the default keeps
    // a frontmatter block free of a line that says nothing.
    currency: a => (a.currency ? yamlStr(a.currency) : null),
    // Written raw, not through yamlStr: the value is either `true` or a YAML
    // flow list, and quoting either would turn it into a string that reads
    // back as one unrecognised word and mutes nothing.
    ignore_warnings: a => a.ignore_warnings || null,
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
      { key: 'balance', label: i18n.t('acct.balance.field'), type: 'number', value: a.balance.toFixed(2),
        // Which currency the figure being typed is IN. Nothing converts it, so
        // the symbol is the only thing telling the reader what they are
        // entering — and on a euro account that is the whole question.
        desc: i18n.t('acct.balance.inCurrency', { symbol: symbolOf(a, S.settings.currency) }) },
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
    toast(i18n.t('acct.reconciled', { name: a.name, amount: acctMoney(a, implied) }));
  }

  /* Everything about the account EXCEPT its balance and its name. The balance
     has its own affordance on the tile; the name is the filename the loader
     keys on and the folder transactions live under, so renaming here would
     silently orphan the history — that is a move-the-files operation, not a
     form field. */
  async function editAccount(a) {
    /* The optional half of the form, built per type. Keyed so the shown list
       below can pick from it by name and keep ALL_OPTIONAL's order. */
    const optional = {
      credit_limit: { key: 'credit_limit', label: i18n.t('acct.field.limit'), type: 'number',
        value: a.credit_limit != null ? String(a.credit_limit) : '',
        desc: i18n.t('acct.field.limitDesc') },
      goal_amount: { key: 'goal_amount', label: i18n.t('acct.field.goal'), type: 'number',
        value: a.goal_amount != null ? String(a.goal_amount) : '' },
      target_date: { key: 'target_date', label: i18n.t('acct.field.goalDate'), type: 'date', value: a.target_date },
      monthly_contribution: { key: 'monthly_contribution', label: i18n.t('acct.field.monthly'), type: 'number',
        value: a.monthly_contribution != null ? String(a.monthly_contribution) : '' },
      total_invested: { key: 'total_invested', label: i18n.t('acct.field.invested'), type: 'number',
        value: a.total_invested != null ? String(a.total_invested) : '',
        desc: i18n.t('acct.field.investedDesc') },
      starting_amount: { key: 'starting_amount', label: i18n.t('acct.field.starting'), type: 'number',
        value: a.starting_amount != null ? String(a.starting_amount) : '' },
      inception_date: { key: 'inception_date', label: i18n.t('acct.field.opened'), type: 'date', value: a.inception_date },
    };
    const shown = fieldsForType(a.type, a);

    const r = await askFields(app, i18n.t('acct.edit.title', { name: a.name }), [
      { key: 'type', label: i18n.t('acct.field.type'), type: 'select', options: acctTypeOptions(), value: a.type },
      { key: 'institution', label: i18n.t('acct.field.institution'), type: 'text', value: a.institution },
      { key: 'account_number', label: i18n.t('acct.field.number'), type: 'text', value: a.account_number,
        desc: i18n.t('acct.field.numberDesc') },
      { key: 'tx_label', label: i18n.t('acct.field.folder'), type: 'text', value: a.tx_label,
        desc: i18n.t('acct.field.folderDesc', { name: a.name }) },
      { key: 'currency', label: i18n.t('acct.field.currency'), type: 'text', value: a.currency,
        placeholder: S.settings.currency,
        desc: i18n.t('acct.field.currencyDesc', { symbol: S.settings.currency }) },
      { key: 'budget', label: i18n.t('acct.field.counts'), type: 'select',
        value: a.in_budget ? 'yes' : 'no',
        options: [{ value: 'yes', label: i18n.t('acct.counts.yes') },
          { value: 'no', label: i18n.t('acct.counts.no') }] },
      ...shown.map(k => optional[k]),
      { key: 'ignore_warnings', label: i18n.t('acct.field.mute'), type: 'toggles',
        desc: i18n.t('acct.field.muteDesc'),
        value: [...mutedWarnings(a)],
        options: WARNINGS.map(w => ({ value: w, label: i18n.t('acct.mute.' + w) })) },
    ]);
    if (!r) return;

    if (!ACCT_TYPES.includes(r.type)) return toast(i18n.t('acct.err.type'), true);
    /* Only the fields this dialog actually SHOWED are read back. A field the
       type hid was never on screen, so treating its absent result as "the user
       cleared it" would write a decision nobody made — and saveAccount patches
       every EDITABLE_KEY from the model, so the untouched ones round-trip
       unchanged on their own. */
    const nums = {};
    for (const k of shown) {
      if (k === 'target_date' || k === 'inception_date') continue;
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
    /* Blank means "the household's" — stored as empty, which FM_WRITERS turns
       into a removed key rather than a line asserting the default. */
    a.currency = (r.currency || '').trim();
    /* Serialised in WARNINGS order rather than the order the toggles happened
       to be flipped, so switching one off and back on again does not rewrite
       the line and show up as a diff in a file the reader syncs. `true` when
       every one is muted — shorter to read, and what a hand-editor writes. */
    const mute = WARNINGS.filter(w => (r.ignore_warnings || []).includes(w));
    a.ignore_warnings = mute.length === WARNINGS.length ? 'true'
      : mute.length ? `[${mute.join(', ')}]` : '';
    a.in_budget = r.budget !== 'no';
    Object.assign(a, nums);
    if (shown.includes('target_date')) a.target_date = (r.target_date || '').trim();
    if (shown.includes('inception_date')) a.inception_date = (r.inception_date || '').trim();

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

  /* ------------------------------ rendering ------------------------------

     The page is three bands, in the order a reader needs them:

       1. one figure — what these accounts are worth between them, and what
          that figure is made of;
       2. the QUEUE — the accounts whose stated balance cannot currently be
          trusted, each with the single action that settles it;
       3. the LEDGER — every account as one table row, sortable, with the
          detail folded into a drawer that opens under the row.

     It replaced a grid of tiles. Tiles cost ~180px of height each and said the
     same eight things about an account whether or not any of them mattered, so
     a vault with fifteen accounts was four screens of mostly-quiet cards with
     the two that needed a decision somewhere inside it. The queue is the fix
     for that; the table is the fix for the height. */

  function badge(text, cls) { return el('span', { class: `acct-badge${cls ? ' ' + cls : ''}` }, text); }

  /* Page state lives on S, NOT in a module-local. The file watcher re-renders
     the whole app whenever anything under the budget folder changes, and a
     sort, a filter or an open drawer held in this closure would reset itself
     every time a transaction file was saved — including by an import running
     in another window while the reader is halfway down this page.

     Filled in field by field and IN PLACE rather than replaced wholesale: the
     click handlers below capture the object this returns, so handing out a
     fresh one per call would let a handler mutate a copy nothing reads. */
  function view() {
    if (!S.acctView) S.acctView = {};
    const v = S.acctView;
    if (typeof v.filter !== 'string') v.filter = 'all';
    if (typeof v.q !== 'string') v.q = '';
    if (typeof v.sort !== 'string') v.sort = 'balance';
    if (v.dir !== 1 && v.dir !== -1) v.dir = -1;
    if (typeof v.grouped !== 'boolean') v.grouped = true;
    if (v.open === undefined) v.open = null;
    return v;
  }

  /* type → the group it renders under, derived FROM ACCT_GROUPS so the two can
     never disagree. A type missing from the map would render nowhere, which is
     the bug ACCT_GROUPS' own comment warns about. */
  const GROUP_OF = new Map();
  for (const [key, types] of ACCT_GROUPS) for (const ty of types) GROUP_OF.set(ty, key);
  const groupOf = a => GROUP_OF.get(a.type) || 'acct.group.other';

  /* One colour per kind of account, from this plugin's own palette and never
     from Obsidian's, so a theme cannot recolour a credit card into a savings
     pot. Cards are the danger red on purpose: on this page a card is the one
     row whose balance is usually money owed. */
  const TYPE_COLOUR = {
    checking:    'var(--color-info)',
    credit_card: 'var(--color-danger)',
    cash:        'var(--color-gold)',
    savings:     'var(--color-primary)',
    investment:  'var(--color-investment)',
    other:       'var(--color-accent)',
  };
  const GROUP_COLOUR = {
    'acct.group.bank':        'var(--color-info)',
    'acct.group.savings':     'var(--color-primary)',
    'acct.group.investments': 'var(--color-investment)',
    'acct.group.other':       'var(--color-accent)',
  };
  const colourOf = a => TYPE_COLOUR[a.type] || 'var(--color-accent)';

  /* Everything every band on this page needs, computed once per render.
     reconcile() walks an account's whole row list, so doing it separately in
     the summary, the queue and the table would be three passes over the same
     transactions to reach the same answer. */
  function model() {
    const idx = accountIndex();
    return S.accounts.map(a => {
      const entry = idx.get(a);
      const rows = entry ? entry.rows : [];
      const labels = entry ? entry.labels : new Set();
      const st = statusOf(a, rows);
      const act = periodActivity(labels);
      return Object.assign({ a, rows, labels, act, flow: act.inAmt - act.outAmt, group: groupOf(a) }, st);
    });
  }

  /* ------------------------------- band 1 --------------------------------
     One figure, and the ring that says what it is made of. */

  function renderSummary(rows) {
    const wrap = $('#acctSummary');
    if (!wrap) return;
    wrap.empty();

    /* By the SIGN of the balance rather than by account type: a credit card in
       credit is not a liability, and an overdrawn cheque account is one. */
    let assets = 0, liabilities = 0;
    for (const a of S.accounts) {
      if (a.balance >= 0) assets += a.balance; else liabilities += -a.balance;
    }
    const net = assets - liabilities;
    const attention = rows.filter(wantsALook).length;
    const oldest = rows.reduce((m, r) => (r.days !== null && r.days > m ? r.days : m), -1);

    /* Only qualify the figure when there IS something elsewhere for it to
       disagree with. On a vault with no assets and no debts the pages report
       the same number, and a caveat about a difference that does not exist is
       just noise. */
    const elsewhere = (S.assets || []).some(x => x.value > 0)
      || (S.debts || []).some(d => d.status !== 'paid' && d.balance > 0);

    /* This figure ADDS every balance and states the result in the household
       currency. Where an account is denominated in something else that is not
       a conversion — no rate is stored, and one would be a fact about a day
       this vault does not hold — it is a plain sum of unlike figures. So it
       says so, right under the number.

       Deliberately not an exclusion. `budget: false` is the one mechanism this
       app has for keeping an account out of a total, and committed.js states
       why there must not be a second: two overlapping ways to exclude the same
       account is how a reader ends up unable to explain their own total. A
       reader who wants the euro account out already knows how to do it. */
    const symbols = currenciesIn(S.accounts, S.settings.currency);

    const hero = el('div', { class: 'card hero acct-hero' },
      el('div', { class: 'hero-lbl' }, i18n.t('acct.hero.label')),
      el('div', { class: `hero-num${net < 0 ? ' hero-num--negative' : ''}` }, money(net)),
      el('div', { class: 'hero-sub' },
        i18n.t('acct.hero.sub', { assets: money(assets), liabilities: money(liabilities) })
        + (elsewhere ? i18n.t('acct.hero.elsewhere') : '')
        + (symbols.length > 1 ? i18n.t('acct.hero.mixed', { symbols: symbols.join(' · ') }) : '')));

    const facts = el('div', { class: 'acct-hero-facts' });
    const fact = (label, value, cls) => facts.append(el('div', { class: 'acct-fact' },
      el('div', { class: 'acct-fact-l' }, label),
      el('div', { class: `acct-fact-v${cls ? ' ' + cls : ''}` }, value)));
    fact(i18n.t('acct.hero.count'), String(S.accounts.length));
    fact(i18n.t('acct.kpi.attention'), String(attention), attention > 0 ? 'text-warning' : '');
    /* Only when there ARE muted accounts. A page that permanently advertised
       "0 ignored" would be teaching every reader about a setting most of them
       will never use — and a zero here is not news, it is the default. */
    const muted = rows.filter(r => r.muted).length;
    if (muted) fact(i18n.t('acct.hero.muted'), String(muted));
    fact(i18n.t('acct.hero.oldest'),
      oldest < 0 ? i18n.t('acct.hero.oldestNone') : i18n.t('acct.hero.oldestDays', { count: oldest }));
    hero.append(facts);

    wrap.append(hero, whereItSits());
  }

  /* The ring. Positive group totals only — a donut cannot draw a negative
     wedge, and a group whose card debt exceeds its cash is a bar-chart problem.
     Rather than drop it silently (which would leave the ring and the hero
     quietly disagreeing), such a group is NAMED under the legend. */
  function whereItSits() {
    const groups = ACCT_GROUPS.map(([key]) => ({
      key,
      colour: GROUP_COLOUR[key] || 'var(--color-accent)',
      total: S.accounts.filter(a => groupOf(a) === key).reduce((s, a) => s + a.balance, 0),
    })).filter(g => g.total !== 0);

    const drawn = groups.filter(g => g.total > 0).sort((x, y) => y.total - x.total);
    const negative = groups.filter(g => g.total < 0);
    const sum = drawn.reduce((s, g) => s + g.total, 0);

    const card = el('div', { class: 'card acct-ring' });
    card.append(el('div', { class: 'card-h' },
      el('div', {},
        el('h2', {}, i18n.t('acct.where.title')),
        el('div', { class: 'sub' }, i18n.t('acct.where.sub')))));

    const body = el('div', { class: 'body-pad acct-ring-body' });
    if (!sum) { card.append(body); return card; }

    const pctOf = g => (g.total / sum) * 100;
    const W = 320, H = 320, cx = W / 2, cy = H / 2, rOut = 140, rIn = 92;
    const { svg, add } = createChart({
      w: W, h: H, cls: 'donut acct-donut',
      label: i18n.t('acct.where.aria', {
        parts: drawn.map(g => i18n.t('acct.where.part',
          { group: i18n.t(g.key), pct: Math.round(pctOf(g)) })).join(', '),
      }),
    });

    let a0 = -Math.PI / 2;                  // 12 o'clock, so the largest slice starts at the top
    for (const g of drawn) {
      const sweep = (g.total / sum) * Math.PI * 2;
      const seg = add('path', {
        d: arcPath(cx, cy, rOut, rIn, a0, a0 + sweep),
        fill: g.colour, stroke: themeColors(root).hole, 'stroke-width': '2',
      });
      tip(add, seg, `${i18n.t(g.key)}: ${money(g.total)} · ${Math.round(pctOf(g))}%`);
      a0 += sweep;
    }
    add('text', {
      x: cx, y: cy + 10, 'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700',
      fill: 'currentColor', 'font-family': 'inherit',
    }).textContent = money(sum, 0);

    const legend = el('ul', { class: 'donut-legend acct-ring-legend' });
    for (const g of drawn) {
      legend.append(el('li', {},
        el('i', { style: `background:${g.colour}` }),
        el('span', { class: 'dl-name' }, i18n.t(g.key)),
        el('span', { class: 'dl-val num' }, money(g.total, 0)),
        el('span', { class: 'dl-pct' }, `${Math.round(pctOf(g))}%`)));
    }
    body.append(svg, legend);
    if (negative.length) {
      body.append(el('div', { class: 'acct-ring-note' },
        i18n.t('acct.where.negative', {
          count: negative.length,
          names: negative.map(g => i18n.t(g.key)).join(', '),
        })));
    }
    card.append(body);
    return card;
  }

  /* ------------------------------- band 2 --------------------------------
     The queue. This is the band the redesign exists for: the page has always
     KNOWN which accounts could not be trusted — it reported the number in a
     tile and then left the reader to find them. */

  /* Four is what fits without pushing the ledger off the screen. A queue that
     scrolls is not a queue — but the remainder is NAMED rather than dropped,
     because a silent cap reads as "that is all of them". */
  const DECK_MAX = 4;

  function deckWhy(r) {
    if (r.state === 'drift') {
      return i18n.t('acct.deck.why.drift',
        { count: r.rec.count, implied: money(r.rec.implied), stated: money(r.a.balance) });
    }
    if (r.state === 'stale') {
      return i18n.t('acct.deck.why.stale', { count: r.days, date: r.a.balance_updated });
    }
    return i18n.t(r.state === 'nodate' ? 'acct.deck.why.nodate' : 'acct.deck.why.notx');
  }

  /* The ONE action a reader would take without looking. Everything else is
     "Review", which opens this account's drawer in the table below — so there
     is one place to act in a hurry and one place to act in depth, rather than
     two competing copies of the same controls. */
  function deckAction(r) {
    if (r.state === 'drift') {
      return { label: i18n.t('acct.deck.do.drift', { amount: money(r.rec.implied) }),
        run: () => acceptImplied(r.a, r.rec.implied) };
    }
    if (r.state === 'stale' || r.state === 'nodate') {
      return { label: i18n.t(r.state === 'stale' ? 'acct.deck.do.stale' : 'acct.deck.do.nodate'),
        run: () => editBalance(r.a) };
    }
    return { label: i18n.t('acct.deck.do.notx'), run: () => editAccount(r.a) };
  }

  function renderDeck(rows) {
    const wrap = $('#acctDeck');
    if (!wrap) return;
    wrap.empty();

    const flagged = queueOrder(rows);

    /* An empty queue is not an empty shelf: the whole band collapses to one
       quiet line, which is the state most weeks will be in. */
    if (!flagged.length) {
      /* An empty vault gets the table's own empty state, not an all-clear about
         nothing. The class is cleared too: leaving a stale `acct-deck` on an
         empty div would paint a bordered amber box with no content in it. */
      if (!S.accounts.length) { wrap.className = ''; return; }
      wrap.className = 'acct-deck is-clear mb-4';
      wrap.append(
        el('div', { class: 'acct-deck-h' },
          el('span', { class: 'acct-deck-dot' }),
          el('h2', {}, i18n.t('acct.deck.clear'))),
        el('div', { class: 'acct-deck-sub' }, i18n.t('acct.deck.clearSub')));
      return;
    }

    wrap.className = 'acct-deck mb-4';
    wrap.append(
      el('div', { class: 'acct-deck-h' },
        el('span', { class: 'acct-deck-dot' }),
        el('h2', {}, i18n.t('acct.deck.title', { count: flagged.length }))),
      el('div', { class: 'acct-deck-sub' }, i18n.t('acct.deck.sub')));

    const list = el('div', { class: 'acct-deck-list' });
    for (const r of flagged.slice(0, DECK_MAX)) {
      const act = deckAction(r);
      const reviewBtn = el('button', { type: 'button', class: 'acct-deck-btn ghost',
        'aria-label': i18n.t('acct.deck.ariaReview', { name: r.a.name }) }, i18n.t('acct.deck.review'));
      reviewBtn.addEventListener('click', () => openRow(r.a.name, true));
      const doBtn = el('button', { type: 'button', class: 'acct-deck-btn' }, icoEl(['check']), act.label);
      doBtn.addEventListener('click', act.run);
      list.append(el('div', { class: 'acct-deck-item' },
        el('div', { class: 'acct-deck-txt' },
          el('div', { class: 'acct-deck-name' }, r.a.name),
          el('div', { class: 'acct-deck-why' }, deckWhy(r))),
        el('div', { class: 'acct-deck-acts' }, reviewBtn, doBtn)));
    }
    wrap.append(list);

    const rest = flagged.length - Math.min(flagged.length, DECK_MAX);
    if (rest > 0) {
      const more = el('button', { type: 'button', class: 'acct-deck-btn ghost acct-deck-more' },
        i18n.t('acct.deck.more', { count: rest }));
      more.addEventListener('click', () => {
        view().filter = 'flag';
        view().open = null;
        renderAccounts();
      });
      wrap.append(more);
    }
  }

  /* ------------------------------- band 3 --------------------------------
     The ledger. Reuses the sheet's own .table rules, so a row here and a row
     on the Dashboard's Budget vs Actual card are the same object. */

  const FILTERS = () => [
    { key: 'all', label: i18n.t('acct.filter.all'), test: () => true },
    ...ACCT_GROUPS.map(([key]) => ({ key, label: i18n.t(key), test: r => r.group === key })),
    { key: 'flag', label: i18n.t('acct.filter.flag'), test: wantsALook, warn: true },
  ];

  const SORTERS = {
    name:    (x, y) => x.a.name.localeCompare(y.a.name),
    balance: (x, y) => x.a.balance - y.a.balance,
    flow:    (x, y) => x.flow - y.flow,
    stale:   (x, y) => staleRank(x) - staleRank(y),
  };

  function visibleRows(rows) {
    const v = view();
    const f = FILTERS().find(x => x.key === v.filter) || FILTERS()[0];
    const q = (v.q || '').trim().toLowerCase();
    return rows
      .filter(r => f.test(r))
      .filter(r => !q || `${r.a.name} ${r.a.institution || ''} ${r.a.type}`.toLowerCase().includes(q))
      .sort((x, y) => (SORTERS[v.sort] || SORTERS.balance)(x, y) * v.dir);
  }

  function renderFilters(rows) {
    const wrap = $('#acctFilters');
    if (!wrap) return;
    wrap.empty();
    const v = view();
    for (const f of FILTERS()) {
      const n = rows.filter(f.test).length;
      /* A chip that filters to nothing is a control that cannot be used. "All"
         always stands — it is how you get back — but a vault with no
         investments has no business offering an Investments tab, and "Needs a
         look" disappearing entirely IS the good news. The one exception is a
         chip that is currently selected: removing the control the reader is
         standing on would strand them on an empty table with no way back. */
      if (!n && f.key !== 'all' && v.filter !== f.key) continue;
      const b = el('button', { type: 'button',
        class: `acct-seg${f.warn ? ' is-warn' : ''}`,
        'aria-pressed': String(v.filter === f.key) },
        f.label, el('span', { class: 'acct-seg-n' }, String(n)));
      b.addEventListener('click', () => {
        v.filter = f.key;
        v.open = null;                     // a drawer left open under a filtered-out row
        renderAccounts();
      });
      wrap.append(b);
    }
  }

  /* A running total through the period, drawn as a line with no axis and no
     numbers: its job is SHAPE — climbing, flat, or falling off a cliff.
     Deliberately the cumulative MOVEMENT rather than the balance itself: the
     opening balance for the period is not a figure this page knows, and
     inventing one would put a number under the reader's eye that no file says.
     An account nothing moved through gets no line at all, because a flat
     stroke would claim a month that was measured and found still. */
  function sparkline(r) {
    const rowsInPeriod = txInPeriod(S.period)
      .filter(t => r.labels.has(t.label) && !supersededBySplit(t))
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    if (rowsInPeriod.length < 2) return null;

    let run = 0;
    const series = [0];
    for (const t of rowsInPeriod) { run += t.amount; series.push(run); }

    const W = 96, H = 24, pad = 2;
    const lo = Math.min(...series), hi = Math.max(...series), span = (hi - lo) || 1;
    /* The one inversion (SVG's y grows downward) happens here and nowhere else,
       so the series above stays plain ascending-is-up. */
    const d = series.map((v, i) => {
      const x = (i / (series.length - 1)) * W;
      const y = H - pad - ((v - lo) / span) * (H - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

    const { svg, add } = createChart({ w: W, h: H, cls: 'acct-spark' });
    add('path', {
      d, fill: 'none', stroke: colourOf(r.a), 'stroke-width': '1.8',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: '0.85',
    });
    svg.removeAttribute('role');            // decorative: the figures are in the cells beside it
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }

  /* The goal / limit cell: a credit card measured against its limit, a savings
     pot against its goal, an investment against what was put into it. Same bar
     and same thresholds as the Dashboard's budget bars, so a filled bar means
     one thing everywhere in this app. */
  function goalCell(r) {
    const a = r.a;
    const bar = (pct, tone, label) => el('span', { class: 'acct-goal' },
      el('span', { class: 'acct-mbar' },
        el('i', { class: tone || '', style: `width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%` })),
      el('span', { class: 'acct-mbar-l' }, label));

    const u = utilisationOf(a);
    if (u) {
      return bar(u.pct, u.over ? 'bg-danger' : u.near ? 'bg-warning' : '',
        u.over ? i18n.t('acct.overLimit', { amount: acctMoney(a, -u.available, 0) })
          : i18n.t('acct.limitOf', { pct: Math.round(u.pct), amount: acctMoney(a, a.credit_limit, 0) }));
    }
    if (a.goal_amount > 0) {
      const pct = (a.balance / a.goal_amount) * 100;
      return bar(pct, '', i18n.t('acct.goalOf', { pct: Math.round(pct), amount: acctMoney(a, a.goal_amount, 0) }));
    }
    if (a.total_invested > 0) {
      const pct = ((a.balance - a.total_invested) / a.total_invested) * 100;
      return bar(100, pct < 0 ? 'bg-warning' : '',
        i18n.t('acct.growthOn', { pct: (pct >= 0 ? '+' : '') + Math.round(pct), amount: acctMoney(a, a.total_invested, 0) }));
    }
    return el('span', { class: 'acct-dash' }, '—');
  }

  function statePill(r) {
    const cls = { ok: 'ok', drift: 'danger', stale: 'warn', nodate: 'warn', notx: 'warn', nofolder: 'warn' }[r.state];
    const label = r.state === 'stale'
      ? i18n.t('acct.state.stale', { count: r.days })
      : i18n.t(`acct.state.${r.state}`);
    /* A muted account still says what it IS — the pill is the fact, and the
       reader asked for the nagging to stop, not for the page to start
       claiming the figure agrees with transactions it has never seen. Muting
       only drops the alarm colour and adds the reason it is quiet. */
    if (r.muted) {
      return el('span', { class: 'acct-pill muted', title: i18n.t('acct.mutedTitle') },
        label, el('span', { class: 'acct-pill-mute' }, i18n.t('acct.state.muted')));
    }
    return el('span', { class: `acct-pill ${cls}` }, label);
  }

  function accountRow(r) {
    const a = r.a, v = view();
    const open = v.open === a.name;
    const tr = el('tr', {
      class: `acct-row${r.state === 'drift' ? ' is-drift' : wantsALook(r) ? ' is-flag' : ''}${open ? ' is-open' : ''}`,
      tabindex: '0',
      'aria-expanded': String(open),
      'aria-label': i18n.t('acct.aria.row', { name: a.name }),
    });

    /* The name is the drill-through to this account's transactions. A button
       rather than a link: it moves the view, it does not navigate anywhere a
       URL could describe. */
    const primary = [...r.labels][0];
    const nameEl = primary
      ? el('button', { type: 'button', class: 'acct-name-btn',
        'aria-label': i18n.t('acct.aria.showTx', { name: a.name }) }, a.name)
      : el('span', { class: 'acct-name-btn is-plain' }, a.name);
    if (primary) {
      nameEl.addEventListener('click', e => { e.stopPropagation(); openTransactions(primary); });
    }

    const balBtn = el('button', { type: 'button',
      class: `acct-bal num${a.balance < 0 ? ' text-danger' : ''}`,
      'aria-label': i18n.t('acct.aria.balance', { name: a.name, amount: acctMoney(a, a.balance) }) },
      acctMoney(a, a.balance));
    balBtn.addEventListener('click', e => { e.stopPropagation(); editBalance(a); });

    const flowCell = r.act.count
      ? el('span', { class: `acct-chip ${r.flow >= 0 ? 'up' : 'down'}` },
        `${r.flow >= 0 ? '+' : '−'}${acctMoney(a, Math.abs(r.flow), 0)}`)
      : el('span', { class: 'acct-dash' }, '—');

    const spark = sparkline(r);

    tr.append(
      el('td', {}, el('div', { class: 'acct-cell-name' },
        el('span', { class: 'acct-dot', style: `background:${colourOf(a)}` }),
        el('span', {}, nameEl,
          el('span', { class: 'acct-cell-sub' },
            [a.type.replace('_', ' '), a.institution].filter(Boolean).join(' · '))))),
      el('td', { class: 'num' }, balBtn),
      el('td', { class: 'num acct-col-drop' }, flowCell),
      el('td', { class: 'acct-col-drop' }, spark || el('span', { class: 'acct-dash' }, '—')),
      el('td', { class: 'acct-col-drop' }, goalCell(r)),
      el('td', { class: 'acct-col-drop' },
        el('span', { class: 'acct-when' }, a.balance_updated || i18n.t('acct.noDate'))),
      el('td', {}, statePill(r)));

    tr.addEventListener('click', () => openRow(a.name, false));
    tr.addEventListener('keydown', e => {
      if (e.target !== tr) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openRow(a.name, false);
    });
    return tr;
  }

  /* Everything the tile used to carry below its balance, moved wholesale into
     a drawer that opens under the row. Nothing here is new information — it is
     the same badges, the same activity line and the same reconciliation offer,
     shown when the reader asks for one account rather than for all of them. */
  function drawerRow(r) {
    const a = r.a;
    const box = el('div', { class: 'acct-drawer' });

    box.append(el('div', { class: 'acct-drawer-h' },
      el('h3', {}, a.name),
      el('div', { class: `acct-drawer-v num${a.balance < 0 ? ' text-danger' : ''}` }, acctMoney(a, a.balance))));

    const grid = el('div', { class: 'acct-drawer-grid' });
    const f = (label, value) => grid.append(el('div', { class: 'acct-drawer-f' },
      el('div', { class: 'acct-drawer-l' }, label),
      el('div', { class: 'acct-drawer-val num' }, value)));

    const u = utilisationOf(a);
    if (u) {
      f(i18n.t('acct.drawer.limit'), acctMoney(a, a.credit_limit));
      f(i18n.t('acct.drawer.available'), acctMoney(a, u.available));
    }
    if (a.goal_amount > 0) {
      f(i18n.t('acct.drawer.goal'), acctMoney(a, a.goal_amount));
      f(i18n.t('acct.drawer.toGo'), acctMoney(a, Math.max(0, a.goal_amount - a.balance)));
    }
    if (a.total_invested > 0) {
      f(i18n.t('acct.drawer.invested'), acctMoney(a, a.total_invested));
      f(i18n.t('acct.drawer.growth'), acctMoney(a, a.balance - a.total_invested));
    }
    if (a.monthly_contribution) f(i18n.t('acct.drawer.monthly'), acctMoney(a, a.monthly_contribution));
    if (r.act.count) {
      f(i18n.t('acct.drawer.flow'),
        `+${acctMoney(a, r.act.inAmt, 0)} · −${acctMoney(a, r.act.outAmt, 0)}`);
      f(i18n.t('acct.drawer.rows', { count: r.act.count }), periodMonthName(S.period));
    }
    f(i18n.t('acct.drawer.folder'), a.tx_label || a.name);
    f(i18n.t('acct.drawer.inBudget'), i18n.t(a.in_budget ? 'acct.drawer.yes' : 'acct.drawer.no'));
    box.append(grid);

    /* The badges the tile carried. Kept because they say things the state pill
       cannot: "not in budget" is not a problem with the figure, it is a fact
       about what the figure counts toward. */
    const badges = el('div', { class: 'acct-badges' });
    if (!a.in_budget) badges.append(badge(i18n.t('acct.badge.notInBudget'), 'muted'));
    if (!r.rows.length) badges.append(badge(i18n.t('acct.badge.noTx'), 'warn'));
    if (a.balance_updated && r.days === null) {
      badges.append(badge(i18n.t('acct.badge.asOf', { date: a.balance_updated }), 'muted'));
    }
    if (badges.childElementCount) box.append(badges);

    box.append(reconLine(r));

    const acts = el('div', { class: 'acct-drawer-acts' });
    const act = (label, aria, run) => {
      const b = el('button', { type: 'button', class: 'acct-drawer-act', 'aria-label': aria }, label);
      b.addEventListener('click', run);
      acts.append(b);
    };
    act(i18n.t('acct.btn.editBalance'),
      i18n.t('acct.aria.balance', { name: a.name, amount: money(a.balance) }), () => editBalance(a));
    const primary = [...r.labels][0];
    if (primary) {
      act(i18n.t('acct.btn.seeTx'), i18n.t('acct.aria.showTx', { name: a.name }),
        () => openTransactions(primary));
    }
    act(i18n.t('acct.btn.edit'), i18n.t('acct.aria.edit', { name: a.name }), () => editAccount(a));
    act(i18n.t(a.in_budget ? 'acct.btn.exclude' : 'acct.btn.include'),
      i18n.t(a.in_budget ? 'acct.aria.exclude' : 'acct.aria.include', { name: a.name }),
      () => toggleBudget(a));
    act(i18n.t('acct.btn.openNote'), i18n.t('acct.aria.openNote', { name: a.name }),
      () => openAccountFile(a));
    box.append(acts);

    const td = el('td', { colspan: '7', class: 'acct-drawer-cell' }, box);
    return el('tr', { class: 'acct-drawer-row' }, td);
  }

  /* The reconciliation, stated the same way it always was — the arithmetic and
     an offer, never a silent correction. */
  function reconLine(r) {
    const a = r.a, rec = r.rec;
    const line = el('div', { class: 'acct-recon' });
    if (rec.state === 'drift') {
      const diff = rec.implied - a.balance;
      line.append(el('div', { class: 'acct-recon-txt' },
        i18n.t('acct.drawer.drift', {
          count: rec.count,
          date: a.balance_updated,
          implied: money(rec.implied),
          diff: money(Math.abs(diff), 0),
          dir: i18n.t(diff < 0 ? 'acct.drawer.lower' : 'acct.drawer.higher'),
        }) + (rec.ahead ? i18n.t('acct.recon.pending', { count: rec.ahead }) : '')));
      const btn = el('button', { type: 'button', class: 'acct-recon-btn',
        'aria-label': i18n.t('acct.aria.useThis', { name: a.name, amount: money(rec.implied) }) },
        icoEl(['check']), i18n.t('acct.recon.useThis'));
      btn.addEventListener('click', () => acceptImplied(a, rec.implied));
      line.append(btn);
      return line;
    }
    const txt = r.state === 'notx' ? i18n.t('acct.drawer.recon.notx')
      : r.state === 'nodate' ? i18n.t('acct.drawer.recon.nodate')
        : r.state === 'stale' ? i18n.t('acct.drawer.recon.stale', { date: a.balance_updated })
          : rec.state === 'pending' ? i18n.t('acct.recon.upToDate', { count: rec.ahead })
            : i18n.t('acct.drawer.recon.ok');
    line.append(el('div', { class: `acct-recon-txt${r.state === 'ok' ? ' text-success' : ' text-muted'}` }, txt));
    if (r.state === 'stale' || r.state === 'nodate') {
      const btn = el('button', { type: 'button', class: 'acct-recon-btn' },
        i18n.t(r.state === 'stale' ? 'acct.deck.do.stale' : 'acct.deck.do.nodate'));
      btn.addEventListener('click', () => editBalance(a));
      line.append(btn);
    }
    return line;
  }

  function sortHeader(key, label) {
    const v = view();
    const on = v.sort === key;
    const th = el('th', { class: on ? 'is-sorted' : '', scope: 'col' });
    const b = el('button', { type: 'button', 'aria-label': i18n.t('acct.aria.sortBy', { column: label }) },
      label, el('span', { class: 'acct-caret' }, on ? (v.dir === -1 ? '↓' : '↑') : '↕'));
    b.addEventListener('click', () => {
      if (v.sort === key) v.dir = -v.dir;
      else { v.sort = key; v.dir = key === 'name' ? 1 : -1; }
      renderAccounts();
    });
    th.append(b);
    return th;
  }

  function renderTable(rows) {
    const table = $('#acctTable');
    if (!table) return;
    table.empty();
    const v = view();
    const shown = visibleRows(rows);

    const head = el('tr', {},
      sortHeader('name', i18n.t('acct.col.account')),
      sortHeader('balance', i18n.t('acct.col.balance')),
      sortHeader('flow', periodMonthName(S.period)),
      el('th', { class: 'acct-col-drop', scope: 'col' }, i18n.t('acct.col.month')),
      el('th', { class: 'acct-col-drop', scope: 'col' }, i18n.t('acct.col.goal')),
      sortHeader('stale', i18n.t('acct.col.confirmed')),
      el('th', { scope: 'col' }, i18n.t('acct.col.state')));
    head.children[2].classList.add('acct-col-drop', 'num');
    head.children[5].classList.add('acct-col-drop');
    table.append(el('thead', {}, head));

    const body = el('tbody', {});
    const emit = r => {
      body.append(accountRow(r));
      if (v.open === r.a.name) body.append(drawerRow(r));
    };

    if (!shown.length) {
      body.append(el('tr', { class: 'acct-empty' },
        el('td', { colspan: '7' },
          S.accounts.length ? i18n.t('acct.emptySearch') : i18n.t('acct.empty'))));
    } else if (v.grouped) {
      for (const [key] of ACCT_GROUPS) {
        const inGroup = shown.filter(r => r.group === key);
        if (!inGroup.length) continue;
        const total = inGroup.reduce((s, r) => s + r.a.balance, 0);
        /* Same disclosure as the hero, at group scale: a Bank total that has
           quietly added euros to rands is marked where the total is, not in a
           legend somewhere else on the page. */
        const mixed = currenciesIn(inGroup.map(r => r.a), S.settings.currency).length > 1;
        body.append(el('tr', { class: 'type-row' },
          el('td', { colspan: '7' },
            i18n.t(key),
            el('span', { class: 'acct-group-total num' }, money(total),
              ...(mixed ? [el('span', { class: 'acct-mixed',
                title: i18n.t('acct.mixedTitle') }, '*')] : [])))));
        for (const r of inGroup) emit(r);
      }
    } else {
      for (const r of shown) emit(r);
    }
    table.append(body);

    const sub = $('#acctTblSub');
    if (sub) {
      sub.textContent =
        (shown.length === S.accounts.length
          ? i18n.t('acct.table.subAll', { count: S.accounts.length })
          : i18n.t('acct.table.subSome', { shown: shown.length, total: S.accounts.length }))
        + i18n.t(v.grouped ? 'acct.table.grouped' : 'acct.table.flat')
        + i18n.t('acct.table.sortedBy', { column: i18n.t(`acct.sort.${v.sort}`) });
    }
    const toggle = $('#acctGroupToggle');
    if (toggle) toggle.setAttribute('aria-pressed', String(v.grouped));
    const search = $('#acctSearch');
    if (search && search.value !== v.q) search.value = v.q;
  }

  /* Open (or close) one account's drawer. `scroll` is for the queue's Review
     button, which may be pointing at a row a filter is currently hiding — so
     it clears a group filter first rather than scrolling to nothing. */
  function openRow(name, scroll) {
    const v = view();
    if (scroll && v.filter !== 'all' && v.filter !== 'flag') v.filter = 'all';
    v.open = v.open === name && !scroll ? null : name;
    renderAccounts();
    if (!scroll || !v.open) return;
    const table = $('#acctTable');
    if (!table) return;
    for (const tr of table.querySelectorAll('tr.acct-row')) {
      if (tr.classList.contains('is-open')) { tr.scrollIntoView({ block: 'center' }); tr.focus(); break; }
    }
  }

  function renderAccounts() {
    const rows = model();
    renderSummary(rows);
    renderDeck(rows);
    renderFilters(rows);
    renderTable(rows);
  }

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
    if (a.currency) lines.push(`currency: ${yamlStr(a.currency)}`);
    if (a.ignore_warnings) lines.push(`ignore_warnings: ${a.ignore_warnings}`);
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
    /* The create form offers only the two optional figures it always has, and
       now only when the kind being created has any use for them — a cash
       wallet is not asked for its savings goal or what was invested in it.
       Everything else is a job for the edit dialog, which is where the full
       set lives; a create form that asked eleven questions would be a worse
       trade than a second click. */
    const opt = fieldsForType(preType, null);
    const r = await askFields(app, i18n.t('acct.new.title'), [
      { key: 'name', label: i18n.t('acct.field.name'), type: 'text', placeholder: 'e.g. Easy Equities TFSA' },
      { key: 'type', label: i18n.t('acct.field.type'), type: 'select', options: acctTypeOptions(), value: preType },
      { key: 'institution', label: i18n.t('acct.field.institution'), type: 'text', placeholder: 'e.g. Easy Equities' },
      { key: 'balance', label: i18n.t('acct.field.balance'), type: 'number', value: '0' },
      { key: 'currency', label: i18n.t('acct.field.currency'), type: 'text',
        placeholder: S.settings.currency,
        desc: i18n.t('acct.field.currencyDesc', { symbol: S.settings.currency }) },
      ...(opt.includes('goal_amount')
        ? [{ key: 'goal_amount', label: i18n.t('acct.field.goalOpt'), type: 'number',
          desc: i18n.t('acct.field.goalOptDesc') }] : []),
      ...(opt.includes('total_invested')
        ? [{ key: 'total_invested', label: i18n.t('acct.field.investedOpt'), type: 'number',
          desc: i18n.t('acct.field.investedDesc') }] : []),
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
      currency: (r.currency || '').trim(),
      // Nothing muted on a fresh account: the warnings are how a new account
      // gets set up, so starting them off would hide the very prompts that
      // tell the reader to link a folder and import something.
      ignore_warnings: '',
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
  /* The two shell controls the controller wires. They live here rather than in
     controller.js so the shape of S.acctView has exactly one owner. */
  function acctSearch(q) { view().q = q; view().open = null; renderAccounts(); }
  function acctToggleGroup() { const v = view(); v.grouped = !v.grouped; renderAccounts(); }

  ctx.provide({ renderAccounts, saveAccount, addAccount, editAccount,
    acctSearch, acctToggleGroup,
    accountReconcile: reconcile, accountUtilisation: utilisationOf, ACCOUNT_FM_KEYS: EDITABLE_KEYS });
};
