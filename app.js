import { roll, describe } from './dice.js';
import { Die, Surface, separate, beginFrame } from './render.js';
import { createRoom, parsePassphraseFromHash } from './room.js';
import { generatePassphrase, normalizePassphrase } from './room-crypto.js';
import { rollV5, describeV5, v5Headline, detectSystem, v5Face, parseV5 } from './system-dice.js';
import { rollFate, describeFate, fateHeadline, fateFace, parseFate } from './system-dice.js';
import { rollGenesys, describeGenesys, genesysHeadline, parseGenesys } from './system-dice.js';
import { rollDaggerheart, describeDaggerheart, daggerheartHeadline, parseDaggerheart } from './system-dice.js';
import { rollCthulhuTech, describeCthulhuTech, cthulhutechHeadline, parseCthulhuTech } from './system-dice.js';
import { rollMothership, describeMothership, mothershipHeadline, parseMothership, resolveMothershipStress } from './system-dice.js';
import { parseCards, newDeckOrder, summarizeCards, cardsHeadline, describeCards } from './system-dice.js';
import { rollStarWars, describeStarWars, starWarsHeadline, parseStarWars } from './system-dice.js';
import { rollOneRing, describeOneRing, oneRingHeadline, parseOneRing } from './system-dice.js';
import { rollPbta, rollMist, twod6Headline, describe2d6, parsePbta, parseMist } from './system-dice.js';

const $ = id => document.getElementById(id);
const canvas = $('tray');
const ctx = canvas.getContext('2d');

// Whether this copy is running inside someone else's page — the Owlbear Rodeo
// panel, or any other iframe. A few things that are right for a page of our own
// are wrong when embedded: installing a service worker, and offering to install
// the app to a home screen from inside a popover that has neither an address
// bar nor a reload button.
//
// Reading window.top throws when the parent is a different origin and the
// browser is strict about it, and that throw is itself the answer: only an
// embedded copy can be cross-origin to its parent.
const embedded = (() => {
  try { return window.top !== window.self; } catch { return true; }
})();

// One row of dice, ordered by size: the standard RPG set plus every Dungeon
// Crawl Classics chain rung, plus d100. Gaps like d9 and d11 are deliberate —
// no published system uses them, and the notation field covers anything here.
const QUICK = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30, 100];

// The standard polyhedral set. Daggerheart (and most systems) only ever roll
// these, so its dice strip hides the rest of the DCC oddities.
const STANDARD_DICE = new Set([4, 6, 8, 10, 12, 20]);

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

// Preferences, through a guard, because reaching localStorage can throw rather
// than return null. Safari in private browsing does it, and so does any browser
// that partitions or blocks storage for an embedded copy — which is what an
// Owlbear panel or any other iframe is.
//
// The read below runs at module top level, so a throw there took the entire app
// with it: no dice, no error line, just a blank page and nothing to report. A
// theme that will not persist is worth a shrug; losing the dice roller is not.
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* see above */ }
  },
};

const stored = store.get('dicebox:theme');
if (stored === 'dark' || stored === 'light') document.documentElement.dataset.theme = stored;
syncThemeLabel();

$('themeToggle').addEventListener('click', () => {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
  store.set('dicebox:theme', document.documentElement.dataset.theme);
  syncThemeLabel();
  updateThemeColor();
  // Re-apply the active system's palette so its dark/light pair follows the
  // toggle instead of being frozen at whichever mode was active on roll.
  applySystemTheme(uiSystem);
});

systemDark.addEventListener('change', () => {
  if (document.documentElement.dataset.theme) return; // pinned by choice
  syncThemeLabel();
  updateThemeColor();
  // A system palette is written as inline custom properties, so it overrides the
  // stylesheet's own dark rules and cannot follow the OS on its own.
  applySystemTheme(uiSystem);
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

// Per-system palettes override the CSS custom properties the canvas and panels
// read, so switching systems visibly recolours the whole app. Every system ships
// a dark and a light pair (the approved design doc: each system = a different
// background/text/line, each with a light-dark pair).
// Every variable the stylesheet themes, so a system palette replaces the whole
// scheme rather than recolouring four of seven and leaving panel fills and hair
// lines behind from the default one.
const THEMED_VARS = ['--paper', '--face', '--line', '--muted', '--hair', '--accent', '--danger'];

const SYSTEM_THEMES = {
  // Vampire the Masquerade — blood crimson on near-black / aged paper. The
  // crimson is the constant: only the neutrals flip, so the mode stays
  // recognisable as V5 in either theme.
  v5: {
    dark: {
      '--paper': '#0B0809', '--face': '#151011', '--line': '#E4D3CE', '--muted': '#7A6A63',
      '--hair': '#2A1C1E', '--accent': '#C3212E', '--danger': '#E0685F',
    },
    light: {
      '--paper': '#EFE6DE', '--face': '#F8F2EC', '--line': '#241417', '--muted': '#8A7070',
      '--hair': '#D8C9BE', '--accent': '#A31621', '--danger': '#8C3A2E',
    },
  },
  // Fate / Fudge — a calm steel-slate blue, matching the system's unadorned
  // feel. The slate is the constant; the neutrals cool slightly and flip.
  fate: {
    dark: {
      '--paper': '#0E1114', '--face': '#171B20', '--line': '#D6DCE3', '--muted': '#6B7580',
      '--hair': '#252C33', '--accent': '#6E96BE', '--danger': '#CB7E70',
    },
    light: {
      '--paper': '#ECEFF3', '--face': '#F7F9FB', '--line': '#1B2530', '--muted': '#78828D',
      '--hair': '#D2D8DF', '--accent': '#3C6489', '--danger': '#8C3A2E',
    },
  },
  // Genesys — the dice carry the colour here (a per-type map, below), so the
  // chrome stays neutral with a warm narrative-gold accent for the readout.
  genesys: {
    dark: {
      '--paper': '#0F1012', '--face': '#191A1D', '--line': '#DCDDE1', '--muted': '#6D6F75',
      '--hair': '#26282C', '--accent': '#BFA766', '--danger': '#C97A6E',
    },
    light: {
      '--paper': '#EDEEF0', '--face': '#F8F8FA', '--line': '#1C1D20', '--muted': '#74767C',
      '--hair': '#D6D7DB', '--accent': '#8A7327', '--danger': '#8C3A2E',
    },
  },
  // Daggerheart — gold and deep violet, its Hope/Fear duality. Gold accent; the
  // Hope/Fear dice carry their own colours (below).
  daggerheart: {
    dark: {
      '--paper': '#12101A', '--face': '#1C1826', '--line': '#E7E1EE', '--muted': '#726C82',
      '--hair': '#2A2536', '--accent': '#D4A93C', '--danger': '#C97A6E',
    },
    light: {
      '--paper': '#F0ECF2', '--face': '#FAF7FB', '--line': '#211B2A', '--muted': '#7C7488',
      '--hair': '#DBD4E1', '--accent': '#976C1B', '--danger': '#8C3A2E',
    },
  },
  // CthulhuTech — a sickly eldritch sea-green on near-black. Even dice (hits)
  // glow green; odd ones stay grey (below).
  cthulhutech: {
    dark: {
      '--paper': '#0B0F0D', '--face': '#131A16', '--line': '#DBE3DD', '--muted': '#647069',
      '--hair': '#1E2822', '--accent': '#57A98A', '--danger': '#C77A6E',
    },
    light: {
      '--paper': '#E9EEEB', '--face': '#F5F8F6', '--line': '#141D18', '--muted': '#6C7871',
      '--hair': '#D0DAD3', '--accent': '#2E7358', '--danger': '#8C3A2E',
    },
  },
  // Star Wars — like Genesys, the dice carry the colour; the chrome is a calm
  // starfield blue.
  starwars: {
    dark: {
      '--paper': '#0C0F14', '--face': '#141922', '--line': '#DCE1E8', '--muted': '#69707B',
      '--hair': '#212833', '--accent': '#5B9BD5', '--danger': '#C77A6E',
    },
    light: {
      '--paper': '#ECEEF2', '--face': '#F7F8FB', '--line': '#161B22', '--muted': '#727984',
      '--hair': '#D4D9E0', '--accent': '#2F6FB0', '--danger': '#8C3A2E',
    },
  },
  // The One Ring — bronze and gold on dark wood-and-stone; aged parchment for
  // light.
  onering: {
    dark: {
      '--paper': '#14110B', '--face': '#1E1911', '--line': '#E6DCC6', '--muted': '#7A6F5A',
      '--hair': '#2A2317', '--accent': '#B5893C', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#EEE7D8', '--face': '#F8F3E8', '--line': '#211B11', '--muted': '#7E6E56',
      '--hair': '#DBD0BB', '--accent': '#7A5A22', '--danger': '#8C3A2E',
    },
  },
  // Powered by the Apocalypse — warm ember: rust and amber over charred paper,
  // a lit-hearth cream for light.
  pbta: {
    dark: {
      '--paper': '#181210', '--face': '#241A16', '--line': '#F0E3D6', '--muted': '#8A7566',
      '--hair': '#33241D', '--accent': '#D97A3C', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#F3E9DF', '--face': '#FBF4EC', '--line': '#241812', '--muted': '#836E5E',
      '--hair': '#E4D5C6', '--accent': '#B75A22', '--danger': '#9A3A2E',
    },
  },
  // Mist Engine — moody teal and dim gold, fog over deep water; a pale seafoam
  // for light.
  mist: {
    dark: {
      '--paper': '#0E1618', '--face': '#152123', '--line': '#DCEAEA', '--muted': '#5F8385',
      '--hair': '#1E2E30', '--accent': '#3F9FA0', '--danger': '#C25B54',
    },
    light: {
      '--paper': '#E3EEED', '--face': '#F0F7F6', '--line': '#0F1E1F', '--muted': '#557072',
      '--hair': '#CBDDDC', '--accent': '#227E7F', '--danger': '#9A443C',
    },
  },
  // Cards — card-table felt: a deep baize green, darker and greener than
  // CthulhuTech's minty sea-glass, under ivory cards.
  cards: {
    dark: {
      '--paper': '#0A0F0C', '--face': '#121A15', '--line': '#DDE5DF', '--muted': '#6E7F74',
      '--hair': '#1D2B23', '--accent': '#2F8B57', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E7EDE8', '--face': '#F4F8F5', '--line': '#14201A', '--muted': '#5F7266',
      '--hair': '#CDD9D0', '--accent': '#1E6B41', '--danger': '#8C3A2E',
    },
  },
  // Mothership — a hazard-label palette: reactor-warning chartreuse over cold
  // gunmetal steel, the industrial radiation-caution look that sets it apart from
  // the four gold systems. The acid green is the constant; only the steel
  // neutrals flip for light, where the accent deepens to hold WCAG AA contrast.
  mothership: {
    dark: {
      '--paper': '#0C0E10', '--face': '#15181C', '--line': '#DCE2E6', '--muted': '#7D8991',
      '--hair': '#232a30', '--accent': '#AEC93C', '--danger': '#D2603E',
    },
    light: {
      '--paper': '#E7EAEC', '--face': '#F4F6F7', '--line': '#14181B', '--muted': '#59656B',
      '--hair': '#CBD2D6', '--accent': '#4C6210', '--danger': '#9A3E24',
    },
  },
};

// PbtA / Mist Engine 2d6 outcome bands, applied to both dice: a strong result
// glows, a partial is cautionary amber, a miss goes muted. Legible on both trays.
const BAND_COLORS = { hit: '#57B591', partial: '#C99A3C', miss: '#9A7070' };

// The Force die's pips: Light side pale, Dark side a mystic violet (the pips are
// black/white on the real die, but black is invisible on the dark tray).
const FORCE_COLORS = { lightside: '#DEE4EC', darkside: '#8267AE' };

// One Ring dice colours: the bronze Feat die, a bright gold for the Gandalf
// rune, Sauron-red for the Eye; Success dice in parchment, their Tengwar 6 in
// gold, and Weary-nullified (1-3) faded.
const TOR_COLORS = {
  feat: '#B5893C', gandalf: '#E8C24E', eye: '#C0453F',
  success: '#CBBF9F', rune: '#D8AE45', weary: '#5E5A4E',
};

// CthulhuTech dice are d10s read even/odd: every even is a Hit and glows green,
// every odd is a miss and stays grey. Constant hues, legible on both trays.
const CT_COLORS = { hit: '#57B591', miss: '#6B7378' };

// Daggerheart dice colour by role — Hope gold, Fear violet, and a green/red d6
// for advantage/disadvantage. Constant hues, legible on both trays.
const DH_COLORS = {
  hope: '#C9A227',
  fear: '#7E6BB5',
  advantage: '#4E9E60',
  disadvantage: '#C24046',
};

// Mothership dice tint by outcome, the way CthulhuTech tints hits: a Check comes
// up green when it lands under the target, red when it fails; a Panic d20 goes
// red on a Panic, green when it holds. Before a roll the staged percentile pair
// wears its acid-green tens / steel ones so the d100 reads as two dice.
const MS_COLORS = {
  success: '#5DAE6A', fail: '#D2603E',
  tens: '#AEC93C', ones: '#6A757C', panic: '#8FA0A8',
};

// Genesys dice are colour-coded by type — the one place a system paints its own
// dice rather than using the chrome accent. Medium tones chosen to read on both
// the light and dark tray.
const GEN_COLORS = {
  ability: '#4E9E60',      // green
  proficiency: '#C39A2E',  // yellow
  boost: '#4C86C6',        // blue
  difficulty: '#8A5CC0',   // purple
  challenge: '#C24046',    // red
  setback: '#7C828A',      // black die → a legible smoke grey
};

function applySystemTheme(system) {
  const root = document.documentElement;
  const scheme = SYSTEM_THEMES[system];
  // isDark(), not the pinned attribute: with no theme chosen the attribute is
  // absent and the OS decides, and reading the attribute alone put every
  // system-dice user on a dark machine into the light palette — which is what
  // "there is no dark mode" looked like from the outside.
  const mode = isDark() ? 'dark' : 'light';
  root.dataset.systemTheme = scheme ? system : '';
  for (const k of THEMED_VARS) root.style.removeProperty(k);
  if (scheme) for (const [k, v] of Object.entries(scheme[mode])) root.style.setProperty(k, v);
  updateThemeColor();
}

// The selected dice system — the UI preset chosen in the mode sheet. It drives
// the palette, the badge, and which dice row is shown, and it persists across
// rolls: a numeric roll typed while V5 is selected stays V5-coloured, because
// notation carries the roll's identity while the mode is the room you are in.
let uiSystem = 'numeric';

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

  // Cards keep their own table: re-run the deck layout instead of the dice
  // grid, which would stack the shoe in with the draws.
  if (state.dice[0].isCard) {
    const cards = state.dice.filter(d => d.isCard && !d.isStack && !d.gone);
    const { stack, slots } = deckLayout(cards.length);
    for (const d of state.dice) {
      if (d.isStack) { d.x = stack.x; d.y = stack.y; d.size = stack.w; }
    }
    cards.forEach((d, i) => {
      d.x = d.to.x = slots[i].x;
      d.y = d.to.y = slots[i].y;
      d.size = slots[i].w;
    });
    return;
  }

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

// Flatten a roll's dice groups into a paint list, carrying every field a system
// die needs to draw itself — the symbols on its face, its role, its Feat face,
// its colour key. Shared by a local roll and by one arriving from a room, so a
// peer's dice look exactly like your own.
function flattenRollDice(result) {
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
      });
    }
  }
  return flat;
}

// Turn the paint list into tray dice, stamping each with its system's face and
// colour so the renderer stays system-agnostic. `remote` marks a peer's dice so
// haptics fire only on your own throws; they look identical either way.
function buildTrayDice(flat, result, { remote = false } = {}) {
  return flat.map(f => {
    const die = new Die(f.sides, f.value, 0, 0, 40);
    die.kept = f.kept;
    die.exploded = f.exploded;
    die.rerolled = f.rerolled;
    if (f.hunger) die.hunger = true;
    if (remote) die.remote = true;
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
    return die;
  });
}

function doRoll(notation) {
  let result;
  try {
    // An explicit system token ("v5:…", "4dF") routes to that system's roller;
    // anything else stays on the numeric engine untouched. Cards go their own
    // way first: a draw is async (the art module loads on demand) and animates
    // through its own dealer rather than the dice thrower.
    const sys = detectSystem(notation);
    if (sys === 'cards') { dealFromNotation(notation); return; }
    result = sys === 'v5' ? rollV5(notation)
      : sys === 'fate' ? rollFate(notation)
      : sys === 'genesys' ? rollGenesys(notation)
      : sys === 'daggerheart' ? rollDaggerheart(notation)
      : sys === 'cthulhutech' ? rollCthulhuTech(notation)
      : sys === 'starwars' ? rollStarWars(notation)
      : sys === 'onering' ? rollOneRing(notation)
      : sys === 'pbta' ? rollPbta(notation)
      : sys === 'mist' ? rollMist(notation)
      : sys === 'mothership' ? rollMothership(notation)
      : roll(notation);
  } catch (err) {
    showError(err.message);
    return;
  }
  clearError();

  // Mothership tracks Stress: a failed Check or Save adds 1, and that new value
  // is what the next Panic Check rolls against. Only a local roll moves your own
  // Stress — a peer's roll (showRemoteRoll) never touches it.
  if (result.system === 'mothership' && result.summary.stressDelta) {
    const stressResult = resolveMothershipStress(ms.stress, result.summary.stressDelta);
    result.summary.stressOverflow = stressResult.overflow;
    setStress(stressResult.stress, { restage: false });
  }

  // The palette follows the selected mode, not this roll's system: a numeric
  // roll typed in V5 mode stays V5-coloured. applySystemTheme runs at mode
  // selection, so nothing to do here.

  state.last = result;
  $('notation').value = result.notation;

  const flat = flattenRollDice(result);

  // Your throw takes the tray outright. Dropping the claim stops a remote
  // roll still in the air from writing its total over yours when its timer
  // fires.
  state.remoteClaim = null;

  state.dice = buildTrayDice(flat, result);
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
    setTimeout(() => finish(result), 620 + rerollDelay(flat));
  } else if (mode === 'spin') {
    // Stagger the starts so the grid resolves in a wave instead of snapping.
    state.dice.forEach((d, i) => d.spinInPlace(i / state.dice.length));
    $('total').dataset.rolling = '1';
    setTimeout(() => finish(result), 700 + rerollDelay(flat));
  } else {
    for (const d of state.dice) { d.settled = true; d.settling = true; d.settleT = 1; }
    finish(result);
  }

  if (navigator.vibrate) navigator.vibrate(mode === 'none' ? 10 : [8, 40, 12]);
  hideHint();
}

// A rerolled die lands, pauses, hops and tumbles again, so the total has to wait
// for the second landing or it would appear while dice are still moving. Only
// paid when something actually rerolled.
function rerollDelay(flat) {
  return flat.some(f => f.rerolled) ? 700 : 0;
}

// Per-system result presentation. System rolls have no numeric `total`; their
// headline/detail come from their own formatter, while the numeric engine's
// formatters produce exactly what Dicebox has always shown.
//
// A headline is `{kind, text}`: numeric rolls and V5 success counts are a
// `number`, set at the big numeral size; a resolved V5 outcome is `text`, a
// phrase set smaller so "Bestial Failure" does not overrun the readout. The
// `kind` reaches the DOM as a data attribute the stylesheet keys off.
function resultHeadline(result) {
  if (result.system === 'v5') return v5Headline(result);
  if (result.system === 'fate') return fateHeadline(result);
  if (result.system === 'genesys') return genesysHeadline(result);
  if (result.system === 'daggerheart') return daggerheartHeadline(result);
  if (result.system === 'cthulhutech') return cthulhutechHeadline(result);
  if (result.system === 'starwars') return starWarsHeadline(result);
  if (result.system === 'onering') return oneRingHeadline(result);
  if (result.system === 'pbta' || result.system === 'mist') return twod6Headline(result);
  if (result.system === 'mothership') return mothershipHeadline(result);
  if (result.system === 'cards') return cardsHeadline(result);
  return { kind: 'number', text: String(result.total) };
}
function resultDetail(result) {
  if (result.system === 'v5') return describeV5(result);
  if (result.system === 'fate') return describeFate(result);
  if (result.system === 'genesys') return describeGenesys(result);
  if (result.system === 'daggerheart') return describeDaggerheart(result);
  if (result.system === 'cthulhutech') return describeCthulhuTech(result);
  if (result.system === 'starwars') return describeStarWars(result);
  if (result.system === 'onering') return describeOneRing(result);
  if (result.system === 'pbta' || result.system === 'mist') return describe2d6(result);
  if (result.system === 'mothership') return describeMothership(result);
  if (result.system === 'cards') return describeCards(result);
  return describe(result.groups);
}

// Write a headline to the big readout, carrying its kind so words and numbers
// get their own type sizes, and an optional variant (Daggerheart's Hope/Fear
// tint) that colours the total.
function setTotal(headline) {
  const total = $('total');
  total.textContent = headline.text;
  total.dataset.kind = headline.kind;
  if (headline.variant) total.dataset.variant = headline.variant;
  else delete total.dataset.variant;
}

function finish(result) {
  delete $('total').dataset.rolling;
  delete $('total').dataset.idle;
  setTotal(resultHeadline(result));
  $('breakdown').textContent = resultDetail(result);
  addHistory(result, selfName(), true);
  // After addHistory, so a throw in room code could not cost the local roll its
  // place in the log. share() is synchronous and a no-op when there is no room,
  // which is what keeps this line off the critical path. It picks the wire
  // schema by system: numeric rolls go as `roll`, the system modes as `roll2`.
  roomLink.share(result);
  // The name has done its job by the first roll; let the tray have the page.
  $('wordmark').dataset.faded = '1';
}

// The visible log stays short, but the record does not: a session's worth of
// rolls is the interesting artifact, and truncating at twelve threw it away.
const HISTORY_LIMIT = 500;
const history = [];

// Your own display name, but only while a room is live. Rolling alone, a log
// that labelled every line with your own name would be noise — "who rolled
// this" is not a question that exists until someone else can.
//
// Read per roll rather than stamped once, so renaming yourself mid-session
// labels what follows and leaves what came before alone. That matches how a
// peer's name is captured: as it was at the moment of the roll.
function selfName() {
  return roomLink.state === 'live' ? roomLink.name : null;
}

// `who` is carried into the export as well as the display: a session log that
// silently merged everyone's rolls into one column would be useless for the
// question people actually ask of it afterwards.
//
// `mine` is separate from `who` rather than inferred from it. Both your rolls
// and a peer's now carry a name, so the name can no longer be the thing that
// says whose roll it was, and the log's left rule and the export's 'you' both
// depend on knowing.
function recordRoll(result, who = null, mine = false) {
  history.push({
    at: new Date().toISOString(),
    who,
    mine,
    notation: result.notation,
    // Numeric rolls keep their scalar `total`; system rolls carry a formatted
    // headline instead of a bogus scalar.
    // Only numeric rolls carry a scalar total; system rolls store a formatted
    // headline instead and leave this null.
    total: result.total ?? null,
    headline: resultHeadline(result).text,
    detail: resultDetail(result),
    dice: result.groups
      .filter(g => g.kind === 'dice')
      .flatMap(g => g.dice.map(d => ({
        sides: g.sides ?? 10,
        value: d.value,
        kept: d.kept,
        exploded: d.exploded,
        rerolled: d.rerolled,
        hunger: d.hunger,
      }))),
  });
  if (history.length > HISTORY_LIMIT) history.shift();
  $('historyCount').textContent = history.length > 12 ? `${history.length} rolls` : '';
}

// `who` is the display name on the roll — yours while a room is live, the
// sender's when it came from someone else, and null when rolling alone. It only
// ever reaches the DOM through textContent — the name is whatever a peer put in
// a payload, and rendering that as markup would be a real bug even among
// friends.
function addHistory(result, who = null, mine = false) {
  recordRoll(result, who, mine);
  const li = document.createElement('li');
  if (who && !mine) li.dataset.remote = '1';

  const top = document.createElement('div');
  top.className = 'log-line';

  const label = document.createElement('span');
  if (who) {
    const by = document.createElement('span');
    by.className = 'log-who';
    // Your own name is marked so it can be quieter than a peer's. Painting
    // every line in the accent colour would leave nothing standing out, which
    // is the opposite of what naming your own rolls was asked for.
    if (mine) by.dataset.self = '1';
    by.textContent = who;
    label.append(by);
  }
  label.append(result.notation);

  const val = document.createElement('b');
  val.textContent = resultHeadline(result).text;

  top.append(label, val);
  li.append(top);

  // What each die actually landed on, not just the total. The breakdown was
  // already computed for the readout and then discarded, so a past roll could
  // not be checked — "17" tells you nothing about which die produced it.
  const detail = resultDetail(result);
  if (detail && detail !== result.notation) {
    const rolls = document.createElement('span');
    rolls.className = 'log-detail';
    rolls.textContent = detail;
    li.append(rolls);
  }

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
  // A system pool typed by hand keeps that system's controls in step instead of
  // being torn apart by the numeric pool parser, which would read "v5:8h3" as
  // garbage.
  const typedSystem = detectSystem($('notation').value);
  if (typedSystem === 'v5') { syncV5FromField(); return; }
  if (typedSystem === 'fate') { syncFateFromField(); return; }
  if (typedSystem === 'genesys' || typedSystem === 'starwars') { syncGenFromField(); return; }
  if (typedSystem === 'daggerheart') { syncDhFromField(); return; }
  if (typedSystem === 'cthulhutech') { syncCtFromField(); return; }
  if (typedSystem === 'onering') { syncTorFromField(); return; }
  if (typedSystem === 'pbta') { pbtaCtl.fromField(); return; }
  if (typedSystem === 'mist') { mistCtl.fromField(); return; }
  if (typedSystem === 'mothership') { syncMsFromField(); return; }
  if (typedSystem === 'cards') { syncCardsFromField(); return; }
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
  if (open) { closeSheet(); closeDial(); closeHistory(); closeRoom(); closeMode(); }
  // A corner popover under its own button, like the mode picker. anchorPop is a
  // function declaration further down, hoisted, so it is callable from here.
  if (open) anchorPop(help, helpToggle);
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

// ---- systems ----
//
// The mode sheet is a UI preset: it recolours the app, swaps the dice row, and
// picks how a result reads. It never touches the meaning of typed notation.

const SYSTEMS = {
  // Community shorthand, matching the picker rows. Numeric shows no badge — the
  // wordmark already says Dicebox.
  numeric: { badge: '' },
  cards: { badge: 'Cards' },
  v5: { badge: 'VtM V5' },
  fate: { badge: 'Fate' },
  genesys: { badge: 'Genesys' },
  daggerheart: { badge: 'DH' },
  cthulhutech: { badge: 'CTech 2e' },
  starwars: { badge: 'SWRPG' },
  onering: { badge: 'TOR 2e' },
  pbta: { badge: 'PbtA' },
  mist: { badge: 'Mist' },
  mothership: { badge: 'MoSh 1e' },
};

// Empty-tray copy. Most modes build a pool by tapping dice, so the default
// speaks of dice. PbtA and Mist have no pool — the roll is always 2d6 and the
// only input is a modifier — so their prompts point at that instead, and Mist
// calls its modifier "Power" the way the game does.
const DEFAULT_HINT = { idle: 'Pick dice or type a roll', placeholder: 'Tap dice above, or type 3d6+2' };
const SYSTEM_HINTS = {
  pbta: { idle: 'Set a modifier, then roll 2d6', placeholder: 'Set a modifier, or type pbta:+2' },
  mist: { idle: 'Set your Power, then roll 2d6', placeholder: 'Set your Power, or type mist:+1' },
  mothership: { idle: 'Set your target, then roll under it', placeholder: 'Set a target, or type ms:c@35' },
  cards: { idle: 'Tap the deck to draw', placeholder: 'Tap the deck, or type deck:3' },
};
function systemHint(system) { return SYSTEM_HINTS[system] || DEFAULT_HINT; }

// Permanent slugs, so a link opens Dicebox already in a system. The Worker
// rewrites these paths to the app shell; numeric is the bare root. Kept branded
// (/vtm rather than /v5) since the URL is the shareable name.
// Reading accepts the shorthand slugs and every pre-rename alias; writing (the
// URL the app puts in the bar) always uses the canonical shorthand, edition
// included, matching the picker labels.
const SLUG_TO_SYSTEM = {
  cards: 'cards', vtmv5: 'v5', fate: 'fate', genesys: 'genesys', dh: 'daggerheart', ctech2e: 'cthulhutech',
  swrpg: 'starwars', tor2e: 'onering', pbta: 'pbta', mist: 'mist', mosh1e: 'mothership',
  v5: 'v5', vtm: 'v5', daggerheart: 'daggerheart', cthulhutech: 'cthulhutech', ctech: 'cthulhutech',
  force: 'starwars', feat: 'onering', tor: 'onering', mothership: 'mothership', mosh: 'mothership',
};
const SYSTEM_TO_SLUG = { cards: 'cards', v5: 'vtmv5', fate: 'fate', genesys: 'genesys', daggerheart: 'dh', cthulhutech: 'ctech2e', starwars: 'swrpg', onering: 'tor2e', pbta: 'pbta', mist: 'mist', mothership: 'mosh1e' };

function systemFromPath() {
  const seg = (location.pathname || '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  return SLUG_TO_SYSTEM[seg] || 'numeric';
}
function pathForSystem(system) {
  return SYSTEM_TO_SLUG[system] ? `/${SYSTEM_TO_SLUG[system]}` : '/';
}

const modeSheet = $('modeSheet');
const modeToggle = $('modeToggle');
const systemBadge = $('systemBadge');
const numPicker = $('numPicker');
const v5Picker = $('v5Picker');
const fatePicker = $('fatePicker');
const genesysPicker = $('genesysPicker');
const dhPicker = $('dhPicker');
const ctPicker = $('ctPicker');
const torPicker = $('torPicker');
// PbtA and Mist Engine share one picker: their only control is a modifier
// stepper, identical between the two modes.
const twod6Picker = $('twod6Picker');
const msPicker = $('msPicker');
// Numeric's strip lives after the final signature picker in the DOM. Daggerheart
// and Mothership both show their own controls above ordinary damage dice; hidden
// intervening pickers do not affect layout in either mode.
msPicker.after?.(numPicker);

function setSystem(system, { roll = false, url = true } = {}) {
  if (!SYSTEMS[system]) system = 'numeric';
  const changed = system !== uiSystem;
  uiSystem = system;

  // Reflect the mode into the address so the current view is shareable and the
  // browser's back button returns to the previous system. Guarded because some
  // embeddings forbid history writes (the same reason the room code guards it).
  if (url) {
    const path = pathForSystem(system);
    // window.history, not history: app.js binds `history` to the roll log array,
    // which shadows the global and has no pushState.
    if (location.pathname !== path) {
      try { window.history.pushState({ system }, '', path); } catch { /* embedded */ }
    }
  }

  // The palette is the loud half of the switch; do it first so the rest of the
  // repaint happens under the right colours.
  applySystemTheme(system);

  // The badge names the mode beside the wordmark, and disappears on numeric,
  // which is the app's own identity and needs no label.
  const badge = SYSTEMS[system].badge;
  systemBadge.hidden = !badge;
  systemBadge.textContent = badge;

  // The mode button wears the active system's mark (d20 / ankh / …).
  modeToggle.dataset.system = system;

  // Swap the dice row for the active system's controls. Daggerheart keeps the
  // numeric strip too — its duality is one roll, but weapons and the rest need
  // ordinary dice — so its own controls sit above the numeric ones. In that mode
  // the strip is trimmed to the standard polyhedral dice.
  // Daggerheart and Mothership keep the numeric strip too — their signature roll
  // is separate, but weapons/damage/wounds are ordinary dice. Mothership's owned
  // books use d5, d10, d20 and d100; d? remains available for table-specific dice.
  numPicker.hidden = system !== 'numeric' && system !== 'daggerheart' && system !== 'mothership';
  diceButtons.classList.toggle('standard-only', system === 'daggerheart');
  diceButtons.classList.toggle('mothership-only', system === 'mothership');
  numPicker.classList.toggle('mothership-rail', system === 'mothership');
  msFieldsRow.hidden = system !== 'mothership';
  v5Picker.hidden = system !== 'v5';
  fatePicker.hidden = system !== 'fate';
  // Star Wars reuses the Genesys chip picker; the Force chip only appears there.
  genesysPicker.hidden = system !== 'genesys' && system !== 'starwars';
  genesysPicker.classList.toggle('with-force', system === 'starwars');
  dhPicker.hidden = system !== 'daggerheart';
  ctPicker.hidden = system !== 'cthulhutech';
  torPicker.hidden = system !== 'onering';
  twod6Picker.hidden = system !== 'pbta' && system !== 'mist';
  msPicker.hidden = system !== 'mothership';
  cardsPicker.hidden = system !== 'cards';
  // The deck's art loads on first entry; the stack appears when it lands. The
  // module is service-worker-precached, so this works offline too.
  if (system === 'cards') {
    ensureCardArt().then(() => { if (uiSystem === 'cards') syncCardsUI(); });
  }
  // Mist calls the 2d6 modifier "Power"; PbtA just "Modifier". The picker is
  // shared, so the label follows the active mode.
  if (system === 'pbta' || system === 'mist') {
    const term = system === 'mist' ? 'Power' : 'Modifier';
    $('twod6ModLabel').textContent = term;
    $('twod6ModChip').setAttribute('aria-label', `${term} — tap to raise, hold to lower`);
  }

  // The input placeholder and the empty-tray line match what this mode offers —
  // "tap dice" is wrong where there are no dice to tap.
  const hint = systemHint(system);
  $('notation').setAttribute('placeholder', hint.placeholder);
  if ($('total').dataset.idle === '1') $('breakdown').textContent = hint.idle;

  // Help follows the mode so its syntax examples match the dice on screen.
  $('helpNumeric').hidden = system !== 'numeric';
  $('helpV5').hidden = system !== 'v5';
  $('helpFate').hidden = system !== 'fate';
  $('helpGenesys').hidden = system !== 'genesys';
  $('helpStarwars').hidden = system !== 'starwars';
  $('helpDaggerheart').hidden = system !== 'daggerheart';
  $('helpCthulhutech').hidden = system !== 'cthulhutech';
  $('helpOnering').hidden = system !== 'onering';
  $('helpPbta').hidden = system !== 'pbta';
  $('helpMist').hidden = system !== 'mist';
  $('helpMothership').hidden = system !== 'mothership';
  $('helpCards').hidden = system !== 'cards';

  // The popover's rows reflect the choice.
  for (const row of modeRows) {
    row.setAttribute('aria-pressed', String(row.dataset.system === system));
  }

  // Switching modes clears the tray to a fresh start: the old pool's notation
  // (`v5:8h3` or `2d20`) is meaningless in the other mode, so carrying it over
  // would only confuse. A no-op re-selection leaves everything alone.
  if (changed && !roll) {
    resetV5();
    resetFate();
    resetGenesys();
    resetDaggerheart();
    resetCthulhuTech();
    resetOneRing();
    pbtaCtl.reset();
    mistCtl.reset();
    // Mothership resets the roll config (mode, target, skill, advantage) but NOT
    // Stress — that is the character's ongoing state, not pool setup, so it must
    // survive a mode switch the way it survives a reload.
    resetMothership();
    clearPool();
    // Daggerheart and Mothership seed the field with their signature roll so a
    // plain Roll or flick throws it; tapping numeric dice replaces it with a pool.
    if (system === 'daggerheart') $('notation').value = dhNotation();
    if (system === 'mothership') $('notation').value = msNotation();
    if (system === 'cards') $('notation').value = `deck:${deckState.draw}`;
  }
}

// ---- mode popover ----

const modeRows = [...modeSheet.querySelectorAll('.mode-row')];

// Anchor a corner popover under its header button. The app column is centred,
// so the button's rect — not the viewport edge — is the anchor. Shared by the
// mode picker, the help panel, and the room panel.
function anchorPop(pop, btn) {
  const r = btn.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  pop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
}

function openMode() {
  setHelp(false);
  closeSheet();
  closeDial();
  closeHistory();
  closeRoom();
  anchorPop(modeSheet, modeToggle);
  modeSheet.hidden = false;
  modeToggle.setAttribute('aria-expanded', 'true');
  hideHint();
}
function closeMode() {
  modeSheet.hidden = true;
  modeToggle.setAttribute('aria-expanded', 'false');
}

modeToggle.addEventListener('click', () => {
  if (modeSheet.hidden) openMode(); else closeMode();
});
// The badge is the second way in: it names the mode, and tapping it changes it.
systemBadge.addEventListener('click', openMode);
// The corner popovers (mode, help, room) have no close button: each closes on
// a tap anywhere outside it (its own toggle handles itself), on Escape (the
// panel-wide Escape handler), or on a resize, which would leave it anchored to
// a stale corner. help/roomPanel are consts declared later in the file; the
// callbacks only run on events, long after everything exists.
document.addEventListener('pointerdown', e => {
  if (!modeSheet.hidden && !modeSheet.contains(e.target) && !modeToggle.contains(e.target) && !systemBadge.contains(e.target)) closeMode();
  if (!help.hidden && !help.contains(e.target) && !helpToggle.contains(e.target)) setHelp(false);
  if (!roomPanel.hidden && !roomPanel.contains(e.target) && !roomToggle.contains(e.target)) closeRoom();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modeSheet.hidden) {
    closeMode();
    modeToggle.focus();
  }
});
window.addEventListener('resize', () => {
  if (!modeSheet.hidden) closeMode();
  if (!help.hidden) setHelp(false);
  if (!roomPanel.hidden) closeRoom();
});

for (const row of modeRows) {
  row.addEventListener('click', () => {
    setSystem(row.dataset.system);
    closeMode();
  });
}

// ---- Vampire pool ----
//
// V5's dice are two counts, not a numeric strip: ordinary dice and Hunger dice,
// each set directly with its own stepper under the die it is. The state is the
// source the notation field is written from; typing a `v5:` pool by hand feeds
// back into it through syncV5FromField.

const v5 = { normal: 0, hunger: 0, difficulty: null };
const v5NormalFace = $('v5NormalFace');
const v5HungerFace = $('v5HungerFace');
const v5DiffChip = $('v5DiffChip');
const v5DiffVal = $('v5Difficulty');

function resetV5() {
  v5.normal = 0;
  v5.hunger = 0;
  v5.difficulty = null;
  syncV5({ writeField: false });
}

// Build the notation the pool represents. An empty pool writes nothing, so the
// readout stays idle rather than showing a "v5:0".
function v5Notation() {
  const total = v5.normal + v5.hunger;
  if (total < 1) return '';
  let s = `v5:${total}`;
  if (v5.hunger > 0) s += `h${v5.hunger}`;
  if (v5.difficulty !== null) s += `@${v5.difficulty}`;
  return s;
}

// Reflect the state onto the controls, and (by default) into the field.
function syncV5({ writeField = true } = {}) {
  if (v5.normal > 0) v5NormalFace.dataset.count = String(v5.normal); else delete v5NormalFace.dataset.count;
  if (v5.hunger > 0) v5HungerFace.dataset.count = String(v5.hunger); else delete v5HungerFace.dataset.count;

  if (v5.difficulty === null) {
    v5DiffVal.textContent = '—'; v5DiffVal.dataset.unset = '1'; v5DiffChip.classList.remove('is-set');
  } else {
    v5DiffVal.textContent = String(v5.difficulty); delete v5DiffVal.dataset.unset; v5DiffChip.classList.add('is-set');
  }

  if (writeField) $('notation').value = v5Notation();
  if (uiSystem === 'v5') stageSystemPool();
}

// Step a die count, keeping the pool inside the parser's limits: 0–100 dice
// total, and no more Hunger than there are dice.
function v5Step(kind, by) {
  const other = kind === 'hunger' ? v5.normal : v5.hunger;
  const current = kind === 'hunger' ? v5.hunger : v5.normal;
  const next = Math.max(0, Math.min(current + by, 100 - other));
  if (kind === 'hunger') v5.hunger = next; else v5.normal = next;
  syncV5();
}

// Tap a die to add one, hold (or right-click) to remove — and a die tapped in
// the tray comes off too. Difficulty cycles unset → 1 … 10; below 1 returns to
// unset, which the reducer treats differently from a difficulty of 1.
bindTapHold(v5NormalFace, dir => v5Step('normal', dir));
bindTapHold(v5HungerFace, dir => v5Step('hunger', dir));
bindTapHold(v5DiffChip, dir => {
  if (dir > 0) v5.difficulty = v5.difficulty === null ? 1 : Math.min(10, v5.difficulty + 1);
  else v5.difficulty = v5.difficulty === null || v5.difficulty <= 1 ? null : v5.difficulty - 1;
  syncV5();
});

// A `v5:` pool typed into the field drives the controls, so the two never
// disagree about what will roll. Invalid part-typed strings are left alone.
function syncV5FromField() {
  try {
    const { pool, hunger, difficulty } = parseV5($('notation').value);
    v5.normal = pool - hunger;
    v5.hunger = hunger;
    v5.difficulty = difficulty;
    syncV5({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// ---- Fate pool ----
//
// Fate is two numbers: how many Fudge dice, and a skill modifier. The standard
// roll is 4dF, so that is the default.

// The die count is fixed at 4dF (the Fate roll); only the modifier varies, so
// that is the whole picker. Typing NdF still adjusts the count for the rare case.
const fate = { count: 4, modifier: 0 };
const fateModField = $('fateMod');

function resetFate() {
  fate.count = 4;
  fate.modifier = 0;
  syncFate({ writeField: false });
}

function fateNotation() {
  const mod = fate.modifier > 0 ? `+${fate.modifier}` : fate.modifier < 0 ? String(fate.modifier) : '';
  return `${fate.count}dF${mod}`;
}

function syncFate({ writeField = true } = {}) {
  fateModField.textContent = fate.modifier > 0 ? `+${fate.modifier}` : String(fate.modifier);
  if (writeField) $('notation').value = fateNotation();
  if (uiSystem === 'fate') stageSystemPool();
}

bindTapHold($('fateModChip'), dir => { fate.modifier = Math.max(-100, Math.min(100, fate.modifier + dir)); syncFate(); });

function syncFateFromField() {
  try {
    const { count, modifier } = parseFate($('notation').value);
    fate.count = count;
    fate.modifier = modifier;
    syncFate({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// ---- Genesys pool ----
//
// Six die types, built by tapping their chips (hold, or right-click, to remove).
// Each type keeps a count; the chips show it and the notation is written from it.

const GEN_TYPES = [
  { type: 'ability', letter: 'A', label: 'Ability' },
  { type: 'proficiency', letter: 'P', label: 'Proficiency' },
  { type: 'boost', letter: 'B', label: 'Boost' },
  { type: 'difficulty', letter: 'D', label: 'Difficulty' },
  { type: 'challenge', letter: 'C', label: 'Challenge' },
  { type: 'setback', letter: 'S', label: 'Setback' },
  // The Force die — Star Wars only. Its chip is hidden in Genesys mode.
  { type: 'force', letter: 'F', label: 'Force' },
];
const GEN_LETTER = Object.fromEntries(GEN_TYPES.map(t => [t.type, t.letter]));
const gen = Object.fromEntries(GEN_TYPES.map(t => [t.type, 0]));

function resetGenesys() {
  for (const t of GEN_TYPES) gen[t.type] = 0;
  syncGen({ writeField: false });
}

function genNotation() {
  const terms = GEN_TYPES.filter(t => gen[t.type] > 0).map(t => `${gen[t.type]}${t.letter}`);
  if (!terms.length) return '';
  // Same chips, two systems: Star Wars adds the Force die and uses the sw: prefix.
  return `${uiSystem === 'starwars' ? 'sw' : 'gen'}:${terms.join('+')}`;
}

function syncGen({ writeField = true } = {}) {
  for (const t of GEN_TYPES) {
    const chip = $(`gen-${t.type}`);
    const n = gen[t.type];
    if (n > 0) { chip.dataset.count = String(n); chip.setAttribute('aria-pressed', 'true'); }
    else { delete chip.dataset.count; chip.setAttribute('aria-pressed', 'false'); }
  }
  if (writeField) $('notation').value = genNotation();
  if (uiSystem === 'genesys' || uiSystem === 'starwars') stageSystemPool();
}

function genStep(type, by) {
  const total = GEN_TYPES.reduce((s, t) => s + gen[t.type], 0);
  const next = Math.max(0, Math.min(gen[type] + by, gen[type] + (100 - total)));
  gen[type] = next;
  syncGen();
}

function syncGenFromField() {
  try {
    const field = $('notation').value;
    const pool = detectSystem(field) === 'starwars' ? parseStarWars(field) : parseGenesys(field);
    for (const t of GEN_TYPES) gen[t.type] = 0;
    for (const { type, count } of pool) gen[type] = count;
    syncGen({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// Tap a chip to add that die; hold it (or right-click) to remove one — the same
// tap/long-press language the numeric row uses for its modifiers.
for (const t of GEN_TYPES) {
  bindTapHold($(`gen-${t.type}`), dir => genStep(t.type, dir));
}

// ---- Daggerheart pool ----
//
// The roll is fixed — a Hope d12 and a Fear d12 — so the controls are the things
// around it: advantage or disadvantage (a ± d6), a flat modifier, and an
// optional difficulty to resolve success against.

// advantage is a signed count of d6: +N advantage dice, −N disadvantage dice.
const dhState = { advantage: 0, modifier: 0, difficulty: null };
const dhModField = $('dhMod');
const dhDiffField = $('dhDifficulty');
const dhModChip = $('dhModChip');
const dhDiffChip = $('dhDiffChip');

function resetDaggerheart() {
  dhState.advantage = 0;
  dhState.modifier = 0;
  dhState.difficulty = null;
  syncDh({ writeField: false });
}

function dhNotation() {
  let s = 'dh:';
  if (dhState.advantage > 0) s += 'adv' + (dhState.advantage > 1 ? dhState.advantage : '');
  else if (dhState.advantage < 0) s += 'dis' + (-dhState.advantage > 1 ? -dhState.advantage : '');
  if (dhState.modifier > 0) s += `+${dhState.modifier}`;
  else if (dhState.modifier < 0) s += String(dhState.modifier);
  if (dhState.difficulty !== null) s += `@${dhState.difficulty}`;
  return s;
}

function syncDh({ writeField = true } = {}) {
  for (const btn of dhAdvButtons) {
    // Each button shows its own kind's count; advantage and disadvantage cancel,
    // so only one is ever lit.
    const n = btn.dataset.adv === 'adv' ? Math.max(0, dhState.advantage) : Math.max(0, -dhState.advantage);
    if (n > 0) { btn.dataset.count = String(n); btn.setAttribute('aria-pressed', 'true'); }
    else { delete btn.dataset.count; btn.setAttribute('aria-pressed', 'false'); }
  }
  dhModField.textContent = dhState.modifier > 0 ? `+${dhState.modifier}` : String(dhState.modifier);
  if (dhState.difficulty === null) {
    dhDiffField.textContent = '—'; dhDiffField.dataset.unset = '1'; dhDiffChip.classList.remove('is-set');
  } else {
    dhDiffField.textContent = String(dhState.difficulty); delete dhDiffField.dataset.unset; dhDiffChip.classList.add('is-set');
  }
  if (writeField) $('notation').value = dhNotation();
  if (uiSystem === 'daggerheart') stageSystemPool();
}

const dhAdvButtons = [...document.querySelectorAll('.dh-adv-btn')];
function setAdvantage(n) {
  dhState.advantage = Math.max(-20, Math.min(20, n));
  syncDh();
}
// Advantage and Disadvantage are a signed count that cancels. Tapping a die adds
// one of its kind; holding removes one of that kind only (never crossing zero
// into the other), so a hold on Advantage can't quietly add Disadvantage.
bindTapHold(dhAdvButtons.find(b => b.dataset.adv === 'adv'), dir => {
  if (dir > 0) setAdvantage(dhState.advantage + 1);
  else if (dhState.advantage > 0) setAdvantage(dhState.advantage - 1);
});
bindTapHold(dhAdvButtons.find(b => b.dataset.adv === 'dis'), dir => {
  if (dir > 0) setAdvantage(dhState.advantage - 1);
  else if (dhState.advantage < 0) setAdvantage(dhState.advantage + 1);
});

// The Duality button rolls the Hope + Fear (with the current advantage, modifier
// and difficulty) straight away — separate from the numeric strip, which builds
// ordinary rolls for weapons and the rest.
$('dhRoll').addEventListener('click', () => doRoll(dhNotation()));

bindTapHold(dhModChip, dir => { dhState.modifier = Math.max(-100, Math.min(100, dhState.modifier + dir)); syncDh(); });
bindTapHold(dhDiffChip, dir => {
  if (dir > 0) dhState.difficulty = dhState.difficulty === null ? 10 : Math.min(100, dhState.difficulty + 1);
  else dhState.difficulty = dhState.difficulty === null || dhState.difficulty <= 1 ? null : dhState.difficulty - 1;
  syncDh();
});

function syncDhFromField() {
  try {
    const { advantage, modifier, difficulty } = parseDaggerheart($('notation').value);
    dhState.advantage = advantage;
    dhState.modifier = modifier;
    dhState.difficulty = difficulty;
    syncDh({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// ---- CthulhuTech pool ----
//
// The whole roll is two numbers: how many d10 (your Attribute + Skill), and an
// optional Difficulty (the hits you need). Evens are hits; the reducer does the
// counting.

// Tap to step up, hold (or right-click) to step down — the tap/long-press
// language the Genesys die buttons use, reused for the single die-add buttons and
// the tap-to-cycle chips. `step(+1|-1)` applies the change and re-syncs.
function bindTapHold(el, step) {
  if (!el) return;
  let held = false, timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  // Remove exactly once per long-press. On touch a long-press fires the hold
  // timer AND a contextmenu; `held` gates the second so they can't both step.
  const removeOnce = () => { if (held) return; held = true; step(-1); if (navigator.vibrate) navigator.vibrate(8); };
  el.addEventListener('pointerdown', () => {
    held = false;
    timer = setTimeout(() => { timer = null; removeOnce(); }, 450);
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', () => { if (held) { held = false; return; } step(1); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); removeOnce(); });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault(); step(1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault(); step(-1);
    }
  });
}

const ct = { dice: 6, difficulty: 3 };
const ctAddDie = $('ctAddDie');
const ctDiffChip = $('ctDiffChip');
const ctDiffVal = $('ctDifficulty');

function resetCthulhuTech() {
  // CthulhuTech builds a pool, so it opens empty like the numeric tray — tap the
  // d10 to add. Difficulty is a setting, not a die, so it keeps its default.
  ct.dice = 0;
  ct.difficulty = 3;
  syncCt({ writeField: false });
}

function ctNotation() {
  if (ct.dice < 1) return ''; // an empty pool writes nothing, like a bare numeric tray
  return `ct:${ct.dice}` + (ct.difficulty !== null ? `@${ct.difficulty}` : '');
}

// The example roll thrown when you flick an empty CthulhuTech tray: a six-die
// pool at the difficulty currently set.
function ctExample() {
  return `ct:6` + (ct.difficulty !== null ? `@${ct.difficulty}` : '');
}

function syncCt({ writeField = true } = {}) {
  // The d10 button badges the pool count, and shows none while the pool is empty.
  if (ct.dice > 0) ctAddDie.dataset.count = String(ct.dice);
  else delete ctAddDie.dataset.count;
  if (ct.difficulty === null) {
    ctDiffVal.textContent = '—'; ctDiffVal.dataset.unset = '1'; ctDiffChip.classList.remove('is-set');
  } else {
    ctDiffVal.textContent = String(ct.difficulty); delete ctDiffVal.dataset.unset; ctDiffChip.classList.add('is-set');
  }
  if (writeField) $('notation').value = ctNotation();
  if (uiSystem === 'cthulhutech') stageSystemPool();
}

// Tap the d10 to add to the pool, hold to remove one (down to empty).
bindTapHold(ctAddDie, dir => { ct.dice = Math.max(0, Math.min(100, ct.dice + dir)); syncCt(); });
// Difficulty cycles unset → 1 … 20; holding below 1 returns to unset (report hits).
bindTapHold(ctDiffChip, dir => {
  if (dir > 0) ct.difficulty = ct.difficulty === null ? 1 : Math.min(20, ct.difficulty + 1);
  else ct.difficulty = ct.difficulty === null || ct.difficulty <= 1 ? null : ct.difficulty - 1;
  syncCt();
});

function syncCtFromField() {
  try {
    const { dice, difficulty } = parseCthulhuTech($('notation').value);
    ct.dice = dice;
    ct.difficulty = difficulty;
    syncCt({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// ---- One Ring pool ----
//
// A Feat die is always rolled; the controls are how many Success dice, the
// Target Number, whether the roll is favoured / ill-favoured, and whether the
// hero is Weary.

// Success starts empty — the Feat die always rolls and shows in the tray, and you
// build the Success pool on top of it.
const tor = { success: 0, favour: null, weary: false, tn: 14 };
const torAddSuccess = $('torAddSuccess');
const torTnChip = $('torTnChip');
const torTnVal = $('torTn');
const torFlagButtons = [...document.querySelectorAll('.tor-flag')];

function resetOneRing() {
  tor.success = 0;
  tor.favour = null;
  tor.weary = false;
  tor.tn = 14;
  syncTor({ writeField: false });
}

function torNotation() {
  return `tor:${tor.success}` + (tor.favour || '') + (tor.weary ? 'w' : '')
    + (tor.tn !== null ? `@${tor.tn}` : '');
}

function syncTor({ writeField = true } = {}) {
  if (tor.success > 0) torAddSuccess.dataset.count = String(tor.success); else delete torAddSuccess.dataset.count;
  if (tor.tn === null) { torTnVal.textContent = '—'; torTnVal.dataset.unset = '1'; torTnChip.classList.remove('is-set'); }
  else { torTnVal.textContent = String(tor.tn); delete torTnVal.dataset.unset; torTnChip.classList.add('is-set'); }
  for (const btn of torFlagButtons) {
    const flag = btn.dataset.flag;
    const on = flag === 'weary' ? tor.weary : tor.favour === flag;
    btn.setAttribute('aria-pressed', String(on));
  }
  if (writeField) $('notation').value = torNotation();
  if (uiSystem === 'onering') stageSystemPool();
}

for (const btn of torFlagButtons) {
  btn.addEventListener('click', () => {
    const flag = btn.dataset.flag;
    if (flag === 'weary') tor.weary = !tor.weary;
    else tor.favour = tor.favour === flag ? null : flag; // fav/ill are exclusive
    syncTor();
  });
}
// Tap the d6 to add a Success die, hold to remove one.
bindTapHold(torAddSuccess, dir => { tor.success = Math.max(0, Math.min(20, tor.success + dir)); syncTor(); });
// Target cycles unset → 10 … 100; holding below 1 returns to unset.
bindTapHold(torTnChip, dir => {
  if (dir > 0) tor.tn = tor.tn === null ? 10 : Math.min(100, tor.tn + 1);
  else tor.tn = tor.tn === null || tor.tn <= 1 ? null : tor.tn - 1;
  syncTor();
});

function syncTorFromField() {
  try {
    const { success, favour, weary, tn } = parseOneRing($('notation').value);
    tor.success = success;
    tor.favour = favour;
    tor.weary = weary;
    tor.tn = tn;
    syncTor({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// ---- PbtA / Mist Engine (2d6 + modifier) ----
// The two systems roll identically — 2d6 plus a modifier — and differ only in
// how the result reads and in colour, so they share one picker (a single
// modifier stepper) and one controller. The active mode (uiSystem) decides which
// prefix the notation carries.
const twod6 = { modifier: 0 };
const twod6ModField = $('twod6Mod');

function twod6Notation(system) {
  const m = twod6.modifier;
  return `${system}:` + (m ? (m > 0 ? `+${m}` : String(m)) : '');
}
function syncTwod6({ writeField = true } = {}) {
  const m = twod6.modifier;
  if (twod6ModField) twod6ModField.textContent = m > 0 ? `+${m}` : String(m);
  if (writeField && (uiSystem === 'pbta' || uiSystem === 'mist')) {
    $('notation').value = twod6Notation(uiSystem);
  }
  if (uiSystem === 'pbta' || uiSystem === 'mist') stageSystemPool();
}
function resetTwod6() { twod6.modifier = 0; syncTwod6({ writeField: false }); }
function syncTwod6FromField() {
  const src = $('notation').value;
  const parse = detectSystem(src) === 'mist' ? parseMist : parsePbta;
  try { twod6.modifier = parse(src).modifier; syncTwod6({ writeField: false }); }
  catch { /* mid-type, not yet valid */ }
}
bindTapHold($('twod6ModChip'), dir => { twod6.modifier = Math.max(-100, Math.min(100, twod6.modifier + dir)); syncTwod6(); });

// Both modes go through the one controller; the picker is shared, so a modifier
// set in PbtA carries into Mist and vice versa — which is the intuitive result.
const pbtaCtl = { notation: () => twod6Notation('pbta'), reset: resetTwod6, fromField: syncTwod6FromField };
const mistCtl = { notation: () => twod6Notation('mist'), reset: resetTwod6, fromField: syncTwod6FromField };

// ---- Mothership 1e ----
//
// Two signature rolls under one picker, chosen with a sub-mode toggle: a Check /
// Save (roll d100 under Target, plus an optional Skill tier and Advantage) and a
// Panic Check (roll d20 over Stress). Stress is a tracked resource, not pool
// setup: it is the Panic target, it climbs by 1 on every failed Check/Save, and
// it persists across reloads and mode switches. Damage/wounds use the numeric
// strip below (plain xd10 / 1d5 / 1d100).
const MS_STRESS_KEY = 'dicebox:ms:stress';
const ms = { mode: 'check', target: 30, skill: null, advantage: null, stress: 2 };
{
  // Restore the tracked Stress; anything out of the 2-20 band falls back to 2.
  const saved = Number(store.get(MS_STRESS_KEY));
  if (Number.isFinite(saved) && saved >= 2 && saved <= 20) ms.stress = Math.round(saved);
}
const msAdvButtons = [...document.querySelectorAll('.ms-adv')];
const msFieldsRow = $('msFieldsRow');
const msTargetDial = $('msTargetDial');
const msSkillDial = $('msSkillDial');
const msStressDial = $('msStressDial');
// Skill has only four fixed tiers, so it cycles on a tap/hold rather than opening
// the number dial: None → Trained → Expert → Master (and back).
const MS_SKILL_ORDER = [null, 't', 'e', 'm'];
const MS_SKILL_NAME = { t: 'Trained', e: 'Expert', m: 'Master' };
const MS_SKILL_BONUS_TEXT = { t: '+10', e: '+15', m: '+20' };
const msSkillLabel = () => (ms.skill ? MS_SKILL_NAME[ms.skill] : 'None');
const msCheckRoll = $('msCheckRoll');
const msPanicRoll = $('msPanicRoll');

function resetMothership() {
  // The roll config resets; Stress does not — it is the character's state.
  ms.mode = 'check';
  ms.target = 30;
  ms.skill = null;
  ms.advantage = null;
  syncMs({ writeField: false });
}

function msNotation() {
  if (ms.mode === 'panic') return `ms:p@${ms.stress}` + (ms.advantage || '');
  return 'ms:c' + (ms.target !== null ? `@${ms.target}` : '') + (ms.skill || '') + (ms.advantage || '');
}

// Stress lives in localStorage so it survives a reload. `restage` is skipped when
// a roll drives the bump — there the tray already holds the settling dice, so we
// only refresh the chip and persist, never re-stage over the result.
function setStress(n, { restage = true } = {}) {
  ms.stress = Math.max(2, Math.min(20, Math.round(n)));
  store.set(MS_STRESS_KEY, String(ms.stress));
  if (restage) syncMs();
  else msStressDial.textContent = String(ms.stress);
}

function syncMs({ writeField = true } = {}) {
  msTargetDial.textContent = ms.target === null ? '—' : String(ms.target);
  msTargetDial.setAttribute('aria-label', `Set Target, current ${ms.target === null ? 'unset' : ms.target}`);
  msSkillDial.textContent = msSkillLabel();
  msSkillDial.setAttribute('aria-label',
    `Skill tier, current ${msSkillLabel()}${ms.skill ? ' ' + MS_SKILL_BONUS_TEXT[ms.skill] : ''} — tap to raise, hold to lower`);
  for (const b of msAdvButtons) b.setAttribute('aria-pressed', String(ms.advantage === b.dataset.adv));
  // Only the active roll type is lit, so the tray's staged dice (a percentile
  // pair or the Panic d20) always match the highlighted tile.
  msCheckRoll.setAttribute('aria-pressed', String(ms.mode === 'check'));
  msPanicRoll.setAttribute('aria-pressed', String(ms.mode === 'panic'));
  msStressDial.textContent = String(ms.stress);
  msStressDial.setAttribute('aria-label', `Set Stress, current ${ms.stress}`);
  if (writeField) $('notation').value = msNotation();
  if (uiSystem === 'mothership') stageSystemPool();
}

// Advantage/Disadvantage are mutually exclusive; tapping the active choice clears it.
for (const b of msAdvButtons) b.addEventListener('click', () => { ms.advantage = ms.advantage === b.dataset.adv ? null : b.dataset.adv; syncMs(); });
// Target and Stress launch the same tactile wheel + direct jump control as d?.
// The resting rail stays two rows; the larger interaction exists only while used.
msTargetDial.addEventListener('click', () => {
  openNumberDial({
    title: 'Target', value: ms.target ?? 30, min: 1, max: 99,
    actionLabel: 'Set Target', inputLabel: 'Target number',
    commit: value => { ms.target = value; syncMs(); },
  });
});
// Only four tiers, so Skill cycles: a tap advances (None → Trained → Expert →
// Master → None), a hold (or left/down arrow) steps back the other way. Wrapping
// means a tap alone can reach any tier without ever needing the long-press.
bindTapHold(msSkillDial, dir => {
  const n = MS_SKILL_ORDER.length;
  const i = MS_SKILL_ORDER.indexOf(ms.skill);
  ms.skill = MS_SKILL_ORDER[(i + dir + n) % n];
  syncMs();
});
msStressDial.addEventListener('click', () => {
  openNumberDial({
    title: 'Stress', value: ms.stress, min: 2, max: 20,
    actionLabel: 'Set Stress', inputLabel: 'Current Stress',
    commit: setStress,
  });
});
// The two tiles choose the roll type: each stages its dice in the tray (the
// percentile pair or the Panic d20) and lights its tile — they do not roll.
// Rolling is the Roll button or a tap/flick on the tray, exactly like the numeric
// pool and every other system.
msCheckRoll.addEventListener('click', () => { ms.mode = 'check'; syncMs(); });
msPanicRoll.addEventListener('click', () => { ms.mode = 'panic'; syncMs(); });

function syncMsFromField() {
  try {
    const { mode, target, skill, advantage } = parseMothership($('notation').value);
    ms.mode = mode;
    ms.advantage = advantage;
    if (mode === 'panic') {
      // A typed Panic carries its Stress; reflect it in the tracker (clamped).
      if (target !== null) { ms.stress = Math.max(2, Math.min(20, target)); store.set(MS_STRESS_KEY, String(ms.stress)); }
    } else {
      ms.target = target;
      ms.skill = skill;
    }
    syncMs({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

// ---- Cards: the Woodcut deck ----
//
// A deck is the app's second stateful resource after Mothership's Stress: draws
// come off a shuffled order WITHOUT replacement (unless the Replace toggle is
// on), so the order and position persist across reloads. The art is ~1.1MB of
// traced path data and lives in cards-art.js, pulled with a dynamic import the
// first time the mode is opened; the service worker precaches it so that first
// open works offline too.
const DECK_KEY = 'dicebox:deck:v1';
const deckState = { order: [], pos: 0, jokers: false, replace: false, draw: 1 };
{
  try {
    const saved = JSON.parse(store.get(DECK_KEY) || 'null');
    if (saved && Array.isArray(saved.order) && saved.order.every(x => typeof x === 'string')) {
      Object.assign(deckState, saved, { draw: Math.max(1, Math.min(10, saved.draw || 1)) });
    }
  } catch { /* fresh deck */ }
}
const persistDeck = () => store.set(DECK_KEY, JSON.stringify(deckState));

const DECK_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function deckIds() {
  const out = [];
  for (const s of ['S', 'H', 'D', 'C']) for (const r of DECK_RANKS) out.push(r + s);
  if (deckState.jokers) out.push('J1', 'J2');
  return out;
}
const deckTotal = () => 52 + (deckState.jokers ? 2 : 0);
const deckRemaining = () => (deckState.replace ? deckTotal() : Math.max(0, deckState.order.length - deckState.pos));

// A uniform index in [0, n), rejection-sampled like the dice rolls.
function cryptoIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return v % n;
}

function reshuffleDeck() {
  deckState.order = newDeckOrder(deckIds(), n => cryptoIndex(n) + 1);
  deckState.pos = 0;
  persistDeck();
}

// Draw n cards per the current mode. Without replacement the draw comes off the
// persisted order; with replacement each card is an independent pick from the
// full deck (duplicates possible, as at a real table). Requires the art module
// (for labels) — callers go through dealCardsFlow, which loads it.
function drawDeckCards(n) {
  let ids;
  if (deckState.replace) {
    const pool = deckIds();
    ids = Array.from({ length: n }, () => pool[cryptoIndex(pool.length)]);
  } else {
    if (deckState.order.length === 0) reshuffleDeck();
    ids = deckState.order.slice(deckState.pos, deckState.pos + n);
    deckState.pos += ids.length;
    persistDeck();
  }
  const drawn = ids.map(id => {
    const m = cardArt.cardMeta(id);
    return { id, label: m.label, red: !!m.red };
  });
  return {
    schema: 2,
    system: 'cards',
    notation: `deck:${n}`,
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeCards(drawn, deckRemaining(), deckTotal()),
  };
}

// The art module, loaded once on demand. In the single-file bundle every module
// is inlined into the shared __dicebox namespace, so the dynamic import (which
// a lone local file could not serve) is skipped there.
let cardArt = null;
let cardArtLoading = null;
function ensureCardArt() {
  if (cardArt) return Promise.resolve(cardArt);
  if (!cardArtLoading) {
    /* global __dicebox */
    cardArtLoading = (typeof __dicebox !== 'undefined' && __dicebox.cardSVG)
      ? Promise.resolve(__dicebox)
      : import('./cards-art.js');
    cardArtLoading = cardArtLoading.then(m => (cardArt = m));
  }
  return cardArtLoading;
}

// Each card is rasterised once per theme from its SVG (at 2x for crisp
// downscaling) and drawn as an image; the flip and deal are cheap transforms.
const cardImgCache = new Map();
function cardImage(id) {
  const key = `${id}|${isDark() ? 'd' : 'l'}`;
  let entry = cardImgCache.get(key);
  if (entry) return entry;
  const svg = cardArt.cardSVG(id, { dark: isDark() })
    .replace('<svg ', '<svg width="500" height="700" ');
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  entry = { img, ready: img.decode ? img.decode().catch(() => {}) : Promise.resolve() };
  cardImgCache.set(key, entry);
  return entry;
}

// ---- card sprites ----
//
// Cards share the dice's frame loop (step/draw/settled and x/y/size), so the
// tray animates them with no changes to the loop itself. A drawn card flies
// from the deck stack to its slot along a lifted arc, lands, then flips from
// back to face; in Replace mode the previous draw flies home first.
const CARD_RATIO = 1.4;
const DEAL_S = 0.34, FLIP_S = 0.26;

class CardSprite {
  constructor(id, from, to, { delay = 0, remote = false, mode = 'deal' } = {}) {
    this.id = id;
    this.isCard = true;
    this.from = from; this.to = to;
    this.x = from.x; this.y = from.y;
    this.size = to.w;
    this.delay = delay; this.t = 0; this.flipT = 0;
    this.phase = 'fly'; // fly -> flip -> idle   (mode 'return' skips the flip)
    this.mode = mode;
    this.settled = false; this.settling = true; this.settleT = 1;
    // trayIdle() reads d.value: null keeps the frame loop live (and the idle
    // snapshot invalid) exactly like an unrolled die; the id lands with the card.
    this.value = null;
    this.remote = remote;
    this.wobble = (cryptoIndex(100) - 50) / 160;
  }
  step(dt) {
    if (this.phase === 'idle') return;
    if (this.delay > 0) { this.delay -= dt; return; }
    if (this.phase === 'fly') {
      this.t = Math.min(1, this.t + dt / DEAL_S);
      const e = 1 - Math.pow(1 - this.t, 3);
      this.x = this.from.x + (this.to.x - this.from.x) * e;
      this.y = this.from.y + (this.to.y - this.from.y) * e - Math.sin(Math.PI * e) * 24;
      if (this.t >= 1) {
        this.x = this.to.x; this.y = this.to.y;
        if (this.mode === 'return') { this.phase = 'idle'; this.settled = true; this.gone = true; this.value = this.id; }
        else this.phase = 'flip';
      }
    } else if (this.phase === 'flip') {
      this.flipT = Math.min(1, this.flipT + dt / FLIP_S);
      if (this.flipT >= 1) { this.phase = 'idle'; this.settled = true; this.value = this.id; }
    }
  }
  draw(ctx) {
    if (this.gone) return;
    const w = this.size, h = w * CARD_RATIO;
    const flip = this.mode === 'return' ? 0 : (this.phase === 'idle' ? 1 : this.flipT);
    const img = (flip < 0.5 ? cardImage('back') : cardImage(this.id)).img;
    const sx = this.phase === 'flip' ? Math.abs(Math.cos(Math.PI * flip)) || 0.02 : 1;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.phase === 'fly') ctx.rotate(this.wobble * (1 - this.t));
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(img, -(w * sx) / 2, -h / 2, w * sx, h);
    ctx.restore();
  }
  throwWith() {}
  spinInPlace() {}
}

// The deck itself, sitting on the tray like a dealer's shoe: a small stack of
// backs with the remaining count beneath. Tapping the tray draws; the Shuffle
// button riffles this stack in place.
class DeckStackSprite {
  constructor(x, y, w) {
    this.x = x; this.y = y; this.size = w;
    this.isCard = true; this.isStack = true;
    this.stageKind = 'deck-stack';
    this.settled = true; this.settling = true; this.settleT = 1;
    this.riffle = 0;
    this.value = 'deck';
  }
  step(dt) {
    if (this.riffle > 0) {
      this.riffle = Math.max(0, this.riffle - dt / 0.8);
      this.value = this.riffle > 0 ? null : 'deck';
    }
  }
  draw(ctx) {
    const w = this.size, h = w * CARD_RATIO;
    const img = cardImage('back').img;
    const empty = deckRemaining() === 0 && !deckState.replace;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    if (this.riffle > 0) {
      // The shuffle: the stack fans out and snaps back, cards leafing through
      // one another on the way home.
      const spread = Math.sin(Math.PI * Math.min(1, this.riffle * 1.15));
      for (let i = 0; i < 7; i++) {
        const k = (i - 3) / 3;
        ctx.save();
        ctx.rotate(k * 0.5 * spread);
        ctx.translate(k * w * 0.55 * spread, -Math.abs(k) * 8 * spread + (3 - i) * 1.4);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    } else {
      for (let i = 2; i >= 0; i--) {
        if (empty && i > 0) continue;
        ctx.save();
        ctx.globalAlpha = empty ? 0.35 : 1;
        ctx.translate(i * 2.5, i * 2.5 - 2.5);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(deckState.replace ? `${deckTotal()} · replace` : `${deckRemaining()} left`, this.x, this.y + h / 2 + 18);
    ctx.restore();
  }
  throwWith() {}
  spinInPlace() {}
}

// Where the stack sits (right of the tray, like a shoe) and where drawn cards
// land: centred rows in the space to its left.
function deckLayout(n) {
  const b = state.bounds;
  const stackW = Math.min(96, (b.right - b.left) * 0.2);
  const stack = { x: b.right - stackW / 2 - 14, y: (b.top + b.floor) / 2, w: stackW };
  const areaL = b.left + 10, areaR = stack.x - stackW / 2 - 26;
  const cols = n <= 4 ? Math.max(1, n) : Math.ceil(n / 2);
  const rows = n ? Math.ceil(n / cols) : 1;
  const w = Math.max(56, Math.min(112, (areaR - areaL) / cols - 12, ((b.floor - b.top) / rows - 16) / CARD_RATIO));
  const slots = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const c = i - r * cols;
    const rowW = inRow * (w + 12) - 12;
    slots.push({
      x: areaL + (areaR - areaL) / 2 - rowW / 2 + c * (w + 12) + w / 2,
      y: b.top + (b.floor - b.top) / 2 + (r - (rows - 1) / 2) * (w * CARD_RATIO + 14),
      w,
    });
  }
  return { stack, slots };
}

// The idle tray in Cards mode: just the deck, waiting.
function stageDeckIdle() {
  if (!cardArt) return;
  // A brand-new deck arrives shuffled, like one out of the box should.
  if (deckState.order.length === 0) reshuffleDeck();
  const { stack } = deckLayout(0);
  state.dice = [new DeckStackSprite(stack.x, stack.y, stack.w)];
  dropIdleCache();
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint('cards').idle;
  hideHint();
}

// Deal a draw (local or a peer's). Loads art and pre-decodes every image so the
// animation never flashes a half-loaded card.
async function dealCardsFlow(result, { remote = false } = {}) {
  await ensureCardArt();
  await cardImage('back').ready;
  await Promise.all(result.summary.drawn.map(c => cardImage(c.id).ready));

  const n = result.summary.drawn.length;
  const { stack, slots } = deckLayout(n);
  const stackSprite = new DeckStackSprite(stack.x, stack.y, stack.w);
  const sprites = [stackSprite];

  // In Replace mode the previous draw visibly goes home before the new one
  // arrives; everywhere else the tray simply moves on, like dice do.
  let delay0 = 0;
  if (deckState.replace && !remote) {
    for (const d of state.dice) {
      if (d.isCard && !d.isStack && d.phase === 'idle') {
        const back = new CardSprite(d.id, { x: d.x, y: d.y }, { x: stack.x, y: stack.y, w: d.size }, { mode: 'return' });
        sprites.push(back);
        delay0 = 0.22;
      }
    }
  }
  result.summary.drawn.forEach((c, i) => {
    sprites.push(new CardSprite(c.id, { x: stack.x, y: stack.y }, slots[i], { delay: delay0 + i * 0.12, remote }));
  });

  state.dice = sprites;
  dropIdleCache();
  $('total').dataset.rolling = '1';
  const settleMs = (delay0 + n * 0.12 + DEAL_S + FLIP_S) * 1000 + 160;
  setTimeout(() => finish(result), settleMs);
  if (!remote && navigator.vibrate) navigator.vibrate([6, 30, 8]);
  hideHint();
  return result;
}

// A peer's draw: same deal, but the readout lands via the remote claim (their
// history line was already added on arrival, and their draw is never re-shared).
function dealCardsFlowRemote(result, claim) {
  const preload = [cardImage('back').ready, ...result.summary.drawn.map(c => cardImage(c.id).ready)];
  Promise.all(preload).then(() => {
    if (state.remoteClaim !== claim) return;
    const n = result.summary.drawn.length;
    const { stack, slots } = deckLayout(n);
    const sprites = [new DeckStackSprite(stack.x, stack.y, stack.w)];
    result.summary.drawn.forEach((c, i) => {
      sprites.push(new CardSprite(c.id, { x: stack.x, y: stack.y }, slots[i], { delay: i * 0.12, remote: true }));
    });
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.rolling = '1';
    setTimeout(() => {
      if (state.remoteClaim !== claim) return;
      delete $('total').dataset.rolling;
      delete $('total').dataset.idle;
      setTotal(cardsHeadline(result));
      $('breakdown').textContent = describeCards(result);
    }, (n * 0.12 + DEAL_S + FLIP_S) * 1000 + 160);
  });
}

// The sync entry point doRoll routes to; errors surface like any bad notation.
function dealFromNotation(notation) {
  let draw;
  try { draw = parseCards(notation).draw; } catch (err) { showError(err.message); return; }
  clearError();
  state.remoteClaim = null;
  ensureCardArt()
    .then(() => dealCardsFlow(drawDeckCards(draw)))
    .then(res => {
      state.last = res;
      $('notation').value = res.notation;
      syncCardsUI({ writeField: false, restage: false });
    })
    .catch(err => showError(String((err && err.message) || err)));
}

// ---- the cards picker ----
const cardsPicker = $('cardsPicker');
const deckCountVal = $('deckCount');
const deckRemainVal = $('deckRemain');
const deckFlagButtons = [...document.querySelectorAll('.deck-flag')];

function syncCardsUI({ writeField = true, restage = true } = {}) {
  deckCountVal.textContent = String(deckState.draw);
  deckRemainVal.textContent = deckState.replace ? `${deckTotal()}∞` : `${deckRemaining()}/${deckTotal()}`;
  for (const b of deckFlagButtons) {
    const on = b.dataset.flag === 'jokers' ? deckState.jokers : deckState.replace;
    b.setAttribute('aria-pressed', String(on));
  }
  if (writeField && uiSystem === 'cards') $('notation').value = `deck:${deckState.draw}`;
  if (restage && uiSystem === 'cards' && !$('total').dataset.rolling) stageDeckIdle();
}

bindTapHold($('deckCountChip'), dir => {
  deckState.draw = Math.max(1, Math.min(10, deckState.draw + dir));
  persistDeck();
  syncCardsUI({ restage: false });
});
$('deckDraw').addEventListener('click', () => doRoll(`deck:${deckState.draw}`));
$('deckShuffle').addEventListener('click', () => {
  reshuffleDeck();
  ensureCardArt().then(() => {
    stageDeckIdle();
    const stack = state.dice.find(d => d.isStack);
    if (stack) { stack.riffle = 1; stack.value = null; dropIdleCache(); }
    if (navigator.vibrate) navigator.vibrate([5, 25, 5, 25, 8]);
    syncCardsUI({ restage: false });
  });
});
for (const b of deckFlagButtons) {
  b.addEventListener('click', () => {
    if (b.dataset.flag === 'jokers') {
      // Changing what the deck contains means a fresh shuffle — you cannot slip
      // jokers into a half-dealt deck at a real table either.
      deckState.jokers = !deckState.jokers;
      reshuffleDeck();
    } else {
      deckState.replace = !deckState.replace;
      persistDeck();
    }
    syncCardsUI();
  });
}

function syncCardsFromField() {
  try {
    const { draw } = parseCards($('notation').value);
    deckState.draw = draw;
    persistDeck();
    syncCardsUI({ writeField: false, restage: false });
  } catch { /* mid-type */ }
}

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

// Set how many of one die are staged, keeping whatever modifiers it carries.
// Zero removes it entirely.
function setDieCount(sides, count) {
  if (!poolMatchesField()) pool = parsePool($('notation').value);

  const cur = pool.get(sides);
  const next = Math.max(0, Math.min(999, Math.round(count)));
  if (next === (cur ? cur.count : 0)) return;

  if (next === 0) pool.delete(sides);
  else pool.set(sides, { count: next, mods: cur ? cur.mods : {} });
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
    : systemHint(uiSystem).idle;
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

// ---- staging the system pools like the numeric one ----
//
// The numeric row already does the thing that feels good: tap a die and it lands
// in the tray as a blank die; tap one in the tray and it leaves; Roll throws the
// lot. The system modes never drove that — they only wrote notation. These give
// every system the same behaviour: each maps its pool state to a flat list of
// blank-die descriptors, the shared stager renders them, and each staged die is
// tagged so a tap in the tray removes the right one.

// The polyhedral sides each Genesys die uses, so a staged pool draws the true
// shape (d8 Ability, d12 Proficiency, d6 Boost, …) the way the numeric pool does.
const GEN_SIDES = { ability: 8, proficiency: 12, boost: 6, difficulty: 8, challenge: 12, setback: 6, force: 12 };
// A Force die has no side until it is rolled (light or dark), so it stages in a
// neutral metal grey.
const FORCE_STAGE_COLOR = '#9AA0A6';

// The pool the active system would roll, as a flat list of blank-die descriptors
// { sides, genColor?, hunger?, kind }. `kind` is the tag a tap in the tray
// removes on. Mandatory dice (Hope/Fear, the Feat die, the fixed 2d6) are
// present but their kind is not removable.
function systemStageDescriptors() {
  const out = [];
  const add = (n, d) => { for (let i = 0; i < Math.max(0, n); i++) out.push(d); };
  switch (uiSystem) {
    case 'v5':
      add(v5.normal, { sides: 10, kind: 'v5-normal' });
      add(v5.hunger, { sides: 10, hunger: true, kind: 'v5-hunger' });
      break;
    case 'fate':
      add(fate.count, { sides: 6, kind: 'fate' });
      break;
    case 'genesys':
    case 'starwars':
      for (const t of GEN_TYPES) {
        if (t.type === 'force' && uiSystem !== 'starwars') continue;
        add(gen[t.type], {
          sides: GEN_SIDES[t.type],
          genColor: t.type === 'force' ? FORCE_STAGE_COLOR : GEN_COLORS[t.type],
          kind: `gen-${t.type}`,
        });
      }
      break;
    case 'daggerheart':
      out.push({ sides: 12, genColor: DH_COLORS.hope, kind: 'dh-hope' });
      out.push({ sides: 12, genColor: DH_COLORS.fear, kind: 'dh-fear' });
      add(Math.abs(dhState.advantage), {
        sides: 6,
        genColor: dhState.advantage < 0 ? DH_COLORS.disadvantage : DH_COLORS.advantage,
        kind: 'dh-adv',
      });
      break;
    case 'cthulhutech':
      add(ct.dice, { sides: 10, genColor: CT_COLORS.miss, kind: 'ct' });
      break;
    case 'onering':
      add(tor.favour ? 2 : 1, { sides: 12, genColor: TOR_COLORS.feat, kind: 'tor-feat' });
      add(tor.success, { sides: 6, genColor: TOR_COLORS.success, kind: 'tor-success' });
      break;
    case 'pbta':
    case 'mist':
      add(2, { sides: 6, kind: '2d6' });
      break;
    case 'mothership': {
      // Advantage/Disadvantage rolls the complete check twice. Stage both
      // percentile pairs (four physical d10s) or both Panic d20s so the tray
      // visibly matches the selected notation before the roll.
      const copies = ms.advantage ? 2 : 1;
      if (ms.mode === 'panic') {
        add(copies, { sides: 20, genColor: MS_COLORS.panic, kind: 'ms-panic' });
      } else {
        add(copies, { sides: 10, genColor: MS_COLORS.tens, kind: 'ms-check' });
        add(copies, { sides: 10, genColor: MS_COLORS.ones, kind: 'ms-check' });
      }
      break;
    }
  }
  return out;
}

// Render the active system's pool as blank tray dice, exactly the way
// stageFromPool renders the numeric pool. Callers guard on their own system so
// the mode switch (which resets every system's controls in turn) only paints the
// tray for the active one. Notation is owned by the caller's sync* (this never
// writes it).
function stageSystemPool() {
  const staged = systemStageDescriptors().slice(0, ANIMATE_LIMIT).map(d => {
    const die = new Die(d.sides, null, 0, 0, 40);
    if (d.hunger) die.hunger = true;
    if (d.genColor) die.genColor = d.genColor;
    die.stageKind = d.kind;
    return die;
  });
  state.dice = staged;
  placeGrid(state.dice);
  for (const die of state.dice) {
    die.settled = true;
    die.settling = true;
    die.settleT = 1;
    die.rot = [0.5, 0.6, 0.1];
    die.homeX = die.x;
    die.homeY = die.y;
  }

  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = staged.length
    ? `${staged.length} ${staged.length === 1 ? 'die' : 'dice'} ready`
    : systemHint(uiSystem).idle;
  hideHint();
}

// Take one staged die of `kind` back off the pool by stepping the owning
// system's state, then let its sync re-render. Mandatory dice return false so a
// tap on them is a gentle no-op rather than an error.
function removeSystemStageKind(kind) {
  switch (kind) {
    case 'v5-normal': v5.normal = Math.max(0, v5.normal - 1); syncV5(); return true;
    case 'v5-hunger': v5.hunger = Math.max(0, v5.hunger - 1); syncV5(); return true;
    case 'fate': fate.count = Math.max(1, fate.count - 1); syncFate(); return true;
    case 'ct': ct.dice = Math.max(0, ct.dice - 1); syncCt(); return true;
    case 'tor-success': tor.success = Math.max(0, tor.success - 1); syncTor(); return true;
    case 'dh-adv':
      dhState.advantage -= Math.sign(dhState.advantage);
      syncDh();
      return true;
    default:
      if (kind && kind.startsWith('gen-')) {
        const type = kind.slice(4);
        if (gen[type] > 0) { gen[type] -= 1; syncGen(); return true; }
      }
      return false; // Hope/Fear, the Feat die, the fixed 2d6 — not removable.
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
  clearError();

  // A system keeps its pool in its own state, and clearing returns it to the
  // standard roll rather than to nothing: 0dF and ct:0 do not parse, so "empty"
  // is not a valid system pool. Its sync then restages the tray and rewrites the
  // field. Build-from-scratch systems (V5, Genesys) default to an empty pool, so
  // they clear to nothing just like numeric.
  if (uiSystem !== 'numeric') {
    switch (uiSystem) {
      case 'v5': resetV5(); syncV5(); break;
      case 'fate': resetFate(); syncFate(); break;
      case 'genesys': case 'starwars': resetGenesys(); syncGen(); break;
      case 'daggerheart': resetDaggerheart(); syncDh(); break;
      case 'cthulhutech': resetCthulhuTech(); syncCt(); break;
      case 'onering': resetOneRing(); syncTor(); break;
      case 'pbta': case 'mist': resetTwod6(); syncTwod6(); break;
      case 'mothership': resetMothership(); syncMs(); break;
      // The deck persists (it is the character's deck, like Stress); clearing
      // just returns the tray to the idle stack.
      case 'cards': ensureCardArt().then(() => { if (uiSystem === 'cards') syncCardsUI(); }); break;
    }
    return;
  }

  state.dice = [];
  $('notation').value = '';
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint(uiSystem).idle;
  markPool();
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
  if (STANDARD_DICE.has(sides)) b.dataset.std = '';

  // The hold-fill is its own element: ::before carries the modifier glyph and
  // ::after the count, so a pseudo-element here would collide with one of them.
  const fill = document.createElement('span');
  fill.className = 'dbtn-fill';
  b.append(fill, document.createTextNode(`d${sides}`));
  b.addEventListener('click', () => addToPool(sides, perTap()));
  attachModifierSheet(b, sides);
  return b;
}

// ---- the row scrolls ----
//
// More dice than fit, so the strip pans. The arrows show only when there is
// something that way: a scrollable row with no visible edge reads as the whole
// set, and every die past the eighth goes unnoticed.

const diceLeft = $('diceLeft');
const diceRight = $('diceRight');

function syncNudges() {
  const max = diceButtons.scrollWidth - diceButtons.clientWidth;
  // 2px of slack: sub-pixel layout leaves a hair of scroll that is not real.
  const canScroll = max > 2;
  diceLeft.hidden = !canScroll || diceButtons.scrollLeft <= 2;
  diceRight.hidden = !canScroll || diceButtons.scrollLeft >= max - 2;
}

// Scroll by most of a screenful, keeping a die or two for continuity.
const nudge = dir => diceButtons.scrollBy({
  left: dir * Math.max(120, diceButtons.clientWidth * 0.7),
  behavior: 'smooth',
});

diceLeft.addEventListener('click', () => nudge(-1));
diceRight.addEventListener('click', () => nudge(1));
diceButtons.addEventListener('scroll', syncNudges, { passive: true });
new ResizeObserver(syncNudges).observe(diceButtons);
// The buttons exist before this runs, and adding a custom die changes the width
// too, so settle the arrows once now rather than relying on the observer's
// first callback.
syncNudges();

// A desktop mouse has no horizontal wheel, so a plain scroll over the row pans
// it rather than doing nothing.
diceButtons.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  const max = diceButtons.scrollWidth - diceButtons.clientWidth;
  if (max <= 2) return;
  e.preventDefault();
  diceButtons.scrollLeft += e.deltaY;
}, { passive: false });

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
  syncNudges();
  return button;
}

// ---- full history ----
//
// The strip above the input shows the last few rolls; this is the whole session,
// with what every die landed on and when. Exportable, because the interesting
// question — "are these dice actually fair?" — needs the raw rolls, not a total.

const historyPanel = $('historyPanel');

// Reading sizes, in px. Four steps rather than a slider: the useful range is
// narrow, and a slider on a phone is a drag gesture inside a panel that already
// scrolls. The default is a step up from where this started, because the
// feedback that prompted this was that the smallest size was the only size.
const HISTORY_TEXT_SIZES = [13, 15, 17, 20];
const HISTORY_TEXT_DEFAULT = 1;

let historyTextStep = (() => {
  const saved = Number(store.get('dicebox:historyText'));
  return Number.isInteger(saved) && saved >= 0 && saved < HISTORY_TEXT_SIZES.length
    ? saved
    : HISTORY_TEXT_DEFAULT;
})();

function applyHistoryText() {
  historyPanel.style.setProperty('--history-text', `${HISTORY_TEXT_SIZES[historyTextStep]}px`);
  // Disabled rather than hidden at the ends, so the pair does not reflow the
  // title row as it is used.
  $('historySmaller').disabled = historyTextStep === 0;
  $('historyBigger').disabled = historyTextStep === HISTORY_TEXT_SIZES.length - 1;
}

function stepHistoryText(by) {
  const next = Math.min(HISTORY_TEXT_SIZES.length - 1, Math.max(0, historyTextStep + by));
  if (next === historyTextStep) return;
  historyTextStep = next;
  store.set('dicebox:historyText', String(next));
  applyHistoryText();
}

$('historySmaller').addEventListener('click', () => stepHistoryText(-1));
$('historyBigger').addEventListener('click', () => stepHistoryText(1));
applyHistoryText();

function openHistory() {
  setHelp(false);
  closeSheet();
  closeDial();
  closeRoom();
  closeMode();

  const list = $('historyFull');
  list.replaceChildren();

  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = 'No rolls yet.';
    list.append(empty);
  }

  // Newest first: the roll you are asking about is usually the last one.
  for (const entry of [...history].reverse()) {
    const li = document.createElement('li');
    if (entry.who && !entry.mine) li.dataset.remote = '1';

    const line = document.createElement('div');
    line.className = 'log-line';

    const when = document.createElement('span');
    when.className = 'history-time';
    when.textContent = new Date(entry.at).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const notation = document.createElement('span');
    notation.className = 'history-notation';
    if (entry.who) {
      const by = document.createElement('span');
      by.className = 'log-who';
      if (entry.mine) by.dataset.self = '1';
      by.textContent = entry.who;
      notation.append(by);
    }
    notation.append(entry.notation);

    const total = document.createElement('b');
    total.textContent = entry.headline ?? String(entry.total);

    line.append(when, notation, total);
    li.append(line);

    if (entry.detail && entry.detail !== entry.notation) {
      const detail = document.createElement('span');
      detail.className = 'log-detail';
      detail.textContent = entry.detail;
      li.append(detail);
    }
    list.append(li);
  }

  historyPanel.hidden = false;
  $('historyClose').focus();
}

function closeHistory() { historyPanel.hidden = true; }

$('historyOpen').addEventListener('click', openHistory);
$('historyClose').addEventListener('click', closeHistory);
historyPanel.addEventListener('click', e => {
  if (e.target === historyPanel) closeHistory();
});

// One row per die rather than per roll: that is the shape you want to pivot on,
// count faces with, or chart. A row-per-roll would bury the individual dice in
// a text field and make the whole export useless for the question people
// actually ask of a dice log.
function historyCsv() {
  const rows = [['time', 'who', 'notation', 'total', 'die', 'sides', 'value', 'kept', 'exploded', 'rerolled']];
  for (const entry of history) {
    entry.dice.forEach((d, i) => {
      rows.push([
        entry.at, entry.who || 'you', entry.notation, entry.headline ?? entry.total, i + 1,
        d.sides, d.value, d.kept ? 1 : 0, d.exploded ? 1 : 0, d.rerolled ? 1 : 0,
      ]);
    });
  }
  return rows
    .map(r => r.map(cell => {
      const text = String(cell);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(','))
    .join('\n');
}

function historyText() {
  return history
    .map(e => `${new Date(e.at).toLocaleTimeString()}  ${e.who ? e.who + '  ' : ''}${e.notation} = ${e.headline ?? e.total}\n    ${e.detail}`)
    .join('\n');
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoked on the next tick: the click is synchronous but the fetch is not.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

$('historyCsv').addEventListener('click', () => {
  if (history.length) download(`dicebox-${stamp()}.csv`, historyCsv(), 'text/csv');
});

$('historyJson').addEventListener('click', () => {
  if (history.length) {
    download(`dicebox-${stamp()}.json`, JSON.stringify(history, null, 2), 'application/json');
  }
});

$('historyCopy').addEventListener('click', async () => {
  if (!history.length) return;
  const button = $('historyCopy');
  try {
    await navigator.clipboard.writeText(historyText());
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => { button.textContent = 'Copy'; }, 1400);
});

$('historyClear').addEventListener('click', () => {
  history.length = 0;
  $('history').replaceChildren();
  $('historyCount').textContent = '';
  openHistory();
});

// ---- tactile number dial ----
//
// The d? scroll wheel also sets bounded character values. It keeps the tactile
// phone-timer interaction the user liked while the field beside it still permits
// a direct jump such as Target 73. Only its title, range, prefix and commit action
// change; all three launchers share the same accessible dialog.

const MAX_SIDES = 1000;
const dial = $('dial');
const wheel = $('wheel');
const dialInput = $('dialInput');
const dialTitle = $('dialTitle');
const dialPrefix = $('dialPrefix');
const dialAdd = $('dialAdd');
const dialClose = $('dialClose');
let customSides = 20;
let dialReturnFocus = null;
let dialConfig = {
  title: 'Custom die', value: customSides, min: 1, max: MAX_SIDES, prefix: 'd',
  actionLabel: 'Add to tray', inputLabel: 'Number of sides', commit: () => {},
};

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
  const fallback = Math.max(dialConfig.min, Math.min(dialConfig.max, dialConfig.value));
  return Number.isFinite(n)
    ? Math.max(dialConfig.min, Math.min(dialConfig.max, n))
    : fallback;
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
  const value = Math.max(dialConfig.min, Math.min(dialConfig.max, Math.round(n)));
  dialInput.value = String(value);
  for (const item of wheel.children) {
    item.setAttribute('aria-selected', String(!item.hidden && Number(item.dataset.value) === value));
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
    let closest = dialConfig.min, best = Infinity;
    for (const item of wheel.children) {
      if (item.hidden) continue;
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
  if (Number.isFinite(n) && n >= dialConfig.min && n <= dialConfig.max) setDial(n, { scroll: true });
});
dialInput.addEventListener('focus', () => dialInput.select());

function openNumberDial(config) {
  const active = document.activeElement;
  dialReturnFocus = active && typeof active.focus === 'function' ? active : null;
  dialConfig = { prefix: '', ...config };
  dialTitle.textContent = dialConfig.title;
  dialPrefix.textContent = dialConfig.prefix;
  dialPrefix.hidden = !dialConfig.prefix;
  dialInput.setAttribute('aria-label', dialConfig.inputLabel);
  wheel.setAttribute('aria-label', dialConfig.inputLabel);
  dialAdd.textContent = dialConfig.actionLabel;
  for (const item of wheel.children) {
    const value = Number(item.dataset.value);
    item.hidden = value < dialConfig.min || value > dialConfig.max;
    item.textContent = `${dialConfig.prefix}${value}`;
  }
  setHelp(false);
  closeSheet();
  closeHistory();
  closeRoom();
  closeMode();
  dial.hidden = false;
  setDial(dialConfig.value);
  dialInput.focus();
  dialInput.select();
  hideHint();
}

function openDial() {
  openNumberDial({
    title: 'Custom die', value: customSides, min: 1, max: MAX_SIDES, prefix: 'd',
    actionLabel: 'Add to tray', inputLabel: 'Number of sides',
    commit: sides => {
      customSides = sides;
      const button = ensureDieButton(sides);
      addToPool(sides, perTap());
      button.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    },
  });
}

function closeDial() {
  if (dial.hidden) return;
  dial.hidden = true;
  const target = dialReturnFocus;
  dialReturnFocus = null;
  if (target && target.isConnected && typeof target.focus === 'function') target.focus();
}

dial.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || dial.hidden) return;
  const focusable = [dialClose, wheel, dialInput, dialAdd].filter(el => !el.hidden && !el.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  } else if (!focusable.includes(document.activeElement)) {
    e.preventDefault();
    first.focus();
  }
});

$('customDie').addEventListener('click', openDial);
dialClose.addEventListener('click', closeDial);
dialAdd.addEventListener('click', () => {
  const value = dialValue();
  const commit = dialConfig.commit;
  closeDial();
  commit(value);
});

// ---- modifier sheet ----
//
// Long-press (or right-click) a die for the modifiers that would otherwise need
// typing. Everything the notation supports is reachable without the text field,
// but none of it takes up space until it is asked for.

const sheet = $('sheet');
const sheetOptions = $('sheetOptions');

function modifiersFor(sides) {
  // Mothership's manual rail is for plain damage and table dice. Its
  // Advantage/Disadvantage mechanic compares two complete rolls and is handled
  // by the rules-aware controls above; generic keep/drop/explode/reroll suffixes
  // are either wrong for a multi-die Mothership roll or are not core mechanics.
  if (uiSystem === 'mothership') return [];

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

function openSheet(sides, { focus = null } = {}) {
  // They all fill the tray, so only one can be up at a time.
  setHelp(false);
  closeDial();
  closeHistory();
  closeRoom();
  $('sheetTitle').textContent = `d${sides}`;
  sheetOptions.replaceChildren();

  const current = pool.get(sides);

  // How many of this die are staged, adjustable exactly. Dragging the button
  // sideways is quicker, but a number you can type is the only way to land on a
  // specific count without counting taps.
  const row = document.createElement('div');
  row.className = 'sheet-count';

  const label = document.createElement('span');
  label.className = 'sheet-count-label';
  label.textContent = 'How many';

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'step';
  minus.textContent = '−';
  minus.setAttribute('aria-label', `One fewer d${sides}`);

  const field = document.createElement('input');
  field.type = 'text';
  field.inputMode = 'numeric';
  field.className = 'count sheet-count-field';
  field.value = String(current ? current.count : 0);
  field.setAttribute('aria-label', `Number of d${sides}`);

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'step';
  plus.textContent = '+';
  plus.setAttribute('aria-label', `One more d${sides}`);

  const readField = () => {
    const n = parseInt(field.value, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 999) : 0;
  };
  const applyCount = n => {
    setDieCount(sides, n);
    field.value = String(Math.max(0, Math.min(999, Math.round(n))));
    refreshSheetPreviews(sides);
  };

  minus.addEventListener('click', () => applyCount(readField() - 1));
  plus.addEventListener('click', () => applyCount(readField() + 1));
  field.addEventListener('change', () => applyCount(readField()));
  field.addEventListener('focus', () => field.select());

  const counter = document.createElement('div');
  counter.className = 'counter';
  counter.append(minus, field, plus);
  row.append(label, counter);
  sheetOptions.append(row);

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
    b.dataset.suffix = mod.suffix;
    b.dataset.min = String(mod.min);
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
    // The sheet stays open: modifiers in different slots stack, so picking
    // exploding and then reroll should be two taps rather than two long
    // presses. It closes on the X, on Escape, or by tapping outside.
    b.addEventListener('click', () => {
      applyModifier(sides, mod);
      // Rebuild so active and blocked states are current, then put focus back
      // where it was — a keyboard user should not be dropped to the top of the
      // list after every choice.
      openSheet(sides, { focus: mod.suffix });
    });
    sheetOptions.append(b);
  }

  sheet.hidden = false;
  // Reopening after a choice keeps focus on the option just used, rather than
  // snapping back to the top of the list.
  const target = focus
    ? sheetOptions.querySelector(`.sheet-option[data-suffix="${CSS.escape(focus)}"]:not([disabled])`)
    : null;
  (target || sheetOptions.querySelector('.sheet-option:not([disabled])'))?.focus();
}

// The modifier rows preview what they would stage, so changing the count has to
// update them or they advertise a number that is no longer true.
function refreshSheetPreviews(sides) {
  for (const option of sheetOptions.querySelectorAll('.sheet-option')) {
    const suffix = option.dataset.suffix || '';
    const min = Number(option.dataset.min || 1);
    const notation = option.querySelector('.sheet-option-notation');
    if (!notation || option.dataset.blocked) continue;

    const cur = pool.get(sides);
    const mods = { ...(cur ? cur.mods : {}) };
    if (suffix) mods[slotFor(suffix)] = suffix;
    else for (const s of SLOTS) delete mods[s];

    const base = cur ? cur.count : perTap();
    notation.textContent = entryNotation(sides, { count: Math.max(min, base), mods });
  }
}

function closeSheet() {
  sheet.hidden = true;
}

$('sheetClose').addEventListener('click', closeSheet);

// The sheet now stays open across choices, so it needs an easy way out: tapping
// the empty space around the options closes it, as does the X and Escape.
sheet.addEventListener('click', e => {
  if (e.target === sheet) closeSheet();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!sheet.hidden) closeSheet();
  if (!dial.hidden) closeDial();
  if (!historyPanel.hidden) closeHistory();
  if (!roomPanel.hidden) closeRoom();
  if (!modeSheet.hidden) closeMode();
});

// Tapping the empty space around the mode cards closes the sheet, like the rest.
modeSheet.addEventListener('click', e => {
  if (e.target === modeSheet) closeMode();
});

// Long-press on touch, right-click on desktop — long-press has no mouse
// equivalent, and the feature should not be touch-only.
function attachModifierSheet(button, sides) {
  let timer = null;
  let longPressed = false;
  let scrub = null;
  let lastX = 0;

  const start = e => {
    longPressed = false;
    // Where the press began, so a sideways drag can be recognised as a scroll
    // rather than a tap. Scrubbing is not armed here: the row has to be free to
    // pan, or every die past the eighth is unreachable on a phone.
    scrub = {
      x: e.clientX,
      y: e.clientY,
      startCount: (pool.get(sides) || { count: 0 }).count,
      moved: false,
      armed: false,
      pointerId: e.pointerId,
    };
    // The fill is the affordance: it shows a hold is doing something, and how
    // much longer to hold. Duration matches the CSS transition.
    button.dataset.holding = '1';
    timer = setTimeout(() => {
      longPressed = true;
      delete button.dataset.holding;
      if (navigator.vibrate) navigator.vibrate(12);
      // Holding still arms the scrub, so a drag that begins *after* the hold
      // dials the count without ever fighting the scroller.
      if (scrub) { scrub.armed = true; scrub.x = lastX; scrub.startCount =
        (pool.get(sides) || { count: 0 }).count; }
      openSheet(sides);
    }, 450);
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    delete button.dataset.holding;
    delete button.dataset.scrubbing;
    scrub = null;
  };

  // No pointer capture: capturing the pointer takes the gesture away from the
  // scroller, which is the other half of what made the row unscrollable.
  button.addEventListener('pointerdown', e => {
    lastX = e.clientX;
    start(e);
  });

  button.addEventListener('pointermove', e => {
    lastX = e.clientX;
    if (!scrub) return;
    const dx = e.clientX - scrub.x;

    // Before the hold completes, any real movement is a scroll or a scrub on the
    // row itself. Cancel the press and let the browser have the gesture.
    if (!scrub.armed) {
      if (Math.abs(dx) > 8 || Math.abs(e.clientY - scrub.y) > 8) {
        clearTimeout(timer);
        timer = null;
        delete button.dataset.holding;
        scrub = null;
      }
      return;
    }

    if (!scrub.moved) {
      if (Math.abs(dx) < 8) return;
      scrub.moved = true;
      button.dataset.scrubbing = '1';
    }
    // Accelerates with distance: small nudges are precise, long drags cover the
    // range without a marathon swipe.
    const steps = Math.sign(dx) * Math.round(Math.pow(Math.abs(dx) / 14, 1.55));
    setDieCount(sides, Math.max(0, scrub.startCount + steps));
    refreshSheetPreviews(sides);
  });

  const finish = () => {
    if (scrub && scrub.moved) {
      // The drag already set the count; suppress the click that follows.
      longPressed = true;
    }
    cancel();
  };

  button.addEventListener('pointerup', finish);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('pointerleave', () => { if (!scrub || !scrub.moved) cancel(); });

  // Swallow the click that follows a long press or a drag, so neither also
  // stages another die.
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

  // Throw whatever is staged; failing that, roll the mode's default. The tray is
  // never a dead surface, so a tap on an empty one still rolls — but it must roll
  // the current system's dice, not a d20 left over from numeric mode.
  const typed = $('notation').value.trim();
  const target = typed || emptyTrayRoll();

  doRoll(target);
  if (speed > 120) {
    for (const d of state.dice) d.throwWith(vx * 0.5, Math.abs(vy) * 0.5 + 200);
  }
});

// What a flick or tap on an empty tray rolls. In a system mode it must be that
// system's own default — a bare d20 makes no sense in Vampire — so V5 throws a
// starter pool of one ordinary die and one Hunger die. Numeric keeps re-rolling
// your last roll, or the selected die if there is none yet.
function emptyTrayRoll() {
  if (uiSystem === 'v5') return v5Notation() || 'v5:2h1';
  if (uiSystem === 'fate') return fateNotation();
  if (uiSystem === 'genesys') return genNotation() || 'gen:1P+1A+2D';
  if (uiSystem === 'starwars') return genNotation() || 'sw:1A+2D+1F';
  if (uiSystem === 'onering') return torNotation();
  if (uiSystem === 'daggerheart') return dhNotation();
  if (uiSystem === 'cthulhutech') return ctNotation() || ctExample();
  if (uiSystem === 'pbta') return pbtaCtl.notation();
  if (uiSystem === 'mist') return mistCtl.notation();
  if (uiSystem === 'mothership') return msNotation();
  if (uiSystem === 'cards') return `deck:${deckState.draw}`;
  const last = state.last;
  const lastNumeric = last && (last.system === 'numeric' || last.system === undefined);
  return (lastNumeric && last.notation) || `d${state.defaultSides}`;
}

// Re-stage the active system's own pool (its signature dice + notation). Used
// when a damage pool built on the numeric strip is emptied while in a system mode.
function restageActiveSystem() {
  switch (uiSystem) {
    case 'v5': syncV5(); break;
    case 'fate': syncFate(); break;
    case 'genesys': case 'starwars': syncGen(); break;
    case 'daggerheart': syncDh(); break;
    case 'cthulhutech': syncCt(); break;
    case 'onering': syncTor(); break;
    case 'pbta': case 'mist': syncTwod6(); break;
    case 'mothership': syncMs(); break;
  }
}

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

  // A staged *system* die carries a stageKind and removes through its own pool.
  // Numeric dice tapped from the strip — the damage pool a Mothership or
  // Daggerheart player builds — carry none, so they fall through to the numeric
  // removal below even though the mode is not 'numeric'.
  if (hit.stageKind) {
    const removed = removeSystemStageKind(hit.stageKind);
    if (removed && navigator.vibrate) navigator.vibrate(8);
    return removed;
  }

  const entry = pool.get(hit.sides);
  if (!entry) return false;

  if (entry.count > 1) pool.set(hit.sides, { count: entry.count - 1, mods: entry.mods });
  else pool.delete(hit.sides);

  if (navigator.vibrate) navigator.vibrate(8);
  // In a system mode, emptying the damage pool returns the tray to that system's
  // own staged dice (and notation) rather than leaving it blank.
  if (uiSystem !== 'numeric' && pool.size === 0) restageActiveSystem();
  else syncPool();
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

// Settled-tray cache: once a *completed roll* has settled (and its reveal has
// played and the tray is visible with no bursts left), the final frame is copied
// to an offscreen canvas and blitted back every tick. The rAF loop never stops,
// so there is no "missed wake" freeze — a new roll makes trayIdle() false and the
// cache is discarded. This is what makes an exact d1000 stop costing a 3k-edge
// redraw per frame the moment it rests.
//
// Staging dice (added by tapping d2/d3 without rolling) carry value null, so
// they make trayIdle() false: a tray being *built* is never frozen, and every
// newly added die draws immediately. Only a thrown, settled, valued tray idles.
let idleCanvas = null, idleSize = null, idleSince = null;

// The idle snapshot is keyed off trayIdle(), which a swap from one settled
// scene to another never trips. The card stagers call this so a fresh stack
// (or a peer's deal) never renders under a stale picture of the old one.
function dropIdleCache() { idleCanvas = null; idleSize = null; idleSince = null; }
const REVEAL_MS = 450;
function trayIdle() {
  return state.dice.length > 0
    && state.dice.every(d => d.settled && d.value !== null)
    && state.surface.bursts.length === 0
    && !trayCovered();
}

// True while a panel covers the tray. The dice keep simulating underneath, but
// drawing them wastes a frame on something nobody can see — and any translucency
// in the panel would let them ghost through.
function trayCovered() {
  return !sheet.hidden || !dial.hidden || !historyPanel.hidden || !help.hidden
      || !roomPanel.hidden;
}

function drawFrame(dt) {
  const t = theme();
  const r = canvas.getBoundingClientRect();

  // Fully-settled tray: blit the cached frame instead of re-stepping and
  // re-drawing every die. Skipping the mesh redraw is what keeps an exact d1000
  // idle cost ~0 instead of a 3k-edge frame.
  if (idleCanvas && idleSize && trayIdle() && idleSize[0] === Math.round(r.width) && idleSize[1] === Math.round(r.height)) {
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.drawImage(idleCanvas, 0, 0, r.width, r.height);
    return;
  }

  ctx.clearRect(0, 0, r.width, r.height);

  state.surface.step(dt);
  beginFrame();

  for (const d of state.dice) {
    const wasSettled = d.settled;
    d.step(dt, state.bounds);
    if (!wasSettled && d.settled) {
      state.surface.impact(d.x, d.y, d.size);
      // A rerolled die lands once, then throws itself again. Doing it here
      // rather than at roll time means the pause starts when the die actually
      // stops, however long its first tumble took.
      if (d.rerolled && !d.rerollShown) {
        d.rerollShown = true;
        d.beginReroll();
      }
      if (d.exploded && !d.burstShown) {
        d.burstShown = true;
        state.surface.burst(d.x, d.y, d.size);
        // The burst is drawn for anyone's die, but only your own buzzes. A
        // phone going off for every explosion at a busy table is an irritation,
        // and touch is the one cue worth reserving for the roll you made.
        if (!d.remote && navigator.vibrate) navigator.vibrate([14, 30, 22]);
      }
    }
  }

  // Spin-in-place dice never move, so the grid spacing already holds — running
  // O(n^2) separation over 100+ of them every frame would be pure waste. Cards
  // fly along fixed paths to fixed slots, so pushing them apart mid-flight
  // would only bend the deal.
  if (state.dice.length > 1 && state.dice.length <= THROW_LIMIT && !state.dice[0].isCard) {
    separate(state.dice, state.bounds);
  }

  // A panel covers the tray, so the dice have been stepped but there is nothing
  // to show. Skipping the draw keeps them from ghosting through anything
  // translucent and saves the frame.
  if (trayCovered()) return;

  // Contact marks sit under the dice, so they draw first.
  state.surface.drawRests(ctx, t, state.dice);
  state.surface.draw(ctx, t);
  for (const d of state.dice) d.draw(ctx, t);
  // Bursts go over the dice: an explosion happens in front of the thing that
  // exploded, not behind it.
  state.surface.drawBursts(ctx, t);

  // Maintain the settled-tray cache. Only snap once the reveal has played, so a
  // die mid-fade is never frozen half-drawn.
  if (trayIdle()) {
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (idleSince === null) idleSince = performance.now();
    if (performance.now() - idleSince >= REVEAL_MS && (!idleCanvas || !idleSize || idleSize[0] !== w || idleSize[1] !== h)) {
      if (!idleCanvas) idleCanvas = document.createElement('canvas');
      idleCanvas.width = w; idleCanvas.height = h;
      idleCanvas.getContext('2d').drawImage(canvas, 0, 0, w, h);
      idleSize = [w, h];
    }
  } else {
    idleCanvas = null; idleSize = null; idleSince = null;
  }
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

if (embedded) {
  // Nothing here applies inside a panel: there is no address bar to install
  // from, no home screen to install to, and the host page needs the network
  // regardless. Saying so is better than leaving instructions that cannot be
  // followed sitting in the help.
  $('installNote').hidden = true;
} else if (standalone) {
  installHint.textContent = 'Running as an app. Rolls work offline.';
} else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
  // Safari offers no install API, so name the actual menu items.
  installHint.textContent = 'To install: tap Share, then Add to Home Screen. It works offline.';
}

// Offline support, but not when embedded.
//
// A copy running inside someone else's page should not install a service
// worker. It buys nothing there, since the host page needs the network anyway,
// and it costs the one thing that makes an embedded copy debuggable: a panel
// with no address bar and no reload button that is being served a cached build
// from a previous deploy is very hard to diagnose and nearly impossible to talk
// a player through fixing.
//
// Wrapped because `'serviceWorker' in navigator` can throw where storage is
// partitioned, which is exactly the embedded case.
try {
  if (!embedded && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
} catch { /* no service worker, no offline cache, everything else still works */ }

// ---- rooms ----
//
// Sharing is strictly additive: every line below can fail, and the only thing
// that happens is that rolls stop leaving the device. Nothing here is awaited
// from doRoll, and no state it owns is consulted before a die is thrown.

// Which build this is, stamped in at deploy time and shown in the help panel.
//
// A service worker serves a correct-looking app from a cache indefinitely, and
// says nothing about it. That turned a fixed bug into two rounds of "it is
// still broken" against code that was right on the server — the only way to
// tell the two apart was to compare bytes over the wire. Now the app says which
// build it is, and the answer is one tap away on the device that has the
// problem. Empty in a checkout and in the single-file build, where there is no
// deploy to be out of step with.
const BUILD_ID = document.querySelector('meta[name="dicebox-build"]')?.content?.trim() || '';
if (BUILD_ID) {
  const stamp = $('build');
  stamp.textContent = `build ${BUILD_ID}`;
  stamp.hidden = false;
}

// Where the relay lives. Empty means sharing is simply unavailable — a build
// with no relay configured shows the Share button doing nothing useful rather
// than pretending to connect, and the local app is unaffected either way.
const RELAY_URL = document.querySelector('meta[name="dicebox-relay"]')?.content?.trim() || '';

// A name nobody has to think about, and specifically not their own. Defaulting
// to a real name is how a casual game night ends up with a legal name sitting in
// someone else's exported CSV — so the suggestion is always a pseudonym, and
// changing it is one field away.
const NAME_COLOURS = [
  'Amber', 'Ash', 'Cobalt', 'Copper', 'Ember', 'Indigo', 'Ivory', 'Jade',
  'Onyx', 'Rust', 'Sable', 'Slate', 'Umber', 'Verdant', 'Violet', 'Wren',
];
const NAME_CREATURES = [
  'Wolf', 'Heron', 'Otter', 'Falcon', 'Badger', 'Marten', 'Raven', 'Hare',
  'Lynx', 'Stoat', 'Adder', 'Kestrel', 'Boar', 'Shrike', 'Vixen', 'Elk',
];

// crypto.getRandomValues rather than Math.random, for the same reason the dice
// use it: there is one source of randomness in this app and it is that one.
function pick(list) {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return list[n[0] % list.length];
}

function suggestName() {
  return `${pick(NAME_COLOURS)} ${pick(NAME_CREATURES)}`;
}

const roomPanel = $('roomPanel');
const roomToggle = $('roomToggle');
const roomFlag = $('shareFlag');
const roomNameField = $('roomName');

// The panel is the only privacy statement inside the app, and it has to be
// honest about which of the two guarantees this build actually offers. A copy
// running from file: is the whole app, already on disk and unable to change
// under the reader, so "we cannot see your rolls" is literally true of it.
// Anything served over http(s) — the hosted demo included — hands the browser
// the encrypting code on every load, so the trust extends to whoever serves it.
// The markup carries the served wording by default so that a build which never
// reaches this line still tells the truth.
if (location.protocol === 'file:') {
  $('roomNote').textContent =
    'Rolls are end-to-end encrypted, so only people with the passphrase can ' +
    'read them. This copy is the file on your disk, so the code cannot change ' +
    'under you.';
}

// The passphrase for the room currently joined, kept so the copy buttons work
// after connecting. Cleared on leave along with everything else.
let roomPhrase = null;

const roomLink = createRoom({
  url: RELAY_URL,
  name: suggestName(),
  onState: showRoomState,
  onRoll: showRemoteRoll,
  onPresence: showRoster,
  onNotice: showRoomNotice,
});

// A remote roll animates exactly as a local one does. It has to: the point of a
// shared tray over a shared log is watching the dice, and dropping someone
// else's roll in fully settled reads as a notification rather than a throw.
//
// Nothing needs synchronising for this. The result was decided on the roller's
// device and travels as a number, so both trays animate independently toward
// the same outcome — a phone rendering half a second behind another is
// invisible, because the dice were never agreeing on a trajectory, only on
// where they stop.
//
// The one thing this must not do is interrupt a throw of your own, which the
// dataset.rolling guard below covers.
function showRemoteRoll(roll) {
  // Rebuild the shape the formatters and the tray expect. A numeric roll travels
  // as a total; a system roll (V5, Fate, …) travels with its system id and the
  // summary its headline and detail are rendered from.
  const result = {
    system: roll.system || 'numeric',
    notation: roll.notation,
    groups: roll.groups,
    total: roll.total,
    summary: roll.summary,
  };
  addHistory(result, roll.name);

  // A peer's draw deals through the card dealer, exactly like their own tray:
  // stack, flight, flip — remote only steers the haptics away. finish() is
  // called by the dealer's own timer; addHistory ran above, and finish adds
  // again, so the dealer path for remote skips it via the claim below not
  // being ours... simpler: cards route renders and sets the readout directly.
  if (result.system === 'cards') {
    if ($('total').dataset.rolling && !state.remoteClaim) return;
    const claim = {};
    state.remoteClaim = claim;
    ensureCardArt().then(() => {
      if (state.remoteClaim !== claim) return;
      dealCardsFlowRemote(result, claim);
    });
    return;
  }

  // Yield to a throw of your own, but not to another remote roll. Testing
  // dataset.rolling alone treated both the same, so once remote rolls started
  // animating, a second one arriving inside the first one's flight was dropped
  // from the tray — two quick rolls at one table showed as one at every other.
  //
  // A remote roll still in the air is simply superseded, which is what a real
  // table does: the next handful lands and you look at that instead.
  if ($('total').dataset.rolling && !state.remoteClaim) return;

  const flat = flattenRollDice(result);
  if (!flat.length || flat.length > ANIMATE_LIMIT) return;

  // Someone else's dice, stamped with their system's faces and colours so they
  // look exactly like a local roll; `remote` only steers haptics away.
  state.dice = buildTrayDice(flat, result, { remote: true });
  placeGrid(state.dice);

  // The readout updates when the dice land rather than now, so the number
  // arrives with them. Showing the total up front would answer the question the
  // animation exists to ask.
  // Stamped so this landing can tell whether the tray is still its own. If you
  // rolled while someone else's dice were in the air, your throw took the tray
  // and this timer must not overwrite your total when it fires.
  const claim = {};
  state.remoteClaim = claim;

  const land = () => {
    if (state.remoteClaim !== claim) return;
    delete $('total').dataset.rolling;
    delete $('total').dataset.idle;
    // Render the peer's result through the same formatters as your own. Guarded
    // because the summary crossed the wire: a malformed one must not wedge the
    // tray, so it falls back to a plain line.
    try {
      setTotal(resultHeadline(result));
      $('breakdown').textContent = `${roll.name} · ${resultDetail(result)}`;
    } catch {
      setTotal({ kind: 'number', text: result.total != null ? String(result.total) : '—' });
      $('breakdown').textContent = `${roll.name} · ${result.notation}`;
    }
  };

  // Same thresholds as a local roll: thrown when there are few enough to follow,
  // spun in place when there are not.
  const mode = flat.length <= THROW_LIMIT ? 'throw' : 'spin';

  if (mode === 'throw') {
    for (const d of state.dice) {
      d.homeX = d.x;
      d.homeY = d.y;
      const fromLeft = Math.random() < 0.5;
      d.x = fromLeft ? state.bounds.left + 12 : state.bounds.right - 12;
      d.y = state.bounds.top + 12 + Math.random() * 30;
      d.throwWith((d.homeX - d.x) * 2.4, (d.homeY - d.y) * 2.4);
    }
  } else {
    state.dice.forEach((d, i) => d.spinInPlace(i / state.dice.length));
  }

  // Claimed for the length of the flight so a second remote roll arriving
  // mid-animation does not reset the tray under the first, and so your own
  // throw is not interrupted by someone else's.
  $('total').dataset.rolling = '1';
  $('breakdown').textContent = `${roll.name} is rolling…`;
  setTimeout(land, (mode === 'throw' ? 620 : 700) + rerollDelay(flat));

  // No vibration. A phone buzzing for every roll at a busy table is an
  // irritation, and it is the one cue that should stay reserved for your own.
  $('wordmark').dataset.faded = '1';
  hideHint();
}

function showRoster(members) {
  const list = $('roomRoster');
  list.replaceChildren();

  // You are not in the roster — the relay's count includes you but the presence
  // table is built from other people's hellos, so the list is "who else".
  if (!members.length) {
    const empty = document.createElement('li');
    empty.className = 'room-roster-empty';
    empty.textContent = 'Waiting for others to join.';
    list.append(empty);
    return;
  }

  for (const m of members) {
    const li = document.createElement('li');
    // textContent, always: this string came off the wire.
    li.textContent = m.name;
    list.append(li);
  }
}

// The state line and the header flag are the two places the app admits whether
// rolls are leaving the device. They must never disagree.
function showRoomState(next, info) {
  const live = next === 'live';
  roomFlag.hidden = !live;
  roomToggle.setAttribute('aria-label',
    live ? 'Sharing rolls — open room' : 'Share rolls with a room');
  roomToggle.dataset.live = live ? '1' : '';
  if (!live) delete roomToggle.dataset.live;

  $('roomSetup').hidden = live;
  $('roomLive').hidden = !live;

  // Whichever way you got here — created the room or typed someone's
  // passphrase — the live view shows it, so it can be read aloud again without
  // leaving and rejoining.
  if (live) $('roomPhraseLive').textContent = roomPhrase || '';

  const line = $('roomState');
  if (next === 'live') {
    const others = (info.n || 1) - 1;
    line.textContent = others > 0
      ? `Connected. ${others} other ${others === 1 ? 'person' : 'people'} here.`
      : 'Connected. Waiting for others.';
  } else if (next === 'connecting') {
    line.textContent = 'Connecting…';
  } else if (next === 'retrying') {
    // Deliberately not an alarm. Nothing is broken from where the user sits.
    line.textContent = 'Reconnecting — rolls are local for now.';
  } else if (next === 'failed') {
    line.textContent = info.detail || 'Could not connect. Rolls stay on this device.';
  } else {
    line.textContent = '';
    // Cleared only when the room actually ended — an expiry, a refusal — and
    // not on every 'offline'.
    //
    // join() leaves the previous room before starting, so a plain 'offline'
    // with no code arrives in the middle of joining: the sequence is
    // offline -> connecting -> live. Clearing here unconditionally wiped the
    // passphrase that enterRoom had just stored, and the live view then
    // rendered "The passphrase" above nothing at all. The copy buttons still
    // worked, because the promise put it back a moment later, which is what
    // made it look like a display bug rather than a lifecycle one.
    if (info && info.code) roomPhrase = null;
  }
}

function showRoomNotice(text) {
  $('roomState').textContent = text;
}

function openRoom() {
  setHelp(false);
  closeSheet();
  closeDial();
  closeHistory();
  closeMode();
  anchorPop(roomPanel, roomToggle);
  roomPanel.hidden = false;
  roomToggle.setAttribute('aria-expanded', 'true');
  if (!roomNameField.value) roomNameField.value = roomLink.name;
  if (!RELAY_URL) {
    $('roomState').textContent = 'No relay is configured for this copy, so rolls stay on this device.';
    $('roomCreate').disabled = true;
    $('roomJoin').disabled = true;
  }
  hideHint();
}

function closeRoom() {
  roomPanel.hidden = true;
  roomToggle.setAttribute('aria-expanded', 'false');
}

roomToggle.addEventListener('click', () => {
  if (roomPanel.hidden) openRoom();
  else closeRoom();
});

$('roomCreate').addEventListener('click', () => {
  roomPhrase = generatePassphrase();
  $('roomPhrase').textContent = roomPhrase;
  $('roomMade').hidden = false;
  // Joining your own new room is what makes the link live for whoever you send
  // it to; a passphrase nobody has joined is just a string.
  enterRoom(roomPhrase);
});

$('roomJoinForm').addEventListener('submit', e => {
  e.preventDefault();
  const phrase = $('roomPhraseInput').value.trim();
  if (phrase) enterRoom(phrase);
});

// The one async path in the room UI, and it is deliberately nowhere near a roll.
// Deriving the key takes about a third of a second on a Pi, so the button says
// what is happening rather than appearing to have missed the tap.
function enterRoom(phrase) {
  $('roomState').textContent = 'Deriving the room key…';
  roomLink.setName(roomNameField.value || roomLink.name);
  // Held before the join resolves, not after. The connection can reach 'live'
  // while that promise is still settling, and setRoomState reads this to fill
  // the live view — so assigning it in the callback left the passphrase blank
  // on exactly the fast connections it should have worked best on.
  roomPhrase = normalizePassphrase(phrase);
  roomLink.join(phrase).then(joined => {
    roomPhrase = joined.passphrase;
    $('roomPhraseInput').value = '';
    roomNameField.value = roomLink.name;
  }).catch(err => {
    roomPhrase = null;
    // A failure here costs sharing and nothing else, so it is reported in the
    // panel rather than the app's error line.
    $('roomState').textContent = `${err.message}. Rolls stay on this device.`;
  });
}

$('roomLeave').addEventListener('click', () => {
  roomLink.leave();
  roomPhrase = null;
  $('roomMade').hidden = true;
  $('roomPhraseLive').textContent = '';
  $('roomState').textContent = 'Left the room. Rolls are local again.';
});

roomNameField.addEventListener('change', () => {
  roomLink.setName(roomNameField.value);
  // setName rejects a name that trims to nothing, so the field is put back to
  // whatever was actually kept rather than left showing a name nobody has.
  roomNameField.value = roomLink.name;
});

// Copy buttons, in both the created-room block and the connected block. Same
// two actions either side of joining, so they share their handlers.
function copyFeedback(button, text) {
  if (!text) return;
  const original = button.textContent;
  navigator.clipboard.writeText(text)
    .then(() => { button.textContent = 'Copied'; })
    .catch(() => { button.textContent = 'Copy failed'; })
    .then(() => setTimeout(() => { button.textContent = original; }, 1400));
}

const shareLink = () => roomPhrase
  ? location.origin + location.pathname + '#' + roomPhrase
  : '';

for (const id of ['roomCopyLink', 'roomCopyLink2']) {
  $(id).addEventListener('click', e => copyFeedback(e.currentTarget, shareLink()));
}

// Tapping the passphrase copies it.
//
// A button labelled "Copy words" sitting under words you cannot copy by
// tapping is the wrong way round — the words are the thing, and the obvious
// gesture should be the one that works. They stay selectable, because reading
// a passphrase aloud and dragging across it are both real ways to use it.
//
// The pulse is the whole confirmation. Swapping the words for "Copied" would
// hide the one thing on screen worth looking at, and the panel is short of
// room as it is.
function copyPhrase(el) {
  if (!roomPhrase) return;
  navigator.clipboard.writeText(roomPhrase).then(() => {
    el.dataset.copied = '1';
    // Removed on a timer rather than on animationend: two taps inside the
    // window would otherwise leave the attribute set with no animation
    // running, and the next tap would do nothing visible at all.
    setTimeout(() => { delete el.dataset.copied; }, 700);
  }).catch(() => {
    // Clipboard access can be refused outright, and there is nothing useful to
    // say about it while the words are already on screen to be read.
  });
}

for (const id of ['roomPhrase', 'roomPhraseLive']) {
  const el = $(id);
  el.addEventListener('click', () => copyPhrase(el));
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    copyPhrase(el);
  });
}

// A link with a passphrase in the fragment joins the room. Tapping a link
// someone sent you *is* the decision to join, and an earlier version that only
// prefilled the field and waited for a second tap read as the link not working.
//
// The panel opens with it, so what happened is visible and leaving is one tap
// away rather than something to work out.
const fromLink = parsePassphraseFromHash();
if (fromLink) {
  // parsePassphraseFromHash has already cleared the fragment, inside a try
  // because some embeddings forbid replaceState. Repeating it here unguarded
  // threw in exactly those embeddings — and because it ran first, the throw
  // took the two lines below with it: no panel, no join, and a link that looked
  // like it did nothing at all.
  openRoom();
  enterRoom(fromLink);
}

// A branded slug (/vtm, /fate, /genesys) opens the app already in that system.
// url:false because the address is already the slug — we are reading it, not
// writing it. Runs after every control exists, so setSystem can touch them all.
setSystem(systemFromPath(), { url: false });

// Back/forward moves between the systems the address has visited.
window.addEventListener('popstate', () => setSystem(systemFromPath(), { url: false }));
