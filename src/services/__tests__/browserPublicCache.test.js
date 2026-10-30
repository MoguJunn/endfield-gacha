import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());

it('evicts expired and excess public entries without retaining every visited pool', async () => {
  const { readBrowserPublicCache, writeBrowserPublicCache } = await import('../browserPublicCache.js');
  const start = Date.now();
  await writeBrowserPublicCache({ key: 'expired', savedAt: start - 8 * 86400000, payload: {} });
  expect(await readBrowserPublicCache('expired')).toBeNull();
  for (let index = 0; index < 100; index++) {
    // eslint-disable-next-line no-await-in-loop -- verify eviction after successive committed writes
    await writeBrowserPublicCache({ key: `pool:${index}`, savedAt: start + index, payload: { index } });
  }
  expect(await readBrowserPublicCache('pool:0')).toBeNull();
  expect(await readBrowserPublicCache('pool:3')).toBeNull();
  expect(await readBrowserPublicCache('pool:4')).toMatchObject({ payload: { index: 4 } });
  expect(await readBrowserPublicCache('pool:99')).toMatchObject({ payload: { index: 99 } });
});

it('returns misses when browser database access is blocked', async () => {
  vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Blocked', 'SecurityError'); } });
  const { readBrowserPublicCache, writeBrowserPublicCache } = await import('../browserPublicCache.js');
  expect(await readBrowserPublicCache('catalog')).toBeNull();
  expect(await writeBrowserPublicCache({ key: 'catalog', savedAt: Date.now(), payload: {} })).toBe(false);
});
