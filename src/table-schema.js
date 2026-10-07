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

const { escMd, unescMd, freshLeadLines, withLeadExtra } = require('./markdown');
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

/* ISSUE 69. A cell past the schema's own columns is never interpreted — this
   file has no idea what a hand-added "Balance" column means — only carried,
   verbatim, exactly as parseMdTable handed it back (still \|-escaped, like
   every raw this module keeps). `known` is the FULL schema length, not
   usedColumns()'s trimmed one: a row's position on disk is fixed by what was
   actually written, and the optional tail (currency) still owns its own slot
   whether or not this particular file ever used it. Called once per row from
   load.js, right after rowToObject. */
function attachExtraCells(obj, known, cells) {
  const extra = cells.slice(known);
  if (extra.length) obj.extraCells = extra;
  return obj;
}

/* ISSUE 69. The table-level half of the same contract: the header cells and
   separator cells past `known`, captured ONCE per file rather than once per
   row. `header`/`sep` come from parseMdTableWithSeparator; `dataRows` from
   the same call, so a row LONGER than the header (a cell nobody named) still
   gets a slot here — synthesised with a blank header and a plain `---`
   separator, because "no column happens to be named for it" is not licence
   to drop it. A row SHORTER than the header is the ordinary case every other
   column here already handles: absent means blank, not missing. Returns null
   when nothing on this table reaches past `known`, which is the common case
   and keeps every existing writer's output byte-identical. */
function extraColsOf(known, header, sep, dataRows) {
  const extraHeaders = (header || []).slice(known);
  const extraSep = (sep || []).slice(known);
  let maxLen = extraHeaders.length;
  for (const c of dataRows) maxLen = Math.max(maxLen, c.length - known);
  if (maxLen <= 0) return null;
  return {
    /* How many of the schema's own columns THIS file carries before its extra
       ones — see knownColumns(). mdTableFile writes at least that many, so
       the household's column stays where the file put it. */
    known,
    headers: Array.from({ length: maxLen }, (_, i) => extraHeaders[i] ?? ''),
    sep: Array.from({ length: maxLen }, (_, i) => extraSep[i] ?? '---'),
  };
}

/* How many of a flat table's columns a FILE carries — the `known` the loader
   reads rows and extra cells with (2026-10-07 round-trip audit, L3-21).

   The frozen prefix is positional, as it always was. The optional tail
   (currency, appended by ADR-0004, written only by a file that uses it) is
   different: on most files on disk that slot is simply the next free column,
   which is exactly where a household puts a column of its own. Read by
   position, an Assets.md with a sixth column headed `Insured` had every
   `yes`/`no` read as the asset's currency — both assets "foreign", out of
   net worth — and the next save renamed the header to `Currency`.
   load.js already settles the identical question for a transaction file's
   Split column by reading the file's own header; this is the same rule for
   the tail (the owner's default): a slot is the schema's column only when
   the header cell there NAMES it (trimmed, case-folded). Any other header is
   the household's column, carried verbatim by attachExtraCells/extraColsOf.
   Where the header stops short of the slot (or leaves it blank), the slot is
   the schema's only while no row writes anything in it — blank reads the
   same either way, and that keeps a file with a trailing empty cell
   byte-stable rather than growing an unnamed column on its next save. */
function knownColumns(schema, header, dataRows) {
  const cols = schema.columns;
  let k = cols.length - (schema.optionalTail || 0);
  while (k < cols.length) {
    const h = String((header || [])[k] ?? '').trim();
    if (h) { if (h.toLowerCase() !== cols[k].header.toLowerCase()) break; }
    else if ((dataRows || []).some(c => String(c[k] ?? '').trim() !== '')) break;
    k++;
  }
  return k;
}

/* The line ending a block of text uses, read off its FIRST line break: '\r\n',
   '\n', or null for text with no line break at all. One rule for the loader
   (which records a file's own ending, L3-20) and mdTableFile (which writes
   every line with it). */
function lineEndingOf(text) {
  const s = typeof text === 'string' ? text : '';
  const i = s.indexOf('\n');
  if (i < 0) return null;
  return i > 0 && s[i - 1] === '\r' ? '\r\n' : '\n';
}

/* ISSUE 69. headerLines()/rowLine() with the extra columns appended after the
   schema's own — same pipe-joined shape, so a table with no extras (the
   common case, extraCols null) is unreachable through these and every
   existing byte stays exactly as usedColumns() already produces it. */
function headerLinesWithExtras(schema, extraCols) {
  const header = `| ${schema.columns.map(c => c.header).concat(extraCols.headers).join(' | ')} |`;
  const knownSep = schema.columns.map(c => {
    const width = c.header.length + 2;
    return c.align === 'right' ? '-'.repeat(width - 1) + ':' : '-'.repeat(width);
  });
  const sep = '|' + knownSep.concat(extraCols.sep).join('|') + '|';
  return [header, sep];
}

function rowLineWithExtras(schema, row, extraCols) {
  const known = schema.columns.map(c => c.write(row));
  const extra = row.extraCells || [];
  const named = extraCols.headers.map((_, i) => extra[i] ?? '');
  const surplus = extra.length > extraCols.headers.length ? extra.slice(extraCols.headers.length) : [];
  return `| ${known.concat(named, surplus).join(' | ')} |`;
}

/* Shared shapes. Each helper pairs a read with the write that reverses it,
   so a column declared with one cannot ship half of the contract. */

// Free text: \|-escaped on disk, unescaped in state.
const text = (key, header, fallback = '') => ({
  key, header, align: 'left',
  read: c => ({ [key]: unescMd(c || fallback) }),
  write: r => escMd(r[key]),
});

/* A date or other verbatim string. Written through escMd like every free cell,
   and — since 2026-09-09 — READ back through unescMd, which is the half that
   was missing.

   This module's own contract at the top says the escape pair lives in one
   declaration so the two cannot drift apart. Here they had: write escaped, read
   did not, so every save re-escaped an already-escaped cell. A hand-typed date
   holding a pipe — "June | maybe", the kind of thing that lands in these cells
   precisely because they accept text a date parser rejects — gained one
   backslash per save, forever:

     June \| maybe  ->  June \\| maybe  ->  June \\\| maybe  ->  …

   until a cell that was merely unparseable was unreadable. Five columns carried
   it: assets `valued`, owed `due` and `lent`, services `next`, debts `start`.

   unescMd also unwinds ONE level per load, so a cell already doubled by an
   older build heals on successive saves rather than needing a migration. A
   normal date has nothing to unescape, so no vault gets a churn diff — the
   golden gate pins those bytes. */
const verbatim = (key, header) => ({
  key, header, align: 'left',
  read: c => ({ [key]: unescMd(c || '') }),
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
   produced. Preferring it unconditionally would make an edit to a
   previously-unreadable cell vanish on save: the same bug one step to the left.
   A reader who deliberately types 0 into such a cell sees no change and the raw
   stands; the app cannot tell that from "never touched", and leaving the
   reader's own text alone is the honest side to be wrong on.

   Every in-place editor of these fields clears its own `<key>Raw` and parses
   through normalizeAmount — assets, debts, owed, services, budgets. That
   pairing is load-bearing in BOTH directions and the two halves must move
   together: this comment used to describe the editors as parsing with
   `parseFloat(e.target.value) || 0`, and while they did, an empty field (which
   is what a plain number input reports when an SA-locale keypad writes
   "15 000 000,00" into it) read as 0 AND cleared the raw beside it — so the
   preserved text this whole contract exists to protect went to 0.00 on disk
   with nothing said about it. A cell that yields no number must leave the
   stored figure alone; see the editMoney comment in views/debts.js.

   TWO MORE KINDS OF CELL the write used to overwrite (2026-10-07 round-trip
   audit), both kept the same way:

   A NEGATIVE IN A FLOORED COLUMN (L3-11). `floor` clamps at read, because
   every floored column is arithmetic input where a negative means nothing —
   but the clamped 0 was all the row kept, so `-250.00` on an overpaid store
   card or `-500.00` on a timeshare whose levies exceed its resale became
   `0.00` on disk at the next save of the page. The owner's decision: keep
   what was typed, clamp only in the arithmetic. The field still holds the
   floored number, so every total is exactly what it was; `<key>Raw` holds the
   typed text whenever flooring changed it. The editors on the Owed, Assets
   and Debts pages are the other half of that contract (they set both when a
   negative is typed, and say beside the row that it counts as 0).

   A FIGURE TWO DECIMALS CANNOT HOLD (L3-17). toFixed(2) rounded `11.125` — a
   prime-linked rate exactly as a contract states it — to `11.13` on a save
   triggered by any other row. Such a cell keeps its own text in `<key>Text`.
   Not `<key>Raw`: a raw has always meant "the reader typed something this
   column could not hold" (unreadable, or floored), and a readable number
   with a third decimal is neither — a reader of `<key>Raw` must not have to
   tell them apart. A cell two decimals CAN hold (`100`, `7.5`, `1 234,56`)
   keeps no text and is rewritten canonically exactly as before, so no file on
   disk changes bytes because of this.

   ONE WRITE RULE for all of them, the contract stated above: the kept text
   goes back only while the field still holds the number that text produces
   (valueOf, the read's own arithmetic). For an unreadable cell and a floored
   negative that number is 0 — precisely the old `!(r[key] || 0)` test — and
   for a kept third decimal it is the figure itself, so an edit to any other
   value is written at two decimals like every figure the app sets. */
/* True when rewriting `v` at two decimals would change the figure. */
const keepsDigits = v => Number.isFinite(v) && Number(v.toFixed(2)) !== v;

const money = (key, header, { floor = false, guarded = false } = {}) => {
  const rawKey = key + 'Raw';
  const textKey = key + 'Text';
  const valueOf = t => { const v = parseNum(t || '0').value || 0; return floor ? Math.max(0, v) : v; };
  return {
    key, header, align: 'right',
    read: c => {
      const a = parseNum(c || '0');
      const v = floor ? Math.max(0, a.value || 0) : (a.value || 0);
      const typed = String(c ?? '').trim();
      /* `!a.raw` is the blank-but-present cell — parseNum trims, so a cell of
         nothing but spaces arrives here as ''. Absent has always meant 0.00 on
         these tables and there is no reader's text to protect, so it must not
         be preserved: writing '' back would leave an empty cell where every
         other row states a figure. */
      if (!a.readable) return a.raw ? { [key]: v, [rawKey]: a.raw } : { [key]: v };
      if (floor && (a.value || 0) < 0) return { [key]: v, [rawKey]: typed };
      return keepsDigits(v) ? { [key]: v, [textKey]: typed } : { [key]: v };
    },
    write: r => {
      const held = r[key] || 0;
      if (r[rawKey] != null && held === valueOf(r[rawKey])) return r[rawKey];
      if (r[textKey] != null && held === valueOf(r[textKey])) return r[textKey];
      return (guarded ? (r[key] || 0) : r[key]).toFixed(2);
    },
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

/* A yes/no cell read as a BOOLEAN — vocab()'s contract for the two columns
   whose value is true/false rather than one of two words.

   Both were declared by hand without it, and both destroyed what was typed
   (2026-10-07 round-trip audit). Services.md `Active` read "anything but
   `no` is active" and wrote `yes`/`no`: `cancelled` and `paused` were
   counted as committed spending on the Dashboard, and the next save of the
   page wrote `yes` over them (L3-09). A transaction's `Excluded` read true
   for exactly `yes`: a hand-typed `x` or `true` loaded as NOT excluded — a
   windfall the household had marked was counted as income — and the next
   write of the month blanked the mark (L3-10).

   `on` and `off` are the words that read as true and false; anything else
   reads as `absent`, the value an empty cell has always meant on that column,
   so an unknown word keeps exactly the reading it had before. The canonical
   spellings (`words`, what the app itself writes) keep no raw, so every file
   already on disk writes the bytes it always did; any other non-blank cell
   keeps its text in `<key>Raw`, written back while the field still holds the
   value that text produces — the toggle on the page still wins. */
const flag = (key, header, { on, off = [], absent, words }) => {
  const rawKey = key + 'Raw';
  const [yesWord, noWord] = words;
  const valueOf = w => {
    const f = String(w).trim().toLowerCase();
    return on.includes(f) ? true : off.includes(f) ? false : absent;
  };
  return {
    key, header, align: 'left',
    read: c => {
      const raw = (c || '').trim();
      if (!raw) return { [key]: absent };
      const v = valueOf(raw);
      return raw.toLowerCase() === (v ? yesWord : noWord) ? { [key]: v } : { [key]: v, [rawKey]: raw };
    },
    write: r => (r[rawKey] != null && valueOf(r[rawKey]) === !!r[key] ? r[rawKey] : (r[key] ? yesWord : noWord)),
  };
};

/* The words fmBool() in load.js reads a frontmatter flag with, so a table
   cell and a frontmatter key read the same word the same way. Each flag
   column adds its own column-specific words below. */
const TRUE_WORDS = ['yes', 'true', 'on', '1'];
const FALSE_WORDS = ['no', 'false', 'off', '0'];

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
/* Same escape pair as verbatim() above, and it was missing the same half —
   ISSUE 76 named this column alongside those five. A symbol is the least likely
   cell in the file to hold a pipe, which is exactly why it would have been the
   last one anyone noticed drifting. Five tables carry it. */
const currency = () => ({
  key: 'currency', header: 'Currency', align: 'left',
  read: c => ({ currency: unescMd(c || '') }),
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
      /* Active is a yes/no cell read as a boolean. An absent cell on an old
         file means what it always meant, an active service — and so does a
         word this list does not know. The words a household writes for a
         service that has stopped (`cancelled`, `paused`, …) read as inactive
         and are kept as typed; see flag(). */
      flag('active', 'Active', {
        on: [...TRUE_WORDS, 'active'],
        off: [...FALSE_WORDS, 'cancelled', 'canceled', 'paused', 'inactive'],
        absent: true, words: ['yes', 'no'],
      }),
      text('notes', 'Notes'),
      currency(),
    ],
  },

  /* Debts.md — the twelve-column cautionary tale CLAUDE.md names. Money
     columns floor at 0 for the arithmetic: every figure here is input to the
     payoff maths, where a negative means nothing. What the household TYPED is
     still what goes back to disk — an unreadable cell, a negative and a third
     decimal are each kept by money()'s rules. */
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
        /* Floored like the balance beside it, so it keeps a typed negative and
           a third decimal by money()'s rules too (L3-11, L3-17). */
        read: c => {
          if (c === undefined || c === '') return { original: null };
          const a = parseNum(c);
          const v = Math.max(0, a.value || 0);
          if (!a.readable) return a.raw ? { original: v, originalRaw: a.raw } : { original: v };
          if ((a.value || 0) < 0) return { original: v, originalRaw: String(c).trim() };
          return keepsDigits(v) ? { original: v, originalText: String(c).trim() } : { original: v };
        },
        /* ISSUE 68. A cell the household left EMPTY goes back empty. load.js's
           post() fills `original` from the balance so the payoff maths has a
           divisor; `originalStated: false` is how it says that figure was
           derived rather than typed, and writing it would turn a blank into a
           claim the household never made.

           The `== null` arm is that same sentence for a row that never met
           post(). null is this column's DECLARED state for an absent-or-empty
           cell — the read above mints it and the comment there calls it
           legitimate — so the write has to reverse it, and '' is the cell that
           reads back as null. Without the arm such a row reached `.toFixed` on
           null and threw; and because rowLine() maps over EVERY column the
           throw escaped rowLine and then mdTableFile, so the failure was not
           one wrong cell but no document at all — Debts.md never written and
           the healthy rows beside it lost with it. usedColumns() already wraps
           this identical call in `catch (e) { return true; }`; rowLine does
           not, and a write that is total for every state its own read produces
           should not need it to. Nothing in the app reaches this today —
           S.debts is filled in exactly two places, load.js's post() and
           addDebt(), and both leave a number behind — so this is the guard
           for the third writer, not a fix for a live crash. */
        write: r => {
          if (r.originalStated === false) return '';
          const held = r.original || 0;
          const valueOf = t => Math.max(0, parseNum(t).value || 0);
          if (r.originalRaw != null && held === valueOf(r.originalRaw)) return r.originalRaw;
          if (r.originalText != null && held === valueOf(r.originalText)) return r.originalText;
          return r.original == null ? '' : r.original.toFixed(2);
        },
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
        /* `amountText`: a strictly-parsed cell two decimals cannot hold
           (`-912.345` off a fuel slip) keeps its own text, written back while
           the amount is still the one it produced — money()'s L3-17 rule. A
           cell the strict parser rejected already goes back verbatim through
           amountRaw, so this only ever applies to an `ok` cell. */
        read: c => {
          const a = parseNum(c);
          const out = { amount: a.value, amountRaw: a.ok ? null : a.raw };
          if (a.ok && keepsDigits(a.value)) out.amountText = String(c).trim();
          return out;
        },
        write: r => (r.amountRaw != null ? r.amountRaw
          : r.amountText != null && parseNum(r.amountText).value === r.amount ? r.amountText
            : r.amount.toFixed(2)),
      },
      /* `excluded` means "out of the budget totals" (CLAUDE.md). `yes` and a
         blank cell are what the app writes; `x`, `true`, `1`, `on` read as
         excluded and are kept as typed; any other word reads as not excluded,
         as before, and is kept rather than blanked. See flag(). */
      flag('excluded', 'Excluded', { on: [...TRUE_WORDS, 'x'], absent: false, words: ['yes', ''] }),
      text('note', 'Note'),
      {
        /* Read through splitRole, the single door — only `parent` and `part`
           are roles. A cell holding anything else (`todo`, `check`) used to be
           ERASED by this read, so nothing downstream could ever write it back
           (L3-10). It now keeps its text in `splitRaw`, written back while the
           row still has no role; whether the Split column is written at all is
           serializeTxFile's decision, not this column's. The raw is the cell as
           parseMdTable gave it (still \|-escaped), so it goes back unescaped
           exactly as vocab()'s raw does. */
        key: 'split', header: 'Split', align: 'left',
        read: c => {
          const role = splitRole(c);
          const raw = (c || '').trim();
          return raw && !role ? { split: role, splitRaw: raw } : { split: role };
        },
        write: r => {
          const role = splitRole(r.split);
          return r.splitRaw != null && !role ? r.splitRaw : role;
        },
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

/* ISSUE 67/69. `leadRaw`/`trailRaw` are the raw text load.js captured around
   the table last load (via markdown.js's splitAroundTable) — null for a file
   that was never loaded, which regenerates exactly the fixed shape below and
   keeps every golden byte this function has always produced. `extraCols`
   (ISSUE 69) is table-schema.js's own concern: when a file carries columns
   this schema does not model, `used` stays the FULL schema rather than
   usedColumns()'s trimmed one, because a row already holding data past the
   optional tail fixes that tail's position on disk whether or not this
   particular save would otherwise have dropped it.

   L3-21: "the FULL schema" became "as many columns as the FILE carries"
   (extraCols.known, from knownColumns) — or more, the day a row starts using
   the optional column. Writing the full schema regardless put a Currency
   column in front of a household's own column that had been sitting in its
   slot; the header now says Currency only when the file did, or when a row
   has one to state. An extraCols object without `known` (built before it
   existed) still gets the full schema, as before.

   L3-20: every line is written with the line ending the captured text
   carries (load.js joins a CRLF file's lead and trail with '\r\n'). The
   frontmatter used to be split on '\n' alone and the rest joined with '\n',
   so a CRLF file came back with two line-ending styles in it. An LF file —
   every file this plugin creates — writes exactly the bytes it always did. */
function mdTableFile({ fm, fallback, title, prose, schema, rows, leadRaw, trailRaw, extraCols }) {
  const fileCols = extraCols && Number.isInteger(extraCols.known) ? extraCols.known : schema.columns.length;
  const used = { ...schema, columns: extraCols
    ? schema.columns.slice(0, Math.max(fileCols, usedColumns(schema, rows).length))
    : usedColumns(schema, rows) };
  const leadLines = withLeadExtra(leadRaw, freshLeadLines(title, prose));
  const [header, sep] = extraCols ? headerLinesWithExtras(used, extraCols) : headerLines(used);
  const lines = ['---', ...(fm || fallback).split(/\r?\n/), '---', ...leadLines, header, sep];
  for (const r of rows) lines.push(extraCols ? rowLineWithExtras(used, r, extraCols) : rowLine(used, r));
  lines.push(...(trailRaw ? trailRaw.split(/\r?\n/) : ['']));
  const eol = lineEndingOf(leadRaw) || lineEndingOf(trailRaw) || lineEndingOf(fm) || '\n';
  return lines.join(eol);
}

module.exports = {
  SCHEMAS, headerLines, rowLine, rowToObject, mdTableFile, usedColumns, CYCLES,
  attachExtraCells, extraColsOf, headerLinesWithExtras, rowLineWithExtras,
  knownColumns, lineEndingOf, keepsDigits,
};
