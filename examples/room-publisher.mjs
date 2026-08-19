// A minimal Dicebox room publisher: join a passphrase room and roll as a player.
//
// This is the "character sheet that rolls as you" pattern from docs/room-api.md.
// The app is just another room member. It rolls through Dicebox's own dice engine
// so the payload is always valid, and announces the result under the player's name.
//
// Runs in a browser (or any runtime with global `WebSocket` and `crypto.subtle` —
// Node 20+ has `crypto` as `globalThis.crypto`; supply a `WebSocketImpl` there).
//
// The four files below ARE the package. Vendor them as a set, or import them from
// wherever you keep them — they are dependency-free ES modules and this is the
// supported surface. (An npm distribution may follow if there's demand; until
// then, these files with their exported functions are the contract.)

import { createRoom } from '../room.js';        // transport: join, share, presence
import { rollAny } from '../system-dice.js';    // every system's roller
import { roll as rollNumeric } from '../dice.js'; // plain dice (2d20+3, 4d6, …)

// Produce a room-ready result for ANY notation. rollAny handles the system modes;
// numeric notation comes back flagged `deferred`, to be finished by the plain-dice
// engine. Either way the result carries { system, notation, groups, summary } —
// exactly what room.share() puts on the wire.
export function rollForRoom(notation) {
  const result = rollAny(notation);
  return result.deferred ? rollNumeric(notation) : result;
}

// A stable id per roll lets a receiver that's on two transports at once (a relay
// room and the Owlbear bus) drop the duplicate. Any unique string works; make it
// deterministic for one roll, not random per render.
let seq = 0;
const nextRollId = () => `sheet-${Date.now()}-${seq++}`;

export function createSheetRoller({ relayUrl, passphrase, playerName, WebSocketImpl }) {
  const room = createRoom({
    url: relayUrl,
    name: playerName,           // the player this app rolls for — a free label
    WebSocketImpl,              // omit in a browser; pass `ws` or global in Node
    // You can observe the table too, not just publish into it:
    onRoll: r => console.log(`${r.name} rolled ${r.notation}`),
    onPresence: list => console.log(`${list.length} at the table`),
    onNotice: text => console.warn(text),
  });

  return {
    join: () => room.join(passphrase),   // resolves once the room is live
    leave: () => room.leave(),

    // Call this when the player taps an action on your sheet.
    rollAs(notation) {
      const result = rollForRoom(notation);
      result.rollId = nextRollId();
      room.share(result);                // announced to the table as `playerName`
      return result;                     // also render it in your own UI
    },
  };
}

// --- usage -------------------------------------------------------------------
//
//   const sheet = createSheetRoller({
//     relayUrl: 'wss://relay.dicebox.cc',
//     passphrase: 'acid-baker-lunar-otter-viper',  // the room's passphrase
//     playerName: 'Kira',
//   });
//   await sheet.join();
//   sheet.rollAs('v5:6h2');   // Kira's Vampire pool appears at every screen
//   sheet.rollAs('2d20+3');   // numeric works the same way
//
// Nothing here runs on anyone else's machine and nothing routes through a Dicebox
// server. The roll is made here and announced, encrypted, through a blind relay —
// as private as the table itself.
