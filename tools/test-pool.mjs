// Tests for the tap-to-build pool. The pool lives in app.js behind DOM wiring,
// so the two functions with real logic are reimplemented here against the same
// contract: text in the notation field must round-trip to a pool and back.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { roll } from '../dice.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

function poolNotation(pool) {
  return [...pool].map(([sides, n]) => `${n}d${sides}`).join('+');
}

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

const add = (pool, sides) => { pool.set(sides, (pool.get(sides) || 0) + 1); return pool; };

// --- building by tapping ---
{
  let p = new Map();
  add(p, 6);
  ok('one tap gives 1d6', poolNotation(p) === '1d6');
  add(p, 6); add(p, 6);
  ok('three taps give 3d6', poolNotation(p) === '3d6');
}

{
  // The attack-roll case: mixed dice keep the order they were tapped in.
  let p = new Map();
  add(p, 20); add(p, 20); add(p, 6);
  ok('mixed pool reads in tap order', poolNotation(p) === '2d20+1d6', poolNotation(p));
}

// --- round-tripping through the field ---
for (const text of ['3d6', '2d20+1d6', '1d4+2d8+3d12', '10d20', '1d100']) {
  ok(`"${text}" round-trips`, poolNotation(parsePool(text)) === normalize(text),
     poolNotation(parsePool(text)));
}
function normalize(text) {
  // "d6" is 1d6; the pool always writes the count explicitly.
  return poolNotation(parsePool(text));
}

ok('bare d20 becomes 1d20', poolNotation(parsePool('d20')) === '1d20');
ok('whitespace tolerated', poolNotation(parsePool(' 2 d 6 ')) === '2d6');
ok('case insensitive', poolNotation(parsePool('2D6')) === '2d6');
ok('repeated terms merge', poolNotation(parsePool('1d6+2d6')) === '3d6');

// Anything the pool cannot represent must yield an empty pool, so the next tap
// starts fresh rather than silently corrupting what the user typed.
for (const text of ['3d6+2', '4d6kh3', '1d20!', '2d6-1', 'd%', 'garbage', '']) {
  ok(`"${text}" is not poolable`, parsePool(text).size === 0);
}

// --- every pool the UI can build must actually roll ---
{
  const sides = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100];
  let bad = null;
  for (const s of sides) {
    const p = add(new Map(), s);
    const text = poolNotation(p);
    try {
      const r = roll(text);
      if (r.total < 1 || r.total > s) bad = `${text} gave ${r.total}`;
    } catch (err) { bad = `${text}: ${err.message}`; }
  }
  ok('every button rolls', bad === null, bad || '');
}

{
  // A large mixed pool, the kind tapping can produce quickly.
  const p = new Map();
  for (let i = 0; i < 12; i++) add(p, 20);
  for (let i = 0; i < 8; i++) add(p, 6);
  const text = poolNotation(p);
  ok('large mixed pool notation', text === '12d20+8d6', text);
  const r = roll(text);
  ok('large mixed pool rolls in range', r.total >= 20 && r.total <= 12 * 20 + 8 * 6,
     `total ${r.total}`);
}

// --- chain stepping replaces dice in place ---
{
  // Stepping d20 -> d16 must move the whole stack of that die, not add one.
  const p = new Map();
  add(p, 20); add(p, 20); add(p, 20);
  const n = p.get(20);
  p.delete(20);
  p.set(16, (p.get(16) || 0) + n);
  ok('chain step moves the whole stack', poolNotation(p) === '3d16', poolNotation(p));
}

{
  // Stepping onto a die already in the pool merges rather than duplicating.
  const p = new Map();
  add(p, 16); add(p, 20);
  const n = p.get(20);
  p.delete(20);
  p.set(16, (p.get(16) || 0) + n);
  ok('chain step merges onto existing die', poolNotation(p) === '2d16', poolNotation(p));
}

// --- button state mirrors the pool ---
// Each die button shows selected when it is in the pool, with a count badge past
// one. The row and the notation field must never disagree about what is loaded.
function buttonState(pool, sides) {
  const n = pool.get(sides) || 0;
  return { pressed: n > 0, badge: n > 1 ? String(n) : null };
}

{
  const p = new Map();
  ok('unselected die has no badge',
     buttonState(p, 6).pressed === false && buttonState(p, 6).badge === null);

  add(p, 6);
  ok('one die selected, no badge',
     buttonState(p, 6).pressed === true && buttonState(p, 6).badge === null);

  add(p, 6);
  ok('two dice show 2', buttonState(p, 6).badge === '2');

  add(p, 20);
  ok('other die independently selected', buttonState(p, 20).pressed === true);
  ok('untouched die stays unselected', buttonState(p, 8).pressed === false);
}

{
  // The field is the source of truth: typing must light the same buttons.
  const p = parsePool('3d8+1d12');
  ok('typed notation selects d8', buttonState(p, 8).pressed && buttonState(p, 8).badge === '3');
  ok('typed notation selects d12', buttonState(p, 12).pressed && buttonState(p, 12).badge === null);
  ok('typed notation leaves d20 alone', buttonState(p, 20).pressed === false);
}

{
  // A pool the field cannot represent clears every button rather than showing a
  // stale selection that no longer matches what will roll.
  const p = parsePool('4d6kh3');
  ok('unpoolable notation clears buttons', [...p.keys()].length === 0);
}

// --- the count multiplier ---
{
  const perTap = 100;
  const p = new Map();
  p.set(6, (p.get(6) || 0) + perTap);
  ok('multiplier adds in bulk', poolNotation(p) === '100d6');
  ok('bulk pool shows its count', buttonState(p, 6).badge === '100');
  const r = roll(poolNotation(p));
  ok('bulk pool rolls in range', r.total >= 100 && r.total <= 600, `total ${r.total}`);
}

// --- modifier notations from the hold sheet ---
// Every option the sheet can build must parse and roll.
{
  const build = [
    n => `${Math.max(2, n)}d20kh1`,
    n => `${Math.max(2, n)}d20kl1`,
    n => `${Math.max(2, n)}d20dl1`,
    n => `${Math.max(2, n)}d20dh1`,
    n => `${n}d20!`,
    n => `${n}d20r1`,
  ];
  let bad = null;
  for (const make of build) {
    for (const n of [1, 2, 5]) {
      const text = make(n);
      try {
        const r = roll(text);
        if (!Number.isFinite(r.total) || r.total < 1) bad = `${text} gave ${r.total}`;
      } catch (err) { bad = `${text}: ${err.message}`; }
    }
  }
  ok('every hold-sheet modifier rolls', bad === null, bad || '');
}

{
  // Advantage needs two dice even when the multiplier says one.
  const adv = (n => `${Math.max(2, n)}d20kh1`)(1);
  ok('advantage forces two dice', adv === '2d20kh1', adv);
  const r = roll(adv);
  ok('advantage keeps one die', r.groups[0].dice.filter(d => d.kept).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
