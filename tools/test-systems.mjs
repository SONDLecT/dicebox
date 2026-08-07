// V5 system-dice tests: parser, pool semantics (hunger replaces, not adds),
// reducer rules (success counting, critical vs messy-critical, bestial failure),
// formatters and the dispatcher.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { parseV5, rollV5, summarizeV5, detectSystem, describeV5, rollAny, v5Face, v5Headline } from '../system-dice.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const d = (value, hunger) => ({ value, hunger, kept: true });

// ---- parsing ----
ok('parse v5:8h3', eq(parseV5('v5:8h3'), { pool: 8, hunger: 3, difficulty: null }));
ok('parse v5:8h3@3', eq(parseV5('v5:8h3@3'), { pool: 8, hunger: 3, difficulty: 3 }));
ok('parse v5:8', eq(parseV5('v5:8'), { pool: 8, hunger: 0, difficulty: null }));
ok('parse v5:8@2', eq(parseV5('v5:8@2'), { pool: 8, hunger: 0, difficulty: 2 }));
for (const bad of ['v5:3h9', 'v5:0', 'v5:101', 'v5:8@0', 'v5:8@11', '4d6', 'v4:8']) {
  ok(`reject bad ${bad}`, (() => { try { parseV5(bad); return false; } catch { return true; } })());
}

// ---- system detection / dispatcher ----
ok('detect v5', detectSystem('v5:8h3') === 'v5');
ok('detect numeric', detectSystem('4d6') === 'numeric');
ok('rollAny routes v5', rollAny('v5:6h2').system === 'v5');
ok('rollAny defers numeric', rollAny('4d6').deferred === true && rollAny('4d6').system === 'numeric');

// ---- pool semantics: hunger REPLACES dice, pool stays fixed ----
{
  const r = rollV5('v5:8h3');
  ok('pool size fixed at 8', r.groups[0].dice.length === 8);
  ok('exactly 3 hunger dice', r.groups[0].dice.filter(x => x.hunger).length === 3);
  ok('5 normal dice', r.groups[0].dice.filter(x => !x.hunger).length === 5);
  ok('values in 1..10', r.groups[0].dice.every(x => x.value >= 1 && x.value <= 10));
  ok('summary kind v5', r.summary.kind === 'v5');
  ok('schema 2', r.schema === 2);
  ok('system v5', r.system === 'v5');
}
// no hunger
{
  const r = rollV5('v5:6');
  ok('no hunger -> 0 blood dice', r.groups[0].dice.filter(x => x.hunger).length === 0);
}

// ---- reducer rules (deterministic dice) ----
// Messy Critical: two 10s, at least one on a hunger die
{
  const s = summarizeV5([d(10, true), d(10, false), d(5, false), d(1, false)], 3, 4, 1);
  ok('messy-critical', s.outcome === 'messy-critical');
  ok('two 10s flagged', s.critTwo === true);
  ok('hungerTen=1', s.hungerTen === 1);
  ok('successes=4 (10=2+2)', s.successes === 4);
}
// Critical: two 10s, none on hunger
{
  const s = summarizeV5([d(10, false), d(10, false), d(1, false)], 3, 3, 0);
  ok('critical (not messy)', s.outcome === 'critical');
  ok('hungerTen=0', s.hungerTen === 0);
}
// Bestial Failure: test fails + hunger die shows 1
{
  const s = summarizeV5([d(4, false), d(2, false), d(1, true)], 3, 3, 1);
  ok('bestial-failure', s.outcome === 'bestial-failure');
  ok('successes=0', s.successes === 0);
}
// Hunger 1 but test succeeds -> NOT bestial
{
  const s = summarizeV5([d(8, false), d(8, false), d(8, false), d(1, true)], 3, 4, 1);
  ok('success despite hunger 1', s.outcome === 'success');
  ok('hungerOne noted', s.hungerOne === 1);
}
// Plain failure (no hunger 1)
{
  const s = summarizeV5([d(4, false), d(2, false), d(5, true)], 3, 3, 1);
  ok('plain failure', s.outcome === 'failure');
}
// Plain success with margin
{
  const s = summarizeV5([d(8, false), d(8, false), d(8, false), d(10, false)], 3, 4, 0);
  ok('success', s.outcome === 'success');
  ok('margin=2 (2+2+1... )', s.margin === 2); // 8=1,8=1,8=1,10=2 => 5 successes, diff 3 => +2
}
// 10 counts double: two 10s = 4 successes (2+2), plus the 6 adds 1
{
  const s = summarizeV5([d(10, false), d(10, false), d(6, false)], 3, 3, 0);
  ok('10s double to 2+2=4, 6 adds 1 => 5 successes', s.successes === 5);
}
// Difficulty omitted -> no bestial/failure assertion, but intrinsic critical resolves
{
  const s = summarizeV5([d(10, true), d(10, false)], null, 2, 1);
  ok('no-difficulty messy-critical', s.outcome === 'messy-critical');
  const s2 = summarizeV5([d(3, false), d(1, true)], null, 2, 1);
  ok('no-difficulty bestial unresolved (null)', s2.outcome === null);
  ok('no-difficulty still counts successes', s2.successes === 0);
}

// ---- formatter ----
{
  const r = rollV5('v5:4h1@3');
  r.summary = summarizeV5([d(10, true), d(10, false), d(5, false), d(2, false)], 3, 4, 1);
  const txt = describeV5(r);
  ok('formatter mentions Messy Critical', /Messy Critical/.test(txt));
  ok('formatter mentions successes', /4 successes/.test(txt));
  ok('formatter mentions two 10s', /two 10s/.test(txt));
}

// ---- face mapping (symbols are a rendering of the numeric d10 value) ----
{
  const cases = [
    // value, hunger, expected face
    [1, false, 'blank'], [5, false, 'blank'],
    [6, false, 'success'], [9, false, 'success'],
    [10, false, 'critical'],
    [1, true, 'skull'],
    [2, true, 'blank'], [5, true, 'blank'],
    [6, true, 'hunger-success'], [9, true, 'hunger-success'],
    [10, true, 'hunger-critical'],
  ];
  for (const [v, h, want] of cases) {
    ok(`v5Face(${v},${h}) = ${want}`, v5Face(v, h) === want);
  }
}

// ---- compact headline (short enough not to overflow the readout) ----
{
  const r = { summary: summarizeV5([d(10, true), d(10, false), d(5, false), d(2, false)], 3, 4, 1) };
  ok('headline messy-critical', v5Headline(r) === 'Messy Critical');
  const s2 = { summary: summarizeV5([d(8, false), d(8, false), d(8, false), d(10, false)], 3, 4, 0) };
  ok('headline success +margin', v5Headline(s2) === 'Success (+2)');
  const s3 = { summary: summarizeV5([d(3, false), d(1, true)], null, 2, 1) };
  ok('headline unresolved successes', v5Headline(s3) === '0 successes');
}

console.log(`\nsystem-dice: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
