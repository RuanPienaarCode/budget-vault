'use strict';
/* The reasoning lives in ADR-0007; the code keeps pointers. Phase 4 of
   ADR-0006.

   Two things this guards, for the ten modules the 2026-09-03 audit measured
   at 57–78% comment by line:
     1. no comment block may grow past twelve lines again — a rule that needs
        forty lines of prose above six lines of code is a rule the structure
        is not expressing, and the next copy of the code will drop the prose;
     2. every `ADR-0007 · <name>` pointer names an entry that exists in
        docs/adr/0007-calculation-rules-register.md, and every entry there
        names a function that still exists in the file it claims — so the
        register and the code cannot drift apart in either direction.

     node tests/narratives-live-in-adrs.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ROOT = path.join(__dirname, '..');
const FILES = ['period.js', 'trend-math.js', 'committed.js', 'money-flow.js', 'worth.js',
  'health-data.js', 'health-math.js', 'savings-math.js', 'debt-math.js', 'load.js'];
const MAX_BLOCK = 12;
const register = fs.readFileSync(path.join(ROOT, 'docs/adr/0007-calculation-rules-register.md'), 'utf8');
/* A heading is `### <name>  (\`file.js\` → <where>)`; <where> is one or more
   backticked identifiers (a rule may live across two functions), `purpose`
   for a module header, or `—`. A name may end in a parenthetical (an issue
   number) that a pointer may omit; both sides are normalised the same way. */
const norm = n => n.trim().replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
const entries = [...register.matchAll(/^### (.+?)\s+\(`([a-z-]+\.js)` → (.+)\)\s*$/gm)]
  .map(m => ({ name: m[1].trim(), file: m[2], fns: m[3] === 'purpose' || m[3] === '—' ? [] : [...m[3].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map(x => x[1]) }));
const unparsed = [...register.matchAll(/^### (.+)$/gm)].map(m => m[1]).filter(h => !/\s+\(`[a-z-]+\.js` → .+\)\s*$/.test(h));
eq(unparsed, [], 'every register heading names its file and where the rule lives');
ok(entries.length >= 40, `the register holds a real number of entries (${entries.length})`);
const names = new Set(entries.map(e => norm(e.name)));

/* ---- 1. no long comment blocks ---------------------------------------- */
{
  const long = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) {
      const lines = m[0].split('\n').length;
      if (lines > MAX_BLOCK) {
        const at = src.slice(0, m.index).split('\n').length;
        long.push(`${f}:${at} — ${lines} lines`);
      }
    }
  }
  eq(long, [], `no comment block in the calculation modules exceeds ${MAX_BLOCK} lines`);
}

/* ---- 2. pointers and entries agree ------------------------------------ */
{
  const dangling = [];
  let pointers = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(/ADR-0007 · ([^.\n]+?)\.(?:\s|\*\/)/g)) {
      pointers++;
      if (!names.has(norm(m[1]))) dangling.push(`${f}: "${m[1].trim()}"`);
    }
  }
  ok(pointers >= 40, `the modules carry pointers to the register (${pointers})`);
  eq(dangling, [], 'every pointer names an entry in ADR-0007');

  const orphaned = [];
  /* A rule's function must still be declared — in the file the entry names,
     or in vocabulary.js / ledger.js / figures.js, where Phases 1–3 moved a few. */
  const declaredIn = (fn, file) => {
    const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    return new RegExp(`(function\\s+${fn}\\b|(?:const|let)\\s+${fn}\\s*=|\\b${fn}\\s*[:(])`).test(src);
  };
  for (const e of entries) {
    for (const fn of e.fns) {
      if (![e.file, 'ledger.js', 'figures.js', 'vocabulary.js'].some(f => declaredIn(fn, f))) orphaned.push(`${e.file} → ${fn} ("${e.name}")`);
    }
  }
  eq(orphaned, [], 'every entry names a function that still exists in its file');
}

console.log(`PASS — narratives live in ADR-0007: ${entries.length} entries, no comment block over ${MAX_BLOCK} lines, pointers and entries agree (${checks} checks)`);
