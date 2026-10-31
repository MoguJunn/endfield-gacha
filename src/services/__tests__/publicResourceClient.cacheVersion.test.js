import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../supabaseRequest.js', () => ({ fetchWithTimeout: mocks.fetch, fetchJsonWithTimeout: vi.fn() }));
vi.mock('../../utils/storageUtils.js', () => ({ readStorageValue: vi.fn(), writeStorageValue: vi.fn() }));
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('DEV', false);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ cacheVersion: 'public-version' }) });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('public cache version browser reuse', () => {
  it('uses normal browser caching and combines concurrent ordinary checks', async () => {
    const { getPublicCacheVersion } = await import('../publicResourceClient.js');
    expect(await Promise.all([getPublicCacheVersion(), getPublicCacheVersion()])).toEqual(['public-version', 'public-version']);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith('/api/public-cache-version', expect.objectContaining({ cache: 'default' }), expect.any(Object));
    await getPublicCacheVersion(); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('bypasses browser and in-memory caches when explicitly refreshed', async () => {
    const { getPublicCacheVersion } = await import('../publicResourceClient.js');
    await getPublicCacheVersion(); await getPublicCacheVersion(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.stringMatching(/^\/api\/public-cache-version\?ts=\d+$/),
      expect.objectContaining({ cache: 'no-store' }), expect.any(Object));
  });
  it('shares the same forced version check across simultaneously refreshing panels', async () => {
    const { getPublicCacheVersion } = await import('../publicResourceClient.js');
    await getPublicCacheVersion();
    expect(await Promise.all([getPublicCacheVersion(true), getPublicCacheVersion(true), getPublicCacheVersion(true)]))
      .toEqual(['public-version', 'public-version', 'public-version']);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
