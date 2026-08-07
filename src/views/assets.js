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
const { escMd } = require('../markdown');
const { askFields } = require('../modal');
const { daysSince } = require('../reconcile');
const { todayIso } = require('../dates');
const { assetTotal } = require('../worth');

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
   the interval at which a valuation genuinely stops meaning anything. */
const VALUED_STALE_DAYS = 365;

module.exports = function registerAssets(ctx) {
  const { S, $, app, money, toast, writeFile } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('assetsDirty', '#assetSave');

  /* Never valued, or valued so long ago the figure is a memory. Same shape as
     reconcile's isStale, on the longer clock above. */
  const isUnvalued = a => {
    const d = daysSince(a.valued);
    return d === null || d > VALUED_STALE_DAYS;
  };

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
    const years = Math.round(d / 365.25);
    return `valued ${years} year${years === 1 ? '' : 's'} ago`;
  }

  /* The only thing outside the table that reads a row, so an edited value can
     refresh here without rebuilding the field being typed in — on a phone
     `change` fires on blur, and a full rebuild lands between the tap leaving
     one field and the tap arriving at the next. Same reasoning as Owed Money
     and Debt. */
  function renderAssetKpis() {
    const total = assetTotal(S.assets);
    /* Seeded from the first row rather than from null. `a.value > (b?.value||0)`
       never advances past null when every value is 0, so a household that has
       listed the house, the car and the ring but priced none of them yet — a
       state this page explicitly expects, and the one the Unvalued tile beside
       this is about — read "Largest: —" as though it owned nothing. */
    const biggest = S.assets.length
      ? S.assets.reduce((b, a) => (a.value > b.value ? a : b))
      : null;
    const unvalued = S.assets.filter(isUnvalued).length;

    const tile = kpiTiles($('#assetKpis'));
    tile('Total value', money(total), total > 0 ? 'text-success' : '');
    tile('Items', String(S.assets.length));
    tile('Largest', biggest ? money(biggest.value, 0) : '—', '', biggest ? biggest.name : null);
    tile('Unvalued', String(unvalued), unvalued > 0 ? 'text-warning' : '',
      unvalued > 0 ? 'not valued in the last year' : 'every value is current');
  }

  /* The caveat under the tiles, for the same reason Savings carries one: a
     total this large built from figures the reader typed once should not be
     printed as though it were measured this morning. */
  function renderAssetStale() {
    const wrap = $('#assetStale'); wrap.empty();
    const stale = S.assets.filter(isUnvalued);
    if (!stale.length) return;
    const all = stale.length === S.assets.length;
    const share = assetTotal(stale) / (assetTotal(S.assets) || 1);
    const subject = all
      ? (S.assets.length === 1 ? 'This value is' : 'Every value here is')
      : `${stale.length} of ${S.assets.length} values are`;
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      `${subject} over a year old` +
      (share > 0.5 ? ` — and that is ${Math.round(share * 100)}% of the total.` : '.')));
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
        el('th', { scope: 'col' }, 'Valued'),
        el('th', { scope: 'col' }, 'Notes'),
        el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      for (const a of S.assets) {
        const age = valuedAge(a);
        body.append(el('tr', {},
          el('td', { style: 'font-weight:600' }, a.name,
            ...(age ? [el('div', { class: `asset-age${isUnvalued(a) ? ' asset-age-old' : ''}` }, age)] : [])),
          // A kind that no longer appears in the preset list (a hand-edited
          // Assets.md, or a list trimmed between versions) keeps an option of
          // its own — without it the select silently rewrites the file's own
          // value to whichever preset happens to be first.
          el('td', {}, el('select', { class: 'form-select form-select-sm', 'aria-label': `Kind of ${a.name}`,
            onchange: e => { a.type = e.target.value; mark(); renderAssets(); } },
            ...(a.type && !ASSET_TYPES.includes(a.type)
              ? [el('option', { value: a.type, selected: '' }, a.type)] : []),
            ...ASSET_TYPES.map(k => el('option', { value: k, ...(k === a.type ? { selected: '' } : {}) }, k)))),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', min: '0',
            class: 'form-control form-control-sm', value: a.value || '',
            'aria-label': `Value of ${a.name}`,
            onchange: e => { a.value = Math.max(0, parseFloat(e.target.value) || 0); mark(); renderAssetKpis(); } })),
          /* Editing the value does NOT stamp this date. A valuation is a
             separate act from correcting a typo, and stamping today on every
             keystroke would make the staleness column agree with itself
             forever while meaning nothing. */
          el('td', {}, dateInput(a.valued, { class: 'form-control form-control-sm',
            'aria-label': `Date ${a.name} was valued` },
            v => { a.valued = v; mark(); renderAssets(); })),
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm',
            value: a.notes, 'aria-label': `Notes for ${a.name}`,
            onchange: e => { a.notes = e.target.value; mark(); } })),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${a.name}`,
            onclick: () => { S.assets.splice(S.assets.indexOf(a), 1); mark(); renderAssets(); } }, '✕'))));
      }
      if (!S.assets.length) {
        body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' },
          'Nothing listed yet. Add the house, the car, the contents, anything with a ' +
          'resale value — net worth counts what you owe on them either way.')));
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

  function serializeAssets() {
    const lines = ['---', ...(S.assetsFm || 'kind: assets').split('\n'), '---', '', '# Assets', '',
      'What the household owns that is not an account — property, vehicles, contents,',
      'jewellery, metals. `Value` is what it would sell for today and `Valued` is when',
      'that was last worked out. Money owed against any of these lives on the Debt page.', '',
      '| Item | Kind | Value | Valued | Notes |',
      '|------|------|------:|--------|-------|'];
    for (const a of S.assets) {
      lines.push(`| ${escMd(a.name)} | ${escMd(a.type)} | ${a.value.toFixed(2)} | ${escMd(a.valued)} | ${escMd(a.notes)} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  async function saveAssets() {
    await writeFile('Assets.md', serializeAssets());
    clearDirty();
    toast('Saved Assets.md');
  }

  async function addAsset() {
    const r = await askFields(app, 'New asset', [
      { key: 'name', label: 'What is it?', type: 'text', placeholder: 'e.g. The house' },
      { key: 'type', label: 'Kind', type: 'select', value: 'property', options: ASSET_TYPES },
      { key: 'value', label: 'What would it sell for?', type: 'number', value: '0' },
      { key: 'valued', label: 'When was that worked out?', type: 'date', value: todayIso(),
        desc: 'Left as today if you are typing a figure you already know.' },
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
    });
    mark(); renderAssets();
  }

  // serializeAssets is published so a round-trip test can drive the real one.
  ctx.provide({ renderAssets, saveAssets, addAsset, serializeAssets, VALUED_STALE_DAYS });
};
