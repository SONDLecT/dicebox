// system-themes.js — every system's chrome palette, dark and light. The app
// retints its CSS variables from these on mode switch, and the Owlbear toast
// paints its little window with the same dark palette, so a V5 roll's corner
// card is blood-on-black there exactly as the panel is.
export const SYSTEM_THEMES = {
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
  // Draw Steel — forged steel and fire: cool near-black steel neutrals under an
  // ember-orange accent, the metal fresh off the anvil. Light is pale steel with
  // the ember deepened to hold WCAG AA on the tinted chrome.
  drawsteel: {
    dark: {
      '--paper': '#0D0E10', '--face': '#16181B', '--line': '#E3E5E8', '--muted': '#8B939B',
      '--hair': '#23272C', '--accent': '#E27B3F', '--danger': '#C0453F',
    },
    light: {
      '--paper': '#E8EAEC', '--face': '#F4F5F7', '--line': '#15181B', '--muted': '#5A626A',
      '--hair': '#CDD2D7', '--accent': '#9A400C', '--danger': '#9E3529',
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
