// result-text.js — the words for a completed roll: the big headline and the
// detail line under it. Shared by the app's readout and the Owlbear toast, so
// the corner window reads a roll exactly as the roller's own panel does — one
// source of truth, like tray-faces.js is for the dice themselves.
//
// The one seam: uta-garuta's detail can quote the poem, which needs the lazily
// loaded art module and the panel's language setting, so the app wraps
// formatDetail with its own richer version for that system and everything else
// lands here.
import { describe } from './dice.js';
import { oracleReading } from './oracle-dice.js';
import {
  v5Headline, describeV5, fateHeadline, describeFate,
  genesysHeadline, describeGenesys, daggerheartHeadline, describeDaggerheart,
  cthulhutechHeadline, describeCthulhuTech, yearzeroHeadline, describeYearZero,
  bladeRunnerHeadline, describeBladeRunner, twilightHeadline, describeTwilight,
  starWarsHeadline, describeStarWars, oneRingHeadline, describeOneRing,
  twod6Headline, describe2d6, drawSteelHeadline, describeDrawSteel,
  mothershipHeadline, describeMothership,
  callOfCthulhuHeadline, describeCallOfCthulhu, deltaGreenHeadline, describeDeltaGreen,
  ironswornHeadline, describeIronsworn, cardsHeadline, describeCards,
  tarotHeadline, describeTarot,
} from './system-dice.js';

export function formatHeadline(result) {
  if (result.system === 'v5') return v5Headline(result);
  if (result.system === 'fate') return fateHeadline(result);
  if (result.system === 'genesys') return genesysHeadline(result);
  if (result.system === 'daggerheart') return daggerheartHeadline(result);
  if (result.system === 'cthulhutech') return cthulhutechHeadline(result);
  if (result.system === 'yearzero') return yearzeroHeadline(result);
  if (result.system === 'bladerunner') return bladeRunnerHeadline(result);
  if (result.system === 'twilight') return twilightHeadline(result);
  if (result.system === 'starwars') return starWarsHeadline(result);
  if (result.system === 'onering') return oneRingHeadline(result);
  if (result.system === 'pbta' || result.system === 'mist') return twod6Headline(result);
  if (result.system === 'drawsteel') return drawSteelHeadline(result);
  if (result.system === 'mothership') return mothershipHeadline(result);
  if (result.system === 'coc') return callOfCthulhuHeadline(result);
  if (result.system === 'deltagreen') return deltaGreenHeadline(result);
  if (result.system === 'ironsworn') return ironswornHeadline(result);
  if (result.system === 'oracle') return { kind: 'text', text: oracleReading(result.summary), variant: 'oracle' };
  if (result.system === 'cards') return cardsHeadline(result);
  if (result.system === 'tarot') return tarotHeadline(result);
  if (result.system === 'napoletane') return cardsHeadline(result);
  if (result.system === 'hanafuda') return cardsHeadline(result);
  if (result.system === 'utagaruta') return cardsHeadline(result);
  return { kind: 'number', text: String(result.total) };
}

export function formatDetail(result) {
  if (result.system === 'v5') return describeV5(result);
  if (result.system === 'fate') return describeFate(result);
  if (result.system === 'genesys') return describeGenesys(result);
  if (result.system === 'daggerheart') return describeDaggerheart(result);
  if (result.system === 'cthulhutech') return describeCthulhuTech(result);
  if (result.system === 'yearzero') return describeYearZero(result);
  if (result.system === 'bladerunner') return describeBladeRunner(result);
  if (result.system === 'twilight') return describeTwilight(result);
  if (result.system === 'starwars') return describeStarWars(result);
  if (result.system === 'onering') return describeOneRing(result);
  if (result.system === 'pbta' || result.system === 'mist') return describe2d6(result);
  if (result.system === 'drawsteel') return describeDrawSteel(result);
  if (result.system === 'mothership') return describeMothership(result);
  if (result.system === 'coc') return describeCallOfCthulhu(result);
  if (result.system === 'deltagreen') return describeDeltaGreen(result);
  if (result.system === 'ironsworn') return describeIronsworn(result);
  if (result.system === 'oracle') {
    const o = result.summary;
    let s = `${o.name} · d${o.sides} = ${o.roll}`;
    if (o.suggested && o.suggested.length) s += ' · may also roll ' + o.suggested.map(x => x.name + (x.n > 1 ? ` ×${x.n}` : '')).join(', ');
    return s;
  }
  if (result.system === 'cards') return describeCards(result);
  if (result.system === 'tarot') return describeTarot(result);
  if (result.system === 'napoletane') return describeCards(result);
  if (result.system === 'hanafuda') return describeCards(result);
  // The app overrides this one with the poem-quoting version; here the plain
  // card line is the honest fallback.
  if (result.system === 'utagaruta') return describeCards(result);
  return describe(result.groups);
}
