'use strict';
/* The Tax empty state's title sits where its paragraphs do.

   2026-10-20 audit, D1-24. "No tax year yet" was centred — an inline
   `justify-content:center` on the card head in shell.js — over two
   left-aligned paragraphs and a left-aligned button. Every other card
   head on the page starts at the left edge.

   The Plan page's empty card ("No plan yet") was the same card with the same
   inline centring over the same left-aligned body, so it is held here too.
   The connect card ("Budget folder not found") is NOT: it is centred as a
   whole (`#connect-card { text-align: center }`, a 640px column in the middle
   of the pane), so its centred title matches its centred paragraphs and
   button, and it keeps its inline centring.

   Static read of the shell markup (the views only toggle the cards).
   Written by lane L5, extended by lane L7 (who owns shell.js).

     node tests/tax-empty-card-left-aligned.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const shell = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell.js'), 'utf8');
const headOf = id => {
  const at = shell.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `the shell still carries #${id}`);
  const head = (shell.slice(at).match(/<div class="card-h"[^>]*>/) || [])[0] || '';
  assert.ok(head, `#${id} has a card head`);
  return head;
};
let checks = 0;
for (const [id, what] of [['taxEmptyCard', 'Tax'], ['planEmptyCard', 'Plan']]) {
  const head = headOf(id);
  assert.ok(!/justify-content\s*:\s*center/.test(head),
    `the ${what} empty card's title is not centred over its left-aligned paragraphs — got ${head}`);
  checks += 3;
}
/* The one card that IS centred as a whole keeps a centred title. */
assert.ok(/justify-content\s*:\s*center/.test(headOf('connect-card')),
  'the connect card is centred as a whole (#connect-card text-align: center), so its title stays centred with it');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
assert.ok(/\.budget-app-root #connect-card \{[^}]*text-align:\s*center/.test(css),
  'and that is because its body is centred: the #connect-card rule still says text-align: center');
checks += 4;
console.log(`PASS tax-empty-card-left-aligned — the Tax and Plan empty-state titles start where their paragraphs do; the centred connect card stays centred (${checks} checks)`);
