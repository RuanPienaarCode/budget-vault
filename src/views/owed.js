'use strict';
/* Owed Money — who owes the household what, saved to Owed Money.md. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { escMd } = require('../markdown');
const { askFields } = require('../modal');
const { daysSince } = require('../reconcile');

module.exports = function registerOwed(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('owedDirty', '#owedSave');

  /* What is still owed. The page used to offer `outstanding | paid` and nothing
     between, so a reader recovering R900 of R4 000 had to choose which lie to
     tell — and on the vault this was built against every single entry was
     marked paid while the transactions showed partial recovery.

     "Paid" is now something the arithmetic can CONCLUDE. The explicit status is
     still honoured, because money comes back in ways the vault never sees — cash,
     a favour, a debt forgiven — and a reader who says it is settled is right. */
  const outstandingOf = o => Math.max(0, (o.amount || 0) - (o.repaid || 0));
  const isSettled = o => o.status === 'paid' || outstandingOf(o) === 0;

  /* The only thing outside the table that reads a row, so an edited amount can
     refresh here without rebuilding the field being typed in. */
  function renderOwedKpis() {
    // Outstanding is now net of part-payments, so it answers "how much is
    // actually still out there" rather than "what did I originally lend".
    const outstanding = S.owed.filter(o => !isSettled(o)).reduce((s, o) => s + outstandingOf(o), 0);
    const back = S.owed.reduce((s, o) => s + Math.min(o.repaid || 0, o.amount || 0), 0)
      + S.owed.filter(o => o.status === 'paid' && !(o.repaid > 0)).reduce((s, o) => s + (o.amount || 0), 0);
    const tile = kpiTiles($('#owedKpis'));
    tile('Outstanding', money(outstanding), outstanding > 0 ? 'text-warning' : '');
    tile('Recovered', money(back), 'text-success');
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
      t.empty();
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Person'), el('th', { scope: 'col' }, 'Description'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
        el('th', { scope: 'col' }, 'Due date'), el('th', { scope: 'col' }, 'Status'), el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      for (const o of S.owed) {
        const settled = isSettled(o);
        const left = outstandingOf(o);
        const label = settled ? 'Paid' : (o.repaid > 0 ? `${money(left, 0)} left` : 'Outstanding');
        const pill = el('button', { class: `status-pill status-${settled ? 'paid' : 'outstanding'}`,
          title: o.repaid > 0 ? `${money(o.amount)} lent · ${money(o.repaid)} back · ${money(left)} outstanding` : '',
          'aria-label': `${o.person}: ${label} — click to change` },
          icoEl(settled ? ['circle-check', 'check-circle'] : ['hourglass']), label);
        pill.addEventListener('click', () => { o.status = settled ? 'outstanding' : 'paid'; mark(); renderOwed(o.person); });
        /* Age, not the due date. The due-date column was empty on every row of
           the vault this was built against — it asks for something you do not
           have when you lend to family. How long the money has been gone is
           derivable, and is the figure that actually applies pressure. */
        const age = daysSince(o.lent);
        body.append(el('tr', {},
          el('td', { style: 'font-weight:600' }, o.person,
            ...(age !== null && !settled
              ? [el('div', { class: 'owed-age' }, `out ${age} day${age === 1 ? '' : 's'}`)] : [])),
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
          el('td', {}, el('div', { class: 'owed-acts' },
            el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Record a repayment from ${o.person}`,
              title: 'Record money that came back', onclick: () => recordRepayment(o) }, icoEl(['plus'])),
            el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${o.person}`,
              onclick: () => { S.owed.splice(S.owed.indexOf(o), 1); mark(); renderOwed(); } }, '✕')))));
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

  /* Money that came back. Recorded by hand rather than matched automatically:
     a wrongly matched repayment silently understates what someone owes you,
     which ends an obligation that has not been met — a worse failure than
     missing one, and not one the reader would ever spot. */
  async function recordRepayment(o) {
    const left = outstandingOf(o);
    const r = await askFields(app, `Repayment from ${o.person}`, [
      { key: 'amount', label: 'Amount that came back', type: 'number', value: left ? left.toFixed(2) : '',
        desc: `${money(o.amount)} lent · ${money(o.repaid || 0)} back so far.` },
    ]);
    if (!r) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null || amount <= 0) return toast('Not a number', true);
    o.repaid = (o.repaid || 0) + amount;
    // Settling the last of it closes the entry, so "paid" stays something the
    // arithmetic concludes rather than a second thing to remember.
    if (outstandingOf(o) === 0) o.status = 'paid';
    mark(); renderOwed(o.person);
    toast(`${money(amount)} back from ${o.person}`);
  }

  function serializeOwed() {
    const lines = ['---', ...(S.owedFm || 'kind: owed').split('\n'), '---', '', '# Owed Money', '',
      'Money owed to the household. `status` is `outstanding` or `paid`.',
      '`Repaid` is how much has come back; `Lent` is when it went out.', '',
      '| Person | Amount | Description | Due date | Status | Repaid | Lent |',
      '|--------|-------:|-------------|----------|--------|-------:|------|'];
    for (const o of S.owed) {
      lines.push(`| ${escMd(o.person)} | ${o.amount.toFixed(2)} | ${escMd(o.description)} | ${escMd(o.due)} | ${o.status} | ${(o.repaid || 0).toFixed(2)} | ${escMd(o.lent || '')} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  async function saveOwed() {
    await writeFile('Owed Money.md', serializeOwed());
    clearDirty();
    toast('Saved Owed Money.md');
  }

  async function addOwed() {
    const r = await askFields(app, 'New owed entry', [
      { key: 'person', label: 'Who owes / is owed?', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', value: '0' },
    ]);
    if (!r || !r.person.trim()) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    S.owed.push({ person: r.person.trim(), amount, description: '', due: '', status: 'outstanding', repaid: 0, lent: '' });
    mark(); renderOwed();
  }

  // serializeOwed is published so a round-trip test can drive the real one.
  ctx.provide({ renderOwed, saveOwed, addOwed, serializeOwed });
};
