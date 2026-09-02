'use strict';
/* Services — recurring subscriptions grouped by budget category, saved to
   Services.md. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile } = require('../table-schema');
const { askFields } = require('../modal');
const { ISO_DATE, todayIso } = require('../dates');
const { matchCharges, chargeStats, nextExpected, chargeStatus, comparePrice } = require('../recurring');
const { isSplitPart } = require('../tx-role');
const { symbolOf, isForeign } = require('../currency');
/* Namespace import, this repo's convention wherever a bare `t` could be
   shadowed — and it is here: renderServices binds `const t = $('#svcTable')`. */
const i18n = require('../i18n');

module.exports = function registerServices(ctx) {
  const { S, $, app, money, moneyIn, toast, writeFile } = ctx;

  function monthlyEquiv(s) { return s.cycle === 'annual' ? s.amount / 12 : s.amount; }

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
    /* ISSUE 28/30. Two pools, not one, and the split is the whole fix.

       `Services.md` has no currency column, so `s.amount` is always in the
       household's currency. The charges it is compared against are raw
       amounts from whichever account they landed in. Compared blind, a
       Netflix subscription listed at R199 and really billed $15.99 on a
       dollar card produced `agrees: false`, `diff: -183.01` and a GREEN
       "really R 16" pill reading "Your bank is charging R 15.99, not
       R 199.00" — a 92% price cut, asserted as fact, on a price that never
       moved. The 4% band below was widened to absorb a currency wobble; it
       cannot absorb a 12x symbol mismatch.

       So PRICE is compared only against charges in the household's own
       currency, and LIVENESS still follows every charge whatever its
       currency — "did this merchant bill me" is a question about events, not
       amounts, and a subscription paid from a euro card is no less alive. A
       service with only foreign charges gets no price verdict at all and
       says so, rather than a confident wrong one.

       Parts are skipped, parents are kept: this is asking what the MERCHANT
       charged, and a split is the reader slicing one charge into categories
       after the fact. Feeding both would show a subscription being billed twice
       a month, and — worse, because it is silent — would drag the median of the
       last three charges that comparePrice() and nextExpected() are built on. */
    const homeRows = [];
    for (const f of Object.values(S.txFiles)) {
      const acct = typeof ctx.accountForLabel === 'function' ? ctx.accountForLabel(f.label) : null;
      const foreign = isForeign(acct, S.settings.currency);
      for (const r of f.rows) {
        if (isSplitPart(r)) continue;
        const stamped = foreign ? { ...r, _symbol: symbolOf(acct, S.settings.currency) } : r;
        rows.push(stamped);
        if (!foreign) homeRows.push(stamped);
      }
    }
    const today = todayIso();
    const out = new Map();
    for (const s of S.services) {
      const m = matchCharges(s, rows);
      const home = matchCharges(s, homeRows);
      const stats = chargeStats(home.charges);
      /* The symbols this service was actually billed in, other than the
         household's — named on the row so a reader can see WHY no price
         verdict is offered rather than just noticing one is missing. */
      const foreignSymbols = [...new Set(m.charges.map(r => r._symbol).filter(Boolean))];
      out.set(s, {
        stats,
        foreignSymbols,
        /* Charges exist, but none of them in a currency this figure can be
           compared against. */
        priceUncomparable: !home.charges.length && m.charges.length > 0,
        // Liveness follows the MERCHANT — every description the tokens hit —
        // because a renamed debit order is not a cancellation.
        status: chargeStatus(chargeStats(m.all), s.cycle, today),
        price: comparePrice(s, stats),
        /* Anchored on the merchant, like the liveness pill above and for the
           same reason: the next charge follows the LAST one under any of its
           names. Read through the dominant group alone, a renamed debit order
           projects its due date from a charge months old — which is how
           committed.js came to drop a live service from "What's left". */
        next: nextExpected(chargeStats(m.all), s.cycle),
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
    if (!c.stats) {
      out.push(el('span', { class: 'category-badge badge-dup',
        title: `No charge in your transactions matches "${s.provider || s.name}". Either it is paid from an account you have not imported, or the name here does not match what your bank prints.` },
      'not seen'));
      return out;
    }
    if (s.active && c.status && c.status.state === 'overdue') {
      const months = Math.round(c.status.daysSince / 30);
      out.push(el('span', { class: 'category-badge badge-transfer',
        title: `Last charged ${c.stats.last}. Still marked active — has it been cancelled?` },
      `last charged ${months}mo ago`));
    }
    if (c.price && c.price.varies) {
      out.push(el('span', { class: 'category-badge badge-dup',
        title: 'The recent charges for this merchant differ too much from each other to call any of them the price — top-ups, or several products billed under one name.' },
      'varies'));
    } else if (c.price && !c.price.agrees) {
      const d = c.price.diff;
      out.push(el('span', { class: `category-badge ${d > 0 ? 'badge-debt' : 'badge-savings'}`,
        title: `Your bank is charging ${money(c.price.actual)}, not ${money(c.price.stated)}. Based on the last few charges, so a price rise shows up here rather than an old average.` },
      `really ${money(c.price.actual, 0)}`));
    } else if (c.priceUncomparable) {
      /* Neutral, not a warning: nothing is wrong with this service, the app
         simply cannot check its price. Saying so beats both alternatives —
         a silent blank reads as "checked and fine", and the old behaviour
         asserted a price change that never happened. */
      out.push(el('span', { class: 'category-badge badge-dup',
        title: `This service is billed in ${c.foreignSymbols.join(' · ')}, and the amount on this page is in ${S.settings.currency}. `
          + 'Comparing them would need an exchange rate for the day of each charge, which this vault does not store — so no price check is offered rather than a wrong one.' },
      `billed in ${c.foreignSymbols.join(' · ')}`));
    }
    return out;
  }

  /* A one-tap "use the date the charges imply". Only offered when it differs
     from what is already there, so a correct row shows nothing. */
  function svcNextHint(s, c) {
    const stale = !s.next || s.next < todayIso();
    const btn = el('button', { type: 'button', class: 'svc-next-hint',
      title: `Billed around day ${c.stats.day} each ${s.cycle === 'annual' ? 'year' : 'month'}; last charged ${c.stats.last}.`,
      'aria-label': `Set next billing for ${s.name} to ${c.next}` },
    icoEl(['calendar-check', 'calendar']), stale ? `due ${c.next}` : c.next);
    btn.addEventListener('click', () => { s.next = c.next; mark(); renderServices(); });
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
          body.append(el('tr', { class: s.active ? '' : 'svc-inactive' },
            el('td', { style: 'font-weight:600' }, s.name, ctx.noteButton('service', s.name), ...svcFlags(s, c)),
            el('td', { class: 'text-muted' }, s.provider),
            el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: s.amount || '',
              'aria-label': `Amount for ${s.name}`,
              /* amountRaw = null: a number typed here supersedes the verbatim
                 text table-schema.js keeps for a cell it could not read. */
              onchange: e => { s.amount = parseFloat(e.target.value) || 0; s.amountRaw = null; refresh(); } })),
            el('td', {}, el('select', { class: 'form-select form-select-sm', 'aria-label': `Billing cycle for ${s.name}`,
              onchange: e => { s.cycle = e.target.value === 'annual' ? 'annual' : 'monthly'; refresh(); } },
              el('option', { value: 'monthly', ...(s.cycle === 'monthly' ? { selected: '' } : {}) }, 'monthly'),
              el('option', { value: 'annual', ...(s.cycle === 'annual' ? { selected: '' } : {}) }, 'annual'))),
            // dateInput, not a bare type="date": a hand-edited "end of month"
            // renders blank in a date input, hiding a value that is still on disk.
            el('td', {}, dateInput(s.next, { class: 'form-control form-control-sm', style: 'width:140px',
              'aria-label': `Next billing date for ${s.name}` },
              v => { s.next = v; mark(); }),
            /* The typed date is a fossil the moment it passes — every value on
               the vault this was built against was months old. The charge
               history already knows: billed on the 2nd, last seen 2 July, so
               next is 2 August. Offered rather than written, because the reader
               may be tracking a plan change the history cannot know about. */
            ...(c.next && c.next !== s.next ? [svcNextHint(s, c)] : [])),
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
      prose: ['Recurring services and subscriptions. `cycle` is `monthly` or `annual`.'],
      schema: SCHEMAS.services, rows: S.services,
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
      { key: 'cycle', label: 'Billing cycle', type: 'select', value: 'monthly', options: [
        { value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }] },
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
      cycle: r.cycle === 'annual' ? 'annual' : 'monthly', next, category: (r.category || '').trim(), active: true, notes: '',
      // '' when it merely restates the household symbol — see usedColumns().
      currency: (r.currency || '').trim() === (S.settings.currency || '') ? '' : (r.currency || '').trim() });
    mark(); renderServices();
  }

  ctx.provide({ renderServices, saveServices, addService, serializeServices });
};
