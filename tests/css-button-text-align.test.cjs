'use strict';
/* A FLEX BUTTON IS ALIGNED BY justify-content, NOT BY text-align (2026-10-20 audit, D1-02).

   Obsidian's app.css styles every bare button `display: inline-flex;
   justify-content: center`, and this plugin's own button reset keeps the
   inline-flex and deliberately leaves justify-content alone (the grid icon
   buttons rely on it; see the reset in src/styles.css). Inside a flex
   container a run of text is an anonymous flex ITEM, so `text-align` only
   aligns the text within that item, and the item itself sits where
   justify-content puts it: in the middle.

   Measured in the audit with Obsidian's real stylesheet: the Accounts balance
   column (`button.acct-bal`, text-align: right) printed each balance centred
   in its 95px button, so "R 320,00" and "R 18 450,75" had their decimals at
   different x; the Plan money-in names (`.src2-main`) and the bucket rename
   button (`.env-name`) sat away from their row's left edge, and the Notes
   titles (`.note-title`) were centred under a left-aligned chip and body.

   The rule pinned here is general. Every button the views create (harvested
   from the el('button', { class }) calls in src/ and the <button class> tags
   in the shell) whose winning text-align is a side (left/start/right/end) and
   whose winning display is a flex one must also be given a justify-content
   by this stylesheet, and a start/end one must point the same way as the
   text. An explicit other value (space-between on a row of parts) is a
   layout decision and passes; ONLY "no value at all", which hands the button
   to the host's centring, fails.

     node tests/css-button-text-align.test.cjs */

const fs = require('fs');
const path = require('path');
const { locate } = require('./helpers/css-sources.cjs');
const { computed, node, ROOT } = require('./helpers/css-cascade.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

/* ---- harvest the buttons ---- */
const SRC = path.join(__dirname, '..', 'src');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'lang') walk(p); } else if (f.endsWith('.js')) files.push(p);
  }
})(SRC);
const buttons = new Map();   // "cls cls" -> where
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const at = i => `${path.relative(path.join(__dirname, '..'), f)}:${t.slice(0, i).split('\n').length}`;
  for (const m of t.matchAll(/el\(\s*'button'\s*,\s*\{/g)) {
    const c = /class:\s*(`[^`]*`|'[^']*'|"[^"]*")/.exec(t.slice(m.index, m.index + 400));
    if (!c) continue;
    // Static class names only: a ${...} expression adds a state (text-danger,
    // is-on), never the class that decides the layout.
    const toks = c[1].slice(1, -1).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(x => /^[a-z][\w-]*$/.test(x));
    if (toks.length) buttons.set(toks.join(' '), at(m.index));
  }
  for (const m of t.matchAll(/<button\b[^>]*\bclass="([^"]+)"/g)) buttons.set(m[1].trim().split(/\s+/).join(' '), at(m.index));
}
ok(buttons.size > 60, `sanity: the harvest should find the app's button classes, found ${buttons.size}`);
for (const must of ['acct-bal num', 'src2-main', 'env-name', 'note-title']) {
  ok(buttons.has(must), `sanity: the harvest finds the audit's button "${must}"`);
}

/* ---- the rule ---- */
const SIDE_START = /^(left|start)$/, SIDE_END = /^(right|end)$/;
const show = d => (d ? `"${d.value}" (${locate(d.line)})` : 'not set (the host centres it)');
let judged = 0;
for (const [width, phone] of [[1280, false], [375, true]]) {
  for (const [cls, where] of buttons) {
    const p = [...(phone ? ROOT('phone') : ROOT()), node('button', cls.split(' '))];
    const ta = computed(p, 'text-align', { width });
    if (!ta || !(SIDE_START.test(ta.value) || SIDE_END.test(ta.value))) continue;
    const disp = computed(p, 'display', { width });
    if (disp && !/flex/.test(disp.value)) continue;           // block / grid: text-align does the job
    judged++;
    const jc = computed(p, 'justify-content', { width });
    const agrees = jc && (SIDE_START.test(ta.value)
      ? !/^(flex-end|end|right|center)$/.test(jc.value)
      : !/^(flex-start|start|left|center)$/.test(jc.value));
    ok(agrees, `${width}px button.${cls.replace(/ /g, '.')} (${where}): text-align "${ta.value}" (${locate(ta.line)}) ` +
      `on ${disp ? disp.value : 'inline-flex'} button, but justify-content is ${show(jc)} — the text is not where text-align says`);
  }
}
ok(judged >= 6, `sanity: at least the audit's flex buttons, at two widths, are judged (judged ${judged})`);

/* ---- the audit's four, by name ---- */
const at1280 = (cls, prop) => computed([...ROOT(), node('button', cls)], prop, { width: 1280 });
ok((at1280(['acct-bal', 'num', 'text-danger'], 'justify-content') || {}).value === 'flex-end', 'D1-02 the Accounts balance is right-aligned in its button, so decimals line up');
for (const c of ['env-name', 'note-title']) {
  ok((at1280([c], 'justify-content') || {}).value === 'flex-start', `D1-02 .${c} starts at its row's left edge`);
}
/* The money-in row is TWO lines (name and kind over date and status). As a
   flex row they sat side by side, centred (measured: the name at x=405 in a
   row starting at x=125); as a block they stack and text-align applies. */
ok((at1280(['src2-main'], 'display') || {}).value === 'block', 'D1-02 .src2-main is a block, so its two lines stack at the left edge');

if (failures.length) { console.error(`FAIL — css-button-text-align: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-button-text-align: every flex button aligned by text-align also carries a matching justify-content (${judged} judged across ${buttons.size} button classes, ${checks} checks).`);
