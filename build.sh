#!/bin/bash
# Bundle src/ into the single main.js that Obsidian loads.
# Requires bun (https://bun.sh) — no node_modules, no package.json needed.
# Fallback: npx esbuild (downloads to the npm cache, not this folder).
set -euo pipefail
cd "$(dirname "$0")"

if command -v bun >/dev/null 2>&1; then
  bun build src/main.js --format=cjs --external obsidian --outfile=main.js
elif command -v npx >/dev/null 2>&1; then
  npx -y esbuild src/main.js --bundle --format=cjs --platform=browser --external:obsidian --outfile=main.js
else
  echo "Need bun or npx (esbuild) to build." >&2
  exit 1
fi

node --check main.js
echo "Built main.js OK — reload Obsidian (or the plugin) to pick it up."
