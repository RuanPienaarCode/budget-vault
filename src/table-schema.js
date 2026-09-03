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

/* Arithmetic input: strict-parsed so "15 000 000" is READ rather than
   truncated, optionally floored, and rewritten canonically as toFixed(2).
   `guarded` writes (r[key] || 0) for rows minted by UI paths that predate the
   column and never set it — serializeOwed's repaid guard.

   A cell normalizeAmount cannot read keeps its verbatim text in `<key>Raw`,
   exactly as the transactions `amount` column has kept `amountRaw` since this
   file was written. That column is the working precedent; these four tables
   were the unfinished half of it. Without it, parseNum's FABRICATED 0 was
   rendered as "0.00" and saved over the reader's own text the next time
   anything on the page was saved — so `| Ring | other | 12 000 R | … |` came
   back as `| Ring | other | 0.00 | … |`, the value gone, the fact that
   anything had been typed gone, and nothing on screen saying so. That is data
   loss, and it is this app silently CORRECTING a figure the reader typed
   instead of arguing with them.

   READABLE, not `ok` — the boundary that keeps this safe. "1 234,56",
   "15 000 000" and "R4000" are cells normalizeAmount reads correctly; they fail
   `ok` only by not already being canonical, and they have always been rewritten
   canonically. tests/golden-tables.test.cjs pins those exact bytes, and these
   files live in user vaults under iCloud sync, so keeping THEIR raw would
   rewrite every table on the planet on upgrade for no gain. Only the cell that
   yielded no number at all is preserved (src/amount.js's `readable`).

   The write prefers the raw only while the row still HOLDS the 0 that raw
   produced. views/assets.js and views/debts.js edit these fields in place
   (`d.balance = Math.max(0, parseFloat(e.target.value) || 0)`) and — unlike
   views/budgets.js with amountRaw — have no way to clear a sibling key they
   have never heard of. Preferring the raw unconditionally would make an edit to
   a previously-unreadable cell vanish on save: the same bug one step to the
   left. A reader who deliberately types 0 into such a cell sees no change and
   the raw stands; the app cannot tell that from "never touched", and leaving
   the reader's own text alone is the honest side to be wrong on. */
const money = (key, header, { floor = false, guarded = false } = {}) => {
  const rawKey = key + 'Raw';
  return {
    key, header, align: 'right',
    read: c => {
      const a = parseNum(c || '0');
      const v = floor ? Math.max(0, a.value || 0) : (a.value || 0);
      /* `!a.raw` is the blank-but-present cell — parseNum trims, so a cell of
         nothing but spaces arrives here as ''. Absent has always meant 0.00 on
         these tables and there is no reader's text to protect, so it must not
         be preserved: writing '' back would leave an empty cell where every
         other row states a figure. */
      return a.readable || !a.raw ? { [key]: v } : { [key]: v, [rawKey]: a.raw };
    },
    write: r => (r[rawKey] != null && !(r[key] || 0)
      ? r[rawKey]
      : (guarded ? (r[key] || 0) : r[key]).toFixed(2)),
  };
};

/* A closed vocabulary: anything that trims+folds to `match` is `match`,
   everything else — including an absent cell — is `other`.

   A cell matching NEITHER value keeps its verbatim text in `<key>Raw`, and the
   write prefers it. This is money()'s contract above, copied deliberately
   rather than re-invented, because it is the same defect one column over: the
   reader's own text was coerced (there for arithmetic, here for a branch) and
   the coerced value was then written back over what they typed.

   `| Gym | Virgin Active | 400.00 | weekly | … |` in Services.md loaded as
   `monthly`, and the next save — triggered by an edit to some entirely
   different row on the page — put `monthly` on disk. The word was gone, the
   fact that anything else had been typed there was gone, and nothing on screen
   said so. Same for a Status of `written off` or `disputed`: two words a
   lender's own paperwork really uses, which this column has no room for.

   Behaviour DOWNSTREAM is unchanged — every consumer still sees `monthly`, so
   recurring.js, committed.js and views/services.js branch exactly as before.
   Only what reaches disk changes. Modelling weekly billing for real is issue
   #33; this only stops the destruction in the meantime.

   Two boundaries, both money()'s and both load-bearing:

   An absent or BLANK cell keeps no raw. Blank has always meant the default on
   these tables — it is what makes a column safe to append at all (ADR-0003's
   truncation sweep) — so there is no reader's text to protect, and writing ''
   back would leave an empty cell where every other row states a word.

   The write prefers the raw only while the row still HOLDS the value that raw
   produced. views/services.js's cycle <select> and views/debts.js's status
   control assign these fields in place and — exactly like views/assets.js with
   the money columns — have no way to clear a sibling key they have never heard
   of. Preferring the raw unconditionally would make a deliberate edit vanish
   on save: the same bug one step to the left. A reader who re-picks the
   coerced value out of the select sees no change and their own word stands;
   the app cannot tell that from "never touched", and leaving the reader's text
   alone is the honest side to be wrong on.

   Still written WITHOUT escMd, and that is load-bearing now rather than
   incidental: a third string can occupy this cell, and a word can contain a
   pipe. The cell arrives from parseMdTable still \|-escaped (see this module's
   header), the raw keeps it escaped, and the write puts those same bytes back
   — so preserving a cell cannot shear the row, and a second load reads the
   identical raw. Precisely what money() does with parseNum's raw. */
/* ISSUE 33. The same reader as vocab() below, over a SET rather than a pair.

   `vocab` was written for genuinely two-valued cells — paid/active,
   paid/outstanding — where "anything that is not the match is the other" is
   the whole of the rule. Services.md's Cycle is not one of those and never
   was: it was declared `vocab('cycle', 'Cycle', 'annual', 'monthly')`, so a
   household that typed `weekly` got `monthly` and a `cycleRaw` nobody read.
   A weekly gym debit order and a fortnightly insurance premium could not be
   expressed at all — not "expressed badly", not stored — and every figure
   built on the cycle then answered a question about a bill that does not
   exist.

   `fallback` is what an unrecognised cell reads as, and `<key>Raw` preserves
   the reader's own text so the next save writes back what they typed rather
   than the app's guess — the same contract money() and vocab() carry, for the
   same reason. Widening the SET is therefore backward-compatible in both
   directions: a cell that used to fall through to the fallback and be
   preserved verbatim is now recognised and written as itself, byte for byte
   the same. */
/* The billing cycles a service can state, in ascending length. Exported so the
   Services page's picker and recurring.js's date arithmetic read one list —
   a picker offering a value the maths cannot step is how "weekly" got stored
   and then silently ignored in the first place. */
const CYCLES = ['weekly', 'fortnightly', 'monthly', 'annual'];

const vocabSet = (key, header, allowed, fallback) => {
  const rawKey = key + 'Raw';
  const set = new Set(allowed);
  return {
    key, header, align: 'left',
    read: c => {
      const raw = (c || '').trim();
      const folded = raw.toLowerCase();
      const known = set.has(folded);
      return !raw || known
        ? { [key]: known ? folded : fallback }
        : { [key]: fallback, [rawKey]: raw };
    },
    write: r => (r[rawKey] != null && r[key] === fallback ? r[rawKey] : r[key]),
  };
};

const vocab = (key, header, match, other) => {
  const rawKey = key + 'Raw';
  return {
    key, header, align: 'left',
    read: c => {
      const raw = (c || '').trim();
      const folded = raw.toLowerCase();
      const v = folded === match ? match : other;
      return !raw || folded === match || folded === other
        ? { [key]: v }
        : { [key]: v, [rawKey]: raw };
    },
    write: r => (r[rawKey] != null && r[key] === other ? r[rawKey] : r[key]),
  };
};

/* The currency an entity's own amounts are stated in — a DISPLAY symbol, the
   same thing an account's `currency:` frontmatter is, and governed by the same
   rules in src/currency.js: it never converts and never excludes.

   APPENDED to four tables (ADR-0003: append is the only cheap operation), and
   blank means the household's currency, which is what every file already on
   disk says by saying nothing. So a vault written by any previous version
   loads unchanged and every existing figure means exactly what it always did.

   Added because the multi-currency audit found the gap was not a wrong number
   but an unrecordable fact: only ACCOUNTS could state a currency, so a euro
   mortgage, a house abroad, a loan to a relative overseas and a subscription
   billed in dollars all had to be typed as though they were in the
   household's currency — and then every total, ratio and payoff schedule
   built on them was quietly wrong with no way for the reader to say
   otherwise. Frontmatter hand-written into those files survived every
   round-trip and was read by nothing, which looks like it took.

   Deliberately NOT a `currency_code`. The code exists on accounts because
   exchange-rate lookup needs one; these four tables have no rate lookup
   behind them yet, and a column nothing reads is the thing this comment
   just described. It can be appended the day conversion reaches them. */
const currency = () => ({
  key: 'currency', header: 'Currency', align: 'left',
  read: c => ({ currency: (c || '').trim() }),
  write: r => escMd(r.currency || ''),
});

const SCHEMAS = {
  /* Assets.md — every column after Item is additive, so a hand-written file
     with nothing but a name and a value loads. */
  assets: {
    file: 'Assets.md',
    /* `currency` is appended and optional — see usedColumns(). */
    optionalTail: 1,
    columns: [
      text('name', 'Item'),
      text('type', 'Kind', 'other'),
      money('value', 'Value', { floor: true }),
      verbatim('valued', 'Valued'),
      text('notes', 'Notes'),
      currency(),
    ],
  },

  /* Owed Money.md — columns 6 and 7 (Repaid, Lent) are additive: a file
     written before they existed has neither, and must mean exactly what it
     always meant — nothing repaid, no lending date. */
  owed: {
    file: 'Owed Money.md',
    /* `currency` is appended and optional — see usedColumns(). */
    optionalTail: 1,
    columns: [
      text('person', 'Person'),
      money('amount', 'Amount'),
      text('description', 'Description'),
      verbatim('due', 'Due date'),
      vocab('status', 'Status', 'paid', 'outstanding'),
      money('repaid', 'Repaid', { guarded: true }),
      verbatim('lent', 'Lent'),
      currency(),
    ],
  },

  /* Services.md — the Amount column feeds the committed total the Dashboard
     subtracts from "actually free to spend", so a truncated cell overstates
     it. */
  services: {
    file: 'Services.md',
    /* `currency` is appended and optional — see usedColumns(). */
    optionalTail: 1,
    columns: [
      text('name', 'Name'),
      text('provider', 'Provider'),
      money('amount', 'Amount'),
      /* ISSUE 33. Four cycles, not two. `monthly` stays the fallback, so every
         Services.md already on disk means exactly what it always meant. */
      vocabSet('cycle', 'Cycle', CYCLES, 'monthly'),
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
      currency(),
    ],
  },

  /* Debts.md — the twelve-column cautionary tale CLAUDE.md names. Money
     columns floor at 0: every figure here is arithmetic input to the payoff
     maths, so a rejected cell falls back to 0 and is rewritten canonically
     rather than preserved verbatim. */
  debts: {
    file: 'Debts.md',
    /* `currency` is appended and optional — see usedColumns(). */
    optionalTail: 1,
    columns: [
      text('name', 'Name'),
      text('lender', 'Lender'),
      text('type', 'Type', 'other'),
      money('balance', 'Balance', { floor: true }),
      {
        /* Absent-or-empty is null, NOT 0: load.js's post() step fills it
           from the parsed balance so the "paid off" bar reads 0% rather
           than dividing by zero. The schema cannot see a sibling column —
           null is the signal that crosses the boundary. That is why this
           column is spelled out rather than built by money(): only this one
           distinguishes "not stated" from "stated as nothing".

           Everything else about it IS money()'s contract, unreadable-cell
           preservation included — see the comment there. A cell nobody can
           read is present, so it does not take the null branch; it takes the
           fabricated 0 and keeps `originalRaw` so the next save writes the
           reader's text back instead of "0.00" over it. */
        key: 'original', header: 'Original', align: 'right',
        read: c => {
          if (c === undefined || c === '') return { original: null };
          const a = parseNum(c);
          const v = Math.max(0, a.value || 0);
          return a.readable || !a.raw ? { original: v } : { original: v, originalRaw: a.raw };
        },
        /* ISSUE 68. A cell the household left EMPTY goes back empty. load.js's
           post() fills `original` from the balance so the payoff maths has a
           divisor; `originalStated: false` is how it says that figure was
           derived rather than typed, and writing it would turn a blank into a
           claim the household never made. */
        write: r => (r.originalStated === false ? ''
          : r.originalRaw != null && !(r.original || 0) ? r.originalRaw
            : r.original.toFixed(2)),
      },
      money('rate', 'Rate', { floor: true }),
      money('payment', 'Payment', { floor: true }),
      money('extra', 'Extra', { floor: true }),
      verbatim('start', 'Start date'),
      text('category', 'Category'),
      vocab('status', 'Status', 'paid', 'active'),
      text('notes', 'Notes'),
      currency(),
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
/* Drop trailing columns no row in this table actually uses.

   The Split column set the precedent (see the transactions schema above):
   serializeTxFile writes six columns into a file with no split in it, so a
   file that has never needed the seventh never grows one. `currency` is
   appended to four tables on exactly the same terms, and the reasoning is
   the same only more so — these files sit in user vaults under iCloud sync,
   and rewriting every Debts.md, Assets.md, Owed Money.md and Services.md on
   the planet to add an empty column would be user-visible churn and a sync
   hazard, in exchange for nothing at all for the single-currency vaults that
   are nearly all of them.

   Only TRAILING columns, and only ones every row leaves empty — an empty
   cell in the middle of a table is a real value (a blank Category means no
   category) and must keep its position, because the parser is positional.
   `write` is asked, not the raw field, so "empty" means what actually
   reaches disk. */
function usedColumns(schema, rows) {
  const cols = schema.columns;
  let last = cols.length;
  while (last > 0) {
    const col = cols[last - 1];
    const used = (rows || []).some(r => {
      try { return String(col.write(r) ?? '').trim() !== ''; } catch (e) { return true; }
    });
    if (used) break;
    last--;
  }
  /* Never below the frozen shape a reader expects: a table is not narrowed
     past the columns it has always written, only prevented from GROWING one
     nobody uses. Columns appended after the original set are the optional
     tail, and OPTIONAL_TAIL names how many there are. */
  const floor = cols.length - (schema.optionalTail || 0);
  return cols.slice(0, Math.max(last, floor));
}

function mdTableFile({ fm, fallback, title, prose, schema, rows }) {
  const used = { ...schema, columns: usedColumns(schema, rows) };
  const lines = ['---', ...(fm || fallback).split('\n'), '---', '', `# ${title}`, '',
    ...prose, '', ...headerLines(used)];
  for (const r of rows) lines.push(rowLine(used, r));
  lines.push('');
  return lines.join('\n');
}

module.exports = { SCHEMAS, headerLines, rowLine, rowToObject, mdTableFile, usedColumns, CYCLES,};
