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

   2. THE ROUND-TRIP, through the REAL loader. A plan written to disk must parse
      back to the same record — and "parse" here means src/load.js's own Plan
      mapping, reached through loadVault() over an in-memory vault. Never a copy
      of it living in this file.

      It used to mean a copy. A hand-written `loadPlan()` sat in this section
      mirroring load.js's column map, so transposing the Items `category` and
      `notes` columns in load.js ALONE left all 181 suites green while every
      subsequent save wrote the two fields into each other's columns. That is
      the shape tests/vault-roundtrip.test.cjs was bought with on the
      transaction, budget, owed, services and tax files — read its header —
      and serializePlan was the last serializer in the repo without it.

      Both halves are the shipped code now: REAL serializePlan out (reached
      through plan.js's register(ctx) factory, the way controller.js reaches
      it), REAL loadVault back in. The column-identity fixture below gives
      every cell of all three tables a value that could have come from no other
      column, so ANY reorder of ANY column turns this suite red — which is the
      whole point on a file whose columns are positional.

   Runs in bare node against an in-memory vault (tests/helpers/harness.cjs).
     node tests/plan.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx: makeVaultCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

const { planSummary, barSegments, envelopeGap, sharePct, round2, isReceived,
  envelopeOverState, SOURCE_KINDS } = require('../src/plan-math');
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
 * 4. Round-trip: REAL serializer → REAL loader → identical record      *
 * ------------------------------------------------------------------ */

const B = 'Budget';
/* The smallest vault loadVault() will read. Everything this section asserts
   comes out of the plan file itself. */
const BASE = { [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n---\n' };

/* The REAL serializer, reached the way controller.js reaches it: registerPlan
   over a ctx whose io/period/load halves are already wired, with the plan
   sitting in S.plans where the view looks for it. */
async function serializeThroughApp(plans, key) {
  const ctx = makeVaultCtx({ ...BASE });
  await loadInto(ctx);
  ctx.S.plans = plans;
  ctx.S.planName = key;
  registerPlan(ctx);
  return ctx.serializePlan(key);
}

/* The REAL loader, over a vault holding exactly that text at the path savePlan
   writes to. `key` is the basename, which IS the plan's identity (load.js keys
   S.plans by it, and writers derive the path from `file`). */
async function loadThroughApp(text, key) {
  const S = await loadInto(makeVaultCtx({ ...BASE, [`${B}/Plans/${key}.md`]: text }));
  return S.plans[key];
}

const roundTrip = async plan =>
  loadThroughApp(await serializeThroughApp({ [plan.file]: plan }, plan.file), plan.file);

(async () => {
  /* ---- the worked example, out through the writer and back in through the
     reader that the app itself uses ---- */
  {
    const text = await serializeThroughApp({ [PLAN.file]: PLAN }, PLAN.file);
    const back = await loadThroughApp(text, PLAN.file);

    eq(back.file, PLAN.file, 'the file basename is the plan identity on the way back in too');
    eq(back.name, PLAN.name, 'display name survives the round-trip');
    eq(back.started, PLAN.started, 'started date survives');
    eq(back.status, PLAN.status, 'status survives');
    eq(back.sources, PLAN.sources, 'every source survives field-for-field');
    eq(back.envelopes, PLAN.envelopes, 'every envelope survives field-for-field');
    eq(back.items, PLAN.items, 'every item survives field-for-field');

    /* The three tables must stay three tables. Running them together is the
       exact failure the heading-slice exists to prevent, and it would show up
       as an envelope list holding rows that are actually items — so the count
       is asserted off the LOADER's record, not off a re-parse in this file. */
    ok(/^## Money in$/m.test(text), 'the Money in heading is written verbatim');
    ok(/^## Envelopes$/m.test(text), 'the Envelopes heading is written verbatim');
    ok(/^## Items$/m.test(text), 'the Items heading is written verbatim');
    eq([back.sources.length, back.envelopes.length, back.items.length], [4, 6, 10],
      'each section holds exactly its own rows — no table bleeds into the next');
  }

  /* ---- COLUMN IDENTITY: the guard the hand-written mirror could not be ----

     Every cell below holds a value that could have come from no other column,
     so transposing ANY pair in load.js's Plan mapping — the Items
     `category`/`notes` swap that used to leave the whole suite green — lands
     here as a field holding another field's value. On a file whose columns are
     positional (CLAUDE.md's first trap), that is the assertion that has to
     exist somewhere, and driving the real loader is the only place it can. */
  {
    const ident = {
      file: 'columns', name: 'Column identity', fmRaw: '', started: '2026-01-01', status: 'active',
      sources: [{ name: 'source-name', kind: 'source-kind', amount: 1111.11,
        date: '2026-01-11', status: 'expected', notes: 'source-notes' }],
      envelopes: [{ name: 'envelope-name', amount: 2222.22, note: 'envelope-note',
        tint: 'var(--color-info)' }],
      items: [{ name: 'item-name', envelope: 'envelope-name', amount: 3333.33, spent: 444.44,
        status: 'part', category: 'item-category', notes: 'item-notes' }],
    };
    const back = await roundTrip(ident);
    eq(back.sources, ident.sources, 'every Money in column lands in its own field');
    eq(back.envelopes, ident.envelopes, 'every Envelopes column lands in its own field');
    eq(back.items, ident.items, 'every Items column lands in its own field');
  }

  /* Adversarial values — pipes, newlines, unicode, currency-formatted amounts
     and empties are exactly what breaks a naive markdown-table writer, and
     every one of these is a plausible thing to type into a plan. */
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
    const back = await roundTrip(nasty);
    // The blank-named source is dropped on the way back in — a row with no name
    // is not a source, and the loader filters it. Compare against that reality
    // rather than pretending an empty row round-trips.
    eq(back.sources, [nasty.sources[0]], 'an adversarial source survives; a nameless row is dropped');
    eq(back.envelopes, nasty.envelopes, 'an adversarial envelope survives field-for-field');
    eq(back.items, nasty.items, 'an adversarial item survives field-for-field');
    eq(back.name, nasty.name, 'a plan name holding a pipe and curly quotes survives the frontmatter');
    eq(back.started, '', 'a plan with no start date keeps none rather than gaining one');
  }

  /* ---- A FILE A PERSON TYPED, twice through ----

     Loader FIRST (so the fixture is a hand-written file, not a record this
     test invented), then serializer, then loader again. Two full passes,
     because the corruption this catches only appears from the SECOND save
     onwards: a cell the loader could not read keeps the reader's own text, and
     that text arrives from parseMdTable still \|-escaped. Writing it back
     through escMd therefore adds one backslash per save — R400 \| ish,
     R400 \\| ish, R400 \\\| ish — until the cell is unreadable in a way it
     never was when it was merely unparseable.

     table-schema.js's money() and vocab() writes state the contract this is
     the hand-applied copy of: the raw goes back WITHOUT escMd, "so preserving a
     cell cannot shear the row, and a second load reads the identical raw". */
  const TYPED = [
    '---', 'kind: plan', 'plan: "Ma\'s payout"', 'started: 2026-08-01', 'status: active',
    'mystery: keep me', '---', '', "# Ma's payout", '',
    '## Money in', '',
    '| Source | Kind | Amount | Date | Status | Notes |',
    '|---|---|---:|---|---|---|',
    '| Gift from Ma \\| Pa | Gift | 2 500,50 | 2026-08-03 | expected | multi<br>line |',
    '| Ask him | Other | R400 \\| ish | when he pays | maybe \\| dunno | he never wrote it down |',
    '',
    '## Envelopes', '',
    '| Envelope | Amount | Note | Tint |',
    '|---|---:|---|---|',
    '| café ¥ 个人所得税 déjà | 1.234,56 | 50% off \\| maybe | var(--color-info) |',
    '| Mystery | who knows | no tint at all | |',
    '',
    '## Items', '',
    '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
    '|---|---|---:|---:|---|---|---|',
    '| thing — dashes | café ¥ 个人所得税 déjà | 12 000 | 0,01 | partial | Eating out | R100 @ shop |',
    '| unreadable | Mystery | tbc | tbc | nearly | | both money cells unreadable |',
    '', '',
  ].join('\n');

  {
    const first = await loadThroughApp(TYPED, 'Typed');

    /* What the loader made of the hand-typed cells, pinned before anything is
       written back — a space-grouped and a comma-decimal amount READ rather
       than truncated, and the three cells it could not read kept verbatim
       under `<key>Raw` (ISSUE 59/63). */
    eq(first.sources[0].amount, 2500.5, '"2 500,50" is read, not truncated to 2');
    eq(first.envelopes[0].amount, 1234.56, '"1.234,56" is read as one thousand two hundred');
    eq(first.items[0].amount, 12000, '"12 000" is read as twelve thousand');
    eq(first.items[0].spent, 0.01, '"0,01" is read as one cent');
    eq(first.sources[1].amountRaw, 'R400 \\| ish', 'an unreadable amount keeps the reader\'s own text, still \\|-escaped');
    eq(first.sources[1].statusRaw, 'maybe \\| dunno', 'and so does a status word the vocabulary has no room for');
    eq(first.items[1].spentRaw, 'tbc', 'both money cells on a row can be unreadable at once');

    const once = await serializeThroughApp({ Typed: first }, 'Typed');
    const second = await loadThroughApp(once, 'Typed');

    eq(second.sources, first.sources, 'every source comes back off disk exactly as it went in');
    eq(second.envelopes, first.envelopes, 'every envelope does');
    eq(second.items, first.items, 'every item does');
    eq(second.name, first.name, 'so does the display name');
    eq(second.started, first.started, 'and the start date');

    /* The bytes, not just the record. A save that rewrites a cell it was not
       asked to touch is how "1.234,56" became "0.00" on four other tables; the
       Plan copy of that contract has to be provably idempotent too. */
    const twice = await serializeThroughApp({ Typed: second }, 'Typed');
    eq(twice, once, 'a second save writes byte-identical bytes — no cell drifts on a save nobody asked for');
    ok(/\| Ask him \| Other \| R400 \\\| ish \| when he pays \| maybe \\\| dunno \|/.test(once),
      'the unreadable cells go back exactly as typed — one backslash, not two');
    ok(/^mystery: keep me$/m.test(once), 'an unmodeled frontmatter key survives the save');
    ok(/^kind: plan$/m.test(once), 'kind is stamped as plan');

    /* THE RAW IS THE READER'S TEXT ONLY WHILE THE ROW STILL HOLDS THE VALUE IT
       PRODUCED. Every in-place editor on this page assigns `amount`/`spent`/
       `status` and has no way to clear a sibling key it has never heard of —
       which is precisely why table-schema.js's writes prefer the raw only
       while `!(r[key] || 0)` and `r[key] === fallback`. Preferring it
       unconditionally makes a deliberate edit to an unreadable cell vanish on
       save: the same data loss one step to the left. */
    const edited = JSON.parse(JSON.stringify(second));
    edited.file = 'Typed';
    edited.sources[1].amount = 400;        // the reader finally asked him
    edited.items[1].status = 'done';       // and clicked the status through
    const after = await roundTrip(edited);
    eq(after.sources[1].amount, 400, 'an edited amount is written, not the raw it replaced');
    ok(!('amountRaw' in after.sources[1]), 'and a now-readable cell carries no raw');
    eq(after.items[1].status, 'done', 'an edited status is written, not the word it replaced');
    ok(!('statusRaw' in after.items[1]), 'and a now-recognised status carries no raw');
    eq(after.sources[1].statusRaw, 'maybe \\| dunno',
      'the raw beside a field nobody touched is still there — only the edited one gives way');
  }

  console.log(`plan: ${checks} checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
