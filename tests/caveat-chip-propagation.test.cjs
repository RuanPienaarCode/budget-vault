'use strict';
/* A caveat chip's tap belongs to the chip.

   caveatChip (src/dom.js) exists so a caveat is reachable by tap on a phone,
   where a `title=` tooltip never shows. On the Accounts page the "ignored" chip
   sits INSIDE a table row whose own click opens the row's drawer — and the
   chip's click bubbled up to it: the drawer opened, the re-render threw the
   just-expanded chip away, and the explanation never showed (audit of
   7 Oct 2026, confirmed in a browser on a household with three ignored
   warnings). views/accounts.js's own statePill comment says the chip is there
   precisely for that tap.

   The dom-stub does not bubble (deliberately — see its _fire), so this file
   carries a ten-line dispatcher that does, honouring stopPropagation the way a
   browser does. §A pins the component against a listening ancestor, for the
   click and for the keys that activate a button; §B drives the real Accounts
   row.

     node tests/caveat-chip-propagation.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, installDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* Fire `type` at `target` and walk it up the parent chain until something
   stops it — a real event's bubbling, in miniature. */
function dispatch(target, type, init = {}) {
  let stopped = false;
  const stopPropagation = () => { stopped = true; };
  for (let n = target; n && !stopped; n = n._parent) {
    for (const fn of (n._on && n._on[type]) || []) {
      fn({ type, target, currentTarget: n, preventDefault() {}, stopPropagation, ...init });
    }
  }
  return stopped;
}

(async () => {
  /* ---- §A the component, inside an ancestor that listens ---- */
  installDom();
  const { caveatChip, el } = require('../src/dom');
  {
    const heard = { click: 0, keydown: [] };
    const row = el('div', {});
    row.addEventListener('click', () => { heard.click++; });
    row.addEventListener('keydown', e => { heard.keydown.push(e.key); });
    const chip = caveatChip('short', 'the reason in full');
    row.append(chip);
    const btn = chip.children.find(c => c.tagName === 'BUTTON');
    const detail = chip.children.find(c => c !== btn);

    dispatch(btn, 'click');
    eq(heard.click, 0, 'a tap on the chip does not reach the row it sits in');
    eq(btn.getAttribute('aria-expanded'), 'true', 'and the chip opens');
    ok(!detail._cls.has('hidden'), 'showing the reason');

    dispatch(btn, 'keydown', { key: 'Enter' });
    dispatch(btn, 'keydown', { key: ' ' });
    eq(heard.keydown, [], 'Enter and Space — the keys that press a button — stay with the chip too');
    dispatch(btn, 'keydown', { key: 'Escape' });
    dispatch(btn, 'keydown', { key: 'Tab' });
    eq(heard.keydown, ['Escape', 'Tab'], 'every other key still reaches the page, so nothing else is swallowed');
  }

  /* ---- §B the Accounts row ---- */
  {
    const unpin = pinClock('2026-10-07');
    try {
      const B = 'Budget';
      const ctx = makeCtx({
        [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
        // No folder → 'nofolder'; muted, so its pill carries the "ignored" chip.
        [`${B}/Accounts/Petty Box.md`]: '---\ntype: cash\nbalance: 300.00\nbalance_updated: 2026-10-01\nignore_warnings: [nofolder]\n---\n',
      });
      const S = await loadInto(ctx);
      S.period = '2026-10';
      const { $ } = makeDom();
      ctx.$ = $;
      ctx.$$ = () => [];
      ctx.root = $('#root');
      ctx.view = { containerEl: $('#root') };
      ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
      ctx.switchView = () => {};
      const { el: el2 } = require('../src/dom');
      ctx.typeBadge = type => el2('span', { class: `category-badge badge-${type}` }, type);
      require('../src/categories')(ctx);
      require('../src/views/accounts')(ctx);
      ctx.render = () => ctx.renderAccounts();
      ctx.renderAccounts();

      const row = descend($('#acctTable')).find(n => n._cls.has('acct-row'));
      const btn = descend(row).find(n => n._cls.has('caveat-chip-btn'));
      ok(btn, 'fixture: the muted row carries the "ignored" chip');
      dispatch(btn, 'click');
      eq(S.acctView.open, null, 'tapping the chip does not open the row\'s drawer');
      ok($('#acctTable').contains(btn), 'so the table is not rebuilt out from under it');
      const detail = descend(btn._parent).find(n => n._cls.has('caveat-chip-detail'));
      ok(detail && !detail._cls.has('hidden'), 'and the reason the warning is quiet is on screen');

      dispatch(row, 'click');
      eq(S.acctView.open, 'Petty Box', 'a tap anywhere else on the row still opens it');
    } finally { unpin(); }
  }

  console.log(`PASS — a caveat chip keeps its own tap, inside a clickable row (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
