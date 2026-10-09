const DATABASE_NAME = 'endfield-gacha-simulator';
const DATABASE_VERSION = 1;
const SESSION_STORE = 'sessions';
const HISTORY_STORE = 'histories';
const SCOPE_INDEX = 'byScope';

let connection = null;

function repositoryError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function revisionConflict() {
  return repositoryError('simulator_revision_conflict', '模拟器存档已更新，请重新加载后再试。');
}

function checkScope(scope) {
  if (typeof scope !== 'string') {
    throw repositoryError('simulator_invalid_scope', '模拟器存档范围必须是字符串。');
  }
}

function openRepository() {
  let factory;
  try {
    factory = globalThis.indexedDB;
  } catch (cause) {
    return Promise.reject(repositoryError('simulator_indexeddb_unavailable', '浏览器无法使用 IndexedDB 存储。', cause));
  }
  if (!factory || typeof factory.open !== 'function') {
    return Promise.reject(repositoryError('simulator_indexeddb_unavailable', '浏览器无法使用 IndexedDB 存储。'));
  }
  if (connection?.factory === factory) return connection.promise;

  connection?.database?.close();
  const entry = { factory, database: null, promise: null };
  connection = entry;
  entry.promise = new Promise((resolve, reject) => {
    let failed = false;
    const fail = (cause) => {
      failed = true;
      if (connection === entry) connection = null;
      reject(repositoryError('simulator_repository_open_failed', '无法打开模拟器 IndexedDB 存档。', cause));
    };
    let request;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (cause) {
      fail(cause);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(SESSION_STORE, { keyPath: 'scope' });
      const histories = database.createObjectStore(HISTORY_STORE, { keyPath: ['scope', 'poolId', 'eventId'] });
      histories.createIndex(SCOPE_INDEX, 'scope', { unique: false });
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('存档升级被其他页面阻塞，请关闭其他页面后再试。'));
    request.onsuccess = () => {
      const database = request.result;
      if (failed || connection !== entry) {
        database.close();
        if (!failed) fail(new Error('存档连接已关闭。'));
        return;
      }
      entry.database = database;
      database.onversionchange = () => {
        database.close();
        if (connection === entry) connection = null;
      };
      database.onclose = () => {
        if (connection === entry) connection = null;
      };
      resolve(database);
    };
  });
  return entry.promise;
}

function runTransaction(database, mode, enqueue) {
  const code = mode === 'readonly' ? 'simulator_repository_read_failed' : 'simulator_repository_write_failed';
  const message = mode === 'readonly' ? '读取模拟器存档失败。' : '保存模拟器存档失败，所有改动已撤销。';
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction([SESSION_STORE, HISTORY_STORE], mode);
    } catch (cause) {
      reject(repositoryError(code, message, cause));
      return;
    }

    let result;
    let failure;
    const abort = (error) => {
      failure = error;
      try {
        transaction.abort();
      } catch {
        reject(failure);
      }
    };
    // Keep every request queued inside native handlers: awaiting a promise here can
    // let the browser commit the transaction before the remaining writes exist.
    const handle = (callback) => (event) => {
      try {
        callback(event);
      } catch (cause) {
        abort(repositoryError(code, message, cause));
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = (event) => {
      failure ??= repositoryError(code, message, event.target.error || transaction.error);
    };
    transaction.onabort = () => reject(failure || repositoryError(code, message, transaction.error));

    try {
      enqueue({
        transaction,
        handle,
        abort,
        setResult: (value) => {
          result = value;
        },
      });
    } catch (cause) {
      abort(repositoryError(code, message, cause));
    }
  });
}

/** Load a consistent snapshot, including all history belonging to this scope. */
export async function loadSimulatorSession(scope) {
  checkScope(scope);
  const database = await openRepository();
  return runTransaction(database, 'readonly', ({ transaction, handle, setResult }) => {
    const snapshot = { session: null, histories: {} };
    setResult(snapshot);
    const sessionRequest = transaction.objectStore(SESSION_STORE).get(scope);
    const historyRequest = transaction.objectStore(HISTORY_STORE).index(SCOPE_INDEX).getAll(scope);
    sessionRequest.onsuccess = handle(() => {
      snapshot.session = sessionRequest.result ?? null;
    });
    historyRequest.onsuccess = handle(() => {
      const histories = new Map();
      for (const { poolId, record } of historyRequest.result) {
        if (!histories.has(poolId)) histories.set(poolId, []);
        histories.get(poolId).push(record);
      }
      for (const records of histories.values()) {
        records.sort((left, right) => left.sequenceIndex - right.sequenceIndex);
      }
      snapshot.histories = Object.fromEntries(histories);
    });
  });
}

/** Atomically compare the revision, save the session and append/replace history.
 * Returns an independent copy of the committed session after the transaction completes.
 */
export async function commitSimulatorSession({
  scope,
  session,
  expectedRevision,
  appendEvents = [],
  replaceHistories = null,
}) {
  checkScope(scope);
  if (!session || session.version !== 2 || session.scope !== scope || !Number.isInteger(session.revision)) {
    throw repositoryError('simulator_invalid_session', '模拟器存档的版本、范围或修订号无效。');
  }
  const validRevision =
    expectedRevision === null
      ? session.revision === 0 || session.revision === 1
      : Number.isInteger(expectedRevision) && expectedRevision >= 0 && session.revision === expectedRevision + 1;
  if (!validRevision) throw revisionConflict();

  let snapshot;
  let events;
  let replacements;
  try {
    snapshot = structuredClone(session);
    events = structuredClone(appendEvents);
    replacements = replaceHistories === null ? null : structuredClone(replaceHistories);
  } catch (cause) {
    throw repositoryError('simulator_repository_write_failed', '模拟器存档包含无法保存的数据。', cause);
  }

  const database = await openRepository();
  return runTransaction(database, 'readwrite', ({ transaction, handle, abort, setResult }) => {
    const sessions = transaction.objectStore(SESSION_STORE);
    const histories = transaction.objectStore(HISTORY_STORE);
    const currentRequest = sessions.get(scope);
    const addHistory = (poolId, record) => {
      histories.add({ scope, poolId, eventId: record.eventId, record });
    };
    const addEvents = () => {
      for (const { poolId, record } of events) addHistory(poolId, record);
    };

    currentRequest.onsuccess = handle(() => {
      const currentRevision = currentRequest.result?.revision ?? null;
      if (currentRevision !== expectedRevision) {
        abort(revisionConflict());
        return;
      }
      sessions.put(snapshot);
      setResult(snapshot);
      if (replacements === null) {
        addEvents();
        return;
      }

      const cursorRequest = histories.index(SCOPE_INDEX).openKeyCursor(scope);
      cursorRequest.onsuccess = handle(() => {
        const cursor = cursorRequest.result;
        if (cursor) {
          histories.delete(cursor.primaryKey);
          cursor.continue();
          return;
        }
        for (const [poolId, records] of Object.entries(replacements)) {
          for (const record of records) addHistory(poolId, record);
        }
        addEvents();
      });
    });
  });
}

/** Release the cached connection without deleting any persisted records. */
export function closeRepositoryForTests() {
  connection?.database?.close();
  connection = null;
}
