'use strict';
/* Four small Score copy findings from the 2026-10-20 audit, each pinned on the
   REAL page over the committed household (clock pinned).

   M1-12  The flow card's subtitle said "Every rand that came in this period",
          but its Money in is BUDGET income only — a windfall marked Excluded
          came in and is not on the card. It names its income now.
   MT-09  "Completed" was green text in the parts list and an amber pill under
          "What is going well", one page apart. One tone now: the parts list's,
          by one class.
   D1-15  Sentences glued without a stop: "worth 2,40 years of income Plus € 300
          held in other currencies" and "goal 6 months Essentials average
          R 9 000 a month." The row's own " · " separator joins them now.
   D2-12  "R X set aside" in the reserves row is the emergency-fund earmarks
          (health-math.js resolveEarmarks), not money set aside in the budget's
          sense (CONTEXT.md "Set-aside" is the sending side of a savings-typed
          category). It says "in your emergency funds".

     node tests/score-copy-2026-10-20.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend, readable } = require('./helpers/dom-stub.cjs');
const { SEED, PERIOD, TODAY } = require('./figures/household.cjs');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? readable(e.textContent) : '');
const classesOf = e => [...(e._cls || [])].sort();

(async () => {
  const unpin = pinClock(TODAY);
  process.on('exit', unpin);
  const { ctx, nodes } = await mountFor(SEED, { period: PERIOD });
  ctx.switchView = () => {};
  ctx.renderScore();
  const view = nodes.get('#view-score');
  const hero = nodes.get('#scoreHero');
  const now = key => textOf(descend(descend(hero).find(e => hasCls(e, 'score-ring-row') && e.getAttribute('data-k') === key))
    .find(e => hasCls(e, 'score-ring-row-now')));

  /* ---- M1-12: the subtitle names the income the card shows ------------- */
  {
    const card = descend(view).find(e => hasCls(e, 'score-flow-card'));
    const sub = textOf(descend(card).find(e => hasCls(e, 'sub')));
    eq(sub, i18n.t('score.flow.sub'), 'the flow card prints its subtitle key');
    ok(/budget income/.test(sub), `and it says the rands are budget income — got: ${sub}`);
    ok(!/came in/.test(sub), 'not "every rand that came in", which a windfall marked Excluded did and is not here');
  }

  /* ---- MT-09: one "Completed", one tone --------------------------------- */
  {
    const label = i18n.t('score.win.fullMarks');
    const inRing = descend(hero).filter(e => textOf(e) === label && e.tagName === 'SPAN');
    const inWins = descend(nodes.get('#scoreGood')).filter(e => textOf(e) === label && e.tagName === 'SPAN');
    ok(inRing.length > 0 && inWins.length > 0, `fixture check: a part at full marks is "Completed" in both lists (${inRing.length}, ${inWins.length})`);
    for (const w of inWins) {
      eq(classesOf(w), classesOf(inRing[0]), 'the "What is going well" badge wears the parts list\'s class, so the two cannot differ in tone');
      ok(!hasCls(w, 'score-win-ribbon'), 'and not the amber pill');
    }
  }

  /* ---- D1-15: fragments joined by the row's separator ------------------- */
  {
    const wealth = now('wealth');
    const plus = i18n.t('acct.hero.otherCurrencies', { list: '§' }).trim().split('§')[0];
    ok(wealth.includes(` · ${plus}`), `the other-currency sentence follows a " · " — got: ${wealth}`);
    ok(!/income\)? Plus/.test(wealth), 'never glued to the clause before it');
    ok(!/ {2}/.test(wealth), 'and no doubled space where two leading-space sentences met');
    const reserves = now('reserves');
    const ess = i18n.t('score.now.reserves.essentials', { amount: '§' }).split('§')[0];
    ok(reserves.includes(` · ${ess}`), `"goal N months · Essentials average …" — got: ${reserves}`);
    ok(!/months Essentials/.test(reserves), 'not "goal 6 months Essentials average"');
  }

  /* ---- D2-12: the reserves amount is the emergency funds ---------------- */
  {
    const reserves = now('reserves');
    const H = ctx.healthSnapshot();
    ok(reserves.includes(`${readable(ctx.money(H.earmarks.total, 0))} in your emergency funds`),
      `the earmarked total, said as what it is — got: ${reserves}`);
    ok(!/set aside/.test(reserves), 'not "set aside", the budget\'s word for money sent under a savings category');
  }

  console.log(`PASS score-copy-2026-10-20 (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
