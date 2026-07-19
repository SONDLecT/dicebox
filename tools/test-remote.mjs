// The rule that decides whether an arriving roll may take the tray.
//
// A remote roll yields to a throw of your own and supersedes another remote
// roll. Testing dataset.rolling alone treated those the same, so once remote
// rolls started animating, a second one arriving inside the first one's flight
// was silently dropped: two quick rolls at one table showed as one everywhere
// else, with the log correct and the tray a roll behind.
//
// The condition is read out of app.js rather than restated here. A copy would
// keep passing after the real one changed, which for a one-line guard is the
// entire risk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

// The guard, lifted from source. Anchored on showRemoteRoll so a rename or a
// move fails here rather than quietly testing nothing.
const fn = app.slice(app.indexOf('function showRemoteRoll'));
const guard = fn.slice(0, fn.indexOf('\n}')).match(/if \((.+?)\) return;/);

ok('the guard is still where this test expects it', !!guard);

if (guard) {
  const condition = guard[1];

  // Evaluated against the two pieces of state it reads: whether the tray is
  // claimed, and whether the claim belongs to a remote roll.
  const blocked = (rolling, remoteClaim) => {
    const $ = () => ({ dataset: rolling ? { rolling: '1' } : {} });
    const state = { remoteClaim };
    return Function('$', 'state', `return (${condition});`)($, state);
  };

  ok('an idle tray accepts a remote roll', !blocked(false, null));

  ok('your own throw is never interrupted', blocked(true, null),
     'a remote roll took the tray mid-throw');

  // The regression. Before the fix this returned true and the second of two
  // quick rolls never reached the tray.
  ok('a second remote roll supersedes the first', !blocked(true, {}),
     'the second of two quick remote rolls was dropped');

  // A stale claim with no animation running must not block anything.
  ok('a cleared tray accepts the next roll', !blocked(false, {}));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
