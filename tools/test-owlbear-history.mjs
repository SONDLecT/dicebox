import { createOwlbearHistoryStore } from '../owlbear-history.js';

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

function fakeIndexedDB() {
  const records = new Map();
  let created = false;
  const requestFor = (operation, tx) => {
    const request = {};
    queueMicrotask(() => {
      try {
        request.result = operation();
        request.onsuccess?.();
        queueMicrotask(() => tx.oncomplete?.());
      } catch (error) {
        request.error = error;
        request.onerror?.();
      }
    });
    return request;
  };
  const db = {
    objectStoreNames: { contains() { return created; } },
    createObjectStore() { created = true; },
    transaction() {
      const tx = {
        objectStore() {
          return {
            get(key) { return requestFor(() => structuredClone(records.get(key)), tx); },
            put(record) { return requestFor(() => { records.set(record.roomId, structuredClone(record)); return record.roomId; }, tx); },
            delete(key) { return requestFor(() => { records.delete(key); return undefined; }, tx); },
          };
        },
      };
      return tx;
    },
    close() {},
  };
  return {
    open() {
      const request = { result: db };
      queueMicrotask(() => {
        if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

const history = createOwlbearHistoryStore({ indexedDB: fakeIndexedDB() });
ok('new IndexedDB room history starts empty', (await history.load('room-a')).length === 0);
const rolls = [{ id: 'one', notation: '1d6', groups: [], total: 4 }];
ok('room history saves transactionally', await history.save('room-a', rolls) === true);
rolls[0].id = 'mutated-after-save';
ok('room history reads a durable cloned value', (await history.load('room-a'))[0]?.id === 'one');
ok('room histories remain isolated', (await history.load('room-b')).length === 0);
ok('room history can be removed', await history.remove('room-a') === true && (await history.load('room-a')).length === 0);
history.close();

const unavailable = createOwlbearHistoryStore({ indexedDB: null });
ok('storage-denied fallback fails closed without throwing',
   (await unavailable.load('room')).length === 0 && await unavailable.save('room', []) === false);
unavailable.close();

let lateDatabaseCloses = 0;
const blocked = createOwlbearHistoryStore({
  indexedDB: {
    open() {
      const request = { result: { close() { lateDatabaseCloses++; } } };
      queueMicrotask(() => {
        request.onblocked?.();
        queueMicrotask(() => request.onsuccess?.());
      });
      return request;
    },
  },
});
await blocked.load('room');
await new Promise(resolve => setTimeout(resolve, 0));
ok('a database opened after a blocked fallback is closed instead of leaked', lateDatabaseCloses === 1);
blocked.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
