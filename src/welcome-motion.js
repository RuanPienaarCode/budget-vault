'use strict';
/* The setup wizard's welcome animation: five short scenes — the vault door
   opening, the setup questions, a statement import, a budget and a plan —
   above the welcome text, so a new reader sees where the two minutes of setup
   lead before answering anything. The source design is
   docs/onboarding/onboarding-motion.html; this is its native port.

   ONE TIMER, ALL ELSE CSS. JavaScript only decides which scene is on; every
   entrance inside a scene is a keyframe in src/styles.css keyed off `.is-on`,
   so re-adding the class replays it. Keyframes rather than
   requestAnimationFrame for the reason confetti() and celebrate() give: rAF is
   starved while a pane is hidden and would freeze a half-drawn frame.

   Words come from the translation table and figures from the wizard's own
   formatters, so the scenes follow the reader's language, currency and
   country. The picture is aria-hidden: the welcome text under it says all of
   it, and the pause button and dots are the only parts a reader operates.

   It animates nothing nobody can see: no timer until the root is in a live
   document (the wizard's guard test builds it in bare node), none under
   reduced motion, and destroy() takes the timer, the resize observer and the
   media listener down. Pure DOM, no obsidian import; the door is drawn only
   where Obsidian's createSvg exists. tests/welcome-motion.test.cjs pins it. */

const SCENE_MS = [5200, 6800, 6800, 6800, 7600];
const STAGE_W = 440;           // the stage is drawn at this width and scaled to fit

function buildWelcomeMotion(parent, { t, money, signed, win = (typeof window !== 'undefined' ? window : null) }) {
  const root = parent.createDiv({ cls: 'budget-onb-motion' });
  const frame = root.createDiv({ cls: 'bvm-frame', attr: { 'aria-hidden': 'true' } });
  const stage = frame.createDiv({ cls: 'bvm-stage' });
  const scenes = [
    welcomeScene(stage),
    settingsScene(stage, t),
    importScene(stage, t, signed),
    budgetScene(stage, t, money),
    planScene(stage, t, money),
  ];
  const names = [t('wiz.welcome.title'), t('wiz.title'), t('nav.import'), t('nav.budgets'), t('nav.plan')];

  const media = win && typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let still = !!(media && media.matches);
  let paused = false;
  let current = 0;
  let timer = null;
  let left = SCENE_MS[0];       // what is left of the current scene's time
  let startedAt = 0;
  let observer = null;
  let dead = false;
  const clock = () => (win && win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now());

  const controls = root.createDiv({ cls: 'bvm-controls' });
  // Always built, hidden while still: reduced motion can be switched off mid-way,
  // and then the scenes move again and need their pause button back.
  const toggle = controls.createEl('button', { cls: 'bvm-toggle', attr: { type: 'button' } });
  const dotRow = controls.createDiv({ cls: 'bvm-dots' });
  const dots = names.map((name, i) => {
    const d = dotRow.createEl('button', { cls: 'bvm-dot', attr: { type: 'button', 'aria-label': name } });
    d.addEventListener('click', () => show(i));
    return d;
  });

  const canTime = () => !dead && !still && !paused && win && typeof win.setTimeout === 'function' && root.isConnected === true;
  const stop = () => { if (timer != null && win) win.clearTimeout(timer); timer = null; };
  const arm = ms => {
    stop();
    if (!canTime()) return;
    startedAt = clock();
    left = ms;
    timer = win.setTimeout(() => { timer = null; show((current + 1) % scenes.length); }, ms);
  };
  function show(i) {
    if (dead) return;
    current = i;
    scenes.forEach((s, k) => s.toggleClass('is-on', k === i));
    dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'true' : 'false'));
    left = SCENE_MS[i];
    arm(left);
  }
  function label() {
    toggle.setAttribute('aria-label', t(paused ? 'wiz.motion.play' : 'wiz.motion.pause'));
    toggle.toggleClass('is-paused', paused);
    toggle.toggleClass('bvm-gone', still);
  }
  /* The keyframes resume from where they froze, so the timer resumes with
     what was left of the scene rather than starting it over. */
  toggle.addEventListener('click', () => {
    paused = !paused;
    root.toggleClass('is-paused', paused);
    label();
    if (paused) {
      if (timer != null) left = Math.max(0, left - (clock() - startedAt));
      stop();
    } else {
      arm(left);
    }
  });
  const onMedia = e => {
    still = !!e.matches;
    root.toggleClass('is-still', still);
    label();
    arm(SCENE_MS[current]);
  };
  if (media && typeof media.addEventListener === 'function') media.addEventListener('change', onMedia);

  // The stage has a fixed drawing size; scale it to whatever width the dialog gives it.
  if (win && typeof win.ResizeObserver === 'function') {
    observer = new win.ResizeObserver(entries => {
      const w = entries && entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
      if (w > 0) stage.setAttribute('style', `--bvm-scale:${(w / STAGE_W).toFixed(4)}`);
    });
    observer.observe(frame);
  }

  root.toggleClass('is-still', still);
  label();
  show(0);

  return {
    root,
    destroy() {
      if (dead) return;
      dead = true;
      stop();
      if (observer) observer.disconnect();
      if (media && typeof media.removeEventListener === 'function') media.removeEventListener('change', onMedia);
    },
  };
}

/* ------------------------------- scenes ---------------------------------- */
const scene = (stage, n) => stage.createDiv({ cls: `bvm-scene bvm-s${n}` });

/* Hinges on the left, eight bolts round the rim, a three-spoke wheel. The
   wheel turns, then the door swings back on its hinges (a squash about the
   hinge line reads as a swing). Coordinates as in the source design. */
const BOLTS = [[52, 28.5], [68.62, 35.38], [75.5, 52], [68.62, 68.62], [52, 75.5], [35.38, 68.62], [28.5, 52], [35.38, 35.38]];
const KNOBS = [[52, 33.5], [68.02, 61.25], [35.98, 61.25]];
function door(parent) {
  if (typeof parent.createSvg !== 'function') return;
  const svg = parent.createSvg('svg', { cls: 'bvm-door', attr: { viewBox: '0 0 104 104' } });
  svg.createSvg('rect', { cls: 'bvm-door-bg', attr: { x: 6, y: 6, width: 92, height: 92, rx: 28 } });
  svg.createSvg('rect', { cls: 'bvm-door-box', attr: { x: 6, y: 6, width: 92, height: 92, rx: 28 } });
  svg.createSvg('circle', { cls: 'bvm-door-inside', attr: { cx: 52, cy: 52, r: 29 } });
  svg.createSvg('rect', { cls: 'bvm-door-hinge', attr: { x: 16, y: 39, width: 7, height: 8, rx: 2.5 } });
  svg.createSvg('rect', { cls: 'bvm-door-hinge', attr: { x: 16, y: 57, width: 7, height: 8, rx: 2.5 } });
  const leaf = svg.createSvg('g', { cls: 'bvm-door-leaf' });
  leaf.createSvg('circle', { cls: 'bvm-door-face', attr: { cx: 52, cy: 52, r: 29 } });
  leaf.createSvg('circle', { cls: 'bvm-door-rim', attr: { cx: 52, cy: 52, r: 29 } });
  const bolts = leaf.createSvg('g', { cls: 'bvm-door-bolts' });
  for (const [cx, cy] of BOLTS) bolts.createSvg('circle', { attr: { cx, cy, r: 1.8 } });
  const spin = leaf.createSvg('g', { cls: 'bvm-door-wheel' }).createSvg('g', { cls: 'bvm-door-spin' });
  spin.createSvg('circle', { cls: 'bvm-door-ring', attr: { cx: 52, cy: 52, r: 8.5 } });
  spin.createSvg('path', { cls: 'bvm-door-spokes', attr: { d: 'M52 43.5L52 36 M59.36 56.25L65.86 60 M44.64 56.25L38.14 60' } });
  for (const [cx, cy] of KNOBS) spin.createSvg('circle', { cls: 'bvm-door-knob', attr: { cx, cy, r: 2.6 } });
  spin.createSvg('circle', { cls: 'bvm-door-knob', attr: { cx: 52, cy: 52, r: 3 } });
}

function welcomeScene(stage) {
  const s = scene(stage, 1);
  const mark = s.createDiv({ cls: 'bvm-mark' });
  door(mark);
  s.createDiv({ cls: 'bvm-wordmark', text: 'Budget Vault' });
  return s;
}

function settingsScene(stage, t) {
  const s = scene(stage, 2);
  s.createDiv({ cls: 'bvm-label', text: t('wiz.title') });
  const card = s.createDiv({ cls: 'bvm-card bvm-wiz' });
  const head = card.createDiv({ cls: 'bvm-wiz-head' });
  head.createSpan({ text: t('wiz.stepOf', { n: 1, total: 7 }) });
  head.createSpan({ cls: 'bvm-wiz-prog' }).createSpan();

  const name = card.createDiv({ cls: 'bvm-field bvm-f1' });
  name.createDiv({ cls: 'bvm-lb', text: t('wiz.step.name') });
  const input = name.createDiv({ cls: 'bvm-input' });
  input.createSpan({ cls: 'bvm-typed', text: 'Sam' });
  input.createSpan({ cls: 'bvm-caret' });

  const paid = card.createDiv({ cls: 'bvm-field bvm-f2' });
  paid.createDiv({ cls: 'bvm-lb', text: t('wiz.step.period') });
  const days = paid.createDiv({ cls: 'bvm-days' });
  for (const d of [22, 23, 24, 25, 26, 27, 28]) days.createSpan({ cls: d === 25 ? 'bvm-day is-sel' : 'bvm-day', text: String(d) });
  days.createSpan({ cls: 'bvm-day-ring' });

  const how = card.createDiv({ cls: 'bvm-field bvm-f3' });
  how.createDiv({ cls: 'bvm-lb', text: t('wiz.step.how') });
  const opts = how.createDiv({ cls: 'bvm-opts' });
  const csv = opts.createDiv({ cls: 'bvm-opt' });
  csv.createSpan({ cls: 'bvm-opt-sel' });
  csv.createSpan({ cls: 'bvm-opt-text', text: t('wiz.how.csv.title') });
  csv.createSpan({ cls: 'bvm-tick' });
  opts.createDiv({ cls: 'bvm-opt' }).createSpan({ cls: 'bvm-opt-text', text: t('wiz.how.manual.title') });
  return s;
}

function importScene(stage, t, signed) {
  const s = scene(stage, 3);
  s.createDiv({ cls: 'bvm-label', text: t('nav.import') });
  const drop = s.createDiv({ cls: 'bvm-drop' });
  drop.createSpan({ cls: 'bvm-drop-on' });
  drop.createSpan({ cls: 'bvm-drop-name', text: 'statement.csv' });
  const file = drop.createDiv({ cls: 'bvm-file-move' }).createDiv({ cls: 'bvm-file' });
  file.createSpan({ cls: 'bvm-file-doc', text: 'CSV' });
  file.createSpan({ text: 'statement.csv' });
  const list = s.createDiv({ cls: 'bvm-card bvm-txs' });
  const rows = [
    ['25', 'wiz.type.income', 28500, true],
    ['26', 'wiz.type.food', -842.1, false],
    ['27', 'wiz.type.transport', -650, false],
    ['28', 'wiz.type.services', -199, false],
  ];
  rows.forEach(([day, type, amount, isIn], k) => {
    const row = list.createDiv({ cls: `bvm-tx bvm-r${k + 1}` });
    row.createSpan({ cls: 'bvm-tx-day', text: day });
    row.createSpan({ cls: isIn ? 'bvm-tag is-in' : 'bvm-tag', text: t(type) });
    row.createSpan({ cls: isIn ? 'bvm-amt is-in' : 'bvm-amt', text: signed(amount, 2) });
  });
  return s;
}

function budgetScene(stage, t, money) {
  const s = scene(stage, 4);
  s.createDiv({ cls: 'bvm-label', text: t('nav.budgets') });
  const tiles = s.createDiv({ cls: 'bvm-tiles' });
  [['bud.total.income', 28500], ['bud.total.budgeted', 28500], ['bud.total.left', 0]].forEach(([key, v], k) => {
    const tile = tiles.createDiv({ cls: `bvm-card bvm-tile bvm-t${k + 1}` });
    tile.createSpan({ cls: 'bvm-tile-lb', text: t(key) });
    tile.createSpan({ cls: 'bvm-tile-v', text: money(v, 0) });
  });
  const cats = s.createDiv({ cls: 'bvm-card bvm-cats' });
  /* Budgeted, spent, and the width class its bar fills to (spent ÷ budgeted,
     capped at the bar). */
  const rows = [
    ['wiz.type.food', 4200, 2950, 'bvm-w70'],
    ['wiz.type.transport', 1800, 1240, 'bvm-w69'],
    ['wiz.type.luxuries', 900, 960, 'bvm-w100'],
    ['wiz.type.giving', 2850, 2850, 'bvm-w100'],
  ];
  rows.forEach(([type, budget, spent, width], k) => {
    const over = spent > budget;
    const row = cats.createDiv({ cls: over ? `bvm-cat bvm-r${k + 1} is-over` : `bvm-cat bvm-r${k + 1}` });
    const top = row.createDiv({ cls: 'bvm-cat-top' });
    top.createSpan({ cls: 'bvm-cat-name', text: `${t(type)} · ${money(budget, 0)}` });
    top.createSpan({ cls: 'bvm-cat-st', text: over
      ? t('bud.remaining.over', { amount: money(spent - budget, 0) })
      : t('bud.remaining.left', { amount: money(budget - spent, 0) }) });
    row.createDiv({ cls: 'bvm-bar' }).createSpan({ cls: width });
  });
  return s;
}

function planScene(stage, t, money) {
  const s = scene(stage, 5);
  s.createDiv({ cls: 'bvm-label', text: t('nav.plan') });
  const hero = s.createDiv({ cls: 'bvm-card bvm-hero' });
  hero.createDiv({ cls: 'bvm-hero-lb', text: t('plan.hero.leftToPlace') });
  /* What is left to place as each bucket takes its share: four figures stacked
     in one spot, each shown in its own window of the scene by the stylesheet. */
  const fig = hero.createDiv({ cls: 'bvm-hero-v' });
  [8400, 4400, 2600, 0].forEach((v, k) => fig.createSpan({ cls: `bvm-v bvm-v${k + 1}`, text: money(v, 0) }));
  hero.createDiv({ cls: 'bvm-hero-of', text: t('plan.hero.ofPot', { pot: money(8400, 0) }) });
  hero.createDiv({ cls: 'bvm-split' }).createSpan();
  const legend = hero.createDiv({ cls: 'bvm-legend' });
  legend.createSpan({ cls: 'bvm-key is-spoken', text: t('plan.split.spokenFor') });
  legend.createSpan({ cls: 'bvm-key', text: t('plan.split.notSpokenFor') });
  const buckets = s.createDiv({ cls: 'bvm-buckets' });
  [['wiz.type.luxuries', 4000], ['wiz.type.transport', 1800], ['wiz.type.savings', 2600]].forEach(([type, v], k) => {
    const b = buckets.createDiv({ cls: `bvm-card bvm-bk bvm-b${k + 1}` });
    b.createSpan({ cls: 'bvm-bk-name', text: t(type) });
    b.createSpan({ cls: 'bvm-bk-v', text: money(v, 0) });
    b.createSpan({ cls: 'bvm-bk-sub', text: t('plan.env.nothingSpent') });
  });
  return s;
}

module.exports = { buildWelcomeMotion, SCENE_MS };
