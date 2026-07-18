// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
  requireSuperAdminUser: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({ rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin }));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: mocks.getSupabaseAdminClient }));
vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
  requireSuperAdminUser: mocks.requireSuperAdminUser,
}));

import historyAnomaliesHandler from '../_routes/root/history-anomalies.js';
import adminHistoryAnomaliesHandler from '../_routes/root/admin-history-anomalies.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function createRequest(method = 'GET', url = '/api/history-anomalies', body) {
  return { method, url, body, headers: { cookie: '__Host-eg_session=redacted' } };
}

function createAdminClient() {
  const state = {
    history_anomalies: [
      {
        id: 'anomaly-own',
        user_id: 'user-1',
        record_id: '100',
        game_uid: 'game-1',
        server_scope: '1',
        pool_id: 'pool-1',
        seq_id: '10',
        issue_code: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
        status: 'pending',
        postponed_until: null,
        detected_at: '2026-07-18T00:00:00.000Z',
        details: { itemName: '未知' },
      },
      {
        id: 'anomaly-postponed',
        user_id: 'user-1',
        record_id: '101',
        game_uid: 'game-1',
        server_scope: '1',
        pool_id: 'pool-1',
        seq_id: '11',
        issue_code: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
        status: 'pending',
        postponed_until: '2999-01-01T00:00:00.000Z',
        detected_at: '2026-07-18T00:00:00.000Z',
        details: { itemName: '未知' },
      },
      {
        id: 'anomaly-other',
        user_id: 'user-2',
        record_id: '102',
        game_uid: 'game-2',
        server_scope: '1',
        pool_id: 'pool-2',
        seq_id: '12',
        issue_code: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
        status: 'pending',
        postponed_until: null,
        detected_at: '2026-07-18T00:00:00.000Z',
        details: { itemName: '未知' },
      },
    ],
    profiles: [
      { id: 'user-1', username: '用户一', email: 'one@example.com' },
      { id: 'user-2', username: '用户二', email: 'two@example.com' },
    ],
    history_change_log: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = 'select';
      this.payload = null;
      this.filters = [];
      this.returning = false;
    }
    select() { this.returning = true; return this; }
    update(payload) { this.operation = 'update'; this.payload = payload; return this; }
    insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { const set = new Set(values); this.filters.push((row) => set.has(row[column])); return this; }
    order() { return this; }
    limit() { return this; }
    maybeSingle() { return this.execute('single'); }
    then(resolve, reject) { return this.execute('many').then(resolve, reject); }
    matches(row) { return this.filters.every((filter) => filter(row)); }
    async execute(mode) {
      const table = state[this.table];
      if (this.operation === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        table.push(...rows.map((row) => structuredClone(row)));
        return { data: null, error: null };
      }
      const matched = table.filter((row) => this.matches(row));
      if (this.operation === 'update') {
        matched.forEach((row) => Object.assign(row, structuredClone(this.payload)));
      }
      const data = matched.map((row) => structuredClone(row));
      return mode === 'single'
        ? { data: data[0] || null, error: null }
        : { data: data, error: null };
    }
  }

  return {
    __state: state,
    from(table) { return new Query(table); },
  };
}

describe('history anomaly APIs', () => {
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({ ok: true, user: { id: 'user-1' } });
    mocks.requireSuperAdminUser.mockResolvedValue({ ok: true, user: { id: 'admin-1' } });
  });

  it('returns only the current user active reminders', async () => {
    const res = createResponse();
    await historyAnomaliesHandler(createRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.anomalies.map((item) => item.id)).toEqual(['anomaly-own']);
  });

  it('lets the owner confirm one anomaly and writes an audit row', async () => {
    const res = createResponse();
    await historyAnomaliesHandler(createRequest('PATCH', '/api/history-anomalies', {
      anomalyId: 'anomaly-own',
      action: 'confirm',
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.anomaly.status).toBe('confirmed');
    expect(adminClient.__state.history_change_log[0]).toMatchObject({
      user_id: 'user-1',
      operation: 'confirm_anomaly',
    });
  });

  it('does not let a user update another user anomaly', async () => {
    const res = createResponse();
    await historyAnomaliesHandler(createRequest('PATCH', '/api/history-anomalies', {
      anomalyId: 'anomaly-other',
      action: 'confirm',
    }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('history_anomaly_not_found');
  });

  it('rejects the administrator endpoint without super-admin permission', async () => {
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'super_admin_required',
      error: 'Super admin role required',
    });
    const res = createResponse();
    await adminHistoryAnomaliesHandler(createRequest('GET', '/api/admin-history-anomalies'), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('super_admin_required');
  });

  it('returns pending anomalies with user labels to a super administrator', async () => {
    const res = createResponse();
    await adminHistoryAnomaliesHandler(createRequest('GET', '/api/admin-history-anomalies'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.anomalies[0]).toEqual(expect.objectContaining({
      status: 'pending',
      user: expect.objectContaining({ username: expect.any(String) }),
    }));
  });
});
