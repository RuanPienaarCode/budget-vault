#!/bin/bash
# Build the plugin and run the guard suite.
#
# This is a thin wrapper now. The build itself lives in esbuild.config.mjs and
# is declared in package.json, because Obsidian's community scorecard verifies a
# release by CLONING this repo and rebuilding it — `npm ci` then the `build`
# script — and compares the result against the published main.js. A build that
# existed only as a bash script calling `bun` could not be verified at all,
# however correct it was. One path, so the thing you run locally and the thing
# the verifier runs cannot drift.
#
# BOTH root main.js and root styles.css are BUILD OUTPUT. Neither is hand-edited:
#   main.js     <- bundled from src/*.js
#   styles.css  <- src/styles.css (hand-written) + src/styles-presets.css (generated)
# Edit src/styles.css for ordinary CSS work; edit scripts/presets.cjs to change a
# palette. An edit made directly to root styles.css is lost on the next build.
set -euo pipefail
cd "$(dirname "$0")"

# `npm ci` when the lockfile is authoritative and node_modules is missing or
# stale — it installs EXACTLY the lockfile, which is what makes the rebuild
# reproducible. Falls back to `npm install` only when there is no lockfile,
# which should never happen in a clean checkout.
if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
fi

npm run build

# The bundle-level gates: it parses, and (via the suite below) it evaluates and
# exports a plugin class against the obsidian stub. The guard tests require src/
# directly, so they pass identically whether or not the bundle minifies — these
# two checks are the only thing standing behind the minifier.
node --check main.js

npm test

echo "Built main.js + styles.css OK — reload Obsidian (or the plugin) to pick it up."
