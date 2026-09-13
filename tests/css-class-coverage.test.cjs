'use strict';
/* EVERY CLASS A VIEW EMITS HAS A RULE IN src/styles.css.

   WHY THIS EXISTS. 1.45.0 added a two-line collapsed row to the Plan page —
   `.env-sum-main` wrapping the bucket name over a new `.env-sum-rem` — and the
   CSS for it was written into the repo-root `styles.css`. That file is BUILD
   OUTPUT: esbuild.config.mjs assembles it from src/styles.css + the generated
   src/styles-presets.css on every build, so the very build that produced the
   shipped bundle silently discarded the stylesheet half of the change. The
   plugin deployed, byte-verified, 198 suites green — and the page rendered the
   new markup with none of its styling.

   The visible symptom was two screens from the cause. `.env-sum` is a
   <button>, and a button centres its content; that had never shown because
   `.env-sum-name` carried `flex: 1` and filled the row. The moment that flex
   moved to a wrapper with no rules, every bucket row collapsed to the middle
   of the card and the name ran into the remainder. Nothing in the repo could
   have caught it: css-structure.test.cjs asks whether the stylesheet PARSES,
   never whether it covers what the views actually render.

   So: harvest every class name the source emits, and require a rule for it.
   The check reads src/styles.css — the hand-written source — deliberately, not
   the assembled root file. Had it read the build output it would have passed on
   the broken build, since the root file was where the orphaned CSS was sitting.

   NOT a lint for unused CSS. The reverse direction (a rule no view uses) is
   ordinary and fine: rules exist for markup in shell.js's static HTML, for
   states set by Obsidian, and for selectors built from attributes.

     node tests/css-class-coverage.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* ---- 1. what the stylesheet defines ------------------------------------ */

/* Both halves of the build input: the hand-written sheet and the generated
   palette blocks, because a class may legitimately be defined in either. */
const css = read('src/styles.css') + read('src/styles-presets.css');
const defined = new Set();
for (const m of css.matchAll(/\.([A-Za-z][\w-]*)/g)) defined.add(m[1]);
ok(defined.size > 400, `the stylesheet should define hundreds of classes, found ${defined.size}`);
ok(defined.has('env-sum-main'), 'sanity: the class whose absence prompted this suite is now defined');

/* ---- 2. what the source emits ------------------------------------------ */

/* A template literal's static chunks are whole class names only in the MIDDLE.
   `pot-fig-2 num ${cls}` ends in an interpolation, and `env-${kind}` begins one
   — a token touching a ${} is a fragment of a name nobody wrote, and treating
   it as a class would have this suite demanding rules for "env-" and "tone-".
   Dropping exactly the touching token is what keeps the signal clean enough to
   be a gate rather than an allowlist that swallows everything. */
function tokensFromTemplate(body) {
  const out = [];
  const chunks = body.split(/\$\{[^}]*\}/g);
  chunks.forEach((chunk, i) => {
    const openLeft = i > 0;
    const openRight = i < chunks.length - 1;
    const toks = chunk.split(/\s+/);
    toks.forEach((t, j) => {
      if (!t) return;
      const touchesLeft = openLeft && j === 0 && !/^\s/.test(chunk);
      const touchesRight = openRight && j === toks.length - 1 && !/\s$/.test(chunk);
      if (!touchesLeft && !touchesRight) out.push(t);
    });
  });
  return out;
}

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const f = path.join(d, e.name);
  return e.isDirectory() ? walk(f) : (f.endsWith('.js') ? [f] : []);
});

const used = new Map();                 // class -> Set of files that emit it
for (const file of walk(path.join(root, 'src'))) {
  if (file.includes(`${path.sep}lang${path.sep}`)) continue;   // translation tables hold prose
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const add = toks => { for (const t of toks) {
    if (!t || !/^[A-Za-z][\w-]*$/.test(t)) continue;
    if (!used.has(t)) used.set(t, new Set());
    used.get(t).add(rel);
  } };
  for (const m of src.matchAll(/\bclass\s*:\s*'([^']*)'/g)) add(m[1].split(/\s+/));
  for (const m of src.matchAll(/\bclass\s*:\s*"([^"]*)"/g)) add(m[1].split(/\s+/));
  for (const m of src.matchAll(/\bclass\s*:\s*`([^`]*)`/g)) add(tokensFromTemplate(m[1]));
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']*)'/g)) add(m[1].split(/\s+/));
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*"([^"]*)"/g)) add(m[1].split(/\s+/));
}
ok(used.size > 300, `the views should emit hundreds of classes, found ${used.size}`);
ok(used.has('env-sum-rem'), 'sanity: the harvester sees a class added in the change that prompted this suite');
ok(!used.has('env-') && !used.has('tone-') && !used.has('status-'),
  'interpolation fragments are not mistaken for class names');

/* ---- 3. the ones that carry no rule ------------------------------------ */

/* PRE-EXISTING at 1.45.0, when this suite was written: twelve classes that are
   emitted and styled nowhere. Each is harmless on its own — a grid cell that
   inherits everything it needs, or a hook left behind when a rule was deleted —
   and fixing twelve other views was not part of the change that added this
   guard. They are listed so the gate can be strict about NEW ones from here.

   The list is checked BOTH WAYS below, so it cannot rot: an entry that gains a
   rule, or stops being emitted, fails this suite and must be deleted. */
const KNOWN_UNSTYLED = [
  'acct-drawer-f', 'acct-fact', 'acct-owners', 'acct-ring',
  'assets-hero-largest', 'bud-total', 'budget-reslice-list',
  'debt-card-overlap', 'num-sm', 'sav-banner-warn',
  'score-empty', 'score-gap-go',
];

const missing = [...used.keys()].filter(c => !defined.has(c)).sort();
const unexpected = missing.filter(c => !KNOWN_UNSTYLED.includes(c));

eq(unexpected, [],
  'these classes are rendered by a view but have no rule in src/styles.css.\n'
  + '    If you meant to style them, check you edited src/styles.css and NOT the\n'
  + '    repo-root styles.css, which is build output and is overwritten on every\n'
  + '    build:\n'
  + unexpected.map(c => `      .${c}  <- ${[...used.get(c)].join(', ')}`).join('\n'));

/* The list cannot rot in either direction. */
for (const c of KNOWN_UNSTYLED) {
  ok(used.has(c),
    `KNOWN_UNSTYLED lists '${c}' but no view emits it any more — delete the entry`);
  ok(!defined.has(c),
    `KNOWN_UNSTYLED lists '${c}' but src/styles.css now has a rule for it — delete the entry`);
}
eq([...KNOWN_UNSTYLED].sort(), [...KNOWN_UNSTYLED],
  'KNOWN_UNSTYLED is kept sorted so two people adding an entry conflict rather than duplicate');

/* ---- 4. the build output is assembled from the source ------------------ */

/* The other half of the same failure: root styles.css IS src/styles.css plus
   the generated presets, so a hand edit to the root file is lost. Checking the
   identity here means a stale or hand-edited build output fails the suite
   rather than shipping. */
/* Compared by digest, not by content: these are a quarter of a megabyte each,
   and a deepStrictEqual on the strings prints both of them into the failure. */
const sha = t => require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 12);
const built = read('styles.css');
const assembled = read('src/styles.css') + read('src/styles-presets.css');
ok(sha(built) === sha(assembled),
  'repo-root styles.css is not src/styles.css + src/styles-presets.css '
  + `(built ${sha(built)}/${built.length}B vs source ${sha(assembled)}/${assembled.length}B).\n`
  + '    Either you hand-edited the build output — it is overwritten on every build,\n'
  + '    put the rule in src/styles.css instead — or you need to run npm run build.');

console.log(`css-class-coverage: ${checks} checks passed `
  + `(${used.size} classes emitted, ${defined.size} defined, ${KNOWN_UNSTYLED.length} known unstyled)`);
