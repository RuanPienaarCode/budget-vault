'use strict';
/* Plan guard suite — the arithmetic and the round-trip.

   Two things are worth pinning here, and they are the two that would corrupt
   data or lie to the reader if they drifted:

   1. THE IDENTITY. The pot bar draws three segments and claims they make up the
      whole: spent + committed + free = pot. Every figure on the page derives
      from planSummary, so that identity holding is the difference between a bar
      that means something and three coloured divs. Checked against a worked
      example AND against random plans, because the failure mode is a rounding
      residue that only shows up on particular amounts.

   2. THE ROUND-TRIP. A plan written to disk must parse back to the same record.
      This drives the REAL serializer (plan.js's serializePlan, reached through
      its register(ctx) factory) and parses the output with the SAME markdown
      primitives load.js uses — including the heading-slice, which is what keeps
      three tables in one file from running together into one malformed list.

   Runs in bare node via the same obsidian stub the other suites use.
     node tests/plan.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const Module = require('module');

const origLoad = Module._load;
const STUB = {
  setIcon() {}, normalizePath: (p) => p,
  Notice: class {}, Modal: class {}, Setting: class {}, PluginSettingTab: class {},
  ItemView: class {}, Plugin: class {}, TFile: class {}, TFolder: class {},
};
Module._load = function (request) {
  if (request === 'obsidian') return STUB;
  return origLoad.apply(this, arguments);
};

const { planSummary, barSegments, envelopeGap, sharePct, round2, isReceived,
  envelopeOverState, SOURCE_KINDS } = require('../src/plan-math');
const { escMd, unescMd, parseMdTable, parseFrontmatter } = require('../src/markdown');
const { normalizeAmount } = require('../src/amount');
const registerPlan = require('../src/views/plan');

let checks = 0;
const eq = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); checks++; };
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

/* ------------------------------------------------------------------ *
 * 1. planSummary — the worked example from the design mockup           *
 * ------------------------------------------------------------------ */

const PLAN = {
  file: 'Baby & catch-up', name: 'Baby & catch-up', fmRaw: '', started: '2026-08-01', status: 'active',
  sources: [
    { name: 'UIF maternity payout', kind: 'UIF', amount: 40000, date: '2026-08-03', status: 'received', notes: '' },
    { name: 'SARS assessment refund', kind: 'Tax', amount: 8000, date: '2026-08-19', status: 'expected', notes: '' },
    { name: 'September salary surplus', kind: 'Salary', amount: 6500, date: '2026-09-25', status: 'expected', notes: '' },
    { name: 'Sold the old pram', kind: 'Sale', amount: 1500, date: '2026-08-08', status: 'received', notes: '' },
  ],
  envelopes: [
    { name: 'Settle up', amount: 11600, note: '', tint: 'var(--color-danger)' },
    { name: 'Keep back', amount: 18000, note: '', tint: 'var(--color-primary)' },
    { name: 'Coming up', amount: 4500, note: '', tint: 'var(--color-warning)' },
    { name: 'For the baby', amount: 12300, note: '', tint: 'var(--color-info)' },
    { name: 'For the house', amount: 1850, note: '', tint: 'var(--color-luxuries)' },
    { name: 'For us', amount: 1200, note: '', tint: 'var(--color-giving)' },
  ],
  items: [
    { name: 'Everyday Card', envelope: 'Settle up', amount: 8420, spent: 8420, status: 'done', category: 'Debt', notes: '' },
    { name: 'Woolworths store account', envelope: 'Settle up', amount: 3180, spent: 0, status: 'planned', category: 'Debt', notes: '' },
    { name: 'Emergency fund top-up', envelope: 'Keep back', amount: 18000, spent: 0, status: 'planned', category: 'Savings', notes: '' },
    { name: 'Car service', envelope: 'Coming up', amount: 4500, spent: 0, status: 'planned', category: 'Vehicle', notes: '' },
    { name: 'Pram & car seat', envelope: 'For the baby', amount: 6800, spent: 0, status: 'planned', category: 'Baby', notes: '' },
    { name: 'Clothes, 0–6 months', envelope: 'For the baby', amount: 2400, spent: 0, status: 'planned', category: 'Baby', notes: '' },
    { name: 'Nappy stock-up', envelope: 'For the baby', amount: 2200, spent: 0, status: 'planned', category: 'Baby', notes: '' },
    { name: 'Books & sensory toys', envelope: 'For the baby', amount: 900, spent: 640, status: 'part', category: 'Baby', notes: '' },
    { name: 'Electric toothbrushes ×2', envelope: 'For the house', amount: 1850, spent: 1812.99, status: 'done', category: 'Household', notes: '' },
    { name: 'Dinner out', envelope: 'For us', amount: 1200, spent: 0, status: 'planned', category: 'Eating out', notes: '' },
  ],
};

const s = planSummary(PLAN);
eq(s.pot, 56000, 'pot is the sum of every source, expected or not');
eq(s.received, 41500, 'received counts only sources marked received');
eq(s.expected, 14500, 'expected is the rest');
eq(s.allocated, 49450, 'allocated is the sum of envelope amounts, not of items');
eq(s.spent, 10872.99, 'spent is the sum of item spent');
eq(s.committed, 38577.01, 'committed is allocated minus spent');
eq(s.free, 6550, 'free is pot minus allocated');
eq(s.left, 45127.01, 'left is pot minus spent');
eq(s.sources, 4, 'source count');
eq(s.envelopes, 6, 'envelope count');
eq(s.items, 10, 'item count');

/* THE SPLIT KEY'S SUBTOTAL. `left` must be pot − spent, full stop — never
   derived from committed/free in the view, because those two clamp and this
   repo's recurring bug shape is exactly that: two figures for the same thing,
   derived by two different rules, that quietly disagree the moment one of
   them clamps. On an unclamped plan the two ways of asking the question still
   agree, which is what makes "Still left" a legible subtotal rather than a
   fourth mystery number — but agreement here is a consequence, not the
   definition. */
eq(s.left, round2(s.pot - s.spent), 'left is defined as pot minus spent, not derived from committed/free');
eq(s.left, round2(s.committed + s.free),
  'on a plan where nothing is clamped, left happens to equal committed + free too');

/* THE IDENTITY the bar depends on. On a healthy plan the summary satisfies it
   directly; barSegments is what guarantees it on every plan, healthy or not. */
eq(round2(s.spent + s.committed + s.free), s.pot,
  'on a plan where nothing is overspent, the summary itself sums to the pot');
{
  const b = barSegments(s);
  eq(round2(b.spent + b.committed + b.free), s.pot, 'bar segments sum to the pot');
  eq(b, { spent: s.spent, committed: s.committed, free: s.free },
    'on a healthy plan the bar shows exactly the summary figures — no clamping in sight');
}

/* ------------------------------------------------------------------ *
 * 2. The identity holds on adversarial amounts too                     *
 * ------------------------------------------------------------------ */

/* Deterministic pseudo-random so a failure is reproducible from the seed
   rather than being a heisenbug that vanishes on the next run. */
let seed = 20260811;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const cents = () => Math.round(rnd() * 5000000) / 100;   // 0 … 50 000.00

for (let n = 0; n < 400; n++) {
  const p = {
    sources: Array.from({ length: 1 + Math.floor(rnd() * 6) },
      () => ({ amount: cents(), status: rnd() < 0.5 ? 'received' : 'expected' })),
    envelopes: Array.from({ length: Math.floor(rnd() * 7) }, () => ({ amount: cents() })),
    items: Array.from({ length: Math.floor(rnd() * 12) }, () => ({ amount: cents(), spent: cents() })),
  };
  const q = planSummary(p);
  assert.strictEqual(round2(q.received + q.expected), q.pot,
    `received + expected must equal pot (n=${n}, seed 20260811)`);
  assert.ok(q.committed >= 0, `committed is clamped at zero (n=${n})`);
  assert.strictEqual(q.left, round2(q.pot - q.spent),
    `left is pot minus spent on every plan, clamped or not (n=${n})`);

  /* The one that matters: whatever the plan looks like — overspent envelopes,
     more allocated than the pot holds, both at once — the three widths the bar
     draws must still sum to exactly the pot, and none of them may go negative.
     This is the assertion that failed when the view drew the summary directly,
     which is why barSegments exists. */
  const b = barSegments(q);
  assert.strictEqual(round2(b.spent + b.committed + b.free), q.pot,
    `bar segments must sum to the pot (n=${n}, seed 20260811)`);
  for (const k of ['spent', 'committed', 'free']) {
    assert.ok(b[k] >= 0, `bar segment ${k} must never be negative (n=${n})`);
    assert.ok(b[k] <= q.pot + 0.005, `bar segment ${k} must never exceed the pot (n=${n})`);
  }
}
checks += 5;

/* A pot of zero must not divide by anything. */
eq(barSegments({ pot: 0, spent: 100, allocated: 200 }), { spent: 0, committed: 0, free: 0 },
  'an empty pot draws an empty bar rather than dividing by zero');

/* Overspending an envelope must not make the bar grow leftwards: committed
   clamps, and the overspend shows up by pushing free down instead. */
const over = planSummary({
  sources: [{ amount: 1000, status: 'received' }],
  envelopes: [{ amount: 400 }],
  items: [{ amount: 400, spent: 900 }],
});
eq(over.committed, 0, 'committed clamps at zero when spending exceeds what was placed');
eq(over.free, 600, 'free still reports pot minus allocated');
eq(barSegments(over), { spent: 900, committed: 0, free: 100 },
  'the bar treats money already gone as committed, so R 900 spent against R 400 placed ' +
  'still leaves only R 100 of the R 1 000 pot unaccounted for');
/* `left` stays honest here even though committed just clamped to zero: R 1 000
   pot minus R 900 actually spent is R 100 left, which is NOT committed + free
   (0 + 600 = 600) — proof that left is derived independently rather than by
   summing the two clamped bar figures. */
eq(over.left, 100, 'left is pot minus spent even when an envelope is overspent');
ok(over.left !== round2(over.committed + over.free),
  'left deliberately disagrees with committed + free once clamping kicks in — that gap is the point');

/* Allocated beyond the pot: free goes negative in the summary (which is what
   lights the loud card) and clamps to zero in the bar. */
const stretched = planSummary({
  sources: [{ amount: 1000, status: 'received' }],
  envelopes: [{ amount: 1400 }],
  items: [{ amount: 1400, spent: 200 }],
});
eq(stretched.free, -400, 'placing more than the pot holds reports a negative free');
eq(barSegments(stretched), { spent: 200, committed: 800, free: 0 },
  'the bar fills to the pot and no further');
eq(stretched.left, 800, 'left still reports pot minus spent when the plan itself is overspent (free < 0)');

/* A plan with nothing in it must not produce NaN anywhere — and must not
   throw either: `left` has no division in it, but it is checked explicitly
   rather than only riding along in the Number.isFinite loop below, because a
   change that reintroduced a ratio (e.g. "left as % of pot") is exactly the
   kind of edit that would divide by this plan's zero pot. */
const empty = planSummary({ sources: [], envelopes: [], items: [] });
eq(empty.left, 0, 'an empty plan has nothing spent, so nothing left to report — not NaN, not a throw');
for (const [k, v] of Object.entries(empty)) {
  ok(Number.isFinite(v), `empty plan: ${k} must be a finite number, got ${v}`);
}
eq(sharePct(100, 0), 0, 'share of an empty pot is 0%, not NaN or Infinity');

/* ------------------------------------------------------------------ *
 * 3. envelopeGap — the difference the page refuses to paper over       *
 * ------------------------------------------------------------------ */

eq(envelopeGap({ amount: 12300 }, PLAN.items.filter(i => i.envelope === 'For the baby')), 0,
  'an envelope whose items add up exactly reports no gap');
eq(envelopeGap({ amount: 5000 }, [{ amount: 3000 }, { amount: 500 }]), 1500,
  'money placed but not yet named is a positive gap');
eq(envelopeGap({ amount: 1000 }, [{ amount: 800 }, { amount: 700 }]), -500,
  'a list that wants more than was placed is a negative gap');
eq(envelopeGap({ amount: 0.1 + 0.2 }, [{ amount: 0.3 }]), 0,
  'the gap is rounded, so 0.1 + 0.2 vs 0.3 does not report a phantom remainder');

eq(isReceived({ status: 'expected' }), false, 'expected is not received');
eq(isReceived({ status: 'received' }), true, 'received is received');
eq(isReceived({}), true, 'a source with no status at all reads as received');
ok(SOURCE_KINDS.includes('Salary') && SOURCE_KINDS.includes('UIF') && SOURCE_KINDS.includes('Tax'),
  'the kind presets cover the ones the design was built around');

/* ------------------------------------------------------------------ *
 * 3b. envelopeOverState — the drag path and the render path share it   *
 * ------------------------------------------------------------------ */

/* "Settle up" as it sits in PLAN: R 11 600 placed, items claiming exactly
   that (R 8 420 + R 3 180 = R 11 600, so no gap), R 8 420 already spent —
   healthy on every axis. */
const settleItems = PLAN.items.filter(i => i.envelope === 'Settle up');
const settleSpent = settleItems.reduce((t, i) => t + (i.spent || 0), 0);
eq(settleSpent, 8420, 'precondition: Settle up has R 8 420 actually spent');
eq(envelopeOverState(11600, settleItems, settleSpent),
  { overAmt: -3180, isOverspent: false, gap: 0, isOvercommitted: false },
  'Settle up at its placed amount is neither overspent nor overcommitted');

/* The exact regression a live drag produced: dragging the slider DOWN to
   R 7 000 while R 8 420 is already spent must read as overspent (money is
   already gone past the new amount) AND overcommitted (the item list, R 11
   600 unchanged, now claims more than the R 7 000 the slider proposes) —
   the two conditions this function exists to tell apart, both true from one
   drag. Pinned to the actual figures a live drag showed: R 1 420,00 over and
   R 4 600,00 over-committed. envelopeOverState is the ONLY thing both the
   initial render and the slider's `input` handler call for this, so a value
   checked here is a value the drag path cannot get out of step with. */
eq(envelopeOverState(7000, settleItems, settleSpent),
  { overAmt: 1420, isOverspent: true, gap: -4600, isOvercommitted: true },
  'dragging the amount below what is already spent is overspent AND overcommitted mid-drag, not just on release');

/* A bucket can be overcommitted (the list over-promises) with nothing spent
   yet at all — the two signals are independent, not two names for one thing. */
eq(envelopeOverState(1000, [{ amount: 800 }, { amount: 700 }], 0),
  { overAmt: -1000, isOverspent: false, gap: -500, isOvercommitted: true },
  'overcommitted with nothing spent is not overspent');

/* And a bucket can be overspent with its item list perfectly balanced — the
   `over` fixture used for barSegments above, restated as a state. */
eq(envelopeOverState(400, [{ amount: 400, spent: 900 }], 900),
  { overAmt: 500, isOverspent: true, gap: 0, isOvercommitted: false },
  'overspent with a balanced item list is not overcommitted');

/* ------------------------------------------------------------------ *
 * 4. Round-trip: serialize → parse → identical record                  *
 * ------------------------------------------------------------------ */

/* A minimal ctx — enough for registerPlan to run its factory and publish
   serializePlan. Nothing here renders, so the DOM helpers are never reached. */
function makeCtx(plans, planName) {
  const ctx = {
    S: { plans, planName, planDirty: false },
    $: () => null, app: {}, money: v => String(v), toast: () => {},
    writeFile: async () => {}, fileAt: () => null,
    dirtyFlag: () => ({ mark: () => {}, clear: () => {} }),
    provide(obj) { Object.assign(ctx, obj); },
  };
  registerPlan(ctx);
  return ctx;
}

/* The same heading-slice load.js uses. If this helper and the loader disagree,
   this test passes while the app loses data — so it is a deliberate mirror,
   and changing one means changing the other. */
const section = (body, name) => {
  for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
    if (chunk.trim().toLowerCase().startsWith(name)) return chunk;
  }
  return '';
};
const amt = v => normalizeAmount(v) ?? 0;
const srcStatus = v => (v || '').trim().toLowerCase() === 'expected' ? 'expected' : 'received';
const itemStatus = v => {
  const t = (v || '').trim().toLowerCase();
  return t === 'done' ? 'done' : (t === 'part' || t === 'partial') ? 'part' : 'planned';
};

function loadPlan(text, file) {
  const { fm, body } = parseFrontmatter(text);
  return {
    file,
    name: (fm.plan || '').toString().trim() || file,
    started: (fm.started || '').toString().trim(),
    status: (fm.status || 'active').toString().trim(),
    sources: parseMdTable(section(body, 'money in')).slice(1).filter(c => c[0]).map(c => ({
      name: unescMd(c[0]), kind: unescMd(c[1] || 'Other'), amount: amt(c[2]),
      date: (c[3] || '').trim(), status: srcStatus(c[4]), notes: unescMd(c[5] || ''),
    })),
    envelopes: parseMdTable(section(body, 'envelopes')).slice(1).filter(c => c[0]).map(c => ({
      name: unescMd(c[0]), amount: amt(c[1]), note: unescMd(c[2] || ''), tint: (c[3] || '').trim(),
    })),
    items: parseMdTable(section(body, 'items')).slice(1).filter(c => c[0]).map(c => ({
      name: unescMd(c[0]), envelope: unescMd(c[1] || ''), amount: amt(c[2]), spent: amt(c[3]),
      status: itemStatus(c[4]), category: unescMd(c[5] || ''), notes: unescMd(c[6] || ''),
    })),
  };
}

{
  const ctx = makeCtx({ 'Baby & catch-up': PLAN }, 'Baby & catch-up');
  const text = ctx.serializePlan('Baby & catch-up');
  const back = loadPlan(text, 'Baby & catch-up');

  eq(back.name, PLAN.name, 'display name survives the round-trip');
  eq(back.started, PLAN.started, 'started date survives');
  eq(back.status, PLAN.status, 'status survives');
  eq(back.sources, PLAN.sources, 'every source survives field-for-field');
  eq(back.envelopes, PLAN.envelopes, 'every envelope survives field-for-field');
  eq(back.items, PLAN.items, 'every item survives field-for-field');

  // The three tables must stay three tables. Running them together is the exact
  // failure the heading-slice exists to prevent, and it would show up as an
  // envelope list containing rows that are actually items.
  ok(/^## Money in$/m.test(text), 'the Money in heading is written verbatim');
  ok(/^## Envelopes$/m.test(text), 'the Envelopes heading is written verbatim');
  ok(/^## Items$/m.test(text), 'the Items heading is written verbatim');
  eq(parseMdTable(section(text, 'envelopes')).slice(1).filter(c => c[0]).length, 6,
    'the Envelopes section holds exactly the envelopes, not the items after it');
}

/* Adversarial values — pipes, newlines, unicode, currency-formatted amounts and
   empties are exactly what breaks a naive markdown-table writer, and every one
   of these is a plausible thing to type into a plan. */
{
  const nasty = {
    file: 'nasty', name: 'Pipes | and “quotes”', fmRaw: '', started: '', status: 'active',
    sources: [
      { name: 'Gift from Ma | Pa', kind: 'Gift', amount: 2500.5, date: '', status: 'expected', notes: 'multi\nline note' },
      { name: '', kind: '', amount: 0, date: '', status: 'received', notes: '' },
    ],
    envelopes: [
      { name: 'café ¥ 个人所得税 déjà', amount: 0, note: '50% off | maybe', tint: '' },
    ],
    items: [
      { name: 'thing — with — dashes', envelope: 'café ¥ 个人所得税 déjà', amount: 1234.56, spent: 0.01,
        status: 'part', category: 'Eating out', notes: 'R100 @ shop; semi, comma' },
    ],
  };
  const ctx = makeCtx({ nasty }, 'nasty');
  const back = loadPlan(ctx.serializePlan('nasty'), 'nasty');
  // The blank-named source is dropped on the way back in — a row with no name
  // is not a source, and the loader filters it. Compare against that reality
  // rather than pretending an empty row round-trips.
  eq(back.sources, [nasty.sources[0]], 'an adversarial source survives; a nameless row is dropped');
  eq(back.envelopes, nasty.envelopes, 'an adversarial envelope survives field-for-field');
  eq(back.items, nasty.items, 'an adversarial item survives field-for-field');
}

/* Frontmatter the app does not model must survive a save — the file is the
   user's, and Obsidian properties (tags, aliases) live in the same block. */
{
  const withFm = { ...PLAN, file: 'fm', name: 'FM plan',
    fmRaw: 'kind: plan\ntags:\n  - money\naliases: [windfall]\nmystery: keep me' };
  const ctx = makeCtx({ fm: withFm }, 'fm');
  const text = ctx.serializePlan('fm');
  ok(/mystery: keep me/.test(text), 'an unmodeled frontmatter key survives serialization');
  ok(/- money/.test(text), 'tags survive serialization');
  ok(/^kind: plan$/m.test(text), 'kind is stamped as plan');
}

console.log(`plan: ${checks} checks passed.`);
