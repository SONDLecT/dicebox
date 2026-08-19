// tray-faces.js — how a rolled die looks: its system's colour and the face it
// shows. Shared by the app's tray and the Owlbear toast, so a roll replayed in
// the little corner window paints exactly like the tray that threw it — one
// source of truth, no drift. The renderer itself stays system-agnostic: these
// functions stamp fields (genColor, genFace, v5Face, …) that render.js paints.
import { v5Face, fateFace } from './system-dice.js';

// PbtA / Mist Engine 2d6 outcome bands, applied to both dice: a strong result
// glows, a partial is cautionary amber, a miss goes muted. Legible on both trays.
export const BAND_COLORS = { hit: '#57B591', partial: '#C99A3C', miss: '#9A7070' };

// Forged in the Dark: only the READ die is coloured — a crit in bright
// ghost-fire cyan, a full success in the electric Duskwall teal, a partial in
// cautionary amber, a failure in cold smoke; the unread dice fade on their own
// (kept:false). On a crit every 6 wears the crit colour so the pair stands
// together. Legible on both trays.
export const FITD_COLORS = { crit: '#7FE9DE', success: '#39C2B7', partial: '#C99A3C', failure: '#8A8088' };

// The Force die's pips: Light side pale, Dark side a mystic violet (the pips are
// black/white on the real die, but black is invisible on the dark tray).
export const FORCE_COLORS = { lightside: '#DEE4EC', darkside: '#8267AE' };

// One Ring dice colours: the bronze Feat die, a bright gold for the Gandalf
// rune, Sauron-red for the Eye; Success dice in parchment, their Tengwar 6 in
// gold, and Weary-nullified (1-3) faded.
export const TOR_COLORS = {
  feat: '#B5893C', gandalf: '#E8C24E', eye: '#C0453F',
  success: '#CBBF9F', rune: '#D8AE45', weary: '#5E5A4E',
};

// CthulhuTech dice are d10s read even/odd: every even is a Hit and glows green,
// every odd is a miss and stays grey. Constant hues, legible on both trays.
export const CT_COLORS = { hit: '#57B591', miss: '#6B7378' };

// Daggerheart dice colour by role — Hope gold, Fear violet, and a green/red d6
// for advantage/disadvantage. Constant hues, legible on both trays.
export const DH_COLORS = {
  hope: '#C9A227',
  fear: '#7E6BB5',
  advantage: '#4E9E60',
  disadvantage: '#C24046',
};

// Mothership dice tint by outcome, the way CthulhuTech tints hits: a Check comes
// up green when it lands under the target, red when it fails; a Panic d20 goes
// red on a Panic, green when it holds. Before a roll the staged percentile pair
// wears its acid-green tens / steel ones so the d100 reads as two dice.
export const MS_COLORS = {
  success: '#5DAE6A', fail: '#D2603E',
  tens: '#AEC93C', ones: '#6A757C', panic: '#8FA0A8',
};

// Genesys dice are colour-coded by type — the one place a system paints its own
// dice rather than using the chrome accent. Medium tones chosen to read on both
// the light and dark tray.
export const GEN_COLORS = {
  ability: '#4E9E60',      // green
  proficiency: '#C39A2E',  // yellow
  boost: '#4C86C6',        // blue
  difficulty: '#8A5CC0',   // purple
  challenge: '#C24046',    // red
  setback: '#7C828A',      // black die → a legible smoke grey
};

// Year Zero dice, after the physical pool: yellow Base, green Skill, black Gear,
// and the Alien Stress die in a warning orange to read as the panic risk it is.
export const YZ_COLORS = {
  base: '#D9A441',
  skill: '#5BA860',
  gear: '#8C919A',
  stress: '#D86A3A',
};

// Blade Runner step dice: the Attribute die takes the neon teal, the Skill die a
// warm amber, and an advantage die a cool green.
export const BR_COLORS = {
  attribute: '#38C6C6',
  skill: '#D9A441',
  advantage: '#5BA860',
};

// Twilight: 2000 — olive Attribute, amber Skill, and the tan of the physical
// ammo dice.
export const T2K_COLORS = {
  attribute: '#9AA36A',
  skill: '#D9A441',
  ammo: '#C8B48A',
};

export const COC_COLORS = { crit: '#8FC98A', success: '#5DAE6A', fail: '#C0453F', fumble: '#8E2F26', tens: '#7F9B57', ones: '#6A757C', bonus: '#5DAE6A', penalty: '#C0453F' };

export const DG_COLORS = { crit: '#7FCF95', success: '#57A06A', fail: '#C0453F', fumble: '#8E2F26', tens: '#5E8A63', ones: '#6A757C' };

export const IRON_COLORS = { action: '#C9A227', beaten: '#57A06A', miss: '#C0453F', challenge: '#6E7F8C', oracle: '#8AA1AE' };

// Flatten a result's dice groups into the paint list the tray works from — one
// entry per die, carrying everything the stamping below reads.
export function flattenRollDice(result) {
  const flat = [];
  for (const g of result.groups) {
    if (g.kind !== 'dice') continue;
    for (const d of g.dice) {
      flat.push({
        // Genesys dice carry their own `sides` per type; V5 groups are d10s and
        // carry no numeric `sides`; fall back to 10.
        sides: d.sides ?? g.sides ?? 10,
        value: d.value,
        // Carried onto the tray so a die can show what happened to it: dropped
        // dice fade, exploded and rerolled ones get a mark. Hunger dice (V5)
        // keep their flag so they paint as blood dice.
        kept: d.kept,
        exploded: d.exploded,
        rerolled: d.rerolled,
        hunger: d.hunger,
        // Genesys: the symbols the face shows and the die-type colour key.
        symbols: d.symbols,
        genColorKey: d.color,
        // Daggerheart/One Ring: the die's role, and (One Ring) its Feat face.
        role: d.role,
        torFaceKind: d.face,
        // Year Zero: which colour of die (base/skill/gear/stress).
        yzType: d.type,
        // Ironsworn: whether the action score beat this challenge die.
        beaten: d.beaten,
        // Forged in the Dark: a 6 that forms part of a critical pair.
        crit: d.crit,
      });
    }
  }
  return flat;
}

// Stamp one tray die with its system's face and colour. `die` is any object the
// renderer will read (a render.js Die); `f` is one flattenRollDice entry;
// `result` supplies the system id and the summary fields some tints read.
// Systems not listed here (numeric, DCC's chain recolour) leave the die bare
// for the caller to dress.
export function stampTrayDie(die, f, result) {
  // Symbol dice stamp the face the die should draw when it settles, so the
  // renderer needs no system knowledge — it just paints a glyph.
  if (result.system === 'v5') die.v5Face = v5Face(f.value, f.hunger);
  else if (result.system === 'fate') die.fateFace = fateFace(f.value);
  else if (result.system === 'genesys' || result.system === 'starwars') {
    die.genFace = f.symbols;
    // The Force die is coloured by the pips it rolled (light or dark); every
    // other narrative die by its type.
    die.genColor = f.genColorKey === 'force'
      ? FORCE_COLORS[f.symbols[0]] || CT_COLORS.miss
      : GEN_COLORS[f.genColorKey];
  }
  // Daggerheart dice are numbered d12s/d6s tinted by their role — no glyph,
  // just the value drawn in the Hope/Fear colour.
  else if (result.system === 'daggerheart') die.genColor = DH_COLORS[f.role];
  // CthulhuTech d10s glow green when even (a Hit), grey when odd (a miss).
  else if (result.system === 'cthulhutech') die.genColor = f.value % 2 === 0 ? CT_COLORS.hit : CT_COLORS.miss;
  // Year Zero d6s are coloured by die type — Base/Skill/Gear/Stress — so a 1 on
  // a Base or Gear die (a bane) and a 1 on a Stress die (a Panic) read by colour.
  else if (result.system === 'yearzero') die.genColor = YZ_COLORS[f.yzType] || YZ_COLORS.base;
  // Blade Runner: the Attribute die is teal, the Skill die amber, advantage green.
  else if (result.system === 'bladerunner') die.genColor = BR_COLORS[f.role] || BR_COLORS.attribute;
  // Twilight: 2000 — olive Attribute, amber Skill, tan Ammo dice.
  else if (result.system === 'twilight') die.genColor = T2K_COLORS[f.role] || T2K_COLORS.attribute;
  // One Ring: the Feat die shows a numeral, the Eye, or the Gandalf rune;
  // Success dice show their value, tinted (Tengwar 6 gold, Weary 1-3 faded).
  else if (result.system === 'onering') {
    if (f.role === 'feat') {
      if (f.torFaceKind === 'eye' || f.torFaceKind === 'gandalf') die.torFace = f.torFaceKind;
      die.genColor = f.torFaceKind === 'gandalf' ? TOR_COLORS.gandalf
        : f.torFaceKind === 'eye' ? TOR_COLORS.eye : TOR_COLORS.feat;
    } else {
      const dropped = result.summary?.weary && f.value <= 3;
      die.genColor = dropped ? TOR_COLORS.weary : f.value === 6 ? TOR_COLORS.rune : TOR_COLORS.success;
    }
  }
  // PbtA / Mist: both d6s take the outcome-band colour of the whole roll.
  else if (result.system === 'pbta' || result.system === 'mist') die.genColor = BAND_COLORS[result.summary?.band];
  // Forged in the Dark: colour only the read die (a crit's sixes each), so the
  // die that decided it reads at a glance; the rest fade via kept:false.
  else if (result.system === 'fitd') {
    if (f.crit) die.genColor = FITD_COLORS.crit;
    else if (f.kept) die.genColor = FITD_COLORS[result.summary?.result] || FITD_COLORS.failure;
  }
  // Mothership: the kept dice tint by the resolved outcome (green pass / red
  // fail); a dropped adv/dis pair fades on its own via kept=false. With no
  // outcome yet (unresolved check), keep the percentile tens/ones tints.
  else if (result.system === 'mothership') {
    const s = result.summary;
    const passed = s.mode === 'panic' ? s.panicked === false : s.success;
    // A percentile tens die is labelled 00–90 while retaining its numeric
    // 0–90 value for reduction, history, and room validation.
    if (f.role === 'tens') die.displayLabel = String(f.value).padStart(2, '0');
    if (passed === true) die.genColor = MS_COLORS.success;
    else if (passed === false) die.genColor = MS_COLORS.fail;
    else die.genColor = f.role === 'tens' ? MS_COLORS.tens : f.role === 'panic' ? MS_COLORS.panic : MS_COLORS.ones;
  }
  // Call of Cthulhu / Delta Green percentile pairs: the tens die is labelled
  // 00-90, and the kept dice tint by the resolved outcome (crit/success green,
  // fumble/failure red); a dropped bonus/penalty die fades via kept=false.
  else if (result.system === 'coc' || result.system === 'deltagreen') {
    const C = result.system === 'coc' ? COC_COLORS : DG_COLORS;
    const o = result.summary.outcome;
    if (f.role === 'tens') die.displayLabel = String(f.value).padStart(2, '0');
    // A dropped bonus/penalty tens die keeps its green/red tint (faded by
    // kept=false), so the modifier stays visible next to the kept result.
    if (result.system === 'coc' && f.role === 'tens' && !f.kept) {
      die.genColor = result.summary.modifier > 0 ? C.bonus : C.penalty;
    }
    else if (o === 'critical') die.genColor = C.crit;
    else if (o === 'fumble') die.genColor = C.fumble;
    else if (result.summary.success === true) die.genColor = C.success;
    else if (result.summary.success === false) die.genColor = C.fail;
    else die.genColor = f.role === 'tens' ? C.tens : C.ones;
  }
  // Ironsworn / Starforged: the action die is gold; each challenge die shows
  // green if the score beat it and red if not, so the tray reads the outcome
  // at a glance (both green = Strong, one = Weak, none = Miss).
  else if (result.system === 'ironsworn') {
    if (f.role === 'action') die.genColor = IRON_COLORS.action;
    else die.genColor = f.beaten ? IRON_COLORS.beaten : IRON_COLORS.miss;
  }
  // An oracle draw is a single dN in the steel oracle colour — neutral, since a
  // table result is information, not a pass/fail.
  else if (result.system === 'oracle') die.genColor = IRON_COLORS.oracle;
}
