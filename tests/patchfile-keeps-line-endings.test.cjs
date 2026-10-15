'use strict';
/* io.patchFile writes ONE line-ending style (2026-10-14 audit, lane S1: L3-11).

   patchFile joined the patched frontmatter block with '\n' onto a body that
   keeps the line endings it was read with. An account note, category note or
   Notes/ file saved from Windows (CRLF) therefore came back with an LF
   frontmatter above a CRLF body: mixed endings, a whole-file diff under sync
   for a one-line change. The body's ending decides (it is the part patchFile
   does not touch and the part with the most lines); an LF file writes exactly
   the bytes it always did.

   Real io.js and the real patchFrontmatter over the harness's in-memory vault.
     node tests/patchfile-keeps-line-endings.test.cjs */

const assert = require('assert');
const { stubObsidian, makeVault } = require('./helpers/harness.cjs');
stubObsidian();
const { makeIo } = require('../src/io');
const { parseFrontmatter } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const style = s => {
  const crlf = (s.match(/\r\n/g) || []).length, lf = (s.match(/\n/g) || []).length - crlf;
  return crlf && lf ? 'mixed' : crlf ? 'crlf' : 'lf';
};
const B = 'Budget';
const crlf = s => s.replace(/\n/g, '\r\n');

(async () => {
  const cases = {
    'a CRLF account note': crlf('---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-09-30\n---\n\n# Cheque\n\nAccount notes.\n'),
    'a CRLF note whose frontmatter has a block list': crlf('---\ntype: checking\naliases:\n  - Wallet\nbalance: 100.00\n---\n\n# Cheque\n\nNotes.\n'),
  };
  for (const [label, text] of Object.entries(cases)) {
    const vault = makeVault({ [`${B}/Accounts/Cheque.md`]: text });
    const io = makeIo({ vault, plugin: { settings: { budgetFolder: B } } });
    const { raw, body } = parseFrontmatter(await io.readFile('Accounts/Cheque.md'));
    const fm = await io.patchFile('Accounts/Cheque.md', raw, body, { balance: '250.00' });
    const out = vault._store.get(`${B}/Accounts/Cheque.md`);
    eq(style(out), 'crlf', `${label}: still all CRLF after a patch (was mixed)`);
    assert.ok(out.includes('balance: 250.00'), `${label}: the patch landed`); checks++;
    assert.ok(out.endsWith('Account notes.\r\n') || out.endsWith('Notes.\r\n'), `${label}: the body is untouched`); checks++;
    // The returned block is what accounts.js re-captures for the NEXT patch: patching it again must stay CRLF too.
    await io.patchFile('Accounts/Cheque.md', fm, body, { balance: '300.00' });
    eq(style(vault._store.get(`${B}/Accounts/Cheque.md`)), 'crlf', `${label}: a second patch from the returned block stays CRLF`);
    assert.ok(vault._store.get(`${B}/Accounts/Cheque.md`).includes('balance: 300.00'), `${label}: and lands`); checks++;
  }

  /* LF files write exactly the bytes they always did. */
  {
    const text = '---\ntype: checking\nbalance: 100.00\n---\n\n# Cheque\n\nNotes.\n';
    const vault = makeVault({ [`${B}/Accounts/Cheque.md`]: text });
    const io = makeIo({ vault, plugin: { settings: { budgetFolder: B } } });
    const { raw, body } = parseFrontmatter(text);
    await io.patchFile('Accounts/Cheque.md', raw, body, { balance: '250.00' });
    eq(vault._store.get(`${B}/Accounts/Cheque.md`), '---\ntype: checking\nbalance: 250.00\n---\n\n# Cheque\n\nNotes.\n', 'an LF file is byte-identical to what it always wrote');
  }

  /* A body with no line break at all falls back to the block's own ending. */
  {
    const text = '---\r\ntype: cash\r\nbalance: 1.00\r\n---';
    const vault = makeVault({ [`${B}/Accounts/Cash.md`]: text });
    const io = makeIo({ vault, plugin: { settings: { budgetFolder: B } } });
    const { raw, body } = parseFrontmatter(text);
    await io.patchFile('Accounts/Cash.md', raw, body, { balance: '2.00' });
    eq(style(vault._store.get(`${B}/Accounts/Cash.md`)), 'crlf', 'an empty body takes the frontmatter\'s ending');
  }

  console.log(`PASS patchfile-keeps-line-endings (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
