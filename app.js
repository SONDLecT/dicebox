import { roll, describe, stepChain } from './dice.js';
import { Die, Surface, separate, beginFrame } from './render.js';

const $ = id => document.getElementById(id);
const canvas = $('tray');
const ctx = canvas.getContext('2d');

// One row of dice, ordered by size. This is the full Dungeon Crawl Classics
// chain plus d2 and d100, so the chain's +/- buttons step along this same row —
// a separate chain row would just be these buttons twice.
const QUICK = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100];

// Above this many dice, throwing them across the tray stops being legible and
// the pairwise separation gets expensive. Larger rolls spin in place instead.
const THROW_LIMIT = 24;

// Above this, even spinning in place costs more per frame than the animation is
// worth — measured at ~39ms/frame for 400 dice on a Raspberry Pi, well past the
// 16.7ms budget. Bigger rolls show their result immediately; the total is what
// anyone rolling 500 dice actually wants.
const ANIMATE_LIMIT = 220;

const state = {
  count: 1,
  chainSides: 20,
  dice: [],
  surface: new Surface(),
  bounds: { left: 0, right: 0, top: 0, floor: 0 },
  last: null,
};

// ---- theme ----

const stored = localStorage.getItem('dicebox:theme');
if (stored) document.documentElement.dataset.theme = stored;
syncThemeLabel();

$('themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = getComputedStyle(root).getPropertyValue('--paper').trim().toLowerCase() === '#141413';
  root.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('dicebox:theme', root.dataset.theme);
  syncThemeLabel();
  updateThemeColor();
});

function syncThemeLabel() {
  const dark = getComputedStyle(document.documentElement)
    .getPropertyValue('--paper').trim().toLowerCase() === '#141413';
  document.querySelector('[data-theme-label]').textContent = dark ? 'Light' : 'Dark';
}

function updateThemeColor() {
  const paper = theme().paper;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', paper));
}

function theme() {
  const s = getComputedStyle(document.documentElement);
  return {
    paper: s.getPropertyValue('--paper').trim(),
    line:  s.getPropertyValue('--line').trim(),
    muted: s.getPropertyValue('--muted').trim(),
    accent: s.getPropertyValue('--accent').trim(),
  };
}

// ---- canvas sizing ----

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.bounds = { left: 8, right: r.width - 8, top: 8, floor: r.height - 18 };
  layoutSettled();
}
new ResizeObserver(resize).observe(canvas.parentElement);

// After a resize the previous positions may be off-screen, so re-place any dice
// that have already come to rest instead of leaving them stranded.
function layoutSettled() {
  const settled = state.dice.filter(d => d.settled);
  if (settled.length) placeGrid(settled);
}

function placeGrid(dice) {
  const { left, right, top, floor } = state.bounds;
  const w = right - left, h = floor - top;
  const cols = Math.ceil(Math.sqrt(dice.length * (w / Math.max(h, 1))));
  const rows = Math.ceil(dice.length / cols);
  const cw = w / cols, ch = h / rows;
  // Cap the size so a lone die doesn't fill the whole tray, and floor it so a
  // large handful stays legible.
  const size = Math.max(26, Math.min(96, Math.min(cw, ch) * 0.78));
  dice.forEach((d, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    d.x = left + cw * (c + 0.5);
    d.y = top + ch * (r + 0.5);
    d.size = size;
  });
}

// ---- rolling ----

function doRoll(notation) {
  let result;
  try {
    result = roll(notation);
  } catch (err) {
    showError(err.message);
    return;
  }
  clearError();

  state.last = result;
  $('notation').value = result.notation;

  const flat = [];
  for (const g of result.groups) {
    if (g.kind !== 'dice') continue;
    for (const d of g.dice) flat.push({ sides: g.sides, value: d.value });
  }

  state.dice = flat.map(f => new Die(f.sides, f.value, 0, 0, 40));
  placeGrid(state.dice);

  // Small rolls get thrown across the tray. Large ones spin in place: the dice
  // end up in the same grid either way, so for 100d6 the flight and collisions
  // buy nothing and cost every frame. Spinning in place keeps every die animated
  // at a fraction of the work.
  const mode = flat.length === 0 || flat.length > ANIMATE_LIMIT ? 'none'
             : flat.length <= THROW_LIMIT ? 'throw'
             : 'spin';

  if (mode === 'throw') {
    // Each die keeps the grid slot placeGrid gave it and is thrown *toward* it.
    // Launching from random positions instead is what made dice pile up.
    for (const d of state.dice) {
      d.homeX = d.x;
      d.homeY = d.y;
      const fromLeft = Math.random() < 0.5;
      d.x = fromLeft ? state.bounds.left + 12 : state.bounds.right - 12;
      d.y = state.bounds.top + 12 + Math.random() * 30;
      d.throwWith((d.homeX - d.x) * 2.4, (d.homeY - d.y) * 2.4);
    }
    $('total').dataset.rolling = '1';
    setTimeout(() => finish(result), 620);
  } else if (mode === 'spin') {
    // Stagger the starts so the grid resolves in a wave instead of snapping.
    state.dice.forEach((d, i) => d.spinInPlace(i / state.dice.length));
    $('total').dataset.rolling = '1';
    setTimeout(() => finish(result), 700);
  } else {
    for (const d of state.dice) { d.settled = true; d.settling = true; d.settleT = 1; }
    finish(result);
  }

  if (navigator.vibrate) navigator.vibrate(mode === 'none' ? 10 : [8, 40, 12]);
  hideHint();
}

function finish(result) {
  delete $('total').dataset.rolling;
  delete $('total').dataset.idle;
  $('total').textContent = String(result.total);
  $('breakdown').textContent = describe(result.groups);
  addHistory(result);
}

function addHistory(result) {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = result.notation;
  const val = document.createElement('b');
  val.textContent = String(result.total);
  li.append(label, val);
  const list = $('history');
  list.prepend(li);
  while (list.children.length > 12) list.lastElementChild.remove();
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg;
  el.hidden = false;
}
function clearError() { $('error').hidden = true; }

// ---- controls ----

$('entry').addEventListener('submit', e => {
  e.preventDefault();
  doRoll($('notation').value);
  $('notation').blur();
});

// ---- help ----

const help = $('help');
const helpToggle = $('helpToggle');

function setHelp(open) {
  help.hidden = !open;
  helpToggle.setAttribute('aria-expanded', String(open));
  helpToggle.setAttribute('aria-label', open ? 'Hide syntax reference' : 'Show syntax reference');
  if (open) hideHint();
}

helpToggle.addEventListener('click', () => setHelp(help.hidden));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !help.hidden) {
    setHelp(false);
    helpToggle.focus();
  }
});

// Tapping an example loads it, so the reference doubles as a set of presets.
help.querySelectorAll('.syntax dt').forEach(dt => {
  dt.tabIndex = 0;
  dt.role = 'button';
  const use = () => {
    $('notation').value = dt.textContent.trim();
    setHelp(false);
    doRoll(dt.textContent.trim());
  };
  dt.addEventListener('click', use);
  dt.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); use(); }
  });
});

// ---- the pool ----
//
// Tapping dice builds a pool: tap d20 twice and d6 once and you have 2d20+1d6,
// which is what an attack roll actually looks like. The pool writes itself into
// the notation field, so the field stays the single source of truth and typing
// notation by hand still works exactly as before.

const diceButtons = $('diceButtons');

// Insertion order is preserved, so the notation reads back in the order tapped.
let pool = new Map();

function poolNotation() {
  return [...pool].map(([sides, n]) => `${n}d${sides}`).join('+');
}

function addToPool(sides) {
  // Typing in the field and then tapping a die should extend what is there, not
  // silently discard it. Anything unparseable is replaced instead.
  if (!poolMatchesField()) {
    pool = parsePool($('notation').value);
  }
  pool.set(sides, (pool.get(sides) || 0) + 1);
  syncPool();
}

function poolMatchesField() {
  return $('notation').value.trim().toLowerCase() === poolNotation().toLowerCase();
}

// Recover a pool from plain NdM+NdM text. Anything with modifiers or arithmetic
// can't round-trip through the Map, so those roll fine but start a fresh pool
// on the next tap.
function parsePool(text) {
  const next = new Map();
  const src = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (!src) return next;
  for (const term of src.split('+')) {
    const m = /^(\d*)d(\d+)$/.exec(term);
    if (!m) return new Map();
    const n = m[1] === '' ? 1 : parseInt(m[1], 10);
    const sides = parseInt(m[2], 10);
    if (!sides) return new Map();
    next.set(sides, (next.get(sides) || 0) + n);
  }
  return next;
}

// Show the pool as unrolled dice waiting on the tray, so tapping summons the
// dice you are about to throw rather than only changing text.
function syncPool() {
  const notation = poolNotation();
  $('notation').value = notation;
  clearError();

  const staged = [];
  for (const [sides, n] of pool) {
    for (let i = 0; i < n; i++) staged.push(new Die(sides, null, 0, 0, 40));
  }
  state.dice = staged.slice(0, ANIMATE_LIMIT);
  placeGrid(state.dice);
  for (const d of state.dice) {
    d.settled = true;
    d.settling = true;
    d.settleT = 1;
    d.rot = [0.5, 0.6, 0.1];
  }

  $('total').dataset.idle = '1';
  $('total').textContent = '—';
  $('breakdown').textContent = notation ? `${staged.length} dice ready` : 'Pick dice or type a roll';
  hideHint();
}

function clearPool() {
  pool = new Map();
  state.dice = [];
  $('notation').value = '';
  $('total').dataset.idle = '1';
  $('total').textContent = '—';
  $('breakdown').textContent = 'Pick dice or type a roll';
  clearError();
}

$('clear').addEventListener('click', () => {
  clearPool();
  $('notation').focus();
});

// One row, ordered by size. The DCC chain values are all here, so the +/- steps
// move along this same row instead of needing a second one.
for (const sides of QUICK) {
  const b = document.createElement('button');
  b.className = 'dbtn';
  b.type = 'button';
  b.textContent = `d${sides}`;
  b.dataset.sides = String(sides);
  b.addEventListener('click', () => {
    state.chainSides = sides;
    addToPool(sides);
    markChain();
  });
  diceButtons.append(b);
}

// The chain buttons step the *last* die tapped up or down its rung, replacing
// that die in the pool — the DCC "roll a d16 instead of a d20" move.
function stepPool(dir) {
  const from = state.chainSides;
  const to = stepChain(from, dir);
  if (to === from) return;

  state.chainSides = to;
  if (pool.has(from)) {
    const n = pool.get(from);
    pool.delete(from);
    pool.set(to, (pool.get(to) || 0) + n);
    syncPool();
  } else {
    addToPool(to);
  }
  markChain();
}

// Highlight whichever die the chain will step from.
function markChain() {
  for (const b of diceButtons.children) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.sides) === state.chainSides));
  }
  const active = [...diceButtons.children]
    .find(b => Number(b.dataset.sides) === state.chainSides);
  active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

$('chainUp').addEventListener('click', () => stepPool(1));
$('chainDown').addEventListener('click', () => stepPool(-1));
markChain();

// ---- flick to throw ----

let drag = null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, t: performance.now() };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const dt = Math.max(16, performance.now() - drag.t);
  const vx = ((e.clientX - drag.x) / dt) * 1000;
  const vy = ((e.clientY - drag.y) / dt) * 1000;
  const speed = Math.hypot(vx, vy);
  drag = null;

  // Throw whatever is staged; failing that, re-roll the last notation. The tray
  // is never a dead surface, so a tap on an empty one rolls the selected die.
  const target = $('notation').value.trim()
    || (state.last && state.last.notation)
    || `d${state.chainSides}`;

  doRoll(target);
  if (speed > 120) {
    for (const d of state.dice) d.throwWith(vx * 0.5, Math.abs(vy) * 0.5 + 200);
  }
});
canvas.addEventListener('pointercancel', () => { drag = null; });

let hintTimer = setTimeout(() => $('hint').dataset.show = '1', 1400);
function hideHint() {
  clearTimeout(hintTimer);
  $('hint').dataset.show = '0';
}

// ---- loop ----

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  const t = theme();
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);

  state.surface.step(dt);
  beginFrame();

  for (const d of state.dice) {
    const wasSettled = d.settled;
    d.step(dt, state.bounds);
    if (!wasSettled && d.settled) state.surface.impact(d.x, d.y, d.size);
  }

  // Spin-in-place dice never move, so the grid spacing already holds — running
  // O(n^2) separation over 100+ of them every frame would be pure waste.
  if (state.dice.length > 1 && state.dice.length <= THROW_LIMIT) {
    separate(state.dice, state.bounds);
  }

  // Contact marks sit under the dice, so they draw first.
  state.surface.drawRests(ctx, t, state.dice);
  state.surface.draw(ctx, t);
  for (const d of state.dice) d.draw(ctx, t);

  requestAnimationFrame(frame);
}

resize();
updateThemeColor();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
