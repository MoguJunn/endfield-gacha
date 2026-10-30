// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ resolve: vi.fn(), admin: vi.fn() }));
vi.mock('../_lib/siteAuth.js', () => ({ resolveAuthenticatedRequestUser: auth.resolve }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: auth.admin }));
import { handlePersonalStatistics, handleScheduledStatistics, handleStatisticsPoolCounts, PUBLIC_STATISTICS_CACHE_CONTROL } from '../_lib/scheduledStatistics.js';
import { handleGroupStatistics } from '../_lib/groupStatistics.js';
import { handlePoolObservations } from '../_lib/poolObservations.js';
import { STATISTICS_SNAPSHOT_VERSION } from '../../shared/statisticsRefreshPolicy.js';
import { statisticsMemberSignature } from '../../shared/statisticsScopes.js';

const response = () => {
  const headers = new Map();
  return { headers, setHeader: (key, value) => headers.set(key, value), status: vi.fn().mockReturnThis(), json: vi.fn() };
};
const members = [{ pool_id: 'p', type: 'limited', name: '公开卡池', up_character: '角色' }];
const database = (payload, error = null) => ({ from: vi.fn(), rpc: vi.fn(async name => ({ error,
  data: name === 'get_app_visible_pools' ? members : name === 'read_statistics_pool_counts' ? { p: 10 }
    : payload == null ? null : { schema_version: STATISTICS_SNAPSHOT_VERSION, payload, computed_at: '2026-10-30T10:00:00Z' } })) });
const handlers = [
  ...['global_summary', 'character_ranking', 'character_catalog'].map(scope => [scope, (res, db) => handleScheduledStatistics({}, res, db, scope)]),
  ['pool', (res, db) => handlePoolObservations({ query: { poolId: 'p' } }, res, db)],
  ['group', (res, db) => handleGroupStatistics({ query: { groupKey: 'limited' } }, res, db)],
];
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('public statistics cache boundaries', () => {
  it.each(handlers)('caches a complete public %s snapshot without reading history', async (_scope, handle) => {
    const db = database({ observations: { total: 10 }, memberSignature: statisticsMemberSignature(members) });
    const res = response(); await handle(res, db);
    expect(res.headers.get('Cache-Control')).toBe(PUBLIC_STATISTICS_CACHE_CONTROL);
    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(db.from).not.toHaveBeenCalled();
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('owner:');
  });
  it.each(handlers)('does not cache pending or failed public %s responses', async (_scope, handle) => {
    for (const [db, status] of [[database(null), 202], [database(null, { code: '57014' }), 503]]) {
      const res = response(); await handle(res, db);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.status).toHaveBeenCalledWith(status);
    }
  });
  it('caches public counts while keeping database errors uncacheable', async () => {
    const res = response(); await handleStatisticsPoolCounts({}, res, database({}));
    expect(res.headers.get('Cache-Control')).toBe(PUBLIC_STATISTICS_CACHE_CONTROL);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { counts: { p: 10 } } });
    const failed = response(); await handleStatisticsPoolCounts({}, failed, database(null, { code: '57014' }));
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    expect(failed.status).toHaveBeenCalledWith(503);
  });
  it('does not cache withdrawn or changed public catalog scopes', async () => {
    const db = database({ memberSignature: 'old-members', observations: { total: 10 } });
    const group = response(); await handleGroupStatistics({ query: { groupKey: 'limited' } }, group, db);
    expect(group.headers.get('Cache-Control')).toBe('no-store');
    expect(group.status).toHaveBeenCalledWith(202);
    const missing = response(); await handlePoolObservations({ query: { poolId: 'not-visible' } }, missing, db);
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
    expect(missing.status).toHaveBeenCalledWith(404);
  });
  it('clears the public header if formatting a completed snapshot fails', async () => {
    const res = response();
    await handleScheduledStatistics({}, res, database({ total: 10 }), 'global_summary', () => { throw new Error('format failed'); });
    expect(res.status).toHaveBeenLastCalledWith(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('never shares authenticated owner responses, including errors and pending data', async () => {
    auth.resolve.mockResolvedValue({ ok: true, user: { id: 'signed-in-owner' } });
    for (const db of [database({ accounts: [], luck: { version: 1 } }), database(null), database(null, { code: '57014' })]) {
      auth.admin.mockReturnValue(db);
      const res = response(); await handlePersonalStatistics({}, res);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(db.rpc).toHaveBeenCalledWith('read_statistics_snapshot', { p_scope: 'owner:signed-in-owner' });
    }
    auth.resolve.mockResolvedValue({ ok: false, status: 401 });
    const res = response(); await handlePersonalStatistics({}, res);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
