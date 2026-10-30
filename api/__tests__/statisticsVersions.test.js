// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ resolve: vi.fn(), admin: vi.fn() }));
vi.mock('../_lib/siteAuth.js', () => ({ resolveAuthenticatedRequestUser: auth.resolve }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: auth.admin }));
vi.mock('../_lib/publicCache.js', () => ({ resolvePublicCacheVersion: async () => 'catalog-v1' }));
import { handleStatisticsVersions } from '../_lib/statisticsVersions.js';
const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
function database() {
  const rows = [{ scope_key: 'pool:p', source_revision: 7, computed_at: '2026-10-30', schema_version: 'v6' }];
  const state = { rows, ownerRevision: 2 };
  const requests = [];
  const db = { rpc: vi.fn(async () => ({ data: [{ pool_id: 'p' }], error: null })), from: vi.fn(table => {
    const request = { table, columns: '', filters: [] }; requests.push(request);
    const query = { select: vi.fn(columns => { request.columns = columns; return query; }),
      in: vi.fn(() => query), eq: vi.fn((key, value) => { request.filters.push([key,value]); return query; }), order: vi.fn(() => query),
      maybeSingle: vi.fn(() => query), then: (resolve, reject) => {
        const personal = request.filters.some(([key,value]) => key === 'user_id' || key === 'scope_key' && String(value).startsWith('owner:'));
        const data = table === 'statistics_snapshots' ? personal ? null : state.rows
          : table === 'statistics_jobs' ? personal ? { revision: 3, published_revision: 2 } : []
          : table === 'personal_analysis_owner_state' ? { history_revision: state.ownerRevision, snapshot_revision: 2 }
          : [{ scope_game_uid: 'secret-uid', server_scope: '1', history_revision: 2, snapshot_revision: 2 }];
        return Promise.resolve({ data, error: null }).then(resolve,reject);
      } };
    return query;
  }) };
  return { db, requests, state };
}
beforeEach(() => vi.clearAllMocks());
describe('lightweight snapshot revisions', () => {
  it('returns stable public versions without reading payloads, history or private state', async () => {
    const { db, requests, state } = database();
    const first = response(); await handleStatisticsVersions({ query: {} }, first, db);
    const value = first.json.mock.calls[0][0].data;
    const second = response(); await handleStatisticsVersions({ query: {} }, second, db);
    expect(second.json.mock.calls[0][0].data).toEqual(value);
    expect(requests.every(request => !/payload|history/.test(request.columns))).toBe(true);
    expect(requests.map(request => request.table)).not.toContain('personal_analysis_owner_state');
    expect(value.personal).toBeNull();
    state.rows[0].source_revision++;
    const changed = response(); await handleStatisticsVersions({ query: {} }, changed, db);
    expect(changed.json.mock.calls[0][0].data.public['pool:p']).not.toBe(value.public['pool:p']);
    expect(changed.json.mock.calls[0][0].data.public.character_catalog).toBe(value.public.character_catalog);
  });
  it('uses the authenticated owner and exposes only fingerprints of private revisions', async () => {
    const { db, requests } = database(); auth.admin.mockReturnValue(db);
    auth.resolve.mockResolvedValue({ ok: true, user: { id: 'verified-owner' } });
    const res = response(); await handleStatisticsVersions({ query: { personal: '1', ownerId: 'forged' } }, res, null);
    const value = res.json.mock.calls[0][0].data;
    expect(value.personal).toMatchObject({ ownerId: 'verified-owner', statisticsPending: true, analysisPending: false });
    expect(JSON.stringify(value)).not.toMatch(/secret-uid|forged|history_revision/);
    expect(requests.some(request => request.filters.some(([key,value]) => key === 'user_id' && value === 'verified-owner'))).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
  it('rejects anonymous personal checks before any private query', async () => {
    const { db } = database(); auth.admin.mockReturnValue(db); auth.resolve.mockResolvedValue({ ok: false, status: 401 });
    const res = response(); await handleStatisticsVersions({ query: { personal: '1' } }, res, db);
    expect(res.status).toHaveBeenCalledWith(401); expect(db.from).not.toHaveBeenCalled();
  });
});
