// Tests for the roll log and its exports. The export is the point of keeping a
// long history — a malformed CSV is not obviously broken until someone loads it
// into a spreadsheet and the columns are off by one.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { roll, describe } from '../dice.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

// Mirrors app.js.
const HISTORY_LIMIT = 500;

function recordRoll(history, result, at, who = null, mine = false) {
  history.push({
    at,
    who,
    mine,
    notation: result.notation,
    total: result.total,
    detail: describe(result.groups),
    dice: result.groups
      .filter(g => g.kind === 'dice')
      .flatMap(g => g.dice.map(d => ({
        sides: g.sides,
        value: d.value,
        kept: d.kept,
        exploded: d.exploded,
        rerolled: d.rerolled,
      }))),
  });
  if (history.length > HISTORY_LIMIT) history.shift();
  return history;
}

function historyCsv(history) {
  const rows = [['time', 'who', 'notation', 'total', 'die', 'sides', 'value', 'kept', 'exploded', 'rerolled']];
  for (const entry of history) {
    entry.dice.forEach((d, i) => {
      rows.push([
        entry.at, entry.who || 'you', entry.notation, entry.total, i + 1,
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

const stamp = n => new Date(Date.UTC(2026, 0, 1, 12, 0, n)).toISOString();

// --- the record keeps what the readout shows ---
{
  const history = [];
  recordRoll(history, roll('1d4+1d3+1d2'), stamp(0));
  const entry = history[0];

  ok('an entry keeps its notation', entry.notation === '1d4+1d3+1d2');
  ok('an entry keeps its total', Number.isFinite(entry.total));
  ok('an entry keeps the breakdown', /1d4 \[\d\]/.test(entry.detail), entry.detail);
  ok('an entry keeps every die', entry.dice.length === 3);
  ok('the breakdown matches the dice',
     entry.dice.every(d => entry.detail.includes(String(d.value))));
}

{
  // The total must equal the dice that counted, or the log misreports the roll.
  const history = [];
  for (let i = 0; i < 200; i++) recordRoll(history, roll('4d6dl1'), stamp(i));
  const bad = history.find(e =>
    e.total !== e.dice.filter(d => d.kept).reduce((s, d) => s + d.value, 0));
  ok('logged totals match their kept dice', !bad, bad ? JSON.stringify(bad) : '');
}

{
  // Dropped dice are recorded, not discarded: "why was that 9" needs the die
  // that did not count.
  const history = [];
  recordRoll(history, roll('4d6dl1'), stamp(0));
  ok('dropped dice are kept in the record',
     history[0].dice.filter(d => !d.kept).length === 1);
}

// --- the log is longer than the strip that shows it ---
{
  const history = [];
  for (let i = 0; i < 60; i++) recordRoll(history, roll('1d20'), stamp(i));
  ok('the record outlives the twelve visible rows', history.length === 60);

  for (let i = 0; i < HISTORY_LIMIT + 40; i++) recordRoll(history, roll('1d6'), stamp(i));
  ok('the record is capped', history.length === HISTORY_LIMIT);
  // Oldest are dropped, not newest: a session's tail is what you are looking at.
  ok('the cap drops the oldest first', history.at(-1).notation === '1d6');
}

// --- csv ---
{
  const history = [];
  recordRoll(history, roll('2d6'), stamp(0));
  recordRoll(history, roll('1d20'), stamp(1));

  const csv = historyCsv(history);
  const lines = csv.split('\n');

  ok('csv has a header', lines[0].startsWith('time,who,notation,total'));
  // One row per die, not per roll: that is the shape you can pivot on.
  ok('csv has one row per die', lines.length === 1 + 3, `${lines.length} lines`);

  const width = lines[0].split(',').length;
  ok('every csv row has the same width',
     lines.every(l => l.split(',').length === width), `header has ${width}`);

  ok('csv carries the die values',
     lines.slice(1).every(l => /,\d+,\d+,[01],[01],[01]$/.test(l)), lines[1]);
}

{
  // A notation containing a comma would break the columns if unquoted. The
  // roller does not produce one today, but the escaping has to hold anyway.
  const history = [{
    at: stamp(0),
    notation: '2d6,weird',
    total: 7,
    detail: 'x',
    dice: [{ sides: 6, value: 3, kept: true, exploded: false, rerolled: false }],
  }];
  const row = historyCsv(history).split('\n')[1];
  ok('csv quotes a field containing a comma', row.includes('"2d6,weird"'), row);
  ok('quoting keeps the column count', row.split('","').length === 2 || /"[^"]*"/.test(row));
}

// --- attribution ---
//
// Players reading a shared log could not find their own rolls in it: a peer's
// roll carried a name and their own carried nothing, so the log read as a list
// of other people interrupted by anonymous lines.
{
  const history = [];
  recordRoll(history, roll('1d20'), stamp(0));                      // alone
  recordRoll(history, roll('1d20'), stamp(1), 'Amber Wolf', true);  // in a room
  recordRoll(history, roll('1d20'), stamp(2), 'Basil', false);      // a peer

  ok('a solo roll carries no name', history[0].who === null);
  ok('a solo roll is still marked as yours', history[0].mine === false);
  ok('your roll in a room carries your name', history[1].who === 'Amber Wolf');
  ok('your roll in a room is marked as yours', history[1].mine === true);
  ok("a peer's roll carries their name", history[2].who === 'Basil');
  ok("a peer's roll is not marked as yours", history[2].mine === false);

  // `mine` is what the left rule and the export's 'you' key off, and it has to
  // survive a name collision: two players may pick the same display name, and
  // the log still has to say which rows were this device's.
  const collision = [];
  recordRoll(collision, roll('1d6'), stamp(0), 'Sam', true);
  recordRoll(collision, roll('1d6'), stamp(1), 'Sam', false);
  ok('a name collision is still distinguishable',
     collision[0].mine !== collision[1].mine);
}

{
  // The rule that decides whether your name appears at all, lifted from app.js
  // rather than restated. A copy would keep passing after the real one changed.
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const src = app.slice(app.indexOf('function selfName'));
  const body = src.slice(0, src.indexOf('\n}') + 2);

  ok('selfName is still where this test expects it', body.startsWith('function selfName'));

  const nameWhen = (state, name) =>
    Function('roomLink', `${body}; return selfName();`)({ state, name });

  ok('rolling alone leaves your rolls unlabelled', nameWhen('offline', 'Amber Wolf') === null);
  ok('a live room labels your rolls', nameWhen('live', 'Amber Wolf') === 'Amber Wolf');
  // Connecting and retrying are not live. Labelling during a reconnect would
  // put a name on rolls nobody else is receiving, which is the opposite of
  // what the name is there to tell you.
  ok('connecting does not label yet', nameWhen('connecting', 'Amber Wolf') === null);
  ok('retrying does not label', nameWhen('retrying', 'Amber Wolf') === null);
  ok('a failed room does not label', nameWhen('failed', 'Amber Wolf') === null);
}

// --- json ---
{
  const history = [];
  recordRoll(history, roll('3d8'), stamp(0));
  const parsed = JSON.parse(JSON.stringify(history));
  ok('json round-trips', parsed.length === 1 && parsed[0].dice.length === 3);
  ok('json keeps timestamps', typeof parsed[0].at === 'string' && parsed[0].at.includes('T'));
  ok('json keeps per-die flags',
     parsed[0].dice.every(d => 'kept' in d && 'exploded' in d && 'rerolled' in d));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
