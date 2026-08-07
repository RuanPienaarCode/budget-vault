#!/bin/bash
# Bundle src/ into the single main.js that Obsidian loads, and assemble the
# single styles.css it loads alongside it.
#
# BOTH root main.js and root styles.css are BUILD OUTPUT. Neither is hand-edited:
#   main.js     <- bundled from src/*.js
#   styles.css  <- src/styles.css (hand-written) + src/styles-presets.css (generated)
# Edit src/styles.css for ordinary CSS work; edit scripts/presets.cjs to change a
# palette. An edit made directly to root styles.css is lost on the next build.
#
# Requires bun (https://bun.sh) — no node_modules, no package.json needed.
# Fallback: npx esbuild (downloads to the npm cache, not this folder).
set -euo pipefail
cd "$(dirname "$0")"

# Palette blocks first: styles.css is assembled from them below, and a failure
# here must stop the build rather than leave a stylesheet missing its palettes.
node scripts/gen-presets.cjs

# Concatenated in this order so the preset blocks come last. They win on
# specificity regardless (they carry the palette class), but keeping the
# generated half at the end makes the assembled file readable.
cat src/styles.css src/styles-presets.css > styles.css

# --minify: this source is commented far more heavily than most, and every one
# of those comments was being parsed by the engine on every plugin load — 175KB
# of the 679KB bundle, ~26%, was comments and whitespace. They are for readers
# of src/, not for WebKit. Nothing here reads a function or class name at
# runtime, so renaming is safe; the classes that matter extend Obsidian's own
# base classes and are located by inheritance, not by name.
#
# The guard tests below DO NOT cover this flag — they require src/ directly, so
# they pass identically whether or not the bundle minifies. The bundle-level
# gates are `node --check` (it parses) and tests/bundle-smoke.test.cjs (it
# evaluates and exports a plugin class against the obsidian stub).
if command -v bun >/dev/null 2>&1; then
  bun build src/main.js --format=cjs --external obsidian --minify --outfile=main.js
elif command -v npx >/dev/null 2>&1; then
  npx -y esbuild src/main.js --bundle --format=cjs --platform=browser --external:obsidian --minify --outfile=main.js
else
  echo "Need bun or npx (esbuild) to build." >&2
  exit 1
fi

node --check main.js

# Guard tests — run in bare node (no obsidian dependency). set -e fails the
# build if a country profile drops a key the views read.
for t in tests/*.test.cjs; do
  [ -e "$t" ] || continue
  node "$t"
done

echo "Built main.js + styles.css OK — reload Obsidian (or the plugin) to pick it up."
