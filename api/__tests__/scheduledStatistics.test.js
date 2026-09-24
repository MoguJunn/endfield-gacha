// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ resolve: vi.fn(), admin: vi.fn() }));
vi.mock('../_lib/siteAuth.js', () => ({ resolveAuthenticatedRequestUser: auth.resolve }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: auth.admin }));
import { handlePersonalStatistics, readScheduledStatistic } from '../_lib/scheduledStatistics.js';
import { handlePoolObservations } from '../_lib/poolObservations.js';
import { handleGroupStatistics } from '../_lib/groupStatistics.js';
import { statisticsMemberSignature } from '../../shared/statisticsScopes.js';
import { runStatisticsWorker } from '../_lib/statisticsWorker.js';
import { STATISTICS_SNAPSHOT_VERSION, statisticsRefreshMinutes } from '../../shared/statisticsRefreshPolicy.js';
const res = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('scheduled statistics', () => {
  it('serves a whitelisted complete group snapshot without reading history', async () => {
    const members = [{ pool_id: 'p', type: 'limited', up_character: 'A' }];
    const payload = { observations: { total: 10 }, memberSignature: statisticsMemberSignature(members) };
    const db = { from: vi.fn(), rpc: vi.fn(async (name) => ({ data: name === 'get_app_visible_pools' ? members : {
      schema_version: STATISTICS_SNAPSHOT_VERSION, payload, computed_at: '2026-01-01', next_refresh_at: '2026-01-02', refresh_minutes: 60,
    } })) };
    const response = res();
    await handleGroupStatistics({ query: { groupKey: 'limited' } }, response, db);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining(payload) }));
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith('read_statistics_snapshot', { p_scope: 'group:limited' });
  });
  it('rejects arbitrary groups and withholds snapshots after member visibility or target changes', async () => {
    const db = { rpc: vi.fn() };
    const bad = res();
    await handleGroupStatistics({ query: { groupKey: 'standard' } }, bad, db);
    expect(bad.status).toHaveBeenCalledWith(400);
    expect(db.rpc).not.toHaveBeenCalled();
    for (const visible of [[], [{ pool_id: 'p', type: 'limited', up_character: 'Changed' }]]) {
      db.rpc.mockImplementation(async (name) => ({ data: name === 'get_app_visible_pools' ? visible : {
        schema_version: STATISTICS_SNAPSHOT_VERSION, payload: { observations: { total: 123 }, memberSignature: statisticsMemberSignature([{ pool_id: 'p', type: 'limited', up_character: 'Old' }]) },
      } }));
      const response = res();
      await handleGroupStatistics({ query: { groupKey: 'limited' } }, response, db);
      expect(response.status).toHaveBeenCalledWith(202);
      expect(response.json.mock.calls[0][0].data.observations).toBeNull();
      expect(JSON.stringify(response.json.mock.calls)).not.toContain('123');
    }
  });
  it('routes group jobs through revision-checked publishing and retains old data on failure', async () => {
    const jobs = [{ scopeKey: 'group:limited', revision: 7 }, { scopeKey: 'group:weapon_standard', revision: 8 }, null];
    const db = { rpc: vi.fn(async (name) => ({ data: name === 'claim_statistics_job' ? jobs.shift() : name === 'publish_statistics_snapshot' ? false : true })) };
    const groupAggregate = vi.fn().mockResolvedValueOnce({ observations: { total: 3 } }).mockRejectedValueOnce(new Error('read failed'));
    expect((await runStatisticsWorker(db, { groupAggregate })).map((result) => result.status)).toEqual(['changed-during-calculation', 'failed']);
    expect(db.rpc).toHaveBeenCalledWith('publish_statistics_snapshot', expect.objectContaining({ p_scope: 'group:limited', p_revision: 7 }));
    expect(db.rpc).toHaveBeenCalledWith('fail_statistics_job', expect.objectContaining({ p_scope: 'group:weapon_standard' }));
    expect(db.rpc.mock.calls.filter(([name]) => name === 'compute_and_publish_legacy_statistics')).toHaveLength(0);
  });
  it('selects 5, 30 and 60 minutes based on recent upload activity', () => {
    expect(statisticsRefreshMinutes()).toBe(60);
    expect(statisticsRefreshMinutes({ changedRows60m: 1 })).toBe(30);
    expect(statisticsRefreshMinutes({ changedRows10m: 1000 })).toBe(5);
    expect(statisticsRefreshMinutes({ contributors10m: 5 })).toBe(5);
  });
  it('reads snapshots only and does not compute missing snapshots on page visits', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null }), from: vi.fn() };
    expect(await readScheduledStatistic(db, 'global_summary')).toMatchObject({ payload: null, meta: { availability: 'building' } });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('read_statistics_snapshot', { p_scope: 'global_summary' });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('serves the previous completed result after its refresh time, with the true calculation time', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: { schema_version: STATISTICS_SNAPSHOT_VERSION, payload: { total: 10 },
      computed_at: '2020-01-01T00:00:00Z', next_refresh_at: '2020-01-01T01:00:00Z', refresh_minutes: 60 } }) };
    expect(await readScheduledStatistic(db, 'global_summary')).toMatchObject({ payload: { total: 10 }, meta: { stale: true, updatedAt: '2020-01-01T00:00:00Z' } });
  });
  it('rejects invisible pool requests before reading the snapshot', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: [] }) };
    const response = res();
    await handlePoolObservations({ query: { poolId: 'private_pool' } }, response, db);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects unauthenticated private access and ignores a caller supplied owner ID', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null }) };
    auth.admin.mockReturnValue(db);
    auth.resolve.mockResolvedValueOnce({ ok: false });
    const response = res();
    await handlePersonalStatistics({ query: { ownerId: 'other' } }, response);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(db.rpc).not.toHaveBeenCalled();
    auth.resolve.mockResolvedValueOnce({ ok: true, user: { id: 'current-owner' } });
    await handlePersonalStatistics({ query: { ownerId: 'other' } }, res());
    expect(db.rpc).toHaveBeenCalledWith('read_statistics_snapshot', { p_scope: 'owner:current-owner' });
  });
  it('publishes only a claimed revision and processes old statistics through the same queue', async () => {
    const jobs = [{ scopeKey: 'pool:p', revision: 3 }, { scopeKey: 'global_summary', revision: 8 }, null];
    const db = { rpc: vi.fn(async (name) => ({ data: name === 'claim_statistics_job' ? jobs.shift() : true })) };
    const aggregate = vi.fn().mockResolvedValue({ observations: { total: 2 } });
    const result = await runStatisticsWorker(db, { aggregate });
    expect(result.map((row) => row.status)).toEqual(['published', 'published']);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('publish_statistics_snapshot', expect.objectContaining({ p_scope: 'pool:p', p_revision: 3, p_schema: STATISTICS_SNAPSHOT_VERSION }));
    expect(db.rpc).toHaveBeenCalledWith('compute_and_publish_legacy_statistics', expect.objectContaining({ p_scope: 'global_summary', p_revision: 8 }));
  });
  it('keeps a failed computation out of the published results and schedules a retry', async () => {
    const db = { rpc: vi.fn(async (name) => ({ data: name === 'claim_statistics_job' ? { scopeKey: 'pool:p', revision: 2 } : true })) };
    const result = await runStatisticsWorker(db, { maxJobs: 1, aggregate: vi.fn().mockRejectedValue(new Error('failure')) });
    expect(result[0].status).toBe('failed');
    expect(db.rpc).toHaveBeenCalledWith('fail_statistics_job', expect.objectContaining({ p_scope: 'pool:p' }));
    expect(db.rpc.mock.calls.some(([name]) => name === 'publish_statistics_snapshot')).toBe(false);
  });
});
