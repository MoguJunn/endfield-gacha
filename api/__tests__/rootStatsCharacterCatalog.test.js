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
import { STATISTICS_SNAPSHOT_VERSION } from '../../shared/statisticsRefreshPolicy.js';

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
        schema_version: STATISTICS_SNAPSHOT_VERSION,
        computed_at: '2026-09-22T00:00:00Z',
        next_refresh_at: '2099-01-01T00:00:00Z',
        refresh_minutes: 30,
        payload: {
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
        source: 'scheduled-snapshot',
        stale: false,
        refreshMinutes: 30,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('read_statistics_snapshot', { p_scope: 'character_catalog' });
    expectNoPrivateIdentifiers(res.body);
  });

  it('returns an error without calculating a new catalog when snapshot storage fails', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error('aggregate timeout'),
    });

    const res = await call({ type: 'character_catalog', v: 'fallback-test' });

    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expectNoPrivateIdentifiers(res.body);
  });

  it('returns a pending response when the first ranking snapshot is unavailable', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await call({ type: 'character_ranking', v: 'ranking-timeout-test' });

    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      success: true,
      cached: true,
      partial: true,
      data: {
        characterRanking: null,
      },
      meta: {
        availability: 'building',
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('read_statistics_snapshot', { p_scope: 'character_ranking' });
    expectNoPrivateIdentifiers(res.body);
  });
});
