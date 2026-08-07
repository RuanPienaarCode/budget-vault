'use strict';
/* Donut slice colours — the guarantee that two wedges are never the same.

   Category colours are the user's, one per Categories/<name>.md, and nothing
   has ever stopped two categories carrying the same one. In practice they do:
   the vault this was built against had 15 categories on #dc3545 and 10 on
   #3b82f6, so the dashboard's "Where it went" donut drew several wedges of the
   same red and several of the same blue and could not be read at all.

   distinctColors() resolves that at render time. What it must hold to:

     1. Nothing drawn together is closer than SLICE_MIN_DISTANCE. That is the
        whole point, and it has to survive the pathological input (every
        category the same colour), not just the typical one.
     2. A colour someone chose deliberately is KEPT, in the original string, so
        long as it isn't a duplicate. The fix is not allowed to quietly become
        "the plugin picks all the colours now".
     3. The BIGGEST wedge is the one that keeps its colour. First claim wins,
        and the caller sorts biggest-first — sorted the other way, the largest
        wedge on the chart is the one overruled, which is the most visible
        possible place to do it.
     4. The palette can always satisfy its own rule. If two palette entries
        were closer than the threshold, the second would be rejected on every
        chart that reached it and the fallback would start repeating colours —
        a regression that only shows up on a donut with enough slices.

     5. It holds for EVERY palette the plugin ships, not just the default one.
        The "Other" wedge is drawn in `--ink-faint`, which each colour preset
        redefines, and that colour is RESERVED — nothing may be assigned near
        it. So each preset shrinks the usable palette by a different amount,
        and a preset whose grey happens to sit near several entries could leave
        too few to separate eight wedges. Nobody would see that coming from the
        preset's own definition, which looks like an ordinary muted grey.

   Bare node: chart.js pulls in util.js, which imports `obsidian`. */

const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const {
  SLICE_PALETTE, parseColor, colorDistance, distinctColors,
} = require('../src/chart');

let checks = 0, fail = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { fail++; console.log(`  FAIL ${msg}`); }
};

const MIN = 130;                                   // SLICE_MIN_DISTANCE
const GREY = '#5f6779';                            // --ink-faint, the "Other" wedge

/* Every pair among the drawn set, plus every one against the reserved grey. */
function worstSeparation(colors, reserved = [GREY]) {
  const rgb = colors.map(parseColor);
  ok(rgb.every(Boolean), `every resolved colour parses: ${colors.join(' ')}`);
  let worst = Infinity;
  for (let i = 0; i < rgb.length; i++) {
    for (let j = i + 1; j < rgb.length; j++) worst = Math.min(worst, colorDistance(rgb[i], rgb[j]));
    for (const r of reserved) worst = Math.min(worst, colorDistance(rgb[i], parseColor(r)));
  }
  return worst;
}

/* ------------------------------ 1. parsing ------------------------------ */
/* Frontmatter is hand-written hex; a colour read back through getComputedStyle
   arrives as rgb(). Both have to parse or a legitimate colour is treated as a
   clash and taken away from the category that asked for it. */
ok(String(parseColor('#abc')) === '170,187,204', 'three-digit hex expands');
ok(String(parseColor('#3B82F6')) === '59,130,246', 'six-digit hex parses, case-insensitively');
ok(String(parseColor('  #3b82f6  ')) === '59,130,246', 'surrounding whitespace tolerated');
ok(String(parseColor('rgb(59, 130, 246)')) === '59,130,246', 'rgb() parses');
ok(String(parseColor('rgba(59 130 246 / 0.5)')) === '59,130,246', 'rgba() with slash syntax parses');
ok(parseColor('rebeccapurple') === null, 'a CSS keyword is left alone rather than guessed at');
ok(parseColor('#12345') === null, 'a malformed hex is not half-parsed');
ok(parseColor('') === null && parseColor(undefined) === null, 'empty and undefined are null');

/* ---------------------------- 2. the metric ----------------------------- */
ok(colorDistance([0, 0, 0], [0, 0, 0]) === 0, 'a colour is zero distance from itself');
/* The pair that motivated using redmean over plain RGB euclidean: on screen
   these are the same blue, and both were live in the vault at once. */
ok(colorDistance(parseColor('#3b82f6'), parseColor('#0d6efd')) < MIN,
  '#3b82f6 and #0d6efd are correctly judged the same blue');
ok(colorDistance(parseColor('#6f42c1'), parseColor('#8b5cf6')) < MIN,
  '#6f42c1 and #8b5cf6 are correctly judged the same purple');
/* …without becoming so blunt that genuinely different hues get merged. */
ok(colorDistance(parseColor('#dc3545'), parseColor('#fd7e14')) >= MIN,
  'red and orange stay distinct');

/* --------------------------- 3. the palette ----------------------------- */
/* Point 4 above. If this fails the fallback silently starts repeating. */
const palWorst = worstSeparation(SLICE_PALETTE, []);
ok(palWorst >= MIN,
  `palette entries are mutually distinct (worst ${palWorst.toFixed(0)}, need >= ${MIN})`);
ok(worstSeparation(SLICE_PALETTE, [GREY]) >= MIN,
  'no palette entry can be mistaken for the muted "Other" wedge');
/* Red is load-bearing elsewhere — "over budget" on the trend chart and in the
   budget table. A category wearing it would have the dashboard signalling
   something it does not mean. */
for (const red of ['#f43f5e', '#dc3545', '#ef4444', '#e11d48']) {
  ok(!SLICE_PALETTE.some(p => colorDistance(parseColor(p), parseColor(red)) < MIN),
    `palette reserves red: nothing sits near ${red}`);
}

/* --------------------------- 4. de-colliding ---------------------------- */
const scenarios = {
  'the real vault mix (two reds, two blues, two purples)':
    ['#dc3545', '#3b82f6', '#dc3545', '#0d6efd', '#eab308', '#3b82f6', '#6f42c1', '#8B5CF6'],
  'every top spender identical': Array(8).fill('#dc3545'),
  'every category still on the stamped #888888 default': Array(8).fill('#888888'),
  'the loader fallback #888': Array(8).fill('#888'),
  'eight deliberately distinct colours':
    ['#dc3545', '#0d6efd', '#eab308', '#28a745', '#6f42c1', '#17a2b8', '#fd7e14', '#000000'],
  'colours that do not parse at all': ['rebeccapurple', 'tomato', '', 'not a colour'],
  'a full palette-length run': Array(SLICE_PALETTE.length).fill('#888888'),
};
for (const [name, input] of Object.entries(scenarios)) {
  const got = distinctColors(input, { reserved: [GREY] });
  ok(got.length === input.length, `${name}: one colour out per colour in`);
  const worst = worstSeparation(got);
  ok(worst >= MIN, `${name}: worst separation ${worst.toFixed(0)} >= ${MIN}`);
}

/* Point 2: deliberate, already-distinct colours are kept — and kept verbatim,
   so a hand-written #3B82F6 is not rewritten to lowercase under the reader. */
const deliberate = ['#dc3545', '#0d6efd', '#28a745', '#6f42c1'];
ok(String(distinctColors(deliberate, { reserved: [GREY] })) === String(deliberate),
  'four distinct hand-set colours all survive untouched');
ok(distinctColors(['#3B82F6'], { reserved: [GREY] })[0] === '#3B82F6',
  'a kept colour comes back in its original casing');

/* Point 3: first claim wins, so the caller's biggest-first order decides who
   keeps the shared colour. */
const dupes = distinctColors(['#dc3545', '#dc3545', '#dc3545'], { reserved: [GREY] });
ok(dupes[0] === '#dc3545', 'the first (largest) wedge keeps the contested colour');
ok(dupes[1] !== '#dc3545' && dupes[2] !== '#dc3545', 'the later duplicates are moved off it');

/* The placeholder is never a "choice", so it is replaced even when it is the
   only slice — otherwise a one-category donut draws a wedge the same grey as
   the Other bucket it does not have. */
ok(distinctColors(['#888888'], { reserved: [GREY] })[0] !== '#888888',
  'the stamped default is replaced even with nothing to collide with');

/* The reserved colour is never handed out, and never itself reassigned. */
ok(!distinctColors(Array(6).fill('#888888'), { reserved: [GREY] }).includes(GREY),
  'the reserved "Other" grey is never assigned to a category');

/* An empty period draws no donut at all, but the helper must not throw on the
   way to finding that out. */
ok(distinctColors([], { reserved: [GREY] }).length === 0, 'an empty list is an empty list');

/* ------------------- 5. every palette the plugin ships ------------------- */
/* GREY above is the default theme's --ink-faint, hard-coded so the rest of
   this file stays readable. But the plugin ships colour presets that each
   redefine it, so the real question is whether the donut survives ALL of them.
   Read out of the stylesheets rather than listed here: a copy would drift the
   first time a preset's grey was nudged, and drift silently. */
const SRC = path.join(__dirname, '..', 'src');
const inkFaints = file => {
  const at = path.join(SRC, file);
  if (!fs.existsSync(at)) return null;
  return [...fs.readFileSync(at, 'utf8').matchAll(/--ink-faint:\s*(#[0-9a-fA-F]{3,6})/g)]
    .map(m => ({ grey: m[1], file }));
};

const handWritten = inkFaints('styles.css');
ok(handWritten && handWritten.length > 0,
  'src/styles.css still defines --ink-faint (the "Other" wedge has a colour at all)');

/* The presets half is BUILD OUTPUT — scripts/gen-presets.cjs writes it and
   build.sh runs that before these tests, so in the build it is always there.
   Tie the two together rather than skipping quietly: if the generator exists
   the generated file must too, otherwise this guard would drop from ten
   palettes to two without anything going red. */
const generated = inkFaints('styles-presets.css');
if (fs.existsSync(path.join(__dirname, '..', 'scripts', 'gen-presets.cjs'))) {
  ok(generated !== null,
    'scripts/gen-presets.cjs exists, so src/styles-presets.css must too — run ./build.sh');
  ok(generated === null || generated.length > 0,
    'the generated presets define at least one --ink-faint');
}

const palettes = [...(handWritten || []), ...(generated || [])];
ok(palettes.length > 0, 'found at least one palette grey to test against');

/* Worst case per palette: every top spender on the stamped default, so nothing
   keeps its own colour and all eight come out of the fallback — the state in
   which a shrunken palette runs out. */
for (const { grey, file } of palettes) {
  const got = distinctColors(Array(8).fill('#888888'), { reserved: [grey] });
  const uniq = new Set(got.map(c => c.toLowerCase())).size;
  const worst = worstSeparation(got, [grey]);
  ok(uniq === 8, `${file} ${grey}: eight wedges get eight different colours (got ${uniq})`);
  ok(worst >= MIN, `${file} ${grey}: worst separation ${worst.toFixed(0)} >= ${MIN}`);
  ok(!got.some(c => c.toLowerCase() === grey.toLowerCase()),
    `${file} ${grey}: the reserved "Other" grey is never given to a category`);
}

if (fail) {
  console.log(`\nFAIL — ${fail} of ${checks} slice-colour checks failed.`);
  process.exit(1);
}
console.log(`PASS — donut wedges are always tellable apart, and deliberate colours survive (${checks} assertions).`);
