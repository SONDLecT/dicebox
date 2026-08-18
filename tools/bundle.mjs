// Builds dicebox.html: the whole app as one file you can download and open.
//
// No server, no install, no build step to run it — double-click and it works,
// including on a laptop with no network. Everything is inlined: the modules are
// concatenated in dependency order, the icons become data URIs, and the service
// worker is dropped entirely since a single local file has nothing to cache.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root, name), 'utf8');

const html = read('index.html');
const css = read('style.css');

// Each module keeps its own scope, with exports hoisted to a shared namespace.
// Plain concatenation would collide — dice.js and app.js both define MAX_SIDES,
// which modules keep apart and a flat script would not — and that breaks the
// bundle at parse time rather than anywhere useful.
function moduleScope(name, exportsFrom = []) {
  const src = read(name)
    .replace(/^\s*import\s+[\s\S]*?from\s+'[^']*';?\s*$/gm, '')
    .replace(/^export\s+/gm, '');

  // Names this module provides to the ones after it. The `async` is optional and
  // was once missing here, which silently dropped room-crypto.js's deriveRoom,
  // encryptMessage and decryptMessage from the namespace — the modules were
  // inlined, parsed and ran, and then room.js died on the first connect.
  const exported = [...read(name).matchAll(
    /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  )].map(m => m[1]);

  const pull = exportsFrom.length
    ? `const { ${exportsFrom.join(', ')} } = __dicebox;\n`
    : '';
  const push = exported.length
    ? `\nObject.assign(__dicebox, { ${exported.join(', ')} });`
    : '';

  return `// ${name}\n(() => {\n${pull}${src}${push}\n})();`;
}

const DICE_EXPORTS = ['roll', 'describe'];
const SYSTEM_EXPORTS = [
  'rollV5', 'rerollV5', 'surgeV5', 'describeV5', 'v5Headline', 'detectSystem', 'v5Face', 'parseV5',
  'rollFate', 'describeFate', 'fateHeadline', 'fateFace', 'parseFate',
  'rollGenesys', 'describeGenesys', 'genesysHeadline', 'parseGenesys',
  'rollDaggerheart', 'describeDaggerheart', 'daggerheartHeadline', 'parseDaggerheart',
  'rollCthulhuTech', 'describeCthulhuTech', 'cthulhutechHeadline', 'parseCthulhuTech',
  'rollStarWars', 'describeStarWars', 'starWarsHeadline', 'parseStarWars',
  'rollOneRing', 'describeOneRing', 'oneRingHeadline', 'parseOneRing',
  'rollPbta', 'rollMist', 'twod6Headline', 'describe2d6', 'parsePbta', 'parseMist',
  'rollDrawSteel', 'describeDrawSteel', 'drawSteelHeadline', 'parseDrawSteel',
  'rollCrows', 'rollCrowsUsage', 'describeCrows', 'crowsHeadline', 'parseCrows',
  'rollShadowdark', 'describeShadowdark', 'shadowdarkHeadline', 'parseShadowdark', 'torchRemaining', 'torchLabel',
  'rollMothership', 'describeMothership', 'mothershipHeadline', 'parseMothership', 'resolveMothershipStress',
  'rollCallOfCthulhu', 'describeCallOfCthulhu', 'callOfCthulhuHeadline', 'parseCallOfCthulhu',
  'rollDeltaGreen', 'describeDeltaGreen', 'deltaGreenHeadline', 'parseDeltaGreen',
  'parseCards', 'newDeckOrder', 'summarizeCards', 'cardsHeadline', 'describeCards',
  'parseTarot', 'summarizeTarot', 'tarotHeadline', 'describeTarot',
  'parseNapoletane', 'parseHanafuda', 'parseUtagaruta',
  'rollYearZero', 'describeYearZero', 'yearzeroHeadline', 'parseYearZero', 'pushYearZero',
  'rollBladeRunner', 'describeBladeRunner', 'bladeRunnerHeadline', 'parseBladeRunner', 'pushBladeRunner',
  'rollTwilight', 'describeTwilight', 'twilightHeadline', 'parseTwilight', 'pushTwilight',
  'rollIronsworn', 'describeIronsworn', 'ironswornHeadline', 'parseIronsworn', 'rollRouse',
];
const CARDS_ART_EXPORTS = ['cardSVG', 'CARD_IDS', 'cardMeta', 'SUIT_NAMES', 'RANKS'];
const TAROT_ART_EXPORTS = ['tarotSVG', 'TAROT_IDS', 'tarotMeta', 'TAROT_SUITS'];
const NAP_ART_EXPORTS = ['napSVG', 'NAP_IDS', 'napMeta'];
const HANA_ART_EXPORTS = ['hanaSVG', 'HANA_IDS', 'hanaMeta'];
const UTA_ART_EXPORTS = ['utaSVG', 'UTA_IDS', 'utaMeta'];
const ORACLE_EXPORTS = ['rollOracle', 'oracleReading', 'oracleText', 'oracleTableList', 'slugifyOracle', 'oracleSlug', 'findOracleBySlug'];
const IRON_ORACLE_EXPORTS = ['IRONSWORN_ORACLES', 'STARFORGED_ORACLES'];
const RENDER_EXPORTS = ['Die', 'Surface', 'separate', 'beginFrame', 'solidFor', 'UNDER_30_GAP'];
const ROOM_CRYPTO_EXPORTS = [
  'deriveRoom', 'newSender', 'encryptMessage', 'decryptMessage',
  'normalizePassphrase', 'generatePassphrase', 'PROTOCOL_VERSION',
];
const ROOM_EXPORTS = ['createRoom', 'parsePassphraseFromHash', 'validateRoll', 'validateSystemRoll'];
const SCRUB_EXPORTS = ['scrubValue', 'wheelStep', 'wheelValue'];
const RESULT_TEXT_EXPORTS = ['formatHeadline', 'formatDetail'];
const SYSTEM_THEME_EXPORTS = ['SYSTEM_THEMES'];
const SHARED_DECK_EXPORTS = ['createSharedDecks'];
const TRAY_FACES_EXPORTS = [
  'flattenRollDice', 'stampTrayDie',
  'BAND_COLORS', 'FORCE_COLORS', 'TOR_COLORS', 'CT_COLORS', 'DH_COLORS',
  'MS_COLORS', 'GEN_COLORS', 'YZ_COLORS', 'BR_COLORS', 'T2K_COLORS',
  'COC_COLORS', 'DG_COLORS', 'IRON_COLORS',
];

// room-crypto.js before room.js before app.js: each pulls only from the ones
// above it. Omitting these two entirely is what made an earlier bundle a dead
// shell — app.js calls createRoom at top level, so the ReferenceError aborted
// the whole module scope and no dice button was ever wired up.
const script = [
  'const __dicebox = {};',
  moduleScope('dice.js'),
  moduleScope('under30-gap.js'),
  moduleScope('system-dice.js'),
  moduleScope('scrub-math.js'),
  moduleScope('tray-faces.js', ['v5Face', 'fateFace']),
  moduleScope('system-themes.js'),
  moduleScope('shared-decks.js'),
  moduleScope('oracle-dice.js', ['randInt']),
  moduleScope('result-text.js', [...DICE_EXPORTS, ...SYSTEM_EXPORTS, 'oracleReading']),
  moduleScope('ironsworn-oracles.js'),
  moduleScope('starforged-oracles.js'),
  moduleScope('cards-art.js'),
  moduleScope('tarot-art.js'),
  moduleScope('nap-art.js'),
  moduleScope('hana-art.js'),
  moduleScope('uta-art.js'),
  moduleScope('render.js', ['UNDER_30_GAP']),
  moduleScope('room-crypto.js'),
  moduleScope('room.js', ROOM_CRYPTO_EXPORTS),
  moduleScope('app.js', [
    ...DICE_EXPORTS, ...SYSTEM_EXPORTS, ...RESULT_TEXT_EXPORTS, ...SYSTEM_THEME_EXPORTS, ...SHARED_DECK_EXPORTS, ...TRAY_FACES_EXPORTS, ...ORACLE_EXPORTS, ...IRON_ORACLE_EXPORTS, ...CARDS_ART_EXPORTS, ...TAROT_ART_EXPORTS, ...NAP_ART_EXPORTS, ...HANA_ART_EXPORTS, ...UTA_ART_EXPORTS, ...RENDER_EXPORTS, ...ROOM_CRYPTO_EXPORTS, ...ROOM_EXPORTS, ...SCRUB_EXPORTS,
  ]),
].join('\n\n');

const dataUri = name =>
  `data:image/png;base64,${readFileSync(join(root, name)).toString('base64')}`;

const manifest = JSON.parse(read('manifest.webmanifest'));
manifest.icons = manifest.icons.map(icon => ({ ...icon, src: dataUri(icon.src) }));
manifest.start_url = '.';

let out = html
  // The single file opens from file: and inlines everything, so <base href="/">
  // would point every (already-absent) relative URL at the filesystem root.
  .replace(/<base [^>]*>/, '')
  // The bundle is one file, so nothing is fetched: no manifest link, no icons to
  // resolve, and no service worker to register.
  .replace(/<link rel="manifest"[^>]*>/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>/,
    `<link rel="apple-touch-icon" href="${dataUri('icons/icon-180.png')}">`)
  .replace(/<link rel="icon"[^>]*>/,
    `<link rel="icon" href="${dataUri('icons/icon-192.png')}">`)
  .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
  .replace(/<script type="module"[^>]*><\/script>/,
    `<script type="module">\n${script}\n</script>`);

// A single downloaded file cannot register a service worker from file://, and
// does not need one — it is already local.
out = out.replace(
  /if \('serviceWorker' in navigator\) \{[\s\S]*?\n\}/,
  '// Service worker omitted: this build is a single local file.',
);

// This build is the download, so it cannot offer one — a relative link would
// point at a file that is not there once the page has been saved somewhere else.
out = out.replace(
  /\s*<span class="colophon-sep">·<\/span>\s*<!--[\s\S]*?-->\s*<a href="dicebox\.html"[^>]*>[^<]*<\/a>/,
  '',
);

// The install button belongs to the hosted copy; a downloaded file is already
// as installed as it gets.
out = out.replace(
  /Add this to your home screen and it works offline, with no\s*\n\s*connection needed\./,
  'This is the single-file build: it already works offline, and can be copied anywhere.',
);

writeFileSync(join(root, 'dist', 'dicebox.html'), out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`dist/dicebox.html  ${kb}KB`);
