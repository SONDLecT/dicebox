import { roll, describe } from './dice.js';
import { Die, Surface, separate, beginFrame } from './render.js';
import { createRoom, parsePassphraseFromHash } from './room.js';
import { generatePassphrase, normalizePassphrase } from './room-crypto.js';
import { rollV5, rollRouse, describeV5, v5Headline, detectSystem, v5Face, parseV5 } from './system-dice.js';
import { rollFate, describeFate, fateHeadline, fateFace, parseFate } from './system-dice.js';
import { rollGenesys, describeGenesys, genesysHeadline, parseGenesys } from './system-dice.js';
import { rollDaggerheart, describeDaggerheart, daggerheartHeadline, parseDaggerheart } from './system-dice.js';
import { rollCthulhuTech, describeCthulhuTech, cthulhutechHeadline, parseCthulhuTech } from './system-dice.js';
import { rollYearZero, describeYearZero, yearzeroHeadline, parseYearZero, pushYearZero } from './system-dice.js';
import { rollBladeRunner, describeBladeRunner, bladeRunnerHeadline, parseBladeRunner, pushBladeRunner } from './system-dice.js';
import { rollTwilight, describeTwilight, twilightHeadline, parseTwilight, pushTwilight } from './system-dice.js';
import { rollMothership, describeMothership, mothershipHeadline, parseMothership, resolveMothershipStress } from './system-dice.js';
import { rollCallOfCthulhu, describeCallOfCthulhu, callOfCthulhuHeadline, parseCallOfCthulhu } from './system-dice.js';
import { rollDeltaGreen, describeDeltaGreen, deltaGreenHeadline, parseDeltaGreen } from './system-dice.js';
import { rollIronsworn, describeIronsworn, ironswornHeadline, parseIronsworn } from './system-dice.js';
import { rollOracle, oracleReading, oracleSlug, findOracleBySlug, oracleTableList } from './oracle-dice.js';
import { parseCards, newDeckOrder, summarizeCards, cardsHeadline, describeCards, parseTarot, summarizeTarot, tarotHeadline, describeTarot, parseNapoletane, parseHanafuda, parseUtagaruta } from './system-dice.js';
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

// Dungeon Crawl Classics rolls the full "dice chain": your action die sits at a
// position on it and effects (Mighty Deeds, luck, spellburn) shift it up or down
// a step. Every die on it already renders — this is the numeric roller trimmed
// to the chain, plus a tracker for where you are. No d? needed: it is all here.
const DCC_CHAIN = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30];
// The strip also carries a d100: not on the chain (the ◄/► tracker), but the
// Judge rolls it constantly for crit/fumble/corruption/mercurial-magic tables.
const DCC_STRIP = [...DCC_CHAIN, 100];
const DCC_SET = new Set(DCC_STRIP);
// One colour per die, after a physical DCC set — the chain reads as a rainbow so
// you can pick your die at a glance. Saturated enough to hold on both themes,
// both on the chain buttons and on the rolled dice. d100 gets a quieter grey to
// set it apart as the off-chain utility die.
const DCC_COLORS = {
  3: '#4E9E52', 4: '#70737C', 5: '#9463B0', 6: '#C2503F', 7: '#8FA6B4',
  8: '#D6A93A', 10: '#DC8FB4', 12: '#3F86D6', 14: '#DB7430', 16: '#4059B5',
  20: '#B9B3A2', 24: '#CE4C40', 30: '#E6C63C', 100: '#8A8594',
};
// The grey dice — d4, d20, d100 — have no hue to spend as the action die, so
// they take the theme ink instead (bright white in dark, bold black in light).
// Kept in sync with the matching [data-sides] rule in style.css.
const DCC_INK_DICE = new Set([4, 20, 100]);

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
  // A push held between its two beats: the rerollable dice are picked up on the
  // tray, and the next tap throws them to this pre-decided result. pushKept holds
  // the locked 6s/1s so they can be unlocked when the throw lands.
  pendingPush: null,
  pushKept: null,
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
  // Cards are rasterised per theme; without this they keep the old ink until
  // the next draw. Preload the new theme's images, then let the frame redraw.
  if (uiSystem === 'cards' && cardArt) {
    const ids = [...new Set(state.dice.filter(d => d.isCard).map(d => (d.isStack || d.isDiscard ? 'back' : d.id)))];
    if (deckState.pile.length) ids.push(deckState.pile[deckState.pile.length - 1]);
    Promise.all(ids.map(id => cardImage(id).ready)).then(dropIdleCache);
  }
  if (uiSystem === 'tarot' && tarotArt) {
    const ids = [...new Set(state.dice.filter(d => d.isCard).map(d => (d.isStack || d.isDiscard ? 'back' : d.id)))];
    if (tarotState.pile.length) ids.push(tarotState.pile[tarotState.pile.length - 1].id);
    Promise.all(ids.map(id => tarotImage(id).ready)).then(dropIdleCache);
  }
  if (uiSystem === 'napoletane' && napArt) {
    const ids = [...new Set(state.dice.filter(d => d.isCard).map(d => (d.isStack || d.isDiscard ? 'back' : d.id)))];
    if (napState.pile.length) ids.push(napState.pile[napState.pile.length - 1]);
    Promise.all(ids.map(id => napImage(id).ready)).then(dropIdleCache);
  }
  if (uiSystem === 'utagaruta' && utaArt) {
    const ids = [...new Set(state.dice.filter(d => d.isCard).map(d => (d.isStack || d.isDiscard ? 'back' : d.id)))];
    if (utaState.pile.length) ids.push(utaState.pile[utaState.pile.length - 1]);
    Promise.all(ids.map(id => utaImage(id).ready)).then(dropIdleCache);
  }
  if (uiSystem === 'hanafuda' && hanaArt) {
    const ids = [...new Set(state.dice.filter(d => d.isCard).map(d => (d.isStack || d.isDiscard ? 'back' : d.id)))];
    if (hanaState.pile.length) ids.push(hanaState.pile[hanaState.pile.length - 1]);
    Promise.all(ids.map(id => hanaImage(id).ready)).then(dropIdleCache);
  }
  // A card held up for a look, or a discard fanned open, retints too.
  retintCardOverlays();
  syncThemeLabel();
  updateThemeColor();
  // Re-apply the active system's palette so its dark/light pair follows the
  // toggle instead of being frozen at whichever mode was active on roll.
  applySystemTheme(uiSystem);
  recolorDccTray();
});

systemDark.addEventListener('change', () => {
  if (document.documentElement.dataset.theme) return; // pinned by choice
  syncThemeLabel();
  updateThemeColor();
  // A system palette is written as inline custom properties, so it overrides the
  // stylesheet's own dark rules and cannot follow the OS on its own.
  applySystemTheme(uiSystem);
  recolorDccTray();
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
  // Year Zero Engine — a muted survival olive on gunmetal, broad enough for the
  // family (Mutant, Forbidden Lands, Vaesen, Coriolis). The dice carry their
  // Base/Skill/Gear colours (below); the chrome stays neutral with an olive readout.
  yearzero: {
    dark: {
      '--paper': '#0E0F0C', '--face': '#181A14', '--line': '#DEE0D6', '--muted': '#6E7062',
      '--hair': '#262820', '--accent': '#8FA05C', '--danger': '#D8685F',
    },
    light: {
      '--paper': '#ECEDE6', '--face': '#F7F8F3', '--line': '#1A1C15', '--muted': '#71736A',
      '--hair': '#D6D8CE', '--accent': '#5E6E32', '--danger': '#8C3A2E',
    },
  },
  // Alien — industrial amber on gunmetal, the warning-light glow of Mother. The
  // dice carry their Base/Skill/Stress colours (below); the chrome stays neutral
  // with an amber readout.
  alien: {
    dark: {
      '--paper': '#0D0F10', '--face': '#171A1C', '--line': '#DDE0E2', '--muted': '#6B7075',
      '--hair': '#252A2D', '--accent': '#D9922E', '--danger': '#D8685F',
    },
    light: {
      '--paper': '#ECEEEF', '--face': '#F7F8F9', '--line': '#1A1D1F', '--muted': '#727679',
      '--hair': '#D5D8DA', '--accent': '#9A5E14', '--danger': '#8C3A2E',
    },
  },
  // Blade Runner — neon-noir: a cold rain-slick near-black under a teal neon
  // readout. The step dice carry their own colours (below).
  bladerunner: {
    dark: {
      '--paper': '#080A0D', '--face': '#10151B', '--line': '#D7E2E6', '--muted': '#63707A',
      '--hair': '#1B2530', '--accent': '#38C6C6', '--danger': '#E0685F',
    },
    light: {
      '--paper': '#E9EDEF', '--face': '#F5F8F9', '--line': '#14191E', '--muted': '#6B767E',
      '--hair': '#D2DADE', '--accent': '#1B8C93', '--danger': '#8C3A2E',
    },
  },
  // Twilight: 2000 — worn military olive-drab and rust, the fallout-lit gloom of
  // a war that never ended. The step dice and tan ammo dice carry their colours.
  twilight: {
    dark: {
      '--paper': '#0E0F0B', '--face': '#1A1C14', '--line': '#DEDFD2', '--muted': '#6C6E5E',
      '--hair': '#262820', '--accent': '#B08A3E', '--danger': '#D8685F',
    },
    light: {
      '--paper': '#ECECE3', '--face': '#F7F7F1', '--line': '#191A12', '--muted': '#70715F',
      '--hair': '#D6D6C8', '--accent': '#7A5E22', '--danger': '#8C3A2E',
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
  // Tarot — candle-lit violet: deep midnight indigo under parchment, the
  // accent a soft mystic violet against the felt green next door in Cards.
  tarot: {
    dark: {
      '--paper': '#0D0B14', '--face': '#16131F', '--line': '#E0DCE8', '--muted': '#77708C',
      '--hair': '#241F33', '--accent': '#8B76D6', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#EAE7F0', '--face': '#F6F4FA', '--line': '#1A1524', '--muted': '#665E7D',
      '--hair': '#D3CDE0', '--accent': '#5D48B5', '--danger': '#8C3A2E',
    },
  },
  // Napoletane — azzurro: the sky-and-bay cyan of Naples itself, bright where
  // Star Wars' steel blue is muted, over a deep harbour-water dark.
  utagaruta: {
    dark: {
      '--paper': '#131108', '--face': '#1D1A0E', '--line': '#EEE7D2', '--muted': '#95875D',
      '--hair': '#2E2914', '--accent': '#C9A227', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#F1EBDA', '--face': '#F9F5E8', '--line': '#231D0C', '--muted': '#77683C',
      '--hair': '#E0D6B8', '--accent': '#8A6D1F', '--danger': '#8C3A2E',
    },
  },
  hanafuda: {
    dark: {
      '--paper': '#120D0C', '--face': '#1C1311', '--line': '#EFE0D6', '--muted': '#93756A',
      '--hair': '#2E1D19', '--accent': '#E8483B', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#F2E9E2', '--face': '#FAF4EE', '--line': '#26140F', '--muted': '#7C5A4F',
      '--hair': '#E2CFC4', '--accent': '#B5311F', '--danger': '#8C3A2E',
    },
  },
  napoletane: {
    dark: {
      '--paper': '#0A1116', '--face': '#101B23', '--line': '#DCE6EC', '--muted': '#64808F',
      '--hair': '#1B2B36', '--accent': '#12A0D7', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E4EDF2', '--face': '#F2F7FA', '--line': '#10202A', '--muted': '#4F6C7C',
      '--hair': '#C8DAE4', '--accent': '#0C7CB0', '--danger': '#8C3A2E',
    },
  },
  // Mothership — a hazard-label palette: reactor-warning chartreuse over cold
  // gunmetal steel, the industrial radiation-caution look that sets it apart from
  // the four gold systems. The acid green is the constant; only the steel
  // neutrals flip for light, where the accent deepens to hold WCAG AA contrast.
  callofcthulhu: {
    dark: {
      '--paper': '#0C0F0B', '--face': '#151A12', '--line': '#DDE3D6', '--muted': '#818B77',
      '--hair': '#232A1C', '--accent': '#7FA05A', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E7EAE2', '--face': '#F4F6EF', '--line': '#1C2216', '--muted': '#5C6650',
      '--hair': '#D3D8C7', '--accent': '#5E7C3D', '--danger': '#9E3529',
    },
  },
  deltagreen: {
    dark: {
      '--paper': '#080D0A', '--face': '#101713', '--line': '#D6E0D9', '--muted': '#77887E',
      '--hair': '#1A2620', '--accent': '#4E9068', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E2E8E4', '--face': '#EFF4F0', '--line': '#132019', '--muted': '#516058',
      '--hair': '#C8D3CB', '--accent': '#2F6B49', '--danger': '#9E3529',
    },
  },
  ironsworn: {
    dark: {
      '--paper': '#090C0F', '--face': '#121820', '--line': '#D7DEE4', '--muted': '#79838C',
      '--hair': '#1B232B', '--accent': '#6E8B9A', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E3E7EB', '--face': '#EFF3F6', '--line': '#141C24', '--muted': '#545E66',
      '--hair': '#C9D1D8', '--accent': '#4A6B7C', '--danger': '#9E3529',
    },
  },
  starforged: {
    dark: {
      '--paper': '#0A0C12', '--face': '#141826', '--line': '#DAD8E8', '--muted': '#807E96',
      '--hair': '#20233A', '--accent': '#8E86C9', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E7E6EE', '--face': '#F1F0F7', '--line': '#181628', '--muted': '#56546A',
      '--hair': '#CFCDDD', '--accent': '#5E56A0', '--danger': '#9E3529',
    },
  },
  dcc: {
    dark: {
      '--paper': '#0E0A08', '--face': '#1A1310', '--line': '#E7DAD0', '--muted': '#948578',
      '--hair': '#2A1E18', '--accent': '#C36A3C', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#EBE4DD', '--face': '#F5EFE8', '--line': '#241813', '--muted': '#6A5A4E',
      '--hair': '#D8CCBF', '--accent': '#9A4E24', '--danger': '#9E3529',
    },
  },
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

// Year Zero dice, after the physical pool: yellow Base, green Skill, black Gear,
// and the Alien Stress die in a warning orange to read as the panic risk it is.
const YZ_COLORS = {
  base: '#D9A441',
  skill: '#5BA860',
  gear: '#8C919A',
  stress: '#D86A3A',
};

// Blade Runner step dice: the Attribute die takes the neon teal, the Skill die a
// warm amber, and an advantage die a cool green.
const BR_COLORS = {
  attribute: '#38C6C6',
  skill: '#D9A441',
  advantage: '#5BA860',
};

// Twilight: 2000 — olive Attribute, amber Skill, and the tan of the physical
// ammo dice.
const T2K_COLORS = {
  attribute: '#9AA36A',
  skill: '#D9A441',
  ammo: '#C8B48A',
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
    const view = state.dice[0].view || cardsView;
    // Only cards actually resting on the table count. A resize firing during a
    // shuffle or deal would otherwise count the in-flight sweep sprites as a
    // hand and park the deck small in the corner as though one were out.
    const cards = state.dice.filter(d => d.isCard && !d.isStack && !d.isDiscard && !d.gone && d.phase === 'idle');
    const { stack, slots, discard } = deckLayout(cards.length, view);
    for (const d of state.dice) {
      if (d.isStack) { d.x = stack.x; d.y = stack.y; d.size = stack.w; }
      if (d.isDiscard) { d.x = discard.x; d.y = discard.y; d.size = discard.w; }
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
        // Year Zero: which colour of die (base/skill/gear/stress).
        yzType: d.type,
      });
    }
  }
  return flat;
}

// Turn the paint list into tray dice, stamping each with its system's face and
// colour so the renderer stays system-agnostic. `remote` marks a peer's dice so
// haptics fire only on your own throws; they look identical either way.
function buildTrayDice(flat, result, { remote = false } = {}) {
  let crownedMarked = false;
  const dccT = uiSystem === 'dcc' ? theme() : null;
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
    // DCC (numeric rolls in the dice-chain mode): the action die carries the
    // emphasis — its chain hue, or the theme ink for the grey dice — while every
    // other die dims to the muted tone, so the action die is unmistakable whatever
    // its colour, on both themes.
    if (dccT && DCC_COLORS[f.sides]) {
      if (!crownedMarked && f.sides === dccCrown) {
        die.genColor = DCC_INK_DICE.has(f.sides) ? dccT.line : DCC_COLORS[f.sides];
        crownedMarked = true;
      } else {
        die.genColor = dccT.muted;
      }
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
    if (sys === 'tarot') { dealFromTarotNotation(notation); return; }
    if (sys === 'napoletane') { dealFromNapNotation(notation); return; }
    if (sys === 'hanafuda') { dealFromHanaNotation(notation); return; }
    if (sys === 'utagaruta') { dealFromUtaNotation(notation); return; }
    if (sys === 'oracle') { rollOracleFromNotation(notation); return; }
    result = sys === 'v5' ? rollV5(notation)
      : sys === 'fate' ? rollFate(notation)
      : sys === 'genesys' ? rollGenesys(notation)
      : sys === 'daggerheart' ? rollDaggerheart(notation)
      : sys === 'cthulhutech' ? rollCthulhuTech(notation)
      : sys === 'yearzero' ? rollYearZero(notation)
      : sys === 'bladerunner' ? rollBladeRunner(notation)
      : sys === 'twilight' ? rollTwilight(notation)
      : sys === 'starwars' ? rollStarWars(notation)
      : sys === 'onering' ? rollOneRing(notation)
      : sys === 'pbta' ? rollPbta(notation)
      : sys === 'mist' ? rollMist(notation)
      : sys === 'mothership' ? rollMothership(notation)
      : sys === 'callofcthulhu' ? rollCallOfCthulhu(notation)
      : sys === 'deltagreen' ? rollDeltaGreen(notation)
      : sys === 'ironsworn' ? rollIronsworn(notation)
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

  throwResult(result);
}

// Present a computed result on the tray: claim it, build and place the dice, and
// throw or spin them (or settle instantly for an empty/huge pool), finishing into
// the readout and log when they land. Shared by the dice engines and the oracle
// roller, so an oracle draw tumbles its d100 exactly like any other roll instead
// of silently swapping text.
function throwResult(result, { writeField = true } = {}) {
  state.last = result;
  state.pendingPush = null; state.pushKept = null;   // a fresh throw cancels any half-done push
  // Quick one-off rolls (an oracle draw, a progress roll) leave the field on the
  // mode's primary expression so the Roll button keeps doing the action roll;
  // typed and dice-engine rolls write themselves in as the current expression.
  if (writeField) $('notation').value = result.notation;

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
  if (result.system === 'yearzero') return yearzeroHeadline(result);
  if (result.system === 'bladerunner') return bladeRunnerHeadline(result);
  if (result.system === 'twilight') return twilightHeadline(result);
  if (result.system === 'starwars') return starWarsHeadline(result);
  if (result.system === 'onering') return oneRingHeadline(result);
  if (result.system === 'pbta' || result.system === 'mist') return twod6Headline(result);
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
function resultDetail(result) {
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
  if (result.system === 'utagaruta') return describeUta(result);
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
  updateYzPush();
  updateBrPush();
  updateT2kPush();
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
  if (yzFamily(typedSystem)) { syncYzFromField(); return; }
  if (typedSystem === 'bladerunner') { syncBrFromField(); return; }
  if (typedSystem === 'twilight') { syncT2kFromField(); return; }
  if (typedSystem === 'onering') { syncTorFromField(); return; }
  if (typedSystem === 'pbta') { pbtaCtl.fromField(); return; }
  if (typedSystem === 'mist') { mistCtl.fromField(); return; }
  if (typedSystem === 'mothership') { syncMsFromField(); return; }
  if (typedSystem === 'callofcthulhu') { syncCocFromField(); return; }
  if (typedSystem === 'deltagreen') { syncDgFromField(); return; }
  if (typedSystem === 'ironsworn') { syncIronFromField(); return; }
  // An oracle slug is field-only (no picker to keep in step); leave it be so the
  // active mode's controls are not torn down by the numeric parser.
  if (typedSystem === 'oracle') return;
  if (typedSystem === 'cards') { syncCardsFromField(); return; }
  if (typedSystem === 'tarot') { syncTarotFromField(); return; }
  if (typedSystem === 'napoletane') { syncNapFromField(); return; }
  if (typedSystem === 'hanafuda') { syncHanaFromField(); return; }
  if (typedSystem === 'utagaruta') { syncUtaFromField(); return; }
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
  tarot: { badge: 'Tarot' },
  napoletane: { badge: 'Napoletane' },
  hanafuda: { badge: 'Hanafuda' },
  utagaruta: { badge: 'Uta-garuta' },
  v5: { badge: 'VtM V5' },
  fate: { badge: 'Fate' },
  genesys: { badge: 'Genesys' },
  daggerheart: { badge: 'DH' },
  cthulhutech: { badge: 'CTech 2e' },
  yearzero: { badge: 'Year Zero' },
  alien: { badge: 'Alien' },
  bladerunner: { badge: 'BRRPG' },
  twilight: { badge: 'T2K 4e' },
  starwars: { badge: 'SWRPG' },
  onering: { badge: 'TOR 2e' },
  pbta: { badge: 'PbtA' },
  mist: { badge: 'Mist' },
  mothership: { badge: 'MoSh 1e' },
  callofcthulhu: { badge: 'CoC 7e' },
  deltagreen: { badge: 'Delta Green' },
  ironsworn: { badge: 'Ironsworn' },
  starforged: { badge: 'Starforged' },
  dcc: { badge: 'DCC' },
};

// Empty-tray copy. Most modes build a pool by tapping dice, so the default
// speaks of dice. PbtA and Mist have no pool — the roll is always 2d6 and the
// only input is a modifier — so their prompts point at that instead, and Mist
// calls its modifier "Power" the way the game does.
const DEFAULT_HINT = { idle: 'Pick dice or type a roll', placeholder: 'Tap dice above, or type 3d6+2' };
const SYSTEM_HINTS = {
  pbta: { idle: 'Set a modifier, then roll 2d6', placeholder: 'Set a modifier, or type pbta:+2' },
  mist: { idle: 'Set your Power, then roll 2d6', placeholder: 'Set your Power, or type mist:+1' },
  mothership: { idle: 'Roll d100 — set a target to resolve it, or let the table judge', placeholder: 'Roll, or type ms:c@35' },
  callofcthulhu: { idle: 'Roll d100 under your skill — set the skill, or let the table judge', placeholder: 'Roll, or type coc:60' },
  deltagreen: { idle: 'Roll d100 under your target — set it, or let the table judge', placeholder: 'Roll, or type dg:50' },
  ironsworn: { idle: 'Tap a roll — Action, Progress, or an oracle', placeholder: 'Roll, or type iron:+2' },
  starforged: { idle: 'Tap a roll — Action, Progress, or an oracle', placeholder: 'Roll, or type iron:+2' },
  dcc: { idle: '', placeholder: 'Tap a die, or type d16' },
  yearzero: { idle: 'Build a d6 pool — every 6 is a success', placeholder: 'Tap the dice, or type yz:5b3s2g' },
  alien: { idle: 'Build a d6 pool — every 6 is a success', placeholder: 'Tap the dice, or type yz:5b1x' },
  bladerunner: { idle: 'Set your Attribute and Skill dice, then roll', placeholder: 'Set the dice, or type br:12,8' },
  twilight: { idle: 'Set your dice and ammo, then roll', placeholder: 'Set the dice, or type t2k:12,8,3' },
  cards: { idle: 'Tap the deck to draw', placeholder: 'Tap the deck, or type deck:3' },
  tarot: { idle: 'Tap the deck to draw', placeholder: 'Tap the deck, or type tarot:3' },
  napoletane: { idle: 'Tocca il mazzo per pescare', placeholder: 'Tocca il mazzo, o scrivi nap:3' },
  hanafuda: { idle: '山札をタップして引く — tap the deck to draw', placeholder: 'Tap the deck, or type hana:2' },
  utagaruta: { idle: 'Draw a poem — a hundred await', placeholder: 'Tap the deck, or type uta:1' },
};
function systemHint(system) { return SYSTEM_HINTS[system] || DEFAULT_HINT; }

// Permanent slugs, so a link opens Dicebox already in a system. The Worker
// rewrites these paths to the app shell; numeric is the bare root. Kept branded
// (/vtm rather than /v5) since the URL is the shareable name.
// Reading accepts the shorthand slugs and every pre-rename alias; writing (the
// URL the app puts in the bar) always uses the canonical shorthand, edition
// included, matching the picker labels.
const SLUG_TO_SYSTEM = {
  cards: 'cards', tarot: 'tarot', italiane: 'napoletane', napoletane: 'napoletane', scopa: 'napoletane', hanafuda: 'hanafuda', koikoi: 'hanafuda', hana: 'hanafuda', utagaruta: 'utagaruta', karuta: 'utagaruta', hyakunin: 'utagaruta', vtmv5: 'v5', fate: 'fate', genesys: 'genesys', dh: 'daggerheart', ctech2e: 'cthulhutech',
  swrpg: 'starwars', tor2e: 'onering', pbta: 'pbta', mist: 'mist', mosh1e: 'mothership',
  v5: 'v5', vtm: 'v5', daggerheart: 'daggerheart', cthulhutech: 'cthulhutech', ctech: 'cthulhutech',
  yz: 'yearzero', yearzero: 'yearzero', forbiddenlands: 'yearzero', vaesen: 'yearzero', coriolis: 'yearzero', mutant: 'yearzero', tales: 'yearzero',
  alien: 'alien',
  brrpg: 'bladerunner', bladerunner: 'bladerunner',
  t2k: 'twilight', twilight: 'twilight', twilight2000: 'twilight',
  force: 'starwars', feat: 'onering', tor: 'onering', mothership: 'mothership', mosh: 'mothership', coc: 'callofcthulhu', callofcthulhu: 'callofcthulhu', cthulhu: 'callofcthulhu', dg: 'deltagreen', deltagreen: 'deltagreen',
  ironsworn: 'ironsworn', iron: 'ironsworn', starforged: 'starforged', sf: 'starforged', dcc: 'dcc',
};
const SYSTEM_TO_SLUG = { cards: 'cards', tarot: 'tarot', napoletane: 'napoletane', hanafuda: 'hanafuda', utagaruta: 'utagaruta', v5: 'vtmv5', fate: 'fate', genesys: 'genesys', daggerheart: 'dh', cthulhutech: 'ctech2e', yearzero: 'yz', alien: 'alien', bladerunner: 'brrpg', twilight: 't2k', starwars: 'swrpg', onering: 'tor2e', pbta: 'pbta', mist: 'mist', mothership: 'mosh1e', callofcthulhu: 'coc', deltagreen: 'dg', ironsworn: 'ironsworn', starforged: 'starforged', dcc: 'dcc' };

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
const cocPicker = $('cocPicker');
const dgPicker = $('dgPicker');
const ironPicker = $('ironPicker');
// Numeric's strip lives after the final signature picker in the DOM. Daggerheart
// and Mothership both show their own controls above ordinary damage dice; hidden
// intervening pickers do not affect layout in either mode.
msPicker.after?.(numPicker);

function setSystem(system, { roll = false, url = true } = {}) {
  if (!SYSTEMS[system]) system = 'numeric';
  const changed = system !== uiSystem;
  uiSystem = system;
  // A card held up for a look — and a discard fanned open — belong to the
  // table they came from.
  if (changed) { closeCardFocus(); closeDiscardPanel(); }

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
  if (system === 'dcc') enterDcc();
  numPicker.classList.toggle('mothership-rail', system === 'mothership');
  msFieldsRow.hidden = system !== 'mothership';
  v5Picker.hidden = system !== 'v5';
  fatePicker.hidden = system !== 'fate';
  // Star Wars reuses the Genesys chip picker; the Force chip only appears there.
  genesysPicker.hidden = system !== 'genesys' && system !== 'starwars';
  genesysPicker.classList.toggle('with-force', system === 'starwars');
  dhPicker.hidden = system !== 'daggerheart';
  ctPicker.hidden = system !== 'cthulhutech';
  // Alien reuses the Year Zero chip picker; the .alien class swaps the Gear chip
  // out for the Stress chip.
  $('yzPicker').hidden = system !== 'yearzero' && system !== 'alien';
  $('yzPicker').classList.toggle('alien', system === 'alien');
  $('brPicker').hidden = system !== 'bladerunner';
  $('t2kPicker').hidden = system !== 'twilight';
  torPicker.hidden = system !== 'onering';
  twod6Picker.hidden = system !== 'pbta' && system !== 'mist';
  msPicker.hidden = system !== 'mothership';
  cocPicker.hidden = system !== 'callofcthulhu';
  dgPicker.hidden = system !== 'deltagreen';
  ironPicker.hidden = system !== 'ironsworn' && system !== 'starforged';
  $('dccPicker').hidden = system !== 'dcc';
  cardsPicker.hidden = system !== 'cards';
  tarotPicker.hidden = system !== 'tarot';
  napPicker.hidden = system !== 'napoletane';
  hanaPicker.hidden = system !== 'hanafuda';
  utaPicker.hidden = system !== 'utagaruta';
  // One action, one name: the entry button IS the draw in the deck modes, so
  // the pickers carry no second Draw button.
  $('rollGo').textContent = system === 'cards' || system === 'tarot' || system === 'napoletane' || system === 'hanafuda' || system === 'utagaruta' ? 'Draw' : 'Roll';
  // The deck's art loads on first entry; the stack appears when it lands. The
  // modules are service-worker-precached, so this works offline too.
  if (system === 'cards') {
    ensureCardArt().then(() => { if (uiSystem === 'cards') syncCardsUI(); });
  }
  if (system === 'tarot') {
    ensureTarotArt().then(() => { if (uiSystem === 'tarot') syncTarotUI(); });
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
  $('helpYearzero').hidden = system !== 'yearzero';
  $('helpAlien').hidden = system !== 'alien';
  $('helpBladerunner').hidden = system !== 'bladerunner';
  $('helpTwilight').hidden = system !== 'twilight';
  $('helpOnering').hidden = system !== 'onering';
  $('helpPbta').hidden = system !== 'pbta';
  $('helpMist').hidden = system !== 'mist';
  $('helpMothership').hidden = system !== 'mothership';
  $('helpCallofcthulhu').hidden = system !== 'callofcthulhu';
  $('helpDeltagreen').hidden = system !== 'deltagreen';
  $('helpIronsworn').hidden = system !== 'ironsworn' && system !== 'starforged';
  $('helpDcc').hidden = system !== 'dcc';
  $('helpCards').hidden = system !== 'cards';
  $('helpTarot').hidden = system !== 'tarot';
  $('helpNapoletane').hidden = system !== 'napoletane';
  $('helpHanafuda').hidden = system !== 'hanafuda';
  $('helpUtagaruta').hidden = system !== 'utagaruta';

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
    resetYearZero();
    resetBladeRunner();
    resetTwilight();
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
    if (system === 'callofcthulhu') $('notation').value = cocNotation();
    if (system === 'deltagreen') $('notation').value = dgNotation();
    if (system === 'ironsworn' || system === 'starforged') $('notation').value = ironNotation();
    if (system === 'cards') $('notation').value = deckNotation();
    if (system === 'tarot') $('notation').value = tarotNotation();
    if (system === 'napoletane') $('notation').value = napNotation();
    if (system === 'hanafuda') $('notation').value = hanaNotation();
    if (system === 'utagaruta') $('notation').value = utaNotation();
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
  // Right-anchored to the button, but never past the left edge of the screen:
  // a wide panel (help is 400px) under a mid-bar button on a narrow phone
  // would otherwise render partly off-screen. Hidden elements have no box, so
  // measure through a visibility flicker when needed.
  const wasHidden = pop.hidden;
  if (wasHidden) { pop.style.visibility = 'hidden'; pop.hidden = false; }
  const w = pop.offsetWidth;
  if (wasHidden) { pop.hidden = true; pop.style.visibility = ''; }
  const right = Math.min(
    Math.max(8, Math.round(window.innerWidth - r.right)),
    Math.max(8, window.innerWidth - w - 8),
  );
  pop.style.right = `${right}px`;
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
  closeCardFocus();
  closeDiscardPanel();
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

// Pool and Hunger are two independent stacks of dice that add together into the
// throw: `pool` is the white pool dice you build for this roll, `hunger` the red
// Hunger dice. Neither replaces the other. Hunger caps at 5 and is the character's
// standing state — it survives a reload and a pool clear the way Mothership's
// Stress does — and 0 means it is not being tracked, where a Rouse check is only
// pass/fail.
const V5_HUNGER_KEY = 'dicebox:v5:hunger';
const v5 = { pool: 0, hunger: 0, difficulty: null };
{
  const saved = Number(store.get(V5_HUNGER_KEY));
  if (Number.isFinite(saved) && saved >= 0 && saved <= 5) v5.hunger = Math.round(saved);
}
const v5PoolFace = $('v5NormalFace');
const v5HungerFace = $('v5HungerFace');
const v5HungerChip = $('v5HungerChip');
const v5HungerVal = $('v5Hunger');
const v5DiffChip = $('v5DiffChip');
const v5DiffVal = $('v5Difficulty');

// Pool and difficulty are this roll's setup and reset with it; Hunger is standing
// state and stays put.
function resetV5() {
  v5.pool = 0;
  v5.difficulty = null;
  syncV5({ writeField: false });
}

// Move the tracked Hunger and persist it. `restage` is skipped mid-roll, when a
// Rouse check is already throwing its own die and the pool must not re-stage.
function setHunger(n, { restage = true } = {}) {
  v5.hunger = Math.max(0, Math.min(5, Math.round(n)));
  store.set(V5_HUNGER_KEY, String(v5.hunger));
  if (restage) syncV5();
  else syncV5Hunger();
}

// Hunger shows in two places that stay in step: the red die in the pool (its
// badge, with CSS reading a level of 0 as empty) and the tracker pill beside
// Difficulty, which reads "—" until Hunger is set.
function syncV5Hunger() {
  v5HungerFace.dataset.count = String(v5.hunger);
  if (v5.hunger > 0) {
    v5HungerVal.textContent = String(v5.hunger); delete v5HungerVal.dataset.unset; v5HungerChip.classList.add('is-set');
  } else {
    v5HungerVal.textContent = '—'; v5HungerVal.dataset.unset = '1'; v5HungerChip.classList.remove('is-set');
  }
}

// The notation is the whole throw, pool + Hunger dice, with the Hunger count noted
// so the receiver can colour them back. An empty throw writes nothing, so the
// readout stays idle rather than showing a "v5:0".
function v5Notation() {
  const total = v5.pool + v5.hunger;
  if (total < 1) return '';
  let s = `v5:${total}`;
  if (v5.hunger > 0) s += `h${v5.hunger}`;
  if (v5.difficulty !== null) s += `@${v5.difficulty}`;
  return s;
}

function syncV5({ writeField = true } = {}) {
  if (v5.pool > 0) v5PoolFace.dataset.count = String(v5.pool); else delete v5PoolFace.dataset.count;
  syncV5Hunger();

  if (v5.difficulty === null) {
    v5DiffVal.textContent = '—'; v5DiffVal.dataset.unset = '1'; v5DiffChip.classList.remove('is-set');
  } else {
    v5DiffVal.textContent = String(v5.difficulty); delete v5DiffVal.dataset.unset; v5DiffChip.classList.add('is-set');
  }

  if (writeField) $('notation').value = v5Notation();
  if (uiSystem === 'v5') stageSystemPool();
}

// The Pool die adds white dice without bound; the Hunger die adds red ones up to
// 5. Neither touches the other's count.
function v5StepPool(by) { v5.pool = Math.max(0, Math.min(v5.pool + by, 100)); syncV5(); }

// Tap a die to add one, hold (or right-click) to remove; a die tapped in the tray
// comes off too.
bindTapHold(v5PoolFace, dir => v5StepPool(dir));
bindTapHold(v5HungerFace, dir => setHunger(v5.hunger + dir));

// The Hunger tracker pill sets the level directly — the way you would after a
// hunt — on the same roller the dice use. 0 reads as untracked ("—").
v5HungerChip.addEventListener('click', () => {
  openNumberDial({
    title: 'Hunger', value: v5.hunger, min: 0, max: 5,
    actionLabel: 'Set Hunger', inputLabel: 'Hunger',
    commit: value => setHunger(value),
  });
});
// Difficulty opens the tactile roller, the one number-picker every system
// shares, with a "Table sets it" release back to unset — the same control as
// the Mothership target and the custom die.
v5DiffChip.addEventListener('click', () => {
  openNumberDial({
    title: 'Difficulty', value: v5.difficulty ?? 3, min: 1, max: 10,
    actionLabel: 'Set Difficulty', inputLabel: 'Difficulty',
    clearLabel: 'Table sets it',
    commit: value => { v5.difficulty = value; syncV5(); },
    onClear: () => { v5.difficulty = null; syncV5(); },
  });
});

// A Rouse check throws a single Hunger die on its own, outside the action pool. If
// Hunger is being tracked (1-5) a failure raises it before the die is shown, so
// the readout can name the new total; untracked (0) it is only pass/fail.
// setHunger runs with restage off so it does not disturb the die already in flight.
$('v5Rouse').addEventListener('click', () => {
  const result = rollRouse();
  const tracked = v5.hunger > 0;
  result.summary.tracked = tracked;
  if (tracked) {
    const before = v5.hunger;
    if (result.summary.hungerGain) setHunger(v5.hunger + result.summary.hungerGain, { restage: false });
    result.summary.hungerAfter = v5.hunger;
    // A failed Rouse at Hunger 5 cannot climb higher, so the readout must not
    // claim it did — that is the moment the Beast is closest, not a tick upward.
    result.summary.hungerRose = v5.hunger > before;
  }
  throwResult(result, { writeField: false });
});

// A `v5:` pool typed into the field drives the controls, so the two never
// disagree about what will roll. Invalid part-typed strings are left alone.
function syncV5FromField() {
  try {
    const { pool, hunger, difficulty } = parseV5($('notation').value);
    // The notation total is pool + Hunger dice, so the white pool is the rest.
    v5.pool = Math.max(0, pool - hunger);
    v5.difficulty = difficulty;
    setHunger(hunger, { restage: false });
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

// ---- Year Zero pool ----
//
// Four die types — Base, Skill, Gear, Stress — built by tapping chips, exactly
// like Genesys. Each keeps a count; the notation is written from them.
// Year Zero and Alien share one engine, pool state, and picker; the mode only
// changes which chips show and whether a push raises Stress.
const yzFamily = s => s === 'yearzero' || s === 'alien';
const YZ_TYPES = [
  { type: 'base', letter: 'b', label: 'Base' },
  { type: 'skill', letter: 's', label: 'Skill' },
  { type: 'gear', letter: 'g', label: 'Gear' },
  { type: 'stress', letter: 'x', label: 'Stress' },
];
const yz = Object.fromEntries(YZ_TYPES.map(t => [t.type, 0]));

function resetYearZero() {
  for (const t of YZ_TYPES) yz[t.type] = 0;
  syncYz({ writeField: false });
}

function yzNotation() {
  const terms = YZ_TYPES.filter(t => yz[t.type] > 0).map(t => `${yz[t.type]}${t.letter}`);
  return terms.length ? `yz:${terms.join('')}` : '';
}

function syncYz({ writeField = true } = {}) {
  for (const t of YZ_TYPES) {
    const chip = $(`yz-${t.type}`);
    const n = yz[t.type];
    if (n > 0) { chip.dataset.count = String(n); chip.setAttribute('aria-pressed', 'true'); }
    else { delete chip.dataset.count; chip.setAttribute('aria-pressed', 'false'); }
  }
  if (writeField) $('notation').value = yzNotation();
  if (yzFamily(uiSystem)) stageSystemPool();
}

function yzStep(type, by) {
  const total = YZ_TYPES.reduce((s, t) => s + yz[t.type], 0);
  yz[type] = Math.max(0, Math.min(yz[type] + by, yz[type] + (100 - total)));
  syncYz();
}

function syncYzFromField() {
  try {
    const pool = parseYearZero($('notation').value);
    for (const t of YZ_TYPES) yz[t.type] = pool[t.type];
    syncYz({ writeField: false });
  } catch { /* mid-type, not yet valid */ }
}

for (const t of YZ_TYPES) {
  bindTapHold($(`yz-${t.type}`), dir => yzStep(t.type, dir));
}

// A push is two beats, the way it feels at the table: pressing Push leaves your
// 6s and 1s on the felt and picks the rest up into your hand (blank, waiting) —
// and in Alien, a fresh Stress die joins them — then a tap on the tray throws
// just that handful. The final result is decided up front; the tap only reveals
// it. A roll may be pushed once.
$('yzPush').addEventListener('click', preparePush);

function preparePush() {
  const last = state.last;
  if (!last || !last.summary || !last.summary.canPush || state.pendingPush) return;
  if (!['yearzero', 'bladerunner', 'twilight'].includes(last.system)) return;
  // Each engine keeps its own dice: Year Zero holds 6s and 1s, Blade Runner and
  // Twilight hold any 6+ and 1s. The reducer flags which dice actually rerolled,
  // so the split below is the same for all of them.
  const pushed = last.system === 'bladerunner' ? pushBladeRunner(last)
    : last.system === 'twilight' ? pushTwilight(last)
    : pushYearZero(last);
  const pushedFlat = flattenRollDice(pushed);
  const prev = state.dice;
  const size = prev.length ? prev[0].size : 40;

  // Split the tray: the kept 6s and 1s are locked and slide to the left, while the
  // rerollable dice are blanked ("picked up") and gather on the right.
  const kept = [], picked = [];
  const dice = prev.map((d, i) => {
    const f = pushedFlat[i];
    if (f && f.rerolled) { d.value = null; d.rerolled = false; d.picked = true; d.locked = false; picked.push(d); }
    else { d.locked = true; d.picked = false; kept.push(d); }
    return d;
  });
  // Alien: the extra Stress die joins the picked handful, blank until thrown.
  for (let i = prev.length; i < pushedFlat.length; i++) {
    const f = pushedFlat[i];
    const die = new Die(f.sides, null, 0, 0, size);
    die.genColor = YZ_COLORS[f.yzType] || YZ_COLORS.base;
    die.settled = true; die.settling = true; die.settleT = 1;
    die.rot = [0.5, 0.6, 0.1];
    die.picked = true;
    dice.push(die); picked.push(die);
    die.freshPick = true;   // snapped into the cluster rather than eased
  }
  state.dice = dice;

  const { left, right, top, floor } = state.bounds;
  const span = right - left, gap = span * 0.05;
  packInto(kept,   left + gap, left + span * 0.44, top + gap, floor - gap);
  packInto(picked, left + span * 0.56, right - gap, top + gap, floor - gap);
  for (const d of picked) if (d.freshPick) { d.x = d.homeX; d.y = d.homeY; delete d.freshPick; }

  state.pendingPush = pushed;
  state.pushKept = kept;
  $('total').dataset.idle = '1';
  $('total').textContent = '—';
  $('breakdown').textContent = 'Tap the tray to throw the pushed dice';
  updateYzPush();
  updateBrPush();
  updateT2kPush();
  dropIdleCache();
  if (navigator.vibrate) navigator.vibrate(10);
}

// The second beat: unlock the kept dice, re-home everyone to the final grid, and
// throw the picked-up handful across the felt to the values the push decided.
function rollPendingPush() {
  const pushed = state.pendingPush;
  state.pendingPush = null;
  state.last = pushed;
  const pushedFlat = flattenRollDice(pushed);
  for (const d of (state.pushKept || [])) d.locked = false;
  state.pushKept = null;

  rehomeGrid(state.dice);
  state.dice.forEach((d, i) => {
    if (!d.picked) return;
    d.picked = false;
    d.value = pushedFlat[i].value;
    d.rerolled = true;
    d.rerollShown = true;   // the roll IS the animation; no second reroll hop
    // A real throw toward its grid slot — a handful cast across the table.
    d.throwWith((d.homeX - d.x) * 2.4, (d.homeY - d.y) * 2.4);
  });
  $('total').dataset.rolling = '1';
  dropIdleCache();
  setTimeout(() => finish(pushed), 760);
  if (navigator.vibrate) navigator.vibrate([8, 40, 12]);
}

// Lay a subset of dice out in a tidy grid inside a box, as ease targets.
function packInto(dice, x0, x1, y0, y1) {
  const n = dice.length;
  if (!n) return;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const cols = Math.max(1, Math.round(Math.sqrt(n * w / h)));
  const rows = Math.ceil(n / cols);
  const cw = w / cols, ch = h / rows;
  dice.forEach((d, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    d.homeX = x0 + cw * (c + 0.5);
    d.homeY = y0 + ch * (r + 0.5);
  });
}

// Ease targets for the current tray, ordered by where the dice already sit so
// nothing jumps across it — a lighter cousin of placeGrid, which snaps.
function rehomeGrid(dice) {
  const { left, right, top, floor } = state.bounds;
  const w = right - left, h = floor - top;
  const cols = Math.ceil(Math.sqrt(dice.length * (w / Math.max(h, 1))));
  const rows = Math.ceil(dice.length / cols);
  const cw = w / cols, ch = h / rows;
  const size = Math.max(26, Math.min(96, Math.min(cw, ch) * 0.78));
  [...dice].sort((a, b) => (a.y - b.y) || (a.x - b.x)).forEach((d, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    d.homeX = left + cw * (c + 0.5);
    d.homeY = top + ch * (r + 0.5);
    d.size = size;
  });
}

function updateYzPush() {
  const last = state.last;
  $('yzPush').hidden = !(yzFamily(uiSystem) && last && last.system === 'yearzero'
    && last.summary && last.summary.canPush && $('total').dataset.idle !== '1'
    && !state.pendingPush);
}

// ---- Blade Runner step dice ----
//
// Two die selectors — the Attribute die and the Skill die, each stepping through
// d6/d8/d10/d12 — plus an advantage/disadvantage stepper. Advantage rolls a
// third die, disadvantage rolls only the larger of the two.
const BR_SIZES = [6, 8, 10, 12];

// The step-die buttons wear the silhouette of the die they currently hold, the
// same die-shape language the other pickers use: rounded square (d6), diamond
// (d8), hexagon (d10), pentagon (d12). Stepping the die swaps the outline.
const BR_DIE_SHAPES = {
  6: 'M10 5H20A5 5 0 0 1 25 10V20A5 5 0 0 1 20 25H10A5 5 0 0 1 5 20V10A5 5 0 0 1 10 5Z',
  8: 'M15 3 27 15 15 27 3 15Z',
  10: 'M15 3 24 10 24 19 15 27 6 19 6 10Z',
  12: 'M15 2.6 27.3 11.5 22.6 26 7.4 26 2.7 11.5Z',
};
function setDieShape(btnId, sides) {
  const path = document.querySelector(`#${btnId} .die-ico path`);
  if (path) path.setAttribute('d', BR_DIE_SHAPES[sides]);
}
const br = { attr: 8, skill: 6, mod: null };  // mod: null | 'adv' | 'dis'

function resetBladeRunner() { br.attr = 8; br.skill = 6; br.mod = null; syncBr({ writeField: false }); }

function brNotation() { return `br:${br.attr},${br.skill}${br.mod || ''}`; }

function syncBr({ writeField = true } = {}) {
  $('br-attr-val').textContent = `d${br.attr}`;
  $('br-skill-val').textContent = `d${br.skill}`;
  setDieShape('br-attr', br.attr);
  setDieShape('br-skill', br.skill);
  $('br-mod-val').textContent = br.mod === 'adv' ? 'Advantage' : br.mod === 'dis' ? 'Disadvantage' : 'Even odds';
  $('brMod').dataset.state = br.mod || 'even';
  if (writeField) $('notation').value = brNotation();
  if (uiSystem === 'bladerunner') stageSystemPool();
}

function stepBrDie(which, dir) {
  const i = BR_SIZES.indexOf(br[which]);
  br[which] = BR_SIZES[(i + (dir > 0 ? 1 : BR_SIZES.length - 1)) % BR_SIZES.length];
  syncBr();
}

// The odds stepper cycles even → advantage → disadvantage → even, so a tap always
// reaches every state (including back to even); hold walks it the other way.
function stepBrMod(dir) {
  const order = [null, 'adv', 'dis'];
  const i = order.indexOf(br.mod);
  br.mod = order[(i + (dir > 0 ? 1 : order.length - 1)) % order.length];
  syncBr();
}

function syncBrFromField() {
  try {
    const p = parseBladeRunner($('notation').value);
    br.attr = p.attr; br.skill = p.skill; br.mod = p.mod;
    syncBr({ writeField: false });
  } catch { /* mid-type */ }
}

bindTapHold($('br-attr'), dir => stepBrDie('attr', dir));
bindTapHold($('br-skill'), dir => stepBrDie('skill', dir));
bindTapHold($('brMod'), dir => stepBrMod(dir));

// Push uses the same pick-up-and-throw gesture as Year Zero (preparePush), which
// locks the successes and 1s and lifts only the rerollable dice.
$('brPush').addEventListener('click', preparePush);

function updateBrPush() {
  const last = state.last;
  $('brPush').hidden = !(uiSystem === 'bladerunner' && last && last.system === 'bladerunner'
    && last.summary && last.summary.canPush && $('total').dataset.idle !== '1'
    && !state.pendingPush);
}

// ---- Twilight: 2000 step dice ----
//
// Blade Runner's Attribute + Skill selectors, plus a pool of d6 Ammo dice. No
// advantage/disadvantage control — Twilight steps the die sizes themselves, which
// you set here directly.
const t2k = { attr: 8, skill: 6, ammo: 0 };

function resetTwilight() { t2k.attr = 8; t2k.skill = 6; t2k.ammo = 0; syncT2k({ writeField: false }); }

function t2kNotation() { return `t2k:${t2k.attr},${t2k.skill}${t2k.ammo > 0 ? ',' + t2k.ammo : ''}`; }

function syncT2k({ writeField = true } = {}) {
  $('t2k-attr-val').textContent = `d${t2k.attr}`;
  $('t2k-skill-val').textContent = `d${t2k.skill}`;
  $('t2k-ammo-val').textContent = String(t2k.ammo);
  setDieShape('t2k-attr', t2k.attr);
  setDieShape('t2k-skill', t2k.skill);
  if (writeField) $('notation').value = t2kNotation();
  if (uiSystem === 'twilight') stageSystemPool();
}

function stepT2kDie(which, dir) {
  const i = BR_SIZES.indexOf(t2k[which]);
  t2k[which] = BR_SIZES[(i + (dir > 0 ? 1 : BR_SIZES.length - 1)) % BR_SIZES.length];
  syncT2k();
}

function stepT2kAmmo(dir) { t2k.ammo = Math.max(0, Math.min(20, t2k.ammo + dir)); syncT2k(); }

function syncT2kFromField() {
  try {
    const p = parseTwilight($('notation').value);
    t2k.attr = p.attr; t2k.skill = p.skill; t2k.ammo = p.ammo;
    syncT2k({ writeField: false });
  } catch { /* mid-type */ }
}

bindTapHold($('t2k-attr'), dir => stepT2kDie('attr', dir));
bindTapHold($('t2k-skill'), dir => stepT2kDie('skill', dir));
bindTapHold($('t2k-ammo'), dir => stepT2kAmmo(dir));

$('t2kPush').addEventListener('click', preparePush);

function updateT2kPush() {
  const last = state.last;
  $('t2kPush').hidden = !(uiSystem === 'twilight' && last && last.system === 'twilight'
    && last.summary && last.summary.canPush && $('total').dataset.idle !== '1'
    && !state.pendingPush);
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
dhDiffChip.addEventListener('click', () => {
  openNumberDial({
    title: 'Difficulty', value: dhState.difficulty ?? 15, min: 1, max: 40,
    actionLabel: 'Set Difficulty', inputLabel: 'Difficulty',
    clearLabel: 'Table sets it',
    commit: value => { dhState.difficulty = value; syncDh(); },
    onClear: () => { dhState.difficulty = null; syncDh(); },
  });
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

const ct = { dice: 6, difficulty: null };
const ctAddDie = $('ctAddDie');
const ctDiffChip = $('ctDiffChip');
const ctDiffVal = $('ctDifficulty');

function resetCthulhuTech() {
  // CthulhuTech builds a pool, so it opens empty like the numeric tray — tap the
  // d10 to add. Difficulty is a setting, not a die, so it keeps its default.
  ct.dice = 0;
  ct.difficulty = null;
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
ctDiffChip.addEventListener('click', () => {
  openNumberDial({
    title: 'Difficulty', value: ct.difficulty ?? 3, min: 1, max: 20,
    actionLabel: 'Set Difficulty', inputLabel: 'Difficulty',
    clearLabel: 'Table sets it',
    commit: value => { ct.difficulty = value; syncCt(); },
    onClear: () => { ct.difficulty = null; syncCt(); },
  });
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
const tor = { success: 0, favour: null, weary: false, tn: null };
const torAddSuccess = $('torAddSuccess');
const torTnChip = $('torTnChip');
const torTnVal = $('torTn');
const torFlagButtons = [...document.querySelectorAll('.tor-flag')];

function resetOneRing() {
  tor.success = 0;
  tor.favour = null;
  tor.weary = false;
  tor.tn = null;
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
torTnChip.addEventListener('click', () => {
  openNumberDial({
    title: 'Target Number', value: tor.tn ?? 14, min: 1, max: 30,
    actionLabel: 'Set Target', inputLabel: 'Target Number',
    clearLabel: 'Table sets it',
    commit: value => { tor.tn = value; syncTor(); },
    onClear: () => { tor.tn = null; syncTor(); },
  });
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
// Target defaults to unset — the table sets the difficulty, as in the other
// judge-it-at-the-table systems; a bare number rolls and the table reads it.
const ms = { mode: 'check', target: null, skill: null, advantage: null, stress: 2 };
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
  ms.target = null;
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
    clearLabel: 'Table sets it',
    commit: value => { ms.target = value; syncMs(); },
    onClear: () => { ms.target = null; syncMs(); },
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

// ---- Call of Cthulhu 7e ----
//
// d100 under a skill, in tiers, with optional bonus/penalty dice. The skill is
// the shared roller (table-set by default); bonus and penalty are one signed
// count of extra tens dice that cancel each other.
const COC_COLORS = { crit: '#8FC98A', success: '#5DAE6A', fail: '#C0453F', fumble: '#8E2F26', tens: '#7F9B57', ones: '#6A757C', bonus: '#5DAE6A', penalty: '#C0453F' };
const coc = { target: null, modifier: 0 };
const cocSkillDial = $('cocSkillDial');
const cocBonusBtn = $('cocBonus');
const cocPenaltyBtn = $('cocPenalty');

function cocNotation() {
  let s = 'coc:';
  if (coc.target !== null) s += coc.target;
  if (coc.modifier > 0) s += 'b' + (coc.modifier > 1 ? coc.modifier : '');
  else if (coc.modifier < 0) s += 'p' + (-coc.modifier > 1 ? -coc.modifier : '');
  return s;
}
function resetCoc() { coc.target = null; coc.modifier = 0; }

function syncCoc({ writeField = true } = {}) {
  cocSkillDial.textContent = coc.target === null ? '—' : String(coc.target);
  if (coc.target === null) cocSkillDial.dataset.unset = '1'; else delete cocSkillDial.dataset.unset;
  const bonus = Math.max(0, coc.modifier), penalty = Math.max(0, -coc.modifier);
  if (bonus) cocBonusBtn.dataset.count = String(bonus); else delete cocBonusBtn.dataset.count;
  if (penalty) cocPenaltyBtn.dataset.count = String(penalty); else delete cocPenaltyBtn.dataset.count;
  cocBonusBtn.setAttribute('aria-pressed', String(bonus > 0));
  cocPenaltyBtn.setAttribute('aria-pressed', String(penalty > 0));
  if (writeField && uiSystem === 'callofcthulhu') $('notation').value = cocNotation();
  if (uiSystem === 'callofcthulhu' && !$('total').dataset.rolling) stageSystemPool();
}

cocSkillDial.addEventListener('click', () => {
  openNumberDial({
    title: 'Skill', value: coc.target ?? 50, min: 1, max: 100,
    actionLabel: 'Set Skill', inputLabel: 'Skill',
    clearLabel: 'Table sets it',
    commit: v => { coc.target = v; syncCoc(); },
    onClear: () => { coc.target = null; syncCoc(); },
  });
});
// Bonus and penalty are one signed axis, capped at 3 a side. A tap cycles that
// side up and wraps back through zero (0 → 1 → 2 → 3 → 0); tapping the other
// side switches to it. No hold — a tap alone reaches every value.
cocBonusBtn.addEventListener('click', () => {
  coc.modifier = coc.modifier < 0 ? 1 : (coc.modifier + 1) % 4;
  syncCoc();
});
cocPenaltyBtn.addEventListener('click', () => {
  coc.modifier = coc.modifier > 0 ? -1 : -(((-coc.modifier) + 1) % 4);
  syncCoc();
});

function syncCocFromField() {
  try {
    const { target, modifier } = parseCallOfCthulhu($('notation').value);
    coc.target = target; coc.modifier = modifier;
    syncCoc({ writeField: false });
  } catch { /* mid-type */ }
}

// ---- Delta Green ----
//
// d100 under a target (skill or stat x5). 01 always succeeds, 100 always fails,
// and matching digits turn a success Critical or a failure a Fumble. One dial.
const DG_COLORS = { crit: '#7FCF95', success: '#57A06A', fail: '#C0453F', fumble: '#8E2F26', tens: '#5E8A63', ones: '#6A757C' };
const dg = { target: null };
const dgTargetDial = $('dgTargetDial');

function dgNotation() { return 'dg:' + (dg.target !== null ? dg.target : ''); }
function resetDg() { dg.target = null; }

function syncDg({ writeField = true } = {}) {
  dgTargetDial.textContent = dg.target === null ? '—' : String(dg.target);
  if (dg.target === null) dgTargetDial.dataset.unset = '1'; else delete dgTargetDial.dataset.unset;
  if (writeField && uiSystem === 'deltagreen') $('notation').value = dgNotation();
  if (uiSystem === 'deltagreen' && !$('total').dataset.rolling) stageSystemPool();
}

dgTargetDial.addEventListener('click', () => {
  openNumberDial({
    title: 'Target', value: dg.target ?? 50, min: 1, max: 99,
    actionLabel: 'Set Target', inputLabel: 'Target',
    clearLabel: 'Table sets it',
    commit: v => { dg.target = v; syncDg(); },
    onClear: () => { dg.target = null; syncDg(); },
  });
});

function syncDgFromField() {
  try {
    const { target } = parseDeltaGreen($('notation').value);
    dg.target = target;
    syncDg({ writeField: false });
  } catch { /* mid-type */ }
}

// ---- Ironsworn / Starforged ----
//
// One action roll for both games: a d6 action die + your modifier (stat + adds,
// score capped at 10) against two d10 challenge dice. Beat both for a Strong
// Hit, one for a Weak Hit, neither for a Miss; matching challenge dice are a
// twist. A progress roll swaps the action die for a track value (1-10). The
// picker is one dial whose meaning flips with the Progress toggle.
const IRON_COLORS = { action: '#C9A227', beaten: '#57A06A', miss: '#C0453F', challenge: '#6E7F8C', oracle: '#8AA1AE' };
// One model for the whole mode: everything you can roll is a TILE in the "Your
// rolls" shelf — Action, Progress, and each pinned oracle. Tapping a tile loads
// it as the active roll (its dice stage on the tray) and rolls it; the notation
// field carries the active roll, so Roll and a tray tap re-roll whatever is
// loaded. This is the same "what's on the tray is what you roll" contract as the
// rest of Dicebox — no separate oracle card, no ambiguity about what Roll does.
const iron = { modifier: 2, progressScore: 1 };
let ironActive = { kind: 'action' };   // { kind:'action'|'progress' } | { kind:'oracle', id }
const ironPins = [];                    // pinned oracle table ids, in pin order
const ironDial = $('ironDial');

function ironNotation() {
  if (ironActive.kind === 'progress') return 'iron:p' + iron.progressScore;
  if (ironActive.kind === 'oracle') return 'oracle:' + oracleSlug(curOracles(), ironActive.id);
  const m = iron.modifier;
  return 'iron:' + (m > 0 ? '+' + m : m < 0 ? String(m) : '');
}
function resetIron() { iron.modifier = 2; iron.progressScore = 1; ironActive = { kind: 'action' }; ironPins.length = 0; renderIronPins(); }

function syncIron({ writeField = true } = {}) {
  ironDial.textContent = iron.modifier > 0 ? '+' + iron.modifier : String(iron.modifier);
  $('ironProgressDial').textContent = iron.progressScore;
  for (const tile of $('ironShelf').querySelectorAll('.iron-tile')) {
    const active = ironActive.kind === 'oracle'
      ? (tile.dataset.id === ironActive.id)
      : (tile.dataset.roll === ironActive.kind);
    tile.classList.toggle('is-active', active);
  }
  if (writeField && (uiSystem === 'ironsworn' || uiSystem === 'starforged')) $('notation').value = ironNotation();
  if ((uiSystem === 'ironsworn' || uiSystem === 'starforged') && !$('total').dataset.rolling) stageSystemPool();
}

// Load a roll as active and (by default) throw it. doRoll routes iron:/oracle:
// notation to the right engine, so this is the single path for every tile.
function selectIronRoll(active, { roll = true } = {}) {
  ironActive = active;
  syncIron();
  const activeTile = $('ironShelf').querySelector('.iron-tile.is-active');
  if (activeTile) activeTile.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  if (roll) doRoll(ironNotation());
}

// The Action tile: its body rolls the action roll; the +N chip opens the dial to
// set the stat/adds (which just re-arms it — you tap Action, or Roll, to throw).
$('ironActionRoll').addEventListener('click', () => selectIronRoll({ kind: 'action' }));
ironDial.addEventListener('click', () => {
  openNumberDial({
    title: 'Modifier', value: Math.max(1, iron.modifier), min: 1, max: 9, prefix: '+',
    actionLabel: 'Set Modifier', inputLabel: 'Modifier',
    commit: v => { iron.modifier = v; selectIronRoll({ kind: 'action' }, { roll: false }); },
  });
});
// Mirrors the Action tile: the body rolls the progress roll at the current box
// count; the value chip opens the dial to set the boxes (0-10) without rolling.
$('ironProgressRoll').addEventListener('click', () => selectIronRoll({ kind: 'progress' }));
$('ironProgressDial').addEventListener('click', () => {
  openNumberDial({
    title: 'Progress — filled boxes', value: iron.progressScore, min: 1, max: 10,
    actionLabel: 'Set boxes', inputLabel: 'Filled boxes',
    commit: v => { iron.progressScore = v; selectIronRoll({ kind: 'progress' }, { roll: false }); },
  });
});

function syncIronFromField() {
  try {
    const p = parseIronsworn($('notation').value);
    if (p.progress) { iron.progressScore = p.progressScore; ironActive = { kind: 'progress' }; }
    else { iron.modifier = p.modifier; ironActive = { kind: 'action' }; }
    syncIron({ writeField: false });
  } catch { /* mid-type */ }
}

// Pinned oracle tiles: added from the browser, re-rollable in one tap, ✕ to drop.
function pinOracle(id) { if (!ironPins.includes(id)) { ironPins.push(id); renderIronPins(); } }
function unpinOracle(id) {
  const i = ironPins.indexOf(id);
  if (i >= 0) ironPins.splice(i, 1);
  renderIronPins();
  if (ironActive.kind === 'oracle' && ironActive.id === id) selectIronRoll({ kind: 'action' }, { roll: false });
}
// The collection breadcrumb for a table id, cached per dataset — a pinned
// "Feature" is meaningless without its "Planet › Inhabited World" context.
function oraclePath(id) {
  const ds = curOracles();
  if (!ds) return '';
  if (!ds.__paths) {
    const map = Object.create(null);
    for (const t of oracleTableList(ds)) map[t.id] = t.path.join(' › ');
    Object.defineProperty(ds, '__paths', { value: map, enumerable: false });
  }
  return ds.__paths[id] || '';
}

function renderIronPins() {
  const shelf = $('ironShelf');
  if (!shelf) return;
  for (const t of shelf.querySelectorAll('.iron-tile-oracle')) t.remove();
  if (!curOracles()) return;
  const addTile = $('ironOracles');   // pins sit before the +Oracles tile
  for (const id of ironPins) {
    const table = curOracles().tables[id];
    if (!table) continue;
    const tile = document.createElement('div');
    tile.className = 'iron-tile iron-tile-oracle';
    tile.dataset.roll = 'oracle';
    tile.dataset.id = id;
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'iron-tile-main';
    const path = oraclePath(id);
    const name = document.createElement('span');
    name.className = 'iron-tile-name';
    name.textContent = table.name;
    const sub = document.createElement('span');
    sub.className = 'iron-tile-sub';
    sub.textContent = path || ('d' + table.sides);
    main.append(name, sub);
    main.title = path ? `${path} › ${table.name}` : table.name;
    main.addEventListener('click', () => selectIronRoll({ kind: 'oracle', id }));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'iron-tile-close';
    close.setAttribute('aria-label', 'Unpin ' + table.name);
    close.textContent = '✕';
    close.addEventListener('click', e => { e.stopPropagation(); unpinOracle(id); });
    tile.append(main, close);
    shelf.insertBefore(tile, addTile);
  }
  syncIron({ writeField: false });
}

// ---- Ironsworn oracles ----
//
// The oracle sets (Datasworn, CC BY 4.0) — Ironsworn (with its Delve expansion
// folded in) and Starforged, one per mode. Each data module is lazy-loaded on
// first open like the deck art; the engine (oracle-dice.js) rolls a table and
// resolves the "roll twice"/linked rolls. The two games share this whole machine
// — only the loaded dataset differs, which is why Starforged is the same mode
// engine as Ironsworn with a different oracle set.
const ORACLE_EXPORT = { ironsworn: 'IRONSWORN_ORACLES', starforged: 'STARFORGED_ORACLES' };
const ORACLE_MODULE = { ironsworn: './ironsworn-oracles.js', starforged: './starforged-oracles.js' };
const oracleCache = {};
const oracleLoading = {};
function activeGame() { return uiSystem === 'starforged' ? 'starforged' : 'ironsworn'; }
function curOracles() { return oracleCache[activeGame()] || null; }
function ensureOracles(game = activeGame()) {
  if (oracleCache[game]) return Promise.resolve(oracleCache[game]);
  if (!oracleLoading[game]) {
    /* global __dicebox */
    const exp = ORACLE_EXPORT[game];
    oracleLoading[game] = (typeof __dicebox !== 'undefined' && __dicebox[exp])
      ? Promise.resolve({ [exp]: __dicebox[exp] })
      : import(ORACLE_MODULE[game]);
    oracleLoading[game] = oracleLoading[game].then(m => (oracleCache[game] = m[exp]));
  }
  return oracleLoading[game];
}

const oracleSheet = $('oracleSheet');
const oracleTree = $('oracleTree');
const oracleSearch = $('oracleSearch');

function oracleTableCount(node) {
  let n = (node.tables || []).length;
  for (const g of node.groups || []) n += oracleTableCount(g);
  return n;
}

function buildOracleTree() {
  if (!curOracles() || oracleTree.dataset.builtFor === activeGame()) return;
  const make = (node, ancestors = []) => {
    const here = [...ancestors, node.name];   // full collection path to this node
    const coll = document.createElement('div');
    coll.className = 'oracle-coll';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'oracle-coll-head';
    head.innerHTML = '<svg class="oracle-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
    const nm = document.createElement('span');
    nm.className = 'oracle-coll-name';
    nm.textContent = node.name;
    const cnt = document.createElement('span');
    cnt.className = 'oracle-coll-count';
    cnt.textContent = oracleTableCount(node);
    head.append(nm, cnt);
    head.addEventListener('click', () => coll.classList.toggle('open'));
    coll.append(head);
    const kids = document.createElement('div');
    kids.className = 'oracle-kids';
    for (const id of node.tables || []) {
      const t = curOracles().tables[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'oracle-table';
      // Search matches the whole path + name, so a category ("monstrosity")
      // surfaces its tables (Size, Abilities…) even though none is named that.
      b.dataset.search = [...here, t.name].join(' ').toLowerCase();
      const label = document.createElement('span');
      label.className = 'oracle-table-name';
      label.textContent = t.name;
      const path = document.createElement('span');
      path.className = 'oracle-table-path';
      path.textContent = here.join(' › ');
      const dtag = document.createElement('span');
      dtag.className = 'oracle-dtag';
      dtag.textContent = 'd' + t.sides;
      b.append(label, path, dtag);
      b.addEventListener('click', () => rollOracleFromBrowser(id));
      kids.append(b);
    }
    for (const g of node.groups || []) kids.append(make(g, here));
    coll.append(kids);
    return coll;
  };
  oracleTree.textContent = '';
  for (const c of curOracles().tree) oracleTree.append(make(c));
  // Open Ask the Oracle by default — the odds tables are the most-reached.
  for (const coll of oracleTree.querySelectorAll('.oracle-coll')) {
    const name = coll.querySelector('.oracle-coll-name');
    if (name && (name.textContent === 'Moves' || name.textContent === 'Ask the Oracle')) coll.classList.add('open');
  }
  oracleTree.dataset.builtFor = activeGame();
}

// The five Ask the Oracle likelihoods live in the picker as one-tap buttons.
// Each asks a yes/no at that chance: load the data if needed, roll the matching
// odds table, and throw its d100 like any roll.
for (const btn of document.querySelectorAll('.iron-odd')) {
  btn.addEventListener('click', () => {
    ensureOracles().then(ds => {
      const id = findOracleBySlug(ds, btn.dataset.odds);
      if (id) selectIronRoll({ kind: 'oracle', id });
    });
  });
}

// Keyboard-driven results, autocomplete-style: as you type, the top match is
// highlighted; ↑/↓ move it and Enter rolls it, focus staying in the box.
let oracleHi = -1;
function oracleVisible() {
  return [...oracleTree.querySelectorAll('.oracle-table')].filter(b => b.offsetParent !== null);
}
function setOracleHighlight(i) {
  for (const b of oracleTree.querySelectorAll('.oracle-table.is-highlighted')) b.classList.remove('is-highlighted');
  const vis = oracleVisible();
  if (!vis.length) { oracleHi = -1; return; }
  oracleHi = Math.max(0, Math.min(i, vis.length - 1));
  const el = vis[oracleHi];
  el.classList.add('is-highlighted');
  el.scrollIntoView({ block: 'nearest' });
}
function clearOracleHighlight() {
  for (const b of oracleTree.querySelectorAll('.oracle-table.is-highlighted')) b.classList.remove('is-highlighted');
  oracleHi = -1;
}

oracleSearch.addEventListener('input', () => {
  const q = oracleSearch.value.trim().toLowerCase();
  // Every whitespace-separated word must appear somewhere in the path + name, so
  // "monstrosity size" and "size monstrosity" both find the table.
  const terms = q.split(/\s+/).filter(Boolean);
  oracleTree.classList.toggle('searching', !!q);
  let any = false;
  for (const b of oracleTree.querySelectorAll('.oracle-table')) {
    const match = !terms.length || terms.every(t => b.dataset.search.includes(t));
    b.hidden = !match;
    if (match) any = true;
  }
  let empty = oracleTree.querySelector('.oracle-empty');
  if (!any) {
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'oracle-empty';
      empty.textContent = 'No tables match.';
      oracleTree.append(empty);
    }
  } else if (empty) empty.remove();
  if (terms.length) setOracleHighlight(0); else clearOracleHighlight();
});

oracleSearch.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setOracleHighlight(oracleHi + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setOracleHighlight(oracleHi - 1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const vis = oracleVisible();
    (vis[oracleHi] || vis[0])?.click();
  }
});

function openOracles() {
  ensureOracles().then(() => {
    if (uiSystem !== 'ironsworn' && uiSystem !== 'starforged') return;
    buildOracleTree();
    setHelp(false);
    closeSheet();
    closeDial();
    closeHistory();
    closeMode();
    closeRoom();
    oracleSheet.hidden = false;
    oracleSearch.focus();
  });
}
function closeOracles() { oracleSheet.hidden = true; }

// Build a result for an oracle draw: a single dN die showing the rolled number,
// so it throws on the tray like any other roll instead of silently swapping text.
// The node (answer + any linked/suggested rolls) rides along as the summary —
// the headline and detail read from it, and it is what a shared table receives.
function makeOracleResult(node) {
  return {
    system: 'oracle',
    notation: 'oracle:' + oracleSlug(curOracles(), node.id),
    groups: [{
      kind: 'dice', dieType: 'oracle', sides: node.sides, count: 1,
      dice: [{ value: node.roll, sides: node.sides, kept: true, rerolled: false, exploded: false }],
    }],
    summary: node,
  };
}

// A table picked in the browser pins to the shelf and becomes the active roll —
// its die loads on the tray and throws, and the tile stays so you can re-roll it
// or jump back to it later.
function rollOracleFromBrowser(id) {
  pinOracle(id);
  closeOracles();
  selectIronRoll({ kind: 'oracle', id });
}

// The typed path: "oracle:pay-the-price", "oracle:likely". The dataset loads on
// demand (the notation can be typed before the browser is ever opened), then the
// slug resolves to a table. An unknown slug is a clear error, not a silent numeric
// fall-through.
function rollOracleFromNotation(notation) {
  const query = String(notation).slice(String(notation).indexOf(':') + 1).trim();
  ensureOracles().then(ds => {
    const id = findOracleBySlug(ds, query);
    if (!id) { showError(`No oracle table matches "${query}"`); return; }
    clearError();
    throwResult(makeOracleResult(rollOracle(ds, id)));
  });
}

$('ironOracles').addEventListener('click', openOracles);
$('oracleClose').addEventListener('click', closeOracles);
oracleSheet.addEventListener('click', e => { if (e.target === oracleSheet) closeOracles(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !oracleSheet.hidden) { closeOracles(); $('ironOracles').focus(); }
});

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
const deckState = {
  order: [], pos: 0, jokers: false, replace: false, draw: 1,
  // The discard pile holds the dealt cards themselves, in the order they were
  // swept in (newest last) — the count and the face-up top card both read off
  // it, and it is what the discard browser opens. The hand currently on the
  // table is tracked so it can be swept into the pile by the next draw (or
  // folded in after a reload).
  pile: [], hand: [], handReplace: false,
};
{
  try {
    const saved = JSON.parse(store.get(DECK_KEY) || 'null');
    if (saved && Array.isArray(saved.order) && saved.order.every(x => typeof x === 'string')) {
      Object.assign(deckState, saved, { draw: Math.max(1, Math.min(10, saved.draw || 1)) });
      // States saved before the pile held its contents knew only a count and a
      // top card; the top card is all that can be carried over.
      if (!Array.isArray(deckState.pile)) {
        deckState.pile = typeof saved.discardTop === 'string' ? [saved.discardTop] : [];
      }
      delete deckState.discard;
      delete deckState.discardTop;
      // A hand left on the table when the page closed is a dealt hand: it
      // belongs to the discard now, exactly as if the next draw had swept it.
      if (Array.isArray(deckState.hand) && deckState.hand.length && !deckState.handReplace) {
        deckState.pile.push(...deckState.hand);
      }
      deckState.hand = [];
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
// What is physically in the deck. Replace mode draws from (and returns to)
// this same pool, so the count holds steady — but the discard stays out until
// a shuffle folds it back in, exactly like a real table.
const deckRemaining = () => Math.max(0, deckState.order.length - deckState.pos);

// Whether the hand being swept off the table was drawn with replacement —
// read by the dealer for the sweep animation after drawDeckCards has already
// re-pointed deckState.hand at the new draw.
let lastSweptReplace = false;

// The pile as it stood before the current deal's sweep — {count, top} — read
// by the dealers so the pile sprite can hold the old face until the flight
// lands. Cards store bare ids in their pile; normalise at use.
let lastSweptPrevPile = null;

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
  deckState.pile = [];
  deckState.hand = [];
  persistDeck();
}

// Draw n cards per the current mode. Without replacement the draw comes off the
// persisted order; with replacement each card is an independent pick from the
// full deck (duplicates possible, as at a real table). Requires the art module
// (for labels) — callers go through dealCardsFlow, which loads it.
// The field's full description of the deck: the count plus whichever settings
// are on, so every picker button has a typed twin and the field round-trips.
function deckNotation() {
  let s = `deck:${deckState.draw}`;
  if (deckState.jokers) s += ' jokers';
  if (deckState.replace) s += ' replace';
  return s;
}

// Bring the deck's settings in line with a parsed notation, the way toggling
// the buttons would: a change to what the deck contains (jokers) reshuffles;
// replace just flips. Returns whether a reshuffle happened, so the caller can
// clear the table to match.
function applyDeckFlags({ jokers, replace }) {
  let reshuffled = false;
  if (jokers !== deckState.jokers) { deckState.jokers = jokers; reshuffleDeck(); reshuffled = true; }
  if (replace !== deckState.replace) { deckState.replace = replace; persistDeck(); }
  return reshuffled;
}

function drawDeckCards(n) {
  let ids;
  deckState.draw = n;
  if (deckState.order.length === 0) reshuffleDeck();
  if (deckState.replace) {
    // Independent picks from what is still in the deck — not the full 52.
    // Cards sitting in the discard are out of play until a shuffle.
    const pool = deckState.order.slice(deckState.pos);
    ids = pool.length ? Array.from({ length: n }, () => pool[cryptoIndex(pool.length)]) : [];
  } else {
    ids = deckState.order.slice(deckState.pos, deckState.pos + n);
    deckState.pos += ids.length;
    persistDeck();
  }
  // The previous hand goes to the discard (replace-mode hands went home to
  // the deck instead and never count). Its provenance is stashed for the
  // dealer, which animates the sweep after this state has already moved on.
  lastSweptReplace = deckState.handReplace;
  lastSweptPrevPile = { count: deckState.pile.length, top: deckState.pile.length ? deckState.pile[deckState.pile.length - 1] : null };
  if (deckState.hand.length && !deckState.handReplace) {
    deckState.pile.push(...deckState.hand);
  }
  deckState.hand = ids.slice();
  deckState.handReplace = deckState.replace;
  persistDeck();
  const drawn = ids.map(id => {
    const m = cardArt.cardMeta(id);
    return { id, label: m.label, red: !!m.red };
  });
  return {
    schema: 2,
    system: 'cards',
    notation: deckNotation(),
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
  // Rasterise generously: a single drawn card can fill most of the tray, and on
  // a dpr-3 phone that is well past 500 device pixels wide.
  const svg = cardArt.cardSVG(id, { dark: isDark() })
    .replace('<svg ', '<svg width="750" height="1050" ');
  const img = new Image();
  img.addEventListener('error', () => cardImgCache.delete(key));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  entry = { img, ready: img.decode ? img.decode().catch(() => {}) : Promise.resolve() };
  // A decoded SVG image still costs the rasteriser on draw; a bitmap is a
  // straight blit. Swap it in once it exists — the entry keeps working either way.
  if (typeof createImageBitmap === 'function') {
    entry.ready = entry.ready
      .then(() => createImageBitmap(img))
      .then(bmp => { entry.img = bmp; })
      .catch(() => {});
  }
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
// The top card of an idle deck lies just off-square — a real stack does — and
// a dealt card starts from exactly that angle, so the pickup reads as picking
// up the card that was already sitting there.
const DECK_ASKEW = 0.045;

// drawImage THROWS on an HTMLImageElement whose decode failed, and three
// thrown frames trip the loop's crash guard and clear the whole tray — which
// is what one flaky SVG decode on a phone turned into. A broken card instead
// skips a frame; its cache entry has already evicted itself (the caches
// listen for error), so the very next frame quietly retries the load.
function liveCardImage(entry) {
  const im = entry.img;
  if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement
      && im.complete && im.naturalWidth === 0) return null;
  return im;
}

// The sprites and layout serve two decks — playing cards and tarot — through a
// small view: which art to draw, the card aspect, and where the live counts
// come from. Each sprite carries the view it was dealt from, so a peer's
// playing-card draw renders correctly even while your tray sits in Tarot mode.
const cardsView = {
  ratio: CARD_RATIO,
  image: id => cardImage(id),
  svg: id => cardArt.cardSVG(id, { dark: isDark() }),
  loaded: () => !!cardArt,
  remaining: () => deckRemaining(),
  total: () => deckTotal(),
  replace: () => deckState.replace,
  discard: () => deckState.pile.length,
  discardTop: () => (deckState.pile.length ? { id: deckState.pile[deckState.pile.length - 1], rev: false } : null),
  pile: () => deckState.pile.map(id => ({ id, rev: false })),
  discardFromHand: (id) => {
    const i = deckState.hand.indexOf(id);
    if (i >= 0) deckState.hand.splice(i, 1);
    deckState.pile.push(id);
    persistDeck();
  },
};
const napView = {
  ratio: 1.552, // the 1902 deck's own 8.2 x 5.3 cm
  image: id => napImage(id),
  svg: id => napArt.napSVG(id, { dark: isDark() }),
  loaded: () => !!napArt,
  remaining: () => napRemaining(),
  total: () => napTotal(),
  replace: () => napState.replace,
  discard: () => napState.pile.length,
  discardTop: () => (napState.pile.length ? { id: napState.pile[napState.pile.length - 1], rev: false } : null),
  pile: () => napState.pile.map(id => ({ id, rev: false })),
  discardFromHand: (id) => {
    const i = napState.hand.indexOf(id);
    if (i >= 0) napState.hand.splice(i, 1);
    napState.pile.push(id);
    persistNap();
  },
};
const hanaView = {
  ratio: 1.639, // the set's own 976x1600
  image: id => hanaImage(id),
  // Not inline SVG like the woodcut decks: these cards carry their colour in
  // style attributes (resolved from the exports' class rules), and the site's
  // CSP has no style-src 'unsafe-inline' — inlined in the page, every style
  // attribute is blocked and every path falls back to black fill: a black
  // card. A data-URI <img> renders as its own SVG document, where the page's
  // CSP doesn't reach, and img-src data: is already allowed.
  svg: id => '<img alt="" draggable="false" src="data:image/svg+xml;charset=utf-8,'
    + encodeURIComponent(hanaArt.hanaSVG(id, { dark: isDark() })) + '">',
  loaded: () => !!hanaArt,
  remaining: () => hanaRemaining(),
  total: () => hanaTotal(),
  replace: () => hanaState.replace,
  discard: () => hanaState.pile.length,
  discardTop: () => (hanaState.pile.length ? { id: hanaState.pile[hanaState.pile.length - 1], rev: false } : null),
  pile: () => hanaState.pile.map(id => ({ id, rev: false })),
  discardFromHand: (id) => {
    const i = hanaState.hand.indexOf(id);
    if (i >= 0) hanaState.hand.splice(i, 1);
    hanaState.pile.push(id);
    persistHana();
  },
};
const utaView = {
  ratio: 1.56, // shells 250x390, after the book page's own proportion
  image: id => utaImage(id),
  svg: id => utaArt.utaSVG(id, { dark: isDark() }),
  reading: id => utaReadingHTML(id),
  loaded: () => !!utaArt,
  remaining: () => utaRemaining(),
  total: () => utaTotal(),
  replace: () => utaState.replace,
  discard: () => utaState.pile.length,
  discardTop: () => (utaState.pile.length ? { id: utaState.pile[utaState.pile.length - 1], rev: false } : null),
  pile: () => utaState.pile.map(id => ({ id, rev: false })),
  discardFromHand: (id) => {
    const i = utaState.hand.indexOf(id);
    if (i >= 0) utaState.hand.splice(i, 1);
    utaState.pile.push(id);
    persistUta();
  },
};
const tarotView = {
  ratio: 1.72,
  image: id => tarotImage(id),
  svg: id => tarotArt.tarotSVG(id, { dark: isDark() }),
  loaded: () => !!tarotArt,
  remaining: () => tarotRemaining(),
  total: () => tarotTotal(),
  replace: () => tarotState.replace,
  discard: () => tarotState.pile.length,
  discardTop: () => (tarotState.pile.length ? tarotState.pile[tarotState.pile.length - 1] : null),
  pile: () => tarotState.pile.slice(),
  discardFromHand: (id, rev) => {
    const i = tarotState.hand.findIndex(e => e.id === id && !!e.rev === !!rev);
    if (i >= 0) tarotState.hand.splice(i, 1);
    tarotState.pile.push({ id, rev: !!rev });
    persistTarot();
  },
};

class CardSprite {
  constructor(id, from, to, { delay = 0, remote = false, mode = 'deal', view = cardsView, rev = false } = {}) {
    this.id = id;
    this.view = view;
    this.rev = rev;
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
    this.wobble = DECK_ASKEW + (cryptoIndex(40) - 20) / 900;
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
        if (this.mode === 'return' || this.mode === 'discard') { this.phase = 'idle'; this.settled = true; this.gone = true; this.value = this.id; }
        else this.phase = 'flip';
      }
    } else if (this.phase === 'flip') {
      this.flipT = Math.min(1, this.flipT + dt / FLIP_S);
      if (this.flipT >= 1) { this.phase = 'idle'; this.settled = true; this.value = this.id; }
    }
  }
  draw(ctx) {
    if (this.gone) return;
    const w = this.size, h = w * this.view.ratio;
    const flip = this.mode === 'return' ? 0 : this.mode === 'discard' ? 1 : (this.phase === 'idle' ? 1 : this.flipT);
    const img = liveCardImage(flip < 0.5 ? this.view.image('back') : this.view.image(this.id));
    if (!img) return;
    const sx = this.phase === 'flip' ? Math.abs(Math.cos(Math.PI * flip)) || 0.02 : 1;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.phase === 'fly') ctx.rotate(this.wobble * (1 - this.t));
    // A reversed tarot card lands upside down: the face rotates in as it flips.
    if (this.rev && flip >= 0.5) ctx.rotate(Math.PI);
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
  constructor(x, y, w, view = cardsView) {
    this.x = x; this.y = y; this.size = w;
    this.view = view;
    this.isCard = true; this.isStack = true;
    this.stageKind = 'deck-stack';
    this.settled = true; this.settling = true; this.settleT = 1;
    this.riffle = 0;
    this.riffleAfter = 0; // seconds until a queued riffle starts
    this.value = 'deck';
    this.tween = null; // { fx, fy, fw, tx, ty, tw, t }
  }
  moveTo(x, y, w) {
    this.tween = { fx: this.x, fy: this.y, fw: this.size, tx: x, ty: y, tw: w, t: 0 };
    this.value = null;
  }
  step(dt) {
    if (this.riffleAfter > 0) {
      this.riffleAfter -= dt;
      this.value = null;
      if (this.riffleAfter <= 0) { this.riffleAfter = 0; this.riffle = 1; }
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.3);
      const e = 1 - Math.pow(1 - tw.t, 3);
      this.x = tw.fx + (tw.tx - tw.fx) * e;
      this.y = tw.fy + (tw.ty - tw.fy) * e;
      this.size = tw.fw + (tw.tw - tw.fw) * e;
      if (tw.t >= 1) { this.tween = null; if (this.riffle === 0) this.value = 'deck'; }
    }
    if (this.riffle > 0) {
      this.riffle = Math.max(0, this.riffle - dt / 1.15);
      this.value = this.riffle > 0 ? null : 'deck';
    }
  }
  draw(ctx) {
    const w = this.size, h = w * this.view.ratio;
    const img = liveCardImage(this.view.image('back'));
    if (!img) return;
    const empty = this.view.remaining() === 0;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    if (this.riffle > 0) {
      // A three-act shuffle, driven backwards from riffle 1 -> 0:
      //   split   — the deck cuts into two halves that swing apart;
      //   riffle  — twelve cards leaf back together, alternating hands,
      //             each on its own little arc with spin;
      //   square  — the pile squashes flat with a pulse.
      const p = 1 - this.riffle; // 0 -> 1 over the animation
      const SPLIT = 0.22, RIFFLE = 0.78;
      if (p < SPLIT) {
        const e = p / SPLIT;
        const gap = Math.sin(e * Math.PI / 2) * w * 0.72;
        const tilt = Math.sin(e * Math.PI / 2) * 0.3;
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(side * gap, -Math.sin(e * Math.PI) * h * 0.06);
          ctx.rotate(side * tilt);
          for (let i = 2; i >= 0; i--) {
            ctx.save(); ctx.translate(i * 2, i * 2 - 2); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
          }
          ctx.restore();
        }
      } else if (p < RIFFLE) {
        const e = (p - SPLIT) / (RIFFLE - SPLIT);
        const CARDS = 12;
        for (let i = 0; i < CARDS; i++) {
          const side = i % 2 ? 1 : -1;
          // Each card gets a slice of the phase; later cards start further out.
          const start = i / CARDS * 0.7;
          const t = Math.max(0, Math.min(1, (e - start) / 0.3));
          const ez = 1 - Math.pow(1 - t, 3);
          const gap = w * 0.72 * (1 - ez);
          const lift = Math.sin(ez * Math.PI) * h * (0.18 + (i % 3) * 0.05);
          const spin = side * (1 - ez) * (0.35 + (i % 4) * 0.08);
          ctx.save();
          ctx.translate(side * gap, -lift + (CARDS - i) * 0.8 - 5);
          ctx.rotate(spin);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.restore();
        }
      } else {
        const e = (p - RIFFLE) / (1 - RIFFLE);
        const squash = 1 + Math.sin(e * Math.PI) * 0.06;
        ctx.save();
        ctx.scale(squash, 2 - squash);
        for (let i = 2; i >= 0; i--) {
          ctx.save(); ctx.translate(i * 2.5, i * 2.5 - 2.5); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
        }
        ctx.restore();
      }
    } else {
      for (let i = 2; i >= 0; i--) {
        if (empty && i > 0) continue;
        ctx.save();
        ctx.globalAlpha = empty ? 0.35 : 1;
        ctx.translate(i * 2.5, i * 2.5 - 2.5);
        if (i === 0 && !empty) ctx.rotate(DECK_ASKEW);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    ctx.font = `${Math.max(11, Math.round(w * 0.09))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(this.view.replace() ? `${this.view.remaining()} · replace` : `${this.view.remaining()} left`, this.x, this.y + h / 2 + Math.max(16, w * 0.13));
    ctx.restore();
  }
  throwWith() {}
  spinInPlace() {}
}

// The discard: dealt cards lying face-up beside the deck, top card showing,
// slightly askew the way a real pile ends up. Grows as hands are swept in,
// vanishes into the deck on a shuffle.
class DiscardPileSprite {
  // `hold` = {count, top, for}: what the pile looked like before this deal's
  // sweep, shown until the swept cards' flight lands. Without it the pile
  // would flash the incoming card on top while that card is still visibly
  // travelling towards it.
  constructor(x, y, w, view = cardsView, hold = null) {
    this.x = x; this.y = y; this.size = w;
    this.view = view;
    this.hold = hold && hold.for > 0 ? hold : null;
    this.isCard = true; this.isDiscard = true;
    this.stageKind = 'deck-discard';
    this.settled = true; this.settling = true; this.settleT = 1;
    this.value = this.hold ? null : 'discard';
  }
  step(dt) {
    if (this.hold) {
      this.hold.for -= dt;
      if (this.hold.for <= 0) { this.hold = null; this.value = 'discard'; }
    }
  }
  draw(ctx) {
    const top = this.hold ? this.hold.top : this.view.discardTop();
    const count = this.hold ? this.hold.count : this.view.discard();
    if (count === 0 || !top) return;
    const w = this.size, h = w * this.view.ratio;
    const img = liveCardImage(this.view.image(top.id));
    if (!img) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    const under = Math.min(2, count - 1);
    for (let i = under; i >= 1; i--) {
      ctx.save();
      ctx.rotate(i % 2 ? 0.05 : -0.04);
      ctx.translate(-i * 2, -i * 2);
      ctx.globalAlpha = 0.55;
      const back = liveCardImage(this.view.image('back'));
      if (back) ctx.drawImage(back, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.rotate(top.rev ? Math.PI - 0.03 : -0.03);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    ctx.font = `${Math.max(10, Math.round(w * 0.13))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${count} dealt`, this.x, this.y + h / 2 + Math.max(14, w * 0.18));
    ctx.restore();
  }
  throwWith() {}
  spinInPlace() {}
}

// Where the deck and the drawn cards sit, by how many were drawn. One card is
// the whole show — it lands ON the deck, big; a small hand is a large centred
// row; a big hand becomes a neat grid (like a fistful of dice) with the deck
// stepping aside to the corner. Idle, the deck fills the stage.
function deckLayout(n, view = cardsView) {
  const b = state.bounds;
  const RATIO = view.ratio;
  const W_ = b.right - b.left, H_ = b.floor - b.top;
  const cx = b.left + W_ / 2, cy = b.top + H_ / 2;

  const discardW = Math.max(44, Math.min(64, W_ * 0.12));
  const discard = { x: b.right - discardW / 2 - 12, y: b.floor - (discardW * RATIO) / 2 - 20, w: discardW };
  if (n === 0) {
    const w = Math.min((H_ * 0.72) / RATIO, W_ * 0.5);
    return { stack: { x: cx - (view.discard() ? W_ * 0.04 : 0), y: cy, w }, slots: [], discard };
  }
  if (n === 1) {
    // The drawn card covers the deck, offset just enough that the deck still
    // reads as underneath it.
    const w = Math.min((H_ * 0.78) / RATIO, W_ * 0.6);
    return {
      stack: { x: cx - w * 0.16, y: cy - w * 0.12, w: w * 0.94 },
      slots: [{ x: cx + w * 0.09, y: cy + w * 0.07, w }],
      discard,
    };
  }
  // The deck steps aside; the hand takes the table.
  const stackW = Math.max(48, Math.min(78, W_ * 0.15));
  const stack = { x: b.right - stackW / 2 - 10, y: b.top + (stackW * RATIO) / 2 + 8, w: stackW };
  const areaL = b.left + 8, areaR = b.right - 8, areaT = b.top + 8, areaB = b.floor - 10;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((areaR - areaL) / cols - 10, ((areaB - areaT) / rows - 12) / RATIO, 200);
    if (!best || w > best.w) best = { cols, rows, w };
  }
  const { cols, rows, w } = best;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const c = i - r * cols;
    const rowW = inRow * (w + 10) - 10;
    slots.push({
      x: areaL + (areaR - areaL) / 2 - rowW / 2 + c * (w + 10) + w / 2,
      y: areaT + (areaB - areaT) / 2 + (r - (rows - 1) / 2) * (w * RATIO + 12),
      w,
    });
  }
  return { stack, slots, discard };
}

// The idle tray in Cards mode: just the deck, waiting.
function stageDeckIdle() {
  if (!cardArt) return;
  // A brand-new deck arrives shuffled, like one out of the box should.
  if (deckState.order.length === 0) { reshuffleDeck(); syncCardsUI({ writeField: false, restage: false }); }
  const { stack, discard } = deckLayout(0);
  state.dice = [new DeckStackSprite(stack.x, stack.y, stack.w)];
  if (deckState.pile.length > 0) state.dice.push(new DiscardPileSprite(discard.x, discard.y, discard.w));
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
  const { stack, slots, discard } = deckLayout(n);
  // The deck is continuous: the new stack sprite starts where the old one sat
  // and glides to its new spot (aside for a hand, underneath for one card).
  const prev = state.dice.find(d => d.isStack);
  const stackSprite = new DeckStackSprite(prev ? prev.x : stack.x, prev ? prev.y : stack.y, prev ? prev.size : stack.w);
  if (prev && (prev.x !== stack.x || prev.size !== stack.w)) stackSprite.moveTo(stack.x, stack.y, stack.w);
  else { stackSprite.x = stack.x; stackSprite.y = stack.y; stackSprite.size = stack.w; }
  const dealFrom = { x: prev ? prev.x : stack.x, y: prev ? prev.y : stack.y };
  const sprites = [stackSprite];

  // The previous hand leaves the table first: home to the deck in Replace
  // mode, face-up onto the discard pile otherwise.
  let delay0 = 0;
  if (!remote) {
    for (const d of state.dice) {
      if (d.isCard && !d.isStack && !d.isDiscard && d.phase === 'idle' && !d.gone) {
        const dest = lastSweptReplace
          ? { to: { x: stack.x, y: stack.y, w: d.size }, mode: 'return' }
          : { to: { x: discard.x, y: discard.y, w: discard.w }, mode: 'discard' };
        sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, dest.to, { mode: dest.mode }));
        delay0 = DEAL_S + 0.12;
      }
    }
  }
  if (!remote && deckState.pile.length > 0) {
    const prev = lastSweptPrevPile;
    const hold = delay0 > 0 && prev
      ? { count: prev.count, top: prev.top ? { id: prev.top, rev: false } : null, for: delay0 + DEAL_S + 0.08 }
      : null;
    sprites.push(new DiscardPileSprite(discard.x, discard.y, discard.w, cardsView, hold));
  }
  result.summary.drawn.forEach((c, i) => {
    sprites.push(new CardSprite(c.id, dealFrom, slots[i], { delay: delay0 + i * 0.12, remote }));
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
// The notation carries the deck's settings too, so a draw first brings the deck
// in line with them (reshuffling and clearing the table if what the deck holds
// changed), exactly as if the buttons had been set, then deals.
function dealFromNotation(notation) {
  let parsed;
  try { parsed = parseCards(notation); } catch (err) { showError(err.message); return; }
  clearError();
  state.remoteClaim = null;
  ensureCardArt()
    .then(() => {
      if (applyDeckFlags(parsed)) stageDeckIdle();
      return dealCardsFlow(drawDeckCards(parsed.draw));
    })
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
const deckFlagButtons = [...document.querySelectorAll('#cardsPicker .deck-flag')];

function syncCardsUI({ writeField = true, restage = true } = {}) {
  deckCountVal.textContent = String(deckState.draw);
  deckRemainVal.textContent = deckState.replace ? `${deckRemaining()}∞` : `${deckRemaining()}/${deckTotal()}`;
  for (const b of deckFlagButtons) {
    const on = b.dataset.flag === 'jokers' ? deckState.jokers : deckState.replace;
    b.setAttribute('aria-pressed', String(on));
  }
  if (writeField && uiSystem === 'cards') $('notation').value = deckNotation();
  if (restage && uiSystem === 'cards' && !$('total').dataset.rolling) stageDeckIdle();
}

bindTapHold($('deckCountChip'), dir => {
  deckState.draw = Math.max(1, Math.min(10, deckState.draw + dir));
  persistDeck();
  syncCardsUI({ restage: false });
});
$('deckShuffle').addEventListener('click', () => {
  ensureCardArt().then(() => {
    // Everything on the table and in the discard visibly flows back into the
    // deck, and the riffle starts once they arrive.
    const prevCards = state.dice.filter(d => d.isCard && !d.isStack && !d.isDiscard && !d.gone && d.phase === 'idle');
    const hadDiscard = deckState.pile.length > 0;
    const discardTop = deckState.pile[deckState.pile.length - 1];
    const prevDiscardSprite = state.dice.find(d => d.isDiscard);
    reshuffleDeck();
    const { stack } = deckLayout(0);
    const stackSprite = new DeckStackSprite(stack.x, stack.y, stack.w);
    const sprites = [stackSprite];
    for (const d of prevCards) {
      sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, { x: stack.x, y: stack.y, w: d.size }, { mode: 'return' }));
    }
    if (hadDiscard && discardTop && prevDiscardSprite) {
      // The pile goes home as a few backs peeling off in sequence.
      for (let i = 0; i < Math.min(3, deckStateDiscardWas(hadDiscard)); i++) {
        sprites.push(new CardSprite(discardTop, { x: prevDiscardSprite.x, y: prevDiscardSprite.y },
          { x: stack.x, y: stack.y, w: prevDiscardSprite.size }, { mode: 'return', delay: i * 0.07 }));
      }
    }
    const sweeping = sprites.length > 1;
    stackSprite.riffleAfter = sweeping ? 0.34 : 0.001;
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.idle = '1';
    $('total').dataset.kind = 'number';
    $('total').textContent = '—';
    $('breakdown').textContent = systemHint('cards').idle;
    if (navigator.vibrate) navigator.vibrate([6, 40, 6, 40, 6, 40, 10]);
    syncCardsUI({ restage: false });
  });
});
// The pile size just before the reshuffle zeroed it — for the sweep visuals.
function deckStateDiscardWas(had) { return had ? 3 : 0; }
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

// ---- the tarot deck ----
//
// The cards engine at 78: same persisted draw-without-replacement order, same
// stack/deal/riffle/discard sprites (via tarotView), plus reversals. Each
// card's orientation is fixed at shuffle time — the deck carries its reversals
// through the spread the way a physical deck does — and a reversed card lands
// upside down on the tray. The art is its own lazy module (tarot-art.js).
const TAROT_KEY = 'dicebox:tarot:v1';
const tarotState = {
  order: [], revs: [], pos: 0, reversals: true, replace: false, majors: false, draw: 1,
  // pile entries are {id, rev}, newest last, same contract as the cards pile.
  pile: [], hand: [], handReplace: false,
};
{
  try {
    const saved = JSON.parse(store.get(TAROT_KEY) || 'null');
    if (saved && Array.isArray(saved.order) && saved.order.every(x => typeof x === 'string')) {
      Object.assign(tarotState, saved, { draw: Math.max(1, Math.min(10, saved.draw || 1)) });
      if (!Array.isArray(tarotState.revs) || tarotState.revs.length !== tarotState.order.length) {
        tarotState.revs = tarotState.order.map(() => false);
      }
      // States saved before the pile held its contents carry over just the top.
      if (!Array.isArray(tarotState.pile)) {
        tarotState.pile = saved.discardTop && typeof saved.discardTop.id === 'string' ? [saved.discardTop] : [];
      }
      delete tarotState.discard;
      delete tarotState.discardTop;
      // A hand left on the table when the page closed folds into the discard,
      // exactly as the cards deck does.
      if (Array.isArray(tarotState.hand) && tarotState.hand.length && !tarotState.handReplace) {
        tarotState.pile.push(...tarotState.hand);
      }
      tarotState.hand = [];
    }
  } catch { /* fresh deck */ }
}
const persistTarot = () => store.set(TAROT_KEY, JSON.stringify(tarotState));

// The 78 ids, generated locally so the deck can shuffle before the art module
// arrives: 22 trumps then each suit's Ace-Ten and Page/Knight/Queen/King.
function tarotDeckIds() {
  const ids = [];
  for (let i = 0; i < 22; i++) ids.push('T' + String(i).padStart(2, '0'));
  // Majors-only: just the 22 trumps — the common quick-reading deck.
  if (tarotState.majors) return ids;
  for (const s of ['b', 'c', 's', 'd']) {
    for (const r of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', 'P', 'N', 'Q', 'K']) ids.push(s + r);
  }
  return ids;
}
const tarotTotal = () => (tarotState.majors ? 22 : 78);
const tarotRemaining = () => Math.max(0, tarotState.order.length - tarotState.pos);

let lastSweptReplaceTarot = false;

// The field's full description of the tarot deck. Reversals are on by default,
// so the field spells out "upright" to say they are off rather than carrying a
// token for the default; majors and replace show when on.
function tarotNotation() {
  let s = `tarot:${tarotState.draw}`;
  if (!tarotState.reversals) s += ' upright';
  if (tarotState.majors) s += ' majors';
  if (tarotState.replace) s += ' replace';
  return s;
}

// Bring the tarot deck in line with a parsed notation, like setting the
// buttons: majors changes what the deck holds and reshuffles; reversals only
// gates the orientations already dealt (turning it on with none dealt deals
// them for the undrawn cards, matching the toggle); replace just flips.
// Returns whether it reshuffled.
function applyTarotFlags({ reversals, majors, replace }) {
  let reshuffled = false;
  if (majors !== tarotState.majors) { tarotState.majors = majors; reshuffleTarot(); reshuffled = true; }
  if (reversals !== tarotState.reversals) {
    tarotState.reversals = reversals;
    if (reversals && !tarotState.revs.some(Boolean)) {
      for (let i = tarotState.pos; i < tarotState.revs.length; i++) tarotState.revs[i] = cryptoIndex(2) === 1;
    }
  }
  if (replace !== tarotState.replace) tarotState.replace = replace;
  if (!reshuffled) persistTarot();
  return reshuffled;
}

function reshuffleTarot() {
  tarotState.order = newDeckOrder(tarotDeckIds(), n => cryptoIndex(n) + 1);
  // Every shuffle deals orientations, whatever the Reversals flag says; the
  // flag only decides whether they apply at draw time. That makes the toggle
  // non-destructive: flipping it never resets the deck.
  tarotState.revs = tarotState.order.map(() => cryptoIndex(2) === 1);
  tarotState.pos = 0;
  tarotState.pile = [];
  tarotState.hand = [];
  persistTarot();
}

function drawTarotCards(n) {
  let picks;
  tarotState.draw = n;
  if (tarotState.order.length === 0) { reshuffleTarot(); syncTarotUI({ writeField: false, restage: false }); }
  if (tarotState.replace) {
    // Independent picks from what is still in the deck; the discard stays out
    // until a shuffle, and each pick keeps its shuffled orientation.
    const span = tarotState.order.length - tarotState.pos;
    picks = span > 0
      ? Array.from({ length: n }, () => {
        const i = tarotState.pos + cryptoIndex(span);
        return { id: tarotState.order[i], rev: tarotState.reversals && !!tarotState.revs[i] };
      })
      : [];
  } else {
    picks = [];
    for (let i = tarotState.pos; i < Math.min(tarotState.pos + n, tarotState.order.length); i++) {
      picks.push({ id: tarotState.order[i], rev: tarotState.reversals && !!tarotState.revs[i] });
    }
    tarotState.pos += picks.length;
    persistTarot();
  }
  lastSweptReplaceTarot = tarotState.handReplace;
  lastSweptPrevPile = { count: tarotState.pile.length, top: tarotState.pile.length ? tarotState.pile[tarotState.pile.length - 1] : null };
  if (tarotState.hand.length && !tarotState.handReplace) {
    tarotState.pile.push(...tarotState.hand);
  }
  tarotState.hand = picks.slice();
  tarotState.handReplace = tarotState.replace;
  persistTarot();
  const drawn = picks.map(p => ({ id: p.id, label: tarotArt.tarotMeta(p.id).label, rev: p.rev }));
  return {
    schema: 2,
    system: 'tarot',
    notation: tarotNotation(),
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeTarot(drawn, tarotRemaining(), tarotTotal()),
  };
}

let tarotArt = null;
let tarotArtLoading = null;
function ensureTarotArt() {
  if (tarotArt) return Promise.resolve(tarotArt);
  if (!tarotArtLoading) {
    /* global __dicebox */
    tarotArtLoading = (typeof __dicebox !== 'undefined' && __dicebox.tarotSVG)
      ? Promise.resolve(__dicebox)
      : import('./tarot-art.js');
    tarotArtLoading = tarotArtLoading.then(m => (tarotArt = m));
  }
  return tarotArtLoading;
}

const tarotImgCache = new Map();
function tarotImage(id) {
  const key = `${id}|${isDark() ? 'd' : 'l'}`;
  let entry = tarotImgCache.get(key);
  if (entry) return entry;
  const svg = tarotArt.tarotSVG(id, { dark: isDark() })
    .replace('<svg ', '<svg width="750" height="1290" ');
  const img = new Image();
  img.addEventListener('error', () => tarotImgCache.delete(key));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  entry = { img, ready: img.decode ? img.decode().catch(() => {}) : Promise.resolve() };
  // A decoded SVG image still costs the rasteriser on draw; a bitmap is a
  // straight blit. Swap it in once it exists — the entry keeps working either way.
  if (typeof createImageBitmap === 'function') {
    entry.ready = entry.ready
      .then(() => createImageBitmap(img))
      .then(bmp => { entry.img = bmp; })
      .catch(() => {});
  }
  tarotImgCache.set(key, entry);
  return entry;
}

// The idle tray in Tarot mode: the deck, waiting.
function stageTarotIdle() {
  if (!tarotArt) return;
  if (tarotState.order.length === 0) reshuffleTarot();
  const { stack, discard } = deckLayout(0, tarotView);
  state.dice = [new DeckStackSprite(stack.x, stack.y, stack.w, tarotView)];
  if (tarotState.pile.length > 0) state.dice.push(new DiscardPileSprite(discard.x, discard.y, discard.w, tarotView));
  dropIdleCache();
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint('tarot').idle;
  hideHint();
}

async function dealTarotFlow(result, { remote = false } = {}) {
  await ensureTarotArt();
  await tarotImage('back').ready;
  await Promise.all(result.summary.drawn.map(c => tarotImage(c.id).ready));

  const n = result.summary.drawn.length;
  const { stack, slots, discard } = deckLayout(n, tarotView);
  const prev = state.dice.find(d => d.isStack);
  const stackSprite = new DeckStackSprite(prev ? prev.x : stack.x, prev ? prev.y : stack.y, prev ? prev.size : stack.w, tarotView);
  if (prev && (prev.x !== stack.x || prev.size !== stack.w)) stackSprite.moveTo(stack.x, stack.y, stack.w);
  else { stackSprite.x = stack.x; stackSprite.y = stack.y; stackSprite.size = stack.w; }
  const dealFrom = { x: prev ? prev.x : stack.x, y: prev ? prev.y : stack.y };
  const sprites = [stackSprite];

  let delay0 = 0;
  if (!remote) {
    for (const d of state.dice) {
      if (d.isCard && !d.isStack && !d.isDiscard && d.phase === 'idle' && !d.gone) {
        const dest = lastSweptReplaceTarot
          ? { to: { x: stack.x, y: stack.y, w: d.size }, mode: 'return' }
          : { to: { x: discard.x, y: discard.y, w: discard.w }, mode: 'discard' };
        sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, dest.to, { mode: dest.mode, view: tarotView, rev: d.rev }));
        delay0 = DEAL_S + 0.12;
      }
    }
  }
  if (!remote && tarotState.pile.length > 0) {
    const prev = lastSweptPrevPile;
    const hold = delay0 > 0 && prev ? { count: prev.count, top: prev.top, for: delay0 + DEAL_S + 0.08 } : null;
    sprites.push(new DiscardPileSprite(discard.x, discard.y, discard.w, tarotView, hold));
  }
  result.summary.drawn.forEach((c, i) => {
    sprites.push(new CardSprite(c.id, dealFrom, slots[i], { delay: delay0 + i * 0.12, remote, view: tarotView, rev: !!c.rev }));
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

function dealTarotFlowRemote(result, claim) {
  const preload = [tarotImage('back').ready, ...result.summary.drawn.map(c => tarotImage(c.id).ready)];
  Promise.all(preload).then(() => {
    if (state.remoteClaim !== claim) return;
    const n = result.summary.drawn.length;
    const { stack, slots } = deckLayout(n, tarotView);
    const sprites = [new DeckStackSprite(stack.x, stack.y, stack.w, tarotView)];
    result.summary.drawn.forEach((c, i) => {
      sprites.push(new CardSprite(c.id, { x: stack.x, y: stack.y }, slots[i], { delay: i * 0.12, remote: true, view: tarotView, rev: !!c.rev }));
    });
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.rolling = '1';
    setTimeout(() => {
      if (state.remoteClaim !== claim) return;
      delete $('total').dataset.rolling;
      delete $('total').dataset.idle;
      setTotal(tarotHeadline(result));
      $('breakdown').textContent = describeTarot(result);
    }, (n * 0.12 + DEAL_S + FLIP_S) * 1000 + 160);
  });
}

function dealFromTarotNotation(notation) {
  let parsed;
  try { parsed = parseTarot(notation); } catch (err) { showError(err.message); return; }
  clearError();
  state.remoteClaim = null;
  ensureTarotArt()
    .then(() => {
      if (applyTarotFlags(parsed)) stageTarotIdle();
      return dealTarotFlow(drawTarotCards(parsed.draw));
    })
    .then(res => {
      state.last = res;
      $('notation').value = res.notation;
      syncTarotUI({ writeField: false, restage: false });
    })
    .catch(err => showError(String((err && err.message) || err)));
}

// ---- the tarot picker ----
const tarotPicker = $('tarotPicker');
const tarotCountVal = $('tarotCount');
const tarotRemainVal = $('tarotRemain');
const tarotFlagButtons = [...document.querySelectorAll('#tarotPicker .deck-flag')];

function syncTarotUI({ writeField = true, restage = true } = {}) {
  tarotCountVal.textContent = String(tarotState.draw);
  tarotRemainVal.textContent = tarotState.replace ? `${tarotRemaining()}∞` : `${tarotRemaining()}/${tarotTotal()}`;
  for (const b of tarotFlagButtons) {
    const on = b.dataset.flag === 'rev' ? tarotState.reversals
      : b.dataset.flag === 'majors' ? tarotState.majors
      : tarotState.replace;
    b.setAttribute('aria-pressed', String(on));
  }
  if (writeField && uiSystem === 'tarot') $('notation').value = tarotNotation();
  if (restage && uiSystem === 'tarot' && !$('total').dataset.rolling) stageTarotIdle();
}

bindTapHold($('tarotCountChip'), dir => {
  tarotState.draw = Math.max(1, Math.min(10, tarotState.draw + dir));
  persistTarot();
  syncTarotUI({ restage: false });
});
$('tarotShuffle').addEventListener('click', () => {
  ensureTarotArt().then(() => {
    const prevCards = state.dice.filter(d => d.isCard && !d.isStack && !d.isDiscard && !d.gone && d.phase === 'idle');
    const hadDiscard = tarotState.pile.length > 0;
    const discardTop = tarotState.pile[tarotState.pile.length - 1];
    const prevDiscardSprite = state.dice.find(d => d.isDiscard);
    reshuffleTarot();
    const { stack } = deckLayout(0, tarotView);
    const stackSprite = new DeckStackSprite(stack.x, stack.y, stack.w, tarotView);
    const sprites = [stackSprite];
    for (const d of prevCards) {
      sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, { x: stack.x, y: stack.y, w: d.size }, { mode: 'return', view: tarotView }));
    }
    if (hadDiscard && discardTop && prevDiscardSprite) {
      for (let i = 0; i < 3; i++) {
        sprites.push(new CardSprite(discardTop.id, { x: prevDiscardSprite.x, y: prevDiscardSprite.y },
          { x: stack.x, y: stack.y, w: prevDiscardSprite.size }, { mode: 'return', delay: i * 0.07, view: tarotView }));
      }
    }
    const sweeping = sprites.length > 1;
    stackSprite.riffleAfter = sweeping ? 0.34 : 0.001;
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.idle = '1';
    $('total').dataset.kind = 'number';
    $('total').textContent = '—';
    $('breakdown').textContent = systemHint('tarot').idle;
    if (navigator.vibrate) navigator.vibrate([6, 40, 6, 40, 6, 40, 10]);
    syncTarotUI({ restage: false });
  });
});
for (const b of tarotFlagButtons) {
  b.addEventListener('click', () => {
    if (b.dataset.flag === 'rev') {
      // Orientations were dealt at shuffle time either way; the flag only
      // gates whether they apply, so toggling never resets the deck. Decks
      // shuffled before orientations were always dealt get theirs now, for
      // the undrawn cards only.
      tarotState.reversals = !tarotState.reversals;
      if (tarotState.reversals && !tarotState.revs.some(Boolean)) {
        for (let i = tarotState.pos; i < tarotState.revs.length; i++) tarotState.revs[i] = cryptoIndex(2) === 1;
      }
      persistTarot();
    } else if (b.dataset.flag === 'majors') {
      // Changing what the deck contains means a fresh shuffle — the same rule
      // as the jokers toggle over in Cards.
      tarotState.majors = !tarotState.majors;
      reshuffleTarot();
    } else {
      tarotState.replace = !tarotState.replace;
      persistTarot();
    }
    syncTarotUI();
  });
}

function syncTarotFromField() {
  try {
    const { draw } = parseTarot($('notation').value);
    tarotState.draw = draw;
    persistTarot();
    syncTarotUI({ writeField: false, restage: false });
  } catch { /* mid-type */ }
}

// ---- le carte napoletane ----
//
// The 40-card Neapolitan deck — the third deck on the same engine. Four
// Italian suits (denari, coppe, spade, bastoni: the same enseignes as the
// tarot's minors), ranks Asso-Sette plus Fante, Cavallo, Re. No jokers, no
// reversals; the one flag is Replace. The art is traced from a deck printed
// in Naples itself in 1902 (nap-art.js, lazy like the others).
const NAP_KEY = 'dicebox:nap:v1';
const napState = {
  order: [], pos: 0, replace: false, draw: 1,
  pile: [], hand: [], handReplace: false,
};
{
  try {
    const saved = JSON.parse(store.get(NAP_KEY) || 'null');
    if (saved && Array.isArray(saved.order) && saved.order.every(x => typeof x === 'string')) {
      Object.assign(napState, saved, { draw: Math.max(1, Math.min(10, saved.draw || 1)) });
      if (!Array.isArray(napState.pile)) napState.pile = [];
      if (Array.isArray(napState.hand) && napState.hand.length && !napState.handReplace) {
        napState.pile.push(...napState.hand);
      }
      napState.hand = [];
    }
  } catch { /* fresh deck */ }
}
const persistNap = () => store.set(NAP_KEY, JSON.stringify(napState));

function napDeckIds() {
  const ids = [];
  for (const s of ['d', 'c', 's', 'b']) {
    for (const r of ['01', '02', '03', '04', '05', '06', '07', 'F', 'C', 'R']) ids.push(s + r);
  }
  return ids;
}
const napTotal = () => 40;
const napRemaining = () => Math.max(0, napState.order.length - napState.pos);

let lastSweptReplaceNap = false;

function napNotation() {
  let s = `nap:${napState.draw}`;
  if (napState.replace) s += ' replace';
  return s;
}

function applyNapFlags({ replace }) {
  if (replace !== napState.replace) { napState.replace = replace; persistNap(); }
  return false; // nothing here changes what the deck contains
}

function reshuffleNap() {
  napState.order = newDeckOrder(napDeckIds(), n => cryptoIndex(n) + 1);
  napState.pos = 0;
  napState.pile = [];
  napState.hand = [];
  persistNap();
}

function drawNapCards(n) {
  let ids;
  napState.draw = n;
  if (napState.order.length === 0) reshuffleNap();
  if (napState.replace) {
    const pool = napState.order.slice(napState.pos);
    ids = pool.length ? Array.from({ length: n }, () => pool[cryptoIndex(pool.length)]) : [];
  } else {
    ids = napState.order.slice(napState.pos, napState.pos + n);
    napState.pos += ids.length;
    persistNap();
  }
  lastSweptReplaceNap = napState.handReplace;
  lastSweptPrevPile = { count: napState.pile.length, top: napState.pile.length ? napState.pile[napState.pile.length - 1] : null };
  if (napState.hand.length && !napState.handReplace) {
    napState.pile.push(...napState.hand);
  }
  napState.hand = ids.slice();
  napState.handReplace = napState.replace;
  persistNap();
  const drawn = ids.map(id => ({ id, label: napArt.napMeta(id).label, red: false }));
  return {
    schema: 2,
    system: 'napoletane',
    notation: napNotation(),
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeCards(drawn, napRemaining(), napTotal()),
  };
}

let napArt = null;
let napArtLoading = null;
function ensureNapArt() {
  if (napArt) return Promise.resolve(napArt);
  if (!napArtLoading) {
    /* global __dicebox */
    napArtLoading = (typeof __dicebox !== 'undefined' && __dicebox.napSVG)
      ? Promise.resolve(__dicebox)
      : import('./nap-art.js');
    napArtLoading = napArtLoading.then(m => (napArt = m));
  }
  return napArtLoading;
}

const napImgCache = new Map();
function napImage(id) {
  const key = `${id}|${isDark() ? 'd' : 'l'}`;
  let entry = napImgCache.get(key);
  if (entry) return entry;
  const svg = napArt.napSVG(id, { dark: isDark() })
    .replace('<svg ', '<svg width="750" height="1164" ');
  const img = new Image();
  img.addEventListener('error', () => napImgCache.delete(key));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  entry = { img, ready: img.decode ? img.decode().catch(() => {}) : Promise.resolve() };
  // A decoded SVG image still costs the rasteriser on draw; a bitmap is a
  // straight blit. Swap it in once it exists — the entry keeps working either way.
  if (typeof createImageBitmap === 'function') {
    entry.ready = entry.ready
      .then(() => createImageBitmap(img))
      .then(bmp => { entry.img = bmp; })
      .catch(() => {});
  }
  napImgCache.set(key, entry);
  return entry;
}

function stageNapIdle() {
  if (!napArt) return;
  if (napState.order.length === 0) { reshuffleNap(); syncNapUI({ writeField: false, restage: false }); }
  const { stack, discard } = deckLayout(0, napView);
  state.dice = [new DeckStackSprite(stack.x, stack.y, stack.w, napView)];
  if (napState.pile.length > 0) state.dice.push(new DiscardPileSprite(discard.x, discard.y, discard.w, napView));
  dropIdleCache();
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint('napoletane').idle;
  hideHint();
}

async function dealNapFlow(result, { remote = false } = {}) {
  await ensureNapArt();
  await napImage('back').ready;
  await Promise.all(result.summary.drawn.map(c => napImage(c.id).ready));

  const n = result.summary.drawn.length;
  const { stack, slots, discard } = deckLayout(n, napView);
  const prev = state.dice.find(d => d.isStack);
  const stackSprite = new DeckStackSprite(prev ? prev.x : stack.x, prev ? prev.y : stack.y, prev ? prev.size : stack.w, napView);
  if (prev && (prev.x !== stack.x || prev.size !== stack.w)) stackSprite.moveTo(stack.x, stack.y, stack.w);
  else { stackSprite.x = stack.x; stackSprite.y = stack.y; stackSprite.size = stack.w; }
  const dealFrom = { x: prev ? prev.x : stack.x, y: prev ? prev.y : stack.y };
  const sprites = [stackSprite];

  let delay0 = 0;
  if (!remote) {
    for (const d of state.dice) {
      if (d.isCard && !d.isStack && !d.isDiscard && d.phase === 'idle' && !d.gone) {
        const dest = lastSweptReplaceNap
          ? { to: { x: stack.x, y: stack.y, w: d.size }, mode: 'return' }
          : { to: { x: discard.x, y: discard.y, w: discard.w }, mode: 'discard' };
        sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, dest.to, { mode: dest.mode, view: napView }));
        delay0 = DEAL_S + 0.12;
      }
    }
  }
  if (!remote && napState.pile.length > 0) {
    const prev = lastSweptPrevPile;
    const hold = delay0 > 0 && prev
      ? { count: prev.count, top: prev.top ? { id: prev.top, rev: false } : null, for: delay0 + DEAL_S + 0.08 }
      : null;
    sprites.push(new DiscardPileSprite(discard.x, discard.y, discard.w, napView, hold));
  }
  result.summary.drawn.forEach((c, i) => {
    sprites.push(new CardSprite(c.id, dealFrom, slots[i], { delay: delay0 + i * 0.12, remote, view: napView }));
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

function dealNapFlowRemote(result, claim) {
  const preload = [napImage('back').ready, ...result.summary.drawn.map(c => napImage(c.id).ready)];
  Promise.all(preload).then(() => {
    if (state.remoteClaim !== claim) return;
    const n = result.summary.drawn.length;
    const { stack, slots } = deckLayout(n, napView);
    const sprites = [new DeckStackSprite(stack.x, stack.y, stack.w, napView)];
    result.summary.drawn.forEach((c, i) => {
      sprites.push(new CardSprite(c.id, { x: stack.x, y: stack.y }, slots[i], { delay: i * 0.12, remote: true, view: napView }));
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

function dealFromNapNotation(notation) {
  let parsed;
  try { parsed = parseNapoletane(notation); } catch (err) { showError(err.message); return; }
  clearError();
  state.remoteClaim = null;
  ensureNapArt()
    .then(() => {
      applyNapFlags(parsed);
      return dealNapFlow(drawNapCards(parsed.draw));
    })
    .then(res => {
      state.last = res;
      $('notation').value = res.notation;
      syncNapUI({ writeField: false, restage: false });
    })
    .catch(err => showError(String((err && err.message) || err)));
}

// ---- the napoletane picker ----
const napPicker = $('napPicker');
const napCountVal = $('napCount');
const napRemainVal = $('napRemain');
const napFlagButtons = [...document.querySelectorAll('#napPicker .deck-flag')];

function syncNapUI({ writeField = true, restage = true } = {}) {
  napCountVal.textContent = String(napState.draw);
  napRemainVal.textContent = napState.replace ? `${napRemaining()}∞` : `${napRemaining()}/${napTotal()}`;
  for (const b of napFlagButtons) {
    b.setAttribute('aria-pressed', String(napState.replace));
  }
  if (writeField && uiSystem === 'napoletane') $('notation').value = napNotation();
  if (restage && uiSystem === 'napoletane' && !$('total').dataset.rolling) stageNapIdle();
}

bindTapHold($('napCountChip'), dir => {
  napState.draw = Math.max(1, Math.min(10, napState.draw + dir));
  persistNap();
  syncNapUI({ restage: false });
});
$('napShuffle').addEventListener('click', () => {
  ensureNapArt().then(() => {
    const prevCards = state.dice.filter(d => d.isCard && !d.isStack && !d.isDiscard && !d.gone && d.phase === 'idle');
    const hadDiscard = napState.pile.length > 0;
    const discardTop = napState.pile[napState.pile.length - 1];
    const prevDiscardSprite = state.dice.find(d => d.isDiscard);
    reshuffleNap();
    const { stack } = deckLayout(0, napView);
    const stackSprite = new DeckStackSprite(stack.x, stack.y, stack.w, napView);
    const sprites = [stackSprite];
    for (const d of prevCards) {
      sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, { x: stack.x, y: stack.y, w: d.size }, { mode: 'return', view: napView }));
    }
    if (hadDiscard && discardTop && prevDiscardSprite) {
      for (let i = 0; i < 3; i++) {
        sprites.push(new CardSprite(discardTop, { x: prevDiscardSprite.x, y: prevDiscardSprite.y },
          { x: stack.x, y: stack.y, w: prevDiscardSprite.size }, { mode: 'return', delay: i * 0.07, view: napView }));
      }
    }
    const sweeping = sprites.length > 1;
    stackSprite.riffleAfter = sweeping ? 0.34 : 0.001;
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.idle = '1';
    $('total').dataset.kind = 'number';
    $('total').textContent = '—';
    $('breakdown').textContent = systemHint('napoletane').idle;
    if (navigator.vibrate) navigator.vibrate([6, 40, 6, 40, 6, 40, 10]);
    syncNapUI({ restage: false });
  });
});
for (const b of napFlagButtons) {
  b.addEventListener('click', () => {
    napState.replace = !napState.replace;
    persistNap();
    syncNapUI();
  });
}

function syncNapFromField() {
  try {
    const { draw } = parseNapoletane($('notation').value);
    napState.draw = draw;
    persistNap();
    syncNapUI({ writeField: false, restage: false });
  } catch { /* mid-type */ }
}

// ---- hanafuda ----
//
// The 48-card Japanese flower deck: twelve months, each a flower, each holding
// four cards — brights, animals, ribbons and chaff (hikari, tane, tanzaku,
// kasu). Same draw engine as the other decks; the one flag is replace. The art
// is Louie Mantia and すけじょ's traditional-colour set (hana-art.js, CC
// BY-SA 4.0 — the one deck in the box that isn't ours, credited in the help).
const HANA_KEY = 'dicebox:hana:v1';
const hanaState = {
  order: [], pos: 0, replace: false, draw: 1,
  pile: [], hand: [], handReplace: false,
};
{
  try {
    const saved = JSON.parse(store.get(HANA_KEY) || 'null');
    if (saved && Array.isArray(saved.order) && saved.order.every(x => typeof x === 'string')) {
      Object.assign(hanaState, saved, { draw: Math.max(1, Math.min(10, saved.draw || 1)) });
      if (!Array.isArray(hanaState.pile)) hanaState.pile = [];
      if (Array.isArray(hanaState.hand) && hanaState.hand.length && !hanaState.handReplace) {
        hanaState.pile.push(...hanaState.hand);
      }
      hanaState.hand = [];
    }
  } catch { /* fresh deck */ }
}
const persistHana = () => store.set(HANA_KEY, JSON.stringify(hanaState));

// The id list lives in the art module; every caller that shuffles has already
// awaited ensureHanaArt, so this never races the import.
function hanaDeckIds() { return hanaArt.HANA_IDS.slice(); }
const hanaTotal = () => 48;
const hanaRemaining = () => Math.max(0, hanaState.order.length - hanaState.pos);

let lastSweptReplaceHana = false;

function hanaNotation() {
  let s = `hana:${hanaState.draw}`;
  if (hanaState.replace) s += ' replace';
  return s;
}

function applyHanaFlags({ replace }) {
  if (replace !== hanaState.replace) { hanaState.replace = replace; persistHana(); }
  return false; // nothing here changes what the deck contains
}

function reshuffleHana() {
  hanaState.order = newDeckOrder(hanaDeckIds(), n => cryptoIndex(n) + 1);
  hanaState.pos = 0;
  hanaState.pile = [];
  hanaState.hand = [];
  persistHana();
}

function drawHanaCards(n) {
  let ids;
  hanaState.draw = n;
  if (hanaState.order.length === 0) reshuffleHana();
  if (hanaState.replace) {
    const pool = hanaState.order.slice(hanaState.pos);
    ids = pool.length ? Array.from({ length: n }, () => pool[cryptoIndex(pool.length)]) : [];
  } else {
    ids = hanaState.order.slice(hanaState.pos, hanaState.pos + n);
    hanaState.pos += ids.length;
    persistHana();
  }
  lastSweptReplaceHana = hanaState.handReplace;
  lastSweptPrevPile = { count: hanaState.pile.length, top: hanaState.pile.length ? hanaState.pile[hanaState.pile.length - 1] : null };
  if (hanaState.hand.length && !hanaState.handReplace) {
    hanaState.pile.push(...hanaState.hand);
  }
  hanaState.hand = ids.slice();
  hanaState.handReplace = hanaState.replace;
  persistHana();
  const drawn = ids.map(id => ({ id, label: hanaArt.hanaMeta(id).label, red: false }));
  return {
    schema: 2,
    system: 'hanafuda',
    notation: hanaNotation(),
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeCards(drawn, hanaRemaining(), hanaTotal()),
  };
}

let hanaArt = null;
let hanaArtLoading = null;
function ensureHanaArt() {
  if (hanaArt) return Promise.resolve(hanaArt);
  if (!hanaArtLoading) {
    /* global __dicebox */
    hanaArtLoading = (typeof __dicebox !== 'undefined' && __dicebox.hanaSVG)
      ? Promise.resolve(__dicebox)
      : import('./hana-art.js');
    hanaArtLoading = hanaArtLoading.then(m => (hanaArt = m));
  }
  return hanaArtLoading;
}

const hanaImgCache = new Map();
function hanaImage(id) {
  const key = `${id}|${isDark() ? 'd' : 'l'}`;
  let entry = hanaImgCache.get(key);
  if (entry) return entry;
  const svg = hanaArt.hanaSVG(id, { dark: isDark() })
    .replace('<svg ', '<svg width="732" height="1200" ');
  const img = new Image();
  img.addEventListener('error', () => hanaImgCache.delete(key));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  entry = { img, ready: img.decode ? img.decode().catch(() => {}) : Promise.resolve() };
  if (typeof createImageBitmap === 'function') {
    entry.ready = entry.ready
      .then(() => createImageBitmap(img))
      .then(bmp => { entry.img = bmp; })
      .catch(() => {});
  }
  hanaImgCache.set(key, entry);
  return entry;
}

function stageHanaIdle() {
  if (!hanaArt) return;
  if (hanaState.order.length === 0) { reshuffleHana(); syncHanaUI({ writeField: false, restage: false }); }
  const { stack, discard } = deckLayout(0, hanaView);
  state.dice = [new DeckStackSprite(stack.x, stack.y, stack.w, hanaView)];
  if (hanaState.pile.length > 0) state.dice.push(new DiscardPileSprite(discard.x, discard.y, discard.w, hanaView));
  dropIdleCache();
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint('hanafuda').idle;
  hideHint();
}

async function dealHanaFlow(result, { remote = false } = {}) {
  await ensureHanaArt();
  await hanaImage('back').ready;
  await Promise.all(result.summary.drawn.map(c => hanaImage(c.id).ready));

  const n = result.summary.drawn.length;
  const { stack, slots, discard } = deckLayout(n, hanaView);
  const prev = state.dice.find(d => d.isStack);
  const stackSprite = new DeckStackSprite(prev ? prev.x : stack.x, prev ? prev.y : stack.y, prev ? prev.size : stack.w, hanaView);
  if (prev && (prev.x !== stack.x || prev.size !== stack.w)) stackSprite.moveTo(stack.x, stack.y, stack.w);
  else { stackSprite.x = stack.x; stackSprite.y = stack.y; stackSprite.size = stack.w; }
  const dealFrom = { x: prev ? prev.x : stack.x, y: prev ? prev.y : stack.y };
  const sprites = [stackSprite];

  let delay0 = 0;
  if (!remote) {
    for (const d of state.dice) {
      if (d.isCard && !d.isStack && !d.isDiscard && d.phase === 'idle' && !d.gone) {
        const dest = lastSweptReplaceHana
          ? { to: { x: stack.x, y: stack.y, w: d.size }, mode: 'return' }
          : { to: { x: discard.x, y: discard.y, w: discard.w }, mode: 'discard' };
        sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, dest.to, { mode: dest.mode, view: hanaView }));
        delay0 = DEAL_S + 0.12;
      }
    }
  }
  if (!remote && hanaState.pile.length > 0) {
    const prev = lastSweptPrevPile;
    const hold = delay0 > 0 && prev
      ? { count: prev.count, top: prev.top ? { id: prev.top, rev: false } : null, for: delay0 + DEAL_S + 0.08 }
      : null;
    sprites.push(new DiscardPileSprite(discard.x, discard.y, discard.w, hanaView, hold));
  }
  result.summary.drawn.forEach((c, i) => {
    sprites.push(new CardSprite(c.id, dealFrom, slots[i], { delay: delay0 + i * 0.12, remote, view: hanaView }));
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

function dealHanaFlowRemote(result, claim) {
  const preload = [hanaImage('back').ready, ...result.summary.drawn.map(c => hanaImage(c.id).ready)];
  Promise.all(preload).then(() => {
    if (state.remoteClaim !== claim) return;
    const n = result.summary.drawn.length;
    const { stack, slots } = deckLayout(n, hanaView);
    const sprites = [new DeckStackSprite(stack.x, stack.y, stack.w, hanaView)];
    result.summary.drawn.forEach((c, i) => {
      sprites.push(new CardSprite(c.id, { x: stack.x, y: stack.y }, slots[i], { delay: i * 0.12, remote: true, view: hanaView }));
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

function dealFromHanaNotation(notation) {
  let parsed;
  try { parsed = parseHanafuda(notation); } catch (err) { showError(err.message); return; }
  clearError();
  state.remoteClaim = null;
  ensureHanaArt()
    .then(() => {
      applyHanaFlags(parsed);
      return dealHanaFlow(drawHanaCards(parsed.draw));
    })
    .then(res => {
      state.last = res;
      $('notation').value = res.notation;
      syncHanaUI({ writeField: false, restage: false });
    })
    .catch(err => showError(String((err && err.message) || err)));
}

// ---- the hanafuda picker ----
const hanaPicker = $('hanaPicker');
const hanaCountVal = $('hanaCount');
const hanaRemainVal = $('hanaRemain');
const hanaFlagButtons = [...document.querySelectorAll('#hanaPicker .deck-flag')];

function syncHanaUI({ writeField = true, restage = true } = {}) {
  hanaCountVal.textContent = String(hanaState.draw);
  hanaRemainVal.textContent = hanaState.replace ? `${hanaRemaining()}∞` : `${hanaRemaining()}/${hanaTotal()}`;
  for (const b of hanaFlagButtons) {
    b.setAttribute('aria-pressed', String(hanaState.replace));
  }
  if (writeField && uiSystem === 'hanafuda') $('notation').value = hanaNotation();
  if (restage && uiSystem === 'hanafuda' && !$('total').dataset.rolling) stageHanaIdle();
}

bindTapHold($('hanaCountChip'), dir => {
  hanaState.draw = Math.max(1, Math.min(10, hanaState.draw + dir));
  persistHana();
  syncHanaUI({ restage: false });
});
$('hanaShuffle').addEventListener('click', () => {
  ensureHanaArt().then(() => {
    const prevCards = state.dice.filter(d => d.isCard && !d.isStack && !d.isDiscard && !d.gone && d.phase === 'idle');
    const hadDiscard = hanaState.pile.length > 0;
    const discardTop = hanaState.pile[hanaState.pile.length - 1];
    const prevDiscardSprite = state.dice.find(d => d.isDiscard);
    reshuffleHana();
    const { stack } = deckLayout(0, hanaView);
    const stackSprite = new DeckStackSprite(stack.x, stack.y, stack.w, hanaView);
    const sprites = [stackSprite];
    for (const d of prevCards) {
      sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, { x: stack.x, y: stack.y, w: d.size }, { mode: 'return', view: hanaView }));
    }
    if (hadDiscard && discardTop && prevDiscardSprite) {
      for (let i = 0; i < 3; i++) {
        sprites.push(new CardSprite(discardTop, { x: prevDiscardSprite.x, y: prevDiscardSprite.y },
          { x: stack.x, y: stack.y, w: prevDiscardSprite.size }, { mode: 'return', delay: i * 0.07, view: hanaView }));
      }
    }
    const sweeping = sprites.length > 1;
    stackSprite.riffleAfter = sweeping ? 0.34 : 0.001;
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.idle = '1';
    $('total').dataset.kind = 'number';
    $('total').textContent = '—';
    $('breakdown').textContent = systemHint('hanafuda').idle;
    if (navigator.vibrate) navigator.vibrate([6, 40, 6, 40, 6, 40, 10]);
    syncHanaUI({ restage: false });
  });
});
for (const b of hanaFlagButtons) {
  b.addEventListener('click', () => {
    hanaState.replace = !hanaState.replace;
    persistHana();
    syncHanaUI();
  });
}

function syncHanaFromField() {
  try {
    const { draw } = parseHanafuda($('notation').value);
    hanaState.draw = draw;
    persistHana();
    syncHanaUI({ writeField: false, restage: false });
  } catch { /* mid-type */ }
}

// ---- uta-garuta ----
//
// The 100 yomifuda of the Ogura Hyakunin Isshu: one poet, one poem, in
// Fujiwara no Teika's order from Emperor Tenji to Emperor Juntoku. Portraits
// and calligraphy are traced from Hishikawa Moronobu's illustrated edition
// (Edo, 1680), scanned by the Library of Congress. A single draw reads the
// whole poem into the breakdown; the categories (hime, bōzu) make Bōzu
// Mekuri playable off the same deck.
const UTA_KEY = 'dicebox:uta:v1';
const utaState = {
  order: [], pos: 0, replace: false, draw: 1, lang: 'both',
  pile: [], hand: [], handReplace: false,
};
{
  try {
    const saved = JSON.parse(store.get(UTA_KEY) || 'null');
    if (saved && Array.isArray(saved.order) && saved.order.every(x => typeof x === 'string')) {
      Object.assign(utaState, saved, { draw: Math.max(1, Math.min(10, saved.draw || 1)) });
      if (!['both', 'ja', 'en'].includes(utaState.lang)) utaState.lang = 'both';
      if (!Array.isArray(utaState.pile)) utaState.pile = [];
      if (Array.isArray(utaState.hand) && utaState.hand.length && !utaState.handReplace) {
        utaState.pile.push(...utaState.hand);
      }
      utaState.hand = [];
    }
  } catch { /* fresh deck */ }
}
const persistUta = () => store.set(UTA_KEY, JSON.stringify(utaState));

function utaDeckIds() { return utaArt.UTA_IDS.slice(); }
const utaTotal = () => 100;
const utaRemaining = () => Math.max(0, utaState.order.length - utaState.pos);

let lastSweptReplaceUta = false;

function utaNotation() {
  let s = `uta:${utaState.draw}`;
  if (utaState.lang !== 'both') s += ` ${utaState.lang}`;
  if (utaState.replace) s += ' replace';
  return s;
}

function applyUtaFlags({ replace, lang }) {
  if (replace !== utaState.replace) { utaState.replace = replace; persistUta(); }
  if (lang && lang !== utaState.lang) { utaState.lang = lang; persistUta(); }
  return false;
}

function reshuffleUta() {
  utaState.order = newDeckOrder(utaDeckIds(), n => cryptoIndex(n) + 1);
  utaState.pos = 0;
  utaState.pile = [];
  utaState.hand = [];
  persistUta();
}

function drawUtaCards(n) {
  let ids;
  utaState.draw = n;
  if (utaState.order.length === 0) reshuffleUta();
  if (utaState.replace) {
    const pool = utaState.order.slice(utaState.pos);
    ids = pool.length ? Array.from({ length: n }, () => pool[cryptoIndex(pool.length)]) : [];
  } else {
    ids = utaState.order.slice(utaState.pos, utaState.pos + n);
    utaState.pos += ids.length;
    persistUta();
  }
  lastSweptReplaceUta = utaState.handReplace;
  lastSweptPrevPile = { count: utaState.pile.length, top: utaState.pile.length ? utaState.pile[utaState.pile.length - 1] : null };
  if (utaState.hand.length && !utaState.handReplace) {
    utaState.pile.push(...utaState.hand);
  }
  utaState.hand = ids.slice();
  utaState.handReplace = utaState.replace;
  persistUta();
  const drawn = ids.map(id => ({ id, label: utaArt.utaMeta(id).label, red: false }));
  return {
    schema: 2,
    system: 'utagaruta',
    notation: utaNotation(),
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeCards(drawn, utaRemaining(), utaTotal()),
  };
}

// A drawn poem should be READ: a single card puts the whole verse in the
// breakdown line — the poet, then MacCauley's translation. A handful of
// cards falls back to the shared labels-and-remaining line.
function describeUta(result) {
  const s = result.summary;
  if (s.drawn.length === 1 && utaArt) {
    const m = utaArt.utaMeta(s.drawn[0].id);
    if (m) {
      const left = s.replace ? `${s.remaining}∞` : `${s.remaining} of ${s.total} left`;
      const lang = utaState.lang;
      const poem = lang === 'en' ? `“${m.trans}”`
        : lang === 'ja' ? m.kanji
        : `${m.kanji} — “${m.trans}”`;
      return `${poem} · ${left}`;
    }
  }
  return describeCards(result);
}

// The reading side of a yomifuda: what the second tap in the close-up turns
// the card over to. The 1680 calligraphy is kuzushiji — cursive forms most
// modern readers cannot parse — so the back of the card sets the poem in
// type: five vertical columns, right to left, one ku each, kana reading and
// MacCauley's translation beneath.
function utaReadingHTML(id) {
  const m = utaArt && utaArt.utaMeta(id);
  if (!m) return '';
  const lang = utaState.lang;
  const kus = m.kanji.split(/\s+/).map(k => `<div>${k}</div>`).join('');
  const cat = m.cat === 'hime' ? '姫' : m.cat === 'bozu' ? '坊主' : '';
  return `<div class="uta-read">`
    + `<div class="uta-read-head">`
    + `<span class="uta-read-n">${m.n}</span>`
    + `<span class="uta-read-ja">${m.ja}</span>`
    + (cat ? `<span class="uta-read-cat">${cat}</span>` : '')
    + (lang !== 'ja' ? `<span class="uta-read-en">${m.en}</span>` : '')
    + `</div>`
    + (lang !== 'en' ? `<div class="uta-read-poem">${kus}</div>` : '')
    + (lang !== 'en' ? `<div class="uta-read-kana">${m.kana.replace('　', ' · ')}</div>` : '')
    + (lang === 'en' ? `<div class="uta-read-poem uta-read-solo">“${m.trans}”</div>` : '')
    + (lang === 'both' ? `<div class="uta-read-trans">“${m.trans}”</div>` : '')
    + `</div>`;
}

let utaArt = null;
let utaArtLoading = null;
function ensureUtaArt() {
  if (utaArt) return Promise.resolve(utaArt);
  if (!utaArtLoading) {
    /* global __dicebox */
    utaArtLoading = (typeof __dicebox !== 'undefined' && __dicebox.utaSVG)
      ? Promise.resolve(__dicebox)
      : import('./uta-art.js');
    utaArtLoading = utaArtLoading.then(m => (utaArt = m));
  }
  return utaArtLoading;
}

const utaImgCache = new Map();
function utaImage(id) {
  const key = `${id}|${isDark() ? 'd' : 'l'}`;
  let entry = utaImgCache.get(key);
  if (entry) return entry;
  const svg = utaArt.utaSVG(id, { dark: isDark() })
    .replace('<svg ', '<svg width="750" height="1170" ');
  const img = new Image();
  img.addEventListener('error', () => utaImgCache.delete(key));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  entry = { img, ready: img.decode ? img.decode().catch(() => {}) : Promise.resolve() };
  if (typeof createImageBitmap === 'function') {
    entry.ready = entry.ready
      .then(() => createImageBitmap(img))
      .then(bmp => { entry.img = bmp; })
      .catch(() => {});
  }
  utaImgCache.set(key, entry);
  return entry;
}

function stageUtaIdle() {
  if (!utaArt) return;
  if (utaState.order.length === 0) { reshuffleUta(); syncUtaUI({ writeField: false, restage: false }); }
  const { stack, discard } = deckLayout(0, utaView);
  state.dice = [new DeckStackSprite(stack.x, stack.y, stack.w, utaView)];
  if (utaState.pile.length > 0) state.dice.push(new DiscardPileSprite(discard.x, discard.y, discard.w, utaView));
  dropIdleCache();
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint('utagaruta').idle;
  hideHint();
}

async function dealUtaFlow(result, { remote = false } = {}) {
  await ensureUtaArt();
  await utaImage('back').ready;
  await Promise.all(result.summary.drawn.map(c => utaImage(c.id).ready));

  const n = result.summary.drawn.length;
  const { stack, slots, discard } = deckLayout(n, utaView);
  const prev = state.dice.find(d => d.isStack);
  const stackSprite = new DeckStackSprite(prev ? prev.x : stack.x, prev ? prev.y : stack.y, prev ? prev.size : stack.w, utaView);
  if (prev && (prev.x !== stack.x || prev.size !== stack.w)) stackSprite.moveTo(stack.x, stack.y, stack.w);
  else { stackSprite.x = stack.x; stackSprite.y = stack.y; stackSprite.size = stack.w; }
  const dealFrom = { x: prev ? prev.x : stack.x, y: prev ? prev.y : stack.y };
  const sprites = [stackSprite];

  let delay0 = 0;
  if (!remote) {
    for (const d of state.dice) {
      if (d.isCard && !d.isStack && !d.isDiscard && d.phase === 'idle' && !d.gone) {
        const dest = lastSweptReplaceUta
          ? { to: { x: stack.x, y: stack.y, w: d.size }, mode: 'return' }
          : { to: { x: discard.x, y: discard.y, w: discard.w }, mode: 'discard' };
        sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, dest.to, { mode: dest.mode, view: utaView }));
        delay0 = DEAL_S + 0.12;
      }
    }
  }
  if (!remote && utaState.pile.length > 0) {
    const prev = lastSweptPrevPile;
    const hold = delay0 > 0 && prev
      ? { count: prev.count, top: prev.top ? { id: prev.top, rev: false } : null, for: delay0 + DEAL_S + 0.08 }
      : null;
    sprites.push(new DiscardPileSprite(discard.x, discard.y, discard.w, utaView, hold));
  }
  result.summary.drawn.forEach((c, i) => {
    sprites.push(new CardSprite(c.id, dealFrom, slots[i], { delay: delay0 + i * 0.12, remote, view: utaView }));
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

function dealUtaFlowRemote(result, claim) {
  const preload = [utaImage('back').ready, ...result.summary.drawn.map(c => utaImage(c.id).ready)];
  Promise.all(preload).then(() => {
    if (state.remoteClaim !== claim) return;
    const n = result.summary.drawn.length;
    const { stack, slots } = deckLayout(n, utaView);
    const sprites = [new DeckStackSprite(stack.x, stack.y, stack.w, utaView)];
    result.summary.drawn.forEach((c, i) => {
      sprites.push(new CardSprite(c.id, { x: stack.x, y: stack.y }, slots[i], { delay: i * 0.12, remote: true, view: utaView }));
    });
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.rolling = '1';
    setTimeout(() => {
      if (state.remoteClaim !== claim) return;
      delete $('total').dataset.rolling;
      delete $('total').dataset.idle;
      setTotal(cardsHeadline(result));
      $('breakdown').textContent = describeUta(result);
    }, (n * 0.12 + DEAL_S + FLIP_S) * 1000 + 160);
  });
}

function dealFromUtaNotation(notation) {
  let parsed;
  try { parsed = parseUtagaruta(notation); } catch (err) { showError(err.message); return; }
  clearError();
  state.remoteClaim = null;
  ensureUtaArt()
    .then(() => {
      applyUtaFlags(parsed);
      return dealUtaFlow(drawUtaCards(parsed.draw));
    })
    .then(res => {
      state.last = res;
      $('notation').value = res.notation;
      syncUtaUI({ writeField: false, restage: false });
    })
    .catch(err => showError(String((err && err.message) || err)));
}

// ---- the uta-garuta picker ----
const utaPicker = $('utaPicker');
const utaCountVal = $('utaCount');
const utaRemainVal = $('utaRemain');
const utaFlagButtons = [...document.querySelectorAll('#utaPicker .deck-flag[data-flag]')];
const utaLangBtn = $('utaLang');
const utaLangName = $('utaLangName');
const UTA_LANGS = ['both', 'ja', 'en'];
const UTA_LANG_LABEL = { both: '和+英', ja: '日本語', en: 'English' };

function syncUtaUI({ writeField = true, restage = true } = {}) {
  utaCountVal.textContent = String(utaState.draw);
  utaRemainVal.textContent = utaState.replace ? `${utaRemaining()}∞` : `${utaRemaining()}/${utaTotal()}`;
  for (const b of utaFlagButtons) {
    b.setAttribute('aria-pressed', String(utaState.replace));
  }
  utaLangName.textContent = UTA_LANG_LABEL[utaState.lang];
  utaLangBtn.setAttribute('aria-pressed', String(utaState.lang !== 'both'));
  if (writeField && uiSystem === 'utagaruta') $('notation').value = utaNotation();
  if (restage && uiSystem === 'utagaruta' && !$('total').dataset.rolling) stageUtaIdle();
}

bindTapHold($('utaCountChip'), dir => {
  utaState.draw = Math.max(1, Math.min(10, utaState.draw + dir));
  persistUta();
  syncUtaUI({ restage: false });
});
$('utaShuffle').addEventListener('click', () => {
  ensureUtaArt().then(() => {
    const prevCards = state.dice.filter(d => d.isCard && !d.isStack && !d.isDiscard && !d.gone && d.phase === 'idle');
    const hadDiscard = utaState.pile.length > 0;
    const discardTop = utaState.pile[utaState.pile.length - 1];
    const prevDiscardSprite = state.dice.find(d => d.isDiscard);
    reshuffleUta();
    const { stack } = deckLayout(0, utaView);
    const stackSprite = new DeckStackSprite(stack.x, stack.y, stack.w, utaView);
    const sprites = [stackSprite];
    for (const d of prevCards) {
      sprites.push(new CardSprite(d.id, { x: d.x, y: d.y }, { x: stack.x, y: stack.y, w: d.size }, { mode: 'return', view: utaView }));
    }
    if (hadDiscard && discardTop && prevDiscardSprite) {
      for (let i = 0; i < 3; i++) {
        sprites.push(new CardSprite(discardTop, { x: prevDiscardSprite.x, y: prevDiscardSprite.y },
          { x: stack.x, y: stack.y, w: prevDiscardSprite.size }, { mode: 'return', delay: i * 0.07, view: utaView }));
      }
    }
    const sweeping = sprites.length > 1;
    stackSprite.riffleAfter = sweeping ? 0.34 : 0.001;
    state.dice = sprites;
    dropIdleCache();
    $('total').dataset.idle = '1';
    $('total').dataset.kind = 'number';
    $('total').textContent = '—';
    $('breakdown').textContent = systemHint('utagaruta').idle;
    if (navigator.vibrate) navigator.vibrate([6, 40, 6, 40, 6, 40, 10]);
    syncUtaUI({ restage: false });
  });
});
for (const b of utaFlagButtons) {
  b.addEventListener('click', () => {
    utaState.replace = !utaState.replace;
    persistUta();
    syncUtaUI();
  });
}

utaLangBtn.addEventListener('click', () => {
  utaState.lang = UTA_LANGS[(UTA_LANGS.indexOf(utaState.lang) + 1) % UTA_LANGS.length];
  persistUta();
  syncUtaUI({ restage: false });
  // The line under the result and an open close-up both re-speak on the spot.
  if (uiSystem === 'utagaruta' && state.last && state.last.system === 'utagaruta' && !$('total').dataset.idle) {
    $('breakdown').textContent = describeUta(state.last);
  }
  retintCardOverlays();
});

function syncUtaFromField() {
  try {
    const { draw } = parseUtagaruta($('notation').value);
    utaState.draw = draw;
    persistUta();
    syncUtaUI({ writeField: false, restage: false });
  } catch { /* mid-type */ }
}

// ---- clearing a deck table ----
//
// The X next to Draw sweeps the table clean without drawing: the hand goes to
// the discard exactly as the next draw would have sent it — or home to the
// deck in replace mode, where the cards never really left — and the tray
// settles back to the idle stack.
function deckBundle() {
  switch (uiSystem) {
    case 'cards': return { view: cardsView, st: deckState, persist: persistDeck, sync: syncCardsUI };
    case 'tarot': return { view: tarotView, st: tarotState, persist: persistTarot, sync: syncTarotUI };
    case 'napoletane': return { view: napView, st: napState, persist: persistNap, sync: syncNapUI };
    case 'hanafuda': return { view: hanaView, st: hanaState, persist: persistHana, sync: syncHanaUI };
    case 'utagaruta': return { view: utaView, st: utaState, persist: persistUta, sync: syncUtaUI };
    default: return null;
  }
}

function clearDeckTable() {
  const d = deckBundle();
  if (!d) return false;
  if (!d.view.loaded() || $('total').dataset.rolling) return true;
  const drawn = state.dice.filter(x => x.isCard && !x.isStack && !x.isDiscard && !x.gone && x.phase === 'idle');
  const prevPile = { count: d.view.discard(), top: d.view.discardTop() };
  const replace = !!d.st.handReplace;
  if (replace) {
    d.st.hand = [];
    d.persist();
  } else if (d.st.hand.length) {
    d.st.pile.push(...d.st.hand);
    d.st.hand = [];
    d.persist();
  }
  const { stack, discard } = deckLayout(0, d.view);
  const sprites = [new DeckStackSprite(stack.x, stack.y, stack.w, d.view)];
  for (const c of drawn) {
    const dest = replace
      ? { to: { x: stack.x, y: stack.y, w: c.size }, mode: 'return' }
      : { to: { x: discard.x, y: discard.y, w: discard.w }, mode: 'discard' };
    sprites.push(new CardSprite(c.id, { x: c.x, y: c.y }, dest.to, { mode: dest.mode, view: d.view }));
  }
  if (d.view.discard() > 0) {
    const hold = drawn.length
      ? { count: prevPile.count, top: prevPile.top, for: DEAL_S + 0.08 }
      : null;
    sprites.push(new DiscardPileSprite(discard.x, discard.y, discard.w, d.view, hold));
  }
  state.dice = sprites;
  dropIdleCache();
  $('total').dataset.idle = '1';
  $('total').dataset.kind = 'number';
  $('total').textContent = '—';
  $('breakdown').textContent = systemHint(uiSystem).idle;
  d.sync({ restage: false });
  if (navigator.vibrate) navigator.vibrate(8);
  hideHint();
  return true;
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
  let stagedCrown = false;
  const dccT = uiSystem === 'dcc' ? theme() : null;
  for (const [sides, entry] of pool) {
    for (let i = 0; i < entry.count; i++) {
      const d = new Die(sides, null, 0, 0, 40);
      // The action die takes the emphasis (chain hue, or theme ink for the greys)
      // on the staged shelf; every other die dims to the muted tone.
      if (dccT && DCC_COLORS[sides]) {
        if (!stagedCrown && sides === dccCrown) {
          d.genColor = DCC_INK_DICE.has(sides) ? dccT.line : DCC_COLORS[sides];
          stagedCrown = true;
        } else {
          d.genColor = dccT.muted;
        }
      }
      staged.push(d);
    }
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
  markDccPool();
}

// The DCC chain tokens carry the same count badge as the numeric buttons, so the
// shaped tokens read as pool buttons (tap adds, hold removes) — not single rolls.
function markDccPool() {
  if (!dccChainEl) return;
  for (const t of dccChainEl.children) {
    const n = pool.get(DCC_STRIP[Number(t.dataset.i)])?.count || 0;
    // The count rides the chip itself so its ::after can read attr(data-count).
    const chip = t.querySelector('.dcc-chip');
    if (n > 1) chip.dataset.count = String(n); else delete chip.dataset.count;
    t.classList.toggle('in-pool', n > 0);
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
      add(v5.pool, { sides: 10, kind: 'v5-normal' });
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
    case 'yearzero':
    case 'alien':
      for (const t of YZ_TYPES) add(yz[t.type], { sides: 6, genColor: YZ_COLORS[t.type], kind: `yz-${t.type}` });
      break;
    case 'bladerunner':
      if (br.mod === 'dis') {
        add(1, { sides: Math.max(br.attr, br.skill), genColor: BR_COLORS.attribute, kind: 'br' });
      } else {
        add(1, { sides: br.attr, genColor: BR_COLORS.attribute, kind: 'br' });
        add(1, { sides: br.skill, genColor: BR_COLORS.skill, kind: 'br' });
        if (br.mod === 'adv') add(1, { sides: Math.min(br.attr, br.skill), genColor: BR_COLORS.advantage, kind: 'br' });
      }
      break;
    case 'twilight':
      add(1, { sides: t2k.attr, genColor: T2K_COLORS.attribute, kind: 't2k' });
      add(1, { sides: t2k.skill, genColor: T2K_COLORS.skill, kind: 't2k' });
      add(t2k.ammo, { sides: 6, genColor: T2K_COLORS.ammo, kind: 't2k' });
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
    case 'callofcthulhu': {
      const extra = Math.abs(coc.modifier);
      add(1, { sides: 10, genColor: COC_COLORS.tens, kind: 'coc-check' });
      if (extra) add(extra, { sides: 10, genColor: coc.modifier > 0 ? COC_COLORS.bonus : COC_COLORS.penalty, kind: 'coc-check' });
      add(1, { sides: 10, genColor: COC_COLORS.ones, kind: 'coc-check' });
      break;
    }
    case 'deltagreen': {
      add(1, { sides: 10, genColor: DG_COLORS.tens, kind: 'dg-check' });
      add(1, { sides: 10, genColor: DG_COLORS.ones, kind: 'dg-check' });
      break;
    }
    case 'ironsworn': case 'starforged': {
      // Stage the dice of whatever roll is loaded, so the tray always shows what
      // Roll will throw: an oracle's single dN, a progress roll's two challenge
      // dice, or the action roll's d6 + two challenge dice.
      if (ironActive.kind === 'oracle') {
        const sides = curOracles() && curOracles().tables[ironActive.id] ? curOracles().tables[ironActive.id].sides : 100;
        add(1, { sides, genColor: IRON_COLORS.oracle, kind: 'iron-oracle' });
      } else if (ironActive.kind === 'progress') {
        add(2, { sides: 10, genColor: IRON_COLORS.challenge, kind: 'iron-challenge' });
      } else {
        add(1, { sides: 6, genColor: IRON_COLORS.action, kind: 'iron-action' });
        add(2, { sides: 10, genColor: IRON_COLORS.challenge, kind: 'iron-challenge' });
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
  state.pendingPush = null; state.pushKept = null;   // building/restaging a pool abandons a pending push
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
  updateYzPush();
  updateBrPush();
  updateT2kPush();
}

// Take one staged die of `kind` back off the pool by stepping the owning
// system's state, then let its sync re-render. Mandatory dice return false so a
// tap on them is a gentle no-op rather than an error.
function removeSystemStageKind(kind) {
  switch (kind) {
    // A white die taken off the tray drops a pool die; a red one lowers Hunger,
    // since the two are independent stacks.
    case 'v5-normal': v5.pool = Math.max(0, v5.pool - 1); syncV5(); return true;
    case 'v5-hunger': setHunger(v5.hunger - 1); return true;
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
      if (kind && kind.startsWith('yz-')) {
        const type = kind.slice(3);
        if (yz[type] > 0) { yz[type] -= 1; syncYz(); return true; }
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
  if (uiSystem !== 'numeric' && uiSystem !== 'dcc') {
    switch (uiSystem) {
      // The X sweeps the whole table, Hunger dice included, so it clears the
      // tracker too — unlike a mode switch, which keeps Hunger as standing state.
      case 'v5': setHunger(0, { restage: false }); resetV5(); syncV5(); break;
      case 'fate': resetFate(); syncFate(); break;
      case 'genesys': case 'starwars': resetGenesys(); syncGen(); break;
      case 'daggerheart': resetDaggerheart(); syncDh(); break;
      case 'cthulhutech': resetCthulhuTech(); syncCt(); break;
      case 'yearzero': case 'alien': resetYearZero(); syncYz(); break;
      case 'bladerunner': resetBladeRunner(); syncBr(); break;
      case 'twilight': resetTwilight(); syncT2k(); break;
      case 'onering': resetOneRing(); syncTor(); break;
      case 'pbta': case 'mist': resetTwod6(); syncTwod6(); break;
      case 'mothership': resetMothership(); syncMs(); break;
      case 'callofcthulhu': resetCoc(); syncCoc(); break;
      case 'deltagreen': resetDg(); syncDg(); break;
      case 'ironsworn': case 'starforged': resetIron(); syncIron(); break;
      // The deck persists (it is the character's deck, like Stress); clearing
      // just returns the tray to the idle stack.
      case 'cards': ensureCardArt().then(() => { if (uiSystem === 'cards') syncCardsUI(); }); break;
      case 'tarot': ensureTarotArt().then(() => { if (uiSystem === 'tarot') syncTarotUI(); }); break;
      case 'napoletane': ensureNapArt().then(() => { if (uiSystem === 'napoletane') syncNapUI(); }); break;
      case 'hanafuda': ensureHanaArt().then(() => { if (uiSystem === 'hanafuda') syncHanaUI(); }); break;
      case 'utagaruta': ensureUtaArt().then(() => { if (uiSystem === 'utagaruta') syncUtaUI(); }); break;
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
  // In a deck mode the X sweeps the table: drawn cards go to the discard
  // (or home to the deck in replace mode) and the tray returns to idle. In
  // the dice modes it clears the pool, as it always has.
  if (clearDeckTable()) { $('notation').focus(); return; }
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

// ---- Dungeon Crawl Classics: the dice chain ----
//
// A tactile die selector: the chain is a scroll-snapping row of die-shaped tokens
// (each its own 2D shape and colour, like the Genesys dice), and the token in the
// centre is your action die — enlarged, and what Roll throws. Scroll or tap to
// move along the chain; there is no separate dialog. d100 rides the end for the
// Judge's tables. Ordinary pools (2d6+3 damage) are still typeable in the field.
const dccChainEl = $('dccChain');

// A 2D shape per die, after the physical set: d3 and d6 are cubes (squares),
// d4 a tetrahedron (triangle), d8 an octahedron (diamond), d10 the classic kite,
// d100 a near-circle. The rest are regular polygons, rotated so chain neighbours
// read differently even when they share a vertex count.
const DCC_SHAPE = {
  3: [4, -45], 4: [3, -90], 5: [5, -90], 6: [4, -45], 7: [6, 30], 8: [4, -90],
  12: [5, 90], 14: [6, -90], 16: [8, -90], 20: [6, 0], 24: [8, 22.5], 30: [10, -90], 100: [24, -90],
};
function dccShapePath(sides) {
  if (sides === 10) return 'M15 2.5 26 13 15 27.5 4 13Z';
  // The d7 is the oddball — a rounded barrel/pentagonal prism, not a polygon.
  if (sides === 7) return 'M9 5 Q3.5 15 9 25 Q15 27.2 21 25 Q26.5 15 21 5 Q15 2.8 9 5 Z';
  const [n, rot] = DCC_SHAPE[sides] || [8, -90];
  const r = 12.5, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (rot + i * 360 / n) * Math.PI / 180;
    pts.push(`${(15 + r * Math.cos(a)).toFixed(1)} ${(15 + r * Math.sin(a)).toFixed(1)}`);
  }
  return 'M' + pts.join(' ') + 'Z';
}

// Each die is a row-token: a crown above (tap to make it your action die) and
// the die itself below, which is a pool button (tap adds one, hold removes one).
// Roll throws the pool, so a fistful of d6 damage works. The crown is a pure
// tracker — it says which die you are on the chain, glowing so it reads as the
// king, and it shifts by crowning the die to its left or right.
let dccCrown = 20;   // sides of the action die
function dccStep(sides, dir) {
  const cur = pool.get(sides)?.count || 0;
  setDieCount(sides, cur + dir * perTap());
}
function setDccCrown(sides) {
  dccCrown = sides;
  const idx = DCC_STRIP.indexOf(sides);
  [...dccChainEl.children].forEach((wrap, i) => wrap.classList.toggle('is-action', i === idx));
  const crowned = dccChainEl.children[idx];
  if (crowned) {
    crowned.querySelector('.dcc-arrow-l').disabled = idx === 0;
    crowned.querySelector('.dcc-arrow-r').disabled = idx === DCC_STRIP.length - 1;
  }
  // Recolour the staged tray live: colour marks the action die, so moving the
  // crown while a pool is out on the shelf must move the coloured die in step.
  if (uiSystem === 'dcc' && pool.size > 0 && $('total').dataset.idle === '1') {
    stageFromPool({ writeField: false });
  }
}

function buildDccChain() {
  if (!dccChainEl || dccChainEl.dataset.built) return;
  DCC_STRIP.forEach((sides, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'dcc-token';
    wrap.dataset.i = i;
    wrap.dataset.sides = sides;
    // The chain hue rides on --chain; a die only spends it (as --dc) once crowned.
    wrap.style.setProperty('--chain', DCC_COLORS[sides]);
    if (sides === dccCrown) wrap.classList.add('is-action');

    // The crown row: a left step-arrow, the crown itself, a right step-arrow.
    // Only the crowned die shows any of it. The arrows shift the crown one step
    // along the chain; tapping a die's crown directly jumps it there.
    const crownRow = document.createElement('div');
    crownRow.className = 'dcc-crown-row';

    const arrowL = document.createElement('button');
    arrowL.type = 'button';
    arrowL.className = 'dcc-arrow dcc-arrow-l';
    arrowL.setAttribute('aria-label', 'Step the crown one die down the chain');
    arrowL.innerHTML = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M9 2 3 8l6 6"/></svg>';
    arrowL.addEventListener('click', e => { e.stopPropagation(); if (i > 0) setDccCrown(DCC_STRIP[i - 1]); });

    const crown = document.createElement('button');
    crown.type = 'button';
    crown.className = 'dcc-crown';
    crown.setAttribute('aria-label', `Make d${sides} your action die`);
    crown.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18 4.6 8 9 12.5 12 5 15 12.5 19.4 8 21 18Z"/></svg>';
    crown.addEventListener('click', () => setDccCrown(sides));

    const arrowR = document.createElement('button');
    arrowR.type = 'button';
    arrowR.className = 'dcc-arrow dcc-arrow-r';
    arrowR.setAttribute('aria-label', 'Step the crown one die up the chain');
    arrowR.innerHTML = '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M3 2l6 6-6 6"/></svg>';
    arrowR.addEventListener('click', e => { e.stopPropagation(); if (i < DCC_STRIP.length - 1) setDccCrown(DCC_STRIP[i + 1]); });

    crownRow.append(arrowL, crown, arrowR);

    const die = document.createElement('button');
    die.type = 'button';
    die.className = 'dcc-chip';
    die.setAttribute('aria-label', `d${sides} — tap to add, hold to remove`);
    die.innerHTML = `<svg class="die-ico" viewBox="0 0 30 30" aria-hidden="true"><path d="${dccShapePath(sides)}"/></svg><span class="dcc-chip-label">d${sides}</span>`;
    bindTapHold(die, dir => dccStep(sides, dir));

    wrap.append(crownRow, die);
    dccChainEl.append(wrap);
  });
  dccChainEl.dataset.built = '1';
}

function enterDcc() {
  buildDccChain();
  setDccCrown(dccCrown);
  markDccPool();
  centerCrownedDie();
}

// The default action die (d20) sits two-thirds along the chain, off the right
// edge on load. Centre it in the viewport on entry so it reads as the starting
// point, not something hidden. Deferred a frame so the picker has laid out.
function centerCrownedDie() {
  requestAnimationFrame(() => {
    if (!dccChainEl || !dccChainEl.clientWidth) return;
    const el = dccChainEl.children[DCC_STRIP.indexOf(dccCrown)];
    if (!el) return;
    dccChainEl.scrollLeft = el.offsetLeft - (dccChainEl.clientWidth - el.offsetWidth) / 2;
  });
}

// The tray colours are theme-aware (muted neutrals, ink for the grey action
// dice), so a theme toggle while dice are already on the tray must repaint them
// or a white action die would strand on a light ground.
function recolorDccTray() {
  if (uiSystem !== 'dcc') return;
  const t = theme();
  let crowned = false;
  for (const d of state.dice) {
    if (!DCC_COLORS[d.sides]) continue;
    if (!crowned && d.sides === dccCrown) {
      d.genColor = DCC_INK_DICE.has(d.sides) ? t.line : DCC_COLORS[d.sides];
      crowned = true;
    } else {
      d.genColor = t.muted;
    }
  }
  dropIdleCache();
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
const dialClear = $('dialClear');
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
  // An optional release action: some values (the Mothership target) can be
  // given back to the table rather than set to a number.
  dialClear.hidden = !dialConfig.clearLabel;
  if (dialConfig.clearLabel) dialClear.textContent = dialConfig.clearLabel;
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
  const focusable = [dialClose, wheel, dialInput, dialAdd, dialClear].filter(el => !el.hidden && !el.disabled);
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
dialClear.addEventListener('click', () => {
  if (dialConfig && dialConfig.onClear) dialConfig.onClear();
  closeDial();
});
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
// ---- card close-up ----
//
// Cards are the one thing on the tray you want to pick up and actually look
// at. Holding a drawn card lifts it into a full close-up over everything but
// the top bar; a tap sets it back down. The overlay carries the card's own
// SVG rather than the tray raster, so the woodcut is pin-sharp at any size,
// and a reversed tarot card stays upside down — that is what was dealt.
const cardFocusEl = $('cardFocus');
const cardFocusHint = $('cardFocusHint');
const cardFocusArt = $('cardFocusArt');
let cardHoldTimer = null;
let cardHoldFired = false;
let cardFocusFrom = null; // the transform it rose from, for the way back down
let cardFocusCard = null; // {id, rev, view} of the card held up, for retinting
// After a touch tap, the browser synthesises a click AFTER pointerup and
// hit-tests it against the page as it is THEN — the just-opened overlay
// covers the fingertip, so the ghost click lands on it and would close it
// in the same breath. Openings ignore clicks for a beat.
let cardFocusShownAt = 0;
let discardShownAt = 0;
const GHOST_CLICK_MS = 450;

function drawnCardAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  let hit = null;
  for (const d of state.dice) {
    if (!d.isCard || d.isStack || d.isDiscard || d.gone || d.phase !== 'idle') continue;
    const w = d.size, h = w * d.view.ratio;
    // Later sprites draw on top, so the last hit wins, same as the eye.
    if (Math.abs(x - d.x) <= w / 2 && Math.abs(y - d.y) <= h / 2) hit = d;
  }
  return hit;
}

// The close-up proper: a card id + orientation rises from wherever it was —
// its sprite on the table, or its cell in the fanned-open discard.
function focusCard(id, rev, view, from) {
  if (!view.loaded() || !cardFocusEl.hidden) return;
  const barBottom = Math.round(document.querySelector('header.bar').getBoundingClientRect().bottom);
  cardFocusEl.style.top = `${barBottom}px`;

  const areaW = window.innerWidth, areaH = window.innerHeight - barBottom;
  const ratio = view.ratio;
  const w = Math.min(areaW - 36, (areaH - 36) / ratio);
  const h = w * ratio;
  cardFocusArt.style.width = `${Math.round(w)}px`;
  cardFocusArt.style.height = `${Math.round(h)}px`;
  // The reading side scales with the card, so everything inside is set in em.
  cardFocusArt.style.fontSize = `${(w * 0.052).toFixed(1)}px`;
  cardFocusArt.innerHTML = buildFocusContent(id, view, false);
  cardFocusHint.hidden = !view.reading;
  if (view.reading) cardFocusHint.textContent = 'Tap the card to turn it over';
  cardFocusCard = { id, rev, view };

  // Rise from where the card was: same FLIP move the eye makes.
  const dx = from.cx - areaW / 2;
  const dy = from.cy - (barBottom + areaH / 2);
  const revT = rev ? ' rotate(180deg)' : '';
  cardFocusFrom = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${(from.w / w).toFixed(3)})${revT}`;
  cardFocusArt.style.transition = 'none';
  cardFocusArt.style.transform = cardFocusFrom;
  cardFocusShownAt = performance.now();
  cardFocusEl.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cardFocusArt.style.transition = '';
    cardFocusArt.style.transform = revT.trim() || 'none';
  }));
}

// A deck with a reading side gets a two-faced close-up: the art, and the
// typeset reading behind it. Tapping the raised card turns it over — the
// same physical grammar as picking it up and flicking it away.
function buildFocusContent(id, view, flipped) {
  if (!view.reading) return view.svg(id);
  return `<div class="cf-flip${flipped ? ' flipped' : ''}">`
    + `<div class="cf-face">${view.svg(id)}</div>`
    + `<div class="cf-face cf-back">${view.reading(id)}</div>`
    + `</div>`;
}

cardFocusArt.addEventListener('click', e => {
  const flip = cardFocusArt.querySelector('.cf-flip');
  if (!flip) return; // no reading side: bubble up, the overlay closes
  e.stopPropagation();
  if (performance.now() - cardFocusShownAt < GHOST_CLICK_MS) return;
  flip.classList.toggle('flipped');
  cardFocusHint.textContent = flip.classList.contains('flipped')
    ? 'Tap to turn it back' : 'Tap the card to turn it over';
});

function openCardFocus(d) {
  const cr = canvas.getBoundingClientRect();
  focusCard(d.id, !!d.rev, d.view, { cx: cr.left + d.x, cy: cr.top + d.y, w: d.size });
}

function closeCardFocus() {
  if (cardFocusEl.hidden) return;
  const from = cardFocusFrom;
  cardFocusFrom = null;
  cardFocusCard = null;
  cardFocusArt.style.transform = from || 'scale(0.2)';
  cardFocusArt.style.opacity = '0';
  cardFocusHint.hidden = true;
  setTimeout(() => {
    cardFocusEl.hidden = true;
    cardFocusArt.style.opacity = '';
    cardFocusArt.innerHTML = '';
  }, 240);
}

cardFocusEl.addEventListener('click', () => {
  if (performance.now() - cardFocusShownAt < GHOST_CLICK_MS) return;
  closeCardFocus();
});

// Flick a drawn card off the table and into the scarti — no draw involved.
// The pile sprite holds its old face until the flight lands.
function discardCardSprite(d) {
  const view = d.view;
  const prevCount = view.discard();
  const prevTop = view.discardTop();
  view.discardFromHand(d.id, d.rev);
  const n = state.dice.filter(s => s.isCard && !s.isStack && !s.isDiscard && !s.gone).length;
  const { discard } = deckLayout(Math.max(0, n - 1), view);
  d.from = { x: d.x, y: d.y };
  d.to = { x: discard.x, y: discard.y, w: discard.w };
  d.mode = 'discard';
  d.phase = 'fly';
  d.t = 0;
  d.delay = 0;
  d.value = null;
  if (!state.dice.some(s => s.isDiscard)) {
    state.dice.push(new DiscardPileSprite(discard.x, discard.y, discard.w, view,
      prevCount > 0 ? { count: prevCount, top: prevTop, for: DEAL_S + 0.06 } : { count: 0, top: null, for: DEAL_S + 0.06 }));
  } else {
    for (const s of state.dice) {
      if (s.isDiscard) s.hold = { count: prevCount, top: prevTop, for: DEAL_S + 0.06 };
    }
  }
  dropIdleCache();
  if (navigator.vibrate) navigator.vibrate(8);
}

// ---- the discard, fanned open ----
//
// Tapping the pile on the tray spreads it out, newest first, every card
// face-up (reversed tarot cards stay upside down). A tap on any card lifts it
// into the close-up above the spread; a tap anywhere else sets the pile back.
const discardPanel = $('discardPanel');
const discardGrid = $('discardGrid');
let discardPanelView = null; // the view whose pile is fanned open, for retinting

function openDiscardPanel(view) {
  const pile = view.pile();
  if (!pile.length || !view.loaded()) return;
  const barBottom = Math.round(document.querySelector('header.bar').getBoundingClientRect().bottom);
  discardPanel.style.top = `${barBottom}px`;
  $('discardTitle').textContent = `Discard · ${pile.length}`;
  discardGrid.innerHTML = '';
  for (let i = pile.length - 1; i >= 0; i--) {
    const entry = pile[i];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'discard-card' + (entry.rev ? ' rev' : '');
    cell.dataset.cardId = entry.id;
    cell.innerHTML = view.svg(entry.id);
    cell.addEventListener('click', ev => {
      ev.stopPropagation();
      if (performance.now() - discardShownAt < GHOST_CLICK_MS) return;
      const r = cell.getBoundingClientRect();
      focusCard(entry.id, !!entry.rev, view, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width });
    });
    discardGrid.appendChild(cell);
  }
  discardPanelView = view;
  discardShownAt = performance.now();
  discardPanel.hidden = false;
}

function closeDiscardPanel() {
  if (discardPanel.hidden) return;
  discardPanel.hidden = true;
  discardPanelView = null;
  discardGrid.innerHTML = '';
}

// The close-up and the fanned-open discard are DOM SVGs, baked at the theme
// they were opened in; a theme toggle repaints the tray canvas but not these,
// so re-render whichever is open with the new-theme art.
function retintCardOverlays() {
  if (!cardFocusEl.hidden && cardFocusCard) {
    const flipped = !!cardFocusArt.querySelector('.cf-flip.flipped');
    cardFocusArt.innerHTML = buildFocusContent(cardFocusCard.id, cardFocusCard.view, flipped);
  }
  if (!discardPanel.hidden && discardPanelView) {
    for (const cell of discardGrid.children) {
      cell.innerHTML = discardPanelView.svg(cell.dataset.cardId);
    }
  }
}

discardPanel.addEventListener('click', () => {
  if (performance.now() - discardShownAt < GHOST_CLICK_MS) return;
  closeDiscardPanel();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!cardFocusEl.hidden) closeCardFocus();
  else if (!discardPanel.hidden) closeDiscardPanel();
});

canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, t: performance.now() };
  // A pointer can be gone by the time capture is asked for (and synthetic
  // pointers never had one); losing capture is fine, losing the handler isn't.
  try { canvas.setPointerCapture(e.pointerId); } catch { /* no capture */ }
  // Holding a drawn card lifts it off the table for a close look; the timer
  // dies on any real movement, so flicks and drags stay flicks and drags.
  cardHoldFired = false;
  const hit = drawnCardAt(e.clientX, e.clientY);
  if (hit) {
    cardHoldTimer = setTimeout(() => {
      cardHoldTimer = null;
      cardHoldFired = true;
      openCardFocus(hit);
      if (navigator.vibrate) navigator.vibrate(10);
    }, 420);
  }
});
canvas.addEventListener('pointermove', e => {
  const budget = e.pointerType === 'touch' ? 20 : 12;
  if (cardHoldTimer && drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > budget) {
    clearTimeout(cardHoldTimer);
    cardHoldTimer = null;
  }
});
canvas.addEventListener('pointercancel', () => {
  if (cardHoldTimer) { clearTimeout(cardHoldTimer); cardHoldTimer = null; }
  drag = null;
});
canvas.addEventListener('pointerup', e => {
  if (cardHoldTimer) { clearTimeout(cardHoldTimer); cardHoldTimer = null; }
  if (cardHoldFired) { cardHoldFired = false; drag = null; return; }
  if (!drag) return;
  const dt = Math.max(16, performance.now() - drag.t);
  const vx = ((e.clientX - drag.x) / dt) * 1000;
  const vy = ((e.clientY - drag.y) / dt) * 1000;
  const speed = Math.hypot(vx, vy);
  const travelled = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  const downX = drag.x, downY = drag.y;
  drag = null;

  // What still counts as a tap: a mouse click barely moves, but a fingertip
  // rolls a few pixels on and off the glass — and over a quick tap's tiny
  // duration that wobble computes as real speed, which is exactly a flick's
  // signature. Touch gets budgets sized for fingers, not pointers.
  const isTouch = e.pointerType === 'touch';
  const tapSpeed = isTouch ? 300 : 120, tapTravel = isTouch ? 24 : 10;
  const isTap = speed < tapSpeed && travelled < tapTravel;

  // A drawn card is a physical thing: tap it to pick it up for a look,
  // flick it to send it to the discard. Neither draws.
  const hitCard = drawnCardAt(downX, downY);
  if (hitCard) {
    if (isTap) { openCardFocus(hitCard); return; }
    if (speed > 260) { discardCardSprite(hitCard); return; }
  }

  // A pending push has the rerollable dice sitting picked-up on the tray; any tap
  // or flick throws just that handful, leaving the kept 6s and 1s in place.
  if (state.pendingPush) { rollPendingPush(); return; }

  // Tapping the discard pile fans it open instead of drawing. Hit-tested where
  // the finger LANDED (the aim point), not where it lifted, with a little pad.
  if (isTap) {
    const r = canvas.getBoundingClientRect();
    const x = downX - r.left, y = downY - r.top;
    const pad = isTouch ? 10 : 0;
    const pileSprite = state.dice.find(d => d.isDiscard
      && Math.abs(x - d.x) <= d.size / 2 + pad && Math.abs(y - d.y) <= (d.size * d.view.ratio) / 2 + pad);
    if (pileSprite && pileSprite.view.discard() > 0) { openDiscardPanel(pileSprite.view); return; }
  }

  // Tapping a staged die takes it back off the tray, which is how you drop one
  // die from a handful without clearing everything or editing the text.
  if (isTap && removeDieAt(downX, downY)) return;

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
  if (yzFamily(uiSystem)) return yzNotation() || 'yz:5';
  if (uiSystem === 'bladerunner') return brNotation();
  if (uiSystem === 'twilight') return t2kNotation();
  if (uiSystem === 'pbta') return pbtaCtl.notation();
  if (uiSystem === 'mist') return mistCtl.notation();
  if (uiSystem === 'mothership') return msNotation();
  if (uiSystem === 'callofcthulhu') return cocNotation();
  if (uiSystem === 'deltagreen') return dgNotation();
  if (uiSystem === 'ironsworn' || uiSystem === 'starforged') return ironNotation();
  if (uiSystem === 'cards') return deckNotation();
  if (uiSystem === 'tarot') return tarotNotation();
  if (uiSystem === 'napoletane') return napNotation();
  if (uiSystem === 'hanafuda') return hanaNotation();
  if (uiSystem === 'utagaruta') return utaNotation();
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
    case 'yearzero': case 'alien': syncYz(); break;
    case 'bladerunner': syncBr(); break;
    case 'twilight': syncT2k(); break;
    case 'onering': syncTor(); break;
    case 'pbta': case 'mist': syncTwod6(); break;
    case 'mothership': syncMs(); break;
    case 'callofcthulhu': syncCoc(); break;
    case 'deltagreen': syncDg(); break;
    case 'ironsworn': case 'starforged': syncIron(); break;
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
    // Settled in rotation AND arrived at its grid slot: a die keeps easing toward
    // home after it settles (the tray tidying itself), so freezing the frame the
    // instant rotation settles locks a die mid-slide. This waits for the sort to
    // finish — it matters when a die settles far from home, as a push re-home or
    // the settle backstop can leave it.
    && state.dice.every(d => d.settled && d.value !== null
        && (d.homeX === undefined || Math.hypot(d.homeX - d.x, d.homeY - d.y) < 0.5))
    && state.surface.bursts.length === 0
    && !trayCovered();
}

// True while a panel covers the tray. The dice keep simulating underneath, but
// drawing them wastes a frame on something nobody can see — and any translucency
// in the panel would let them ghost through.
function trayCovered() {
  // Only the full-viewport modals count — they use inset:0, so nothing behind
  // them is visible and drawing the tray is wasted. The help and room panels
  // (and the mode picker) are corner popovers: the table shows around them, so
  // the tray must keep rendering or the visible part blanks out.
  return !sheet.hidden || !dial.hidden || !historyPanel.hidden;
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
      // Dice thump; cards don't. A landing ripple under a flat card reads as
      // a stray mark, so the impact stays a dice thing.
      if (!d.isCard) state.surface.impact(d.x, d.y, d.size);
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
      // Snapshot at the backing store's device resolution, not CSS pixels. A
      // CSS-sized copy re-blits soft on any dpr > 1 screen — invisible on
      // wireframe dice, but a settled card visibly dropped a resolution the
      // moment the cache took over from the live render.
      idleCanvas.width = canvas.width; idleCanvas.height = canvas.height;
      idleCanvas.getContext('2d').drawImage(canvas, 0, 0);
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
      // Name the fault: a screenshot of this line is a bug report.
      const why = String((err && err.message) || err).slice(0, 90);
      showError(`Something went wrong drawing that roll. The tray was cleared. (${why})`);
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
// Don't tell the Owlbear panel how to add the Owlbear panel: hide that note
// when Dicebox is already running framed. Comparing window refs is safe even
// cross-origin; reading the parent's location would not be, so we never do.
if (window.self !== window.top) { const _ow = $('roomOwlbear'); if (_ow) _ow.hidden = true; }
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
  if (result.system === 'cards' || result.system === 'tarot' || result.system === 'napoletane' || result.system === 'hanafuda' || result.system === 'utagaruta') {
    if ($('total').dataset.rolling && !state.remoteClaim) return;
    const claim = {};
    state.remoteClaim = claim;
    const ensure = result.system === 'tarot' ? ensureTarotArt : result.system === 'napoletane' ? ensureNapArt : result.system === 'hanafuda' ? ensureHanaArt : result.system === 'utagaruta' ? ensureUtaArt : ensureCardArt;
    const deal = result.system === 'tarot' ? dealTarotFlowRemote : result.system === 'napoletane' ? dealNapFlowRemote : result.system === 'hanafuda' ? dealHanaFlowRemote : result.system === 'utagaruta' ? dealUtaFlowRemote : dealCardsFlowRemote;
    ensure().then(() => {
      if (state.remoteClaim !== claim) return;
      deal(result, claim);
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
