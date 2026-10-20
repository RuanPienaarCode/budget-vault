'use strict';
/* THE 2026-10-20 AUDIT'S LAYOUT AND INK FINDINGS, RESOLVED THROUGH THE CASCADE.

   Each finding below was measured in Chromium over the synthetic household
   (harness :8832, 1280 / 1024 / 375px, both themes). A bare-node guard cannot
   lay a page out, so each check asks the stylesheet the question the
   measurement turned on: which declaration wins for this element at this
   width (tests/helpers/css-cascade.cjs). Every check here failed before its
   fix and passes after it.

     D1-03  Accounts: the card-overlap caveat was a grid CELL of the summary
            band, stretched to the "Where it sits" card's 351px, its button
            186px under its text. It is a full-width row under the band.
     D1-16  Savings: four tiles in five fixed columns, the right fifth empty.
            The 5-up row lays out the tiles it has.
     D1-17  The Savings banners and the Debts overlap note: text and button
            touching (0px); the Debts line 24px left of its card's heading.
     D1-21  Dashboard "Budget vs actual" at 375px: the table at x=5 under a
            card title at x=14, the Budget and Spent figures 8px apart.
     D1-22  Services at 375px: a group bar drawn as two grey boxes with a
            white gap, the total 6px higher than the name.
     D1-23  Accounts: the unsorted column's sort glyph at 1.91:1 (light) /
            2.51:1 (dark), under the 3:1 a meaningful glyph needs.
     D2-22  Accounts hero: its ::first-letter symbol on the fallback ratio,
            not the display pair the other display figures use.
     D2-23  The paid / done / uploaded pills in a hex green of their own; the
            debt type in two colours on one Budget row (amber dot, orange chip).
   And D1-04's CSS half, which needed no change: the muted-symbol hook
   (.st-money) already reaches a KPI tile's value and a loan figure; the views
   must say which of their tiles print money (a JS change, lanes L4/L5).

     node tests/css-layout-2026-10-20.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');
const { computed, node, ROOT } = require('./helpers/css-cascade.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const show = d => (d ? `"${d.value}" (${d.selector} at ${locate(d.line)})` : 'nothing');
const val = (path, prop, env) => { const d = computed(path, prop, env); return d ? d.value : null; };
const want = (path, prop, env, expect, why) => {
  const d = computed(path, prop, env);
  const good = d && (typeof expect === 'function' ? expect(d.value) : d.value === expect);
  ok(good, `${why}: ${prop} at ${env.width}px resolves to ${show(d)}, wanted ${typeof expect === 'function' ? 'a passing value' : expect}`);
  return d;
};
const px = v => { const m = /^(-?[\d.]+)(px|rem)?$/.exec(String(v).trim()); return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : NaN; };
/* One side of a padding/margin, from a longhand, a logical pair or a shorthand. */
const side = (d, which) => {
  if (!d) return NaN;
  const parts = String(d.value).trim().split(/\s+/);
  if (/-(left|right|top|bottom)$/.test(d.prop)) return px(parts[0]);
  if (/-inline$/.test(d.prop)) return px(which === 'left' ? parts[0] : (parts[1] || parts[0]));
  const [t, r = t, b = t, l = r] = parts;
  return px({ top: t, right: r, bottom: b, left: l }[which]);
};
const padLeft = (path, env) => side(computed(path, 'padding-left', env), 'left');

const R = ROOT();
const P = ROOT('phone');

/* ---- D1-03: the Accounts caveat is a row under the band, not a cell in it ---- */
{
  const cav = [...R, node('div', ['top-grid', 'mb-4'], { id: 'acctSummary' }), node('div', ['kpi-caveat'])];
  want(cav, 'grid-column', { width: 1280 }, '1 / -1', 'D1-03 the overlap caveat spans the whole band');
  want(cav, 'align-self', { width: 1280 }, 'start', 'D1-03 and is as tall as its own line, not the card beside it');
  want(cav, 'grid-column', { width: 375 }, '1 / -1', 'on a phone too (one column: the same thing)');
}

/* ---- D1-16: the 5-up row lays out the tiles it has ---- */
{
  const row = [...R, node('div', ['mini-grid', 'mini-kpis-5', 'mb-4'], { id: 'savingsKpis' })];
  want(row, 'grid-auto-flow', { width: 1280 }, 'column', 'D1-16 above 1100px the tiles flow into one column each');
  want(row, 'grid-template-columns', { width: 1280 }, 'none', 'D1-16 instead of five fixed columns');
  want(row, 'grid-auto-columns', { width: 1280 }, '1fr', 'D1-16 of equal width');
  want(row, 'grid-template-columns', { width: 1024 }, 'repeat(3, 1fr)', 'the 3-column step under 1100px is untouched');
  ok(val(row, 'grid-auto-flow', { width: 1024 }) === null, 'and the column flow does not reach it');
}

/* ---- D1-17: caveat text and button apart; the Debts note at its heading's edge ---- */
{
  const banner = [...R, node('div', ['sav-banner', 'sav-banner-warn'])];
  want(banner, 'display', { width: 1280 }, 'flex', 'D1-17 the Savings banner is a flex row');
  want(banner, 'gap', { width: 1280 }, v => px(String(v).split(/\s+/).pop()) >= 8, 'D1-17 with a gap between the sentence and its button');

  const card = [...R, node('div', ['card'])];
  const head = [...card, node('div', ['card-h'])];
  const body = [...card, node('div', ['body-pad', 'body-pad-tight'])];
  const note = [...body, node('div', ['debt-card-overlap'])];
  want(note, 'display', { width: 1280 }, 'flex', 'D1-17 the Debts overlap note is a flex row');
  want(note, 'justify-content', { width: 1280 }, 'space-between', 'D1-17 its button to the right, as on the Dashboard');
  want(note, 'gap', { width: 1280 }, v => px(String(v).split(/\s+/).pop()) >= 8, 'D1-17 and apart from the sentence');
  for (const [width, path] of [[1280, R], [700, R], [375, P]]) {
    const h = [...path, ...head.slice(R.length)], b = [...path, ...body.slice(R.length)], n = [...path, ...note.slice(R.length)];
    const inset = padLeft(h, { width }) - padLeft(b, { width });
    const got = side(computed(n, 'padding-left', { width }), 'left');
    ok(got === inset, `D1-17 at ${width}px the Debts note starts at the card heading's edge: card-h ${padLeft(h, { width })}px less the table body's ${padLeft(b, { width })}px = ${inset}px, found ${got}px`);
  }
}

/* ---- D1-21: the Dashboard budget table on a phone ---- */
{
  const card = [...P, node('div', ['card'])];
  const head = [...card, node('div', ['card-h'])];
  const rim = [...card, node('div', ['body-pad', 'body-pad-tight'])];
  const tbl = [...rim, node('div', ['table-responsive']), node('table', ['table'], { id: 'dashBudget' })];
  // A body row as the view builds it: name, Budget, Spent, bar, Remaining.
  const cell = (nth, cls = []) => [...tbl, node('tbody'), node('tr'), node('td', cls, { nth, of: 5 })];
  const gutter = padLeft(head, { width: 375 }) - padLeft(rim, { width: 375 });
  ok(gutter === 9, `sanity: the phone card gutter is 14px and the table rim 5px (owed: 9px), computed ${gutter}px`);
  ok(padLeft(cell(1), { width: 375 }) === gutter, `D1-21 the first cell carries the rest of the card gutter (${gutter}px), so a name starts under the card title; found ${show(computed(cell(1), 'padding-left', { width: 375 }))}`);
  ok(side(computed(cell(5, ['num']), 'padding-right', { width: 375 }), 'right') === gutter,
    `D1-21 and the last cell, so the Remaining column ends where the card text does; found ${show(computed(cell(5, ['num']), 'padding-right', { width: 375 }))}`);
  want(cell(2, ['num']), 'padding-left', { width: 375 }, '0.6rem', 'D1-21 the Budget figure leads with 0.6rem');
  want(cell(3, ['num']), 'padding-left', { width: 375 }, '0.6rem', 'D1-21 and so does Spent, so the two are not one run');
  want(cell(3, ['num']), 'font-size', { width: 375 }, '13px', 'D1-21 paid for by 13px cells (the type floor is 12px)');
  // A phone on its side keeps its own edge cells (its rim and title are both 20px).
  const land = [...P, node('div', ['card']), node('div', ['body-pad', 'body-pad-tight']), node('div', ['table-responsive']), node('table', ['table'], { id: 'dashBudget' }), node('tbody'), node('tr'), node('td', [], { nth: 1, of: 5 })];
  want(land, 'padding-left', { width: 667 }, '0.2rem', 'a landscape phone keeps its 0.2rem first cell');
}

/* ---- D1-22: the Services group bar is one band ---- */
for (const [label, base, width] of [['portrait', ROOT(), 375], ['phone', P, 700]]) {
  const tr = [...base, node('table', ['table'], { id: 'svcTable', attrs: { role: 'table' } }), node('tbody'), node('tr', ['type-row'])];
  want(tr, 'gap', { width }, '0', `D1-22 (${label}) the group bar's cells touch (the card rows' 12px gap does not reach it)`);
  // The group row as the view builds it: the name (colspan) and the total.
  const total = [...tr, node('td', ['num'], { nth: 2, of: 2 })];
  want(total, 'margin-top', { width }, '0', `D1-22 (${label}) the total sits level with the name (the service rows' -6px second line does not reach it)`);
  want(total, 'white-space', { width }, 'normal', `D1-22 (${label}) and may wrap, so a total that names other currencies cannot squeeze the group name out`);
}

/* ---- D1-23: the sort glyph clears 3:1 on every palette, both themes ---- */
{
  const caret = [...R, node('table', ['table']), node('thead'), node('tr'), node('th'), node('button'), node('span', ['acct-caret'])];
  const op = computed(caret, 'opacity', { width: 1280 });
  ok(!op || Number(op.value) >= 1, `D1-23 the glyph is not dimmed by opacity (found ${show(op)})`);
  const ink = val(caret, 'color', { width: 1280 });
  ok(ink === 'var(--ink-faint)', `D1-23 the glyph is set in --ink-faint, found ${ink}`);
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  let palettes = 0;
  for (const r of readRules()) {
    if (r.context.length) continue;
    for (const s of r.selectors) {
      const m = /^\.budget-app-root\.bud-palette-([a-z-]+)(\.bud-dark)?$/.exec(s);
      if (!m) continue;
      const get = p => { const d = r.decls.find(x => x.prop === p); return d && /^#[0-9a-f]{6}$/i.test(d.value) ? hex(d.value) : null; };
      const faint = get('--ink-faint'), surface = get('--surface');
      if (!faint || !surface) continue;
      palettes++;
      // The card is translucent glass over the page; the audit read the glyph on rgb(241,246,246).
      const grounds = m[2] ? [surface] : [surface, [241, 246, 246]];
      for (const g of grounds) {
        const q = ratio(faint, g);
        ok(q >= 3, `D1-23 ${m[1]}${m[2] ? ' dark' : ''}: --ink-faint on ${g} is ${q.toFixed(2)}:1, under 3:1`);
      }
    }
  }
  ok(palettes >= 8, `sanity: four palettes in two themes are measured, found ${palettes}`);
}

/* ---- D2-22: the Accounts hero draws its symbol with the display pair ---- */
{
  const hero = [...R, node('div', ['card', 'acct-hero']), node('div', ['hero-num'])];
  want(hero, '--st-cur', { width: 1280 }, 'var(--st-cur-display)', 'D2-22 the Accounts hero symbol is display-sized');
  want(hero, '--st-cur-gap', { width: 1280 }, 'var(--st-cur-gap-display)', 'D2-22 with the display gap beside it');
  const fs = computed(hero, 'font-size', { width: 1280 });
  ok(fs && /foundation/.test(locate(fs.line)), `D2-22 the hero's size lives with its symbol tokens in the foundation, found ${show(fs)}`);
}

/* ---- D2-23: success pills on the success ink; debt in one colour family ---- */
{
  for (const cls of ['status-paid', 'tax-done', 'tax-uploaded']) {
    want([...R, node('span', ['status-pill', cls])], 'color', { width: 1280 }, 'var(--color-primary)', `D2-23 light .${cls} reads the success ink token, not a hex of its own`);
  }
  const dot = [...R, node('table', ['bud-table']), node('tbody'), node('tr', ['type-row'], { attrs: { 'data-type': 'debt' } })];
  const dotTok = val(dot, '--bud-g', { width: 1280 });
  const badge = [...R, node('span', ['category-badge', 'badge-debt'])];
  const ink = val(badge, 'color', { width: 1280 }), fill = val(badge, 'background', { width: 1280 });
  const fam = v => (/var\(--color-(warning|danger|info|success)/.exec(String(v)) || [])[1];
  ok(fam(dotTok) && fam(dotTok) === fam(ink) && fam(ink) === fam(fill),
    `D2-23 the debt type is one colour family: the Budget group dot ${dotTok}, the chip ${ink} on ${fill}`);
  const darkInk = val([...ROOT('bud-dark'), node('span', ['category-badge', 'badge-debt'])], 'color', { width: 1280 });
  ok(fam(darkInk) === fam(dotTok), `D2-23 in the dark theme too (chip ${darkInk})`);
}

/* ---- D1-04 (CSS half, unchanged): the hook reaches the money figures ---- */
{
  const fl = { width: 1280, pseudo: '::first-letter' };
  for (const id of ['savingsKpis', 'debtKpis', 'owedKpis', 'servicesKpis']) {
    const v = cls => [...R, node('div', ['mini-grid'], { id }), node('div', ['mini']), node('div', ['v', 'num', ...cls])];
    const d = computed(v(['st-money']), 'font-size', fl);
    ok(d && /\.st-money::first-letter/.test(d.selector), `D1-04 a money tile on #${id} marked .st-money gets the muted symbol (found ${show(d)})`);
    ok(!computed(v([]), 'font-size', fl), `D1-04 a tile on #${id} that is not marked (a count, a percentage) keeps its first character whole`);
    ok(val(v(['st-money']), '--st-cur', { width: 1280 }) === 'var(--st-cur-figure-sm)', `D1-04 and the symbol is sized for a figure-small tile on #${id}`);
  }
  const lo = cls => [...R, node('div', ['loan-out']), node('div', ['lo-row']), node('b', ['lo-v', 'num', 'lo-big', ...cls])];
  ok(computed(lo(['st-money']), 'font-size', fl), 'D1-04 a loan figure marked .st-money gets the muted symbol');
  ok(!computed(lo([]), 'font-size', fl), 'D1-04 an unmarked loan figure (a tariff in another currency) does not');
}

if (failures.length) { console.error(`FAIL — css-layout-2026-10-20: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-layout-2026-10-20: the Accounts caveat row, the 5-up row, caveat gaps and insets, the phone budget table and group bar, the sort glyph, the hero symbol, the success pills and the debt colour each resolve as measured (${checks} checks).`);
