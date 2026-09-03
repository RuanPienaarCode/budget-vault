'use strict';
/* Savings & Investments — net-worth KPIs, composition, goals, per-group tiles. */

const { el, kpiTiles, icoEl, caveatChip } = require('../dom');
const { createChart, tip, parseColor, distinctColors } = require('../chart');
const { isStale, isStaleValuation, stalenessSummary, reconcile } = require('../reconcile');
const { todayIso } = require('../dates');
const { accountFlows, totalReturn, growthTotals, growthSeries, chartable, poolCatType } = require('../savings-math');
const { worth, cardOverlap, accountGroups, debtsByType, assetsByType,
  otherCurrencyNet } = require('../worth');
const { daysSince } = require('../reconcile');
const { sharePercents } = require('../share-percents');
const { symbolOf, isForeign, splitByCurrency, primaryTotal, currenciesIn } = require('../currency');
/* Namespace import: see src/views/dashboard.js's own comment — `t` is taken
   as a local in several sibling files, so every view in this app imports i18n
   the same way regardless of whether this particular file happens to clash. */
const i18n = require('../i18n');

/* Bumped once per composition chart drawn, to keep its clipPath and gradient
   ids unique across every render AND across every open leaf. Module scope
   rather than per-registration for exactly that second reason. */
let worthSeq = 0;

module.exports = function registerSavings(ctx) {
  /* saveAccount and acceptImplied are deliberately NOT destructured here. Both
     are provided by views/accounts.js, so pulling them out at register time
     made this the one module whose correctness depended on registration ORDER
     in controller.js — reorder the register calls and they silently became
     undefined, throwing only when a user edited a savings balance a screen
     away from the cause. Every other cross-view call (ctx.editBalance,
     ctx.editAccount, ctx.noteButton) is late-bound through ctx at call time;
     these now are too. */
  const { S, $, root, money, accountIndex, impliedAccounts } = ctx;

  /* ---------------------------- currency ----------------------------------
     This page was the pre-issue-#28 code verbatim, and an audit found every
     defect that issue described sitting one tab across from the page it was
     reported against: net worth read Rp 6 203 956 here while the Accounts
     hero read Rp 6 200 000 for the same three files, and unlike the hero this
     page said nothing at all. Its growth tile went further and divided one
     mixed quantity by another — "+11,2% on Rp 903 000 put in", where the
     903 000 was Rp 900 000 and ¥ 3 000 added together, a percentage of a
     number that does not exist.

     The two rules below are the same two the Accounts page uses, imported
     rather than re-derived so this file cannot drift from it again:

       acctMoney  an account's OWN figures print in the account's OWN symbol.
                  A ¥ balance rendered "Rp 3 956,00" is not a missing label,
                  it is a wrong figure — it claims the household holds rupiah
                  it does not have.
       homeOnly / otherTag
                  a total ACROSS accounts sums the household's currency and
                  names every other symbol beside it, never folding them in. */
  const acctMoney = (a, v, decimals = 2) =>
    ctx.moneyIn(symbolOf(a, S.settings.currency), v, decimals);
  const split = accts => splitByCurrency(accts, S.settings.currency);
  const homeOnly = accts => primaryTotal(accts, S.settings.currency);
  /* "plus ¥ 3 956 · $ 1 200" — zero decimals, because this is always a side
     note beside a figure that already carries its own full precision. This
     page is on the English-only backlog (EXPECTED_ENGLISH_ONLY in
     tests/i18n-render.test.cjs), so the wording is inline here rather than
     through i18n.t, matching every other string in this file. */
  const otherList = others => others.map(([sym, v]) => ctx.moneyIn(sym, v, 0)).join(' · ');
  const otherTag = others => (others.length ? `plus ${otherList(others)}` : '');
  const otherLine = others => (others.length
    ? ` Plus ${otherList(others)} held in other currencies, not converted.` : '');

  /* ITEM 2: every call into savings-math.js that classifies a row (totalReturn,
     accountFlows, growthSeries) must use THIS, not ctx.catType directly — see
     savings-math.js's own poolCatType() header for why passing the raw type
     straight through silently reverts every income-typed category, flagged
     interest or not, back to the old "any income is growth" rule on this page
     alone. Built once so it never drifts from the identical wrapper
     views/accounts.js's own totalReturn() call uses for the same account. */
  const poolType = name => poolCatType(S.categories, name);

  /* Case-folded and trimmed against the account's own type, not compared
     raw — the same trap views/dashboard.js's own accountsOfType documents,
     and worth.js:122-141 names outright ("`type: Savings` with a capital S,
     which is the same bug wearing a hat"). `load.js` only defaults `type`
     when the key is ABSENT, so `type: Savings`, `type: ' savings '` or
     `type: SAVINGS` reach here exactly as written — and worth() sums every
     account into net worth by balance SIGN regardless of type, so an account
     like that used to count toward the net-worth tile on this very page
     while showing 0 accounts on the savings/investment tile beside it.

     Every account-type test in this file goes through this one function —
     including the per-account `investment` checks further down, which read
     the same possibly-mixed-case field a second time — so the next reader
     cannot add a sixth raw `=== 'savings'`. */
  const typeIs = (a, type) => String((a && a.type) || '').trim().toLowerCase() === type;

  function renderSavings() {
    const savings = S.accounts.filter(a => typeIs(a, 'savings'));
    const investments = S.accounts.filter(a => typeIs(a, 'investment'));
    /* Split BEFORE summing, and split BEFORE worth() — the same order
       views/accounts.js's hero uses. worth()'s arithmetic is shared with the
       Dashboard, the Report and the health score, so this view narrows the
       account list it hands over rather than teaching worth() a rule those
       callers never asked for. */
    const sPlit = split(savings), iPlit = split(investments);
    const totalSavings = homeOnly(savings);
    const totalInvest = homeOnly(investments);
    /* ISSUE 44 — implied balances, the same as-of the Dashboard's cash card. */
    const { primary: homeAccounts, others: worthOthers } = split(impliedAccounts());
    /* The household symbol, passed at last: worth() has always computed a
       `currencies` disclosure for its caller and every caller in this app
       dropped it — and, calling with three arguments, computed it against a
       fallback household of "R", so on an Rp vault it named a currency the
       household has never held. */
    /* ISSUE 39 — receivables, so this tile and the Dashboard's own net-worth
       tile cannot state different totals for one household. */
    const w = worth(homeAccounts, S.debts, S.assets, S.settings.currency, S.owed);
    const netWorth = w.net;

    /* Built once and threaded through the tile, the chart and the cards. Each
       used to reach for accountIndex() on its own, which walked every
       transaction in the vault three times to reach the same answer — and, more
       to the point, let the three drift apart on WHICH accounts they covered. */
    const idx = accountIndex();
    const entries = [...savings, ...investments]
      .map(a => ({ account: a, rows: (idx.get(a) || {}).rows || [] }));

    const tile = kpiTiles($('#savingsKpis'));
    /* The same wording the Dashboard's own net-worth tile carries — matched by
       hand rather than routed through i18n.t: this view is still on the
       English-only backlog (EXPECTED_ENGLISH_ONLY in i18n-render.test.cjs),
       and one translated call here would make its render disagree with
       English for a reason nothing on the page explains. */
    /* THREE LEDGERS, ONE DISCLOSURE. `worthOthers` is the ACCOUNTS half alone
       — what splitByCurrency held out before worth() was ever called — and it
       is what this caption used to state on its own. worth() has returned the
       other two halves (`otherCurrencies.assets` and `.debts`) since ADR-0004
       landed and no page had ever read them, so a €300 000 flat and a
       €200 000 mortgage vanished from the headline figure of this page with
       nothing said: the silent exclusion currency.js's header forbids, on the
       one number that claims to be the whole picture. otherCurrencyNet merges
       all three into a per-symbol NET, which is the right shape here because
       the figure it sits beside is a NET worth — "held" in this sentence means
       "in the household's position", not "in a bank".

       The Savings and Investments tiles below keep `otherTag(…others)` on
       purpose: those two figures ARE account sums, so the accounts half is the
       whole of what they hold out. */
    tile('Net worth', money(netWorth), netWorth >= 0 ? 'grad-txt' : 'text-danger',
      'what you own minus what you owe' + otherLine(otherCurrencyNet(w, worthOthers)));
    tile('Savings', money(totalSavings), '', otherTag(sPlit.others));
    tile('Investments', money(totalInvest), '', otherTag(iPlit.others));
    growthTile(tile, entries);
    /* NO DEBT TILE HERE, deliberately — it was removed rather than lost.
       This page is about what the household is putting away and what that has
       earned; what it owes has a page of its own, and the composition chart
       directly below already states the same liabilities figure inside the net
       worth it breaks down. On a vault with no debts the tile was a red
       "R 0,00" sitting in a strip of savings figures, which reads as a warning
       about nothing. The definition it used — worth()'s liabilities, accounts
       and debt page together — is the one that survives, on the chart and on
       Debts; nothing about "one definition of owed" depended on this tile. */

    renderStaleNote();
    renderWorth();
    renderGrowth(entries);

    renderGoals();
    renderSections(savings, investments, idx);
  }

  /* ------------------------- what it has earned --------------------------
     Everything below reads totalReturn(), which works BACKWARDS from the
     balance — see the header of savings-math.js. The short version: growth the
     account never posted as a transaction is still growth, and on a
     market-linked fund it is all of it.

     The price is a dependency on `starting_amount`, and every figure here is
     shown with what it depends on rather than alone. */

  const ret = e => totalReturn(e.account, e.rows, poolType, { today: todayIso() });

  /* Is this entry's account stated in the household's own currency? The one
     test the pooled figures on this page are allowed to gate on. */
  const homeEntry = e => !split([e.account]).others.length;

  const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  /* growthTotals itself now lives in savings-math.js (2026-08-29 audit, M4) —
     see that module's own header on `growthTotals` for the `measured`/
     `unmeasured`/`negCapital` reasoning this file used to carry alone. Moved
     out so views/report.js's savingsSummary() calls the SAME function
     instead of re-deriving it: "two figures derived by different rules" is
     this codebase's most-repeated bug shape, and a report whose savings
     section disagreed with this page's own tile would be exactly that shape
     wearing a new hat. */

  /* The tile is drawn even when NOTHING is measurable, saying so. A tile that
     appeared only once a reader had already filled in the field that produces
     it would never tell anyone the field exists — and "—, no account carries a
     starting amount" is a fact about this vault, not an empty state. */
  function growthTile(tile, entries) {
    /* HOME-CURRENCY ENTRIES ONLY. growthTotals pools `growth` and `capitalIn`
       across whatever it is given, and the tile then divides one by the other
       — so on a mixed pool it printed "+11,2% on Rp 903 000 put in", where the
       903 000 was Rp 900 000 and ¥ 3 000 added together. That is not an
       overstated figure, it is a percentage of a quantity that does not
       exist, and no disclosure can rescue it: the only honest move is to take
       the ratio inside ONE currency and say how many accounts that left out.

       Deliberately narrowed HERE rather than inside growthTotals: that
       function is shared with src/report.js's savings section, and it has no
       business learning about currencies when what it actually needs is a
       homogeneous pool. Per-account growth is untouched and correct — an
       account's own return divides its own figures and is currency-neutral by
       construction, which is why the cards below still show a rate for a
       foreign account even though this tile cannot include it. */
    const foreignEntries = entries.filter(e => !homeEntry(e));
    const g = growthTotals(entries.filter(homeEntry), poolType, { today: todayIso() });
    if (!g.total && !foreignEntries.length) return;
    if (!g.measured) {
      /* Names the field AND where to set it — "no account records what it
         started at" told the reader a fact with no way to act on it. The field
         is `starting_amount`, entered as "Starting amount" in an account's
         edit dialog; the same fix is offered per-card below via the "Add
         starting amount" action (see renderActions), so this points at the
         same control rather than inventing a second description of it. */
      return tile('Growth', '—', '', foreignEntries.length
        ? `${foreignEntries.length} account${foreignEntries.length > 1 ? 's are' : ' is'} in another currency — a combined rate would divide one currency by another, so each is shown on its own card below`
        : 'no account has a Starting amount set — use "Add starting amount" on an account below');
    }
    const sub = [
      g.rateCapital > 0 ? `${pct((g.rateGrowth / g.rateCapital) * 100)} on ${money(g.rateCapital, 0)} put in` : null,
      g.unmeasured ? `${g.unmeasured} of ${g.total} missing a starting amount or date` : null,
      g.negCapital ? `${g.negCapital} taken out more than put in — left out of the rate` : null,
      /* Named, never silently dropped — currency.js:14 is explicit that this
         app does not exclude, and an account left out of a rate with nothing
         said about it is an exclusion however good the reason. Each card
         below still shows that account's own return in its own currency. */
      foreignEntries.length
        ? `${foreignEntries.length} in another currency — each shown on its own card below`
        : null,
    ].filter(Boolean).join(' · ');
    tile('Growth', `${g.growth >= 0 ? '▲' : '▼'} ${money(Math.abs(g.growth))}`,
      g.growth >= 0 ? 'text-success' : 'text-danger', sub || null);
  }

  /* Reconciliation "Use this" button below calls ctx.acceptImplied directly —
     see views/accounts.js's acceptImplied, published on ctx so this page and
     Accounts share the one implementation (stamp the last row the figure
     absorbed, so those rows cannot be counted a second time WITHOUT burying
     the days between them and now; back the mutation out on a failed write).
     The verdict is passed along with the figure because the stamp is derived
     from the rows it counted. */

  /* ----------------------- how old is this number ------------------------
     Net worth is a sum of figures the reader TYPED, and the Accounts page
     labels those very same figures "unconfirmed 118 days". Stating the total
     here as fact while the page next door calls its inputs provisional is the
     disagreement that makes a reader stop trusting both.

     Deliberately a caveat rather than a warning, and never a reason to hide the
     figure: an old balance is still the best answer anyone has. It just should
     not be printed in gradient text as though it were measured this morning. */
  /* An asset value goes stale on a year's clock, not the 30 days a bank
     balance does — see the header of views/assets.js. Reported as its own line
     rather than folded into the account count above: the two say "unconfirmed"
     about different lengths of time, and one sentence covering both would be
     true of neither.

     The THRESHOLD is read from views/assets.js's own `VALUED_STALE_DAYS`
     rather than hand-declared here a second time — assets.js's header says
     this file exists specifically so nothing else re-declares that number,
     and until now this was the one place that still did. Read through
     `ctx.VALUED_STALE_DAYS` rather than destructured at registration time:
     views/assets.js registers AFTER this module (see controller.js), so the
     key does not exist on `ctx` yet when `registerSavings(ctx)` runs — the
     same registration-order trap this file's own header names for
     saveAccount/acceptImplied above, hit a second time.

     The `a.value > 0` clause DOES stay, and deliberately diverges from
     assets.js's own `isStaleValuation`, which has no such guard. The two
     predicates answer different questions on purpose: assets.js is asking
     "is this row's date current", and a R0 house with a year-old date is a
     real answer to that. This caveat is asking "how much of what you own is
     resting on a stale figure", stated in Rand ("R X of what you own...") —
     and a zero-valued asset owns nothing, so counting it here would either
     pad the count with an entry that changes no money figure, or — on a
     vault whose only stale asset is worth nothing — surface a caveat reading
     "R 0,00 of what you own was last valued over a year ago", which is not a
     sentence that helps anyone. So a zero-valued stale asset is real and
     visible on the Assets page (where the question is "is the date good")
     and silent here (where the question is "how much money is at stake") —
     two pages counting different rows on purpose, not by drift.

     The DATED half of the test is reconcile.js's `isStaleValuation` now, not a
     third hand-written `d > VALUED_STALE_DAYS`. That expression is false for a
     NEGATIVE d, so a `valued:` date typed into the future read as a fresh
     valuation here and on the Assets page both — the exact hole 1.23.1 closed
     for a bank balance in reconcile() and stalenessSummary(), still open in
     the two functions that ask the same question about a valuation. One rule,
     one spelling; the THRESHOLD still comes from assets.js through ctx, so
     the number stays where its own header says it lives.

     The UNDATED half stays local and stays this page's own: an unreadable or
     absent Valued date is money resting on a figure nobody has checked, which
     is exactly what this sentence is counting, whereas the Assets page states
     it as a separate claim ("has never been valued") because its question is
     about the date rather than the money. */
  function staleAssets() {
    return (S.assets || []).filter(a => {
      /* FOREIGN ROWS OUT. The sentence this feeds prints one figure in the
         household's symbol — "R 2 300 000 of what you own was last valued over
         a year ago" — and R2 000 000 plus €300 000 is not R2 300 000. The
         euro rows are named beside it instead (see renderAssetCaveat), the
         same trade every other total on this page makes. */
      if (isForeign(a, S.settings.currency)) return false;
      /* Unreadable date (null) counts as stale HERE — this sentence is about
         money at stake, and a valuation nobody can date is money at stake;
         isStaleValuation() itself answers false for null because assets.js
         names "date unreadable" as its own state. Everything datable goes
         through the shared rule, so a future-dated typo reads stale on both
         pages by the same test. */
      const d = daysSince(a.valued);
      return (d === null || isStaleValuation(a.valued, null, ctx.VALUED_STALE_DAYS)) && a.value > 0;
    });
  }

  /* The euro half of the same question, per symbol, so the sentence above can
     NAME what it left out rather than dropping it — currency.js:10 is explicit
     that this app does not exclude silently. Same predicate, same clock, same
     `a.value > 0` rule; only the currency test is inverted. */
  function staleAssetsOther() {
    const by = new Map();
    for (const a of S.assets || []) {
      if (!isForeign(a, S.settings.currency)) continue;
      const d = daysSince(a.valued);
      const stale = d === null || isStaleValuation(a.valued, null, ctx.VALUED_STALE_DAYS);
      if (!stale || !(a.value > 0)) continue;
      const sym = symbolOf(a, S.settings.currency);
      by.set(sym, (by.get(sym) || 0) + a.value);
    }
    return [...by].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]);
  }

  function renderStaleNote() {
    const wrap = $('#savingsStale'); wrap.empty();
    renderAssetCaveat(wrap);
    const s = stalenessSummary(S.accounts);
    if (!s.stale) return;

    const all = s.stale === s.total;
    const line = all
      ? `Built from ${s.total === 1 ? 'a balance' : `${s.total} balances`} nobody has confirmed recently`
      : `Built from ${s.stale} of ${s.total} balances nobody has confirmed recently`;
    // oldestDays is null when every stale account is stale for want of a date
    // at all — "never confirmed" is the honest phrasing there, not "0 days".
    const age = s.oldestDays === null
      ? 'none of them carry a date'
      : `the oldest ${s.oldestDays} days ago`;

    const note = el('div', { class: 'kpi-caveat-txt' },
      icoEl(['info', 'alert-circle']), `${line} — ${age}.`);
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review account balances on the Accounts page' }, 'Review balances');
    btn.addEventListener('click', () => ctx.switchView('accounts'));
    /* Redesign mockup B ("Net worth is the hero"): the sentence between the
       tiles and the composition bar becomes a compact bordered banner with
       its own action inside it, rather than a paragraph with a button
       trailing loose after it. `note` and `btn` are unchanged — same
       `kpi-caveat-txt`/`kpi-caveat-btn` classes the guard tests key on
       (byCls walks INTO this wrapper) — only the enclosing `sav-banner`
       shell is new; see src/_redesign/savings.css. */
    wrap.append(el('div', { class: 'sav-banner sav-banner-warn' }, note, btn));
  }

  /* Named separately from the balances caveat and shown before it, because an
     out-of-date house valuation is usually the single largest input to the
     figure printed above and the reader should meet it first. */
  function renderAssetCaveat(wrap) {
    const stale = staleAssets();
    const otherStale = staleAssetsOther();
    if (!stale.length && !otherStale.length) return;
    const owned = stale.reduce((t, a) => t + a.value, 0);
    /* TWO SENTENCES, NEVER ONE SUM — the same shape views/assets.js's own
       caveat takes, and for the same reason: R2 000 000 plus €300 000 is not
       R2 300 000, and this line prints ONE figure in the household's symbol.
       The foreign rows are named after it, unconverted, rather than folded in
       or dropped. ("Last valued over a year ago" covers a date that is absent,
       unreadable, past the year or ahead of today — all four mean the same
       thing to a reader deciding whether to trust the total above, which is
       what this line is for.) */
    const bits = [];
    if (stale.length) {
      bits.push(`${money(owned, 0)} of what you own was last valued over a year ago.`);
    }
    if (otherStale.length) {
      bits.push(stale.length
        ? `A further ${otherList(otherStale)} of it is held in other currencies, not converted.`
        : `${otherList(otherStale)} of what you own, all of it held in other currencies, was last valued over a year ago.`);
    }
    const note = el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      bits.join(' '));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review asset valuations on the Assets page' }, 'Review valuations');
    btn.addEventListener('click', () => ctx.switchView('assets'));
    // Same compact banner shell as renderStaleNote's own caveat, for the same
    // reason: two paragraphs with a trailing button apiece used to sit one
    // above the other with nothing telling them apart from body copy.
    wrap.append(el('div', { class: 'sav-banner sav-banner-warn' }, note, btn));
  }

  function renderGoals() {
    /* `> 0`, not truthy: a negative `goal_amount` (a typo, or a hand-edited
       file) passed the truthy filter, clamped `pct` to 0 below, and then
       `a.balance >= a.goal_amount` was true for ANY balance — a goal nobody
       could miss, reading "Goal reached!" on an account with nothing in it. */
    const withGoals = S.accounts.filter(a => a.goal_amount > 0);
    const goalsWrap = $('#savingsGoals'); goalsWrap.empty();
    if (!withGoals.length) {
      /* Names the CONTROL, not the frontmatter key it writes — the key is
         still hand-editable, but sending a reader to YAML when a real dialog
         field exists (en.js's own acct.field.goalOpt, "Savings goal
         (optional)") reads as the app admitting it has no UI for its own
         feature. Same reasoning as dash.health.setup's own comment. A button
         is offered too, the same way the staleness caveat below routes to
         Accounts, because "on the Accounts page" is not a real next step
         without one. */
      goalsWrap.append(el('p', { class: 'text-muted', style: 'margin:0 0 10px' },
        'No goals set yet. Open a savings or investment account on the Accounts page and set its ' +
        'Savings goal field to track progress here.'));
      const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
        'aria-label': 'Go to the Accounts page to set a savings goal' }, 'Go to Accounts');
      btn.addEventListener('click', () => ctx.switchView('accounts'));
      goalsWrap.append(btn);
    } else {
      const g = el('div', { class: 'goals' });
      for (const a of withGoals) {
        const pct = Math.min(100, Math.max(0, (a.balance / a.goal_amount) * 100));
        const reached = a.balance >= a.goal_amount;
        /* A goal bar divides the same unconfirmed balance the caveat above is
           about. Marked rather than hidden — "62% of the way there, as of
           April" is still worth knowing, and a bar that silently vanishes when
           a balance ages is a worse answer than one that admits its age. */
        const stale = isStale(a.balance_updated);
        /* Floored, and capped one short of 100, unless the goal is actually
           reached — `Math.round` on 99.6% printed "100%" beside a bar that was
           not full and a `reached` flag that was false, the one combination
           that should never appear together on a progress bar. */
        const pctLine = reached ? 'Goal reached'
          : `${Math.min(99, Math.floor(pct))}%${a.target_date ? ' · target ' + a.target_date : ''}`;
        g.append(el('div', {},
          el('div', { class: 'goal-h' },
            el('div', { class: 'gn' }, a.name),
            el('div', { class: 'gv' }, el('b', {}, acctMoney(a, a.balance)), ' / ', acctMoney(a, a.goal_amount))),
          el('div', { class: `cat-bar${stale ? ' cat-bar-stale' : ''}` },
            el('i', { class: 'cat-bar-fill', style: `width:${pct}%` })),
          el('div', { class: 'goal-pct' }, pctLine,
            ...(stale ? [el('span', { class: 'goal-stale' }, ' · balance unconfirmed')] : []))));
      }
      goalsWrap.append(g);
    }
  }

  function renderSections(savings, investments, idx) {
    const wrap = $('#savingsSections'); wrap.empty();
    /* The loop below `continue`s past whichever of the two lists is empty —
       right when exactly one of them has accounts, so the page doesn't print
       an empty "Investments" section header for a household with none. But
       nothing covered the case where BOTH are empty: the loop then runs zero
       iterations and this whole page section — the page's own subject —
       renders nothing at all, no explanation and no next step, right below a
       Goals card that already handles its own empty case. Caught here,
       before the loop, rather than folded into it. */
    if (!savings.length && !investments.length) {
      const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
        'aria-label': 'Go to the Accounts page to add a savings or investment account' }, 'Go to Accounts');
      btn.addEventListener('click', () => ctx.switchView('accounts'));
      wrap.append(el('div', { class: 'card mb-4' },
        el('div', { class: 'body-pad' },
          el('p', { class: 'text-muted', style: 'margin:0 0 10px' },
            'No savings or investment accounts yet. Add one on the Accounts page and its balance, ' +
            'goal and growth will appear here.'),
          btn)));
      return;
    }
    for (const [title, list] of [['Savings', savings], ['Investments', investments]]) {
      if (!list.length) continue;
      /* VARIANT B of the redesign mockup (budget-redesign.html, "List rows,
         actions on open"): each account is a scannable balance row rather
         than a five-button card. Every figure and every action below is
         UNCHANGED from the card layout — this only changes where on the page
         it is drawn and when it is visible. `sav-list` replaces `mini-grid`;
         see src/_redesign/savings.css. */
      const listEl = el('div', { class: 'sav-list' });
      /* The section header's own subtotal — split like every other total on
         this page. It used to add every balance in the group, which put
         "Rp 1 003 956" at the head of a card whose own Accounts-page twin
         reads "Rp 1 000 000 plus ¥ 3 956". */
      const { others: listOthers } = split(list);
      const total = homeOnly(list);
      for (const a of list) {
        const kind = [a.type.replace('_', ' '), a.institution].filter(Boolean).join(' · ');
        const rows = (idx.get(a) || {}).rows || [];
        const flows = accountFlows(a, rows, poolType);
        const r = ret({ account: a, rows });
        const rec = reconcile(a, rows);

        /* An account carrying nothing yet — R0 and no starting amount — is the
           mockup's third row: no flows, no match state, just the one action
           that gets it out of that state. Tested the same way renderActions
           below decides whether to lead with "Add starting amount". */
        const empty = r.basis === 'none' && flows.basis !== 'derived' && flows.basis !== 'stated'
          && !a.balance && !a.inception_date;

        /* The compact growth chip on the row itself — same figure and same
           colour rule as the card's own `▲`/`▼` span, just without the rest of
           the return breakdown beside it. Prefers the total-return figure
           (r.growth) when the account has one, falling back to the derived
           flows growth so a fund with no starting amount still shows what its
           card used to show inline. */
        const chipGrowth = r.basis !== 'none' ? r.growth
          : (flows.basis === 'derived' ? flows.growth : null);

        /* The one-line match status, reworded to fit a row rather than a
           card: same three `rec.state`s, same wording as the card's own
           `.acct-recon-txt`, just shorter — "matches" / a warning / a drift
           count, never "checked" for a state the card itself refuses to
           paint green. */
        const matchLine = rec.state === 'drift'
          ? `${rec.count} unmatched`
          : rec.state === 'clean' && rec.unreadable
            ? `${rec.unreadable} unreadable`
            : rec.state === 'clean'
              ? '✓ matches'
              : null;

        const balEl = el('div', { class: 'num sav-row-bal' }, acctMoney(a, a.balance));
        if (empty) balEl.classList.add('text-muted');

        const subParts = [el('span', {}, kind)];
        if (chipGrowth) {
          subParts.push(el('span', { class: `num sav-row-chip ${chipGrowth >= 0 ? 'text-success' : 'text-danger'}` },
            `${chipGrowth >= 0 ? '▲' : '▼'} ${acctMoney(a, Math.abs(chipGrowth), 0)}`));
        } else if (empty) {
          subParts.push(el('span', { class: 'sav-row-warn' }, 'no starting amount'));
        }

        const row = el('button', { type: 'button', class: 'sav-row', 'aria-expanded': 'false',
          'aria-label': `${a.name}, ${acctMoney(a, a.balance)}. Show account actions.` },
          el('div', { class: 'sav-row-main' },
            el('div', { class: 'sav-row-name' }, a.name),
            el('div', { class: 'sav-row-sub' }, ...subParts)),
          el('div', { class: 'sav-row-end' },
            balEl,
            matchLine ? el('div', {
              class: `sav-row-status${rec.state === 'drift' || (rec.state === 'clean' && rec.unreadable) ? ' text-warning' : ' text-success'}`,
            }, matchLine) : el('div', { class: 'sav-row-status' })));

        const detail = el('div', { class: 'sav-detail hidden' });
        if (!empty) {
          row.addEventListener('click', () => {
            const open = !detail.classList.contains('hidden');
            detail.classList.toggle('hidden', open);
            row.setAttribute('aria-expanded', open ? 'false' : 'true');
          });
        } else {
          row.removeAttribute('aria-expanded');
        }

        /* card = the detail panel's own body. What follows is IDENTICAL to
           the card body the previous layout always showed — the return
           breakdown, the derived-flows line, the caveats, the reconciliation
           line — just appended to `detail` instead of a `.mini` card, and
           only built (and rendered) once the row is opened.

           This block keeps the name `card` on purpose: every comment below it
           — in renderReturn, in the derived/stated branches, in the
           reconciliation block — refers to "the card" as the thing being
           appended to, and renaming it would desync every one of those
           comments from the code they describe for no behavioural gain.

           `mini` stays as a SECOND class on the same element, alongside
           `sav-detail` — tests/savings-cards.test.cjs and
           tests/savings-account-type-casing.test.cjs both key a card's
           content by walking `.mini` under #savingsSections and reading its
           FIRST child's text as the account name, exactly the shape the old
           `.mini` card had (`.l` was that first child). The name anchor below
           reproduces that shape so those guards keep pinning the same
           invariants against the new markup rather than needing a rewrite
           this lane isn't scoped to do. */
        const card = detail;
        card.classList.add('mini');
        card.append(el('div', { class: 'l hidden-visually' }, a.name));
        /* The balance-edit control — same one-field dialog the Accounts page
           uses, same `.v num` class the old card gave it (so the hover, the
           focus ring and its iOS-15 `:focus` fallback all still apply), just
           relocated into the sheet rather than sitting as the card's own
           headline. The row above already SHOWS the balance; this is where
           editing it now lives, one tap after the row that shows it. */
        const balBtn = el('button', { type: 'button', class: 'v num',
          'aria-label': `Update the balance of ${a.name}, currently ${acctMoney(a, a.balance)}` },
        acctMoney(a, a.balance));
        balBtn.addEventListener('click', () => ctx.editBalance(a));
        card.append(balBtn);
        /* What the balance is MADE of, derived from the account's own
           transactions: contributions are money the household put in, growth is
           what the account earned on its own. The old single figure —
           `balance − total_invested` — called the whole difference growth, and
           since nothing keeps total_invested in step with a debit order, every
           contribution was reported as performance.

           `rows`, `flows`, `r` and `rec` are computed once above — before the
           row itself, so the compact chip and match line on the closed row can
           read them too — and reused here rather than recomputed. */

        /* Where the account records what it STARTED at, the total-return block
           below supersedes the contributions line — the two state different
           "in" figures (net capital against contributions alone) and printing
           both puts two answers to one question on one card.

           Where it does not, nothing changes: the derived split is still the
           best the vault can do, and every disclosure it carries is still the
           one it always was. */
        if (r.basis !== 'none') {
          renderReturn(card, a, r);
        } else if (flows.basis === 'derived') {
          const g = flows.growth;
          const line = el('div', { class: 's2' }, `put in ${acctMoney(a, flows.contributions, 0)}`);
          /* A zero growth figure is NOT a measurement of zero growth — it means
             nothing in this account posted a transaction the vault could read as
             growth. A unit trust normally posts none at all: the market moves,
             the balance is retyped, and no row is ever written. Printing "▲ R0"
             in green against that claims the fund went nowhere, which on the
             page named after these accounts is the worst place to guess. So the
             chip appears only when there is something to report. */
          if (g) {
            line.append(' · ', el('span', { class: `num ${g >= 0 ? 'text-success' : 'text-danger'}` },
              `${g >= 0 ? '▲' : '▼'} ${acctMoney(a, Math.abs(g), 0)}`));
          }
          if (flows.withdrawals) line.append(` · taken out ${acctMoney(a, flows.withdrawals, 0)}`);
          card.append(line);

          /* And say so outright where the silence is most likely to mislead.
             Only for investments, and only when no growth was recorded at all —
             a savings account crediting monthly interest has a real figure
             above and needs no explanation of one it does not have. */
          if (typeIs(a, 'investment') && !g) {
            card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
              'no growth recorded — it is inside the balance, not measured here',
              'Growth only appears here when the account posts it as a transaction the vault can read. '
                + 'A fund whose value moves with the market posts nothing, so its growth is inside the balance '
                + 'you typed rather than in this line.')));
          }
          /* Growth is recognised by category TYPE, and income the household
             EARNED and then deposited here is income-type too — counselling
             fees paid into a savings account, a salary routed straight to it.
             Neither is growth: the household put that money in, the account did
             not earn it. Nothing in the data tells the two apart.

             So the categories are named ON the card rather than in a tooltip.
             On the vault this was built against, one account's growth was 41%
             counselling income — an error big enough that hiding it behind a
             hover would have been the same silent overstatement this whole
             change set out to end.

             Named whenever ANY category fed the figure, including a single one.
             Gating this at "more than one" withheld the disclosure in precisely
             the case that needs it most: where one category IS the whole figure,
             a wrong one makes the growth 100% wrong rather than 41% wrong — the
             card read "▲ R9 000" of consulting fees with nothing beside it. A
             redundant "growth from Interest R120" on the honest account is a
             cheap price for closing that. */
          if (flows.growthCategories.length) {
            card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
              'growth from ' + flows.growthCategories.map(c => `${c.cat} ${acctMoney(a, c.amount, 0)}`).join(', '),
              'Anything here that is not interest or dividends is really a contribution. '
                + 'Recategorise the rows, or change the category\'s type, and this figure corrects itself.')));
          }
        } else if (flows.basis === 'stated') {
          /* No transactions for this account, so the hand-typed baseline is the
             only signal there is. Shown, but never called derived. */
          const over = flows.growth;
          card.append(el('div', { class: `s2 num ${over >= 0 ? 'text-success' : 'text-danger'}` },
            `${over >= 0 ? '▲' : '▼'} ${acctMoney(a, Math.abs(over), 0)} vs ${acctMoney(a, flows.opening, 0)} in`));
          card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
            'based on the account file, not transactions',
            'No transactions in the vault for this account, so this is the balance less what the '
              + 'account file records as put in. Import its statements and the split becomes real.')));
        } else if (a.inception_date) {
          card.append(el('div', { class: 's2' }, `since ${a.inception_date}`));
        }

        /* Reconciliation — the same argument the Accounts page makes, on the
           page where the balance is largest and least often confirmed. */
        if (rec.state === 'drift') {
          const line = el('div', { class: 'acct-recon' },
            el('div', { class: 'acct-recon-txt' },
              `${rec.count} since · they add up to `, el('b', { class: 'num' }, acctMoney(a, rec.implied)),
              rec.ahead ? ` · ${rec.ahead} dated ahead` : ''));
          const btn = el('button', { type: 'button', class: 'acct-recon-btn',
            'aria-label': `Set ${a.name} balance to ${acctMoney(a, rec.implied)}` }, icoEl(['check']), 'Use this');
          btn.addEventListener('click', () => ctx.acceptImplied(a, rec.implied, rec));
          line.append(btn);
          card.append(line);
          /* On a fund the implied figure is a FLOOR, not a correction, and the
             difference is the growth. An account confirmed at R200 000 that has
             taken three R2 000 debit orders since implies R206 000 — while the
             real balance, market included, is R214 000. Accepting that offer
             quietly writes off R8 000 and stamps the result as confirmed.

             The button stays: a fixed deposit that posts its interest as a real
             transaction reconciles exactly, and taking the offer away from those
             accounts to protect the others helps nobody. What it gets is the one
             sentence that stops it reading as a correction. */
          if (typeIs(a, 'investment')) {
            card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
              'added up from recorded movements only — growth is not in it',
              'The implied figure adds up recorded movements only. Growth that never posted a '
                + 'transaction is not in it, so on a market-linked fund this figure is a floor rather '
                + 'than a correction — take it only if your provider agrees.')));
          }
        } else if (rec.state === 'clean' && rec.unreadable) {
          /* `clean` means "nothing READABLE has moved" (reconcile.js) — it is
             not agreement while rows the app cannot date exist. The Accounts
             page refuses to paint green here (acct-status's `unreadable`
             state); this card must refuse too, or the page where the balance
             is largest and least often confirmed is the one that says
             "matches" over money it never checked. */
          card.append(el('div', { class: 'acct-recon' },
            el('div', { class: 'acct-recon-txt text-warning' },
              `${rec.unreadable} transaction${rec.unreadable === 1 ? '' : 's'} carr${rec.unreadable === 1 ? 'ies' : 'y'} a date this app cannot read — not checked against them`)));
        } else if (rec.state === 'clean') {
          card.append(el('div', { class: 'acct-recon' },
            el('div', { class: 'acct-recon-txt text-success' }, 'Matches your transactions')));
        }

        /* The action sheet — same five actions, same handlers, same labels as
           the card layout's `.acct-drawer-acts` had, just appended into the
           row's own detail panel instead of always being on screen. An empty
           account (see `empty` above) skips the sheet altogether: the mockup
           shows only the one action it needs, inline, rather than opening a
           sheet to reach it. */
        if (empty) {
          const btn = el('button', { type: 'button', class: 'acct-drawer-act sav-row-solo-act',
            'aria-label': `Add a starting amount and opening date for ${a.name}` }, 'Add starting amount');
          btn.addEventListener('click', () => ctx.editAccount(a));
          const item = el('div', { class: 'sav-item' }, row, btn);
          listEl.append(item);
          continue;
        }

        renderActions(card, a, r, (idx.get(a) || {}).labels);
        const item = el('div', { class: 'sav-item' }, row, detail);
        listEl.append(item);
      }
      wrap.append(el('div', { class: 'card mb-4' },
        el('div', { class: 'card-h' },
          el('div', {}, el('h2', {}, title), el('div', { class: 'sub' }, `${list.length} account${list.length === 1 ? '' : 's'}`)),
          el('div', { class: 'legend' }, el('span', {}, el('b', { class: 'num', style: 'font-size:15px;color:var(--text-primary)' }, money(total)),
            ...(listOthers.length ? [el('span', { class: 'acct-group-other' }, ` ${otherTag(listOthers)}`)] : [])))),
        el('div', { class: 'body-pad' }, listEl)));
    }
  }

  /* What was put in, what it earned, and what that is worth as a rate. One
     `.s2` line in the shape the card already used, a bar, and the rate. */
  function renderReturn(card, a, r) {
    const up = r.growth >= 0;
    /* `capitalIn` can be legitimately negative — more has been withdrawn than
       was ever put in — and "in -R30 000" reads as a typo, not a fact.
       returnBar() already refuses to draw a bar for this case; the line gets
       the same relabelling rather than printing a negative "in" figure. */
    const line = el('div', { class: 's2' }, r.capitalIn > 0
      ? `put in ${acctMoney(a, r.capitalIn, 0)}`
      : `${acctMoney(a, Math.abs(r.capitalIn), 0)} taken out more than put in`);
    /* Withdrawals are ALREADY netted out of capitalIn, so this names them
       rather than subtracting them a second time — a card reading "put in
       R150 000 · taken out R20 000" invites exactly that arithmetic. */
    if (r.capitalIn > 0 && r.withdrawals) line.append(` after ${acctMoney(a, r.withdrawals, 0)} taken out`);
    line.append(' · ', el('span', { class: `num ${up ? 'text-success' : 'text-danger'}` },
      `${up ? '▲' : '▼'} ${acctMoney(a, Math.abs(r.growth), 0)}`));
    card.append(line);

    const bar = returnBar(a, r);
    if (bar) card.append(bar);

    const bits = [];
    if (r.returnPct !== null) bits.push(`${pct(r.returnPct)} total`);
    /* Marked "≈" wherever it appears, and explained on hover. It is not
       money-weighted — a contribution made last month is treated as though it
       had been invested since the start — and savings-math.js withholds it
       under a year entirely rather than annualising noise. */
    if (r.annualisedPct !== null) bits.push(`≈ ${pct(r.annualisedPct)} a year`);
    if (r.since) bits.push(`since ${r.since}`);
    if (bits.length) {
      /* Marked "≈" wherever it appears, and — now — explained on tap as well
         as on hover: the whole line carried the caveat before, so the whole
         line is what becomes tappable, same as it was reachable as a whole
         under a mouse. */
      card.append(el('div', { class: 's2' }, r.annualisedPct !== null
        ? caveatChip(bits.join(' · '),
          'The yearly rate is approximate: it assumes every contribution was invested from the '
            + 'start, which a monthly debit order never is. Treat it as a shape, not a quote.')
        : bits.join(' · ')));
    }

    /* The disclosure that matters most, first. A history starting after the
       account did undercounts contributions, and every rand it misses is
       reported as growth — the error runs in the flattering direction, which is
       the one a reader is least likely to question. */
    if (r.trust === 'history-gap') {
      card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
        `records begin ${r.gapDays} days after it opened — growth may be overstated`,
        'Contributions made before your records start are not in the figure above, so they are '
          + 'counted as growth instead. Import the account\'s earlier statements, or correct its '
          + 'opening date, and the split corrects itself.')));
    }

    /* The mirror case. Transactions exist BEFORE the stated opening date, so
       either that date is wrong or the starting amount is not the balance at
       it. Those rows are deliberately left out of the capital sum — the
       starting amount already contains them — but if the date is the thing
       that is wrong, real contributions are being ignored and growth is
       understated. Disclosed for the same reason the flattering direction is:
       the reader is the only one who knows which of the two is true. */
    if (r.trust === 'pre-inception') {
      card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
        `records begin ${Math.abs(r.gapDays)} days before its opening date`,
        'This account has transactions dated before the opening date you gave it. The starting '
          + 'amount is treated as the balance on that date, so those earlier rows are not counted again. '
          + 'If the opening date is wrong, correct it and the split corrects itself.')));
    }

    if (r.basis === 'stated') {
      card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
        'based on the account file, not transactions',
        'No transactions in the vault for this account, so this is the balance less what the '
          + 'account file records as put in. Import its statements and the split becomes real.')));
    } else if (r.undatedGrowth && typeIs(a, 'investment')) {
      /* Named because the chart above cannot draw it. A fund's value moved every
         day for years and the vault holds one number — today's — so this growth
         is real, is in the balance, and has no date anywhere. */
      card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
        'includes growth no transaction recorded',
        'Your fund never posted this as a transaction — the value moved and the balance was '
          + 'retyped. It is real growth, but it carries no date, so the chart above cannot show when '
          + 'it happened.')));
    }

    /* Unchanged in force from the derived path: growth is recognised by category
       TYPE, so income the household EARNED and deposited here counts as growth
       and nothing in the data tells the two apart. Named whenever any category
       fed the figure, including a single one. */
    if (r.growthCategories.length) {
      card.append(el('div', { class: 's2 s2-caveat' }, caveatChip(
        'growth from ' + r.growthCategories.map(c => `${c.cat} ${acctMoney(a, c.amount, 0)}`).join(', '),
        'Anything here that is not interest or dividends is really a contribution. '
          + 'Recategorise the rows, or change the category\'s type, and this figure corrects itself.')));
    }
  }

  /* Capital against growth, on the existing .acct-mbar. A LOSS is drawn as what
     survives of the capital rather than as a growth segment of negative width:
     the bar is a quantity read against itself, and there is no honest way to
     draw "minus R1 200" beside "R32 400". */
  function returnBar(a, r) {
    if (!(r.capitalIn > 0)) return null;
    const bar = el('span', { class: 'acct-mbar acct-mbar--split' });
    if (r.growth >= 0) {
      const inPct = (r.capitalIn / (r.capitalIn + r.growth)) * 100;
      bar.setAttribute('title',
        `${acctMoney(a, r.capitalIn, 0)} put in · ${acctMoney(a, r.growth, 0)} earned`);
      bar.append(el('i', { class: 'seg-in', style: `width:${inPct.toFixed(1)}%` }),
        el('i', { class: 'seg-growth', style: `width:${(100 - inPct).toFixed(1)}%` }));
    } else {
      const leftPct = Math.max(0, Math.min(100, (r.balance / r.capitalIn) * 100));
      bar.setAttribute('title',
        `${acctMoney(a, r.balance, 0)} left of ${acctMoney(a, r.capitalIn, 0)} put in`);
      bar.append(el('i', { class: 'seg-in', style: `width:${leftPct.toFixed(1)}%` }),
        el('i', { class: 'seg-growth neg', style: `width:${(100 - leftPct).toFixed(1)}%` }));
    }
    return bar;
  }

  /* The actions, on the class the Accounts drawer uses — same dialogs, same
     handlers, same labels as the card layout always had. Variant B of the
     redesign mockup fences Delete below a divider inside the sheet rather
     than putting it in the wrapping five-across row; `sav-sheet-fence`
     carries just that spacing/border, in src/_redesign/savings.css, layered
     on top of the unchanged `acct-drawer-act`/`acct-drawer-del` classes so
     hover, focus-visible and its iOS-15 `:focus` fallback all still apply. */
  function renderActions(card, a, r, labels) {
    const acts = el('div', { class: 'acct-drawer-acts sav-sheet-acts' });
    const act = (label, aria, run) => {
      const b = el('button', { type: 'button', class: 'acct-drawer-act', 'aria-label': aria }, label);
      b.addEventListener('click', run);
      acts.append(b);
    };
    /* First when it is the thing standing between this card and a growth
       figure — an account that cannot be measured should lead with the fix,
       not bury it behind a generic Edit. */
    if (r.basis === 'none') {
      act('Add starting amount', `Add a starting amount and opening date for ${a.name}`,
        () => ctx.editAccount(a));
    }
    act('Edit', `Edit ${a.name}`, () => ctx.editAccount(a));
    const primary = labels && [...labels][0];
    if (primary) act('Transactions', `Show transactions for ${a.name}`,
      () => ctx.openAccountTransactions(primary));
    act('Open note', `Open the note for ${a.name}`, () => ctx.openAccountFile(a));
    card.append(acts);
    /* Same dialog the Accounts drawer opens — one delete for an account in this
       plugin, not two that drift apart on what they say about the transactions
       folder. Fenced below the rest of the sheet by its own divider, so it is
       never the button a thumb reaches for by accident. */
    const del = el('button', { type: 'button', class: 'acct-drawer-act acct-drawer-del sav-sheet-fence',
      'aria-label': `Delete the account ${a.name}` }, 'Delete');
    del.addEventListener('click', () => ctx.deleteAccount(a));
    card.append(del);
  }

  /* --------------------- what built this balance -------------------------
     Two stacked bands over time: what the household put in, and the growth the
     accounts actually posted. Plus, at the right edge and deliberately set
     APART from them, the growth nobody dated.

     That separation is the whole design. A market-linked fund's value moved
     every day for four years and the vault holds exactly one number — today's.
     Spreading it back across the months would draw a curve out of a single
     measurement, which is the invention this entire module exists to avoid. So
     it is a block at "now", labelled, sitting on top of the stack it belongs
     to: the three still sum to the balance on the cards below.

     Bumped per render, for the clipPath ids — same trap renderWorth documents. */
  let growthSeq = 0;

  function renderGrowth(entries) {
    const wrap = $('#savingsGrowth');
    const card = $('#savingsGrowthCard');
    if (!wrap) return;                     // shell without this card mounted
    wrap.empty();

    /* Home-currency entries only, for the same reason growthTile() above
       narrows its pool: growthSeries accumulates `closing`, `baseline` and
       `undated` across whatever it is given, and its stated identity —
       capital + posted + undated = closing — is an identity only inside one
       currency. Excluded accounts are counted and named in the sub-line
       below, never silently dropped. */
    const foreignEntries = entries.filter(e => !homeEntry(e));
    const s = growthSeries(entries.filter(homeEntry), poolType, { today: todayIso() });
    /* Hidden outright rather than shown empty. The Growth tile above already
       says why there is nothing to draw, and a framed blank restates it in the
       space a chart would have occupied. */
    if (card) card.classList.toggle('hidden', s.points.length < 2);
    if (s.points.length < 2) return;

    const css = getComputedStyle(root);
    const pick = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    const cIn = pick('--color-info', '#0ea5e9');
    const cGrow = pick('--color-success', '#22c55e');

    const sub = $('#savingsGrowthSub');
    if (sub) {
      sub.textContent = [
        s.excluded
          ? `${s.excluded} of ${s.included + s.excluded} missing a starting amount or date`
          : `all ${s.included} account${s.included === 1 ? '' : 's'} have a starting amount and date`,
        s.truncatedFrom ? `from ${s.truncatedFrom}` : null,
        foreignEntries.length
          ? `${foreignEntries.length} in another currency, not drawn here`
          : null,
      ].filter(Boolean).join(' · ');
    }
    const totalBox = $('#savingsGrowthTotal');
    if (totalBox) {
      totalBox.empty();
      totalBox.append(el('span', {}, el('b', { class: 'num',
        style: 'font-size:15px;color:var(--text-primary)' }, money(s.closing))));
    }

    const last = s.points[s.points.length - 1];
    const dated = last.capital + last.posted;
    const undated = s.undated;

    const W = 1000, H = 250, padL = 8, padR = 8, padT = 22, padB = 28;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    /* The undated block gets its own column so it cannot be read as the last
       month of a curve. Reserved out of the plot width rather than drawn over
       it — an overlay would sit on top of real months and claim them. */
    const gap = undated ? 16 : 0;
    const blockW = undated ? 78 : 0;
    const plotW = innerW - gap - blockW;
    /* Scaled to the WHOLE series, not just its final point. `capital` is
       contributions less withdrawals and `posted` can go negative in a losing
       month, so the stack is not monotonic: a run that peaked at R180 000
       before a R150 000 house-deposit withdrawal closed at R30 000, the plot
       was scaled to that R30 000, and 32 of 44 points mapped ABOVE padT where
       the worth-wipe clip discarded them silently. The reader saw a flat line
       hugging the floor that materialised out of nowhere near the end. With no
       y-axis and no gridline labels on this chart there is nothing else on
       screen to reveal a wrong scale, so it has to be right here.

       The floor follows for the same reason: a cumulative capital that has
       gone negative belongs on the plot, not below its bottom edge. */
    const stacks = s.points.map(p => p.capital + p.posted);
    const seriesTop = Math.max(...stacks, dated + Math.max(0, undated), dated, 1);
    const seriesFloor = Math.min(0, ...stacks);
    const span = (seriesTop - seriesFloor) * 1.08 || 1;

    const X = i => padL + (i / (s.points.length - 1)) * plotW;
    const Y = v => padT + innerH - ((v - seriesFloor) / span) * innerH;

    const uid = `bud-growth-${++growthSeq}`;
    const listFor = `${money(last.capital, 0)} put in`
      + (last.posted ? `, ${money(last.posted, 0)} of recorded growth` : '')
      + (undated ? `, and ${money(undated, 0)} of growth carrying no date` : '');
    const { svg, add } = createChart({
      w: W, h: H, cls: 'growth-svg',
      label: `What built this balance of ${money(s.closing)}: ${listFor}.`
        + ` From ${s.points[0].month} to ${last.month}.`,
    });
    const defs = add('defs', {});

    const areaFor = (lo, hi) => {
      let d = `M${X(0).toFixed(1)} ${Y(hi(0)).toFixed(1)}`;
      for (let i = 1; i < s.points.length; i++) d += ` L${X(i).toFixed(1)} ${Y(hi(i)).toFixed(1)}`;
      for (let i = s.points.length - 1; i >= 0; i--) d += ` L${X(i).toFixed(1)} ${Y(lo(i)).toFixed(1)}`;
      return `${d} Z`;
    };
    const lineFor = fn => s.points
      .map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(fn(i)).toFixed(1)}`).join(' ');

    const cap = i => s.points[i].capital;
    const stack = i => s.points[i].capital + s.points[i].posted;

    /* The wipe is one clip over BOTH bands: they are adjacent, and growing each
       from its own left edge opens a gap between them for the length of the
       animation — the same reason renderWorth clips rather than animating
       segments. */
    const clip = add('clipPath', { id: `${uid}-wipe` }, defs);
    add('rect', { class: 'worth-wipe', x: padL, y: padT, width: innerW, height: innerH }, clip);
    const band = add('g', { 'clip-path': `url(#${uid}-wipe)` });

    add('line', {
      x1: padL, y1: Y(0), x2: W - padR, y2: Y(0),
      stroke: 'currentColor', 'stroke-opacity': '0.14', 'stroke-width': '1',
    });

    const capArea = add('path', { d: areaFor(() => 0, cap), fill: cIn, 'fill-opacity': '0.55' }, band);
    tip(add, capArea, `Put in: ${money(last.capital)}`);
    if (last.posted) {
      const gArea = add('path', { d: areaFor(cap, stack), fill: cGrow, 'fill-opacity': '0.65' }, band);
      tip(add, gArea, `Growth your accounts recorded: ${money(last.posted)}`);
      add('path', {
        d: lineFor(stack), fill: 'none', stroke: cGrow, 'stroke-width': '2',
        'stroke-linejoin': 'round',
      }, band);
    }
    add('path', {
      d: lineFor(cap), fill: 'none', stroke: cIn, 'stroke-width': '2', 'stroke-linejoin': 'round',
    }, band);

    /* The undated block. Dashed, and separated by a real gap, because the one
       thing it must never look like is a continuation of the curve. */
    if (undated) {
      const x0 = padL + plotW + gap;
      const yTop = Y(dated + undated), yBot = Y(dated);
      const node = add('rect', {
        x: x0, y: Math.min(yTop, yBot), width: blockW, height: Math.max(2, Math.abs(yBot - yTop)),
        fill: cGrow, 'fill-opacity': '0.28', stroke: cGrow, 'stroke-opacity': '0.7',
        'stroke-width': '1.5', 'stroke-dasharray': '4 3', rx: 4,
      }, band);
      tip(add, node, `${money(undated)} of growth that no transaction dated — `
        + 'it is inside the balances you typed, so it can be totalled but not placed in time');
      /* Was a bare "undated" here — its only explanation lived in the <title>
         above, which touch-and-hold reaches and a screen reader never does
         (createChart marks the svg role="img", which collapses every child
         including this text) and a desktop pointer never sees either (the
         HTML tooltip takes over hover, dropping the native title). The
         legend right beside this chart already says it correctly — "Growth
         with no date" — so this now says the same thing rather than a
         second, cryptic phrase for the same block. Two lines, and a smaller
         size, because the full phrase does not fit one line over a 78-unit
         column without running past the chart's right edge: the 1.08
         headroom factor in `span` above reserves enough vertical room for
         the second line, on every series, not just this one. */
      const labelX = x0 + blockW / 2;
      const labelY = Math.min(yTop, yBot) - 7;
      const labelAttrs = {
        x: labelX, 'text-anchor': 'middle', 'font-size': '9.5', 'font-weight': '600',
        fill: 'currentColor', 'fill-opacity': '0.6', 'font-family': 'inherit',
      };
      add('text', { ...labelAttrs, y: labelY - 10 }, band).textContent = 'Growth with';
      add('text', { ...labelAttrs, y: labelY }, band).textContent = 'no date';
    }

    // First and last month, at the two ends. Nothing between them: the shape is
    // the point, and a dense axis on a 60-month series is unreadable on a phone.
    const label = (x, anchor, text) => {
      add('text', {
        x, y: H - 8, 'text-anchor': anchor, 'font-size': '12',
        fill: 'currentColor', 'fill-opacity': '0.5', 'font-family': 'inherit',
      }).textContent = text;
    };
    label(padL, 'start', s.points[0].month);
    label(padL + plotW, 'end', last.month);

    wrap.append(svg);

    const legend = el('ul', { class: 'donut-legend donut-legend--inline' });
    const key = (colour, name, amount) => legend.append(el('li', {},
      el('i', { style: `background:${colour}` }),
      el('span', { class: 'dl-name' }, name),
      el('span', { class: 'dl-val num' }, money(amount, 0))));
    key(cIn, 'Put in', last.capital);
    if (last.posted) key(cGrow, 'Growth recorded', last.posted);
    if (undated) key(cGrow, 'Growth with no date', undated);
    wrap.append(legend);

    /* Named under the chart, not only in the subtitle. An account left out is
       the one thing that could make this disagree with the tiles above, and a
       reader who cannot see that it happened has no way to check. */
    if (s.excluded) {
      /* Not "nothing records what they started at" — an account can carry a
         `total_invested` figure (basis 'stated') and still be excluded here,
         because it has no transactions to hang a date on. The true reason an
         account is left out of THIS chart is always about placement, not
         about whether anything was recorded. */
      wrap.append(el('div', { class: 'kpi-caveat-txt', style: 'margin-top:10px' },
        icoEl(['info', 'alert-circle']),
        `${s.excluded} account${s.excluded === 1 ? '' : 's'} left out — `
        + 'their growth carries no date it can be placed at.'));
    }
  }

  /* --------------------- net-worth composition ---------------------------
     Two stacked bars — what you own, and what you owe — drawn on ONE shared
     scale so their lengths are directly comparable. That shared scale is the
     entire point of the chart: the four KPI tiles above already give the
     figures, and what a number cannot show is that the debt bar is two thirds
     the length of the asset bar.

     Deliberately not a donut. A donut has to take the absolute value of a
     negative balance to draw it, which turns a credit-card debt into a slice
     of net worth that reads as an asset.

     Covers BOTH ledgers — accounts and the Debt page. It used to be scoped to
     accounts alone, disclosed in the subtitle as "the Debt page is tracked
     separately". That was defensible while the KPI above it had the same
     scope, and indefensible once you notice what it does to a reader with a
     bond: a chart captioned "what you own against what you owe" omitting the
     largest thing they owe, with a subtitle as the only warning. A phrase is
     not a disclosure when the number it qualifies is the point of the page. */
  const WORTH_TYPES = [
    ['investment', 'Investments', '--color-investment', '#6f42c1'],
    ['savings', 'Savings', '--color-success', '#22c55e'],
    ['checking', 'Cheque', '--color-info', '#0ea5e9'],
    ['cash', 'Cash', '--color-accent', '#0d9488'],
    ['credit_card', 'Credit cards', '--color-danger', '#f43f5e'],
    ['other', 'Other', '--ink-faint', '#5f6779'],
  ];

  /* Colours for a type this list has never heard of — walked in order so the
     same unlisted type keeps the same colour between renders, exactly as the
     debt and asset walks below do. */
  const EXTRA_VARS = ['--color-warning', '--color-investment', '--color-info', '--ink-faint'];
  const EXTRA_FALLBACKS = ['#f5a524', '#6f42c1', '#0ea5e9', '#5f6779'];

  function renderWorth() {
    const wrap = $('#savingsWorth'); wrap.empty();
    const css = getComputedStyle(root);

    /* Split by SIGN, not by type: a cheque account overdrawn is a liability
       however it is labelled, and a credit card in credit is an asset.

       The grouping itself is worth.js's, not a filter written here, because a
       filter written here is what let an account of an unlisted type sit inside
       the net-worth tile and be absent from this chart — two net worths on one
       screen. Every account the vault holds now reaches a segment; a type this
       file has no label for keeps its own name and takes a walked colour. */
    const meta = new Map(WORTH_TYPES.map(([type, label, varName, fallback]) => [type, {
      label, color: (css.getPropertyValue(varName) || '').trim() || fallback,
    }]));
    /* Memoised BY TYPE, not by position in the walk. One unlisted type can
       reach both bars at once — two `tfsa` accounts, one in credit and one
       overdrawn — and drawing the same type in two colours on one chart says
       they are two different things. */
    const extraColors = new Map();
    const colorFor = type => {
      if (!extraColors.has(type)) {
        const i = extraColors.size;
        extraColors.set(type, (css.getPropertyValue(EXTRA_VARS[i % EXTRA_VARS.length]) || '').trim()
          || EXTRA_FALLBACKS[i % EXTRA_FALLBACKS.length]);
      }
      return extraColors.get(type);
    };
    /* `known` rides along on the returned segment — see the distinctColors
       pass below, which must never reassign a sealed account-type colour.
       `acctType` rides along too, unlisted types only: the SAME unlisted type
       can reach both bars (a tfsa in credit and a tfsa overdrawn), and the
       colour pass below has to recognise those two segments as one decision,
       not two — see its own comment. */
    const segFor = g => (g.known
      ? { label: meta.get(g.type).label, amount: g.amount, color: meta.get(g.type).color, known: true }
      : { label: g.type.replace(/_/g, ' '), amount: g.amount, color: colorFor(g.type), known: false, acctType: g.type });
    /* HOME-CURRENCY ACCOUNTS ONLY. This chart's segments are widths on a
       shared scale and shares of one denominator — "16% of what you own" is
       meaningless the moment the numerator and the denominator are in
       different currencies, and unlike a total there is no way to print a
       disclosure inside a bar. So the bar is drawn in one currency and the
       rest is NAMED underneath it (see the note appended at the end of this
       function), which is the same trade the Accounts ring makes. */
    /* ISSUE 44 — implied balances, the same as-of the Dashboard's cash card. */
    const { primary: homeAccounts, others: worthOthers } = split(impliedAccounts());
    /* worth.js is the one place net worth is computed — see its own header —
       and this chart used to re-derive `totalAssets`/`totalDebts`/`net` from
       the very same grouped arrays instead of reading it, which meant it also
       skipped the `Math.round(…* 100) / 100 || 0` guard worth() applies to
       `net`: a household sitting at exactly zero read "R 0,00" in the KPI
       tile above and "R -0,00" in this chart's own aria-label, on the same
       screen. The grouped arrays stay — they still drive the segment
       geometry — but the headline figures come from the one function that is
       allowed to state them.

       Read HERE rather than three-quarters of the way down the function,
       where it used to sit, because the disclosure note below is built out of
       the very ledgers it held out. */
    /* ISSUE 39 — receivables, and this bar is the one place the addition has to
       be VISIBLE: `totalAssets` below is w.assets, so a ledger that reaches the
       total without reaching a segment draws a bar that does not fill its own
       track. The segment is pushed with the Assets-page rows further down. */
    const w = worth(homeAccounts, S.debts, S.assets, S.settings.currency, S.owed);
    const groups = accountGroups(homeAccounts, WORTH_TYPES.map(([type]) => type));
    const assets = groups.owned.map(segFor);
    const debts = groups.owed.map(segFor);

    /* The disclosure the bar itself cannot carry. Appended once, at the end
       of the segment lists below, rather than inside a wedge — see the note
       on `worthAccounts` above.

       Built from otherCurrencyNet, not from `worthOthers`, for the same reason
       the Net worth tile above it is: the accounts were only ever one of the
       three ledgers this chart draws. Once assetsByType and debtsByType stopped
       drawing foreign rows on a rand scale (below), a note naming the accounts
       alone would have disclosed a third of what had just been held out — and
       the figure this chart is headed by is a net worth, so a per-symbol net is
       the shape that answers "what is missing from it". */
    const worthOther = otherCurrencyNet(w, worthOthers);
    const worthNote = worthOther.length
      ? `${otherList(worthOther)} held in other currencies is not drawn here — a share of one currency's total cannot include another's.`
      : '';

    /* Assets-page rows, grouped by their own kind — the house, the car and the
       ring as three named blocks rather than one anonymous slab. Colours walk a
       fixed list for the same reason the debt colours below do. Deliberately
       appended AFTER the accounts so the bar reads bank money first and
       possessions second: the two are not equally liquid, and a chart that
       leads with a house implies you could spend it this week. */
    const ASSET_VARS = ['--color-accent', '--color-investment', '--color-info', '--ink-faint'];
    const ASSET_FALLBACKS = ['#0d9488', '#6f42c1', '#0ea5e9', '#5f6779'];
    /* HOME CURRENCY, like the accounts above. These two calls used to take no
       household symbol at all, so every foreign row reached a segment while
       the heading beside it — worth()'s, which holds them out — did not: a
       R2 300 000 bar under a R2 100 000 label on a R2 100 000 track. What is
       held out is named in `worthNote`. */
    const assetSegs = assetsByType(S.assets, S.settings.currency);
    assetSegs.forEach((a, i) => {
      const color = (css.getPropertyValue(ASSET_VARS[i % ASSET_VARS.length]) || '').trim()
        || ASSET_FALLBACKS[i % ASSET_FALLBACKS.length];
      assets.push({ label: a.type, amount: a.amount, color, fromAssetPage: true });
    });

    /* ISSUE 39 — money lent out, drawn LAST in the owned bar and as one block.
       Last because the bar already reads most-liquid-first (bank money, then
       possessions) and a loan to a friend is the least certain rand on it;
       one block because the Owed page's rows are people, not kinds of thing,
       and a legend naming them would put someone's name on a chart the
       household may well show to someone else.

       Read off w.ownedOwed rather than re-summed here: the total above this
       chart is worth()'s, so a second reduce over S.owed is exactly the
       "two figures derived by different rules" shape that would let the bar
       and its own heading disagree. */
    if (w.ownedOwed > 0) {
      const color = (css.getPropertyValue('--color-info') || '').trim() || '#0ea5e9';
      assets.push({ label: 'Owed to you', amount: w.ownedOwed, color, fromOwedPage: true });
    }

    /* Debt-page rows, grouped by their own type so a bond and a car loan are
       tellable apart rather than merged into one anonymous block. Colours walk
       a fixed list so the same debt type keeps the same colour between renders
       — a segment that changes colour when another debt is added reads as a
       different debt. */
    const DEBT_VARS = ['--color-warning', '--color-danger', '--color-investment', '--ink-faint'];
    const DEBT_FALLBACKS = ['#f5a524', '#f43f5e', '#6f42c1', '#5f6779'];
    const debtSegs = debtsByType(S.debts, S.settings.currency);
    debtSegs.forEach((d, i) => {
      const color = (css.getPropertyValue(DEBT_VARS[i % DEBT_VARS.length]) || '').trim()
        || DEBT_FALLBACKS[i % DEBT_FALLBACKS.length];
      debts.push({ label: d.type, amount: d.amount, color, fromDebtPage: true });
    });

    /* The four colour schemes above (the account-type table, its own
       unlisted-type walk, the Assets-page walk, the Debt-page walk) each pick
       from a FIXED list with no idea what the other three chose — the same
       "--color-accent" landed on both a Cash account and a house asset,
       drawing identical adjacent rects with no stroke or gap between them, so
       they merged into one indivisible block and the legend carried two rows
       with one swatch. One pass, over every segment on the chart together, in
       size order (distinctColors' own requirement — see chart.js), fixes
       that. The six sealed account-type colours are `reserved` rather than
       run through the resolver: they are the one palette this file may not
       touch (`scripts/presets.cjs` generates it), so they keep whatever this
       row assigned them regardless of what else is on the chart, and nothing
       else may be placed close enough to be confused with one. */
    const sealedColors = [...meta.values()].map(m => m.color);
    const resizable = [...assets, ...debts].filter(seg => !seg.known);
    /* Grouped so the SAME unlisted account type collapses to ONE colour
       decision even though it can appear once in each bar. distinctColors
       knows nothing about "same type" — without this, the two occurrences
       are resolved independently and can walk away with different colours,
       which reads as two different things rather than one type split across
       credit and overdraft. Every OTHER segment (asset-page and debt-page
       rows) keys on itself, so genuinely different things that happen to
       share a colour by coincidence of two unrelated fixed lists — the bug
       this whole pass exists to fix — are still free to be told apart. */
    const colorGroups = new Map();
    for (const seg of resizable) {
      const key = seg.acctType !== undefined ? `acct:${seg.acctType}` : seg;
      if (!colorGroups.has(key)) colorGroups.set(key, { amount: 0, wanted: seg.color, members: [] });
      const grp = colorGroups.get(key);
      grp.amount += seg.amount;
      grp.members.push(seg);
    }
    const ordered = [...colorGroups.values()].sort((a, b) => b.amount - a.amount);
    const resolved = distinctColors(ordered.map(g => g.wanted), { reserved: sealedColors });
    ordered.forEach((grp, i) => { for (const m of grp.members) m.color = resolved[i]; });

    const totalAssets = w.assets;
    const totalDebts = w.liabilities;
    const net = w.net;

    const overlap = cardOverlap(S.accounts, S.debts);
    /* Name every ledger the bar is drawn from. The subtitle is not a
       disclosure — the figures are all actually IN the chart — but a reader
       who cannot tell which pages fed it has no way to check it.

       Read off the SEGMENT lists rather than off S.assets/S.debts directly:
       once the two grouping calls above started holding foreign rows out, a
       vault whose only assets are a Lisbon flat would have been told the bar
       was drawn "across your accounts and the Assets page" with not one pixel
       of the Assets page on it. A caption that names a source contributing
       nothing is the same failure as a total that omits one silently, pointed
       the other way. */
    const ledgers = ['your accounts',
      ...(assetSegs.length ? ['the Assets page'] : []),
      ...(w.ownedOwed > 0 ? ['money owed to you'] : []),
      ...(debtSegs.length ? ['the Debt page'] : [])];
    const across = ledgers.length > 1
      ? `Across ${ledgers.slice(0, -1).join(', ')} and ${ledgers[ledgers.length - 1]}`
      : 'Across your accounts';
    $('#savingsWorthSub').textContent = [
      overlap
        ? `${across} · a credit card appears on two of them, so it may be counted twice`
        : across,
      worthNote,
    ].filter(Boolean).join(' · ');

    if (!totalAssets && !totalDebts) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Add a balance to any account and the split appears here.'));
      return;
    }

    /* Thin strips, not the old 46px bars — redesign mockup B draws the
       composition bar at 12-14px, with everything a label used to say inside
       a segment now living once, in the ranked list below. H shrinks with
       barH; the two rows keep the same 8px gap between a row's own heading
       text and its bar, and a ~26px gap between the two bars for the second
       heading to sit in. */
    const W = 1000, H = 118, padL = 8, padR = 8, barH = 14;
    const scale = Math.max(totalAssets, totalDebts, 1);
    const innerW = W - padL - padR;

    /* Every id minted below is per-render. Two plugin leaves open at once put
       two of these charts in one document, and a repeated clipPath or gradient
       id means the second bar silently references the first one's — the same
       trap areaGradient() documents in chart.js. */
    const uid = `bud-worth-${++worthSeq}`;

    /* The segment <title>s below are the ONLY thing a pointer gets, but they are
       invisible to a screen reader: createChart marks the svg role="img", which
       collapses the whole thing to one node and hides its children. So the
       breakdown has to be in the label itself, or a non-sighted reader gets two
       totals and no composition — and on a desktop, where the titles are
       dropped in favour of the tooltip, nothing at all. */
    const listFor = segs => segs.map(s => `${s.label} ${money(s.amount, 0)}`).join(', ');
    const { svg, add } = createChart({
      w: W, h: H, cls: 'worth-svg',
      label: `Net worth ${money(net)}: assets ${money(totalAssets)} against debts ${money(totalDebts)}`
        + (assets.length ? `. Owned: ${listFor(assets)}` : '')
        + (debts.length ? `. Owed: ${listFor(debts)}` : ''),
    });
    const defs = add('defs', {});

    /* A single top-to-bottom sheen laid over every bar — the "glow". Drawn as
       SVG rather than a CSS filter because it has to survive the iOS 15 floor
       untouched, and because a gradient overlay costs nothing to composite. */
    const sheen = add('linearGradient', { id: `${uid}-sheen`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    add('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.22' }, sheen);
    add('stop', { offset: '48%', 'stop-color': '#ffffff', 'stop-opacity': '0.05' }, sheen);
    add('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': '0.08' }, sheen);

    /* Hover is a real capability question, not a screen-size one. Where there
       is a fine pointer the HTML tooltip below reads better and lands instantly,
       so the native <title> is left off — two tooltips for one segment is worse
       than either. Where there is not (every phone, which is where this plugin
       mostly lives) nothing changes: touch-and-hold still shows the <title> it
       always did, and no hover-only affordance is invented for a finger. */
    const hoverable = typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const tipBox = el('div', { class: 'worth-tip', 'aria-hidden': 'true' });
    const tipName = el('div', { class: 'worth-tip-name' });
    const tipVal = el('div', { class: 'worth-tip-val num' });
    tipBox.append(tipName, tipVal);

    const clearHover = () => {
      svg.classList.remove('is-hover');
      for (const n of svg.querySelectorAll('.worth-seg.is-on')) n.classList.remove('is-on');
      tipBox.classList.remove('is-on');
    };

    const row = (y, segs, total, heading, idx) => {
      add('text', {
        x: padL, y: y - 10, 'font-size': '13', 'font-weight': '600',
        fill: 'currentColor', 'fill-opacity': '0.55', 'font-family': 'inherit',
      }).textContent = heading;
      add('text', {
        x: W - padR, y: y - 10, 'text-anchor': 'end', 'font-size': '13', 'font-weight': '700',
        fill: 'currentColor', 'fill-opacity': '0.8', 'font-family': 'inherit',
      }).textContent = money(total, 0);
      // The track shows how far short of the longer bar this one falls.
      // rx capped at half of the new thin barH, not the old bar's 10 — a
      // corner radius bigger than the strip is tall drew a barely-rounded
      // pill wherever this constant was reused unscaled.
      add('rect', {
        x: padL, y, width: innerW, height: barH, rx: barH / 2,
        fill: 'currentColor', 'fill-opacity': '0.05',
      });
      if (!total) return;

      /* The bar wipes in left to right behind a clip rect rather than each
         segment growing from its own left edge — segments are adjacent, so
         growing them individually opens gaps between them for the length of
         the animation and reads as a broken chart rather than an entering one. */
      const clip = add('clipPath', { id: `${uid}-wipe-${idx}` }, defs);
      add('rect', {
        class: `worth-wipe${idx ? ' worth-wipe--b' : ''}`,
        x: padL, y, width: innerW, height: barH,
      }, clip);
      const band = add('g', { 'clip-path': `url(#${uid}-wipe-${idx})` });

      /* One allocation for the whole row, not `Math.round` per segment — the
         exact defect share-percents.js exists to eradicate, and its own test
         keeps a naive per-slice rounder as a NEGATIVE CONTROL specifically
         because this stack (the two net-worth donuts) had already fixed it
         once and this bar chart was missed: three equal segments used to
         announce 33/33/33 = 99% between them, and — worse, since the segment
         `<title>` is the only reading a touch user gets — a real R60 000
         segment could announce "0% of what you own" while a rounding-up
         neighbour absorbed the missing point. */
      const shares = sharePercents(segs.map(s => s.amount));

      let x = padL;
      segs.forEach((seg, i) => {
        const w = (seg.amount / scale) * innerW;
        /* Drawn width, clamped so a sliver of a segment still has SOME ink —
           and the cursor advances by that SAME clamped width, not the raw
           one. It used to advance by `w` while drawing `Math.max(2, w)`: a
           handful of sub-2px segments drew wider than the gap the walk left
           for them and ate into their neighbour, so the drawn bar disagreed
           with the data it was drawn from. */
        const dw = Math.max(2, w);
        const share = shares[i];
        /* The glow is the segment's OWN colour at low alpha, so it reads as the
           block lighting up rather than a generic highlight landing on it. The
           fill arrives as a resolved rgb() from getComputedStyle or as a hex
           fallback; parseColor takes both, and a colour it cannot read simply
           gets no glow rather than an invented one. */
        const rgb = parseColor(seg.color);
        const g = add('g', {
          class: 'worth-seg',
          style: rgb
            ? `--seg-soft:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.28);` +
              `--seg-glow:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.6)`
            : null,
        }, band);
        const node = add('rect', {
          x, y, width: dw, height: barH,
          fill: seg.color, rx: w > 20 ? barH / 2 : 2,
        }, g);
        if (hoverable) {
          g.addEventListener('pointerenter', () => {
            svg.classList.add('is-hover');
            for (const n of svg.querySelectorAll('.worth-seg.is-on')) n.classList.remove('is-on');
            g.classList.add('is-on');
            tipName.textContent = seg.label;
            tipVal.textContent = `${money(seg.amount)} · ${share}% of ${heading.toLowerCase()}`;
            tipBox.classList.add('is-on');
          });
        } else {
          tip(add, node, `${seg.label}: ${money(seg.amount)} · ${share}% of ${heading.toLowerCase()}`);
        }
        /* NO IN-BAR LABEL — redesign mockup B ("Net worth is the hero"): the
           bar becomes a thin strip (`barH` below) too narrow to ever hold a
           9px label without clipping, and the label now lives once, in the
           ranked list under the bar, rather than fighting for space inside a
           segment on top of the identical text the <title>/tooltip above
           already carries. `c.hole` (the colour this removed text used) is
           now unused here; still read for `c.axis` elsewhere in this scope. */
        x += dw;
      });

      /* Laid over the finished row, and only as far as the row actually runs —
         a sheen across the empty track would draw a ghost bar the full width of
         the chart. Inert to the pointer so it cannot steal a segment's hover.
         Width is the row's ACTUAL drawn extent (`x` after the walk above),
         not a fresh `(total / scale) * innerW` — that recomputed figure is the
         UNclamped sum, so once any segment above was sub-2px and clamped
         wider, the sheen fell short of the last segment's real right edge. */
      add('rect', {
        x: padL, y, width: x - padL, height: barH, rx: barH / 2,
        fill: `url(#${uid}-sheen)`, 'pointer-events': 'none',
      }, band);
    };

    row(30, assets, totalAssets, 'What you own', 0);
    row(86, debts, totalDebts, 'What you owe', 1);

    if (hoverable) {
      /* Positioned from the pointer rather than from the segment: a segment can
         be most of the chart wide, and a tooltip parked at its centre ends up
         nowhere near the cursor. Measured at pointer time, which is the one
         moment the chart is guaranteed to be on screen — the standing rule
         against DOM measurement here is about rendering into a hidden tab. */
      svg.addEventListener('pointermove', e => {
        if (!tipBox.classList.contains('is-on')) return;
        const r = svg.getBoundingClientRect();
        const pad = Math.min(60, r.width / 2);
        tipBox.style.left = `${Math.max(pad, Math.min(e.clientX - r.left, r.width - pad))}px`;
        tipBox.style.top = `${e.clientY - r.top}px`;
      });
      svg.addEventListener('pointerleave', clearHover);
    }

    wrap.append(svg, tipBox);

    /* RANKED LIST, replacing the swatch/name/value legend grid — redesign
       mockup B ("Net worth is the hero"). Same segments, same colours, same
       amounts as the legend it replaces (and the same figures the bars and
       their <title>s state — one set of numbers, three views of it), just
       ordered largest-first and carrying the share the bar's own tooltip
       already computes, so a reader gets on the page what used to cost a
       hover/hold. `sharePercents` — not a per-row Math.round — for the same
       reason `row()` above uses it: a naive per-slice rounder can announce
       "0%" for a real segment while a neighbour silently absorbs the missing
       point (see that function's own comment). One call per bar, matching
       the one `row()` makes for the same segments, so the percentage printed
       here is never a second, independently-rounded answer to the same
       question the bar's tooltip already answered. */
    const assetShares = sharePercents(assets.map(s => s.amount));
    const debtShares = sharePercents(debts.map(s => s.amount));
    const ranked = [
      ...assets.map((seg, i) => ({ seg, share: assetShares[i], of: 'own' })),
      ...debts.map((seg, i) => ({ seg: { ...seg, label: `${seg.label} (owed)` }, share: debtShares[i], of: 'owe' })),
    ].sort((a, b) => b.seg.amount - a.seg.amount);

    /* TAPPABLE, ROW-BY-ROW — the composition list becomes another way into
       the page that actually owns each segment's figure, the same way the
       legend on the Debt page's own donut and the Dashboard's net-worth tile
       already route a tap to Debts/Accounts. A segment drawn from the
       Assets or Debt page, or from money owed, goes to the page that owns
       it; every account-type segment (including an unlisted one, on either
       bar) goes to Accounts, where its balance lives and can be edited. */
    const navFor = seg => (seg.fromAssetPage ? 'assets' : seg.fromOwedPage ? 'owed'
      : seg.fromDebtPage ? 'debts' : 'accounts');

    const list = el('ul', { class: 'sav-worth-list' });
    for (const { seg, share, of } of ranked) {
      const dest = navFor(seg);
      const btn = el('button', { type: 'button', class: 'sav-worth-btn',
        'aria-label': `${seg.label}, ${money(seg.amount, 0)}, ${share}% of what you ${of}. Open ${dest === 'owed' ? 'Owed Money' : dest[0].toUpperCase() + dest.slice(1)}.` },
        /* `i`, not `span` — tests/savings-cards.test.cjs walks the swatch by
           TAG (`e.tagName === 'I'`), the same shape the legend it replaces
           used, so the colour-per-unlisted-type guard keeps pinning the same
           invariant against this markup without a rewrite. */
        el('i', { class: 'sav-worth-swatch', style: `background:${seg.color}` }),
        el('span', { class: 'sav-worth-name' }, seg.label),
        el('span', { class: 'sav-worth-end' },
          el('span', { class: 'sav-worth-share' }, `${share}%`),
          el('span', { class: 'num sav-worth-val' }, money(seg.amount, 0))));
      btn.addEventListener('click', () => ctx.switchView(dest));
      const row = el('li', { class: `sav-worth-row${of === 'owe' ? ' sav-worth-row--owe' : ''}` }, btn);
      list.append(row);
    }
    wrap.append(list);
  }

  ctx.provide({ renderSavings, renderWorth });
};
