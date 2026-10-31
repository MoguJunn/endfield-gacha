// Public catalogs and aggregate snapshots only. Never store sessions or owner data.
const DATABASE_NAME = 'endfield-public-data-v1';
const STORE_NAME = 'resources';
const MAX_ENTRIES = 96;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise(resolve => {
    try {
      if (!globalThis.indexedDB) return resolve(null);
      const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); databasePromise = null; };
        db.onclose = () => { databasePromise = null; };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return databasePromise;
}

export async function readBrowserPublicCache(key) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function writeBrowserPublicCache(entry) {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(entry);
      // Walk newest first without loading payloads; discard old/extra entries.
      let count = 0;
      const request = store.index('savedAt').openKeyCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (++count > MAX_ENTRIES || cursor.key < Date.now() - MAX_AGE_MS) store.delete(cursor.primaryKey);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}
