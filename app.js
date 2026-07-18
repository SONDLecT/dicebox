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

// With nothing stored the page follows the system setting, and keeps following
// it if that changes. Choosing a theme pins it until it is cleared.
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'dark') return true;
  if (pinned === 'light') return false;
  return systemDark.matches;
}

const stored = localStorage.getItem('dicebox:theme');
if (stored === 'dark' || stored === 'light') document.documentElement.dataset.theme = stored;
syncThemeLabel();

$('themeToggle').addEventListener('click', () => {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
  localStorage.setItem('dicebox:theme', document.documentElement.dataset.theme);
  syncThemeLabel();
  updateThemeColor();
});

systemDark.addEventListener('change', () => {
  if (document.documentElement.dataset.theme) return; // pinned by choice
  syncThemeLabel();
  updateThemeColor();
});

// The button shows the theme you are in and switches to the other one, so the
// label has to describe the destination rather than the icon.
function syncThemeLabel() {
  const dark = isDark();
  $('themeToggle').dataset.mode = dark ? 'dark' : 'light';
  $('themeToggle').setAttribute('aria-label',
    dark ? 'Switch to light theme' : 'Switch to dark theme');
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

// Below this, dice keep the order they were rolled in. A handful small enough to
// read at a glance does not need sorting, and the scatter of dice arriving in
// whatever slot they reach looks better than a filing cabinet.
const TIDY_THRESHOLD = 8;

// The order dice come to rest in: the way you would tidy a handful on a table —
// all the d6s together, all the d20s together, each group ordered high to low,
// and the dropped dice pushed to the end of their group.
function tidyOrder(dice) {
  if (dice.length < TIDY_THRESHOLD) return dice;

  const groupOrder = [];
  for (const d of dice) if (!groupOrder.includes(d.sides)) groupOrder.push(d.sides);
  groupOrder.sort((a, b) => a - b);

  return dice.slice().sort((a, b) => {
    const byType = groupOrder.indexOf(a.sides) - groupOrder.indexOf(b.sides);
    if (byType) return byType;
    // Dice that did not count sit at the end of their own group.
    const aKept = a.kept === false ? 1 : 0;
    const bKept = b.kept === false ? 1 : 0;
    if (aKept !== bKept) return aKept - bKept;
    return (b.value ?? 0) - (a.value ?? 0);
  });
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

  // Slots are assigned in tidy order rather than roll order, so the drift toward
  // the grid also sorts the dice — the same thing a hand does after a throw.
  tidyOrder(dice).forEach((d, i) => {
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
    for (const d of g.dice) {
      flat.push({
        sides: g.sides,
        value: d.value,
        // Carried onto the tray so a die can show what happened to it: dropped
        // dice fade, exploded and rerolled ones get a mark.
        kept: d.kept,
        exploded: d.exploded,
        rerolled: d.rerolled,
      });
    }
  }

  state.dice = flat.map(f => {
    const die = new Die(f.sides, f.value, 0, 0, 40);
    die.kept = f.kept;
    die.exploded = f.exploded;
    die.rerolled = f.rerolled;
    return die;
  });
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
  // The name has done its job by the first roll; let the tray have the page.
  $('wordmark').dataset.faded = '1';
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
// Typing is another way of staging dice, so the tray follows the field as it is
// edited: backspace away "+2d3" and those dice leave the tray immediately.
$('notation').addEventListener('input', () => {
  pool = parsePool($('notation').value);
  // Typing an unusual die earns it a button too, so the row always accounts for
  // everything in the pool.
  for (const sides of pool.keys()) {
    if (sides >= 1 && sides <= MAX_SIDES) ensureDieButton(sides);
  }
  stageFromPool({ writeField: false });
});

// ---- help ----

const help = $('help');
const helpToggle = $('helpToggle');

function setHelp(open) {
  if (open) { closeSheet(); closeDial(); }
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

// sides -> { count, mods }. Insertion order is preserved, so the notation reads
// back in the order the dice were tapped.
//
// `mods` holds one suffix per slot. Modifiers in different slots stack — 4d6dl1!
// drops the lowest *and* explodes — while two in the same slot replace each
// other, because "keep the highest" and "drop the lowest" both answer the same
// question and cannot both apply.
const SLOTS = ['keep', 'burst', 'reroll'];

const SLOT_OF = [
  [/^(kh|kl|dh|dl)/, 'keep'],
  [/^!/, 'burst'],
  [/^r/, 'reroll'],
];

function slotFor(suffix) {
  for (const [pattern, slot] of SLOT_OF) if (pattern.test(suffix)) return slot;
  return 'keep';
}

// The roller expects keep/drop before the explode and reroll flags.
const entryNotation = (sides, { count, mods }) =>
  `${count}d${sides}` + SLOTS.map(s => (mods && mods[s]) || '').join('');

let pool = new Map();

function poolNotation() {
  return [...pool].map(([sides, e]) => entryNotation(sides, e)).join('+');
}

function addToPool(sides, count = 1) {
  // Typing in the field and then tapping a die should extend what is there, not
  // silently discard it. Anything unparseable is replaced instead.
  if (!poolMatchesField()) {
    pool = parsePool($('notation').value);
  }
  const cur = pool.get(sides) || { count: 0, mods: {} };
  pool.set(sides, { count: cur.count + count, mods: cur.mods });
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
    // Modifiers may appear in any order and more than one may apply, so they are
    // read one at a time rather than matched as a single optional group.
    const head = /^(\d*)d(\d+)/.exec(term);
    if (!head) return new Map();
    const n = head[1] === '' ? 1 : parseInt(head[1], 10);
    const sides = parseInt(head[2], 10);
    if (!sides) return new Map();

    const mods = {};
    let rest = term.slice(head[0].length);
    while (rest) {
      const mod = /^((?:kh|kl|dh|dl)\d+|!|r\d+)/.exec(rest);
      if (!mod) return new Map(); // trailing junk: not a pool the row can show
      const slot = slotFor(mod[1]);
      if (mods[slot]) return new Map(); // two in one slot cannot both apply
      mods[slot] = mod[1];
      rest = rest.slice(mod[0].length);
    }

    const cur = next.get(sides);
    // Two groups of the same die with different modifiers can't merge into one
    // entry, so the pool declines to represent it rather than losing one.
    if (cur && SLOTS.some(s => (cur.mods[s] || '') !== (mods[s] || ''))) return new Map();
    next.set(sides, { count: (cur ? cur.count : 0) + n, mods });
  }
  return next;
}

// Show the pool as unrolled dice waiting on the tray, so tapping summons the
// dice you are about to throw rather than only changing text.
function syncPool() {
  stageFromPool({ writeField: true });
}

// Put the pool on the tray as unrolled dice. `writeField` is false when the pool
// came *from* the field, so typing is never overwritten mid-edit — the tray
// follows what you type rather than fighting it.
function stageFromPool({ writeField }) {
  const notation = poolNotation();
  if (writeField) $('notation').value = notation;
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
    d.homeX = d.x;
    d.homeY = d.y;
  }

  $('total').dataset.idle = '1';
  $('total').textContent = '—';
  $('breakdown').textContent = staged.length
    ? `${staged.length} ${staged.length === 1 ? 'die' : 'dice'} ready`
    : 'Pick dice or type a roll';
  markPool();
  hideHint();
}

// Mirror the pool onto the buttons: a die in the tray reads as selected, and its
// count shows on the button. The pool is then visible where you are already
// looking, instead of only in the notation field.
function markPool() {
  for (const b of diceButtons.children) {
    // The custom-die button opens a picker rather than standing for a die, so
    // it never carries pool state.
    if (!b.dataset.sides) continue;
    const entry = pool.get(Number(b.dataset.sides));
    const n = entry ? entry.count : 0;
    b.setAttribute('aria-pressed', String(n > 0));
    if (n > 1) b.dataset.count = String(n);
    else delete b.dataset.count;
    // Each modifier gets its own glyph, and stacked ones sit side by side. One
    // shared underline told you a die was modified but not how.
    const glyphs = entry
      ? SLOTS.filter(s => entry.mods && entry.mods[s]).map(s => modifierGlyph(entry.mods[s]))
      : [];
    if (glyphs.length) {
      b.dataset.mod = glyphs.map(g => g.mark).join('');
      b.title = `d${b.dataset.sides} — ${glyphs.map(g => g.label).join(', ')}`;
    } else {
      delete b.dataset.mod;
      b.removeAttribute('title');
    }
  }
}

// Marks shown on a die button, chosen to say which modifier without a legend:
// arrows point the way the kept die goes, a burst means exploding, a cycle means
// reroll. Drop shares the arrow but points at what leaves.
const MODIFIER_GLYPHS = [
  [/^kh/, { mark: '▲', label: 'advantage — keep highest' }],
  [/^kl/, { mark: '▼', label: 'disadvantage — keep lowest' }],
  [/^dl/, { mark: '⌃', label: 'drop lowest' }],
  [/^dh/, { mark: '⌄', label: 'drop highest' }],
  [/^!/,  { mark: '✳', label: 'exploding' }],
  [/^r/,  { mark: '↻', label: 'reroll' }],
];

function modifierGlyph(mod) {
  for (const [pattern, glyph] of MODIFIER_GLYPHS) {
    if (pattern.test(mod)) return glyph;
  }
  return { mark: '•', label: mod };
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
  diceButtons.append(makeDieButton(sides));
}

function makeDieButton(sides) {
  const b = document.createElement('button');
  b.className = 'dbtn';
  b.type = 'button';
  b.dataset.sides = String(sides);

  // The hold-fill is its own element: ::before carries the modifier glyph and
  // ::after the count, so a pseudo-element here would collide with one of them.
  const fill = document.createElement('span');
  fill.className = 'dbtn-fill';
  b.append(fill, document.createTextNode(`d${sides}`));
  b.addEventListener('click', () => addToPool(sides, perTap()));
  attachModifierSheet(b, sides);
  return b;
}

// A die made with the custom picker earns a button of its own, in size order,
// so it behaves like every other die — tappable, countable, and holdable for
// modifiers. Without one a d46 could be staged but never modified.
function ensureDieButton(sides) {
  const existing = [...diceButtons.children]
    .find(b => Number(b.dataset.sides) === sides);
  if (existing) return existing;

  const button = makeDieButton(sides);
  button.dataset.custom = '1';

  const after = [...diceButtons.children]
    .find(b => b.dataset.sides && Number(b.dataset.sides) > sides);
  diceButtons.insertBefore(button, after || null);
  return button;
}

// ---- custom die ----
//
// A scroll wheel, the way a phone's timer picker works: flick through the
// numbers and one snaps under the marker. Scroll-snap does the physics, so
// there is no momentum code to write and it feels native on both platforms.
// The field beside it is for jumping straight to a number like 57.

const MAX_SIDES = 1000;
const dial = $('dial');
const wheel = $('wheel');
const dialInput = $('dialInput');

for (let n = 1; n <= MAX_SIDES; n++) {
  const item = document.createElement('div');
  item.className = 'wheel-item';
  item.dataset.value = String(n);
  item.textContent = `d${n}`;
  item.setAttribute('role', 'option');
  wheel.append(item);
}

const wheelItem = n => wheel.children[n - 1];

function dialValue() {
  const n = parseInt(dialInput.value, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_SIDES) : 20;
}

function centreWheel(n, smooth = false) {
  const item = wheelItem(n);
  if (!item) return;
  wheel.scrollTo({
    top: item.offsetTop - (wheel.clientHeight - item.offsetHeight) / 2,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

function setDial(n, { scroll = true, focusField = false } = {}) {
  const value = Math.max(1, Math.min(MAX_SIDES, n));
  dialInput.value = String(value);
  for (const item of wheel.children) {
    item.setAttribute('aria-selected', String(Number(item.dataset.value) === value));
  }
  if (scroll) centreWheel(value);
  if (focusField) dialInput.select();
}

// Read back whichever item settled under the marker.
let wheelSettle = null;
wheel.addEventListener('scroll', () => {
  clearTimeout(wheelSettle);
  wheelSettle = setTimeout(() => {
    const middle = wheel.scrollTop + wheel.clientHeight / 2;
    let closest = 1, best = Infinity;
    for (const item of wheel.children) {
      const d = Math.abs(item.offsetTop + item.offsetHeight / 2 - middle);
      if (d < best) { best = d; closest = Number(item.dataset.value); }
    }
    setDial(closest, { scroll: false });
  }, 90);
});

wheel.addEventListener('click', e => {
  const item = e.target.closest('.wheel-item');
  if (item) setDial(Number(item.dataset.value));
});

wheel.addEventListener('keydown', e => {
  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1
             : e.key === 'PageUp' ? -10 : e.key === 'PageDown' ? 10 : 0;
  if (!step) return;
  e.preventDefault();
  setDial(dialValue() + step);
});

dialInput.addEventListener('input', () => {
  const n = parseInt(dialInput.value, 10);
  if (Number.isFinite(n) && n >= 1 && n <= MAX_SIDES) setDial(n, { scroll: true });
});
dialInput.addEventListener('focus', () => dialInput.select());

function openDial() {
  setHelp(false);
  closeSheet();
  dial.hidden = false;
  setDial(dialValue());
  hideHint();
}

function closeDial() { dial.hidden = true; }

$('customDie').addEventListener('click', openDial);
$('dialClose').addEventListener('click', closeDial);
$('dialAdd').addEventListener('click', () => {
  const sides = dialValue();
  closeDial();
  const button = ensureDieButton(sides);
  addToPool(sides, perTap());
  button.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
});

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

// Modifiers in different slots stack; one already active toggles back off.
function applyModifier(sides, mod) {
  if (!poolMatchesField()) pool = parsePool($('notation').value);

  const cur = pool.get(sides);
  const mods = { ...(cur ? cur.mods : {}) };

  if (!mod.suffix) {
    // "No modifier" clears everything but keeps the dice.
    for (const slot of SLOTS) delete mods[slot];
  } else {
    const slot = slotFor(mod.suffix);
    if (mods[slot] === mod.suffix) delete mods[slot];  // tapping it again removes it
    else mods[slot] = mod.suffix;
  }

  pool.set(sides, { count: modifierCount(sides, mod), mods });
  syncPool();
}

function openSheet(sides) {
  // All three fill the tray, so only one can be up at a time.
  setHelp(false);
  closeDial();
  $('sheetTitle').textContent = `d${sides}`;
  sheetOptions.replaceChildren();

  const current = pool.get(sides);

  for (const mod of modifiersFor(sides)) {
    const active = current ? current.mods || {} : {};
    const slot = mod.suffix ? slotFor(mod.suffix) : null;
    const isOn = Boolean(mod.suffix) && active[slot] === mod.suffix;
    // Something else already answers this question — "keep the highest" and
    // "drop the lowest" cannot both apply — so it is shown as unavailable
    // rather than silently replacing what is there.
    const blocked = Boolean(slot) && Boolean(active[slot]) && !isOn;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-option';
    if (isOn) b.setAttribute('aria-pressed', 'true');
    if (blocked) {
      b.disabled = true;
      b.dataset.blocked = '1';
    }

    const name = document.createElement('span');
    name.className = 'sheet-option-name';
    // Lead with the same glyph the die button will show, so the mark on the row
    // is learnable rather than a code to decipher.
    if (mod.suffix) {
      const mark = document.createElement('span');
      mark.className = 'sheet-option-mark';
      mark.textContent = modifierGlyph(mod.suffix).mark;
      name.append(mark);
    }
    name.append(mod.label);

    // Preview exactly what will be staged, including whatever is already on the
    // die, so stacking is visible before it is committed.
    const preview = { ...active };
    if (mod.suffix) {
      if (isOn) delete preview[slot];
      else preview[slot] = mod.suffix;
    } else {
      for (const s of SLOTS) delete preview[s];
    }

    const notation = document.createElement('span');
    notation.className = 'sheet-option-notation';
    notation.textContent = blocked
      ? '—'
      : entryNotation(sides, { count: modifierCount(sides, mod), mods: preview });

    const hint = document.createElement('span');
    hint.className = 'sheet-option-hint';
    hint.textContent = blocked
      ? `already ${modifierGlyph(active[slot]).label}`
      : isOn ? 'tap to remove' : mod.hint;

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
  if (e.key !== 'Escape') return;
  if (!sheet.hidden) closeSheet();
  if (!dial.hidden) closeDial();
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
  const travelled = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  drag = null;

  // Tapping a staged die takes it back off the tray, which is how you drop one
  // die from a handful without clearing everything or editing the text.
  if (speed < 120 && travelled < 10 && removeDieAt(e.clientX, e.clientY)) return;

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

// Remove one staged die under the given screen point. Only staged dice can be
// picked off: once a roll has happened the numbers are a result, not a pool, and
// quietly editing them would be lying about what was rolled.
function removeDieAt(clientX, clientY) {
  if (!state.dice.length || state.dice.some(d => d.value !== null)) return false;

  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  let hit = null, best = Infinity;
  for (const d of state.dice) {
    const dist = Math.hypot(d.x - x, d.y - y);
    if (dist < d.size * 0.62 && dist < best) { best = dist; hit = d; }
  }
  if (!hit) return false;

  const entry = pool.get(hit.sides);
  if (!entry) return false;

  if (entry.count > 1) pool.set(hit.sides, { count: entry.count - 1, mods: entry.mods });
  else pool.delete(hit.sides);

  if (navigator.vibrate) navigator.vibrate(8);
  syncPool();
  return true;
}
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

// ---- install ----
//
// Chrome and Edge fire beforeinstallprompt and let the page trigger the install
// flow. Safari never does, so iOS gets the manual route spelled out instead of a
// button that cannot work.

let installEvent = null;
const installButton = $('install');
const installHint = $('installHint');

const standalone = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  if (standalone) return;
  installButton.hidden = false;
  installHint.textContent = 'Works offline once installed.';
});

installButton.addEventListener('click', async () => {
  if (!installEvent) return;
  installButton.disabled = true;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  if (outcome === 'accepted') {
    installButton.hidden = true;
    installHint.textContent = 'Installed. It works offline from here.';
  } else {
    installButton.disabled = false;
  }
});

window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  installHint.textContent = 'Installed. It works offline from here.';
});

if (standalone) {
  installHint.textContent = 'Running as an app. Rolls work offline.';
} else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
  // Safari offers no install API, so name the actual menu items.
  installHint.textContent = 'To install: tap Share, then Add to Home Screen. It works offline.';
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
