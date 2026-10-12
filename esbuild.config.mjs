/* The build, as one reproducible Node script.

   Obsidian's community scorecard verifies a release by cloning this repo and
   REBUILDING it, then comparing the result against the published main.js. It
   does that the standard way — `npm ci`, then the `build` script in
   package.json — so a build that only exists as a bash script calling `bun`
   cannot be verified at all, however correct it is. That is what this file
   fixes: the same bundle, declared where the verifier looks for it.

   Kept as `esbuild.config.mjs` deliberately. That is the filename
   obsidian-sample-plugin uses, and matching the convention is the point.

   BOTH root main.js and root styles.css are BUILD OUTPUT. Neither is
   hand-edited:
     main.js     <- bundled from src/*.js
     styles.css  <- the files listed in scripts/css-sources.cjs, in that order:
                    src/styles-fonts.css (generated: scripts/fonts.cjs)
                    src/styles.css (hand-written, legacy)
                    src/statement/foundation.css + one file per page lane
                    src/styles-presets.css (generated: scripts/gen-presets.cjs)
   Edit src/styles.css or src/statement/*.css for ordinary CSS work; edit
   scripts/presets.cjs to change a palette. An edit made directly to root
   styles.css is lost on the next build. */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);

const root = dirname(fileURLToPath(import.meta.url));
const rel = p => join(root, p);

/* Palette blocks first: styles.css is assembled from them below, and a failure
   here must stop the build rather than leave a stylesheet missing its palettes. */
execFileSync(process.execPath, [rel('scripts/gen-presets.cjs')], { stdio: 'inherit' });
/* The bundled typeface, embedded as a data URI (scripts/fonts.cjs says why).
   Generated here, in the build the scorecard re-runs, so a clean checkout
   reproduces src/styles-fonts.css byte for byte from assets/fonts/. */
execFileSync(process.execPath, [rel('scripts/fonts.cjs')], { stdio: 'inherit' });

/* Concatenated in the order scripts/css-sources.cjs declares: fonts, the legacy
   sheet, the statement foundation, the page lanes, and the preset blocks LAST.
   The order is the cascade, and the same list feeds every CSS guard test, so the
   build and the tests cannot disagree about what "the stylesheet" is.

   Done in Node rather than `cat` so the build behaves the same wherever the
   verifier runs it, and so the byte output cannot drift with a shell. */
writeFileSync(rel('styles.css'), require('./scripts/css-sources.cjs').assemble());

/* minify: this source is commented far more heavily than most, and every one of
   those comments was being parsed by the engine on every plugin load — 175KB of
   the 679KB bundle, ~26%, was comments and whitespace. They are for readers of
   src/, not for WebKit. Nothing here reads a function or class name at runtime,
   so renaming is safe; the classes that matter extend Obsidian's own base
   classes and are located by inheritance, not by name.

   format cjs + external obsidian: Obsidian loads main.js as CommonJS and
   provides the `obsidian` module itself, so it must stay unbundled.

   target safari15 pins the syntax floor at the engine this plugin actually has
   to parse on. The floor is NOT minAppVersion — Obsidian mobile runs the OS
   WebView, and a syntax feature the engine cannot parse is a SyntaxError that
   kills the WHOLE bundle at load, not a graceful degradation.

   Named as the engine rather than as an ES year on purpose: `es2018` would be
   the safe-looking choice and is WRONG in both directions — it downlevels `?.`
   and `??`, which Safari 15 supports natively (36KB of pointless expansion),
   while an ES-year target says nothing about the engine anyone is running.
   Letting esbuild pick its own default would make the floor an accident of
   whichever version happened to be installed. */
await esbuild.build({
  entryPoints: [rel('src/main.js')],
  outfile: rel('main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'safari15',
  external: ['obsidian'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});
