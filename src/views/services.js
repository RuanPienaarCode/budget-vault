'use strict';
/* Services — recurring subscriptions grouped by budget category, saved to
   Services.md. */

const { el, escMd } = require('../util');
const { askFields } = require('../modal');

module.exports = function registerServices(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  function monthlyEquiv(s) { return s.cycle === 'annual' ? s.amount / 12 : s.amount; }

  function renderServices() {
    const active = S.services.filter(s => s.active);
    const perMonth = active.reduce((sum, s) => sum + monthlyEquiv(s), 0);
    const kpis = $('#servicesKpis'); kpis.innerHTML = '';
    const tile = (l, v) => kpis.append(el('div', { class: 'mini' },
      el('div', { class: 'l' }, l), el('div', { class: 'v num' }, v)));
    tile('Per month', money(perMonth));
    tile('Per year', money(perMonth * 12));
    tile('Active', String(active.length));
    tile('Total services', String(S.services.length));

    const mark = () => { S.servicesDirty = true; $('#svcSave').disabled = false; };
    const t = $('#svcTable'); t.innerHTML = '';
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Service'), el('th', { scope: 'col' }, 'Provider'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
      el('th', { scope: 'col' }, 'Cycle'), el('th', { scope: 'col' }, 'Next billing'), el('th', { scope: 'col' }, 'Active'), el('th', { scope: 'col' }, ''))));
    const body = el('tbody', {});
    const groups = Object.create(null);   // null-proto: a "__proto__"/"constructor" category can't crash the view
    for (const s of S.services) (groups[s.category || 'Uncategorised'] ??= []).push(s);
    for (const cat of Object.keys(groups).sort()) {
      const gMonthly = groups[cat].filter(s => s.active).reduce((sum, s) => sum + monthlyEquiv(s), 0);
      body.append(el('tr', { class: 'type-row' },
        el('td', { colspan: '6' }, cat),
        el('td', { class: 'num' }, `${money(gMonthly, 0)}/mo`)));
      for (const s of groups[cat]) {
        body.append(el('tr', { class: s.active ? '' : 'svc-inactive' },
          el('td', { style: 'font-weight:600' }, s.name),
          el('td', { class: 'text-muted' }, s.provider),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: s.amount || '',
            onchange: e => { s.amount = parseFloat(e.target.value) || 0; mark(); renderServices(); } })),
          el('td', { class: 'text-muted' }, s.cycle),
          el('td', { class: 'text-muted' }, s.next || '—'),
          el('td', {}, el('input', { type: 'checkbox', ...(s.active ? { checked: '' } : {}),
            onchange: e => { s.active = e.target.checked; mark(); renderServices(); } })),
          el('td', {}, el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem', 'aria-label': `Remove ${s.name}`,
            onclick: () => { S.services.splice(S.services.indexOf(s), 1); mark(); renderServices(); } }, '✕'))));
      }
    }
    if (!S.services.length) body.append(el('tr', {}, el('td', { colspan: '7', class: 'text-muted' }, 'No services yet.')));
    t.append(body);
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
      { key: 'amount', label: 'Monthly amount', type: 'number', value: '0' },
      { key: 'category', label: 'Budget category', type: 'select', options: ['', ...S.categories.map(c => c.name)], value: '' },
    ]);
    if (!r || !r.name.trim()) return;
    const amount = parseFloat(String(r.amount).replace(',', '.'));
    if (isNaN(amount)) return toast('Not a number', true);
    S.services.push({ name: r.name.trim(), provider: (r.provider || '').trim(), amount, cycle: 'monthly', next: '', category: (r.category || '').trim(), active: true, notes: '' });
    S.servicesDirty = true; $('#svcSave').disabled = false; renderServices();
  }

  Object.assign(ctx, { renderServices, saveServices, addService });
};
