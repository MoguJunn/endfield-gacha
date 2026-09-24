// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  resolveSupabaseUrl: vi.fn(() => 'https://example.supabase.co'),
  resolveSupabaseServerKey: vi.fn(() => 'service-role-key'),
  serverLogger: {
    error: vi.fn(),
  },
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

async function call(query) {
  const req = {
    method: 'GET',
    query,
    headers: {},
  };
  const res = createJsonResponseRecorder();
  await statsHandler(req, res);
  return res;
}

function expectNoPrivateIdentifiers(payload) {
  const serialized = JSON.stringify(payload);
  [
    'user_id',
    'game_uid',
    'history_id',
    'record_id',
    'platform_user_id',
    'email',
    'private-user',
    'private-game',
    'private-record',
  ].forEach((token) => {
    expect(serialized).not.toContain(token);
  });
}

describe('/api/stats character_catalog privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      rpc: mocks.rpc,
      from: mocks.from,
    });
    mocks.from.mockReset();
    mocks.rpc.mockResolvedValue({
      data: {
        totalContributors: 1,
        summary: {
          totalCharacters: 1,
          ownedCharacters: 1,
          quotaAggregate: {
            aicQuotaDirect: 30,
          },
          user_id: 'private-user',
        },
        characters: [
          {
            id: 'char_public',
            name: '公开角色',
            avatarUrl: '/avatars/characters/chr_0031_mifu.png',
            rarity: 6,
            ownerUsers: 1,
            unownedUsers: 0,
            ownershipRate: 1,
            fullPotentialUsers: 0,
            totalCopies: 1,
            user_id: 'private-user',
            game_uid: 'private-game',
            record_id: 'private-record',
          },
        ],
      },
      error: null,
    });
  });

  it('returns character catalog aggregates without raw private identifiers', async () => {
    const res = await call({ type: 'character_catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        characterCatalog: {
          totalContributors: 1,
          characters: [
            {
              id: 'char_public',
              name: '公开角色',
              avatarUrl: '/avatars/characters/chr_0031_mifu.webp',
              ownerUsers: 1,
            },
          ],
        },
      },
      meta: {
        source: 'origin',
        partial: false,
        stale: false,
        cacheKey: 'stats:character_catalog:v0',
        cacheVersion: '0',
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_character_catalog_stats_cached');
    expectNoPrivateIdentifiers(res.body);
  });

  it('falls back to a lightweight character catalog when the aggregate RPC fails', async () => {
    const order = vi.fn(async () => ({
      data: [
        {
          id: 'chr_0031_mifu',
          name: '弭弗',
          avatar_url: '/avatars/characters/chr_0031_mifu.png',
          rarity: 6,
          type: 'character',
          is_limited: true,
          release_date: '2026-06-05',
        },
        {
          id: 'wpn_funnel_0015',
          name: '焰羽火燎',
          avatar_url: '/avatars/weapons/wpn_funnel_0015.png',
          rarity: 6,
          type: 'weapon',
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ order }));
    mocks.from.mockReturnValue({ select });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error('aggregate timeout'),
    });

    const res = await call({ type: 'character_catalog', v: 'fallback-test' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      partial: true,
      data: {
        characterCatalog: {
          totalContributors: 0,
          summary: {
            totalCharacters: 1,
            ownedCharacters: 0,
          },
          characters: [
            {
              id: 'chr_0031_mifu',
              name: '弭弗',
              avatarUrl: '/avatars/characters/chr_0031_mifu.webp',
              ownerUsers: 0,
            },
          ],
        },
      },
      meta: {
        source: 'character-table-fallback',
        partial: true,
      },
    });
    expect(select).toHaveBeenCalledWith('id, name, avatar_url, rarity, type, aliases, is_limited, release_date, created_at, updated_at, pool_config');
    expect(order).toHaveBeenCalledWith('name');
    expectNoPrivateIdentifiers(res.body);
  });

  it('returns a partial response when character ranking aggregation is unavailable', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error('ranking timeout'),
    });

    const res = await call({ type: 'character_ranking', v: 'ranking-timeout-test' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      cached: false,
      partial: true,
      data: {
        characterRanking: null,
      },
      meta: {
        source: 'origin-timeout',
        partial: true,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_character_ranking_stats_cached');
    expectNoPrivateIdentifiers(res.body);
  });
});
