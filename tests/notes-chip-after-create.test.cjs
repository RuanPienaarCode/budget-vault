'use strict';
/* The notes chip on a host page went on offering "Write a note about X" after
   the note was written — and a second tap opened a second New note dialog.

   noteButton (views/notes.js) is the chip the Accounts, Debts, Assets,
   Services and Owed pages render beside a name: no notes yet means "write the
   first one", one or more means "show them". It counted the subject's notes
   ONCE, when the host page rendered, and the click handler used that captured
   count. addNote then re-read the notes and re-rendered only the Notes page,
   and nothing re-renders the host: the vault watcher deliberately skips the
   plugin's own writes (controller.js, scheduleReload's lastWriteAt test). So
   the note existed on disk and in S.notes while the chip still said there was
   none, and acted on it (2026-10-07 audit, L6-02).

   Fixed at both ends: the click reads the count when it happens, and the chip
   that started a note repaints itself once the note exists. Driven through the
   real loader and the real Services page, with the New note dialog answered by
   a stub at the module loader (src/modal.js is the only Obsidian-only piece).
     node tests/notes-chip-after-create.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The dialogs, answered from a queue and recorded. Installed before any src/
   module loads, and matched by resolved path so every view's '../modal' lands
   here. */
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const asked = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async (_app, title, fields) => { asked.push(title); return answers.length ? answers.shift() : null; },
      confirmModal: async () => false,
      askSplit: async () => null, askRulesCleanup: async () => false, askBudgetReslice: async () => false,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Bills.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n'
    + '|---|---|---:|---|---|---|---|---|\n'
    + '| Gym | Fitco | 300.00 | monthly | 2026-11-01 | Bills | yes |  |\n'
    + '| Music | Tunes | 60.00 | monthly | 2026-11-05 | Bills | yes |  |\n',
};

const SEP = '\u001F';
const tick = () => new Promise(r => setTimeout(r, 20));
const chips = ctx => ctx.$('#svcTable').querySelectorAll('.note-chip');
const chipFor = (ctx, name) => chips(ctx).find(c => /about (.+)$/.exec(c.getAttribute('aria-label') || '')[1] === name);

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the chip that wrote the note says so, and acts on it --------- */
    {
      const { ctx, S } = await mountFor(FILES, { period: '2026-10', budgetFolder: B });
      const switched = [];
      ctx.switchView = v => switched.push(v);
      ctx.renderServices();

      const gym = chipFor(ctx, 'Gym');
      ok(gym, 'the Services page renders a notes chip beside the Gym service');
      eq(gym.getAttribute('aria-label'), 'Write a note about Gym', 'with no notes yet, it offers to write the first');

      answers.push({ title: 'Fee query', about: `service${SEP}Gym`, body: 'Asked about the joining fee.' });
      gym._fire('click');
      await tick(); await tick();
      eq(asked, ['New note'], 'the first tap opened the New note dialog');
      const written = [...ctx.vault._store.keys()].filter(k => k.startsWith(`${B}/Notes/`) && !k.endsWith('/.folder'));
      eq(written, [`${B}/Notes/2026-10-07 Fee query.md`], 'and the note was written');
      eq(S.notes.filter(n => n.kind === 'service' && n.subject === 'Gym').length, 1, 'and is in S.notes');

      /* The SAME element, not a re-rendered one: nothing re-renders a host
         page after the plugin's own write, so the chip has to say it itself. */
      eq(gym.getAttribute('aria-label'), '1 note about Gym', 'the tapped chip now counts the note');
      eq(gym.getAttribute('title'), '1 note about Gym', 'its hover title too');
      ok(gym._cls.has('has-notes'), 'and it carries the has-notes style');
      ok(/1/.test(gym.textContent), 'and shows the count');

      /* Negative control: the repaint is per subject, not a blanket "1 note".
         Music has no note and its chip must still offer to write one. */
      eq(chipFor(ctx, 'Music').getAttribute('aria-label'), 'Write a note about Music',
        'negative control: a chip for a subject with no notes is unchanged');

      gym._fire('click');
      await tick();
      eq(asked, ['New note'], 'a second tap opens NO second New note dialog');
      eq(switched, ['notes'], 'it goes to the Notes page instead');
      eq(S.noteFilter.about, `service${SEP}Gym`, 'filtered to the notes about Gym');
    }

    /* ---- 2. a chip rendered before the note existed reads the count at tap
       The note is written by another route (here addNote directly, as the
       Notes page's own New note button does). The chip on the host page was
       rendered before it and was never repainted — tapping it must still see
       the note rather than offer to write the first one. */
    {
      asked.length = 0;
      const { ctx } = await mountFor(FILES, { period: '2026-10', budgetFolder: B });
      const switched = [];
      ctx.switchView = v => switched.push(v);
      ctx.renderServices();
      const music = chipFor(ctx, 'Music');
      eq(music.getAttribute('aria-label'), 'Write a note about Music', 'rendered before any note about Music');

      answers.push({ title: 'Price rise', about: `service${SEP}Music`, body: '' });
      await ctx.addNote(`service${SEP}Music`);
      eq(asked, ['New note'], 'the note was written through the Notes page route');

      music._fire('click');
      await tick();
      eq(asked, ['New note'], 'tapping the older chip opens no New note dialog');
      eq(switched, ['notes'], 'it opens the Notes page, because the count is read at the tap');
    }
  } finally { unpin(); }

  console.log(`PASS — notes chip: counts the note it just wrote and reads the count at the tap (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
