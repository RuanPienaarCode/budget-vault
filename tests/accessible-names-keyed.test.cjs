'use strict';
/* NO ACCESSIBLE NAME IS WRITTEN IN ENGLISH — EVERY ONE GOES THROUGH i18n.t().

   The interface language is the plugin's own setting, independent of
   Obsidian's (src/i18n.js), and twelve tables ship. Until November 2026 the
   words a screen reader speaks were the part of that the migration had not
   reached. The audit of 11 Nov 2026 (task 19) grepped about 73 `aria-label`
   and 24 `title` literals; read with this scan, which follows a name to where
   it is written, it was 100 places an attribute was set from English (88
   aria-label, 12 title) across 17 files. Most were on pages whose VISIBLE copy
   is still English too (Savings, Tax, Owed money, Services, Food — see
   EXPECTED_ENGLISH_ONLY in tests/i18n-render.test.cjs), but the Plan and
   Assets pages, the split dialog, the import table and the note chip drawn on
   five other pages had them as well. A reader with the interface in
   isiZulu heard a Zulu page with "Remove", "Amount for" and "click to
   change" read into it, in the host's voice, because the plugin root carried
   no `lang` either (tests/i18n-lang-attribute.test.cjs).

   An accessible name is not like the rest of an untranslated page. A sighted
   reader on a half-English page can see which half is which; a name that is
   only ever spoken arrives with no such context. So the names are keyed on
   EVERY page, including the ones whose visible copy is still waiting, and this
   file is what keeps them keyed.

   WHAT IS CHECKED. The value given to `aria-label`, `aria-description`,
   `aria-roledescription`, `aria-valuetext`, `title` or `alt`, wherever src/
   sets one:

     attribute object   el('button', { 'aria-label': … })   createEl(…, { attr: { title: … } })
     setAttribute       b.setAttribute('aria-label', …)      (setAttr, setAttributeNS too)
     property           b.ariaLabel = …    img.alt = …       b.title = …
     tooltip            setTooltip(el, …)  btn.setTooltip(…)  addRibbonIcon(icon, …)
                        — Obsidian writes all three as the element's aria-label
     static markup      aria-label="…" inside an HTML string (src/shell.js)

   A value fails when English can be SEEN in it: a string literal with a letter
   in it, a template literal with a letter outside its `${…}` holes, or either
   of those reached through `+`, `?:`, `||`, `&&`, `??`, an array `.join()`, or
   an English fragment handed to i18n.t() as a parameter (`{ what: 'this
   figure' }` is a concatenation with extra steps).

   Static markup is allowed its English on one condition: the same tag carries
   the `data-i18n-aria` / `data-i18n-title` that applyDom() overwrites it from,
   so the literal is only ever the text shown before the first pass.

   WHAT IS FOLLOWED, AND WHY A VARIABLE IS NOT ENOUGH. Most names here are not
   written at the attribute. They are built two lines up (`const aria = …`),
   picked from a table (`STEP_LABEL[s.status]`), or passed to a helper that
   sets them (`rangePills({ label: 'Chart range' })`, `createChart({ label })`,
   `deferredCatSelect(cat, onchange, \`Category for ${it.desc}\`)`). A guard
   that stopped at the first identifier would have passed all of those — they
   are what the audit's grep could not count. So a
   value that is a name is followed to what it holds, as far as that can be
   read off the code without running it:

     - a `const` / `let` in an enclosing scope  -> its initialiser, and every
       assignment to it in that scope
     - a destructured binding                    -> that property of the source
     - `TABLE[key]` / `TABLE.key`                -> the object literal's values
     - a parameter of a named function           -> that argument at every call
       of the function this suite can attribute to it (same file; another file
       only where the caller has no function of that name of its own), and the
       parameter's default
     - a call to a function in the same file     -> what it returns

   Anything that cannot be followed — a callback's parameter, a field of a row
   read from the vault, a value from another module's function — is NOT a
   failure. It is a variable, and a variable is what a translated name looks
   like. The guard only fails on English it can actually point at, and the
   message says which literal, not just which attribute.

   WHY A PARSER AND NOT A GREP: the reason tests/ios-floor.test.cjs gives. This
   source explains itself, and the explanations say "aria-label" and "title"
   in nearly every file; a grep cannot tell `// the aria-label carries the
   totals` from code, nor `title: 'Delete note'` (a dialog's heading, visible
   copy, not an attribute) from `el('span', { title: '…' })`. `title` and
   `alt` are only read as attributes where they are in an attribute object:
   an argument of a DOM builder, or the value of `attr:`.

   NOT A NAME: TEXT THE PAGE ALSO PRINTS. Three things look like names here
   and are visible copy, which the pages that are still English keep in English
   until each one's own translation pass:

     - `placeholder` is printed in the field, and `data-label` is the column
       name a stacked table row prints on a phone. Neither is read here.
     - an SVG `<title>` (src/chart.js tip()) is a hover and touch-and-hold
       tooltip on a mark inside a role="img" chart. The chart's children are
       not exposed to a screen reader at all — its aria-label is the whole of
       what one hears, and that IS checked.
     - a MIRROR: an attribute that only repeats text its own component prints.
       dom.js caveatChip() gives its button `title: detailText` and prints the
       same `detailText` in the panel the button opens, so the sixty-odd
       caveat sentences that reach that title are the page's visible copy, not
       a second, spoken-only string. MIRRORS lists these (one today), and the
       claim is checked rather than taken on trust: the listed function must
       still hand that same variable to an element as its text.

   KNOWN is the ratchet, as in ios-floor: an entry stops a hit failing the
   suite and must still match something, so the list can only shrink on
   purpose. One entry today — the ribbon button's title, which is read at
   plugin load; its reason is beside it.

   Needs the dev dependency `typescript`.
     node tests/accessible-names-keyed.test.cjs
     node tests/accessible-names-keyed.test.cjs --list     every name the scan read, and what it could not follow */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let ts;
try {
  ts = require('typescript');
} catch (e) {
  console.error('FAIL tests/accessible-names-keyed.test.cjs — the dev dependencies are not installed. Run `npm ci`.');
  process.exit(1);
}

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const K = ts.SyntaxKind;
const LIST = process.argv.includes('--list');

/* ---- what counts as a name ------------------------------------------------- */

const NAME_ATTRS = new Set(['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'title', 'alt']);
/* The DOM properties that reflect them. */
const NAME_PROPS = new Map([
  ['ariaLabel', 'aria-label'], ['ariaDescription', 'aria-description'],
  ['ariaRoleDescription', 'aria-roledescription'], ['ariaValueText', 'aria-valuetext'],
  ['title', 'title'], ['alt', 'alt'],
]);
/* `title` and `alt` are also ordinary field names — a dialog's heading, a
   note's title, a rule's alternate pattern — so as OBJECT KEYS they are only
   read as attributes inside an attribute object. The aria-* names are
   unambiguous and are read wherever they appear. */
const AMBIGUOUS = new Set(['title', 'alt']);
/* The calls that take an attribute object: this repo's own `el` and
   `dateInput` (src/dom.js), and Obsidian's. Obsidian's DomElementInfo takes
   `title` directly as well as under `attr`. */
const DOM_BUILDERS = new Set(['el', 'dateInput', 'createEl', 'createDiv', 'createSpan', 'createSvg', 'setAttrs', 'createFragment']);
const SET_ATTRIBUTE = new Set(['setAttribute', 'setAttr', 'setAttributeNS']);
/* A name that only repeats what its own component prints — see the header.
   `prints` is the variable that must reach both the attribute and an
   element's text inside `fn`. */
const MIRRORS = [
  { file: 'src/dom.js', fn: 'caveatChip', attr: 'title', prints: 'detailText',
    why: 'the chip\'s title repeats the detail it discloses on tap — visible copy, translated with its page' },
];
/* In static markup, the attribute applyDom() fills each one from. A name with
   no binding here cannot be translated in markup at all. */
const MARKUP_BINDING = new Map([['aria-label', 'data-i18n-aria'], ['title', 'data-i18n-title']]);

/* A letter of any script. Digits, punctuation, arrows, a currency sign and
   "—" are not English, and "%" in a name is not a sentence. */
const HAS_LETTER = /\p{L}/u;

/* ---- reading the tree ------------------------------------------------------ */

const unwrap = n => {
  while (n && (n.kind === K.ParenthesizedExpression || n.kind === K.NonNullExpression)) n = n.expression;
  return n;
};
const isFn = n => n.kind === K.FunctionDeclaration || n.kind === K.FunctionExpression || n.kind === K.ArrowFunction
  || n.kind === K.MethodDeclaration || n.kind === K.Constructor || n.kind === K.GetAccessor || n.kind === K.SetAccessor;
const keyText = name => (name && (name.kind === K.Identifier || ts.isStringLiteralLike(name) || name.kind === K.NumericLiteral)
  ? name.text : null);
/* The last name of what is being called: `el`, `x.createEl`, `ctx.rangeToggle`. */
const calleeName = call => {
  const c = unwrap(call.expression);
  if (!c) return null;
  if (c.kind === K.Identifier) return c.text;
  if (c.kind === K.PropertyAccessExpression) return c.name.text;
  return null;
};

/* Where in a binding pattern `target` is bound, as the path of keys from the
   bound value down to it — [] for a plain name, ['label'] for `{ label }`,
   ['opts', 'label'] for `{ opts: { label } }`, [1] for `[, label]`. */
function pathIn(binding, target) {
  if (binding.kind === K.Identifier) return binding.text === target ? [] : null;
  if (binding.kind === K.ObjectBindingPattern) {
    for (const e of binding.elements) {
      if (e.dotDotDotToken) continue;
      const key = keyText(e.propertyName || e.name);
      const rest = pathIn(e.name, target);
      if (rest && key !== null) return [key, ...rest];
    }
  } else if (binding.kind === K.ArrayBindingPattern) {
    for (let i = 0; i < binding.elements.length; i++) {
      const e = binding.elements[i];
      if (e.kind !== K.BindingElement || e.dotDotDotToken) continue;
      const rest = pathIn(e.name, target);
      if (rest) return [i, ...rest];
    }
  }
  return null;
}

/* What an identifier is bound to, found by walking outward through the scopes
   that enclose it. Null for a global or anything this cannot see. */
function bindingOf(id) {
  const name = id.text;
  for (let p = id.parent; p; p = p.parent) {
    if (isFn(p)) {
      for (let i = 0; i < p.parameters.length; i++) {
        const at = pathIn(p.parameters[i].name, name);
        if (at) return { kind: 'param', fn: p, index: i, path: at, param: p.parameters[i] };
      }
    }
    if (p.statements) {
      for (const s of p.statements) {
        if (s.kind === K.VariableStatement) {
          for (const d of s.declarationList.declarations) {
            const at = pathIn(d.name, name);
            if (at) return { kind: 'var', decl: d, path: at, scope: p };
          }
        } else if (s.kind === K.FunctionDeclaration && s.name && s.name.text === name) {
          return { kind: 'fn', fn: s };
        }
      }
    }
    if ((p.kind === K.ForStatement || p.kind === K.ForOfStatement || p.kind === K.ForInStatement)
      && p.initializer && p.initializer.kind === K.VariableDeclarationList) {
      for (const d of p.initializer.declarations) if (pathIn(d.name, name)) return { kind: 'opaque' };
    }
    if (p.kind === K.CatchClause && p.variableDeclaration && pathIn(p.variableDeclaration.name, name)) return { kind: 'opaque' };
  }
  return null;
}

/* The name a function goes by, for finding its calls: its own, or the
   variable / property it is the value of. */
function nameOfFn(fn) {
  if (fn.name && keyText(fn.name) !== null) return keyText(fn.name);
  const p = fn.parent;
  if (!p) return null;
  if ((p.kind === K.VariableDeclaration || p.kind === K.PropertyAssignment) && p.initializer === fn) return keyText(p.name);
  return null;
}

/* ---- the scan --------------------------------------------------------------

   Two passes. `index` parses every file and records what the second pass has
   to look across files for: every call by the name it calls, and every named
   function. `names` then reads each attribute site and follows its value. */

function parse(text, label) {
  const sf = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) {
    const d = sf.parseDiagnostics[0];
    const at = sf.getLineAndCharacterOfPosition(d.start || 0);
    throw new Error(`${label}:${at.line + 1} does not parse (${ts.flattenDiagnosticMessageText(d.messageText, ' ')}) — `
      + 'a file this guard cannot read is a file it cannot vouch for');
  }
  return sf;
}

function index(files) {
  const calls = new Map();        // callee name -> [CallExpression]
  const fns = new Map();          // function name -> [function node]
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const parsed = [];
  for (const { rel, text } of files) {
    const sf = parse(text, rel);
    parsed.push({ rel, text, sf });
    const visit = n => {
      if (n.kind === K.CallExpression) { const c = calleeName(n); if (c) push(calls, c, n); }
      if (isFn(n)) { const nm = nameOfFn(n); if (nm) push(fns, nm, n); }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { parsed, calls, fns };
}

function scanAll(files) {
  const { parsed, calls, fns } = index(files);
  const mirrored = new Set();     // the MIRRORS entries that matched a site
  const hits = [];                // English found in a name
  const read = [];                // every name site, for --list and the counts
  const loose = [];               // values the scan could not follow to an end

  const where = node => {
    const sf = node.getSourceFile();
    const at = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { file: sf.fileName, line: at.line + 1 };
  };

  /* Is this call a call of `fn`? Same file: yes if the name it calls resolves
     to that function, or is a member call (`this.field(…)`, `ctx.field(…)`).
     Another file: only when the caller has no function of that name in reach
     of its own — otherwise two views that each define a local `pill()` would
     answer for each other's arguments. */
  function callsOf(fn) {
    const nm = nameOfFn(fn);
    if (!nm) return [];
    const sameNamed = fns.get(nm) || [];
    return (calls.get(nm) || []).filter(call => {
      const c = unwrap(call.expression);
      if (c.kind === K.Identifier) {
        const b = bindingOf(c);
        if (b && b.kind === 'fn') return b.fn === fn;
        if (b && b.kind === 'var' && b.path.length === 0 && b.decl.initializer && isFn(unwrap(b.decl.initializer))) {
          return unwrap(b.decl.initializer) === fn;
        }
        if (b && b.kind === 'param') return false;      // a callback handed in — not this function
        /* Imported (`const { rangeToggle } = require('./chart')`), taken off
           ctx, or a global: attributed only when the name is one function. */
        return sameNamed.length === 1;
      }
      /* `x.name(…)`: a member call. Attributed when the name is one function
         across src/, or the function lives in the calling file. */
      return sameNamed.length === 1 || call.getSourceFile() === fn.getSourceFile();
    });
  }

  /* ---- what a value can be: the expressions it may evaluate to -------------

     `follow` turns one expression into the set of expressions that are, as
     far as the code says, what it holds — itself if it is already a literal
     or a composition, otherwise whatever it names. `select` then steps into
     one property of each. Depth-limited and cycle-safe; a step that cannot be
     taken yields nothing and is noted in `loose`. */
  const MAX_DEPTH = 6;

  function follow(expr, depth, trail, note) {
    expr = unwrap(expr);
    if (!expr || depth > MAX_DEPTH || trail.has(expr)) return [];
    trail = new Set(trail).add(expr);
    switch (expr.kind) {
      case K.Identifier: {
        if (expr.text === 'undefined') return [];
        const b = bindingOf(expr);
        if (!b || b.kind === 'opaque') { note(expr); return []; }
        if (b.kind === 'fn') return [];
        let sources = [];
        if (b.kind === 'var') {
          if (b.decl.initializer) sources.push(b.decl.initializer);
          if (b.path.length === 0) {
            /* `let aria; … aria = …;` — every assignment in the declaring scope. */
            const walk = n => {
              if (n.kind === K.BinaryExpression && unwrap(n.left).kind === K.Identifier && unwrap(n.left).text === expr.text
                && (n.operatorToken.kind === K.EqualsToken || n.operatorToken.kind === K.PlusEqualsToken
                  || n.operatorToken.kind === K.BarBarEqualsToken || n.operatorToken.kind === K.QuestionQuestionEqualsToken)) {
                sources.push(n.right);
              }
              ts.forEachChild(n, walk);
            };
            walk(b.scope);
          }
        } else {
          /* A parameter: its default, and that argument at every call. */
          if (b.param.initializer) sources.push(b.param.initializer);
          const sites = callsOf(b.fn);
          if (!sites.length) note(expr);
          for (const call of sites) {
            if (call.arguments.some(a => a.kind === K.SpreadElement)) { note(expr); continue; }
            const arg = call.arguments[b.index];
            if (arg) sources.push(arg);
          }
          if (b.param.dotDotDotToken) { note(expr); sources = []; }
        }
        let out = sources.flatMap(s => follow(s, depth + 1, trail, note));
        for (const key of b.path) out = out.flatMap(c => select(c, key, depth + 1, trail, note));
        /* A destructured parameter's own default: `({ label = 'Range' })`. */
        return out;
      }
      case K.PropertyAccessExpression:
        return follow(expr.expression, depth + 1, trail, () => note(expr))
          .flatMap(c => select(c, expr.name.text, depth + 1, trail, note));
      case K.ElementAccessExpression: {
        const arg = unwrap(expr.argumentExpression);
        const key = arg && (ts.isStringLiteralLike(arg) || arg.kind === K.NumericLiteral) ? arg.text : undefined;
        return follow(expr.expression, depth + 1, trail, () => note(expr))
          .flatMap(c => select(c, key, depth + 1, trail, note));
      }
      case K.CallExpression: {
        /* A function of this file: what it returns. */
        const c = unwrap(expr.expression);
        if (c.kind === K.Identifier && !isTranslate(expr)) {
          const b = bindingOf(c);
          const fn = b && b.kind === 'fn' ? b.fn
            : b && b.kind === 'var' && b.path.length === 0 && b.decl.initializer && isFn(unwrap(b.decl.initializer))
              ? unwrap(b.decl.initializer) : null;
          if (fn) return returnsOf(fn).flatMap(r => follow(r, depth + 1, trail, note));
        }
        return [expr];
      }
      default:
        return [expr];
    }
  }

  /* One property of a value. `key === undefined` is a computed index: every
     value the object or array holds is a candidate. */
  function select(expr, key, depth, trail, note) {
    expr = unwrap(expr);
    if (!expr) return [];
    if (expr.kind === K.ObjectLiteralExpression) {
      const out = [];
      for (const p of expr.properties) {
        if (p.kind === K.SpreadAssignment) {
          out.push(...follow(p.expression, depth, trail, note).flatMap(c => select(c, key, depth, trail, note)));
        } else if (p.kind === K.PropertyAssignment && (key === undefined || keyText(p.name) === String(key))) {
          out.push(...follow(p.initializer, depth, trail, note));
        } else if (p.kind === K.ShorthandPropertyAssignment && (key === undefined || p.name.text === String(key))) {
          out.push(...follow(p.name, depth, trail, note));
        }
      }
      return out;
    }
    if (expr.kind === K.ArrayLiteralExpression) {
      const picked = key === undefined || Number.isNaN(Number(key)) ? expr.elements : [expr.elements[Number(key)]].filter(Boolean);
      return picked.flatMap(e => follow(e, depth, trail, note));
    }
    if (expr.kind === K.ConditionalExpression) {
      return [expr.whenTrue, expr.whenFalse].flatMap(e => follow(e, depth, trail, note))
        .flatMap(c => select(c, key, depth, trail, note));
    }
    if (expr.kind === K.BinaryExpression && (expr.operatorToken.kind === K.BarBarToken
      || expr.operatorToken.kind === K.QuestionQuestionToken || expr.operatorToken.kind === K.AmpersandAmpersandToken)) {
      return [expr.left, expr.right].flatMap(e => follow(e, depth, trail, note))
        .flatMap(c => select(c, key, depth, trail, note));
    }
    note(expr);
    return [];
  }

  /* The expressions a function can return — its concise body, or every
     `return` that belongs to it rather than to a function inside it. */
  function returnsOf(fn) {
    if (!fn.body) return [];
    if (fn.body.kind !== K.Block) return [fn.body];
    const out = [];
    const walk = n => {
      if (isFn(n)) return;
      if (n.kind === K.ReturnStatement && n.expression) out.push(n.expression);
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(fn.body, walk);
    return out;
  }

  /* `i18n.t(…)`, `t(…)`, `ctx.t(…)`. */
  function isTranslate(call) {
    const c = unwrap(call.expression);
    return (c.kind === K.Identifier && c.text === 't') || (c.kind === K.PropertyAccessExpression && c.name.text === 't');
  }

  /* The English visible in a value: the literal nodes that carry a letter. */
  function english(expr, depth, trail, note) {
    const out = [];
    const walk = (e, d, tr) => {
      for (const c of follow(e, d, tr, note)) {
        const n = unwrap(c);
        const next = new Set(tr).add(n);
        switch (n.kind) {
          case K.StringLiteral:
          case K.NoSubstitutionTemplateLiteral:
            if (HAS_LETTER.test(n.text)) out.push(n);
            break;
          case K.TemplateExpression:
            if (HAS_LETTER.test(n.head.text) || n.templateSpans.some(s => HAS_LETTER.test(s.literal.text))) out.push(n);
            for (const s of n.templateSpans) walk(s.expression, d + 1, next);
            break;
          case K.BinaryExpression: {
            const op = n.operatorToken.kind;
            if (op === K.PlusToken || op === K.BarBarToken || op === K.QuestionQuestionToken || op === K.AmpersandAmpersandToken
              || op === K.CommaToken) {
              if (op !== K.CommaToken && op !== K.AmpersandAmpersandToken) walk(n.left, d + 1, next);
              walk(n.right, d + 1, next);
            }
            break;
          }
          case K.ConditionalExpression:
            walk(n.whenTrue, d + 1, next);
            walk(n.whenFalse, d + 1, next);
            break;
          case K.ArrayLiteralExpression:
            for (const el of n.elements) walk(el.kind === K.SpreadElement ? el.expression : el, d + 1, next);
            break;
          case K.CallExpression: {
            if (isTranslate(n)) {
              /* The key is not a name. The parameters are: an English fragment
                 handed in to be interpolated is still English in the result. */
              const params = n.arguments[1] && unwrap(n.arguments[1]);
              if (params && params.kind === K.ObjectLiteralExpression) {
                for (const p of params.properties) {
                  if (p.kind === K.PropertyAssignment) walk(p.initializer, d + 1, next);
                  else if (p.kind === K.ShorthandPropertyAssignment) walk(p.name, d + 1, next);
                }
              }
              break;
            }
            /* `[a, 'Paid'].join(' ')`, `\`Delete ${x}\`.trim()` — the thing the
               method is called on is still the text. */
            const callee = unwrap(n.expression);
            if (callee.kind === K.PropertyAccessExpression) {
              const on = unwrap(callee.expression);
              if (on.kind === K.ArrayLiteralExpression || on.kind === K.TemplateExpression || ts.isStringLiteralLike(on)
                || on.kind === K.BinaryExpression || on.kind === K.ParenthesizedExpression) walk(on, d + 1, next);
              else if (['trim', 'toLowerCase', 'toUpperCase', 'join', 'concat', 'filter', 'replace', 'slice'].includes(callee.name.text)
                && on.kind !== K.CallExpression) walk(on, d + 1, next);
              else note(n);
            } else note(n);
            break;
          }
          default:
            /* A number, `null`, a regex, a `new` — not text. Anything else that
               reaches here is a value the code does not spell out. */
            if (n.kind !== K.NumericLiteral && n.kind !== K.NullKeyword && n.kind !== K.TrueKeyword && n.kind !== K.FalseKeyword
              && n.kind !== K.VoidExpression && n.kind !== K.ObjectLiteralExpression) note(n);
        }
      }
    };
    walk(expr, depth, trail);
    return [...new Set(out)];
  }

  /* Is this site a declared mirror, and is the declaration still true? The
     value must be the bare variable MIRRORS names, and the same function must
     pass that variable to a DOM builder as a child — which is what "prints
     it" means in this codebase (el(tag, attrs, ...kids)). */
  function mirrorOf(attr, value, at) {
    const file = at.getSourceFile().fileName;
    let fn = at.parent;
    while (fn && !(isFn(fn) && nameOfFn(fn))) fn = fn.parent;
    if (!fn) return null;
    const m = MIRRORS.find(x => x.file === file && x.attr === attr && x.fn === nameOfFn(fn));
    if (!m) return null;
    const v = unwrap(value);
    if (v.kind !== K.Identifier || v.text !== m.prints) return null;
    let printed = false;
    const walk = n => {
      if (n.kind === K.CallExpression && DOM_BUILDERS.has(calleeName(n))
        && n.arguments.slice(2).some(a => unwrap(a).kind === K.Identifier && unwrap(a).text === m.prints)) printed = true;
      ts.forEachChild(n, walk);
    };
    walk(fn);
    return printed ? m : null;
  }

  /* One name site: record it, and record the English in it. */
  function site(attr, value, at, how) {
    const mirror = mirrorOf(attr, value, at);
    if (mirror) {
      read.push({ ...where(at), attr, how: 'mirror', value: value.getText() });
      mirrored.add(mirror);
      return;
    }
    const notes = [];
    const found = english(value, 0, new Set(), n => notes.push(n));
    const w = where(at);
    read.push({ ...w, attr, how, value: value.getText().replace(/\s+/g, ' ').slice(0, 120) });
    for (const lit of found) {
      const lw = where(lit);
      hits.push({ ...w, attr, how, literal: lit.getText().replace(/\s+/g, ' ').slice(0, 110),
        from: lw.file === w.file && lw.line === w.line ? '' : `${lw.file}:${lw.line}` });
    }
    for (const n of new Set(notes)) {
      loose.push({ ...w, attr, expr: n.getText().replace(/\s+/g, ' ').slice(0, 90) });
    }
  }

  /* Is this object literal an attribute object? Climbs out through the ways
     one is assembled — `...(cond ? { title: x } : {})`, `cond && { … }` — to
     the call or the `attr:` it ends up in. */
  function isAttrObject(obj) {
    for (let child = obj, p = obj.parent; p; child = p, p = p.parent) {
      if (p.kind === K.ParenthesizedExpression || p.kind === K.ConditionalExpression || p.kind === K.SpreadAssignment) continue;
      if (p.kind === K.BinaryExpression && (p.operatorToken.kind === K.AmpersandAmpersandToken
        || p.operatorToken.kind === K.BarBarToken || p.operatorToken.kind === K.QuestionQuestionToken)) continue;
      if (p.kind === K.ObjectLiteralExpression && child.kind === K.SpreadAssignment) continue;
      if (p.kind === K.PropertyAssignment && p.initializer === child) return keyText(p.name) === 'attr';
      if (p.kind === K.CallExpression && p.arguments.includes(child)) return DOM_BUILDERS.has(calleeName(p));
      return false;
    }
    return false;
  }

  /* Static markup inside a string: every tag that carries a name. */
  const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g;
  const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  function markup(node) {
    const text = node.getText();
    if (text.indexOf('<') < 0) return;
    const sf = node.getSourceFile();
    for (const tag of text.matchAll(TAG)) {
      const attrs = new Map();
      for (const a of tag[2].matchAll(ATTR)) attrs.set(a[1].toLowerCase(), a[2]);
      for (const [attr, value] of attrs) {
        if (!NAME_ATTRS.has(attr)) continue;
        const at = sf.getLineAndCharacterOfPosition(node.getStart(sf) + tag.index);
        const w = { file: sf.fileName, line: at.line + 1 };
        read.push({ ...w, attr, how: 'markup', value: `"${value}"` });
        if (!HAS_LETTER.test(value.replace(/\$\{[^}]*\}/g, ''))) continue;
        const binding = MARKUP_BINDING.get(attr);
        if (binding && attrs.get(binding)) continue;
        hits.push({ ...w, attr, how: 'markup', literal: `${attr}="${value}"`.slice(0, 110), from: '' });
      }
    }
  }

  for (const { sf } of parsed) {
    const visit = node => {
      switch (node.kind) {
        case K.PropertyAssignment:
        case K.ShorthandPropertyAssignment: {
          const key = keyText(node.name);
          const attr = NAME_ATTRS.has(key) ? key : (NAME_PROPS.has(key) && key !== 'title' && key !== 'alt') ? NAME_PROPS.get(key) : null;
          if (!attr || node.parent.kind !== K.ObjectLiteralExpression) break;
          if (AMBIGUOUS.has(attr) && !isAttrObject(node.parent)) break;
          site(attr, node.kind === K.PropertyAssignment ? node.initializer : node.name, node, 'attribute object');
          break;
        }
        case K.CallExpression: {
          const callee = calleeName(node);
          const first = node.arguments[0] && unwrap(node.arguments[0]);
          if (SET_ATTRIBUTE.has(callee)) {
            /* setAttributeNS(ns, name, value) keeps its name second. */
            const at = callee === 'setAttributeNS' ? 1 : 0;
            const name = node.arguments[at] && unwrap(node.arguments[at]);
            if (name && ts.isStringLiteralLike(name) && NAME_ATTRS.has(name.text.toLowerCase()) && node.arguments[at + 1]) {
              site(name.text.toLowerCase(), node.arguments[at + 1], node, callee);
            }
          } else if (callee === 'setTooltip' && first) {
            /* Obsidian's setTooltip(el, text) and component.setTooltip(text):
               both write the text as the element's aria-label. */
            const c = unwrap(node.expression);
            const text = c.kind === K.Identifier ? node.arguments[1] : first;
            if (text) site('aria-label', text, node, 'setTooltip');
          } else if (callee === 'addRibbonIcon' && node.arguments[1]) {
            /* plugin.addRibbonIcon(icon, title, cb): the title is the ribbon
               button's aria-label. */
            site('aria-label', node.arguments[1], node, 'addRibbonIcon');
          }
          break;
        }
        case K.BinaryExpression: {
          const left = unwrap(node.left);
          if (node.operatorToken.kind !== K.EqualsToken && node.operatorToken.kind !== K.PlusEqualsToken) break;
          if (left.kind !== K.PropertyAccessExpression || !NAME_PROPS.has(left.name.text)) break;
          /* Read as the DOM property whatever it is set on: syntax cannot
             tell an element from a plain object, and nothing in src/ assigns
             `.title` or `.alt` on one — an object's field of that name is
             written in its literal (`{ title: … }`), which is not read here. */
          site(NAME_PROPS.get(left.name.text), node.right, node, `.${left.name.text} =`);
          break;
        }
        case K.StringLiteral:
        case K.NoSubstitutionTemplateLiteral:
        case K.TemplateExpression:
          markup(node);
          break;
        default:
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const order = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
  hits.sort(order); read.sort(order); loose.sort(order);
  return { hits, read, loose, mirrored };
}

/* ---- controls: it fires on what it must, and only on that ------------------ */

const scanOne = code => scanAll([{ rel: 'control.js', text: code }]);
const litsOf = code => scanOne(code).hits.map(h => h.attr);

/* Each planted literal, by the attribute it should be reported against. */
const VIOLATIONS = [
  /* The four ways a name is set, with a plain literal. */
  ['aria-label', "el('button', { 'aria-label': 'Remove' });"],
  ['aria-label', "el('button', { \"aria-label\": \"Remove\" });"],
  ['title', "el('span', { class: 'chip', title: 'Interest is estimated' });"],
  ['alt', "el('img', { src, alt: 'Receipt photo' });"],
  ['aria-description', "el('div', { 'aria-description': 'Sorted by date' });"],
  ['aria-roledescription', "el('div', { 'aria-roledescription': 'carousel' });"],
  ['aria-valuetext', "el('input', { 'aria-valuetext': 'half way' });"],
  ['aria-label', "box.createEl('button', { cls: 'x', attr: { 'aria-label': 'Close' } });"],
  ['title', "box.createEl('button', { cls: 'x', attr: { title: 'Close this' } });"],
  ['title', "box.createDiv({ cls: 'x', title: 'Close this' });"],
  ['aria-label', "b.setAttribute('aria-label', 'Remove');"],
  ['title', "b.setAttribute('title', 'Remove this row');"],
  ['alt', "img.setAttribute('alt', 'Receipt photo');"],
  ['aria-label', "b.setAttr('aria-label', 'Remove');"],
  ['aria-label', "b.setAttributeNS(null, 'aria-label', 'Balance over time');"],
  ['aria-label', "b.ariaLabel = 'Remove';"],
  ['aria-description', "b.ariaDescription = 'Sorted by date';"],
  ['title', "b.title = 'Remove this row';"],
  ['alt', "img.alt = 'Receipt photo';"],
  ['aria-label', "setTooltip(b, 'Remove');"],
  ['aria-label', "btn.setIcon('trash').setTooltip('Remove');"],
  ['aria-label', "this.addRibbonIcon('wallet', 'Open budget', () => this.activateView());"],
  /* Built, not written whole. */
  ['aria-label', "el('button', { 'aria-label': `Remove ${s.name}` });"],
  ['aria-label', "el('button', { 'aria-label': 'Remove ' + s.name });"],
  ['aria-label', "el('button', { 'aria-label': s.name + ' is active' });"],
  ['aria-label', "el('button', { 'aria-label': paid ? 'Settled' : i18n.t('debt.active') });"],
  ['aria-label', "el('button', { 'aria-label': s.name || 'this figure' });"],
  ['aria-label', "el('button', { 'aria-label': (`${key} for figure ${code}`).trim() });"],
  ['aria-label', "el('button', { 'aria-label': [name, 'paid'].join(', ') });"],
  ['aria-label', "el('button', { ...(aria ? { 'aria-label': 'Remove' } : {}) });"],
  ['title', "el('button', { ...(why ? { title: 'Remove this row' } : {}) });"],
  /* A translated sentence with an English fragment handed in. */
  ['aria-label', "el('button', { 'aria-label': i18n.t('tax.aria.amount', { what: f.code || 'this figure' }) });"],
  ['aria-label', "el('button', { 'aria-label': i18n.t('x.status', { status: paid ? 'Settled' : 'Active' }) });"],
  /* Held in a variable first — the shape the audit's grep could not see. */
  ['aria-label', "const aria = `Delete the account ${a.name}`; el('button', { 'aria-label': aria });"],
  ['title', "function f(s) { const title = `Last charged ${s.last}`; return el('button', { title }); }"],
  ['aria-label', "let say; if (x) say = 'Open the page'; else say = i18n.t('k'); b.setAttribute('aria-label', say);"],
  ['aria-label', "const { aria } = { aria: 'Remove' }; el('button', { 'aria-label': aria });"],
  /* Picked from a table of English. */
  ['aria-label', "const STEP = { todo: 'To do', done: 'Done' }; el('button', { 'aria-label': STEP[s.status] });"],
  ['aria-label', "const STEP = { todo: 'To do', done: 'Done' }; el('button', { 'aria-label': i18n.t('x', { status: STEP[s.status] }) });"],
  ['aria-label', "const L = { del: 'Remove' }; el('button', { 'aria-label': L.del });"],
  /* Passed to the helper that sets it. */
  ['aria-label', "function toggle(label) { return el('div', { role: 'group', 'aria-label': label }); } toggle('Chart range');"],
  ['aria-label', "const toggle = (label) => el('div', { 'aria-label': label }); toggle('Chart range');"],
  ['aria-label', "function pick({ label }) { return el('select', { 'aria-label': label }); } pick({ label: 'Category' });"],
  ['aria-label', "function pick(label = 'Category') { return el('select', { 'aria-label': label }); } pick();"],
  ['aria-label', "function act(label, aria) { return el('button', { 'aria-label': aria }, label); } act(i18n.t('k'), `Rename ${a.name}`);"],
  ['aria-label', "class M { field(label) { return el('input', { 'aria-label': label }); } go() { this.field('Store'); } }"],
  /* Returned by a function of the same file. */
  ['aria-label', "function word(s) { return s.active ? 'Active' : 'Paused'; } el('button', { 'aria-label': word(s) });"],
  ['aria-label', "const word = s => `${s.name} is active`; el('button', { 'aria-label': word(s) });"],
  /* Static markup with no binding. */
  ['aria-label', "const HTML = `<select id=\"y\" aria-label=\"Tax year\"></select>`; out(HTML);"],
  ['title', "const HTML = '<button id=\"c\" title=\"Discard this statement\">Cancel</button>'; out(HTML);"],
  ['alt', "const HTML = '<img src=\"x.png\" alt=\"Receipt\">'; out(HTML);"],
  ['aria-label', "const HTML = `<div role=\"group\" aria-label=\"Choose a plan\" data-i18n=\"plan.choose\"></div>`; out(HTML);"],
];
for (const [attr, code] of VIOLATIONS) {
  ok(litsOf(code).includes(attr), `planted English ${attr} is caught: ${code}`);
}

const LEGAL = [
  /* Keyed. */
  "el('button', { 'aria-label': i18n.t('svc.aria.remove', { name: s.name }) });",
  "el('button', { 'aria-label': t('wiz.motion.pause') });",
  "el('button', { 'aria-label': i18n.t(paused ? 'wiz.motion.play' : 'wiz.motion.pause') });",
  "el('span', { title: i18n.t('acct.caveat.estimated') });",
  "b.setAttribute('aria-label', i18n.t('tx.aria.exclude', { desc: r.desc, amount: money(r.amount) }));",
  "b.title = i18n.t('k'); img.alt = i18n.t('k2'); b.ariaLabel = i18n.t('k3');",
  "setTooltip(b, i18n.t('k')); btn.setTooltip(i18n.t('k')); this.addRibbonIcon('wallet', i18n.t('ribbon.open'), go);",
  "const aria = i18n.t('sav.aria.delete', { name: a.name }); el('button', { 'aria-label': aria });",
  "const STEP = { todo: i18n.t('tax.todo'), done: i18n.t('tax.done') }; el('button', { 'aria-label': STEP[s.status] });",
  "function toggle(label) { return el('div', { 'aria-label': label }); } toggle(i18n.t('chart.range'));",
  "function pick({ label }) { return el('select', { 'aria-label': label }); } pick({ label: i18n.t('k') });",
  /* A variable is what a translated name looks like. */
  "el('button', { 'aria-label': label });",
  "el('button', { 'aria-label': s.name });",
  "rows.forEach(r => el('input', { 'aria-label': r.label }));",
  "el('button', { title, 'aria-label': aria });",
  "b.setAttribute('aria-label', say); b.title = why;",
  "function toggle(label) { return el('div', { 'aria-label': label }); } toggle(opts.label);",
  "el('button', { 'aria-label': labelFor(s) });",
  /* Symbols and numbers are not English. */
  "el('button', { 'aria-label': '—' });",
  "el('span', { title: '→' });",
  "el('span', { 'aria-label': `${done} / ${total}` });",
  "el('span', { 'aria-label': `${name}: ${money(x)}` });",
  "el('span', { 'aria-valuetext': `${pct}%` });",
  "el('span', { 'aria-label': [name, money(x)].join(' · ') });",
  "el('span', { 'aria-label': '' });",
  /* A user's own text interpolated into a keyed sentence. */
  "el('button', { 'aria-label': i18n.t('note.aria.delete', { title: n.title }) });",
  /* Comments and strings that only talk about names — the reason this is a parser. */
  "// the aria-label: 'Remove' carries the same words for a screen reader\nout(1);",
  "/* title: 'Interest is estimated' used to live in a title attribute */ out(1);",
  "out('aria-label is set from the key, never a literal such as \"Remove\"');",
  "const q = `[aria-label=\"${i18n.t('rc.aria.item', { n })}\"]`; out(root.querySelector(q));",
  /* `title` and `alt` as ordinary fields. */
  "confirm({ title: 'Delete note', message: `Move \"${n.title}\" to trash?` });",
  "const doc = { title: 'Budget', footer: 'x' }; out(doc);",
  "askFields(app, 'New note', [{ key: 'title', label: 'Title', type: 'text' }]);",
  "const r = { p, alt: 'woolworths', category }; out(r);",
  "out({ key: p.key, name: p.name, title: p.title });",
  /* Other attributes. */
  "el('input', { placeholder: 'Note (optional)', 'data-label': 'Amount', class: 'num', type: 'text', role: 'img' });",
  "b.setAttribute('aria-labelledby', id); b.setAttribute('role', 'group'); b.setAttribute('data-title', 'x');",
  "b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-live', 'polite'); b.setAttribute('aria-current', 'page');",
  /* Static markup whose English is only the text before applyDom() runs. */
  "const HTML = `<button aria-label=\"Close menu\" data-i18n-aria=\"nav.close\" title=\"Close\" data-i18n-title=\"nav.closeTitle\"></button>`; out(HTML);",
  "const HTML = `<h1 class=\"banner-title\" data-i18n=\"nav.tax\">Tax</h1><div aria-labelledby=\"gateTitle\"></div>`; out(HTML);",
  "const HTML = `<svg aria-label=\"\" role=\"img\"></svg>`; out(HTML);",
];
for (const code of LEGAL) {
  eq(scanOne(code).hits.map(h => `${h.attr}: ${h.literal}`), [], `legal: ${code}`);
}

/* The follow is read from the code, not waved through: the same helper is
   clean with a keyed argument and caught with an English one, and the report
   names the literal where it was WRITTEN, not just the attribute that used it. */
{
  const helper = "function toggle(label) { return el('div', { 'aria-label': label }); }\n";
  eq(scanOne(helper + "toggle(i18n.t('chart.range'));").hits, [], 'a helper called with a key is clean');
  const { hits } = scanOne(helper + "toggle(i18n.t('chart.range'));\ntoggle('Chart range');");
  eq(hits.map(h => [h.line, h.literal, h.from]), [[1, "'Chart range'", 'control.js:3']],
    'the same helper called with English is caught, and the report points at the call that passed it');
}
/* A second file's call reaches a helper in the first — and a local function of
   the same name in the calling file does NOT answer for it. */
{
  const chart = { rel: 'chart.js', text: "function rangeToggle(label) { return el('div', { 'aria-label': label }); }\nmodule.exports = { rangeToggle };" };
  const caller = { rel: 'views/x.js', text: "const { rangeToggle } = require('../chart');\nrangeToggle('Chart range');" };
  eq(scanAll([chart, caller]).hits.map(h => h.from), ['views/x.js:2'], 'a call in another file is followed to the helper');
  const own = { rel: 'views/y.js', text: "function rangeToggle(a) { return a; }\nrangeToggle('not a name');" };
  eq(scanAll([chart, own]).hits, [], 'a same-named local function is not mistaken for the helper');
}
/* Every site is counted, so a clean result cannot be a scan that saw nothing. */
{
  const { read, loose } = scanOne("el('button', { 'aria-label': label, title: i18n.t('k') }); b.setAttribute('alt', x.y);");
  eq(read.map(r => r.attr), ['aria-label', 'title', 'alt'], 'each name site is read');
  ok(loose.length >= 1, 'and a value that cannot be followed is noted rather than silently passed');
}
/* A mirror is believed only while it is one. The same component passes with
   its detail printed, and is caught the moment the title is something the
   page does not also show — or the printing is taken away. */
{
  const chip = body => ({ rel: 'src/dom.js', text: `function caveatChip(shortText, detailText) {\n${body}\n}\ncaveatChip('est.', 'Interest is estimated from the rate you typed.');` });
  const printed = "const btn = el('button', { title: detailText }, shortText);\nreturn el('span', {}, btn, el('div', { class: 'detail' }, detailText));";
  const r = scanAll([chip(printed)]);
  eq(r.hits, [], 'a title that repeats the text its component prints is visible copy, not a name');
  eq(r.read.map(x => x.how), ['mirror'], 'and is counted as a mirror, not skipped unseen');
  eq(scanAll([chip("const btn = el('button', { title: detailText }, shortText);\nreturn el('span', {}, btn);")]).hits.map(h => h.attr), ['title'],
    'the same title with nothing printing it is a name again, and its English is caught');
  eq(scanAll([chip("const btn = el('button', { title: `More: ${detailText}` }, shortText);\nreturn el('span', {}, btn, el('div', {}, detailText));")]).hits.map(h => h.attr), ['title', 'title'],
    'and so is a title that says more than the page prints');
  const other = { rel: 'src/views/x.js', text: "function chip(shortText, detailText) {\nreturn el('span', {}, el('button', { title: detailText }, shortText), el('div', {}, detailText));\n}\nchip('est.', 'Interest is estimated.');" };
  eq(scanAll([other]).hits.map(h => h.attr), ['title'], 'only the component MIRRORS names is believed — a look-alike elsewhere is not');
}
/* A file the parser cannot read must fail the guard, not pass it empty. */
assert.throws(() => scanOne('const = ;'), /does not parse/);
checks++;

/* ---- the real thing: every .js under src/ except the language tables ------- */

/* A hit recorded instead of fixed, with its reason:
     { file: 'src/views/x.js', attr: 'title', literal: "'…'", why: '…' }
   Keep it sorted by file. */
const KNOWN = [
  { file: 'src/main.js', attr: 'aria-label', literal: "'Open budget'",
    why: 'the ribbon button is registered in onload(), on every Obsidian start, whether or not the budget is ever opened. '
      + 'Reading a key there would load a language table at plugin load, which is exactly what src/i18n.js\'s lazy tables '
      + 'exist to avoid (tests/i18n-lazy-tables.test.cjs: 1.77 MB of a 2.63 MB bundle). It shares its words with the '
      + '"Open budget" command registered on the next line, which the command palette prints — one decision, for both' },
];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== path.join(SRC, 'lang')) walk(p); }
    else if (e.name.endsWith('.js')) files.push({ rel: path.relative(ROOT, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
  }
}(SRC));
ok(files.length > 80, `src/ holds the plugin's modules (${files.length} .js files outside src/lang/)`);
ok(!files.some(f => f.rel.startsWith('src/lang/')), 'the language tables are the one place English names belong, and are not scanned');

const { hits, read, loose, mirrored } = scanAll(files);

if (LIST) {
  console.log(`# ${read.length} name sites`);
  for (const r of read) console.log(`${r.file}:${r.line}\t${r.attr}\t${r.how}\t${r.value}`);
  console.log(`\n# ${loose.length} values not followed to an end (legal — listed so a reader can check them by eye)`);
  for (const l of loose) console.log(`${l.file}:${l.line}\t${l.attr}\t${l.expr}`);
  console.log(`\n# ${hits.length} English literals`);
  for (const h of hits) console.log(`${h.file}:${h.line}\t${h.attr}\t${h.literal}${h.from ? `\t<- ${h.from}` : ''}`);
}

const usedKnown = new Set();
const found = [];
for (const h of hits) {
  const known = KNOWN.findIndex(k => k.file === h.file && k.attr === h.attr && h.literal.startsWith(k.literal));
  if (known >= 0) { usedKnown.add(known); continue; }
  found.push(`${h.file}:${h.line}  ${h.attr} (${h.how})  ${h.literal}${h.from ? `  — written at ${h.from}` : ''}`);
}

/* The walk really read the code. The floors are well under what is there
   today (see the PASS line) and well over what an empty scan would report. */
ok(read.length >= 150, `the scan read the plugin's accessible names (${read.length} sites)`);
ok(read.filter(r => r.how === 'markup').length >= 25, 'including the ones in the shell\'s static markup');
ok(read.filter(r => r.how === 'attribute object').length >= 100, 'and the ones in attribute objects');

eq(found, [], `${found.length} accessible name(s) in src/ are written in English instead of going through i18n.t():\n  ${found.join('\n  ')}\n`
  + '  Add a key to src/lang/en.js beside that feature\'s other keys, add it to the other eleven tables,\n'
  + '  and build the name with i18n.t(key, { name, amount, … }) — parameters, never concatenated fragments.\n'
  + '  In static markup, add data-i18n-aria / data-i18n-title to the same tag.\n');

for (const m of MIRRORS) {
  ok(mirrored.has(m), `MIRRORS says ${m.file} ${m.fn}() sets ${m.attr} from the text it prints (${m.prints}), but it no longer does — `
    + 'delete the entry, and key whatever now reaches that attribute');
}
for (let i = 0; i < KNOWN.length; i++) {
  ok(usedKnown.has(i), `KNOWN lists ${KNOWN[i].file} ${KNOWN[i].attr} ${KNOWN[i].literal} but nothing matches it any more — delete the entry`);
}
eq(KNOWN.map(k => `${k.file} ${k.attr} ${k.literal}`), KNOWN.map(k => `${k.file} ${k.attr} ${k.literal}`).sort(), 'KNOWN is kept sorted');

console.log(`PASS accessible-names-keyed — ${files.length} src files: ${read.length} accessible-name sites read, `
  + `${KNOWN.length ? `${KNOWN.length} written in English and recorded in KNOWN, none besides ` : 'none written in English '}`
  + `(${loose.length} values are variables the code does not spell out); `
  + `${VIOLATIONS.length} planted literals caught, ${LEGAL.length} legal shapes passed (${checks} checks)`);
