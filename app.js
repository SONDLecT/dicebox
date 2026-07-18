import { roll, describe } from './dice.js';
import { Die, Surface, separate, beginFrame } from './render.js';

const $ = id => document.getElementById(id);
const canvas = $('tray');
const ctx = canvas.getContext('2d');

// One row of dice, ordered by size: the standard RPG set plus every Dungeon
// Crawl Classics chain rung, plus d100. Gaps like d9 and d11 are deliberate —
// no published system uses them, and the notation field covers anything here.
const QUICK = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100];

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
  // What a tap on an empty tray rolls, when nothing is staged.
  defaultSides: 20,
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

// After a resize the previous positions may be off-screen, so re-place the dice.
//
// This must lay out the whole tray, not just the dice that have already come to
// rest. Gridding a subset computes rows, columns and size for that smaller
// count, so mid-roll the settled dice were re-placed into a layout meant for
// fewer dice — landing on top of the ones still in flight, at a different size.
// Dice in flight keep their target slot updated so they arrive in the right
// place; dice at rest move immediately.
function layoutSettled() {
  if (!state.dice.length) return;

  // Compute slots for the whole tray, then apply them without teleporting dice
  // that are still in flight — those get their destination updated instead.
  const flying = state.dice.map(d => ({
    d, inFlight: !d.settled && d.homeX !== undefined,
    x: d.x, y: d.y,
  }));

  placeGrid(state.dice);

  for (const f of flying) {
    if (!f.inFlight) continue;
    f.d.homeX = f.d.x;
    f.d.homeY = f.d.y;
    f.d.x = f.x;
    f.d.y = f.y;
  }
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

// Typing keeps the buttons in step, so the field and the row never disagree
// about what is loaded.
$('notation').addEventListener('input', () => {
  pool = parsePool($('notation').value);
  markPool();
});

// ---- help ----

const help = $('help');
const helpToggle = $('helpToggle');

function setHelp(open) {
  if (open) closeSheet();
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

// sides -> { count, mod }. Insertion order is preserved, so the notation reads
// back in the order the dice were tapped. `mod` is a notation suffix like "kh1"
// that applies to that die's group only, leaving the rest of the pool alone.
let pool = new Map();

const entryNotation = (sides, { count, mod }) => `${count}d${sides}${mod || ''}`;

function poolNotation() {
  return [...pool].map(([sides, e]) => entryNotation(sides, e)).join('+');
}

function addToPool(sides, count = 1) {
  // Typing in the field and then tapping a die should extend what is there, not
  // silently discard it. Anything unparseable is replaced instead.
  if (!poolMatchesField()) {
    pool = parsePool($('notation').value);
  }
  const cur = pool.get(sides) || { count: 0, mod: '' };
  pool.set(sides, { count: cur.count + count, mod: cur.mod });
  syncPool();
}

function poolMatchesField() {
  return $('notation').value.trim().toLowerCase() === poolNotation().toLowerCase();
}

// Recover a pool from NdM notation, including per-group modifiers, so a staged
// roll survives a round trip through the text field. Arithmetic terms (+2, -1)
// and subtraction can't be represented, so those roll fine but start a fresh
// pool on the next tap.
function parsePool(text) {
  const next = new Map();
  const src = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (!src) return next;
  for (const term of src.split('+')) {
    const m = /^(\d*)d(\d+)((?:kh|kl|dh|dl)\d+|!|r\d+)?$/.exec(term);
    if (!m) return new Map();
    const n = m[1] === '' ? 1 : parseInt(m[1], 10);
    const sides = parseInt(m[2], 10);
    const mod = m[3] || '';
    if (!sides) return new Map();
    const cur = next.get(sides);
    // Two groups of the same die with different modifiers can't merge into one
    // entry, so the pool declines to represent it rather than losing one.
    if (cur && cur.mod !== mod) return new Map();
    next.set(sides, { count: (cur ? cur.count : 0) + n, mod });
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
  for (const [sides, entry] of pool) {
    for (let i = 0; i < entry.count; i++) staged.push(new Die(sides, null, 0, 0, 40));
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
  markPool();
  hideHint();
}

// Mirror the pool onto the buttons: a die in the tray reads as selected, and its
// count shows on the button. The pool is then visible where you are already
// looking, instead of only in the notation field.
function markPool() {
  for (const b of diceButtons.children) {
    const entry = pool.get(Number(b.dataset.sides));
    const n = entry ? entry.count : 0;
    b.setAttribute('aria-pressed', String(n > 0));
    if (n > 1) b.dataset.count = String(n);
    else delete b.dataset.count;
    // A die carrying a modifier is marked, so kh1/dl1 is visible on the row
    // instead of only in the notation.
    if (entry && entry.mod) b.dataset.mod = '1';
    else delete b.dataset.mod;
  }
}

function clearPool() {
  pool = new Map();
  state.dice = [];
  $('notation').value = '';
  $('total').dataset.idle = '1';
  $('total').textContent = '—';
  $('breakdown').textContent = 'Pick dice or type a roll';
  markPool();
  clearError();
}

$('clear').addEventListener('click', () => {
  clearPool();
  $('notation').focus();
});

// ---- how many per tap ----

const countField = $('count');

function perTap() {
  const n = parseInt(countField.value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 1;
}

function setPerTap(n) {
  countField.value = String(Math.max(1, Math.min(500, n)));
}

$('countUp').addEventListener('click', () => setPerTap(perTap() + 1));
$('countDown').addEventListener('click', () => setPerTap(perTap() - 1));
countField.addEventListener('change', () => setPerTap(perTap()));
countField.addEventListener('focus', () => countField.select());

// ---- dice buttons ----

for (const sides of QUICK) {
  const b = document.createElement('button');
  b.className = 'dbtn';
  b.type = 'button';
  b.textContent = `d${sides}`;
  b.dataset.sides = String(sides);
  b.addEventListener('click', () => addToPool(sides, perTap()));
  attachModifierSheet(b, sides);
  diceButtons.append(b);
}

// ---- modifier sheet ----
//
// Long-press (or right-click) a die for the modifiers that would otherwise need
// typing. Everything the notation supports is reachable without the text field,
// but none of it takes up space until it is asked for.

const sheet = $('sheet');
const sheetOptions = $('sheetOptions');

function modifiersFor(sides) {
  const mods = [];
  if (sides >= 4) {
    mods.push(
      { label: 'Advantage', suffix: 'kh1', hint: 'roll two, keep the best', min: 2 },
      { label: 'Disadvantage', suffix: 'kl1', hint: 'roll two, keep the worst', min: 2 },
    );
  }
  mods.push(
    { label: 'Drop lowest', suffix: 'dl1', hint: 'discard the worst die', min: 2 },
    { label: 'Drop highest', suffix: 'dh1', hint: 'discard the best die', min: 2 },
  );
  if (sides > 1) {
    mods.push(
      { label: 'Exploding', suffix: '!', hint: `reroll and add on a ${sides}`, min: 1 },
      { label: 'Reroll 1s', suffix: 'r1', hint: 'reroll any 1', min: 1 },
    );
  }
  mods.push({ label: 'No modifier', suffix: '', hint: 'roll these dice plainly', min: 1 });
  return mods;
}

// How many of this die a modifier would apply to: whatever is already staged,
// or one tap's worth if none are. Keep/drop needs at least two dice to mean
// anything, so those raise the count rather than silently doing nothing.
function modifierCount(sides, mod) {
  const staged = pool.get(sides);
  const base = staged ? staged.count : perTap();
  return Math.max(mod.min, base);
}

function applyModifier(sides, mod) {
  if (!poolMatchesField()) pool = parsePool($('notation').value);
  pool.set(sides, { count: modifierCount(sides, mod), mod: mod.suffix });
  syncPool();
}

function openSheet(sides) {
  // Both fill the tray, so only one can be up at a time.
  setHelp(false);
  $('sheetTitle').textContent = `d${sides}`;
  sheetOptions.replaceChildren();

  const current = pool.get(sides);

  for (const mod of modifiersFor(sides)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-option';
    // Mark the modifier already on this die, so the sheet shows state rather
    // than only offering actions.
    if (current && (current.mod || '') === mod.suffix) {
      b.setAttribute('aria-pressed', 'true');
    }

    const name = document.createElement('span');
    name.className = 'sheet-option-name';
    name.textContent = mod.label;

    const notation = document.createElement('span');
    notation.className = 'sheet-option-notation';
    // Preview exactly what will be staged, using the dice already on the tray.
    notation.textContent = `${modifierCount(sides, mod)}d${sides}${mod.suffix}`;

    const hint = document.createElement('span');
    hint.className = 'sheet-option-hint';
    hint.textContent = mod.hint;

    b.append(name, notation, hint);
    // The modifier attaches to this die's group and leaves the rest of the pool
    // alone, so picking advantage on a d6 does not disturb a staged d20. It
    // stages rather than rolls, matching every other way dice get added.
    b.addEventListener('click', () => {
      closeSheet();
      applyModifier(sides, mod);
    });
    sheetOptions.append(b);
  }

  sheet.hidden = false;
  sheetOptions.firstElementChild?.focus();
}

function closeSheet() {
  sheet.hidden = true;
}

$('sheetClose').addEventListener('click', closeSheet);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !sheet.hidden) closeSheet();
});

// Long-press on touch, right-click on desktop — long-press has no mouse
// equivalent, and the feature should not be touch-only.
function attachModifierSheet(button, sides) {
  let timer = null;
  let longPressed = false;

  const start = () => {
    longPressed = false;
    // The fill is the affordance: it shows a hold is doing something, and how
    // much longer to hold. Duration matches the CSS transition.
    button.dataset.holding = '1';
    timer = setTimeout(() => {
      longPressed = true;
      delete button.dataset.holding;
      if (navigator.vibrate) navigator.vibrate(12);
      openSheet(sides);
    }, 450);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    delete button.dataset.holding;
  };

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointerleave', cancel);
  button.addEventListener('pointercancel', cancel);

  // Swallow the click that follows a long press, so it does not also stage dice.
  button.addEventListener('click', e => {
    if (longPressed) { e.preventDefault(); e.stopImmediatePropagation(); longPressed = false; }
  }, true);

  button.addEventListener('contextmenu', e => {
    e.preventDefault();
    cancel();
    openSheet(sides);
  });
}

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
    || `d${state.defaultSides}`;

  doRoll(target);
  if (speed > 120) {
    for (const d of state.dice) d.throwWith(vx * 0.5, Math.abs(vy) * 0.5 + 200);
  }
});
canvas.addEventListener('pointercancel', () => { drag = null; });

// ---- intro ----
//
// Plays once per cold open and clears on the first interaction, whichever comes
// first. It teaches the two things the interface cannot say for itself: that
// taps load dice, and that holding a die offers more.

const intro = $('intro');
let introTimer = setTimeout(hideHint, 3400);
let introGone = false;

function hideHint() {
  if (introGone) return;
  introGone = true;
  clearTimeout(introTimer);
  intro.dataset.gone = '1';
  // Removed rather than left transparent, so it can never eat a tap.
  setTimeout(() => intro.remove(), 800);
}

// ---- loop ----

let prev = performance.now();
let loopFaults = 0;

function drawFrame(dt) {
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
}

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  // The loop must survive a bad frame. Scheduling the next one before drawing —
  // and dropping the dice that faulted — means a rendering bug degrades to a
  // cleared tray instead of freezing the app until a reload, which is what
  // happened when a d1 hit a code path that no longer existed.
  requestAnimationFrame(frame);

  try {
    drawFrame(dt);
    loopFaults = 0;
  } catch (err) {
    loopFaults++;
    console.error('Dicebox: frame failed', err);
    if (loopFaults >= 3) {
      state.dice = [];
      loopFaults = 0;
      showError('Something went wrong drawing that roll. The tray was cleared.');
    }
  }
}

resize();
updateThemeColor();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
