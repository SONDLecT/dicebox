import { roll, describe, DCC_CHAIN, stepChain } from './dice.js';
import { Die, Surface, separate } from './render.js';

const $ = id => document.getElementById(id);
const canvas = $('tray');
const ctx = canvas.getContext('2d');

const QUICK = [2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 30, 100];

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

  // Beyond a couple dozen dice, individual tumbling animations stop being
  // readable and just cost frames — show the numbers immediately instead.
  const animate = flat.length > 0 && flat.length <= 24;

  state.dice = flat.map(f => new Die(f.sides, f.value, 0, 0, 40));
  placeGrid(state.dice);

  if (animate) {
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
  } else {
    for (const d of state.dice) { d.settled = true; d.settling = true; d.settleT = 1; }
    finish(result);
  }

  if (navigator.vibrate) navigator.vibrate(animate ? [8, 40, 12] : 10);
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

$('countUp').addEventListener('click', () => setCount(state.count + 1));
$('countDown').addEventListener('click', () => setCount(state.count - 1));
function setCount(n) {
  state.count = Math.max(1, Math.min(99, n));
  $('count').textContent = String(state.count);
}

const diceButtons = $('diceButtons');
for (const sides of QUICK) {
  const b = document.createElement('button');
  b.className = 'dbtn';
  b.type = 'button';
  b.textContent = `d${sides}`;
  b.addEventListener('click', () => doRoll(`${state.count}d${sides}`));
  diceButtons.append(b);
}

const rungs = $('rungs');
for (const sides of DCC_CHAIN) {
  const b = document.createElement('button');
  b.className = 'rung';
  b.type = 'button';
  b.textContent = `d${sides}`;
  b.setAttribute('aria-pressed', String(sides === state.chainSides));
  b.addEventListener('click', () => setChain(sides, true));
  rungs.append(b);
}

function setChain(sides, alsoRoll) {
  state.chainSides = sides;
  [...rungs.children].forEach((b, i) => {
    b.setAttribute('aria-pressed', String(DCC_CHAIN[i] === sides));
  });
  const active = rungs.children[DCC_CHAIN.indexOf(sides)];
  active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  if (alsoRoll) doRoll(`${state.count}d${sides}`);
}

$('chainUp').addEventListener('click', () => setChain(stepChain(state.chainSides, 1), true));
$('chainDown').addEventListener('click', () => setChain(stepChain(state.chainSides, -1), true));

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

  // A flick re-rolls whatever is already loaded; a tap with nothing loaded
  // falls back to the current chain die so the tray is never a dead surface.
  if (speed > 120 || state.last) {
    doRoll(state.last ? state.last.notation : `${state.count}d${state.chainSides}`);
    if (speed > 120) {
      for (const d of state.dice) d.throwWith(vx * 0.5, Math.abs(vy) * 0.5 + 200);
    }
  } else {
    doRoll(`${state.count}d${state.chainSides}`);
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
  state.surface.draw(ctx, t, state.bounds);

  for (const d of state.dice) {
    const wasSettled = d.settled;
    d.step(dt, state.bounds);
    if (!wasSettled && d.settled) state.surface.impact(d.x, d.y);
  }

  if (state.dice.length > 1) separate(state.dice, state.bounds);
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
