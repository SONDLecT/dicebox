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

// The tray-ownership guard, lifted from source. showRemoteRoll now has a separate
// dedupe guard before it, so select the condition by the state it is meant to
// exercise rather than assuming it will always be the function's first return.
const fn = app.slice(app.indexOf('function showRemoteRoll'));
const guardLine = fn.split('\n').find(line =>
  line.includes("$('total').dataset.rolling") && line.includes('return;'));
const guard = guardLine?.match(/if \((.*)\) return;/);

ok('the tray-ownership guard is still where this test expects it', !!guard);

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

// A pushed result is not a fresh full-pool throw. The originating roll ID and
// explicit index sets must survive publication, and the remote animator must
// mutate/throw only picked dice while leaving held dice locked in place.
const preparePush = app.slice(app.indexOf('function preparePush'), app.indexOf('function rollPendingPush'));
const remotePushStart = app.indexOf('function showRemotePushTransition');
const remotePush = remotePushStart >= 0
  ? app.slice(remotePushStart, app.indexOf('function showRemoteRoll', remotePushStart))
  : '';
ok('local pushes publish their originating roll reference',
   preparePush.includes('parentId') && preparePush.includes('last.rollId'));
ok('local pushes publish held/rerolled/added transition indices',
   preparePush.includes('transition') && preparePush.includes('held') &&
   preparePush.includes('rerolled') && preparePush.includes('added'));
ok('remote pushes have a dedicated transition animator', remotePush.length > 0);
ok('remote push animator throws only dice marked as picked',
   remotePush.includes('if (!d.picked) return') && remotePush.includes('d.throwWith'));
ok('remote push animator keeps held dice visibly locked through the reroll',
   remotePush.includes('d.locked = true') && remotePush.includes('d.locked = false'));
ok('a push arriving during another animation falls back to a fresh authoritative render',
   remotePush.includes("if ($('total').dataset.rolling) return false;"));

const remoteRollPath = app.slice(app.indexOf('function showRemoteRoll'), app.indexOf('function showRoster'));
const owlbearReceivePath = app.slice(app.indexOf('function initializeOwlbear'), app.indexOf('if (owlbearPanel)'));
ok('incoming Owlbear rolls cannot be forwarded into the passphrase-room relay',
   !remoteRollPath.includes('roomLink.') && !remoteRollPath.includes('broadcastToOwlbear('));
ok('the Owlbear listener cannot amplify received messages back onto either transport',
   !owlbearReceivePath.includes('roomLink.') && !owlbearReceivePath.includes('broadcastToOwlbear('));

const doRollPath = app.slice(app.indexOf('function doRoll'), app.indexOf('function throwResult'));
const owlRequestPath = app.slice(app.indexOf('function sendOwlbearRequest'), app.lastIndexOf('if (owlbearPanel)'));
ok('Owlbear panel rolls send intent to the background before any local RNG path',
   doRollPath.indexOf('requestOwlbearRoll(notation)') >= 0
   && doRollPath.indexOf('requestOwlbearRoll(notation)') < doRollPath.indexOf('detectSystem(notation)'));
ok('the panel no longer publishes caller-supplied completed outcomes',
   !app.includes("type: 'roll.publish'") && !app.includes('function broadcastToOwlbear'));
ok('local RPC responses require authentication before correlation or state access',
   owlRequestPath.includes('await verifyLocalPayload(getOrCreateLocalAuthSecret(localStorage), data)')
   && owlRequestPath.indexOf('await verifyLocalPayload(getOrCreateLocalAuthSecret(localStorage), data)')
      < owlRequestPath.indexOf('obrOutstanding.get(data.requestId)'));
ok('local authoritative action and roll results protect newer state from stale history hydration',
   owlRequestPath.includes("if (data.type === 'action.result')")
   && (owlRequestPath.match(/if \(obrHistorySync\) obrHistorySync\.live = true;/g) || []).length >= 2);

ok('local RPC responses require both origin and outstanding-request correlation',
   owlRequestPath.includes('event.connectionId !== obrConnectionId')
   && owlRequestPath.includes('obrOutstanding.get(data.requestId)'));
ok('history hydration is correlated, page-counted, bounded, and buffered before merge',
   owlRequestPath.includes('data.pageCount') && owlRequestPath.includes('sync.pages.set')
   && owlRequestPath.includes('OBR_MAX_HYDRATION_BYTES') && owlRequestPath.includes('sync.live'));
ok('push rehoming leaves held dice untouched',
   remotePush.includes('rehomeUnlockedGrid(state.dice)') && !remotePush.includes('packInto(kept'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
