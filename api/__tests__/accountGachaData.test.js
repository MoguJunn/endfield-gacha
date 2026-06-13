// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

import accountGachaDataHandler from '../_routes/root/account-gacha-data.js';

function createJsonResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
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
      this.ended = true;
      return this;
    },
  };
}

function createRequest({
  method = 'GET',
  url = '/api/account-gacha-data',
  headers = { cookie: '__Host-eg_session=redacted' },
  body,
} = {}) {
  return {
    method,
    url,
    headers,
    body,
  };
}

function createQuery(table, state) {
  const query = {
    table,
    selection: '',
    filters: [],
    operation: 'select',
    updatePayload: null,
    select: vi.fn((selection = '*') => {
      query.selection = selection;
      return query;
    }),
    delete: vi.fn(() => {
      query.operation = 'delete';
      state.deleteCalls.push({
        table,
        filters: query.filters,
      });
      return query;
    }),
    update: vi.fn((payload) => {
      query.operation = 'update';
      query.updatePayload = payload;
      return query;
    }),
    eq: vi.fn((column, value) => {
      query.filters.push({ op: 'eq', column, value });
      return query;
    }),
    not: vi.fn((column, op, value) => {
      query.filters.push({ op: 'not', column, value });
      return query;
    }),
    order: vi.fn(() => query),
    range: vi.fn(async () => {
      if (table === 'history' && query.selection.includes('timestamp')) {
        return { data: state.dedupeRows, error: null };
      }
      if (table === 'history' && query.selection.includes('seq_id')) {
        return { data: state.seqKeyRows, error: null };
      }
      if (table === 'history') {
        return { data: state.historyRows, error: null };
      }
      return { data: [], error: null };
    }),
    in: vi.fn(async (column, values) => {
      query.filters.push({ op: 'in', column, values });
      if (query.operation === 'delete') {
        return { data: null, error: null };
      }
      if (query.operation === 'update') {
        state.updateCalls.push({
          table,
          payload: query.updatePayload,
          filters: query.filters,
        });
        return { data: null, error: null };
      }
      if (table === 'pool_id_aliases') {
        return { data: state.poolAliasRows, error: null };
      }
      if (table === 'character_id_aliases') {
        return { data: state.characterAliasRows, error: null };
      }
      return { data: [], error: null };
    }),
    then(resolve, reject) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return query;
}

function createAdminClient() {
  const state = {
    historyRows: [
      {
        record_id: 'record-1',
        rarity: 6,
        is_standard: false,
        special_type: null,
        timestamp: '2026-06-05T12:00:00.000Z',
        pool_id: 'official_pool_alias',
        user_id: 'user-1',
        character_name: '弭弗',
        item_name: null,
        character_id: 'char_alias',
        batch_id: 'batch-1',
        seq_id: '1',
        pity: 120,
        is_new: true,
        is_free: false,
        game_uid: 'game-1',
        nick_name: '博士',
      },
    ],
    seqKeyRows: [
      {
        seq_id: '1',
        game_uid: 'game-1',
        pool_id: 'special_official_001',
      },
    ],
    dedupeRows: [],
    poolAliasRows: [
      {
        id: 1,
        source: 'official_api',
        alias_id: 'official_pool_alias',
        pool_id: 'special_official_001',
        is_primary: true,
      },
    ],
    characterAliasRows: [
      {
        id: 2,
        source: 'official_api',
        alias_id: 'char_alias',
        character_id: 'char_official_001',
        is_primary: true,
      },
    ],
    upsertCalls: [],
    deleteCalls: [],
    updateCalls: [],
  };

  const client = {
    from: vi.fn((table) => ({
      select: (...args) => createQuery(table, state).select(...args),
      delete: () => createQuery(table, state).delete(),
      update: (...args) => createQuery(table, state).update(...args),
      upsert: vi.fn(async (rows, options) => {
        state.upsertCalls.push({
          table,
          rows,
          options,
        });
        return { data: rows, error: null };
      }),
    })),
    __state: state,
  };

  return client;
}

describe('/api/account-gacha-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAdminClient.mockReturnValue(createAdminClient());
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: {
        id: 'user-1',
      },
    });
  });

  it('loads current user history through the site-session auth path', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(mocks.resolveAuthenticatedRequestUser).toHaveBeenCalledWith(req, {
      adminClient,
      touch: true,
    });
    expect(res.body).toMatchObject({
      success: true,
      source: 'site_session',
      meta: {
        count: 1,
        truncated: false,
      },
      warnings: [],
    });
    expect(res.body.history).toEqual([
      expect.objectContaining({
        id: 'record-1',
        user_id: 'user-1',
        poolId: 'special_official_001',
        character_id: 'char_official_001',
        pity: 80,
        gameUid: 'game-1',
      }),
    ]);
  });

  it('loads current user history with the caller client when admin secrets are absent', async () => {
    const callerClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(null);
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      source: 'supabase',
      user: {
        id: 'user-1',
      },
      callerClient,
    });
    const req = createRequest({
      headers: { authorization: 'Bearer native-token' },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.resolveAuthenticatedRequestUser).toHaveBeenCalledWith(req, {
      adminClient: null,
      touch: false,
    });
    expect(callerClient.from).toHaveBeenCalledWith('history');
    expect(res.body).toMatchObject({
      success: true,
      source: 'supabase',
      meta: {
        count: 1,
        truncated: false,
      },
    });
  });

  it('returns current user seq keys for import dedupe', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      url: '/api/account-gacha-data?mode=seq-keys&gameUid=game-1',
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      keys: [
        {
          seqId: '1',
          gameUid: 'game-1',
          poolId: 'special_official_001',
        },
      ],
      meta: {
        count: 1,
        truncated: false,
      },
    });
  });

  it('saves pools and history for the authenticated user, ignoring payload user ids', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        pools: [
          {
            id: 'official_pool_alias',
            user_id: 'attacker-user',
            name: '测试卡池',
            type: 'limited',
          },
        ],
        history: [
          {
            id: '1001',
            user_id: 'attacker-user',
            poolId: 'official_pool_alias',
            character_id: 'char_alias',
            name: '弭弗',
            rarity: 6,
            seqId: '1',
            gameUid: 'game-1',
            serverId: '2',
            region: 'international',
            timestamp: '2026-06-05T12:00:00.000Z',
          },
        ],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      saved: {
        pools: 1,
        history: 1,
      },
    });

    const poolUpsert = adminClient.__state.upsertCalls.find(call => call.table === 'pools');
    const historyUpsert = adminClient.__state.upsertCalls.find(call => call.table === 'history');
    expect(poolUpsert).toMatchObject({
      options: { onConflict: 'pool_id' },
    });
    expect(poolUpsert.rows[0]).toMatchObject({
      user_id: 'user-1',
      pool_id: 'special_official_001',
    });
    expect(historyUpsert).toMatchObject({
      options: { onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id' },
    });
    expect(historyUpsert.rows[0]).toMatchObject({
      user_id: 'user-1',
      pool_id: 'special_official_001',
      character_id: 'char_official_001',
      server_id: '2',
      region: 'intl',
    });
  });

  it('skips cross-source duplicate history before saving', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.dedupeRows = [
      {
        seq_id: '42',
        game_uid: 'game-1',
        pool_id: 'special_official_001',
        timestamp: '2026-06-05T12:00:00.000Z',
        character_name: '弭弗',
        item_name: '弭弗',
        character_id: 'char_official_001',
        rarity: 6,
        is_free: false,
      },
    ];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        history: [
          {
            id: '2001',
            poolId: 'legacy_kwer_pool',
            name: '弭弗',
            rarity: 6,
            seqId: '42',
            gameUid: 'game-1',
            timestamp: '2026-06-05T12:00:00.000Z',
          },
        ],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      saved: {
        pools: 0,
        history: 0,
      },
      skipped: {
        pools: 0,
        history: 1,
      },
    });
    expect(adminClient.__state.upsertCalls.some(call => call.table === 'history')).toBe(false);
  });

  it('skips legacy JSON duplicates even when existing rows have no game uid', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.dedupeRows = [
      {
        seq_id: '42',
        game_uid: null,
        pool_id: 'legacy_kwer_pool',
        timestamp: '2026-06-05T12:00:00.000Z',
        character_name: '弭弗',
        item_name: '弭弗',
        character_id: null,
        rarity: 6,
        is_free: false,
      },
    ];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        history: [
          {
            id: '2002',
            poolId: 'official_pool_alias',
            character_id: 'char_alias',
            name: '弭弗',
            rarity: 6,
            seqId: '42',
            gameUid: 'game-1',
            timestamp: '2026-06-05T12:00:00.000Z',
          },
        ],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      saved: {
        pools: 0,
        history: 0,
      },
      skipped: {
        pools: 0,
        history: 1,
      },
    });
    expect(adminClient.__state.upsertCalls.some(call => call.table === 'history')).toBe(false);
  });

  it('keeps same-batch duplicate items when their seq ids differ', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        history: [
          {
            id: '3001',
            poolId: 'official_pool_alias',
            character_id: 'char_alias',
            name: '弭弗',
            rarity: 5,
            seqId: '4201',
            gameUid: 'game-1',
            timestamp: '2026-06-05T12:00:00.000Z',
          },
          {
            id: '3002',
            poolId: 'official_pool_alias',
            character_id: 'char_alias',
            name: '弭弗',
            rarity: 5,
            seqId: '4202',
            gameUid: 'game-1',
            timestamp: '2026-06-05T12:00:00.000Z',
          },
        ],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      saved: {
        pools: 0,
        history: 2,
      },
      skipped: {
        pools: 0,
        history: 0,
      },
    });
    const historyUpsert = adminClient.__state.upsertCalls.find(call => call.table === 'history');
    expect(historyUpsert.rows).toHaveLength(2);
    expect(historyUpsert.rows.map(row => row.seq_id)).toEqual(['4201', '4202']);
  });

  it('resolves pool and character aliases through the authenticated endpoint', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'resolveAliases',
        poolIds: ['official_pool_alias'],
        characterIds: ['char_alias'],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      poolAliases: {
        official_pool_alias: 'special_official_001',
      },
      characterAliases: {
        char_alias: 'char_official_001',
      },
    });
  });

  it('updates current user history server labels for a selected account', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.historyRows = [
      {
        record_id: 'record-1',
        user_id: 'user-1',
        game_uid: 'game-1',
        server_id: '1',
        region: 'cn',
      },
      {
        record_id: 'record-2',
        user_id: 'user-1',
        game_uid: 'other-game',
        server_id: '1',
        region: 'cn',
      },
    ];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'updateServerLabel',
        gameUid: 'game-1',
        accountKey: 'game-1::server:1',
        currentServerId: '1',
        currentRegion: 'cn',
        serverId: '2',
        region: 'intl',
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      updated: 1,
      serverId: '2',
      region: 'intl',
    });
    expect(adminClient.__state.updateCalls).toHaveLength(1);
    expect(adminClient.__state.updateCalls[0]).toMatchObject({
      table: 'history',
      payload: {
        server_id: '2',
        region: 'intl',
      },
      filters: [
        { op: 'eq', column: 'user_id', value: 'user-1' },
        { op: 'in', column: 'record_id', values: ['record-1'] },
      ],
    });
  });

  it('deletes only authenticated user records by record id', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'DELETE',
      body: {
        action: 'records',
        recordIds: ['1', '2', '2', 'bad'],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      deleted: {
        history: 2,
        pools: 0,
      },
    });
    expect(adminClient.__state.deleteCalls[0]).toMatchObject({
      table: 'history',
    });
    expect(adminClient.__state.deleteCalls[0].filters).toEqual([
      { op: 'eq', column: 'user_id', value: 'user-1' },
      { op: 'in', column: 'record_id', values: [1, 2] },
    ]);
  });

  it('rejects unauthenticated requests without returning private rows', async () => {
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Missing access token',
      code: 'missing_access_token',
    });

    const req = createRequest({ headers: {} });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Missing access token',
      code: 'missing_access_token',
    });
  });
});
