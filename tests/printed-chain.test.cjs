'use strict';
/* The Dashboard's What's-left strip, as printed. 2026-11-11 audit, task 23.

   The strip prints an equation — cash − earmarked − committed − card = free —
   with a rendered − and = between the terms. Its arithmetic lived inside
   renderLeft in views/dashboard.js, some nine hundred lines of DOM, where no
   guard could reach it; committed.js printedChain(L) holds it now, pure.

   That arithmetic makes a deliberate trade, and this suite is where it is
   written down as something that can fail:

     - the printed terms ALWAYS sum to the printed result, exactly. That is
       the point: the strip is the one place on the page a reader re-adds by
       eye, so the result is derived from the rounded terms.
     - so the printed result is NOT `free` rounded. Each printed term may be
       half a unit from its true value, and the result sits up to half a unit
       PER TERM from `free`. The audit recorded "up to R1". That is the
       two-term strip; with a card term it is up to R1,50, with an earmark too
       up to R2 — witnesses below.
     - the word (free / short) is not this function's. It is whatsLeft's
       cent-precise verdict, and may disagree in sign with the number beside
       it by less than that same margin.

   And, because this was a move and not a rewrite: the function is compared
   with the arithmetic it replaced, restated here from the commit before, on
   generated inputs covering every branch.

     node tests/printed-chain.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { printedChain } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* views/dashboard.js renderLeft at 9a68c18, statement for statement. */
function asItWas(L) {
  const showCardTerm = L.cardDue > 0 && !L.cycle;
  const dCash = L.cashKnown ? Math.round(L.cash) : null;
  const dCommitted = Math.round(L.committedOther);
  const dCard = showCardTerm ? Math.round(L.cardDue) : 0;
  const showEarmark = (L.earmarked || 0) >= 1;
  const dEarmarked = showEarmark ? Math.round(L.earmarked) : 0;
  const dFree = dCash === null ? null : dCash - dEarmarked - dCommitted - dCard;
  return { showCardTerm, showEarmark, cash: dCash, earmarked: dEarmarked, committed: dCommitted, card: dCard, free: dFree };
}

/* A whatsLeft-shaped result whose `free` obeys committed.js's own identity
   (ADR-0007 · One free figure; · Earmark floored at cash). */
function left({ cash, committedOther, cardDue = 0, earmarked = 0, cycle = null, cashKnown = true }) {
  const spokenFor = Math.min(cash, earmarked);
  const free = (cycle ? cash - committedOther : cash - committedOther - cardDue) - spokenFor;
  return { cash, cashKnown, committedOther, cardDue, earmarked: spokenFor, cycle, free, short: Math.round(free * 100) < 0 };
}

/* Deterministic, so a failure names an input that fails again. */
let seed = 20261111;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const cents = max => Math.round(rnd() * max * 100) / 100;

/* ---- 1. the move changed nothing --------------------------------------- */
{
  const edge = [0, 0.004, 0.49, 0.5, 0.51, 0.99, 1, 1.49, 1.5, 2.5, -0.5, -1.5, 1e9 + 0.5];
  let n = 0;
  const compare = L => { eq(printedChain(L), asItWas(L), `printedChain equals the arithmetic it replaced for ${JSON.stringify(L)}`); n++; };
  for (let i = 0; i < 4000; i++) {
    compare(left({
      cash: rnd() < 0.1 ? edge[i % edge.length] : cents(60000) - (rnd() < 0.1 ? 5000 : 0),
      committedOther: rnd() < 0.1 ? edge[(i * 7) % edge.length] : cents(20000),
      cardDue: rnd() < 0.4 ? 0 : (rnd() < 0.1 ? edge[(i * 3) % edge.length] : cents(15000)),
      earmarked: rnd() < 0.4 ? 0 : (rnd() < 0.2 ? edge[(i * 5) % edge.length] : cents(30000)),
      cycle: rnd() < 0.3 ? { spend: 1 } : null,
      cashKnown: rnd() > 0.1,
    }));
  }
  /* Shapes a hand-built or partial result can take: the old inline code read
     them a particular way and the function must read them the same. */
  for (const L of [
    { cash: 10, cashKnown: true, committedOther: 3 },                                  // no card, no earmark fields
    { cash: 10, cashKnown: false, committedOther: 3, cardDue: 2, cycle: null, earmarked: 4 },
    { cash: 10.5, cashKnown: true, committedOther: 0, cardDue: 0, cycle: null, earmarked: null },
    { cash: 10, cashKnown: true, committedOther: 3, cardDue: -2, cycle: null, earmarked: 0 },
    { cash: -0.5, cashKnown: true, committedOther: -0.5, cardDue: 0.5, cycle: null, earmarked: 0.999 },
  ]) compare(L);
  ok(n > 4000, `${n} inputs compared`);
}

/* ---- 2. the strip adds up, always -------------------------------------- */
{
  for (let i = 0; i < 4000; i++) {
    const L = left({ cash: cents(60000), committedOther: cents(20000), cardDue: rnd() < 0.5 ? 0 : cents(15000),
      earmarked: rnd() < 0.5 ? 0 : cents(30000), cycle: rnd() < 0.3 ? { spend: 1 } : null });
    const p = printedChain(L);
    eq(p.cash - p.earmarked - p.committed - p.card, p.free, 'the printed terms sum to the printed result, exactly');
    ok([p.cash, p.earmarked, p.committed, p.card, p.free].every(Number.isInteger), 'and every one of them is a whole number, which is what money(…, 0) is handed');
    eq([p.showEarmark, p.earmarked === 0 || p.showEarmark], [L.earmarked >= 1, true], 'the earmark is a term from one unit up, and contributes nothing when it is not shown');
    eq([p.showCardTerm, p.card === 0 || p.showCardTerm], [L.cardDue > 0 && !L.cycle, true], 'the card is a term only outside a settlement cycle, and contributes nothing otherwise');
  }
  eq(printedChain(left({ cash: 100, committedOther: 30, cashKnown: false })).free, null,
    'with no cash counted there is no printed result — the view prints `free` itself beside a dash');
  eq(printedChain(left({ cash: 100, committedOther: 30, cashKnown: false })).cash, null, 'and no printed cash');
}

/* ---- 3. the trade-off, in words ----------------------------------------- */
{
  /* Half a unit per PRINTED term: cash and committed always, the card and the
     earmark when shown. An earmark below one unit is not shown and not
     subtracted, so the result is out by all of it as well. */
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const L = left({ cash: cents(5000), committedOther: cents(3000), cardDue: rnd() < 0.5 ? 0 : cents(900),
      earmarked: rnd() < 0.3 ? 0 : (rnd() < 0.3 ? cents(1) : cents(800)), cycle: rnd() < 0.2 ? { spend: 1 } : null });
    const p = printedChain(L);
    const terms = 2 + (p.showCardTerm ? 1 : 0) + (p.showEarmark ? 1 : 0);
    const hidden = p.showEarmark ? 0 : L.earmarked;
    const off = Math.abs(p.free - L.free);
    ok(off <= terms * 0.5 + hidden + 1e-9,
      `the printed result is within half a unit per printed term of free (${off.toFixed(2)} off over ${terms} terms${hidden ? `, ${hidden} hidden earmark` : ''})`);
    worst = Math.max(worst, off);
  }
  ok(worst > 1, `and the margin is really used: the generated strips came as far as ${worst.toFixed(2)} from free`);

  /* The plain strip — cash and committed — is the "up to R1" the audit
     recorded: never a whole unit out. */
  for (let i = 0; i < 20000; i++) {
    const L = left({ cash: cents(5000), committedOther: cents(3000) });
    ok(Math.abs(printedChain(L).free - L.free) < 1, 'two terms: the printed result is less than one unit from free');
  }

  /* Witnesses past one unit, each done in the head. */
  const card = left({ cash: 1000.49, committedOther: 100.5, cardDue: 50.5 });
  eq([printedChain(card).free, Math.round(card.free * 100) / 100], [848, 849.49],
    'with a card term: 1 000 − 101 − 51 prints 848 where free is 849,49 — R1,49 out');
  const four = left({ cash: 1000.49, committedOther: 100.5, cardDue: 50.5, earmarked: 20.5 });
  eq([printedChain(four).free, Math.round(four.free * 100) / 100], [827, 828.99],
    'with an earmark too: 1 000 − 21 − 101 − 51 prints 827 where free is 828,99 — R1,99 out');
  const hidden = left({ cash: 1000.5, committedOther: 100.49, earmarked: 0.99 });
  eq([printedChain(hidden).free, printedChain(hidden).showEarmark, Math.round(hidden.free * 100) / 100], [901, false, 899.02],
    'an earmark under one unit is not a term: 1 001 − 100 prints 901 where free is 899,02');

  /* The word is not this function's. A strip thirty cents short prints a
     number built from rounded terms beside the word whatsLeft chose in cents. */
  const nearly = left({ cash: 100.2, committedOther: 100.5 });
  eq([nearly.short, printedChain(nearly).free], [true, -1], 'thirty cents short reads "R 1 short": the word from the cents, the number from the rounded terms');
  const flip = left({ cash: 100.5, committedOther: 100.6 });
  eq([flip.short, printedChain(flip).free], [true, 0], 'and ten cents short can read "R 0 short" — the number cannot be asked which side of zero it is on');
  const sign = left({ cash: 100.5, committedOther: 100.49, cardDue: 0.4 });
  eq([sign.short, printedChain(sign).free], [true, 1],
    'with a third term it can even print R 1 beside "short" — the bounded disagreement the strip accepts so that its terms add up');
}

/* ---- 4. on the page, and out of the view ---------------------------------- */
(async () => {
  /* The strip as the three committed households print it, read off the real
     Dashboard: the terms on screen sum to the result on screen. */
  const { stubObsidian } = require('./helpers/harness.cjs');
  stubObsidian();
  const { mountFor, harvestView, pinClock } = require('./helpers/figures.cjs');
  let strips = 0;
  for (const name of ['household', 'household2', 'household-fx']) {
    const H = require(`./figures/${name}.cjs`);
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const figs = harvestView(M.ctx, M.nodes, M.raws, { view: 'dashboard', fn: 'renderDashboard' }).figures;
      M.restore();
      const term = n => { const f = figs.find(x => x.address === `leftBody/@left-${n}`); return f ? f.raw : null; };
      const cash = term('cash');
      if (cash === null) continue;        // a household whose card is not drawn has no strip to add up
      const result = term('free') !== null ? term('free') : -term('short');
      eq(cash - (term('earmarked') || 0) - term('committed') - (term('card') || 0), result,
        `${name}: the strip on the Dashboard adds up as printed (${cash} − ${term('earmarked') || 0} − ${term('committed')} − ${term('card') || 0} = ${result})`);
      strips++;
    } finally { unpin(); }
  }
  ok(strips >= 2, `the strip was read off real pages (${strips} households)`);

  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'dashboard.js'), 'utf8');
  ok(/=\s*printedChain\(L\);/.test(view), 'renderLeft takes its printed terms from printedChain(L)');
  for (const gone of ['Math.round(L.cash)', 'Math.round(L.committedOther)', 'Math.round(L.cardDue)', 'Math.round(L.earmarked)']) {
    eq(view.includes(gone), false, `views/dashboard.js no longer rounds a chain term itself (${gone}) — a second spelling there is how the strip stops adding up`);
  }

  console.log(`PASS printed-chain — the strip adds up as printed, and sits within half a unit per term of free (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
