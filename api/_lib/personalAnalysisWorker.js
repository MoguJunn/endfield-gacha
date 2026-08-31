import { randomUUID } from 'node:crypto';

import { resolveCharacterAliasMap, resolvePoolAliasMap } from '../../shared/idAliasService.js';
import { formatAccountGachaHistoryRows } from '../../src/utils/accountGachaHistoryFormat.js';
import { buildPersonalAnalysisSnapshots } from '../../src/utils/personalAnalysisSnapshot.js';

const HISTORY_FIELDS = [
  'id',
  'user_id',
  'record_id',
  'pool_id',
  'rarity',
  'is_standard',
  'special_type',
  'item_name',
  'timestamp',
  'game_uid',
  'seq_id',
  'server_id',
  'server_scope',
  'region',
  'is_free',
  'character_id',
  'character_name',
  'nick_name',
  'pity',
  'is_new',
  'batch_id',
  'is_info_book',
  'edit_version',
].join(', ');

const POOL_FIELDS = [
  'pool_id',
  'name',
  'name_en',
  'type',
  'locked',
  'is_limited_weapon',
  'created_at',
  'updated_at',
  'user_id',
  'up_character',
  'description',
  'banner_url',
  'start_time',
  'end_time',
  'featured_characters',
].join(', ');

const CHARACTER_FIELDS = [
  'id',
  'name',
  'avatar_url',
  'rarity',
  'type',
  'aliases',
  'is_limited',
  'release_date',
  'pool_config',
].join(', ');

const POOL_QUERY_CHUNK_SIZE = 100;
const ERROR_CODE_PATTERN = /[^A-Za-z0-9_.:-]+/g;
export const PERSONAL_ANALYSIS_SCHEMA_VERSION = 2;

function readEnvironment() {
  return globalThis.process?.env || {};
}

function parseBoolean(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseInteger(value, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

export function getPersonalAnalysisWorkerConfigFromEnv(env = readEnvironment()) {
  return {
    enabled: parseBoolean(env.PERSONAL_ANALYSIS_WORKER_ENABLED, false),
    backfillEnabled: parseBoolean(
      env.PERSONAL_ANALYSIS_WORKER_BACKFILL_ENABLED,
      false
    ),
    batchSize: parseInteger(env.PERSONAL_ANALYSIS_WORKER_BATCH_SIZE, 1, { min: 1, max: 5 }),
    backfillBatchSize: parseInteger(
      env.PERSONAL_ANALYSIS_WORKER_BACKFILL_BATCH_SIZE,
      100,
      { min: 1, max: 500 }
    ),
    leaseSeconds: parseInteger(
      env.PERSONAL_ANALYSIS_WORKER_LEASE_SECONDS,
      50,
      { min: 30, max: 55 }
    ),
    historyPageSize: parseInteger(
      env.PERSONAL_ANALYSIS_WORKER_HISTORY_PAGE_SIZE,
      1000,
      { min: 1, max: 1000 }
    ),
    maxHistoryPages: parseInteger(
      env.PERSONAL_ANALYSIS_WORKER_MAX_HISTORY_PAGES,
      100,
      { min: 1, max: 500 }
    ),
    historyPageConcurrency: parseInteger(
      env.PERSONAL_ANALYSIS_WORKER_HISTORY_PAGE_CONCURRENCY,
      2,
      { min: 1, max: 4 }
    ),
  };
}

function normalizeConfig(config) {
  const defaults = getPersonalAnalysisWorkerConfigFromEnv();
  if (!config) return defaults;

  return {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : defaults.enabled,
    backfillEnabled: typeof config.backfillEnabled === 'boolean'
      ? config.backfillEnabled
      : defaults.backfillEnabled,
    batchSize: parseInteger(config.batchSize, defaults.batchSize, { min: 1, max: 5 }),
    backfillBatchSize: parseInteger(
      config.backfillBatchSize,
      defaults.backfillBatchSize,
      { min: 1, max: 500 }
    ),
    leaseSeconds: parseInteger(
      config.leaseSeconds,
      defaults.leaseSeconds,
      { min: 30, max: 55 }
    ),
    historyPageSize: parseInteger(
      config.historyPageSize,
      defaults.historyPageSize,
      { min: 1, max: 1000 }
    ),
    maxHistoryPages: parseInteger(
      config.maxHistoryPages,
      defaults.maxHistoryPages,
      { min: 1, max: 500 }
    ),
    historyPageConcurrency: parseInteger(
      config.historyPageConcurrency,
      defaults.historyPageConcurrency,
      { min: 1, max: 4 }
    ),
  };
}

function createEmptyStats() {
  return {
    claimedOwner: 0,
    claimedScope: 0,
    succeeded: 0,
    stale: 0,
    failed: 0,
  };
}

function normalizeErrorCode(error, fallback) {
  const preferred = String(error?.code || fallback || 'personal_analysis_job_failed').trim();
  const sanitized = preferred.replace(ERROR_CODE_PATTERN, '_').slice(0, 160);
  return sanitized || 'personal_analysis_job_failed';
}

async function callRpc(adminClient, name, params) {
  const { data, error } = await adminClient.rpc(name, params);
  if (error) throw error;
  return data;
}

function createLeaseId() {
  return globalThis.crypto?.randomUUID?.() || randomUUID();
}

function uniqueTextValues(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  )];
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadHistory(adminClient, userId, config) {
  const rows = [];
  const concurrency = Math.min(
    config.maxHistoryPages,
    Math.max(1, Number(config.historyPageConcurrency) || 2)
  );

  for (let firstPage = 0; firstPage < config.maxHistoryPages; firstPage += concurrency) {
    const pageNumbers = Array.from(
      { length: Math.min(concurrency, config.maxHistoryPages - firstPage) },
      (_, offset) => firstPage + offset
    );
    const pages = await Promise.all(pageNumbers.map(async (page) => {
      const from = page * config.historyPageSize;
      const to = from + config.historyPageSize - 1;
      const { data, error } = await adminClient
        .from('history')
        .select(HISTORY_FIELDS)
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }));

    for (const pageRows of pages) {
      rows.push(...pageRows);
      if (pageRows.length < config.historyPageSize) return rows;
    }
  }

  const limitError = new Error(
    `Personal analysis history exceeded ${config.maxHistoryPages} full pages`
  );
  limitError.code = 'personal_analysis_history_page_limit_exceeded';
  throw limitError;
}

function normalizePoolType(type) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  return type || 'standard';
}

function formatPoolRow(row) {
  const limitedWeaponFlag = row?.is_limited_weapon ?? row?.isLimitedWeapon;
  return {
    ...row,
    id: row?.pool_id || null,
    type: normalizePoolType(row?.type),
    isLimitedWeapon: limitedWeaponFlag !== false,
  };
}

async function loadPools(adminClient, poolIds) {
  const chunks = chunkValues(uniqueTextValues(poolIds), POOL_QUERY_CHUNK_SIZE);
  if (chunks.length === 0) return [];

  const pages = [];
  for (const chunk of chunks) {
    // Keep catalog reads bounded so a maliciously fragmented account cannot
    // fan out hundreds of simultaneous PostgREST requests.
    const { data, error } = await adminClient
      .from('pools')
      .select(POOL_FIELDS)
      .in('pool_id', chunk);
    if (error) throw error;
    pages.push((Array.isArray(data) ? data : []).map(formatPoolRow));
  }

  return pages.flat();
}

async function loadCharacters(adminClient) {
  const { data, error } = await adminClient
    .from('characters')
    .select(CHARACTER_FIELDS);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function loadPersonalAnalysisModel(adminClient, userId, config = {}) {
  const normalizedModelConfig = {
    ...getPersonalAnalysisWorkerConfigFromEnv(),
    ...config,
    historyPageSize: parseInteger(config.historyPageSize, 1000, { min: 1, max: 1000 }),
    maxHistoryPages: parseInteger(config.maxHistoryPages, 100, { min: 1, max: 500 }),
    historyPageConcurrency: parseInteger(config.historyPageConcurrency, 2, { min: 1, max: 4 }),
  };
  const rawHistory = await loadHistory(adminClient, userId, normalizedModelConfig);
  const [poolAliasMap, characterAliasMap] = await Promise.all([
    resolvePoolAliasMap(adminClient, rawHistory.map((row) => row?.pool_id)),
    resolveCharacterAliasMap(adminClient, rawHistory.map((row) => row?.character_id)),
  ]);
  const history = formatAccountGachaHistoryRows(rawHistory, {
    poolAliasMap,
    characterAliasMap,
  });
  const canonicalPoolIds = uniqueTextValues(history.map((row) => row?.poolId));
  const [pools, characters] = await Promise.all([
    loadPools(adminClient, canonicalPoolIds),
    loadCharacters(adminClient),
  ]);

  return buildPersonalAnalysisSnapshots({ history, pools, characters, userId });
}

function normalizeClaimedJobs(claimed) {
  const ownerJobs = (Array.isArray(claimed?.ownerJobs) ? claimed.ownerJobs : []).map((job) => ({
    ...job,
    kind: 'owner',
  }));
  const scopeJobs = (Array.isArray(claimed?.scopeJobs) ? claimed.scopeJobs : []).map((job) => ({
    ...job,
    kind: 'scope',
  }));
  return { ownerJobs, scopeJobs, jobs: [...ownerJobs, ...scopeJobs] };
}

function groupJobsByUser(jobs) {
  const groups = new Map();
  jobs.forEach((job) => {
    const userId = String(job?.userId || '').trim();
    if (!groups.has(userId)) groups.set(userId, []);
    groups.get(userId).push(job);
  });
  return groups;
}

async function failJob(adminClient, job, leaseId, errorCode) {
  try {
    await callRpc(adminClient, 'fail_personal_analysis_job', {
      p_kind: job.kind,
      p_user_id: job.userId,
      p_scope_game_uid: job.kind === 'scope' ? job.scopeGameUid : null,
      p_server_scope: job.kind === 'scope' ? job.serverScope : null,
      p_lease_id: leaseId,
      p_error_code: errorCode,
    });
  } catch {
    // The original controlled code remains the useful per-job result.
  }
}

function buildFailedResult(job, errorCode) {
  return {
    kind: job.kind,
    status: 'failed',
    code: errorCode,
  };
}

async function hasHistoryForClaimedScope(adminClient, job) {
  let query = adminClient
    .from('history')
    .select('id')
    .eq('user_id', job.userId)
    .eq('server_scope', job.serverScope)
    .limit(1);
  query = job.scopeGameUid === 'legacy'
    ? query.or('game_uid.is.null,game_uid.eq.')
    : query.eq('game_uid', job.scopeGameUid);
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function publishJob(adminClient, job, model, leaseId) {
  try {
    let published;
    if (job.kind === 'owner') {
      published = await callRpc(adminClient, 'publish_personal_analysis_owner_snapshot', {
        p_user_id: job.userId,
        p_input_revision: job.historyRevision,
        p_analysis_schema_version: PERSONAL_ANALYSIS_SCHEMA_VERSION,
        p_payload: model.owner,
        p_lease_id: leaseId,
      });
    } else {
      const snapshots = (Array.isArray(model.scopes) ? model.scopes : [])
        .filter((scope) => (
          scope?.sourceGameUid === job.scopeGameUid
          && scope?.sourceServerScope === job.serverScope
        ))
        .map((scope) => ({
          scopeKey: scope.scopeKey,
          payload: scope.payload,
        }));
      if (snapshots.length === 0 && await hasHistoryForClaimedScope(adminClient, job)) {
        const scopeMismatchError = new Error(
          'Claimed scope still has history but produced no analysis snapshots'
        );
        scopeMismatchError.code = 'personal_analysis_scope_identity_mismatch';
        throw scopeMismatchError;
      }
      published = await callRpc(adminClient, 'publish_personal_analysis_scope_snapshots', {
        p_user_id: job.userId,
        p_scope_game_uid: job.scopeGameUid,
        p_server_scope: job.serverScope,
        p_input_revision: job.historyRevision,
        p_analysis_schema_version: PERSONAL_ANALYSIS_SCHEMA_VERSION,
        p_snapshots: snapshots,
        p_lease_id: leaseId,
      });
    }

    if (published === false) {
      return {
        kind: job.kind,
        status: 'stale',
        code: 'personal_analysis_snapshot_stale',
      };
    }
    if (published !== true) {
      const resultError = new Error('Personal analysis publish returned an invalid result');
      resultError.code = 'personal_analysis_publish_result_invalid';
      throw resultError;
    }

    return {
      kind: job.kind,
      status: 'succeeded',
      code: 'personal_analysis_snapshot_published',
    };
  } catch (error) {
    const errorCode = normalizeErrorCode(error, 'personal_analysis_publish_failed');
    await failJob(adminClient, job, leaseId, errorCode);
    return buildFailedResult(job, errorCode);
  }
}

function sanitizeBackfillSummary(backfill) {
  return {
    processedUsers: Number(backfill?.processedUsers || 0),
    insertedOwnerStates: Number(backfill?.insertedOwnerStates || 0),
    insertedScopeStates: Number(backfill?.insertedScopeStates || 0),
    hasMore: Boolean(backfill?.hasMore),
  };
}

export async function runPersonalAnalysisWorker({
  adminClient,
  config,
  leaseId,
} = {}) {
  const workerConfig = normalizeConfig(config);
  if (!workerConfig.enabled) {
    return {
      ok: true,
      skipped: true,
      code: 'personal_analysis_worker_disabled',
      stats: createEmptyStats(),
      results: [],
    };
  }

  if (!adminClient?.rpc || !adminClient?.from) {
    return {
      ok: false,
      skipped: true,
      code: 'admin_client_unavailable',
      stats: createEmptyStats(),
      results: [],
    };
  }

  const backfill = workerConfig.backfillEnabled
    ? await callRpc(adminClient, 'enqueue_personal_analysis_backfill', {
      p_after_user_id: null,
      p_limit: workerConfig.backfillBatchSize,
    })
    : null;
  const activeLeaseId = leaseId || createLeaseId();
  const claimed = await callRpc(adminClient, 'claim_personal_analysis_jobs', {
    p_lease_id: activeLeaseId,
    p_limit: workerConfig.batchSize,
    p_lease_seconds: workerConfig.leaseSeconds,
  });
  const { ownerJobs, scopeJobs, jobs } = normalizeClaimedJobs(claimed);
  const results = [];

  for (const [userId, userJobs] of groupJobsByUser(jobs)) {
    let model;
    try {
      if (!userId) {
        const invalidJobError = new Error('Claimed personal analysis job has no user');
        invalidJobError.code = 'personal_analysis_claimed_job_invalid';
        throw invalidJobError;
      }
      model = await loadPersonalAnalysisModel(adminClient, userId, workerConfig);
    } catch (error) {
      const errorCode = normalizeErrorCode(error, 'personal_analysis_build_failed');
      for (const job of userJobs) {
        await failJob(adminClient, job, activeLeaseId, errorCode);
        results.push(buildFailedResult(job, errorCode));
      }
      continue;
    }

    for (const job of userJobs) {
      results.push(await publishJob(adminClient, job, model, activeLeaseId));
    }
  }

  const stats = {
    claimedOwner: ownerJobs.length,
    claimedScope: scopeJobs.length,
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    stale: results.filter((result) => result.status === 'stale').length,
    failed: results.filter((result) => result.status === 'failed').length,
  };

  return {
    ok: stats.failed === 0,
    skipped: false,
    code: stats.failed === 0
      ? 'personal_analysis_worker_completed'
      : 'personal_analysis_worker_partial_failure',
    backfill: sanitizeBackfillSummary(backfill),
    stats,
    results,
  };
}

export const __internal = {
  CHARACTER_FIELDS,
  HISTORY_FIELDS,
  POOL_FIELDS,
  formatPoolRow,
  hasHistoryForClaimedScope,
  loadHistory,
  normalizeErrorCode,
};
