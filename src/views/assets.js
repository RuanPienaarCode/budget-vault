'use strict';
/* Assets — what the household owns that is not an account. Saved to Assets.md.

   The gap this fills: net worth was built out of bank balances and the Debt
   page, so a household with a bond read as several hundred thousand rand in
   the hole while living in a house worth several million. The liability was
   counted in full and the thing it bought was not counted at all — which is
   not a conservative estimate, it is the wrong sign.

   A value here is a CLAIM WITH AN AGE, in exactly the sense Balances means it
   in CONTEXT.md, and more so: nobody re-values a house monthly. The age is
   shown on every row and summarised above the table, because a net worth
   dominated by one number somebody typed four years ago should say so. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile } = require('../table-schema');
const { askFields } = require('../modal');
/* `staleValuationOf` is reconcile.js's shared "is this figure still current"
   rule, aliased on the way in so the local predicate below keeps the name this
   file already uses everywhere. See that function's own header for why the
   RULE moved out and the NUMBER stayed here. */
const { daysSince, isStaleValuation: staleValuationOf } = require('../reconcile');
const { symbolOf, isForeign } = require('../currency');
const { todayIso } = require('../dates');
const { assetTotal, foreignTotals } = require('../worth');

/* Kinds of possession, in the order a household usually meets them. Stored
   verbatim in the Type column; an unknown value from a hand-edited file is
   kept as-is rather than coerced, the same way Debts keeps an unknown type. */
const ASSET_TYPES = ['property', 'vehicle', 'household contents', 'jewellery',
  'precious metals', 'electronics', 'collectibles', 'equipment', 'other'];

/* A valuation goes stale on a different clock to a bank balance. The 30 days
   reconcile.js uses is right for a figure a statement re-confirms every month
   and badly wrong here — nobody has a house valued monthly, so a 30-day rule
   would flag every row of every vault forever, which is not a warning, it is
   noise that teaches the reader to ignore the one row that matters. A year is
   the interval at which a valuation genuinely stops meaning anything.

   THE single source for this number. Published below via ctx.provide so any
   other view that needs "what counts as a stale asset valuation" reads it
   from here rather than re-declaring its own 365 — that already happened
   once (views/savings.js's own ASSET_STALE_DAYS), and the two copies had
   already drifted apart on which rows counted before anyone noticed. */
const VALUED_STALE_DAYS = 365;

module.exports = function registerAssets(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  /* ISSUE 30. Assets can state a currency now. An asset's OWN figure prints
     in its OWN symbol — a Lisbon flat shown as "R 250 000" is not a missing
     label but a claim the household holds rand it does not — and the page
     total sums the household's currency alone, naming the rest beside it. */
  const aMoney = (a, v, dp = 2) => (isForeign(a, S.settings.currency) && typeof ctx.moneyIn === 'function'
    ? ctx.moneyIn(symbolOf(a, S.settings.currency), v, dp)
    : money(v, dp));
  const otherList = pairs => pairs.map(([sym, v]) => (typeof ctx.moneyIn === 'function'
    ? ctx.moneyIn(sym, v, 0) : `${sym} ${Math.round(v)}`)).join(' · ');

  const { mark, clear: clearDirty } = ctx.dirtyFlag('assetsDirty', '#assetSave');

  /* Two different claims, kept apart, because conflating them says a page
     knows something it does not:

     - dateUnreadable: daysSince() came back null, which covers BOTH a
       genuinely blank Valued cell AND one it could not parse — the golden
       fixture's "when we bought it" is a real example, and it is a row this
       page cannot date at all.
     - isStaleValuation: daysSince() read a real date, and it is over a year
       old — a fact this page CAN state.

     Before this split, "over a year old" was asserted about both, which
     means a row this page has no date for at all was told to its face that
     its figure is a specific kind of old. valuedAge() below already made
     this distinction for the per-row caption ("never valued" vs no caption);
     the KPI tile and the caveat under it did not. */
  const dateUnreadable = a => daysSince(a.valued) === null;
  const neverValued = a => !a.valued;
  /* Delegated to reconcile.js rather than spelled out here a third time. The
     expression this used to hold — `d !== null && d > VALUED_STALE_DAYS` — is
     false for a NEGATIVE d, so a Valued date typo'd into the future read as a
     current valuation and the tile below printed "Needs a new valuation: 0 —
     every value is current" directly above a row whose own caption
     (valuedAge, twenty lines down, which has always had the `d < 0` branch)
     said "valued ahead of today". reconcile.js:63 closed exactly that hole for
     a bank balance in 1.23.1; this function and views/savings.js's staleAssets
     were a fourth and fifth answer to the same question and neither was
     patched. One rule now, in one place, with the threshold handed to it. */
  const isStaleValuation = a => staleValuationOf(a.valued, null, VALUED_STALE_DAYS);
  /* "Not current" for the KPI tile and the row's age styling: never valued,
     unreadable, or valued so long ago the figure is a memory. Same shape as
     reconcile's isStale, on the longer clock above. Named for what it MEANS
     to the reader (needs a fresh number) rather than for the predicate shape,
     because the KPI used to be labelled "Unvalued" while counting rows that
     plainly HAVE a value — a house priced 400 days ago read as "Unvalued 1"
     next to its own price. */
  const needsRevaluation = a => dateUnreadable(a) || isStaleValuation(a);

  /* "3 years ago" rather than "1104 days ago". Days are the right unit for an
     account balance and the wrong one here — the whole point of the line is
     that the reader recognises the figure as old at a glance. */
  function valuedAge(a) {
    const d = daysSince(a.valued);
    if (d === null) return a.valued ? null : 'never valued';
    if (d < 0) return 'valued ahead of today';
    if (d < 31) return d <= 1 ? 'valued today' : `valued ${d} days ago`;
    const months = Math.round(d / 30.44);
    if (months < 18) return `valued ${months} month${months === 1 ? '' : 's'} ago`;
    // Floor, not round: rounding jumped from "1 year ago" to "2 years ago" in
    // a single day at the 18-month gate above (Math.round(547/365.25) = 1,
    // Math.round(548/365.25) = 2), overstating a valuation's age by up to six
    // months right at the boundary the caption exists to communicate.
    const years = Math.floor(d / 365.25);
    return `valued ${years} year${years === 1 ? '' : 's'} ago`;
  }

  /* The only thing outside the table that reads a row, so an edited value can
     refresh here without rebuilding the field being typed in — on a phone
     `change` fires on blur, and a full rebuild lands between the tap leaving
     one field and the tap arriving at the next. Same reasoning as Owed Money
     and Debt. */
  function renderAssetKpis() {
    const total = assetTotal(S.assets, S.settings.currency);
    const assetOthers = foreignTotals(S.assets, S.settings.currency, 'value');
    /* Seeded from the first row rather than from null. `a.value > (b?.value||0)`
       never advances past null when every value is 0, so a household that has
       listed the house, the car and the ring but priced none of them yet — a
       state this page explicitly expects, and the one the tile beside this is
       about — read "Largest: —" as though it owned nothing. */
    const biggest = S.assets.length
      ? S.assets.reduce((b, a) => (a.value > b.value ? a : b))
      : null;
    const revaluationCount = S.assets.filter(needsRevaluation).length;

    const tile = kpiTiles($('#assetKpis'));
    tile('Total value', money(total), total > 0 ? 'text-success' : '',
      assetOthers.length ? `plus ${otherList(assetOthers)} held abroad, not converted` : null);
    tile('Items', String(S.assets.length));
    tile('Largest', biggest ? aMoney(biggest, biggest.value, 0) : '—', '', biggest ? biggest.name : null);
    // Labelled by what it means to do about it, not by the predicate shape —
    // this used to read "Unvalued" while counting rows that plainly HAVE a
    // value (a house priced 400 days ago), which reads as though the app
    // lost the reader's own figures.
    tile('Needs a new valuation', String(revaluationCount), revaluationCount > 0 ? 'text-warning' : '',
      revaluationCount > 0 ? 'not valued in the last year' : 'every value is current');
  }

  /* The caveat under the tiles, for the same reason Savings carries one: a
     total this large built from figures the reader typed once should not be
     printed as though it were measured this morning.

     Two sentences, not one, because they assert two different things: "over
     a year old" is provable from a parsed date, and "never valued or the
     date can't be read" is the honest thing to say about a row this page has
     no date for at all. Folding both into one "over a year old" claim is
     exactly the bug fix 6 closes. */
  function renderAssetStale() {
    const wrap = $('#assetStale'); wrap.empty();
    const stale = S.assets.filter(isStaleValuation);
    const unreadable = S.assets.filter(dateUnreadable);
    if (!stale.length && !unreadable.length) return;

    const bits = [];
    if (stale.length) {
      const all = stale.length === S.assets.length;
      /* BOTH SIDES in the household's own currency, which the tile directly
         above already states — `assetTotal(S.assets, S.settings.currency)`.
         Dropped on both sides, this was a ratio between two mixed-currency
         sums presented as a share of a figure the page never printed, and the
         50% gate below made it consequential rather than merely untidy: one
         stale R1 000 000 house is 100% of a rand household's assets and says
         so, and the same house beside a €5 000 000 flat computed 17% and
         suppressed the disclosure entirely. */
      const share = assetTotal(stale, S.settings.currency)
        / (assetTotal(S.assets, S.settings.currency) || 1);
      const subject = all
        ? (S.assets.length === 1 ? 'This value is' : 'Every value here is')
        : `${stale.length} of ${S.assets.length} values are`;
      bits.push(`${subject} over a year old` +
        (share > 0.5 ? ` — ${Math.round(share * 100)}% of the total` : ''));
    }
    if (unreadable.length) {
      const never = unreadable.filter(neverValued).length;
      const unreadableDate = unreadable.length - never;
      bits.push([
        never ? `${never} ${never === 1 ? 'has' : 'have'} never been valued` : null,
        unreadableDate ? `${unreadableDate} ${unreadableDate === 1 ? 'has' : 'have'} a Valued date this page can't read` : null,
      ].filter(Boolean).join(', and '));
    }
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']), `${bits.join('. ')}.`));
  }

  function renderAssets(focusRow) {
    renderAssetKpis();
    renderAssetStale();
    const t = $('#assetTable');
    keepScroll(t, () => {
      t.empty();
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Item'),
        el('th', { scope: 'col' }, 'Kind'),
        el('th', { scope: 'col', class: 'num' }, 'Value'),
        el('th', { scope: 'col' }, 'Last valued'),
        el('th', { scope: 'col' }, 'Notes'),
        el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      for (const a of S.assets) {
        const age = valuedAge(a);
        body.append(el('tr', {},
          el('td', { style: 'font-weight:600' }, a.name, ctx.noteButton('asset', a.name),
            /* The row's own currency, where it differs. The Value cell is a
               bare number input with no symbol on it, so without this the
               only place a foreign asset announced itself was the total's
               footnote — and a reader scanning the table would have no idea
               which row it referred to. */
            ...(isForeign(a, S.settings.currency)
              ? [el('span', { class: 'acct-group-other' }, ` ${symbolOf(a, S.settings.currency)}`)] : []),
            ...(age ? [el('div', { class: `asset-age${needsRevaluation(a) ? ' asset-age-old' : ''}` }, age)] : [])),
          // A kind that no longer appears in the preset list (a hand-edited
          // Assets.md, or a list trimmed between versions) keeps an option of
          // its own — without it the select silently rewrites the file's own
          // value to whichever preset happens to be first.
          el('td', {}, el('select', { class: 'form-select form-select-sm', 'aria-label': `Kind of ${a.name}`,
            // focusRow: rebuilding the table drops focus to <body> otherwise —
            // see the restore block below. Same fix as Owed Money and Debt.
            onchange: e => { a.type = e.target.value; mark(); renderAssets(S.assets.indexOf(a)); } },
            ...(a.type && !ASSET_TYPES.includes(a.type)
              ? [el('option', { value: a.type, selected: '' }, a.type)] : []),
            ...ASSET_TYPES.map(k => el('option', { value: k, ...(k === a.type ? { selected: '' } : {}) }, k)))),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', min: '0',
            class: 'form-control form-control-sm', value: a.value || '',
            'aria-label': `Value of ${a.name}`,
            // Routed through normalizeAmount, matching addAsset — an invalid
            // cell (an SA-locale phone's numeric keypad writes "15 000 000,00"
            // into a plain number input, which the browser reports as an
            // empty string) used to fall through `parseFloat('') || 0` and
            // silently ZERO a real value with no toast, dropping net worth on
            // every page that reads it. Left untouched on a bad parse, and the
            // row is redrawn so the field shows the real stored value instead
            // of the invalid text still sitting in it.
            onchange: e => {
              const value = normalizeAmount(e.target.value);
              if (value === null) { toast('Value must be a number', true); renderAssets(); return; }
              /* valueRaw is the verbatim text of a cell the loader could not
                 read (table-schema.js's money()); the writer prefers it over a
                 fabricated 0 so a save cannot erase what the reader typed.
                 A number typed HERE supersedes that text, so the sibling is
                 cleared — the same thing views/budgets.js does with amountRaw. */
              a.value = Math.max(0, value); a.valueRaw = null; mark(); renderAssetKpis();
            } })),
          /* Editing the value does NOT stamp this date. A valuation is a
             separate act from correcting a typo, and stamping today on every
             keystroke would make the staleness column agree with itself
             forever while meaning nothing. */
          el('td', {}, dateInput(a.valued, { class: 'form-control form-control-sm',
            'aria-label': `Date ${a.name} was valued` },
            v => { a.valued = v; mark(); renderAssets(S.assets.indexOf(a)); })),
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm',
            value: a.notes, 'aria-label': `Notes for ${a.name}`,
            onchange: e => { a.notes = e.target.value; mark(); } })),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${a.name}`,
            onclick: () => { S.assets.splice(S.assets.indexOf(a), 1); mark(); renderAssets(); } }, '✕'))));
      }
      if (!S.assets.length) {
        body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' },
          'Nothing listed yet. Add the house, the car, the contents — anything with a ' +
          'resale value. If a bond or a loan is already on the Debt page, listing what it ' +
          'bought here is what balances it in net worth, rather than only the amount owed.')));
      }
      t.append(body);
    });
    /* Rebuilding the table drops focus to <body>, which ejects a keyboard or
       screen-reader user to the top of the page after every kind change. Same
       fix as Owed Money and Debt. */
    if (focusRow !== undefined && focusRow >= 0) {
      const sel = t.querySelectorAll('tbody select')[focusRow];
      if (sel) sel.focus();
    }
  }

  /* Columns, escaping and number formatting come from the same declaration
     the loader reads with (table-schema.js, ADR-0003); only the prose is
     this view's own. */
  function serializeAssets() {
    return mdTableFile({
      fm: S.assetsFm, fallback: 'kind: assets', title: 'Assets',
      prose: [
        'What the household owns that is not an account — property, vehicles, contents,',
        'jewellery, metals. `Value` is what it would sell for today and `Valued` is when',
        'that was last worked out. Money owed against any of these lives on the Debt page.',
      ],
      schema: SCHEMAS.assets, rows: S.assets,
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
  async function saveAssets() {
    try {
      await writeFile('Assets.md', serializeAssets());
    } catch (e) {
      return toast(`Could not save Assets.md (${e.message || e})`, true);
    }
    clearDirty();
    toast('Saved Assets.md');
  }

  async function addAsset() {
    const r = await askFields(app, 'New asset', [
      { key: 'name', label: 'What is it?', type: 'text', placeholder: 'e.g. The house' },
      { key: 'type', label: 'Kind', type: 'select', value: 'property', options: ASSET_TYPES },
      { key: 'value', label: 'What would it sell for?', type: 'number', value: '0' },
      { key: 'valued', label: 'When was that worked out?', type: 'date', value: todayIso(),
        desc: 'If this figure comes from an older valuation, set the date it was true.' },
      /* ISSUE 30. Until now only ACCOUNTS could state a currency, so a house
         in Lisbon had to be typed as though it were in the household's
         currency and every total built on it was quietly wrong with no way
         for the reader to say otherwise. Blank means the household's — which
         is what every asset already on disk says by saying nothing — so the
         field is an option, never a question a single-currency household has
         to answer. */
      { key: 'currency', label: 'Currency', type: 'text', value: '',
        placeholder: S.settings.currency || 'R',
        desc: `Leave blank if it is in ${S.settings.currency || 'your own currency'}. Set it for something held abroad — the value is then shown in that currency and left out of totals rather than added to them.` },
    ]);
    if (!r || !r.name.trim()) return;
    const value = normalizeAmount(r.value);
    if (value === null) return toast('Value must be a number', true);
    /* Deliberately not unique — "Car" once per car is the normal case. Nothing
       downstream keys by name: the chart groups by kind and focus restores by
       row index. */
    S.assets.push({
      name: r.name.trim(), type: r.type || 'other',
      value: Math.max(0, value), valued: (r.valued || '').trim(), notes: '',
      /* Normalised to '' when it merely restates the household's symbol, so
         a table only grows the Currency column when a row genuinely differs
         — see usedColumns() in table-schema.js. */
      currency: (r.currency || '').trim() === (S.settings.currency || '') ? '' : (r.currency || '').trim(),
    });
    mark(); renderAssets();
  }

  // serializeAssets is published so a round-trip test can drive the real one.
  ctx.provide({ renderAssets, saveAssets, addAsset, serializeAssets, VALUED_STALE_DAYS });
};
