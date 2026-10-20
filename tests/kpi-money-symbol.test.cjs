'use strict';
/* A KPI TILE OR LOAN FIGURE THAT PRINTS MONEY SAYS SO (2026-10-20 audit, D1-04 / D2-15).

   The muted currency symbol (1.51.0) is a ::first-letter rule, and a tile's
   value can be a count ("4"), a percentage or a date as often as money, so the
   stylesheet cannot style "every tile". It styles the figures a view marks
   .st-money (statement/foundation.css section 6). Savings, Debt, Owed Money and
   Services printed their money tiles without the mark, and Loans its money()
   rows, so "R 3 079 818,25" drew its R full-size on Savings beside the
   Dashboard's muted one.

   The rule, read from the views: a tile(...) whose value is money(...) passes
   'st-money' in its class argument; a lo-big row whose value is money(...) does
   too; a lo-big row printed through tariffMoney() is marked only when the
   tariff prints the household's own currency.

   (Prepared by lane L7 for lanes L4 and L5; drop into tests/ once the view
   diffs land.)

     node tests/kpi-money-symbol.test.cjs */

const fs = require('fs');
const path = require('path');
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'views', f), 'utf8');

/* tile('Label', money(...), <cls>, ...) — the class argument is the third. */
const splitArgs = s => { const out = []; let d = 0, cur = '', q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
    if (d < 0) break;
    if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out; };
let seen = 0;
for (const f of ['savings.js', 'debts.js', 'owed.js', 'services.js']) {
  const t = read(f);
  for (const m of t.matchAll(/\btile\(/g)) {
    const args = splitArgs(t.slice(m.index + 5, m.index + 600));
    if (!/^money\(/.test(args[1] || '')) continue;
    seen++;
    const line = t.slice(0, m.index).split('\n').length;
    ok(/st-money/.test(args[2] || ''), `${f}:${line} tile(${args[0]}, ${args[1].slice(0, 30)}…) prints money but does not pass 'st-money'`);
  }
}
ok(seen >= 8, `sanity: the money tiles of Savings, Debt, Owed and Services are found (${seen})`);

const loans = read('loans.js');
let rows = 0;
for (const m of loans.matchAll(/\brow\(/g)) {
  const args = splitArgs(loans.slice(m.index + 4, m.index + 400));
  if (!/lo-big|tariffBig\(/.test(args[2] || '')) continue;
  rows++;
  const line = loans.slice(0, m.index).split('\n').length;
  if (/^money\(/.test(args[1])) ok(/st-money/.test(args[2]), `loans.js:${line} a lo-big money() row is not marked st-money`);
  else if (/^tariffMoney\(/.test(args[1])) ok(!/'lo-big st-money'|"lo-big st-money"/.test(args[2]), `loans.js:${line} a tariffMoney() row is marked unconditionally`);
}
ok(rows >= 4, `sanity: the Loans lo-big rows are found (${rows})`);

if (failures.length) { console.error(`FAIL — kpi-money-symbol: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — kpi-money-symbol: every money KPI tile and loan figure carries .st-money (${checks} checks).`);
