'use strict';
/* A NARROW-SCREEN RULE MUST COME AFTER THE RULE IT OVERRIDES (2026-10-20 audit, D1-01).

   An @media block raises no specificity. A rule inside one that names the same
   selector as a base rule ties it, and the tie goes to whichever comes LATER in
   the stylesheet. Written above its base rule, the phone rule never applies at
   all, and nothing says so: the declaration is right there, it is just dead.

   The audit found it on the Plan page. `@media (max-width: 640px)
   { .env-sum-bar { display: none } }` sat about 600 lines above the base
   `.env-sum-bar { display: flex }`, whose own comment pointed at "the mobile
   block at the end of this section" that was not at the end of anything. Under
   640px the 150px bar stayed, the row's one flexible column measured 0px, and
   every collapsed bucket on a phone showed a swatch, a bar, an amount and a
   percentage but no name.

   The sweep that followed found the same shape in six more places in
   src/styles.css, each a real behaviour that never happened:
     - the page-title banner's 20px side inset at 601-768px (the title sat on
       the window edge of a narrow desktop window; phone.css patched only the
       body.is-phone half of it),
     - reduced motion for the Score meter, ring and confetti, and for the
       Import drop zone and the toast (they animated anyway),
     - the donut legend's info button losing its 6px lead-in under 560px,
     - the wider gap between a note's actions on a touch screen,
     - the Plan figures' narrower gap under 640px.
   And five legacy phone sizes the statement foundation (a later file)
   replaced by design: the card title, the table heading, the Plan figures and
   the Score ring number. Those were deleted rather than moved: the foundation's
   clamp() floors ARE the phone sizes now, and a declaration that can never win
   only misleads the next reader.

   Two halves:
     1. the behaviours themselves, resolved through the cascade at the width
        that should trigger them (tests/helpers/css-cascade.cjs);
     2. the general rule, swept over the whole assembled sheet: no declaration
        inside an @media block is overridden by a LATER rule outside any
        @media with the identical selector and the same property (a shorthand
        counts), unless the media rule is restated after that base rule.

     node tests/css-media-after-base.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');
const { computed, node, ROOT } = require('./helpers/css-cascade.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const show = d => (d ? `"${d.value}" (${d.selector} at ${locate(d.line)})` : 'nothing');
const want = (path, prop, env, expect, why) => {
  const d = computed(path, prop, env);
  ok(d && (typeof expect === 'function' ? expect(d.value) : d.value === expect), `${why}: ${prop} resolves to ${show(d)}, wanted ${expect}`);
};

/* ---- 1. the behaviours ---- */
const R = ROOT();
const P = ROOT('phone');

// D1-01: the Plan bucket row's bar is gone on a phone, so the name has room.
const bar = [...R, node('button', ['env-sum']), node('div', ['env-sum-bar'])];
want(bar, 'display', { width: 375 }, 'none', 'D1-01 the collapsed bucket bar is removed under 640px');
want(bar, 'display', { width: 1280 }, 'flex', 'D1-01 and kept on a desktop');
want([...R, node('div', ['pot-figs'])], 'gap', { width: 375 }, '10px 26px', 'the Plan figures close up under 640px');
want([...R, node('div', ['pot-figs'])], 'gap', { width: 1280 }, '10px 38px', 'and keep their wide gap on a desktop');

// The banner's side inset between a phone and a tablet, on a desktop window.
const banner = [...R, node('div', ['main-content']), node('div', ['financial-period-banner'])];
want(banner, 'padding-left', { width: 700 }, '20px', 'the page title keeps a 20px inset at 601-768px on a desktop window');
want(banner, 'padding-right', { width: 700 }, '20px', 'on both sides');
want(banner, 'padding-left', { width: 375 }, v => /14px/.test(v), 'and the phone gutter under 600px');
want(banner, 'padding', { width: 1280 }, '0.25rem 0 1.25rem', 'a desktop keeps the base padding');

// Reduced motion reaches the rules it was written for.
const RM = { width: 1280, reducedMotion: true };
const score = [...R, node('div', ['score-hero'])];
want([...score, node('div', ['score-meter']), node('i', ['score-meter-fill'])], 'animation', RM, 'none', 'reduced motion stops the Score meter fill');
want([...score, node('div', ['score-ring']), node('circle', ['score-ring-fill'])], 'animation', RM, 'none', 'reduced motion stops the Score ring draw');
want([...score, node('div', ['score-confetti']), node('i', ['score-confetti-bit'])], 'animation', RM, 'none', 'reduced motion stops the confetti');
want([...R, node('div', ['upload-area'])], 'transition', RM, 'none', 'reduced motion stops the Import drop zone transition');
want([...R, node('div', [], { id: 'toast' })], 'transition', RM, 'none', 'reduced motion stops the toast transition');
want([...score, node('div', ['score-meter']), node('i', ['score-meter-fill'])], 'animation', { width: 1280 }, v => /bud-score-fill/.test(v), 'without reduced motion the meter still fills');

// The donut legend under 560px, and the notes' actions on a touch screen.
const legend = [...R, node('ul', ['donut-legend', 'donut-legend--linked']), node('li')];
// Under 600px the info button's inline margins are statement/phone.css's (its
// 44px tap target pulls them negative); the legacy `margin-left: 0` under 560px
// never applied and is gone, which the sweep below holds.
want([...legend, node('button', ['dl-note'])], 'margin-left', { width: 375 }, '-4px -8px', 'the legend info button takes phone.css\'s tap-target margins on a phone');
want([...legend, node('button', ['dl-link'])], 'gap', { width: 375 }, '7px', 'the legend row gap is 7px under 560px');
want([...legend, node('button', ['dl-note'])], 'margin-left', { width: 1280 }, '6px', 'and keeps it on a desktop');
want([...R, node('div', ['note-actions'])], 'gap', { width: 1280, pointer: 'coarse' }, '10px', 'a touch screen widens the gap between a note\'s actions');
want([...R, node('div', ['note-actions'])], 'gap', { width: 1280 }, '6px', 'a mouse keeps the tight gap');

// The legacy phone sizes are gone; the foundation's floors are what a phone gets.
want([...P, node('div', ['card']), node('div', ['card-h']), node('h2')], 'font-size', { width: 375 }, 'var(--st-card-title)', 'the card title on a phone is the statement card-title size');
want([...R, node('div', ['score-ring-mid']), node('div', ['score-ring-num'])], 'font-size', { width: 375 }, 'var(--st-figure)', 'the Score ring number on a phone is the figure size');

/* ---- 2. the sweep ---- */
const rules = readRules();
const isMedia = ctx => ctx.some(c => c.startsWith('@media'));
const COVERS = {
  padding: /^padding-(top|right|bottom|left)$/, margin: /^margin-(top|right|bottom|left)$/,
  'padding-inline': /^padding-(left|right)$/, 'margin-inline': /^margin-(left|right)$/,
  gap: /^(row|column)-gap$/, flex: /^flex-(grow|shrink|basis)$/, overflow: /^overflow-[xy]$/,
  inset: /^(top|right|bottom|left)$/, background: /^background-/, font: /^font-/,
  border: /^border-(top|right|bottom|left|width|style|color)$/, 'grid-template': /^grid-template-/,
};
const overlaps = (a, b) => a === b || (COVERS[a] && COVERS[a].test(b)) || (COVERS[b] && COVERS[b].test(a));
const dead = [];
let mediaDecls = 0;
for (const r of rules) {
  if (!isMedia(r.context)) continue;
  for (const sel of r.selectors) {
    for (const d of r.decls) {
      mediaDecls++;
      const base = rules.find(q => q.line > r.line && !isMedia(q.context) && q.selectors.includes(sel)
        && q.decls.some(e => overlaps(e.prop, d.prop)));
      if (!base) continue;
      const restated = rules.some(z => z.line > base.line && JSON.stringify(z.context) === JSON.stringify(r.context)
        && z.selectors.includes(sel) && z.decls.some(e => overlaps(e.prop, d.prop)));
      if (restated) continue;
      dead.push(`${locate(d.line)} ${r.context.join(' ')} ${sel} { ${d.prop}: ${d.value} } — overridden by ${locate(base.line)}`);
    }
  }
}
ok(mediaDecls > 500, `sanity: the sweep should see the sheet's media declarations, saw ${mediaDecls}`);
ok(dead.length === 0, `${dead.length} @media declaration(s) can never apply: a later rule outside any @media, with the same ` +
  'selector, sets the same property and wins the tie on source order. Move the media rule below its base rule ' +
  '(or delete it if a later layer replaced it by design):\n    ' + dead.join('\n    '));

if (failures.length) { console.error(`FAIL — css-media-after-base: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-media-after-base: every @media rule comes after the base rule it overrides; the Plan bucket bar, the banner inset, reduced motion, the legend and the note actions each apply at their width (${checks} checks).`);
