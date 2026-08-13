'use strict';
/* Who an account belongs to.

   A household budget can be two people's, and until this key existed the
   Accounts page could total everything and split nothing. `owners:` in
   Settings.md declares the people; `owner:` on an account names one of them,
   the reserved word `joint`, or nobody.

   Seven invariants, pinned because each one is a way this feature could quietly
   corrupt a file rather than merely look wrong:

     1. the settings line parses in every spelling the two readers produce
     2. an account's owner survives the loader verbatim
     3. a NEW account writes its owner (the build-from-model save path, which is
        the one addAccount takes and the easiest to forget)
     4. an EXISTING account's owner round-trips through the patch path without
        disturbing anything else in the frontmatter
     5. an owner the settings no longer declare keeps its account, and is still
        offered by the dropdown — settings say what the form OFFERS, not what a
        file is allowed to say
     6. the per-owner split sums to the same net figure the hero states
     7. a one-person vault renders exactly the page it had before this existed —
        no card, no chips, no owner row in the drawer

   Runs in bare node against the in-memory vault. Every figure is synthetic.
     node tests/account-owner.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const owners = require('../src/owners');
const { parseOwners, ownerKey, ownerLabel, ownerOptions, netByOwner, JOINT } = owners;

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nowners: "Alex, Sam"\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',

  [`${B}/Accounts/His Cheque.md`]:
    '---\ntype: checking\ninstitution: "Bank A"\nowner: Alex\nbalance: 12000.00\nbalance_updated: 2026-07-01\naliases: [cheque]\n---\n\n# His Cheque\n\nBody survives.\n',
  [`${B}/Accounts/Her Cheque.md`]:
    '---\ntype: checking\nowner: Sam\nbalance: 8000.00\nbalance_updated: 2026-07-01\n---\n',
  // Spelled differently from the settings line on purpose — a hand-edited vault
  // is a supported way to use this app, and two spellings are one person.
  [`${B}/Accounts/Her Card.md`]:
    '---\ntype: credit_card\nowner: sam\ncredit_limit: 30000\nbalance: -3000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Bond.md`]:
    '---\ntype: other\nowner: joint\nbalance: -500000.00\nbalance_updated: 2026-07-01\n---\n',
  // An owner the settings do not declare. It must not vanish.
  [`${B}/Accounts/Trust Fund.md`]:
    '---\ntype: investment\nowner: "Ouma"\nbalance: 40000.00\nbalance_updated: 2026-07-01\n---\n',
  // No owner at all — the "unassigned" bucket.
  [`${B}/Accounts/Petty Cash.md`]:
    '---\ntype: cash\nbalance: 500.00\nbalance_updated: 2026-07-01\n---\n',
};

/* Mounts the Accounts view over the real DOM stub, the same way
   views-render.test.cjs does — the render assertions below have to run against
   the real markup, not against a claim about it. */
async function mount(files = FILES) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, $ };
}

const textOf = root => descend(root).map(n => n.textContent || '').join(' | ');

(async () => {
  /* ------------------- 1. the settings line, every spelling ------------- */
  eq(parseOwners('Alex, Sam'), ['Alex', 'Sam'], 'a comma list parses');
  eq(parseOwners('  Alex ,  Sam  '), ['Alex', 'Sam'], 'whitespace around the names is trimmed');
  eq(parseOwners('[Alex, Sam]'), ['Alex', 'Sam'],
    'a YAML flow list arrives as literal text from load.js\'s line parser and must not read as one person');
  eq(parseOwners(['Alex', 'Sam']), ['Alex', 'Sam'],
    'metadataCache hands the settings tab a real array for the same line');
  eq(parseOwners('Alex, alex, Sam'), ['Alex', 'Sam'],
    'one person spelled twice is one person, keeping the FIRST spelling');
  eq(parseOwners(''), [], 'a blank line is a one-person household');
  eq(parseOwners(undefined), [], 'an absent key is a one-person household — every vault before this feature');
  eq(parseOwners('Alex, , ,'), ['Alex'], 'stray commas do not declare anonymous people');

  eq(ownerKey('  Sam '), 'sam', 'the comparison key is trimmed and folded');
  eq(ownerKey(undefined), '', 'no owner is the empty key, not "undefined"');
  eq(ownerKey('Joint'), JOINT, 'a hand-typed Joint is the reserved value');

  /* ------------------------ 2. through the loader ----------------------- */
  const { ctx, S } = await mount();
  const byName = n => S.accounts.find(a => a.name === n);

  eq(S.settings.owners, ['Alex', 'Sam'], 'the loader parses the settings line onto S');
  eq(byName('His Cheque').owner, 'Alex', 'an account carries its owner');
  eq(byName('Her Card').owner, 'sam',
    'the file\'s own spelling is kept verbatim — owners.js decides what it MEANS, the loader does not');
  eq(byName('Bond').owner, 'joint', 'the reserved value loads like any other');
  eq(byName('Trust Fund').owner, 'Ouma', 'an undeclared owner is still an owner');
  eq(byName('Petty Cash').owner, '', 'an absent key is no owner, not undefined');

  /* ------------------- 3. a NEW account writes its owner ---------------- */
  /* addAccount reaches saveAccount through the build-from-model branch (a fresh
     account has no fmRaw to patch). That branch names every key it writes, so an
     owner missing from it is an owner the create form collects and discards —
     invisible until someone reopens the file. */
  {
    const fresh = {
      name: 'New Pot', type: 'savings', institution: '', owner: 'Sam',
      account_number: '', tx_label: '', currency: '', ignore_warnings: '',
      balance: 100, balance_updated: '2026-07-01', in_budget: true,
      credit_limit: null, goal_amount: null, target_date: '',
      monthly_contribution: null, total_invested: null,
      starting_amount: null, inception_date: '', tags: '', body: '\n\n# New Pot\n',
    };
    await ctx.saveAccount(fresh);
    const written = await ctx.readFile('Accounts/New Pot.md');
    ok(/^owner: "?Sam"?$/m.test(written),
      `a newly created account writes its owner line — got:\n${written}`);
  }

  /* -------------- 4. an EXISTING account round-trips its owner ---------- */
  /* The patch branch, which is what the edit dialog takes. The claim it has to
     keep is "everything else byte for byte": an owner change must not disturb
     the aliases line this app does not model. */
  {
    const a = byName('His Cheque');
    a.owner = 'joint';
    await ctx.saveAccount(a, ctx.ACCOUNT_FM_KEYS);
    const written = await ctx.readFile('Accounts/His Cheque.md');
    ok(/^owner: "?joint"?$/m.test(written), `the owner is patched — got:\n${written}`);
    ok(written.includes('aliases: [cheque]'), 'an unmodeled key survives the patch untouched');
    ok(written.includes('Body survives.'), 'the body survives the patch');

    // And clearing it REMOVES the line rather than writing an empty one, the
    // same contract institution and currency keep.
    a.owner = '';
    await ctx.saveAccount(a, ctx.ACCOUNT_FM_KEYS);
    const cleared = await ctx.readFile('Accounts/His Cheque.md');
    ok(!/^owner:/m.test(cleared), `clearing the owner removes the key — got:\n${cleared}`);
    a.owner = 'Alex';                       // put it back for the bands below
    await ctx.saveAccount(a, ctx.ACCOUNT_FM_KEYS);
  }

  /* ------------- 5. an undeclared owner keeps its account --------------- */
  {
    const declared = S.settings.owners;
    const opts = ownerOptions(declared, S.accounts);
    eq(opts.slice(0, 3), ['Alex', 'Sam', JOINT],
      'the declared people come first, then Joint — the dropdown order the form offers');
    ok(opts.includes('Ouma'),
      'an owner the settings do not declare is STILL offered, or saving any other field on that '
      + 'account would silently reassign it to whatever the control fell back to');
    eq(opts.filter(v => v.toLowerCase() === 'sam'), ['Sam'],
      'a person is offered once, not once per spelling found in the files');

    eq(ownerLabel('sam', declared), 'Sam',
      'a declared owner reads with the settings spelling, so fixing it in one place fixes every tile');
    eq(ownerLabel('Ouma', declared), 'Ouma', 'an undeclared owner reads exactly as its file spells it');
    eq(ownerLabel(JOINT, declared), 'Joint', 'the reserved value is translated on the way to the screen');
    ok(ownerLabel('', declared).length > 0, 'unassigned has a label of its own, not a blank cell');
  }

  /* --------------- 6. the split adds up to the same total --------------- */
  {
    const rows = netByOwner(S.accounts, S.settings.owners);
    const net = S.accounts.reduce((s, a) => s + a.balance, 0);
    eq(rows.reduce((s, r) => s + r.net, 0), net,
      'every account is in exactly one bucket, so the split sums to the household net');
    eq(rows.reduce((s, r) => s + r.count, 0), S.accounts.length,
      'and every account is counted exactly once');

    const get = k => rows.find(r => r.key === k);
    eq(get('sam').net, 8000 - 3000,
      'both spellings of one person land in one bucket — this is the whole reason for ownerKey');
    eq(get('sam').count, 2, 'and both accounts are counted there');
    eq(get(JOINT).net, -500000, 'a joint liability is a negative bucket, not a dropped one');
    eq(get('').count, 1, 'the unassigned account gets its own row — a breakdown that omitted it would not sum');
    eq(rows[rows.length - 1].key, '', 'unassigned sorts last: it is the absence of an answer, not one of them');
    eq(rows.map(r => r.key).slice(0, 3), ['alex', 'sam', JOINT],
      'the declared people keep their settings order, then Joint, then the strays');
  }

  /* --------------- 7. the page renders, and can be filtered ------------- */
  {
    ctx.renderAccounts();
    const summary = ctx.$('#acctSummary');
    ok(descend(summary).some(n => n._cls && n._cls.has('acct-owners')),
      'a two-owner vault gets the "Whose it is" card');
    ok(textOf(summary).includes('Sam'), 'and names the people in it');

    const chips = ctx.$('#acctOwners');
    const chipEls = descend(chips).filter(n => n._cls && n._cls.has('acct-seg'));
    // Everyone + Alex + Sam + Joint + Ouma + unassigned
    eq(chipEls.length, 6, 'one chip per bucket, plus the "Everyone" chip that clears the filter');

    // The owner reaches the ledger row, so a reader can see whose an account is
    // without opening its drawer.
    ok(textOf(ctx.$('#acctTable')).includes('Ouma'),
      'the row subtitle carries the owner alongside the kind and the bank');

    /* Filtering. Driven through the chip's own click handler rather than by
       setting S.acctView directly — the handler is the thing that has to work,
       and reaching past it would test a private field instead of the feature. */
    const samChip = chipEls.find(n => (n.textContent || '').includes('Sam'));
    ok(samChip, 'there is a Sam chip to click');
    samChip._fire('click');
    eq(S.acctView.owner, 'sam', 'clicking a chip sets the owner filter');
    const shown = descend(ctx.$('#acctTable')).filter(n => n._cls && n._cls.has('acct-row'));
    eq(shown.length, 2, 'the ledger shows only that owner\'s accounts');

    // The kind chips have to be counted WITHIN the owner, or the two rows
    // contradict each other on screen.
    const bankChip = descend(ctx.$('#acctFilters'))
      .filter(n => n._cls && n._cls.has('acct-seg'))
      .find(n => (n.textContent || '').includes('Bank'));
    ok(bankChip && /2$/.test((bankChip.textContent || '').trim()),
      `the Bank count is scoped to Sam (cheque + card), got "${bankChip && bankChip.textContent}"`);

    samChip._fire('click');
    eq(S.acctView.owner, 'sam',
      're-clicking the chip you are on is a no-op, not a toggle — "Everyone" is how you clear it');
  }

  /* ------------- 8. a one-person vault is exactly what it was ----------- */
  {
    const { ctx: solo, S: soloS } = await mount({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Accounts/Pot.md`]: '---\ntype: savings\nbalance: 200.00\nbalance_updated: 2026-07-01\n---\n',
    });
    eq(soloS.settings.owners, [], 'no owners line means no declared people');
    solo.renderAccounts();
    ok(!descend(solo.$('#acctSummary')).some(n => n._cls && n._cls.has('acct-owners')),
      'no "Whose it is" card — a split with one row answers a question nobody asked');
    eq(descend(solo.$('#acctOwners')).filter(n => n._cls && n._cls.has('acct-seg')).length, 0,
      'no owner chips either');
    eq(solo.$('#acctOwners').className, '',
      'and the band is left classless, so a bare div reserves no space on the page');

    // Opening a drawer must not offer an Owner row on a page with no owners.
    solo.renderAccounts();
    soloS.acctView.open = 'Cheque';
    solo.renderAccounts();
    const drawer = descend(solo.$('#acctTable')).find(n => n._cls && n._cls.has('acct-drawer'));
    ok(drawer, 'the drawer opens');
    ok(!textOf(drawer).match(/\bOwner\b/), 'and says nothing about an owner');
  }

  /* ---------- 9. a starting amount of ZERO is a real baseline ------------
     Not an owner question, but it lives in the same FM_WRITERS table and is
     the same shape of bug: a truthy test where `!= null` was meant.

     savings-math.js states the case outright — an account opened empty and
     funded entirely by transfer has `starting_amount: 0`, and that must not
     fall through to basis 'none'. Under the truthy test 0 wrote null, and null
     REMOVES the key: type 0, save, reload, and the growth block vanished while
     the card offered "Add starting amount" again. The behaviour the maths
     module documents was unreachable through the app.

     Both writers are checked, because there are two — the patch branch an edit
     takes and the build-from-model branch a fresh account takes — and fixing
     one leaves the bug reachable from the other half of the UI. */
  {
    const acct = byName('His Cheque');
    acct.starting_amount = 0;
    await ctx.saveAccount(acct, ctx.ACCOUNT_FM_KEYS);
    const patched = await ctx.readFile('Accounts/His Cheque.md');
    ok(/^starting_amount: 0\.00$/m.test(patched), `zero is written, not dropped — got:\n${patched}`);

    // The contract it must NOT break: absent still means absent.
    acct.starting_amount = null;
    await ctx.saveAccount(acct, ctx.ACCOUNT_FM_KEYS);
    ok(!/^starting_amount:/m.test(await ctx.readFile('Accounts/His Cheque.md')),
      'while a genuinely absent starting amount still writes no key at all');

    const pot = {
      name: 'Empty Pot', type: 'savings', institution: '', owner: '',
      account_number: '', tx_label: '', currency: '', ignore_warnings: '',
      balance: 0, balance_updated: '2026-07-01', in_budget: true,
      credit_limit: null, goal_amount: null, target_date: '',
      monthly_contribution: null, total_invested: null,
      starting_amount: 0, inception_date: '2026-01-01', tags: '', body: '\n\n# Empty Pot\n',
    };
    await ctx.saveAccount(pot);
    ok(/^starting_amount: 0\.00$/m.test(await ctx.readFile('Accounts/Empty Pot.md')),
      'and a NEW account created with zero keeps it too');

    /* The whole point of writing it: the loader reads it back as a NUMBER, so
       totalReturn sees a baseline rather than nothing. */
    await ctx.loadVault();
    const loaded = ctx.S.accounts.find(x => x.name === 'Empty Pot');
    eq(typeof loaded.starting_amount, 'number', 'and it survives the round trip as a number');
    eq(loaded.starting_amount, 0, 'holding the value the user actually typed');
  }

  console.log(`account-owner.test.cjs — ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
