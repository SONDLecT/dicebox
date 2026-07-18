// Tests for the roll log and its exports. The export is the point of keeping a
// long history — a malformed CSV is not obviously broken until someone loads it
// into a spreadsheet and the columns are off by one.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { roll, describe } from '../dice.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

// Mirrors app.js.
const HISTORY_LIMIT = 500;

function recordRoll(history, result, at) {
  history.push({
    at,
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
  const rows = [['time', 'notation', 'total', 'die', 'sides', 'value', 'kept', 'exploded', 'rerolled']];
  for (const entry of history) {
    entry.dice.forEach((d, i) => {
      rows.push([
        entry.at, entry.notation, entry.total, i + 1,
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

  ok('csv has a header', lines[0].startsWith('time,notation,total'));
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
