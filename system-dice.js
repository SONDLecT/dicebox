// system-dice.js — non-numeric / special-outcome dice systems.
//
// Per the vetted design doc (Projects/Code/Dicebox System Dice Proposal):
//   * generic at the die level, explicit at the system level;
//   * a die type is { geometrySides, faces:[faceId...], outcomes }, rolled by
//     LOGICAL FACE INDEX, not by glyph;
//   * each system has a small explicit reducer/formatter — no universal total.
//
// V1 implements Vampire the Masquerade V5 (a d10 pool + Hunger dice). Fate /
// Genesys / Star Wars / The One Ring slot in behind the same registry later.

// ---- V5 ----

// v5:POOL[hHUNGER][@DIFFICULTY]   e.g. "v5:8h3" or "v5:8h3@3"
//   pool      total dice rolled (fixed size)
//   hunger    how many of those are Hunger/blood dice (they REPLACE pool dice,
//             they are not added — total pool size stays constant)
//   difficulty (optional) number of successes needed to win
const V5_REGEX = /^v5:(\d+)(?:h(\d+))?(?:@(\d+))?$/;

// A strong uniform integer in [1, sides]. Mirrors dice.js randInt (rejection
// sampling avoids the modulo bias of a naive `% sides`).
function randInt(sides) {
  if (sides <= 1) return 1;
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return (v % sides) + 1;
}

export function detectSystem(src) {
  return /^v5:/.test(String(src || '').trim().toLowerCase()) ? 'v5' : 'numeric';
}

export function parseV5(src) {
  const m = V5_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected V5 pool like "v5:8h3" or "v5:8h3@3"');
  const pool = Number(m[1]);
  const hunger = m[2] === undefined ? 0 : Number(m[2]);
  const difficulty = m[3] === undefined ? null : Number(m[3]);
  if (pool < 1 || pool > 100) throw new Error('V5 pool must be 1-100');
  if (hunger < 0 || hunger > pool) throw new Error('Hunger must be 0 to pool');
  if (difficulty !== null && (difficulty < 1 || difficulty > 10)) {
    throw new Error('Difficulty must be 1-10');
  }
  return { pool, hunger, difficulty };
}

export function rollV5(src) {
  const { pool, hunger, difficulty } = parseV5(src);
  // Hunger dice replace pool dice: the first `hunger` dice are blood dice, the
  // rest are ordinary d10s. `pool` is the fixed total, never pool+hunger.
  const dice = [];
  for (let i = 0; i < pool; i++) {
    dice.push({
      value: randInt(10),
      hunger: i < hunger,
      kept: true, rerolled: false, exploded: false, crit: null,
    });
  }
  return {
    schema: 2,
    system: 'v5',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'v5', count: pool, dice, subtotal: 0 }],
    summary: summarizeV5(dice, difficulty, pool, hunger),
  };
}

// V5 outcome rules
//   * a die is a success on 6-9 (1 success); 10 counts as TWO successes
//   * two dice showing 10 => a critical win
//   * Messy Critical  = critical win where at least one Hunger die shows 10
//   * Bestial Failure = the test fails AND at least one Hunger die shows 1
// Difficulty is needed to resolve win/loss truthfully; when omitted (null) the
// reducer reports successes + intrinsic critical + hunger events but does not
// assert Bestial Failure (it cannot know whether the roll lost).
export function summarizeV5(dice, difficulty, pool = dice.length, hunger = dice.filter(d => d.hunger).length) {
  let successes = 0, tenCount = 0, hungerTen = 0, hungerOne = 0;
  for (const d of dice) {
    const v = d.value;
    if (v >= 6) successes += v === 10 ? 2 : 1;
    if (v === 10) { tenCount++; if (d.hunger) hungerTen++; }
    if (v === 1 && d.hunger) hungerOne++;
  }
  const critTwo = tenCount >= 2;
  const margin = difficulty === null ? null : successes - difficulty;

  let outcome = null;
  if (critTwo && hungerTen > 0) outcome = 'messy-critical';
  else if (critTwo) outcome = 'critical';
  else if (difficulty !== null && margin >= 0) outcome = 'success';
  else if (difficulty !== null && hungerOne > 0) outcome = 'bestial-failure';
  else if (difficulty !== null) outcome = 'failure';

  return {
    kind: 'v5', pool, hunger, difficulty,
    successes, outcome, margin,
    critTwo, hungerTen, hungerOne, tenCount,
  };
}

const OUTCOME_LABEL = {
  'messy-critical': 'Messy Critical',
  critical: 'Critical',
  success: 'Success',
  'bestial-failure': 'Bestial Failure',
  failure: 'Failure',
};

export function describeV5(result) {
  const s = result.summary;
  const parts = [`${s.successes} success${s.successes === 1 ? '' : 'es'}`];
  if (s.outcome && OUTCOME_LABEL[s.outcome]) parts.push(OUTCOME_LABEL[s.outcome]);
  if (s.outcome === 'success' && s.margin !== null) parts.push(`margin +${s.margin}`);
  if (s.critTwo) parts.push('two 10s');
  if (s.hungerTen) parts.push(`Hunger ${s.hungerTen > 1 ? `10 ×${s.hungerTen}` : '10'}`);
  if (s.hungerOne) parts.push(`Hunger ${s.hungerOne > 1 ? `1 ×${s.hungerOne}` : '1'}`);
  return parts.join(' · ');
}

// A compact headline for the big readout: the resolved outcome (or the success
// count when difficulty is unknown), short enough not to overflow the total.
export function v5Headline(result) {
  const s = result.summary;
  if (s.outcome) {
    if (s.outcome === 'success' && s.margin !== null) return `Success (+${s.margin})`;
    return OUTCOME_LABEL[s.outcome] || 'Roll';
  }
  return `${s.successes} success${s.successes === 1 ? '' : 'es'}`;
}

// Dispatcher: an explicit system token in the notation wins; otherwise defer to
// the numeric engine (returned as {system:'numeric', deferred:true}).
export function rollAny(src, uiSystem = 'numeric') {
  const sys = detectSystem(src);
  if (sys === 'v5') return rollV5(src);
  return { system: 'numeric', deferred: true, notation: String(src) };
}

// V5 dice are still uniform d10s (value 1-10); the official dice merely *render*
// each numeric face as a symbol so the outcome is readable without "≥6" math.
// This maps a numeric face back to the symbol that should be drawn on it.
// Regular: 1-5 blank, 6-9 success, 10 critical.
// Hunger:  1 skull, 2-5 blank, 6-9 hunger-success, 10 hunger-critical.
export function v5Face(value, hunger) {
  if (hunger) {
    if (value === 1) return 'skull';
    if (value <= 5) return 'blank';
    if (value < 10) return 'hunger-success';
    return 'hunger-critical';
  }
  if (value <= 5) return 'blank';
  if (value < 10) return 'success';
  return 'critical';
}
