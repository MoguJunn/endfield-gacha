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
  rosterStatus: 'complete',
  rosterRows: null,
  rosterRanges: [],
  truncateRosterPage: false,
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
    mocks.rosterStatus = 'complete';
    mocks.rosterRows = null;
    mocks.rosterRanges = [];
    mocks.truncateRosterPage = false;
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
                roster_status: mocks.rosterStatus,
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
        const query = {
          select: (_columns, options) => {
            expect(options).toEqual({ count: 'exact' });
            return query;
          },
          in: (_column, poolIds) => {
              expect(poolIds).toEqual(['special_1_0_1']);
              return query;
          },
          order: () => query,
          range: async (from, to) => {
              mocks.rosterRanges.push([from, to]);
              if (mocks.poolRosterError) {
                return {
                  data: null,
                  error: mocks.poolRosterError,
                };
              }
              const rows = mocks.rosterRows || [
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
                ];
              return {
                data: rows.slice(from, mocks.truncateRosterPage ? Math.min(to+1, from+100) : to+1),
                count: rows.length,
                error: null,
              };
          },
        };
        return query;
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
            roster_status: 'complete',
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

  it('does not promote an existing partial roster to complete in the public catalog', async () => {
    mocks.rosterStatus = 'partial';
    const res = await callPoolCatalog('pool-roster-unconfirmed-test');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.pools[0]).toMatchObject({ roster_status: 'partial', six_star_roster_complete: false });
    expect(res.body.data.pools[0].six_star_entities).toHaveLength(2);
  });

  it('reads every roster page so a six-star UP after the first 1000 relations is preserved', async () => {
    mocks.rosterRows = Array.from({ length: 1001 }, (_, index) => ({
      pool_id: 'special_1_0_1', character_id: `filler_${String(index).padStart(4, '0')}`, is_up: false,
      characters: { id: `filler_${index}`, name: `四星${index}`, rarity: 4, type: 'character' },
    }));
    mocks.rosterRows.push({ pool_id: 'special_1_0_1', character_id: 'up_tail', is_up: true,
      characters: { id: 'up_tail', name: '莱万汀', rarity: 6, type: 'character' } });
    const res = await callPoolCatalog('pool-roster-over-limit-test');
    expect(res.body.partial).toBe(false);
    expect(res.body.data.pools[0].six_star_entities).toEqual([{ id: 'up_tail', name: '莱万汀', type: 'character', is_up: true }]);
    expect(mocks.rosterRanges).toEqual([[0,499], [500,999], [1000,1499]]);
  });

  it('reports incomplete responses instead of publishing a shortened roster as complete', async () => {
    mocks.rosterRows = Array.from({ length: 501 }, (_, index) => ({
      pool_id: 'special_1_0_1', character_id: `entity_${index}`, is_up: false,
      characters: { id: `entity_${index}`, name: `角色${index}`, rarity: 6, type: 'character' },
    }));
    mocks.truncateRosterPage = true;
    const res = await callPoolCatalog('pool-roster-truncated-test');
    expect(res.body).toMatchObject({ partial: true, error: 'pool_catalog_roster_unavailable' });
    expect(res.body.data.pools[0]).toMatchObject({ six_star_entities: [], six_star_roster_complete: false });
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
