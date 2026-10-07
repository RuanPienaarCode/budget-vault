'use strict';
/* Owed Money — who owes the household what, saved to Owed Money.md. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile } = require('../table-schema');
const { askFields } = require('../modal');
const { daysSince } = require('../reconcile');
/* A new entry is stamped with the day it was created — see addOwed for why a
   default beats an empty field here. Read through todayIso() rather than
   `new Date()` so it is a LOCAL calendar date, the distinction dates.js exists
   to keep. */
const { todayIso } = require('../dates');
/* The definitions of "outstanding" and "settled" now live in owed-math.js,
   because the Dashboard's position band states an outstanding total too. Two
   copies of this arithmetic in one app is exactly the drift worth.js exists to
   prevent — a dashboard that forgot to net part-payments off would report a
   half-recovered loan as still fully owed, on the screen read first. */
const { outstandingOf, isSettled, owedSummary } = require('../owed-math');
const { symbolOf, isForeign } = require('../currency');
/* A negative typed into Amount is kept and shown; owed-math floors it in every
   total. See worth.js's typedBelowZero for the rule the note follows. */
const { typedBelowZero, shownFigure } = require('../worth');

module.exports = function registerOwed(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  /* A row's OWN figures in its OWN symbol — the same formatter views/assets.js
     calls aMoney(). The page total holds foreign entries out and names them
     ("plus € 300 owed in other currencies"), but each row's pill, its title,
     the repayment dialog and the toast after it all went through money(), the
     household formatter: a €500 loan with €200 back read "R 300 left" right
     under that sentence. A true figure under a false symbol is a claim the
     household holds rand it does not. */
  const oMoney = (o, v, dp = 2) => (isForeign(o, S.settings.currency) && typeof ctx.moneyIn === 'function'
    ? ctx.moneyIn(symbolOf(o, S.settings.currency), v, dp)
    : money(v, dp));

  const { mark, clear: clearDirty } = ctx.dirtyFlag('owedDirty', '#owedSave');

  /* The only thing outside the table that reads a row, so an edited amount can
     refresh here without rebuilding the field being typed in. */
  function renderOwedKpis() {
    // Outstanding is net of part-payments, so it answers "how much is actually
    // still out there" rather than "what did I originally lend".
    const s = owedSummary(S.owed, undefined, S.settings.currency);
    const tile = kpiTiles($('#owedKpis'));
    /* Entries in another currency are stated beside the figure, never added
       into it — see owedSummary()'s own header. */
    const inOwn = list => list
      .map(([sym, v]) => (typeof ctx.moneyIn === 'function' ? ctx.moneyIn(sym, v, 0) : `${sym} ${Math.round(v)}`))
      .join(' · ');
    const owedOthers = (s.otherCurrencies || []);
    const otherTag = owedOthers.length
      ? `plus ${inOwn(owedOthers)} owed in other currencies`
      : null;
    tile('Outstanding', money(s.outstanding), s.outstanding > 0 ? 'text-warning' : '', otherTag);
    /* Money that came back in another currency needs saying for the same
       reason money still out does. It cannot join the rand figure beside it —
       €200 is not R200 and this app never invents a rate — and until
       owedSummary grew `recoveredOthers` it had nowhere else to go, so a
       recovered foreign part-payment was disclosed nowhere on the page while
       its unrecovered half was disclosed on the tile directly above. One
       ledger, half of it visible. */
    const backOthers = (s.recoveredOthers || []);
    tile('Recovered', money(s.recovered), 'text-success',
      backOthers.length ? `plus ${inOwn(backOthers)} recovered in other currencies` : null);
    tile('Entries', String(s.entries));
  }

  /* focusRow: index into S.owed whose status pill should get focus back after
     a rebuild. Rebuilding the table drops focus to <body>, and cycling status
     is the main interaction here — a keyboard or screen-reader user was being
     ejected to the top of the page on every single click.

     An INDEX rather than a name — two rows can share a person's name (Sam
     twice is the normal case for two separate loans to the same person), and
     the previous version looked the row up with S.owed.findIndex(person ===
     focusPerson), which returns the FIRST match: clicking the second Sam's
     pill returned focus to the first one. views/debts.js carries the same
     comment for the identical bug, fixed there by index — this ripples that
     fix over here. */
  function renderOwed(focusRow) {
    renderOwedKpis();
    const t = $('#owedTable');
    keepScroll(t, () => {
      t.empty();
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Person'), el('th', { scope: 'col' }, 'Description'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
        /* Lent before Due, in the order the money moves. */
        el('th', { scope: 'col' }, 'Lent'), el('th', { scope: 'col' }, 'Due date'),
        el('th', { scope: 'col' }, 'Status'), el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      for (const o of S.owed) {
        const settled = isSettled(o);
        const left = outstandingOf(o);
        const label = settled ? 'Paid' : (o.repaid > 0 ? `${oMoney(o, left, 0)} left` : 'Outstanding');
        const pill = el('button', { class: `status-pill status-${settled ? 'paid' : 'outstanding'}`,
          title: o.repaid > 0 ? `${oMoney(o, o.amount)} lent · ${oMoney(o, o.repaid)} back · ${oMoney(o, left)} outstanding` : '',
          'aria-label': `${o.person}: ${label} — click to change` },
          icoEl(settled ? ['circle-check', 'check-circle'] : ['hourglass']), label);
        pill.addEventListener('click', () => { const row = S.owed.indexOf(o); o.status = settled ? 'outstanding' : 'paid'; mark(); renderOwed(row); });
        /* Age, not the due date. The due-date column was empty on every row of
           the vault this was built against — it asks for something you do not
           have when you lend to family. How long the money has been gone is
           derivable, and is the figure that actually applies pressure.

           That argument still holds. What did not, until now, is that `lent`
           was READ here and by owedSummary's `oldestDays` and written by
           NOTHING: the table rendered no field for it and addOwed hardcoded it
           empty, so the one figure this comment calls the real pressure was
           unreachable for any entry the app itself created. Measured on a real
           vault: 0 of 6 entries carried a lent date, while the only unsettled
           one carried a due date already in the past — the exact inverse of the
           premise above. The column exists in Owed Money.md's schema and always
           did; only the way in was missing. See issue #34. */
        const age = daysSince(o.lent);
        /* Beside the Amount field, updated in place by its editor (the row is
           not rebuilt on an amount edit — see the comment on that field).
           Empty unless the figure was typed below zero. */
        const belowZeroNote = el('div', { class: 'text-muted', style: 'font-size:11.5px' });
        const syncBelowZero = () => {
          belowZeroNote.textContent = typedBelowZero(o, 'amount') !== null ? 'counts as 0 in the totals' : '';
        };
        syncBelowZero();
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
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', min: '0', class: 'form-control form-control-sm', value: shownFigure(o, 'amount'),
            'aria-label': `Amount for ${o.person}`,
            /* A negative is KEPT as typed, and the row says it counts as 0.
               This used to floor it with Math.max(0, …) — because a negative
               amount once made owedSummary's recovered branch subtract it from
               money that came BACK (a -500 row on a book with R500 recovered
               dropped Recovered to R0). owed-math floors `amount` in every
               total now (outstandingOf, and the `amt` in both of
               owedSummary's branches), so the clamp had become nothing but a
               silent correction: the field kept showing "-450" while 0.00 went
               to disk. And the loader has always read a negative in this cell
               as itself — Amount is not a floored column — so keeping the
               typed number is also what makes the field mean the same thing
               before and after a reload. */
            /* amountRaw = null: a number typed here supersedes the verbatim text
               table-schema.js keeps for a cell it could not read (see money()
               there) — same as views/budgets.js clearing amountRaw on edit. */
            /* normalizeAmount, not `parseFloat(...) || 0` — the same guard
               views/assets.js documents. An empty field (which is what a plain
               number input reports when an SA-locale keypad writes
               "15 000 000,00" into it) used to read as 0 and, with amountRaw
               cleared beside it, erase the reader's own text on the next save.
               addOwed above already parses this way. A rejected entry puts the
               stored figure back in the field: it used to leave it blank while
               the old figure was the one the next save wrote. */
            onchange: e => {
              const v = normalizeAmount(e.target.value);
              if (v === null) {
                toast('Amount must be a number', true);
                e.target.value = String(shownFigure(o, 'amount'));
                renderOwedKpis(); return;
              }
              o.amount = v; o.amountRaw = null; mark(); renderOwedKpis(); syncBelowZero();
            } }), belowZeroNote),
          /* The age caption under the person's name is derived from this, so
             editing it re-renders the row rather than only marking dirty —
             unlike the amount field, whose figure is read by the KPI tiles and
             not by the row itself. renderOwed(row) restores focus to the
             status pill, matching what the pill's own handler does. */
          el('td', {}, dateInput(o.lent, { class: 'form-control form-control-sm', style: 'width:120px', 'aria-label': `Date lent to ${o.person}` },
            v => { const row = S.owed.indexOf(o); o.lent = v; mark(); renderOwed(row); })),
          el('td', {}, dateInput(o.due, { class: 'form-control form-control-sm', style: 'width:120px', 'aria-label': `Due date for ${o.person}` },
            v => { o.due = v; mark(); })),
          el('td', {}, pill),
          el('td', {}, el('div', { class: 'owed-acts' },
            el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Record a repayment from ${o.person}`,
              title: 'Record money that came back', onclick: () => recordRepayment(o) }, icoEl(['plus'])),
            el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${o.person}`,
              onclick: () => { S.owed.splice(S.owed.indexOf(o), 1); mark(); renderOwed(); } }, '✕')))));
      }
      if (!S.owed.length) body.append(el('tr', {}, el('td', { colspan: '7', class: 'text-muted' }, 'No entries yet.')));
      t.append(body);
    });
    if (focusRow !== undefined && focusRow >= 0) {
      const pill = t.querySelectorAll('.status-pill')[focusRow];
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
        desc: `${oMoney(o, o.amount)} lent · ${oMoney(o, o.repaid || 0)} back so far.` },
    ]);
    if (!r) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null || amount <= 0) return toast('Not a number', true);
    o.repaid = (o.repaid || 0) + amount; o.repaidRaw = null;
    // Settling the last of it closes the entry, so "paid" stays something the
    // arithmetic concludes rather than a second thing to remember. Through
    // isSettled(), not `outstandingOf(o) === 0` — the repayment box defaults
    // to `left.toFixed(2)`, which rounds DOWN a three-decimal cell and can
    // leave a sub-cent residue that exact equality never clears.
    if (isSettled(o)) o.status = 'paid';
    mark(); renderOwed(S.owed.indexOf(o));
    toast(`${oMoney(o, amount)} back from ${o.person}`);
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
      // ISSUE 67/69 — a paragraph above/below the table and a hand-added
      // column both survive a save now; see load.js's tableParts.
      leadRaw: S.owedLead, trailRaw: S.owedTrail, extraCols: S.owedExtraCols,
    });
  }

  /* Guarded like every other write on this page's Save button: a rejected
     write — a full disk, a sync lock — used to be an unhandled rejection.
     With no try/catch there was no toast and no cleanup to run, so the dirty
     flag was left exactly as it was (clearDirty() sits AFTER the write and
     never ran on a rejection) with nothing on screen to say the save had
     failed. The button stayed lit and the flag stayed dirty by ACCIDENT, not
     by design — the only bug was the silence. Now the failure toasts and the
     same left-dirty state is kept on purpose, so the same click retries. */
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
      /* One direction only, because that is all this page can count:
         owedSummary() treats every entry as a receivable and worth.js adds
         what is outstanding to net worth. "Who owes / is owed?" invited the
         other direction too, and a debt the household owes, entered here,
         RAISED its net worth by the amount owed. The file has no direction
         column for the arithmetic to tell the two apart, so the question
         does it instead — and says where the other kind belongs. */
      { key: 'person', label: 'Who owes you?', type: 'text',
        desc: 'Money owed to the household. If it is money you owe someone, add it on the Debt page instead, where it is counted against you.' },
      { key: 'amount', label: 'Amount', type: 'number', value: '0' },
      /* ISSUE 30 — see views/assets.js. Blank means the household's currency,
         which is what every row already on disk says by saying nothing, so
         this is an option and never a question a single-currency household
         has to answer. */
      { key: 'currency', label: 'Currency', type: 'text', value: '',
        placeholder: S.settings.currency || 'R',
        desc: 'Leave blank if it is in your own currency. Set it if this one is not — the figure is then shown in its own currency and stated separately rather than added into your totals.' },
    ]);
    if (!r || !r.person.trim()) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    // Kept as typed, the same as the in-table Amount field — see the comment
    // there. owed-math floors a negative in every total; the row says so.
    /* `lent` defaults to TODAY rather than staying empty. You are recording
       the loan at the moment you make it in the overwhelming case, an empty
       date makes the age caption and oldestDays unreachable (issue #34), and
       a wrong-by-a-few-days age is worth far more than no age at all. It is a
       plain date field in the table, so correcting it is one tap. `due` stays
       empty on purpose — nothing can guess when it comes back. */
    S.owed.push({ person: r.person.trim(), amount, description: '', due: '', status: 'outstanding', repaid: 0, lent: todayIso(),
      // '' when it merely restates the household symbol — see usedColumns().
      currency: (r.currency || '').trim() === (S.settings.currency || '') ? '' : (r.currency || '').trim() });
    mark(); renderOwed();
  }

  // serializeOwed is published so a round-trip test can drive the real one.
  ctx.provide({ renderOwed, saveOwed, addOwed, serializeOwed });
};
