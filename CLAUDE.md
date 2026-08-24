# Budget Vault — working notes

An Obsidian plugin (id `budget-app`) whose source of truth is the markdown in the
user's vault, not the plugin. Every figure shown is derived from a file the user
could have written by hand. Read `CONTEXT.md` for the domain vocabulary before
naming anything new.

## Build output is not source

`main.js` and root `styles.css` are **build output — never hand-edit them.**

- `main.js` ← bundled from `src/*.js` by esbuild
- root `styles.css` ← `src/styles.css` (hand-written) + `src/styles-presets.css`
  (generated from the seeds in `scripts/presets.cjs`)

Build with `./build.sh` — a thin wrapper over `npm run build`. The indirection is
load-bearing: Obsidian's community scorecard verifies a release by cloning this
repo and rebuilding it, so the local build and the verified build must not drift.

**A green build installs nothing.** The vault keeps loading the previous bundle
until the artifacts are copied across. The deploy path is
`~/.claude/skills/obsidian-plugin-dev-loop/scripts/dev-loop.sh` — it builds,
parse-checks, runs the guard suite, copies, and proves each file byte-identical
by sha256. Copying by hand skips the proof, and the proof is the point.

## Logic goes in a pure module

If it can be pure, it is: no DOM, no `require('obsidian')`, `today` injected
rather than read off the clock — so it runs in bare node under a guard test.
Existing ones: `dates` `amount` `markdown` `csv` `debt-math` `loan-math`
`savings-math` `owed-math` `reconcile` `recurring` `worth` `dedupe` `tx-role`.

Views in `src/views/*.js` own the DOM and receive a shared `ctx`; they publish
their own helpers back onto it with `ctx.provide({...})`.

## Tests are bare-node scripts, not a framework

`tests/*.test.cjs` — each asserts, prints its own `PASS` line, and exits non-zero
on failure. `scripts/run-tests.mjs` auto-discovers them, so dropping a file in
`tests/` wires it in. Run one directly while iterating; `./build.sh` runs all of
them.

**File-format work must round-trip through the REAL loader** in
`tests/vault-roundtrip.test.cjs`. A test that parses with a hand-written mirror
of the loader's column mapping stays green while `load.js` changes and every
subsequent save corrupts data — that file's own header explains why.

## Two traps that have each cost a release

**Transaction columns are POSITIONAL:**
`Date | Description | Category | Amount | Excluded | Note | Split`.
Appending is safe (a short row yields `undefined`); inserting or reordering
shifts every later value into the wrong field. `Debts.md`'s twelve positional
columns are the cautionary tale.

**`excluded` means "out of the budget totals", not "ignore this row".** The money
still moved, so everything measuring the *account* rather than the budget
deliberately does not filter on it — `reconcile()`, `periodActivity()`,
`splitFlows()`, `chargeIndex()`, `buildIndex()`. That correctness is exactly what
made split parents double-count in 1.11.9. **Any new consumer of raw transaction
rows must go through `src/tx-role.js`.**

## Constraints

- **iOS 15 / WebKit is the engine floor** — *not* `minAppVersion`. No regex
  lookbehind anywhere in `src/`: it is a parse-time SyntaxError that kills the
  whole bundle, not one function. No `innerHTML`. No Node/Electron APIs in `src/`.
- The palette is **sealed** — edit `scripts/presets.cjs` seeds, never derive
  colours from Obsidian's own variables.
- i18n lives in `src/lang/*.js`, 9 languages, `en.js` is the key source of truth.
  Imported as a namespace (`const i18n = require('./i18n')`) because `t` is
  already a local in several files.
- Never commit real statement data. `dev-docs/` is gitignored.

## This repo changes under you

Two agent sessions edit it concurrently. Re-read `git status` / `git log` /
`gh pr list` **immediately** before any commit, push, tag or merge — never trust
a reading from earlier in the turn. Stage **explicit paths**; never `git add -A`.
Prefer `--force-with-lease` over `--force`. Check which branch you are on before
committing: work has landed on another session's feature branch more than once.

## House style

Comments carry the **why** and the evidence, not the what — often naming the real
vault figure that proved a rule ("on the vault this was built against, four of
six services disagreed with the statements"). Match that register; terse comments
read as foreign here.

The app **argues, it does not correct.** A stated balance is "a claim with an age,
never a fact". Show the disagreement and let the reader decide which number is
wrong — never silently overwrite a figure the user typed.

## Lanes

- Releases → the `obsidian-plugin-release` skill (`bump-version.sh`,
  `preflight.sh`, `verify-release.sh`)
- Build + deploy → the `obsidian-plugin-dev-loop` skill
- Feature work here → the `budget-vault-engineer` agent in `.claude/agents/`
- iOS/WebKit + host-cascade audit → `obsidian-mobile-safety-reviewer`
- Runtime browser proof → `obsidian-plugin-verifier`
