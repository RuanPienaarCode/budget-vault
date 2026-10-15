'use strict';
/* THE LOAN CALCULATOR'S SLIDERS ARE A STYLED TRACK, NOT A GREY SLAB (audit L5-01).

   Obsidian's own `input[type='range']` rule (app.css, 0,1,1) sets
   -webkit-appearance: none and a 6px track, and the host also styles the
   thumb. Inside the plugin that left `.loan-range` with:

     - `accent-color`, the only thing the plugin set to colour it, doing
       nothing at all: accent-color only paints a NATIVE slider, and the host
       had switched the native one off;
     - `min-height: 28px` (44px on a phone) stretching the host's
       background-colour box into a 28/44px grey slab with a small thumb
       floating in the middle of it (measured in Chromium against Obsidian
       1.14.4's real app.css, 375x667 phone: the track was 44px thick).

   The Plan page's `.env-slider` solved the same host collision: an explicit
   track, an explicit thumb, `background-clip: content-box` so the padding is
   hit area and the painted track stays 8px. The loan sliders now share that
   rule instead of carrying a second, weaker copy.

   Negative controls, each run by hand when this file was written: put
   `min-height` back on .loan-range; drop `background-clip` from the shared
   track rule; drop .loan-range from the thumb rule; drop it from the guarded
   :focus fallback. Each fails here.

     node tests/css-loan-range-track.test.cjs */

const fs = require('fs');
const path = require('path');
const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';
const SEL = `${R} .loan-range`;
const PORTRAIT = ['@media (max-width: 600px)'];
const px = v => { const m = /^(-?[\d.]+)px$/.exec(String(v).trim()); return m ? Number(m[1]) : null; };

/* Every rule that styles this control (alone or in a list), with its context. */
const mine = rules.filter(r => r.selectors.some(s => s === SEL || s.startsWith(`${SEL}::`) || s.startsWith(`${SEL}:`)));
const decl = (ctx, test, prop) => {
  let hit = null;
  for (const r of mine) {
    if (JSON.stringify(r.context) !== JSON.stringify(ctx)) continue;
    if (!r.selectors.some(test)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, r };
  }
  return hit;
};
const isTrack = s => s === SEL;
const want = (ctx, test, prop, fn, why) => {
  const d = decl(ctx, test, prop);
  ok(d && fn(d.value), `${SEL} { ${prop} } in ${ctx.join(' ') || '(base)'} should ${why}; found ${d ? `"${d.value}" at ${locate(d.r.line)}` : 'nothing'}`);
  return d;
};

/* ---- 1. the track: explicit, because the host's appearance:none removed the native one */
want([], isTrack, 'appearance', v => v === 'none', 'switch the native slider off itself (the host already had)');
want([], isTrack, '-webkit-appearance', v => v === 'none', 'switch the WebKit native slider off (iOS 15 reads only the prefixed property)');
want([], isTrack, 'width', v => v === '100%', 'fill its field');
want([], isTrack, 'background-color', v => v.length > 0, 'paint its own track colour (longhand: the shorthand would reset the clip)');
want([], isTrack, 'background-clip', v => v === 'content-box', 'clip the track to the content box, so the padding is hit area and not a fat bar');
want([], isTrack, 'border-radius', v => px(v) >= 99 || v === '999px', 'round the track');
{
  const h = decl([], isTrack, 'height'), p = decl([], isTrack, 'padding-block');
  ok(h && p && px(h.value) >= 24 && px(h.value) - 2 * px(p.value) === 8,
    `the painted track is 8px inside a >=24px box (WCAG 2.2 target floor), found height ${h && h.value} / padding-block ${p && p.value}`);
}
ok(!decl([], isTrack, 'min-height') && !decl(PORTRAIT, isTrack, 'min-height'),
  'no min-height on .loan-range in any context: it stretched the host\'s 6px track into a 28/44px grey slab; the box is sized with height + padding-block');
ok(!mine.some(r => r.decls.some(d => d.prop === 'background' && /^[^u]/.test(d.value) && !/^(none|transparent)$/.test(d.value)) && r.selectors.some(isTrack)),
  'the track must not use the `background` shorthand (it resets background-clip)');

/* ---- 2. the thumb: the host styles it, and nothing else of ours reached it -------------------- */
for (const pseudo of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
  const test = s => s === `${SEL}${pseudo}`;
  const w = decl([], test, 'width'), h = decl([], test, 'height');
  ok(w && h && px(w.value) >= 20 && px(h.value) >= 20, `${SEL}${pseudo} should be a thumb of at least 20px (a thumb is dragged with a thumb), found ${w && w.value} x ${h && h.value}`);
  ok(decl([], test, 'border') && decl([], test, 'border-radius'), `${SEL}${pseudo} should carry its own ring and radius`);
}
ok(decl([], s => s === `${SEL}::-webkit-slider-thumb`, 'appearance') || decl([], s => s === `${SEL}::-webkit-slider-thumb`, '-webkit-appearance'),
  'the WebKit thumb switches its native look off');

/* ---- 3. phone: a 44px hit area around the same 8px track ------------------------------------- */
{
  const h = decl(PORTRAIT, isTrack, 'height'), p = decl(PORTRAIT, isTrack, 'padding-block');
  ok(h && p && px(h.value) >= 44 && px(h.value) - 2 * px(p.value) === 8,
    `on a phone .loan-range is a 44px target with the SAME 8px painted track (height - 2 x padding-block), found ${h && h.value} / ${p && p.value}`);
}

/* ---- 4. focus: a visible ring on every engine ------------------------------------------------- */
ok(mine.some(r => r.context.length === 0 && r.selectors.includes(`${SEL}:focus-visible`) && r.decls.some(d => d.prop === 'outline' && /2px solid/.test(d.value))),
  '.loan-range has a :focus-visible ring');
ok(mine.some(r => r.context.join() === '@supports not selector(:focus-visible)' && r.selectors.includes(`${SEL}:focus`) && r.decls.some(d => d.prop === 'outline')),
  '.loan-range has the guarded :focus fallback for iOS 15.0-15.3 (an unknown :focus-visible drops the whole rule there)');
ok(!mine.some(r => r.selectors.length > 1 && r.selectors.some(s => /:focus-visible/.test(s))), ':focus-visible is never listed beside another selector (one unknown pseudo-class invalidates the list)');

/* ---- 5. dark theme: the same translucent-track treatment as the Plan slider ------------------- */
ok(rules.some(r => r.selectors.includes(SEL) && r.context.some(c => /^@supports \((color|background): color-mix/.test(c)) && r.decls.some(d => d.prop === 'background-color' && /color-mix/.test(d.value))),
  'the color-mix track tint (the plan slider\'s) also reaches .loan-range, behind its @supports guard');

/* ---- 6. the markup cannot undo it ------------------------------------------------------------- */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'loans.js'), 'utf8');
  ok(!/\.style\.background\s*=|style:\s*['"`][^'"`]*background/.test(src), 'views/loans.js sets no inline `background` (the shorthand would reset the track clip)');
}

if (failures.length) {
  console.log(`FAIL — css-loan-range-track: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-loan-range-track: ${checks} checks (explicit track + thumb like .env-slider, no min-height slab, 44px phone hit area around an 8px track, guarded focus ring).`);
