import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({ version: vi.fn(), resource: vi.fn() }));
const revisions = vi.hoisted(() => ({ pool: 's1' }));
vi.mock('../snapshotChangeService.js', async original => ({ ...(await original()),
  checkSnapshotVersions: async () => ({ public: { 'pool:p': revisions.pool } }) }));
vi.mock('../supabaseRequest.js', () => ({ fetchWithTimeout: network.version, fetchJsonWithTimeout: network.resource }));
const payload = (name = '目录') => ({ success: true, data: { characters: [{ id: 'c', name }] }, meta: { cacheVersion: 'v1' } });
const reply = (data = payload(), status = 200) => ({ response: { ok: status < 400, status }, data });
const client = () => import('../publicResourceClient.js');
const catalog = { params: { type: 'characters' } };

beforeEach(() => {
  vi.resetModules(); vi.stubEnv('DEV', false); vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear(); vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  revisions.pool = 's1';
  network.version.mockReset().mockResolvedValue({ ok: true, json: async () => ({ cacheVersion: 'v1' }) });
  network.resource.mockReset().mockImplementation(async () => reply());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('browser public data reuse', () => {
  it.each([
    ['/api/announcements', { cutoffIso: '2026-10-25T12:00:00.000Z', limit: '10' },
      { success: true, data: { siteAnnouncements: [], recentGameAnnouncements: [], latestGameAnnouncements: [],
        versionBriefingAnnouncements: [], gameAnnouncementDigest: null } }],
    ['/api/automation-feed', { job: 'official-announcements' }, { success: true, records: [{ source_id: 'test' }] }],
  ])('reuses complete public announcements after reload for five minutes: %s', async (path, params, data) => {
    network.resource.mockResolvedValue(reply(data));
    await (await client()).fetchPublicApiJson(path, { params });
    vi.resetModules();
    expect(await (await client()).fetchPublicApiJson(path, { params })).toEqual(data);
    expect(network.resource).toHaveBeenCalledOnce();
    Date.now.mockReturnValue(1_800_000_300_001);
    await (await client()).fetchPublicApiJson(path, { params });
    expect(network.resource).toHaveBeenCalledTimes(2);
  });
  it('does not retain an incomplete announcement feed as fresh public data', async () => {
    network.resource.mockResolvedValue(reply({ success: true, records: [], stale: true }));
    const options = { params: { job: 'official-announcements' } };
    await (await client()).fetchPublicApiJson('/api/automation-feed', options);
    vi.resetModules();
    await (await client()).fetchPublicApiJson('/api/automation-feed', options);
    expect(network.resource).toHaveBeenCalledTimes(2);
  });
  it('restores catalogs after a reload without any network request', async () => {
    const first = await (await client()).fetchPublicApiJson('/api/stats', catalog);
    vi.resetModules();
    const second = await (await client()).fetchPublicApiJson('/api/stats', catalog);
    expect(second).toEqual(first);
    expect(network.version).toHaveBeenCalledTimes(1);
    expect(network.resource).toHaveBeenCalledTimes(1);
  });
  it('checks the small version after ten minutes and downloads only when it changes', async () => {
    await (await client()).fetchPublicApiJson('/api/stats', catalog);
    Date.now.mockReturnValue(1_800_000_600_001); vi.resetModules();
    await (await client()).fetchPublicApiJson('/api/stats', catalog);
    expect(network.version).toHaveBeenCalledTimes(2);
    expect(network.resource).toHaveBeenCalledTimes(1);
    network.version.mockResolvedValue({ ok: true, json: async () => ({ cacheVersion: 'v2' }) });
    network.resource.mockResolvedValue(reply({ ...payload('新目录'), meta: { cacheVersion: 'v2' } }));
    Date.now.mockReturnValue(1_800_001_200_002); vi.resetModules();
    expect((await (await client()).fetchPublicApiJson('/api/stats', catalog)).data.characters[0].name).toBe('新目录');
    expect(network.resource).toHaveBeenCalledTimes(2);
  });
  it('retains aggregate statistics past five minutes and downloads only a changed revision', async () => {
    const data = { success: true, data: { observations: { total: 7 }, meta: { updatedAt: '2026-10-01' } } };
    network.resource.mockResolvedValue(reply(data));
    const options = { params: { type: 'pool_observations', poolId: 'p' } };
    await (await client()).fetchPublicApiJson('/api/stats', options);
    Date.now.mockReturnValue(1_800_000_299_999); vi.resetModules();
    expect(await (await client()).fetchPublicApiJson('/api/stats', options)).toEqual(data);
    expect(network.resource).toHaveBeenCalledTimes(1);
    Date.now.mockReturnValue(1_800_000_300_001);
    await (await client()).fetchPublicApiJson('/api/stats', options);
    expect(network.resource).toHaveBeenCalledTimes(1);
    revisions.pool = 's2';
    await (await client()).fetchPublicApiJson('/api/stats', options);
    expect(network.resource).toHaveBeenCalledTimes(2);
  });
  it('bypasses memory and persistent caches for explicit refresh, then replaces the saved result', async () => {
    await (await client()).fetchPublicApiJson('/api/stats', catalog);
    network.resource.mockResolvedValue(reply(payload('刷新后')));
    const refreshed = await (await client()).fetchPublicApiJson('/api/stats', { ...catalog, forceRefresh: true });
    expect(network.version).toHaveBeenLastCalledWith(expect.stringContaining('?ts='), expect.objectContaining({ cache: 'no-store' }), expect.any(Object));
    expect(network.resource).toHaveBeenLastCalledWith(expect.stringContaining('&ts='), expect.objectContaining({ cache: 'no-store' }), expect.any(Object));
    expect(await (await client()).fetchPublicApiJson('/api/stats', catalog)).toEqual(refreshed);
    vi.resetModules();
    expect(await (await client()).fetchPublicApiJson('/api/stats', catalog)).toEqual(refreshed);
    expect(network.resource).toHaveBeenCalledTimes(2);
  });
  it('never writes private responses into the public browser database', async () => {
    await (await client()).fetchPublicApiJson('/api/stats', { params: { type: 'personal_statistics' } });
    vi.resetModules();
    await (await client()).fetchPublicApiJson('/api/stats', { params: { type: 'personal_statistics' } });
    expect(network.resource).toHaveBeenCalledTimes(2);
    const { readBrowserPublicCache } = await import('../browserPublicCache.js');
    expect(await readBrowserPublicCache('/api/stats?type=personal_statistics')).toBeNull();
  });
  it.each([
    reply({ success: true, partial: true, data: { globalSummary: null } }, 202),
    reply({ success: true, data: { poolId: 'p', observations: null, meta: { availability: 'building' } } }, 202),
    reply({ success: false, error: 'Unavailable' }, 503),
  ])('does not retain pending or failed snapshots: %#', async response => {
    network.resource.mockResolvedValue(response);
    const api = await client(); const options = { params: { type: 'global_summary' } };
    await api.fetchPublicApiJson('/api/stats', options).catch(() => null);
    await api.fetchPublicApiJson('/api/stats', options).catch(() => null);
    expect(network.resource).toHaveBeenCalledTimes(2);
  });
  it('merges simultaneous reads and lets one view cancel without cancelling the other', async () => {
    let release;
    network.resource.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const api = await client(), controller = new AbortController();
    const cancelled = api.fetchPublicApiJson('/api/stats', { ...catalog, signal: controller.signal });
    const surviving = api.fetchPublicApiJson('/api/stats', catalog);
    await vi.waitFor(() => expect(network.resource).toHaveBeenCalledTimes(1));
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); release(reply());
    await rejection; expect(await surviving).toEqual(payload());
  });
  it('does not overwrite a forced update when an older request finishes later', async () => {
    let release;
    network.resource.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const api = await client(), older = api.fetchPublicApiJson('/api/stats', catalog);
    await vi.waitFor(() => expect(network.resource).toHaveBeenCalledTimes(1));
    network.resource.mockResolvedValue(reply(payload('最新结果')));
    await api.fetchPublicApiJson('/api/stats', { ...catalog, forceRefresh: true });
    release(reply(payload('旧结果'))); await older;
    expect((await api.fetchPublicApiJson('/api/stats', catalog)).data.characters[0].name).toBe('最新结果');
    vi.resetModules();
    expect((await (await client()).fetchPublicApiJson('/api/stats', catalog)).data.characters[0].name).toBe('最新结果');
  });
  it('continues to load data when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await (await client()).fetchPublicApiJson('/api/stats', catalog)).toEqual(payload());
  });
});
