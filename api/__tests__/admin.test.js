// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  checkMemoryRateLimit: vi.fn(() => ({ allowed: true, retryAfter: 0 })),
  getRequesterKey: vi.fn(() => 'test-requester'),
  getSupabaseAdminClient: vi.fn(),
  getBearerToken: vi.fn(() => 'token'),
  createSupabaseAccessTokenClient: vi.fn(),
  getSupabaseAnonServerClient: vi.fn(),
  findAuthUserByEmail: vi.fn(),
  listMergedAdminUsers: vi.fn(),
  parseRequestedJobIds: vi.fn(() => ['official-announcements']),
  runOpsAutomationJobs: vi.fn(),
  runMailOutboxWorker: vi.fn(),
  sendMailSmokeTest: vi.fn(),
  enqueueMailOutboxEvent: vi.fn(),
  buildOpsAutomationHttpPayload: vi.fn((runResult = {}) => ({
    success: Boolean(runResult.ok),
    partial: Boolean(runResult.partial),
    jobGraph: Array.isArray(runResult.jobGraph) ? runResult.jobGraph : [],
    ...(runResult.results || {}),
  })),
  buildAdminSiteHealth: vi.fn(),
  revokeAllSiteSessionsForUser: vi.fn(),
  requireSuperAdminUser: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
  checkMemoryRateLimit: mocks.checkMemoryRateLimit,
  getRequesterKey: mocks.getRequesterKey,
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
  getBearerToken: mocks.getBearerToken,
  createSupabaseAccessTokenClient: mocks.createSupabaseAccessTokenClient,
  getSupabaseAnonServerClient: mocks.getSupabaseAnonServerClient,
  findAuthUserByEmail: mocks.findAuthUserByEmail,
  listMergedAdminUsers: mocks.listMergedAdminUsers,
}));

vi.mock('../_lib/opsAutomation.js', () => ({
  parseRequestedJobIds: mocks.parseRequestedJobIds,
}));

vi.mock('../_lib/runOpsAutomation.js', () => ({
  runOpsAutomationJobs: mocks.runOpsAutomationJobs,
  buildOpsAutomationHttpPayload: mocks.buildOpsAutomationHttpPayload,
}));

vi.mock('../_lib/mailOutboxWorker.js', () => ({
  runMailOutboxWorker: mocks.runMailOutboxWorker,
}));

vi.mock('../_lib/mailSmokeTest.js', () => ({
  sendMailSmokeTest: mocks.sendMailSmokeTest,
}));

vi.mock('../_lib/mailOutbox.js', () => ({
  enqueueMailOutboxEvent: mocks.enqueueMailOutboxEvent,
}));

vi.mock('../_lib/adminSiteHealth.js', () => ({
  buildAdminSiteHealth: mocks.buildAdminSiteHealth,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  requireSuperAdminUser: mocks.requireSuperAdminUser,
}));

vi.mock('../_lib/siteSession.js', async (importOriginal) => ({
  ...await importOriginal(),
  revokeAllSiteSessionsForUser: mocks.revokeAllSiteSessionsForUser,
}));

import handler from '../_routes/root/admin.js';

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

function createProfilesQuery(role = 'super_admin', profilesById = {}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn((field, value) => {
        const row = field === 'id' && value !== 'super-admin-id'
          ? profilesById[value] || null
          : { id: 'super-admin-id', role };
        return {
          maybeSingle: vi.fn(async () => ({
            data: row,
            error: null,
          })),
          single: vi.fn(async () => ({
            data: row,
            error: null,
          })),
        };
      }),
    })),
  };
}

function createCleanupQuery() {
  return {
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  };
}

function createAccountSecurityStateQuery() {
  return {
    upsert: vi.fn(async () => ({ error: null })),
  };
}

function createAdminClient({ role = 'super_admin', deleteError = null } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (['announcements', 'site_config', 'puzzles'].includes(table)) {
        return createCleanupQuery();
      }

      if (table === 'account_security_states') {
        return createAccountSecurityStateQuery();
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    auth: {
      admin: {
        deleteUser: vi.fn(async () => ({ error: deleteError })),
        updateUserById: vi.fn(async () => ({ error: null })),
      },
    },
  };
}

function createAdminUserDataClient({ role = 'super_admin', historyDeleteError = null, poolsDeleteError = null } = {}) {
  const state = {
    poolFilters: [],
    historyFilters: [],
    deleteCalls: [],
    pools: [
      {
        pool_id: 'pool-1',
        user_id: 'target-user-id',
        name: '测试卡池',
        created_at: '2026-06-01T00:00:00.000Z',
      },
    ],
    history: [
      {
        record_id: 1,
        user_id: 'target-user-id',
        pool_id: 'pool-1',
        rarity: 6,
        timestamp: '2026-06-02T00:00:00.000Z',
      },
    ],
  };

  function createSelectQuery(table) {
    const query = {
      filters: [],
      select: vi.fn(() => query),
      eq: vi.fn((column, value) => {
        query.filters.push({ column, value });
        if (table === 'pools') {
          state.poolFilters.push({ column, value });
        }
        if (table === 'history') {
          state.historyFilters.push({ column, value });
        }
        return query;
      }),
      order: vi.fn(() => {
        if (table === 'pools') {
          return Promise.resolve({ data: state.pools, error: null });
        }
        return query;
      }),
      limit: vi.fn(async () => ({
        data: state.history,
        error: null,
        count: state.history.length + 10,
      })),
    };
    return query;
  }

  function createDeleteQuery(table) {
    const query = {
      filters: [],
      eq: vi.fn((column, value) => {
        query.filters.push({ column, value });
        return query;
      }),
      then(resolve, reject) {
        state.deleteCalls.push({
          table,
          filters: [...query.filters],
        });
        const error = table === 'history' ? historyDeleteError : poolsDeleteError;
        return Promise.resolve({ data: null, error }).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'pools' || table === 'history') {
        return {
          select: (...args) => createSelectQuery(table).select(...args),
          delete: () => createDeleteQuery(table),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __userDataState: state,
  };
}

function createPublicCacheBumpAdminClient({
  role = 'super_admin',
  upsertError = null,
  rpcResult = {
    data: {
      refreshedPools: 1,
      refreshedTrendRows: 3,
      updatedAt: '2026-06-05T12:00:00.000Z',
    },
    error: null,
  },
} = {}) {
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const rpc = vi.fn(async () => rpcResult);

  return {
    rpc,
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'site_config') {
        return { upsert };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __publicCacheMocks: {
      rpc,
      upsert,
    },
  };
}

function createMailRuntimeConfigAdminClient({
  role = 'super_admin',
  upsertError = null,
  existingConfig = null,
} = {}) {
  const state = {
    siteConfig: existingConfig
      ? [{
        key: 'mail_runtime_config',
        value: JSON.stringify(existingConfig),
        updated_at: '2026-06-12T00:00:00.000Z',
        updated_by: 'super-admin-id',
      }]
      : [],
  };
  const upsert = vi.fn(async (payload) => {
    if (!upsertError) {
      const existingIndex = state.siteConfig.findIndex(row => row.key === payload.key);
      const row = { ...payload };
      if (existingIndex >= 0) {
        state.siteConfig[existingIndex] = row;
      } else {
        state.siteConfig.push(row);
      }
    }
    return { error: upsertError };
  });

  return {
    state,
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'site_config') {
        return {
          upsert,
          select: vi.fn(() => ({
            eq: vi.fn((field, value) => ({
              limit: vi.fn(async () => ({
                data: state.siteConfig.filter(row => row[field] === value).slice(0, 1),
                error: null,
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mailRuntimeMocks: {
      upsert,
    },
  };
}

class SiteConfigQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
    this.limitValue = null;
  }

  select() {
    return this;
  }

  upsert(payload) {
    this.operation = 'upsert';
    this.payload = payload;
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  order() {
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.client.__executeSiteConfigQuery(this, { maybeSingle: true }));
  }

  then(resolve, reject) {
    return Promise.resolve(this.client.__executeSiteConfigQuery(this)).then(resolve, reject);
  }
}

function matchesSiteConfigFilters(row, filters) {
  return filters.every((filter) => row?.[filter.field] === filter.value);
}

function createSiteConfigAdminClient({
  role = 'super_admin',
  rows = [
    {
      key: 'author_name',
      value: 'MoguJun',
      label: '作者名',
      category: 'social',
      updated_at: '2026-06-01T00:00:00.000Z',
      updated_by: null,
    },
  ],
  upsertError = null,
} = {}) {
  const state = {
    siteConfig: [...rows],
  };

  const adminClient = {
    state,
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }
      if (table === 'site_config') {
        return new SiteConfigQuery(adminClient, table);
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    __executeSiteConfigQuery(query, { maybeSingle = false } = {}) {
      if (query.table !== 'site_config') {
        throw new Error(`Unexpected table: ${query.table}`);
      }

      if (query.operation === 'upsert') {
        if (upsertError) {
          return { data: null, error: upsertError };
        }
        const existingIndex = state.siteConfig.findIndex((row) => row.key === query.payload.key);
        const row = {
          ...query.payload,
        };
        if (existingIndex >= 0) {
          state.siteConfig[existingIndex] = row;
        } else {
          state.siteConfig.push(row);
        }
        return { data: maybeSingle ? row : [row], error: null };
      }

      const rowsToReturn = state.siteConfig
        .filter((row) => matchesSiteConfigFilters(row, query.filters))
        .slice(0, query.limitValue || state.siteConfig.length);
      return {
        data: maybeSingle ? rowsToReturn[0] || null : rowsToReturn,
        error: null,
      };
    },
  };

  return adminClient;
}

function createMailBudgetConfigAdminClient({
  role = 'super_admin',
  upsertError = null,
} = {}) {
  const upsert = vi.fn((rows) => ({
    select: vi.fn(async () => ({
      data: Array.isArray(rows)
        ? rows.map((row) => ({
          scope: row.scope,
          event_type: row.event_type,
          window_seconds: row.window_seconds,
          max_attempts: row.max_attempts,
          enabled: row.enabled,
          updated_at: row.updated_at,
        }))
        : [],
      error: upsertError,
    })),
  }));

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'mail_abuse_budget_config') {
        return { upsert };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mailBudgetMocks: {
      upsert,
    },
  };
}

function createApiKeyRevokeAdminClient({
  role = 'super_admin',
  revokedKey = {
    id: 'key-1',
    client_id: 'client-1',
    key_prefix: 'egk_test_prefix',
    label: 'primary',
    status: 'revoked',
    revoked_at: '2026-04-26T00:00:00.000Z',
  },
  revokeError = null,
} = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: revokedKey,
    error: revokeError,
  }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'api_client_keys') {
        return { update };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __apiKeyRevokeMocks: {
      update,
      eq,
      select,
      maybeSingle,
    },
  };
}

function createApiKeyDeleteAdminClient({
  role = 'super_admin',
  deletedKey = {
    id: 'key-1',
    client_id: 'client-1',
    key_prefix: 'egk_test_prefix',
    label: 'primary',
    status: 'revoked',
  },
  deleteError = null,
} = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: deletedKey,
    error: deleteError,
  }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const deleteMethod = vi.fn(() => ({ eq }));

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'api_client_keys') {
        return { delete: deleteMethod };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __apiKeyDeleteMocks: {
      deleteMethod,
      eq,
      select,
      maybeSingle,
    },
  };
}

class ApiClientReviewQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = 'select';
    this.patch = null;
    this.insertPayload = null;
    this.filters = [];
    this.limitValue = null;
  }

  select() {
    return this;
  }

  update(patch) {
    this.operation = 'update';
    this.patch = patch;
    return this;
  }

  insert(payload) {
    this.operation = 'insert';
    this.insertPayload = payload;
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.client.__executeApiReviewQuery(this, { maybeSingle: true }));
  }

  single() {
    return Promise.resolve(this.client.__executeApiReviewQuery(this, { maybeSingle: true }));
  }

  then(resolve, reject) {
    return Promise.resolve(this.client.__executeApiReviewQuery(this)).then(resolve, reject);
  }
}

function matchesApiReviewFilters(row, filters) {
  return filters.every((filter) => row?.[filter.field] === filter.value);
}

function createApiClientReviewAdminClient({
  role = 'super_admin',
  clientRow = {
    id: 'client-1',
    owner_user_id: 'developer-user-id',
    client_type: 'developer',
    provider: null,
    name: 'Review Target App',
    use_case: 'Read public analytics',
    status: 'pending',
    requested_scopes: ['public.read'],
    granted_scopes: [],
    rate_limit_tier: 'default',
    review_note: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-06-08T01:00:00.000Z',
    updated_at: '2026-06-08T01:00:00.000Z',
  },
  ownerProfile = {
    id: 'developer-user-id',
    username: 'developer',
    email: 'developer.owner@example.com',
    role: 'user',
  },
  activeKeys = [],
  mailRuntimeConfig = null,
} = {}) {
  const state = {
    profiles: [
      { id: 'super-admin-id', username: 'admin', email: 'admin@example.com', role },
      ownerProfile,
    ],
    apiClients: [clientRow],
    apiClientKeys: activeKeys,
    siteConfig: mailRuntimeConfig
      ? [{
        key: 'mail_runtime_config',
        value: JSON.stringify(mailRuntimeConfig),
        updated_at: '2026-06-12T00:00:00.000Z',
        updated_by: 'super-admin-id',
      }]
      : [],
    calls: [],
  };

  const adminClient = {
    state,
    from: vi.fn((table) => new ApiClientReviewQuery(adminClient, table)),
    __executeApiReviewQuery(query, { maybeSingle = false } = {}) {
      state.calls.push({
        table: query.table,
        operation: query.operation,
        filters: query.filters,
        patch: query.patch,
        insertPayload: query.insertPayload,
      });

      if (query.table === 'profiles') {
        const rows = state.profiles.filter((row) => matchesApiReviewFilters(row, query.filters));
        return { data: maybeSingle ? rows[0] || null : rows, error: null };
      }

      if (query.table === 'api_clients') {
        if (query.operation === 'update') {
          const updatedRows = [];
          state.apiClients = state.apiClients.map((row) => {
            if (!matchesApiReviewFilters(row, query.filters)) {
              return row;
            }

            const updatedRow = { ...row, ...query.patch };
            updatedRows.push(updatedRow);
            return updatedRow;
          });
          return { data: maybeSingle ? updatedRows[0] || null : updatedRows, error: null };
        }

        const rows = state.apiClients
          .filter((row) => matchesApiReviewFilters(row, query.filters))
          .slice(0, query.limitValue || state.apiClients.length);
        return { data: maybeSingle ? rows[0] || null : rows, error: null };
      }

      if (query.table === 'api_client_keys') {
        if (query.operation === 'insert') {
          const inserted = {
            id: 'created-key-1',
            client_id: query.insertPayload.client_id,
            key_prefix: query.insertPayload.key_prefix,
            label: query.insertPayload.label,
            status: query.insertPayload.status,
            last_used_at: null,
            expires_at: null,
            created_at: '2026-06-08T01:05:00.000Z',
            revoked_at: null,
            secret_revealed_at: query.insertPayload.secret_revealed_at,
          };
          state.apiClientKeys.push(inserted);
          return { data: maybeSingle ? inserted : [inserted], error: null };
        }

        if (query.operation === 'update') {
          const updatedRows = [];
          state.apiClientKeys = state.apiClientKeys.map((row) => {
            if (!matchesApiReviewFilters(row, query.filters)) {
              return row;
            }

            const updatedRow = { ...row, ...query.patch };
            updatedRows.push(updatedRow);
            return updatedRow;
          });
          return { data: maybeSingle ? updatedRows[0] || null : updatedRows, error: null };
        }

        const rows = state.apiClientKeys
          .filter((row) => matchesApiReviewFilters(row, query.filters))
          .slice(0, query.limitValue || state.apiClientKeys.length);
        return { data: maybeSingle ? rows[0] || null : rows, error: null };
      }

      if (query.table === 'site_config') {
        const rows = state.siteConfig
          .filter((row) => matchesApiReviewFilters(row, query.filters))
          .slice(0, query.limitValue || state.siteConfig.length);
        return { data: maybeSingle ? rows[0] || null : rows, error: null };
      }

      throw new Error(`Unexpected table: ${query.table}`);
    },
  };

  return adminClient;
}

function createRecoveryPasswordResetAdminClient({
  role = 'super_admin',
  recoveryRequest = {
    id: 'recovery-1',
    matched_user_id: 'target-user-id',
    request_type: 'password_reset',
    status: 'verified',
    admin_note: 'verified offline',
    recovery_audit: {
      version: 1,
      events: [
        {
          type: 'request_received',
          at: '2026-05-24T00:00:00.000Z',
        },
      ],
    },
  },
  requestSelectError = null,
  updateAuthError = null,
  securityStateError = null,
  requestUpdateError = null,
} = {}) {
  const requestSingle = vi.fn(async () => ({
    data: recoveryRequest,
    error: requestSelectError,
  }));
  const requestSelectEq = vi.fn(() => ({ single: requestSingle }));
  const requestSelect = vi.fn(() => ({ eq: requestSelectEq }));
  const requestUpdateEq = vi.fn(async () => ({ error: requestUpdateError }));
  const requestUpdate = vi.fn(() => ({ eq: requestUpdateEq }));

  const securityUpsert = vi.fn(async () => ({ error: securityStateError }));

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return createProfilesQuery(role);
      }

      if (table === 'account_recovery_requests') {
        return {
          select: requestSelect,
          update: requestUpdate,
        };
      }

      if (table === 'account_security_states') {
        return {
          upsert: securityUpsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    auth: {
      admin: {
        updateUserById: vi.fn(async () => ({ error: updateAuthError })),
      },
    },
    __recoveryResetMocks: {
      requestSelect,
      requestSelectEq,
      requestSingle,
      requestUpdate,
      requestUpdateEq,
      securityUpsert,
    },
  };
}

function createRequest({
  method = 'GET',
  url = 'https://example.com/api/admin-users',
  body,
  headers = {},
} = {}) {
  return {
    method,
    url,
    body,
    headers,
  };
}

describe('api/admin handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_ALERT_MAIL_OUTBOX_ENABLED;
    delete process.env.DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED;
    delete process.env.MAIL_OUTBOX_WORKER_ENABLED;
    delete process.env.MAIL_WORKER_ENABLED;
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'super-admin-id' } },
          error: null,
        })),
      },
    });
    mocks.getSupabaseAnonServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'super-admin-id' } },
          error: null,
        })),
      },
    });
    mocks.findAuthUserByEmail.mockResolvedValue(null);
    mocks.revokeAllSiteSessionsForUser.mockResolvedValue({ ok: true, revokedCount: 2 });
    mocks.requireSuperAdminUser.mockImplementation(async (_req, { adminClient }) => ({
      ok: true,
      user: { id: 'super-admin-id' },
      profile: { id: 'super-admin-id', role: 'super_admin' },
      adminClient,
    }));
  });

  it('returns merged users for the users route', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.listMergedAdminUsers.mockResolvedValue([
      { id: 'user-1', email: 'one@example.com' },
      { id: 'user-2', email: 'two@example.com' },
    ]);

    const req = createRequest({
      method: 'GET',
      url: 'https://example.com/api/admin-users',
      headers: { authorization: 'Bearer token' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.listMergedAdminUsers).toHaveBeenCalledWith(adminClient, { repairProfiles: true });
    expect(res.body).toEqual({
      success: true,
      users: [
        { id: 'user-1', email: 'one@example.com' },
        { id: 'user-2', email: 'two@example.com' },
      ],
    });
  });

  it('loads a target user data sample through the admin user-data route', async () => {
    const adminClient = createAdminUserDataClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'GET',
      url: 'https://example.com/api/admin?route=user-data&userId=target-user-id',
      headers: { authorization: 'Bearer token' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith('pools');
    expect(adminClient.from).toHaveBeenCalledWith('history');
    expect(adminClient.__userDataState.poolFilters).toContainEqual({
      column: 'user_id',
      value: 'target-user-id',
    });
    expect(adminClient.__userDataState.historyFilters).toContainEqual({
      column: 'user_id',
      value: 'target-user-id',
    });
    expect(res.body).toMatchObject({
      success: true,
      userId: 'target-user-id',
      pools: [
        expect.objectContaining({
          pool_id: 'pool-1',
          user_id: 'target-user-id',
        }),
      ],
      history: [
        expect.objectContaining({
          record_id: 1,
          user_id: 'target-user-id',
        }),
      ],
      historyMeta: {
        sampleLimit: 500,
        totalCount: 11,
        loadedCount: 1,
        isTruncated: true,
      },
    });
  });

  it('deletes only target pool records through the admin user-data route', async () => {
    const adminClient = createAdminUserDataClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'DELETE',
      url: 'https://example.com/api/admin?route=user-data',
      headers: { authorization: 'Bearer token' },
      body: {
        action: 'purgePoolRecords',
        userId: 'target-user-id',
        poolId: 'pool-1',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__userDataState.deleteCalls).toEqual([
      {
        table: 'history',
        filters: [
          { column: 'user_id', value: 'target-user-id' },
          { column: 'pool_id', value: 'pool-1' },
        ],
      },
    ]);
    expect(res.body).toMatchObject({
      success: true,
      action: 'purgePoolRecords',
      deleted: {
        history: true,
        pools: false,
      },
    });
  });

  it('deletes a target pool and its records through the admin user-data route', async () => {
    const adminClient = createAdminUserDataClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'DELETE',
      url: 'https://example.com/api/admin-user-data',
      headers: { authorization: 'Bearer token' },
      body: {
        action: 'deletePool',
        userId: 'target-user-id',
        poolId: 'pool-1',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__userDataState.deleteCalls).toEqual([
      {
        table: 'history',
        filters: [
          { column: 'user_id', value: 'target-user-id' },
          { column: 'pool_id', value: 'pool-1' },
        ],
      },
      {
        table: 'pools',
        filters: [
          { column: 'user_id', value: 'target-user-id' },
          { column: 'pool_id', value: 'pool-1' },
        ],
      },
    ]);
    expect(res.body).toMatchObject({
      success: true,
      action: 'deletePool',
      poolId: 'pool-1',
      deleted: {
        history: true,
        pools: true,
      },
    });
  });

  it('rejects admin user-data deletion without required pool id', async () => {
    const adminClient = createAdminUserDataClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'DELETE',
      url: 'https://example.com/api/admin?route=user-data',
      headers: { authorization: 'Bearer token' },
      body: {
        action: 'deletePool',
        userId: 'target-user-id',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Pool ID is required',
    });
    expect(adminClient.__userDataState.deleteCalls).toEqual([]);
  });

  it('rejects deleting the current super admin', async () => {
    mocks.getSupabaseAdminClient.mockReturnValue(createAdminClient());

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-delete-user',
      headers: { authorization: 'Bearer token' },
      body: { userId: 'super-admin-id' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Cannot delete current super admin',
    });
  });

  it('cleans up foreign keys before deleting a user', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-delete-user',
      headers: { authorization: 'Bearer token' },
      body: { userId: 'target-user-id' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith('announcements');
    expect(adminClient.from).toHaveBeenCalledWith('site_config');
    expect(adminClient.from).toHaveBeenCalledWith('puzzles');
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith('target-user-id');
    expect(res.body).toEqual({
      success: true,
      userId: 'target-user-id',
    });
  });

  it('syncs a synthetic OAuth auth email from the profile when issuing a temporary password', async () => {
    const targetProfile = {
      id: 'target-user-id',
      email: 'github-user@example.com',
    };
    const adminClient = {
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return createProfilesQuery('super_admin', {
            'target-user-id': targetProfile,
          });
        }
        if (table === 'account_security_states') {
          return createAccountSecurityStateQuery();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: {
              user: {
                id: 'target-user-id',
                email: 'github.abcdef1234567890@oauth.local.invalid',
                user_metadata: {
                  synthetic_oauth_email: true,
                  auth_provider: 'github',
                  username: 'github-user',
                },
              },
            },
            error: null,
          })),
          listUsers: vi.fn(async () => ({
            data: { users: [] },
            error: null,
          })),
          updateUserById: vi.fn(async () => ({ error: null })),
        },
      },
    };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-user-reset-password',
      headers: { authorization: 'Bearer token' },
      body: {
        userId: 'target-user-id',
        temporaryPassword: 'TempPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.findAuthUserByEmail).toHaveBeenCalledWith(adminClient, 'github-user@example.com');
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('target-user-id', expect.objectContaining({
      password: 'TempPass123',
      email: 'github-user@example.com',
      email_confirm: true,
      app_metadata: expect.objectContaining({
        temporary_password_issue_id: expect.any(String),
        temporary_password_force_change: true,
        temporary_password_issued_at: expect.any(String),
        temporary_password_expires_at: expect.any(String),
      }),
      user_metadata: {
        synthetic_oauth_email: false,
        auth_provider: 'github',
        username: 'github-user',
        email_bound_from_profile: true,
      },
    }));
    expect(res.body).toEqual({
      success: true,
      userId: 'target-user-id',
      emailSynced: true,
    });
  });

  it('rejects temporary password email sync when the profile email belongs to another auth account', async () => {
    const adminClient = {
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return createProfilesQuery('super_admin', {
            'target-user-id': {
              id: 'target-user-id',
              email: 'github-user@example.com',
            },
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: {
              user: {
                id: 'target-user-id',
                email: 'github.abcdef1234567890@oauth.local.invalid',
                user_metadata: {
                  synthetic_oauth_email: true,
                },
              },
            },
            error: null,
          })),
          listUsers: vi.fn(async () => ({
            data: { users: [] },
            error: null,
          })),
          updateUserById: vi.fn(async () => ({ error: null })),
        },
      },
    };
    mocks.findAuthUserByEmail.mockResolvedValue({
      id: 'other-user-id',
      email: 'github-user@example.com',
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-user-reset-password',
      headers: { authorization: 'Bearer token' },
      body: {
        userId: 'target-user-id',
        temporaryPassword: 'TempPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      success: false,
      error: 'Profile email is already used by another auth account',
      code: 'auth_email_already_used',
    });
  });

  it('rejects a too-simple temporary password from the admin reset route', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-user-reset-password',
      headers: { authorization: 'Bearer token' },
      body: {
        userId: 'target-user-id',
        temporaryPassword: 'abcdefgh',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Temporary password must include at least two character groups',
    });
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('accepts a policy-compliant temporary password from the admin reset route', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-user-reset-password',
      headers: { authorization: 'Bearer token' },
      body: {
        userId: 'target-user-id',
        temporaryPassword: 'TempPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('target-user-id', expect.objectContaining({
      password: 'TempPass123',
      app_metadata: expect.objectContaining({
        temporary_password_issue_id: expect.any(String),
        temporary_password_force_change: true,
        temporary_password_issued_at: expect.any(String),
        temporary_password_expires_at: expect.any(String),
      }),
    }));
    expect(res.body).toEqual({
      success: true,
      userId: 'target-user-id',
      emailSynced: false,
    });
  });

  it('reports partial success when password reset succeeds but session revocation fails', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.revokeAllSiteSessionsForUser.mockResolvedValue({
      ok: false,
      code: 'site_session_revoke_failed',
      reason: 'session database unavailable',
    });
    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-user-reset-password',
      headers: { authorization: 'Bearer token' },
      body: {
        userId: 'target-user-id',
        temporaryPassword: 'TempPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      partial: true,
      passwordUpdated: true,
      userId: 'target-user-id',
      code: 'site_session_revoke_failed',
    });
  });

  it('updates mail runtime config without exposing secrets or bypassing env hard gates', async () => {
    process.env.MAIL_OUTBOX_WORKER_ENABLED = 'false';
    process.env.AUTH_MAIL_ACTIONS_ENABLED = 'false';
    process.env.ADMIN_ALERT_MAIL_OUTBOX_ENABLED = 'false';
    process.env.MAIL_OUTBOX_GLOBAL_KILL_SWITCH = 'true';
    const adminClient = createMailRuntimeConfigAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-mail-runtime-config',
      headers: { authorization: 'Bearer token' },
      body: {
        events: {
          authMailActions: true,
          adminAlert: true,
          ticketReply: false,
        },
        controls: {
          killSwitch: false,
          disabledEvents: ['email_login', 'password_reset'],
          pausedDomains: ['Example.COM'],
        },
        note: 'runtime test',
        smtpPassword: 'must-not-save',
        webhookSecret: 'must-not-save',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__mailRuntimeMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'mail_runtime_config',
        label: '邮件运行期开关',
        category: 'system',
        updated_by: 'super-admin-id',
      }),
      { onConflict: 'key' },
    );
    expect(res.body).toMatchObject({
      success: true,
      runtime: {
        controls: {
          killSwitch: true,
          envKillSwitch: true,
          runtimeKillSwitch: 'disabled',
          disabledEvents: expect.arrayContaining(['email_login', 'password_reset']),
          pausedDomains: expect.arrayContaining(['example.com']),
        },
        events: {
          authMailActions: {
            envEnabled: false,
            runtime: 'enabled',
            effective: false,
          },
          adminAlert: {
            envEnabled: false,
            runtime: 'enabled',
            effective: false,
          },
          ticketReply: {
            runtime: 'disabled',
            effective: false,
          },
        },
      },
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('must-not-save');
    expect(serialized).not.toContain('smtpPassword');
    expect(serialized).not.toContain('webhookSecret');
  });

  it('loads site config from the super admin route', async () => {
    const adminClient = createSiteConfigAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'GET',
      url: 'https://example.com/api/admin?route=site-config',
      headers: { authorization: 'Bearer token' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith('site_config');
    expect(res.body).toMatchObject({
      success: true,
      items: [
        {
          key: 'author_name',
          value: 'MoguJun',
          label: '作者名',
          category: 'social',
        },
      ],
    });
  });

  it('updates site config from the super admin route', async () => {
    const adminClient = createSiteConfigAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=site-config',
      headers: { authorization: 'Bearer token' },
      body: {
        key: 'author_name',
        value: 'New Name',
        label: '作者名',
        category: 'social',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      item: {
        key: 'author_name',
        value: 'New Name',
        label: '作者名',
        category: 'social',
        updated_by: 'super-admin-id',
      },
    });
    expect(adminClient.state.siteConfig[0]).toMatchObject({
      key: 'author_name',
      value: 'New Name',
      updated_by: 'super-admin-id',
    });
  });

  it('rejects invalid site config keys', async () => {
    const adminClient = createSiteConfigAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=site-config',
      headers: { authorization: 'Bearer token' },
      body: {
        key: 'bad key',
        value: 'x',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Invalid site config key',
    });
  });

  it('updates mail budget config from the super admin route', async () => {
    const adminClient = createMailBudgetConfigAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=mail-budget-config',
      headers: { authorization: 'Bearer token' },
      body: {
        item: {
          scope: 'recipient',
          eventType: 'email_login',
          windowSeconds: 1800,
          maxAttempts: 2,
          enabled: false,
        },
        smtpPassword: 'must-not-save',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__mailBudgetMocks.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        scope: 'recipient',
        event_type: 'email_login',
        window_seconds: 1800,
        max_attempts: 2,
        enabled: false,
        updated_by_user_id: 'super-admin-id',
      }),
    ], { onConflict: 'scope,event_type' });
    expect(res.body).toMatchObject({
      success: true,
      updated: [
        {
          scope: 'recipient',
          eventType: 'email_login',
          windowSeconds: 1800,
          maxAttempts: 2,
          enabled: false,
        },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('must-not-save');
  });

  it('rejects invalid mail budget config updates', async () => {
    const adminClient = createMailBudgetConfigAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-mail-budget-config',
      headers: { authorization: 'Bearer token' },
      body: {
        item: {
          scope: 'global',
          eventType: 'password_reset',
          windowSeconds: 30,
          maxAttempts: 0,
        },
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(adminClient.__mailBudgetMocks.upsert).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: false,
      error: 'Global mail budget must use * event type',
    });
  });

  it('reviews a developer API client without enqueueing mail when review mail is disabled', async () => {
    const adminClient = createApiClientReviewAdminClient({
      activeKeys: [
        {
          id: 'key-active-1',
          client_id: 'client-1',
          key_prefix: 'egk_active_prefix',
          label: 'primary',
          status: 'active',
          created_at: '2026-06-08T01:01:00.000Z',
        },
      ],
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-review',
      headers: { authorization: 'Bearer token' },
      body: {
        clientId: 'client-1',
        status: 'active',
        reviewNote: '用途明确，批准 public.read。',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueMailOutboxEvent).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      client: {
        id: 'client-1',
        status: 'active',
        review_note: '用途明确，批准 public.read。',
        granted_scopes: ['public.read'],
      },
      bootstrapKey: null,
      mailNotification: {
        enabled: false,
        attempted: false,
        status: 'disabled',
        code: 'developer_api_review_mail_disabled',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('developer.owner@example.com');
  });

  it('queues a redacted developer API review mail when review mail is enabled', async () => {
    process.env.DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED = 'true';
    process.env.MAIL_OUTBOX_WORKER_ENABLED = 'true';
    mocks.enqueueMailOutboxEvent.mockResolvedValue({
      ok: true,
      queued: true,
      deduped: false,
      action: 'queue',
      code: 'mail_outbox_queued',
      outboxId: 'outbox-1',
      decision: {
        recipient: {
          redacted: 'd***r@example.com',
        },
      },
    });
    const adminClient = createApiClientReviewAdminClient({
      activeKeys: [
        {
          id: 'key-active-1',
          client_id: 'client-1',
          key_prefix: 'egk_active_prefix',
          label: 'primary',
          status: 'active',
          created_at: '2026-06-08T01:01:00.000Z',
        },
      ],
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-review',
      headers: {
        authorization: 'Bearer token',
        'x-forwarded-for': '203.0.113.10',
      },
      body: {
        clientId: 'client-1',
        status: 'rejected',
        reviewNote: '用途描述不足，请补充数据展示位置。',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueMailOutboxEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminClient,
      eventType: 'developer_api_review',
      recipientEmail: 'developer.owner@example.com',
      requesterIp: '203.0.113.10',
      userId: 'developer-user-id',
      templateKey: 'developer-api.review',
      locale: 'zh-CN',
      relatedEntityType: 'api_client',
      relatedEntityId: 'client-1',
      priority: 5,
      payload: expect.objectContaining({
        status: 'rejected',
        previousStatus: 'pending',
        clientName: 'Review Target App',
        clientType: 'developer',
        hasReviewNote: true,
        grantedScopesCount: 0,
        reviewedBy: '[redacted]',
      }),
    }));
    expect(res.body).toMatchObject({
      success: true,
      client: {
        id: 'client-1',
        status: 'rejected',
        review_note: '用途描述不足，请补充数据展示位置。',
        granted_scopes: [],
      },
      mailNotification: {
        enabled: true,
        attempted: true,
        status: 'queued',
        code: 'mail_outbox_queued',
        outboxId: 'outbox-1',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('developer.owner@example.com');
    expect(JSON.stringify(res.body)).not.toContain('d***r@example.com');
    expect(JSON.stringify(res.body)).not.toContain('decision');
  });

  it('keeps developer API review successful when review mail enqueue fails', async () => {
    process.env.DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED = 'true';
    process.env.MAIL_OUTBOX_WORKER_ENABLED = 'true';
    mocks.enqueueMailOutboxEvent.mockRejectedValue(new Error('mail queue unavailable'));
    const adminClient = createApiClientReviewAdminClient({
      activeKeys: [
        {
          id: 'key-active-1',
          client_id: 'client-1',
          key_prefix: 'egk_active_prefix',
          label: 'primary',
          status: 'active',
          created_at: '2026-06-08T01:01:00.000Z',
        },
      ],
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-review',
      headers: { authorization: 'Bearer token' },
      body: {
        clientId: 'client-1',
        status: 'revoked',
        reviewNote: '测试撤销。',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      client: {
        id: 'client-1',
        status: 'revoked',
        review_note: '测试撤销。',
        granted_scopes: [],
      },
      mailNotification: {
        enabled: true,
        attempted: true,
        status: 'error',
        code: 'mail_enqueue_exception',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('mail queue unavailable');
    expect(JSON.stringify(res.body)).not.toContain('developer.owner@example.com');
  });

  it('revokes one developer API key from the admin route', async () => {
    const adminClient = createApiKeyRevokeAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-revoke-key',
      headers: { authorization: 'Bearer token' },
      body: { keyId: 'key-1' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith('api_client_keys');
    expect(adminClient.__apiKeyRevokeMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'revoked',
      revoked_at: expect.any(String),
    }));
    expect(adminClient.__apiKeyRevokeMocks.eq).toHaveBeenCalledWith('id', 'key-1');
    expect(res.body).toMatchObject({
      success: true,
      key: {
        id: 'key-1',
        client_id: 'client-1',
        key_prefix: 'egk_test_prefix',
        status: 'revoked',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('key_hash');
  });

  it('rejects API key revoke without keyId', async () => {
    mocks.getSupabaseAdminClient.mockReturnValue(createApiKeyRevokeAdminClient());

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-revoke-key',
      headers: { authorization: 'Bearer token' },
      body: {},
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Missing keyId',
    });
  });

  it('deletes one developer API key from the admin route', async () => {
    const adminClient = createApiKeyDeleteAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-delete-key',
      headers: { authorization: 'Bearer token' },
      body: { keyId: 'key-1' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith('api_client_keys');
    expect(adminClient.__apiKeyDeleteMocks.deleteMethod).toHaveBeenCalled();
    expect(adminClient.__apiKeyDeleteMocks.eq).toHaveBeenCalledWith('id', 'key-1');
    expect(adminClient.__apiKeyDeleteMocks.select).toHaveBeenCalledWith('id, client_id, key_prefix, label, status');
    expect(res.body).toMatchObject({
      success: true,
      key: {
        id: 'key-1',
        client_id: 'client-1',
        key_prefix: 'egk_test_prefix',
        status: 'revoked',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('key_hash');
  });

  it('bumps the public cache epoch from the admin route', async () => {
    const adminClient = createPublicCacheBumpAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-public-cache-bump',
      headers: { authorization: 'Bearer token' },
      body: { scope: 'announcements', reason: 'test:bump' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith('site_config');
    expect(adminClient.__publicCacheMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'public_cache_epoch',
        label: '公共缓存版本',
        category: 'system',
      }),
      { onConflict: 'key' },
    );
    expect(JSON.parse(adminClient.__publicCacheMocks.upsert.mock.calls[0][0].value)).toMatchObject({
      scope: 'announcements',
      reason: 'test:bump',
    });
    expect(res.body).toMatchObject({
      success: true,
      scope: 'announcements',
      reason: 'test:bump',
      cacheVersion: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(adminClient.__publicCacheMocks.rpc).not.toHaveBeenCalled();
  });

  it('refreshes public analytics aggregates when bumping stats cache', async () => {
    const adminClient = createPublicCacheBumpAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-public-cache-bump',
      headers: { authorization: 'Bearer token' },
      body: { scope: 'stats', reason: 'admin:stats-refresh' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__publicCacheMocks.rpc).toHaveBeenCalledWith('refresh_public_analytics_cache');
    expect(res.body).toMatchObject({
      success: true,
      scope: 'stats',
      reason: 'admin:stats-refresh',
      analyticsRefresh: {
        ok: true,
        functionName: 'refresh_public_analytics_cache',
        refreshedPools: 1,
        refreshedTrendRows: 3,
      },
    });
  });

  it('passes manual ops automation options and returns graph metadata', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.runOpsAutomationJobs.mockResolvedValue({
      ok: true,
      partial: true,
      status: 200,
      results: {
        announcements: {
          synced: 1,
          summaryFailed: 1,
        },
      },
      jobGraph: [
        {
          id: 'official-announcements',
          presentationStatus: 'partial',
          retryCount: 1,
          failureType: 'llm',
        },
      ],
    });

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-ops-automation',
      headers: { authorization: 'Bearer token' },
      body: {
        job: 'all',
        forceRefresh: true,
        refreshMode: 'all',
        announcementLimit: 20,
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(mocks.parseRequestedJobIds).toHaveBeenCalledWith('all');
    expect(mocks.runOpsAutomationJobs).toHaveBeenCalledWith(expect.objectContaining({
      requestedJobIds: ['official-announcements'],
      triggerType: 'manual',
      createdBy: 'super-admin-id',
      forceRefresh: true,
      refreshMode: 'all',
      announcementLimit: 20,
    }));
    expect(mocks.buildOpsAutomationHttpPayload).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      partial: true,
      jobGraph: expect.any(Array),
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      partial: true,
      announcements: {
        synced: 1,
        summaryFailed: 1,
      },
      jobGraph: [
        {
          id: 'official-announcements',
          presentationStatus: 'partial',
          retryCount: 1,
          failureType: 'llm',
        },
      ],
    });
  });

  it('returns redacted site health from the admin route', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.buildAdminSiteHealth.mockResolvedValue({
      ok: true,
      generatedAt: '2026-06-08T04:05:06.000Z',
      overall: {
        level: 'notice',
        label: '有待处理事项',
        attentionCount: 2,
      },
      content: {
        ok: true,
        items: [
          {
            key: 'announcements',
            label: '公告',
            latestAt: '2026-06-08T04:00:00.000Z',
            latest: { title: '版本更新' },
          },
        ],
      },
      mail: {
        ok: true,
        config: {
          workerEnabled: false,
          killSwitch: true,
          dryRun: true,
          stalwartSmtpConfigured: true,
          deliveryFeedbackSecretConfigured: true,
        },
        outbox: {
          countsByStatus: {
            queued: 1,
            failed: 0,
          },
        },
      },
      warnings: [],
    });

    const req = createRequest({
      method: 'GET',
      url: 'https://example.com/api/admin-site-health',
      headers: { authorization: 'Bearer token' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.buildAdminSiteHealth).toHaveBeenCalledWith({ adminClient });
    expect(res.body).toMatchObject({
      success: true,
      health: {
        ok: true,
        overall: {
          level: 'notice',
          attentionCount: 2,
        },
        mail: {
          config: {
            stalwartSmtpConfigured: true,
            deliveryFeedbackSecretConfigured: true,
          },
        },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('smtp-password');
    expect(JSON.stringify(res.body)).not.toContain('feedback-secret');
    expect(JSON.stringify(res.body)).not.toContain('raw.user@example.com');
  });

  it('runs the mail outbox worker from the super admin route', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.runMailOutboxWorker.mockResolvedValue({
      ok: true,
      skipped: false,
      code: 'mail_worker_completed',
      dryRun: true,
      stats: {
        loaded: 1,
        processed: 1,
        sent: 0,
        dryRun: 1,
        failed: 0,
        retried: 0,
        skipped: 0,
      },
      results: [],
    });

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-mail-outbox-drain',
      headers: { authorization: 'Bearer token' },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.runMailOutboxWorker).toHaveBeenCalledWith({ adminClient });
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      result: {
        code: 'mail_worker_completed',
        stats: {
          loaded: 1,
          dryRun: 1,
        },
      },
    });
  });

  it('sends a redacted mail smoke test from the super admin route', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.sendMailSmokeTest.mockResolvedValue({
      ok: true,
      skipped: false,
      accepted: true,
      dryRun: true,
      code: 'mail_provider_dry_run',
      providerKey: 'stalwart:dry-run',
      recipient: {
        redacted: 't***r@e***e.com',
        domain: 'example.com',
      },
      deliveryEvent: {
        ok: true,
        eventType: 'smoke_test_dry_run',
      },
    });

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-mail-smoke-test',
      headers: { authorization: 'Bearer token' },
      body: {
        recipientEmail: 'tester@example.com',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.sendMailSmokeTest).toHaveBeenCalledWith({
      adminClient,
      recipientEmail: 'tester@example.com',
      locale: 'zh-CN',
      actorUserId: 'super-admin-id',
    });
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      result: {
        code: 'mail_provider_dry_run',
        providerKey: 'stalwart:dry-run',
        recipient: {
          redacted: 't***r@e***e.com',
        },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('tester@example.com');
    expect(JSON.stringify(res.body)).not.toContain('smtp-password');
  });

  it('does not enqueue admin alert mail when the controlled alert flag is disabled', async () => {
    const adminClient = createApiClientReviewAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-mail-alert',
      headers: { authorization: 'Bearer token' },
      body: {
        summary: '队列检查告警',
        secondary: '存在失败 outbox，需要查看后台。',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueMailOutboxEvent).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      mailNotification: {
        enabled: false,
        attempted: false,
        status: 'disabled',
        code: 'admin_alert_mail_disabled',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('admin@example.com');
  });

  it('queues a redacted admin alert mail to the current super admin only', async () => {
    process.env.ADMIN_ALERT_MAIL_OUTBOX_ENABLED = 'true';
    process.env.MAIL_OUTBOX_WORKER_ENABLED = 'true';
    mocks.enqueueMailOutboxEvent.mockResolvedValue({
      ok: true,
      queued: true,
      deduped: false,
      action: 'queue',
      code: 'mail_outbox_queued',
      outboxId: 'outbox-admin-alert-1',
      decision: {
        recipient: {
          redacted: 'a***n@example.com',
        },
      },
    });
    const adminClient = createApiClientReviewAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-mail-alert',
      headers: {
        authorization: 'Bearer token',
        'x-forwarded-for': '203.0.113.20',
      },
      body: {
        summary: '队列检查告警',
        secondary: '存在失败 outbox，需要查看后台。',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueMailOutboxEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminClient,
      eventType: 'admin_alert',
      recipientEmail: 'admin@example.com',
      requesterIp: '203.0.113.20',
      userId: 'super-admin-id',
      templateKey: 'admin.alert',
      locale: 'zh-CN',
      relatedEntityType: 'profile',
      relatedEntityId: 'super-admin-id',
      priority: 3,
      payload: expect.objectContaining({
        summary: '队列检查告警',
        secondary: '存在失败 outbox，需要查看后台。',
        source: 'admin-mail-status-panel',
      }),
    }));
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      mailNotification: {
        enabled: true,
        attempted: true,
        status: 'queued',
        code: 'mail_outbox_queued',
        outboxId: 'outbox-admin-alert-1',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('admin@example.com');
    expect(JSON.stringify(res.body)).not.toContain('a***n@example.com');
    expect(JSON.stringify(res.body)).not.toContain('decision');
  });

  it('keeps admin alert route redacted when enqueue fails', async () => {
    process.env.ADMIN_ALERT_MAIL_OUTBOX_ENABLED = 'true';
    process.env.MAIL_OUTBOX_WORKER_ENABLED = 'true';
    mocks.enqueueMailOutboxEvent.mockRejectedValue(new Error('smtp password leaked in exception'));
    const adminClient = createApiClientReviewAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=mail-alert',
      headers: { authorization: 'Bearer token' },
      body: {
        summary: '异常告警',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      partial: true,
      mailNotification: {
        enabled: true,
        attempted: true,
        status: 'error',
        code: 'mail_enqueue_exception',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('admin@example.com');
    expect(JSON.stringify(res.body)).not.toContain('smtp password');
  });

  it('sets a recovery temporary password and records force-change metadata', async () => {
    const adminClient = createRecoveryPasswordResetAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-reset-recovery-password',
      headers: { authorization: 'Bearer token' },
      body: {
        requestId: 'recovery-1',
        userId: 'target-user-id',
        temporaryPassword: 'TempPass123',
        adminNote: 'identity verified',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('target-user-id', expect.objectContaining({
      password: 'TempPass123',
      app_metadata: expect.objectContaining({
        temporary_password_issue_id: expect.any(String),
        temporary_password_force_change: true,
        temporary_password_issued_at: expect.any(String),
        temporary_password_expires_at: expect.any(String),
      }),
    }));
    expect(adminClient.__recoveryResetMocks.securityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'target-user-id',
        password_change_required: true,
        password_change_reason: 'account_recovery_temporary_password',
        password_change_source: 'account_recovery',
        password_change_recovery_request_id: 'recovery-1',
        password_change_set_by: 'super-admin-id',
        password_change_requested_at: expect.any(String),
        password_change_expires_at: expect.any(String),
      }),
      { onConflict: 'user_id' },
    );
    expect(adminClient.__recoveryResetMocks.requestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'closed',
      admin_note: expect.stringContaining('identity verified'),
      handled_by: 'super-admin-id',
      delivery_channel: 'manual',
      next_step: 'temporary_password_issued_force_change',
      temporary_password_force_change: true,
      temporary_password_set_by: 'super-admin-id',
      temporary_password_set_at: expect.any(String),
      temporary_password_expires_at: expect.any(String),
      recovery_audit: expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'temporary_password_issued',
            requestId: 'recovery-1',
            forceChangeRequired: true,
            deliveryChannel: 'manual',
            nextStep: 'temporary_password_issued_force_change',
          }),
        ]),
      }),
    }));
    expect(adminClient.__recoveryResetMocks.requestUpdateEq).toHaveBeenCalledWith('id', 'recovery-1');
    expect(res.body).toMatchObject({
      success: true,
      partial: false,
      warnings: [],
      deliveryChannel: 'manual',
      nextStep: 'temporary_password_issued_force_change',
      expiresAt: expect.any(String),
      forceChangeRequired: true,
      securityStateUpdated: true,
      recoveryRequestUpdated: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('TempPass123');
  });

  it('reports partial success when recovery state persistence fails after auth password update', async () => {
    const adminClient = createRecoveryPasswordResetAdminClient({
      securityStateError: new Error('security state unavailable'),
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin-reset-recovery-password',
      headers: { authorization: 'Bearer token' },
      body: {
        requestId: 'recovery-1',
        userId: 'target-user-id',
        temporaryPassword: 'TempPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('target-user-id', expect.objectContaining({
      password: 'TempPass123',
      app_metadata: expect.objectContaining({
        temporary_password_issue_id: expect.any(String),
        temporary_password_force_change: true,
        temporary_password_issued_at: expect.any(String),
        temporary_password_expires_at: expect.any(String),
      }),
    }));
    expect(res.body).toMatchObject({
      success: true,
      partial: true,
      securityStateUpdated: false,
      recoveryRequestUpdated: true,
      warnings: [
        expect.objectContaining({
          code: 'account_security_state_update_failed',
        }),
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('TempPass123');
  });

  it('rejects API key delete without keyId', async () => {
    mocks.getSupabaseAdminClient.mockReturnValue(createApiKeyDeleteAdminClient());

    const req = createRequest({
      method: 'POST',
      url: 'https://example.com/api/admin?route=api-clients-delete-key',
      headers: { authorization: 'Bearer token' },
      body: {},
    });
    const res = createJsonResponseRecorder();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Missing keyId',
    });
  });
});
