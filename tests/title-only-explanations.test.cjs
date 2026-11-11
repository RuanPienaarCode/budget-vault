'use strict';
/* A reason that is only a hover tooltip is a reason most readers never get.

   Nine flags on four pages said WHAT and kept the WHY in a `title=` on a
   <span>: Services' "not seen", "last charged 4mo ago", "billed in €",
   "varies" and "really R 219"; the import review's "transfer" and
   "transfer?"; Owed's partly-repaid breakdown; Notes' "unmatched". A <span>
   takes no focus, so a keyboard never reaches it, and a phone has no hover at
   all — on the platform this plugin treats as first-class, "not seen" was a
   grey word with nothing behind it (audit of 11 Nov 2026, task 18).

   src/dom.js caveatChip() already existed for this: a real <button> that
   reveals its reason on tap, with aria-expanded, keeping `title` as the
   desktop-hover bonus. Each flag is now one. The badges keep their colours —
   a price ABOVE the listed one is still the debt colour, below it the savings
   colour — by the chip taking the badge's classes instead of its own
   (caveatChip's third argument).

   Pinned, on the real views:

     A. the component: a chip given a class wears it, and is otherwise the
        same chip (a button, type=button, aria-expanded, a hidden detail).
     B. Services: every flag is a button carrying its badge colour, and its
        reason is on the page, hidden until asked for, word for word.
     C. Import: the same for "transfer" and "transfer?".
     D. Owed: a partly-repaid entry carries its breakdown in a chip.
     E. Notes: "unmatched" is a chip that explains, and re-pointing is still
        one button away on the same card.
     F. on those pages, NOTHING that cannot take focus carries a title whose
        text is not also on the page. The sweep is what catches the tenth.

     node tests/title-only-explanations.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { household, servicesPage } = require('./helpers/services-page.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const FOCUSABLE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY']);
const has = (n, cls) => n._cls && n._cls.has(cls);

/* One flag, read the way a reader meets it. `node` is the element carrying
   the flag's badge class. */
function isChip(node, what) {
  eq(node.tagName, 'BUTTON', `${what}: the flag is a real button, so a keyboard reaches it`);
  eq(node.getAttribute('type'), 'button', `${what}: type=button`);
  eq(node.getAttribute('aria-expanded'), 'false', `${what}: starts collapsed, and says so`);
  const wrap = node._parent;
  ok(wrap && has(wrap, 'caveat-chip'), `${what}: built by caveatChip`);
  const detail = wrap.children.find(c => c !== node);
  ok(detail && has(detail, 'hidden'), `${what}: the reason is on the page, hidden until asked for`);
  ok(detail.textContent.length > 20, `${what}: and it is a sentence, not a stub`);
  eq(detail.textContent, node.getAttribute('title'), `${what}: word for word what the tooltip said`);
  node.click();
  eq(node.getAttribute('aria-expanded'), 'true', `${what}: a tap opens it`);
  ok(!has(detail, 'hidden'), `${what}: and the reason is shown`);
  node.click();
  ok(has(detail, 'hidden'), `${what}: a second tap puts it away`);
  return detail.textContent;
}

/* F. Nothing unfocusable under `root` hides its only explanation in a title. */
function sweep(root, page) {
  const pageText = root.textContent;
  const bad = descend(root).filter(n => n.attrs && n.attrs.title && !FOCUSABLE.has(n.tagName)
    && !pageText.includes(n.getAttribute('title')));
  eq(bad.map(n => `<${n.tagName.toLowerCase()} class="${n.className}"> ${n.getAttribute('title').slice(0, 50)}`), [],
    `${page}: no unfocusable element carries a title that is not also on the page`);
}

(async () => {
  /* ---- A. the component --------------------------------------------------- */
  {
    require('./helpers/dom-stub.cjs').installDom();
    const { caveatChip } = require('../src/dom');
    const plain = caveatChip('short', 'the long reason for it');
    eq(plain.children[0].className, 'caveat-chip-btn', 'with no class asked for, the chip is the chip it always was');
    const badge = caveatChip('not seen', 'the long reason for it', 'category-badge badge-dup');
    const btn = badge.children[0];
    eq(btn.className, 'category-badge badge-dup', 'a chip given a class wears that class instead of its own');
    isChip(btn, 'a badge chip');
  }

  const unpin = pinClock('2026-10-15');
  try {
    /* ---- B. Services -------------------------------------------------------- */
    {
      const page = await servicesPage(household({
        services: [
          '| Ghost | NOWHERE | 99.00 | monthly | 2026-11-01 | Bills | yes | | |',
          '| Stream | STREAMCO | 199.00 | monthly | 2026-11-02 | Bills | yes | | |',
          '| Lapsed | OLDGYM | 300.00 | monthly | 2026-11-01 | Bills | yes | | |',
        ],
        tx: { Cheque: {
          '2026-10': ['| 2026-10-02 | STREAMCO | Bills | -219.00 |  |  |  |'],
          '2026-09': ['| 2026-09-02 | STREAMCO | Bills | -219.00 |  |  |  |'],
          '2026-08': ['| 2026-08-02 | STREAMCO | Bills | -219.00 |  |  |  |'],
          '2026-03': ['| 2026-03-05 | OLDGYM | Bills | -300.00 |  |  |  |'],
          '2026-02': ['| 2026-02-05 | OLDGYM | Bills | -300.00 |  |  |  |'],
        } },
      }));
      ok(!page.error, `the Services page renders${page.error ? ': ' + page.error.message : ''}`);
      const table = page.M.nodes.get('#svcTable');
      const flags = descend(table).filter(n => has(n, 'category-badge'));
      const text = n => n.textContent.trim();
      const flag = re => flags.find(n => re.test(text(n)));

      const unseen = flag(/^not seen$/);
      ok(unseen, 'a service no charge matches is flagged "not seen"');
      ok(/NOWHERE/.test(isChip(unseen, 'not seen')), 'and its reason names the provider it looked for');
      ok(has(unseen, 'badge-dup'), 'not seen keeps its neutral colour');

      const really = flag(/^really /);
      ok(really, 'a service charged at another price is flagged "really …"');
      ok(/219/.test(isChip(really, 'really')), 'and its reason states the price the bank is charging');
      ok(has(really, 'badge-debt'), 'a price above the listed one keeps the debt colour');

      const lapsed = flag(/^last charged \d+mo ago$/);
      ok(lapsed, 'an active service that has gone quiet is flagged');
      ok(/cancelled\?/.test(isChip(lapsed, 'last charged')), 'and its reason asks the question the flag is there to ask');

      for (const n of flags) eq(n.tagName, 'BUTTON', `Services: the "${text(n)}" flag is a button`);
      sweep(table, 'Services');

      /* The two flags this household does not earn ("varies", "billed in …")
         are built by the same function, so the source is held to it as well. */
      const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'views', 'services.js'), 'utf8');
      const fn = /function svcFlags\(s, c\) \{[\s\S]*?\n  \}\n/.exec(src);
      ok(fn, 'svcFlags is still recognisable in views/services.js');
      ok(!/el\('span', \{ class: [`']category-badge/.test(fn[0]), 'svcFlags builds no bare badge <span> — every flag goes through the chip');
      ok(/const flag = \(badge, text, why\) => caveatChip\(/.test(src), 'the page\'s `flag` helper is caveatChip wearing a badge');
      eq((fn[0].match(/\bflag\(/g) || []).length, 5, 'and all five flags are built with it');
    }

    /* ---- C. Import ---------------------------------------------------------- */
    {
      const B = 'Budget';
      const FILES = {
        [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
        [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
        [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\naccount_number: "62000000001"\nbalance: 0.00\nbalance_updated: 2026-09-01\n---\n',
        [`${B}/Accounts/Savings.md`]: '---\ntype: savings\naccount_number: "62000000002"\nbalance: 5000.00\nbalance_updated: 2026-09-30\n---\n',
        [`${B}/Transactions/Savings/2026-09.md`]: '---\naccount: "Savings"\nmonth: 2026-09\n---\n\n'
          + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
          + '| 2026-09-26 | IB TRANSFER FROM 62000000001 |  | 5000.00 | yes |  |\n',
      };
      const CSV = 'Date,Description,Amount\n'
        + '2026-09-20,SALARY ACME PAYROLL,20000.00\n'
        + '2026-09-25,IB TRANSFER TO 62000000002,-5000.00\n'
        + '2026-09-27,ACME CO 62000000002,5000.00\n';
      const ctx = makeCtx(FILES);
      const S = await loadInto(ctx);
      S.period = '2026-09';
      const { $ } = makeDom();
      ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
      ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
      const { el } = require('../src/dom');
      ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
      require('../src/categories')(ctx);
      for (const f of ['dashboard', 'transactions', 'import']) require(`../src/views/${f}`)(ctx);
      ctx.render = () => {}; ctx.switchView = () => {};
      await ctx.handleStatementFile({ name: 'cheque.csv', async arrayBuffer() { return Buffer.from(CSV, 'utf8'); } });
      S.pendingImport.label = 'Cheque';
      ctx.renderImportReview();
      const table = $('#impTable');
      const [proven, suggested] = descend(table).filter(n => has(n, 'badge-transfer'));
      ok(proven && suggested, 'the review flags a proven transfer and a suggested one');
      eq([proven.textContent, suggested.textContent], ['transfer', 'transfer?'], 'in that order');
      ok(/2026-09-26/.test(isChip(proven, 'transfer')), 'the proven one\'s reason cites the leg that proved it');
      ok(/tick Exclude/.test(isChip(suggested, 'transfer?')), 'the suggested one\'s reason says how to exclude it');
      sweep(table, 'Import review');
    }

    /* ---- D. Owed ------------------------------------------------------------ */
    {
      const B = 'Budget';
      const M = await mountFor({
        [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
        [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n'
          + '| Sam | 250.00 | lunch | | outstanding | 100.00 |\n| Lee | 400.00 | tools | | outstanding | |\n',
      }, { period: '2026-10', budgetFolder: B });
      M.ctx.renderOwed();
      const table = M.ctx.$('#owedTable');
      const rows = descend(table).filter(n => n.tagName === 'TR' && n._parent.tagName === 'TBODY');
      const chips = tr => descend(tr).filter(n => has(n, 'caveat-chip-btn'));
      eq(chips(rows[0]).length, 1, 'a partly-repaid entry carries one chip');
      eq(chips(rows[1]).length, 0, 'an entry nothing has come back on carries none');
      const chip = chips(rows[0])[0];
      ok(/100/.test(chip.textContent), 'the chip states what has come back');
      const why = isChip(chip, 'owed breakdown');
      ok(/250/.test(why) && /100/.test(why) && /150/.test(why), 'and its reason is the whole breakdown: lent, back, outstanding');
      sweep(table, 'Owed');
    }

    /* ---- E. Notes ----------------------------------------------------------- */
    {
      const B = 'Budget';
      const M = await mountFor({
        [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
        [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-10-01\n---\n',
        [`${B}/Notes/2026-10-01 Old card.md`]: '---\nnote_kind: account\nnote_subject: "Closed Card"\ncreated: 2026-10-01\n---\n\nA note about an account that was renamed.\n',
      }, { period: '2026-10', budgetFolder: B });
      M.ctx.renderNotes();
      const list = M.ctx.$('#notesList');
      const orphan = descend(list).find(n => has(n, 'note-orphan'));
      ok(orphan, 'a note whose subject is gone is flagged');
      ok(/unmatched/.test(orphan.textContent), 'as "unmatched"');
      const why = isChip(orphan, 'unmatched');
      ok(/Closed Card/.test(why), 'its reason names the subject that no longer exists');
      ok(/Change subject/.test(why), 'and points at the button that fixes it');
      const card = descend(list).find(n => has(n, 'note-card'));
      ok(descend(card).some(n => n.tagName === 'BUTTON' && /Change subject/.test(n.textContent)),
        'which is on the same card');
      sweep(list, 'Notes');
    }
  } finally {
    unpin();
  }

  console.log(`PASS title-only-explanations — every flag's reason is a tap or a Tab away, not a hover (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
