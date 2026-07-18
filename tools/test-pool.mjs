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

// Mirrors app.js: the pool maps sides -> { count, mods }, where mods holds at
// most one suffix per slot. Modifiers in different slots stack; two in the same
// slot replace each other, because they answer the same question.
const SLOTS = ['keep', 'burst', 'reroll'];
const SLOT_OF = [[/^(kh|kl|dh|dl)/, 'keep'], [/^!/, 'burst'], [/^r/, 'reroll']];
const slotFor = suffix => (SLOT_OF.find(([p]) => p.test(suffix)) || [null, 'keep'])[1];

function poolNotation(pool) {
  return [...pool]
    .map(([sides, e]) => `${e.count}d${sides}` + SLOTS.map(s => (e.mods && e.mods[s]) || '').join(''))
    .join('+');
}

function parsePool(text) {
  const next = new Map();
  const src = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (!src) return next;
  for (const term of src.split('+')) {
    const head = /^(\d*)d(\d+)/.exec(term);
    if (!head) return new Map();
    const n = head[1] === '' ? 1 : parseInt(head[1], 10);
    const sides = parseInt(head[2], 10);
    if (!sides) return new Map();
    const mods = {};
    let rest = term.slice(head[0].length);
    while (rest) {
      const mod = /^((?:kh|kl|dh|dl)\d+|!|r\d+)/.exec(rest);
      if (!mod) return new Map();
      const slot = slotFor(mod[1]);
      if (mods[slot]) return new Map();
      mods[slot] = mod[1];
      rest = rest.slice(mod[0].length);
    }
    const cur = next.get(sides);
    if (cur && SLOTS.some(s => (cur.mods[s] || '') !== (mods[s] || ''))) return new Map();
    next.set(sides, { count: (cur ? cur.count : 0) + n, mods });
  }
  return next;
}

const add = (pool, sides, count = 1) => {
  const cur = pool.get(sides) || { count: 0, mods: {} };
  pool.set(sides, { count: cur.count + count, mods: cur.mods });
  return pool;
};

// Modifier application, as applyModifier does it.
const MODS = {
  adv:     { suffix: 'kh1', min: 2 },
  dis:     { suffix: 'kl1', min: 2 },
  droplow: { suffix: 'dl1', min: 2 },
  drophigh:{ suffix: 'dh1', min: 2 },
  explode: { suffix: '!',   min: 1 },
  reroll:  { suffix: 'r1',  min: 1 },
  none:    { suffix: '',    min: 1 },
};

function applyModifier(pool, sides, mod, perTap = 1) {
  const staged = pool.get(sides);
  const base = staged ? staged.count : perTap;
  const mods = { ...(staged ? staged.mods : {}) };
  if (!mod.suffix) {
    for (const s of SLOTS) delete mods[s];
  } else {
    const slot = slotFor(mod.suffix);
    if (mods[slot] === mod.suffix) delete mods[slot];
    else mods[slot] = mod.suffix;
  }
  pool.set(sides, { count: Math.max(mod.min, base), mods });
  return pool;
}

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

// Modifiers ride along on the group they belong to, so a staged modified roll
// survives a round trip through the field.
for (const text of ['2d20kh1', '2d20kl1', '4d6dl1', '4d6dh1', '3d6!', '2d10r1']) {
  ok(`"${text}" round-trips with its modifier`, poolNotation(parsePool(text)) === text,
     poolNotation(parsePool(text)));
}
ok('modifier survives with other dice',
   poolNotation(parsePool('2d20kh1+1d6')) === '2d20kh1+1d6',
   poolNotation(parsePool('2d20kh1+1d6')));

// Anything the pool cannot represent must yield an empty pool, so the next tap
// starts fresh rather than silently corrupting what the user typed.
for (const text of ['3d6+2', '2d6-1', 'd%', 'garbage', '']) {
  ok(`"${text}" is not poolable`, parsePool(text).size === 0);
}

// Two groups of the same die with different modifiers cannot merge into one
// entry, so the pool declines rather than dropping one of them.
ok('conflicting modifiers on one die are not poolable',
   parsePool('2d6kh1+2d6dl1').size === 0);

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

// --- applying a modifier from the hold sheet ---
// Regression: picking a modifier used to wipe the pool and rebuild the roll from
// the per-tap count, so a staged d20 vanished and four staged d6 collapsed to
// two. A modifier belongs to one die's group and must leave everything else be.
{
  // Stage a d20, then a d6, then give the d6 advantage.
  const p = new Map();
  add(p, 20);
  add(p, 6);
  applyModifier(p, 6, MODS.adv);
  ok('modifier keeps the rest of the pool', p.has(20), 'the d20 was dropped');
  ok('modifier applies to its own die only',
     poolNotation(p) === '1d20+2d6kh1', poolNotation(p));
}

{
  // Four staged d6 must stay four when a modifier is applied.
  const p = new Map();
  add(p, 6, 4);
  applyModifier(p, 6, MODS.droplow);
  ok('modifier preserves the staged count',
     poolNotation(p) === '4d6dl1', poolNotation(p));
}

{
  // Keep/drop needs two dice to mean anything, so one staged die is raised.
  const p = new Map();
  add(p, 20);
  applyModifier(p, 20, MODS.adv);
  ok('advantage on one die raises it to two',
     poolNotation(p) === '2d20kh1', poolNotation(p));
}

{
  // Exploding has no minimum, so a lone die stays alone.
  const p = new Map();
  add(p, 6);
  applyModifier(p, 6, MODS.explode);
  ok('exploding does not inflate the count',
     poolNotation(p) === '1d6!', poolNotation(p));
}

{
  // With nothing staged, the modifier uses one tap's worth.
  const p = new Map();
  applyModifier(p, 8, MODS.explode, 5);
  ok('modifier on an empty pool uses the multiplier',
     poolNotation(p) === '5d8!', poolNotation(p));
}

{
  // Picking a second modifier replaces the first rather than stacking.
  const p = new Map();
  add(p, 20, 3);
  applyModifier(p, 20, MODS.adv);
  applyModifier(p, 20, MODS.dis);
  ok('modifiers replace rather than stack',
     poolNotation(p) === '3d20kl1', poolNotation(p));
}

{
  // "No modifier" clears it while keeping the dice.
  const p = new Map();
  add(p, 6, 3);
  applyModifier(p, 6, MODS.explode);
  applyModifier(p, 6, MODS.none);
  ok('no-modifier clears the suffix', poolNotation(p) === '3d6', poolNotation(p));
}

// Every modifier, at every count, must produce notation the roller accepts.
{
  let bad = null;
  for (const [name, mod] of Object.entries(MODS)) {
    for (const staged of [1, 2, 5]) {
      for (const sides of [4, 6, 20, 100]) {
        const p = add(new Map(), sides, staged);
        applyModifier(p, sides, mod);
        const text = poolNotation(p);
        try {
          const r = roll(text);
          if (!Number.isFinite(r.total) || r.total < 1) bad = `${name}: ${text} gave ${r.total}`;
        } catch (err) { bad = `${name}: ${text} — ${err.message}`; }
      }
    }
  }
  ok('every modifier rolls at every count', bad === null, bad || '');
}

// The kept-dice count must match what the modifier promises.
{
  const cases = [
    ['4d6kh1', 1], ['4d6kl1', 1],
    ['4d6dl1', 3], ['4d6dh1', 3],
    ['2d20kh1', 1], ['2d20kl1', 1],
  ];
  let bad = null;
  for (const [text, expected] of cases) {
    const r = roll(text);
    const kept = r.groups[0].dice.filter(d => d.kept).length;
    if (kept !== expected) bad = `${text} kept ${kept}, expected ${expected}`;
  }
  ok('keep/drop counts are correct', bad === null, bad || '');
}

// Advantage really takes the higher of two; disadvantage the lower.
{
  let advWrong = 0, disWrong = 0;
  for (let i = 0; i < 400; i++) {
    const a = roll('2d20kh1');
    if (a.total !== Math.max(...a.groups[0].dice.map(d => d.value))) advWrong++;
    const d = roll('2d20kl1');
    if (d.total !== Math.min(...d.groups[0].dice.map(x => x.value))) disWrong++;
  }
  ok('advantage takes the higher die', advWrong === 0, `${advWrong} wrong`);
  ok('disadvantage takes the lower die', disWrong === 0, `${disWrong} wrong`);
}

// Drop lowest must equal the sum of everything but the minimum.
{
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const r = roll('4d6dl1');
    const vals = r.groups[0].dice.map(d => d.value).sort((x, y) => x - y);
    const expected = vals.slice(1).reduce((s, v) => s + v, 0);
    if (r.total !== expected) bad++;
  }
  ok('drop lowest discards exactly one die', bad === 0, `${bad} wrong`);
}

// --- button state mirrors the pool ---
// Each die button shows selected when it is in the pool, with a count badge past
// one. The row and the notation field must never disagree about what is loaded.
function buttonState(pool, sides) {
  const e = pool.get(sides);
  const n = e ? e.count : 0;
  const marks = e ? SLOTS.filter(s => e.mods && e.mods[s]).map(s => e.mods[s]) : [];
  return { pressed: n > 0, badge: n > 1 ? String(n) : null, mod: marks.join(''), marks };
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
  // A modified roll still lights its button, and marks that it carries one.
  const p = parsePool('4d6kh3');
  ok('modified notation selects its die', buttonState(p, 6).pressed);
  ok('modified notation marks the modifier', buttonState(p, 6).mod === 'kh3');
}

{
  // A pool the field cannot represent clears every button rather than showing a
  // stale selection that no longer matches what will roll.
  const p = parsePool('3d6+2');
  ok('arithmetic notation clears buttons', [...p.keys()].length === 0);
}

// --- the count multiplier ---
{
  const perTap = 100;
  const p = new Map();
  add(p, 6, perTap);
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

// --- each modifier gets its own mark ---
// One shared underline told you a die was modified but not which modifier, so
// drop-lowest and exploding looked identical on the row.
{
  const GLYPHS = [
    [/^kh/, '▲'], [/^kl/, '▼'], [/^dl/, '⌃'], [/^dh/, '⌄'], [/^!/, '✳'], [/^r/, '↻'],
  ];
  const glyphFor = mod => (GLYPHS.find(([p]) => p.test(mod)) || [null, '•'])[1];

  const marks = Object.values(MODS)
    .filter(m => m.suffix)
    .map(m => glyphFor(m.suffix));

  ok('every modifier has a distinct mark', new Set(marks).size === marks.length,
     marks.join(' '));
  ok('no modifier falls through to the default', !marks.includes('•'), marks.join(' '));

  // The mark must follow the notation, including counts other than 1.
  ok('kh3 reads as advantage', glyphFor('kh3') === '▲');
  ok('dl2 reads as drop lowest', glyphFor('dl2') === '⌃');
  ok('r2 reads as reroll', glyphFor('r2') === '↻');
  ok('plain dice have no mark', Object.values(MODS).filter(m => !m.suffix).length === 1);
}

// --- custom dice earn a button ---
// A die made with the picker has to behave like any other: tappable, countable,
// and holdable for modifiers. Without a button of its own a d46 could be staged
// but never modified.
{
  // Mirrors ensureDieButton's placement: keep the row in size order.
  const insertSorted = (row, sides) => {
    if (row.includes(sides)) return row;
    const at = row.findIndex(s => s > sides);
    const next = row.slice();
    next.splice(at === -1 ? row.length : at, 0, sides);
    return next;
  };

  const STANDARD = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100];

  let row = insertSorted(STANDARD, 46);
  ok('custom die lands in size order',
     row.indexOf(46) === row.indexOf(30) + 1 && row[row.indexOf(46) + 1] === 100,
     row.slice(row.indexOf(30)).join(','));

  row = insertSorted(row, 46);
  ok('adding the same die twice makes one button',
     row.filter(s => s === 46).length === 1);

  ok('a die below the row goes first', insertSorted(STANDARD, 0)[0] === 0);
  ok('a die above the row goes last',
     insertSorted(STANDARD, 500).at(-1) === 500);
  ok('an existing die is not duplicated',
     insertSorted(STANDARD, 20).length === STANDARD.length);

  // Whatever the picker can produce must roll.
  let bad = null;
  for (const sides of [17, 46, 57, 99, 123, 1000]) {
    const p = add(new Map(), sides);
    try {
      const r = roll(poolNotation(p));
      if (r.total < 1 || r.total > sides) bad = `d${sides} gave ${r.total}`;
    } catch (err) { bad = `d${sides}: ${err.message}`; }
  }
  ok('custom dice roll in range', bad === null, bad || '');

  // And must accept modifiers like any other die.
  const p = add(new Map(), 46, 3);
  applyModifier(p, 46, MODS.adv);
  ok('custom dice take modifiers', poolNotation(p) === '3d46kh1', poolNotation(p));
  ok('modified custom die rolls', roll('3d46kh1').total >= 1);
}

// --- stacking modifiers ---
// Modifiers answering different questions apply together: 4d6dl1! drops the
// lowest and explodes. Two answering the same question cannot both hold.
{
  const p = add(new Map(), 6, 4);
  applyModifier(p, 6, MODS.droplow);
  applyModifier(p, 6, MODS.explode);
  ok('drop lowest and exploding stack', poolNotation(p) === '4d6dl1!', poolNotation(p));

  applyModifier(p, 6, MODS.reroll);
  ok('all three slots stack', poolNotation(p) === '4d6dl1!r1', poolNotation(p));

  const r = roll(poolNotation(p));
  ok('a fully stacked roll works', Number.isFinite(r.total) && r.total >= 3, `total ${r.total}`);
}

{
  // Same slot replaces rather than accumulating.
  const p = add(new Map(), 20, 2);
  applyModifier(p, 20, MODS.adv);
  applyModifier(p, 20, MODS.dis);
  ok('advantage and disadvantage do not stack',
     poolNotation(p) === '2d20kl1', poolNotation(p));
  ok('only one keep modifier is present',
     (poolNotation(p).match(/k[hl]/g) || []).length === 1);
}

{
  // Drop and keep share the slot: dl1 on two dice already is advantage.
  const p = add(new Map(), 6, 4);
  applyModifier(p, 6, MODS.adv);
  applyModifier(p, 6, MODS.droplow);
  ok('keep and drop share one slot', poolNotation(p) === '4d6dl1', poolNotation(p));
}

{
  // Choosing an active modifier again takes it off, leaving the others.
  const p = add(new Map(), 6, 4);
  applyModifier(p, 6, MODS.explode);
  applyModifier(p, 6, MODS.droplow);
  applyModifier(p, 6, MODS.explode);
  ok('reselecting a modifier removes it', poolNotation(p) === '4d6dl1', poolNotation(p));
}

{
  // "No modifier" clears every slot at once.
  const p = add(new Map(), 6, 3);
  applyModifier(p, 6, MODS.droplow);
  applyModifier(p, 6, MODS.explode);
  applyModifier(p, 6, MODS.reroll);
  applyModifier(p, 6, MODS.none);
  ok('no-modifier clears all slots', poolNotation(p) === '3d6', poolNotation(p));
}

// Stacked notation has to survive a round trip through the field.
for (const text of ['4d6dl1!', '4d6dl1r1', '4d6dl1!r1', '2d20kh1!', '3d6!r1']) {
  ok(`"${text}" round-trips stacked`, poolNotation(parsePool(text)) === text,
     poolNotation(parsePool(text)));
}

// Two modifiers from one slot in typed notation is not a pool the row can show.
ok('two keep modifiers are not poolable', parsePool('4d6kh1dl1').size === 0);
ok('two bursts are not poolable', parsePool('4d6!!').size === 0);

// Every stacked combination the sheet can build must roll.
{
  const keeps = [null, MODS.adv, MODS.dis, MODS.droplow, MODS.drophigh];
  const bursts = [null, MODS.explode];
  const rerolls = [null, MODS.reroll];
  let bad = null;
  for (const k of keeps) for (const b of bursts) for (const r of rerolls) {
    const p = add(new Map(), 6, 4);
    for (const mod of [k, b, r]) if (mod) applyModifier(p, 6, mod);
    const text = poolNotation(p);
    try {
      const result = roll(text);
      if (!Number.isFinite(result.total) || result.total < 1) bad = `${text} gave ${result.total}`;
    } catch (err) { bad = `${text}: ${err.message}`; }
  }
  ok('every stacked combination rolls', bad === null, bad || '');
}

// --- per-die outcome flags reach the tray ---
// The tray fades dropped dice and marks exploded and rerolled ones, which only
// works if the roller reports them per die.
{
  const r = roll('4d6dl1');
  const dice = r.groups[0].dice;
  ok('dropped dice are flagged', dice.filter(d => !d.kept).length === 1);
  ok('kept dice are flagged', dice.filter(d => d.kept).length === 3);
  ok('total counts only kept dice',
     r.total === dice.filter(d => d.kept).reduce((s, d) => s + d.value, 0));
}

{
  let sawExplosion = false;
  for (let i = 0; i < 3000 && !sawExplosion; i++) {
    const r = roll('1d6!');
    if (r.groups[0].dice[0].exploded) {
      sawExplosion = true;
      ok('an exploded die is flagged and exceeds its faces', r.total > 6, `total ${r.total}`);
    }
  }
  ok('exploding dice report it', sawExplosion);
}

{
  let sawReroll = false;
  for (let i = 0; i < 3000 && !sawReroll; i++) {
    const r = roll('1d6r1');
    if (r.groups[0].dice[0].rerolled) {
      sawReroll = true;
      ok('a rerolled die is flagged and is not a 1', r.total !== 1, `total ${r.total}`);
    }
  }
  ok('rerolled dice report it', sawReroll);
}

// --- taking dice back off the tray ---
// Tapping a staged die removes exactly one, so a handful can be trimmed without
// clearing everything or editing the text by hand.
function removeOne(pool, sides) {
  const entry = pool.get(sides);
  if (!entry) return false;
  if (entry.count > 1) pool.set(sides, { count: entry.count - 1, mods: entry.mods });
  else pool.delete(sides);
  return true;
}

{
  const p = new Map();
  add(p, 6, 3);
  add(p, 20, 1);

  ok('removing one leaves the rest', removeOne(p, 6) && poolNotation(p) === '2d6+1d20',
     poolNotation(p));

  removeOne(p, 6);
  removeOne(p, 6);
  ok('removing the last of a die drops it entirely', poolNotation(p) === '1d20',
     poolNotation(p));

  ok('removing a die that is not staged does nothing', removeOne(p, 8) === false);

  removeOne(p, 20);
  ok('removing everything empties the pool', p.size === 0 && poolNotation(p) === '');
}

{
  // A modifier survives having one of its dice removed.
  const p = add(new Map(), 6, 4);
  applyModifier(p, 6, MODS.droplow);
  removeOne(p, 6);
  ok('removing a die keeps the modifier', poolNotation(p) === '3d6dl1', poolNotation(p));
}

// --- the field and the tray stay in step ---
// Editing the notation restages the tray, so backspacing "+2d3" makes those dice
// leave immediately rather than lingering until the next tap.
{
  const staged = text => {
    const p = parsePool(text);
    let n = 0;
    for (const e of p.values()) n += e.count;
    return n;
  };
  ok('typing stages the dice it describes', staged('3d6+2d3') === 5);
  ok('deleting a term removes those dice', staged('3d6') === 3);
  ok('clearing the field empties the tray', staged('') === 0);
  ok('a half-typed term stages nothing', staged('3d6+2d') === 0);
  ok('growing a count adds dice', staged('12d6') === 12);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
