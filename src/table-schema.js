'use strict';
/* One declaration per flat table, driving the loader, the serializer and the
   tests — docs/adr/0003-columns-are-declared-once.md. Before this module the
   column order of every entity lived three times (a c[N] mapping in load.js,
   a hand-built header/separator/row template in the view, and for
   transactions a third copy inside a test), and none of the copies could
   tell when another moved. This file is the single door.

   THE COLUMN ORDER IS HISTORY, NOT STYLE. Files written by every past version
   of this plugin are still on disk in user vaults, so append is the only
   cheap operation: reordering, renaming or inserting mid-table shears every
   later value into the wrong field of every file already written. Two guard
   tests enforce this — the frozen-prefix tripwire and the truncation sweep
   in tests/table-schema-guards.test.cjs. If either goes red, read the ADR
   before touching the frozen list.

   A column is { key, header, align, read, write }:
     read(cell)  -> a PARTIAL OBJECT merged into the row. Partial rather than
                    a bare value because one cell can carry two fields — a
                    money cell strict-parses into amount plus the amountRaw
                    the serializer writes back verbatim when parsing failed.
                    `cell` is exactly what parseMdTable yields: still \|-
                    escaped, and undefined past the end of a short row —
                    which is what a file written before the column existed
                    looks like, so every read must yield its documented
                    default for undefined.
     write(row)  -> the finished cell string, escaping included, so the
                    escape pair (escMd/unescMd) and the number pair
                    (parseNum/toFixed) live side by side in one declaration
                    and cannot drift apart.

   Cross-column fix-ups a single cell cannot express (a debt's `original`
   defaulting to its parsed `balance`) stay in load.js as one named post()
   step per entity — visible there, not hidden in schema hooks.

   This module is pure (markdown.js/amount.js layer — no Obsidian imports)
   and its generic row reader is called by load.js ONLY. Nothing downstream
   gains a second door onto raw transaction rows; everything still goes
   through tx-role.js. */

const { escMd, unescMd } = require('./markdown');
const { parseNum } = require('./amount');
const { splitRole } = require('./tx-role');

/* The separator row is derived, never hand-typed: dash count equals the
   header cell's width (word plus its two padding spaces), and a right-
   aligned column trades its last dash for the colon. This reproduces the
   shipped format byte for byte — see the literals in table-schema.test.cjs. */
function headerLines(schema) {
  const header = `| ${schema.columns.map(c => c.header).join(' | ')} |`;
  const sep = '|' + schema.columns.map(c => {
    const width = c.header.length + 2;
    return c.align === 'right' ? '-'.repeat(width - 1) + ':' : '-'.repeat(width);
  }).join('|') + '|';
  return [header, sep];
}

function rowLine(schema, row) {
  return `| ${schema.columns.map(c => c.write(row)).join(' | ')} |`;
}

function rowToObject(schema, cells) {
  const obj = {};
  for (let i = 0; i < schema.columns.length; i++) {
    Object.assign(obj, schema.columns[i].read(cells[i]));
  }
  return obj;
}

/* Shared shapes. Each helper pairs a read with the write that reverses it,
   so a column declared with one cannot ship half of the contract. */

// Free text: \|-escaped on disk, unescaped in state.
const text = (key, header, fallback = '') => ({
  key, header, align: 'left',
  read: c => ({ [key]: unescMd(c || fallback) }),
  write: r => escMd(r[key]),
});

// A date or other verbatim string: trimmed, never escaped by the reader
// today, but written through escMd like every free cell.
const verbatim = (key, header) => ({
  key, header, align: 'left',
  read: c => ({ [key]: (c || '').trim() }),
  write: r => escMd(r[key]),
});

// Arithmetic input: strict-parsed so "15 000 000" is READ rather than
// truncated, optionally floored, rewritten canonically as toFixed(2). No
// *Raw write-back — a rejected cell falls back to 0, same as the loader
// today. `guarded` writes (r[key] || 0) for rows minted by UI paths that
// predate the column and never set it — serializeOwed's repaid guard.
const money = (key, header, { floor = false, guarded = false } = {}) => ({
  key, header, align: 'right',
  read: c => ({ [key]: floor ? Math.max(0, parseNum(c || '0').value || 0) : (parseNum(c || '0').value || 0) }),
  write: guarded ? (r => (r[key] || 0).toFixed(2)) : (r => r[key].toFixed(2)),
});

// A closed vocabulary: anything that trims+folds to `match` is `match`,
// everything else — including an absent cell — is `other`. Written raw:
// only two strings can ever occupy the cell, so it never needs escaping.
const vocab = (key, header, match, other) => ({
  key, header, align: 'left',
  read: c => ({ [key]: (c || other).trim().toLowerCase() === match ? match : other }),
  write: r => r[key],
});

const SCHEMAS = {
  /* Assets.md — every column after Item is additive, so a hand-written file
     with nothing but a name and a value loads. */
  assets: {
    file: 'Assets.md',
    columns: [
      text('name', 'Item'),
      text('type', 'Kind', 'other'),
      money('value', 'Value', { floor: true }),
      verbatim('valued', 'Valued'),
      text('notes', 'Notes'),
    ],
  },

  /* Owed Money.md — columns 6 and 7 (Repaid, Lent) are additive: a file
     written before they existed has neither, and must mean exactly what it
     always meant — nothing repaid, no lending date. */
  owed: {
    file: 'Owed Money.md',
    columns: [
      text('person', 'Person'),
      money('amount', 'Amount'),
      text('description', 'Description'),
      verbatim('due', 'Due date'),
      vocab('status', 'Status', 'paid', 'outstanding'),
      money('repaid', 'Repaid', { guarded: true }),
      verbatim('lent', 'Lent'),
    ],
  },

  /* Services.md — the Amount column feeds the committed total the Dashboard
     subtracts from "actually free to spend", so a truncated cell overstates
     it. */
  services: {
    file: 'Services.md',
    columns: [
      text('name', 'Name'),
      text('provider', 'Provider'),
      money('amount', 'Amount'),
      vocab('cycle', 'Cycle', 'annual', 'monthly'),
      verbatim('next', 'Next billing'),
      text('category', 'Category'),
      {
        // Active is a yes/no cell read as a boolean: only an explicit "no"
        // deactivates — an absent cell on an old file means what it always
        // meant, an active service.
        key: 'active', header: 'Active', align: 'left',
        read: c => ({ active: (c || 'yes').trim().toLowerCase() !== 'no' }),
        write: r => (r.active ? 'yes' : 'no'),
      },
      text('notes', 'Notes'),
    ],
  },

  /* Debts.md — the twelve-column cautionary tale CLAUDE.md names. Money
     columns floor at 0: every figure here is arithmetic input to the payoff
     maths, so a rejected cell falls back to 0 and is rewritten canonically
     rather than preserved verbatim. */
  debts: {
    file: 'Debts.md',
    columns: [
      text('name', 'Name'),
      text('lender', 'Lender'),
      text('type', 'Type', 'other'),
      money('balance', 'Balance', { floor: true }),
      {
        /* Absent-or-empty is null, NOT 0: load.js's post() step fills it
           from the parsed balance so the "paid off" bar reads 0% rather
           than dividing by zero. The schema cannot see a sibling column —
           null is the signal that crosses the boundary. */
        key: 'original', header: 'Original', align: 'right',
        read: c => ({ original: c !== undefined && c !== '' ? Math.max(0, parseNum(c).value || 0) : null }),
        write: r => r.original.toFixed(2),
      },
      money('rate', 'Rate', { floor: true }),
      money('payment', 'Payment', { floor: true }),
      money('extra', 'Extra', { floor: true }),
      verbatim('start', 'Start date'),
      text('category', 'Category'),
      vocab('status', 'Status', 'paid', 'active'),
      text('notes', 'Notes'),
    ],
  },

  /* Transactions — per-month files under Transactions/<account>/. The Split
     column is written ONLY into files that contain a split (serializeTxFile
     slices this schema to six columns otherwise), and read through
     splitRole, the single door: the loader accepts only the two known
     roles, so the cell can never need escaping. */
  transactions: {
    columns: [
      {
        // Verbatim, unescaped, untrimmed beyond what parseMdTable did —
        // dates are ISO from import, and the serializer sorts on them.
        key: 'date', header: 'Date', align: 'left',
        read: c => ({ date: c }),
        write: r => r.date,
      },
      text('desc', 'Description'),
      text('cat', 'Category'),
      {
        /* One cell, two fields — the reason reads return partial objects.
           amountRaw !== null means the strict parser rejected the cell; the
           write side puts the verbatim raw back rather than corrupting a
           figure the user typed. */
        key: 'amount', header: 'Amount', align: 'right',
        read: c => { const a = parseNum(c); return { amount: a.value, amountRaw: a.ok ? null : a.raw }; },
        write: r => (r.amountRaw != null ? r.amountRaw : r.amount.toFixed(2)),
      },
      {
        key: 'excluded', header: 'Excluded', align: 'left',
        read: c => ({ excluded: (c || '').toLowerCase() === 'yes' }),
        write: r => (r.excluded ? 'yes' : ''),
      },
      text('note', 'Note'),
      {
        key: 'split', header: 'Split', align: 'left',
        read: c => ({ split: splitRole(c) }),
        write: r => splitRole(r.split),
      },
    ],
  },
};

/* The whole document for the four flat single-table files (transactions
   keeps serializeTxFile's own shape and consumes only the line builders).
   Frontmatter is preserved VERBATIM from load — `fm` is the raw block the
   loader captured, and the `kind:` fallback lives here, once, instead of
   four slightly-different copies in four views. A fifth view added later
   with a subtly different fallback would have been invisible until
   someone's frontmatter got eaten. Prose stays with the view: it is
   content, and differs per file for good reason. */
function mdTableFile({ fm, fallback, title, prose, schema, rows }) {
  const lines = ['---', ...(fm || fallback).split('\n'), '---', '', `# ${title}`, '',
    ...prose, '', ...headerLines(schema)];
  for (const r of rows) lines.push(rowLine(schema, r));
  lines.push('');
  return lines.join('\n');
}

module.exports = { SCHEMAS, headerLines, rowLine, rowToObject, mdTableFile };
