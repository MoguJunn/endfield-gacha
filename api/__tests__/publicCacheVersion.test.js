// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), version: vi.fn(), url: vi.fn(), key: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }));
vi.mock('../_lib/publicCache.js', async original => ({ ...(await original()), resolvePublicCacheVersion: mocks.version }));
vi.mock('../_lib/supabaseEnv.js', () => ({ resolveSupabaseUrl: mocks.url, resolveSupabaseServerKey: mocks.key }));
import handler from '../_routes/root/public-cache-version.js';
const response = () => {
  const headers = new Map();
  return { headers, getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value),
    status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() };
};
beforeEach(() => {
  mocks.url.mockReturnValue('https://example.invalid'); mocks.key.mockReturnValue('synthetic');
  mocks.create.mockReturnValue({}); mocks.version.mockResolvedValue('public-version');
});
afterEach(() => vi.clearAllMocks());

describe('public cache version caching', () => {
  it('lets ordinary public checks reuse short browser and CDN caches', async () => {
    const res = response(); await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=15, s-maxage=30');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cacheVersion: 'public-version' }));
  });
  it('keeps forced refresh, missing configuration and rejected methods uncached', async () => {
    const forced = response(); await handler({ method: 'GET', headers: {}, query: { ts: '1' } }, forced);
    expect(forced.headers.get('Cache-Control')).toBe('no-store');
    mocks.url.mockReturnValue(null);
    const missing = response(); await handler({ method: 'GET', headers: {}, query: {} }, missing);
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
    const method = response(); await handler({ method: 'POST', headers: {}, query: {} }, method);
    expect(method.status).toHaveBeenCalledWith(405); expect(method.headers.get('Cache-Control')).toBe('no-store');
  });
});
