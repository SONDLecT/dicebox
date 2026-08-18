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
// sampling avoids the modulo bias of a naive `% sides`). Exported so the oracle
// engine draws from the same crypto source as the dice.
export function randInt(sides) {
  if (sides <= 1) return 1;
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return (v % sides) + 1;
}

export function detectSystem(src) {
  const s = String(src || '').trim().toLowerCase();
  if (/^v5:/.test(s)) return 'v5';
  if (/^gen:/.test(s)) return 'genesys';
  if (/^dh:/.test(s)) return 'daggerheart';
  if (/^ct:/.test(s)) return 'cthulhutech';
  if (/^yz:/.test(s)) return 'yearzero';
  if (/^br:/.test(s)) return 'bladerunner';
  if (/^t2k:/.test(s)) return 'twilight';
  if (/^sw:/.test(s)) return 'starwars';
  if (/^tor:/.test(s)) return 'onering';
  if (/^pbta:/.test(s)) return 'pbta';
  if (/^mist:/.test(s)) return 'mist';
  if (/^ms:/.test(s)) return 'mothership';
  if (/^coc:/.test(s)) return 'callofcthulhu';
  if (/^dg:/.test(s)) return 'deltagreen';
  if (/^iron:/.test(s)) return 'ironsworn';
  // Oracle table draws (Ironsworn/Starforged) are rolled app-side against the
  // lazy-loaded dataset, so this only tags the notation; rollAny does not roll it.
  if (/^oracle:/.test(s)) return 'oracle';
  if (/^deck:/.test(s)) return 'cards';
  if (/^tarot:/.test(s)) return 'tarot';
  if (/^(?:ita|nap):/.test(s)) return 'napoletane';
  if (/^(?:hana|koi|hf):/.test(s)) return 'hanafuda';
  if (/^(?:uta|karuta):/.test(s)) return 'utagaruta';
  if (FATE_REGEX.test(s)) return 'fate';
  return 'numeric';
}

export function parseV5(src) {
  const m = V5_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected V5 pool like "v5:8h3" or "v5:8h3@3"');
  // `pool` is the whole throw; `hunger` is how many of those dice are red. The
  // app builds the two counts additively (pool + hunger dice) and writes their
  // sum here, so hunger is always 0-5 and never more than the pool.
  const pool = Number(m[1]);
  const hunger = m[2] === undefined ? 0 : Number(m[2]);
  const difficulty = m[3] === undefined ? null : Number(m[3]);
  if (pool < 1 || pool > 100) throw new Error('V5 pool must be 1-100');
  if (hunger < 0 || hunger > pool || hunger > 5) throw new Error('Hunger must be 0 to 5 and within the pool');
  if (difficulty !== null && (difficulty < 1 || difficulty > 10)) {
    throw new Error('Difficulty must be 1-10');
  }
  return { pool, hunger, difficulty };
}

export function rollV5(src) {
  const { pool, hunger, difficulty } = parseV5(src);
  // The first `hunger` of the `pool` dice are the red Hunger dice, the rest are
  // ordinary d10s.
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

// A Rouse check: one Hunger die, spent to power a Discipline or wake for the
// night. It holds on 6+ and raises Hunger by one on 1-5. No pool, no difficulty,
// so it carries a 'rouse' summary the headline and detail read on their own.
// `hungerAfter` is filled in by the caller once it has moved the tracked Hunger,
// since the die alone does not know the new total.
export function rollRouse() {
  const value = randInt(10);
  const success = value >= 6;
  return {
    schema: 2,
    system: 'v5',
    notation: 'v5:rouse',
    groups: [{ kind: 'dice', dieType: 'v5', count: 1,
      dice: [{ value, hunger: true, kept: true, rerolled: false, exploded: false, crit: null }], subtotal: 0 }],
    summary: { kind: 'rouse', value, success, hungerGain: success ? 0 : 1, hungerAfter: null },
  };
}

// V5 outcome rules
//   * every die showing 6+ is one success — a 10 is NOT worth two on its own
//   * each PAIR of 10s is a critical: the pair adds two further successes, so
//     two 10s together are worth four. An odd 10 left over is just its own
//     single success. (Counting every 10 as two, as this once did, inflated any
//     pool containing a lone 10 and quietly changed win/lose at the margin.)
//   * a critical only *wins* if the roll also meets the difficulty; two 10s in
//     a roll that falls short is still a failure, not a Critical
//   * Messy Critical  = a winning critical where at least one Hunger die shows 10
//   * Bestial Failure = the test fails AND at least one Hunger die shows 1
//
// Difficulty is what makes any of the resolved states truthful, so with it
// omitted (null) the reducer reports the raw facts — successes, the crit pair,
// the Hunger events — and asserts no outcome at all rather than guessing.
export function summarizeV5(dice, difficulty, pool = dice.length, hunger = dice.filter(d => d.hunger).length) {
  let base = 0, tenCount = 0, hungerTen = 0, hungerOne = 0;
  for (const d of dice) {
    const v = d.value;
    if (v >= 6) base++;
    if (v === 10) { tenCount++; if (d.hunger) hungerTen++; }
    if (v === 1 && d.hunger) hungerOne++;
  }
  const critPairs = Math.floor(tenCount / 2);
  const successes = base + critPairs * 2;
  const critTwo = critPairs > 0;
  const margin = difficulty === null ? null : successes - difficulty;
  const won = difficulty !== null && successes >= difficulty;

  let outcome = null;
  // Zero successes resolves without a difficulty: every difficulty is at least
  // 1, so a roll with nothing on it has lost whatever the Storyteller had in
  // mind — including, with a Hunger 1 among the dice, as a Bestial Failure.
  if (difficulty === null && successes === 0) outcome = hungerOne > 0 ? 'bestial-failure' : 'failure';
  else if (difficulty === null) outcome = null;
  else if (won && critTwo) outcome = hungerTen > 0 ? 'messy-critical' : 'critical';
  else if (won) outcome = 'success';
  else if (hungerOne > 0) outcome = 'bestial-failure';
  else outcome = 'failure';

  return {
    kind: 'v5', pool, hunger, difficulty,
    successes, outcome, margin,
    // A total failure — no successes at all — is its own thing at the table,
    // and it is worth saying out loud whether or not a difficulty was set.
    totalFailure: successes === 0,
    critTwo, critPairs, hungerTen, hungerOne, tenCount,
    // A Willpower reroll is offered while there is at least one non-Hunger die
    // to spend it on. rerollV5 clears this so it can only be taken once.
    willpowerAvailable: dice.some(d => !d.hunger),
  };
}

// A Willpower reroll: the player spends one point of Willpower to reroll up to
// three of their own non-Hunger dice, once per roll. The chosen dice take fresh
// d10 faces, Hunger dice are never eligible, and the pool resolves again from
// the new values. `indices` are positions into the roll's own dice array; any
// that are out of range or land on a Hunger die are quietly ignored, and no
// more than three are honoured.
export function rerollV5(result, indices) {
  const src = result?.groups?.[0]?.dice || [];
  const chosen = new Set(
    (Array.isArray(indices) ? indices : [])
      .filter(i => Number.isInteger(i) && i >= 0 && i < src.length && !src[i].hunger)
      .slice(0, 3),
  );
  const dice = src.map((d, i) => chosen.has(i)
    ? { ...d, value: randInt(10), rerolled: true }
    : { ...d, rerolled: false });
  const pool = Number.isInteger(result?.summary?.pool) ? result.summary.pool : dice.length;
  const hunger = Number.isInteger(result?.summary?.hunger)
    ? result.summary.hunger : dice.filter(d => d.hunger).length;
  const difficulty = result?.summary?.difficulty ?? null;
  const summary = summarizeV5(dice, difficulty, pool, hunger);
  summary.willpowerAvailable = false;
  summary.willpowerUsed = true;
  return {
    schema: 2,
    system: 'v5',
    notation: result?.notation || `v5:${pool}h${hunger}`,
    groups: [{ kind: 'dice', dieType: 'v5', count: dice.length, dice, subtotal: 0 }],
    summary,
  };
}

const OUTCOME_LABEL = {
  'messy-critical': 'Messy Critical',
  critical: 'Critical',
  success: 'Success',
  'bestial-failure': 'Bestial Failure',
  failure: 'Failure',
};

// The raw dice, split into the two pools and labelled in words. The symbols on
// the tray are the fun part, but the readout and the log spell out the actual
// d10 values so a roll can be checked — and "Hunger 9, 7" reads as what it is
// where "9⬥, 7⬥" needs a legend nobody has.
export function v5Dice(result) {
  const regular = [], hunger = [];
  for (const g of result.groups || []) {
    for (const d of g.dice || []) (d.hunger ? hunger : regular).push(d.value);
  }
  const parts = [];
  if (regular.length) parts.push(`Regular ${regular.join(', ')}`);
  if (hunger.length) parts.push(`Hunger ${hunger.join(', ')}`);
  return parts.join(' · ');
}

// The line under the headline, in reading order: what happened, then the
// arithmetic behind it, then a short "why" for the outcomes a bare count does
// not explain, then the dice themselves.
export function describeV5(result) {
  const s = result.summary;
  if (s.kind === 'rouse') {
    if (s.success) return `Rouse check · the Blood holds · rolled ${s.value}`;
    // Untracked: no Hunger total to move, so it just names the mechanical result.
    if (s.tracked === false) return `Rouse check · gain 1 Hunger · rolled ${s.value}`;
    const climb = s.hungerRose === false
      ? `Hunger stays at ${s.hungerAfter}, the Beast stirs`
      : `Hunger rises to ${s.hungerAfter}`;
    return `Rouse check · ${climb} · rolled ${s.value}`;
  }
  const parts = [];
  if (s.outcome && OUTCOME_LABEL[s.outcome]) parts.push(OUTCOME_LABEL[s.outcome]);
  parts.push(`${s.successes} success${s.successes === 1 ? '' : 'es'}`
    + (s.difficulty !== null ? ` vs difficulty ${s.difficulty}` : ''));
  // Only the outcomes that a "successes ≥ difficulty" tally does not explain on
  // its own get a reason, so the line stays short.
  if (s.outcome === 'messy-critical') parts.push('a pair of 10s, one on a Hunger die');
  else if (s.outcome === 'critical') parts.push(s.critPairs > 1 ? `${s.critPairs} pairs of 10s` : 'a pair of 10s');
  else if (s.outcome === 'bestial-failure') parts.push('a Hunger die rolled 1');
  else if (s.critTwo) parts.push(s.critPairs > 1 ? `${s.critPairs} pairs of 10s` : 'a pair of 10s');
  const dice = v5Dice(result);
  if (dice) parts.push(dice);
  return parts.join(' · ');
}

// The big readout. Two shapes, because V5 has two different answers depending
// on what the roll knows:
//
//   * with a difficulty, the answer is the resolved outcome — a phrase, set at
//     the readout's text size so "Bestial Failure" does not run off the edge
//     and overlap itself at 104px;
//   * without one, nothing is resolved and the answer is simply how many
//     successes came up — a number, which keeps the roller looking like itself.
export function v5Headline(result) {
  const s = result.summary;
  if (s.kind === 'rouse') {
    if (s.success) return { kind: 'text', text: 'Blood holds' };
    if (s.tracked === false) return { kind: 'text', text: 'Hunger +1', variant: 'v5-hunger' };
    return { kind: 'text', text: `Hunger ${s.hungerAfter}`, variant: 'v5-hunger' };
  }
  if (s.outcome) {
    const text = s.outcome === 'success' && s.margin !== null
      ? `Success +${s.margin}`
      : (OUTCOME_LABEL[s.outcome] || 'Roll');
    return { kind: 'text', text };
  }
  return { kind: 'number', text: String(s.successes) };
}

// Dispatcher: an explicit system token in the notation wins; otherwise defer to
// the numeric engine (returned as {system:'numeric', deferred:true}).
export function rollAny(src, uiSystem = 'numeric') {
  const sys = detectSystem(src);
  if (sys === 'v5') return rollV5(src);
  if (sys === 'fate') return rollFate(src);
  if (sys === 'genesys') return rollGenesys(src);
  if (sys === 'daggerheart') return rollDaggerheart(src);
  if (sys === 'cthulhutech') return rollCthulhuTech(src);
  if (sys === 'yearzero') return rollYearZero(src);
  if (sys === 'bladerunner') return rollBladeRunner(src);
  if (sys === 'twilight') return rollTwilight(src);
  if (sys === 'starwars') return rollStarWars(src);
  if (sys === 'onering') return rollOneRing(src);
  if (sys === 'pbta') return rollPbta(src);
  if (sys === 'mist') return rollMist(src);
  if (sys === 'mothership') return rollMothership(src);
  if (sys === 'callofcthulhu') return rollCallOfCthulhu(src);
  if (sys === 'deltagreen') return rollDeltaGreen(src);
  if (sys === 'ironsworn') return rollIronsworn(src);
  return { system: 'numeric', deferred: true, notation: String(src) };
}

// ---- 2d6 systems: Powered by the Apocalypse + the Mist Engine ----
//
// One mechanic, two names. Roll 2d6, add a modifier, read the band: 10+ is a
// full hit, 7-9 a partial (a hit with a cost), 6 or under a miss. PbtA calls
// them Strong/Weak Hit and Miss; the Mist Engine (City of Mist, Legend in the
// Mist, :Otherscape) calls them Success/Consequence/Failure and sources the
// modifier from power tags minus weakness tags.
const PBTA_REGEX = /^pbta:([+-]\d+)?$/;
const MIST_REGEX = /^mist:([+-]\d+)?$/;

const BAND_LABELS = {
  pbta: { hit: 'Strong Hit', partial: 'Weak Hit', miss: 'Miss' },
  mist: { hit: 'Success', partial: 'Consequence', miss: 'Failure' },
};

function parse2d6(src, regex, label) {
  const m = regex.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error(`Expected a ${label} roll like "${label === 'PbtA' ? 'pbta' : 'mist'}:" or ":+2"`);
  const modifier = m[1] ? Number(m[1]) : 0;
  if (Math.abs(modifier) > 100) throw new Error('Modifier must be -100 to 100');
  return { modifier };
}
export function parsePbta(src) { return parse2d6(src, PBTA_REGEX, 'PbtA'); }
export function parseMist(src) { return parse2d6(src, MIST_REGEX, 'Mist'); }

function roll2d6(src, system, parse) {
  const { modifier } = parse(src);
  const a = randInt(6), b = randInt(6);
  const dice = [
    { value: a, sides: 6, kept: true, rerolled: false, exploded: false },
    { value: b, sides: 6, kept: true, rerolled: false, exploded: false },
  ];
  return {
    schema: 2,
    system,
    notation: String(src),
    groups: [{ kind: 'dice', dieType: system, sides: 6, count: 2, dice, subtotal: a + b }],
    summary: summarize2d6(a, b, modifier, system),
  };
}
export function rollPbta(src) { return roll2d6(src, 'pbta', parsePbta); }
export function rollMist(src) { return roll2d6(src, 'mist', parseMist); }

export function summarize2d6(a, b, modifier, system) {
  const sum = a + b;
  const total = sum + modifier;
  const band = total >= 10 ? 'hit' : total >= 7 ? 'partial' : 'miss';
  return { kind: system, a, b, sum, modifier, total, band };
}

// Total as the big number, tinted by the band (green hit / amber partial /
// muted miss). Shared by both 2d6 systems.
export function twod6Headline(result) {
  return { kind: 'number', text: String(result.summary.total), variant: `band-${result.summary.band}` };
}

export function describe2d6(result) {
  const s = result.summary;
  const parts = [BAND_LABELS[s.kind][s.band]];
  let math = `${s.a} + ${s.b}`;
  if (s.modifier) math += ` ${s.modifier > 0 ? '+' : '−'} ${Math.abs(s.modifier)}`;
  parts.push(math, `total ${s.total}`);
  return parts.join(' · ');
}

// ---- Star Wars (FFG / Edge Studio) — Genesys narrative dice + the Force die ----
//
// The six narrative dice resolve exactly as Genesys does; Star Wars adds a
// seventh: the white Force die (d12), whose Light- and Dark-side pips are a
// separate output used to power Force abilities. They do not cancel the
// success/advantage axes. Force die faces: six single Dark, one double Dark,
// three double Light, two single Light (8 pips each side, dark on more faces).
const LIGHT = 'lightside', DARK = 'darkside';
const FORCE_DIE = {
  color: 'force', sides: 12,
  faces: [
    [DARK], [DARK], [DARK], [DARK], [DARK], [DARK],
    [DARK, DARK],
    [LIGHT, LIGHT], [LIGHT, LIGHT], [LIGHT, LIGHT],
    [LIGHT], [LIGHT],
  ],
};
const SW_LETTERS = { a: 'ability', p: 'proficiency', b: 'boost', s: 'setback', d: 'difficulty', c: 'challenge', f: 'force' };
// Resolved at call time, not module load: GENESYS_DICE is declared further down.
const swDie = type => (type === 'force' ? FORCE_DIE : GENESYS_DICE[type]);

export function parseStarWars(src) {
  const raw = String(src || '').trim().toLowerCase();
  const m = /^sw:(.+)$/.exec(raw);
  if (!m) throw new Error('Expected a Star Wars pool like "sw:2A+2D+1F"');
  const body = m[1].replace(/[\s+]/g, '');
  if (!/^(\d*[apbsdcf])+$/.test(body)) {
    throw new Error('Star Wars dice are A P B S D C F (the six narrative dice plus the Force die)');
  }
  const pool = [];
  let total = 0;
  for (const t of body.matchAll(/(\d*)([apbsdcf])/g)) {
    const count = t[1] === '' ? 1 : Number(t[1]);
    if (count < 1) throw new Error('Each die count must be at least 1');
    total += count;
    pool.push({ type: SW_LETTERS[t[2]], count });
  }
  if (total < 1 || total > 100) throw new Error('Star Wars pool must be 1-100 dice');
  return pool;
}

export function rollStarWars(src) {
  const pool = parseStarWars(src);
  const dice = [];
  for (const { type, count } of pool) {
    const def = swDie(type);
    for (let i = 0; i < count; i++) {
      const faceIndex = randInt(def.sides) - 1;
      dice.push({
        type, sides: def.sides, color: def.color,
        faceIndex, symbols: def.faces[faceIndex],
        value: faceIndex + 1, kept: true, rerolled: false, exploded: false,
      });
    }
  }
  return {
    schema: 2,
    system: 'starwars',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'starwars', count: dice.length, dice, subtotal: 0 }],
    summary: summarizeStarWars(dice),
  };
}

export function summarizeStarWars(dice) {
  const narrative = dice.filter(d => d.type !== 'force');
  const g = summarizeGenesys(narrative);
  let lightside = 0, darkside = 0;
  for (const d of dice) {
    if (d.type !== 'force') continue;
    for (const sym of d.symbols) { if (sym === LIGHT) lightside++; else darkside++; }
  }
  return {
    ...g, kind: 'starwars',
    lightside, darkside,
    hasNarrative: narrative.length > 0,
    hasForce: lightside + darkside > 0,
  };
}

export function starWarsHeadline(result) {
  const s = result.summary;
  // A Force-only roll (a Force-power check) leads with the pips; otherwise the
  // narrative outcome leads and the pips ride along in the detail.
  if (!s.hasNarrative && s.hasForce) {
    const parts = [];
    if (s.lightside) parts.push(`${s.lightside} Light`);
    if (s.darkside) parts.push(`${s.darkside} Dark`);
    return { kind: 'text', text: parts.join(' · ') || 'No Force' };
  }
  return genesysHeadline(result);
}

export function describeStarWars(result) {
  const s = result.summary;
  let text = s.hasNarrative ? describeGenesys(result) : '';
  if (s.hasForce) {
    const force = [];
    if (s.lightside) force.push(`${s.lightside} Light`);
    if (s.darkside) force.push(`${s.darkside} Dark`);
    const clause = `Force ${force.join(', ')}`;
    text = text ? `${text} · ${clause}` : clause;
  }
  return text;
}

// ---- The One Ring 2e ----
//
// One Feat die (d12: 1-10, plus the Eye of Sauron = 0 and the Gandalf rune =
// automatic success) rolled with a pool of Success dice (d6, where each 6 bears
// a Tengwar rune). Total the dice and meet the Target Number. Each rune is a
// mark of quality: one is a Great success, two or more Extraordinary. Favoured /
// ill-favoured rolls two Feat dice and keeps the better / worse; when Weary,
// Success dice of 1-3 count as nothing.
//
//   tor:3           a Feat die + three Success dice
//   tor:3@16        the same, against Target Number 16
//   tor:3fav@16     favoured (roll two Feat dice, keep the best)
//   tor:2illw@18    ill-favoured and weary
const TOR_REGEX = /^tor:(\d+)(fav|ill)?(w)?(?:@(\d+))?$/;

export function parseOneRing(src) {
  const m = TOR_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected an One Ring roll like "tor:3" or "tor:3fav@16"');
  const success = Number(m[1]);
  const favour = m[2] || null; // 'fav' | 'ill' | null
  const weary = Boolean(m[3]);
  const tn = m[4] === undefined ? null : Number(m[4]);
  if (success < 0 || success > 20) throw new Error('Success dice must be 0-20');
  if (tn !== null && (tn < 1 || tn > 100)) throw new Error('Target Number must be 1-100');
  return { success, favour, weary, tn };
}

// A Feat die roll → {face, value, rank}. rank orders them for keeping the best
// or worst: Gandalf beats every number beats the Eye.
function rollFeatDie() {
  const r = randInt(12);
  if (r === 11) return { face: 'eye', value: 0, rank: -1 };       // Eye of Sauron = 0
  if (r === 12) return { face: 'gandalf', value: 0, rank: 99 };   // Gandalf = automatic success
  return { face: 'number', value: r, rank: r };                   // 1-10
}

export function rollOneRing(src) {
  const { success, favour, weary, tn } = parseOneRing(src);
  // Favoured/ill-favoured rolls two Feat dice; the kept one resolves, the other
  // is shown faded like a dropped die.
  const feats = [rollFeatDie()];
  if (favour) feats.push(rollFeatDie());
  const kept = favour === 'ill'
    ? feats.reduce((a, b) => (b.rank < a.rank ? b : a))
    : feats.reduce((a, b) => (b.rank > a.rank ? b : a));

  const dice = feats.map(f => ({
    role: 'feat', face: f.face, value: f.value, sides: 12,
    kept: f === kept, rerolled: false, exploded: false,
  }));
  for (let i = 0; i < success; i++) {
    const value = randInt(6);
    dice.push({ role: 'success', value, sides: 6, rune: value === 6, kept: true, rerolled: false, exploded: false });
  }

  return {
    schema: 2,
    system: 'onering',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'onering', count: dice.length, dice, subtotal: 0 }],
    summary: summarizeOneRing({ kept, dice, weary, tn }),
  };
}

export function summarizeOneRing({ kept, dice, weary = false, tn = null }) {
  const successDice = dice.filter(d => d.role === 'success');
  // Weary drops the botches: Success dice showing 1-3 count as zero.
  let successSum = 0;
  for (const d of successDice) {
    d.counts = !(weary && d.value <= 3);
    if (d.counts) successSum += d.value;
  }
  const runes = successDice.filter(d => d.value === 6).length;
  const gandalf = kept.face === 'gandalf';
  const eye = kept.face === 'eye';
  const total = kept.value + successSum;
  const success = tn === null ? null : (gandalf || total >= tn);
  const degree = runes >= 2 ? 'extraordinary' : runes === 1 ? 'great' : 'ordinary';
  return {
    kind: 'onering',
    feat: kept.face, featValue: kept.value, gandalf, eye,
    successSum, runes, total, tn, weary, success, degree,
  };
}

const TOR_DEGREE_LABEL = { great: 'Great Success', extraordinary: 'Extraordinary Success' };

// The big readout is the total, tinted by the outcome (gold for a Gandalf
// auto-success, green for success, muted for failure).
export function oneRingHeadline(result) {
  const s = result.summary;
  let variant;
  if (s.gandalf) variant = 'tor-gandalf';
  else if (s.success === true) variant = 'tor-success';
  else if (s.success === false) variant = 'tor-failure';
  return { kind: 'number', text: String(s.total), variant };
}

export function describeOneRing(result) {
  const s = result.summary;
  const parts = [];
  if (s.gandalf) parts.push('Automatic Success');
  else if (s.success === true) parts.push('Success');
  else if (s.success === false) parts.push('Failure');
  if (s.success !== false && s.degree !== 'ordinary') parts.push(TOR_DEGREE_LABEL[s.degree]);
  if (s.eye) parts.push('Eye of Sauron');
  const feat = s.gandalf ? 'Gandalf' : s.eye ? 'Eye' : s.featValue;
  parts.push(`Feat ${feat}`);
  const successVals = result.groups[0].dice
    .filter(d => d.role === 'success')
    .map(d => (d.value === 6 ? 'ᚱ' : String(d.value)));
  if (successVals.length) parts.push(`Success ${successVals.join(', ')}`);
  parts.push(`total ${s.total}` + (s.tn !== null ? ` vs ${s.tn}` : ''));
  return parts.join(' · ');
}

// ---- CthulhuTech 2e (the even/odd d10 pool) ----
//
// 2e dropped 1e's poker "Framewerk" for a pool of coin-flips: roll d10 equal to
// your Attribute + Skill, and every EVEN die is a Hit (odd is a miss). Count the
// hits and meet the Difficulty (about 3 for a simple task up to 6-7 for a near
// impossible one). A pool that meets or beats the Difficulty succeeds.
//
//   ct:8       roll eight d10, report the hits
//   ct:8@4     the same, resolved against Difficulty 4
const CT_REGEX = /^ct:(\d+)(?:@(\d+))?$/;

export function parseCthulhuTech(src) {
  const m = CT_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a CthulhuTech pool like "ct:8" or "ct:8@4"');
  const dice = Number(m[1]);
  const difficulty = m[2] === undefined ? null : Number(m[2]);
  if (dice < 1 || dice > 100) throw new Error('Pool must be 1-100 dice');
  if (difficulty !== null && (difficulty < 1 || difficulty > 20)) {
    throw new Error('Difficulty must be 1-20');
  }
  return { dice, difficulty };
}

export function rollCthulhuTech(src) {
  const { dice: count, difficulty } = parseCthulhuTech(src);
  const dice = [];
  for (let i = 0; i < count; i++) {
    const value = randInt(10);
    dice.push({ value, hit: value % 2 === 0, kept: true, rerolled: false, exploded: false });
  }
  return {
    schema: 2,
    system: 'cthulhutech',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'cthulhutech', sides: 10, count, dice, subtotal: 0 }],
    summary: summarizeCthulhuTech(dice, difficulty, count),
  };
}

export function summarizeCthulhuTech(dice, difficulty = null, count = dice.length) {
  let hits = 0;
  for (const d of dice) if (d.value % 2 === 0) hits++;
  const success = difficulty === null ? null : hits >= difficulty;
  const margin = difficulty === null ? null : hits - difficulty;
  return { kind: 'cthulhutech', count, hits, misses: count - hits, difficulty, success, margin };
}

// The big readout is the hit count, tinted by whether it met the Difficulty.
export function cthulhutechHeadline(result) {
  const s = result.summary;
  const variant = s.success === null ? undefined : s.success ? 'ct-success' : 'ct-failure';
  return { kind: 'number', text: String(s.hits), variant };
}

export function describeCthulhuTech(result) {
  const s = result.summary;
  const parts = [`${s.hits} hit${s.hits === 1 ? '' : 's'}`
    + (s.difficulty !== null ? ` vs difficulty ${s.difficulty}` : '')];
  if (s.success !== null) {
    parts.push(s.success ? (s.margin > 0 ? `Success +${s.margin}` : 'Success') : 'Failure');
  }
  const dice = result.groups[0].dice;
  const hitVals = dice.filter(d => d.value % 2 === 0).map(d => d.value);
  const missVals = dice.filter(d => d.value % 2 !== 0).map(d => d.value);
  parts.push(`hits ${hitVals.length ? hitVals.join(', ') : 'none'}`);
  if (missVals.length) parts.push(`missed ${missVals.join(', ')}`);
  return parts.join(' · ');
}

// ---- Year Zero Engine (the d6 success pool) ----
//
// Roll a pool of d6 and count every 6 as a Success; one success carries the roll,
// more is better. The dice come in colours — Base (attribute), Skill, and Gear —
// which matter on a Push: reroll everything that is not a 6 or a 1, and each 1
// left showing is a bane. A Base 1 costs an attribute, a Gear 1 damages the gear.
// Alien folds Stress dice into the pool: they roll for successes too, but a 1 on
// one is a Panic, and each push adds another Stress die.
//
//   yz:5           five Base dice
//   yz:5b3s2g      Base 5, Skill 3, Gear 2
//   yz:5b3s2g1x    the same, plus a Stress die (Alien)
const YZ_LETTER = { b: 'base', s: 'skill', g: 'gear', x: 'stress' };
const YZ_TYPES = ['base', 'skill', 'gear', 'stress'];
const YZ_TERM = /(\d+)([bsgx])/g;

export function parseYearZero(src) {
  const raw = String(src || '').trim().toLowerCase().replace(/^yz:/, '');
  const pool = { base: 0, skill: 0, gear: 0, stress: 0 };
  if (/^\d+$/.test(raw)) {
    pool.base = Number(raw);
  } else if (/^(?:\d+[bsgx])+$/.test(raw)) {
    let m;
    YZ_TERM.lastIndex = 0;
    while ((m = YZ_TERM.exec(raw))) pool[YZ_LETTER[m[2]]] += Number(m[1]);
  } else {
    throw new Error('Expected a Year Zero pool like "yz:5" or "yz:5b3s2g"');
  }
  const total = pool.base + pool.skill + pool.gear + pool.stress;
  if (total < 1 || total > 100) throw new Error('Pool must be 1-100 dice');
  return pool;
}

function makeYzDie(type) {
  return { value: randInt(6), type, kept: true, rerolled: false, exploded: false };
}

function yearzeroResult(notation, dice, pushed) {
  return {
    schema: 2,
    system: 'yearzero',
    notation: String(notation),
    groups: [{ kind: 'dice', dieType: 'yearzero', sides: 6, count: dice.length, dice, subtotal: 0 }],
    summary: summarizeYearZero(dice, pushed),
  };
}

export function rollYearZero(src) {
  const pool = parseYearZero(src);
  const dice = [];
  for (const type of YZ_TYPES) {
    for (let i = 0; i < pool[type]; i++) dice.push(makeYzDie(type));
  }
  return yearzeroResult(src, dice, false);
}

// A push rerolls every die that is not already a 6 (a kept success) or a 1 (a
// kept bane). An Alien push costs a Stress die, so one is added whenever the pool
// already holds Stress.
export function pushYearZero(result) {
  const dice = result.groups[0].dice.map(d =>
    d.value === 6 || d.value === 1 ? d : { ...d, value: randInt(6), rerolled: true });
  if (dice.some(d => d.type === 'stress')) dice.push({ ...makeYzDie('stress'), rerolled: true });
  return yearzeroResult(result.notation, dice, true);
}

export function summarizeYearZero(dice, pushed = false) {
  let successes = 0;
  const banes = { base: 0, skill: 0, gear: 0, stress: 0 };
  for (const d of dice) {
    if (d.value === 6) successes++;
    else if (d.value === 1) banes[d.type]++;
  }
  return {
    kind: 'yearzero',
    count: dice.length,
    successes,
    ones: banes.base + banes.skill + banes.gear + banes.stress,
    banes,
    pushed,
    panic: banes.stress > 0,   // Alien: any Stress 1 is a Panic
    canPush: !pushed,          // a roll may be pushed once
  };
}

// The readout is the success count: green once anything succeeds, red on a clean
// miss, flagged when a Stress die panics.
export function yearzeroHeadline(result) {
  const s = result.summary;
  const variant = s.panic ? 'yz-panic' : s.successes > 0 ? 'yz-success' : 'yz-fail';
  return { kind: 'number', text: String(s.successes), variant };
}

export function describeYearZero(result) {
  const s = result.summary;
  const parts = [`${s.successes} success${s.successes === 1 ? '' : 'es'}`];
  if (s.pushed) parts.push('pushed');
  if (s.panic) parts.push('Panic!');
  const banes = [];
  if (s.banes.base) banes.push(`${s.banes.base} attribute`);
  if (s.banes.gear) banes.push(`${s.banes.gear} gear`);
  if (s.banes.stress) banes.push(`${s.banes.stress} stress`);
  if (banes.length) parts.push(`banes: ${banes.join(', ')}`);
  return parts.join(' · ');
}

// ---- Blade Runner (BRRPG) — the Year Zero step-die ----
//
// Two step dice — an Attribute die and a Skill die, each d6/d8/d10/d12. Count
// successes: 6-9 is one, 10+ is two. One success passes; two or more is a crit,
// zero is a failure. Advantage rolls a third die (a copy of the smaller base
// die); disadvantage rolls only the larger of the two. Push rerolls every die
// that is not already a 6+ and not a 1 (1s lock), and each 1 left showing is a
// point of damage — to Health for a physical roll, Resolve for a mental one.
//
//   br:12,8       Attribute d12 + Skill d8
//   br:12,8adv    the same, with advantage (a third die)
//   br:10,6dis    with disadvantage (the larger die only)
const BR_REGEX = /^br:(6|8|10|12),(6|8|10|12)(adv|dis)?$/;

export function parseBladeRunner(src) {
  const m = BR_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Blade Runner roll like "br:12,8" or "br:12,8adv"');
  return { attr: Number(m[1]), skill: Number(m[2]), mod: m[3] || null };
}

const brSuccesses = value => (value >= 10 ? 2 : value >= 6 ? 1 : 0);
const makeBrDie = (sides, role) => ({ sides, value: randInt(sides), role, kept: true, rerolled: false, exploded: false });

function bladeRunnerResult(notation, dice, pushed) {
  return {
    schema: 2,
    system: 'bladerunner',
    notation: String(notation),
    groups: [{ kind: 'dice', dieType: 'bladerunner', sides: dice[0]?.sides ?? 6, count: dice.length, dice, subtotal: 0 }],
    summary: summarizeBladeRunner(dice, pushed),
  };
}

export function rollBladeRunner(src) {
  const { attr, skill, mod } = parseBladeRunner(src);
  let dice;
  if (mod === 'dis') {
    dice = [makeBrDie(Math.max(attr, skill), attr >= skill ? 'attribute' : 'skill')];
  } else {
    dice = [makeBrDie(attr, 'attribute'), makeBrDie(skill, 'skill')];
    if (mod === 'adv') dice.push(makeBrDie(Math.min(attr, skill), 'advantage'));
  }
  return bladeRunnerResult(src, dice, false);
}

// Push rerolls every die that is not already a success (6+) and not locked on a 1.
export function pushBladeRunner(result) {
  const dice = result.groups[0].dice.map(d =>
    (d.value >= 6 || d.value === 1) ? d : { ...d, value: randInt(d.sides), rerolled: true });
  return bladeRunnerResult(result.notation, dice, true);
}

export function summarizeBladeRunner(dice, pushed = false) {
  let successes = 0, ones = 0;
  for (const d of dice) { successes += brSuccesses(d.value); if (d.value === 1) ones++; }
  return {
    kind: 'bladerunner',
    successes,
    ones,
    outcome: successes >= 2 ? 'critical' : successes >= 1 ? 'success' : 'failure',
    pushed,
    // You push a MISS, not a roll you already passed. On a miss every die is 1-5,
    // so nothing but a 1 is ever "locked" — which is what the 6+ rule quietly
    // means here.
    canPush: !pushed && successes === 0,
  };
}

// The readout is the success count: gold on a critical (2+), green on a plain
// success, red on a miss.
export function bladeRunnerHeadline(result) {
  const s = result.summary;
  const variant = s.outcome === 'critical' ? 'br-crit' : s.outcome === 'success' ? 'br-success' : 'br-fail';
  return { kind: 'number', text: String(s.successes), variant };
}

export function describeBladeRunner(result) {
  const s = result.summary;
  const label = { critical: 'Critical', success: 'Success', failure: 'Failure' }[s.outcome];
  const parts = [`${s.successes} success${s.successes === 1 ? '' : 'es'}`, label];
  if (s.pushed) parts.splice(1, 0, 'pushed');
  const dice = result.groups[0].dice.map(d => `d${d.sides}[${d.value}]`).join(' + ');
  parts.push(dice);
  if (s.pushed && s.ones) parts.push(`${s.ones} damage`);
  return parts.join(' · ');
}

// ---- Twilight: 2000 (T2K 4e) — Blade Runner's step-die sibling ----
//
// The same core as Blade Runner: an Attribute die + a Skill die, each d6-d12,
// counting 6-9 as one success and 10+ as two, with the same push (reroll the
// dice that are not a 6+, 1s lock). What's new is a pool of d6 Ammunition dice
// rolled alongside for automatic fire: each 6 is an extra hit, and every 1 left
// after a push knocks the weapon's Reliability down a step.
//
//   t2k:12,8      Attribute d12 + Skill d8
//   t2k:12,8,3    the same, with three Ammo dice
const T2K_REGEX = /^t2k:(6|8|10|12),(6|8|10|12)(?:,(\d+))?$/;

export function parseTwilight(src) {
  const m = T2K_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Twilight: 2000 roll like "t2k:12,8" or "t2k:12,8,3"');
  const ammo = m[3] === undefined ? 0 : Number(m[3]);
  if (ammo > 20) throw new Error('Ammo dice must be 0-20');
  return { attr: Number(m[1]), skill: Number(m[2]), ammo };
}

function twilightResult(notation, dice, pushed) {
  return {
    schema: 2,
    system: 'twilight',
    notation: String(notation),
    groups: [{ kind: 'dice', dieType: 'twilight', sides: dice[0]?.sides ?? 6, count: dice.length, dice, subtotal: 0 }],
    summary: summarizeTwilight(dice, pushed),
  };
}

export function rollTwilight(src) {
  const { attr, skill, ammo } = parseTwilight(src);
  const dice = [makeBrDie(attr, 'attribute'), makeBrDie(skill, 'skill')];
  for (let i = 0; i < ammo; i++) dice.push(makeBrDie(6, 'ammo'));
  return twilightResult(src, dice, false);
}

// Push rerolls every die that is not already a 6+ and not locked on a 1 — base
// dice and Ammo dice alike.
export function pushTwilight(result) {
  const dice = result.groups[0].dice.map(d =>
    (d.value >= 6 || d.value === 1) ? d : { ...d, value: randInt(d.sides), rerolled: true });
  return twilightResult(result.notation, dice, true);
}

export function summarizeTwilight(dice, pushed = false) {
  let successes = 0, ones = 0;
  for (const d of dice) { successes += brSuccesses(d.value); if (d.value === 1) ones++; }
  return {
    kind: 'twilight',
    successes,
    ones,
    outcome: successes >= 1 ? 'success' : 'failure',
    pushed,
    canPush: !pushed && successes === 0,
  };
}

export function twilightHeadline(result) {
  const s = result.summary;
  return { kind: 'number', text: String(s.successes), variant: s.outcome === 'success' ? 't2k-success' : 't2k-fail' };
}

export function describeTwilight(result) {
  const s = result.summary;
  const parts = [`${s.successes} success${s.successes === 1 ? '' : 'es'}`, s.outcome === 'success' ? 'Success' : 'Failure'];
  if (s.pushed) parts.splice(1, 0, 'pushed');
  parts.push(result.groups[0].dice.map(d => `d${d.sides}[${d.value}]`).join(' + '));
  if (s.pushed && s.ones) parts.push(`Reliability −${s.ones}`);
  return parts.join(' · ');
}

// ---- Mothership 1e ----
//
// A roll-under percentile system with a companion Panic die and a tracked Stress
// resource. Two signature rolls share the "ms:" prefix; ordinary damage/wounds
// stay on the numeric engine (they are plain xd10 / 1d5 / 1d100 sums).
//
//   Check / Save  ms:c@35        1d100 (two d10: tens 00-90 + ones 0-9). Roll
//                                UNDER the target to succeed. A failed Check or
//                                Save gains 1 Stress.
//     skill tier  ms:c@35e       add the Skill bonus to the target before the
//                                roll (t Trained +10, e Expert +15, m Master +20)
//     advantage   ms:c@35adv     roll two d100, keep the better (lower); dis keeps
//                                the worse (higher). The dropped pair shows faded.
//   Panic         ms:p@8         1d20, roll OVER current Stress; a result ≤ Stress
//                                is a Panic — look up the die on the Panic Table
//                                (the table text is the publisher's, so the roller
//                                only ever reports the NUMBER to look up).
//
// Roll-under specials (PSG p.19): 00 is always a Critical Success, 99 always a
// Critical Failure, and any 90-99 always fails. Doubles (00, 11 … 99) are a
// Critical — a Critical Success if the roll also came in under, a Critical Failure
// if it did not. A Critical Failure also demands a Panic Check.
const MS_REGEX = /^ms:(c|p)(?:@(\d+))?(t|e|m)?(adv|dis)?$/;
const MS_SKILL_BONUS = { t: 10, e: 15, m: 20 };
const MS_SKILL_LABEL = { t: 'Trained', e: 'Expert', m: 'Master' };

export function parseMothership(src) {
  const m = MS_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Mothership roll like "ms:c@35" or "ms:p@8"');
  const mode = m[1] === 'p' ? 'panic' : 'check';
  const target = m[2] === undefined ? null : Number(m[2]);
  const skill = m[3] || null;
  const advantage = m[4] || null; // 'adv' | 'dis' | null
  if (mode === 'panic' && skill) throw new Error('A Panic Check takes no Skill bonus');
  if (target !== null) {
    if (mode === 'check' && (target < 1 || target > 99)) throw new Error('Check target must be 1-99');
    if (mode === 'panic' && (target < 2 || target > 20)) throw new Error('Stress must be 2-20');
  }
  return { mode, target, skill, advantage };
}

// A single d100 as a percentile pair: the tens die reads 00-90, the ones 0-9, so
// the tray shows the two dice a Mothership player actually reads (a 40 die and a
// 2 die = 42), and doubles are visible as matching digits.
function rollD100() {
  const tens = (randInt(10) - 1) * 10; // 0,10,…,90
  const ones = randInt(10) - 1;        // 0-9
  return { tens, ones, value: tens + ones, double: tens / 10 === ones };
}

// Apply gained Stress without silently dropping the PSG consequence above 20.
// Dicebox is not a character sheet, so the caller surfaces `overflow` as the
// number of points by which the relevant Stat or Save must be reduced.
export function resolveMothershipStress(current, delta) {
  const total = Number(current) + Number(delta);
  return {
    stress: Math.max(2, Math.min(20, total)),
    overflow: Math.max(0, total - 20),
  };
}

export function rollMothership(src) {
  const { mode, target, skill, advantage } = parseMothership(src);
  // Advantage/disadvantage rolls the whole check twice and keeps one; the other
  // is shown faded like a dropped die, the way The One Ring shows its two Feat
  // dice. A plain roll makes just the one.
  const dice = [];
  let summary;

  if (mode === 'panic') {
    const rolls = [randInt(20)];
    if (advantage) rolls.push(randInt(20));
    // Choose the best/worst resolved Panic result. Holding steady is always
    // better than Panicking; among failed Panic rolls, the lower table result is
    // better. Among steady rolls, the higher roll is the stronger result.
    const panicQuality = value => summarizeMothershipPanic(value, target).panicked === false ? 1 : 0;
    const keep = rolls.reduce((a, b) => {
      const aq = panicQuality(a), bq = panicQuality(b);
      if (aq !== bq) return advantage === 'dis' ? (bq < aq ? b : a) : (bq > aq ? b : a);
      const bothPanicked = aq === 0;
      const preferLower = bothPanicked ? advantage !== 'dis' : advantage === 'dis';
      return preferLower ? (b < a ? b : a) : (b > a ? b : a);
    });
    let kept = false;
    for (const v of rolls) {
      const isKept = !kept && v === keep;
      if (isKept) kept = true;
      dice.push({ role: 'panic', value: v, sides: 20, kept: isKept, rerolled: false, exploded: false });
    }
    summary = summarizeMothershipPanic(keep, target, advantage);
  } else {
    const pairs = [rollD100()];
    if (advantage) pairs.push(rollD100());
    // Mothership keeps the best/worst *result*, not simply the lowest/highest
    // percentile. Criticals change that ordering: at target 35, 11 (Critical
    // Success) beats 10 (Success), while 88 (Critical Failure) is worse than 89
    // (ordinary Failure). Raw value is only the tie-breaker within one outcome.
    const quality = pair => ({
      'crit-success': 3,
      success: 2,
      unresolved: 2,
      failure: 1,
      'crit-failure': 0,
    })[summarizeMothershipCheck(pair, target, skill).outcome];
    const keep = pairs.reduce((a, b) => {
      const aq = quality(a), bq = quality(b);
      if (aq !== bq) return advantage === 'dis' ? (bq < aq ? b : a) : (bq > aq ? b : a);
      return advantage === 'dis' ? (b.value > a.value ? b : a) : (b.value < a.value ? b : a);
    });
    for (const p of pairs) {
      const isKept = p === keep;
      dice.push({ role: 'tens', value: p.tens, sides: 10, kept: isKept, rerolled: false, exploded: false });
      dice.push({ role: 'ones', value: p.ones, sides: 10, kept: isKept, rerolled: false, exploded: false });
    }
    summary = summarizeMothershipCheck(keep, target, skill, advantage);
  }

  return {
    schema: 2,
    system: 'mothership',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'mothership', count: dice.length, dice, subtotal: 0 }],
    summary,
  };
}

export function summarizeMothershipCheck(roll, target, skill = null, advantage = null) {
  const bonus = skill ? MS_SKILL_BONUS[skill] : 0;
  const effective = target === null ? null : target + bonus;
  const value = roll.value;
  const double = roll.double;

  // The absolute rules first (they hold whatever the target is), then the
  // target comparison. Without a target the roll cannot pass or fail, so it is
  // reported unresolved — a bare number, no Stress moves.
  let outcome;
  if (value === 0) {
    outcome = 'crit-success';
  } else if (value === 99) {
    outcome = 'crit-failure';
  } else if (effective === null) {
    outcome = 'unresolved';
  } else if (value >= 90) {
    outcome = 'failure';           // 90-99 always fails, doubles or not
  } else {
    const under = value < effective;
    outcome = under
      ? (double ? 'crit-success' : 'success')
      : (double ? 'crit-failure' : 'failure');
  }

  const failed = outcome === 'failure' || outcome === 'crit-failure';
  return {
    kind: 'mothership', mode: 'check',
    tens: roll.tens, ones: roll.ones, value, double,
    target, skill, skillBonus: bonus, effective, advantage,
    outcome,
    success: outcome === 'unresolved' ? null : !failed,
    // A failed Check or Save gains 1 Stress; a Critical Failure also forces a
    // Panic Check. Both drive the tracker in the UI.
    stressDelta: failed ? 1 : 0,
    forcesPanic: outcome === 'crit-failure',
  };
}

export function summarizeMothershipPanic(value, stress = null, advantage = null) {
  // Roll OVER Stress to hold it together; a result at or below Stress is a Panic.
  const panicked = stress === null ? null : value <= stress;
  return {
    kind: 'mothership', mode: 'panic',
    value, stress, advantage,
    panicked,
    // What the player looks up on their own Panic Table — the number only.
    lookup: panicked ? value : null,
  };
}

const MS_OUTCOME_LABEL = {
  'crit-success': 'Critical Success',
  success: 'Success',
  failure: 'Failure',
  'crit-failure': 'Critical Failure',
};

// The big readout. A resolved Check is its outcome phrase (tinted by success);
// an unresolved one is the bare percentile number. Panic is Steady or Panic.
export function mothershipHeadline(result) {
  const s = result.summary;
  if (s.mode === 'panic') {
    if (s.panicked === null) return { kind: 'number', text: String(s.value) };
    return s.panicked
      ? { kind: 'text', text: 'Panic', variant: 'ms-panic' }
      : { kind: 'text', text: 'Steady', variant: 'ms-steady' };
  }
  if (s.outcome === 'unresolved') return { kind: 'number', text: String(s.value) };
  const variant = s.outcome === 'crit-success' ? 'ms-crit-success'
    : s.outcome === 'success' ? 'ms-success'
    : s.outcome === 'crit-failure' ? 'ms-crit-failure'
    : 'ms-failure';
  return { kind: 'text', text: MS_OUTCOME_LABEL[s.outcome], variant };
}

export function describeMothership(result) {
  const s = result.summary;
  const parts = [];
  if (s.mode === 'panic') {
    if (s.panicked === null) parts.push(`rolled ${s.value}`);
    else {
      parts.push(s.panicked ? 'Panic' : 'Steady');
      parts.push(`rolled ${s.value} vs Stress ${s.stress}`);
      if (s.panicked) parts.push(`look up ${s.lookup} on the Panic Table`);
    }
    if (s.advantage) parts.push(s.advantage === 'adv' ? 'advantage' : 'disadvantage');
    return parts.join(' · ');
  }
  // Check / Save.
  if (s.outcome !== 'unresolved') parts.push(MS_OUTCOME_LABEL[s.outcome]);
  // The percentile read: "42 (40 + 2)". The zero tens face is printed 00,
  // including an absolute critical-success result of 00.
  const valueLabel = s.value === 0 ? '00' : String(s.value);
  const tensLabel = s.tens === 0 ? '00' : String(s.tens);
  let read = `rolled ${valueLabel} (${tensLabel} + ${s.ones})`;
  if (s.double && s.value !== 0 && s.value !== 99) read += ', doubles';
  parts.push(read);
  if (s.effective !== null) {
    const skillNote = s.skill ? ` (${s.target} +${s.skillBonus} ${MS_SKILL_LABEL[s.skill]})` : '';
    parts.push(`under ${s.effective}${skillNote}`);
  }
  if (s.advantage) parts.push(s.advantage === 'adv' ? 'advantage' : 'disadvantage');
  if (s.stressOverflow) {
    const amount = s.stressOverflow;
    parts.push(`Stress at 20 — reduce the relevant Stat or Save by ${amount}`);
  } else if (s.stressDelta) parts.push('+1 Stress');
  if (s.forcesPanic) parts.push('Panic Check');
  return parts.join(' · ');
}

// ---- Call of Cthulhu 7e ----
//
// A d100 rolled UNDER a skill, in tiers: <= skill/5 Extreme, <= skill/2 Hard,
// <= skill Regular, above it a Failure. 01 is always a Critical; 100 always
// Fumbles, as does 96-100 when the skill is under 50. Bonus/penalty dice roll
// extra tens dice and keep the best (lowest) or worst (highest), sharing the
// one ones die. Notation: "coc:60", "coc:60b", "coc:60p2", or bare "coc:".
const COC_REGEX = /^coc:(\d+)?(?:(b|p)(\d+)?)?$/;

export function parseCallOfCthulhu(src) {
  const m = COC_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Call of Cthulhu roll like "coc:60", "coc:60b", or "coc:60p2"');
  const target = m[1] === undefined ? null : Number(m[1]);
  const kind = m[2] || null;                       // 'b' bonus | 'p' penalty
  const extra = kind ? (m[3] ? Number(m[3]) : 1) : 0;
  if (target !== null && (target < 1 || target > 100)) throw new Error('Skill must be 1-100');
  if (extra > 3) throw new Error('Bonus/penalty dice must be 1-3');
  return { target, modifier: kind === 'p' ? -extra : extra };  // + bonus, - penalty
}

// One ones die, plus |modifier| extra tens dice. Each tens die combines with the
// shared ones die (00 tens + 0 ones is 100, never 0); a bonus keeps the lowest
// combined result, a penalty the highest. A plain roll has a single tens die.
function rollPercentile(modifier = 0) {
  const ones = randInt(10) - 1;                          // 0-9
  const tensCount = 1 + Math.abs(modifier);
  const tens = Array.from({ length: tensCount }, () => (randInt(10) - 1) * 10); // 0,10,…,90
  const combine = t => (t === 0 && ones === 0 ? 100 : t + ones);
  let kept = tens[0];
  for (const tv of tens) {
    if (modifier > 0 ? combine(tv) < combine(kept) : combine(tv) > combine(kept)) kept = tv;
  }
  const value = combine(kept);
  return { ones, tens, kept, value, double: kept / 10 === ones };
}

export function rollCallOfCthulhu(src) {
  const { target, modifier } = parseCallOfCthulhu(src);
  const r = rollPercentile(modifier);
  // Every tens die is on the tray; the one that was kept is flagged, the rest
  // fade like a dropped advantage die. The shared ones die is always kept.
  const dice = [];
  for (let i = 0; i < r.tens.length; i++) {
    dice.push({ role: 'tens', value: r.tens[i], sides: 10, kept: r.tens[i] === r.kept && !dice.some(d => d.kept), rerolled: false, exploded: false });
  }
  dice.push({ role: 'ones', value: r.ones, sides: 10, kept: true, rerolled: false, exploded: false });
  return {
    schema: 2,
    system: 'coc',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'coc', count: dice.length, dice, subtotal: 0 }],
    summary: summarizeCallOfCthulhu(r, target, modifier),
  };
}

const COC_ORDER = { critical: 5, extreme: 4, hard: 3, regular: 2, failure: 1, fumble: 0 };

export function summarizeCallOfCthulhu(roll, target, modifier = 0) {
  const value = roll.value;
  let outcome;
  if (value === 1) outcome = 'critical';                 // 01 always a Critical
  else if (value === 100) outcome = 'fumble';            // 100 always Fumbles
  else if (target === null) outcome = 'unresolved';
  else if (target < 50 && value >= 96) outcome = 'fumble';
  else if (value <= Math.floor(target / 5)) outcome = 'extreme';
  else if (value <= Math.floor(target / 2)) outcome = 'hard';
  else if (value <= target) outcome = 'regular';
  else outcome = 'failure';
  const succeeded = outcome === 'critical' || outcome === 'extreme'
    || outcome === 'hard' || outcome === 'regular';
  return {
    kind: 'coc',
    tens: roll.kept, ones: roll.ones, value, target, modifier,
    outcome,
    success: outcome === 'unresolved' ? null : succeeded,
  };
}

const COC_OUTCOME_LABEL = {
  critical: 'Critical', extreme: 'Extreme Success', hard: 'Hard Success',
  regular: 'Success', failure: 'Failure', fumble: 'Fumble',
};

export function callOfCthulhuHeadline(result) {
  const s = result.summary;
  if (s.outcome === 'unresolved') return { kind: 'number', text: String(s.value) };
  const variant = (s.outcome === 'critical' || s.outcome === 'extreme') ? 'roll-crit-success'
    : (s.outcome === 'hard' || s.outcome === 'regular') ? 'roll-success'
    : s.outcome === 'fumble' ? 'roll-crit-failure'
    : 'roll-failure';
  return { kind: 'text', text: COC_OUTCOME_LABEL[s.outcome], variant };
}

export function describeCallOfCthulhu(result) {
  const s = result.summary;
  const parts = [];
  if (s.outcome !== 'unresolved') parts.push(COC_OUTCOME_LABEL[s.outcome]);
  const valueLabel = s.value === 100 ? '100' : String(s.value).padStart(2, '0');
  const tensLabel = String(s.tens).padStart(2, '0');
  parts.push(`rolled ${valueLabel} (${tensLabel} + ${s.ones})`);
  if (s.target !== null) parts.push(`under ${s.target}`);
  if (s.modifier > 0) parts.push(s.modifier === 1 ? 'bonus die' : `${s.modifier} bonus dice`);
  else if (s.modifier < 0) parts.push(-s.modifier === 1 ? 'penalty die' : `${-s.modifier} penalty dice`);
  return parts.join(' · ');
}

// ---- Delta Green ----
//
// A d100 rolled UNDER the target (skill, or a stat x5). 01 always succeeds and
// is a Critical; 100 always fails and is a Fumble. Matching digits (doubles)
// make any success a Critical and any failure a Fumble. Notation: "dg:60" or
// bare "dg:".
const DG_REGEX = /^dg:(\d+)?$/;

export function parseDeltaGreen(src) {
  const m = DG_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Delta Green roll like "dg:60"');
  const target = m[1] === undefined ? null : Number(m[1]);
  if (target !== null && (target < 1 || target > 99)) throw new Error('Target must be 1-99');
  return { target };
}

export function rollDeltaGreen(src) {
  const { target } = parseDeltaGreen(src);
  const r = rollPercentile(0);
  const dice = [
    { role: 'tens', value: r.kept, sides: 10, kept: true, rerolled: false, exploded: false },
    { role: 'ones', value: r.ones, sides: 10, kept: true, rerolled: false, exploded: false },
  ];
  return {
    schema: 2,
    system: 'deltagreen',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'deltagreen', count: dice.length, dice, subtotal: 0 }],
    summary: summarizeDeltaGreen(r, target),
  };
}

export function summarizeDeltaGreen(roll, target) {
  const value = roll.value;
  const double = roll.double;
  let outcome;
  if (target === null) outcome = 'unresolved';
  else {
    const alwaysFail = value === 100;
    const success = value === 1 || (!alwaysFail && value <= target);
    if (success) outcome = (value === 1 || double) ? 'critical' : 'success';
    else outcome = (value === 100 || double) ? 'fumble' : 'failure';
  }
  const succeeded = outcome === 'critical' || outcome === 'success';
  return {
    kind: 'deltagreen',
    tens: roll.kept, ones: roll.ones, value, double, target,
    outcome,
    success: outcome === 'unresolved' ? null : succeeded,
  };
}

const DG_OUTCOME_LABEL = {
  critical: 'Critical Success', success: 'Success',
  failure: 'Failure', fumble: 'Fumble',
};

export function deltaGreenHeadline(result) {
  const s = result.summary;
  if (s.outcome === 'unresolved') return { kind: 'number', text: String(s.value) };
  const variant = s.outcome === 'critical' ? 'roll-crit-success'
    : s.outcome === 'success' ? 'roll-success'
    : s.outcome === 'fumble' ? 'roll-crit-failure'
    : 'roll-failure';
  return { kind: 'text', text: DG_OUTCOME_LABEL[s.outcome], variant };
}

export function describeDeltaGreen(result) {
  const s = result.summary;
  const parts = [];
  if (s.outcome !== 'unresolved') parts.push(DG_OUTCOME_LABEL[s.outcome]);
  const valueLabel = s.value === 100 ? '100' : String(s.value).padStart(2, '0');
  const tensLabel = String(s.tens).padStart(2, '0');
  let read = `rolled ${valueLabel} (${tensLabel} + ${s.ones})`;
  if (s.double) read += ', doubles';
  parts.push(read);
  if (s.target !== null) parts.push(`under ${s.target}`);
  return parts.join(' · ');
}

// ---- Ironsworn / Starforged (the Ironsworn family, Shawn Tomkin, CC BY 4.0) ----
//
// One action roll underlies both games. Roll a d6 action die, add your stat and
// any adds, cap the score at 10, and set it against two d10 challenge dice. Beat
// BOTH → Strong Hit; beat ONE → Weak Hit; beat NEITHER → Miss. When the two
// challenge dice show the same number that is a Match — a twist whose meaning
// follows the outcome (a bonus on a hit, a worse turn on a miss). A progress
// roll drops the action die and sets a progress-track value (0-10) against the
// same two challenge dice. No target is needed: the challenge dice are the
// opposition, so every roll resolves on its own.
//
//   iron:        an action roll with no adds
//   iron:+2      an action roll, +2 to the action die
//   iron:-1      a negative modifier is legal
//   iron:p6      a progress roll with a track value of 6
const IRON_REGEX = /^iron:(p)?([+-]?\d+)?$/;

export function parseIronsworn(src) {
  const m = IRON_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected an Ironsworn roll like "iron:+2" or a progress roll "iron:p6"');
  const progress = Boolean(m[1]);
  const raw = m[2] === undefined ? 0 : Number(m[2]);
  if (progress) {
    if (raw < 0 || raw > 10) throw new Error('Progress must be 0-10');
    return { progress: true, modifier: null, progressScore: raw };
  }
  if (raw < -9 || raw > 20) throw new Error('Modifier must be -9 to 20');
  return { progress: false, modifier: raw, progressScore: null };
}

export function rollIronsworn(src) {
  const { progress, modifier, progressScore } = parseIronsworn(src);
  const challenge = [randInt(10), randInt(10)];          // 1-10 each
  const match = challenge[0] === challenge[1];
  let actionDie = null, score;
  if (progress) {
    score = progressScore;
  } else {
    actionDie = randInt(6);                              // 1-6
    score = Math.max(0, Math.min(actionDie + modifier, 10)); // score is capped at 10
  }
  const dice = [];
  if (!progress) dice.push({ role: 'action', value: actionDie, sides: 6, kept: true, rerolled: false, exploded: false });
  for (const c of challenge) {
    dice.push({ role: 'challenge', value: c, sides: 10, beaten: score > c, matched: match, kept: true, rerolled: false, exploded: false });
  }
  return {
    schema: 2,
    system: 'ironsworn',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'ironsworn', count: dice.length, dice, subtotal: 0 }],
    summary: summarizeIronsworn({ progress, actionDie, modifier, score, challenge, match }),
  };
}

export function summarizeIronsworn(r) {
  const beats = r.challenge.filter(c => r.score > c).length;
  const outcome = beats === 2 ? 'strong' : beats === 1 ? 'weak' : 'miss';
  return {
    kind: 'ironsworn',
    progress: r.progress,
    actionDie: r.actionDie,
    modifier: r.progress ? null : r.modifier,
    score: r.score,
    challenge: r.challenge,
    match: r.match,
    beats,
    outcome,
    success: outcome !== 'miss',
  };
}

const IRON_OUTCOME_LABEL = { strong: 'Strong Hit', weak: 'Weak Hit', miss: 'Miss' };

export function ironswornHeadline(result) {
  const s = result.summary;
  const variant = s.outcome === 'strong' ? 'band-hit'
    : s.outcome === 'weak' ? 'band-partial'
    : 'band-miss';
  const text = s.match ? `${IRON_OUTCOME_LABEL[s.outcome]} — Match` : IRON_OUTCOME_LABEL[s.outcome];
  return { kind: 'text', text, variant };
}

export function describeIronsworn(result) {
  const s = result.summary;
  const parts = [IRON_OUTCOME_LABEL[s.outcome]];
  if (s.progress) {
    parts.push(`progress ${s.score} vs ${s.challenge.join(', ')}`);
  } else {
    const mod = s.modifier ? (s.modifier > 0 ? ` + ${s.modifier}` : ` − ${-s.modifier}`) : '';
    parts.push(`action ${s.actionDie}${mod} = ${s.score} vs ${s.challenge.join(', ')}`);
  }
  if (s.match) parts.push('match');
  return parts.join(' · ');
}

// ---- Cards (the Woodcut deck) ----
//
// Not dice: a deck is drawn WITHOUT replacement, so it is stateful in a way no
// die is. The stateless parts live here — notation, shuffling, and the
// formatters — while the deck's order and position belong to the app (they
// persist across reloads the way Mothership's Stress does).
//
//   deck:1        draw one card
//   deck:3        draw three
//
// Draws come off the top of a shuffled order; shuffling is an explicit action
// in the UI, not a notation. A draw larger than what remains takes what is
// left — the table answer, not an error.
//
// The deck's two settings follow the count as keyword flags, so every button
// in the picker has a typed equivalent and the field can fully describe the
// deck: "deck:3 jokers replace". Flags may be space- or plus-separated and are
// order-free; the field writes back the ones that are on.
const DECK_REGEX = /^deck:(\d+)\s*(.*)$/;

export function parseCards(src) {
  const m = DECK_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a draw like "deck:1" or "deck:3"');
  const draw = Number(m[1]);
  if (draw < 1 || draw > 10) throw new Error('Draw 1-10 cards');
  let jokers = false, replace = false;
  for (const tok of m[2].split(/[\s+]+/).filter(Boolean)) {
    if (tok === 'jokers' || tok === 'joker' || tok === 'j') jokers = true;
    else if (tok === 'replace' || tok === 'rep') replace = true;
    else throw new Error(`Unknown card option "${tok}" — try jokers or replace`);
  }
  return { draw, jokers, replace };
}

// A fresh shuffled order over the given card ids. The rng is injectable so
// tests can fix the order; the default is the same rejection-sampled crypto
// source the dice use.
export function newDeckOrder(ids, rng = randInt) {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng(i + 1) - 1; // randInt is 1-based
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function summarizeCards(drawn, remaining, total) {
  return {
    kind: 'cards',
    // drawn: [{id, label, red}] — labels are baked in at draw time so a peer
    // can format the roll without loading the art module.
    drawn,
    remaining,
    total,
    exhausted: remaining === 0,
  };
}

// The big readout: one card shows its own label; a handful shows the count.
export function cardsHeadline(result) {
  const s = result.summary;
  if (s.drawn.length === 0) return { kind: 'text', text: 'Deck empty' };
  if (s.drawn.length === 1) {
    return { kind: 'text', text: s.drawn[0].label, variant: s.drawn[0].red ? 'card-red' : undefined };
  }
  return { kind: 'number', text: String(s.drawn.length) };
}

export function describeCards(result) {
  const s = result.summary;
  const parts = [];
  if (s.drawn.length) parts.push(s.drawn.map(c => c.label).join('  '));
  else parts.push('nothing left to draw');
  parts.push(`${s.remaining} of ${s.total} left`);
  if (s.exhausted && s.drawn.length) parts.push('deck exhausted — shuffle to continue');
  return parts.join(' · ');
}

// ---- Tarot ----
//
// The tarot deck is the cards engine at 78: same draw-without-replacement
// order, same shuffle, plus reversals — each card's orientation is fixed at
// shuffle time, the way a real deck carries reversals through a spread.
//
// Keyword flags follow the count, like the playing deck. Reversals are on by
// default, so the field carries "upright" to turn them off rather than a token
// for the default; "majors" and "replace" appear when on:
// "tarot:3 majors upright".
const TAROT_REGEX = /^tarot:(\d+)\s*(.*)$/;

export function parseTarot(src) {
  const m = TAROT_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a draw like "tarot:1" or "tarot:3"');
  const draw = Number(m[1]);
  if (draw < 1 || draw > 10) throw new Error('Draw 1-10 cards');
  let reversals = true, majors = false, replace = false;
  for (const tok of m[2].split(/[\s+]+/).filter(Boolean)) {
    if (tok === 'upright' || tok === 'up') reversals = false;
    else if (tok === 'majors' || tok === 'major' || tok === 'maj') majors = true;
    else if (tok === 'replace' || tok === 'rep') replace = true;
    else throw new Error(`Unknown tarot option "${tok}" — try majors, upright, or replace`);
  }
  return { draw, reversals, majors, replace };
}

export function summarizeTarot(drawn, remaining, total) {
  return {
    kind: 'tarot',
    // drawn: [{id, label, rev}] — labels baked in at draw time, like cards,
    // so peers can format the draw without the art module.
    drawn,
    remaining,
    total,
    exhausted: remaining === 0,
  };
}

// ---- Carte napoletane ----
//
// The 40-card Italian deck (Neapolitan pattern): 1-7 plus Fante, Cavallo, Re
// in each of the four Italian suits (denari, coppe, spade, bastoni). Same draw
// engine as the other decks; the one flag is replace. It shares the cards
// summary/formatters — a draw is a draw, whichever deck it came off. `ita:` is
// the notation; `nap:` is accepted as an alias.
const NAP_REGEX = /^(?:ita|nap):(\d+)\s*(.*)$/;

export function parseNapoletane(src) {
  const m = NAP_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a draw like "nap:1" or "nap:3"');
  const draw = Number(m[1]);
  if (draw < 1 || draw > 10) throw new Error('Draw 1-10 cards');
  let replace = false;
  for (const tok of m[2].split(/[\s+]+/).filter(Boolean)) {
    if (tok === 'replace' || tok === 'rep') replace = true;
    else throw new Error(`Unknown option "${tok}" — try replace`);
  }
  return { draw, replace };
}

// ---- Hanafuda ----
//
// The 48-card Japanese flower deck: twelve months of four cards each. Same
// draw engine and formatters as the other decks; the one flag is replace.
// `hana:` is the notation; `koi:` and `hf:` are accepted as aliases.
const HANA_REGEX = /^(?:hana|koi|hf):(\d+)\s*(.*)$/;

export function parseHanafuda(src) {
  const m = HANA_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a draw like "hana:1" or "hana:8"');
  const draw = Number(m[1]);
  if (draw < 1 || draw > 10) throw new Error('Draw 1-10 cards');
  let replace = false;
  for (const tok of m[2].split(/[\s+]+/).filter(Boolean)) {
    if (tok === 'replace' || tok === 'rep') replace = true;
    else throw new Error(`Unknown option "${tok}" — try replace`);
  }
  return { draw, replace };
}

// ---- Uta-garuta ----
//
// The 100 yomifuda of the Ogura Hyakunin Isshu, drawn like any other deck.
// `uta:` is the notation; `karuta:` is accepted as an alias.
const UTA_REGEX = /^(?:uta|karuta):(\d+)\s*(.*)$/;

export function parseUtagaruta(src) {
  const m = UTA_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a draw like "uta:1" or "uta:5"');
  const draw = Number(m[1]);
  if (draw < 1 || draw > 10) throw new Error('Draw 1-10 cards');
  let replace = false, lang = 'both';
  for (const tok of m[2].split(/[\s+]+/).filter(Boolean)) {
    if (tok === 'replace' || tok === 'rep') replace = true;
    else if (tok === 'ja' || tok === 'jp') lang = 'ja';
    else if (tok === 'en') lang = 'en';
    else if (tok === 'both') lang = 'both';
    else throw new Error(`Unknown option "${tok}" — try replace, ja, or en`);
  }
  return { draw, replace, lang };
}

const tarotCardText = c => c.rev ? `${c.label} (reversed)` : c.label;

export function tarotHeadline(result) {
  const s = result.summary;
  if (s.drawn.length === 0) return { kind: 'text', text: 'Deck empty' };
  if (s.drawn.length === 1) {
    return { kind: 'text', text: tarotCardText(s.drawn[0]), variant: s.drawn[0].rev ? 'tarot-rev' : undefined };
  }
  return { kind: 'number', text: String(s.drawn.length) };
}

export function describeTarot(result) {
  const s = result.summary;
  const parts = [];
  if (s.drawn.length) parts.push(s.drawn.map(tarotCardText).join('  '));
  else parts.push('nothing left to draw');
  parts.push(`${s.remaining} of ${s.total} left`);
  if (s.exhausted && s.drawn.length) parts.push('deck exhausted — shuffle to continue');
  return parts.join(' · ');
}

// ---- Daggerheart (Duality Dice) ----
//
// The core roll is two d12s — a Hope die and a Fear die — summed with an
// optional modifier and compared to a Difficulty. Which die is higher decides
// the tone: Hope high hands the player a Hope, Fear high hands the GM a Fear.
// Matching dice are a Critical Success (a success regardless of the total, and
// it comes with Hope). Advantage/disadvantage add or subtract a d6.
//
// `advantage` is a signed count of d6 the pool carries: positive = that many
// advantage dice (each added), negative = that many disadvantage dice (each
// subtracted), 0 = none. Advantage and disadvantage cancel one-for-one, so a
// pool never holds both; multiple of one kind stack (e.g. an ally's Help).
//
//   dh:            just the duality
//   dh:+2          with a flat +2 (modifiers can be negative — dh:-1)
//   dh:@15         against difficulty 15
//   dh:adv         with one advantage d6
//   dh:adv2        with two advantage d6 (added)
//   dh:dis+1@15    with a disadvantage d6, +1, vs 15
const DH_REGEX = /^dh:(?:(adv|dis)(\d*))?([+-]\d+)?(?:@(\d+))?$/;

export function parseDaggerheart(src) {
  const m = DH_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Daggerheart roll like "dh:", "dh:+2", or "dh:adv@15"');
  let advantage = 0;
  if (m[1]) {
    const count = m[2] === '' || m[2] === undefined ? 1 : Number(m[2]);
    if (count < 1 || count > 20) throw new Error('Advantage/disadvantage dice must be 1-20');
    advantage = m[1] === 'adv' ? count : -count;
  }
  const modifier = m[3] ? Number(m[3]) : 0;
  const difficulty = m[4] === undefined ? null : Number(m[4]);
  if (Math.abs(modifier) > 100) throw new Error('Modifier must be -100 to 100');
  if (difficulty !== null && (difficulty < 1 || difficulty > 100)) {
    throw new Error('Difficulty must be 1-100');
  }
  return { advantage, modifier, difficulty };
}

export function rollDaggerheart(src) {
  const { advantage, modifier, difficulty } = parseDaggerheart(src);
  const hope = randInt(12), fear = randInt(12);
  const dice = [
    { value: hope, role: 'hope', sides: 12, kept: true, rerolled: false, exploded: false },
    { value: fear, role: 'fear', sides: 12, kept: true, rerolled: false, exploded: false },
  ];
  // One d6 per advantage (or disadvantage) source, each added (or subtracted).
  let mod = modifier;
  const n = Math.abs(advantage);
  const role = advantage > 0 ? 'advantage' : 'disadvantage';
  for (let i = 0; i < n; i++) {
    const v = randInt(6);
    dice.push({ value: v, role, sides: 6, kept: true, rerolled: false, exploded: false });
    mod += advantage > 0 ? v : -v;
  }
  const total = hope + fear + mod;
  return {
    schema: 2,
    system: 'daggerheart',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'daggerheart', count: dice.length, dice, subtotal: total }],
    summary: summarizeDaggerheart({ hope, fear, total, modifier, advantage, difficulty }),
  };
}

export function summarizeDaggerheart({ hope, fear, total, modifier = 0, advantage = 0, difficulty = null }) {
  const critical = hope === fear;
  const withHope = hope > fear;
  // A Critical always succeeds, whatever the total. Otherwise the total is
  // measured against the difficulty when one was set.
  const success = difficulty === null ? null : (critical || total >= difficulty);
  let outcome;
  if (critical) outcome = 'critical';
  else if (difficulty !== null) outcome = (success ? 'success-' : 'failure-') + (withHope ? 'hope' : 'fear');
  else outcome = withHope ? 'hope' : 'fear';
  return { kind: 'daggerheart', hope, fear, total, modifier, advantage, difficulty, critical, withHope, success, outcome };
}

const DH_OUTCOME_LABEL = {
  critical: 'Critical Success',
  'success-hope': 'Success with Hope',
  'success-fear': 'Success with Fear',
  'failure-hope': 'Failure with Hope',
  'failure-fear': 'Failure with Fear',
  hope: 'with Hope',
  fear: 'with Fear',
};

// The big readout is the total, tinted by the tone: gold for Hope, violet for
// Fear, a brighter gold for a Critical. `variant` carries that to the DOM.
export function daggerheartHeadline(result) {
  const s = result.summary;
  const variant = s.critical ? 'critical' : s.withHope ? 'hope' : 'fear';
  return { kind: 'number', text: String(s.total), variant };
}

export function describeDaggerheart(result) {
  const s = result.summary;
  const parts = [DH_OUTCOME_LABEL[s.outcome], `Hope ${s.hope}, Fear ${s.fear}`];
  const dice = result.groups[0].dice;
  const adv = dice.filter(d => d.role === 'advantage').map(d => d.value);
  const dis = dice.filter(d => d.role === 'disadvantage').map(d => d.value);
  if (adv.length) parts.push(`advantage +${adv.join(', +')}`);
  if (dis.length) parts.push(`disadvantage −${dis.join(', −')}`);
  if (s.modifier) parts.push(`${s.modifier > 0 ? '+' : '−'}${Math.abs(s.modifier)} modifier`);
  parts.push(s.difficulty !== null ? `total ${s.total} vs ${s.difficulty}` : `total ${s.total}`);
  return parts.join(' · ');
}

// ---- Genesys (narrative dice) ----
//
// The six FFG/Genesys narrative dice, by exact face table. A face carries a
// multiset of symbols (0-2 of them); the pool is reduced on two independent
// axes — Success cancels Failure, Advantage cancels Threat — while Triumph and
// Despair persist uncancelled (a Triumph also counts as a Success, a Despair
// also as a Failure). Star Wars is the same set plus a Force die, added later.
//
// s=success a=advantage t=triumph  f=failure h=threat d=despair
const S = 'success', A = 'advantage', TRI = 'triumph';
const F = 'failure', H = 'threat', DES = 'despair';

export const GENESYS_DICE = {
  // Boost — light blue d6.
  boost: { color: 'boost', sides: 6, faces: [[], [], [S], [A], [S, A], [A, A]] },
  // Setback — black d6.
  setback: { color: 'setback', sides: 6, faces: [[], [], [F], [F], [H], [H]] },
  // Ability — green d8.
  ability: { color: 'ability', sides: 8, faces: [[], [S], [S], [S, S], [A], [A], [S, A], [A, A]] },
  // Difficulty — purple d8.
  difficulty: { color: 'difficulty', sides: 8, faces: [[], [F], [F, F], [H], [H], [H], [H, H], [F, H]] },
  // Proficiency — yellow d12 (carries the Triumph).
  proficiency: {
    color: 'proficiency', sides: 12,
    faces: [[], [S], [S], [S, S], [S, S], [A], [S, A], [S, A], [S, A], [A, A], [A, A], [TRI]],
  },
  // Challenge — red d12 (carries the Despair).
  challenge: {
    color: 'challenge', sides: 12,
    faces: [[], [F], [F], [F, F], [F, F], [H], [H], [F, H], [F, H], [H, H], [H, H], [DES]],
  },
};

// Pool shorthand: gen:2A+1P+2D+1S — Ability, Proficiency, Boost, Setback,
// Difficulty, Challenge by their initials. The + separators are optional.
const GENESYS_LETTERS = { a: 'ability', p: 'proficiency', b: 'boost', s: 'setback', d: 'difficulty', c: 'challenge' };

export function parseGenesys(src) {
  const raw = String(src || '').trim().toLowerCase();
  const m = /^gen:(.+)$/.exec(raw);
  if (!m) throw new Error('Expected a Genesys pool like "gen:2A+1P+2D"');
  const body = m[1].replace(/[\s+]/g, '');
  if (!/^(\d*[apbsdc])+$/.test(body)) {
    throw new Error('Genesys dice are A P B S D C (Ability, Proficiency, Boost, Setback, Difficulty, Challenge)');
  }
  const pool = [];
  let total = 0;
  for (const t of body.matchAll(/(\d*)([apbsdc])/g)) {
    const count = t[1] === '' ? 1 : Number(t[1]);
    if (count < 1) throw new Error('Each die count must be at least 1');
    total += count;
    pool.push({ type: GENESYS_LETTERS[t[2]], count });
  }
  if (total < 1 || total > 100) throw new Error('Genesys pool must be 1-100 dice');
  return pool;
}

export function rollGenesys(src) {
  const pool = parseGenesys(src);
  const dice = [];
  for (const { type, count } of pool) {
    const def = GENESYS_DICE[type];
    for (let i = 0; i < count; i++) {
      const faceIndex = randInt(def.sides) - 1;
      dice.push({
        type, sides: def.sides, color: def.color,
        faceIndex, symbols: def.faces[faceIndex],
        value: faceIndex + 1, kept: true, rerolled: false, exploded: false,
      });
    }
  }
  return {
    schema: 2,
    system: 'genesys',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'genesys', count: dice.length, dice, subtotal: 0 }],
    summary: summarizeGenesys(dice),
  };
}

export function summarizeGenesys(dice) {
  const raw = { success: 0, advantage: 0, triumph: 0, failure: 0, threat: 0, despair: 0 };
  for (const d of dice) {
    for (const sym of d.symbols || []) raw[sym]++;
  }
  // Triumph counts as a Success and Despair as a Failure for the pass/fail axis,
  // but both are also reported on their own since they never cancel.
  const netSuccess = (raw.success + raw.triumph) - (raw.failure + raw.despair);
  const netAdvantage = raw.advantage - raw.threat;
  return {
    kind: 'genesys',
    ...raw,
    netSuccess,
    netAdvantage,
    success: netSuccess > 0 ? netSuccess : 0,
    failure: netSuccess < 0 ? -netSuccess : 0,
    advantage: netAdvantage > 0 ? netAdvantage : 0,
    threat: netAdvantage < 0 ? -netAdvantage : 0,
    raw,
  };
}

// The success/failure axis is the outcome; it leads. A wash (net 0) is a
// failure, since Genesys needs at least one net success to pass.
export function genesysHeadline(result) {
  const s = result.summary;
  const parts = [];
  if (s.netSuccess > 0) parts.push(`${s.netSuccess} Success`);
  else parts.push('Failure');
  if (s.netAdvantage > 0) parts.push(`${s.netAdvantage} Advantage`);
  else if (s.netAdvantage < 0) parts.push(`${-s.netAdvantage} Threat`);
  if (s.raw.triumph) parts.push(s.raw.triumph > 1 ? `${s.raw.triumph} Triumph` : 'Triumph');
  if (s.raw.despair) parts.push(s.raw.despair > 1 ? `${s.raw.despair} Despair` : 'Despair');
  return { kind: 'text', text: parts.join(' · ') };
}

export function describeGenesys(result) {
  const s = result.summary;
  // The net result, spelled out, then the raw tally so the cancellation is
  // auditable ("2 success, 3 failure → net 1 failure").
  const net = genesysHeadline(result).text;
  const r = s.raw;
  const rawParts = [];
  const pushRaw = (n, one, many) => { if (n) rawParts.push(`${n} ${n === 1 ? one : many}`); };
  pushRaw(r.success, 'success', 'success');
  pushRaw(r.advantage, 'advantage', 'advantage');
  pushRaw(r.triumph, 'Triumph', 'Triumph');
  pushRaw(r.failure, 'failure', 'failure');
  pushRaw(r.threat, 'threat', 'threat');
  pushRaw(r.despair, 'Despair', 'Despair');
  const rolled = rawParts.length ? `rolled ${rawParts.join(', ')}` : 'all blank';
  return `${net} · ${rolled}`;
}

// The symbols a face shows, for the renderer.
export function genesysFace(type, faceIndex) {
  return GENESYS_DICE[type]?.faces[faceIndex] ?? [];
}

// ---- Fate / Fudge ----
//
// NdF[+/-M]: N Fudge dice, each a d6 with two + faces, two − faces and two
// blanks, so a die reads +1 / −1 / 0. The result is the net sum plus an optional
// skill modifier. N defaults to 4 (the standard 4dF, net −4…+4).
const FATE_REGEX = /^(\d+)?df([+-]\d+)?$/;

export function parseFate(src) {
  const m = FATE_REGEX.exec(String(src || '').trim().toLowerCase());
  if (!m) throw new Error('Expected a Fate pool like "4dF" or "4dF+2"');
  const count = m[1] === undefined ? 4 : Number(m[1]);
  const modifier = m[2] === undefined ? 0 : Number(m[2]);
  if (count < 1 || count > 100) throw new Error('Fate dice must be 1-100');
  if (Math.abs(modifier) > 100) throw new Error('Modifier must be -100 to 100');
  return { count, modifier };
}

export function rollFate(src) {
  const { count, modifier } = parseFate(src);
  // Each die is a uniform d6; two faces each map to +1, −1 and 0. Rolling the
  // d6 and mapping keeps the die an honest cube with an exact face distribution.
  const dice = [];
  for (let i = 0; i < count; i++) {
    const face = randInt(6);
    const value = face <= 2 ? 1 : face <= 4 ? -1 : 0;
    dice.push({ value, kept: true, rerolled: false, exploded: false });
  }
  return {
    schema: 2,
    system: 'fate',
    notation: String(src),
    groups: [{ kind: 'dice', dieType: 'fate', sides: 6, count, dice, subtotal: 0 }],
    summary: summarizeFate(dice, modifier, count),
  };
}

export function summarizeFate(dice, modifier = 0, count = dice.length) {
  let plus = 0, minus = 0, blank = 0, sum = 0;
  for (const d of dice) {
    if (d.value > 0) plus++;
    else if (d.value < 0) minus++;
    else blank++;
    sum += d.value;
  }
  return { kind: 'fate', count, modifier, sum, total: sum + modifier, plus, minus, blank };
}

// The Fate ladder: every total has an adjective, which is half the fun of the
// system. Clamped at the ends rather than left blank.
const FATE_LADDER = [
  'Mediocre', 'Average', 'Fair', 'Good', 'Great',
  'Superb', 'Fantastic', 'Epic', 'Legendary',
];
export function fateLadder(n) {
  if (n >= 8) return 'Legendary';
  if (n <= -2) return 'Terrible';
  if (n === -1) return 'Poor';
  return FATE_LADDER[n];
}

// A signed total, using a real minus sign so "−2" lines up with the glyphs.
function fateSigned(n) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

// The glyph a die shows: a plus, a minus, or a blank face.
export function fateFace(value) {
  return value > 0 ? 'plus' : value < 0 ? 'minus' : 'blank';
}

const FATE_SYMBOL = { 1: '+', 0: '▢', '-1': '−' };

export function describeFate(result) {
  const s = result.summary;
  const syms = result.groups
    .flatMap(g => g.dice)
    .map(d => FATE_SYMBOL[d.value] ?? '▢')
    .join(' ');
  const parts = [fateLadder(s.total), syms];
  // Only spell out the arithmetic when a modifier makes the total differ from
  // the dice; otherwise the glyphs already are the sum.
  if (s.modifier) {
    parts.push(`dice ${fateSigned(s.sum)}`, `${fateSigned(s.modifier)} modifier`);
  }
  return parts.join(' · ');
}

// The big readout: the signed total, at the numeral size (it is short).
export function fateHeadline(result) {
  return { kind: 'number', text: fateSigned(result.summary.total) };
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
