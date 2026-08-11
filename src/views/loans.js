'use strict';
/* Loan Calculators — a home-loan and a vehicle-finance scratchpad.

   Nothing here is saved. This is the one view with no file behind it: it
   answers "what would this cost me" before there is anything to track, so it
   registers no dirty check and writes nothing to the vault.

   The arithmetic and every published bracket, cap and tariff live in
   ../loan-math (pure, separately tested); this file is presentation only.

   State lives in module closures rather than in S for the same reason — it is
   a what-if, not household data. The closure is created per mount, exactly the
   same lifetime as S, so a value typed here survives switching to another view
   and back, and is gone on reload, which is what a scratchpad should do. */

const { fact } = require('../facts');

const { el } = require('../dom');
const { totalsFor, amortise, byYear, loanProfileFor } = require('../loan-math');

module.exports = function registerLoans(ctx) {
  const { S, $, money } = ctx;

  /* Resolved per call, so changing country in settings applies on the next
     render without re-mounting — same contract as ctx.locale(). */
  const P = () => loanProfileFor(S.settings.country);

  /* `rate: null` means "still on the country default". Once the reader types a
     rate it is theirs and the profile stops overwriting it — without that flag
     a rate typed here would be silently reset on the next view switch, and
     with it always on, switching country would leave the previous country's
     default sitting under the new country's costs. */
  /* `deposit` is the amount and the one the maths reads; `depositPct` is the
     proportion it was last set at, remembered so that changing the price moves
     the deposit with it instead of stranding a figure from the old price.
     Deriving the amount from the percentage alone was not enough — a slider
     stepping in whole percent cannot express "the R200 000 I actually have",
     which is the number people know. */
  const home = { price: 1500000, deposit: 150000, depositPct: 10, rate: null, years: 20 };
  const car = { price: 350000, deposit: 35000, depositPct: 10, rate: null, months: 60, balloonPct: 0, insurance: false };

  /* Range readouts quote money, so they go stale when the currency changes —
     they are only rebuilt when their own slider moves. renderLoans() calls
     every one of these, which is the only place that knows the profile may
     have changed underneath. */
  const syncs = [];

  /* Rough comprehensive-cover estimate, deliberately crude and labelled as
     such on the page. It exists so the instalment is not mistaken for the cost
     of running the car — financing without insuring is not an option a lender
     offers — not to compete with a real quote. */
  /* Never checked against real South African premiums — src/facts.js records
     that as verified: null, and the UI copy has to keep saying so for as long
     as it does. */
  const INSURANCE_RATE = fact('za.vehicle.insurance.rate');
  const insuranceEstimate = price => Math.max(450, Math.round(price * INSURANCE_RATE));

  /* ------------------------------ fields --------------------------------- */
  /* A <label> WRAPPING its control associates the two without needing an id on
     every field, which matters here because the shell only carries container
     ids — the form itself is built in JS. */
  function numField(label, hint, value, attrs, commit) {
    const input = el('input', {
      type: 'number', inputmode: 'decimal', class: 'form-control form-control-sm',
      value: String(value), ...attrs,
    });
    input.addEventListener('input', () => commit(input.value));
    const hintEl = el('span', { class: 'lf-h' }, hint || '');
    const wrap = el('label', { class: 'loan-field' }, el('span', { class: 'lf-l' }, label), input, hintEl);
    return { wrap, input, hintEl };
  }

  /* The rate field, for both calculators. Kept together because the two share
     the "untouched fields follow the country default" behaviour, and because
     the hint under it is profile text that changes with the country. */
  function rateField(state, recalc) {
    const f = numField('Interest rate (% a year)', P().rateNote, state.rate ?? P().defaultRate,
      { min: '0', max: '40', step: '0.25' },
      // An emptied field means "I have not decided", not "0%". Reading a
      // cleared box as a zero-interest loan produced a cheerful, completely
      // wrong instalment mid-edit; back to null puts it on the country
      // default until a real number arrives.
      v => {
        const raw = String(v).trim();
        state.rate = raw === '' ? null : Math.max(0, parseFloat(raw) || 0);
        recalc();
      });
    // Re-read the profile on every render: switching country has to move both
    // the hint and — while the reader has not overridden it — the rate itself.
    syncs.push(() => {
      const p = P();
      f.hintEl.textContent = p.rateNote;
      if (state.rate === null) f.input.value = String(p.defaultRate);
    });
    return f.wrap;
  }

  /* Deposit: an amount and a percentage that drive each other, because people
     arrive with one or the other ("I have R200 000" / "I want to put down
     20%") and converting between them by hand is exactly the work this page
     exists to save. The slider spans the full 0–100%: capping it at 50% made
     a paid-off house, an inheritance or a downsize impossible to model, and
     those are the cases worth modelling.

     `deposit` is the truth; the two controls are views onto it. Whichever one
     is being typed into is left alone — writing a rounded value back into the
     field under the cursor would fight the reader mid-keystroke. */
  function depositField(state, recalc) {
    const lab = el('span', { class: 'lf-l' });
    const amt = el('input', {
      type: 'number', inputmode: 'decimal', class: 'form-control form-control-sm',
      min: '0', step: '5000', 'aria-label': 'Deposit amount',
    });
    const slider = el('input', {
      type: 'range', class: 'loan-range', min: '0', max: '100', step: '1',
      'aria-label': 'Deposit as a percentage of the price',
    });

    const pct = () => (state.price > 0 ? (state.deposit / state.price) * 100 : state.depositPct);
    // One decimal only when there is one to show: "13.3%" earns its place,
    // "10.0%" does not.
    const show = () => {
      const v = pct();
      lab.textContent = `Deposit — ${Math.round(v * 10) % 10 ? v.toFixed(1) : Math.round(v)}%`;
      if (document.activeElement !== slider) slider.value = String(Math.min(100, Math.round(v)));
      if (document.activeElement !== amt) amt.value = String(Math.round(state.deposit));
    };

    amt.addEventListener('input', () => {
      const v = parseFloat(amt.value);
      state.deposit = Math.min(Math.max(0, Number.isFinite(v) ? v : 0), state.price);
      if (state.price > 0) state.depositPct = pct();
      show(); recalc();
    });
    slider.addEventListener('input', () => {
      state.depositPct = Number(slider.value);
      state.deposit = state.price * state.depositPct / 100;
      show(); recalc();
    });

    show();
    syncs.push(show);
    return { wrap: el('label', { class: 'loan-field' }, lab, amt, slider), sync: show };
  }

  /* Range + a readout that IS the label, so a screen reader announces the
     current value rather than a bare "Deposit". `sync` is exposed because the
     readout depends on other fields too — the deposit slider reads a rand
     amount off the price, so editing the price has to refresh it. */
  function rangeField(labelFor, attrs, value, commit) {
    const lab = el('span', { class: 'lf-l' });
    const input = el('input', { type: 'range', class: 'loan-range', value: String(value), ...attrs });
    const sync = () => { lab.textContent = labelFor(Number(input.value)); };
    input.addEventListener('input', () => { sync(); commit(Number(input.value)); });
    sync();
    syncs.push(sync);
    return { wrap: el('label', { class: 'loan-field' }, lab, input), sync };
  }

  function selectField(label, options, value, commit) {
    const sel = el('select', { class: 'form-select form-select-sm' },
      ...options.map(([v, l]) => el('option', { value: String(v), ...(String(v) === String(value) ? { selected: '' } : {}) }, l)));
    sel.addEventListener('change', () => commit(sel.value));
    return el('label', { class: 'loan-field' }, el('span', { class: 'lf-l' }, label), sel);
  }

  function checkField(label, hint, value, commit) {
    const box = el('input', { type: 'checkbox', ...(value ? { checked: '' } : {}) });
    box.addEventListener('change', () => commit(box.checked));
    const wrap = el('label', { class: 'loan-field loan-check' }, box, el('span', { class: 'lf-l' }, label));
    if (hint) wrap.append(el('span', { class: 'lf-h' }, hint));
    return wrap;
  }

  /* ------------------------------ output --------------------------------- */
  const row = (label, value, cls) => el('div', { class: 'lo-row' },
    el('span', { class: 'lo-l' }, label),
    el('b', { class: `lo-v num ${cls || ''}` }, value));

  const DISCLAIMER = 'Estimates only — this is not financial advice. Every figure here is a default to check, ' +
    'not a quote: rates, attorney fees and lender charges all vary. Confirm the numbers with your bank, ' +
    'your attorney and a qualified adviser before committing to anything.';

  /* Folds the flat monthly service fee into the totals a reader checks
     affordability against — the same fold recalcCar() already does inline
     (`money(t.payment + service + insurance, 0)` / `service * car.months`).
     Split into a DOM-free function, unlike recalcCar's inline version, purely
     so it can be pinned by a bare-node test: src/dom.js's el() calls
     document.createElement, so recalcHome() itself cannot run outside a
     browser. tests/loan-math.test.cjs reaches this via ctx.provide(), the same
     pattern src/views/budgets.js uses for otherShapeBudgets()/carryStructure().
     Gated on service > 0, same as recalcCar's `if (service > 0)`: a country
     with no fee profile gets no extra rows rather than a "R0.00" one. */
  function homeServiceFeeFold(payment, service, months) {
    return {
      monthlyTotal: service > 0 ? payment + service : null,
      termTotal: service > 0 ? service * months : 0,
    };
  }

  function amortTable(tbl, rows, termLabel) {
    tbl.empty();
    tbl.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, termLabel),
      el('th', { scope: 'col', class: 'num' }, 'Opening'),
      el('th', { scope: 'col', class: 'num' }, 'Interest'),
      el('th', { scope: 'col', class: 'num' }, 'Capital'),
      el('th', { scope: 'col', class: 'num' }, 'Closing'))));
    const body = el('tbody', {});
    // Nothing borrowed, nothing to schedule. Without this the table drew a
    // full run of "R 0" rows, which reads as broken rather than as empty.
    if (!rows.length) {
      body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' },
        'Enter a price and a deposit below the price to see the schedule.')));
    }
    for (const y of rows) {
      body.append(el('tr', {},
        el('td', {}, String(y.year)),
        el('td', { class: 'num' }, money(y.opening, 0)),
        el('td', { class: 'num text-warning' }, money(y.interest, 0)),
        el('td', { class: 'num' }, money(y.capital, 0)),
        el('td', { class: 'num' }, money(y.closing, 0))));
    }
    tbl.append(body);
  }

  /* ------------------------------ home loan ------------------------------- */
  let homeBuilt = false;
  let homeDepositSync = null;

  function buildHome() {
    const box = $('#loanHomeForm');
    box.empty();
    const form = el('div', { class: 'loan-form' });

    // Changing the price carries the deposit with it at the same proportion,
    // rather than leaving an amount that belonged to the old price.
    form.append(numField('Purchase price', null, home.price, { min: '0', step: '10000' },
      v => {
        home.price = Math.max(0, parseFloat(v) || 0);
        home.deposit = Math.min(home.price * home.depositPct / 100, home.price);
        homeDepositSync(); recalcHome();
      }).wrap);

    const dep = depositField(home, recalcHome);
    homeDepositSync = dep.sync;
    form.append(dep.wrap);

    form.append(rateField(home, recalcHome));

    const term = rangeField(
      y => `Loan term — ${y} years`,
      { min: '5', max: '30', step: '1' }, home.years,
      y => { home.years = y; recalcHome(); });
    form.append(term.wrap);

    box.append(form);
    homeBuilt = true;
  }

  function recalcHome() {
    const p = P();
    const deposit = Math.min(home.deposit, home.price);
    const loan = Math.max(0, home.price - deposit);
    const rate = home.rate ?? p.defaultRate;
    const t = totalsFor(loan, rate, home.years * 12);

    const duty = p.transferDuty(home.price);
    const bond = p.bondCost(loan);
    const transfer = p.transferCost(home.price);
    const init = p.mortgageInitiationFee(loan);
    const onceOff = duty + bond + transfer + init;

    // The ZA profile's own costsNote prints "monthly service fee R69.00" on
    // this exact card — the fee below is what makes that sentence true.
    const service = p.serviceFee;
    const fee = homeServiceFeeFold(t.payment, service, home.years * 12);

    const out = $('#loanHomeOut'); out.empty();
    const block = el('div', { class: 'loan-out' },
      row('Monthly repayment', money(t.payment, 0), 'lo-big grad-txt'));
    if (service > 0) block.append(row('Monthly service fee', money(service, 0)));
    if (fee.monthlyTotal !== null) block.append(row('Total per month', money(fee.monthlyTotal, 0), 'text-danger'));
    block.append(
      row('Loan amount', money(loan, 0)),
      row('Total interest', money(t.totalInterest, 0), 'text-warning'),
      row('Total repaid', money(t.totalRepaid, 0)));
    block.append(el('div', { class: 'lo-sep' }));
    block.append(row('Deposit', money(deposit, 0)));
    if (p.hasBuyingCosts) block.append(row('Once-off costs', money(onceOff, 0)));
    if (fee.termTotal > 0) block.append(row('Service fees over the term', money(fee.termTotal, 0)));
    block.append(row('Cash needed upfront', money(deposit + (p.hasBuyingCosts ? onceOff : 0), 0), 'text-danger'));
    block.append(el('div', { class: 'lo-note' }, DISCLAIMER));
    out.append(block);

    $('#loanHomeCostsCard').classList.toggle('hidden', !p.hasBuyingCosts);
    if (p.hasBuyingCosts) {
      $('#loanHomeCostsSub').textContent = p.costsNote;
      const costs = $('#loanHomeCosts'); costs.empty();
      costs.append(el('div', { class: 'loan-out' },
        row('Transfer duty', money(duty, 0)),
        row('Bond registration (est.)', money(bond, 0)),
        row('Transfer costs (est.)', money(transfer, 0)),
        row('Initiation fee', money(init, 0)),
        el('div', { class: 'lo-sep' }),
        row('Total once-off costs', money(onceOff, 0), 'lo-big')));
    }

    amortTable($('#loanHomeAmort'),
      loan > 0 ? byYear(amortise(loan, rate, home.years * 12, t.payment)) : [], 'Year');
  }

  /* --------------------------- vehicle finance ---------------------------- */
  let carBuilt = false;
  let carDepositSync = null;
  let carBalloonSync = null;

  const TERMS = [[12, '12 months (1 year)'], [24, '24 months (2 years)'], [36, '36 months (3 years)'],
    [48, '48 months (4 years)'], [54, '54 months'], [60, '60 months (5 years)'],
    [66, '66 months'], [72, '72 months (6 years)']];

  function buildCar() {
    const box = $('#loanCarForm');
    box.empty();
    const form = el('div', { class: 'loan-form' });

    form.append(numField('Vehicle price', null, car.price, { min: '0', step: '5000' },
      v => {
        car.price = Math.max(0, parseFloat(v) || 0);
        car.deposit = Math.min(car.price * car.depositPct / 100, car.price);
        carDepositSync(); carBalloonSync(); recalcCar();
      }).wrap);

    const dep = depositField(car, recalcCar);
    carDepositSync = dep.sync;
    form.append(dep.wrap);

    form.append(rateField(car, recalcCar));

    form.append(selectField('Loan term', TERMS, car.months,
      v => { car.months = Number(v); recalcCar(); }));

    /* A balloon is a percentage of the VEHICLE PRICE, which is how dealers
       quote it — so it is not automatically smaller than the financed amount.
       recalcCar() clamps it; see the note there. */
    const bal = rangeField(
      pct => `Balloon / residual — ${pct}% (${money(car.price * pct / 100, 0)})`,
      { min: '0', max: '40', step: '5' }, car.balloonPct,
      pct => { car.balloonPct = pct; recalcCar(); });
    carBalloonSync = bal.sync;
    form.append(bal.wrap);

    form.append(checkField('Include estimated insurance',
      'A rough placeholder so the monthly total is not mistaken for the cost of running the car. Get a real quote.',
      car.insurance, v => { car.insurance = v; recalcCar(); }));

    box.append(form);
    carBuilt = true;
  }

  function recalcCar() {
    const p = P();
    const deposit = Math.min(car.deposit, car.price);
    const finance = Math.max(0, car.price - deposit);
    // The balloon is a percentage of the PRICE, so a large deposit can leave
    // less financed than the balloon asks for. It used to be impossible when
    // the deposit stopped at 50%; now that it reaches 100% the clamp has to
    // be real, or the page would promise a residual bigger than the loan.
    const balloon = Math.min(car.price * car.balloonPct / 100, finance);
    const rate = car.rate ?? p.defaultRate;
    const t = totalsFor(finance, rate, car.months, balloon);

    const init = p.vehicleInitiationFee(finance);
    const service = p.serviceFee;
    const serviceTotal = service * car.months;
    const insurance = car.insurance ? insuranceEstimate(car.price) : 0;

    const out = $('#loanCarOut'); out.empty();
    const block = el('div', { class: 'loan-out' },
      row('Monthly instalment', money(t.payment, 0), 'lo-big grad-txt'));
    if (service > 0) block.append(row('Monthly service fee', money(service, 0)));
    if (insurance) block.append(row('Insurance (rough estimate)', money(insurance, 0)));
    if (service > 0 || insurance) {
      block.append(row('Total per month', money(t.payment + service + insurance, 0), 'text-danger'));
    }
    block.append(el('div', { class: 'lo-sep' }),
      row('Finance amount', money(finance, 0)),
      row('Total interest', money(t.totalInterest, 0), 'text-warning'),
      row('Total repaid', money(t.totalRepaid, 0)));
    if (balloon > 0) {
      block.append(row('Balloon due at the end', money(balloon, 0), 'text-danger'));
      block.append(el('div', { class: 'lo-note' },
        'The balloon is not paid off by the instalments — at the end of the term you settle it, ' +
        'refinance it, or trade the car in and hope it is worth more than the balloon. That is why ' +
        'the total interest above rises as you raise it.'));
    }
    block.append(el('div', { class: 'lo-sep' }), row('Deposit', money(deposit, 0)));
    // Gated like the service-fee rows either side of it. A country with no fee
    // profile was showing "Initiation fee — R 0", which reads as a quoted fee
    // of nothing rather than as "not modelled here".
    if (init > 0) block.append(row('Initiation fee', money(init, 0)));
    if (serviceTotal > 0) block.append(row('Service fees over the term', money(serviceTotal, 0)));
    // The deposit belongs in this total: it is money spent on the car, and it
    // is listed three rows up. Leaving it out understates the true cost.
    block.append(row('Total cost of ownership', money(deposit + t.totalRepaid + init + serviceTotal, 0), 'lo-big'));
    block.append(el('div', { class: 'lo-note' }, DISCLAIMER));
    out.append(block);

    $('#loanCarFeesCard').classList.toggle('hidden', !p.hasBuyingCosts);
    if (p.hasBuyingCosts) {
      $('#loanCarFeesSub').textContent = p.feesNote;
      const fees = $('#loanCarFees'); fees.empty();
      fees.append(el('div', { class: 'loan-out' },
        row('Initiation fee (once-off)', money(init, 0)),
        row('Monthly service fee', money(service, 0)),
        el('div', { class: 'lo-sep' }),
        row('Total service fees over the term', money(serviceTotal, 0), 'lo-big')));
    }

    amortTable($('#loanCarAmort'),
      finance > 0 ? byYear(amortise(finance, rate, car.months, t.payment, balloon)) : [], 'Year');
  }

  /* -------------------------------- tabs ---------------------------------- */
  /* Wired here rather than in controller.js because the tabs carry no state
     beyond which panel is showing, and nothing outside this view reads it. */
  function showTab(which) {
    const isHome = which === 'home';
    $('#loanHome').classList.toggle('hidden', !isHome);
    $('#loanCar').classList.toggle('hidden', isHome);
    for (const [id, on] of [['#loanTabHome', isHome], ['#loanTabCar', !isHome]]) {
      const b = $(id);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
    }
    renderLoans();
  }
  $('#loanTabHome').addEventListener('click', () => showTab('home'));
  $('#loanTabCar').addEventListener('click', () => showTab('car'));

  function renderLoans() {
    const p = P();
    $('#loansSubNote').textContent = p.hasBuyingCosts
      ? 'Nothing here is saved — change anything and the numbers follow. Costs and fees follow South African rules.'
      : 'Nothing here is saved — change anything and the numbers follow. Purchase taxes and lender fees are not modelled for your country.';

    // Built once: rebuilding a form while a slider is being dragged or a field
    // typed into replaces the control under the finger, the same trap the Tax
    // view documents. Only the output containers are ever rebuilt, and none of
    // them holds a focusable control.
    if (!homeBuilt) buildHome();
    if (!carBuilt) buildCar();
    // Refresh what the forms cache from the profile — the money inside every
    // slider readout, and the rate hint. Without this, changing country left
    // "Deposit — 10% (¥ 150,000)" sitting above a rand-denominated result.
    for (const sync of syncs) sync();
    recalcHome();
    recalcCar();
  }

  ctx.provide({ renderLoans, homeServiceFeeFold });
};
