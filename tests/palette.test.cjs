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
const baseCss = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

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

  /* One grandfathered pair, recorded rather than hidden.

     vault-green's DARK --text-light (#6f7799) measures 4.07:1 on the dark card
     (--surface #12162a). That is the palette as it has shipped since the theme
     was written, and it predates this generator — the "AA (5.0:1)" note in
     src/styles.css is the LIGHT-mode figure, measured against --body-bg; the
     dark value was never annotated with a ratio, and on the darker page behind
     the card it does clear AA (5.05:1). It is only the card that falls short.

     Left as-is rather than nudged, because changing it would change the look of
     the palette every existing user is on, which is exactly what the
     reproduction test above exists to prevent — that is a product decision, not
     a thing a test should make silently. The three newer palettes are held to
     the full gate: their dark --text-light values were chosen to clear 4.5:1 on
     both the card and the page.

     Fixing vault-green means editing the seed AND src/styles.css together, then
     deleting this entry — the assertion below fails if the pair is ever brought
     up to AA and the exemption is left behind, so it cannot rot. */
  const GRANDFATHERED = [{ id: 'vault-green', mode: 'dark', fg: 'textLight', bg: 'surface', ratio: 4.07 }];

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

console.log(`PASS — palette generator: reproduces Vault Green, AA in ${PRESETS.length * 2} blocks, dropdown parity (${checks} checks).`);
