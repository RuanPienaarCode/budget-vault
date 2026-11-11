'use strict';
/* The palette generator, pinned.

   Four invariants, each a build failure:

     1. REPRODUCTION. The generated `vault-green` blocks match the hand-written
        palette at the top of src/styles.css, colour for colour. This is the
        whole reason vault-green goes through the generator at all. If the seed
        set could not reproduce the one palette a person actually designed, it
        is not expressive enough to be trusted with the others — and without
        this test that failure is invisible, because the hand-written default
        would keep looking right while every generated preset quietly looked
        worse. It also guarantees an upgrade changes nothing for anyone who
        never opens the setting.

     2. CONTRAST. Every text colour clears WCAG AA against the surfaces it is
        actually painted on, in both modes of every palette. The hand-written
        palette carries its own AA workings in comments — --text-light is
        annotated "AA (5.0:1) on --body-bg; was #7b8494 (3.3:1)" — and a
        generated palette has no comments to carry them, so the ratio is
        asserted instead of remembered.

     3. PARITY. The ids the settings dropdown offers (PALETTE_PRESETS in
        src/constants.js) are exactly the ids the generator emits. Same reason
        settings-parity.test.cjs exists: two lists of the same thing drift, and
        a dropdown offering a palette with no CSS behind it would silently do
        nothing.

     4. OVERRIDE BUDGET. Overrides are capped. They are the escape hatch for
        tokens that genuinely do not derive, and a palette needing several would
        mean the seed set is wrong — so the cap turns "the design is drifting"
        into a failed build rather than a slow accumulation nobody notices.

   And a seventh section, numbered to match the code below, for the pairs
   invariant 2 cannot see because they are not text on a surface. The
   2026-11-11 audit measured each one failing:

     7a. A FORM CONTROL'S EDGE against what the field sits on: 1.20:1 light,
         1.24:1 dark, on all four palettes. WCAG 1.4.11 asks 3:1 of the
         boundary a control is found by.
     7b. A GRADIENT BUTTON'S LABEL against the lightest point of its own
         gradient: 3.74:1 on vault-green and 3.68:1 on ocean, where 13.6px
         bold text needs 4.5:1.
     7c. THE INFO INK of the Budget page's pressed "fixed bill" toggle,
         painted in the info FILL: 2.77:1 on a white card.

   Each is read out of the stylesheet rather than restated here, so the gate
   measures the rule that ships, and each also refuses a second rule that
   would repaint the same pair somewhere the gate is not looking.

   Pure text and arithmetic — no Obsidian, no DOM, no bundle. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { derive, contrast, rgb } = require('../scripts/palette.cjs');
const { PRESETS, DEFAULT_PRESET } = require('../scripts/presets.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const root = path.join(__dirname, '..');
/* Every HAND-WRITTEN source (tests/helpers/css-sources.cjs): the legacy sheet,
   the statement foundation and the page lanes, in cascade order, without the
   generated palette blocks, which this file checks separately against their
   seeds. The palette's base blocks are the FIRST rules for their selectors in
   it, which is where the legacy sheet keeps them; the "no hardcoded brand colour
   outside the palette blocks" scan below now also covers the statement files. */
const baseCss = require('./helpers/css-sources.cjs').sources()
  .filter(s => s.rel !== 'src/styles-presets.css').map(s => s.text).join('');

/* Parse a `{ --a: x; --b: y }` rule body into a token map. */
function tokensOf(css, selector) {
  const m = new RegExp(String.raw`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*\{([\s\S]*?)\n\}`).exec(css);
  assert.ok(m, `selector not found in stylesheet: ${selector}`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

/* Colours are compared by VALUE, not by source text. The hand-written palette
   spells the same colour several ways — `rgba(6, 95, 70, 0.20)` with spaces
   beside `rgba(15,23,32,.09)` without, `0.18` beside `.18` — and a byte
   comparison would fail on formatting while passing a genuine colour change of
   one unit. Normalising to an [r,g,b,a] tuple compares what the browser will
   actually paint. */
function norm(v) {
  const s = String(v).trim();
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map(x => x.trim());
    const a = p.length > 3 ? parseFloat(p[3]) : 1;
    return [Number(p[0]), Number(p[1]), Number(p[2]), a];
  }
  if (/^#[0-9a-f]{3,6}$/i.test(s)) return [...rgb(s), 1];
  return s;   // not a colour (a shadow, a font stack) — compared as text
}

/* ---- 1. the generator reproduces the hand-written Vault Green ---- */
{
  const vg = PRESETS.find(p => p.id === 'vault-green');
  ok(vg, 'vault-green is a defined preset');
  eq(DEFAULT_PRESET, 'vault-green', 'and is the default');

  for (const [mode, selector] of [
    ['light', '.budget-app-root'],
    ['dark', '.budget-app-root.bud-dark'],
  ]) {
    const hand = tokensOf(baseCss, selector);
    const gen = derive(vg[mode], mode, vg[mode === 'light' ? 'lightOverrides' : 'darkOverrides'] || {});
    for (const [token, value] of Object.entries(gen)) {
      ok(token in hand, `${mode}: hand-written palette defines ${token}`);
      assert.deepStrictEqual(
        norm(value), norm(hand[token]),
        `${mode} ${token}: generated ${value} != hand-written ${hand[token]}`,
      );
      checks++;
    }
  }
}

/* ---- 2. every palette clears WCAG AA in both modes ----

   Pairs chosen to match where the text is actually drawn: body copy sits on
   cards (--surface), the page behind them is --body-bg, and --text-light is the
   faintest thing the design uses, which is exactly the one that slipped to
   3.3:1 in an earlier revision of the hand-written palette.

   4.5:1 is AA for normal-size text. --text-light is held to 4.5 as well rather
   than the 3:1 large-text allowance, because the plugin uses it for small
   captions, not headings. */
{
  const AA = 4.5;

  /* No grandfathered pairs. There was one, and this is the note it left.

     vault-green's DARK --text-light was #6f7799, which measured 4.07:1 on the
     dark card (--surface #12162a) — it cleared AA against the PAGE and failed
     against the card, which is where nearly every consumer of the token it
     feeds actually sits. It was waived here rather than hidden, on the
     reasoning that nudging it changes the look of the palette every existing
     user is on, and that is a product decision rather than one a test should
     make silently.

     Taken in 1.16.1, after an audit found the same 4.07:1 independently. The
     product decision was made deliberately: #7d85a7, which measures 4.93:1 on
     the card and 5.61:1 on the page, and sits in family with the three newer
     palettes (4.56-4.59 against their own surfaces). The seed in
     scripts/presets.cjs and the hand-written pair in src/styles.css moved
     together, as the note that used to live here required.

     The list stays, empty, because the mechanism is the valuable part: a
     waiver that cannot rot. An entry here fails the moment its pair is brought
     up to AA, so an exemption cannot outlive the problem it excused. */
  const GRANDFATHERED = [];

  for (const p of PRESETS) {
    for (const mode of ['light', 'dark']) {
      const s = p[mode];
      for (const [fg, bg, fgName, bgName] of [
        [s.textPrimary, s.surface, 'textPrimary', 'surface'],
        [s.textPrimary, s.bodyBg, 'textPrimary', 'bodyBg'],
        [s.textMuted, s.surface, 'textMuted', 'surface'],
        [s.textMuted, s.bodyBg, 'textMuted', 'bodyBg'],
        [s.textLight, s.surface, 'textLight', 'surface'],
        [s.textLight, s.bodyBg, 'textLight', 'bodyBg'],
      ]) {
        const r = contrast(fg, bg);
        const waived = GRANDFATHERED.find(g => g.id === p.id && g.mode === mode && g.fg === fgName && g.bg === bgName);
        if (waived) {
          ok(r < AA,
            `${p.id}/${mode}: ${fgName} on ${bgName} now clears AA at ${r.toFixed(2)}:1 — delete its GRANDFATHERED entry`);
          ok(Math.abs(r - waived.ratio) < 0.01,
            `${p.id}/${mode}: ${fgName} on ${bgName} moved to ${r.toFixed(2)}:1, recorded as ${waived.ratio}:1`);
        } else {
          ok(r >= AA, `${p.id}/${mode}: ${fgName} on ${bgName} is ${r.toFixed(2)}:1, below AA ${AA}:1`);
        }
      }
    }
  }
}

/* ---- 3. the dropdown and the generator agree on which palettes exist ---- */
{
  const constants = fs.readFileSync(path.join(root, 'src', 'constants.js'), 'utf8');
  const block = /const PALETTE_PRESETS = \{([\s\S]*?)\n\};/.exec(constants);
  ok(block, 'PALETTE_PRESETS is declared in src/constants.js');
  const declared = [...block[1].matchAll(/^\s*'?([a-z0-9-]+)'?:/gm)].map(m => m[1]);
  eq(declared.sort(), PRESETS.map(p => p.id).sort(),
    'settings dropdown offers exactly the palettes the generator emits');
  ok(declared.includes(DEFAULT_PRESET), 'the default palette is one the dropdown offers');
}

/* ---- 4. overrides stay a last resort ---- */
{
  /* One per mode is the budget. Vault Green needs exactly one — light mode's
     --color-primary-light, a hand-picked tint — and nothing has yet needed a
     second. Raising this cap is a decision about the seed set, which is why it
     has to be made here rather than by quietly adding another override. */
  const CAP = 1;
  for (const p of PRESETS) {
    for (const key of ['lightOverrides', 'darkOverrides']) {
      const n = Object.keys(p[key] || {}).length;
      ok(n <= CAP, `${p.id}.${key} has ${n} overrides, cap is ${CAP} — fix the seed set, not the override list`);
    }
  }
}

/* ---- 5. the ambient glow follows the palette ----

   The washes behind the app and the splash gate were painted in literal
   emerald, mint and gold, in BOTH themes, so every palette but Vault Green
   drew its own colours over a green background. They are tokens now, and these
   assertions are what stop a literal creeping back: the first would otherwise
   pass silently forever the moment someone pasted an rgba() into a new
   gradient, and the last catches the subtler failure where the tokens exist but
   every palette resolves them to the same colour. */
{
  const BRAND_LITERAL = /rgba\(\s*(110,\s*231,\s*183|16,\s*185,\s*129|251,\s*191,\s*36|13,\s*148,\s*136)/g;
  /* The palette blocks at the top legitimately state brand colours — that is
     their job. Everything after them must reach for a token instead. */
  const afterPalette = baseCss.slice(baseCss.indexOf('.budget-app-root.bud-dark'));
  const body = afterPalette.slice(afterPalette.indexOf('}'));
  eq(body.match(BRAND_LITERAL) || [], [],
    'no hardcoded brand colour outside the palette blocks — use a --glow-*-rgb token');

  const GLOW = ['--glow-accent-rgb', '--glow-primary-rgb', '--glow-gold-rgb', '--glow-deep-rgb'];
  const hand = tokensOf(baseCss, '.budget-app-root');
  for (const t of GLOW) ok(t in hand, `the base palette declares ${t}`);

  const generated = fs.readFileSync(path.join(root, 'src', 'styles-presets.css'), 'utf8');
  const blocks = PRESETS.map(p => {
    const block = tokensOf(generated, `.budget-app-root.bud-palette-${p.id}`);
    for (const t of GLOW) ok(t in block, `${p.id} emits ${t}`);
    return block;
  });
  /* Checked per token rather than on one of them. All three washes started life
     as the same literals, and the gold one stayed shared across every palette
     for a while after the other two were made to vary — an easy thing to miss,
     because two of the three moving looks like the feature works. */
  for (const t of GLOW) {
    const values = blocks.map(b => b[t]);
    eq(new Set(values).size, PRESETS.length,
      `${t} differs across all ${PRESETS.length} palettes — a shared value means that wash ignores the palette`);
  }
  const vg = blocks[PRESETS.findIndex(p => p.id === 'vault-green')];
  eq(vg['--glow-primary-rgb'], '16,185,129', 'and Vault Green still glows the emerald it always did');
  eq(vg['--glow-gold-rgb'], '251,191,36', 'in the gold it always did');
}

/* ---- 6. the generated stylesheet on disk is current ----
   build.sh regenerates it, but a stale file committed by hand would ship a
   palette that no longer matches its seeds. */
{
  const { generate } = require('../scripts/gen-presets.cjs');
  const onDisk = fs.readFileSync(path.join(root, 'src', 'styles-presets.css'), 'utf8');
  eq(onDisk, generate(), 'src/styles-presets.css matches its seeds — run ./build.sh and commit');
}

/* ---- 7. the pairs invariant 2 cannot see ----

   Invariant 2 gates text on a surface, straight from the seeds. The pairs here
   are not that, so each is read from the RULE that paints it, resolved against
   every palette's tokens, and measured with the same contrast() the audit
   used. A gate that restated the values would stay green while the rule
   drifted; this one fails the moment the rule stops saying what was measured.

   Each part also lists the rules allowed to touch its pair. A later, more
   specific rule that repainted it would otherwise pass straight under a gate
   that only reads the base rule — which is how a page lane came to hold the
   Transactions filters at a weaker edge than the one gated below. */
{
  const { readRules, locate } = require('./helpers/css-sources.cjs');
  const rules = readRules();
  const where = r => locate(r.line);

  const hasClass = (sel, cls) => new RegExp(String.raw`\.${cls}(?![\w-])`).test(sel);
  /* The one rule that sets `prop` on exactly this selector. More than one is
     itself the failure: the gate would be measuring a value the cascade may
     not be using. */
  const only = (selector, prop) => {
    const hits = rules.filter(r => r.selectors.includes(selector) && r.decls.some(d => d.prop === prop));
    eq(hits.length, 1,
      `exactly one rule sets ${prop} on "${selector}" (found ${hits.map(where).join(', ') || 'none'})`);
    return hits[0].decls.filter(d => d.prop === prop).pop().value;
  };
  /* Every "selector { prop }" in the whole sheet where the selector carries one
     of these classes and the rule sets a property the pattern matches. */
  const touching = (classes, props) => {
    const out = [];
    for (const r of rules) {
      for (const sel of r.selectors) {
        if (!classes.some(c => hasClass(sel, c))) continue;
        for (const d of r.decls) if (props.test(d.prop)) out.push(`${sel} { ${d.prop} }`);
      }
    }
    return out.sort();
  };

  /* What a rule inside the root resolves a token to, per palette and mode, in
     cascade order: the hand-written light block, then (dark only) the
     hand-written dark block, then the palette's own blocks, which out-rank
     both. The palette's light block applies in dark too — its selector matches
     the root with or without .bud-dark — which is how the tokens a palette
     sets once reach dark mode at all. */
  const baseLight = tokensOf(baseCss, '.budget-app-root');
  const baseDark = tokensOf(baseCss, '.budget-app-root.bud-dark');
  const tokensFor = (p, mode) => {
    const light = derive(p.light, 'light', p.lightOverrides || {});
    return mode === 'light'
      ? { ...baseLight, ...light }
      : { ...baseLight, ...baseDark, ...light, ...derive(p.dark, 'dark', p.darkOverrides || {}) };
  };
  const resolve = (value, tokens) => {
    let v = String(value).trim();
    for (let hop = 0; hop < 4; hop++) {
      const m = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(v);
      if (!m) return v;
      ok(m[1] in tokens, `${m[1]} is defined where "${value}" reads it`);
      v = String(tokens[m[1]]).trim();
    }
    return v;
  };

  /* contrast() takes opaque hex only, on purpose (see scripts/palette.cjs). A
     translucent colour is flattened here onto the surface the stylesheet says
     is behind it, and the part that does so asserts that surface first. */
  const toHex = c => '#' + c.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  const over = (fg, bgHex) => {
    const [r, g, b, a] = norm(fg);
    const under = rgb(bgHex);
    return toHex([r, g, b].map((c, i) => under[i] + a * (c - under[i])));
  };
  const each = fn => { for (const p of PRESETS) for (const mode of ['light', 'dark']) fn(p, mode, tokensFor(p, mode)); };

  /* -- 7a. the boundary of a form control ---------------------------------

     WCAG 1.4.11: the edge that tells you where a control is needs 3:1 against
     what is next to it. A field here is filled with --surface and sits on a
     card or straight on the page, so the edge is measured against both. It was
     the card hairline, --border-color: 1.20:1 light and 1.24:1 dark against
     the fill, on all four palettes, and 1.06:1 against the light page.

     The fix is a token of its own, --control-border, so that the hairline
     stays a hairline everywhere else: the same ink the hairlines are drawn in,
     at an alpha that clears 3:1 once flattened onto the field's own fill. */
  {
    const NON_TEXT = 3;
    const CONTROLS = ['.budget-app-root .form-control', '.budget-app-root .form-select', '.budget-app-root .category-select'];
    for (const sel of CONTROLS) {
      eq(only(sel, 'border'), '1px solid var(--control-border)', `"${sel}" draws its edge in --control-border`);
      /* The border is painted over the control's own background (the default
         background-clip is border-box), so this is what it is flattened onto. */
      eq(only(sel, 'background-color'), 'var(--surface)', `"${sel}" is filled with --surface, which the edge is flattened onto`);
    }

    /* THE SWEEP: every other rule under the root that draws an edge on a field,
       measured the same way — whether it names one of the three classes or
       reaches a field as a bare `input`, `select` or `textarea`, and whichever
       selectors it happens to share its declaration with. The base rules above
       are only where a field's edge STARTS; a later rule on a page can repaint
       it, and the first draft of this gate matched on the class alone and so
       saw one selector of a four-selector rule (a review caught it: the
       Transactions search box and the Note field on every row are
       `.form-control` in the markup and `#txSearch` / `td input` in the CSS).

       Only rules scoped under .budget-app-root: the dialogs mounted on
       document.body are Obsidian's furniture and follow Obsidian's theme, on
       purpose (tests/css-host-cascade.test.cjs says the same of its check 1).

       A rule that draws no edge (`border: 0`, the checkbox reset, the book
       switcher's select inside its pill) has nothing to measure and is skipped.
       Everything else must clear 3:1 on every palette, or be listed below. */
    const FIELD_CLASSES = ['form-control', 'form-control-sm', 'form-select', 'form-select-sm', 'category-select'];
    const isField = sel => /^\.budget-app-root\b/.test(sel)
      && (FIELD_CLASSES.some(c => hasClass(sel, c)) || /(^|[\s>+~])(input|select|textarea)(?![\w-])/.test(sel));
    const EDGE = /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/;
    /* The colour a border declaration paints, as something over() can flatten:
       null when it paints nothing. Reads the three spellings the sheet uses —
       a token, a literal, and color-mix(<token> N%, transparent), which is that
       token at alpha N. Anything else stops the gate rather than being guessed. */
    const edgeColour = (value, t) => {
      const v = value.trim();
      if (/^(0|none|transparent)$/.test(v) || /^0(px)?\s/.test(v)) return null;
      const c = v.replace(/^[\d.]+px\s+(solid|dashed|dotted)\s+/, '');
      const mix = /^color-mix\(in srgb,\s*var\((--[a-z0-9-]+)\)\s+([\d.]+)%,\s*transparent\)$/.exec(c);
      if (mix) {
        const [r, g, b] = norm(resolve(`var(${mix[1]})`, t));
        return `rgba(${r},${g},${b},${Number(mix[2]) / 100})`;
      }
      const flat = resolve(c, t);
      ok(Array.isArray(norm(flat)), `the gate can read this edge colour: "${value}"`);
      return flat;
    };

    /* STILL UNDER 3:1, and not this gate's to fix. Both rules belonged to
       other lanes in the audit-fix round this gate was written in (2026-11-11),
       so they are recorded here — with what they measure on vault-green light,
       against the field's own fill — instead of edited or left unseen:

         - The Transactions page's "firmer edge": --text-primary at 30%, written
           when a field's edge was the hairline and 30% was the firmer of the
           two. It carries an id, so nothing in the base rules can out-rank it,
           and wherever color-mix() parses it holds the filter selects, the
           search box and the Note field on every row at 1.96:1 — firmer than
           the old hairline, under 3:1, and now WEAKER than every other field
           in the app. (Its .btn-ghost selector is a button, not a field; it
           rides along because it shares the declaration.)
         - The Accounts search box, which is not a .form-control and still
           draws the --border-color hairline: 1.20:1.

       An entry cannot rot. It fails when its rule is gone or renamed, and it
       fails when its rule is brought up to 3:1 — either way the fix is to
       delete the entry — and a rule that is under 3:1 and NOT listed fails
       for that. */
    const STILL_FAILING = [
      '.budget-app-root #view-transactions .tx-filters .form-select-sm:not(:focus), '
        + '.budget-app-root #view-transactions .tx-filters #txSearch:not(:focus), '
        + '.budget-app-root #view-transactions .tx-actions .btn-ghost:not(:hover), '
        + '.budget-app-root #view-transactions .table tbody td:nth-child(7) input:not(:focus)',
      '.budget-app-root .acct-search input',
    ];
    const swept = new Map();
    for (const r of rules) {
      if (!r.selectors.some(isField)) continue;
      for (const d of r.decls.filter(x => EDGE.test(x.prop))) {
        let worst = Infinity;
        each((p, mode, t) => {
          const colour = edgeColour(d.value, t);
          if (colour === null) return;
          const edge = over(colour, p[mode].surface);
          worst = Math.min(worst, contrast(edge, p[mode].surface), contrast(edge, p[mode].bodyBg));
        });
        if (worst === Infinity) continue;   // draws no edge
        const key = r.selectors.join(', ');
        if (!swept.has(key) || worst < swept.get(key).worst) swept.set(key, { worst, at: where(r) });
      }
    }
    ok(swept.size >= CONTROLS.length, 'the sweep found the field rules it exists to measure');
    for (const [key, { worst, at }] of swept) {
      if (STILL_FAILING.includes(key)) {
        ok(worst < NON_TEXT, `${at}: "${key}" now clears ${NON_TEXT}:1 (worst ${worst.toFixed(2)}:1) — delete its STILL_FAILING entry`);
      } else {
        ok(worst >= NON_TEXT, `${at}: "${key}" draws a field's edge at ${worst.toFixed(2)}:1 on its worst palette, below ${NON_TEXT}:1`);
      }
    }
    for (const key of STILL_FAILING) ok(swept.has(key), `STILL_FAILING lists a rule that no longer exists — delete the entry: "${key}"`);

    each((p, mode, t) => {
      const s = p[mode];
      eq(norm(t['--surface']), norm(s.surface), `${p.id}/${mode}: --surface is the surface seed`);
      const edge = over(resolve('var(--control-border)', t), s.surface);
      for (const [bg, name] of [[s.surface, 'surface'], [s.bodyBg, 'bodyBg']]) {
        const r = contrast(edge, bg);
        ok(r >= NON_TEXT, `${p.id}/${mode}: form-control edge ${edge} on ${name} is ${r.toFixed(2)}:1, below ${NON_TEXT}:1`);
      }
      /* And the hairline did not move to pay for it: the stronger edge is a
         second token, not a darker --border-color. */
      ok(norm(t['--control-border'])[3] > norm(t['--border-color'])[3] * 3,
        `${p.id}/${mode}: --control-border is a separate, stronger token than the --border-color hairline`);
    });
  }

  /* -- 7b. the label on a gradient button ---------------------------------

     .btn-gradient is 13.6px bold, which is not "large text", so it needs the
     full 4.5:1 — and against the LIGHTEST point of the gradient, not its
     average, because a label spans the button. White on the accent seed was
     3.74:1 on vault-green and 3.68:1 on ocean.

     Measured as painted. The stops are read from the rule; the gradient is
     sampled across the part of it the button actually shows (a stop placed
     outside 0-100% is legal CSS, and is how the light button now starts
     part-way into the same accent-to-primary run); and the hover state is
     measured too, because `filter: brightness()` lightens the fill under a
     label that is already white and cannot follow it. */
  {
    const AA = 4.5;
    const BTN = '.budget-app-root .btn-gradient';
    const DARK = '.budget-app-root.bud-dark .btn-gradient';

    eq(touching(['btn-gradient'], /^(background(-image|-color)?|color|filter)$/), [
      `${BTN} { background }`,
      `${BTN} { color }`,
      `${BTN}:disabled { filter }`,
      `${BTN}:hover { filter }`,
      `${DARK} { background }`,
      `${DARK} { color }`,
    ].sort(), 'nothing else paints a gradient button\'s fill, label or hover — a new rule has to be measured here');

    /* linear-gradient(<angle>, var(--a) [n%], var(--b) [n%]) -> two stops. */
    const stopsOf = value => {
      const m = /^linear-gradient\(\s*[\d.]+deg\s*,\s*var\((--[a-z0-9-]+)\)\s*(-?[\d.]+%)?\s*,\s*var\((--[a-z0-9-]+)\)\s*(-?[\d.]+%)?\s*\)$/.exec(value);
      ok(m, `the gate can read the button's gradient: ${value}`);
      return [{ token: m[1], at: m[2] ? parseFloat(m[2]) / 100 : 0 }, { token: m[3], at: m[4] ? parseFloat(m[4]) / 100 : 1 }];
    };
    const hover = /^brightness\(([\d.]+)\)$/.exec(only(`${BTN}:hover`, 'filter'));
    ok(hover, 'the hover state is a brightness() the gate can apply');
    /* brightness() scales each sRGB channel and clamps — the whole element,
       label included, which is why a white label gains nothing from it. */
    const lift = hex => toHex(rgb(hex).map(c => Math.min(255, c * Number(hover[1]))));

    const fill = { light: stopsOf(only(BTN, 'background')), dark: stopsOf(only(DARK, 'background')) };
    const label = { light: only(BTN, 'color'), dark: only(DARK, 'color') };

    each((p, mode, t) => {
      const [a, b] = fill[mode].map(s => ({ at: s.at, c: rgb(resolve(`var(${s.token})`, t)) }));
      ok(b.at > a.at, `${p.id}/${mode}: the gradient's stops are in order`);
      const ink = toHex(norm(resolve(label[mode], t)));
      let rest = Infinity, hovered = Infinity;
      /* 0..1 is the whole of what a corner-to-corner gradient shows: its line
         is sized so that 0% and 100% land exactly on the two corners. */
      for (let i = 0; i <= 200; i++) {
        const k = Math.min(1, Math.max(0, (i / 200 - a.at) / (b.at - a.at)));
        const here = toHex(a.c.map((c, j) => c + k * (b.c[j] - c)));
        rest = Math.min(rest, contrast(ink, here));
        hovered = Math.min(hovered, contrast(lift(ink), lift(here)));
      }
      ok(rest >= AA, `${p.id}/${mode}: gradient-button label ${ink} is ${rest.toFixed(2)}:1 at the weakest point of its fill, below AA ${AA}:1`);
      ok(hovered >= AA, `${p.id}/${mode}: gradient-button label is ${hovered.toFixed(2)}:1 under the hover brightness(${hover[1]}), below AA ${AA}:1`);
    });
  }

  /* -- 7c. the info ink ---------------------------------------------------

     The pressed "fixed bill" toggle on the Budget page was painted in
     --color-info, #0ea5e9 — a FILL, like the amber and the rose, and 2.77:1 on
     a white card. It reads --color-info-ink now, the same move as
     --color-warning-ink and --color-danger-ink: a darker ink in light mode,
     pointed straight back at the fill in dark, where the fill already measures
     6.26:1 or better on every palette's card.

     Info is one of the colours a palette may NOT change (scripts/presets.cjs),
     so the ink is one value per mode — but the surfaces under it are seeds, so
     it is still measured against every palette's card and page. Held to the
     text ratio rather than the 3:1 a glyph is allowed, because the toggle is
     only the first thing to use it and an ink token gets reached for by text. */
  {
    const AA = 4.5;
    const FIXED = ['.budget-app-root .bud-fixed-on', '.budget-app-root .bud-table .bud-act.bud-fixed-on'];
    for (const sel of FIXED) eq(only(sel, 'color'), 'var(--color-info-ink)', `"${sel}" is painted in the info ink, not the info fill`);
    eq(touching(['bud-fixed-on'], /^color$/), FIXED.map(s => `${s} { color }`).sort(),
      'nothing else colours the pressed fixed-bill toggle');

    each((p, mode, t) => {
      const s = p[mode];
      const ink = toHex(norm(resolve('var(--color-info-ink)', t)));
      for (const [bg, name] of [[s.surface, 'surface'], [s.bodyBg, 'bodyBg']]) {
        const r = contrast(ink, bg);
        ok(r >= AA, `${p.id}/${mode}: info ink ${ink} on ${name} is ${r.toFixed(2)}:1, below AA ${AA}:1`);
      }
    });
  }
}

console.log(`PASS — palette generator: reproduces Vault Green, AA in ${PRESETS.length * 2} blocks, dropdown parity, form-control edge / gradient-button label / info ink gated per palette (${checks} checks).`);
