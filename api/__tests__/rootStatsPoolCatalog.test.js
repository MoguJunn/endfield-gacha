// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  resolveSupabaseUrl: vi.fn(() => 'https://example.supabase.co'),
  resolveSupabaseServerKey: vi.fn(() => 'service-role-key'),
  serverLogger: { error: vi.fn() },
  poolRosterError: null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/supabaseEnv.js', () => ({
  resolveSupabaseUrl: mocks.resolveSupabaseUrl,
  resolveSupabaseServerKey: mocks.resolveSupabaseServerKey,
}));

vi.mock('../_lib/serverLogger.js', () => ({
  serverLogger: mocks.serverLogger,
}));

import statsHandler from '../_routes/root/stats.js';

function createJsonResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function callPoolCatalog(version = 'pool-roster-route-test') {
  const req = {
    method: 'GET',
    query: { type: 'pool_catalog', v: version },
    headers: {},
  };
  const res = createJsonResponseRecorder();
  await statsHandler(req, res);
  return res;
}

describe('/api/stats pool_catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolRosterError = null;
    mocks.createClient.mockReturnValue({ from: mocks.from, rpc: vi.fn() });
    mocks.from.mockImplementation((table) => {
      if (table === 'site_config') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'pools') {
        return {
          select: async () => ({
            data: [
              {
                pool_id: 'special_1_0_1',
                name: '熔火灼痕',
                type: 'limited',
                extra_subtype: null,
                extra_rule_profile: null,
                extra_series_key: null,
                extra_series_phase: null,
                user_id: 'public-owner',
                creator_username: '公开维护者',
                creator_role: 'admin',
                banner_url: 'https://127.0.0.1/private.png',
                up_character: '莱万汀',
                start_time: '2026-01-22T03:00:00+00:00',
                end_time: '2026-02-07T03:55:00+00:00',
                featured_characters: null,
              },
            ],
            error: null,
          }),
        };
      }
      if (table === 'public_profiles') {
        return {
          select: () => ({
            in: async () => ({
              data: [{ id: 'public-owner', username: '公开维护者', role: 'admin' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'pool_characters') {
        return {
          select: () => ({
            in: async (_column, poolIds) => {
              expect(poolIds).toEqual(['special_1_0_1']);
              if (mocks.poolRosterError) {
                return {
                  data: null,
                  error: mocks.poolRosterError,
                };
              }
              return {
                data: [
                  {
                    pool_id: 'special_1_0_1',
                    character_id: 'chr_0016_laevat',
                    is_up: false,
                    characters: { id: 'chr_0016_laevat', name: '莱万汀', rarity: 6, type: 'character' },
                  },
                  {
                    pool_id: 'special_1_0_1',
                    character_id: 'chr_0013_aglina',
                    is_up: false,
                    characters: { id: 'chr_0013_aglina', name: '洁尔佩塔', rarity: 6, type: 'character' },
                  },
                  {
                    pool_id: 'special_1_0_1',
                    character_id: 'chr_five',
                    is_up: false,
                    characters: { id: 'chr_five', name: '五星角色', rarity: 5, type: 'character' },
                  },
                ],
                error: null,
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });
  });

  it('returns pool schedule and the complete six-star roster', async () => {
    const res = await callPoolCatalog();

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        pools: [
          {
            id: 'special_1_0_1',
            name: '熔火灼痕',
            extra_subtype: null,
            extra_rule_profile: null,
            extra_series_key: null,
            extra_series_phase: null,
            start_time: '2026-01-22T03:00:00+00:00',
            end_time: '2026-02-07T03:55:00+00:00',
            six_star_roster_complete: true,
            six_star_entities: [
              { id: 'chr_0016_laevat', name: '莱万汀', type: 'character', is_up: true },
              { id: 'chr_0013_aglina', name: '洁尔佩塔', type: 'character', is_up: false },
            ],
          },
        ],
      },
      meta: {
        source: 'origin',
        partial: false,
      },
    });
    expect(mocks.from).toHaveBeenCalledWith('pool_characters');
    expect(JSON.stringify(res.body)).not.toContain('chr_five');
    expect(res.body.data.pools[0].banner_url).toBeNull();
    expect(res.body.data.pools[0]).not.toHaveProperty('user_id');
    expect(res.body.data.pools[0]).not.toHaveProperty('creator_username');
    expect(res.body.data.pools[0]).not.toHaveProperty('creator_role');
  });

  it('keeps the pool catalog available when the optional roster query fails', async () => {
    mocks.poolRosterError = new Error('pool_characters relation unavailable');

    const res = await callPoolCatalog('pool-roster-partial-test');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      partial: true,
      error: 'pool_catalog_roster_unavailable',
      data: {
        pools: [
          {
            id: 'special_1_0_1',
            name: '熔火灼痕',
            six_star_entities: [],
            six_star_roster_complete: false,
          },
        ],
      },
      meta: {
        source: 'origin',
        partial: true,
      },
    });
    expect(mocks.serverLogger.error).toHaveBeenCalledWith('stats.pool_catalog.roster_unavailable', {
      message: 'pool_characters relation unavailable',
    });
  });
});
