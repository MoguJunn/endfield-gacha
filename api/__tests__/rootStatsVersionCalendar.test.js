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

  it('returns all public version snapshots with sanitized pool artwork', async () => {
    const snapshotBuilder = {
      select: vi.fn(() => snapshotBuilder),
      eq: vi.fn(() => snapshotBuilder),
      order: vi.fn(async () => ({
        data: [{
          version_key: 'version-4',
          version_number: '4',
          revision: 1,
          title: '寻遗散记',
          starts_at: '2026-06-04T20:00:00+00:00',
          ends_at: '2026-07-15T22:00:00+00:00',
          content: { activitiesComplete: false, events: [] },
          pool_bindings: {},
          source_meta: { source: 'version-config' },
          published_at: '2026-07-11T00:00:00+00:00',
          updated_at: '2026-07-11T00:00:00+00:00',
        }, {
          version_key: 'version-5',
          version_number: '5',
          revision: 1,
          title: '向渊行',
          starts_at: '2026-07-16T04:00:00+00:00',
          ends_at: '2026-09-01T22:00:00+00:00',
          content: { events: [{ id: 'op-wander' }] },
          pool_bindings: { 'op-wander': 'pool-a' },
          source_meta: { source: 'official-version-calendar' },
          published_at: '2026-07-11T00:00:00+00:00',
          updated_at: '2026-07-11T00:00:00+00:00',
        }],
        error: null,
      })),
    };
    const configBuilder = {
      select: vi.fn(() => configBuilder),
      eq: vi.fn(() => configBuilder),
      maybeSingle: vi.fn(async () => ({
        data: {
          value: JSON.stringify({
            versions: [{
              id: 'version-4',
              name: '寻遗散记',
              starts_at: '2026-06-04T20:00:00+00:00',
              ends_at: '2026-07-15T22:00:00+00:00',
              enabled: true,
              order: 40,
            }, {
              id: 'version-5',
              name: '向渊行',
              starts_at: '2026-07-16T04:00:00+00:00',
              ends_at: '2026-09-02T06:00:00+08:00',
              enabled: true,
              order: 50,
            }],
          }),
          updated_at: '2026-07-11T18:16:32.446+00:00',
        },
        error: null,
      })),
    };
    const characterBuilder = {
      select: vi.fn(() => characterBuilder),
      in: vi.fn(async () => ({
        data: [{
          id: 'char-manual-jue',
          name: '诀',
          avatar_url: '/avatars/characters/char-manual-jue.png',
          aliases: [],
          type: 'character',
        }],
        error: null,
      })),
    };
    mocks.from.mockImplementation((table) => {
      if (table === 'version_content_snapshots') return snapshotBuilder;
      if (table === 'site_config') return configBuilder;
      if (table === 'characters') return characterBuilder;
      return undefined;
    });
    mocks.rpc.mockResolvedValue({
      data: [{
        pool_id: 'pool-a',
        name: '临渊望北（前瞻）',
        type: 'limited_character',
        start_time: '2026-07-16T04:00:00+00:00',
        end_time: '2026-08-09T04:00:00+00:00',
        banner_url: 'https://cdn.example/pool-a.webp',
        up_character: '诀',
        user_id: 'private-user',
      }],
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
          activeVersionKey: 'version-5',
          versionKey: 'version-5',
          versionNumber: '5',
          revision: 1,
          poolNames: { 'pool-a': '临渊望北' },
          versions: [
            expect.objectContaining({
              versionKey: 'version-4',
              versionNumber: '4',
              pools: [],
            }),
            expect.objectContaining({
              versionKey: 'version-5',
              versionNumber: '5',
              pools: [expect.objectContaining({
                poolId: 'pool-a',
                bannerUrl: null,
                backgroundCharacter: '诀',
                backgroundUrl: '/avatars/characters/char-manual-jue.png',
              })],
            }),
          ],
        },
      },
      meta: { source: 'origin', partial: false },
    });
    expect(JSON.stringify(res.body)).not.toContain('private-user');
    expect(mocks.rpc).toHaveBeenCalledWith('get_app_visible_pools');
  });
});
