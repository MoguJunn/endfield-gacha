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

import accountGachaDataHandler, { __internal } from '../_routes/root/account-gacha-data.js';

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
    selectOptions: null,
    selectedLimit: null,
    select: vi.fn((selection = '*', options = null) => {
      query.selection = selection;
      query.selectOptions = options;
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
    is: vi.fn((column, value) => {
      query.filters.push({ op: 'is', column, value });
      return query;
    }),
    lt: vi.fn((column, value) => {
      query.filters.push({ op: 'lt', column, value });
      return query;
    }),
    or: vi.fn((value) => {
      query.filters.push({ op: 'or', value });
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      state.selectCalls.push({
        table,
        selection: query.selection,
        selectOptions: query.selectOptions,
        filters: [...query.filters],
      });
      if (table === 'personal_analysis_scope_state') {
        return {
          data: state.scopeState,
          error: state.scopeStateError,
        };
      }
      if (table === 'personal_analysis_owner_state') {
        return {
          data: state.ownerState,
          error: state.ownerStateError,
        };
      }
      if (table === 'personal_analysis_snapshots') {
        const scopeKind = query.filters.find((filter) => filter.column === 'scope_kind')?.value;
        const scopeKey = query.filters.find((filter) => filter.column === 'scope_key')?.value;
        if (scopeKind === 'owner' && scopeKey === 'owner') {
          return {
            data: state.ownerSnapshot,
            error: state.snapshotError,
          };
        }
        return {
          data: state.accountSnapshots[scopeKey] || null,
          error: state.snapshotError,
        };
      }
      return { data: null, error: null };
    }),
    limit: vi.fn((value) => {
      query.selectedLimit = value;
      return query;
    }),
    order: vi.fn(() => query),
    range: vi.fn(async (from, to) => {
      state.selectCalls.push({
        table,
        selection: query.selection,
        selectOptions: query.selectOptions,
        filters: [...query.filters],
        from,
        to,
      });
      const count = query.selectOptions?.count === 'exact' ? state.historyRows.length : null;
      if (table === 'history' && query.selection.includes('record_id')) {
        return { data: state.historyRows, count, error: null };
      }
      if (table === 'history' && query.selection.includes('timestamp')) {
        return { data: state.dedupeRows, count, error: null };
      }
      if (table === 'history' && query.selection.includes('seq_id')) {
        return { data: state.seqKeyRows, count, error: null };
      }
      if (table === 'history') {
        return { data: state.historyRows, count, error: null };
      }
      return { data: [], count: null, error: null };
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
      if (table === 'pools') {
        return { data: state.poolRows, error: null };
      }
      return { data: [], error: null };
    }),
    then(resolve, reject) {
      const isHeadCount = table === 'history' && query.selectOptions?.head === true;
      const isBoundedHistoryRead = table === 'history' && query.selectedLimit !== null;
      return Promise.resolve({
        data: isHeadCount
          ? null
          : isBoundedHistoryRead
            ? state.historyRows.slice(0, query.selectedLimit)
            : [],
        count: isHeadCount ? state.historyRows.length : null,
        error: null,
      }).then(resolve, reject);
    },
  };
  return query;
}

function createAdminClient() {
  const state = {
    historyRows: [
      {
        id: 2,
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
    rpcCalls: [],
    selectCalls: [],
    scopeState: {
      history_revision: 7,
      snapshot_revision: 6,
      analysis_schema_version: 1,
      computed_at: '2026-08-04T12:00:00.000Z',
    },
    scopeStateError: null,
    ownerState: {
      history_revision: 7,
      snapshot_revision: 7,
      analysis_schema_version: 1,
      computed_at: '2026-08-04T12:00:00.000Z',
      last_error: null,
    },
    ownerStateError: null,
    ownerSnapshot: {
      scope_kind: 'owner',
      scope_key: 'owner',
      source_game_uid: null,
      source_server_scope: null,
      input_revision: 7,
      analysis_schema_version: 1,
      computed_at: '2026-08-04T12:00:00.000Z',
      payload: {
        defaultAccountKey: 'game-1::server:2',
        accounts: [{ accountKey: 'game-1::server:2' }],
        summary: { total: 1 },
      },
    },
    accountSnapshots: {
      'game-1::server:2': {
        scope_kind: 'account',
        scope_key: 'game-1::server:2',
        source_game_uid: 'game-1',
        source_server_scope: '2',
        input_revision: 7,
        analysis_schema_version: 1,
        computed_at: '2026-08-04T12:01:00.000Z',
        payload: {
          account: { accountKey: 'game-1::server:2' },
          selector: { totalPulls: 1 },
          dashboard: { views: {} },
        },
      },
    },
    snapshotError: null,
    poolRows: [],
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
    rpc: vi.fn(async (functionName, params = {}) => {
      state.rpcCalls.push({ functionName, params });
      if (functionName === 'delete_history_records_controlled') {
        return {
          data: {
            deleted: Array.isArray(params.p_record_ids) ? params.p_record_ids.length : 0,
          },
          error: null,
        };
      }
      return {
        data: null,
        error: new Error(`Unexpected RPC: ${functionName}`),
      };
    }),
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

  it('only enables transient analysis without admin or through an explicit local flag', () => {
    expect(__internal.shouldUseTransientPersonalAnalysis(null, {})).toBe(true);
    expect(__internal.shouldUseTransientPersonalAnalysis({}, {
      PERSONAL_ANALYSIS_TRANSIENT_FALLBACK: 'true',
    })).toBe(true);
    expect(__internal.shouldUseTransientPersonalAnalysis({}, {
      PERSONAL_ANALYSIS_TRANSIENT_FALLBACK: 'false',
    })).toBe(false);
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
      touch: false,
    });
    expect(res.body).toMatchObject({
      success: true,
      source: 'site_session',
      meta: {
        ownerId: 'user-1',
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

  it('returns a ready private analysis snapshot without reading raw history', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      url: '/api/account-gacha-data?mode=analysis&accountKey=game-1%3A%3Aserver%3A2',
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      mode: 'analysis',
      schemaVersion: 1,
      availability: 'ready',
      source: 'site_session',
      meta: {
        ownerId: 'user-1',
        rawIncluded: false,
        verifiedEmpty: false,
        revision: '7',
        accountKey: 'game-1::server:2',
        scopeRevision: '7',
      },
      owner: {
        summary: { total: 1 },
      },
      scope: {
        account: { accountKey: 'game-1::server:2' },
        selector: { totalPulls: 1 },
      },
      warnings: [],
    });
    expect(adminClient.__state.selectCalls.some((call) => call.table === 'history')).toBe(false);
  });

  it('returns building instead of falling back to a full history read when no snapshot exists', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.ownerSnapshot = null;
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=analysis',
    }), res);

    expect(res.statusCode).toBe(202);
    expect(res.headers['Retry-After']).toBe('10');
    expect(res.body).toMatchObject({
      success: true,
      mode: 'analysis',
      availability: 'building',
      meta: {
        ownerId: 'user-1',
        rawIncluded: false,
        verifiedEmpty: false,
      },
      owner: null,
      scope: null,
      warnings: [{ code: 'personal_analysis_build_pending' }],
    });
    const historyReads = adminClient.__state.selectCalls.filter((call) => call.table === 'history');
    expect(historyReads).toHaveLength(0);
    expect(adminClient.from).toHaveBeenCalledWith('history');
  });

  it('only reports verified empty after a bounded history existence check', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.ownerState = null;
    adminClient.__state.ownerSnapshot = null;
    adminClient.__state.historyRows = [];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=analysis',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      availability: 'empty',
      meta: {
        ownerId: 'user-1',
        rawIncluded: false,
        verifiedEmpty: true,
        revision: '0',
      },
      owner: null,
      scope: null,
    });
  });

  it('serves the last analysis as stale when its owner revision is behind', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.ownerState.history_revision = 8;
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=analysis',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      availability: 'stale',
      meta: {
        revision: '8',
        ownerSnapshotRevision: '7',
      },
      warnings: [{ code: 'personal_analysis_owner_stale' }],
    });
  });

  it('rejects an account key that is not present in the owner snapshot', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=analysis&accountKey=other-account',
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'personal_analysis_account_not_found',
    });
  });

  it('treats a fresh owner snapshot with no accounts as verified empty', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.ownerState.history_revision = 8;
    adminClient.__state.ownerState.snapshot_revision = 8;
    adminClient.__state.ownerSnapshot.input_revision = 8;
    adminClient.__state.ownerSnapshot.payload = {
      accounts: [],
      defaultAccountKey: null,
      summary: { total: 0 },
    };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=analysis',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      availability: 'empty',
      meta: {
        verifiedEmpty: true,
        revision: '8',
      },
      owner: {
        accounts: [],
        summary: { total: 0 },
      },
      scope: null,
      warnings: [],
    });
  });

  it('returns an owner-scoped bounded history page without changing the legacy GET contract', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.historyRows.push({
      ...adminClient.__state.historyRows[0],
      id: 1,
      record_id: 'record-0',
      timestamp: '2026-06-04T12:00:00.000Z',
      seq_id: '0',
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      url: '/api/account-gacha-data?mode=history&gameUid=game-1&serverScope=2&poolId=official_pool_alias&limit=1',
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      mode: 'history',
      source: 'site_session',
      meta: {
        ownerId: 'user-1',
        rawIncluded: true,
        count: 1,
        revision: '7',
        revisionAvailable: true,
        snapshotRevision: '6',
      },
      scope: {
        accountKey: 'game-1::server:2',
        gameUid: 'game-1',
        serverScope: '2',
        poolId: 'official_pool_alias',
      },
      page: {
        limit: 1,
        hasMore: true,
        total: 2,
        revision: '7',
      },
      warnings: [],
    });
    expect(res.body.records).toEqual([
      expect.objectContaining({
        id: 'record-1',
        poolId: 'special_official_001',
        character_id: 'char_official_001',
      }),
    ]);
    expect(typeof res.body.page.nextCursor).toBe('string');

    const historyRead = adminClient.__state.selectCalls.find((call) => (
      call.table === 'history' && call.selectOptions?.count === 'exact'
    ));
    expect(historyRead).toMatchObject({
      from: 0,
      to: 1,
      filters: expect.arrayContaining([
        { op: 'eq', column: 'user_id', value: 'user-1' },
        { op: 'eq', column: 'game_uid', value: 'game-1' },
        { op: 'eq', column: 'server_scope', value: '2' },
        { op: 'eq', column: 'pool_id', value: 'official_pool_alias' },
      ]),
    });
  });

  it('binds a history cursor to its account scope and rejects missing scope', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.historyRows.push({
      ...adminClient.__state.historyRows[0],
      id: 1,
      record_id: 'record-0',
      timestamp: '2026-06-04T12:00:00.000Z',
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const firstRes = createJsonResponseRecorder();
    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=history&gameUid=game-1&serverScope=2&limit=1',
    }), firstRes);

    const cursor = encodeURIComponent(firstRes.body.page.nextCursor);
    const nextRes = createJsonResponseRecorder();
    await accountGachaDataHandler(createRequest({
      url: `/api/account-gacha-data?mode=history&gameUid=game-1&serverScope=2&limit=1&cursor=${cursor}`,
    }), nextRes);
    expect(nextRes.statusCode).toBe(200);
    expect(nextRes.body.page.total).toBeNull();
    const latestHistoryRead = adminClient.__state.selectCalls
      .filter((call) => call.table === 'history')
      .at(-1);
    expect(latestHistoryRead.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'or' }),
    ]));
    expect(latestHistoryRead.filters.find((filter) => filter.op === 'or')?.value)
      .toContain('id.lt.2');

    adminClient.__state.scopeState.history_revision = 8;
    const changedRevisionRes = createJsonResponseRecorder();
    await accountGachaDataHandler(createRequest({
      url: `/api/account-gacha-data?mode=history&gameUid=game-1&serverScope=2&cursor=${cursor}`,
    }), changedRevisionRes);
    expect(changedRevisionRes.statusCode).toBe(409);
    expect(changedRevisionRes.body).toMatchObject({
      success: false,
      code: 'history_revision_changed',
    });

    const wrongScopeRes = createJsonResponseRecorder();
    await accountGachaDataHandler(createRequest({
      url: `/api/account-gacha-data?mode=history&gameUid=game-1&serverScope=3&cursor=${cursor}`,
    }), wrongScopeRes);
    expect(wrongScopeRes.statusCode).toBe(400);
    expect(wrongScopeRes.body).toMatchObject({
      success: false,
      code: 'invalid_history_cursor',
    });

    const missingScopeRes = createJsonResponseRecorder();
    await accountGachaDataHandler(createRequest({
      url: '/api/account-gacha-data?mode=history&gameUid=game-1',
    }), missingScopeRes);
    expect(missingScopeRes.statusCode).toBe(400);
    expect(missingScopeRes.body).toMatchObject({
      success: false,
      code: 'history_scope_required',
    });
  });

  it('loads known history pages concurrently with an explicit column list', async () => {
    const totalRows = 1500;
    const pageSelections = [];
    let activePageRequests = 0;
    let maxActivePageRequests = 0;

    const client = {
      from: vi.fn(() => {
        const query = {
          selection: '',
          selectOptions: null,
          select(selection, options = null) {
            query.selection = selection;
            query.selectOptions = options;
            return query;
          },
          eq() {
            return query;
          },
          order() {
            return query;
          },
          range(from, to) {
            pageSelections.push(query.selection);
            activePageRequests += 1;
            maxActivePageRequests = Math.max(maxActivePageRequests, activePageRequests);

            return new Promise((resolve) => {
              setTimeout(() => {
                const rowCount = Math.max(0, Math.min(totalRows - from, to - from + 1));
                activePageRequests -= 1;
                resolve({
                  data: Array.from({ length: rowCount }, (_, index) => ({
                    record_id: String(from + index + 1),
                  })),
                  error: null,
                });
              }, 5);
            });
          },
          then(resolve, reject) {
            return Promise.resolve({
              data: null,
              count: query.selectOptions?.head ? totalRows : null,
              error: null,
            }).then(resolve, reject);
          },
        };
        return query;
      }),
    };

    const result = await __internal.loadAllHistoryForUser(client, 'user-1');

    expect(result).toMatchObject({
      truncated: false,
    });
    expect(result.rows).toHaveLength(totalRows);
    expect(maxActivePageRequests).toBe(2);
    expect(pageSelections).toHaveLength(2);
    expect(pageSelections.every((selection) => selection !== '*')).toBe(true);
    expect(pageSelections.every((selection) => selection.includes('edit_version'))).toBe(true);
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
        ownerId: 'user-1',
        count: 1,
        truncated: false,
      },
    });
  });

  it('builds a transient lightweight analysis with the caller client when admin secrets are absent', async () => {
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
      url: '/api/account-gacha-data?mode=analysis',
      headers: { authorization: 'Bearer native-token' },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      mode: 'analysis',
      availability: 'ready',
      source: 'supabase',
      meta: {
        ownerId: 'user-1',
        rawIncluded: false,
        transient: true,
      },
      owner: {
        accounts: [expect.objectContaining({ gameUid: 'game-1' })],
      },
      warnings: [{ code: 'personal_analysis_transient_fallback' }],
    });
    expect(res.body).not.toHaveProperty('history');
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
        ownerId: 'user-1',
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

    const poolUpsert = adminClient.__state.upsertCalls.find((call) => call.table === 'pools');
    const historyUpsert = adminClient.__state.upsertCalls.find((call) => call.table === 'history');
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

  it('does not overwrite a global pool owned by another user', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.poolRows = [{
      pool_id: 'special_official_001',
      user_id: 'other-owner',
    }];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        pools: [{
          id: 'official_pool_alias',
          name: '恶意覆盖名称',
          type: 'limited',
        }],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      saved: { pools: 0, history: 0 },
      skipped: { pools: 1, history: 0 },
    });
    expect(adminClient.__state.upsertCalls.some((call) => call.table === 'pools')).toBe(false);
    expect(adminClient.__state.updateCalls).toEqual([]);
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
    expect(adminClient.__state.upsertCalls.some((call) => call.table === 'history')).toBe(false);
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
    expect(adminClient.__state.upsertCalls.some((call) => call.table === 'history')).toBe(false);
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
    const historyUpsert = adminClient.__state.upsertCalls.find((call) => call.table === 'history');
    expect(historyUpsert.rows).toHaveLength(2);
    expect(historyUpsert.rows.map((row) => row.seq_id)).toEqual(['4201', '4202']);
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
        id: 101,
        record_id: 'record-1',
        user_id: 'user-1',
        game_uid: 'game-1',
        server_id: '1',
        region: 'cn',
      },
      {
        id: 102,
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
        { op: 'in', column: 'id', values: [101] },
      ],
    });
  });

  it('deduplicates repeated history when merging split server labels', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.historyRows = [
      {
        id: 201,
        record_id: 'record-1',
        user_id: 'user-1',
        game_uid: 'game-1',
        server_id: '2',
        region: 'intl',
        seq_id: '42',
        pool_id: 'limited',
        timestamp: '2026-06-05T12:00:00.000Z',
        character_name: '弭弗',
        item_name: null,
        character_id: 'char-1',
        rarity: 6,
        is_free: false,
      },
      {
        id: 202,
        record_id: 'record-2',
        user_id: 'user-1',
        game_uid: 'game-1',
        server_id: '3',
        region: 'intl',
        seq_id: '42',
        pool_id: 'limited',
        timestamp: '2026-06-05T12:00:00.000Z',
        character_name: '弭弗',
        item_name: null,
        character_id: 'char-1',
        rarity: 6,
        is_free: false,
      },
    ];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'updateServerLabel',
        gameUid: 'game-1',
        serverId: '3',
        region: 'intl',
        mergeGameUid: true,
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      updated: 1,
      deletedDuplicates: 1,
      serverId: '3',
      region: 'intl',
      mergeGameUid: true,
    });
    expect(adminClient.__state.updateCalls).toHaveLength(1);
    expect(adminClient.__state.updateCalls[0].filters).toContainEqual({
      op: 'in',
      column: 'id',
      values: [201],
    });
    expect(adminClient.__state.deleteCalls).toHaveLength(1);
    expect(adminClient.__state.deleteCalls[0].filters).toEqual([
      { op: 'eq', column: 'user_id', value: 'user-1' },
      { op: 'in', column: 'id', values: [202] },
    ]);
  });

  it('updates server labels in small record id chunks to avoid long request URLs', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.historyRows = Array.from({ length: 205 }, (_, index) => ({
      id: index + 1,
      record_id: `record-${index + 1}`,
      user_id: 'user-1',
      game_uid: 'game-1',
      server_id: '2',
      region: 'intl',
      seq_id: String(index + 1),
      pool_id: 'limited',
      timestamp: `2026-06-05T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
      character_name: `item-${index + 1}`,
      rarity: 4,
      is_free: false,
    }));
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'updateServerLabel',
        gameUid: 'game-1',
        serverId: '3',
        region: 'intl',
        mergeGameUid: true,
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      updated: 205,
      deletedDuplicates: 0,
    });
    expect(adminClient.__state.updateCalls).toHaveLength(3);
    expect(
      adminClient.__state.updateCalls.map((call) => call.filters.find((filter) => filter.op === 'in').values.length)
    ).toEqual([100, 100, 5]);
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
        history: 3,
        pools: 0,
      },
    });
    expect(adminClient.__state.rpcCalls).toEqual([
      {
        functionName: 'delete_history_records_controlled',
        params: {
          p_user_id: 'user-1',
          p_record_ids: ['1', '2', 'bad'],
          p_reason: '用户批量删除记录',
        },
      },
    ]);
  });

  it('rejects legacy batch deletion when a record id spans multiple account scopes', async () => {
    const adminClient = createAdminClient();
    adminClient.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '21000',
        message: 'ambiguous_history_record_id',
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const req = createRequest({
      method: 'DELETE',
      body: {
        action: 'records',
        recordIds: ['shared-record-id'],
      },
    });
    const res = createJsonResponseRecorder();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: '所选记录 ID 跨多个游戏账号重复，请刷新页面后按完整记录重新删除',
      code: 'ambiguous_history_record_id',
    });
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
