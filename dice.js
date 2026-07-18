// Dice notation parser and roller.
// Grammar: expr := term (('+'|'-') term)*
//          term := dice | integer
//          dice := [count] 'd' sides [modifiers]
//          modifiers := kh<n> | kl<n> | dh<n> | dl<n> | '!' (explode) | r<n> (reroll <= n)

export const DCC_CHAIN = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30];

export function stepChain(sides, steps) {
  const i = DCC_CHAIN.indexOf(sides);
  if (i === -1) return sides;
  return DCC_CHAIN[Math.min(DCC_CHAIN.length - 1, Math.max(0, i + steps))];
}

const MAX_DICE = 500;
const MAX_SIDES = 10000;
const MAX_EXPLOSIONS = 100;

// Cryptographically strong uniform integer in [1, sides], rejection-sampled to
// avoid the modulo bias a naive `% sides` would introduce.
function randInt(sides) {
  if (sides <= 1) return 1;
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return (v % sides) + 1;
}

class Parser {
  constructor(src) {
    this.src = src.toLowerCase().replace(/\s+/g, '');
    this.pos = 0;
  }
  peek() { return this.src[this.pos]; }
  eof() { return this.pos >= this.src.length; }

  number() {
    const start = this.pos;
    while (!this.eof() && /[0-9]/.test(this.peek())) this.pos++;
    if (start === this.pos) return null;
    return parseInt(this.src.slice(start, this.pos), 10);
  }

  parse() {
    const terms = [];
    let sign = 1;
    for (;;) {
      const term = this.term(sign);
      terms.push(term);
      if (this.eof()) break;
      const op = this.peek();
      if (op === '+') sign = 1;
      else if (op === '-') sign = -1;
      else throw new Error(`Unexpected "${op}"`);
      this.pos++;
      if (this.eof()) throw new Error('Expression ends with an operator');
    }
    return terms;
  }

  term(sign) {
    const count = this.number();
    if (this.peek() !== 'd') {
      if (count === null) throw new Error('Expected a number or dice term');
      return { kind: 'const', sign, value: count };
    }
    this.pos++; // consume 'd'

    let sides;
    if (this.peek() === '%') { this.pos++; sides = 100; }
    else {
      sides = this.number();
      if (sides === null) throw new Error('Expected number of sides after "d"');
    }

    const n = count === null ? 1 : count;
    if (n < 1 || n > MAX_DICE) throw new Error(`Dice count must be 1-${MAX_DICE}`);
    if (sides < 1 || sides > MAX_SIDES) throw new Error(`Sides must be 1-${MAX_SIDES}`);

    const mods = { keepHigh: null, keepLow: null, explode: false, rerollBelow: null };
    for (;;) {
      if (this.src.startsWith('kh', this.pos)) {
        this.pos += 2; mods.keepHigh = this.number() ?? 1;
      } else if (this.src.startsWith('kl', this.pos)) {
        this.pos += 2; mods.keepLow = this.number() ?? 1;
      } else if (this.src.startsWith('dh', this.pos)) {
        this.pos += 2; mods.keepLow = n - (this.number() ?? 1);
      } else if (this.src.startsWith('dl', this.pos)) {
        this.pos += 2; mods.keepHigh = n - (this.number() ?? 1);
      } else if (this.peek() === '!') {
        this.pos++; mods.explode = true;
      } else if (this.peek() === 'r') {
        this.pos++; mods.rerollBelow = this.number() ?? 1;
      } else break;
    }

    if (mods.explode && sides === 1) {
      throw new Error('d1 cannot explode — it would never stop');
    }
    return { kind: 'dice', sign, count: n, sides, mods };
  }
}

function rollTerm(term) {
  const { count, sides, mods } = term;
  const dice = [];

  for (let i = 0; i < count; i++) {
    let value = randInt(sides);
    let rerolled = false;

    if (mods.rerollBelow !== null && mods.rerollBelow < sides) {
      while (value <= mods.rerollBelow) { value = randInt(sides); rerolled = true; }
    }

    const die = { value, rerolled, exploded: false, kept: true, crit: null };

    if (mods.explode) {
      let bursts = 0;
      while (value === sides && bursts < MAX_EXPLOSIONS) {
        value = randInt(sides);
        die.value += value;
        die.exploded = true;
        bursts++;
      }
    }

    if (die.value === sides && !die.exploded) die.crit = 'max';
    else if (die.value === 1) die.crit = 'min';

    dice.push(die);
  }

  // Keep/drop: mark the losers rather than removing them, so the UI can grey
  // them out instead of silently hiding dice the user watched roll.
  const keepN = mods.keepHigh ?? mods.keepLow;
  if (keepN !== null) {
    const n = Math.max(0, Math.min(count, keepN));
    const order = dice
      .map((d, i) => ({ i, v: d.value }))
      .sort((a, b) => (mods.keepHigh !== null ? b.v - a.v : a.v - b.v));
    order.forEach((entry, rank) => { dice[entry.i].kept = rank < n; });
  }

  const total = dice.reduce((sum, d) => sum + (d.kept ? d.value : 0), 0);
  return { dice, total };
}

export function roll(notation) {
  const src = String(notation || '').trim();
  if (!src) throw new Error('Enter something like 3d6 or 1d20+5');

  const terms = new Parser(src).parse();
  let total = 0;
  const groups = [];

  for (const term of terms) {
    if (term.kind === 'const') {
      total += term.sign * term.value;
      groups.push({ kind: 'const', sign: term.sign, value: term.value });
    } else {
      const { dice, total: sub } = rollTerm(term);
      total += term.sign * sub;
      groups.push({
        kind: 'dice', sign: term.sign, count: term.count,
        sides: term.sides, mods: term.mods, dice, subtotal: sub,
      });
    }
  }

  return { notation: src, groups, total };
}

export function describe(groups) {
  return groups.map((g, i) => {
    const op = g.sign < 0 ? '−' : i === 0 ? '' : '+';
    if (g.kind === 'const') return `${op}${g.value}`;
    const rolls = g.dice.map(d => (d.kept ? d.value : `(${d.value})`)).join(', ');
    return `${op}${g.count}d${g.sides} [${rolls}]`;
  }).join(' ').trim();
}
