import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import { resolveAliasValue, resolveCharacterAliasMap, resolvePoolAliasMap } from '../../../shared/idAliasService.js';
import {
  serializeHistoryForUpsert,
  serializePoolForUpsert,
  upsertHistoryRowsWithOptionalColumnFallback,
} from '../../../src/utils/cloudDataWriteRows.js';
import {
  buildGameAccountKey,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from '../../../src/utils/gameAccountMetadata.js';
import { formatAccountGachaHistoryRows } from '../../../src/utils/accountGachaHistoryFormat.js';
import {
  reconcileOfficialCharacterIds,
  reconcileOfficialPoolIds,
} from '../../../backend/lib/officialIdReconciliation.js';
import { loadPersonalAnalysisModel } from '../../_lib/personalAnalysisWorker.js';
import { serverLogger } from '../../_lib/serverLogger.js';

const PAGE_SIZE = 1000;
const MAX_PAGES = 500;
const HISTORY_PAGE_CONCURRENCY = 4;
const HISTORY_CLIENT_PAGE_DEFAULT = 50;
const HISTORY_CLIENT_PAGE_MAX = 200;
const HISTORY_READ_COLUMNS = [
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
].join(',');
const MAX_WRITE_POOLS = 200;
const MAX_WRITE_HISTORY = 1000;
const MAX_DELETE_IDS = 1000;
const MAX_SERVER_LABEL_WRITE_IDS = 100;
const TRANSIENT_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const TRANSIENT_ANALYSIS_CACHE_MAX_ENTRIES = 3;
const transientAnalysisCache = new Map();
const transientAnalysisInFlight = new Map();

class AccountGachaDataRequestError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'AccountGachaDataRequestError';
    this.code = code;
    this.status = status;
  }
}

function getRequestUrl(req) {
  try {
    return new URL(req.url || '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function shouldUseTransientPersonalAnalysis(adminClient, env = globalThis.process?.env || {}) {
  const enabled = ['1', 'true', 'yes', 'on'].includes(
    String(env.PERSONAL_ANALYSIS_TRANSIENT_FALLBACK || '').trim().toLowerCase()
  );
  return !adminClient || enabled;
}

function clearTransientPersonalAnalysisCache(userId = '') {
  const normalizedUserId = String(userId || '').trim();
  if (normalizedUserId) {
    transientAnalysisCache.delete(normalizedUserId);
    transientAnalysisInFlight.delete(normalizedUserId);
    return;
  }
  transientAnalysisCache.clear();
  transientAnalysisInFlight.clear();
}

async function getTransientPersonalAnalysisModel(dbClient, userId) {
  const now = Date.now();
  const cached = transientAnalysisCache.get(userId);
  if (cached && now - cached.createdAt < TRANSIENT_ANALYSIS_CACHE_TTL_MS) {
    // Refresh insertion order for the small LRU cache.
    transientAnalysisCache.delete(userId);
    transientAnalysisCache.set(userId, cached);
    return { model: cached.model, cacheHit: true };
  }
  if (cached) transientAnalysisCache.delete(userId);

  const existingRequest = transientAnalysisInFlight.get(userId);
  if (existingRequest) {
    return { model: await existingRequest, cacheHit: true };
  }

  const request = loadPersonalAnalysisModel(dbClient, userId, {
    historyPageSize: PAGE_SIZE,
    historyPageConcurrency: 2,
    maxHistoryPages: MAX_PAGES,
  });
  transientAnalysisInFlight.set(userId, request);
  try {
    const model = await request;
    transientAnalysisCache.set(userId, { model, createdAt: Date.now() });
    while (transientAnalysisCache.size > TRANSIENT_ANALYSIS_CACHE_MAX_ENTRIES) {
      const oldestKey = transientAnalysisCache.keys().next().value;
      transientAnalysisCache.delete(oldestKey);
    }
    return { model, cacheHit: false };
  } finally {
    if (transientAnalysisInFlight.get(userId) === request) {
      transientAnalysisInFlight.delete(userId);
    }
  }
}

function sendError(res, status, error, code = error) {
  return res.status(status).json({
    success: false,
    error,
    code,
  });
}

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function normalizeRecordIds(recordIds) {
  return [
    ...new Set((Array.isArray(recordIds) ? recordIds : []).map((value) => String(value ?? '').trim()).filter(Boolean)),
  ].slice(0, MAX_DELETE_IDS);
}

function normalizePoolId(value) {
  return String(value || '')
    .trim()
    .slice(0, 160);
}

function normalizeAccountText(value, maxLength = 160) {
  return String(value || '')
    .trim()
    .slice(0, maxLength);
}

function normalizeAnalysisViewKey(value) {
  const normalized = normalizeAccountText(value, 160);
  return /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : '';
}

function normalizeAnalysisLocale(value) {
  return String(value || '').trim().toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

function normalizeHistoryPageLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return HISTORY_CLIENT_PAGE_DEFAULT;
  }
  return Math.min(parsed, HISTORY_CLIENT_PAGE_MAX);
}

function buildHistoryPageScopeKey({ gameUid, serverScope, region = '', poolId = '', accountKey = '' }) {
  return JSON.stringify([gameUid, serverScope, region, poolId, accountKey]);
}

function normalizeHistoryRevision(value, fallback = '0') {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : fallback;
}

function encodeHistoryPageCursor(row, scopeKey, historyRevision) {
  const recordId = normalizeAccountText(row?.record_id, 256);
  const internalId = Number(row?.id);
  if (!recordId || !Number.isInteger(internalId) || internalId < 1) {
    return null;
  }

  const rawTimestamp = row?.timestamp;
  const timestamp = rawTimestamp ? new Date(rawTimestamp).toISOString() : null;
  return Buffer.from(JSON.stringify({
    v: 2,
    t: timestamp,
    r: recordId,
    i: internalId,
    s: scopeKey,
    h: normalizeHistoryRevision(historyRevision),
  }), 'utf8').toString('base64url');
}

function decodeHistoryPageCursor(value, expectedScopeKey, expectedHistoryRevision) {
  const cursor = normalizeAccountText(value, 2048);
  if (!cursor) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const recordId = normalizeAccountText(parsed?.r, 256);
    const internalId = Number(parsed?.i);
    const timestamp = parsed?.t === null ? null : new Date(parsed?.t).toISOString();
    const historyRevision = normalizeHistoryRevision(parsed?.h, '');
    if (
      parsed?.v !== 2
      || !recordId
      || !Number.isInteger(internalId)
      || internalId < 1
      || !historyRevision
      || parsed?.s !== expectedScopeKey
      || (parsed?.t !== null && timestamp !== parsed.t)
    ) {
      throw new Error('cursor_mismatch');
    }
    parsed = { timestamp, recordId, internalId, historyRevision };
  } catch {
    throw new AccountGachaDataRequestError(
      'Invalid or expired history cursor',
      'invalid_history_cursor'
    );
  }

  if (parsed.historyRevision !== normalizeHistoryRevision(expectedHistoryRevision)) {
    throw new AccountGachaDataRequestError(
      'History changed while paging; restart from the first page',
      'history_revision_changed',
      409
    );
  }

  return parsed;
}

function quotePostgrestFilterValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readHistoryPageScope(url) {
  const gameUid = normalizeAccountText(url.searchParams.get('gameUid'));
  const serverScope = normalizeAccountText(url.searchParams.get('serverScope'));
  const poolId = normalizePoolId(url.searchParams.get('poolId'));
  const accountKey = normalizeAccountText(url.searchParams.get('accountKey'), 320);
  const region = normalizeAccountText(url.searchParams.get('region'), 80);

  if (!gameUid || !serverScope) {
    throw new AccountGachaDataRequestError(
      'gameUid and serverScope are required for paged history reads',
      'history_scope_required'
    );
  }

  const canonicalAccountKey = buildGameAccountKey({
    gameUid,
    serverId: serverScope === 'legacy' ? null : serverScope,
    region,
  }) || gameUid;
  if (accountKey && accountKey !== canonicalAccountKey) {
    throw new AccountGachaDataRequestError(
      'accountKey does not match the requested history scope',
      'history_account_scope_mismatch'
    );
  }

  return {
    gameUid,
    serverScope,
    poolId,
    accountKey: accountKey || canonicalAccountKey,
    region,
  };
}

async function loadHistoryPageForScope(dbClient, userId, scope, {
  cursor = '',
  limit = HISTORY_CLIENT_PAGE_DEFAULT,
  historyRevision = '0',
} = {}) {
  const scopeKey = buildHistoryPageScopeKey(scope);
  const normalizedRevision = normalizeHistoryRevision(historyRevision);
  const decodedCursor = decodeHistoryPageCursor(cursor, scopeKey, normalizedRevision);
  let query = dbClient
    .from('history')
    .select(HISTORY_READ_COLUMNS, decodedCursor ? undefined : { count: 'exact' })
    .eq('user_id', userId)
    .eq('server_scope', scope.serverScope);

  if (scope.gameUid === 'legacy') {
    query = query.or('game_uid.is.null,game_uid.eq.');
  } else {
    query = query.eq('game_uid', scope.gameUid);
  }

  if (scope.serverScope === 'legacy') {
    query = scope.region
      ? query.eq('region', scope.region)
      : query.or('region.is.null,region.eq.');
  }

  if (scope.poolId) {
    query = query.eq('pool_id', scope.poolId);
  }

  if (decodedCursor?.timestamp) {
    const timestamp = quotePostgrestFilterValue(decodedCursor.timestamp);
    const recordId = quotePostgrestFilterValue(decodedCursor.recordId);
    query = query.or(
      `timestamp.lt.${timestamp},and(timestamp.eq.${timestamp},record_id.lt.${recordId}),and(timestamp.eq.${timestamp},record_id.eq.${recordId},id.lt.${decodedCursor.internalId}),timestamp.is.null`
    );
  } else if (decodedCursor) {
    const recordId = quotePostgrestFilterValue(decodedCursor.recordId);
    query = query
      .is('timestamp', null)
      .or(`record_id.lt.${recordId},and(record_id.eq.${recordId},id.lt.${decodedCursor.internalId})`);
  }

  const { data, count, error } = await query
    .order('timestamp', { ascending: false, nullsFirst: false })
    .order('record_id', { ascending: false })
    .order('id', { ascending: false })
    .range(0, limit);

  if (error) {
    throw error;
  }

  const fetchedRows = Array.isArray(data) ? data : [];
  const hasMore = fetchedRows.length > limit;
  const rows = fetchedRows.slice(0, limit);
  const nextCursor = hasMore && rows.length > 0
    ? encodeHistoryPageCursor(rows[rows.length - 1], scopeKey, normalizedRevision)
    : null;

  return {
    rows,
    page: {
      limit,
      nextCursor,
      hasMore,
      total: decodedCursor ? null : Math.max(0, Number(count) || 0),
      revision: normalizedRevision,
    },
  };
}

function isMissingPersonalAnalysisInfrastructureError(error) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('personal_analysis_') && (
      message.includes('does not exist')
      || message.includes('schema cache')
    );
}

async function loadPersonalAnalysisScopeState(dbClient, userId, scope) {
  const { data, error } = await dbClient
    .from('personal_analysis_scope_state')
    .select('history_revision, snapshot_revision, analysis_schema_version, computed_at, last_error')
    .eq('user_id', userId)
    .eq('scope_game_uid', scope.gameUid)
    .eq('server_scope', scope.serverScope)
    .maybeSingle();

  if (error) {
    if (isMissingPersonalAnalysisInfrastructureError(error)) {
      return {
        available: false,
        historyRevision: '0',
        snapshotRevision: null,
        analysisSchemaVersion: null,
        computedAt: null,
      };
    }
    throw error;
  }

  if (!data) {
    return {
      available: false,
      historyRevision: '0',
      snapshotRevision: null,
      analysisSchemaVersion: null,
      computedAt: null,
    };
  }

  return {
    available: true,
    historyRevision: normalizeHistoryRevision(data?.history_revision),
    snapshotRevision: data?.snapshot_revision === null || data?.snapshot_revision === undefined
      ? '-1'
      : String(data.snapshot_revision),
    analysisSchemaVersion: Math.max(1, Number(data?.analysis_schema_version) || 1),
    computedAt: data?.computed_at || null,
    lastError: data?.last_error || null,
  };
}

function normalizePersonalAnalysisState(data) {
  if (!data) {
    return null;
  }
  return {
    historyRevision: normalizeHistoryRevision(data.history_revision),
    snapshotRevision: data.snapshot_revision === null || data.snapshot_revision === undefined
      ? '-1'
      : String(data.snapshot_revision),
    analysisSchemaVersion: Math.max(1, Number(data.analysis_schema_version) || 1),
    computedAt: data.computed_at || null,
    lastError: data.last_error || null,
  };
}

function normalizePersonalAnalysisSnapshot(data) {
  if (!data || !data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) {
    return null;
  }
  return {
    scopeKind: data.scope_kind,
    scopeKey: data.scope_key,
    sourceGameUid: data.source_game_uid || null,
    sourceServerScope: data.source_server_scope || null,
    inputRevision: normalizeHistoryRevision(data.input_revision),
    analysisSchemaVersion: Math.max(1, Number(data.analysis_schema_version) || 1),
    computedAt: data.computed_at || null,
    payload: data.payload,
  };
}

async function loadPersonalAnalysisOwnerState(dbClient, userId) {
  const { data, error } = await dbClient
    .from('personal_analysis_owner_state')
    .select('history_revision, snapshot_revision, analysis_schema_version, computed_at, last_error')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingPersonalAnalysisInfrastructureError(error)) {
      throw new AccountGachaDataRequestError(
        'Personal analysis snapshots are not configured',
        'personal_analysis_not_configured',
        503
      );
    }
    throw error;
  }

  return normalizePersonalAnalysisState(data);
}

async function loadPersonalAnalysisSnapshot(dbClient, userId, scopeKind, scopeKey) {
  const { data, error } = await dbClient
    .from('personal_analysis_snapshots')
    .select(
      'scope_kind, scope_key, source_game_uid, source_server_scope, input_revision, analysis_schema_version, computed_at, payload'
    )
    .eq('user_id', userId)
    .eq('scope_kind', scopeKind)
    .eq('scope_key', scopeKey)
    .maybeSingle();

  if (error) {
    if (isMissingPersonalAnalysisInfrastructureError(error)) {
      throw new AccountGachaDataRequestError(
        'Personal analysis snapshots are not configured',
        'personal_analysis_not_configured',
        503
      );
    }
    throw error;
  }

  return normalizePersonalAnalysisSnapshot(data);
}

function buildProjectedAccountPayload(data, viewKey, locale) {
  const fallbackPayload = data?.payload && typeof data.payload === 'object' ? data.payload : {};
  const view = data?.view && typeof data.view === 'object'
    ? data.view
    : fallbackPayload.dashboard?.views?.[viewKey] || null;
  const timeline = Array.isArray(data?.timeline)
    ? data.timeline
    : fallbackPayload.dashboard?.timelineViews?.[locale]?.[viewKey] || null;
  return {
    account: data?.account && typeof data.account === 'object'
      ? data.account
      : fallbackPayload.account || null,
    poolManifest: Array.isArray(data?.pool_manifest)
      ? data.pool_manifest
      : Array.isArray(fallbackPayload.poolManifest) ? fallbackPayload.poolManifest : [],
    selector: data?.selector && typeof data.selector === 'object'
      ? data.selector
      : fallbackPayload.selector || {},
    dashboard: {
      views: view ? { [viewKey]: view } : {},
      timelineViews: timeline ? { [locale]: { [viewKey]: timeline } } : {},
    },
    recentSixStars: Array.isArray(data?.recent_six_stars)
      ? data.recent_six_stars
      : Array.isArray(fallbackPayload.recentSixStars) ? fallbackPayload.recentSixStars : [],
  };
}

async function loadProjectedPersonalAnalysisAccountSnapshot(
  dbClient,
  userId,
  scopeKey,
  { viewKey, locale }
) {
  if (!viewKey) {
    return loadPersonalAnalysisSnapshot(dbClient, userId, 'account', scopeKey);
  }

  const selection = [
    'scope_kind',
    'scope_key',
    'source_game_uid',
    'source_server_scope',
    'input_revision',
    'analysis_schema_version',
    'computed_at',
    'account:payload->account',
    'pool_manifest:payload->poolManifest',
    'selector:payload->selector',
    `view:payload->dashboard->views->${viewKey}`,
    `timeline:payload->dashboard->timelineViews->${locale}->${viewKey}`,
    'recent_six_stars:payload->recentSixStars',
  ].join(',');
  const { data, error } = await dbClient
    .from('personal_analysis_snapshots')
    .select(selection)
    .eq('user_id', userId)
    .eq('scope_kind', 'account')
    .eq('scope_key', scopeKey)
    .maybeSingle();

  if (error) {
    if (isMissingPersonalAnalysisInfrastructureError(error)) {
      throw new AccountGachaDataRequestError(
        'Personal analysis snapshots are not configured',
        'personal_analysis_not_configured',
        503
      );
    }
    throw error;
  }
  if (!data) return null;

  return normalizePersonalAnalysisSnapshot({
    ...data,
    payload: buildProjectedAccountPayload(data, viewKey, locale),
  });
}

function projectTransientScopePayload(payload, viewKey, locale) {
  if (!payload || !viewKey) return payload || null;
  const view = payload.dashboard?.views?.[viewKey] || null;
  const timeline = payload.dashboard?.timelineViews?.[locale]?.[viewKey]
    || payload.dashboard?.timelineViews?.['zh-CN']?.[viewKey]
    || null;
  return {
    ...payload,
    dashboard: {
      views: view ? { [viewKey]: view } : {},
      timelineViews: Array.isArray(timeline) ? { [locale]: { [viewKey]: timeline } } : {},
    },
  };
}

async function hasAnyHistoryForUser(dbClient, userId) {
  const { data, error } = await dbClient
    .from('history')
    .select('record_id')
    .eq('user_id', userId)
    .limit(1);

  if (error) {
    throw error;
  }
  return Array.isArray(data) && data.length > 0;
}

function isPersonalAnalysisSnapshotFresh(snapshot, state) {
  return Boolean(
    snapshot
    && state
    && snapshot.inputRevision === state.historyRevision
    && snapshot.analysisSchemaVersion === state.analysisSchemaVersion
  );
}

function getAnalysisAccountKey(ownerPayload, requestedAccountKey = '') {
  const normalizedRequested = normalizeAccountText(requestedAccountKey, 320);
  if (normalizedRequested) {
    return normalizedRequested;
  }

  const defaultAccountKey = normalizeAccountText(ownerPayload?.defaultAccountKey, 320);
  if (defaultAccountKey) {
    return defaultAccountKey;
  }

  const accounts = Array.isArray(ownerPayload?.accounts) ? ownerPayload.accounts : [];
  return normalizeAccountText(accounts[0]?.accountKey || accounts[0]?.account_key, 320);
}

async function handleLoadPersonalAnalysis(url, res, dbClient, authResult) {
  const userId = authResult.user.id;
  const [ownerState, ownerSnapshot] = await Promise.all([
    loadPersonalAnalysisOwnerState(dbClient, userId),
    loadPersonalAnalysisSnapshot(dbClient, userId, 'owner', 'owner'),
  ]);

  if (!ownerSnapshot) {
    const hasHistory = await hasAnyHistoryForUser(dbClient, userId);
    if (!hasHistory) {
      res.status(200).json({
        success: true,
        mode: 'analysis',
        schemaVersion: 1,
        availability: 'empty',
        source: authResult.source || 'unknown',
        meta: {
          ownerId: userId,
          rawIncluded: false,
          verifiedEmpty: true,
          revision: ownerState?.historyRevision || '0',
        },
        owner: null,
        scope: null,
        warnings: [],
      });
      return;
    }

    res.setHeader('Retry-After', '10');
    res.status(202).json({
      success: true,
      mode: 'analysis',
      schemaVersion: 1,
      availability: 'building',
      source: authResult.source || 'unknown',
      meta: {
        ownerId: userId,
        rawIncluded: false,
        verifiedEmpty: false,
        revision: ownerState?.historyRevision || null,
        retryAfterSeconds: 10,
      },
      owner: null,
      scope: null,
      warnings: [{
        code: ownerState?.lastError
          ? 'personal_analysis_build_retry_pending'
          : 'personal_analysis_build_pending',
      }],
    });
    return;
  }

  const ownerAccounts = Array.isArray(ownerSnapshot.payload?.accounts)
    ? ownerSnapshot.payload.accounts
    : [];
  const ownerAccountKeys = new Set(ownerAccounts.map((account) => (
    normalizeAccountText(account?.accountKey || account?.account_key, 320)
  )).filter(Boolean));
  const requestedAccountKey = normalizeAccountText(
    url.searchParams.get('accountKey') || '',
    320
  );
  if (requestedAccountKey && !ownerAccountKeys.has(requestedAccountKey)) {
    throw new AccountGachaDataRequestError(
      'Requested analysis account was not found',
      'personal_analysis_account_not_found',
      400
    );
  }

  const accountKey = getAnalysisAccountKey(
    ownerSnapshot.payload,
    requestedAccountKey
  );
  const viewKey = normalizeAnalysisViewKey(url.searchParams.get('viewKey'));
  const locale = normalizeAnalysisLocale(url.searchParams.get('locale'));
  const selectedAccount = ownerAccounts.find((account) => (
    normalizeAccountText(account?.accountKey || account?.account_key, 320) === accountKey
  ));
  const manifestScope = selectedAccount ? {
    gameUid: normalizeAccountText(selectedAccount.gameUid || selectedAccount.game_uid),
    serverScope: normalizeAccountText(
      selectedAccount.serverScope
      || selectedAccount.server_scope
      || selectedAccount.serverId
      || selectedAccount.server_id
    ),
  } : null;
  const accountSnapshotRequest = accountKey
    ? loadProjectedPersonalAnalysisAccountSnapshot(dbClient, userId, accountKey, {
      viewKey,
      locale,
    })
    : Promise.resolve(null);
  const scopeStateRequest = manifestScope?.gameUid && manifestScope?.serverScope
    ? loadPersonalAnalysisScopeState(dbClient, userId, manifestScope)
    : Promise.resolve(null);
  const [accountSnapshot, manifestScopeState] = await Promise.all([
    accountSnapshotRequest,
    scopeStateRequest,
  ]);

  if (accountKey && !accountSnapshot) {
    res.setHeader('Retry-After', '10');
    res.status(202).json({
      success: true,
      mode: 'analysis',
      schemaVersion: 1,
      availability: 'building',
      source: authResult.source || 'unknown',
      meta: {
        ownerId: userId,
        rawIncluded: false,
        verifiedEmpty: false,
        revision: ownerState?.historyRevision || ownerSnapshot.inputRevision,
        accountKey,
        retryAfterSeconds: 10,
      },
      owner: ownerSnapshot.payload,
      scope: null,
      warnings: [{ code: 'personal_analysis_scope_build_pending' }],
    });
    return;
  }

  const snapshotMatchesManifest = accountSnapshot && manifestScope
    && accountSnapshot.sourceGameUid === manifestScope.gameUid
    && accountSnapshot.sourceServerScope === manifestScope.serverScope;
  const scopeState = accountSnapshot
    ? snapshotMatchesManifest && manifestScopeState
      ? manifestScopeState
      : await loadPersonalAnalysisScopeState(dbClient, userId, {
      gameUid: accountSnapshot.sourceGameUid,
      serverScope: accountSnapshot.sourceServerScope,
      })
    : null;
  const ownerFresh = isPersonalAnalysisSnapshotFresh(ownerSnapshot, ownerState);
  const scopeFresh = !accountSnapshot || (
    scopeState?.available
    && accountSnapshot.inputRevision === scopeState.historyRevision
    && accountSnapshot.analysisSchemaVersion === scopeState.analysisSchemaVersion
  );
  const verifiedEmpty = ownerFresh && ownerAccountKeys.size === 0;
  const availability = verifiedEmpty
    ? 'empty'
    : ownerFresh && scopeFresh
      ? 'ready'
      : 'stale';
  const warnings = [];
  if (!ownerFresh) {
    warnings.push({ code: 'personal_analysis_owner_stale' });
  }
  if (!scopeFresh) {
    warnings.push({ code: 'personal_analysis_scope_stale' });
  }

  res.status(200).json({
    success: true,
    mode: 'analysis',
    schemaVersion: 1,
    availability,
    source: authResult.source || 'unknown',
    meta: {
      ownerId: userId,
      rawIncluded: false,
      verifiedEmpty,
      revision: ownerState?.historyRevision || ownerSnapshot.inputRevision,
      ownerSnapshotRevision: ownerSnapshot.inputRevision,
      accountKey: accountKey || null,
      scopeRevision: scopeState?.historyRevision || accountSnapshot?.inputRevision || null,
      scopeSnapshotRevision: accountSnapshot?.inputRevision || null,
      generatedAt: accountSnapshot?.computedAt || ownerSnapshot.computedAt,
      viewKey: viewKey || null,
      locale,
    },
    owner: ownerSnapshot.payload,
    scope: accountSnapshot?.payload || null,
    warnings,
  });
}

async function handleLoadTransientPersonalAnalysis(url, res, dbClient, authResult) {
  const userId = authResult.user.id;
  const { model, cacheHit } = await getTransientPersonalAnalysisModel(dbClient, userId);
  const accounts = Array.isArray(model?.owner?.accounts) ? model.owner.accounts : [];
  const requestedAccountKey = normalizeAccountText(
    url.searchParams.get('accountKey') || '',
    320
  );
  const accountKey = requestedAccountKey
    || normalizeAccountText(model?.owner?.defaultAccountKey, 320)
    || normalizeAccountText(accounts[0]?.accountKey, 320);
  if (
    requestedAccountKey
    && !accounts.some((account) => normalizeAccountText(account?.accountKey, 320) === requestedAccountKey)
  ) {
    throw new AccountGachaDataRequestError(
      'Requested analysis account was not found',
      'personal_analysis_account_not_found',
      400
    );
  }

  const scope = accountKey
    ? model.scopes.find((candidate) => candidate?.scopeKey === accountKey)?.payload || null
    : null;
  const viewKey = normalizeAnalysisViewKey(url.searchParams.get('viewKey'));
  const locale = normalizeAnalysisLocale(url.searchParams.get('locale'));
  const verifiedEmpty = accounts.length === 0;

  res.status(200).json({
    success: true,
    mode: 'analysis',
    schemaVersion: 1,
    availability: verifiedEmpty ? 'empty' : 'ready',
    source: authResult.source || 'supabase',
    meta: {
      ownerId: userId,
      rawIncluded: false,
      verifiedEmpty,
      transient: true,
      cacheHit,
      accountKey: accountKey || null,
      generatedAt: new Date().toISOString(),
      viewKey: viewKey || null,
      locale,
    },
    owner: model.owner,
    scope: projectTransientScopePayload(scope, viewKey, locale),
    warnings: [{ code: 'personal_analysis_transient_fallback' }],
  });
}

async function loadHistoryPageForUser(adminClient, userId, page) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await adminClient
    .from('history')
    .select(HISTORY_READ_COLUMNS)
    .eq('user_id', userId)
    .order('record_id', { ascending: true })
    .range(from, to);

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function loadHistoryPagesForUser(adminClient, userId, pageCount) {
  const pages = Array.from({ length: pageCount });
  let nextPage = 0;

  const worker = async () => {
    while (nextPage < pageCount) {
      const page = nextPage;
      nextPage += 1;
      pages[page] = await loadHistoryPageForUser(adminClient, userId, page);
    }
  };

  const workerCount = Math.min(HISTORY_PAGE_CONCURRENCY, pageCount);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return pages.flat();
}

async function loadAllHistoryForUser(adminClient, userId) {
  const { count, error: countError } = await adminClient
    .from('history')
    .select('record_id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (countError) {
    throw countError;
  }

  const totalRows = Math.max(0, Number(count) || 0);
  if (totalRows === 0) {
    return {
      rows: [],
      truncated: false,
    };
  }

  const totalPages = Math.ceil(totalRows / PAGE_SIZE);
  const pageCount = Math.min(totalPages, MAX_PAGES);
  const rows = await loadHistoryPagesForUser(adminClient, userId, pageCount);

  return {
    rows,
    truncated: totalPages > MAX_PAGES,
  };
}

async function loadHistorySeqKeysForUser(adminClient, userId, { gameUid = '', serverId = '', region = '' } = {}) {
  const keys = [];
  const normalizedGameUid = String(gameUid || '').trim();
  const normalizedServerId = String(serverId || '').trim();
  const normalizedRegion = String(region || '').trim();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let query = adminClient
      .from('history')
      .select('seq_id, game_uid, pool_id, server_id, region')
      .eq('user_id', userId)
      .not('seq_id', 'is', null);

    if (normalizedGameUid) {
      query = query.eq('game_uid', normalizedGameUid);
    }
    if (normalizedServerId) {
      query = query.eq('server_id', normalizedServerId);
    }
    if (normalizedRegion) {
      query = query.eq('region', normalizedRegion);
    }

    const { data, error } = await query.order('record_id', { ascending: true }).range(from, to);
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    keys.push(
      ...rows.map((row) => {
        const keyRow = {
          seqId: row.seq_id,
          seq_id: row.seq_id,
          gameUid: row.game_uid,
          game_uid: row.game_uid,
          poolId: row.pool_id,
          pool_id: row.pool_id,
          serverId: row.server_id,
          server_id: row.server_id,
          region: row.region,
        };

        return {
          ...keyRow,
          accountKey: buildGameAccountKey(keyRow),
          account_key: buildGameAccountKey(keyRow),
        };
      })
    );

    if (rows.length < PAGE_SIZE) {
      return {
        keys,
        truncated: false,
      };
    }
  }

  return {
    keys,
    truncated: true,
  };
}

async function loadHistoryDedupeRowsForUser(adminClient, userId) {
  const rowsForDedupe = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await adminClient
      .from('history')
      .select(
        'seq_id, game_uid, pool_id, server_id, region, timestamp, character_name, item_name, character_id, rarity, is_free'
      )
      .eq('user_id', userId)
      .order('record_id', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    rowsForDedupe.push(...rows);
    if (rows.length < PAGE_SIZE) {
      return rowsForDedupe;
    }
  }

  return rowsForDedupe;
}

function normalizeDedupeValue(value) {
  return String(value || '').trim();
}

function normalizeDedupeTimestamp(value) {
  const normalized = normalizeDedupeValue(value);
  if (!normalized) return '';

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

function getDedupeSeqId(row) {
  return normalizeDedupeValue(row?.seq_id || row?.seqId);
}

function getDedupeGameUid(row) {
  return normalizeDedupeValue(row?.game_uid || row?.gameUid);
}

function getDedupePoolId(row) {
  return normalizeDedupeValue(row?.pool_id || row?.poolId);
}

function getDedupeServerId(row) {
  return normalizeDedupeValue(row?.server_id || row?.serverId);
}

function getDedupeRegion(row) {
  return normalizeDedupeValue(row?.region || row?.serverRegion);
}

function getDedupeAccountKey(row) {
  const gameUid = getDedupeGameUid(row);
  if (!gameUid) {
    return '';
  }

  return (
    buildGameAccountKey({
      gameUid,
      serverId: getDedupeServerId(row),
      region: getDedupeRegion(row),
    }) || gameUid
  );
}

function getDedupeItemIdentities(row) {
  return [
    ...new Set(
      [
        row?.character_id,
        row?.item_id,
        row?.charId,
        row?.weaponId,
        row?.character_name,
        row?.characterName,
        row?.item_name,
        row?.name,
      ]
        .map((value) => normalizeDedupeValue(value))
        .filter(Boolean)
    ),
  ];
}

function buildHistoryDedupeKeys(row) {
  const gameUid = getDedupeGameUid(row);
  const accountKey = getDedupeAccountKey(row);
  const isServerScoped = Boolean(accountKey && accountKey !== gameUid);
  const poolId = getDedupePoolId(row);
  const seqId = getDedupeSeqId(row);
  const timestamp = normalizeDedupeTimestamp(row?.timestamp);
  const itemIdentities = getDedupeItemIdentities(row);
  const rarity = normalizeDedupeValue(row?.rarity);
  const isFree = row?.is_free === true || row?.isFree === true ? 'free' : 'paid';
  const keys = [];

  if (seqId) {
    if (!gameUid && poolId) keys.push(`pool-seq:${poolId}:${seqId}`);
    if (isServerScoped && poolId) keys.push(`account-pool-seq:${accountKey}:${poolId}:${seqId}`);
    if (!isServerScoped && gameUid && poolId) keys.push(`game-pool-seq:${gameUid}:${poolId}:${seqId}`);
  }

  itemIdentities.forEach((itemIdentity) => {
    if (seqId && timestamp && rarity) {
      // kwer 旧 JSON 可能没有 gameUid 或仍使用旧池 ID；同一用户内 seq + 时间 + 物品足以兜底识别同一条历史。
      keys.push(`seq-time-item:${seqId}:${timestamp}:${itemIdentity}:${rarity}`);
    }

    if (isServerScoped && seqId && timestamp && rarity) {
      keys.push(`account-seq-time-item:${accountKey}:${seqId}:${timestamp}:${itemIdentity}:${rarity}`);
    }

    if (!isServerScoped && gameUid && seqId && timestamp && rarity) {
      // 跨来源导入时旧 JSON 可能缺少可映射池 ID，但 seq + 时间 + 物品身份仍能稳定指向同一抽卡记录。
      keys.push(`game-seq-time-item:${gameUid}:${seqId}:${timestamp}:${itemIdentity}:${rarity}`);
    }

    if (!seqId && isServerScoped && poolId && timestamp && rarity) {
      keys.push(`account-pool-time-item:${accountKey}:${poolId}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }

    if (!seqId && !isServerScoped && gameUid && poolId && timestamp && rarity) {
      keys.push(`game-pool-time-item:${gameUid}:${poolId}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }

    if (!seqId && isServerScoped && timestamp && rarity) {
      keys.push(`account-time-item:${accountKey}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }

    if (!seqId && !isServerScoped && gameUid && timestamp && rarity) {
      keys.push(`game-time-item:${gameUid}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }
  });

  return keys;
}

function createHistoryDedupeSet(rows) {
  const dedupeKeys = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    buildHistoryDedupeKeys(row).forEach((key) => dedupeKeys.add(key));
  });
  return dedupeKeys;
}

function filterDuplicateHistoryRows(rows, existingRows) {
  const dedupeKeys = createHistoryDedupeSet(existingRows);
  const newRows = [];
  let duplicateCount = 0;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rowKeys = buildHistoryDedupeKeys(row);
    const duplicate = rowKeys.some((key) => dedupeKeys.has(key));

    if (duplicate) {
      duplicateCount += 1;
      return;
    }

    newRows.push(row);
    rowKeys.forEach((key) => dedupeKeys.add(key));
  });

  return {
    newRows,
    duplicateCount,
  };
}

function normalizeTextValues(values) {
  return [
    ...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean)),
  ].slice(0, 1000);
}

async function resolveAliasMapOptional(resolver, supabaseClient, ids, preferredSource, { optional = false } = {}) {
  try {
    return await resolver(supabaseClient, ids, preferredSource);
  } catch (error) {
    if (optional) {
      return new Map();
    }
    throw error;
  }
}

async function handleResolveAccountGachaAliases(body, res, adminClient, { optionalAliases = false } = {}) {
  const poolIds = normalizeTextValues(body.poolIds);
  const characterIds = normalizeTextValues(body.characterIds);
  const [poolAliasMap, characterAliasMap] = await Promise.all([
    resolveAliasMapOptional(resolvePoolAliasMap, adminClient, poolIds, 'official_api', { optional: optionalAliases }),
    resolveAliasMapOptional(resolveCharacterAliasMap, adminClient, characterIds, 'official_api', {
      optional: optionalAliases,
    }),
  ]);

  return res.status(200).json({
    success: true,
    poolAliases: Object.fromEntries(poolAliasMap),
    characterAliases: Object.fromEntries(characterAliasMap),
  });
}

function buildHistoryAccountKeyFromRow(row) {
  const gameUid = normalizeAccountText(row?.game_uid || row?.gameUid);
  if (!gameUid) {
    return '';
  }

  return (
    buildGameAccountKey({
      gameUid,
      serverId: row?.server_id || row?.serverId,
      region: row?.region || row?.serverRegion,
    }) || gameUid
  );
}

function matchesServerLabelUpdateTarget(row, { accountKey = '', currentServerId = '', currentRegion = '' } = {}) {
  const rowServerId = normalizeAccountText(row?.server_id || row?.serverId);
  const rowRegion = normalizeAccountText(row?.region || row?.serverRegion, 80);
  const rowGameUid = normalizeAccountText(row?.game_uid || row?.gameUid || row?.hg_uid || row?.hgUid, 120);

  if (accountKey) {
    return (
      buildHistoryAccountKeyFromRow(row) === accountKey || rowGameUid === accountKey || (!rowServerId && !rowRegion)
    );
  }

  if (currentServerId) {
    return rowServerId === currentServerId;
  }

  if (currentRegion) {
    return rowRegion === currentRegion;
  }

  return !rowServerId && !rowRegion;
}

async function loadHistoryRowsForServerLabelUpdate(adminClient, userId, gameUid) {
  const rows = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await adminClient
      .from('history')
      .select(
        'id, record_id, game_uid, server_id, region, seq_id, pool_id, timestamp, character_name, item_name, character_id, rarity, is_free'
      )
      .eq('user_id', userId)
      .eq('game_uid', gameUid)
      .order('record_id', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) {
      return rows;
    }
  }

  return rows;
}

function getHistoryInternalId(row) {
  const internalId = Number(row?.id);
  return Number.isInteger(internalId) && internalId > 0 ? internalId : null;
}

function collectDuplicateHistoryRecordIdsForServerMerge(rows, { serverId, region } = {}) {
  const seenKeys = new Set();
  const duplicateIds = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const mergedRow = {
      ...row,
      serverId,
      server_id: serverId,
      region,
    };
    const rowKeys = buildHistoryDedupeKeys(mergedRow);
    if (rowKeys.length === 0) {
      return;
    }

    const isDuplicate = rowKeys.some((key) => seenKeys.has(key));
    if (isDuplicate) {
      const internalId = getHistoryInternalId(row);
      if (internalId !== null) {
        duplicateIds.push(internalId);
      }
      return;
    }

    rowKeys.forEach((key) => seenKeys.add(key));
  });

  return duplicateIds;
}

async function updateHistoryServerLabelByInternalIds(
  adminClient,
  userId,
  gameUid,
  internalIds,
  { serverId, region } = {}
) {
  let updated = 0;

  for (let index = 0; index < internalIds.length; index += MAX_SERVER_LABEL_WRITE_IDS) {
    const chunk = internalIds.slice(index, index + MAX_SERVER_LABEL_WRITE_IDS);
    const { error } = await adminClient
      .from('history')
      .update({
        server_id: serverId,
        region,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('game_uid', gameUid)
      .in('id', chunk);

    if (error) throw error;
    updated += chunk.length;
  }

  return updated;
}

async function deleteHistoryRowsByInternalIds(adminClient, userId, gameUid, internalIds) {
  let deleted = 0;

  for (let index = 0; index < internalIds.length; index += MAX_SERVER_LABEL_WRITE_IDS) {
    const chunk = internalIds.slice(index, index + MAX_SERVER_LABEL_WRITE_IDS);
    const { error } = await adminClient
      .from('history')
      .delete()
      .eq('user_id', userId)
      .eq('game_uid', gameUid)
      .in('id', chunk);

    if (error) throw error;
    deleted += chunk.length;
  }

  return deleted;
}

async function handleUpdateAccountServerLabel(body, res, adminClient, userId) {
  const gameUid = normalizeAccountText(body.gameUid || body.game_uid);
  const accountKey = normalizeAccountText(body.accountKey || body.account_key, 240);
  const currentServerId = normalizeAccountText(body.currentServerId || body.current_server_id, 80);
  const currentRegion = normalizeAccountText(body.currentRegion || body.current_region, 80);
  const mergeGameUid = body.mergeGameUid === true || body.merge_game_uid === true;
  const serverId = normalizeGameAccountServerId({
    serverId: body.serverId || body.server_id,
    region: body.region,
  });
  const region = normalizeGameAccountRegion({
    serverId,
    region: body.region,
  });

  if (!gameUid) {
    return sendError(res, 400, 'Missing game uid', 'game_uid_required');
  }

  if (!serverId || !region) {
    return sendError(res, 400, 'Missing server label', 'server_label_required');
  }

  const rows = await loadHistoryRowsForServerLabelUpdate(adminClient, userId, gameUid);
  let targetRows = rows.filter(
    (row) => mergeGameUid || matchesServerLabelUpdateTarget(row, { accountKey, currentServerId, currentRegion })
  );

  if (!mergeGameUid && targetRows.length === 0) {
    targetRows = rows;
  }
  const duplicateIds = mergeGameUid
    ? collectDuplicateHistoryRecordIdsForServerMerge(targetRows, { serverId, region })
    : [];
  const duplicateIdSet = new Set(duplicateIds);
  const targetIds = targetRows
    .map((row) => getHistoryInternalId(row))
    .filter((value) => !duplicateIdSet.has(value))
    .filter((value) => value !== null && value !== undefined);

  if (targetIds.length === 0 && duplicateIds.length === 0) {
    return res.status(200).json({
      success: true,
      updated: 0,
      deletedDuplicates: 0,
      serverId,
      region,
      mergeGameUid,
    });
  }

  const deletedDuplicates = await deleteHistoryRowsByInternalIds(adminClient, userId, gameUid, duplicateIds);
  const updated = await updateHistoryServerLabelByInternalIds(
    adminClient,
    userId,
    gameUid,
    targetIds,
    { serverId, region }
  );

  return res.status(200).json({
    success: true,
    updated,
    deletedDuplicates,
    serverId,
    region,
    mergeGameUid,
  });
}

async function handleSaveAccountGachaData(
  body,
  res,
  adminClient,
  userId,
  { reconcile = true, optionalAliases = false } = {}
) {
  const pools = Array.isArray(body.pools) ? body.pools.slice(0, MAX_WRITE_POOLS) : [];
  const history = Array.isArray(body.history) ? body.history.slice(0, MAX_WRITE_HISTORY) : [];
  let savedPoolCount = 0;
  let protectedPoolCount = 0;

  if (pools.length === 0 && history.length === 0) {
    return res.status(200).json({
      success: true,
      saved: {
        pools: 0,
        history: 0,
      },
      skipped: {
        pools: 0,
        history: 0,
      },
    });
  }

  if (pools.length > 0) {
    if (reconcile) {
      await reconcileOfficialPoolIds(adminClient, pools, {
        userId,
      });
    }

    const poolAliasMap = await resolveAliasMapOptional(
      resolvePoolAliasMap,
      adminClient,
      pools.map((pool) => pool?.id || pool?.pool_id || pool?.poolId),
      'official_api',
      { optional: optionalAliases }
    );
    const rows = pools.map((pool) => ({
      ...serializePoolForUpsert(
        pool,
        userId,
        resolveAliasValue(poolAliasMap, pool?.id || pool?.pool_id || pool?.poolId)
      ),
      user_id: userId,
    }));
    const canonicalPoolIds = [...new Set(rows.map((row) => row.pool_id).filter(Boolean))];
    const { data: existingPools, error: existingPoolsError } = canonicalPoolIds.length > 0
      ? await adminClient
        .from('pools')
        .select('pool_id, user_id')
        .in('pool_id', canonicalPoolIds)
      : { data: [], error: null };
    if (existingPoolsError) throw existingPoolsError;

    const existingOwnerByPoolId = new Map(
      (Array.isArray(existingPools) ? existingPools : [])
        .map((pool) => [String(pool?.pool_id || '').trim(), String(pool?.user_id || '').trim()])
        .filter(([poolId]) => Boolean(poolId))
    );
    const writableRows = rows.filter((row) => {
      const existingOwnerId = existingOwnerByPoolId.get(String(row.pool_id || '').trim());
      return !existingOwnerId || existingOwnerId === userId;
    });
    protectedPoolCount = rows.length - writableRows.length;
    if (writableRows.length > 0) {
      const { error } = await adminClient.from('pools').upsert(writableRows, { onConflict: 'pool_id' });
      if (error) throw error;
      savedPoolCount = writableRows.length;
    }
  }

  if (history.length > 0) {
    if (reconcile) {
      await reconcileOfficialPoolIds(
        adminClient,
        history.map((record) => ({
          ...record,
          pool_id: record?.poolId || record?.pool_id,
          name: record?.pool_name || record?.poolName,
          type: record?.poolType || record?.type,
        })),
        {
          userId,
        }
      );
      await reconcileOfficialCharacterIds(adminClient, history);
    }

    const [poolAliasMap, characterAliasMap] = await Promise.all([
      resolveAliasMapOptional(
        resolvePoolAliasMap,
        adminClient,
        history.map((record) => record?.poolId || record?.pool_id),
        'official_api',
        { optional: optionalAliases }
      ),
      resolveAliasMapOptional(
        resolveCharacterAliasMap,
        adminClient,
        history.map((record) => record?.character_id || record?.item_id || record?.charId || record?.weaponId),
        'official_api',
        { optional: optionalAliases }
      ),
    ]);
    const rows = history.map((record) => ({
      ...serializeHistoryForUpsert(
        record,
        userId,
        resolveAliasValue(poolAliasMap, record?.poolId || record?.pool_id),
        resolveAliasValue(
          characterAliasMap,
          record?.character_id || record?.item_id || record?.charId || record?.weaponId
        )
      ),
      user_id: userId,
    }));
    const existingRows = await loadHistoryDedupeRowsForUser(adminClient, userId);
    const { newRows, duplicateCount } = filterDuplicateHistoryRows(rows, existingRows);

    if (newRows.length > 0) {
      await upsertHistoryRowsWithOptionalColumnFallback(newRows, (pendingRows, onConflict) =>
        adminClient.from('history').upsert(pendingRows, { onConflict })
      );
    }

    return res.status(200).json({
      success: true,
      saved: {
        pools: savedPoolCount,
        history: newRows.length,
      },
      skipped: {
        pools: Math.max(0, (Array.isArray(body.pools) ? body.pools.length : 0) - pools.length)
          + protectedPoolCount,
        history: Math.max(0, (Array.isArray(body.history) ? body.history.length : 0) - history.length) + duplicateCount,
      },
    });
  }

  return res.status(200).json({
    success: true,
    saved: {
      pools: savedPoolCount,
      history: history.length,
    },
    skipped: {
      pools: Math.max(0, (Array.isArray(body.pools) ? body.pools.length : 0) - pools.length)
        + protectedPoolCount,
      history: Math.max(0, (Array.isArray(body.history) ? body.history.length : 0) - history.length),
    },
  });
}

function normalizeDetailedRecordLocator(body = {}) {
  const recordId = normalizeAccountText(body.recordId || body.record_id, 200);
  const gameUid = normalizeAccountText(body.gameUid || body.game_uid, 160);
  const serverScope = normalizeAccountText(body.serverScope || body.server_scope, 160);
  const poolId = normalizePoolId(body.currentPoolId || body.current_pool_id || body.poolId || body.pool_id);
  const seqId = normalizeAccountText(body.seqId || body.seq_id, 200);
  return { recordId, gameUid, serverScope, poolId, seqId };
}

function applyDetailedRecordLocator(query, userId, locator) {
  let nextQuery = query
    .eq('user_id', userId)
    .eq('record_id', locator.recordId)
    .eq('game_uid', locator.gameUid)
    .eq('pool_id', locator.poolId)
    .eq('seq_id', locator.seqId);
  if (locator.serverScope) {
    nextQuery = nextQuery.eq('server_scope', locator.serverScope);
  }
  return nextQuery;
}

function validateDetailedRecordLocator(locator, res) {
  if (!locator.recordId || !locator.gameUid || !locator.poolId || !locator.seqId) {
    sendError(res, 400, '缺少记录所属账号、卡池或序号信息', 'record_scope_required');
    return false;
  }
  return true;
}

async function loadDetailedHistoryRecord(adminClient, userId, locator) {
  const query = applyDetailedRecordLocator(adminClient.from('history').select('*'), userId, locator);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadCatalogPool(adminClient, poolId) {
  const { data, error } = await adminClient
    .from('pools')
    .select('pool_id, name, type')
    .eq('pool_id', poolId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadCatalogItem(adminClient, characterId) {
  const { data, error } = await adminClient
    .from('characters')
    .select('id, name, rarity, type')
    .eq('id', characterId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function buildChangedFields(oldValues, newValues) {
  return Object.keys(newValues).filter((field) => oldValues[field] !== newValues[field]);
}

async function handlePatchDetailedHistoryRecord(req, res, adminClient, userId) {
  const body = parseRequestBody(req);
  const locator = normalizeDetailedRecordLocator(body);
  if (!validateDetailedRecordLocator(locator, res)) return;

  const expectedVersion = Number(body.editVersion ?? body.edit_version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return sendError(res, 400, '记录版本无效，请刷新后重试', 'edit_version_required');
  }

  const current = await loadDetailedHistoryRecord(adminClient, userId, locator);
  if (!current) {
    return sendError(res, 404, '没有找到这条记录，或它不属于当前用户', 'history_record_not_found');
  }
  if (Number(current.edit_version || 1) !== expectedVersion) {
    return sendError(res, 409, '这条记录已在其他页面被修改，请刷新后重试', 'history_record_conflict');
  }

  const changes = body.changes && typeof body.changes === 'object' ? body.changes : {};
  const update = {};

  if (Object.prototype.hasOwnProperty.call(changes, 'timestamp')) {
    const timestamp = new Date(changes.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      return sendError(res, 400, '抽卡时间格式无效', 'invalid_history_timestamp');
    }
    update.timestamp = timestamp.toISOString();
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'poolId')) {
    const poolId = normalizePoolId(changes.poolId);
    const pool = poolId ? await loadCatalogPool(adminClient, poolId) : null;
    if (!pool) {
      return sendError(res, 400, '选择的卡池不存在，请刷新卡池列表后重试', 'invalid_history_pool');
    }
    update.pool_id = pool.pool_id;
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'characterId')) {
    const characterId = normalizeAccountText(changes.characterId, 200);
    const item = characterId ? await loadCatalogItem(adminClient, characterId) : null;
    if (!item) {
      return sendError(res, 400, '选择的角色或武器不存在，请刷新列表后重试', 'invalid_history_item');
    }
    update.character_id = item.id;
    update.character_name = item.name;
    update.item_name = item.name;
    update.rarity = Number(item.rarity);
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'drawMethod')) {
    const drawMethod = String(changes.drawMethod || '');
    if (!['normal', 'free', 'info_book'].includes(drawMethod)) {
      return sendError(res, 400, '抽取方式无效', 'invalid_draw_method');
    }
    update.is_free = drawMethod === 'free';
    update.is_info_book = drawMethod === 'info_book';
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'isStandard')) {
    if (typeof changes.isStandard !== 'boolean') {
      return sendError(res, 400, 'UP/常驻标记格式无效', 'invalid_standard_flag');
    }
    update.is_standard = changes.isStandard;
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'specialType')) {
    const specialType = changes.specialType == null || changes.specialType === '' ? null : String(changes.specialType);
    if (specialType !== null && !['gift', 'guaranteed'].includes(specialType)) {
      return sendError(res, 400, '特殊记录标记无效', 'invalid_special_type');
    }
    update.special_type = specialType;
  }

  const changedFields = buildChangedFields(current, update);
  if (changedFields.length === 0) {
    return res.status(200).json({
      success: true,
      updated: 0,
      record: formatAccountGachaHistoryRows([current])[0],
    });
  }

  const { data: mutation, error: updateError } = await adminClient.rpc('update_history_record_controlled', {
    p_user_id: userId,
    p_record_id: locator.recordId,
    p_game_uid: locator.gameUid,
    p_server_scope: locator.serverScope || null,
    p_pool_id: locator.poolId,
    p_seq_id: locator.seqId,
    p_expected_version: expectedVersion,
    p_changes: update,
    p_reason: normalizeAccountText(body.reason, 500) || null,
  });
  if (updateError?.code === '23505') {
    return sendError(res, 409, '目标卡池中已经存在相同序号的记录，请检查卡池选择', 'history_record_duplicate');
  }
  if (updateError?.code === '40001') {
    return sendError(res, 409, '这条记录已在其他页面被修改，请刷新后重试', 'history_record_conflict');
  }
  if (updateError?.code === 'P0002') {
    return sendError(res, 404, '没有找到这条记录，或它不属于当前用户', 'history_record_not_found');
  }
  if (updateError) throw updateError;
  const updated = mutation?.record || null;
  if (!updated) {
    return sendError(res, 409, '这条记录已在其他页面被修改，请刷新后重试', 'history_record_conflict');
  }
  return res.status(200).json({
    success: true,
    updated: 1,
    record: formatAccountGachaHistoryRows([updated])[0],
  });
}

async function handleDeleteDetailedHistoryRecord(body, res, adminClient, userId) {
  const locator = normalizeDetailedRecordLocator(body);
  if (!validateDetailedRecordLocator(locator, res)) return;
  const current = await loadDetailedHistoryRecord(adminClient, userId, locator);
  if (!current) {
    return sendError(res, 404, '没有找到这条记录，或它不属于当前用户', 'history_record_not_found');
  }

  const { error } = await adminClient.rpc('delete_history_record_controlled', {
    p_user_id: userId,
    p_record_id: locator.recordId,
    p_game_uid: locator.gameUid,
    p_server_scope: locator.serverScope || null,
    p_pool_id: locator.poolId,
    p_seq_id: locator.seqId,
    p_reason: normalizeAccountText(body.reason, 500) || '用户删除异常记录',
  });
  if (error?.code === 'P0002') {
    return sendError(res, 404, '没有找到这条记录，或它不属于当前用户', 'history_record_not_found');
  }
  if (error) throw error;

  return res.status(200).json({
    success: true,
    deleted: { history: 1, pools: 0 },
  });
}

async function handleDeleteAccountGachaData(req, res, adminClient, userId) {
  const body = parseRequestBody(req);
  const action = String(body.action || '').trim();

  if (action === 'record') {
    return handleDeleteDetailedHistoryRecord(body, res, adminClient, userId);
  }

  if (action === 'records') {
    const recordIds = normalizeRecordIds(body.recordIds);
    if (recordIds.length === 0) {
      return res.status(200).json({
        success: true,
        deleted: {
          history: 0,
          pools: 0,
        },
      });
    }

    const { data, error } = await adminClient.rpc('delete_history_records_controlled', {
      p_user_id: userId,
      p_record_ids: recordIds,
      p_reason: '用户批量删除记录',
    });

    if (error?.code === '21000' || String(error?.message || '').includes('ambiguous_history_record_id')) {
      return sendError(
        res,
        409,
        '所选记录 ID 跨多个游戏账号重复，请刷新页面后按完整记录重新删除',
        'ambiguous_history_record_id'
      );
    }
    if (error) throw error;

    return res.status(200).json({
      success: true,
      deleted: {
        history: Number(data?.deleted || 0),
        pools: 0,
      },
    });
  }

  if (action === 'poolHistory') {
    const poolId = normalizePoolId(body.poolId);
    if (!poolId) {
      return sendError(res, 400, 'Missing pool id', 'pool_id_required');
    }

    const { error } = await adminClient.from('history').delete().eq('user_id', userId).eq('pool_id', poolId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      deleted: {
        history: null,
        pools: 0,
      },
    });
  }

  if (action === 'pool') {
    const poolId = normalizePoolId(body.poolId);
    if (!poolId) {
      return sendError(res, 400, 'Missing pool id', 'pool_id_required');
    }

    const { error } = await adminClient.from('pools').delete().eq('user_id', userId).eq('pool_id', poolId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      deleted: {
        history: 0,
        pools: 1,
      },
    });
  }

  if (action === 'all') {
    const { error: historyError } = await adminClient.from('history').delete().eq('user_id', userId);
    if (historyError) throw historyError;

    const { error: poolError } = await adminClient.from('pools').delete().eq('user_id', userId);
    if (poolError) throw poolError;

    return res.status(200).json({
      success: true,
      deleted: {
        history: null,
        pools: null,
      },
    });
  }

  return sendError(res, 400, 'Unsupported delete action', 'unsupported_delete_action');
}

export default async function accountGachaDataHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (
    rejectDisallowedBrowserOrigin(req, res, {
      methods: 'GET, POST, PATCH, DELETE, OPTIONS',
      headers: 'Content-Type, Authorization',
    })
  ) {
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    sendError(res, 405, 'Method not allowed', 'method_not_allowed');
    return;
  }

  const adminClient = getSupabaseAdminClient();
  const authResult = await resolveAuthenticatedRequestUser(req, {
    adminClient,
    // 应用初始化已有独立的 last_seen 更新；GET 避免为大数据读取增加两次跨网写入。
    touch: Boolean(adminClient) && req.method !== 'GET',
  });

  if (!authResult.ok) {
    sendError(
      res,
      authResult.status || 401,
      authResult.error || 'Authentication required',
      authResult.code || 'authentication_required'
    );
    return;
  }

  try {
    const dbClient = adminClient || authResult.callerClient;
    if (!dbClient) {
      sendError(res, 503, 'Auth service not configured', 'auth_service_not_configured');
      return;
    }
    const useAdminFeatures = Boolean(adminClient);

    if (req.method === 'POST') {
      const body = parseRequestBody(req);
      if (body.action === 'resolveAliases') {
        await handleResolveAccountGachaAliases(body, res, dbClient, {
          optionalAliases: !useAdminFeatures,
        });
        return;
      }
      if (body.action === 'updateServerLabel') {
        clearTransientPersonalAnalysisCache(authResult.user.id);
        await handleUpdateAccountServerLabel(body, res, dbClient, authResult.user.id);
        return;
      }
      clearTransientPersonalAnalysisCache(authResult.user.id);
      await handleSaveAccountGachaData(body, res, dbClient, authResult.user.id, {
        // Personal browser writes must never invoke global catalog/history
        // reconciliation, even when the route has a service-role client.
        reconcile: false,
        optionalAliases: !useAdminFeatures,
      });
      return;
    }

    if (req.method === 'DELETE') {
      clearTransientPersonalAnalysisCache(authResult.user.id);
      await handleDeleteAccountGachaData(req, res, dbClient, authResult.user.id);
      return;
    }

    if (req.method === 'PATCH') {
      clearTransientPersonalAnalysisCache(authResult.user.id);
      await handlePatchDetailedHistoryRecord(req, res, dbClient, authResult.user.id);
      return;
    }

    const url = getRequestUrl(req);
    const mode = url.searchParams.get('mode');
    if (mode === 'analysis') {
      if (shouldUseTransientPersonalAnalysis(adminClient)) {
        await handleLoadTransientPersonalAnalysis(url, res, dbClient, authResult);
      } else {
        await handleLoadPersonalAnalysis(url, res, dbClient, authResult);
      }
      return;
    }

    if (mode === 'history') {
      const scope = readHistoryPageScope(url);
      const limit = normalizeHistoryPageLimit(url.searchParams.get('limit'));
      const stateBeforeRead = await loadPersonalAnalysisScopeState(
        dbClient,
        authResult.user.id,
        scope
      );
      const { rows, page } = await loadHistoryPageForScope(dbClient, authResult.user.id, scope, {
        cursor: url.searchParams.get('cursor') || '',
        limit,
        historyRevision: stateBeforeRead.historyRevision,
      });
      const stateAfterRead = await loadPersonalAnalysisScopeState(
        dbClient,
        authResult.user.id,
        scope
      );
      if (
        stateBeforeRead.available
        && stateAfterRead.available
        && stateBeforeRead.historyRevision !== stateAfterRead.historyRevision
      ) {
        throw new AccountGachaDataRequestError(
          'History changed while reading this page; retry from the first page',
          'history_revision_changed',
          409
        );
      }
      const [poolAliasMap, characterAliasMap] = await Promise.all([
        resolveAliasMapOptional(
          resolvePoolAliasMap,
          dbClient,
          rows.map((row) => row?.pool_id),
          'official_api',
          { optional: !useAdminFeatures }
        ),
        resolveAliasMapOptional(
          resolveCharacterAliasMap,
          dbClient,
          rows.map((row) => row?.character_id),
          'official_api',
          { optional: !useAdminFeatures }
        ),
      ]);

      res.status(200).json({
        success: true,
        mode: 'history',
        source: authResult.source || 'unknown',
        meta: {
          ownerId: authResult.user.id,
          rawIncluded: true,
          count: rows.length,
          revision: stateAfterRead.historyRevision,
          revisionAvailable: stateBeforeRead.available && stateAfterRead.available,
          snapshotRevision: stateAfterRead.snapshotRevision,
          analysisSchemaVersion: stateAfterRead.analysisSchemaVersion,
        },
        scope: {
          accountKey: scope.accountKey,
          gameUid: scope.gameUid,
          serverScope: scope.serverScope,
          poolId: scope.poolId || null,
        },
        records: formatAccountGachaHistoryRows(rows, {
          poolAliasMap,
          characterAliasMap,
        }),
        page,
        warnings: stateBeforeRead.available && stateAfterRead.available
          ? []
          : [{ code: 'history_revision_unavailable' }],
      });
      return;
    }

    if (mode === 'seq-keys') {
      const { keys, truncated } = await loadHistorySeqKeysForUser(dbClient, authResult.user.id, {
        gameUid: url.searchParams.get('gameUid') || '',
        serverId: url.searchParams.get('serverId') || '',
        region: url.searchParams.get('region') || '',
      });
      res.status(200).json({
        success: true,
        source: authResult.source || 'unknown',
        keys,
        meta: {
          ownerId: authResult.user.id,
          count: keys.length,
          pageSize: PAGE_SIZE,
          truncated,
        },
        warnings: truncated ? [{ code: 'history_seq_key_page_limit_reached' }] : [],
      });
      return;
    }

    const { rows, truncated } = await loadAllHistoryForUser(dbClient, authResult.user.id);
    const [poolAliasMap, characterAliasMap] = await Promise.all([
      resolveAliasMapOptional(
        resolvePoolAliasMap,
        dbClient,
        rows.map((row) => row?.pool_id),
        'official_api',
        { optional: !useAdminFeatures }
      ),
      resolveAliasMapOptional(
        resolveCharacterAliasMap,
        dbClient,
        rows.map((row) => row?.character_id),
        'official_api',
        { optional: !useAdminFeatures }
      ),
    ]);

    res.status(200).json({
      success: true,
      source: authResult.source || 'unknown',
      history: formatAccountGachaHistoryRows(rows, {
        poolAliasMap,
        characterAliasMap,
      }),
      meta: {
        ownerId: authResult.user.id,
        count: rows.length,
        pageSize: PAGE_SIZE,
        truncated,
      },
      warnings: truncated ? [{ code: 'history_page_limit_reached' }] : [],
    });
  } catch (error) {
    if (error instanceof AccountGachaDataRequestError) {
      sendError(res, error.status, error.message, error.code);
      return;
    }
    const errorCode = req.method === 'GET'
      ? 'account_gacha_data_load_failed'
      : req.method === 'POST'
        ? 'account_gacha_data_save_failed'
        : 'account_gacha_data_delete_failed';
    serverLogger.error('account-gacha-data.request-failed', {
      method: req.method,
      code: String(error?.code || errorCode).slice(0, 120),
      name: String(error?.name || 'Error').slice(0, 80),
    });
    sendError(
      res,
      500,
      'Failed to process account gacha data',
      errorCode
    );
  }
}

export const __internal = {
  decodeHistoryPageCursor,
  clearTransientPersonalAnalysisCache,
  encodeHistoryPageCursor,
  formatHistoryRows: formatAccountGachaHistoryRows,
  handleLoadPersonalAnalysis,
  handleLoadTransientPersonalAnalysis,
  handleUpdateAccountServerLabel,
  handleDeleteAccountGachaData,
  handleResolveAccountGachaAliases,
  handleSaveAccountGachaData,
  loadAllHistoryForUser,
  loadHistoryPageForScope,
  loadHistorySeqKeysForUser,
  loadPersonalAnalysisOwnerState,
  loadProjectedPersonalAnalysisAccountSnapshot,
  loadPersonalAnalysisSnapshot,
  loadPersonalAnalysisScopeState,
  readHistoryPageScope,
  shouldUseTransientPersonalAnalysis,
};
