// V5 system-dice tests: parser, pool semantics (hunger replaces, not adds),
// reducer rules (success counting, critical vs messy-critical, bestial failure),
// formatters and the dispatcher.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { parseV5, rollV5, rollRouse, summarizeV5, detectSystem, describeV5, rollAny, v5Face, v5Headline } from '../system-dice.js';
import { parseFate, rollFate, summarizeFate, describeFate, fateHeadline, fateFace, fateLadder } from '../system-dice.js';
import { parseGenesys, rollGenesys, summarizeGenesys, describeGenesys, genesysHeadline, genesysFace, GENESYS_DICE } from '../system-dice.js';
import { parseDaggerheart, rollDaggerheart, summarizeDaggerheart, describeDaggerheart, daggerheartHeadline } from '../system-dice.js';
import { parseCthulhuTech, rollCthulhuTech, summarizeCthulhuTech, describeCthulhuTech, cthulhutechHeadline } from '../system-dice.js';
import { parseYearZero, rollYearZero, pushYearZero, summarizeYearZero, describeYearZero, yearzeroHeadline } from '../system-dice.js';
import { parseBladeRunner, rollBladeRunner, pushBladeRunner, summarizeBladeRunner, describeBladeRunner, bladeRunnerHeadline } from '../system-dice.js';
import { parseTwilight, rollTwilight, pushTwilight, summarizeTwilight, describeTwilight, twilightHeadline } from '../system-dice.js';
import { parseStarWars, rollStarWars, summarizeStarWars, describeStarWars, starWarsHeadline } from '../system-dice.js';
import { parseOneRing, rollOneRing, summarizeOneRing, describeOneRing, oneRingHeadline } from '../system-dice.js';
import { parsePbta, parseMist, rollPbta, rollMist, summarize2d6, describe2d6, twod6Headline } from '../system-dice.js';
import { parseMothership, rollMothership, summarizeMothershipCheck, summarizeMothershipPanic, describeMothership, mothershipHeadline } from '../system-dice.js';
import { parseCards, newDeckOrder, summarizeCards, cardsHeadline, describeCards } from '../system-dice.js';
import { parseTarot, summarizeTarot, tarotHeadline, describeTarot } from '../system-dice.js';
import { parseNapoletane } from '../system-dice.js';
import { parseIronsworn, rollIronsworn, summarizeIronsworn, describeIronsworn, ironswornHeadline } from '../system-dice.js';
import * as systemModule from '../system-dice.js';

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
// Plain success with margin. 8,8,8 are three successes; a lone 10 is one more
// (a single 10 is NOT worth two — only a PAIR of 10s adds the crit bonus).
{
  const s = summarizeV5([d(8, false), d(8, false), d(8, false), d(10, false)], 3, 4, 0);
  ok('success', s.outcome === 'success');
  ok('four successes from a lone 10', s.successes === 4);
  ok('margin=1', s.margin === 1);
  ok('lone 10 is not a crit', s.critTwo === false);
}
// A pair of 10s: two successes for the dice, plus two more for the pair = 4,
// and the 6 adds one => 5. And with the difficulty met, it is a Critical.
{
  const s = summarizeV5([d(10, false), d(10, false), d(6, false)], 3, 3, 0);
  ok('pair of 10s + a 6 => 5 successes', s.successes === 5);
  ok('a met pair of 10s is a Critical', s.outcome === 'critical');
  ok('critPairs=1', s.critPairs === 1);
}
// A pair of 10s that still misses the difficulty is a failure, not a Critical.
{
  const s = summarizeV5([d(10, false), d(10, false)], 6, 2, 0); // 4 successes vs difficulty 6
  ok('unmet crit is a failure', s.outcome === 'failure');
  ok('still four successes', s.successes === 4);
}
// Difficulty omitted -> the win-contingent outcomes (Critical / Messy Critical /
// Success) cannot be asserted, because a critical is a critical *win* and there
// is nothing to win against. The pair is still surfaced through critTwo.
{
  const s = summarizeV5([d(10, true), d(10, false)], null, 2, 1);
  ok('no-difficulty: crit not asserted', s.outcome === null);
  ok('no-difficulty: pair still flagged', s.critTwo === true);
  ok('no-difficulty: still counts successes (4)', s.successes === 4);
}
// But zero successes DOES resolve without a difficulty — every difficulty is at
// least 1, so nothing on the dice has already lost, Bestially if a Hunger 1 is
// among them.
{
  const s2 = summarizeV5([d(3, false), d(1, true)], null, 2, 1);
  ok('no-difficulty zero + hunger 1 => bestial', s2.outcome === 'bestial-failure');
  ok('no-difficulty zero successes', s2.successes === 0);
  const s3 = summarizeV5([d(3, false), d(4, false)], null, 2, 0);
  ok('no-difficulty zero, no hunger => failure', s3.outcome === 'failure');
}

// ---- formatter ----
{
  const r = rollV5('v5:4h1@3');
  r.summary = summarizeV5([d(10, true), d(10, false), d(5, false), d(2, false)], 3, 4, 1);
  const txt = describeV5(r);
  ok('formatter mentions Messy Critical', /Messy Critical/.test(txt));
  ok('formatter mentions successes', /4 successes/.test(txt));
  ok('formatter mentions the pair of 10s', /pair of 10s/.test(txt));
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

// ---- headline: a {kind, text} pair so words and numbers get their own size ----
{
  const r = { summary: summarizeV5([d(10, true), d(10, false), d(5, false), d(2, false)], 3, 4, 1) };
  const h = v5Headline(r);
  ok('headline messy-critical text', h.text === 'Messy Critical');
  ok('headline messy-critical kind', h.kind === 'text');

  const s2 = { summary: summarizeV5([d(8, false), d(8, false), d(8, false), d(10, false)], 3, 4, 0) };
  const h2 = v5Headline(s2);
  ok('headline success margin text', h2.text === 'Success +1');
  ok('headline success kind text', h2.kind === 'text');

  // Unresolved (no difficulty, some successes): a bare number, at numeral size.
  const s3 = { summary: summarizeV5([d(8, false), d(6, false)], null, 2, 0) };
  const h3 = v5Headline(s3);
  ok('headline unresolved is a number', h3.text === '2' && h3.kind === 'number');
}

// ---- Rouse check: one Hunger die, holds on 6+, raises Hunger on 1-5 ----
{
  // Every possible value resolves the right way, and the die is always a single
  // Hunger d10 the tray can render.
  for (let trial = 0; trial < 60; trial++) {
    const r = rollRouse();
    ok('rouse is a v5 roll', r.system === 'v5');
    ok('rouse throws one Hunger die', r.groups[0].dice.length === 1 && r.groups[0].dice[0].hunger === true);
    const { value, success, hungerGain } = r.summary;
    ok('rouse value is a d10', value >= 1 && value <= 10);
    ok('rouse holds iff 6+', success === (value >= 6));
    ok('rouse raises Hunger only on a failure', hungerGain === (value >= 6 ? 0 : 1));
  }
  // Headline and detail read the rouse summary on their own, with hungerAfter
  // supplied by the caller.
  const hold = v5Headline({ summary: { kind: 'rouse', value: 8, success: true, hungerGain: 0, hungerAfter: 2 } });
  ok('rouse hold headline', hold.text === 'Blood holds');
  const rise = v5Headline({ summary: { kind: 'rouse', value: 3, success: false, hungerGain: 1, hungerAfter: 3 } });
  ok('rouse rise headline names the new Hunger', rise.text === 'Hunger 3' && rise.variant === 'v5-hunger');
  const riseTxt = describeV5({ summary: { kind: 'rouse', value: 3, success: false, hungerGain: 1, hungerAfter: 3, tracked: true } });
  ok('rouse detail names the new Hunger', /Hunger rises to 3/.test(riseTxt));
  // Untracked (tracked: false): a failure just reports the mechanical gain.
  const untrackedHead = v5Headline({ summary: { kind: 'rouse', value: 3, success: false, hungerGain: 1, tracked: false } });
  ok('untracked rouse fail headline is Hunger +1', untrackedHead.text === 'Hunger +1' && untrackedHead.variant === 'v5-hunger');
  const untrackedTxt = describeV5({ summary: { kind: 'rouse', value: 3, success: false, hungerGain: 1, tracked: false } });
  ok('untracked rouse fail detail says gain 1 Hunger', /gain 1 Hunger/.test(untrackedTxt));
  // At Hunger 5 a tracked failure cannot climb: it names the Beast, not a rise.
  const cappedTxt = describeV5({ summary: { kind: 'rouse', value: 3, success: false, hungerGain: 1, hungerAfter: 5, hungerRose: false, tracked: true } });
  ok('capped rouse detail names the Beast', /the Beast stirs/.test(cappedTxt) && !/rises/.test(cappedTxt));
}

// ---- Fate / Fudge ----
const f = value => ({ value, kept: true });

// parsing / detection
ok('detect 4dF', detectSystem('4dF') === 'fate');
ok('detect dF (bare)', detectSystem('dF') === 'fate');
ok('detect 4dF+2', detectSystem('4dF+2') === 'fate');
ok('detect lower df', detectSystem('6df-1') === 'fate');
ok('numeric d6 not fate', detectSystem('4d6') === 'numeric');
ok('parse 4dF', eq(parseFate('4dF'), { count: 4, modifier: 0 }));
ok('parse bare dF -> 4', eq(parseFate('dF'), { count: 4, modifier: 0 }));
ok('parse 4dF+2', eq(parseFate('4dF+2'), { count: 4, modifier: 2 }));
ok('parse 6dF-3', eq(parseFate('6dF-3'), { count: 6, modifier: -3 }));
for (const bad of ['0dF', '101dF', '4dF+200', '4d6', 'v5:8', 'dFF']) {
  ok(`reject fate ${bad}`, (() => { try { parseFate(bad); return false; } catch { return true; } })());
}

// roll shape
{
  const r = rollFate('4dF+1');
  ok('fate system tag', r.system === 'fate');
  ok('fate rolls 4 dice', r.groups[0].dice.length === 4);
  ok('fate dice are cubes', r.groups[0].sides === 6);
  ok('fate values in -1..1', r.groups[0].dice.every(d => d.value >= -1 && d.value <= 1));
  ok('rollAny routes fate', rollAny('4dF').system === 'fate');
}

// summary arithmetic
{
  const s = summarizeFate([f(1), f(1), f(-1), f(0)], 0);
  ok('fate net +1', s.total === 1 && s.sum === 1);
  ok('fate counts', s.plus === 2 && s.minus === 1 && s.blank === 1);
  const s2 = summarizeFate([f(1), f(1), f(-1), f(0)], 2);
  ok('fate modifier adds', s2.total === 3 && s2.sum === 1 && s2.modifier === 2);
  const s3 = summarizeFate([f(-1), f(-1), f(-1), f(-1)], 0);
  ok('fate floor -4', s3.total === -4);
}

// ladder
ok('ladder 0 Mediocre', fateLadder(0) === 'Mediocre');
ok('ladder +3 Good', fateLadder(3) === 'Good');
ok('ladder +4 Great', fateLadder(4) === 'Great');
ok('ladder -1 Poor', fateLadder(-1) === 'Poor');
ok('ladder -2 Terrible', fateLadder(-2) === 'Terrible');
ok('ladder clamps high', fateLadder(12) === 'Legendary');
ok('ladder clamps low', fateLadder(-9) === 'Terrible');

// faces
ok('fateFace + ', fateFace(1) === 'plus');
ok('fateFace -', fateFace(-1) === 'minus');
ok('fateFace blank', fateFace(0) === 'blank');

// formatter + headline
{
  const r = { summary: summarizeFate([f(1), f(1), f(-1), f(0)], 2), groups: [{ dice: [f(1), f(1), f(-1), f(0)] }] };
  const txt = describeFate(r);
  ok('describe names the ladder', /Good/.test(txt));
  ok('describe shows the modifier', /2 modifier/.test(txt));
  const h = fateHeadline(r);
  ok('fate headline is +3', h.text === '+3' && h.kind === 'number');
  const h0 = fateHeadline({ summary: summarizeFate([f(0)], 0) });
  ok('fate headline 0', h0.text === '0');
  const hneg = fateHeadline({ summary: summarizeFate([f(-1), f(-1)], 0) });
  ok('fate headline negative uses minus sign', hneg.text === '−2');
}

// ---- Genesys ----
// a die object for the reducer, from a symbol list
const g = (...symbols) => ({ symbols });

// detection / parsing
ok('detect gen', detectSystem('gen:2A+1P') === 'genesys');
ok('gen not fate/numeric', detectSystem('gen:1A') === 'genesys' && detectSystem('4d6') === 'numeric');
ok('parse gen 2A+1P+2D', eq(parseGenesys('gen:2A+1P+2D'),
  [{ type: 'ability', count: 2 }, { type: 'proficiency', count: 1 }, { type: 'difficulty', count: 2 }]));
ok('parse gen no plus', eq(parseGenesys('gen:2a1p'),
  [{ type: 'ability', count: 2 }, { type: 'proficiency', count: 1 }]));
ok('parse gen bare letter = 1', eq(parseGenesys('gen:A+C'),
  [{ type: 'ability', count: 1 }, { type: 'challenge', count: 1 }]));
for (const bad of ['gen:', 'gen:2X', 'v5:8', '4dF', 'gen:0A']) {
  ok(`reject gen ${bad}`, (() => { try { parseGenesys(bad); return false; } catch { return true; } })());
}

// face tables — exact symbol counts per die (verified against the official set)
{
  const tally = type => {
    const c = { success: 0, advantage: 0, triumph: 0, failure: 0, threat: 0, despair: 0, blank: 0 };
    for (const face of GENESYS_DICE[type].faces) {
      if (face.length === 0) c.blank++;
      for (const s of face) c[s]++;
    }
    return c;
  };
  ok('boost d6', GENESYS_DICE.boost.sides === 6 && eq(tally('boost'), { success: 2, advantage: 4, triumph: 0, failure: 0, threat: 0, despair: 0, blank: 2 }));
  ok('setback d6', eq(tally('setback'), { success: 0, advantage: 0, triumph: 0, failure: 2, threat: 2, despair: 0, blank: 2 }));
  ok('ability d8', GENESYS_DICE.ability.sides === 8 && eq(tally('ability'), { success: 5, advantage: 5, triumph: 0, failure: 0, threat: 0, despair: 0, blank: 1 }));
  ok('difficulty d8', eq(tally('difficulty'), { success: 0, advantage: 0, triumph: 0, failure: 4, threat: 6, despair: 0, blank: 1 }));
  ok('proficiency d12 (1 triumph)', GENESYS_DICE.proficiency.sides === 12 && eq(tally('proficiency'), { success: 9, advantage: 8, triumph: 1, failure: 0, threat: 0, despair: 0, blank: 1 }));
  ok('challenge d12 (1 despair)', eq(tally('challenge'), { success: 0, advantage: 0, triumph: 0, failure: 8, threat: 8, despair: 1, blank: 1 }));
}

// roll shape
{
  const r = rollGenesys('gen:2A+1P+1D');
  ok('gen system tag', r.system === 'genesys');
  ok('gen rolls 4 dice', r.groups[0].dice.length === 4);
  ok('gen dice carry type + symbols', r.groups[0].dice.every(d => d.type && Array.isArray(d.symbols)));
  ok('gen dice sides match type', r.groups[0].dice.every(d => d.sides === GENESYS_DICE[d.type].sides));
  ok('rollAny routes gen', rollAny('gen:1A').system === 'genesys');
}

// cancellation on both axes
{
  const s = summarizeGenesys([g('success', 'success'), g('advantage'), g('failure'), g('threat', 'threat')]);
  ok('net 1 success', s.netSuccess === 1 && s.success === 1 && s.failure === 0);
  ok('net 1 threat', s.netAdvantage === -1 && s.threat === 1 && s.advantage === 0);
}
// wash is a failure
{
  const s = summarizeGenesys([g('success'), g('failure')]);
  ok('wash → 0 net success', s.netSuccess === 0);
  ok('wash reports as failure in headline', genesysHeadline({ summary: s }).text.startsWith('Failure'));
}
// triumph counts as a success AND persists; despair likewise
{
  const s = summarizeGenesys([g('triumph'), g('failure'), g('failure')]);
  ok('triumph adds a success (net -1)', s.netSuccess === -1);
  ok('triumph still reported', s.raw.triumph === 1);
  const s2 = summarizeGenesys([g('despair'), g('success'), g('success')]);
  ok('despair adds a failure (net +1)', s2.netSuccess === 1);
  ok('despair still reported', s2.raw.despair === 1);
}
// headline + describe
{
  const s = summarizeGenesys([g('success', 'success'), g('advantage'), g('triumph'), g('failure'), g('threat', 'threat', 'threat')]);
  const h = genesysHeadline({ summary: s });
  ok('gen headline kind text', h.kind === 'text');
  // success 2 + triumph 1 = 3, minus failure 1 = net 2 success; adv 1 - threat 3 = -2 threat; triumph 1
  ok('gen headline nets correctly', h.text === '2 Success · 2 Threat · Triumph', h.text);
  ok('gen describe shows raw tally', /rolled/.test(describeGenesys({ summary: s })));
}
// face lookup
ok('genesysFace proficiency triumph', eq(genesysFace('proficiency', 11), ['triumph']));
ok('genesysFace boost blank', eq(genesysFace('boost', 0), []));

// ---- Daggerheart ----
const dh = (hope, fear, extra = {}) => summarizeDaggerheart({ hope, fear, total: hope + fear + (extra.modifier || 0), ...extra });

// detection / parsing
ok('detect dh', detectSystem('dh:') === 'daggerheart');
ok('detect dh mod', detectSystem('dh:+2') === 'daggerheart');
ok('detect dh full', detectSystem('dh:adv+1@15') === 'daggerheart');
ok('dh not numeric', detectSystem('2d12') === 'numeric');
ok('parse dh bare', eq(parseDaggerheart('dh:'), { advantage: 0, modifier: 0, difficulty: null }));
ok('parse dh +2', eq(parseDaggerheart('dh:+2'), { advantage: 0, modifier: 2, difficulty: null }));
ok('parse dh negative modifier', eq(parseDaggerheart('dh:-1'), { advantage: 0, modifier: -1, difficulty: null }));
ok('parse dh @15', eq(parseDaggerheart('dh:@15'), { advantage: 0, modifier: 0, difficulty: 15 }));
ok('parse dh adv = +1 die', eq(parseDaggerheart('dh:adv+1@15'), { advantage: 1, modifier: 1, difficulty: 15 }));
ok('parse dh adv2 = +2 dice', eq(parseDaggerheart('dh:adv2'), { advantage: 2, modifier: 0, difficulty: null }));
ok('parse dh dis = -1 die', eq(parseDaggerheart('dh:dis'), { advantage: -1, modifier: 0, difficulty: null }));
ok('parse dh dis3 = -3 dice', eq(parseDaggerheart('dh:dis3'), { advantage: -3, modifier: 0, difficulty: null }));
for (const bad of ['dh', 'dh:xyz', 'dh:@0', 'dh:adv0', 'gen:1A', '4dF']) {
  ok(`reject dh ${bad}`, (() => { try { parseDaggerheart(bad); return false; } catch { return true; } })());
}

// roll shape
{
  const r = rollDaggerheart('dh:adv2+2@15');
  ok('dh system tag', r.system === 'daggerheart');
  ok('dh has hope+fear+2 advantage dice', r.groups[0].dice.length === 4);
  ok('dh dice have roles', r.groups[0].dice.map(d => d.role).join() === 'hope,fear,advantage,advantage');
  ok('dh values in range', r.groups[0].dice.every(d => d.value >= 1 && d.value <= d.sides));
  ok('rollAny routes dh', rollAny('dh:').system === 'daggerheart');
  const [h, f, a1, a2] = r.groups[0].dice.map(d => d.value);
  ok('dh total = hope+fear+2 adv+mod', r.summary.total === h + f + a1 + a2 + 2);
  // disadvantage subtracts each die
  const rd = rollDaggerheart('dh:dis2');
  const [dh_, df, x1, x2] = rd.groups[0].dice.map(d => d.value);
  ok('dh disadvantage subtracts each die', rd.summary.total === dh_ + df - x1 - x2);
}

// duality tone
{
  ok('hope high → with Hope', dh(9, 6).outcome === 'hope' && dh(9, 6).withHope === true);
  ok('fear high → with Fear', dh(4, 10).outcome === 'fear' && dh(4, 10).withHope === false);
  ok('match → critical', dh(7, 7).outcome === 'critical' && dh(7, 7).critical === true);
}
// difficulty resolution
{
  ok('success with hope', dh(10, 8, { difficulty: 15 }).outcome === 'success-hope');
  ok('failure with fear', dh(5, 7, { difficulty: 15 }).outcome === 'failure-fear');
  ok('success with fear', dh(8, 10, { difficulty: 15 }).outcome === 'success-fear');
  ok('failure with hope', dh(6, 4, { difficulty: 15 }).outcome === 'failure-hope');
  // a critical always succeeds even under the difficulty
  const c = dh(3, 3, { difficulty: 20 });
  ok('critical succeeds under difficulty', c.outcome === 'critical' && c.success === true);
}
// modifier and adv/dis affect the total
{
  ok('modifier adds to total', dh(6, 6, { modifier: 3 }).total === 15);
  const s = summarizeDaggerheart({ hope: 6, fear: 5, total: 6 + 5 - 4, advantage: 'dis' });
  ok('disadvantage lowers total', s.total === 7);
}
// headline + describe
{
  const rHope = { summary: dh(10, 7, { difficulty: 15 }) };
  const h = daggerheartHeadline(rHope);
  ok('dh headline is the total', h.text === '17' && h.kind === 'number');
  ok('dh headline variant hope', h.variant === 'hope');
  ok('dh headline variant fear', daggerheartHeadline({ summary: dh(4, 10) }).variant === 'fear');
  ok('dh headline variant critical', daggerheartHeadline({ summary: dh(8, 8) }).variant === 'critical');
  const rd = { summary: dh(10, 7, { difficulty: 15 }), groups: [{ dice: [{ role: 'hope', value: 10 }, { role: 'fear', value: 7 }] }] };
  ok('dh describe names the outcome', /Success with Hope/.test(describeDaggerheart(rd)));
  ok('dh describe shows the dice', /Hope 10, Fear 7/.test(describeDaggerheart(rd)));
}

// ---- CthulhuTech 2e ----
const ct = (...values) => summarizeCthulhuTech(values.map(value => ({ value })), null);
const ctd = (difficulty, ...values) => summarizeCthulhuTech(values.map(value => ({ value })), difficulty);

// detection / parsing
ok('detect ct', detectSystem('ct:8') === 'cthulhutech');
ok('detect ct@', detectSystem('ct:8@4') === 'cthulhutech');
ok('ct not numeric', detectSystem('8d10') === 'numeric');
ok('parse ct:8', eq(parseCthulhuTech('ct:8'), { dice: 8, difficulty: null }));
ok('parse ct:8@4', eq(parseCthulhuTech('ct:8@4'), { dice: 8, difficulty: 4 }));
for (const bad of ['ct:', 'ct:0', 'ct:101', 'ct:8@0', 'dh:', '4dF']) {
  ok(`reject ct ${bad}`, (() => { try { parseCthulhuTech(bad); return false; } catch { return true; } })());
}

// even = hit, odd = miss
{
  ok('even values are hits', ct(2, 4, 6, 8, 10).hits === 5);
  ok('odd values are misses', ct(1, 3, 5, 7, 9).hits === 0);
  const s = ct(2, 7, 4, 9, 10, 3);
  ok('counts only evens', s.hits === 3 && s.misses === 3);
}
// roll shape
{
  const r = rollCthulhuTech('ct:12@5');
  ok('ct system tag', r.system === 'cthulhutech');
  ok('ct rolls 12 d10', r.groups[0].dice.length === 12 && r.groups[0].sides === 10);
  ok('ct dice flag hits by parity', r.groups[0].dice.every(d => d.hit === (d.value % 2 === 0)));
  ok('ct values 1..10', r.groups[0].dice.every(d => d.value >= 1 && d.value <= 10));
  ok('rollAny routes ct', rollAny('ct:6').system === 'cthulhutech');
}
// difficulty resolution
{
  ok('meets difficulty → success', ctd(3, 2, 4, 6, 1, 3).success === true);   // 3 hits vs 3
  ok('under difficulty → failure', ctd(4, 2, 4, 1, 3, 5).success === false);   // 2 hits vs 4
  ok('margin over difficulty', ctd(2, 2, 4, 6, 8).margin === 2);               // 4 hits vs 2
  ok('no difficulty → unresolved', ct(2, 4).success === null);
}
// headline + describe
{
  const rWin = { summary: ctd(3, 2, 4, 6, 8, 1), groups: [{ dice: [2, 4, 6, 8, 1].map(value => ({ value })) }] };
  const h = cthulhutechHeadline(rWin);
  ok('ct headline is the hit count', h.text === '4' && h.kind === 'number');
  ok('ct headline success variant', h.variant === 'ct-success');
  ok('ct headline failure variant', cthulhutechHeadline({ summary: ctd(5, 2, 1) }).variant === 'ct-failure');
  ok('ct headline no variant unresolved', cthulhutechHeadline({ summary: ct(2, 4) }).variant === undefined);
  const txt = describeCthulhuTech(rWin);
  ok('ct describe shows hits vs difficulty', /4 hits vs difficulty 3/.test(txt));
  ok('ct describe lists the hit dice', /hits 2, 4, 6, 8/.test(txt));
  ok('ct describe lists the misses', /missed 1/.test(txt));
}

// ---- Year Zero Engine ----
{
  // detection / parsing
  ok('detect yz', detectSystem('yz:5') === 'yearzero');
  ok('detect yz typed pool', detectSystem('yz:5b3s2g1x') === 'yearzero');
  ok('yz not numeric', detectSystem('5d6') === 'numeric');
  ok('parse yz:5 is base', eq(parseYearZero('yz:5'), { base: 5, skill: 0, gear: 0, stress: 0 }));
  ok('parse yz typed', eq(parseYearZero('yz:5b3s2g1x'), { base: 5, skill: 3, gear: 2, stress: 1 }));
  ok('parse yz sums repeats', eq(parseYearZero('yz:2b3b'), { base: 5, skill: 0, gear: 0, stress: 0 }));
  for (const bad of ['yz:', 'yz:0', 'yz:5q', 'yz:101', 'ct:8', '4dF']) {
    ok(`reject yz ${bad}`, (() => { try { parseYearZero(bad); return false; } catch { return true; } })());
  }

  // summary: 6s are successes, 1s are banes by type, a Stress 1 panics
  const dice = (...specs) => specs.map(([value, type]) => ({ value, type }));
  const s = summarizeYearZero(dice([6, 'base'], [6, 'skill'], [1, 'base'], [1, 'gear'], [1, 'stress'], [3, 'skill']));
  ok('yz counts sixes as successes', s.successes === 2);
  ok('yz tallies banes by type', s.banes.base === 1 && s.banes.gear === 1 && s.banes.stress === 1);
  ok('yz stress 1 panics', s.panic === true);
  ok('yz no stress 1 → no panic', summarizeYearZero(dice([6, 'base'], [1, 'base'])).panic === false);
  ok('yz fresh roll can push', s.canPush === true);

  // roll shape
  {
    const r = rollYearZero('yz:4b2s1g1x');
    ok('yz system tag', r.system === 'yearzero');
    ok('yz rolls the pool', r.groups[0].dice.length === 8 && r.groups[0].sides === 6);
    ok('yz dice carry type', r.groups[0].dice.filter(d => d.type === 'base').length === 4);
    ok('yz values 1..6', r.groups[0].dice.every(d => d.value >= 1 && d.value <= 6));
    ok('rollAny routes yz', rollAny('yz:5').system === 'yearzero');
  }

  // push: keeps 6s and 1s, rerolls the rest, adds a Stress die, one push only
  {
    const r = rollYearZero('yz:6b1x');
    const kept = r.groups[0].dice.map(d => (d.value === 6 || d.value === 1 ? d.value : null));
    const p = pushYearZero(r);
    ok('push adds a stress die (Alien)', p.groups[0].dice.length === r.groups[0].dice.length + 1);
    ok('push keeps sixes and ones', r.groups[0].dice.every((d, i) =>
      (d.value === 6 || d.value === 1) ? p.groups[0].dice[i].value === d.value : true) && kept.length === r.groups[0].dice.length);
    ok('push marks pushed, blocks a second push', p.summary.pushed === true && p.summary.canPush === false);
    const noStress = pushYearZero(rollYearZero('yz:5'));
    ok('classic push adds no dice', noStress.groups[0].dice.length === 5);
  }

  // headline + describe
  {
    const win = { summary: summarizeYearZero(dice([6, 'base'], [6, 'skill'])) };
    ok('yz headline is the success count', yearzeroHeadline(win).text === '2');
    ok('yz headline success variant', yearzeroHeadline(win).variant === 'yz-success');
    const miss = { summary: summarizeYearZero(dice([3, 'base'], [4, 'skill'])) };
    ok('yz headline miss variant', yearzeroHeadline(miss).variant === 'yz-fail');
    const panic = { summary: summarizeYearZero(dice([6, 'base'], [1, 'stress'])) };
    ok('yz headline panic variant', yearzeroHeadline(panic).variant === 'yz-panic');
    const txt = describeYearZero({ summary: summarizeYearZero(dice([6, 'base'], [1, 'base'], [1, 'stress']), true) });
    ok('yz describe reads successes, push, panic, banes',
      /1 success · pushed · Panic! · banes: 1 attribute, 1 stress/.test(txt));
  }
}

// ---- Blade Runner (BRRPG step-die) ----
{
  ok('detect br', detectSystem('br:12,8') === 'bladerunner');
  ok('detect br adv', detectSystem('br:12,8adv') === 'bladerunner');
  ok('br not numeric', detectSystem('2d12') === 'numeric');
  ok('parse br:12,8', eq(parseBladeRunner('br:12,8'), { attr: 12, skill: 8, mod: null }));
  ok('parse br adv/dis', eq(parseBladeRunner('br:12,8adv'), { attr: 12, skill: 8, mod: 'adv' })
    && eq(parseBladeRunner('br:10,6dis'), { attr: 10, skill: 6, mod: 'dis' }));
  for (const bad of ['br:', 'br:12', 'br:7,8', 'br:5,6', 'br:12,8xyz', 'yz:5']) {
    ok(`reject br ${bad}`, (() => { try { parseBladeRunner(bad); return false; } catch { return true; } })());
  }

  // 6-9 = one success, 10+ = two
  const s = summarizeBladeRunner([{ sides: 12, value: 11 }, { sides: 8, value: 7 }, { sides: 6, value: 3 }]);
  ok('br counts 6-9 as one, 10+ as two', s.successes === 3);
  ok('br 2+ successes is a critical', s.outcome === 'critical');
  ok('br one success passes', summarizeBladeRunner([{ sides: 8, value: 6 }, { sides: 6, value: 2 }]).outcome === 'success');
  ok('br zero successes fails', summarizeBladeRunner([{ sides: 8, value: 5 }, { sides: 6, value: 2 }]).outcome === 'failure');
  ok('br tallies ones for push damage', summarizeBladeRunner([{ sides: 8, value: 1 }, { sides: 6, value: 1 }]).ones === 2);

  // roll shape: two dice, advantage adds smaller, disadvantage keeps larger
  {
    const r = rollBladeRunner('br:12,8');
    ok('br system tag', r.system === 'bladerunner');
    ok('br rolls two dice', r.groups[0].dice.length === 2 && r.groups[0].dice[0].sides === 12 && r.groups[0].dice[1].sides === 8);
    const adv = rollBladeRunner('br:12,8adv');
    ok('br advantage adds a third die (the smaller)', adv.groups[0].dice.length === 3 && adv.groups[0].dice[2].sides === 8);
    const dis = rollBladeRunner('br:12,8dis');
    ok('br disadvantage rolls only the larger', dis.groups[0].dice.length === 1 && dis.groups[0].dice[0].sides === 12);
    ok('rollAny routes br', rollAny('br:8,8').system === 'bladerunner');
  }

  // push: rerolls dice below 6 that aren't 1s; 6+ and 1s lock
  {
    const r = rollBladeRunner('br:12,12');
    const p = pushBladeRunner(r);
    ok('push locks 6+ and 1s, rerolls the rest', r.groups[0].dice.every((d, i) =>
      (d.value >= 6 || d.value === 1) ? p.groups[0].dice[i].value === d.value : true));
    ok('push marks pushed, blocks a second push', p.summary.pushed === true && p.summary.canPush === false);
  }

  // headline + describe
  {
    ok('br crit headline is the success count', bladeRunnerHeadline({ summary: s }).text === '3');
    ok('br crit variant', bladeRunnerHeadline({ summary: s }).variant === 'br-crit');
    ok('br fail variant', bladeRunnerHeadline({ summary: summarizeBladeRunner([{ sides: 6, value: 2 }]) }).variant === 'br-fail');
    const txt = describeBladeRunner({ summary: summarizeBladeRunner([{ sides: 12, value: 10 }, { sides: 8, value: 3 }], true), groups: [{ dice: [{ sides: 12, value: 10 }, { sides: 8, value: 3 }] }] });
    ok('br describe reads successes, push, outcome, dice', /2 successes · pushed · Critical · d12\[10\] \+ d8\[3\]/.test(txt));
  }
}

// ---- Twilight 2000 (T2K 4e step-die + ammo) ----
{
  ok('detect t2k', detectSystem('t2k:12,8') === 'twilight');
  ok('detect t2k with ammo', detectSystem('t2k:12,8,3') === 'twilight');
  ok('t2k not br', detectSystem('br:12,8') === 'bladerunner');
  ok('parse t2k:12,8', eq(parseTwilight('t2k:12,8'), { attr: 12, skill: 8, ammo: 0 }));
  ok('parse t2k with ammo', eq(parseTwilight('t2k:10,6,4'), { attr: 10, skill: 6, ammo: 4 }));
  for (const bad of ['t2k:', 't2k:12', 't2k:7,8', 't2k:12,8,99', 'br:12,8']) {
    ok(`reject t2k ${bad}`, (() => { try { parseTwilight(bad); return false; } catch { return true; } })());
  }

  // 6-9 = one success, 10+ = two (shared with BR)
  const s = summarizeTwilight([{ sides: 12, value: 11 }, { sides: 8, value: 7 }, { sides: 6, value: 3 }]);
  ok('t2k counts 6-9 as one, 10+ as two', s.successes === 3);
  ok('t2k one success passes', summarizeTwilight([{ sides: 8, value: 6 }, { sides: 6, value: 2 }]).outcome === 'success');
  ok('t2k zero successes fails', summarizeTwilight([{ sides: 8, value: 5 }, { sides: 6, value: 2 }]).outcome === 'failure');
  ok('t2k tallies ones for reliability', summarizeTwilight([{ sides: 6, value: 1 }, { sides: 6, value: 1 }]).ones === 2);
  ok('t2k push blocked on success', summarizeTwilight([{ sides: 8, value: 6 }]).canPush === false);
  ok('t2k push offered on failure', summarizeTwilight([{ sides: 8, value: 4 }]).canPush === true);

  // roll shape: attribute + skill + ammo pool
  {
    const r = rollTwilight('t2k:12,8,3');
    ok('t2k system tag', r.system === 'twilight');
    ok('t2k rolls attr + skill + ammo dice', r.groups[0].dice.length === 5
      && r.groups[0].dice[0].sides === 12 && r.groups[0].dice[1].sides === 8
      && r.groups[0].dice.slice(2).every(d => d.sides === 6));
    ok('rollAny routes t2k', rollAny('t2k:8,8').system === 'twilight');
  }

  // push: rerolls dice below 6 that aren't 1s; 6+ and 1s lock
  {
    const r = rollTwilight('t2k:12,12,4');
    const p = pushTwilight(r);
    ok('t2k push locks 6+ and 1s, rerolls the rest', r.groups[0].dice.every((d, i) =>
      (d.value >= 6 || d.value === 1) ? p.groups[0].dice[i].value === d.value : true));
    ok('t2k push marks pushed, blocks a second push', p.summary.pushed === true && p.summary.canPush === false);
  }

  // headline + describe
  {
    ok('t2k headline is the success count', twilightHeadline({ summary: s }).text === '3');
    ok('t2k success variant', twilightHeadline({ summary: s }).variant === 't2k-success');
    ok('t2k fail variant', twilightHeadline({ summary: summarizeTwilight([{ sides: 6, value: 2 }]) }).variant === 't2k-fail');
    const txt = describeTwilight({ summary: summarizeTwilight([{ sides: 12, value: 10 }, { sides: 6, value: 1 }], true), groups: [{ dice: [{ sides: 12, value: 10 }, { sides: 6, value: 1 }] }] });
    ok('t2k describe reads successes, push, reliability', /pushed/.test(txt) && /Reliability −1/.test(txt));
  }
}

// ---- Star Wars (Genesys + Force die) ----
const swForce = symbols => ({ type: 'force', symbols });
const swNarr = symbols => ({ type: 'ability', symbols });

ok('detect sw', detectSystem('sw:2A+1F') === 'starwars');
ok('sw not genesys', detectSystem('sw:1A') === 'starwars' && detectSystem('gen:1A') === 'genesys');
ok('parse sw with force', eq(parseStarWars('sw:2A+1D+1F'),
  [{ type: 'ability', count: 2 }, { type: 'difficulty', count: 1 }, { type: 'force', count: 1 }]));
for (const bad of ['sw:', 'sw:2Z', 'gen:1A']) {
  ok(`reject sw ${bad}`, (() => { try { parseStarWars(bad); return false; } catch { return true; } })());
}
// Force die: 8 light + 8 dark pips across 12 faces (dark on 7, light on 5)
{
  const r = rollStarWars('sw:6F');
  ok('sw system tag', r.system === 'starwars');
  ok('sw force dice are d12', r.groups[0].dice.every(d => d.sides === 12 && d.type === 'force'));
  ok('sw force faces only light/dark', r.groups[0].dice.every(d => d.symbols.every(s => s === 'lightside' || s === 'darkside')));
  ok('rollAny routes sw', rollAny('sw:1A').system === 'starwars');
}
// narrative + force in one summary
{
  const s = summarizeStarWars([
    swNarr(['success', 'success']), swNarr(['failure']),
    swForce(['lightside', 'lightside']), swForce(['darkside']),
  ]);
  ok('sw narrative still cancels', s.netSuccess === 1);
  ok('sw counts light pips', s.lightside === 2);
  ok('sw counts dark pips', s.darkside === 1);
  ok('sw flags force + narrative', s.hasNarrative === true && s.hasForce === true);
}
// force-only leads with pips
{
  const s = summarizeStarWars([swForce(['lightside', 'lightside']), swForce(['darkside'])]);
  const h = starWarsHeadline({ summary: s });
  ok('sw force-only headline is pips', h.kind === 'text' && h.text === '2 Light · 1 Dark');
  ok('sw force-only no narrative', s.hasNarrative === false);
}
// describe includes the Force clause
{
  const rNarr = summarizeStarWars([swNarr(['success', 'advantage']), swForce(['lightside'])]);
  const txt = describeStarWars({ summary: rNarr, groups: [{ dice: [swNarr(['success', 'advantage']), swForce(['lightside'])] }] });
  ok('sw describe has Force clause', /Force 1 Light/.test(txt));
}

// ---- The One Ring ----
// build a summary from a kept feat face + success die values
const tor = (feat, featValue, successVals, opts = {}) => {
  const kept = { face: feat, value: featValue };
  const dice = [{ role: 'feat', face: feat, value: featValue }, ...successVals.map(value => ({ role: 'success', value }))];
  return summarizeOneRing({ kept, dice, weary: opts.weary || false, tn: opts.tn ?? null });
};

ok('detect tor', detectSystem('tor:3') === 'onering');
ok('detect tor full', detectSystem('tor:3fav@16') === 'onering');
ok('parse tor:3', eq(parseOneRing('tor:3'), { success: 3, favour: null, weary: false, tn: null }));
ok('parse tor:3@16', eq(parseOneRing('tor:3@16'), { success: 3, favour: null, weary: false, tn: 16 }));
ok('parse tor:3fav@16', eq(parseOneRing('tor:3fav@16'), { success: 3, favour: 'fav', weary: false, tn: 16 }));
ok('parse tor:2illw@18', eq(parseOneRing('tor:2illw@18'), { success: 2, favour: 'ill', weary: true, tn: 18 }));
for (const bad of ['tor:', 'tor:3x', 'tor:3@0', 'dh:']) {
  ok(`reject tor ${bad}`, (() => { try { parseOneRing(bad); return false; } catch { return true; } })());
}

// totals and target number
{
  const s = tor('number', 8, [4, 2], { tn: 14 });
  ok('tor total = feat + success', s.total === 14);
  ok('tor meets TN → success', s.success === true);
  ok('tor under TN → failure', tor('number', 5, [2, 1], { tn: 14 }).success === false);
}
// Eye of Sauron = 0
{
  const s = tor('eye', 0, [4, 5], { tn: 8 });
  ok('eye contributes 0', s.total === 9 && s.eye === true);
}
// Gandalf = automatic success even below TN
{
  const s = tor('gandalf', 0, [1, 1], { tn: 30 });
  ok('gandalf auto-succeeds', s.success === true && s.gandalf === true);
}
// Tengwar runes → degree
{
  ok('one 6 → great', tor('number', 7, [6, 3], { tn: 10 }).degree === 'great');
  ok('two 6s → extraordinary', tor('number', 5, [6, 6], { tn: 10 }).degree === 'extraordinary');
  ok('no 6 → ordinary', tor('number', 9, [4, 5], { tn: 10 }).degree === 'ordinary');
  ok('runes counted', tor('number', 5, [6, 6, 2]).runes === 2);
}
// Weary: success dice of 1-3 count as 0
{
  const s = tor('number', 6, [2, 5, 6], { weary: true, tn: 10 });
  ok('weary drops 1-3', s.successSum === 11); // 5 + 6 (the 2 is dropped); feat 6 → total 17
  ok('weary total', s.total === 17);
}
// roll shape: favoured rolls two feat dice, one kept
{
  const r = rollOneRing('tor:3fav@16');
  ok('tor system tag', r.system === 'onering');
  const feats = r.groups[0].dice.filter(d => d.role === 'feat');
  ok('favoured rolls two feat dice', feats.length === 2);
  ok('exactly one feat kept', feats.filter(d => d.kept).length === 1);
  ok('three success dice', r.groups[0].dice.filter(d => d.role === 'success').length === 3);
  ok('rollAny routes tor', rollAny('tor:2').system === 'onering');
  const plain = rollOneRing('tor:2');
  ok('unfavoured rolls one feat die', plain.groups[0].dice.filter(d => d.role === 'feat').length === 1);
}
// headline + describe
{
  const rWin = { summary: tor('number', 8, [6, 2], { tn: 14 }), groups: [{ dice: [{ role: 'feat', face: 'number', value: 8 }, { role: 'success', value: 6 }, { role: 'success', value: 2 }] }] };
  const h = oneRingHeadline(rWin);
  ok('tor headline is total', h.text === '16' && h.kind === 'number');
  ok('tor headline success variant', h.variant === 'tor-success');
  ok('tor gandalf variant', oneRingHeadline({ summary: tor('gandalf', 0, [1], { tn: 20 }) }).variant === 'tor-gandalf');
  const txt = describeOneRing(rWin);
  ok('tor describe names success + degree', /Success · Great Success/.test(txt));
  ok('tor describe shows total vs TN', /total 16 vs 14/.test(txt));
}

// ---- 2d6 (PbtA + Mist Engine) ----
ok('detect pbta', detectSystem('pbta:+1') === 'pbta');
ok('detect mist', detectSystem('mist:-1') === 'mist');
ok('pbta/mist not numeric', detectSystem('2d6') === 'numeric');
ok('parse pbta bare', eq(parsePbta('pbta:'), { modifier: 0 }));
ok('parse pbta +2', eq(parsePbta('pbta:+2'), { modifier: 2 }));
ok('parse mist -1', eq(parseMist('mist:-1'), { modifier: -1 }));
for (const bad of ['pbta:x', 'pbta', 'mist:++1', 'dh:']) {
  ok(`reject 2d6 ${bad}`, (() => { try { parsePbta(bad); parseMist(bad); return false; } catch { return true; } })());
}
// bands: 10+ hit, 7-9 partial, 6- miss
ok('10+ = hit', summarize2d6(5, 5, 0, 'pbta').band === 'hit');
ok('7-9 = partial', summarize2d6(4, 3, 0, 'pbta').band === 'partial');
ok('6- = miss', summarize2d6(2, 3, 0, 'pbta').band === 'miss');
ok('modifier bumps the band', summarize2d6(4, 3, 3, 'pbta').band === 'hit'); // 7 + 3 = 10
ok('negative modifier drops the band', summarize2d6(4, 4, -3, 'pbta').band === 'miss'); // 8 - 3 = 5
// roll shape
{
  const r = rollPbta('pbta:+1');
  ok('pbta system tag', r.system === 'pbta');
  ok('pbta rolls two d6', r.groups[0].dice.length === 2 && r.groups[0].sides === 6);
  ok('pbta total = a+b+mod', r.summary.total === r.groups[0].dice[0].value + r.groups[0].dice[1].value + 1);
  ok('rollAny routes pbta', rollAny('pbta:').system === 'pbta');
  ok('rollAny routes mist', rollMist('mist:').system === 'mist');
}
// labels differ by system, math shared
{
  const p = { summary: summarize2d6(5, 5, 1, 'pbta') };
  const m = { summary: summarize2d6(5, 5, 1, 'mist') };
  ok('pbta hit label', describe2d6(p).startsWith('Strong Hit'));
  ok('mist hit label', describe2d6(m).startsWith('Success'));
  ok('pbta partial label', describe2d6({ summary: summarize2d6(4, 3, 0, 'pbta') }).startsWith('Weak Hit'));
  ok('mist partial label', describe2d6({ summary: summarize2d6(4, 3, 0, 'mist') }).startsWith('Consequence'));
  const h = twod6Headline(p);
  ok('2d6 headline is total', h.text === '11' && h.kind === 'number');
  ok('2d6 headline band variant', h.variant === 'band-hit');
  ok('2d6 describe shows the math', /5 \+ 5 \+ 1 · total 11/.test(describe2d6(p)));
}

// ---- Mothership 1e ----
ok('Stress overflow resolves to a Stat/Save reduction instead of disappearing',
   typeof systemModule.resolveMothershipStress === 'function' &&
   eq(systemModule.resolveMothershipStress(20, 1), { stress: 20, overflow: 1 }) &&
   eq(systemModule.resolveMothershipStress(19, 1), { stress: 20, overflow: 0 }));
// A check summary from an explicit tens/ones pair, so outcomes are deterministic.
const msc = (tens, ones, target, skill = null, adv = null) =>
  summarizeMothershipCheck({ tens, ones, value: tens + ones, double: tens / 10 === ones }, target, skill, adv);

// detection / parsing
ok('detect ms check', detectSystem('ms:c@35') === 'mothership');
ok('detect ms panic', detectSystem('ms:p@8') === 'mothership');
ok('ms not numeric', detectSystem('1d100') === 'numeric');
ok('parse ms:c@35', eq(parseMothership('ms:c@35'), { mode: 'check', target: 35, skill: null, advantage: null }));
ok('parse ms:c@35eadv', eq(parseMothership('ms:c@35eadv'), { mode: 'check', target: 35, skill: 'e', advantage: 'adv' }));
ok('parse ms:p@8dis', eq(parseMothership('ms:p@8dis'), { mode: 'panic', target: 8, skill: null, advantage: 'dis' }));
ok('parse bare ms:c', eq(parseMothership('ms:c'), { mode: 'check', target: null, skill: null, advantage: null }));
for (const bad of ['ms:', 'ms:x@5', 'ms:c@100', 'ms:p@5e', 'ms:p@1', 'ms:p@21', 'ms:c@0', 'ct:8']) {
  ok(`reject ms ${bad}`, (() => { try { parseMothership(bad); return false; } catch { return true; } })());
}

// roll-under outcomes and the absolute-rule specials
{
  ok('00 always crit-success', msc(0, 0, 35).outcome === 'crit-success');
  ok('99 always crit-failure', msc(90, 9, 35).outcome === 'crit-failure');
  ok('90-99 always fails', msc(90, 5, 99).outcome === 'failure');
  ok('under target succeeds', msc(20, 2, 35).success === true);          // 22 (also doubles)
  ok('at/over target fails', msc(40, 2, 35).outcome === 'failure');      // 42 ≥ 35
  ok('doubles under → crit-success', msc(30, 3, 35).outcome === 'crit-success'); // 33 < 35
  ok('doubles over → crit-failure', msc(40, 4, 35).outcome === 'crit-failure');  // 44 ≥ 35
  ok('crit-failure forces a Panic Check', msc(40, 4, 35).forcesPanic === true);
  ok('failed check gains 1 Stress', msc(40, 2, 35).stressDelta === 1);
  ok('success gains no Stress', msc(20, 0, 35).stressDelta === 0);
  ok('no target → unresolved', msc(40, 2, null).outcome === 'unresolved' && msc(40, 2, null).success === null);
  ok('bare 00 remains an absolute Critical Success',
     msc(0, 0, null).outcome === 'crit-success' && msc(0, 0, null).stressDelta === 0);
  ok('bare 99 remains an absolute Critical Failure with Stress and Panic',
     msc(90, 9, null).outcome === 'crit-failure' && msc(90, 9, null).stressDelta === 1 && msc(90, 9, null).forcesPanic === true);
}
// skill tier folds into the effective roll-under
{
  ok('expert raises the target by 15', msc(40, 0, 35, 'e').effective === 50);
  ok('40 under 50 (expert) succeeds', msc(40, 0, 35, 'e').success === true);
  ok('40 under 35 (no skill) fails', msc(40, 0, 35).success === false);
  ok('master is +20', msc(0, 0, 30, 'm').effective === 50);
}
// panic: roll over Stress
{
  const p = summarizeMothershipPanic(5, 8);
  ok('roll ≤ Stress panics', p.panicked === true && p.lookup === 5);
  ok('panic reports only the number', summarizeMothershipPanic(3, 8).lookup === 3);
  ok('roll over Stress holds', summarizeMothershipPanic(12, 8).panicked === false);
  ok('panic no stress → unresolved', summarizeMothershipPanic(5, null).panicked === null);
}
// roll shape: a check is a percentile pair, advantage rolls two and keeps one
{
  const r = rollMothership('ms:c@35');
  ok('ms system tag', r.system === 'mothership');
  ok('ms check is two d10', r.groups[0].dice.length === 2 && r.groups[0].dice.every(d => d.sides === 10));
  ok('ms check roles tens/ones', eq(r.groups[0].dice.map(d => d.role), ['tens', 'ones']));
  ok('rollAny routes ms', rollAny('ms:c@35').system === 'mothership');
  const ra = rollMothership('ms:c@35adv');
  ok('ms advantage rolls two pairs', ra.groups[0].dice.length === 4);
  ok('ms advantage keeps one pair', ra.groups[0].dice.filter(d => d.kept).length === 2);
  const rp = rollMothership('ms:p@8');
  ok('ms panic is one d20', rp.groups[0].dice.length === 1 && rp.groups[0].dice[0].sides === 20);
}
// Advantage/disadvantage keeps the best/worst resolved result, not merely the
// lower/higher raw number. Critical doubles can invert the numeric ordering.
{
  const withRandom = (values, fn) => {
    const original = globalThis.crypto.getRandomValues;
    const queue = [...values];
    globalThis.crypto.getRandomValues = array => { array[0] = queue.shift(); return array; };
    try { return fn(); } finally { globalThis.crypto.getRandomValues = original; }
  };
  // 10 = ordinary Success; 11 = Critical Success. Advantage must keep 11.
  const adv = withRandom([1, 0, 1, 1], () => rollMothership('ms:c@35adv'));
  ok('ms advantage prefers Critical Success 11 over ordinary Success 10',
     adv.summary.value === 11 && eq(adv.groups[0].dice.map(d => d.kept), [false, false, true, true]));
  // 88 = Critical Failure; 89 = ordinary Failure. Disadvantage must keep 88.
  const dis = withRandom([8, 8, 8, 9], () => rollMothership('ms:c@35dis'));
  ok('ms disadvantage prefers Critical Failure 88 over ordinary Failure 89',
     dis.summary.value === 88 && dis.summary.forcesPanic === true &&
     eq(dis.groups[0].dice.map(d => d.kept), [true, true, false, false]));
  // When both Panic rolls fail, the lower Panic Table result is better.
  const panicAdv = withRandom([2, 4], () => rollMothership('ms:p@8adv'));
  ok('ms Panic advantage keeps lower failed result 3 over 5',
     panicAdv.summary.value === 3 && eq(panicAdv.groups[0].dice.map(d => d.kept), [true, false]));
  const panicDis = withRandom([2, 4], () => rollMothership('ms:p@8dis'));
  ok('ms Panic disadvantage keeps higher failed result 5 over 3',
     panicDis.summary.value === 5 && eq(panicDis.groups[0].dice.map(d => d.kept), [false, true]));
}
// headline + describe
{
  ok('ms headline crit-success variant', mothershipHeadline({ summary: msc(0, 0, 35) }).variant === 'ms-crit-success');
  ok('ms headline failure text', mothershipHeadline({ summary: msc(40, 2, 35) }).text === 'Failure');
  ok('ms unresolved headline is a number', mothershipHeadline({ summary: msc(40, 2, null) }).kind === 'number');
  ok('ms panic headline', mothershipHeadline({ summary: summarizeMothershipPanic(5, 8) }).text === 'Panic');
  ok('ms steady headline', mothershipHeadline({ summary: summarizeMothershipPanic(12, 8) }).text === 'Steady');
  const txt = describeMothership({ summary: msc(40, 2, 35, 'e') });
  ok('ms describe shows percentile read', /rolled 42 \(40 \+ 2\)/.test(txt));
  ok('ms describe shows the effective target + skill', /under 50 \(35 \+15 Expert\)/.test(txt));
  ok('ms describe formats percentile zero as 00', /rolled 00 \(00 \+ 0\)/.test(describeMothership({ summary: msc(0, 0, 35) })));
  const overflowSummary = { ...msc(40, 2, 35), stressOverflow: 1 };
  const overflowText = describeMothership({ summary: overflowSummary });
  ok('ms Stress 20 overflow tells the player to reduce a Stat or Save',
     /Stress at 20.*reduce the relevant Stat or Save by 1/.test(overflowText) && !/\+1 Stress/.test(overflowText));
  const panicTxt = describeMothership({ summary: summarizeMothershipPanic(5, 8) });
  ok('ms panic describe says look up the number', /look up 5 on the Panic Table/.test(panicTxt));
  ok('ms panic describe reproduces no table text', !/Coward|Nervous|Adrenaline/.test(panicTxt));
}

// ---- Cards (the Woodcut deck) ----
// detection / parsing
ok('detect deck', detectSystem('deck:1') === 'cards');
ok('deck not numeric', detectSystem('1d52') === 'numeric');
ok('parse deck:3', eq(parseCards('deck:3'), { draw: 3, jokers: false, replace: false }));
ok('parse deck:3 jokers', eq(parseCards('deck:3 jokers'), { draw: 3, jokers: true, replace: false }));
ok('parse deck:1 replace', eq(parseCards('deck:1 replace'), { draw: 1, jokers: false, replace: true }));
ok('deck flags are order-free and plus-joinable', eq(parseCards('deck:5 replace+jokers'), { draw: 5, jokers: true, replace: true }));
ok('deck flag short forms', eq(parseCards('deck:2 j rep'), { draw: 2, jokers: true, replace: true }));
ok('deck flags are case-insensitive', eq(parseCards('DECK:2 Jokers'), { draw: 2, jokers: true, replace: false }));
for (const bad of ['deck:', 'deck:0', 'deck:11', 'deck:1x', 'deck:1 wild', 'ms:c']) {
  ok(`reject deck ${bad}`, (() => { try { parseCards(bad); return false; } catch { return true; } })());
}
// shuffle: a permutation, not a mutation, honouring an injected rng
{
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const identity = newDeckOrder(ids, () => 1); // rng always picks index 0
  ok('shuffle returns a permutation', identity.length === 5 && [...identity].sort().join('') === 'abcde');
  ok('shuffle does not mutate its input', ids.join('') === 'abcde');
  // Fixed rng ⇒ deterministic order, so tests can pin a deck.
  ok('shuffle is deterministic under a fixed rng', eq(newDeckOrder(ids, () => 1), newDeckOrder(ids, () => 1)));
  const crypto1 = newDeckOrder(ids);
  ok('default rng still permutes', [...crypto1].sort().join('') === 'abcde');
}
// summaries + formatters
{
  const KS = { id: 'KS', label: 'K♠', red: false }, TH = { id: '10H', label: '10♥', red: true };
  const one = { summary: summarizeCards([KS], 51, 52) };
  ok('single draw headline is the card', eq(cardsHeadline(one), { kind: 'text', text: 'K♠', variant: undefined }));
  ok('red card carries the red variant', cardsHeadline({ summary: summarizeCards([TH], 51, 52) }).variant === 'card-red');
  const three = { summary: summarizeCards([KS, TH, { id: 'J1', label: 'Joker (Le Fov)', red: false }], 41, 54) };
  ok('multi draw headline is the count', eq(cardsHeadline(three), { kind: 'number', text: '3' }));
  ok('describe lists cards and remaining', /K♠ {2}10♥ {2}Joker \(Le Fov\) · 41 of 54 left/.test(describeCards(three)));
  const empty = { summary: summarizeCards([], 0, 52) };
  ok('empty deck headline', cardsHeadline(empty).text === 'Deck empty');
  const last = { summary: summarizeCards([KS], 0, 52) };
  ok('exhaustion is called out', /deck exhausted — shuffle to continue/.test(describeCards(last)));
}

// ---- Tarot (the Woodcut Tarot) ----
// detection / parsing
ok('detect tarot', detectSystem('tarot:1') === 'tarot');
ok('tarot not cards', detectSystem('tarot:3') !== 'cards');
ok('parse tarot:3', eq(parseTarot('tarot:3'), { draw: 3, reversals: true, majors: false, replace: false }));
ok('parse tarot:3 majors', eq(parseTarot('tarot:3 majors'), { draw: 3, reversals: true, majors: true, replace: false }));
ok('parse tarot:1 upright turns reversals off', eq(parseTarot('tarot:1 upright'), { draw: 1, reversals: false, majors: false, replace: false }));
ok('tarot flags combine, order-free', eq(parseTarot('tarot:5 replace majors upright'), { draw: 5, reversals: false, majors: true, replace: true }));
ok('tarot flag short forms', eq(parseTarot('tarot:2 maj up'), { draw: 2, reversals: false, majors: true, replace: false }));
for (const bad of ['tarot:', 'tarot:0', 'tarot:11', 'tarot:1x', 'tarot:1 wild', 'deck:1']) {
  ok(`reject tarot ${bad}`, (() => { try { parseTarot(bad); return false; } catch { return true; } })());
}
// summaries + formatters (reversals ride on each drawn card)
{
  const FOOL = { id: 'T00', label: 'The Fool', rev: false };
  const TOWER_R = { id: 'T16', label: 'The Tower', rev: true };
  const one = { summary: summarizeTarot([FOOL], 77, 78) };
  ok('single tarot headline is the card', eq(tarotHeadline(one), { kind: 'text', text: 'The Fool', variant: undefined }));
  const rev = { summary: summarizeTarot([TOWER_R], 77, 78) };
  ok('reversed card says so and carries the variant',
     eq(tarotHeadline(rev), { kind: 'text', text: 'The Tower (reversed)', variant: 'tarot-rev' }));
  const three = { summary: summarizeTarot([FOOL, TOWER_R, { id: 'c07', label: 'Seven of Cups', rev: false }], 69, 78) };
  ok('multi tarot headline is the count', eq(tarotHeadline(three), { kind: 'number', text: '3' }));
  ok('describe marks reversals inline',
     /The Fool {2}The Tower \(reversed\) {2}Seven of Cups · 69 of 78 left/.test(describeTarot(three)));
  const empty = { summary: summarizeTarot([], 0, 78) };
  ok('empty tarot deck headline', tarotHeadline(empty).text === 'Deck empty');
  const last = { summary: summarizeTarot([FOOL], 0, 78) };
  ok('tarot exhaustion is called out', /deck exhausted — shuffle to continue/.test(describeTarot(last)));
}

// ---- Carte napoletane ----
ok('detect ita', detectSystem('ita:1') === 'napoletane');
ok('nap: stays an alias', detectSystem('nap:1') === 'napoletane');
ok('parse ita:3', eq(parseNapoletane('ita:3'), { draw: 3, replace: false }));
ok('parse via alias', eq(parseNapoletane('nap:3'), { draw: 3, replace: false }));
ok('parse ita:1 replace', eq(parseNapoletane('ita:1 replace'), { draw: 1, replace: true }));
for (const bad of ['ita:', 'ita:0', 'ita:11', 'ita:1 jokers', 'deck:1']) {
  ok(`reject ita ${bad}`, (() => { try { parseNapoletane(bad); return false; } catch { return true; } })());
}

// ---- Ironsworn / Starforged ----
ok('detect iron', detectSystem('iron:+2') === 'ironsworn');
ok('parse iron: (no adds)', eq(parseIronsworn('iron:'), { progress: false, modifier: 0, progressScore: null }));
ok('parse iron:+2', eq(parseIronsworn('iron:+2'), { progress: false, modifier: 2, progressScore: null }));
ok('parse iron:2 (bare adds)', eq(parseIronsworn('iron:2'), { progress: false, modifier: 2, progressScore: null }));
ok('parse iron:-1 (negative)', eq(parseIronsworn('iron:-1'), { progress: false, modifier: -1, progressScore: null }));
ok('parse iron:p6 (progress)', eq(parseIronsworn('iron:p6'), { progress: true, modifier: null, progressScore: 6 }));
for (const bad of ['iron:p11', 'iron:21', 'iron:-10', 'iron:xyz', 'ironx', 'dg:60']) {
  ok(`reject iron ${bad}`, (() => { try { parseIronsworn(bad); return false; } catch { return true; } })());
}
{
  const sum = (o) => summarizeIronsworn(o);
  const base = { progress: false, actionDie: 4, modifier: 2 };
  ok('strong hit beats both', sum({ ...base, score: 6, challenge: [3, 5], match: false }).outcome === 'strong');
  ok('weak hit beats one', sum({ ...base, score: 6, challenge: [7, 5], match: false }).outcome === 'weak');
  ok('miss beats neither', sum({ ...base, score: 4, challenge: [7, 9], match: false }).outcome === 'miss');
  ok('a tie is not a beat', sum({ ...base, score: 6, challenge: [6, 2], match: false }).outcome === 'weak');
  ok('strong is a success', sum({ ...base, score: 6, challenge: [3, 5], match: false }).success === true);
  ok('miss is not a success', sum({ ...base, score: 4, challenge: [7, 9], match: false }).success === false);
  const matchStrong = { summary: sum({ ...base, score: 6, challenge: [2, 2], match: true }) };
  ok('match strong headline + variant', eq(ironswornHeadline(matchStrong), { kind: 'text', text: 'Strong Hit — Match', variant: 'band-hit' }));
  ok('weak headline variant is amber', ironswornHeadline({ summary: sum({ ...base, score: 6, challenge: [7, 5], match: false }) }).variant === 'band-partial');
  ok('miss headline variant is muted', ironswornHeadline({ summary: sum({ ...base, score: 4, challenge: [7, 9], match: false }) }).variant === 'band-miss');
  const prog = { summary: sum({ progress: true, actionDie: null, modifier: null, score: 8, challenge: [3, 5], match: false }) };
  ok('progress roll resolves without an action die', prog.summary.outcome === 'strong' && prog.summary.actionDie === null);
  ok('progress describe reads progress N', /progress 8 vs 3, 5/.test(describeIronsworn(prog)));
  ok('action describe shows the math', /action 4 \+ 2 = 6 vs 3, 5/.test(describeIronsworn({ summary: sum({ ...base, score: 6, challenge: [3, 5], match: false }) })));
}
{
  // live rng: score is always capped at 10 and every roll resolves
  for (let i = 0; i < 200; i++) {
    const r = rollIronsworn('iron:20');
    ok('score capped at 10', r.summary.score <= 10, `score=${r.summary.score}`);
    ok('outcome always resolves', ['strong', 'weak', 'miss'].includes(r.summary.outcome));
    const chall = r.groups[0].dice.filter(d => d.role === 'challenge');
    ok('two challenge dice on the tray', chall.length === 2);
    ok('action die present on action roll', r.groups[0].dice.some(d => d.role === 'action'));
  }
  const p = rollIronsworn('iron:p0');
  ok('progress roll has no action die', !p.groups[0].dice.some(d => d.role === 'action'));
}

console.log(`\nsystem-dice: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
