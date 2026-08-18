'use strict';
/* Owed Money — who owes the household what, saved to Owed Money.md. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile } = require('../table-schema');
const { askFields } = require('../modal');
const { daysSince } = require('../reconcile');
/* The definitions of "outstanding" and "settled" now live in owed-math.js,
   because the Dashboard's position band states an outstanding total too. Two
   copies of this arithmetic in one app is exactly the drift worth.js exists to
   prevent — a dashboard that forgot to net part-payments off would report a
   half-recovered loan as still fully owed, on the screen read first. */
const { outstandingOf, isSettled, owedSummary } = require('../owed-math');

module.exports = function registerOwed(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('owedDirty', '#owedSave');

  /* The only thing outside the table that reads a row, so an edited amount can
     refresh here without rebuilding the field being typed in. */
  function renderOwedKpis() {
    // Outstanding is net of part-payments, so it answers "how much is actually
    // still out there" rather than "what did I originally lend".
    const s = owedSummary(S.owed);
    const tile = kpiTiles($('#owedKpis'));
    tile('Outstanding', money(s.outstanding), s.outstanding > 0 ? 'text-warning' : '');
    tile('Recovered', money(s.recovered), 'text-success');
    tile('Entries', String(s.entries));
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
          el('td', { style: 'font-weight:600' }, o.person, ctx.noteButton('owed', o.person),
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

  /* Columns, escaping and number formatting come from the same declaration
     the loader reads with (table-schema.js, ADR-0003); only the prose is
     this view's own. */
  function serializeOwed() {
    return mdTableFile({
      fm: S.owedFm, fallback: 'kind: owed', title: 'Owed Money',
      prose: [
        'Money owed to the household. `status` is `outstanding` or `paid`.',
        '`Repaid` is how much has come back; `Lent` is when it went out.',
      ],
      schema: SCHEMAS.owed, rows: S.owed,
    });
  }

  /* Guarded like every other write on this page's Save button: a rejected
     write — a full disk, a sync lock — used to be an unhandled rejection with
     the dirty flag already gone and the Save button dark over data that was
     never written. Left dirty and lit on failure, so the same click retries. */
  async function saveOwed() {
    try {
      await writeFile('Owed Money.md', serializeOwed());
    } catch (e) {
      return toast(`Could not save Owed Money.md (${e.message || e})`, true);
    }
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
