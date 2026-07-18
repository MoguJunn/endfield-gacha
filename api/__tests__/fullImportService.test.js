import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSupabaseClient;

const officialImportStagingMocks = vi.hoisted(() => ({
  stageOfficialImportTask: vi.fn(),
  confirmOfficialImportTask: vi.fn(),
  getOfficialImportReview: vi.fn(),
  rejectOfficialImportTask: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

vi.mock('../../backend/lib/officialImportStaging.js', () => officialImportStagingMocks);

beforeEach(() => {
  Object.values(officialImportStagingMocks).forEach((mock) => mock.mockReset());
  officialImportStagingMocks.stageOfficialImportTask.mockResolvedValue({
    task: { id: 'task-1', status: 'awaiting_confirmation' },
    accessKey: 'access-key',
    records: [],
  });
});

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createCompatAccessToken(payload, secret = 'test-jwt-secret') {
  const header = toBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = toBase64UrlJson(payload);
  const unsigned = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function createHistoryRangeQuery(rangeHandler) {
  const query = {
    eq: vi.fn(() => query),
    range: rangeHandler,
  };
  return query;
}

function mockConfirmationCommitFromLatestStaging() {
  const stagedPayload = officialImportStagingMocks.stageOfficialImportTask.mock.calls.at(-1)?.[0];
  if (!stagedPayload) {
    throw new Error('Expected executeFullImport to stage records before confirmation');
  }

  officialImportStagingMocks.confirmOfficialImportTask.mockImplementation(async ({ commit }) => {
    const poolById = new Map(
      (stagedPayload.pools || []).map((pool) => [String(pool.pool_id), pool])
    );
    const rows = (stagedPayload.stagedRecords || []).map((record, ordinal) => ({
      ordinal,
      selected_action: 'keep',
      normalized_record: {
        history: record.historyRecord,
        normalized: record.normalized,
        pool: poolById.get(String(record.historyRecord?.pool_id || record.normalized?.poolId)) || null,
      },
    }));
    const task = {
      id: 'task-1',
      user_id: stagedPayload.userId,
      source: stagedPayload.source,
      import_mode: stagedPayload.importMode,
      summary: stagedPayload.importSummary,
    };
    const result = await commit({ task, rows });
    return { task, result, idempotent: false };
  });
}

describe('verifySupabaseAccessToken', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
  });

  it('keeps accepting native Supabase access tokens', async () => {
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: { id: 'native-user' },
          },
          error: null,
        })),
        admin: {
          getUserById: vi.fn(),
        },
      },
    };

    const { initSupabaseAdmin, verifySupabaseAccessToken } = await import('../../backend/fullImportService.js');
    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    await expect(verifySupabaseAccessToken('native-token')).resolves.toEqual({ id: 'native-user' });
    expect(mockSupabaseClient.auth.getUser).toHaveBeenCalledWith('native-token');
    expect(mockSupabaseClient.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it('accepts signed site-session compatible tokens for OAuth users', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createCompatAccessToken({
      iss: 'https://db.15963574.xyz/auth/v1',
      sub: 'oauth-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: '',
      app_metadata: {
        provider: 'site_session',
      },
      user_metadata: {
        site_session: true,
      },
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    });
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing' },
        })),
        admin: {
          getUserById: vi.fn(async () => ({
            data: {
              user: { id: 'oauth-user', email: 'github.hash@oauth.local.invalid' },
            },
            error: null,
          })),
        },
      },
    };

    const { initSupabaseAdmin, verifySupabaseAccessToken } = await import('../../backend/fullImportService.js');
    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    await expect(verifySupabaseAccessToken(token)).resolves.toEqual({
      id: 'oauth-user',
      email: 'github.hash@oauth.local.invalid',
    });
    expect(mockSupabaseClient.auth.getUser).toHaveBeenCalledWith(token);
    expect(mockSupabaseClient.auth.admin.getUserById).toHaveBeenCalledWith('oauth-user');
  });

  it('reports a missing backend JWT secret for site-session compatible tokens', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createCompatAccessToken({
      sub: 'oauth-user',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {
        provider: 'site_session',
      },
      user_metadata: {
        site_session: true,
      },
      exp: nowSeconds + 3600,
    });
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing' },
        })),
        admin: {
          getUserById: vi.fn(),
        },
      },
    };

    const { initSupabaseAdmin, verifySupabaseAccessToken } = await import('../../backend/fullImportService.js');
    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      publicCode: 'compat_jwt_secret_missing',
    });
  });

  it('reports backend JWT signature mismatches without exposing token data', async () => {
    process.env.SUPABASE_JWT_SECRET = 'different-secret';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createCompatAccessToken({
      sub: 'oauth-user',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {
        provider: 'site_session',
      },
      user_metadata: {
        site_session: true,
      },
      exp: nowSeconds + 3600,
    }, 'test-jwt-secret');
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing' },
        })),
        admin: {
          getUserById: vi.fn(),
        },
      },
    };

    const { initSupabaseAdmin, verifySupabaseAccessToken } = await import('../../backend/fullImportService.js');
    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      publicCode: 'compat_jwt_signature_mismatch',
      publicDetails: {
        tokenKind: 'site_session',
      },
    });
  });

  it('reports expired site-session compatible tokens with safe timing details', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createCompatAccessToken({
      sub: 'oauth-user',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {
        provider: 'site_session',
      },
      user_metadata: {
        site_session: true,
      },
      exp: nowSeconds - 30,
    });
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing' },
        })),
        admin: {
          getUserById: vi.fn(),
        },
      },
    };

    const { initSupabaseAdmin, verifySupabaseAccessToken } = await import('../../backend/fullImportService.js');
    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({
      publicCode: 'compat_jwt_expired',
      publicDetails: {
        exp: nowSeconds - 30,
      },
    });
  });
});

describe('savePoolsToServer', () => {
  beforeEach(() => {
    vi.resetModules();

    const insertedPoolIds = new Set();
    const operations = [];

    mockSupabaseClient = {
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push('pool_id_aliases.upsert');

              const missingPool = (rows || []).find((row) => !insertedPoolIds.has(String(row.pool_id)));
              if (missingPool) {
                return {
                  error: {
                    code: '23503',
                    message: `Key (pool_id)=(${missingPool.pool_id}) is not present in table "pools".`,
                  },
                };
              }

              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push('pools.upsert');
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };
  });

  it('creates fallback pools for unknown official ids and writes official self aliases', async () => {
    const { initSupabaseAdmin, savePoolsToServer } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const result = await savePoolsToServer(
      [{
        pool_id: 'special_1_2_1',
        name: '测试限定池',
        type: 'limited',
        start_time: null,
        end_time: null,
        up_character: '测试角色',
      }],
      '00000000-0000-0000-0000-000000000001'
    );

    expect(result).toMatchObject({
      success: true,
      created: 1,
    });
    expect(mockSupabaseClient.__operations).toEqual([
      'pools.upsert',
      'pool_id_aliases.upsert',
    ]);
  });
});

describe('executeFullImport import mode metadata', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalizes import mode values', async () => {
    const { normalizeFullImportMode } = await import('../../backend/fullImportService.js');

    expect(normalizeFullImportMode('full')).toBe('full');
    expect(normalizeFullImportMode('incremental')).toBe('incremental');
    expect(normalizeFullImportMode('unsafe')).toBe('incremental');
    expect(normalizeFullImportMode(undefined)).toBe('incremental');
  });

  it('stages the selected mode without changing full-fetch dedupe semantics, then commits on confirmation', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    let savedHistoryRows = [];
    const rpc = vi.fn(async (functionName, args = {}) => {
      if (functionName === 'commit_official_import_records') {
        savedHistoryRows = args.p_history || [];
        operations.push({
          tableName: 'official_import_records',
          action: 'rpc',
          poolCount: (args.p_pools || []).length,
          historyCount: savedHistoryRows.length,
        });
        return {
          data: {
            savedRecords: savedHistoryRows.length,
            skippedRecords: 0,
            createdPools: (args.p_pools || []).length,
            atomicCommit: true,
          },
          error: null,
        };
      }
      return {
        data: {
          refreshedPools: 1,
          refreshedTrendRows: 3,
          updatedAt: '2026-06-05T12:00:00.000Z',
        },
        error: null,
        functionName,
      };
    });

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => ({ data: [], error: null }));
            },
            async upsert(rows) {
              savedHistoryRows = rows;
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'profiles') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: '00000000-0000-0000-0000-000000000001' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const { executeFullImport, initSupabaseAdmin } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const updateProgress = vi.fn();
    const authChainFunctions = {
      grantAppToken: vi.fn(async () => ({
        success: true,
        data: { token: 'app-token' },
      })),
      fetchBindingList: vi.fn(async () => ({
        success: true,
        data: {
          accounts: [{
            uid: 'hg-uid',
            gameUid: '10000001',
            nickName: '测试账号',
            serverId: '1',
          }],
        },
      })),
      fetchU8TokenByUid: vi.fn(async () => ({
        success: true,
        data: { token: 'u8-token' },
      })),
      fetchAllRecordsConcurrent: vi.fn(async () => ({
        success: true,
        data: {
          totalRecords: 1,
          partial: [],
          failed: [],
          results: [{
            type: 'char',
            poolType: 'E_CharacterGachaPoolType_Special',
            currentUpCharacter: '测试角色',
            records: [{
              poolId: 'special_1_2_1',
              poolName: '测试限定池',
              seqId: '1',
              charId: 'char_test',
              charName: '测试角色',
              rarity: 6,
              gachaTs: '1767225600000',
              isFree: false,
              isInfoBook: true,
              isNew: true,
            }],
          }],
        },
      })),
    };

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress,
      authChainFunctions,
      source: 'cn',
      importMode: 'full',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      importMode: 'full',
      fetchStrategy: 'full_official_fetch_with_dedupe',
      totalRecords: 1,
      newRecords: 1,
      savedRecords: 0,
      duplicates: 0,
      reviewRequired: true,
      reviewTask: {
        id: 'task-1',
        status: 'awaiting_confirmation',
        accessKey: 'access-key',
      },
      warnings: [],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(authChainFunctions.fetchAllRecordsConcurrent).toHaveBeenCalledWith(
      'u8-token',
      '1',
      '10000001',
      '测试账号',
      {
        importMode: 'full',
        existingRecordKeys: null,
      }
    );
    expect(operations).toEqual([]);
    expect(savedHistoryRows).toEqual([]);
    expect(officialImportStagingMocks.stageOfficialImportTask).toHaveBeenCalledTimes(1);
    const stagedPayload = officialImportStagingMocks.stageOfficialImportTask.mock.calls[0][0];
    expect(stagedPayload).toMatchObject({
      userId: '00000000-0000-0000-0000-000000000001',
      source: 'cn',
      importMode: 'full',
      account: {
        gameUid: '10000001',
        serverId: '1',
        region: 'cn',
      },
      importSummary: {
        fetchStrategy: 'full_official_fetch_with_dedupe',
        newRecords: 1,
        savedRecords: 0,
      },
    });
    expect(stagedPayload.stagedRecords).toHaveLength(1);
    expect(stagedPayload.stagedRecords[0]).toMatchObject({
      historyRecord: {
        game_uid: '10000001',
        nick_name: '测试账号',
        server_id: '1',
        region: 'cn',
        is_info_book: true,
      },
    });
    expect(updateProgress).toHaveBeenCalledWith({ progress: 100, message: '记录已暂存，请确认后写入' });

    mockConfirmationCommitFromLatestStaging();
    const { confirmFullImportReview } = await import('../../backend/fullImportService.js');
    const confirmed = await confirmFullImportReview({
      taskId: 'task-1',
      accessKey: 'access-key',
      userId: '00000000-0000-0000-0000-000000000001',
    });

    expect(confirmed.result).toMatchObject({
      savedRecords: 1,
      atomicCommit: true,
      publicAnalyticsRefresh: {
        ok: true,
        functionName: 'refresh_public_analytics_cache',
        refreshedPools: 1,
        refreshedTrendRows: 3,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      'commit_official_import_records',
      expect.objectContaining({
        p_task_id: 'task-1',
        p_user_id: '00000000-0000-0000-0000-000000000001',
        p_pools: expect.any(Array),
        p_history: expect.any(Array),
      })
    );
    expect(rpc).toHaveBeenCalledWith('refresh_public_analytics_cache');
    expect(operations).toEqual(expect.arrayContaining([
      { tableName: 'official_import_records', action: 'rpc', poolCount: 1, historyCount: 1 },
      { tableName: 'characters', action: 'upsert', count: 1 },
      { tableName: 'character_id_aliases', action: 'upsert', count: 2 },
      { tableName: 'pools', action: 'upsert', count: 1 },
      { tableName: 'pool_id_aliases', action: 'upsert', count: 2 },
    ]));
    expect(savedHistoryRows[0]).toMatchObject({
      game_uid: '10000001',
      nick_name: '测试账号',
      server_id: '1',
      region: 'cn',
      is_info_book: true,
    });
  });

  it('preserves existing international EU/NA server when bindings omit sub-server', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    let savedHistoryRows = [];
    const rpc = vi.fn(async () => ({
      data: {
        refreshedPools: 1,
        refreshedTrendRows: 3,
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
      error: null,
    }));

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => ({
                data: [{ server_id: '3' }],
                error: null,
              }));
            },
            async upsert(rows) {
              savedHistoryRows = rows;
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'profiles') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: '00000000-0000-0000-0000-000000000001' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const { executeFullImport, initSupabaseAdmin } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const authChainFunctions = {
      grantAppToken: vi.fn(async () => ({
        success: true,
        data: { token: 'app-token' },
      })),
      fetchBindingList: vi.fn(async () => ({
        success: true,
        data: {
          accounts: [{
            uid: 'hg-uid',
            gameUid: '20000001',
            nickName: 'EU/NA账号',
            channelName: 'Gryphline',
          }],
        },
      })),
      fetchU8TokenByUid: vi.fn(async () => ({
        success: true,
        data: { token: 'u8-token' },
      })),
      fetchAllRecordsConcurrent: vi.fn(async () => ({
        success: true,
        data: {
          totalRecords: 1,
          partial: [],
          failed: [],
          results: [{
            type: 'char',
            poolType: 'E_CharacterGachaPoolType_Special',
            currentUpCharacter: '测试角色',
            records: [{
              poolId: 'special_1_2_1',
              poolName: '测试限定池',
              seqId: '1',
              charId: 'char_test',
              charName: '测试角色',
              rarity: 6,
              gachaTs: '1767225600000',
              isFree: false,
              isNew: true,
            }],
          }],
        },
      })),
    };

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress: vi.fn(),
      authChainFunctions,
      source: 'intl',
      importMode: 'full',
    });

    expect(result.success).toBe(true);
    expect(authChainFunctions.fetchAllRecordsConcurrent).toHaveBeenCalledWith(
      'u8-token',
      '3',
      '20000001',
      'EU/NA账号',
      {
        importMode: 'full',
        existingRecordKeys: null,
      }
    );
    expect(result.data.account).toMatchObject({
      gameUid: '20000001',
      serverId: '3',
      region: 'intl',
    });
    expect(result.data).toMatchObject({
      savedRecords: 0,
      reviewRequired: true,
      reviewTask: {
        id: 'task-1',
        accessKey: 'access-key',
      },
    });
    expect(operations).toEqual([]);
    expect(savedHistoryRows).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    const stagedPayload = officialImportStagingMocks.stageOfficialImportTask.mock.calls[0][0];
    expect(stagedPayload.account).toEqual({
      gameUid: '20000001',
      serverId: '3',
      region: 'intl',
    });
    expect(stagedPayload.stagedRecords[0]).toMatchObject({
      historyRecord: {
        game_uid: '20000001',
        nick_name: 'EU/NA账号',
        server_id: '3',
        region: 'intl',
      },
    });
  });

  it('falls back to legacy history schema when character_id is absent', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    let historyUpsertAttempts = 0;
    const rpc = vi.fn(async () => ({
      data: {
        refreshedPools: 1,
        refreshedTrendRows: 3,
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
      error: null,
    }));

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => ({ data: [], error: null }));
            },
            async upsert(rows) {
              historyUpsertAttempts += 1;
              operations.push({
                tableName,
                action: 'upsert',
                count: rows.length,
                hasCharacterId: Object.prototype.hasOwnProperty.call(rows[0] || {}, 'character_id'),
                hasServerId: Object.prototype.hasOwnProperty.call(rows[0] || {}, 'server_id'),
                hasRegion: Object.prototype.hasOwnProperty.call(rows[0] || {}, 'region'),
              });
              if (historyUpsertAttempts === 1) {
                return {
                  error: {
                    message: "Could not find the 'character_id' column of 'history' in the schema cache",
                  },
                };
              }
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'profiles') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: '00000000-0000-0000-0000-000000000001' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const {
      executeFullImport,
      initSupabaseAdmin,
      saveHistoryToServer,
    } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress: vi.fn(),
      authChainFunctions: {
        grantAppToken: vi.fn(async () => ({
          success: true,
          data: { token: 'app-token' },
        })),
        fetchBindingList: vi.fn(async () => ({
          success: true,
          data: {
            accounts: [{
              uid: 'hg-uid',
              gameUid: '10000001',
              nickName: '测试账号',
              serverId: '1',
            }],
          },
        })),
        fetchU8TokenByUid: vi.fn(async () => ({
          success: true,
          data: { token: 'u8-token' },
        })),
        fetchAllRecordsConcurrent: vi.fn(async () => ({
          success: true,
          data: {
            totalRecords: 1,
            partial: [],
            failed: [],
            results: [{
              type: 'char',
              poolType: 'E_CharacterGachaPoolType_Special',
              currentUpCharacter: '测试角色',
              records: [{
                poolId: 'special_1_2_1',
                poolName: '测试限定池',
                seqId: '1',
                charId: 'char_test',
                charName: '测试角色',
                rarity: 6,
                gachaTs: '1767225600000',
                isFree: false,
                isNew: true,
              }],
            }],
          },
        })),
      },
      source: 'cn',
      importMode: 'full',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      newRecords: 1,
      savedRecords: 0,
      reviewRequired: true,
    });

    const stagedRecord = officialImportStagingMocks.stageOfficialImportTask.mock.calls[0][0]
      .stagedRecords[0].historyRecord;
    const saved = await saveHistoryToServer(
      [stagedRecord],
      '00000000-0000-0000-0000-000000000001'
    );

    expect(saved.saved).toBe(1);
    expect(historyUpsertAttempts).toBe(2);
    expect(operations).toEqual([
      {
        tableName: 'history',
        action: 'upsert',
        count: 1,
        hasCharacterId: true,
        hasServerId: true,
        hasRegion: true,
      },
      {
        tableName: 'history',
        action: 'upsert',
        count: 1,
        hasCharacterId: false,
        hasServerId: true,
        hasRegion: true,
      },
    ]);
  });

  it('falls back to record id when history conflict constraints are missing', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    let historyUpsertAttempts = 0;
    const rpc = vi.fn(async () => ({
      data: {
        refreshedPools: 1,
        refreshedTrendRows: 3,
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
      error: null,
    }));
    const missingConflictTarget = {
      code: '42P10',
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    };

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => ({ data: [], error: null }));
            },
            async upsert(rows, options = {}) {
              historyUpsertAttempts += 1;
              operations.push({
                tableName,
                action: 'upsert',
                count: rows.length,
                onConflict: options.onConflict,
              });
              if (historyUpsertAttempts <= 2) {
                return { error: missingConflictTarget };
              }
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'profiles') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: '00000000-0000-0000-0000-000000000001' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const {
      executeFullImport,
      initSupabaseAdmin,
      saveHistoryToServer,
    } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress: vi.fn(),
      authChainFunctions: {
        grantAppToken: vi.fn(async () => ({
          success: true,
          data: { token: 'app-token' },
        })),
        fetchBindingList: vi.fn(async () => ({
          success: true,
          data: {
            accounts: [{
              uid: 'hg-uid',
              gameUid: '10000001',
              nickName: '测试账号',
              serverId: '1',
            }],
          },
        })),
        fetchU8TokenByUid: vi.fn(async () => ({
          success: true,
          data: { token: 'u8-token' },
        })),
        fetchAllRecordsConcurrent: vi.fn(async () => ({
          success: true,
          data: {
            totalRecords: 1,
            partial: [],
            failed: [],
            results: [{
              type: 'char',
              poolType: 'E_CharacterGachaPoolType_Special',
              currentUpCharacter: '测试角色',
              records: [{
                poolId: 'special_1_2_1',
                poolName: '测试限定池',
                seqId: '1',
                charId: 'char_test',
                charName: '测试角色',
                rarity: 6,
                gachaTs: '1767225600000',
                isFree: false,
                isNew: true,
              }],
            }],
          },
        })),
      },
      source: 'cn',
      importMode: 'full',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      newRecords: 1,
      savedRecords: 0,
      reviewRequired: true,
    });

    const stagedRecord = officialImportStagingMocks.stageOfficialImportTask.mock.calls[0][0]
      .stagedRecords[0].historyRecord;
    const saved = await saveHistoryToServer(
      [stagedRecord],
      '00000000-0000-0000-0000-000000000001'
    );

    expect(saved.saved).toBe(1);
    expect(historyUpsertAttempts).toBe(3);
    expect(operations.filter(operation => operation.tableName === 'history')).toEqual([
      {
        tableName: 'history',
        action: 'upsert',
        count: 1,
        onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id',
      },
      {
        tableName: 'history',
        action: 'upsert',
        count: 1,
        onConflict: 'user_id,game_uid,pool_id,seq_id',
      },
      {
        tableName: 'history',
        action: 'upsert',
        count: 1,
        onConflict: 'user_id,record_id',
      },
    ]);
  });

  it('passes existing official record keys to incremental fetch and reuses them for dedupe', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    let historySelectCalls = 0;
    const rpc = vi.fn(async () => ({
      data: {
        refreshedPools: 1,
        refreshedTrendRows: 3,
        updatedAt: '2026-06-05T12:00:00.000Z',
      },
      error: null,
    }));

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => {
                historySelectCalls++;
                return {
                  data: [{ pool_id: 'special_1_2_1', seq_id: '1', server_id: '1' }],
                  error: null,
                };
              });
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'profiles') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: '00000000-0000-0000-0000-000000000001' },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const { executeFullImport, initSupabaseAdmin } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const updateProgress = vi.fn();
    const earlyStopped = [{
      type: 'char',
      poolType: 'E_CharacterGachaPoolType_Special',
      records: 2,
      pages: 2,
      reason: 'all_existing_page_with_pity_context',
    }];
    const authChainFunctions = {
      grantAppToken: vi.fn(async () => ({
        success: true,
        data: { token: 'app-token' },
      })),
      fetchBindingList: vi.fn(async () => ({
        success: true,
        data: {
          accounts: [{
            uid: 'hg-uid',
            gameUid: '10000001',
            nickName: '测试账号',
            serverId: '1',
          }],
        },
      })),
      fetchU8TokenByUid: vi.fn(async () => ({
        success: true,
        data: { token: 'u8-token' },
      })),
      fetchAllRecordsConcurrent: vi.fn(async () => ({
        success: true,
        data: {
          totalRecords: 2,
          partial: [],
          failed: [],
          earlyStopped,
          fetchStrategy: 'incremental_official_fetch_with_context_guard',
          results: [{
            type: 'char',
            poolType: 'E_CharacterGachaPoolType_Special',
            currentUpCharacter: '测试角色',
            records: [{
              poolId: 'special_1_2_1',
              poolName: '测试限定池',
              seqId: '2',
              charId: 'char_test',
              charName: '测试角色',
              rarity: 5,
              gachaTs: '1767225600001',
              isFree: false,
              isNew: true,
            }, {
              poolId: 'special_1_2_1',
              poolName: '测试限定池',
              seqId: '1',
              charId: 'char_old',
              charName: '已保存角色',
              rarity: 6,
              gachaTs: '1767225600000',
              isFree: false,
              isNew: false,
            }],
          }],
        },
      })),
    };

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress,
      authChainFunctions,
      source: 'cn',
      importMode: 'incremental',
    });

    const fetchCall = authChainFunctions.fetchAllRecordsConcurrent.mock.calls[0];
    expect(fetchCall.slice(0, 4)).toEqual([
      'u8-token',
      '1',
      '10000001',
      '测试账号',
    ]);
    expect(fetchCall[4]).toMatchObject({
      importMode: 'incremental',
    });
    expect([...fetchCall[4].existingRecordKeys]).toEqual([
      '10000001:server:1:special_1_2_1:1',
    ]);
    expect(historySelectCalls).toBe(3);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      importMode: 'incremental',
      fetchStrategy: 'incremental_official_fetch_with_context_guard',
      totalRecords: 2,
      newRecords: 1,
      savedRecords: 0,
      duplicates: 1,
      earlyStoppedPools: earlyStopped,
      reviewRequired: true,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
    const stagedPayload = officialImportStagingMocks.stageOfficialImportTask.mock.calls[0][0];
    expect(stagedPayload.importSummary).toMatchObject({
      importMode: 'incremental',
      fetchStrategy: 'incremental_official_fetch_with_context_guard',
      newRecords: 1,
      duplicates: 1,
    });
    expect(stagedPayload.stagedRecords).toHaveLength(1);
    expect(stagedPayload.stagedRecords[0]).toMatchObject({
      historyRecord: {
        seq_id: '2',
        game_uid: '10000001',
        server_id: '1',
      },
    });
  });

  it('skips public analytics refresh when incremental import has no new records', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    const rpc = vi.fn();

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => ({
                data: [{ pool_id: 'special_1_2_1', seq_id: '1', server_id: '1' }],
                error: null,
              }));
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const { executeFullImport, initSupabaseAdmin } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress: vi.fn(),
      authChainFunctions: {
        grantAppToken: vi.fn(async () => ({
          success: true,
          data: { token: 'app-token' },
        })),
        fetchBindingList: vi.fn(async () => ({
          success: true,
          data: {
            accounts: [{
              uid: 'hg-uid',
              gameUid: '10000001',
              nickName: '测试账号',
              serverId: '1',
            }],
          },
        })),
        fetchU8TokenByUid: vi.fn(async () => ({
          success: true,
          data: { token: 'u8-token' },
        })),
        fetchAllRecordsConcurrent: vi.fn(async () => ({
          success: true,
          data: {
            totalRecords: 1,
            partial: [],
            failed: [],
            fetchStrategy: 'incremental_official_fetch_with_context_guard',
            results: [{
              type: 'char',
              poolType: 'E_CharacterGachaPoolType_Special',
              currentUpCharacter: '测试角色',
              records: [{
                poolId: 'special_1_2_1',
                poolName: '测试限定池',
                seqId: '1',
                charId: 'char_test',
                charName: '测试角色',
                rarity: 6,
                gachaTs: '1767225600000',
                isFree: false,
                isNew: true,
              }],
            }],
          },
        })),
      },
      source: 'cn',
      importMode: 'incremental',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      totalRecords: 1,
      newRecords: 0,
      savedRecords: 0,
      duplicates: 1,
      reviewRequired: false,
      warnings: [],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
    expect(officialImportStagingMocks.stageOfficialImportTask).not.toHaveBeenCalled();
  });

  it('keeps import successful when public analytics refresh fails after saving records', async () => {
    const operations = [];
    const insertedPoolIds = new Set();
    const rpc = vi.fn(async (functionName, args = {}) => {
      if (functionName === 'commit_official_import_records') {
        operations.push({
          tableName: 'official_import_records',
          action: 'rpc',
          poolCount: (args.p_pools || []).length,
          historyCount: (args.p_history || []).length,
        });
        return {
          data: {
            savedRecords: (args.p_history || []).length,
            skippedRecords: 0,
            createdPools: (args.p_pools || []).length,
            atomicCommit: true,
          },
          error: null,
        };
      }
      return {
        data: null,
        error: { message: 'refresh timeout' },
      };
    });

    mockSupabaseClient = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
            error: null,
          })),
        },
      },
      rpc,
      __operations: operations,
      from(tableName) {
        if (tableName === 'pool_id_aliases' || tableName === 'character_id_aliases') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'pools') {
          return {
            select() {
              return {
                in: async (_column, values) => ({
                  data: (values || [])
                    .filter((poolId) => insertedPoolIds.has(String(poolId)))
                    .map((poolId) => ({ pool_id: String(poolId) })),
                  error: null,
                }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              (rows || []).forEach((row) => insertedPoolIds.add(String(row.pool_id)));
              return { error: null };
            },
          };
        }

        if (tableName === 'history') {
          return {
            select() {
              return createHistoryRangeQuery(async () => ({ data: [], error: null }));
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        if (tableName === 'characters') {
          return {
            select() {
              return {
                limit: async () => ({ data: [], error: null }),
              };
            },
            async upsert(rows) {
              operations.push({ tableName, action: 'upsert', count: rows.length });
              return { error: null };
            },
          };
        }

        throw new Error(`Unexpected table access: ${tableName}`);
      },
    };

    const { executeFullImport, initSupabaseAdmin } = await import('../../backend/fullImportService.js');

    initSupabaseAdmin('https://example.supabase.co', 'service-role-key');

    const result = await executeFullImport({
      token: 'AbCdEfGhIjKlMnOpQrStUvWx',
      accountIndex: 0,
      userId: '00000000-0000-0000-0000-000000000001',
      updateProgress: vi.fn(),
      authChainFunctions: {
        grantAppToken: vi.fn(async () => ({
          success: true,
          data: { token: 'app-token' },
        })),
        fetchBindingList: vi.fn(async () => ({
          success: true,
          data: {
            accounts: [{
              uid: 'hg-uid',
              gameUid: '10000001',
              nickName: '测试账号',
              serverId: '1',
            }],
          },
        })),
        fetchU8TokenByUid: vi.fn(async () => ({
          success: true,
          data: { token: 'u8-token' },
        })),
        fetchAllRecordsConcurrent: vi.fn(async () => ({
          success: true,
          data: {
            totalRecords: 1,
            partial: [],
            failed: [],
            results: [{
              type: 'char',
              poolType: 'E_CharacterGachaPoolType_Special',
              currentUpCharacter: '测试角色',
              records: [{
                poolId: 'special_1_2_1',
                poolName: '测试限定池',
                seqId: '1',
                charId: 'char_test',
                charName: '测试角色',
                rarity: 6,
                gachaTs: '1767225600000',
                isFree: false,
                isNew: true,
              }],
            }],
          },
        })),
      },
      source: 'cn',
      importMode: 'full',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      newRecords: 1,
      savedRecords: 0,
      reviewRequired: true,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(operations).toEqual([]);

    mockConfirmationCommitFromLatestStaging();
    const { confirmFullImportReview } = await import('../../backend/fullImportService.js');
    const confirmed = await confirmFullImportReview({
      taskId: 'task-1',
      accessKey: 'access-key',
      userId: '00000000-0000-0000-0000-000000000001',
    });

    expect(confirmed.result).toMatchObject({
      savedRecords: 1,
      atomicCommit: true,
      publicAnalyticsRefresh: {
        ok: false,
        error: 'refresh timeout',
      },
    });
    expect(rpc).toHaveBeenCalledWith('refresh_public_analytics_cache');
    expect(operations).toEqual(expect.arrayContaining([
      { tableName: 'official_import_records', action: 'rpc', poolCount: 1, historyCount: 1 },
      { tableName: 'characters', action: 'upsert', count: 1 },
      { tableName: 'character_id_aliases', action: 'upsert', count: 2 },
      { tableName: 'pools', action: 'upsert', count: 1 },
      { tableName: 'pool_id_aliases', action: 'upsert', count: 2 },
    ]));
  });
});

describe('official import incremental guards', () => {
  it('only stops after a fully existing page with enough pity context', async () => {
    const {
      analyzeIncrementalPage,
      hasSufficientIncrementalPityContext,
    } = await import('../../backend/lib/officialImportIncremental.js');

    const existingRecordKeys = new Set([
      '10000001:server:1:special_1_2_1:10',
      '10000001:server:1:special_1_2_1:9',
    ]);
    const existingSixStarPage = [{
      poolId: 'special_1_2_1',
      seqId: '10',
      rarity: 6,
      isFree: false,
    }, {
      poolId: 'special_1_2_1',
      seqId: '9',
      rarity: 5,
      isFree: false,
    }];

    expect(analyzeIncrementalPage({
      records: existingSixStarPage,
      gameUid: '10000001',
      serverId: '1',
      existingRecordKeys,
      getPoolId: (record) => record.poolId,
    })).toMatchObject({
      checked: 2,
      existing: 2,
      missingKey: 0,
      allExisting: true,
    });
    expect(analyzeIncrementalPage({
      records: existingSixStarPage,
      gameUid: '10000001',
      serverId: '2',
      existingRecordKeys,
      getPoolId: (record) => record.poolId,
    })).toMatchObject({
      checked: 2,
      existing: 0,
      missingKey: 0,
      allExisting: false,
    });
    expect(hasSufficientIncrementalPityContext(existingSixStarPage)).toBe(true);
  });

  it('does not stop when a page has missing keys or insufficient paid context', async () => {
    const {
      analyzeIncrementalPage,
      createIncrementalImportStopGuard,
      hasSufficientIncrementalPityContext,
    } = await import('../../backend/lib/officialImportIncremental.js');

    const shortExistingPage = Array.from({ length: 20 }, (_, index) => ({
      poolId: 'special_1_2_1',
      seqId: String(80 - index),
      rarity: 5,
      isFree: false,
    }));
    const existingRecordKeys = new Set(
      shortExistingPage.map((record) => `10000001:${record.poolId}:${record.seqId}`)
    );

    expect(analyzeIncrementalPage({
      records: [{ poolId: 'special_1_2_1', rarity: 5 }],
      gameUid: '10000001',
      existingRecordKeys,
      getPoolId: (record) => record.poolId,
    })).toMatchObject({
      checked: 0,
      existing: 0,
      missingKey: 1,
      allExisting: false,
    });
    expect(analyzeIncrementalPage({
      records: shortExistingPage,
      gameUid: '10000001',
      existingRecordKeys,
      getPoolId: (record) => record.poolId,
    }).allExisting).toBe(true);
    expect(hasSufficientIncrementalPityContext(shortExistingPage)).toBe(false);
    expect(hasSufficientIncrementalPityContext(
      Array.from({ length: 80 }, (_, index) => ({
        seqId: String(index + 1),
        rarity: 5,
        isFree: false,
      }))
    )).toBe(true);

    const stopGuard = createIncrementalImportStopGuard({
      gameUid: '10000001',
      existingRecordKeys,
      getPoolId: (record) => record.poolId,
    });

    const firstCheck = stopGuard.inspectPage(shortExistingPage.slice(0, 10));
    expect(firstCheck.shouldStop).toBe(false);
    expect(firstCheck.meta).toMatchObject({
      pagesChecked: 1,
      contextRecords: 10,
      stopped: false,
    });

    const secondCheck = stopGuard.inspectPage([{ poolId: 'special_1_2_1', rarity: 5 }]);
    expect(secondCheck.shouldStop).toBe(false);
    expect(secondCheck.meta).toMatchObject({
      pagesChecked: 2,
      contextRecords: 0,
      missingKey: 1,
      stopped: false,
    });
  });

  it('accumulates only consecutive existing pages before early stop', async () => {
    const {
      createIncrementalImportStopGuard,
    } = await import('../../backend/lib/officialImportIncremental.js');

    const pageA = Array.from({ length: 40 }, (_, index) => ({
      poolId: 'special_1_2_1',
      seqId: String(100 - index),
      rarity: 5,
      isFree: false,
    }));
    const pageB = Array.from({ length: 40 }, (_, index) => ({
      poolId: 'special_1_2_1',
      seqId: String(60 - index),
      rarity: 5,
      isFree: false,
    }));
    const existingRecordKeys = new Set(
      [...pageA, ...pageB].map((record) => `10000001:${record.poolId}:${record.seqId}`)
    );
    const stopGuard = createIncrementalImportStopGuard({
      gameUid: '10000001',
      existingRecordKeys,
      getPoolId: (record) => record.poolId,
    });

    expect(stopGuard.inspectPage(pageA)).toMatchObject({
      shouldStop: false,
      meta: {
        pagesChecked: 1,
        contextRecords: 40,
        stopped: false,
      },
    });
    expect(stopGuard.inspectPage(pageB)).toMatchObject({
      shouldStop: true,
      reason: 'all_existing_page_with_pity_context',
      meta: {
        pagesChecked: 2,
        contextRecords: 80,
        stopped: true,
        stopReason: 'all_existing_page_with_pity_context',
      },
    });
  });
});
