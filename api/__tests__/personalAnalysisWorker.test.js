// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  getPersonalAnalysisWorkerConfigFromEnv,
  runPersonalAnalysisWorker,
} from '../_lib/personalAnalysisWorker.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const LEASE_ID = '22222222-2222-4222-8222-222222222222';
const LARGE_REVISION = '90071992547409931234';

function createHistoryRow(overrides = {}) {
  return {
    id: 1,
    user_id: USER_ID,
    record_id: 'record-1',
    pool_id: 'pool-1',
    rarity: 4,
    is_standard: false,
    special_type: null,
    item_name: null,
    timestamp: '2026-08-01T00:00:00.000Z',
    game_uid: 'game-1',
    seq_id: '1',
    server_id: '2',
    server_scope: 'scope-1',
    region: 'cn',
    is_free: false,
    character_id: 'character-1',
    character_name: '角色一',
    nick_name: '博士',
    pity: 1,
    is_new: false,
    batch_id: 'batch-1',
    is_info_book: false,
    edit_version: 1,
    ...overrides,
  };
}

function createPoolRow(overrides = {}) {
  return {
    pool_id: 'pool-1',
    name: '测试卡池',
    type: 'limited_character',
    is_limited_weapon: false,
    locked: false,
    up_character: null,
    ...overrides,
  };
}

function createAdminClient({
  claimed = { ownerJobs: [], scopeJobs: [] },
  history = [],
  pools = [],
  characters = [],
  poolAliases = [],
  characterAliases = [],
  publishOwner = true,
  publishScope = true,
} = {}) {
  const queryLog = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.limitValue = null;
      this.rangeValue = null;
      this.columns = '';
      queryLog.push(this);
    }

    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.filters.push(['eq', column, value]); return this; }
    gt(column, value) { this.filters.push(['gt', column, value]); return this; }
    in(column, values) { this.filters.push(['in', column, values]); return this; }
    or(value) { this.filters.push(['or', value]); return this; }
    order() { return this; }
    limit(value) { this.limitValue = value; return this; }
    range(from, to) { this.rangeValue = [from, to]; return this; }

    execute() {
      let data;
      if (this.table === 'history') data = history;
      else if (this.table === 'pools') data = pools;
      else if (this.table === 'characters') data = characters;
      else if (this.table === 'pool_id_aliases') data = poolAliases;
      else if (this.table === 'character_id_aliases') data = characterAliases;
      else data = [];

      this.filters.forEach(([operator, column, value]) => {
        if (operator === 'eq') data = data.filter((row) => row?.[column] === value);
        if (operator === 'gt') data = data.filter((row) => row?.[column] > value);
        if (operator === 'in') data = data.filter((row) => value.includes(row?.[column]));
        if (operator === 'or' && column === 'game_uid.is.null,game_uid.eq.') {
          data = data.filter((row) => row?.game_uid == null || row?.game_uid === '');
        }
      });
      if (this.table === 'history') {
        data = [...data].sort((left, right) => Number(left.id) - Number(right.id));
      }
      if (this.rangeValue !== null) {
        data = data.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      }
      if (this.limitValue !== null) data = data.slice(0, this.limitValue);
      return { data, error: null };
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  const rpc = vi.fn(async (name) => {
    if (name === 'enqueue_personal_analysis_backfill') {
      return {
        data: {
          processedUsers: 1,
          insertedOwnerStates: 1,
          insertedScopeStates: 1,
          nextUserId: USER_ID,
          hasMore: true,
        },
        error: null,
      };
    }
    if (name === 'claim_personal_analysis_jobs') return { data: claimed, error: null };
    if (name === 'publish_personal_analysis_owner_snapshot') {
      return { data: publishOwner, error: null };
    }
    if (name === 'publish_personal_analysis_scope_snapshots') {
      return { data: publishScope, error: null };
    }
    if (name === 'fail_personal_analysis_job') return { data: true, error: null };
    return { data: null, error: new Error(`Unexpected RPC: ${name}`) };
  });

  return {
    client: {
      from: vi.fn((table) => new Query(table)),
      rpc,
    },
    queryLog,
    rpc,
  };
}

function enabledConfig(overrides = {}) {
  return {
    enabled: true,
    backfillEnabled: true,
    batchSize: 1,
    backfillBatchSize: 100,
    leaseSeconds: 50,
    historyPageSize: 1000,
    maxHistoryPages: 100,
    ...overrides,
  };
}

describe('personal analysis worker', () => {
  it('is disabled by default and clamps environment configuration', async () => {
    const adminClient = { rpc: vi.fn(), from: vi.fn() };
    const result = await runPersonalAnalysisWorker({ adminClient, config: { enabled: false } });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      code: 'personal_analysis_worker_disabled',
    });
    expect(adminClient.rpc).not.toHaveBeenCalled();
    expect(getPersonalAnalysisWorkerConfigFromEnv({
      PERSONAL_ANALYSIS_WORKER_ENABLED: 'true',
      PERSONAL_ANALYSIS_WORKER_BATCH_SIZE: '99',
      PERSONAL_ANALYSIS_WORKER_BACKFILL_BATCH_SIZE: '999',
      PERSONAL_ANALYSIS_WORKER_LEASE_SECONDS: '1',
      PERSONAL_ANALYSIS_WORKER_HISTORY_PAGE_SIZE: '2000',
    })).toMatchObject({
      enabled: true,
      batchSize: 5,
      backfillBatchSize: 500,
      leaseSeconds: 30,
      historyPageSize: 1000,
      historyPageConcurrency: 2,
      maxHistoryPages: 100,
    });
  });

  it('runs backfill before claiming with exact RPC parameter names', async () => {
    const { client, rpc } = createAdminClient();
    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig({ batchSize: 3, backfillBatchSize: 123, leaseSeconds: 240 }),
      leaseId: LEASE_ID,
    });

    expect(rpc.mock.calls.slice(0, 2)).toEqual([
      ['enqueue_personal_analysis_backfill', {
        p_after_user_id: null,
        p_limit: 123,
      }],
      ['claim_personal_analysis_jobs', {
        p_lease_id: LEASE_ID,
        p_limit: 3,
        p_lease_seconds: 55,
      }],
    ]);
    expect(result.backfill).toEqual({
      processedUsers: 1,
      insertedOwnerStates: 1,
      insertedScopeStates: 1,
      hasMore: true,
    });
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });

  it('skips the expensive history backfill during regular scheduled runs', async () => {
    const { client, rpc } = createAdminClient();
    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig({ backfillEnabled: false }),
      leaseId: LEASE_ID,
    });

    expect(rpc.mock.calls[0]).toEqual([
      'claim_personal_analysis_jobs',
      {
        p_lease_id: LEASE_ID,
        p_limit: 1,
        p_lease_seconds: 50,
      },
    ]);
    expect(rpc).not.toHaveBeenCalledWith(
      'enqueue_personal_analysis_backfill',
      expect.any(Object)
    );
    expect(result.backfill).toEqual({
      processedUsers: 0,
      insertedOwnerStates: 0,
      insertedScopeStates: 0,
      hasMore: false,
    });
  });

  it('loads one user once and publishes owner plus every matching account scope', async () => {
    const claimed = {
      ownerJobs: [{
        userId: USER_ID,
        historyRevision: LARGE_REVISION,
        analysisSchemaVersion: 1,
      }],
      scopeJobs: [{
        userId: USER_ID,
        scopeGameUid: 'game-1',
        serverScope: 'scope-1',
        historyRevision: LARGE_REVISION,
        analysisSchemaVersion: 1,
      }],
    };
    const history = [
      createHistoryRow({
        id: 1,
        record_id: 'record-1',
        pool_id: 'raw-pool',
        server_id: '2',
        region: 'intl',
      }),
      createHistoryRow({
        id: 2,
        record_id: 'record-2',
        pool_id: 'raw-pool',
        server_id: '3',
        region: 'intl',
        seq_id: '2',
      }),
    ];
    const { client, queryLog, rpc } = createAdminClient({
      claimed,
      history,
      pools: [createPoolRow({ pool_id: 'pool-1' })],
      characters: [{
        id: 'character-1',
        name: '角色一',
        rarity: 4,
        type: 'character',
        aliases: [],
      }],
      poolAliases: [{
        id: 1,
        source: 'official_api',
        alias_id: 'raw-pool',
        pool_id: 'pool-1',
        is_primary: true,
      }],
    });

    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig(),
      leaseId: LEASE_ID,
    });

    expect(queryLog.filter((query) => query.table === 'history')).toHaveLength(2);
    expect(queryLog.filter((query) => query.table === 'pools')).toHaveLength(1);
    expect(queryLog.filter((query) => query.table === 'characters')).toHaveLength(1);
    expect(queryLog.find((query) => query.table === 'pools').filters).toContainEqual([
      'in',
      'pool_id',
      ['pool-1'],
    ]);

    const ownerCall = rpc.mock.calls.find(([name]) => (
      name === 'publish_personal_analysis_owner_snapshot'
    ));
    const scopeCall = rpc.mock.calls.find(([name]) => (
      name === 'publish_personal_analysis_scope_snapshots'
    ));
    expect(ownerCall[1]).toMatchObject({
      p_user_id: USER_ID,
      p_input_revision: LARGE_REVISION,
      p_analysis_schema_version: 2,
      p_lease_id: LEASE_ID,
    });
    expect(ownerCall[1].p_payload.accounts).toHaveLength(2);
    expect(scopeCall[1]).toMatchObject({
      p_user_id: USER_ID,
      p_scope_game_uid: 'game-1',
      p_server_scope: 'scope-1',
      p_input_revision: LARGE_REVISION,
      p_analysis_schema_version: 2,
      p_lease_id: LEASE_ID,
    });
    expect(scopeCall[1].p_snapshots).toHaveLength(2);
    expect(scopeCall[1].p_snapshots.every((snapshot) => (
      snapshot.scopeKey && snapshot.payload && !('history' in snapshot.payload)
    ))).toBe(true);
    expect(result.stats).toEqual({
      claimedOwner: 1,
      claimedScope: 1,
      succeeded: 2,
      stale: 0,
      failed: 0,
    });
  });

  it('pages by internal id without dropping duplicate record ids across scopes', async () => {
    const { client, queryLog, rpc } = createAdminClient({
      claimed: {
        ownerJobs: [{
          userId: USER_ID,
          historyRevision: '12',
          analysisSchemaVersion: 1,
        }],
        scopeJobs: [],
      },
      history: [
        createHistoryRow({ id: 1, record_id: 'duplicate', server_scope: 'scope-1', seq_id: '1' }),
        createHistoryRow({ id: 2, record_id: 'duplicate', server_scope: 'scope-2', server_id: '3', seq_id: '2' }),
      ],
      pools: [createPoolRow()],
    });

    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig({ historyPageSize: 1, maxHistoryPages: 5 }),
      leaseId: LEASE_ID,
    });

    const ownerCall = rpc.mock.calls.find(([name]) => (
      name === 'publish_personal_analysis_owner_snapshot'
    ));
    expect(queryLog.filter((query) => query.table === 'history')).toHaveLength(4);
    expect(ownerCall[1].p_payload.summary.total).toBe(2);
    expect(result.stats.succeeded).toBe(1);
  });

  it('publishes an empty scope array so obsolete snapshots can be deleted', async () => {
    const { client, rpc } = createAdminClient({
      claimed: {
        ownerJobs: [],
        scopeJobs: [{
          userId: USER_ID,
          scopeGameUid: 'missing-game',
          serverScope: 'missing-scope',
          historyRevision: '7',
          analysisSchemaVersion: 1,
        }],
      },
      history: [createHistoryRow()],
      pools: [createPoolRow()],
      characters: [],
    });

    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig(),
      leaseId: LEASE_ID,
    });

    const publishCall = rpc.mock.calls.find(([name]) => (
      name === 'publish_personal_analysis_scope_snapshots'
    ));
    expect(publishCall[1].p_snapshots).toEqual([]);
    expect(result.stats.succeeded).toBe(1);
  });

  it('does not mark a scope fresh when legacy identity folding drops live history', async () => {
    const { client, rpc } = createAdminClient({
      claimed: {
        ownerJobs: [],
        scopeJobs: [{
          userId: USER_ID,
          scopeGameUid: 'legacy',
          serverScope: '9',
          historyRevision: '7',
          analysisSchemaVersion: 1,
        }],
      },
      history: [
        createHistoryRow({
          id: 1,
          record_id: 'legacy-9',
          game_uid: null,
          server_scope: '9',
          server_id: '9',
          timestamp: '2026-08-01T00:00:00.000Z',
        }),
        createHistoryRow({
          id: 2,
          record_id: 'legacy-10',
          game_uid: null,
          server_scope: '10',
          server_id: '10',
          timestamp: '2026-08-02T00:00:00.000Z',
        }),
      ],
      pools: [createPoolRow()],
    });

    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig(),
      leaseId: LEASE_ID,
    });

    expect(result.stats).toMatchObject({ succeeded: 0, failed: 1 });
    expect(result.results).toContainEqual({
      kind: 'scope',
      status: 'failed',
      code: 'personal_analysis_scope_identity_mismatch',
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'publish_personal_analysis_scope_snapshots',
      expect.any(Object)
    );
    expect(rpc).toHaveBeenCalledWith(
      'fail_personal_analysis_job',
      expect.objectContaining({
        p_kind: 'scope',
        p_error_code: 'personal_analysis_scope_identity_mismatch',
      })
    );
  });

  it('counts a false publish as stale instead of failed', async () => {
    const { client, rpc } = createAdminClient({
      claimed: {
        ownerJobs: [{
          userId: USER_ID,
          historyRevision: '8',
          analysisSchemaVersion: 1,
        }],
        scopeJobs: [],
      },
      history: [createHistoryRow()],
      pools: [createPoolRow()],
      publishOwner: false,
    });

    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig(),
      leaseId: LEASE_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      stats: { succeeded: 0, stale: 1, failed: 0 },
    });
    expect(rpc.mock.calls.some(([name]) => name === 'fail_personal_analysis_job')).toBe(false);
  });

  it('fails every affected job with a controlled code and leaks no private identifier', async () => {
    const buildError = new Error(`private build details for ${USER_ID}`);
    buildError.code = 'snapshot build/failed';
    const brokenCharacter = {
      id: 'character-1',
      name: '角色一',
      get aliases() { throw buildError; },
    };
    const { client, rpc } = createAdminClient({
      claimed: {
        ownerJobs: [{
          userId: USER_ID,
          historyRevision: '9',
          analysisSchemaVersion: 1,
        }],
        scopeJobs: [{
          userId: USER_ID,
          scopeGameUid: 'game-1',
          serverScope: 'scope-1',
          historyRevision: '9',
          analysisSchemaVersion: 1,
        }],
      },
      history: [createHistoryRow()],
      pools: [createPoolRow()],
      characters: [brokenCharacter],
    });

    const result = await runPersonalAnalysisWorker({
      adminClient: client,
      config: enabledConfig(),
      leaseId: LEASE_ID,
    });

    const failCalls = rpc.mock.calls.filter(([name]) => name === 'fail_personal_analysis_job');
    expect(failCalls).toHaveLength(2);
    expect(failCalls.map(([, params]) => params.p_error_code)).toEqual([
      'snapshot_build_failed',
      'snapshot_build_failed',
    ]);
    expect(result.stats.failed).toBe(2);
    expect(JSON.stringify(result)).not.toContain(USER_ID);
    expect(JSON.stringify(result)).not.toContain('private build details');
  });
});
