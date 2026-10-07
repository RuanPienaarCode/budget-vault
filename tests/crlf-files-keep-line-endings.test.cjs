'use strict';
/* A flat-table file written with Windows line endings comes back with them.

   mdTableFile split the captured frontmatter on '\n' alone and joined every
   line with '\n', so a CRLF Owed Money.md came back with each frontmatter line
   still ending '\r\n' and every other line ending '\n' — one file, two
   line-ending styles (2026-10-07 round-trip audit, L3-20). Harmless to read,
   but a whole-file rewrite under sync from a Windows device, for nothing.

   The loader now records the file's own line ending at load (the first line
   break in the file decides) and hands the captured prose around the table
   back in it; the serializer writes EVERY line with the ending the captured
   text carries. An LF file — which is every file this plugin itself has ever
   created — writes exactly the bytes it always did (golden-tables pins them).

   Synthetic. Real loader, real serializers.
     node tests/crlf-files-keep-line-endings.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const crlf = lines => lines.join('\r\n');
const styles = s => ({ crlf: (s.match(/\r\n/g) || []).length, bareLf: (s.match(/\n/g) || []).length - (s.match(/\r\n/g) || []).length });

const FILES = {
  owed: ['Owed Money.md', 'owed', 'serializeOwed', crlf(['---', 'kind: owed', 'tags: [finance]', '---', '', '# Owed Money', '',
    'Money owed to the household. `status` is `outstanding` or `paid`.',
    '`Repaid` is how much has come back; `Lent` is when it went out.', '',
    '| Person | Amount | Description | Due date | Status | Repaid | Lent |',
    '|--------|-------:|-------------|----------|--------|-------:|------|',
    '| Sam | 250.00 | lunch | 2026-10-31 | outstanding | 0.00 | 2026-09-01 |', ''])],
  assets: ['Assets.md', 'assets', 'serializeAssets', crlf(['---', 'kind: assets', '---', '', '# Assets', '',
    'What the household owns that is not an account — property, vehicles, contents,',
    'jewellery, metals. `Value` is what it would sell for today and `Valued` is when',
    'that was last worked out. Money owed against any of these lives on the Debt page.', '',
    '| Item | Kind | Value | Valued | Notes |', '|------|------|------:|--------|-------|',
    '| Car | vehicle | 90000.00 | 2026-03-01 |  |', '', '## Insurance', '', 'Renew in March.', ''])],
  services: ['Services.md', 'services', 'serializeServices', crlf(['---', 'kind: services', 'tags: [finance]', '---', '',
    '# Services & Subscriptions', '',
    'Recurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.', '',
    '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |',
    '|------|----------|-------:|-------|--------------|----------|--------|-------|',
    '| Gym | GymCo | 450.00 | monthly | 2026-10-01 | Fun | yes |  |', ''])],
  debts: ['Debts.md', 'debts', 'serializeDebts', crlf(['---', 'kind: debts', '---', '', '# Debts', '',
    'Money the household owes. `rate` is the annual interest rate as a percentage,',
    '`payment` the contracted monthly amount and `extra` anything paid on top of it.',
    '`status` is `active` or `paid`.', '',
    '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |',
    '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|',
    '| Card | Bank | credit card | 1200.00 | 3000.00 | 21.00 | 150.00 | 0.00 | 2024-01-01 |  | active |  |', ''])],
};

(async () => {
  for (const [kind, [path, view, ser, text]] of Object.entries(FILES)) {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/${path}`]: text });
    const S = await loadInto(ctx);
    require(`../src/views/${view}`)(ctx);
    const out = ctx[ser]();
    eq(styles(out).bareLf, 0, `${kind}: a CRLF file comes back with no bare LF line ending`);
    eq(out, text, `${kind}: a no-change save of a CRLF file is byte-identical`);
    S[kind][0][kind === 'owed' ? 'description' : 'notes'] = 'changed';
    const edited = ctx[ser]();
    eq(styles(edited).bareLf, 0, `${kind}: an edited CRLF file is still all CRLF`);
    eq(edited.includes('changed'), true, `${kind}: …and the edit took`);
  }

  /* Control: an LF file stays LF. */
  {
    const lf = FILES.owed[3].replace(/\r\n/g, '\n');
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Owed Money.md`]: lf });
    await loadInto(ctx);
    require('../src/views/owed')(ctx);
    eq(ctx.serializeOwed(), lf, 'an LF file writes exactly the LF bytes it always did');
  }

  console.log(`PASS crlf-files-keep-line-endings (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
