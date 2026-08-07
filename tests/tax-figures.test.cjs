'use strict';
/* Tax Figures round-trip + checks guard.

   The Figures table is the first place the Tax page stores NUMBERS rather than
   just "does a document exist", so a parse/serialize mismatch silently corrupts
   amounts on the next save. This test pins:

     1. the amount coercion the loader applies (raw, separators, junk, empty),
     2. the parse → serialize → parse round-trip through the same util
        primitives both sides use,
     3. that a page written before ## Figures existed still loads (empty list),
     4. the za figureChecks thresholds and the assessed-vs-declared
        reconciliation, including the exempt-vs-omitted prompt that is the whole
        reason the reconciliation exists.

   Runs in bare node — locale.js, markdown.js and amount.js are all pure.
   Wired into ./build.sh.
     node tests/tax-figures.test.cjs        # non-zero exit on failure

   NOTE: figAmount/section below mirror src/load.js. If you change the loader's
   Figures column mapping or coercion, update BOTH — that's the parity guarded. */

const assert = require('assert');
const Module = require('module');

// Kept for the modules below that still reach obsidian — stub it for bare node.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { setIcon() {}, normalizePath: p => p };
  return origLoad.call(this, req, ...rest);
};

const { normalizeAmount } = require('../src/amount');
const { escMd, unescMd, parseMdTable } = require('../src/markdown');
const { PROFILES } = require('../src/locale');

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.deepStrictEqual(a, b, msg); };

/* ---- mirrors of src/load.js ------------------------------------------- */
const section = (body, name) => {
  for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
    if (chunk.trim().toLowerCase().startsWith(name)) return chunk;
  }
  return '';
};
/* Not a mirror any more: load.js's figAmount IS this expression, so the
   coercion assertions below drive the shipped reader rather than a copy of it
   that could silently drift from it. */
const figAmount = s => normalizeAmount(s) ?? 0;
const loadFigures = body => parseMdTable(section(body, 'figures')).slice(1).filter(c => c[0]).map(c => ({
  code: unescMd(c[0]), description: unescMd(c[1] || ''),
  source: unescMd(c[2] || ''), amount: figAmount(c[3]),
}));

/* Mirrors the ## Figures block of serializeTax in src/views/tax.js. */
const serializeFigures = (figures, codeLabel = 'Source code') => [
  '## Figures', '',
  `| ${codeLabel} | Description | Source | Amount |`,
  '|------|-------------|--------|--------|',
  ...figures.map(f => `| ${escMd(f.code)} | ${escMd(f.description)} | ${escMd(f.source)} | ${Number(f.amount || 0).toFixed(2)} |`),
  '',
].join('\n');

/* ---- 1. amount coercion ------------------------------------------------ */
eq(figAmount('5432.10'), 5432.1, 'plain decimal');
eq(figAmount('400000.00'), 400000, 'trailing zeros');
eq(figAmount('-1250.00'), -1250, 'negative (a refund)');
eq(figAmount('R5 432,10'), 5432.1, 'ZA formatting: space thousands, comma decimal');
eq(figAmount('1.234,56'), 1234.56, 'EU formatting: dot thousands, comma decimal');
eq(figAmount('1,234.56'), 1234.56, 'US/UK formatting: comma thousands, dot decimal');
eq(figAmount(''), 0, 'empty → 0, never NaN');
eq(figAmount('not a number'), 0, 'junk → 0, never NaN');
eq(figAmount(undefined), 0, 'undefined → 0');

/* ---- 2. round-trip, including adversarial text ------------------------- */
// Synthetic figures — round numbers chosen to make the threshold arithmetic
// obvious, not anyone's actual return.
const original = [
  { code: '3601', description: 'Income (salary)', source: 'Employer', amount: 400000 },
  { code: '4201', description: 'Credit interest | all accounts', source: 'Bank A', amount: 5000 },
  { code: '4201', description: 'Credit interest', source: 'Bank B', amount: 100 },
  { code: '4219', description: 'TFSA contributions', source: 'Provider', amount: 20000 },
  { code: '4250', description: 'Net gain', source: 'Provider', amount: 500 },
  { code: '4218', description: '', source: '', amount: 250 },
];
const body = `# Tax Year 2026\n\n## Progress\n\n| Step | Status |\n|---|---|\n| A | done |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | uploaded | a.pdf; b.pdf |  |\n\n${serializeFigures(original)}`;
const reloaded = loadFigures(body);
eq(reloaded, original, 'figures survive serialize → parse unchanged');

// A pipe in a description must not shear the row into extra columns.
ok(reloaded[1].description === 'Credit interest | all accounts', 'escaped pipe round-trips');
// Re-serializing what we parsed must be byte-identical (no drift on re-save).
eq(serializeFigures(reloaded), serializeFigures(original), 're-serialize is stable');

/* ---- 3. backwards compatibility ---------------------------------------- */
const legacy = `# Tax Year 2025\n\n## Progress\n\n| Step | Status |\n|---|---|\n| A | todo |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | needed |  |  |\n`;
eq(loadFigures(legacy), [], 'a page with no ## Figures loads as an empty list');
// The Figures parser must not accidentally pick up the Documents table.
ok(loadFigures(legacy).length === 0, 'section() does not fall through to another table');

/* ---- 4. za figureChecks ------------------------------------------------ */
const za = PROFILES.za;
const textOf = msgs => msgs.map(m => m.text).join(' || ');
const filed = { assessment: 'submit-requested', taxpayer_type: 'standard' };

const underLimits = za.figureChecks(original, 2026, filed);
ok(underLimits.every(m => m.ok), 'everything under threshold reports ok');
ok(/23 800/.test(textOf(underLimits)), 'names the interest exemption');
// 4201 total is 5 000 + 100 → headroom 23 800 − 5 100.
ok(/R18 700,00 of headroom/.test(textOf(underLimits)), 'reports exact interest headroom');
ok(/16 000,00 of headroom/.test(textOf(underLimits)), 'reports TFSA headroom (36 000 - 20 000)');
ok(/no exemption/.test(textOf(underLimits)), 'flags foreign interest as unexempt');

const overTfsa = za.figureChecks([{ code: '4219', description: '', source: '', amount: 40000 }], 2026, filed);
ok(overTfsa.some(m => !m.ok && /40%/.test(m.text)), 'TFSA over the annual limit warns about the penalty');

const overInterest = za.figureChecks([{ code: '4201', description: '', source: '', amount: 30000 }], 2026, filed);
ok(overInterest.some(m => !m.ok && /taxable/.test(m.text)), 'interest over the exemption warns');

const overCgt = za.figureChecks([{ code: '4250', description: '', source: '', amount: 50000 }], 2026, filed);
ok(overCgt.some(m => !m.ok), 'gains over the annual exclusion warn');

/* ---- 4b. assessed-vs-declared reconciliation --------------------------- */
// Not assessed yet → the reconciliation stays quiet.
ok(!/[Aa]ssessed taxable income/.test(textOf(za.figureChecks(original, 2026, filed))),
  'no reconciliation before an assessment exists');

// The real 2026 shape: assessed income == employment income exactly, while
// other income figures were captured. This is the prompt that matters.
const assessed = { assessment: 'assessed', taxpayer_type: 'standard', assessment_income: 500000, assessment_result: -5000 };
const recon = za.figureChecks(
  [{ code: '3601', description: 'Salary', source: 'Employer', amount: 400000 },
   { code: '3605', description: 'Annual payment', source: 'Employer', amount: 80000 },
   { code: '3801', description: 'Fringe benefit', source: 'Employer', amount: 20000 },
   { code: '4201', description: 'Interest', source: 'Bank', amount: 5000 }],
  2026, assessed);
ok(recon.some(m => !m.ok && /matches your employment income exactly/.test(m.text)),
  'assessed == employment income with other figures present raises the exempt-or-omitted prompt');

// Employment income alone, nothing else captured → nothing to question.
const clean = za.figureChecks([{ code: '3601', description: 'Salary', source: 'Employer', amount: 500000 }], 2026, assessed);
ok(!clean.some(m => !m.ok), 'no warning when employment income is the only figure captured');

// Assessed BELOW captured employment income → hard warning.
const short = za.figureChecks([{ code: '3601', description: 'Salary', source: 'Employer', amount: 600000 }], 2026, assessed);
ok(short.some(m => !m.ok && /below your captured employment income/.test(m.text)),
  'assessment below declared employment income warns');

// Missing assessment_income must not throw or invent a verdict.
const noIncome = za.figureChecks(original, 2026, { assessment: 'assessed', assessment_income: null });
ok(Array.isArray(noIncome) && !/[Aa]ssessed taxable income/.test(textOf(noIncome)),
  'a missing assessed-income figure is silent, not a crash');

console.log(`PASS — tax figures round-trip + za checks intact (${checks} assertions).`);
