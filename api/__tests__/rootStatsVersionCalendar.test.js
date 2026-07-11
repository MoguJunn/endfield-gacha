// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  resolveSupabaseUrl: vi.fn(() => 'https://example.supabase.co'),
  resolveSupabaseServerKey: vi.fn(() => 'service-role-key'),
  serverLogger: { error: vi.fn() },
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));
vi.mock('../_lib/supabaseEnv.js', () => ({
  resolveSupabaseUrl: mocks.resolveSupabaseUrl,
  resolveSupabaseServerKey: mocks.resolveSupabaseServerKey,
}));
vi.mock('../_lib/serverLogger.js', () => ({ serverLogger: mocks.serverLogger }));

import statsHandler from '../_routes/root/stats.js';

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

describe('/api/stats version_calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  });

  it('returns the active public snapshot with canonical pool names', async () => {
    const snapshotBuilder = {
      select: vi.fn(() => snapshotBuilder),
      eq: vi.fn(() => snapshotBuilder),
      order: vi.fn(() => snapshotBuilder),
      limit: vi.fn(() => snapshotBuilder),
      maybeSingle: vi.fn(async () => ({
        data: {
          version_key: 'xiangyuan-2026',
          revision: 1,
          title: '终「向渊行」',
          content: { events: [{ id: 'op-wander' }] },
          pool_bindings: { 'op-wander': 'pool-a' },
          source_meta: { source: 'official-version-calendar' },
          published_at: '2026-07-11T00:00:00+00:00',
          updated_at: '2026-07-11T00:00:00+00:00',
        },
        error: null,
      })),
    };
    mocks.from.mockImplementation((table) => (
      table === 'version_content_snapshots' ? snapshotBuilder : undefined
    ));
    mocks.rpc.mockResolvedValue({
      data: [{ pool_id: 'pool-a', name: '临渊望北（前瞻）', user_id: 'private-user' }],
      error: null,
    });

    const req = { method: 'GET', query: { type: 'version_calendar', v: 'calendar-test' }, headers: {} };
    const res = createResponse();
    await statsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        versionCalendar: {
          versionKey: 'xiangyuan-2026',
          revision: 1,
          poolNames: { 'pool-a': '临渊望北' },
        },
      },
      meta: { source: 'origin', partial: false },
    });
    expect(JSON.stringify(res.body)).not.toContain('private-user');
    expect(mocks.rpc).toHaveBeenCalledWith('get_app_visible_pools');
  });
});
