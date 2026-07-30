'use strict';
/* Services — recurring subscriptions grouped by budget category, saved to
   Services.md. */

const { el, dateInput, keepScroll, escMd } = require('../util');
const { askFields } = require('../modal');

module.exports = function registerServices(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  function monthlyEquiv(s) { return s.cycle === 'annual' ? s.amount / 12 : s.amount; }
  const mark = () => { S.servicesDirty = true; $('#svcSave').disabled = false; };
  ctx.registerDirty(() => S.servicesDirty);

  /* Split out so an edited amount can refresh the totals without rebuilding
     the row it was typed into — on a phone `change` fires on blur, so a full
     rebuild lands between the tap that leaves a field and the one arriving at
     the next, and the arriving tap hits whatever now occupies those pixels. */
  function renderServicesKpis() {
    const active = S.services.filter(s => s.active);
    const perMonth = active.reduce((sum, s) => sum + monthlyEquiv(s), 0);
    const kpis = $('#servicesKpis'); kpis.empty();
    const tile = (l, v) => kpis.append(el('div', { class: 'mini' },
      el('div', { class: 'l' }, l), el('div', { class: 'v num' }, v)));
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

  function renderServices() {
    renderServicesKpis();
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
          body.append(el('tr', { class: s.active ? '' : 'svc-inactive' },
            el('td', { style: 'font-weight:600' }, s.name),
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
              v => { s.next = v; mark(); })),
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

  function serializeServices() {
    const lines = ['---', ...(S.servicesFm || 'kind: services').split('\n'), '---', '', '# Services & Subscriptions', '',
      'Recurring services and subscriptions. `cycle` is `monthly` or `annual`.', '',
      '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |',
      '|------|----------|-------:|-------|--------------|----------|--------|-------|'];
    for (const s of S.services) {
      lines.push(`| ${escMd(s.name)} | ${escMd(s.provider)} | ${s.amount.toFixed(2)} | ${s.cycle} | ${escMd(s.next)} | ${escMd(s.category)} | ${s.active ? 'yes' : 'no'} | ${escMd(s.notes)} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  async function saveServices() {
    await writeFile('Services.md', serializeServices());
    S.servicesDirty = false; $('#svcSave').disabled = true;
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
    const amount = parseFloat(String(r.amount).replace(',', '.'));
    if (isNaN(amount)) return toast('Not a number', true);
    const next = /^\d{4}-\d{2}-\d{2}$/.test((r.next || '').trim()) ? r.next.trim() : '';
    S.services.push({ name: r.name.trim(), provider: (r.provider || '').trim(), amount,
      cycle: r.cycle === 'annual' ? 'annual' : 'monthly', next, category: (r.category || '').trim(), active: true, notes: '' });
    S.servicesDirty = true; $('#svcSave').disabled = false; renderServices();
  }

  ctx.provide({ renderServices, saveServices, addService, serializeServices });
};
