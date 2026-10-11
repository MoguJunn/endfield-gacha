// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.client }));
vi.mock('../_lib/supabaseEnv.js', () => ({ resolveSupabaseUrl: () => 'https://example.invalid', resolveSupabaseServerKey: () => 'synthetic' }));
vi.mock('../_lib/http.js', () => ({ rejectDisallowedBrowserOrigin: () => false }));
vi.mock('../_lib/publicCache.js', async (original) => ({ ...await original(), resolvePublicCacheVersion: async () => 'test' }));
import handler, { __internal } from '../_routes/root/pool-rosters.js';

function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function read(ids = 'older,zero-history,empty') {
  const res = response();
  await handler({ method: 'GET', url: `/api/pool-rosters?poolIds=${ids}`, headers: {} }, res);
  return res;
}

describe('/api/pool-rosters complete reads', () => {
  beforeEach(() => {
    __internal.cacheByKey.clear();
    mocks.client = { rpc: vi.fn() };
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns all relations beyond 1000 and explicitly keeps a genuine empty pool', async () => {
    const rows = Array.from({ length: 1227 }, (_, i) => ({ pool_id: i < 1000 ? 'older' : 'zero-history', character_id: `entity-${i}`, is_up: false, characters: { id: `entity-${i}`, rarity: 6 } }));
    mocks.client.rpc.mockResolvedValue({ data: { rowCount: rows.length, rows }, error: null });
    const res = await read();
    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.data.poolRosters.older).toHaveLength(1000);
    expect(res.body.data.poolRosters['zero-history']).toHaveLength(227);
    expect(res.body.data.poolRosters.empty).toEqual([]);
    expect(mocks.client.rpc).toHaveBeenCalledWith('read_pool_roster_catalog', { p_pool_ids: ['older', 'zero-history', 'empty'] });
  });

  it('returns an uncached failure instead of inventing empty rosters', async () => {
    mocks.client.rpc.mockResolvedValue({ data: { rowCount: 1227, rows: [] }, error: null });
    const res = await read();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
    expect(__internal.cacheByKey.size).toBe(0);
  });

  it('preserves only a previously complete snapshot when a later read fails', async () => {
    mocks.client.rpc.mockResolvedValueOnce({ data: { rowCount: 1, rows: [{ pool_id: 'older', character_id: 'entity' }] }, error: null });
    const initial = await read();
    const entry = [...__internal.cacheByKey.values()][0];
    entry.lastFetch = Date.now() - __internal.CACHE_TTL - 1;
    mocks.client.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const later = await read();
    expect(later.body.partial).toBe(true);
    expect(later.body.meta.stale).toBe(true);
    expect(later.body.data).toEqual(initial.body.data);
  });
});
