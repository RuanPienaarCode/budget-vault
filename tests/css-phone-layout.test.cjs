'use strict';
/* THE PHONE LAYOUT KEEPS ITS PROMISES: ACCOUNTS FITS, AND TARGETS CAN BE HIT.

   Two findings from the 7 Oct 2026 audit, both measured at 390px — an iPhone
   held upright — and both invisible on the desktop the plugin is built on.

   1. ACCOUNTS. The stylesheet's own 760px rule says "a phone gets the name,
      the balance and the state". The per-row actions broke it: the state cell
      held its pill, the reason and two or three buttons on ONE nowrap line, so
      the table measured 827px in a 380px scroller — the pill cut to "doesn'",
      every row action at x 625-876, the drawer's Delete at x 739. The rules
      that fix it tie the base rules on specificity, so they only work if they
      come LATER in the file; this checks that as well as what they say.

      Under 600px the layout that truly fits is a card per row, which means a
      grid on the <tr> — and a grid row is no longer a row to VoiceOver (the
      reason dom.js tableCells exists for the stacked Transactions and Budget
      tables). So any rule that takes #acctTable out of table layout must be
      gated on [role='table']: it may only ever apply to a table whose roles
      were stamped explicitly. That gate is checked here, so the card layout
      can never quietly cost a screen-reader user the table.

   2. TAP TARGETS. Plan's item ticks were 17x17, item and bucket names 16-18px
      tall, status pills 20px on Owed/Debts/Tax, one-line caveat chips 21px —
      all under the 24px WCAG 2.2 AA floor (2.5.8). The sizes are computed from
      what the rules declare (font-size x line-height + padding, or an explicit
      min-height), not read off a literal, so a rule can change shape without
      changing this file and still be held to the floor. The two names grow by
      padding with an equal negative margin, which keeps the list's rhythm
      exactly as it was; that neutrality is checked too.

      The bucket slider (8px tall) grows a 24px hit area by padding, its track
      clipped to the content box. Its overspent state is painted inline by
      views/plan.js, which therefore writes `background-image`: the
      `background:` shorthand would reset background-clip and paint the red
      track 24px tall. Both halves are checked below.

     node tests/css-phone-layout.test.cjs */

const fs = require('fs');
const path = require('path');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const ROOT = path.join(__dirname, '..');

/* ---- a minimal stylesheet reader ------------------------------------------
   Not a CSS parser: enough to walk rules and their declarations, which is all
   these checks ask. Comments are blanked first (length-preserving, so line
   numbers stay true); strings are skipped so the data: URL's own `;` cannot end
   a declaration early; @media/@supports are descended into and recorded as the
   context of the rules inside them; @keyframes frames are walked as rules. */
function readRules(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const skipString = i => { const q = src[i]; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; return i; };
  const closeOf = open => {
    let d = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'") i = skipString(i);
      else if (c === '{') d++;
      else if (c === '}' && --d === 0) return i;
    }
    throw new Error(`${rel}: unbalanced brace from line ${lineOf(open)}`);
  };
  const splitTop = s => {
    const out = []; let d = 0, cur = '';
    for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur);
    return out.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const rules = [];
  const walk = (from, to, context) => {
    let i = from, start = from;
    while (i < to) {
      const c = src[i];
      if (c === '"' || c === "'") { i = skipString(i) + 1; continue; }
      if (c === ';') { start = ++i; continue; }
      if (c !== '{') { i++; continue; }
      const prelude = src.slice(start, i).replace(/\s+/g, ' ').trim();
      const close = closeOf(i);
      if (/^@(media|supports|layer|container|document|(-webkit-)?keyframes)\b/.test(prelude)) {
        walk(i + 1, close, [...context, prelude]);
      } else {
        const decls = [];
        let ds = i + 1, depth = 0;
        for (let j = i + 1; j <= close; j++) {
          const d = src[j];
          if (d === '"' || d === "'") { j = skipString(j); continue; }
          if (d === '(') depth++;
          else if (d === ')') depth--;
          else if ((d === ';' && depth === 0) || j === close) {
            const text = src.slice(ds, j), colon = text.indexOf(':');
            if (text.trim() && colon > 0) {
              const prop = text.slice(0, colon).trim();
              decls.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
                value: text.slice(colon + 1).trim(), line: lineOf(ds + (text.length - text.trimStart().length)) });
            }
            ds = j + 1;
          }
        }
        rules.push({ file: rel, prelude, selectors: splitTop(prelude), context, decls, line: lineOf(i) });
      }
      i = start = close + 1;
    }
  };
  walk(0, src.length, []);
  return rules;
}

const rules = readRules('src/styles.css');
ok(rules.length > 1000, `the reader should find over a thousand rules, found ${rules.length}`);

/* The LAST declaration of `prop` for an exact selector in a given context —
   last, because that is the one the cascade keeps between equal rules. */
const decl = (sel, prop, ctx = []) => {
  let hit = null;
  for (const r of rules) {
    if (JSON.stringify(r.context) !== JSON.stringify(ctx) || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, rule: r };
  }
  return hit;
};
const px = v => { const m = /^(-?[\d.]+)(px|rem)?$/.exec(String(v).trim()); return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : NaN; };
/* The vertical component of a padding/margin shorthand. */
const blockOf = v => { const p = String(v).trim().split(/\s+/); return px(p[0]); };
const inlineStartOf = v => { const p = String(v).trim().split(/\s+/); return px(p.length === 4 ? p[3] : p.length >= 2 ? p[1] : p[0]); };

/* ---- 1. Accounts at a phone width ------------------------------------------ */
const PHONE = ['@media (max-width: 760px)'], SMALL = ['@media (max-width: 600px)'];
const want = (sel, prop, ctx, test, why) => {
  const d = decl(sel, prop, ctx);
  ok(d && test(d.value), `${ctx.join(' ') || '(base)'} ${sel} { ${prop} } should ${why}; found ${d ? `"${d.value}" at line ${d.line}` : 'nothing'}`);
  return d;
};
const later = (sel, prop, ctx) => {
  const over = decl(sel, prop, ctx), base = decl(sel, prop, []);
  ok(!base || (over && over.line > base.line),
    `${sel} { ${prop} }: the ${ctx.join(' ')} override (line ${over && over.line}) must come AFTER the base rule ` +
    `(line ${base && base.line}) — they tie on specificity, so an earlier override loses on every phone`);
};
want('.budget-app-root .acct-col-state', 'white-space', PHONE, v => v === 'normal', 'let the state cell wrap');
later('.budget-app-root .acct-col-state', 'white-space', PHONE);
want('.budget-app-root .acct-row-acts', 'display', PHONE, v => v === 'flex', 'be a block-level flex row (its own line)');
later('.budget-app-root .acct-row-acts', 'display', PHONE);
want('.budget-app-root .acct-row-acts', 'flex-wrap', PHONE, v => v === 'wrap', 'wrap its buttons');
const actsMargin = want('.budget-app-root .acct-row-acts', 'margin', PHONE, v => inlineStartOf(v) === 0, 'drop the inline offset it has beside the pill');
later('.budget-app-root .acct-row-acts', 'margin', PHONE);
want('.budget-app-root .acct-pill + .acct-row-acts', 'margin-left', PHONE, v => px(v) === 0, 'drop the 8px it has beside the pill');
later('.budget-app-root .acct-pill + .acct-row-acts', 'margin-left', PHONE);
ok(!actsMargin || blockOf(actsMargin.value) > 0, 'the actions keep a gap above them, under the pill and its reason');
want('.budget-app-root .acct-col-state .acct-pill', 'white-space', SMALL, v => v === 'normal', 'let a long pill wrap on a phone');
want('.budget-app-root #acctTable td:first-child', 'min-width', SMALL, v => px(v) === 0,
  'lift the 210px name floor on a phone, where the state cell is no longer the column that cannot give');
later('.budget-app-root #acctTable td:first-child', 'min-width', SMALL);

/* The VoiceOver gate. Any rule that changes how an #acctTable element is
   DISPLAYED must name [role='table'] in that selector. */
const GATE = /#acctTable\[role=(['"])table\1\]/;
const relayouts = rules.filter(r => r.decls.some(d => d.prop === 'display' && /^(grid|block|flex|inline-flex|contents)$/.test(d.value)) &&
  r.selectors.some(s => s.includes('#acctTable')));
for (const r of relayouts) {
  for (const s of r.selectors.filter(x => x.includes('#acctTable'))) {
    ok(GATE.test(s), `line ${r.line}: "${s}" takes the Accounts table out of table layout without the [role='table'] ` +
      'gate — on iOS VoiceOver a grid/block table is no longer a table unless its roles were stamped (dom.js tableCells)');
  }
  ok(JSON.stringify(r.context) === JSON.stringify(SMALL), `line ${r.line}: the card layout belongs under ${SMALL[0]} only, found ${r.context.join(' ') || 'no @media'}`);
}
ok(relayouts.some(r => r.selectors.some(s => GATE.test(s) && / tr$/.test(s)) && r.decls.some(d => d.prop === 'display' && d.value === 'grid')),
  'the gated card layout exists: a [role=\'table\'] #acctTable tr becomes a grid under 600px');

/* ---- 2. tap targets --------------------------------------------------------- */
const FLOOR = 24;
const rootLine = decl('.budget-app-root', 'line-height');
const LH = rootLine ? Number(rootLine.value) : NaN;
ok(LH > 1 && LH < 2, `sanity: the root's line-height is a unitless factor, found ${rootLine && rootLine.value}`);

for (const sel of ['.budget-app-root .status-pill', '.budget-app-root .caveat-chip-btn']) {
  const mh = decl(sel, 'min-height');
  ok(mh && px(mh.value) >= FLOOR, `${sel}: min-height must be at least ${FLOOR}px (the WCAG 2.2 AA target floor), found ${mh ? mh.value : 'none'}`);
}
const tick = { w: decl('.budget-app-root .ei-tick', 'width'), h: decl('.budget-app-root .ei-tick', 'height'), mb: decl('.budget-app-root .ei-tick', 'margin-block') };
ok(tick.w && tick.h && px(tick.w.value) >= FLOOR && px(tick.h.value) >= FLOOR,
  `.ei-tick must be at least ${FLOOR}x${FLOOR}px, found ${tick.w && tick.w.value} x ${tick.h && tick.h.value}`);

/* A text button's height: its line box plus its block padding. Its LAYOUT
   height adds the block margins back, and for these two that must equal the
   bare line box, so growing the target moves nothing on the page. */
const nameLineBox = {};
for (const sel of ['.budget-app-root .ei-name', '.budget-app-root .env-name']) {
  const fs_ = decl(sel, 'font-size'), lh = decl(sel, 'line-height'), pad = decl(sel, 'padding'), mar = decl(sel, 'margin-block');
  const line = px(fs_ && fs_.value) * (lh ? Number(lh.value) : LH);
  const p = pad ? blockOf(pad.value) : 0;
  nameLineBox[sel] = line;
  ok(line + 2 * p >= FLOOR, `${sel}: the target is ${(line + 2 * p).toFixed(2)}px tall (${line.toFixed(2)}px of text + 2 x ${p}px), under ${FLOOR}px`);
  ok(mar && px(mar.value) === -p, `${sel}: margin-block should be -${p}px to hand the padding back (layout unchanged), found ${mar ? mar.value : 'none'}`);
}
/* The tick grows past the 18px row its name sets; its negative block margins
   must keep its layout box inside that line, or every list row grows. */
const tickLayout = px(tick.h && tick.h.value) + 2 * px(tick.mb ? tick.mb.value : 0);
ok(tickLayout <= nameLineBox['.budget-app-root .ei-name'] + 0.5,
  `.ei-tick's layout box is ${tickLayout}px against the name's ${nameLineBox['.budget-app-root .ei-name'].toFixed(2)}px line — the rows would grow`);

/* The bucket slider, the target the pass above left open: 8px of visible
   track inside a 24px hit area. The height includes the padding (border-box),
   and the track is clipped to the content box, which holds only while no rule
   and no inline style writes the `background` shorthand: the shorthand resets
   background-clip, and plan.js paints an overspent bucket's fill inline. */
const slider = { h: decl('.budget-app-root .env-slider', 'height'), pb: decl('.budget-app-root .env-slider', 'padding-block'),
  clip: decl('.budget-app-root .env-slider', 'background-clip') };
ok(slider.h && px(slider.h.value) >= FLOOR, `.env-slider: height must be at least ${FLOOR}px, found ${slider.h ? slider.h.value : 'none'}`);
ok(slider.h && slider.pb && px(slider.h.value) - 2 * px(slider.pb.value) === 8,
  `.env-slider: the visible track stays 8px (height less both paddings), found ${slider.h && slider.h.value} / ${slider.pb ? slider.pb.value : 'no padding-block'}`);
ok(slider.clip && slider.clip.value === 'content-box', `.env-slider: background-clip must be content-box, found ${slider.clip ? slider.clip.value : 'none'}`);
const sliderShorthand = rules.filter(r => r.selectors.some(x => /\.env-slider$/.test(x)) && r.decls.some(d => d.prop === 'background'));
ok(sliderShorthand.length === 0,
  `no rule may set the background shorthand on .env-slider (it resets background-clip): line ${sliderShorthand.map(r => r.line).join(', ')}`);
const planSrc = fs.readFileSync(path.join(ROOT, 'src', 'views', 'plan.js'), 'utf8');
ok(!/`background:\s*linear-gradient/.test(planSrc) && /`background-image:\s*linear-gradient/.test(planSrc),
  'plan.js paints the overspent fill with background-image, not the background shorthand');

if (failures.length) {
  console.log(`FAIL — css-phone-layout: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-phone-layout: Accounts phone rules present and ordered, ${relayouts.length} relayout rules all behind ` +
  `[role='table'], six tap targets at ${FLOOR}px or more (${checks} checks).`);
