'use strict';
/* THE iOS 15.0 FLOOR, HELD IN THE REPO'S OWN SUITE — src/ AND THE BUILT BUNDLE.

   Obsidian mobile runs the phone's own WebView, so the engine this plugin has
   to run on is WebKit as shipped with iOS 15.0, not whatever `minAppVersion`
   implies. Four kinds of mistake break it there, and until November 2026 the
   repo guarded one and a half of them:

     - tests/bundle-smoke.test.cjs greps main.js for regex lookbehind;
     - tests/shell-contract.test.cjs greps two files for `.innerHTML =`;
     - the Node-API and innerHTML greps over the bundle lived in
       ~/.claude/skills/obsidian-plugin-dev-loop/scripts/dev-loop.sh — a script
       OUTSIDE this repository. A contributor, CI, or the release workflow
       running ./build.sh got none of them.

   And nothing anywhere caught the fourth kind: a runtime API newer than the
   floor. esbuild's `target: 'safari15'` lowers SYNTAX; it cannot know that
   `list.at(-1)` calls a method Safari only gained in 15.4. That one is not a
   parse error that kills the bundle — it is a TypeError the first time the
   line runs, on a phone, in a view the desktop author never saw fail.

   So this file scans every .js under src/ AND the built main.js for all four:

     lookbehind   (?<= and (?<! in a regex literal, or in a string that reaches
                  `new RegExp`. A parse-time SyntaxError before iOS 16.4 that
                  kills the WHOLE bundle.
     floor-api    a call to .at() .findLast() .findLastIndex() (15.4),
                  .toSorted() .toReversed() .toSpliced() .with() (16.0),
                  structuredClone() Object.hasOwn() crypto.randomUUID() (15.4),
                  Array.fromAsync() (16.4), Object.groupBy() / Map.groupBy()
                  (17.4), .showPicker() (16.0).
     html-sink    innerHTML, outerHTML, insertAdjacentHTML — the house rule is
                  createEl / setText / DOMParser, and Obsidian's review bot
                  flags them.
     node-api     require() or import of a Node builtin or of electron — by
                  any spelling: `window.require('electron')` is how a plugin
                  really reaches it — and `require` itself handed on under
                  another name, since nothing can then follow what it loads.
                  There is no Node on a phone.

   WHY A PARSER AND NOT A GREP. bundle-smoke's own comment gives the reason
   the old greps only ever looked at the bundle: this source explains itself,
   and a grep over src/ flags every comment that says "hand-rolled rather than
   a lookbehind" or "no innerHTML" — a red failure on exactly the code that got
   it right. A grep cannot tell a comment or a string from code. So this reads
   each file with the TypeScript parser (already a dev dependency, for
   tests/pure-types.test.cjs) and looks only at real syntax nodes: comments are
   not nodes, and a string that merely names an API is a string. That is what
   lets it scan src/ at all, and report `src/views/plan.js:412` instead of a
   column in a minified line.

   BOTH are scanned because they fail differently. src/ is where a person can
   act on the line number. main.js is what the engine actually parses: it is
   the only place a hazard introduced by the bundler itself would show.

   FEATURE DETECTION STAYS LEGAL. src/categories.js opens its picker with

       if (typeof sel.showPicker === 'function') { try { sel.showPicker(); } … }

   which is the right way to use something the floor lacks, and a guard that
   flagged it would teach people to delete the check. A floor-api call is
   allowed when the code around it has tested for that same API ON THAT SAME
   RECEIVER: inside the `if`, `?:` or `&&` whose condition asks for it (or the
   else of one that asks whether it is missing), after an `if (missing)
   return`, or as an optional call `x.at?.()`. Merely mentioning the API —
   `typeof x.at`, `x.at || fallback` — is asking, not calling, and is never
   flagged. A test of `a.at` says nothing about `b.at`, and is not accepted
   for it. A bare try/catch is NOT accepted as detection either: it makes the
   line safe and the feature silently absent, which is the bug this guard
   exists to surface.
   html-sink and node-api have no such exemption; there is nothing to detect.

   The controls below plant each violation and each legal shape, as source and
   again after esbuild has minified it, because the bundle is where the shapes
   change (`typeof x<"u"`, `a&&a.b()`), and a guard that only recognises the
   way the source spells a check would be vacuous on main.js.

   KNOWN is the ratchet for a hit in a file this guard's author does not own:
   listed with its reason, it stops failing the suite; an entry that no longer
   matches anything fails instead, so the list can only shrink on purpose.

   Needs the dev dependencies (typescript, esbuild) and a built main.js.
     node tests/ios-floor.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

let ts;
let esbuild;
try {
  ts = require('typescript');
  esbuild = require('esbuild');
} catch (e) {
  console.error('FAIL tests/ios-floor.test.cjs — the dev dependencies are not installed. Run `npm ci`.');
  process.exit(1);
}

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const K = ts.SyntaxKind;

/* ---- what the floor lacks -------------------------------------------------
   name -> the first Safari that has it. All are after 15.0. */

/* Instance methods: flagged on ANY receiver, because the receiver's type is
   not knowable from syntax. That is a real limit — a class of this plugin's
   own with a method called `at` or `with` would be flagged — and the answer
   is to name the method something else rather than weaken the check: nothing
   in src/ needs these names today. */
const METHODS = new Map([
  ['at', '15.4'], ['findLast', '15.4'], ['findLastIndex', '15.4'],
  ['toSorted', '16.0'], ['toReversed', '16.0'], ['toSpliced', '16.0'], ['with', '16.0'],
  ['randomUUID', '15.4'],
  ['showPicker', '16.0'],
]);
/* Static methods: flagged only on the constructor that owns them, so this
   plugin's own `groupBy(rows)` helper or `acct.groupBy` translation key is not
   mistaken for Object.groupBy. */
const STATICS = new Map([
  ['hasOwn', { on: ['Object'], since: '15.4' }],
  ['groupBy', { on: ['Object', 'Map'], since: '17.4' }],
  ['fromAsync', { on: ['Array'], since: '16.4' }],
]);
const GLOBALS = new Map([['structuredClone', '15.4']]);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML']);

/* Node's own list rather than a hand-written five: `fs`, `path`, `os` and
   `child_process` are the ones that have been reached for, but `crypto`,
   `zlib` and `util` are no more available on a phone. */
const NODE_MODULES = new Set([...builtinModules.map(m => m.replace(/^node:/, '')), 'electron', '@electron/remote']);
const isNodeModule = spec => {
  if (/^node:/.test(spec)) return true;
  if (spec.startsWith('.') || spec.startsWith('/')) return false;
  const parts = spec.split('/');
  const base = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return NODE_MODULES.has(base);
};

/* ---- lookbehind, read the way a regex engine reads it ----------------------
   `(?<=` and `(?<!` only when the `(` really opens a group: an escaped paren
   (`\(?<=` is an optional literal paren followed by `<=`) and a `(` inside a
   character class are not groups. Named groups `(?<name>` are fine and have
   been since Safari 11.1. Hand-walked, because the obvious way to write this
   test is with a lookbehind. */
function hasLookbehind(source) {
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(' && source[i + 1] === '?' && source[i + 2] === '<'
      && (source[i + 3] === '=' || source[i + 3] === '!')) return true;
  }
  return false;
}

/* ---- the scanner ----------------------------------------------------------- */

const unwrap = n => { while (n && (n.kind === K.ParenthesizedExpression || n.kind === K.NonNullExpression)) n = n.expression; return n; };
/* The nearest ancestor that is not a pair of brackets, and the child of it we
   came up through. */
const climb = n => {
  let child = n, p = n.parent;
  while (p && (p.kind === K.ParenthesizedExpression || p.kind === K.NonNullExpression)) { child = p; p = p.parent; }
  return { parent: p, child };
};

/* `x.name` or `x['name']` — the member being read, and what it is read from.
   The bracket form is here because it is the same call: `rows['at'](-1)` and
   `window['require']('fs')` reach exactly what the dotted spelling does, and a
   guard that only read dots would be passed by anyone who had been told it
   was there. */
function member(node) {
  if (node.kind === K.PropertyAccessExpression) return { name: node.name.text, object: unwrap(node.expression) };
  if (node.kind === K.ElementAccessExpression) {
    const arg = node.argumentExpression && unwrap(node.argumentExpression);
    if (arg && ts.isStringLiteralLike(arg)) return { name: arg.text, object: unwrap(node.expression) };
  }
  return null;
}

/* What something is read FROM, as text, so two reads can be told to be of the
   same thing. `rows?.at` and `rows.at` are the same receiver. */
const receiverText = n => n.getText().replace(/\s+/g, '').replace(/\?\./g, '.');

/* Which floor API, if any, this node REFERS to: `x.at`, `x['at']`,
   `Object.hasOwn`, `structuredClone`, `window.structuredClone`. Null for
   everything else, including a property that merely shares a static's name on
   another object.

   Returns { api, key }. `api` is the name; `key` is the name AND the receiver
   it was read from (`at@rows`, `hasOwn@Object`, `structuredClone@` for a
   global). The key is what a feature test has to match: `typeof a.at ===
   'function'` says something about `a` and nothing about `b`, and a field
   that happens to be called `at` on some other object — this plugin's health
   pillars have one — is not a test for Array.prototype.at at all. */
function refOf(node) {
  node = unwrap(node);
  if (!node) return null;
  const m = member(node);
  if (m) {
    const { name, object } = m;
    if (GLOBALS.has(name) && object.kind === K.Identifier && GLOBAL_OBJECTS.has(object.text)) return { api: name, key: `${name}@` };
    if (METHODS.has(name)) return { api: name, key: `${name}@${receiverText(object)}` };
    if (STATICS.has(name) && object.kind === K.Identifier && STATICS.get(name).on.includes(object.text)) {
      return { api: name, key: `${name}@${object.text}` };
    }
    return null;
  }
  if (node.kind === K.Identifier && GLOBALS.has(node.text) && isFreeReference(node)) return { api: node.text, key: `${node.text}@` };
  return null;
}
/* An identifier that names a variable in scope — not `x.name`, not the name
   being declared, not an object key. */
function isFreeReference(node) {
  const p = node.parent;
  if (!p) return false;
  if (p.kind === K.PropertyAccessExpression && p.name === node) return false;
  if ((p.kind === K.PropertyAssignment || p.kind === K.MethodDeclaration || p.kind === K.PropertyDeclaration
    || p.kind === K.VariableDeclaration || p.kind === K.Parameter || p.kind === K.FunctionDeclaration
    || p.kind === K.FunctionExpression || p.kind === K.BindingElement) && p.name === node) return false;
  if (p.kind === K.BindingElement && p.propertyName === node) return false;
  return true;
}
const keyOf = node => { const r = refOf(node); return r ? r.key : null; };
const sinceOf = api => METHODS.get(api) || (STATICS.get(api) || {}).since || GLOBALS.get(api);

/* Does `test` being TRUE ('pos') or being FALSE ('neg') establish that the API
   named by `key` exists ON THAT RECEIVER? Null when it establishes neither.

     typeof x.at === 'function'   pos      typeof x.at !== 'function'   neg
     x.at                         pos      !x.at                        neg
     x.at != null                 pos      x.at === undefined           neg
     'at' in x                    pos
     a && <pos>                   pos      a || <neg>                   neg
     a, b, <test>                 whatever <test> is

   The `&&` / `||` line is the two that are sound: a conjunction is true only
   if every part is, a disjunction false only if every part is. The other two
   combinations prove nothing and return null.

   `typeof x<"u"` and `typeof x>"u"` are how esbuild minifies a comparison with
   'undefined', so they are read as the same two questions. */
function polarity(test, key) {
  test = unwrap(test);
  if (!test) return null;
  if (keyOf(test) === key) return 'pos';
  if (test.kind === K.PrefixUnaryExpression && test.operator === K.ExclamationToken) {
    const inner = polarity(test.operand, key);
    return inner === 'pos' ? 'neg' : inner === 'neg' ? 'pos' : null;
  }
  if (test.kind !== K.BinaryExpression) return null;
  const op = test.operatorToken.kind;
  const left = unwrap(test.left), right = unwrap(test.right);
  if (op === K.AmpersandAmpersandToken) {
    return polarity(left, key) === 'pos' || polarity(right, key) === 'pos' ? 'pos' : null;
  }
  if (op === K.BarBarToken) {
    return polarity(left, key) === 'neg' || polarity(right, key) === 'neg' ? 'neg' : null;
  }
  if (op === K.InKeyword) {
    if (!ts.isStringLiteralLike(left)) return null;
    const name = left.text;
    const asked = GLOBALS.has(name) && right.kind === K.Identifier && GLOBAL_OBJECTS.has(right.text)
      ? `${name}@` : `${name}@${receiverText(right)}`;
    return asked === key ? 'pos' : null;
  }
  /* `a(), b(), typeof x.at == "function"` — the value of a comma expression is
     its last operand. Not a shape anyone writes; it is how esbuild folds the
     statements before an `if` into its condition, and it is exactly what the
     real showPicker test in src/categories.js looks like in main.js. */
  if (op === K.CommaToken) return polarity(right, key);
  const equal = op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken;
  const unequal = op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken;
  const typeofApi = n => n.kind === K.TypeOfExpression && keyOf(n.expression) === key;
  const str = n => (ts.isStringLiteralLike(n) ? n.text : null);
  for (const [a, b, flipped] of [[left, right, false], [right, left, true]]) {
    if (typeofApi(a)) {
      const s = str(b);
      if (s === 'function') return equal ? 'pos' : unequal ? 'neg' : null;
      if (s === 'undefined') return equal ? 'neg' : unequal ? 'pos' : null;
      if (s === 'u') {
        const lt = op === K.LessThanToken, gt = op === K.GreaterThanToken;
        if (lt || gt) return (lt !== flipped) ? 'pos' : 'neg';
      }
      return null;
    }
    if (keyOf(a) === key) {
      const nullish = b.kind === K.NullKeyword || (b.kind === K.Identifier && b.text === 'undefined')
        || (b.kind === K.VoidExpression);
      if (nullish) return equal ? 'neg' : unequal ? 'pos' : null;
    }
  }
  return null;
}

/* A statement that always leaves the block it is in. */
function exits(stmt) {
  if (!stmt) return false;
  if (stmt.kind === K.ReturnStatement || stmt.kind === K.ThrowStatement
    || stmt.kind === K.ContinueStatement || stmt.kind === K.BreakStatement) return true;
  if (stmt.kind === K.Block) return stmt.statements.length > 0 && exits(stmt.statements[stmt.statements.length - 1]);
  return false;
}

/* Is the use at `node` inside code that only runs once the API named by `key`
   is known to exist? Walks outward; crossing a function boundary is fine, a
   closure written inside a guarded branch is still guarded. */
function guarded(node, key) {
  for (let child = node, p = node.parent; p; child = p, p = p.parent) {
    if (p.kind === K.IfStatement) {
      const pol = polarity(p.expression, key);
      if (child === p.thenStatement && pol === 'pos') return true;
      if (child === p.elseStatement && pol === 'neg') return true;
    } else if (p.kind === K.ConditionalExpression) {
      const pol = polarity(p.condition, key);
      if (child === p.whenTrue && pol === 'pos') return true;
      if (child === p.whenFalse && pol === 'neg') return true;
    } else if (p.kind === K.BinaryExpression && child === p.right) {
      const op = p.operatorToken.kind;
      if (op === K.AmpersandAmpersandToken && polarity(p.left, key) === 'pos') return true;
      if ((op === K.BarBarToken || op === K.QuestionQuestionToken) && polarity(p.left, key) === 'neg') return true;
    }
    const list = p.statements || (p.kind === K.CaseClause || p.kind === K.DefaultClause ? p.statements : null);
    if (list) {
      for (const s of list) {
        if (s === child) break;
        if (s.kind === K.IfStatement && !s.elseStatement && exits(s.thenStatement)
          && polarity(s.expression, key) === 'neg') return true;
      }
    }
  }
  return false;
}

/* Is this expression handed on as a value — stored, passed, returned — so
   that whoever receives it can call it? An operand of && || ?? is not handed
   on (`Object.hasOwn || fallback` is the fallback idiom), and neither is
   anything typeof, ! or a comparison looks at. */
function handedOn(ref) {
  const { parent, child } = climb(ref);
  if (!parent) return false;
  if ((parent.kind === K.CallExpression || parent.kind === K.NewExpression) && parent.arguments
    && parent.arguments.includes(child)) return true;
  if (parent.kind === K.VariableDeclaration && parent.initializer === child) return true;
  if (parent.kind === K.PropertyAssignment && parent.initializer === child) return true;
  if (parent.kind === K.ReturnStatement || parent.kind === K.ArrayLiteralExpression
    || parent.kind === K.SpreadElement || parent.kind === K.ArrowFunction) return true;
  if (parent.kind === K.BinaryExpression && parent.operatorToken.kind === K.EqualsToken && parent.right === child) return true;
  return false;
}

/* Is this reference to a floor API a USE of it — something that needs the API
   to exist — rather than a question about whether it does? */
function isUse(ref, api) {
  const { parent, child } = climb(ref);
  if (!parent) return false;
  /* Called. `x.at?.(0)` is the one call that cannot throw on a missing
     method, so it is detection and use in one, and legal. */
  if ((parent.kind === K.CallExpression || parent.kind === K.NewExpression) && parent.expression === child) {
    return !parent.questionDotToken;
  }
  if (parent.kind === K.TaggedTemplateExpression && parent.tag === child) return true;
  /* `[].at.call(xs, -1)` */
  if (parent.kind === K.PropertyAccessExpression && parent.expression === child
    && ['call', 'apply', 'bind'].includes(parent.name.text)) return true;
  /* A METHOD name is only a use when it is called. Read as a value it is
     indistinguishable from a field: this plugin's health pillars carry a
     number called `at` (`{ at: p.at, tone: pillarTone(p.at) }`, seven reads in
     src/), and flagging those would be the false alarm that gets a guard
     switched off. The cost is that `const f = xs.at; f.call(xs, -1)` gets
     past this — in a pure module tests/pure-types.test.cjs still catches it,
     because the ES2021 library it checks against has no such method. */
  if (METHODS.has(api)) return false;
  /* A global or a constructor's static has no such ambiguity, so handing one
     on as a value is a use: whoever receives it will call it. */
  return handedOn(ref);
}

/* `require`, by any of the names it goes by: the bare identifier, or
   `window.require` / `globalThis.require` / `module.require` — the member
   form is the idiom an Obsidian plugin actually uses to reach Electron, and
   the grep this guard replaces caught it only because "require(" is a
   substring of it. */
function isRequire(node) {
  node = unwrap(node);
  if (!node) return false;
  if (node.kind === K.Identifier) return node.text === 'require' && isFreeReference(node);
  const m = member(node);
  return !!m && m.name === 'require';
}

/* Every hit in one file's text: [{ rule, what, line, col, excerpt }].
   Also returns counts of what was looked at, so a caller can tell a clean file
   from one the walk never entered. */
function scan(text, label) {
  const sf = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) {
    const d = sf.parseDiagnostics[0];
    const at = sf.getLineAndCharacterOfPosition(d.start || 0);
    throw new Error(`${label}:${at.line + 1} does not parse (${ts.flattenDiagnosticMessageText(d.messageText, ' ')}) — `
      + 'a file this guard cannot read is a file it cannot vouch for');
  }
  const hits = [];
  const seen = { nodes: 0, regexes: 0, calls: 0, detected: [] };
  const hit = (rule, what, node) => {
    const start = node.getStart(sf);
    const at = sf.getLineAndCharacterOfPosition(start);
    hits.push({ rule, what, line: at.line + 1, col: at.character + 1,
      excerpt: text.slice(Math.max(0, start - 30), start + 50).replace(/\s+/g, ' ').trim() });
  };

  /* Strings that reach `new RegExp(...)`: the literals inside its arguments,
     and the literals inside the initialiser of any variable those arguments
     name — src/i18n.js builds one pattern out of six string constants. */
  const regexpArgs = [];
  const declared = new Map();                        // name -> [initialiser]
  const literalsUnder = (root, out, names) => {
    const walk = n => {
      if (ts.isStringLiteralLike(n) || n.kind === K.TemplateHead || n.kind === K.TemplateMiddle || n.kind === K.TemplateTail) out.push(n);
      else if (n.kind === K.Identifier) names.add(n.text);
      ts.forEachChild(n, walk);
    };
    walk(root);
  };

  const visit = node => {
    seen.nodes++;
    switch (node.kind) {
      case K.RegularExpressionLiteral: {
        seen.regexes++;
        const body = node.text.slice(1, node.text.lastIndexOf('/'));
        if (hasLookbehind(body)) hit('lookbehind', 'regex lookbehind', node);
        break;
      }
      case K.VariableDeclaration:
        if (node.initializer && node.name.kind === K.Identifier) {
          if (!declared.has(node.name.text)) declared.set(node.name.text, []);
          declared.get(node.name.text).push(node.initializer);
        }
        /* `const { hasOwn } = Object`, `const { structuredClone, require } =
           window` — the same reads as `Object.hasOwn` and `window.require`,
           spelled as a pattern. Only off the objects that OWN the name: `const
           { at } = pillar` is a field. A default (`{ hasOwn = fallback }`) is
           the destructuring spelling of `Object.hasOwn || fallback`, and legal. */
        if (node.initializer && node.name.kind === K.ObjectBindingPattern) {
          const from = unwrap(node.initializer);
          if (from.kind === K.Identifier) {
            for (const el of node.name.elements) {
              const prop = el.propertyName || el.name;
              if (!prop || prop.kind !== K.Identifier || el.dotDotDotToken) continue;
              const name = prop.text;
              if (name === 'require' && GLOBAL_OBJECTS.has(from.text)) {
                hit('node-api', '`require` taken as a value — what it then loads cannot be checked', el);
              } else if (!el.initializer) {
                const key = STATICS.has(name) && STATICS.get(name).on.includes(from.text) ? `${name}@${from.text}`
                  : GLOBALS.has(name) && GLOBAL_OBJECTS.has(from.text) ? `${name}@` : null;
                if (key && !guarded(node, key)) hit('floor-api', `${name}() — Safari ${sinceOf(name)}`, el);
                else if (key) seen.detected.push(name);
              }
            }
          }
        }
        break;
      case K.Identifier:
        if (HTML_SINKS.has(node.text)) hit('html-sink', node.text, node);
        break;
      case K.ElementAccessExpression: {
        const arg = node.argumentExpression && unwrap(node.argumentExpression);
        if (arg && ts.isStringLiteralLike(arg) && HTML_SINKS.has(arg.text)) hit('html-sink', arg.text, arg);
        break;
      }
      case K.ImportDeclaration:
      case K.ExportDeclaration:
        if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && isNodeModule(node.moduleSpecifier.text)) {
          hit('node-api', `import '${node.moduleSpecifier.text}'`, node);
        }
        break;
      case K.CallExpression:
      case K.NewExpression: {
        seen.calls++;
        const callee = unwrap(node.expression);
        const first = node.arguments && node.arguments[0] && unwrap(node.arguments[0]);
        const requireLike = isRequire(callee) || callee.kind === K.ImportKeyword;
        if (requireLike && first && ts.isStringLiteralLike(first) && isNodeModule(first.text)) {
          hit('node-api', `require('${first.text}')`, node);
        }
        const isRegExp = (callee.kind === K.Identifier && callee.text === 'RegExp')
          || (callee.kind === K.PropertyAccessExpression && callee.name.text === 'RegExp');
        if (isRegExp && first) regexpArgs.push(first);
        break;
      }
      default:
    }
    /* refOf and isRequire also answer for the brackets around a reference;
       count each reference once, at the node itself. */
    const bare = node.kind !== K.ParenthesizedExpression && node.kind !== K.NonNullExpression;
    const ref = bare ? refOf(node) : null;
    if (ref && isUse(node, ref.api)) {
      if (guarded(node, ref.key)) seen.detected.push(ref.api);
      else hit('floor-api', `${ref.api}() — Safari ${sinceOf(ref.api)}`, node);
    }
    /* `const load = require; load('fs')` — once `require` is a value under
       another name, no scan of this kind can follow what it loads. Nothing in
       src/ needs to do that, so the alias itself is the hit. */
    if (bare && isRequire(node) && handedOn(node)) {
      hit('node-api', '`require` taken as a value — what it then loads cannot be checked', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const literals = [];
  const names = new Set();
  for (const arg of regexpArgs) literalsUnder(arg, literals, names);
  const resolved = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const name of [...names]) {
      if (resolved.has(name)) continue;
      resolved.add(name);
      for (const init of declared.get(name) || []) { literalsUnder(init, literals, names); grew = true; }
    }
  }
  for (const lit of new Set(literals)) {
    if (hasLookbehind(lit.text)) hit('lookbehind', 'regex lookbehind in a string passed to RegExp', lit);
  }

  hits.sort((a, b) => a.line - b.line || a.col - b.col);
  return { hits, seen };
}

/* ---- controls: the scanner fires on what it must, and only on that -------- */

const rulesOf = code => scan(code, 'control.js').hits.map(h => h.rule);
/* The same code as esbuild leaves it in the bundle. An expression statement
   with no effect is dropped by the minifier, so every control does something
   with its result. */
const minified = code => esbuild.transformSync(code, { minify: true, target: 'safari15', loader: 'js' }).code;

const VIOLATIONS = [
  ['lookbehind', 'out(s.split(/(?<!\\\\)\\|/));'],
  ['lookbehind', 'out(/(?<=R )\\d+/.test(s));'],
  ['lookbehind', 'out(new RegExp("(?<=R )\\\\d+").test(s));'],
  ['lookbehind', 'const SIGN = "(?<![0-9])-"; out(new RegExp(`^${SIGN}\\\\d+$`).test(s));'],
  ['floor-api', 'out(rows.at(-1));'],
  ['floor-api', 'out(rows.findLast(r => r.ok));'],
  ['floor-api', 'out(rows.findLastIndex(r => r.ok));'],
  ['floor-api', 'out(rows.toSorted((a, b) => a - b));'],
  ['floor-api', 'out(rows.toReversed());'],
  ['floor-api', 'out(rows.toSpliced(0, 1));'],
  ['floor-api', 'out(rows.with(0, x));'],
  ['floor-api', 'out(structuredClone(state));'],
  ['floor-api', 'out(window.structuredClone(state));'],
  ['floor-api', 'out(Object.hasOwn(o, k));'],
  ['floor-api', 'out(crypto.randomUUID());'],
  ['floor-api', 'out(Array.fromAsync(gen));'],
  ['floor-api', 'out(Object.groupBy(rows, r => r.k));'],
  ['floor-api', 'out(Map.groupBy(rows, r => r.k));'],
  ['floor-api', 'input.showPicker();'],
  ['floor-api', 'out(rows?.at(0));'],                                   // the ?. guards `rows`, not `at`
  ['floor-api', 'const clone = structuredClone; out(clone(state));'],   // handed on as a value
  ['floor-api', 'out(rows.map(structuredClone));'],
  ['floor-api', 'const hasOwn = Object.hasOwn; out(hasOwn(o, k));'],
  ['floor-api', 'out([].at.call(rows, -1));'],
  ['floor-api', 'try { input.showPicker(); } catch (e) { out(e); }'],   // try alone is not detection
  ['floor-api', 'if (typeof rows.findLast === "function") { out(rows.at(-1)); }'],   // tested the wrong API
  ['floor-api', 'if (!rows.at) { out(rows.at(-1)); }'],                 // called in the branch where it is missing
  ['floor-api', 'if (rows.length || !rows.at) { out(1); } else { out(2); } out(rows.at(0));'],
  /* The bracket and destructured spellings of the same calls. */
  ['floor-api', 'out(rows["at"](-1));'],
  ['floor-api', 'out(Object["hasOwn"](o, k));'],
  ['floor-api', 'const { hasOwn } = Object; out(hasOwn(o, k));'],
  ['floor-api', 'const { structuredClone: clone } = window; out(clone(state));'],
  /* A test only vouches for the receiver it asked about. */
  ['floor-api', 'if (typeof a.at === "function") { out(b.at(-1)); }'],
  ['floor-api', 'if (pillar.at) { out(rows.at(-1)); }'],                // a FIELD called `at` is not a test for Array's
  ['floor-api', 'if (Object.groupBy) { out(Map.groupBy(rows, f)); }'],
  ['floor-api', 'if ("at" in other) { out(rows.at(-1)); }'],
  ['html-sink', 'el.innerHTML = html;'],
  ['html-sink', 'out(el.outerHTML);'],
  ['html-sink', 'el.insertAdjacentHTML("beforeend", html);'],
  ['html-sink', 'el["innerHTML"] = html;'],
  ['html-sink', 'Object.assign(el, { innerHTML: html });'],
  ['html-sink', 'const { innerHTML } = el; out(innerHTML);'],
  ['node-api', 'const fs = require("fs"); out(fs);'],
  ['node-api', 'out(require("path").join(a, b));'],
  ['node-api', 'out(require("os").homedir());'],
  ['node-api', 'out(require("electron").shell);'],
  ['node-api', 'out(require("child_process").execSync(c));'],
  ['node-api', 'out(require("node:fs"));'],
  ['node-api', 'out(require("fs/promises"));'],
  ['node-api', 'out(require("crypto").randomBytes(8));'],
  /* How an Obsidian plugin actually reaches Electron and Node. */
  ['node-api', 'out(window.require("electron").remote);'],
  ['node-api', 'out(globalThis.require("fs"));'],
  ['node-api', 'out(window["require"]("child_process"));'],
  ['node-api', 'out(module.require("os"));'],
  ['node-api', 'const load = require; out(load("fs"));'],
  ['node-api', 'const load = window.require; out(load("fs"));'],
  ['node-api', 'const { require: load } = window; out(load("fs"));'],
  ['node-api', 'out([require].map(r => r("fs")));'],
];
for (const [rule, code] of VIOLATIONS) {
  ok(rulesOf(code).includes(rule), `planted ${rule} is caught in source: ${code}`);
  const min = minified(code);
  ok(rulesOf(min).includes(rule), `planted ${rule} is caught as the bundle spells it: ${min.trim().slice(0, 90)}`);
}
for (const code of ['import fs from "fs"; out(fs);', 'out(await import("node:path"));']) {
  ok(rulesOf(code).includes('node-api'), `planted node-api is caught: ${code}`);
}

const LEGAL = [
  /* Comments and strings that only NAME a hazard — the reason this is a parser. */
  '/* hand-rolled rather than /(?<!\\\\)\\|/ — a lookbehind literal kills the bundle */ out(1);',
  '// no innerHTML here, and never require("fs")\nout(1);',
  'out("structuredClone, Object.hasOwn and rows.at(-1) are Safari 15.4");',
  'out(`set innerHTML? never — ${x}`);',
  'out("(?<=R )");',                                          // a string nothing hands to RegExp
  'out({ "acct.groupBy": "Group by kind" });',
  /* Things that look like a hazard and are not. */
  'out(/(?<year>\\d{4})-(?<month>\\d\\d)/.exec(s));',          // named groups: Safari 11.1
  'out(/\\(?<=/.test(s));',                                   // an optional literal paren, then "<="
  'out(/[(?<=]/.test(s));',                                   // inside a character class
  'out(new RegExp("(?<y>\\\\d+)").test(s));',
  'function groupBy(rows) { return rows; } out(groupBy(rows));',
  'out(ledger.groupBy(rows));',                               // not Object's or Map's
  'out({ at: 1, with: 2, structuredClone: 3 });',              // keys, not references
  'out(require("obsidian").Notice, require("./dates"), require("../table-schema"));',
  'out(text.charAt(0), list.concat(x), el.textContent, el.replaceChildren());',
  /* Feature detection — asking is never a use, and a use behind the question is legal. */
  'out(typeof rows.at, typeof structuredClone === "function", "at" in rows, !rows.at);',
  'const last = rows.at ? rows.at(-1) : rows[rows.length - 1]; out(last);',
  'if (typeof sel.showPicker === "function") { try { sel.showPicker(); } catch (e) { out(e); } }',
  'if (typeof structuredClone === "function") { out(structuredClone(s)); } else { out(JSON.parse(JSON.stringify(s))); }',
  'if (typeof structuredClone !== "undefined") { out(structuredClone(s)); }',
  'if (typeof rows.at !== "function") { out(rows[0]); } else { out(rows.at(0)); }',
  'function last(rows) { if (!rows.at) return rows[rows.length - 1]; return rows.at(-1); } out(last);',
  'function id() { if (typeof crypto.randomUUID !== "function") { return fallback(); } return crypto.randomUUID(); } out(id);',
  'out(rows.at && rows.at(-1));',
  'out(ready && rows.at && rows.at(-1));',
  'out(!rows.at || rows.at(-1));',
  'out(rows.at?.(-1));',
  'out(Object.hasOwn ? Object.hasOwn(o, k) : Object.prototype.hasOwnProperty.call(o, k));',
  'const pick = rows.findLast || fallback; out(pick);',
  'out({ at: p.at, tone: pillarTone(p.at), width: `${clampPct(r.at)}%` });',   // a FIELD called `at`, as src/health-math.js has
  'const hasOwn = Object.hasOwn || ((o, k) => Object.prototype.hasOwnProperty.call(o, k)); out(hasOwn);',
  'if ("showPicker" in input) { input.showPicker(); }',
  'if (wrap.replaceChildren(sel), sel.focus(), typeof sel.showPicker === "function") { sel.showPicker(); }',
  'function swap() { wrap.replaceChildren(sel); sel.focus(); if (typeof sel.showPicker === "function") { try { sel.showPicker(); } catch (e) { out(e); } } } out(swap);',
  'if (typeof structuredClone === "function") { out(rows.map(r => structuredClone(r))); }',   // a closure inside the guard
  'if (rows.at != null) { out(rows.at(0)); } if (rows.findLast !== undefined) { out(rows.findLast(f)); }',
  'if (this.rows.at) { out(this.rows.at(-1)); }',
  'if (rows?.at) { out(rows.at(-1)); }',                      // the same receiver, optional or not
  'out(typeof rows["at"] === "function" ? rows["at"](-1) : rows[rows.length - 1]);',
  'const { hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k) } = Object; out(hasOwn);',
  'if (Object.hasOwn) { const { hasOwn } = Object; out(hasOwn(o, k)); }',
  'const { at, with: w } = pillar; out(at, w);',              // fields off an ordinary object
  'out(typeof require === "function", typeof window.require);',
  'out(window.require("obsidian"), { require: 1 });',
];
for (const code of LEGAL) {
  eq(rulesOf(code), [], `legal in source: ${code}`);
  const min = minified(code);
  eq(rulesOf(min), [], `legal as the bundle spells it: ${min.trim().slice(0, 90)}`);
}

/* The detection is read from the code, not waved through: the same call with
   its test removed is flagged again. */
eq(rulesOf('sel.showPicker();'), ['floor-api'], 'the showPicker call is only legal BEHIND its typeof test');
{
  const { seen } = scan('if (typeof sel.showPicker === "function") { sel.showPicker(); }', 'control.js');
  eq(seen.detected, ['showPicker'], 'and a guarded call is counted as detected, not skipped unseen');
}

/* A file the parser cannot read must fail the guard, not pass it empty. */
assert.throws(() => scan('const = ;', 'broken.js'), /does not parse/);
checks++;

/* ---- the real thing: src/ and the built bundle ----------------------------- */

/* A hit in a file outside this guard's lane, recorded instead of fixed:
     { file: 'src/views/x.js', rule: 'floor-api', what: 'at', why: '…' }
   Empty when this was written — the 11 Nov 2026 audit found src/ and the
   bundle clean on all four, and so did this scan. Keep it sorted. */
const KNOWN = [];

const sourceFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) sourceFiles.push(p);
  }
}(SRC));
ok(sourceFiles.length > 100, `src/ holds the plugin's modules (${sourceFiles.length} .js files)`);

const BUNDLE = path.join(ROOT, 'main.js');
ok(fs.existsSync(BUNDLE), 'main.js is missing — run ./build.sh first');

const found = [];
const totals = { nodes: 0, regexes: 0, calls: 0, detected: [] };
const usedKnown = new Set();
for (const file of [...sourceFiles, BUNDLE]) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const { hits, seen } = scan(fs.readFileSync(file, 'utf8'), rel);
  totals.nodes += seen.nodes; totals.regexes += seen.regexes; totals.calls += seen.calls;
  for (const api of seen.detected) totals.detected.push(`${rel}: ${api}`);
  for (const h of hits) {
    const known = KNOWN.findIndex(k => k.file === rel && k.rule === h.rule && h.what.startsWith(k.what));
    if (known >= 0) { usedKnown.add(known); continue; }
    found.push(`${rel}:${h.line}:${h.col}  ${h.rule}  ${h.what}  …${h.excerpt.slice(0, 80)}…`);
  }
}

/* The walk really went through the code: a scanner that silently visited
   nothing would report the same clean result. */
ok(totals.nodes > 500000, `the scan walked src/ and the bundle (${totals.nodes} syntax nodes)`);
ok(totals.regexes > 200, `and read their regex literals (${totals.regexes})`);
ok(totals.calls > 20000, `and their calls (${totals.calls})`);

/* The live example of detection done right is seen as exactly that, in the
   source and again in the bundle built from it. */
ok(totals.detected.includes('src/categories.js: showPicker'),
  'src/categories.js opens its picker behind a typeof test, and the scan reads that as detection');
ok(totals.detected.includes('main.js: showPicker'),
  'and still reads it that way in the minified bundle');

eq(found, [], `the iOS 15.0 floor is broken in ${found.length} place(s):\n  ${found.join('\n  ')}\n`
  + '  lookbehind: rewrite as a hand-rolled scan or an anchored alternation (src/markdown.js splitRow).\n'
  + '  floor-api:  use the long form (xs[xs.length - 1], Object.prototype.hasOwnProperty.call), or test for it first.\n'
  + '  html-sink:  createEl / setText / DOMParser.\n'
  + '  node-api:   there is no Node on a phone.\n');

/* ---- a floor the stylesheet's own comments got wrong ------------------------
   Three "iOS 15 / WebKit floor" notes head the mobile-redesign blocks of
   src/styles.css, and one of them listed the `inset` shorthand among the
   things the floor lacks. It does not: Safari has had `inset` since 14.1, and
   the same stylesheet uses it bare in thirteen places. A wrong floor note is
   not harmless — it reads as a rule, and the next person writes four
   longhands to obey it, or concludes the notes are not to be trusted. The
   note is corrected; this keeps the claim from being written again, and keeps
   the correction honest by checking the sheet really does rely on it. */
{
  const { readSources } = require('../scripts/css-sources.cjs');
  const sources = readSources();
  const claims = [];
  for (const s of sources) {
    for (const m of s.text.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (/\bno\s+(`|')?inset(`|')?\s+shorthand/i.test(m[0])) {
        claims.push(`${s.rel}:${s.text.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  eq(claims, [], 'a stylesheet comment says the iOS 15 floor has no `inset` shorthand — it does (Safari 14.1)');
  const bare = sources.map(s => s.text.replace(/\/\*[\s\S]*?\*\//g, '')).join('');
  ok((bare.match(/[\s;{]inset\s*:/g) || []).length >= 10,
    'and the stylesheet does use `inset:` without a fallback, which is why the note mattered');
}

for (let i = 0; i < KNOWN.length; i++) {
  ok(usedKnown.has(i), `KNOWN lists ${KNOWN[i].file} ${KNOWN[i].rule} ${KNOWN[i].what} but nothing matches it any more — delete the entry`);
}
eq(KNOWN.map(k => `${k.file} ${k.rule} ${k.what}`), KNOWN.map(k => `${k.file} ${k.rule} ${k.what}`).sort(), 'KNOWN is kept sorted');

console.log(`PASS ios-floor — ${sourceFiles.length} src files and main.js: no lookbehind, no API newer than iOS 15.0 `
  + `(${totals.detected.length} feature-detected), no HTML sink, no Node module; `
  + `${VIOLATIONS.length} planted violations caught, ${LEGAL.length} legal shapes passed (${checks} checks)`);
