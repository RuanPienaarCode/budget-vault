'use strict';
/* Owed Money — who owes the household what, saved to Owed Money.md. */

const { el, dateInput, keepScroll, escMd, icoEl } = require('../util');
const { askFields } = require('../modal');

module.exports = function registerOwed(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  const mark = () => { S.owedDirty = true; $('#owedSave').disabled = false; };
  ctx.registerDirty(() => S.owedDirty);

  /* The only thing outside the table that reads a row, so an edited amount can
     refresh here without rebuilding the field being typed in. */
  function renderOwedKpis() {
    const outstanding = S.owed.filter(o => o.status !== 'paid').reduce((s, o) => s + o.amount, 0);
    const paid = S.owed.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0);
    const kpis = $('#owedKpis'); kpis.innerHTML = '';
    const tile = (l, v, cls) => kpis.append(el('div', { class: 'mini' },
      el('div', { class: 'l' }, l), el('div', { class: `v num ${cls || ''}` }, v)));
    tile('Outstanding', money(outstanding), outstanding > 0 ? 'text-warning' : '');
    tile('Paid', money(paid), 'text-success');
    tile('Entries', String(S.owed.length));
  }

  /* focusPerson: after a rebuild, put focus back on that row's status pill.
     Rebuilding the table drops focus to <body>, and cycling status is the main
     interaction here — a keyboard or screen-reader user was being ejected to
     the top of the page on every single click. */
  function renderOwed(focusPerson) {
    renderOwedKpis();
    const t = $('#owedTable');
    keepScroll(t, () => {
      t.innerHTML = '';
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Person'), el('th', { scope: 'col' }, 'Description'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
        el('th', { scope: 'col' }, 'Due date'), el('th', { scope: 'col' }, 'Status'), el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      for (const o of S.owed) {
        const pill = el('button', { class: `status-pill status-${o.status}`,
          'aria-label': `${o.person}: ${o.status === 'paid' ? 'Paid' : 'Outstanding'} — click to change` },
          icoEl(o.status === 'paid' ? ['circle-check', 'check-circle'] : ['hourglass']),
          o.status === 'paid' ? 'Paid' : 'Outstanding');
        pill.addEventListener('click', () => { o.status = o.status === 'paid' ? 'outstanding' : 'paid'; mark(); renderOwed(o.person); });
        body.append(el('tr', {},
          el('td', { style: 'font-weight:600' }, o.person),
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: o.description, style: 'width:220px',
            'aria-label': `Description for ${o.person}`,
            onchange: e => { o.description = e.target.value; mark(); } })),
          // Only the KPI tiles read the amount — refresh those, never this table,
          // or the rebuild lands between the tap that leaves this field and the
          // tap that arrives at the next one.
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: o.amount || '',
            'aria-label': `Amount for ${o.person}`,
            onchange: e => { o.amount = parseFloat(e.target.value) || 0; mark(); renderOwedKpis(); } })),
          el('td', {}, dateInput(o.due, { class: 'form-control form-control-sm', style: 'width:120px', 'aria-label': `Due date for ${o.person}` },
            v => { o.due = v; mark(); })),
          el('td', {}, pill),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${o.person}`,
            onclick: () => { S.owed.splice(S.owed.indexOf(o), 1); mark(); renderOwed(); } }, '✕'))));
      }
      if (!S.owed.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' }, 'No entries yet.')));
      t.append(body);
    });
    if (focusPerson) {
      const i = S.owed.findIndex(o => o.person === focusPerson);
      const pill = t.querySelectorAll('.status-pill')[i];
      if (pill) pill.focus();
    }
  }

  function serializeOwed() {
    const lines = ['---', ...(S.owedFm || 'kind: owed').split('\n'), '---', '', '# Owed Money', '',
      'Money owed to the household. `status` is `outstanding` or `paid`.', '',
      '| Person | Amount | Description | Due date | Status |',
      '|--------|-------:|-------------|----------|--------|'];
    for (const o of S.owed) {
      lines.push(`| ${escMd(o.person)} | ${o.amount.toFixed(2)} | ${escMd(o.description)} | ${escMd(o.due)} | ${o.status} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  async function saveOwed() {
    await writeFile('Owed Money.md', serializeOwed());
    S.owedDirty = false; $('#owedSave').disabled = true;
    toast('Saved Owed Money.md');
  }

  async function addOwed() {
    const r = await askFields(app, 'New owed entry', [
      { key: 'person', label: 'Who owes / is owed?', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', value: '0' },
    ]);
    if (!r || !r.person.trim()) return;
    const amount = parseFloat(String(r.amount).replace(',', '.'));
    if (isNaN(amount)) return toast('Not a number', true);
    S.owed.push({ person: r.person.trim(), amount, description: '', due: '', status: 'outstanding' });
    S.owedDirty = true; $('#owedSave').disabled = false; renderOwed();
  }

  // serializeOwed is published so a round-trip test can drive the real one.
  ctx.provide({ renderOwed, saveOwed, addOwed, serializeOwed });
};
