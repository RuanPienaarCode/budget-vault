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

module.exports = function registerServices(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  function monthlyEquiv(s) { return s.cycle === 'annual' ? s.amount / 12 : s.amount; }

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
    /* Parts are skipped, parents are kept: this is asking what the MERCHANT
       charged, and a split is the reader slicing one charge into categories
       after the fact. Feeding both would show a subscription being billed twice
       a month, and — worse, because it is silent — would drag the median of the
       last three charges that comparePrice() and nextExpected() are built on. */
    for (const f of Object.values(S.txFiles)) for (const r of f.rows) if (!isSplitPart(r)) rows.push(r);
    const today = todayIso();
    const out = new Map();
    for (const s of S.services) {
      const m = matchCharges(s, rows);
      const stats = chargeStats(m.charges);
      out.set(s, {
        stats,
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
    const perMonth = active.reduce((sum, s) => sum + monthlyEquiv(s), 0);
    const tile = kpiTiles($('#servicesKpis'));
    tile('Per month', money(perMonth));
    tile('Per year', money(perMonth * 12));
    tile('Active', String(active.length));
    tile('Total services', String(S.services.length));
  }

  /* The per-category subtotal rows are the other thing an amount feeds. They
     hold no inputs, so they are safe to replace in place. */
  function renderServiceSubtotals() {
    const groups = Object.create(null);
    for (const s of S.services) (groups[s.category || 'Uncategorised'] ??= []).push(s);
    for (const row of $('#svcTable').querySelectorAll('tr.type-row')) {
      const cat = row.dataset.cat;
      const list = groups[cat] || [];
      const gMonthly = list.filter(s => s.active).reduce((sum, s) => sum + monthlyEquiv(s), 0);
      row.lastElementChild.textContent = `${money(gMonthly, 0)}/mo`;
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
      const groups = Object.create(null);   // null-proto: a "__proto__"/"constructor" category can't crash the view
      for (const s of S.services) (groups[s.category || 'Uncategorised'] ??= []).push(s);
      for (const cat of Object.keys(groups).sort()) {
        const gMonthly = groups[cat].filter(s => s.active).reduce((sum, s) => sum + monthlyEquiv(s), 0);
        body.append(el('tr', { class: 'type-row', 'data-cat': cat },
          el('td', { colspan: '6' }, cat),
          el('td', { class: 'num' }, `${money(gMonthly, 0)}/mo`)));
        for (const s of groups[cat]) {
          const refresh = () => { mark(); renderServicesKpis(); renderServiceSubtotals(); };
          const c = charged.get(s) || {};
          body.append(el('tr', { class: s.active ? '' : 'svc-inactive' },
            el('td', { style: 'font-weight:600' }, s.name, ctx.noteButton('service', s.name), ...svcFlags(s, c)),
            el('td', { class: 'text-muted' }, s.provider),
            el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: s.amount || '',
              'aria-label': `Amount for ${s.name}`,
              onchange: e => { s.amount = parseFloat(e.target.value) || 0; refresh(); } })),
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

  /* Guarded for the same reason as every save on this page's Save button: a
     rejected write used to be an unhandled rejection, dirty state already
     gone, the button dark over data that never landed. Left dirty and lit on
     failure so the same click retries. */
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
    ]);
    if (!r || !r.name.trim()) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    const next = ISO_DATE.test((r.next || '').trim()) ? r.next.trim() : '';
    S.services.push({ name: r.name.trim(), provider: (r.provider || '').trim(), amount,
      cycle: r.cycle === 'annual' ? 'annual' : 'monthly', next, category: (r.category || '').trim(), active: true, notes: '' });
    mark(); renderServices();
  }

  ctx.provide({ renderServices, saveServices, addService, serializeServices });
};
