// Engine tests. Run: node tools/test.mjs
// Node 18 exposes webcrypto but not as a global in ESM; the app relies on the
// browser global, so provide it here rather than weakening dice.js.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { roll, describe, stepChain, DCC_CHAIN } from '../dice.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const throws = (name, fn) => {
  try { fn(); ok(name, false, 'expected an error'); }
  catch { pass++; }
};

// --- parsing ---
ok('bare d20 implies one die', roll('d20').groups[0].count === 1);
ok('3d6 has three dice', roll('3d6').groups[0].dice.length === 3);
ok('whitespace tolerated', roll(' 2 d 8 + 1 ').total >= 3);
ok('case insensitive', roll('2D6').groups[0].sides === 6);
ok('d% is d100', roll('d%').groups[0].sides === 100);
ok('d100 parses', roll('1d100').groups[0].sides === 100);
ok('multi-term', roll('1d20+3d6-2').groups.length === 3);

throws('empty input rejected', () => roll(''));
throws('trailing operator rejected', () => roll('1d6+'));
throws('garbage rejected', () => roll('hello'));
throws('too many dice rejected', () => roll('9999d6'));
throws('exploding d1 rejected', () => roll('3d1!'));

// --- ranges ---
// Every die must land within [1, sides], and the total within [n, n*sides].
// Testing that the *aggregate* reaches its extremes would be flaky: all-1s on
// 8d10 is a 1-in-10^8 event. Instead assert per-die coverage, which is reachable.
for (const [n, s] of [[1,20],[3,6],[8,10],[1,100],[2,30],[5,4],[1,7]]) {
  const seen = new Set();
  let bad = null, outOfRange = false;
  for (let i = 0; i < 4000; i++) {
    const r = roll(`${n}d${s}`);
    if (r.total < n || r.total > n * s) { bad = r.total; break; }
    for (const d of r.groups[0].dice) {
      if (d.value < 1 || d.value > s) { outOfRange = true; bad = d.value; break; }
      seen.add(d.value);
    }
    if (outOfRange) break;
  }
  ok(`${n}d${s} stays in range`, bad === null, bad !== null ? `saw ${bad}` : '');
  ok(`${n}d${s} covers every face`, seen.size === s, `saw ${seen.size} of ${s}`);
}

// --- d1 is degenerate but legal ---
ok('d1 always 1', Array.from({length: 50}, () => roll('1d1').total).every(v => v === 1));
ok('3d1 always 3', roll('3d1').total === 3);

// --- modifiers ---
ok('constant added', roll('1d1+7').total === 8);
ok('constant subtracted', roll('1d1-3').total === -2);

for (let i = 0; i < 500; i++) {
  const r = roll('4d6kh3');
  const kept = r.groups[0].dice.filter(d => d.kept);
  if (kept.length !== 3) { ok('kh3 keeps three', false, `kept ${kept.length}`); break; }
  const dropped = r.groups[0].dice.find(d => !d.kept);
  if (kept.some(k => k.value < dropped.value)) { ok('kh3 drops lowest', false); break; }
  if (r.total !== kept.reduce((a, d) => a + d.value, 0)) { ok('kh3 total', false); break; }
}
ok('4d6kh3 behaves', true);

for (let i = 0; i < 500; i++) {
  const r = roll('2d20kl1');
  const kept = r.groups[0].dice.filter(d => d.kept);
  if (kept.length !== 1) { ok('kl1 keeps one', false); break; }
  if (r.total !== Math.min(...r.groups[0].dice.map(d => d.value))) { ok('kl1 takes min', false); break; }
}
ok('2d20kl1 behaves', true);

ok('dl1 equals kh(n-1)', roll('4d6dl1').groups[0].dice.filter(d => d.kept).length === 3);
ok('dh1 equals kl(n-1)', roll('4d6dh1').groups[0].dice.filter(d => d.kept).length === 3);

// exploding: a d6! can exceed 6
let sawExplosion = false;
for (let i = 0; i < 3000 && !sawExplosion; i++) {
  if (roll('1d6!').total > 6) sawExplosion = true;
}
ok('exploding dice can exceed max', sawExplosion);

// reroll: 1d6r2 never yields 1 or 2
let sawLow = false;
for (let i = 0; i < 3000 && !sawLow; i++) {
  if (roll('1d6r2').total <= 2) sawLow = true;
}
ok('reroll suppresses low faces', !sawLow);

// r below full range must not hang
ok('r at max sides terminates', roll('1d6r6').total >= 1);

// --- distribution sanity ---
const counts = new Array(21).fill(0);
const N = 60000;
for (let i = 0; i < N; i++) counts[roll('1d20').total]++;
const expected = N / 20;
const worst = Math.max(...counts.slice(1).map(c => Math.abs(c - expected) / expected));
ok('d20 roughly uniform', worst < 0.08, `worst face deviates ${(worst*100).toFixed(1)}%`);

// --- dcc chain ---
ok('chain has 15 rungs', DCC_CHAIN.length === 15);
ok('chain steps up', stepChain(20, 1) === 24);
ok('chain steps down', stepChain(20, -1) === 16);
ok('chain clamps at top', stepChain(30, 1) === 30);
ok('chain clamps at bottom', stepChain(1, -1) === 1);
ok('chain jumps multiple', stepChain(6, 3) === 10);
ok('off-chain sides unchanged', stepChain(100, 1) === 100);

// --- describe ---
// The history keeps this alongside the total, so it has to account for every
// die: a total of 17 says nothing about which die produced it.
ok('describe shows dropped in parens', describe(roll('4d6kh3').groups).includes('('));
ok('describe includes notation', describe(roll('2d6').groups).startsWith('2d6'));
ok('describe handles negative', describe(roll('1d6-2').groups).includes('− 2'));

{
  // Every term appears, in order, with its own dice.
  const text = describe(roll('1d4+1d3+1d2').groups);
  ok('describe covers every term',
     /^1d4 \[\d\] \+ 1d3 \[\d\] \+ 1d2 \[\d\]$/.test(text), text);
}

{
  const text = describe(roll('3d6').groups);
  ok('describe lists each die', (text.match(/\d+/g) || []).length >= 4, text);
}

{
  // An exploded die is marked, or a d6 reading 11 looks like a bug.
  let marked = null;
  for (let i = 0; i < 3000 && !marked; i++) {
    const r = roll('1d6!');
    if (r.groups[0].dice[0].exploded) marked = describe(r.groups);
  }
  ok('describe marks an exploded die', marked && marked.includes('!'), marked || 'none seen');
}

{
  // A rerolled die is marked, so an ordinary-looking result is not mistaken for
  // a first roll.
  let marked = null;
  for (let i = 0; i < 3000 && !marked; i++) {
    const r = roll('1d4r1');
    if (r.groups[0].dice[0].rerolled) marked = describe(r.groups);
  }
  ok('describe marks a rerolled die', marked && marked.includes('↻'), marked || 'none seen');
}

ok('describe of a dropped die keeps it visible',
   /\(\d+\)/.test(describe(roll('4d6dl1').groups)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
