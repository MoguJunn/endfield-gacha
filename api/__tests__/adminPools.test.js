// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  requireSuperAdminUser: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  requireSuperAdminUser: mocks.requireSuperAdminUser,
}));

import adminPoolsHandler, { __internal } from '../_routes/root/admin-pools.js';

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
  url = '/api/admin-pools',
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

function matchesFilters(row, filters) {
  return filters.every((filter) => {
    if (filter.op === 'eq') return row?.[filter.column] === filter.value;
    if (filter.op === 'in') return filter.value.includes(row?.[filter.column]);
    return true;
  });
}

class AdminPoolsQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.payload = null;
  }

  select(selection = '*') {
    this.selection = selection;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  upsert(payload, options = {}) {
    this.operation = 'upsert';
    this.payload = payload;
    this.options = options;
    return this;
  }

  eq(column, value) {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  in(column, value) {
    this.filters.push({ op: 'in', column, value });
    return this;
  }

  range(from, to) {
    this.page = { from, to };
    return this;
  }

  order() {
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.client.__executeQuery(this)).then(resolve, reject);
  }
}

function createAdminClient() {
  const state = {
    calls: [],
    rpcCalls: [],
    pools: [
      {
        pool_id: 'pool-1',
        name: '测试卡池',
        type: 'limited',
        up_character: '测试角色',
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ],
    characters: [
      {
        id: 'char-1',
        name: '测试角色',
        rarity: 6,
        type: 'character',
      },
      { id: 'char-2', name: '测试角色二', rarity: 6, type: 'character' },
      { id: 'char-3', name: '测试角色三', rarity: 6, type: 'character' },
      { id: 'char-4', name: '测试角色四', rarity: 6, type: 'character' },
      { id: 'weapon-1', name: '测试武器', rarity: 6, type: 'weapon' },
    ],
    poolCharacters: [
      {
        pool_id: 'pool-1',
        character_id: 'char-1',
        is_up: true,
      },
    ],
    history: [
      {
        record_id: 1,
        id: '1',
        user_id: 'user-a',
        game_uid: 'account-a',
        server_id: 'cn',
        pool_id: 'pool-1',
        rarity: 6,
        character_name: '测试角色',
        item_name: '测试角色',
        is_standard: true,
      },
      {
        record_id: 2,
        id: '2',
        user_id: 'user-b',
        game_uid: 'account-b',
        server_id: 'intl',
        pool_id: 'pool-1',
        rarity: 6,
        character_name: '常驻角色',
        item_name: '常驻角色',
        is_standard: false,
      },
    ],
  };

  const adminClient = {
    from: vi.fn((table) => new AdminPoolsQuery(adminClient, table)),
    rpc: vi.fn(async (name, payload) => {
      state.rpcCalls.push({ name, payload });
      if (name === 'read_pool_roster_catalog') {
        const rows = state.poolCharacters.filter((row) => payload.p_pool_ids === null || payload.p_pool_ids.includes(row.pool_id));
        return { data: { rowCount: rows.length, rows }, error: null };
      }
      if (name === 'admin_pool_recalculation_snapshot') {
        return { data: { pools: state.pools, records: state.history, previewToken: 'snapshot-1' }, error: null };
      }
      if (name === 'admin_apply_pool_recalculation') {
        for (const update of payload.p_updates) {
          state.history = state.history.map((row) => row.record_id === update.record_id && row.user_id === update.user_id
            ? { ...row, is_standard: update.is_standard } : row);
        }
      }
      return { data: null, error: null };
    }),
    __executeQuery(query) {
      state.calls.push({
        table: query.table,
        operation: query.operation,
        filters: query.filters,
        payload: query.payload,
        options: query.options,
      });

      if (query.table === 'pools') {
        if (query.operation === 'delete') {
          state.pools = state.pools.filter((row) => !matchesFilters(row, query.filters));
          return { data: null, error: null };
        }
        return { data: state.pools.filter((row) => matchesFilters(row, query.filters)), error: null };
      }

      if (query.table === 'characters') {
        return { data: state.characters, error: null };
      }

      if (query.table === 'pool_characters') {
        if (query.operation === 'delete') {
          state.poolCharacters = state.poolCharacters.filter((row) => !matchesFilters(row, query.filters));
          return { data: null, error: null };
        }
        if (query.operation === 'upsert') {
          const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
          state.poolCharacters.push(...rows);
          return { data: rows, error: null };
        }
        const rows = state.poolCharacters.filter(row => matchesFilters(row, query.filters))
          .sort((a, b) => a.pool_id.localeCompare(b.pool_id) || a.character_id.localeCompare(b.character_id));
        return { data: query.page ? rows.slice(query.page.from, query.page.to + 1) : rows, count: rows.length, error: null };
      }

      if (query.table === 'history') {
        if (query.operation === 'update') {
          state.history = state.history.map((row) => (
            matchesFilters(row, query.filters)
              ? { ...row, ...query.payload }
              : row
          ));
          return { data: null, error: null };
        }
        return { data: state.history.filter((row) => matchesFilters(row, query.filters)), error: null };
      }

      throw new Error(`Unexpected table: ${query.table}`);
    },
    __state: state,
  };

  return adminClient;
}

function configureSuperAdminAuth(adminClient, userId = 'super-admin-id') {
  mocks.requireSuperAdminUser.mockResolvedValue({
    ok: true,
    user: { id: userId },
    profile: { id: userId, role: 'super_admin' },
    adminClient,
  });
}

describe('/api/admin-pools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
  });

  it('loads admin pool data through the site-session auth path', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({ url: '/api/admin-pools?mode=pools' });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.requireSuperAdminUser).toHaveBeenCalledWith(req, {
      adminClient,
      touch: true,
    });
    expect(res.body).toMatchObject({
      success: true,
      data: [
        expect.objectContaining({
          pool_id: 'pool-1',
        }),
      ],
    });
  });

  it('loads every roster relation beyond the REST row limit, including pools without history', async () => {
    const client = createAdminClient();
    client.__state.poolCharacters = Array.from({ length: 1227 }, (_, index) => ({
      pool_id: index < 1000 ? 'older-pool' : 'zero-history-pool',
      character_id: `entity-${index}`, is_up: index === 1226,
    }));
    mocks.getSupabaseAdminClient.mockReturnValue(client);
    configureSuperAdminAuth(client);
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ url: '/api/admin-pools?mode=pool-characters' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data['older-pool']).toHaveLength(1000);
    expect(res.body.data['zero-history-pool']).toHaveLength(227);
    expect(res.body.data['zero-history-pool'].at(-1)).toEqual({ character_id: 'entity-1226', is_up: true });
    expect(client.rpc).toHaveBeenCalledWith('read_pool_roster_catalog', { p_pool_ids: null });
    expect(client.from).not.toHaveBeenCalledWith('history');
  });

  it('reads an edit roster from the complete scoped contract', async () => {
    const client = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(client);
    configureSuperAdminAuth(client);
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ url: '/api/admin-pools?mode=pool-characters-for-edit&poolId=pool-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([{ character_id: 'char-1', is_up: true }]);
    expect(client.rpc).toHaveBeenCalledWith('read_pool_roster_catalog', { p_pool_ids: ['pool-1'] });
  });

  it('rejects an incomplete roster instead of publishing it as an empty configuration', async () => {
    const client = createAdminClient();
    client.rpc.mockResolvedValue({ data: { rowCount: 1227, rows: [] }, error: null });
    mocks.getSupabaseAdminClient.mockReturnValue(client);
    configureSuperAdminAuth(client);
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ url: '/api/admin-pools?mode=pool-characters' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });

  it('creates manual pools on behalf of the authenticated super admin only', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient, 'real-super-admin');
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'savePool',
        poolData: {
          name: '新卡池',
          type: 'limited',
          up_character: '测试角色',
          start_time: '2026-06-05T04:00:00.000Z',
          end_time: '2026-06-26T04:00:00.000Z',
          user_id: 'attacker-user',
        },
        editingPool: null,
        characters: [
          { id: 'char-1', name: '测试角色', type: 'character' },
        ],
        editingPoolCharacters: [
          { character_id: 'char-1', is_up: true },
        ],
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      isNew: true,
      addedCount: 1,
    });
    const rpcCall = adminClient.__state.rpcCalls.find((call) => call.name === 'admin_save_pool_catalog');
    expect(rpcCall).toBeTruthy();
    expect(rpcCall.payload.p_insert_payload).toMatchObject({
      name: '新卡池',
      user_id: 'real-super-admin',
    });
    expect(rpcCall.payload.p_actor_user_id).toBe('real-super-admin');
    expect(rpcCall.payload.p_insert_payload.user_id).not.toBe('attacker-user');
  });

  it('rejects unclassified extra pools from explicit admin saves', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'savePool',
        poolData: {
          name: '未分类附加寻访',
          type: 'extra',
          featured_characters: ['测试角色'],
          up_character: '测试角色',
        },
        characters: adminClient.__state.characters,
        editingPoolCharacters: [{ character_id: 'char-1', is_up: true }],
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'extra_pool_template_required',
    });
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('saves reconstruction weapon metadata with one six-star weapon UP', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'savePool',
        poolData: {
          name: '重构申领',
          type: 'extra',
          extra_subtype: 'reconstruction',
          extra_rule_profile: 'reconstruction_weapon_v1',
          extra_series_key: 'reconstruction-weapon-test',
          extra_series_phase: 1,
          featured_characters: ['测试武器'],
          up_character: '测试武器',
        },
        characters: adminClient.__state.characters,
        editingPoolCharacters: [{ character_id: 'weapon-1', is_up: true }],
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    const rpcCall = adminClient.__state.rpcCalls.find((call) => call.name === 'admin_save_pool_catalog');
    expect(rpcCall.payload.p_insert_payload).toMatchObject({
      type: 'extra',
      extra_subtype: 'reconstruction_claim',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'reconstruction-weapon-test',
      extra_series_phase: 1,
    });
    expect(rpcCall.payload.p_pool_character_rows).toEqual([
      { character_id: 'weapon-1', is_up: true },
    ]);
  });

  it.each([
    ['reconstruction_character_v1', 'character', '重构角色'],
    ['reconstruction_weapon_v1', 'weapon', '重构武器'],
  ])('creates limited %s UP targets with the correct object type', async (extraRuleProfile, expectedType, characterName) => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'createUpCharacter',
        characterName,
        poolType: 'extra',
        itemType: expectedType,
        extraRuleProfile,
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.character).toMatchObject({
      name: characterName,
      type: expectedType,
      is_limited: true,
    });
    expect(adminClient.__state.rpcCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'admin_upsert_character_with_aliases',
        payload: expect.objectContaining({
          p_insert_payload: expect.objectContaining({
            type: expectedType,
            is_limited: true,
          }),
        }),
      }),
    ]));
  });

  it('rejects automatic target creation for an unresolved ordinary extra pool', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'createUpCharacter',
        characterName: '不应创建',
        poolType: 'extra',
        itemType: 'character',
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'extra_up_character_profile_required',
    });
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('requires exactly four distinct six-star character UPs for brilliance festival', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const basePoolData = {
      name: '辉光庆典',
      type: 'extra',
      extra_subtype: 'special',
      extra_rule_profile: 'brilliance_festival_v1',
      extra_series_key: null,
      extra_series_phase: null,
      featured_characters: ['测试角色', '测试角色二', '测试角色三', '测试角色四'],
      up_character: '测试角色',
    };
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'savePool',
        poolData: basePoolData,
        characters: adminClient.__state.characters,
        editingPoolCharacters: ['char-1', 'char-2', 'char-3', 'char-4'].map((character_id) => ({
          character_id,
          is_up: true,
        })),
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__state.rpcCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'admin_save_pool_catalog',
        payload: expect.objectContaining({
          p_insert_payload: expect.objectContaining({
            extra_subtype: 'special',
            extra_rule_profile: 'brilliance_festival_v1',
          }),
        }),
      }),
    ]));
  });

  it('deletes pool roster rows before deleting the pool row', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'DELETE',
      body: {
        poolId: 'pool-1',
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__state.calls.filter((call) => call.operation === 'delete')).toEqual([
      expect.objectContaining({
        table: 'pool_characters',
        filters: [{ op: 'eq', column: 'pool_id', value: 'pool-1' }],
      }),
      expect.objectContaining({
        table: 'pools',
        filters: [{ op: 'eq', column: 'pool_id', value: 'pool-1' }],
      }),
    ]);
  });

  it('previews without writes then applies scoped changes from authoritative server pools', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'recalculateIsStandard',
        pools: [
          {
            pool_id: 'pool-1',
            type: 'limited',
            up_character: '测试角色',
          },
        ],
      },
    });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      changedCount: 2,
    });
    expect(res.body.scope).toEqual({
      kind: 'all-users-six-star', recordCount: 2, affectedPoolIds: ['pool-1'], affectedUserCount: 2,
    });
    expect(adminClient.__state.history[0].is_standard).toBe(true);
    expect(adminClient.__state.rpcCalls.map((call) => call.name)).toEqual(['admin_pool_recalculation_snapshot']);
    const applyRes = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'recalculateIsStandard', mode: 'apply', previewToken: res.body.previewToken,
      pools: [{ pool_id: 'pool-1', type: 'standard' }],
    } }), applyRes);
    expect(applyRes.statusCode).toBe(200);
    expect(adminClient.__state.rpcCalls.at(-1)).toMatchObject({
      name: 'admin_apply_pool_recalculation', payload: { p_preview_token: 'snapshot-1', p_updates: [
        { id: '1', user_id: 'user-a', game_uid: 'account-a', server_id: 'cn', pool_id: 'pool-1', record_id: 1, is_standard: false },
        { id: '2', user_id: 'user-b', game_uid: 'account-b', server_id: 'intl', pool_id: 'pool-1', record_id: 2, is_standard: true },
      ] },
    });
    expect(adminClient.__state.calls.some((call) => call.table === 'history' && call.operation === 'update')).toBe(false);
  });

  it('recalculates extra pools from capabilities without treating unknown profiles as targets', async () => {
    const adminClient = createAdminClient();
    adminClient.__state.history = [
      { record_id: 11, pool_id: 'recon-character', rarity: 6, character_name: '重构角色UP', is_standard: true },
      { record_id: 12, pool_id: 'recon-character', rarity: 6, character_name: '角色歪出', is_standard: false },
      { record_id: 13, pool_id: 'recon-weapon', rarity: 6, item_name: '重构武器UP', is_standard: true },
      { record_id: 14, pool_id: 'recon-weapon', rarity: 6, item_name: '武器歪出', is_standard: false },
      ...['辉光目标一', '辉光目标二', '辉光目标三', '辉光目标四'].map((name, index) => ({
        record_id: 20 + index,
        pool_id: 'brilliance',
        rarity: 6,
        character_name: name,
        is_standard: true,
      })),
      { record_id: 31, pool_id: 'joint-unknown', rarity: 6, character_name: '未知目标一', is_standard: false },
      { record_id: 32, pool_id: 'joint-unknown', rarity: 6, character_name: '未知目标二', is_standard: false },
    ];
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    configureSuperAdminAuth(adminClient);
    const req = createRequest({
      method: 'POST',
      body: {
        action: 'recalculateIsStandard',
        mode: 'apply',
        previewToken: 'snapshot-1',
        pools: [
          {
            pool_id: 'recon-character',
            type: 'extra',
            up_character: '重构角色UP',
            extra_subtype: 'reconstruction',
            extra_rule_profile: 'reconstruction_character_v1',
            extra_series_key: 'recon-character-series',
            extra_series_phase: 1,
          },
          {
            id: 'recon-weapon',
            type: 'extra',
            upCharacter: '重构武器UP',
            extraSubtype: 'reconstruction',
            extraRuleProfile: 'reconstruction_weapon_v1',
            extraSeriesKey: 'recon-weapon-series',
            extraSeriesPhase: 2,
          },
          {
            pool_id: 'brilliance',
            type: 'extra',
            extra_subtype: 'special',
            extra_rule_profile: 'brilliance_festival_v1',
            extra_series_key: null,
            extra_series_phase: null,
          },
          {
            pool_id: 'joint-unknown',
            type: 'extra',
            extra_subtype: 'special',
            extra_rule_profile: 'future_joint_profile',
            extra_series_key: null,
            extra_series_phase: null,
          },
        ],
      },
    });
    const res = createJsonResponseRecorder();
    adminClient.__state.pools = req.body.pools;
    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, changedCount: 8 });
    expect(adminClient.__state.history.filter((row) => [11, 13, 20, 21, 22, 23].includes(row.record_id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ record_id: 11, is_standard: false }),
        expect.objectContaining({ record_id: 13, is_standard: false }),
        expect.objectContaining({ record_id: 20, is_standard: false }),
        expect.objectContaining({ record_id: 21, is_standard: false }),
        expect.objectContaining({ record_id: 22, is_standard: false }),
        expect.objectContaining({ record_id: 23, is_standard: false }),
      ]));
    expect(adminClient.__state.history.filter((row) => [12, 14].includes(row.record_id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ record_id: 12, is_standard: true }),
        expect.objectContaining({ record_id: 14, is_standard: true }),
      ]));
    expect(adminClient.__state.history.filter((row) => [31, 32].includes(row.record_id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ record_id: 31, is_standard: false }),
        expect.objectContaining({ record_id: 32, is_standard: false }),
      ]));
  });

  it.each([
    [{ name: '' }, 'pool_name_invalid'],
    [{ pool_id: 'limited' }, 'pool_id_invalid'],
    [{ pool_id: 'bad id' }, 'pool_id_invalid'],
    [{ start_time: 'bad-date' }, 'pool_time_invalid'],
    [{ start_time: '2026-09-20', end_time: '2026-09-19' }, 'pool_time_range_invalid'],
    [{ roster_status: 'complete' }, 'pool_roster_confirmation_required'],
    [{ roster_status: 'invented' }, 'pool_roster_status_invalid'],
    [{ roster_status: 'missing' }, 'pool_roster_status_mismatch'],
  ])('rejects invalid pool fields %j', async (fields, code) => {
    const adminClient = mocks.getSupabaseAdminClient();
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'savePool', poolData: { name: '新卡池', type: 'limited', ...fields },
      editingPoolCharacters: [{ character_id: 'char-1' }],
    } }), res);
    expect(res.body.code).toBe(code);
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('rejects browser-forged entity types and only confirms complete rosters explicitly', async () => {
    const adminClient = mocks.getSupabaseAdminClient();
    const body = { action: 'savePool', poolData: { name: '新卡池', type: 'limited', roster_status: 'complete' },
      confirmRosterComplete: true, characters: [{ id: 'weapon-1', type: 'character', rarity: 6 }],
      editingPoolCharacters: [{ character_id: 'weapon-1' }] };
    const invalid = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body }), invalid);
    expect(invalid.body.code).toBe('pool_roster_entity_invalid');
    const valid = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      ...body, editingPoolCharacters: [{ character_id: 'char-1' }],
    } }), valid);
    expect(valid.statusCode).toBe(200);
    expect(adminClient.__state.rpcCalls.at(-1).payload.p_insert_payload.roster_status).toBe('complete');
    expect(adminClient.__state.calls.some((call) => call.table === 'pool_characters')).toBe(false);
  });

  it('does not infer complete from a nonempty roster and resolves UP marks from the pool', async () => {
    const adminClient = mocks.getSupabaseAdminClient();
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'savePool', poolData: { name: '新卡池', type: 'limited', up_character: '测试角色二' },
      editingPoolCharacters: [{ character_id: 'char-1', is_up: true }, { character_id: 'char-2', is_up: false }],
    } }), res);
    expect(res.statusCode).toBe(200);
    expect(adminClient.__state.rpcCalls.at(-1).payload).toMatchObject({
      p_insert_payload: { roster_status: 'partial' },
      p_pool_character_rows: [{ character_id: 'char-1', is_up: false }, { character_id: 'char-2', is_up: true }],
    });
  });

  it('rejects omitted rosters instead of silently clearing existing data', async () => {
    const client = mocks.getSupabaseAdminClient();
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'savePool', editingPool: client.__state.pools[0], poolData: { name: '保留名单', type: 'limited' },
    } }), res);
    expect(res.body.code).toBe('pool_roster_required');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: 'standard', up_character: '测试角色' }, [{ character_id: 'char-1' }], 'pool_up_not_allowed'],
    [{ type: 'limited', featured_characters: ['测试角色二'] }, [{ character_id: 'char-1' }], 'pool_featured_not_allowed'],
    [{ type: 'limited', up_character: '不存在' }, [{ character_id: 'char-1' }], 'pool_up_roster_invalid'],
    [{ type: 'limited', roster_status: 'partial' }, [], 'pool_roster_status_mismatch'],
    [{ type: 'limited', roster_status: 'complete' }, [], 'pool_roster_complete_empty'],
  ])('rejects roster and UP contradictions %j', async (fields, rows, code) => {
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'savePool', poolData: { name: '名单校验', ...fields }, editingPoolCharacters: rows,
      confirmRosterComplete: true,
    } }), res);
    expect(res.body.code).toBe(code);
    expect(mocks.getSupabaseAdminClient().rpc).not.toHaveBeenCalled();
  });

  it('canonicalizes UP entity IDs before storing the pool', async () => {
    const client = mocks.getSupabaseAdminClient();
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'savePool', poolData: { name: 'ID目标', type: 'limited', up_character: 'char-1' },
      editingPoolCharacters: [{ character_id: 'char-1' }],
    } }), res);
    expect(res.statusCode).toBe(200);
    expect(client.__state.rpcCalls[0].payload.p_insert_payload.up_character).toBe('测试角色');
  });

  it('returns an actionable conflict when a self alias belongs to another pool', async () => {
    const client = mocks.getSupabaseAdminClient();
    client.rpc.mockResolvedValueOnce({ error: { message: 'pool_alias_conflict' } });
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'savePool', poolData: { name: '别名校验', type: 'limited' }, editingPoolCharacters: [],
    } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('pool_alias_conflict');
  });

  it('recalculates by identity or exact catalog aliases without substring matches', () => {
    const pools = new Map([['pool-a', { type: 'limited', up_character: '角色A',
      up_character_id: 'char-a', up_character_aliases: ['旧名A'] }]]);
    const record = { pool_id: 'pool-a', rarity: 6, is_standard: false };
    expect(__internal.calculateIsStandard({ ...record, character_name: '角色A改' }, pools)).toBe(true);
    expect(__internal.calculateIsStandard({ ...record, character_name: '旧名A' }, pools)).toBe(false);
    expect(__internal.calculateIsStandard({ ...record, character_id: 'char-a', character_name: '另一旧名' }, pools)).toBe(false);
    expect(__internal.calculateIsStandard({ ...record, character_id: 'char-b', character_name: '角色A' }, pools)).toBe(true);
    expect(__internal.calculateIsStandard({ ...record, pool_id: 'unknown', is_standard: null }, pools)).toBeNull();
  });

  it.each([
    [null, 400, 'recalculate_preview_required'],
    ['old-token', 409, 'recalculate_preview_stale'],
  ])('blocks unpreviewed or stale global applications', async (previewToken, status, code) => {
    const adminClient = mocks.getSupabaseAdminClient();
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'recalculateIsStandard', mode: 'apply', previewToken,
    } }), res);
    expect(res.statusCode).toBe(status);
    expect(res.body.code).toBe(code);
    expect(adminClient.__state.rpcCalls.some((call) => call.name === 'admin_apply_pool_recalculation')).toBe(false);
  });

  it('returns a stale-preview conflict when the SQL transaction detects a later race', async () => {
    const adminClient = mocks.getSupabaseAdminClient();
    adminClient.rpc.mockResolvedValueOnce({ data: {
      pools: adminClient.__state.pools, records: adminClient.__state.history, previewToken: 'snapshot-1',
    }, error: null }).mockResolvedValueOnce({ error: { message: 'recalculate_preview_stale' } });
    const res = createJsonResponseRecorder();
    await adminPoolsHandler(createRequest({ method: 'POST', body: {
      action: 'recalculateIsStandard', mode: 'apply', previewToken: 'snapshot-1',
    } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('recalculate_preview_stale');
  });

  it.each(['GET', 'POST', 'DELETE'])('rejects non-super-admin %s requests before accessing public data', async (method) => {
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Super admin role required',
      code: 'super_admin_required',
    });
    const req = createRequest({ method, body: { action: 'savePool' } });
    const res = createJsonResponseRecorder();

    await adminPoolsHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Super admin role required',
      code: 'super_admin_required',
    });
    expect(mocks.getSupabaseAdminClient().from).not.toHaveBeenCalled();
    expect(mocks.getSupabaseAdminClient().rpc).not.toHaveBeenCalled();
  });
});
