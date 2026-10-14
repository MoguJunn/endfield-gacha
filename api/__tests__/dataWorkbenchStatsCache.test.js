// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATISTICS_SNAPSHOT_VERSION } from '../../shared/statisticsRefreshPolicy.js';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: mocks.snapshot,
  from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
}) }));
vi.mock('../_lib/supabaseEnv.js', () => ({ resolveSupabaseUrl: () => 'https://example.invalid', resolveSupabaseServerKey: () => 'mock-only' }));
vi.mock('../_lib/http.js', () => ({ rejectDisallowedBrowserOrigin: () => false }));
import statsHandler from '../_routes/root/stats.js';

async function request() {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await statsHandler({ method: 'GET', query: { type: 'global_summary', v: 'workbench-cache-test' }, headers: {} }, res);
  return res;
}

describe('workbench public summary cache', () => {
  afterEach(() => vi.useRealTimers());
  it('reads the published metric DTO without rebuilding history and keeps scheduled refresh metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
    const snapshot = total => ({ data: { schema_version: STATISTICS_SNAPSHOT_VERSION,
      computed_at: '2026-09-19T10:00:00Z', next_refresh_at: '2026-09-19T11:00:00Z', refresh_minutes: 60,
      payload: { totalPulls: 100, workbench: { status: 'ready', supplemental: { totalPulls: total } } } }, error: null });
    mocks.snapshot.mockResolvedValue(snapshot(80));
    const first = await request();
    const cached = await request();
    expect(first.statusCode).toBe(200);
    expect(cached.body.cached).toBe(true);
    expect(cached.body.data.globalSummary.workbench.supplemental.totalPulls).toBe(80);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.snapshot).toHaveBeenCalledWith('read_statistics_snapshot', { p_scope: 'global_summary' });
    expect(cached.body.data.globalSummary.meta.nextRefreshAt).toBe('2026-09-19T11:00:00Z');
    mocks.snapshot.mockResolvedValue(snapshot(0));
    vi.setSystemTime(new Date('2026-09-19T10:01:01Z'));
    const refreshed = await request();
    expect(refreshed.body.cached).toBe(true);
    expect(refreshed.body.data.globalSummary.workbench.supplemental.totalPulls).toBe(0);
    expect(mocks.snapshot).toHaveBeenCalledTimes(3);
  });
});
