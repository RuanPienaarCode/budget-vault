'use strict';
/* Services — recurring subscriptions grouped by budget category, saved to
   Services.md. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile, CYCLES } = require('../table-schema');
const { askFields } = require('../modal');
const { ISO_DATE, todayIso } = require('../dates');
const { matchCharges, chargeStats, nextDue, chargeStatus, comparePriceNow } = require('../recurring');
const { isSplitPart } = require('../tx-role');
const { symbolOf, isForeign } = require('../currency');
/* Namespace import, this repo's convention wherever a bare `t` could be
   shadowed — and it is here: renderServices binds `const t = $('#svcTable')`. */
const i18n = require('../i18n');

module.exports = function registerServices(ctx) {
  const { S, $, app, money, moneyIn, toast, writeFile } = ctx;
  const CYCLE_NOUN = { weekly: 'week', fortnightly: 'fortnight', monthly: 'month', annual: 'year' };

  /* ISSUE 33. Four cycles now, so this is a lookup rather than one ternary —
     and the weekly factor is 365.25/12/7, not 4. A weekly R250 gym costs
     R1 087 a month, not R1 000: four-week months are a convention, not a
     calendar, and the difference is a month's worth of it every year on a page
     whose whole job is a monthly total. */
  const PER_MONTH = { weekly: 365.25 / 12 / 7, fortnightly: 365.25 / 12 / 14, monthly: 1, annual: 1 / 12 };
  function monthlyEquiv(s) { return s.amount * (PER_MONTH[s.cycle] ?? 1); }

  /* ---------------------- what a total may add up -------------------------

     ISSUE 30. Services.md can state a currency (ADR-0004), and this page
     learned exactly half of what that means. chargeIndex() below is
     scrupulous about it — a listed price is compared ONLY against charges in
     the household's own currency, and a service billed abroad gets a neutral
     "billed in €" badge and no price verdict at all rather than a confident
     wrong one. Every TOTAL on the page then added the same services blind:
     R800 of fibre plus €15 of cloud storage printed "Per month R 815.00 · Per
     year R 9 780.00" — a euro added to a rand and stamped with a rand symbol,
     on the page whose own badges say those two figures cannot be compared.
     The Dashboard already splits these very services by symbol before they
     reach whatsLeft (views/dashboard.js's homeish/fxOf), so it was also two
     answers to one question on two screens.

     Same shape and same rounding as currency.js's splitByCurrency — the
     household figure, then a [symbol, total] list to state BESIDE it, never
     folded in — but over monthlyEquiv() rather than a balance, which is a
     quantity only this page has. Never converted, never dropped:
     currency.js:14. */
  function monthlySplit(list) {
    const home = S.settings.currency;
    let primary = 0;
    const bySymbol = new Map();
    for (const s of list || []) {
      const m = monthlyEquiv(s) || 0;
      if (isForeign(s, home)) {
        const sym = symbolOf(s, home);
        bySymbol.set(sym, (bySymbol.get(sym) || 0) + m);
      } else primary += m;
    }
    // Rounded to the cent with -0 collapsed, the two-step every other total in
    // this app applies — a foreign side figure is a figure like any other, and
    // "€ -0" beside a headline reads as a cost that does not exist.
    return {
      primary: (Math.round(primary * 100) / 100) || 0,
      others: [...bySymbol].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]),
    };
  }

  /* The sentence beside a KPI figure. From the Accounts page's own key, so no
     two screens word one fact differently. `scale` annualises it for the "Per
     year" tile: what is stated beside a figure has to be stated over the same
     span as the figure, or the reader is handed a monthly euro next to an
     annual rand. `.trim()` because acct.hero.otherCurrencies carries a leading
     space for sentence-appending and a KPI sub-line is not one. */
  const otherNote = (others, scale = 1) => (others.length
    ? i18n.t('acct.hero.otherCurrencies', {
      list: others.map(([sym, v]) => moneyIn(sym, v * scale, 0)).join(' · '),
    }).trim() : '');

  /* Services grouped by their budget category. Both writers of the subtotal
     row built this map for themselves; one function so a change to the
     "Uncategorised" fallback cannot land in only one of them. null-proto: a
     "__proto__"/"constructor" category must not crash the view. */
  function serviceGroups() {
    const groups = Object.create(null);
    for (const s of S.services) (groups[s.category || 'Uncategorised'] ??= []).push(s);
    return groups;
  }

  /* THE category subtotal cell, written by renderServices on a full paint and
     by renderServiceSubtotals on every amount edit. It was two expressions of
     one string, which is this repo's recurring defect shape — and both of them
     added unlike currencies. `acct.table.otherCurrencies` is the compact
     companion to the sentence above: a subtotal cell is narrow, so the other
     symbols get a tag rather than a clause. A group billed ENTIRELY abroad
     still prints its rand subtotal — "R 0/mo · plus € 10/mo" is the truth, and
     a bare R0 would say the group costs nothing. */
  function subtotalText(list) {
    const { primary, others } = monthlySplit((list || []).filter(s => s.active));
    return `${money(primary, 0)}/mo`
      + (others.length ? ' · ' + i18n.t('acct.table.otherCurrencies', {
        list: others.map(([sym, v]) => `${moneyIn(sym, v, 0)}/mo`).join(' · '),
      }) : '');
  }

  /* ------------------- what the statements actually say -------------------
     The list on this page is what the reader BELIEVES they pay. The vault holds
     what was really charged, and until now nothing compared the two — so the
     page drifted quietly: a fibre line listed R40 under its real price, a
     subscription still marked active whose description had stopped appearing
     five months earlier, and a "next billing" column every value of which was
     months in the past.

     Built once per render over every transaction, then handed to each row —
     matching per service inside the row loop would walk the whole history once
     per service. */
  function chargeIndex() {
    const rows = [];
    /* ISSUE 28/30. Pools by currency, not one pool, and the split is the
       whole fix.

       The charges a listed price is compared against are raw amounts from
       whichever account they landed in. Compared blind, a Netflix
       subscription listed at R199 and really billed $15.99 on a dollar card
       produced `agrees: false`, `diff: -183.01` and a GREEN "really R 16" pill
       reading "Your bank is charging R 15.99, not R 199.00" — a 92% price
       cut, asserted as fact, on a price that never moved. The 4% band in
       comparePrice was widened to absorb a currency wobble; it cannot absorb a
       12x symbol mismatch.

       So PRICE is compared only against charges in the SERVICE'S OWN currency
       (its Currency cell, ADR-0004; blank is the household's), and LIVENESS
       still follows every charge whatever its currency — "did this merchant
       bill me" is a question about events, not amounts, and a subscription
       paid from a euro card is no less alive. A service with no charges in its
       own currency gets no price verdict at all and says so, rather than a
       confident wrong one.

       2026-10-07 audit, SVC-1: this used to compare against the HOUSEHOLD'S
       currency, under a comment saying Services.md had no currency column —
       written before ADR-0004 gave it one. The totals learned the column
       (monthlySplit, above); the price check did not, so a service listed as
       "$ 20.00" and charged in rand on a rand card was told "really R 360 —
       Your bank is charging R 360,00, not R 20,00".

       Parts are skipped, parents are kept: this is asking what the MERCHANT
       charged, and a split is the reader slicing one charge into categories
       after the fact. Feeding both would show a subscription being billed twice
       a month, and — worse, because it is silent — would drag the median of the
       last three charges the price and the next date are built on. */
    const home = S.settings.currency;
    const homeSym = symbolOf(null, home);
    const pools = new Map();   // symbol -> the rows charged in it
    for (const f of Object.values(S.txFiles)) {
      const acct = typeof ctx.accountForLabel === 'function' ? ctx.accountForLabel(f.label) : null;
      const foreign = isForeign(acct, home);
      const sym = foreign ? symbolOf(acct, home) : homeSym;
      if (!pools.has(sym)) pools.set(sym, []);
      const pool = pools.get(sym);
      for (const r of f.rows) {
        if (isSplitPart(r)) continue;
        const stamped = foreign ? { ...r, _symbol: sym } : r;
        rows.push(stamped);
        pool.push(stamped);
      }
    }
    const today = todayIso();
    const out = new Map();
    for (const s of S.services) {
      const own = isForeign(s, home) ? symbolOf(s, home) : homeSym;
      const m = matchCharges(s, rows);
      const same = matchCharges(s, pools.get(own) || []);
      /* `current`, not `charges`: what the merchant takes NOW. The dominant
         group by lifetime total can be a description the merchant abandoned,
         and committed.js already prices the same service off `current` — read
         through `charges` here, the Services page priced a service at the old
         description while the Dashboard committed the current price (2026-09-29 audit). */
      const priced = same.current || same.charges;
      const stats = chargeStats(priced);
      /* EVERY charge the merchant's tokens hit, in any currency and under any
         of its descriptions. Liveness, "not seen" and the next date are all
         questions about these events, so they are answered from this ONE
         reading — 2026-10-07 audit, SVC-4: "not seen" and the hint's tooltip
         were read from the PRICE stats, which are null for a service billed
         only abroad, so the badge claimed charges that had matched were
         missing and the tooltip threw on `null.day`, leaving the page
         half-built. */
      const seen = chargeStats(m.all);
      const status = chargeStatus(seen, s.cycle, today);
      /* The symbols this service was actually billed in, other than its own —
         named on the row so a reader can see WHY no price verdict is offered
         rather than just noticing one is missing. */
      const otherSymbols = [...new Set((m.all || []).map(r => r._symbol || homeSym).filter(x => x !== own))];
      out.set(s, {
        stats,
        seen,
        symbol: own,
        otherSymbols,
        /* Charges exist, but none of them in a currency this figure can be
           compared against. */
        priceUncomparable: !same.charges.length && m.charges.length > 0,
        // Liveness follows the MERCHANT — every description the tokens hit —
        // because a renamed debit order is not a cancellation.
        status,
        /* comparePriceNow, not comparePrice: a price that moved and then held
           for two charges is a price, not "varies" (SVC-2, see recurring.js).
           committed.js keeps comparePrice's own reading. */
        price: comparePriceNow(s, stats, priced),
        /* Anchored on the merchant, like the liveness pill above and for the
           same reason: the next charge follows the LAST one under any of its
           names. Read through the dominant group alone, a renamed debit order
           projects its due date from a charge months old — which is how
           committed.js came to drop a live service from "What's left".
           nextDue, not nextExpected: the hint OFFERS this date, so it is
           stepped past dates that have already gone (SVC-3, recurring.js). */
        next: nextDue(seen, s.cycle, today),
        related: m.related,
      });
    }
    return out;
  }
  const { mark, clear: clearDirty } = ctx.dirtyFlag('servicesDirty', '#svcSave');

  /* Split out so an edited amount can refresh the totals without rebuilding
     the row it was typed into — on a phone `change` fires on blur, so a full
     rebuild lands between the tap that leaves a field and the one arriving at
     the next, and the arriving tap hits whatever now occupies those pixels. */
  function renderServicesKpis() {
    const active = S.services.filter(s => s.active);
    const { primary: perMonth, others } = monthlySplit(active);
    const tile = kpiTiles($('#servicesKpis'));
    tile('Per month', money(perMonth), null, otherNote(others));
    tile('Per year', money(perMonth * 12), null, otherNote(others, 12));
    /* The two counts are unchanged, deliberately. A euro subscription is still
       a subscription — the currency decides which total may hold its AMOUNT,
       not whether the thing exists, and dropping it from the count here would
       be the silent exclusion the disclosure above exists to replace. */
    tile('Active', String(active.length));
    tile('Total services', String(S.services.length));
  }

  /* The per-category subtotal rows are the other thing an amount feeds. They
     hold no inputs, so they are safe to replace in place. */
  function renderServiceSubtotals() {
    const groups = serviceGroups();
    for (const row of $('#svcTable').querySelectorAll('tr.type-row')) {
      row.lastElementChild.textContent = subtotalText(groups[row.dataset.cat] || []);
    }
  }

  /* Badges beside the service name. Every one of them is a QUESTION or an
     observation, never an assertion: this can see an absence of charges, and an
     absence is not a cancellation — a bank posts late, a card gets reissued,
     an annual plan is silent for eleven months by design. */
  function svcFlags(s, c) {
    const out = [];
    /* "Not seen" is a claim about EVERY charge, so it is read from every
       charge (c.seen) — never from the price stats, which are empty whenever
       the charges are in another currency (SVC-4). */
    if (!c.seen) {
      out.push(el('span', { class: 'category-badge badge-dup',
        title: `No charge in your transactions matches "${s.provider || s.name}". Either it is paid from an account you have not imported, or the name here does not match what your bank prints.` },
      'not seen'));
      return out;
    }
    if (s.active && c.status && c.status.state === 'overdue') {
      const months = Math.round(c.status.daysSince / 30);
      // c.seen.last: the charge the overdue reading itself was measured from.
      out.push(el('span', { class: 'category-badge badge-transfer',
        title: `Last charged ${c.seen.last}. Still marked active — has it been cancelled?` },
      `last charged ${months}mo ago`));
    }
    /* A price verdict is printed in the service's OWN currency — the one both
       sides of the comparison are now in (SVC-1). money() for the household's,
       so the common path stays on the formatter every other figure uses. */
    const fmt = c.symbol && c.symbol !== symbolOf(null, S.settings.currency)
      ? (v, dp) => moneyIn(c.symbol, v, dp) : money;
    /* Tested FIRST. It was the last branch of this chain, after an early
       `return` on missing price stats that every uncomparable service took —
       so the neutral badge below was unreachable, and the row said "not seen"
       about charges that had matched (SVC-4). */
    if (c.priceUncomparable) {
      /* Neutral, not a warning: nothing is wrong with this service, the app
         simply cannot check its price. Saying so beats both alternatives —
         a silent blank reads as "checked and fine", and the old behaviour
         asserted a price change that never happened. */
      out.push(el('span', { class: 'category-badge badge-dup',
        title: `This service is billed in ${c.otherSymbols.join(' · ')}, and the amount on this page is in ${c.symbol}. `
          + 'Comparing them would need an exchange rate for the day of each charge, which this vault does not store — so no price check is offered rather than a wrong one.' },
      `billed in ${c.otherSymbols.join(' · ')}`));
    } else if (c.price && c.price.varies) {
      out.push(el('span', { class: 'category-badge badge-dup',
        title: 'The recent charges for this merchant differ too much from each other to call any of them the price — top-ups, or several products billed under one name.' },
      'varies'));
    } else if (c.price && !c.price.agrees) {
      const d = c.price.diff;
      /* A settled price (SVC-2) says so: the verdict rests on the last two
         charges agreeing, after earlier ones at another price, and the reader
         deciding whether to update their figure deserves to know that. */
      const basis = c.price.settled
        ? `Your last two charges were ${fmt(c.price.actual)}, not ${fmt(c.price.stated)} — the price looks to have changed.`
        : `Your bank is charging ${fmt(c.price.actual)}, not ${fmt(c.price.stated)}. Based on the last few charges, so a price rise shows up here rather than an old average.`;
      out.push(el('span', { class: `category-badge ${d > 0 ? 'badge-debt' : 'badge-savings'}`, title: basis },
      `really ${fmt(c.price.actual, 0)}`));
    }
    return out;
  }

  /* The date the charges imply, if it is one worth offering — or null.

     Offered rather than written, because the reader may be tracking a plan
     change the history cannot know about. So it is held back whenever taking
     it could only make the row worse (2026-10-07 audit, SVC-3):
       - it already matches what is stored, so a correct row shows nothing;
       - it is EARLIER than a real date the reader typed: the old hint offered
         2026-09-05 over a stored 2026-10-05, inviting them to replace a right
         answer with one already in the past;
       - the service has gone quiet for more than two cycles. Its row already
         asks whether it has been cancelled, and a date stepped forward to
         today would answer that question for the reader. */
  function offeredNext(s, c) {
    if (!c.next) return null;
    if (c.status && c.status.state === 'overdue') return null;
    const d = c.next.date;
    if (d === s.next) return null;
    if (ISO_DATE.test(s.next || '') && d < s.next) return null;
    return d;
  }

  /* A one-tap "use the date the charges imply". The tooltip states what the
     date is built from — the charge it steps from and the cycle — taken from
     the same reading the date is (c.next), so the two cannot name different
     charges again (SVC-3: the date followed an add-on charged on the 28th
     while the tooltip quoted the main charge on the 5th). The cadence is
     worded by the cycle; "around day N each week" read a day-of-the-MONTH
     median as if a week had thirty days. */
  function svcNextHint(s, c, date) {
    const stale = !s.next || s.next < todayIso();
    const { last, first, skipped } = c.next;
    const title = `Last charged ${last}, billed every ${CYCLE_NOUN[s.cycle] || 'month'}, so the next charge is due ${date}.`
      + (skipped ? ` ${first} has passed with no charge in your transactions yet, so this is the next date after today.` : '');
    const btn = el('button', { type: 'button', class: 'svc-next-hint', title,
      'aria-label': `Set next billing for ${s.name} to ${date}` },
    icoEl(['calendar-check', 'calendar']), stale ? `due ${date}` : date);
    btn.addEventListener('click', () => { s.next = date; mark(); renderServices(); });
    return btn;
  }

  function renderServices() {
    renderServicesKpis();
    const charged = chargeIndex();
    const t = $('#svcTable');
    keepScroll(t, () => {
      t.empty();
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Service'), el('th', { scope: 'col' }, 'Provider'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
        el('th', { scope: 'col' }, 'Cycle'), el('th', { scope: 'col' }, 'Next billing'), el('th', { scope: 'col' }, 'Active'), el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      const groups = serviceGroups();
      for (const cat of Object.keys(groups).sort()) {
        body.append(el('tr', { class: 'type-row', 'data-cat': cat },
          el('td', { colspan: '6' }, cat),
          el('td', { class: 'num' }, subtotalText(groups[cat]))));
        for (const s of groups[cat]) {
          const refresh = () => { mark(); renderServicesKpis(); renderServiceSubtotals(); };
          const c = charged.get(s) || {};
          const hintDate = offeredNext(s, c);
          body.append(el('tr', { class: s.active ? '' : 'svc-inactive' },
            el('td', { style: 'font-weight:600' }, s.name, ctx.noteButton('service', s.name), ...svcFlags(s, c)),
            el('td', { class: 'text-muted' }, s.provider),
            el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: s.amount || '',
              'aria-label': `Amount for ${s.name}`,
              /* amountRaw = null: a number typed here supersedes the verbatim
                 text table-schema.js keeps for a cell it could not read. */
              /* normalizeAmount, not `parseFloat(...) || 0` — see the comment
                 on the same input in views/assets.js. Clearing amountRaw beside
                 a fabricated 0 is what turned an unreadable cell into 0.00 on
                 disk with nothing said about it. */
              onchange: e => {
                const v = normalizeAmount(e.target.value);
                if (v === null) { toast('Amount must be a number', true); e.target.value = s.amount || ''; return; }
                s.amount = v; s.amountRaw = null; refresh();
              } })),
            /* ISSUE 33. Driven off table-schema's CYCLES, so the picker can
               never offer a value the reader's file cannot hold — or fail to
               offer one it can. The old two-option list was the visible half of
               a schema that only had two; a household with a weekly debit
               order had nowhere to say so. */
            el('td', {}, el('select', { class: 'form-select form-select-sm', 'aria-label': `Billing cycle for ${s.name}`,
              onchange: e => { s.cycle = CYCLES.includes(e.target.value) ? e.target.value : 'monthly'; refresh(); } },
              ...CYCLES.map(c => el('option', { value: c, ...(s.cycle === c ? { selected: '' } : {}) }, c)))),
            // dateInput, not a bare type="date": a hand-edited "end of month"
            // renders blank in a date input, hiding a value that is still on disk.
            el('td', {}, dateInput(s.next, { class: 'form-control form-control-sm', style: 'width:140px',
              'aria-label': `Next billing date for ${s.name}` },
              v => { s.next = v; mark(); }),
            /* The typed date is a fossil the moment it passes — every value on
               the vault this was built against was months old. The charge
               history already knows: billed on the 2nd, last seen 2 July, so
               next is 2 August. Offered rather than written, because the reader
               may be tracking a plan change the history cannot know about —
               see offeredNext for when it is held back. */
            ...(hintDate ? [svcNextHint(s, c, hintDate)] : [])),
            el('td', {}, el('input', { type: 'checkbox', 'aria-label': `${s.name} is active`, ...(s.active ? { checked: '' } : {}),
              onchange: e => { s.active = e.target.checked; mark(); renderServices(); } })),
            el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${s.name}`,
              onclick: () => { S.services.splice(S.services.indexOf(s), 1); mark(); renderServices(); } }, '✕'))));
        }
      }
      if (!S.services.length) body.append(el('tr', {}, el('td', { colspan: '7', class: 'text-muted' }, 'No services yet.')));
      t.append(body);
    });
  }

  /* Columns, escaping and number formatting come from the same declaration
     the loader reads with (table-schema.js, ADR-0003); only the prose is
     this view's own. */
  function serializeServices() {
    return mdTableFile({
      fm: S.servicesFm, fallback: 'kind: services', title: 'Services & Subscriptions',
      prose: [`Recurring services and subscriptions. \`cycle\` is one of: ${CYCLES.join(', ')}.`],
      schema: SCHEMAS.services, rows: S.services,
      // ISSUE 67/69 — a paragraph above/below the table and a hand-added
      // column both survive a save now; see load.js's tableParts.
      leadRaw: S.servicesLead, trailRaw: S.servicesTrail, extraCols: S.servicesExtraCols,
    });
  }

  /* Guarded for the same reason as every save on this page's Save button:
     before this, a rejected write was an unhandled rejection — no try/catch
     meant no toast and no code path to run at all, so the dirty flag was left
     exactly as it was (clearDirty() sits AFTER the write and never ran on a
     rejection) with nothing on screen to say the save had failed. The button
     stayed lit and the flag stayed dirty by ACCIDENT, not by design; the only
     bug was the silence. Now the failure toasts and the same left-dirty state
     is kept on purpose, so the same click retries. */
  async function saveServices() {
    try {
      await writeFile('Services.md', serializeServices());
    } catch (e) {
      return toast(`Could not save Services.md (${e.message || e})`, true);
    }
    clearDirty();
    toast('Saved Services.md');
  }

  async function addService() {
    const r = await askFields(app, 'New service', [
      { key: 'name', label: 'Service name', type: 'text' },
      { key: 'provider', label: 'Provider', type: 'text' },
      { key: 'amount', label: 'Amount per billing cycle', type: 'number', value: '0' },
      { key: 'cycle', label: 'Billing cycle', type: 'select', value: 'monthly',
        options: CYCLES.map(c => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
      { key: 'next', label: 'Next billing (optional)', type: 'date' },
      { key: 'category', label: 'Budget category', type: 'select', options: ['', ...S.categories.map(c => c.name)], value: '' },
      /* ISSUE 30 — see views/assets.js for the reasoning. Blank means the
         household's currency, which is what every row already on disk says
         by saying nothing, so this is an option and never a question a
         single-currency household has to answer. */
      { key: 'currency', label: 'Currency', type: 'text', value: '',
        placeholder: S.settings.currency || 'R',
        desc: 'Leave blank if it is in your own currency. Set it if this one is not — the figure is then shown in its own currency and stated separately rather than added in.' },
    ]);
    if (!r || !r.name.trim()) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    const next = ISO_DATE.test((r.next || '').trim()) ? r.next.trim() : '';
    S.services.push({ name: r.name.trim(), provider: (r.provider || '').trim(), amount,
      cycle: CYCLES.includes(r.cycle) ? r.cycle : 'monthly', next, category: (r.category || '').trim(), active: true, notes: '',
      // '' when it merely restates the household symbol — see usedColumns().
      currency: (r.currency || '').trim() === (S.settings.currency || '') ? '' : (r.currency || '').trim() });
    mark(); renderServices();
  }

  ctx.provide({ renderServices, saveServices, addService, serializeServices });
};
