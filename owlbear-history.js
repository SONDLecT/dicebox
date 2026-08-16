// Owlbear-only, room-scoped history persistence. The VTT background uses
// IndexedDB because retained roll payloads can exceed localStorage's small
// synchronous quota. Callers still provide a bounded array; this repository is
// storage, not policy.
const DB_NAME = 'dicebox-owlbear';
const DB_VERSION = 1;
const STORE_NAME = 'room-history';

function openDatabase(indexedDB) {
  if (!indexedDB?.open) return Promise.resolve(null);
  return new Promise(resolve => {
    let request;
    let settled = false;
    const finish = database => {
      if (!settled) {
        settled = true;
        resolve(database);
      } else if (database) {
        try { database.close(); } catch {}
      }
    };
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { finish(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'roomId' });
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

function transactionRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(STORE_NAME, mode); }
    catch (error) { reject(error); return; }
    let request;
    try { request = operation(tx.objectStore(STORE_NAME)); }
    catch (error) { reject(error); return; }
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export function createOwlbearHistoryStore(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  let database = openDatabase(indexedDB);
  let closed = false;

  const getDb = async () => closed ? null : database;
  return {
    async load(roomId) {
      const db = await getDb();
      if (!db) return [];
      try {
        const record = await transactionRequest(db, 'readonly', store => store.get(String(roomId)));
        return Array.isArray(record?.rolls) ? record.rolls : [];
      } catch {
        return [];
      }
    },

    async save(roomId, rolls) {
      const db = await getDb();
      if (!db) return false;
      try {
        await transactionRequest(db, 'readwrite', store => store.put({
          roomId: String(roomId),
          rolls: Array.isArray(rolls) ? rolls : [],
          updatedAt: Date.now(),
        }));
        return true;
      } catch {
        return false;
      }
    },

    async remove(roomId) {
      const db = await getDb();
      if (!db) return false;
      try {
        await transactionRequest(db, 'readwrite', store => store.delete(String(roomId)));
        return true;
      } catch {
        return false;
      }
    },

    close() {
      closed = true;
      database.then(db => { try { db?.close(); } catch {} });
      database = Promise.resolve(null);
    },
  };
}
