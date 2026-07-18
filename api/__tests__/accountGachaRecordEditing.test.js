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

function createResponse() {
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

function createRequest(method, body) {
  return {
    method,
    url: '/api/account-gacha-data',
    headers: { cookie: '__Host-eg_session=redacted' },
    body,
  };
}

function createAdminClient() {
  const state = {
    history: [
      {
        record_id: '3500001026',
        user_id: 'user-1',
        game_uid: 'game-1',
        server_id: '1',
        server_scope: '1',
        pool_id: 'pool-old',
        seq_id: '1026',
        timestamp: '2026-07-16T03:40:17.803Z',
        character_id: null,
        character_name: '未知',
        item_name: '未知',
        rarity: 4,
        pity: 39,
        batch_id: 'old-batch',
        is_free: false,
        is_info_book: false,
        is_standard: false,
        special_type: null,
        edit_version: 2,
      },
      {
        record_id: '3500001026',
        user_id: 'user-1',
        game_uid: 'game-2',
        server_id: '1',
        server_scope: '1',
        pool_id: 'pool-other',
        seq_id: '1026',
        timestamp: '2026-07-17T03:40:17.803Z',
        character_id: 'char-existing',
        character_name: '其他账号角色',
        item_name: '其他账号角色',
        rarity: 5,
        pity: 5,
        batch_id: 'other-batch',
        is_free: false,
        is_info_book: false,
        is_standard: false,
        special_type: null,
        edit_version: 1,
      },
    ],
    pools: [
      { pool_id: 'pool-old', name: '旧卡池', type: 'limited_character' },
      { pool_id: 'pool-new', name: '新卡池', type: 'limited_character' },
    ],
    characters: [
      { id: 'char-correct', name: '正确角色', rarity: 6, type: 'character' },
    ],
    history_change_log: [],
    history_anomalies: [
      {
        user_id: 'user-1',
        game_uid: 'game-1',
        server_scope: '1',
        pool_id: 'pool-old',
        seq_id: '1026',
        status: 'pending',
      },
    ],
    rpcCalls: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = 'select';
      this.payload = null;
      this.filters = [];
      this.returning = false;
    }

    select() {
      this.returning = true;
      return this;
    }

    update(payload) {
      this.operation = 'update';
      this.payload = payload;
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    insert(payload) {
      this.operation = 'insert';
      this.payload = payload;
      return this;
    }

    eq(column, value) {
      this.filters.push({ column, value });
      return this;
    }

    maybeSingle() {
      return this.execute('single');
    }

    then(resolve, reject) {
      return this.execute('many').then(resolve, reject);
    }

    matches(row) {
      return this.filters.every(({ column, value }) => row[column] === value);
    }

    async execute(mode) {
      const table = state[this.table];
      if (!Array.isArray(table)) {
        return { data: null, error: { message: `Unexpected table ${this.table}` } };
      }

      if (this.operation === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        table.push(...rows.map((row) => structuredClone(row)));
        return { data: this.returning ? rows : null, error: null };
      }

      const matching = table.filter((row) => this.matches(row));
      if (this.operation === 'update') {
        matching.forEach((row) => Object.assign(row, structuredClone(this.payload)));
      }
      if (this.operation === 'delete') {
        for (let index = table.length - 1; index >= 0; index -= 1) {
          if (this.matches(table[index])) table.splice(index, 1);
        }
      }

      const data = this.operation === 'delete'
        ? null
        : matching.map((row) => structuredClone(row));
      if (mode === 'single') {
        return { data: data?.[0] || null, error: null };
      }
      return { data: this.returning ? data : null, error: null };
    }
  }

  return {
    __state: state,
    from(table) {
      return new Query(table);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      const matchesLocator = (row) => (
        row.user_id === args.p_user_id
        && row.record_id === args.p_record_id
        && row.game_uid === args.p_game_uid
        && row.pool_id === args.p_pool_id
        && row.seq_id === args.p_seq_id
        && (!args.p_server_scope || row.server_scope === args.p_server_scope)
      );

      if (name === 'update_history_record_controlled') {
        const row = state.history.find(matchesLocator);
        if (!row) return { data: null, error: { code: 'P0002', message: 'history_record_not_found' } };
        if (row.edit_version !== args.p_expected_version) {
          return { data: null, error: { code: '40001', message: 'history_record_conflict' } };
        }
        const oldValues = structuredClone(row);
        Object.assign(row, structuredClone(args.p_changes), {
          edit_version: args.p_expected_version + 1,
        });
        state.history_change_log.push({
          user_id: args.p_user_id,
          record_id: args.p_record_id,
          operation: 'update',
          reason: args.p_reason,
          old_values: oldValues,
          new_values: structuredClone(row),
        });
        state.history_anomalies
          .filter((anomaly) => anomaly.user_id === args.p_user_id && anomaly.status === 'pending')
          .forEach((anomaly) => { anomaly.status = 'resolved'; });
        return { data: { updated: 1, record: structuredClone(row) }, error: null };
      }

      if (name === 'delete_history_record_controlled') {
        const index = state.history.findIndex(matchesLocator);
        if (index < 0) return { data: null, error: { code: 'P0002', message: 'history_record_not_found' } };
        const [row] = state.history.splice(index, 1);
        state.history_change_log.push({
          user_id: args.p_user_id,
          record_id: args.p_record_id,
          operation: 'delete',
          reason: args.p_reason,
          old_values: structuredClone(row),
          new_values: {},
        });
        return { data: { deleted: 1, record: structuredClone(row) }, error: null };
      }

      return { data: null, error: { message: `Unexpected rpc ${name}` } };
    },
  };
}

function detailedLocator(overrides = {}) {
  return {
    recordId: '3500001026',
    gameUid: 'game-1',
    serverScope: '1',
    currentPoolId: 'pool-old',
    seqId: '1026',
    ...overrides,
  };
}

describe('account gacha detailed record editing', () => {
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: 'user-1' },
    });
  });

  it('updates only the owned scoped row and writes an audit entry', async () => {
    const req = createRequest('PATCH', {
      ...detailedLocator(),
      editVersion: 2,
      reason: '修正官方导入异常',
      changes: {
        timestamp: '2026-07-16T04:00:00.000Z',
        poolId: 'pool-new',
        characterId: 'char-correct',
        drawMethod: 'info_book',
        isStandard: false,
        specialType: null,
      },
    });
    const res = createResponse();

    await accountGachaDataHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      updated: 1,
      record: {
        gameUid: 'game-1',
        poolId: 'pool-new',
        character_id: 'char-correct',
        name: '正确角色',
        rarity: 6,
        isInfoBook: true,
        editVersion: 3,
      },
    });
    expect(adminClient.__state.history.find((row) => row.game_uid === 'game-2')).toMatchObject({
      pool_id: 'pool-other',
      character_name: '其他账号角色',
    });
    expect(adminClient.__state.history_change_log).toHaveLength(1);
    expect(adminClient.__state.history_change_log[0]).toMatchObject({
      user_id: 'user-1',
      operation: 'update',
      reason: '修正官方导入异常',
    });
    expect(adminClient.__state.rpcCalls).toEqual([
      expect.objectContaining({
        name: 'update_history_record_controlled',
        args: expect.objectContaining({
          p_user_id: 'user-1',
          p_pool_id: 'pool-old',
          p_expected_version: 2,
          p_changes: expect.objectContaining({
            pool_id: 'pool-new',
            is_info_book: true,
          }),
        }),
      }),
    ]);
  });

  it('rejects stale edit versions', async () => {
    const res = createResponse();
    await accountGachaDataHandler(createRequest('PATCH', {
      ...detailedLocator(),
      editVersion: 1,
      changes: { drawMethod: 'free' },
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('history_record_conflict');
    expect(adminClient.__state.history_change_log).toHaveLength(0);
  });

  it('rejects unsupported draw methods without changing data', async () => {
    const res = createResponse();
    await accountGachaDataHandler(createRequest('PATCH', {
      ...detailedLocator(),
      editVersion: 2,
      changes: { drawMethod: 'mystery' },
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid_draw_method');
    expect(adminClient.__state.history[0].is_free).toBe(false);
  });

  it('does not let a user target another user through the request body', async () => {
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: 'user-2' },
    });
    const res = createResponse();
    await accountGachaDataHandler(createRequest('PATCH', {
      ...detailedLocator(),
      userId: 'user-1',
      editVersion: 2,
      changes: { drawMethod: 'free' },
    }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('history_record_not_found');
  });

  it('deletes only the fully scoped row when record ids repeat', async () => {
    const res = createResponse();
    await accountGachaDataHandler(createRequest('DELETE', {
      action: 'record',
      ...detailedLocator(),
      reason: '不是我的记录',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.deleted.history).toBe(1);
    expect(adminClient.__state.history).toHaveLength(1);
    expect(adminClient.__state.history[0]).toMatchObject({ game_uid: 'game-2', pool_id: 'pool-other' });
    expect(adminClient.__state.history_change_log[0]).toMatchObject({ operation: 'delete' });
    expect(adminClient.__state.rpcCalls[0]).toMatchObject({
      name: 'delete_history_record_controlled',
      args: expect.objectContaining({
        p_game_uid: 'game-1',
        p_pool_id: 'pool-old',
        p_seq_id: '1026',
      }),
    });
  });
});
