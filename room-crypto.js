// Room encryption. Everything a room needs, derived from one spoken passphrase.
//
// The relay never sees the passphrase, the message key, or any plaintext. It
// sees a room id it cannot reverse and ciphertext it cannot read.
//
// No dependencies and no WASM: this has to survive the single-file build, which
// is the version that gives self-hosters a guarantee the hosted demo cannot.

// The EFF short wordlist (CC0), 1296 words built for exactly this: every word
// is at most five letters, distinct from every other in its first three, and
// picked to survive being read aloud over a bad voice connection.
//
// A hand-written list was tried first and carried 35 bits at five words, which
// is not enough — the count of words in the list matters as much as the count
// of words in the phrase, and it is easy to be badly wrong about by eye.
export const WORDS = [
  'acid', 'acorn', 'acre', 'acts', 'afar', 'affix', 'aged', 'agent', 'agile', 'aging',
  'agony', 'ahead', 'aide', 'aids', 'aim', 'ajar', 'alarm', 'alias', 'alibi', 'alien',
  'alike', 'alive', 'aloe', 'aloft', 'aloha', 'alone', 'amend', 'amino', 'ample', 'amuse',
  'angel', 'anger', 'angle', 'ankle', 'apple', 'april', 'apron', 'aqua', 'area', 'arena',
  'argue', 'arise', 'armed', 'armor', 'army', 'aroma', 'array', 'arson', 'art', 'ashen',
  'ashes', 'atlas', 'atom', 'attic', 'audio', 'avert', 'avoid', 'awake', 'award', 'awoke',
  'axis', 'bacon', 'badge', 'bagel', 'baggy', 'baked', 'baker', 'balmy', 'banjo', 'barge',
  'barn', 'bash', 'basil', 'bask', 'batch', 'bath', 'baton', 'bats', 'blade', 'blank',
  'blast', 'blaze', 'bleak', 'blend', 'bless', 'blimp', 'blink', 'bloat', 'blob', 'blog',
  'blot', 'blunt', 'blurt', 'blush', 'boast', 'boat', 'body', 'boil', 'bok', 'bolt',
  'boned', 'boney', 'bonus', 'bony', 'book', 'booth', 'boots', 'boss', 'botch', 'both',
  'boxer', 'breed', 'bribe', 'brick', 'bride', 'brim', 'bring', 'brink', 'brisk', 'broad',
  'broil', 'broke', 'brook', 'broom', 'brush', 'buck', 'bud', 'buggy', 'bulge', 'bulk',
  'bully', 'bunch', 'bunny', 'bunt', 'bush', 'bust', 'busy', 'buzz', 'cable', 'cache',
  'cadet', 'cage', 'cake', 'calm', 'cameo', 'canal', 'candy', 'cane', 'canon', 'cape',
  'card', 'cargo', 'carol', 'carry', 'carve', 'case', 'cash', 'cause', 'cedar', 'chain',
  'chair', 'chant', 'chaos', 'charm', 'chase', 'cheek', 'cheer', 'chef', 'chess', 'chest',
  'chew', 'chief', 'chili', 'chill', 'chip', 'chomp', 'chop', 'chow', 'chuck', 'chump',
  'chunk', 'churn', 'chute', 'cider', 'cinch', 'city', 'civic', 'civil', 'clad', 'claim',
  'clamp', 'clap', 'clash', 'clasp', 'class', 'claw', 'clay', 'clean', 'clear', 'cleat',
  'cleft', 'clerk', 'click', 'cling', 'clink', 'clip', 'cloak', 'clock', 'clone', 'cloth',
  'cloud', 'clump', 'coach', 'coast', 'coat', 'cod', 'coil', 'coke', 'cola', 'cold',
  'colt', 'coma', 'come', 'comic', 'comma', 'cone', 'cope', 'copy', 'coral', 'cork',
  'cost', 'cot', 'couch', 'cough', 'cover', 'cozy', 'craft', 'cramp', 'crane', 'crank',
  'crate', 'crave', 'crawl', 'crazy', 'creme', 'crepe', 'crept', 'crib', 'cried', 'crisp',
  'crook', 'crop', 'cross', 'crowd', 'crown', 'crumb', 'crush', 'crust', 'cub', 'cult',
  'cupid', 'cure', 'curl', 'curry', 'curse', 'curve', 'curvy', 'cushy', 'cut', 'cycle',
  'dab', 'dad', 'daily', 'dairy', 'daisy', 'dance', 'dandy', 'darn', 'dart', 'dash',
  'data', 'date', 'dawn', 'deaf', 'deal', 'dean', 'debit', 'debt', 'debug', 'decaf',
  'decal', 'decay', 'deck', 'decor', 'decoy', 'deed', 'delay', 'denim', 'dense', 'dent',
  'depth', 'derby', 'desk', 'dial', 'diary', 'dice', 'dig', 'dill', 'dime', 'dimly',
  'diner', 'dingy', 'disco', 'dish', 'disk', 'ditch', 'ditzy', 'dizzy', 'dock', 'dodge',
  'doing', 'doll', 'dome', 'donor', 'donut', 'dose', 'dot', 'dove', 'down', 'dowry',
  'doze', 'drab', 'drama', 'drank', 'draw', 'dress', 'dried', 'drift', 'drill', 'drive',
  'drone', 'droop', 'drove', 'drown', 'drum', 'dry', 'duck', 'duct', 'dude', 'dug',
  'duke', 'duo', 'dusk', 'dust', 'duty', 'dwarf', 'dwell', 'eagle', 'early', 'earth',
  'easel', 'east', 'eaten', 'eats', 'ebay', 'ebony', 'ebook', 'echo', 'edge', 'eel',
  'eject', 'elbow', 'elder', 'elf', 'elk', 'elm', 'elope', 'elude', 'elves', 'email',
  'emit', 'empty', 'emu', 'enter', 'entry', 'envoy', 'equal', 'erase', 'error', 'erupt',
  'essay', 'etch', 'evade', 'even', 'evict', 'evil', 'evoke', 'exact', 'exit', 'fable',
  'faced', 'fact', 'fade', 'fall', 'false', 'fancy', 'fang', 'fax', 'feast', 'feed',
  'femur', 'fence', 'fend', 'ferry', 'fetal', 'fetch', 'fever', 'fiber', 'fifth', 'fifty',
  'film', 'filth', 'final', 'finch', 'fit', 'five', 'flag', 'flaky', 'flame', 'flap',
  'flask', 'fled', 'flick', 'fling', 'flint', 'flip', 'flirt', 'float', 'flock', 'flop',
  'floss', 'flyer', 'foam', 'foe', 'fog', 'foil', 'folic', 'folk', 'food', 'fool',
  'found', 'fox', 'foyer', 'frail', 'frame', 'fray', 'fresh', 'fried', 'frill', 'frisk',
  'from', 'front', 'frost', 'froth', 'frown', 'froze', 'fruit', 'gag', 'gains', 'gala',
  'game', 'gap', 'gas', 'gave', 'gear', 'gecko', 'geek', 'gem', 'genre', 'gift',
  'gig', 'gills', 'given', 'giver', 'glad', 'glass', 'glide', 'gloss', 'glove', 'glow',
  'glue', 'goal', 'going', 'golf', 'gong', 'good', 'gooey', 'goofy', 'gore', 'gown',
  'grab', 'grain', 'grant', 'grape', 'graph', 'grasp', 'grass', 'grave', 'gravy', 'gray',
  'green', 'greet', 'grew', 'grid', 'grief', 'grill', 'grip', 'grit', 'groom', 'grope',
  'growl', 'grub', 'grunt', 'guide', 'gulf', 'gulp', 'gummy', 'guru', 'gush', 'gut',
  'guy', 'habit', 'half', 'halo', 'halt', 'happy', 'harm', 'hash', 'hasty', 'hatch',
  'hate', 'haven', 'hazel', 'hazy', 'heap', 'heat', 'heave', 'hedge', 'hefty', 'help',
  'herbs', 'hers', 'hub', 'hug', 'hula', 'hull', 'human', 'humid', 'hump', 'hung',
  'hunk', 'hunt', 'hurry', 'hurt', 'hush', 'hut', 'ice', 'icing', 'icon', 'icy',
  'igloo', 'image', 'ion', 'iron', 'islam', 'issue', 'item', 'ivory', 'ivy', 'jab',
  'jam', 'jaws', 'jazz', 'jeep', 'jelly', 'jet', 'jiffy', 'job', 'jog', 'jolly',
  'jolt', 'jot', 'joy', 'judge', 'juice', 'juicy', 'july', 'jumbo', 'jump', 'junky',
  'juror', 'jury', 'keep', 'keg', 'kept', 'kick', 'kilt', 'king', 'kite', 'kitty',
  'kiwi', 'knee', 'knelt', 'koala', 'kung', 'ladle', 'lady', 'lair', 'lake', 'lance',
  'land', 'lapel', 'large', 'lash', 'lasso', 'last', 'latch', 'late', 'lazy', 'left',
  'legal', 'lemon', 'lend', 'lens', 'lent', 'level', 'lever', 'lid', 'life', 'lift',
  'lilac', 'lily', 'limb', 'limes', 'line', 'lint', 'lion', 'lip', 'list', 'lived',
  'liver', 'lunar', 'lunch', 'lung', 'lurch', 'lure', 'lurk', 'lying', 'lyric', 'mace',
  'maker', 'malt', 'mama', 'mango', 'manor', 'many', 'map', 'march', 'mardi', 'marry',
  'mash', 'match', 'mate', 'math', 'moan', 'mocha', 'moist', 'mold', 'mom', 'moody',
  'mop', 'morse', 'most', 'motor', 'motto', 'mount', 'mouse', 'mousy', 'mouth', 'move',
  'movie', 'mower', 'mud', 'mug', 'mulch', 'mule', 'mull', 'mumbo', 'mummy', 'mural',
  'muse', 'music', 'musky', 'mute', 'nacho', 'nag', 'nail', 'name', 'nanny', 'nap',
  'navy', 'near', 'neat', 'neon', 'nerd', 'nest', 'net', 'next', 'niece', 'ninth',
  'nutty', 'oak', 'oasis', 'oat', 'ocean', 'oil', 'old', 'olive', 'omen', 'onion',
  'only', 'ooze', 'opal', 'open', 'opera', 'opt', 'otter', 'ouch', 'ounce', 'outer',
  'oval', 'oven', 'owl', 'ozone', 'pace', 'pagan', 'pager', 'palm', 'panda', 'panic',
  'pants', 'panty', 'paper', 'park', 'party', 'pasta', 'patch', 'path', 'patio', 'payer',
  'pecan', 'penny', 'pep', 'perch', 'perky', 'perm', 'pest', 'petal', 'petri', 'petty',
  'photo', 'plank', 'plant', 'plaza', 'plead', 'plot', 'plow', 'pluck', 'plug', 'plus',
  'poach', 'pod', 'poem', 'poet', 'pogo', 'point', 'poise', 'poker', 'polar', 'polio',
  'polka', 'polo', 'pond', 'pony', 'poppy', 'pork', 'poser', 'pouch', 'pound', 'pout',
  'power', 'prank', 'press', 'print', 'prior', 'prism', 'prize', 'probe', 'prong', 'proof',
  'props', 'prude', 'prune', 'pry', 'pug', 'pull', 'pulp', 'pulse', 'puma', 'punch',
  'punk', 'pupil', 'puppy', 'purr', 'purse', 'push', 'putt', 'quack', 'quake', 'query',
  'quiet', 'quill', 'quilt', 'quit', 'quota', 'quote', 'rabid', 'race', 'rack', 'radar',
  'radio', 'raft', 'rage', 'raid', 'rail', 'rake', 'rally', 'ramp', 'ranch', 'range',
  'rank', 'rant', 'rash', 'raven', 'reach', 'react', 'ream', 'rebel', 'recap', 'relax',
  'relay', 'relic', 'remix', 'repay', 'repel', 'reply', 'rerun', 'reset', 'rhyme', 'rice',
  'rich', 'ride', 'rigid', 'rigor', 'rinse', 'riot', 'ripen', 'rise', 'risk', 'ritzy',
  'rival', 'river', 'roast', 'robe', 'robin', 'rock', 'rogue', 'roman', 'romp', 'rope',
  'rover', 'royal', 'ruby', 'rug', 'ruin', 'rule', 'runny', 'rush', 'rust', 'rut',
  'sadly', 'sage', 'said', 'saint', 'salad', 'salon', 'salsa', 'salt', 'same', 'sandy',
  'santa', 'satin', 'sauna', 'saved', 'savor', 'sax', 'say', 'scale', 'scam', 'scan',
  'scare', 'scarf', 'scary', 'scoff', 'scold', 'scoop', 'scoot', 'scope', 'score', 'scorn',
  'scout', 'scowl', 'scrap', 'scrub', 'scuba', 'scuff', 'sect', 'sedan', 'self', 'send',
  'sepia', 'serve', 'set', 'seven', 'shack', 'shade', 'shady', 'shaft', 'shaky', 'sham',
  'shape', 'share', 'sharp', 'shed', 'sheep', 'sheet', 'shelf', 'shell', 'shine', 'shiny',
  'ship', 'shirt', 'shock', 'shop', 'shore', 'shout', 'shove', 'shown', 'showy', 'shred',
  'shrug', 'shun', 'shush', 'shut', 'shy', 'sift', 'silk', 'silly', 'silo', 'sip',
  'siren', 'sixth', 'size', 'skate', 'skew', 'skid', 'skier', 'skies', 'skip', 'skirt',
  'skit', 'sky', 'slab', 'slack', 'slain', 'slam', 'slang', 'slash', 'slate', 'slaw',
  'sled', 'sleek', 'sleep', 'sleet', 'slept', 'slice', 'slick', 'slimy', 'sling', 'slip',
  'slit', 'slob', 'slot', 'slug', 'slum', 'slurp', 'slush', 'small', 'smash', 'smell',
  'smile', 'smirk', 'smog', 'snack', 'snap', 'snare', 'snarl', 'sneak', 'sneer', 'sniff',
  'snore', 'snort', 'snout', 'snowy', 'snub', 'snuff', 'speak', 'speed', 'spend', 'spent',
  'spew', 'spied', 'spill', 'spiny', 'spoil', 'spoke', 'spoof', 'spool', 'spoon', 'sport',
  'spot', 'spout', 'spray', 'spree', 'spur', 'squad', 'squat', 'squid', 'stack', 'staff',
  'stage', 'stain', 'stall', 'stamp', 'stand', 'stank', 'stark', 'start', 'stash', 'state',
  'stays', 'steam', 'steep', 'stem', 'step', 'stew', 'stick', 'sting', 'stir', 'stock',
  'stole', 'stomp', 'stony', 'stood', 'stool', 'stoop', 'stop', 'storm', 'stout', 'stove',
  'straw', 'stray', 'strut', 'stuck', 'stud', 'stuff', 'stump', 'stung', 'stunt', 'suds',
  'sugar', 'sulk', 'surf', 'sushi', 'swab', 'swan', 'swarm', 'sway', 'swear', 'sweat',
  'sweep', 'swell', 'swept', 'swim', 'swing', 'swipe', 'swirl', 'swoop', 'swore', 'syrup',
  'tacky', 'taco', 'tag', 'take', 'tall', 'talon', 'tamer', 'tank', 'taper', 'taps',
  'tarot', 'tart', 'task', 'taste', 'tasty', 'taunt', 'thank', 'thaw', 'theft', 'theme',
  'thigh', 'thing', 'think', 'thong', 'thorn', 'those', 'throb', 'thud', 'thumb', 'thump',
  'thus', 'tiara', 'tidal', 'tidy', 'tiger', 'tile', 'tilt', 'tint', 'tiny', 'trace',
  'track', 'trade', 'train', 'trait', 'trap', 'trash', 'tray', 'treat', 'tree', 'trek',
  'trend', 'trial', 'tribe', 'trick', 'trio', 'trout', 'truce', 'truck', 'trump', 'trunk',
  'try', 'tug', 'tulip', 'tummy', 'turf', 'tusk', 'tutor', 'tutu', 'tux', 'tweak',
  'tweet', 'twice', 'twine', 'twins', 'twirl', 'twist', 'uncle', 'uncut', 'undo', 'unify',
  'union', 'unit', 'untie', 'upon', 'upper', 'urban', 'used', 'user', 'usher', 'utter',
  'value', 'vapor', 'vegan', 'venue', 'verse', 'vest', 'veto', 'vice', 'video', 'view',
  'viral', 'virus', 'visa', 'visor', 'vixen', 'vocal', 'voice', 'void', 'volt', 'voter',
  'vowel', 'wad', 'wafer', 'wager', 'wages', 'wagon', 'wake', 'walk', 'wand', 'wasp',
  'watch', 'water', 'wavy', 'wheat', 'whiff', 'whole', 'whoop', 'wick', 'widen', 'widow',
  'width', 'wife', 'wifi', 'wilt', 'wimp', 'wind', 'wing', 'wink', 'wipe', 'wired',
  'wiry', 'wise', 'wish', 'wispy', 'wok', 'wolf', 'womb', 'wool', 'woozy', 'word',
  'work', 'worry', 'wound', 'woven', 'wrath', 'wreck', 'wrist', 'xerox', 'yahoo', 'yam',
  'yard', 'year', 'yeast', 'yelp', 'yield', 'yo-yo', 'yodel', 'yoga', 'yoyo', 'yummy',
  'zebra', 'zero', 'zesty', 'zippy', 'zone', 'zoom',
];

// Five words from this list. Fewer would not carry enough for the KDF below to
// hold the line, so the count is a floor rather than a preference.
export const PHRASE_WORDS = 5;

// Bits of entropy in a generated passphrase. Reported rather than assumed, so a
// change to the wordlist cannot silently weaken every room.
export const PHRASE_BITS = Math.log2(Math.pow(WORDS.length, PHRASE_WORDS));

// OWASP's current floor for PBKDF2-SHA256. Roughly a third of a second on a
// Raspberry Pi, so comfortably under half that on a phone.
//
// Argon2id would be the better primitive — it is memory-hard, which is what
// actually blunts GPU attacks — but WebCrypto does not implement it and the only
// way to get it in a browser is a WASM blob. That would break the single-file
// build, which is the build that carries the real privacy guarantee. Trading a
// stronger KDF for a weaker deployment story is the wrong way round.
const KDF_ITERATIONS = 600000;

// Bound: unbounded input into a deliberately slow KDF is a way to make someone
// else's phone hang.
const MAX_PHRASE_LENGTH = 200;

const enc = new TextEncoder();
const dec = new TextDecoder();

// Uniform over the wordlist, via rejection sampling. `% WORDS.length` would bias
// toward earlier words, and biased passphrases are weaker than they look.
function randomWord() {
  const limit = Math.floor(0x100000000 / WORDS.length) * WORDS.length;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return WORDS[buf[0] % WORDS.length];
  }
}

export function generatePassphrase() {
  const words = [];
  for (let i = 0; i < PHRASE_WORDS; i++) words.push(randomWord());
  return words.join('-');
}

// Accepts what people actually type: extra spaces, capitals, and the hyphens or
// spaces they might use as separators. Rejecting a correct passphrase over
// punctuation would be its own kind of failure.
export function normalizePassphrase(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Everything the room needs, from the passphrase alone.
//
//   K       = PBKDF2(passphrase)
//   roomId  = HKDF(K, "id")   -> the relay sees this
//   roomKey = HKDF(K, "key")  -> never leaves the device
//
// The relay learning roomId reveals nothing about roomKey: HKDF is one-way, and
// the two are derived with different info strings so neither leaks the other.
export async function deriveRoom(passphrase) {
  const phrase = normalizePassphrase(passphrase);
  if (!phrase) throw new Error('Passphrase is empty');
  if (phrase.length > MAX_PHRASE_LENGTH) throw new Error('Passphrase is too long');

  const base = await crypto.subtle.importKey(
    'raw', enc.encode(phrase), 'PBKDF2', false, ['deriveBits']);

  // A fixed salt. Per-room salts are the usual advice and cannot apply here:
  // everyone must derive the same key from the same phrase with nothing else
  // shared, so there is nowhere for a random salt to come from. The version
  // string is what lets this be changed later without silently reusing keys.
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('dicebox-room-v1'), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base, 256);

  const master = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);

  const idBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('dicebox-room-v1-id') },
    master, 128);

  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('dicebox-room-v1-key') },
    master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

  return { roomId: hex(new Uint8Array(idBits)), key };
}

function hex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Every message is padded to a multiple of this before encryption. Without it,
// ciphertext length tracks the number of dice and the length of a display name,
// so a relay that cannot read a single roll could still tell a 1d20 from a
// 20d6, and tell players apart by how long their names are.
const PAD_BLOCK = 256;

function pad(bytes) {
  // Two length bytes, then the payload, then zeros to the block boundary.
  const total = Math.ceil((bytes.length + 2) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(total);
  out[0] = bytes.length >> 8;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function unpad(bytes) {
  if (bytes.length < 2) throw new Error('Message is truncated');
  const len = (bytes[0] << 8) | bytes[1];
  if (len + 2 > bytes.length) throw new Error('Message length is impossible');
  return bytes.subarray(2, 2 + len);
}

// The protocol version, carried in every message and in the AEAD's additional
// data. It exists so that a future fix to this file makes old clients fail
// closed rather than interoperate badly — the service worker serves from cache
// first, so old clients stay in circulation long after a change ships. This
// cannot be added later: a message without it is indistinguishable from a
// message that predates it.
export const PROTOCOL_VERSION = 1;

// A sender identity for the life of one connection. The counter below combines
// with it to make nonces that cannot repeat.
export function newSender() {
  const id = new Uint8Array(4);
  crypto.getRandomValues(id);
  return { id: hex(id), bytes: id, counter: 0 };
}

// Nonce is senderId(4) || counter(8), never random.
//
// Every client in a room encrypts under the same key, and AES-GCM does not
// merely weaken on a repeated nonce — it leaks the authentication key and the
// XOR of both plaintexts. Random 96-bit nonces across several senders rely on
// birthday bounds holding; constructing them from a per-sender id and a counter
// removes the possibility instead of making it unlikely.
function nonceFor(sender) {
  const nonce = new Uint8Array(12);
  nonce.set(sender.bytes, 0);
  const n = ++sender.counter;
  // 64-bit counter, big-endian. Split because a JS number cannot hold 2^64.
  const hi = Math.floor(n / 0x100000000);
  const lo = n >>> 0;
  new DataView(nonce.buffer).setUint32(4, hi);
  new DataView(nonce.buffer).setUint32(8, lo);
  return nonce;
}

// Additional authenticated data: not encrypted, but the tag covers it, so a
// message cannot be replayed into a different room or reinterpreted under a
// different protocol version.
function aad(roomId) {
  return enc.encode(`${roomId}:${PROTOCOL_VERSION}`);
}

export async function encryptMessage(room, sender, payload) {
  const nonce = nonceFor(sender);
  const body = pad(enc.encode(JSON.stringify({
    v: PROTOCOL_VERSION,
    from: sender.id,
    seq: sender.counter,
    ...payload,
  })));

  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(room.roomId) }, room.key, body);

  const out = new Uint8Array(nonce.length + ct.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(ct), nonce.length);
  return base64(out);
}

// Decrypts and checks everything that has to be checked before a message is
// trusted. `seen` is the caller's per-room map of senderId -> highest sequence.
export async function decryptMessage(room, seen, wire) {
  const raw = unbase64(wire);
  if (raw.length < 13) throw new Error('Message is too short');

  const nonce = raw.subarray(0, 12);
  const ct = raw.subarray(12);

  // Failure here means a wrong passphrase, a corrupted message, or tampering.
  // They are indistinguishable by design and all mean the same thing: do not
  // trust this.
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(room.roomId) }, room.key, ct);

  const msg = JSON.parse(dec.decode(unpad(new Uint8Array(plain))));

  if (msg.v !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version ${msg.v}`);
  }

  // The `from` field is plaintext-in-the-ciphertext: the tag stops an outsider
  // editing it, but every room member holds the key and can simply write
  // someone else's id into a message they encrypt under their own nonce. That
  // was enough to wedge a victim permanently — forge from: victim, seq: 2**40,
  // and every receiver poisons seen[victim], after which the victim's genuine
  // messages all fail the sequence check below and vanish with no error. The
  // nonce prefix is the only identity the sender cannot choose freely, since a
  // second sender using it would repeat a nonce, so bind attribution to it.
  if (msg.from !== hex(nonce.subarray(0, 4))) {
    throw new Error('Sender id does not match the nonce');
  }

  // Replay. The relay, or anyone who captured a message, could send a good roll
  // again; without this it would appear twice in everyone's tray. Sequence
  // numbers live inside the ciphertext, so they cannot be edited in transit.
  const last = seen.get(msg.from);
  if (last !== undefined && msg.seq <= last) {
    throw new Error('Replayed or out-of-order message');
  }
  seen.set(msg.from, msg.seq);

  return msg;
}

function base64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unbase64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
