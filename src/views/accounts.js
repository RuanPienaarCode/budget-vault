'use strict';
/* Accounts — grouped balance tiles backed by the transaction history, so a
   hand-typed balance can be checked against what has actually moved since it
   was entered. Clicking a balance updates the account's markdown file in place. */

const { el, icoEl, keepScroll, caveatChip } = require('../dom');
/* The ring reuses the Dashboard's own chart primitives rather than a second
   donut implementation — same arc maths, same tooltip, same theme lookup, so
   the two rings on this app cannot drift apart visually. */
const { createChart, arcPath, tip, themeColors } = require('../chart');
const { normalizeAmount } = require('../amount');
/* A display symbol per account, and the disclosure when a total spans more
   than one of them. It converts nothing — see the module header. isForeign is
   used only by this view's own splitByCurrency() below — currency.js stays
   display-only by design (tests/currency.test.cjs's own §7 pins that), so the
   ACTUAL splitting of a total into "primary sum" + "foreign side figures" is
   this view's arithmetic, not that module's. */
const { symbolOf, splitByCurrency: splitAccounts, primaryTotal } = require('../currency');
/* What an account is worth against what was put into it, derived from its own
   transactions rather than a stale hand-typed total_invested. Shared with
   views/savings.js — see savings-math.js's own header for why
   `balance - total_invested` was retired: measured against four real accounts
   it was wrong on all four. poolCatType alongside it: ITEM 2, the same
   growth/contribution split savings.js now makes — this file's own
   totalReturn() call below must feed it the SAME pool-aware type lookup or
   the goal cell and drawer answer a different growth figure for the same
   account than the Savings page does (exactly the two-call-sites-drift bug
   the comment above already names one instance of). */
const { totalReturn, poolCatType } = require('../savings-math');
const { yamlStr } = require('../markdown');
const { safeSeg } = require('../vault-path');
/* Namespace import: this file binds `t` in askFields callbacks. */
const i18n = require('../i18n');
const { askFields, confirmModal } = require('../modal');
/* The reconciliation engine was written here first and now lives in its own
   module, because Savings, Services and Debt all need to make the same argument
   about a hand-typed figure. Behaviour on this page is unchanged. */
/* reconcile is published on ctx for the tests that drive the REAL arithmetic;
   the page itself now reaches it through acct-status below. */
const { reconcile } = require('../reconcile');
/* committed.js owns what counts as a credit card — one tolerant spelling of
   the type test, shared with net worth and the importer, so a hand-typed
   `Credit_Card` is a card to every page or to none. */
const { isCreditCard } = require('../committed');
/* The state machine behind the decision queue — which accounts land in it, in
   what order, and why. Pure, and tested without a DOM. */
const { statusOf, wantsALook, staleRank, queueOrder, WARNINGS, mutedWarnings, URGENCY } = require('../acct-status');
/* isSplitPart, alongside supersededBySplit: the delete dialog counts what the
   BANK actually printed, and a split's parts are rows this app created, not
   statement lines — see tx-role.js's own header. */
const { supersededBySplit, isSplitPart } = require('../tx-role');
/* Who an account belongs to. The vocabulary lives in its own module because
   three bands on this page ask the same question of it — the hero's split, the
   filter chips and both dialogs — and a household with one person must get the
   same page it had before the key existed. */
const { ownerKey, ownerLabel, ownerOptions, netByOwner } = require('../owners');
/* isRealIsoDate, not ISO_DATE, for the as-at date: ISO_DATE is shape-only and
   accepts "2026-13-45", which would stamp a confirmation on a month that does
   not exist and place a window nothing can fall into. */
const { ISO_DATE, todayIso, isRealIsoDate } = require('../dates');
/* worth.js owns the by-sign asset/liability split and the -0 collapse a
   break-even household's float remainder needs — see worth.js for why a raw
   `net < 0` there once rendered a solvent household as "-R0.00". Called here
   with no debts/assets so it reduces to the accounts-only split this hero
   wants, the same call dashboard.js and savings.js make for the vault-wide
   figure. */
/* cardOverlap alongside worth: the Dashboard and the Savings worth chart both
   disclose a credit card tracked as BOTH an account and a Debt-page row (net
   worth counting it twice) — this page and the Debt page were the two that
   invited the duplicate in the first place and said nothing about it. See
   worth.js's own header for why this is a disclosure, not a dedupe. */
const { worth, cardOverlap } = require('../worth');

/* Shared with views/dashboard.js — see share-percents.js for why a ring's
   percentage column is allocated by largest remainder, never rounded per
   group. Re-exported at the bottom of this file so the donut test keeps
   reading each view's own door. */
const { sharePercents } = require('../share-percents');

module.exports = function registerAccounts(ctx) {
  const { S, $, app, root, plugin, money, toast, writeFile, ensureFolder, relPath, fileAt, ledger, tally, LENSES,
    txInPeriod, accountForLabel, accountIndex, accountsWithFolder, periodMonthName,
    periodRange, currentPeriod } = ctx;

  /* ITEM 2: the SAME wrapper views/savings.js builds for its own totalReturn()
     calls — see savings-math.js's poolCatType() header for why the raw
     ctx.catType must never reach totalReturn() directly here. */
  const poolType = name => poolCatType(S.categories, name);

  /* No ctx.registerDirty and no ctx.dirtyFlag, DELIBERATELY: this page writes
     on every edit (each dialog saves on submit), so there is never an unsaved
     draft for the file watcher to protect. From controller.js an absent
     registration is indistinguishable from a view that forgot — the failure
     mode registerDirty exists for — so the absence is recorded here, in the
     same register budgets.js and transactions.js use for their deviations. */

  /* One account's own figures, in its own symbol. Used for everything that
     describes a SINGLE account — its balance, its limit, its goal, its month.
     Cross-account totals keep plain money(), because they are stated in the
     household currency; where that spans more than one symbol the summary
     says so rather than converting. */
  const acctMoney = (a, v, decimals = 2) =>
    ctx.moneyIn(symbolOf(a, S.settings.currency), v, decimals);

  /* Round to the cent, then collapse -0 — the same two-step worth.js:91 applies
     to its own net figure, for the same reason: summing signed floats leaves a
     remainder like -7.1e-15 behind on an exact break-even group, and read raw
     that renders a group holding nothing net as "−R0,00" in danger red. This
     page sums account balances in three places (the ring's per-group totals,
     the table's group-total rows) that worth.js itself never touches — it only
     ever sees the household-wide figure — so the same rule is repeated here
     rather than imported. */

  /* ITEM 5, now module-level. The rule this page introduced — sum the
     household's own currency, state every other symbol beside it, convert
     nothing — lives in src/currency.js as splitByCurrency(), because leaving
     it here is what let the Savings page, the Dashboard, the Report and the
     Score each keep summing their own way. See that function's own header for
     the three rounds of the same defect that moved it. This is now a binding,
     not a definition: one implementation, applied everywhere. */
  const splitByCurrency = accts => splitAccounts(accts, S.settings.currency);

  /* "€ 640,00 · $ 1 200,00" — zero decimals, since this is always a side note
     beside a headline that already carries its own full precision. Shared by
     both wrappers below so the hero's sentence and the table row's short tag
     can never print the list in a different order or a different rounding. */
  const otherCurrenciesList = others => others.map(([sym, v]) => ctx.moneyIn(sym, v, 0)).join(' · ');

  /* The hero's full sentence — " Plus {list} held in other currencies, not
     converted." Empty string when nothing is foreign, so a caller can always
     concatenate it onto the sub-line without an `if`. */
  const otherCurrenciesLine = others => (others.length
    ? i18n.t('acct.hero.otherCurrencies', { list: otherCurrenciesList(others) }) : '');

  /* The table row's compact tag — "plus {list}" — beside a group total that is
     already narrow on a table that scrolls horizontally on a phone; the full
     sentence above would not fit and would repeat "not converted" once per
     group, which the hero already said once for the whole page. */
  const otherCurrenciesTag = others => (others.length
    ? i18n.t('acct.table.otherCurrencies', { list: otherCurrenciesList(others) }) : '');

  /* Is this account's balance a cell the loader could not read AT ALL — as
     opposed to one merely written in a non-canonical format (a decimal comma,
     grouped thousands) that normalizeAmount reads correctly and load.js still
     preserves in balanceRaw for lossless write-back?

     `a.balanceRaw != null` alone answers the wrong question: it is set on
     "1 234,56" too, and that balance is genuinely 1234.56 — reading it back as
     "unreadable" would un-fix a value this app already gets right. Only when
     normalizeAmount ALSO fails on the raw cell has parseNum's fallback
     (`normalizeAmount(t) ?? 0`) forced a.balance to a fabricated zero — see
     amount.js's own warning that a fallback "must not be a plausible wrong
     number". That is the one case this page must not render as real money. */
  const unreadableBalance = a => a.balanceRaw != null && normalizeAmount(a.balanceRaw) === null;

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

  /* The household's declared people. Read off S per call rather than captured
     at register time: Settings.md is editable in the next tab across, and the
     reload that follows refreshes S without re-running this module. */
  const declaredOwners = () => S.settings.owners || [];

  /* Does this vault have an owner question at all? A Settings.md that names
     nobody is a one-person household, and it gets the page it had before this
     key existed — no field on the form, no chips, no split in the hero. The
     second half is the escape hatch: an account file that already names an
     owner brings the controls back whatever the settings say, because the
     alternative is a value the reader can see in their own file and cannot
     edit anywhere in this app. */
  const ownerInPlay = () => declaredOwners().length > 0 || S.accounts.some(a => a.owner);

  /* The owner control, or nothing at all — spread into a field list, so the
     empty case adds no row. Blank is offered first and deliberately: "not
     said" is a real answer, and a form that forced a name onto a joint bond
     would be inventing one. */
  const ownerField = value => (ownerInPlay()
    ? [{ key: 'owner', label: i18n.t('acct.field.owner'), type: 'select',
      value: value || '',
      desc: i18n.t('acct.field.ownerDesc'),
      options: [
        { value: '', label: i18n.t('acct.owner.none') },
        ...ownerOptions(declaredOwners(), S.accounts)
          .map(v => ({ value: v, label: ownerLabel(v, declaredOwners()) })),
      ] }]
    : []);

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
    savings:     ['emergency_fund', 'goal_amount', 'target_date', 'monthly_contribution', 'starting_amount', 'inception_date'],
    investment:  ['emergency_fund', 'total_invested', 'starting_amount', 'inception_date', 'goal_amount', 'target_date', 'monthly_contribution'],
  };
  const ALL_OPTIONAL = ['emergency_fund', 'credit_limit', 'goal_amount', 'target_date',
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
  /* 0 IS a value here, same rule as FM_WRITERS.starting_amount and
     FM_WRITERS.total_invested above: null, undefined and '' are the only
     "unset" states this app recognises for a number. Under the old `v !== 0`
     test, an account holding a deliberately typed `starting_amount: 0` had
     that field hidden the moment its type left the create form's default set —
     the very value fieldsForType's own header promises stays visible so the
     reader can "clear it deliberately if that is what they meant" could not be
     seen at all, let alone cleared. */
  const hasValue = v => v != null && String(v).trim() !== '';

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
    // Absent means "nobody has said", which is what every account in a
    // single-person vault means — so an unowned account keeps a frontmatter
    // block free of a line asserting it.
    owner: a => (a.owner ? yamlStr(a.owner) : null),
    tx_label: a => (a.tx_label ? yamlStr(a.tx_label) : null),
    credit_limit: a => (a.credit_limit ? a.credit_limit.toFixed(2) : null),
    /* Written RAW, not through yamlStr, for the same reason ignore_warnings is:
       the value is either the bare word `true` or a number, and quoting either
       turns it into a string that the loader's fmBool/fmNum pair both refuse —
       earmarking the account in the dialog would then read back as no earmark
       at all. null removes the key, which is what "not the emergency fund"
       means: the absence of a claim, not a claim of zero. */
    emergency_fund: a => (a.emergency_fund === true ? 'true'
      : typeof a.emergency_fund === 'number' && a.emergency_fund > 0 ? a.emergency_fund.toFixed(2)
        : null),
    goal_amount: a => (a.goal_amount ? a.goal_amount.toFixed(2) : null),
    target_date: a => a.target_date || null,
    monthly_contribution: a => (a.monthly_contribution ? a.monthly_contribution.toFixed(2) : null),
    /* `!= null`, not truthy — same fix, same reasoning as `starting_amount`
       immediately below: savings-math.js:278-286 documents a `total_invested: 0`
       as a real baseline (basis 'stated'), not an absent figure. Under the old
       truthy test, saving an account with an explicitly typed 0 REMOVED the key
       — the next load read no total_invested at all, basis fell back to 'none',
       and the card that had just shown "Growth on R0" offered "Add invested
       amount" again. */
    total_invested: a => (a.total_invested != null ? a.total_invested.toFixed(2) : null),
    /* `!= null`, not truthy, because ZERO IS A REAL BASELINE here and the rest
       of these keys is not the same case. savings-math.js says so outright: an
       account opened empty and funded entirely by transfer has
       `starting_amount: 0`, and that must not fall through to basis 'none'.
       Under the truthy test, null REMOVED the key — so typing 0 into "Starting
       amount", saving and reloading dropped it, the growth block vanished, and
       the card offered "Add starting amount" again. The behaviour the maths
       module documents was unreachable through the app. */
    starting_amount: a => (a.starting_amount != null ? a.starting_amount.toFixed(2) : null),
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
  /* ISSUE 42. Split at TODAY, because the figure this feeds sits next to a
     balance that stopped moving days ago.

     Measured on the `BudgetAudit` household on 2026-09-02. Every account
     showed its last confirmed balance — cheque R20 000 as at 1 September —
     with a green pill beside it reading +R26 410: the whole of September's
     signed net, gym charges dated the 10th, 17th and 24th included, and a
     R5 000 family gift dated the 28th sitting in the emergency fund's +R7 000.
     Read together the two say cheque will be R46 410, which is a claim about
     the end of the month wearing the colours of a change that has happened.
     Rolled only through today the same account is R48 300 — a bigger number
     than either, because the pill was ALSO missing the salary the balance had
     already absorbed. Not one error but two, pointing opposite ways, on one
     row.

     The BALANCE staying at the last confirmed figure is right and is not
     touched here: this page's whole job is to show a claim with its age and
     offer to reconcile it, and the drift is already on screen with a button
     that accepts it. What was wrong is a delta measured over a different
     window from the one anything else on the page uses.

     `ahead` rather than a drop: the rows are real and still coming, and this
     app does not remove a figure without naming it. A finished or future
     period is unclamped — there is no "today" inside it to split on, which is
     the same rule periodSummary() applies for the same reason. */
  /* Phase 3 of ADR-0006: the ACCOUNT lens — every row moves the balance,
     whatever the budget thinks of it; only a split's superseded parent is
     not money. Two tallies, either side of the as-of day, so "so far" and
     "ahead" are the same reading of the same rows. */
  function periodActivity(labels) {
    const { start, end } = periodRange(S.period);
    const now = todayIso();
    const asOf = (S.period === currentPeriod() && now >= start && now < end) ? now : end;
    const mine = ledger(start, end).filter(s => labels.has(s.label));
    const done = tally(mine.filter(s => s.date <= asOf), LENSES.ACCOUNT);
    const ahead = tally(mine.filter(s => s.date > asOf), LENSES.ACCOUNT);
    return {
      inAmt: done.inflow, outAmt: -done.outflow, count: done.count, asOf,
      ahead: { inAmt: ahead.inflow, outAmt: -ahead.outflow, count: ahead.count },
    };
  }
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
    /* The implied figure, worked out BEFORE the dialog opens, so the reader is
       comparing against it while they type rather than after they commit.

       This is the one screen where a real bank balance enters the vault, and
       until now it took the number, stamped today, and compared nothing — then
       reconcile(), finding its whole window behind the fresh stamp, reported
       "clean" and the drawer printed "This figure matches your transactions".
       That sentence was false by construction on every entry that disagreed:
       a statement imported into the wrong account, a missing row, a duplicate,
       all silently absorbed, because the confirmed baseline moved with the
       error. CONTEXT.md defines reconciliation as measuring the stated balance
       against the implied one and SHOWING THE READER THE DISAGREEMENT — so it
       is shown, and the reader may still save whatever they typed. The app
       argues; it does not correct. */
    const before = reconcile(a, (accountIndex().get(a) || {}).rows || [], todayIso());
    const impliedNow = before && before.implied !== undefined ? before.implied : a.balance;
    /* An unreadable balance (see unreadableBalance() above) is a fabricated
       zero load.js's parseNum fallback produced, never a real figure — so it
       must not be offered back as the starting point for this field. Pre-filled
       with `a.balance.toFixed(2)` it read "0.00", and the ONE Enter keystroke a
       reader uses to accept every other field on this dialog silently overwrote
       the raw text the loader had preserved (a.balanceRaw) with that fabricated
       zero. Blank is the honest starting point: the reader types the real
       figure, same as they would for a brand-new account. */
    const balancePrefill = unreadableBalance(a) ? '' : a.balance.toFixed(2);
    const r = await askFields(app, i18n.t('acct.balance.title', { name: a.name }), [
      { key: 'balance', label: i18n.t('acct.balance.field'), type: 'number', value: balancePrefill,
        // Which currency the figure being typed is IN. Nothing converts it, so
        // the symbol is the only thing telling the reader what they are
        // entering — and on a euro account that is the whole question.
        desc: `${i18n.t('acct.balance.inCurrency', { symbol: symbolOf(a, S.settings.currency) })}${
          before && before.state === 'drift'
            ? ` · ${i18n.t('acct.balance.impliedHint', { amount: acctMoney(a, impliedNow), count: before.count })}`
            : ''}` },
      /* Reading Monday's statement on Wednesday is the ORDINARY way a
         household knows its balance, and without this field those two days of
         real transactions fell behind the stamp and became unreachable for
         ever. `balance_updated` is not in FM_WRITERS either, so there was no
         way to correct it from anywhere in the app — only by hand-editing
         frontmatter the app never mentions. */
      { key: 'as_at', label: i18n.t('acct.balance.asAt'), type: 'date', value: todayIso(),
        desc: i18n.t('acct.balance.asAtDesc') },
    ]);
    if (!r) return;
    const num = parseAmount(r.balance);
    /* TODO(i18n): reword acct.err.nan from "Not a number" to "{field} isn't a
       number — try a plain figure like {example}." Both params are passed at
       every call site now (here and in addAccount below) — the old text said
       neither which field was wrong nor what a valid answer looks like, so a
       reader who mistyped "R 1 500" learned only that SOMETHING failed. */
    if (num === null || isNaN(num)) {
      return toast(i18n.t('acct.err.nan', { field: i18n.t('acct.balance.field'), example: '1500.00' }), true);
    }
    const now = todayIso();
    /* A confirmation cannot be dated in the future — reconcile() reads such a
       date as unplaceable, which would silence the account rather than
       confirm it. Blank falls back to today, the old behaviour. */
    const asAt = isRealIsoDate(r.as_at) && r.as_at <= now ? r.as_at : now;
    a.balance = num;
    a.balanceRaw = null;   // the user just gave us a clean figure
    a.balance_updated = asAt;
    // saveAccount already toasted the failure — stop here rather than telling
    // the reader it updated when the file never changed.
    if (!(await saveAccount(a))) return;
    /* ctx.render, not renderAccounts: this dialog is opened from the Savings &
       Investments page too, and renderAccounts() would rebuild the page the
       reader is NOT looking at — leaving the figure they just typed absent from
       the one they are. render() draws whichever view is current. */
    ctx.render();
    /* Say the disagreement OUT LOUD at the moment it is created. Re-read after
       the write rather than reusing `before`, because the figure and the date
       the reader just supplied are both inputs to it — this is the reconcile
       the old code never performed. A clean result still gets the plain
       confirmation, so the extra sentence only ever appears when there is
       genuinely something to argue about. */
    const after = reconcile(a, (accountIndex().get(a) || {}).rows || [], todayIso());
    if (after && after.state === 'drift') {
      toast(i18n.t('acct.balance.updatedDrift', {
        name: a.name,
        amount: acctMoney(a, Math.abs(after.delta)),
        count: after.count,
      }), true);
      return;
    }
    toast(i18n.t('acct.balance.updated', { name: a.name }));
  }

  /* Accept the implied figure. Stamping today is what stops the rows just
     absorbed from being counted a second time: reconcile() only ever folds in
     rows dated on or before today, so the next window starts clear of them.

     Published on ctx (see the bottom of this file) rather than kept private:
     Savings & Investments offers the identical "Use this" reconciliation
     button off its own accounts, and used to carry a hand-copied twin of this
     function that had drifted out of step with the guard below. One
     implementation now backs both pages' buttons.

     ctx.render, not renderAccounts — same reasoning as editBalance above:
     this is reachable from the Savings page too, and renderAccounts() would
     rebuild the page the reader is NOT looking at. */
  async function acceptImplied(a, implied, rec) {
    const priorBalance = a.balance, priorBalanceRaw = a.balanceRaw, priorUpdated = a.balance_updated;
    a.balance = implied;
    a.balanceRaw = null;
    /* Stamped to the LAST ROW THIS FIGURE ABSORBED, not to the clock. Dates
       carry no time, and reconcile() skips everything dated on or before the
       stamp — so stamping today buried every row dated between the last
       transaction and now. Accept a drift on the 24th whose newest row was the
       20th, and the four days in between became unreachable for ever: a
       statement imported later carrying rows dated the 21st through 24th was
       silently never folded in, the pill stayed green, and the account
       under-reported permanently.

       Narrowing the stamp to the data closes all of that except rows sharing
       the boundary date itself, which day-granularity dates cannot distinguish
       from the ones already counted. Capped at today so a future-dated row
       cannot stamp a confirmation the vault has not reached — reconcile() now
       reads such a date as unplaceable anyway. */
    const lastCounted = rec && rec.since && rec.since.length
      ? rec.since.reduce((m, r) => (r.date > m ? r.date : m), '')
      : null;
    const now = todayIso();
    a.balance_updated = (lastCounted && lastCounted <= now) ? lastCounted : now;
    if (!(await saveAccount(a))) {
      // Back the mutation out. Without this, a failed write left the model
      // stamped with the implied balance and today's date even though the
      // file on disk still held the old figure — invisible until the next
      // render of this account, at which point it read "updated today" over
      // a save that never landed.
      a.balance = priorBalance;
      a.balanceRaw = priorBalanceRaw;
      a.balance_updated = priorUpdated;
      return;
    }
    ctx.render();
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
      /* Three states, and the third only when it already applies.

         `emergency_fund: 50000` — earmarking PART of an account — is a
         hand-edited power case with no dialog affordance of its own, so a
         two-option yes/no control would read a partial earmark as "no" and
         wipe it on the first unrelated save of the account. Offering the
         current figure back as its own option means the form can only ever
         preserve or deliberately change it. The whole-account case is the
         common one and stays a plain choice. */
      emergency_fund: { key: 'emergency_fund', label: i18n.t('acct.field.emergency'), type: 'select',
        value: a.emergency_fund === true ? 'all' : typeof a.emergency_fund === 'number' ? 'part' : 'no',
        options: [
          { value: 'no', label: i18n.t('acct.emergency.no') },
          { value: 'all', label: i18n.t('acct.emergency.all') },
          ...(typeof a.emergency_fund === 'number'
            ? [{ value: 'part', label: i18n.t('acct.emergency.part', { amount: acctMoney(a, a.emergency_fund, 0) }) }]
            : []),
        ],
        desc: i18n.t('acct.field.emergencyDesc') },
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
      // Every neighbouring optional field on this dialog (invested, currency,
      // limit) already carries a `desc` explaining what it feeds — this is
      // the one field that is the WHOLE basis for savings-math.js's
      // totalReturn() and had none, which is why an account with a balance
      // but no starting_amount silently shows "—" for Growth on the Savings
      // page with no clue why. i18n wave: acct.field.startingDesc added to
      // lang/en.js and all six sibling tables.
      starting_amount: { key: 'starting_amount', label: i18n.t('acct.field.starting'), type: 'number',
        value: a.starting_amount != null ? String(a.starting_amount) : '',
        desc: i18n.t('acct.field.startingDesc') },
      inception_date: { key: 'inception_date', label: i18n.t('acct.field.opened'), type: 'date', value: a.inception_date },
    };
    const shown = fieldsForType(a.type, a);

    const r = await askFields(app, i18n.t('acct.edit.title', { name: a.name }), [
      { key: 'type', label: i18n.t('acct.field.type'), type: 'select', options: acctTypeOptions(), value: a.type },
      { key: 'institution', label: i18n.t('acct.field.institution'), type: 'text', value: a.institution },
      ...ownerField(a.owner),
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

    /* TODO(i18n): reword acct.err.type from "Invalid type" to "{field} isn't
       valid — pick one from the list, e.g. {example}." — the type control is
       a closed <select>, so this fires only when something OTHER than a
       reader's own click supplied the value; naming the field and showing a
       real option still beats a bare "Invalid type" for whoever hits it. */
    if (!ACCT_TYPES.includes(r.type)) {
      return toast(i18n.t('acct.err.type', { field: i18n.t('acct.field.type'), example: i18n.t('acctType.savings') }), true);
    }
    /* Only the fields this dialog actually SHOWED are read back. A field the
       type hid was never on screen, so treating its absent result as "the user
       cleared it" would write a decision nobody made — and saveAccount patches
       every EDITABLE_KEY from the model, so the untouched ones round-trip
       unchanged on their own. */
    const nums = {};
    for (const k of shown) {
      // The two dates and the earmark are not amounts — the earmark's control
      // is a select whose values are words, and parseAmount('all') is NaN,
      // which would reject the whole save as "not a number".
      if (k === 'target_date' || k === 'inception_date' || k === 'emergency_fund') continue;
      const n = parseAmount(r[k]);
      if (n !== null && isNaN(n)) return toast(i18n.t('acct.err.notNumber', { field: k.replace(/_/g, ' ') }), true);
      nums[k] = n;
    }
    // Validate everything BEFORE assigning any of it: a half-applied edit would
    // be written to disk by the save below with no way to tell what changed.
    a.type = r.type;
    a.institution = (r.institution || '').trim();
    /* Only when the control was actually on screen. Same rule the optional
       figures follow above: a one-person vault never renders this field, so
       reading its absent result as "the user cleared it" would strip the owner
       off every account the moment someone emptied the settings line. */
    if (ownerInPlay()) a.owner = (r.owner || '').trim();
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
    /* Same only-when-shown rule as the dates: a cheque account never renders
       this control, and reading its absent result as "no" would quietly clear
       the earmark off a savings account the moment its type was changed. The
       `part` branch keeps the number already on the model rather than
       re-deriving it from a control that only ever showed its label. */
    if (shown.includes('emergency_fund')) {
      a.emergency_fund = r.emergency_fund === 'all' ? true
        : r.emergency_fund === 'part' ? a.emergency_fund
          : null;
    }

    if (!(await saveAccount(a, EDITABLE_KEYS))) return;
    // ctx.render, not renderAccounts: a type change moves the account between
    // groups here AND changes whether Savings & Investments shows it at all.
    ctx.render();
    toast(i18n.t('acct.toast.updated', { name: a.name }));
  }

  async function toggleBudget(a) {
    a.in_budget = !a.in_budget;
    if (!(await saveAccount(a))) return;
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
    /* null is "every owner", '' is "the ones nobody has claimed" — two states
       that a single falsy value cannot tell apart, and conflating them would
       make the Unassigned chip the same control as the All chip. */
    if (v.owner === undefined) v.owner = null;
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
    /* Separate from idx on purpose: idx only knows accounts that have a month
       file, so an account with an empty folder is absent from it and would be
       told to link the folder it already has. */
    const folders = accountsWithFolder();
    return S.accounts.map(a => {
      const entry = idx.get(a);
      const rows = entry ? entry.rows : [];
      const labels = entry ? entry.labels : new Set();
      const st = statusOf(a, rows, null, folders.has(a));
      const act = periodActivity(labels);
      /* Computed once here rather than separately in the goal cell and the
         drawer, same reasoning as reconcile() above it — two call sites
         deriving "what this account earned" independently is exactly how the
         retired `balance - total_invested` formula and views/savings.js's
         totalReturn() came to disagree by R60 000 on the same account. */
      const tr = totalReturn(a, rows, poolType, { today: todayIso() });
      return Object.assign({ a, rows, labels, act, flow: act.inAmt - act.outAmt, group: groupOf(a), tr }, st);
    });
  }

  /* ------------------------------- band 1 --------------------------------
     One figure, and the ring that says what it is made of. */

  function renderSummary(rows) {
    const wrap = $('#acctSummary');
    if (!wrap) return;
    wrap.empty();

    /* A brand-new vault gets NOTHING here, not a zero hero over an empty
       framed ring — renderDeck (just below) already bails the same way for
       the same reason. The table's own empty state (`acct.empty`) is where
       "you have no accounts yet" is actually said; a hero reading "Net across
       your accounts R 0,00" beside a bordered ring with nothing in it repeats
       that fact twice, badly, before the reader reaches the sentence that
       explains it. */
    if (!S.accounts.length) return;

    /* By the SIGN of the balance rather than by account type: a credit card in
       credit is not a liability, and an overdrawn cheque account is one. No
       debts/assets pages passed in — this hero is the accounts-only figure,
       and the `elsewhere` caveat below is what tells the reader when those
       pages hold more.

       An account whose balance cell could not be read at all is left OUT of
       this sum rather than folded in as the fabricated zero load.js falls
       back to — see unreadableBalance() above. It still appears in the table,
       flagged, so the reader can fix it; it just does not silently count as
       R0,00 toward what the household is worth. */
    /* ISSUE 60. Account files the loader ignored because they sit in a
       sub-folder, named on the page that owns accounts. Their money is in no
       figure here — while their transactions, which are read by label, DO
       reach the period totals. That split is exactly why silence was the wrong
       answer: the vault looks internally inconsistent and nothing explains it. */
    const ignored = S.accountsIgnored || [];
    if (ignored.length) {
      const el0 = $('#acctSummary');
      if (el0) {
        el0.append(el('div', { class: 'kpi-caveat-txt' },
          i18n.t('acct.ignoredFiles', {
            count: ignored.length,
            names: ignored.map(p2 => p2.split('/').pop().replace(/\.md$/, '')).join(' · '),
          })));
      }
    }
    /* ISSUE 72. Two accounts, one transaction folder — see load.js. */
    const dup = S.accountsDuplicated || [];
    if (dup.length) {
      const el0 = $('#acctSummary');
      if (el0) {
        el0.append(el('div', { class: 'kpi-caveat-txt' },
          i18n.t('acct.duplicateFolders', {
            count: dup.length,
            names: dup.map(d => `${d.label}: ${d.first} · ${d.second}`).join(' — '),
          })));
      }
    }
    const unreadable = S.accounts.filter(unreadableBalance);
    /* ITEM 5: the headline used to ADD every readable balance and disclose
       that the result mixed currencies. It now sums only the accounts stated
       in the household's own currency — the only ones this figure can add
       without pretending a euro is a rand — and each foreign currency present
       becomes its own side figure below, in its own symbol, never converted
       or folded in. Split BEFORE worth(): worth.js's own arithmetic is shared
       with the Dashboard, Savings and the health score, so this view feeds it
       a narrower account list rather than teaching it a new rule those pages
       never asked for. */
    const { primary, others } = splitByCurrency(S.accounts.filter(a => !unreadableBalance(a)));

    /* ISSUE 30 — the opt-in conversion, finally reaching a screen.

       `conv` is null unless the reader turned exchange rates on AND the app
       has a usable table, which is the overwhelmingly common case; the
       un-converted split above is what renders then, exactly as it has since
       1.29.1. So the no-conversion path is the NORMAL path and stays
       exercised, rather than becoming a fallback nobody looks at.

       When it is on, the headline becomes one number the reader can actually
       act on — and it never appears without saying what it is made of and WHEN
       its rates are from. src/currency.js's objection to conversion was never
       the arithmetic, it was a figure that has forgotten when it was true, so
       the date travels with the number and a rate over a week old says so.

       An account the rate table cannot convert is still named, not folded in
       at par and not dropped: that is `unconvertible`, and it prints as the
       same "held in other currencies" sentence the un-converted view uses. */
    const conv = ctx.fxConvert ? ctx.fxConvert(S.accounts.filter(a => !unreadableBalance(a))) : null;
    const convLine = conv ? (() => {
      const parts = conv.converted.map(c =>
        `${ctx.moneyIn(symbolOf({ currency_code: c.code }, S.settings.currency), c.amount, 0)}`);
      const bits = [];
      if (conv.converted.length) {
        bits.push(i18n.t(conv.stale ? 'acct.hero.convertedStale' : 'acct.hero.converted', {
          list: conv.converted.map((c, i) => `${c.code} ${parts[i].replace(/^\S+\s/, '')}`).join(' · '),
          date: conv.date,
          days: conv.age === null ? '?' : String(conv.age),
        }));
      }
      /* Accounts the table could not convert keep the honest sentence — they
         are not in the figure above and must not look as though they are. */
      if (conv.unconvertible.length) {
        const stuck = splitByCurrency(conv.unconvertible.map(u => u.account));
        bits.push(otherCurrenciesLine(stuck.others));
      }
      return bits.join('');
    })() : '';
    const w = worth(primary, null, null);
    const assets = w.ownedAccounts, liabilities = w.fromAccounts, net = w.net;
    const attention = rows.filter(wantsALook).length;
    const oldest = rows.reduce((m, r) => (r.days !== null && r.days > m ? r.days : m), -1);

    /* Only qualify the figure when there IS something elsewhere for it to
       disagree with. On a vault with no assets and no debts the pages report
       the same number, and a caveat about a difference that does not exist is
       just noise. */
    const elsewhere = (S.assets || []).some(x => x.value > 0)
      || (S.debts || []).some(d => d.status !== 'paid' && d.balance > 0);

    const hero = el('div', { class: 'card hero acct-hero' },
      el('div', { class: 'hero-lbl' }, i18n.t('acct.hero.label')),
      /* ISSUE 31. THE HEADLINE IS THE SPLIT, always — home currency summed,
         every other symbol named beside it. The converted figure moves to a
         line of its own below.

         It was the headline until now, and that made this page the only
         surface in the app running a different rule from every other. Measured
         on 2026-09-02 with rates on: a R20 000 cheque account and a US$1 000
         broker account gave a hero of 37 985.61, its OWN subtitle "R20 000
         credit" (worth() is home-currency only), the Dashboard's net-worth
         tile R20 000, and the Savings page R0 invested. One card disagreeing
         with itself, and the page disagreeing with two others in the same
         session — which is the exact ISSUE 28 symptom the Dashboard's comment
         says was closed, true only while rates were off.

         The arithmetic was never wrong; the rule was inconsistent. currency.js
         has one ("sum home currency and name the rest") and ADR-0004 records
         it, so the fix is the headline joining it rather than four other
         surfaces leaving it — a conversion is a DERIVED view of a total, and a
         derived view does not get to be the number a reader acts on while its
         own subtitle describes a different one.

         Nothing is lost: `convLine` below still lists what each foreign
         holding converts to and when its rates are from, and the converted
         total now says out loud that that is what it is. */
      el('div', { class: `hero-num${net < 0 ? ' hero-num--negative' : ''}` }, money(net)),
      conv
        ? el('div', { class: 'acct-hero-converted' },
          i18n.t('acct.hero.convertedTotal', { amount: money(conv.total) }))
        : '',
      el('div', { class: 'hero-sub' },
        i18n.t('acct.hero.sub', { assets: money(assets), liabilities: money(liabilities) })
        + (elsewhere ? i18n.t('acct.hero.elsewhere') : '')
        + (conv ? convLine : otherCurrenciesLine(others))
        // TODO(i18n): acct.hero.unreadable — "{count} account balance could
        // not be read and is left out of this total." (plural: "balances").
        + (unreadable.length ? i18n.t('acct.hero.unreadable', { count: unreadable.length }) : '')));

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

    const split = whoseItIs();
    const overlap = overlapNote();
    wrap.append(hero, ...(split ? [split] : []), whereItSits(), ...(overlap ? [overlap] : []));
  }

  /* Same disclosure the Dashboard and the Savings worth chart already carry —
     see worth.js's cardOverlap() header. Accounts and Debt are the two pages
     that actually invite a reader to add the same Visa twice (one as an
     account, one as a debt row), and until now they were the only two pages
     that said nothing about it: the net figure at the top of this very page
     is exactly the one that double-counts. Reuses dash.overlap's wording
     rather than a page-local copy, so the sentence cannot drift between the
     three places it now appears. */
  function overlapNote() {
    const o = cardOverlap(S.accounts, S.debts);
    if (!o) return null;
    const note = el('div', { class: 'kpi-caveat' },
      el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
        i18n.t('dash.overlap', { accounts: o.cardAccounts, debts: o.cardDebts })));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': i18n.t('dash.overlap.aria') }, i18n.t('dash.overlap.btn'));
    btn.addEventListener('click', () => ctx.switchView('debts'));
    note.append(btn);
    return note;
  }

  /* Whose it is — the same net figure as the hero, cut by owner.

     A READING of the total, never a replacement for it: every row here is
     already inside the number above, and the bars are drawn against the largest
     POSITIVE side rather than against the net, so an owner carrying more card
     debt than cash still gets a row that says so instead of an empty track.

     Absent entirely in a one-person vault — see ownerInPlay(). A card headed
     "Whose it is" with one row under it answers a question nobody asked. */
  function whoseItIs() {
    if (!ownerInPlay()) return null;
    /* ISSUE 28: sourced the same way the hero and the table's group subtotals
       already are — netByOwner() decides WHICH rows exist and in what order
       (so an owner holding nothing but yuan still gets a row), and each row's
       FIGURE is then re-derived from that owner's household-currency accounts
       alone, with every other symbol restated beside it. The row used to add
       every balance and hang an asterisk on the result; an asterisk does not
       make R5 000 + ¥3 956 = 8 956 true. */
    const rows = netByOwner(S.accounts, declaredOwners()).map(r => {
      const { primary, others } = splitByCurrency(
        S.accounts.filter(a => ownerKey(a.owner) === r.key));
      return { ...r, net: primaryTotal(primary, S.settings.currency), others };
    });
    if (rows.length < 2) return null;

    const card = el('div', { class: 'card acct-owners' });
    card.append(el('div', { class: 'card-h' },
      el('div', {},
        el('h2', {}, i18n.t('acct.owner.title')),
        el('div', { class: 'sub' }, i18n.t('acct.owner.sub')))));

    const body = el('div', { class: 'body-pad' });
    const widest = rows.reduce((m, r) => Math.max(m, Math.abs(r.net)), 0) || 1;
    for (const r of rows) {
      const pct = (Math.abs(r.net) / widest) * 100;
      /* The same compact tag the table's group rows carry — "plus ¥ 3 956" —
         rather than the asterisk that used to stand in for it. The tag names
         what is NOT in the figure; the asterisk only warned that the figure
         was wrong. */
      const tag = otherCurrenciesTag(r.others);
      const line = el('button', { type: 'button',
        class: `acct-owner-row${view().owner === r.key ? ' is-on' : ''}`,
        'aria-pressed': String(view().owner === r.key),
        'aria-label': i18n.t('acct.owner.aria', { owner: r.label, amount: money(r.net) + (tag ? ` ${tag}` : '') }) },
      el('div', { class: 'acct-owner-top' },
        el('span', { class: 'acct-owner-name' }, r.label),
        el('span', { class: `acct-owner-net num${r.net < 0 ? ' text-danger' : ''}` }, money(r.net),
          ...(tag ? [el('span', { class: 'acct-group-other' }, ` ${tag}`)] : []))),
      el('span', { class: 'acct-mbar' },
        el('i', { class: r.net < 0 ? 'bg-danger' : '', style: `width:${pct.toFixed(1)}%` })),
      el('div', { class: 'acct-owner-sub' }, i18n.t('acct.group.count', { count: r.count })));
      /* Clicking a row filters the ledger to that owner — the figure and the
         accounts behind it are one click apart, rather than the figure being
         here and the way to check it being a chip further down the page. */
      line.addEventListener('click', () => setOwnerFilter(view().owner === r.key ? null : r.key));
      body.append(line);
    }
    card.append(body);
    return card;
  }

  /* The ring. Positive group totals only — a donut cannot draw a negative
     wedge, and a group whose card debt exceeds its cash is a bar-chart problem.
     Rather than drop it silently (which would leave the ring and the hero
     quietly disagreeing), such a group is NAMED under the legend. */
  function whereItSits() {
    const groups = ACCT_GROUPS.map(([key]) => {
      const accts = S.accounts.filter(a => groupOf(a) === key);
      /* ISSUE 28: this used to be roundedSum(accts) — every balance added
         regardless of its own `currency:`, with an asterisk hung on the
         result. The ring was the last figure on the page still doing it, so
         the centre of the donut and the hero two lines above it printed two
         different numbers for the same household. Sourced now exactly as the
         hero is: the household's own currency summed, every other symbol
         stated beside it in its own symbol, nothing converted. */
      const { primary, others } = splitByCurrency(accts);
      return {
        key,
        colour: GROUP_COLOUR[key] || 'var(--color-accent)',
        total: primaryTotal(primary, S.settings.currency),
        others,
      };
      /* A group holding ONLY foreign money nets zero in the household's
         currency but is not empty, so it is kept — it cannot be drawn as a
         wedge, and appears in the legend at 0% with its own symbols beside
         it, the same shape the table's group row already takes. Dropping it
         would be the silent exclusion currency.js forbids. */
    }).filter(g => g.total !== 0 || g.others.length);

    const drawn = groups.filter(g => g.total > 0).sort((x, y) => y.total - x.total);
    const negative = groups.filter(g => g.total < 0);
    const foreignOnly = groups.filter(g => g.total === 0 && g.others.length);
    const sum = drawn.reduce((s, g) => s + g.total, 0);
    // The true net — what the hero states — for comparison against `sum`
    // below, which is only the positive half of it.
    const excluded = -negative.reduce((s, g) => s + g.total, 0);

    /* Whole-card disclosure, and now the same SENTENCE the hero carries —
       "Plus ¥ 3 956 held in other currencies, not converted." — rather than
       the retired "adds accounts held in more than one currency" line, which
       described arithmetic this card no longer does. */
    const { others: cardOthers } = splitByCurrency(S.accounts);
    const cardOtherLine = otherCurrenciesLine(cardOthers);

    const card = el('div', { class: 'card acct-ring' });
    card.append(el('div', { class: 'card-h' },
      el('div', {},
        el('h2', {}, i18n.t('acct.where.title')),
        el('div', { class: 'sub' },
          i18n.t('acct.where.sub') + cardOtherLine))));

    const body = el('div', { class: 'body-pad acct-ring-body' });
    if (!sum) {
      /* The negative note used to sit BEHIND this early return — a vault
         where every group nets negative got a titled card with an empty body
         and no explanation, because `sum` is Σ of positive totals only and a
         household that owes more than it holds has none. Said now, either
         way, so the card never renders blank. */
      /* Foreign-only vault: nothing to draw, but there IS money — saying
         "nothing to show yet" here would be flatly untrue. */
      if (foreignOnly.length) {
        body.append(el('div', { class: 'acct-ring-note' }, cardOtherLine.trim()));
      } else if (negative.length) {
        /* States the AMOUNT as well as the names, the way the partial-negative
           path further down already does. Naming which groups were left out
           while withholding how much they came to is half a disclosure: on a
           vault whose hero reads -R7 000 this said only "1 group is net
           negative — Bank accounts", and the reader had no way to tie that
           sentence to the figure above it. */
        const excludedAll = negative.reduce((s, g) => s + Math.abs(g.total), 0);
        body.append(el('div', { class: 'acct-ring-note' },
          i18n.t('acct.where.negative', {
            count: negative.length,
            names: negative.map(g => i18n.t(g.key)).join(', '),
          }),
          ' ', i18n.t('acct.where.excluded', { amount: money(excludedAll) })));
      } else {
        body.append(el('div', { class: 'acct-ring-note' }, i18n.t('acct.where.empty')));
      }
      card.append(body);
      return card;
    }

    /* Computed ONCE and indexed everywhere below — the aria-label, each
       wedge's tooltip and the legend's % column all read the same array, so
       the three can never disagree with each other the way three independent
       Math.round() calls on the same group occasionally did. */
    const shares = sharePercents(drawn.map(g => g.total));
    const W = 320, H = 320, cx = W / 2, cy = H / 2, rOut = 140, rIn = 92;
    const { svg, add } = createChart({
      w: W, h: H, cls: 'donut acct-donut',
      label: i18n.t('acct.where.aria', {
        parts: drawn.map((g, i) => i18n.t('acct.where.part',
          { group: i18n.t(g.key), pct: shares[i] })).join(', '),
      }) + cardOtherLine,
    });

    let a0 = -Math.PI / 2;                  // 12 o'clock, so the largest slice starts at the top
    drawn.forEach((g, i) => {
      const sweep = (g.total / sum) * Math.PI * 2;
      const seg = add('path', {
        d: arcPath(cx, cy, rOut, rIn, a0, a0 + sweep),
        fill: g.colour, stroke: themeColors(root).hole, 'stroke-width': '2',
      });
      tip(add, seg, `${i18n.t(g.key)}: ${money(g.total)} · ${shares[i]}%`
        + (g.others.length ? ` ${otherCurrenciesTag(g.others)}` : ''));
      a0 += sweep;
    });
    add('text', {
      x: cx, y: cy + 10, 'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700',
      fill: 'currentColor', 'font-family': 'inherit',
    }).textContent = money(sum, 0);

    const legend = el('ul', { class: 'donut-legend acct-ring-legend' });
    /* Drawn wedges first, then any group that holds only foreign money — it
       has no wedge and no share of the ring, but it is listed rather than
       dropped, so the legend still accounts for every account on the page. */
    [...drawn.map((g, i) => [g, shares[i]]), ...foreignOnly.map(g => [g, '0'])]
      .forEach(([g, pct]) => {
        const tag = otherCurrenciesTag(g.others);
        legend.append(el('li', {},
          el('i', { style: `background:${g.colour}` }),
          el('span', { class: 'dl-name' }, i18n.t(g.key)),
          el('span', { class: 'dl-val num' }, money(g.total, 0),
            ...(tag ? [el('span', { class: 'acct-group-other' }, ` ${tag}`)] : [])),
          el('span', { class: 'dl-pct' }, `${pct}%`)));
      });
    body.append(svg, legend);
    if (negative.length) {
      /* Named rather than just counted: the centre figure above is the sum of
         the POSITIVE groups only, and on its own reads as the household total
         — which it is not whenever this note fires. The hero, two lines up on
         the same page, states the real net; this says by how much the two
         figures differ and why. */
      body.append(el('div', { class: 'acct-ring-note' },
        i18n.t('acct.where.negative', {
          count: negative.length,
          names: negative.map(g => i18n.t(g.key)).join(', '),
        }),
        // TODO(i18n): acct.where.excluded — "{amount} excluded from the total above."
        ' ', i18n.t('acct.where.excluded', { amount: money(excluded) })));
    }
    card.append(body);
    return card;
  }

  /* ------------------------------- band 2 --------------------------------
     The queue. This is the band the redesign exists for: the page has always
     KNOWN which accounts could not be trusted — it reported the number in a
     tile and then left the reader to find them. */

  function deckWhy(r) {
    if (r.state === 'drift') {
      // acctMoney, not money: both figures are THIS account's own, in its own
      // symbol — see acctMoney's header.
      return i18n.t('acct.deck.why.drift',
        { count: r.rec.count, implied: acctMoney(r.a, r.rec.implied), stated: acctMoney(r.a, r.a.balance) });
    }
    if (r.state === 'stale') {
      return i18n.t('acct.deck.why.stale', { count: r.days, date: r.a.balance_updated });
    }
    /* Its own branch rather than the generic fallthrough below, because this is
       the only `why` line besides drift and stale that states a NUMBER — the
       count of rows nothing can date, which travels on the reconciliation
       (rec.unreadable) rather than being recoverable from the state name.

       The sentence shipped inline in English for one wave, while `unreadable`
       was a new state (see src/acct-status.js) and no lang table carried a key
       for it: this file is in tests/i18n.test.cjs's TRANSLATED_VIEWS, so a key
       added to only one table fails that suite, and a key called before it
       exists renders its own dotted name on screen in EVERY language — which
       is tests/i18n-render.test.cjs's first and highest-value assertion. All
       twelve tables now carry `acct.deck.why.unreadable`, so the words live
       where the other eleven languages can reach them.

       Whole sentence per plural form, not a fragment assembled around the
       number: the singular says "against it" and the plural "against them",
       which is the distinction the old inline `carries a date`/`carry dates`
       concatenation could not make on the tail of the sentence. */
    if (r.state === 'unreadable') {
      return i18n.t('acct.deck.why.unreadable', { count: r.rec.unreadable });
    }
    return i18n.t(`acct.deck.why.${r.state}`);
  }

  /* The ONE action a reader would take without looking. Everything else is
     "Review", which opens this account's drawer in the table below — so there
     is one place to act in a hurry and one place to act in depth, rather than
     two competing copies of the same controls. */
  function deckAction(r) {
    if (r.state === 'drift') {
      return { label: i18n.t('acct.deck.do.drift', { amount: acctMoney(r.a, r.rec.implied) }),
        run: () => acceptImplied(r.a, r.rec.implied, r.rec) };
    }
    if (r.state === 'stale' || r.state === 'nodate') {
      return { label: i18n.t(r.state === 'stale' ? 'acct.deck.do.stale' : 'acct.deck.do.nodate'),
        run: () => editBalance(r.a) };
    }
    /* A linked-but-empty folder needs a statement, not a second folder — so it
       goes to Import, where the reader picks a file. The account cannot be
       preselected on the way in: Import's account <select> is only built once a
       statement has been parsed, so there is nothing to select yet. */
    if (r.state === 'notx') {
      return { label: i18n.t('acct.deck.do.notx'), run: () => ctx.switchView('import') };
    }
    /* The fix for an unreadable date is in the transaction file, not in any
       dialog this page owns — so the action is to go and look at the rows.
       Reuses `acct.btn.seeTx`, an existing translated key that says exactly
       the right thing, rather than minting an `acct.deck.do.unreadable` that
       would read identically — a second key for the same words is a second
       thing to keep in step across twelve tables, for no gain a reader of any
       of them can see. */
    if (r.state === 'unreadable') {
      const primary = [...(r.labels || [])][0];
      return { label: i18n.t('acct.btn.seeTx'),
        run: () => (primary ? openTransactions(primary) : ctx.switchView('transactions')) };
    }
    return { label: i18n.t('acct.deck.do.nofolder'), run: () => editAccount(r.a) };
  }

  /* Redesign variant B (see budget-redesign.html, screen 8, variant B): the
     four-card deck collapsed to one line. The per-account "why" sentence and
     the one-tap action (deckWhy / deckAction above) are NOT retired — they
     move onto the row itself (see accountRow's `acct-row-acts`, and
     reasonGroups() below for the once-per-reason header that replaces the
     old once-per-account repetition of the same sentence). This function's
     only job now is to say how many accounts want a look and offer the one
     door into them; the table (already filterable to "Needs a look") is
     where the reader actually acts. */
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
      wrap.className = 'acct-deck is-clear acct-deck--banner mb-4';
      wrap.append(
        el('div', { class: 'acct-deck-h' },
          el('span', { class: 'acct-deck-dot' }),
          el('h2', {}, i18n.t('acct.deck.clear'))),
        el('div', { class: 'acct-deck-sub' }, i18n.t('acct.deck.clearSub')));
      return;
    }

    wrap.className = 'acct-deck acct-deck--banner mb-4';
    const line = el('div', { class: 'acct-deck-banner' },
      el('span', { class: 'acct-deck-dot' }),
      el('span', { class: 'acct-deck-banner-txt' }, i18n.t('acct.deck.title', { count: flagged.length })));
    const showBtn = el('button', { type: 'button', class: 'acct-deck-btn' }, i18n.t('acct.deck.show'));
    showBtn.addEventListener('click', () => {
      view().filter = 'flag';
      view().open = null;
      renderAccounts();
    });
    wrap.append(line, showBtn);
  }

  /* Distinct reasons in the flagged set, most urgent first, each carrying the
     accounts that share it. This is what lets the table print "nothing
     imports into these" ONCE above five accounts instead of once per account
     — reasonHeader() below states the reason in general terms; the
     account-specific numbers (a stale count, an implied balance) stay on the
     row via deckWhy(), same as they did inside the old deck cards. */
  function reasonGroups(flagged) {
    const byState = new Map();
    for (const r of flagged) {
      if (!byState.has(r.state)) byState.set(r.state, []);
      byState.get(r.state).push(r);
    }
    return [...byState.keys()]
      .sort((x, y) => URGENCY[x] - URGENCY[y])
      .map(state => ({ state, rows: byState.get(state) }));
  }

  /* The reason stated once, with no account name in it — the sentence a
     reader sees above a whole group, not the per-account one deckWhy()
     prints on the row underneath it. */
  function reasonHeader(state) { return i18n.t(`acct.deck.groupReason.${state}`); }

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

  /* The owner filter, applied on its own axis. Kept separate from FILTERS()
     rather than folded in as more chips: kind and owner are two different
     questions, and one `v.filter` can only hold one answer — merging them would
     mean picking "Sam" silently dropped the reader out of "Savings". */
  const ownerMatch = r => view().owner === null || ownerKey(r.a.owner) === view().owner;

  function visibleRows(rows) {
    const v = view();
    const f = FILTERS().find(x => x.key === v.filter) || FILTERS()[0];
    const q = (v.q || '').trim().toLowerCase();
    return rows
      .filter(r => f.test(r))
      .filter(ownerMatch)
      /* Owner joins the searchable text: typing a name into the box is the
         first thing a reader tries, and it landing on "0 rows" while a chip
         with that exact name sits above it reads as a broken search. */
      .filter(r => !q || `${r.a.name} ${r.a.institution || ''} ${r.a.type} ${ownerLabel(r.a.owner, declaredOwners())}`.toLowerCase().includes(q))
      .sort((x, y) => (SORTERS[v.sort] || SORTERS.balance)(x, y) * v.dir);
  }

  function setOwnerFilter(key) {
    const v = view();
    v.owner = key;
    v.open = null;                        // a drawer left open under a filtered-out row
    renderAccounts();
  }

  /* The owner chips, on their own row under the kind chips. Rendered only when
     the vault has an owner question — and only when more than one answer is in
     use, because a single chip beside "Everyone" cannot change what is on
     screen. The band is emptied rather than left standing in that case, so a
     vault that had two owners and now has one loses the control cleanly. */
  function renderOwnerFilters(rows) {
    const wrap = $('#acctOwners');
    if (!wrap) return;
    wrap.empty();
    const v = view();
    const buckets = netByOwner(S.accounts, declaredOwners());
    if (!ownerInPlay() || buckets.length < 2) {
      wrap.className = '';
      // A filter left set on an owner this vault no longer distinguishes would
      // hide accounts with no visible control explaining why.
      if (v.owner !== null) { v.owner = null; }
      return;
    }
    /* acct-rail: variant B's scrolling chip rail (see budget-redesign.html
       screen 8) — overflow-x rather than flex-wrap, so a long owner list
       scrolls sideways instead of wrapping a row that clips at the panel's
       left edge. Presentation only: same chips, same click handler, same
       counts. */
    wrap.className = 'acct-segs acct-segs--owner acct-rail';

    const chip = (key, label, n) => {
      const b = el('button', { type: 'button', class: 'acct-seg',
        'aria-pressed': String(v.owner === key) },
      label, el('span', { class: 'acct-seg-n' }, String(n)));
      b.addEventListener('click', () => setOwnerFilter(key));
      wrap.append(b);
    };
    chip(null, i18n.t('acct.owner.all'), rows.length);
    for (const b of buckets) chip(b.key, b.label, b.count);
  }

  function renderFilters(rows) {
    const wrap = $('#acctFilters');
    if (!wrap) return;
    wrap.empty();
    // See renderOwnerFilters' own note on acct-rail — same scrolling-rail
    // treatment, kept off shell.js's static class list so the two agree
    // even if shell.js's markup changes under a concurrent edit.
    wrap.classList.add('acct-rail');
    const v = view();
    /* Counted WITHIN the current owner, so the two chip rows agree with each
       other and with the table. A "Savings 5" sitting above three rows is not a
       count, it is a contradiction the reader has to resolve themselves. */
    const inScope = rows.filter(ownerMatch);
    for (const f of FILTERS()) {
      const n = inScope.filter(f.test).length;
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
      /* Clamped to match the BAR, which is clamped in the same [0,100] range
         two lines up in `bar()` — an overdrawn account with a savings goal
         used to print "−340% of R10 000" beside a bar that could only ever
         show zero width, two figures making two different claims about the
         same account. */
      const shown = Math.min(100, Math.max(0, pct));
      return bar(pct, '', i18n.t('acct.goalOf', { pct: Math.round(shown), amount: acctMoney(a, a.goal_amount, 0) }));
    }
    /* r.tr.basis !== 'none', not `a.total_invested > 0` — the old gate hid this
       whole branch from an account on basis 'measured' (starting_amount +
       inception_date, no total_invested at all — the account type this cell's
       own header calls "measured against real accounts") and from one on basis
       'stated' at an explicit total_invested of 0, which A1 above made a real,
       reachable state. Both have a growth figure totalReturn() is willing to
       state; the old test just never asked it. */
    if (r.tr && r.tr.basis !== 'none') {
      /* totalReturn(), not `balance - total_invested` — see savings-math.js's
         own header for why that formula was retired: measured against real
         accounts it was wrong on all four, most starkly wherever a debit
         order kept moving the balance without total_invested keeping pace.
         `r.tr` is computed once in model() and shared with the drawer below,
         so the two cannot disagree with each other the way the goal cell and
         views/savings.js's own tile used to. */
      const tr = r.tr;
      /* tr.returnPct, not a local re-derivation — totalReturn() (savings-math.js)
         deliberately returns null here when capitalIn <= 0, because a percentage
         with nothing paid in to divide by is not a number this app can defend.
         This cell used to recompute its own `pct` with a `capitalIn > 0 ? … : 0`
         fallback, which silently printed "+0%" in exactly the case the maths
         module refuses to answer at all — the same account showing a real growth
         bar in the drawer beside a dash-free 0% in the table. */
      if (tr.returnPct === null) return el('span', { class: 'acct-dash' }, '—');
      const pct = tr.returnPct;
      return bar(100, pct < 0 ? 'bg-warning' : '',
        i18n.t('acct.growthOn', { pct: (pct >= 0 ? '+' : '') + Math.round(pct), amount: acctMoney(a, tr.capitalIn, 0) }));
    }
    return el('span', { class: 'acct-dash' }, '—');
  }

  function statePill(r) {
    const cls = { ok: 'ok', drift: 'danger', stale: 'warn', unreadable: 'warn',
      nodate: 'warn', notx: 'warn', nofolder: 'warn' }[r.state];
    /* `stale` is the only state whose pill states a number, so it is the only
       one that needs a param; every other state — `unreadable` now included —
       is a bare label the state name itself selects. The template-literal form
       is invisible to tests/i18n.test.cjs's source scan, which is why the
       rendered proof in tests/reconcile-unreadable-dates.test.cjs asserts the
       pill through this same i18n.t call rather than against a literal. */
    const label = r.state === 'stale'
      ? i18n.t('acct.state.stale', { count: r.days })
      : i18n.t(`acct.state.${r.state}`);
    /* A muted account still says what it IS — the pill is the fact, and the
       reader asked for the nagging to stop, not for the page to start
       claiming the figure agrees with transactions it has never seen. Muting
       only drops the alarm colour and adds the reason it is quiet. The WHY
       ("Ignored on this account, so it is not listed under 'Needs a look'.")
       used to live only in a `title`, invisible on the phones this table's
       reconciliation state is read on just as much as a desktop — caveatChip
       (dom.js) makes it reachable by tap. */
    if (r.muted) {
      return el('span', { class: 'acct-pill muted' },
        label, ' ', caveatChip(i18n.t('acct.state.muted'), i18n.t('acct.mutedTitle')));
    }
    return el('span', { class: `acct-pill ${cls}` }, label);
  }

  /* Variant B's per-row actions (see budget-redesign.html screen 8, variant
     B): the deck's own Review / one-tap-fix pair, now printed on the row that
     wants it instead of duplicated on a card above the table. `null` for a
     clean account — nothing here is a decision, so nothing here has buttons. */
  function rowActions(r) {
    if (!wantsALook(r)) return null;
    const act = deckAction(r);
    const reviewBtn = el('button', { type: 'button', class: 'acct-deck-btn ghost sm',
      'aria-label': i18n.t('acct.deck.ariaReview', { name: r.a.name }) }, i18n.t('acct.deck.review'));
    reviewBtn.addEventListener('click', e => { e.stopPropagation(); openRow(r.a.name, true); });
    const doBtn = el('button', { type: 'button', class: 'acct-deck-btn sm' }, icoEl(['check']), act.label);
    doBtn.addEventListener('click', e => { e.stopPropagation(); act.run(); });
    /* The reason travels with the row: a flagged account must say WHY on the
       same surface it is flagged, whichever filter is active (the reason
       group header only exists under the "Needs a look" filter). */
    /* Ignore: the third answer to a decision, beside "look" and "fix". Only
       for a state that is a judgement (WARNINGS); `unreadable` is a typo with
       one correct answer and is never offered, the same rule mutedWarnings
       applies to a hand-written key. Appends to whatever is already muted on
       the account and saves that one key, so nothing else in the file moves. */
    const kids = [el('span', { class: 'acct-row-why' }, deckWhy(r)), reviewBtn, doBtn];
    if (WARNINGS.includes(r.state)) {
      const ignBtn = el('button', { type: 'button', class: 'acct-deck-btn ghost sm',
        'aria-label': i18n.t('acct.deck.ariaIgnore', { name: r.a.name }) }, i18n.t('acct.deck.ignore'));
      ignBtn.addEventListener('click', e => { e.stopPropagation(); ignoreWarning(r); });
      kids.push(ignBtn);
    }
    return el('span', { class: 'acct-row-acts' }, ...kids);
  }

  async function ignoreWarning(r) {
    const a = r.a;
    const mute = WARNINGS.filter(w => mutedWarnings(a).has(w) || w === r.state);
    a.ignore_warnings = mute.length === WARNINGS.length ? 'true' : `[${mute.join(', ')}]`;
    if (!(await saveAccount(a, ['ignore_warnings']))) return;
    renderAccounts();
    toast(i18n.t('acct.toast.ignored', { name: a.name }));
  }

  function accountRow(r) {
    const a = r.a, v = view();
    const open = v.open === a.name;
    const tr = el('tr', {
      /* A currency conflict flags the ROW as well as carrying a badge in the
         drawer: it is a contradiction in the file, not a figure that has merely
         aged, and a reader should not have to open an account to discover that
         the app is reading it as a different currency from the one they wrote.
         Deliberately NOT a new `state`: acct-status.js's own note says a sixth
         one has to be understood by every consumer of the pill, the queue and
         the mute aliases before it can ship, and this needs none of that — the
         existing "look at me" styling says enough, and the badge says which. */
      class: `acct-row${r.state === 'drift' ? ' is-drift' : (wantsALook(r) || r.a.currency_conflict) ? ' is-flag' : ''}${open ? ' is-open' : ''}`,
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

    /* A cell load.js could not parse at all reads as what it is — a figure
       the app cannot show, not R0,00 — see unreadableBalance() above. The
       button still opens editBalance(), which is the one place that fixes it. */
    const unreadable = unreadableBalance(a);
    const balLabel = unreadable
      // TODO(i18n): acct.balance.unreadable — 'Can't read "{raw}" — click to fix'
      ? i18n.t('acct.balance.unreadable', { raw: a.balanceRaw })
      : acctMoney(a, a.balance);
    const balBtn = el('button', { type: 'button',
      class: `acct-bal num${unreadable ? ' text-warning' : a.balance < 0 ? ' text-danger' : ''}`,
      'aria-label': i18n.t('acct.aria.balance', { name: a.name, amount: balLabel }) },
      balLabel);
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
            /* Owner joins the kind and the bank on the one line the row
               already has. Only when there IS one — an empty owner would leave
               a trailing separator on every row in a single-person vault. */
            [a.type.replace('_', ' '), a.institution,
              a.owner ? ownerLabel(a.owner, declaredOwners()) : ''].filter(Boolean).join(' · '))))),
      el('td', { class: 'num' }, balBtn),
      el('td', { class: 'num acct-col-drop' }, flowCell),
      el('td', { class: 'acct-col-drop' }, spark || el('span', { class: 'acct-dash' }, '—')),
      el('td', { class: 'acct-col-drop' }, goalCell(r)),
      el('td', { class: 'acct-col-drop' },
        el('span', { class: 'acct-when' }, a.balance_updated || i18n.t('acct.noDate'))),
      el('td', { class: 'acct-col-state' }, statePill(r), rowActions(r)),
      /* Notes get a column of their own, at the end.
         It rode with the account NAME first, which read fine on one-line names
         and badly on the real ones: "Discovery Bank Transaction Account
         (Alex)" wraps to three lines, and an inline chip after the last word
         lands alone under the name looking like a stray control belonging to
         nothing. A column keeps it on the row's own baseline whatever the name
         does, and puts every account's chip in one scannable strip.
         NOT acct-col-drop: the columns that drop on a phone are the figures a
         narrow screen can do without, and notes are the opposite — the phone
         is where you write "the bank said X" while still on the call. */
      el('td', { class: 'acct-col-notes' }, ctx.noteButton('account', a.name)));

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

    /* Same unreadable-cell treatment as the row's own balance button — see
       unreadableBalance() above and the row's own comment. */
    const unreadable = unreadableBalance(a);
    const drawerBal = unreadable
      ? i18n.t('acct.balance.unreadable', { raw: a.balanceRaw })
      : acctMoney(a, a.balance);
    box.append(el('div', { class: 'acct-drawer-h' },
      el('h3', {}, a.name),
      el('div', { class: `acct-drawer-v num${unreadable ? ' text-warning' : a.balance < 0 ? ' text-danger' : ''}` }, drawerBal)));

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
    /* r.tr.basis !== 'none', not `a.total_invested > 0` — same fix and same
       reasoning as goalCell() above: the old gate hid Growth from an account on
       basis 'measured' (starting_amount, no total_invested at all) and from one
       on basis 'stated' at an explicit total_invested of 0 (a real baseline
       since A1). "Total invested" stays keyed to `a.total_invested` itself
       rather than r.tr.capitalIn — it is naming a specific frontmatter figure,
       and showing it for a 'measured' account that never had one would put a
       number under a label the account's own file does not support. */
    if (r.tr && r.tr.basis !== 'none') {
      if (a.total_invested != null) {
        f(i18n.t('acct.drawer.invested'), acctMoney(a, a.total_invested));
      }
      f(i18n.t('acct.drawer.growth'), acctMoney(a, r.tr.growth));
    }
    if (a.monthly_contribution) f(i18n.t('acct.drawer.monthly'), acctMoney(a, a.monthly_contribution));
    if (r.act.count) {
      f(i18n.t('acct.drawer.flow'),
        `+${acctMoney(a, r.act.inAmt, 0)} · −${acctMoney(a, r.act.outAmt, 0)}`);
      f(i18n.t('acct.drawer.rows', { count: r.act.count }), periodMonthName(S.period));
    }
    /* ISSUE 42. What the pill stops short of. The pill is now as-of today, so
       the rest of the period has to be somewhere a reader can find it — this
       drawer is where this page says what it knows about an account, and
       "nothing here" would read as "nothing coming". */
    if (r.act.ahead && r.act.ahead.count) {
      f(i18n.t('acct.drawer.ahead'),
        `+${acctMoney(a, r.act.ahead.inAmt, 0)} · −${acctMoney(a, r.act.ahead.outAmt, 0)}`);
      f(i18n.t('acct.drawer.aheadRows', { count: r.act.ahead.count }), periodMonthName(S.period));
    }
    /* Stated even when unset, unlike the row subtitle above: the drawer is
       where a reader goes to find out what this app knows about an account, and
       a question with a blank answer is itself the answer. Suppressed only in a
       vault that has no owner question at all. */
    if (ownerInPlay()) f(i18n.t('acct.field.owner'), ownerLabel(a.owner, declaredOwners()));
    if (a.currency_conflict) {
      f(i18n.t('acct.drawer.currencyClash'), i18n.t('acct.badge.currencyClash', {
        code: a.currency_conflict.code, symbol: a.currency_conflict.symbol,
      }));
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
    /* The account's own two currency fields contradicting each other, said on
       the row rather than left to be inferred from a total. `currency: R` with
       `currency_code: USD` in a rand vault used to be HOME to currency.js and
       FOREIGN to fx.js — R1 000 in the split headline against R17 985,61 on
       the converted line. The app now takes the safe reading (foreign, named
       by its code, never added at par), and this badge is the other half of
       that: the reader is told which of the two words won, so they can correct
       the file rather than wonder why their rand account is listed under USD.
       Warning-toned, because it is a fact about the FILE and not about the
       money — nothing here is stale or unconfirmed, it is contradictory. */
    if (a.currency_conflict) {
      badges.append(badge(i18n.t('acct.badge.currencyClash', {
        code: a.currency_conflict.code, symbol: a.currency_conflict.symbol,
      }), 'warn'));
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
      i18n.t('acct.aria.balance', { name: a.name, amount: drawerBal }), () => editBalance(a));
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
    // Last, and on its own class: it is the only action here that removes
    // something, and it should not sit a thumb's width from "Edit".
    const del = el('button', { type: 'button', class: 'acct-drawer-act acct-drawer-del',
      'aria-label': i18n.t('acct.aria.delete', { name: a.name }) }, i18n.t('acct.btn.delete'));
    del.addEventListener('click', () => deleteAccount(a));
    acts.append(del);
    box.append(acts);

    const td = el('td', { colspan: '8', class: 'acct-drawer-cell' }, box);
    return el('tr', { class: 'acct-drawer-row' }, td);
  }

  /* The reconciliation, stated the same way it always was — the arithmetic and
     an offer, never a silent correction. */
  function reconLine(r) {
    const a = r.a, rec = r.rec;
    const line = el('div', { class: 'acct-recon' });
    /* Stated on EVERY branch below, not only on its own state. An account that
       is ALSO drifting, or also stale, still has money the vault cannot place;
       reporting the count only when it happens to be the headline is how it
       would go missing on exactly the accounts that have more than one thing
       wrong with them — and the drift branch is the one that offers a figure
       to accept, so it is the branch where an unstated omission does the most
       damage.

       `acct.recon.undatable` carries its own leading " · " inside the string,
       exactly as `acct.recon.pending` beside it does — the separator belongs to
       the fragment rather than to the concatenation, so a language that wants a
       different join (or none) can say so in its own table instead of being
       held to a punctuation mark decided here. */
    const n = (rec && rec.unreadable) || 0;
    const undatable = n ? i18n.t('acct.recon.undatable', { count: n }) : '';
    if (rec.state === 'drift') {
      const diff = rec.implied - a.balance;
      line.append(el('div', { class: 'acct-recon-txt' },
        i18n.t('acct.drawer.drift', {
          count: rec.count,
          date: a.balance_updated,
          implied: acctMoney(a, rec.implied),
          diff: acctMoney(a, Math.abs(diff), 0),
          dir: i18n.t(diff < 0 ? 'acct.drawer.lower' : 'acct.drawer.higher'),
        }) + (rec.ahead ? i18n.t('acct.recon.pending', { count: rec.ahead }) : '') + undatable));
      const btn = el('button', { type: 'button', class: 'acct-recon-btn',
        'aria-label': i18n.t('acct.aria.useThis', { name: a.name, amount: acctMoney(a, rec.implied) }) },
        icoEl(['check']), i18n.t('acct.recon.useThis'));
      btn.addEventListener('click', () => acceptImplied(a, rec.implied, rec));
      line.append(btn);
      return line;
    }
    const txt = r.state === 'notx' ? i18n.t('acct.drawer.recon.notx')
      : r.state === 'nofolder' ? i18n.t('acct.drawer.recon.nofolder')
        : r.state === 'nodate' ? i18n.t('acct.drawer.recon.nodate')
          : r.state === 'unreadable' ? i18n.t('acct.drawer.recon.unreadable')
            : r.state === 'stale' ? i18n.t('acct.drawer.recon.stale', { date: a.balance_updated })
              : rec.state === 'pending' ? i18n.t('acct.recon.upToDate', { count: rec.ahead })
                : i18n.t('acct.drawer.recon.ok');
    line.append(el('div', { class: `acct-recon-txt${r.state === 'ok' ? ' text-success' : ' text-muted'}` },
      txt + undatable));
    if (r.state === 'stale' || r.state === 'nodate') {
      const btn = el('button', { type: 'button', class: 'acct-recon-btn' },
        i18n.t(r.state === 'stale' ? 'acct.deck.do.stale' : 'acct.deck.do.nodate'));
      btn.addEventListener('click', () => editBalance(a));
      line.append(btn);
    }
    return line;
  }

  /* ------------------------- resizable columns ---------------------------
     The reader drags a column edge; the width is remembered in plugin data
     (settings.acctColWidths) and re-applied on every later render.

     WIDTHS ARE ONLY HONOURED UNDER `table-layout: fixed`. Under the automatic
     layout this table ships with, a `width` on a `th` is a suggestion the
     engine is free to ignore the moment the content disagrees — which is
     exactly what a reader narrowing a column is asking it to do. So the table
     switches to a fixed layout the first time ANY column is sized, and stays
     automatic for a household that never drags one. That keeps the default
     behaviour (and the name-column min-width floor that fixed the one-word-
     per-line wrap) untouched for everyone who never asks for this.

     Not applied on a phone: the three `acct-col-drop` columns are display:none
     under 760px, so a width dragged on a desktop would be shared out among a
     different set of columns and read as a broken table. The stored figure is
     kept, not cleared — going back to the desktop restores it. */
  const COL_MIN = 64;
  const RESIZE_AT = 761;   // one past the 760px drop breakpoint in styles.css

  function widths() { return plugin.settings.acctColWidths || {}; }
  function resizingOn() {
    return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true : window.matchMedia(`(min-width: ${RESIZE_AT}px)`).matches;
  }

  /* Persisted on RELEASE, not on every pointermove: a drag is one decision,
     and writing data.json per frame would put hundreds of writes into a vault
     that syncs. Guarded like every other settings write in this app. */
  async function saveWidth(key, px) {
    const w = { ...widths() };
    if (px === null) { delete w[key]; } else { w[key] = Math.round(px); }
    plugin.settings.acctColWidths = w;
    try { await plugin.saveSettings(); }
    catch (e) { toast(i18n.t('settings.err.save', { error: e.message || e }), true); }
  }

  /* One grip per header. pointerdown/move/up with setPointerCapture rather
     than document-level listeners: capture keeps the drag alive when the
     pointer leaves the 6px grip, which it does immediately, and releases it
     automatically if the pointer is cancelled. touch-action:none is what stops
     the table scrolling under a finger instead of resizing. */
  function addGrip(th, key) {
    const grip = el('span', { class: 'acct-grip', 'aria-hidden': 'true' });
    let startX = 0, startW = 0, live = null;
    grip.addEventListener('pointerdown', e => {
      if (!resizingOn()) { return; }
      e.preventDefault(); e.stopPropagation();       // never sorts the column it grips
      startX = e.clientX; startW = th.getBoundingClientRect().width; live = startW;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('is-dragging');
      $('#acctTable').classList.add('is-sized');
    });
    grip.addEventListener('pointermove', e => {
      if (!grip.hasPointerCapture || !grip.classList.contains('is-dragging')) { return; }
      live = Math.max(COL_MIN, startW + (e.clientX - startX));
      th.style.width = `${live}px`;
    });
    const end = e => {
      if (!grip.classList.contains('is-dragging')) { return; }
      grip.classList.remove('is-dragging');
      try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      if (live !== null) { saveWidth(key, live); }
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    /* Double-click resets this one column — the standard escape hatch, and the
       only way back to automatic sizing for a column dragged somewhere silly. */
    grip.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation();
      th.style.width = '';
      saveWidth(key, null);
      renderAccounts();
    });
    th.append(grip);
  }

  /* Stamped on the th at build time so both the restore and the drag read one
     name for a column. */
  function colHeader(th, key) {
    th.setAttribute('data-col', key);
    const px = widths()[key];
    if (px && resizingOn()) { th.style.width = `${px}px`; }
    addGrip(th, key);
    return th;
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
    return colHeader(th, key);
  }

  function renderTable(rows) {
    const table = $('#acctTable');
    if (!table) return;
    const v = view();
    const shown = visibleRows(rows);

    /* keepScroll: this is the widest table in the plugin, and every wide
       table in it (Assets, Debts) already rebuilds inside this wrapper — see
       dom.js's own note on why. Without it, every render (a filter click, a
       drawer opening, even the file watcher firing from an import running in
       another window) snapped a reader mid-scroll on a phone back to the
       leftmost column. */
    keepScroll(table, () => {
      table.empty();
      const head = el('tr', {},
        sortHeader('name', i18n.t('acct.col.account')),
        sortHeader('balance', i18n.t('acct.col.balance')),
        sortHeader('flow', periodMonthName(S.period)),
        /* TODO(i18n): reword acct.col.month from "Month" to "Period" — this
           header sits over the SPARKLINE column, which is drawn from
           txInPeriod(S.period) (see sparkline() below), the same window as
           every other figure on this page. "Month" is wrong whenever the
           household's period is not a calendar month (a fortnightly household
           gets a column headed "Month" showing 14 days of shape). The column
           it sits beside (idx2, just above) already gets this right — its
           header is periodMonthName(S.period), which is interval-aware — so
           this is the one surface still hard-coding the word. Matches the
           vocabulary acct.sort.flow ("this period") and acct.drawer.flow
           ("This period") already use for the same figure elsewhere on this
           page — three names for one concept is the bug the audit named;
           "Period" is the fourth surface converging on the two that already
           got it right, not a fifth new word. */
        colHeader(el('th', { class: 'acct-col-drop', scope: 'col' }, i18n.t('acct.col.month')), 'month'),
        /* TODO(i18n): reword acct.col.goal from "Goal / limit" to "Progress"
           — goalCell() (below) puts THREE different figures under this one
           header depending on account type: a credit card's utilisation
           against its limit, a savings pot's balance against its goal, and —
           since totalReturn() replaced the retired balance-minus-invested
           formula — an INVESTMENT'S GROWTH, which is neither a goal nor a
           limit. "Goal / limit" was accurate for two of three and silently
           wrong for the third. Renaming beats splitting the figure into its
           own column: every neighbouring column here is `acct-col-drop`
           (hidden under 760px) and this table already switches to a fixed
           layout the moment any column is resized (see COL_MIN's own note
           above) — adding a column means updating every hard-coded colspan='8'
           in this file (the empty-table row, the type-row group total, the
           drawer row) and the phone breakpoint CSS, for a number the Savings
           page already owns and states in full. "Progress" reads honestly for
           all three: a limit bar, a goal bar and a growth bar are each "how
           this account is doing against a benchmark", and a one-word header
           survives a dragged-narrow column the way "Goal / limit / growth"
           would not. */
        colHeader(el('th', { class: 'acct-col-drop', scope: 'col' }, i18n.t('acct.col.goal')), 'goal'),
        sortHeader('stale', i18n.t('acct.col.confirmed')),
        colHeader(el('th', { scope: 'col' }, i18n.t('acct.col.state')), 'state'),
        /* The label is for a screen reader, not for the eye. Spelling "Notes"
           out visibly made the column 76px wide to hold a 26px chip, which
           pushed the whole table 24px past its card at 1280 — and the column it
           clipped was this one. A column of icons needs no word over it; a `th`
           with no accessible name at all would leave every chip in it announced
           without the one word that says what the column is. */
        el('th', { class: 'acct-col-notes', scope: 'col' },
          el('span', { class: 'sr-only' }, i18n.t('acct.col.notes'))));
      head.children[2].classList.add('acct-col-drop', 'num');
      head.children[5].classList.add('acct-col-drop');
      /* See the note on COL_MIN above: fixed layout is what makes a stored width
         real, and it is switched on only for a table that has one. */
      table.classList.toggle('is-sized', resizingOn() && Object.keys(widths()).length > 0);
      table.append(el('thead', {}, head));

      const body = el('tbody', {});
      const emit = r => {
        body.append(accountRow(r));
        if (v.open === r.a.name) body.append(drawerRow(r));
      };

      if (!shown.length) {
        body.append(el('tr', { class: 'acct-empty' },
          el('td', { colspan: '8' },
            S.accounts.length ? i18n.t('acct.emptySearch') : i18n.t('acct.empty'))));
      } else if (v.filter === 'flag') {
        /* Variant B (screen 8): filtered to "Needs a look", the table groups
           by REASON rather than by kind — the sentence that used to repeat
           on every one of the old deck's cards now heads the group instead,
           and each row underneath states only what is specific to IT
           (deckWhy, via rowActions' own doBtn label). Overrides the kind
           toggle deliberately: "group by kind" and "why does this account
           need a look" are two different questions, and the reason grouping
           is the one this filter exists to answer. */
        for (const g of reasonGroups(shown)) {
          body.append(el('tr', { class: 'type-row' },
            el('td', { colspan: '8' },
              reasonHeader(g.state),
              el('span', { class: 'acct-group-total num' }, String(g.rows.length)))));
          for (const r of g.rows) emit(r);
        }
      } else if (v.grouped) {
        for (const [key] of ACCT_GROUPS) {
          const inGroup = shown.filter(r => r.group === key);
          if (!inGroup.length) continue;
          /* ITEM 5, same rule as the hero above it: this row's own total sums
             only the group's primary-currency accounts, and any other
             currency in the group gets its own small side figure rather than
             being folded in and marked with an asterisk. */
          const { primary, others } = splitByCurrency(inGroup.map(r => r.a));
          const total = primaryTotal(primary, S.settings.currency);
          body.append(el('tr', { class: 'type-row' },
            el('td', { colspan: '8' },
              i18n.t(key),
              el('span', { class: 'acct-group-total num' }, money(total),
                ...(others.length ? [el('span', { class: 'acct-group-other' },
                  otherCurrenciesTag(others))] : [])))));
          for (const r of inGroup) emit(r);
        }
      } else {
        for (const r of shown) emit(r);
      }
      table.append(body);
    });

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
    /* Owner chips FIRST: that pass is what clears a filter pointing at an owner
       this vault no longer distinguishes, and everything below reads v.owner. */
    renderOwnerFilters(rows);
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
    if (!isCreditCard(a) || !a.credit_limit || a.credit_limit <= 0) return null;
    const used = Math.max(0, -a.balance);
    const pct = (used / a.credit_limit) * 100;
    const over = used > a.credit_limit;
    return { used, pct, over, near: !over && pct >= 85, available: a.credit_limit - used };
  }
  /* `keys` names the extra frontmatter fields to write from the model — the
     edit form passes EDITABLE_KEYS, everything else passes nothing. The balance,
     its date and the budget flag are always patched, because they are the only
     three the tile itself can change.

     Returns true on a write that landed, false on one that did not. This is
     the ONE save function in the app with no dirty flag or Save button of its
     own — every edit here writes through immediately from five different
     callers (editBalance, acceptImplied, editAccount, toggleBudget,
     addAccount) — so a caller cannot tell "did it land" from a bare await the
     way the dirty-flag pages can. Guarded here, once, rather than five times:
     a rejected write used to be an unhandled rejection that patchFile
     propagates straight through saveAccount and out through whichever
     caller's `await` was waiting on it — so, before this, a failed save did
     NOT fall through to a false success toast; it silently aborted the
     caller at that line, with nothing after it ever running and nothing
     telling the reader why. The fix is not a corrected result but a shared,
     controlled stopping point: one try/catch here, a plain boolean every
     caller can check, instead of five copies of the same catch (or five
     places that could forget one). addAccount goes further still on a false
     return — it must not push the account it just failed to write into
     S.accounts, or the app would show an account with no file behind it. */
  // TODO(i18n): reword acct.err.save from "Could not save {name} ({error})"
  // to "Could not save {name} ({error}) — nothing was written to the file;
  // try the same action again." This page has no dirty flag and no Save
  // button of its own (see this function's own header above) — every dialog
  // here writes through immediately, and neither branch below reverts the
  // in-memory model on a failed write (acceptImplied does; editBalance and
  // editAccount do not), so what actually happened on a failure is: the file
  // is untouched, and reopening the same dialog and saving again is a real,
  // working retry. The old text said what failed and stopped there — it
  // never told the reader the retry exists at all.
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
      /* Re-capture the returned block. Every patch is computed against fmRaw,
         so leaving it at the block read from disk at LOAD time makes each save
         undo the one before it: edit the credit limit, then click the balance,
         and the limit goes back to whatever the file said when the vault was
         opened. Our own writes are deliberately not re-read by the file
         watcher, so nothing else would put this back in step. */
      try {
        a.fmRaw = await ctx.patchFile(`Accounts/${a.name}.md`, a.fmRaw, a.body || `\n\n# ${a.name}\n`, updates);
      } catch (e) {
        toast(i18n.t('acct.err.save', { name: a.name, error: e.message || e }), true);
        return false;
      }
      return true;
    }
    // Legacy fallback: no captured frontmatter (a file the loader never saw) —
    // rebuild from the model.
    const lines = ['---', `type: ${a.type}`];
    if (a.institution) lines.push(`institution: ${yamlStr(a.institution)}`);
    if (a.account_number) lines.push(`account_number: ${yamlStr(a.account_number)}`);
    // addAccount reaches saveAccount through THIS branch (a fresh account has no
    // fmRaw to patch), so an owner missing here is an owner the create form
    // collects and then throws away.
    if (a.owner) lines.push(`owner: ${yamlStr(a.owner)}`);
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
    // != null, for the reason spelled out at FM_WRITERS.total_invested and
    // FM_WRITERS.starting_amount above: 0 is a baseline the maths module
    // honours, not an absent key.
    if (a.total_invested != null) lines.push(`total_invested: ${a.total_invested.toFixed(2)}`);
    if (a.starting_amount != null) lines.push(`starting_amount: ${a.starting_amount.toFixed(2)}`);
    if (a.inception_date) lines.push(`inception_date: ${a.inception_date}`);
    if (a.tx_label) lines.push(`tx_label: ${yamlStr(a.tx_label)}`);
    if (a.tags) lines.push(`tags: ${a.tags}`);
    lines.push('---');
    // Not ctx.patchFile — this branch REBUILDS the frontmatter from the model
    // (there is no raw block to patch), but the trailing `a.body ||` still
    // preserves the body, same invariant as the patch branch above.
    try {
      await writeFile(`Accounts/${a.name}.md`, lines.join('\n') + (a.body || `\n\n# ${a.name}\n`));
    } catch (e) {
      toast(i18n.t('acct.err.save', { name: a.name, error: e.message || e }), true);
      return false;
    }
    // Adopt what was just written, so the NEXT save takes the patch branch
    // above and preserves anything the user has added to the file since.
    a.fmRaw = lines.slice(1, -1).join('\n');
    return true;
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
      ...ownerField(defaults && defaults.owner),
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
    if (!ACCT_TYPES.includes(r.type)) {
      toast(i18n.t('acct.err.type', { field: i18n.t('acct.field.type'), example: i18n.t('acctType.savings') }), true);
      return null;
    }

    const balance = parseAmount(r.balance) ?? 0;
    const goal = parseAmount(r.goal_amount);
    const invested = parseAmount(r.total_invested);
    /* Which of the three failed, not just that one did — same fix as
       editBalance's single-field check above, extended to a form that offers
       three amounts at once. `find`, not `some`: the toast can only carry one
       field, so the first bad one found is the one named. A reader who fixes
       it and resubmits gets told about the next one if there is one, rather
       than three unnamed failures in a row. */
    const badAmount = [
      ['balance', balance, i18n.t('acct.field.balance'), '1500.00'],
      ['goal_amount', goal, i18n.t('acct.field.goalOpt'), '50000.00'],
      ['total_invested', invested, i18n.t('acct.field.investedOpt'), '20000.00'],
    ].find(([, n]) => n !== null && isNaN(n));
    if (badAmount) {
      toast(i18n.t('acct.err.nan', { field: badAmount[2], example: badAmount[3] }), true);
      return null;
    }

    const acct = {
      name, type: r.type, institution: (r.institution || '').trim(),
      // '' when the form never asked — saveAccount's FM_WRITERS then writes no
      // owner line at all, which is what a one-person vault should produce.
      owner: (r.owner || '').trim(),
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
    // saveAccount already toasted the failure. Returning null here — same as
    // every validation failure above — matters more than usual: the account
    // below is never pushed into S.accounts, so a failed write never leaves
    // the app showing an account with no file behind it.
    if (!(await saveAccount(acct))) return null;
    // Match the setup wizard: pre-create the account's transactions folder so
    // it's importable and visible in the file explorer right away.
    await ensureFolder(relPath(`Transactions/${name}`));
    S.accounts.push(acct);
    S.accounts.sort((a, b) => a.name.localeCompare(b.name));
    ctx.render();   // not renderAccounts — three other pages have this button too
    toast(i18n.t('acct.toast.created', { path: `Accounts/${name}.md` }));
    return acct;
  }

  /* ------------------------------- deleting --------------------------------
     An account is a FILE and a FOLDER joined by a string, and those two are
     what makes deleting one different from deleting a row in a table.

     Trash `Accounts/<name>.md` on its own and every transaction it held stays
     exactly where it was — still parsed, still counted in every period total,
     still in the cash figure — under a folder no account claims. CONTEXT.md
     has a name for that state (an orphan folder) because the loader will not
     invent an account to go with one, and it is deliberately silent: the rows
     are not wrong, they simply belong to nobody. Someone deleting an account
     they opened by mistake wants the rows gone; someone retiring a closed
     account wants the history kept. Neither is guessable, so the folder is a
     question rather than a default, and the counts are stated in the asking.

     Two other consequences named in the dialog because nothing on screen shows
     them: notes written about the account stay in Notes/ and start reading as
     unmatched (their subject no longer resolves — the same after-the-fact badge
     a table-row rename lands in, see classifyRename in controller.js), and the
     files go to the VAULT trash rather than the system one, so all of this is
     recoverable from inside Obsidian.

     Resolved to TFile/TFolder BEFORE the dialogs and trashed by that handle,
     never by re-reading the path afterwards: a path re-resolved across the
     seconds a reader spends in a confirmation either no longer exists — and the
     delete then reports a success it did not have — or now points at something
     else, which it would trash instead. notes.js paid for that lesson once. */
  async function deleteAccount(a) {
    const file = fileAt(`Accounts/${a.name}.md`);
    if (!file) return toast(i18n.t('acct.delete.gone', { name: a.name }), true);

    /* Every folder that resolves to THIS account, not just `a.name`: tx_label
       points an account at a folder of another name, and safeSeg renames one on
       the way to disk. accountForLabel is the same door accountIndex and the
       reconciliation read through, so a folder counted as this account's
       everywhere else is counted as this account's here. */
    const labels = (S.txFolders || []).filter(n => accountForLabel(n) === a);
    const folders = labels.map(n => ctx.folderAt(`Transactions/${n}`)).filter(Boolean);
    const files = Object.values(S.txFiles).filter(f => labels.includes(f.label));
    /* !isSplitPart, like every other raw-row consumer on this page — a split's
       parts are rows THIS APP created out of one statement line, not lines the
       bank printed, so counting them here offered to delete "130 transactions"
       for an account whose statements held 100. */
    const rows = files.reduce((n, f) => n + f.rows.filter(row => !isSplitPart(row)).length, 0);

    let dropFolder = false;
    if (folders.length) {
      const ask = await askFields(app, i18n.t('acct.delete.title', { name: a.name }), [{
        key: 'folder',
        label: i18n.t('acct.delete.folderField', { label: labels.join(', ') }),
        type: 'select',
        value: 'keep',
        desc: i18n.t('acct.delete.folderDesc', { count: rows, months: files.length }),
        options: [
          { value: 'keep', label: i18n.t('acct.delete.keep') },
          { value: 'drop', label: i18n.t('acct.delete.drop') },
        ],
      }]);
      if (!ask) return;
      dropFolder = ask.folder === 'drop';
    }

    /* The second dialog is not a formality — it is the only one that states the
       outcome of the choice just made, and it is the one with the warning
       button on it. An account with no folder never sees the first. */
    const go = await confirmModal(app, {
      title: i18n.t('acct.delete.title', { name: a.name }),
      message: i18n.t('acct.delete.msg', { name: a.name }) + ' '
        + (!folders.length ? i18n.t('acct.delete.noFolder')
          : dropFolder ? i18n.t('acct.delete.willDrop', { count: rows, label: labels.join(', ') })
            : i18n.t('acct.delete.willKeep', { count: rows, label: labels.join(', ') }))
        + ' ' + i18n.t('acct.delete.notes'),
      confirmText: i18n.t('acct.delete.confirm'),
    });
    if (!go) return;

    try {
      await ctx.trashFile(file);
      if (dropFolder) for (const f of folders) await ctx.trashFile(f);
    } catch (e) {
      /* Re-read rather than guess which half landed. A delete that threw
         part-way is exactly the case where the in-memory model and the disk
         have stopped agreeing, and this app's whole contract is that the
         markdown is the source of truth. */
      await ctx.reloadFromDisk();
      ctx.render();
      return toast(i18n.t('acct.delete.failed', { error: (e && e.message) || e }), true);
    }

    S.accounts = S.accounts.filter(x => x !== a);
    if (dropFolder) {
      for (const key of Object.keys(S.txFiles)) {
        if (labels.includes(S.txFiles[key].label)) delete S.txFiles[key];
      }
      S.txFolders = (S.txFolders || []).filter(n => !labels.includes(n));
    }
    /* Close the drawer if it was this account's — v.open holds a NAME, and a
       name pointing at nothing renders no drawer but leaves the row that would
       have opened it looking selected. */
    const v = view();
    if (v.open === a.name) v.open = null;
    ctx.render();   // not renderAccounts — Savings has this button too
    toast(dropFolder && rows
      ? i18n.t('acct.deleted.withRows', { name: a.name, count: rows })
      : i18n.t('acct.deleted', { name: a.name }));
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

  /* editBalance, editAccount and acceptImplied are shared with views/savings.js
     rather than copied into it. One account form and one reconcile-accept
     path in this plugin, not two that drift — the fields a type offers, the
     parsing, the frontmatter keys written, and the failed-write back-out all
     have exactly one owner. */
  ctx.provide({ renderAccounts, saveAccount, addAccount, editAccount, editBalance, deleteAccount,
    acceptImplied, openAccountFile, openAccountTransactions: openTransactions,
    acctSearch, acctToggleGroup,
    accountReconcile: reconcile, accountUtilisation: utilisationOf, ACCOUNT_FM_KEYS: EDITABLE_KEYS });
};

/* Exposed for a direct, DOM-free unit test of the rounding algorithm — see
   tests/donut-percentages.test.cjs, which covers this copy and dashboard.js's
   independently, plus the full render for each. */
module.exports.sharePercents = sharePercents;
