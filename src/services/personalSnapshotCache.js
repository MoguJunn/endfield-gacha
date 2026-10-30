// Tab-local private results: keyed by verified owner, view and backend revision.
// No auth credentials, no raw history, and cleared when the active owner leaves.
import { registerPrivateFeatureCacheClearer } from './privateFeatureCacheRegistry.js';
const PREFIX = 'endfield-personal-snapshot-v1:';
const memory = new Map();
const requests = new Map();
const latestVersions = new Map();
let generation = 0;

export function waitForPersonalSnapshot(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export function clearPersonalSnapshotCache() {
  generation++;
  memory.clear(); requests.clear(); latestVersions.clear();
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch { /* optional storage */ }
}

export async function readPersonalSnapshot({ ownerId, key, version, fetcher }) {
  if (!ownerId || !version) return fetcher();
  const storageKey = `${PREFIX}${JSON.stringify([ownerId, key])}`;
  const saved = memory.get(storageKey);
  if (saved?.version === version) return saved.value;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey));
    if (stored?.version === version && stored.ownerId === ownerId && stored.value?.meta?.ownerId === ownerId) {
      memory.set(storageKey, stored); return stored.value;
    }
  } catch { /* optional storage */ }
  const requestKey = JSON.stringify([storageKey, version]);
  if (requests.has(requestKey)) return requests.get(requestKey);
  const currentGeneration = generation;
  latestVersions.set(storageKey, version);
  const request = (async () => {
    const value = await fetcher();
    if (value?.meta?.ownerId !== ownerId) throw new Error('Personal snapshot owner mismatch');
    if (currentGeneration === generation && latestVersions.get(storageKey) === version && value.data !== null && value.availability !== 'building') {
      const entry = { version, value, ownerId };
      memory.set(storageKey, entry);
      if (memory.size > 8) memory.delete(memory.keys().next().value);
      try {
        const previousKeys = Object.keys(sessionStorage).filter(key => key.startsWith(PREFIX) && key !== storageKey);
        while (previousKeys.length >= 4) sessionStorage.removeItem(previousKeys.shift());
        sessionStorage.setItem(storageKey, JSON.stringify(entry));
      } catch { /* Memory remains usable if browser storage is full. */ }
    }
    return value;
  })().finally(() => { if (requests.get(requestKey) === request) requests.delete(requestKey); });
  requests.set(requestKey, request);
  return request;
}

registerPrivateFeatureCacheClearer('personal-snapshots', clearPersonalSnapshotCache);
