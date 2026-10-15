'use strict';
/* THE "UNREADABLE FILES" BANNER, THE UNREADABLE AMOUNT FIELD AND AN INACTIVE SERVICE ROW (Wave A follow-ups).

   1. controller.js renders a banner above every page when a file is present but
      unreadable: `div.kpi-caveat.bv-unreadable-banner > span.kpi-caveat-txt`, a
      direct child of .bud-scroll, i.e. OUTSIDE .main-content and its gutters.
      `.kpi-caveat` is deliberately quiet (it reports the AGE of a figure), and
      this reports a file the app could not read, so it gets a bordered card in
      the warning tone: the warning fill, the warning ink for the border, the
      primary text ink for the sentence (>= 12px), and the same side gutters as
      the page's own blocks on a desktop (the 1200px column less its 2.5rem
      padding) and on a phone (14px). tests/css-class-coverage holds that the
      class has a rule at all.
   2. views/budgets.js shows an Amount the loader could not read in a text field
      with aria-invalid="true" (a number input would render it blank). The field
      takes the warning ink for its border, so it is tellable from a good one
      without relying on the text beside it.
   3. `.svc-inactive td { opacity: .5 }` multiplied the INK of an inactive
      service row, the same shape the settled-debt fix removed (see
      tests/css-settled-debt-contrast): --text-primary at half opacity over the
      pale tile is ~3.5:1 and the muted notes beside it lower. The row is quieter
      through its ink token now, never through opacity on the cell.

     node tests/css-unreadable-banner-and-dimmed-row.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';

const last = (sel, prop, ctx = []) => {
  let hit = null;
  for (const r of rules) {
    if (JSON.stringify(r.context) !== JSON.stringify(ctx) || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, rule: r };
  }
  return hit;
};
const px = v => { const m = /^(-?[\d.]+)(px|rem)?$/.exec(String(v).trim()); return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : NaN; };

/* ---- colour arithmetic: hex or rgba() ---- */
const parse = v => {
  v = String(v).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
};
const over = (top, bot) => [0, 1, 2].map(i => top[i] * top[3] + bot[i] * (1 - top[3]));
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/* Tokens per theme: the base root (light) and .bud-dark carry the warning
   tokens; the generated palettes carry the text and page colours. */
const tok = (sel, prop) => { const d = last(sel, prop); return d ? parse(d.value) : null; };
const warnLight = { light: tok(R, '--color-warning-light'), dark: tok(`${R}.bud-dark`, '--color-warning-light') };
ok(warnLight.light && warnLight.dark, 'the warning-light token is a literal in both themes');
const palettes = { light: [], dark: [] };
for (const r of rules) for (const s of r.selectors) {
  const m = /^\.budget-app-root\.bud-palette-([a-z-]+)(\.bud-dark)?$/.exec(s);
  if (!m || r.context.length) continue;
  const get = p => { const d = r.decls.find(x => x.prop === p); return d ? parse(d.value) : null; };
  const t = { name: m[1], text: get('--text-primary'), body: get('--body-bg') };
  if (t.text && t.body) palettes[m[2] ? 'dark' : 'light'].push(t);
}
ok(palettes.light.length >= 4 && palettes.dark.length >= 4, 'the four palettes are read in both themes');

/* ---- 1. the banner ---- */
const B = `${R} .bv-unreadable-banner`;
ok(rules.some(r => r.selectors.includes(B)), `the banner has a rule (${B})`);
{
  const bg = last(B, 'background'), border = last(B, 'border'), rad = last(B, 'border-radius'), pad = last(B, 'padding');
  ok(bg && bg.value === 'var(--color-warning-light)', `the banner sits on the warning fill; found ${bg && bg.value}`);
  ok(border && /^1px solid var\(--color-warning-ink\)$/.test(border.value), `the banner is bordered in the warning ink (the fill amber is 2.2:1 as a border on white); found ${border && border.value}`);
  ok(rad && (/^var\(--radius(-sm|-lg|-card)?\)$/.test(rad.value) || px(rad.value) >= 8), `the banner is rounded with the house radius token; found ${rad && rad.value}`);
  ok(pad && px(String(pad.value).split(/\s+/)[0]) >= 8, 'the banner has padding of its own');
  const txt = last(`${B} .kpi-caveat-txt`, 'font-size');
  ok(txt && px(txt.value) >= 12, `the banner sentence is >= 12px; found ${txt && txt.value}`);
  const ink = last(`${B} .kpi-caveat-txt`, 'color');
  ok(ink && ink.value === 'var(--text-primary)', `the sentence takes the primary ink; found ${ink && ink.value}`);
  /* The sentence reads at 4.5:1 on the fill over the page, every palette. */
  for (const theme of ['light', 'dark']) for (const t of palettes[theme]) {
    const q = ratio(t.text, over(warnLight[theme], t.body));
    ok(q >= 4.5, `${t.name} ${theme}: banner text on the warning fill is ${q.toFixed(2)}:1 (< 4.5)`);
  }
  /* Gutters: it is a child of .bud-scroll, so it carries the column itself. */
  const mw = last(B, 'max-width');
  ok(mw && /calc\(1200px - 5rem\)/.test(mw.value), `on a desktop it is as wide as the page's own column (1200px less 2.5rem each side); found ${mw && mw.value}`);
  const m768 = last(B, 'margin-left', ['@media (max-width: 768px)']), m768r = last(B, 'margin-right', ['@media (max-width: 768px)']);
  ok(m768 && m768r && px(m768.value) === 14 && px(m768r.value) === 14, 'on a phone it keeps the 14px gutter every loose block has');
  const w768 = last(B, 'width', ['@media (max-width: 768px)']);
  ok(w768 && w768.value === 'auto', 'on a phone it stops being the desktop column width, so the 14px margins sit on the screen edges');
}

/* ---- 2. an Amount the loader could not read ---- */
{
  const S = `${R} .bud-amt-wrap input[aria-invalid="true"]`;
  const bc = last(S, 'border-color');
  ok(bc && bc.value === 'var(--color-warning-ink)', `the unreadable Amount field takes the warning ink for its border; found ${bc && bc.value}`);
  const sh = last(S, 'box-shadow');
  ok(sh && /var\(--color-warning-ink\)/.test(sh.value), 'and a 1px inset ring of the same ink, so the border reads as 2px without moving the layout');
}

/* ---- 3. an inactive service row is not dimmed through opacity ---- */
for (const r of rules) {
  if (!r.selectors.some(s => /\.svc-inactive\b/.test(s))) continue;
  for (const d of r.decls) if (d.prop === 'opacity') ok(Number(d.value) >= 1, `${locate(d.line)}: .svc-inactive must not dim ink with opacity (${d.value}); a quieter row is built from --text-muted`);
}
{
  const d = last(`${R} .svc-inactive td`, 'color');
  ok(d && d.value === 'var(--text-muted)', `an inactive service row's ink is --text-muted; found ${d && d.value}`);
  for (const theme of ['light', 'dark']) for (const t of palettes[theme]) {
    const muted = (() => { for (const r of rules) for (const s of r.selectors) { if (s === `${R}.bud-palette-${t.name}${theme === 'dark' ? '.bud-dark' : ''}` && !r.context.length) { const x = r.decls.find(y => y.prop === '--text-muted'); if (x) return parse(x.value); } } return null; })();
    const q = muted && ratio(muted, t.body);
    ok(q >= 4.5, `${t.name} ${theme}: --text-muted on the page is ${q && q.toFixed(2)}:1 (< 4.5)`);
  }
}

if (failures.length) { console.error(`FAIL — css-unreadable-banner-and-dimmed-row: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-unreadable-banner-and-dimmed-row: the unreadable-files banner is a bordered warning card with the page gutters, the unreadable Amount field has a warning border, an inactive service row keeps 4.5:1 (${checks} checks).`);
