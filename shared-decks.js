// shared-decks.js — the table's decks, one per Owlbear room. Inside a real
// room the deck state lives in ROOM METADATA — shared by every player and
// persisted with the room — so there is one deck on the table: anyone may
// shuffle it, every draw comes off the same stack, and no card exists twice.
// localStorage keeps a local copy as cache and as the whole store where the
// metadata API is absent (tests, degraded hosts). Draws are read-modify-write
// with last-write-wins; at human pace that is the honest trade, and a clash
// costs a re-shuffle, not a corrupted room.
//
// Used by the Owlbear background service for every bridge draw, and by the
// panel itself for the fallback path — so a draw made while the background is
// unreachable still comes off the room's own deck, not a private divergent one.

function safeGet(storage, key) {
  try { return storage?.getItem?.(key) ?? null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage?.setItem?.(key, value); } catch { /* memory still serves */ }
}

// `prefix` namespaces the room-metadata keys: the decks keep their original
// 'cc.dicebox/deck:' (renaming it would orphan every live room's state), and
// other table-shared fiction — the Shadowdark torch — rides the same
// machinery under 'cc.dicebox/table:'.
export function createSharedDecks(OBR, storage, { onChange, prefix = 'cc.dicebox/deck:' } = {}) {
  const META_PREFIX = prefix;
  const mirror = new Map();
  const shared = typeof OBR?.room?.getMetadata === 'function'
    && typeof OBR?.room?.setMetadata === 'function';
  let unsubscribe = null;
  const absorb = (metadata, notify) => {
    for (const [k, v] of Object.entries(metadata || {})) {
      if (!k.startsWith(META_PREFIX)) continue;
      const key = k.slice(META_PREFIX.length);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const before = notify && onChange ? JSON.stringify(mirror.get(key) ?? null) : null;
        mirror.set(key, v);
        if (notify && onChange && before !== JSON.stringify(v)) {
          try { onChange(key); } catch { /* a listener's problem, not the deck's */ }
        }
      }
    }
  };
  const ready = (async () => {
    if (!shared) return;
    try { absorb(await OBR.room.getMetadata(), false); } catch { /* local cache serves */ }
    try {
      if (typeof OBR.room.onMetadataChange === 'function') {
        unsubscribe = OBR.room.onMetadataChange(metadata => absorb(metadata, true));
      }
    } catch { /* no live sync; the next read is only as stale as the last write */ }
  })();
  return {
    ready,
    get(key) {
      if (mirror.has(key)) return structuredClone(mirror.get(key));
      try {
        const saved = JSON.parse(safeGet(storage, key) || 'null');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
      } catch { /* fresh deck */ }
      return null;
    },
    set(key, state) {
      mirror.set(key, structuredClone(state));
      safeSet(storage, key, JSON.stringify(state));
      if (shared) {
        try { Promise.resolve(OBR.room.setMetadata({ [META_PREFIX + key]: state })).catch(() => {}); }
        catch { /* the local copy still serves this client */ }
      }
    },
    dispose() { if (unsubscribe) { try { unsubscribe(); } catch { /* gone */ } } },
  };
}
