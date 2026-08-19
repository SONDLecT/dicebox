---
title: Dicebox
description: Dice rolling and card drawing with built-in rules and trays for 23 game systems. Open source and self-hostable.
author: SONDLecT
image: https://raw.githubusercontent.com/SONDLecT/dicebox/master/og.png
icon: https://dicebox.cc/icons/icon-512.png
tags:
  - dice
manifest: https://vtt.dicebox.cc/manifest.json
learn-more: https://github.com/SONDLecT/dicebox
---

# Dicebox

Roll dice and draw cards with the whole table. Every system Dicebox supports
gets a real tray of its own — the dice, the symbols, and the reading of the
result are built in — and every roll is shared with the Owlbear game
automatically. No account, no passphrase: being in the game is the
membership.

![Rolling a mixed handful of dice](https://raw.githubusercontent.com/SONDLecT/dicebox/master/docs/dark.png)

**Roll anything.** Standard notation with advantage, disadvantage, keep/drop,
exploding dice and rerolls — up to 500 dice a term, from d1 to d1000, all
decided by the browser's cryptographic random source.

**23 game systems built in.** Vampire: The Masquerade V5 with Hunger, Rouse
checks, Willpower rerolls and Blood Surge, Draw Steel's tiered power roll,
Crows (locked honestly to its current alpha packet), Shadowdark with a torch
that burns for one real hour and lights the tray while it does,
checks, Genesys and Star Wars narrative dice, Year Zero and Alien with push,
Blade Runner, Twilight: 2000, Call of Cthulhu, Delta Green, Mothership with
tracked Stress, Daggerheart, The One Ring, Ironsworn and Starforged with their
oracle libraries, Dungeon Crawl Classics' full dice chain, Fate, PbtA, Mist
Engine, and CthulhuTech. Each mode has its own dice, symbols, colours, and
reading of the result.

![A selection of game system modes](https://raw.githubusercontent.com/SONDLecT/dicebox/master/docs/modes.png)

**Five card decks.** Woodcut playing cards and tarot traced by hand from
antique decks, carte napoletane, Hanafuda, and Uta-garuta. In Owlbear the deck
belongs to the room: anyone shuffles it, every draw comes off the same stack,
and the deck keeps its state between sessions.

![The Woodcut playing cards and tarot](https://raw.githubusercontent.com/SONDLecT/dicebox/master/docs/cards.png)

**Rolls without the panel open.** A small corner window replays each throw —
real dice, in the rolling system's own colours and symbols — with the result
and who rolled it, whether or not your panel is up. Tap a drawn card in it to
open the panel with that card's close-up.

**Made for other extensions too.** Dicebox runs a background service that
answers roll, draw, and history requests from other extensions on a versioned
broadcast channel, with Dicebox keeping authority over the dice. The contract
is documented in the
[extension API](https://github.com/SONDLecT/dicebox/blob/master/owlbear/API.md).

**Honest about sharing.** Owlbear carries table rolls in readable form — that
is what makes the interoperability work. For anyone outside the game, a phone
at the table or a player elsewhere, Dicebox's own end-to-end encrypted rooms
are built in: rolls are encrypted before they leave the device, and the relay
only ever sees ciphertext.

Dicebox is free, open source (MIT), and self-hostable — the same app also
lives at [dicebox.cc](https://dicebox.cc), installs as an offline PWA, and
ships as a single HTML file.

## Support

Found a bug, or want a game system added? Open an issue at
[github.com/SONDLecT/dicebox/issues](https://github.com/SONDLecT/dicebox/issues).
