/**
 * 完全后端化导入服务
 *
 * 功能：
 * 1. 接收前端提交的 token 和账号信息
 * 2. 后端执行完整的认证链
 * 3. 后端获取所有抽卡记录
 * 4. 后端处理数据（去重、计算 pity、normalizeIsStandard）
 * 5. 后端直接写入 Supabase
 * 6. 前端通过轮询获取进度
 *
 * @version 1.6.3
 * @date 2026-07-19
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import {
  resolveAliasValue,
  resolveCharacterAliasMap,
  resolvePoolAliasMap,
} from './lib/idAliasService.js';
import { fetchWithNetworkRetry } from './lib/networkFetch.js';
import {
  reconcileOfficialCharacterIds,
  reconcileOfficialPoolIds,
} from './lib/officialIdReconciliation.js';
import { classifyCharacterIdSource } from './lib/canonicalEntityUtils.js';
import { buildOfficialImportRecordKey } from './lib/officialImportIncremental.js';
import {
  filterOfficialImportPullRecords,
  hasActionableImportIdentityIssues,
  hasWriteBlockingImportIssues,
  isOfficialImportNonPullRecord,
  normalizeOfficialImportRecord,
  summarizeOfficialImportIssues,
} from '../shared/officialImportRecordNormalizer.js';
import { calculateHistoryPity } from '../shared/historyPity.js';
import {
  confirmOfficialImportTask,
  getOfficialImportReview,
  rejectOfficialImportTask,
  stageOfficialImportTask,
} from './lib/officialImportStaging.js';

// Supabase Admin 客户端（需要 SUPABASE_SECRET_KEY；旧 service_role_key 仍兼容）
let supabaseAdmin = null;
const HISTORY_PAGE_SIZE = 1000;

export class AuthTokenVerificationError extends Error {
  constructor(code, message = 'Invalid or expired session', details = {}) {
    super(message);
    this.name = 'AuthTokenVerificationError';
    this.code = code;
    this.publicCode = code;
    this.publicDetails = sanitizeAuthVerificationDetails(details);
  }
}

export const FULL_IMPORT_MODES = {
  INCREMENTAL: 'incremental',
  FULL: 'full',
};

export function normalizeFullImportMode(mode) {
  return mode === FULL_IMPORT_MODES.FULL
    ? FULL_IMPORT_MODES.FULL
    : FULL_IMPORT_MODES.INCREMENTAL;
}

/**
 * 初始化 Supabase Admin 客户端
 */
export function initSupabaseAdmin(supabaseUrl, serviceRoleKey) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY');
  }

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    global: {
      fetch: (input, init) => fetchWithNetworkRetry(input, init, { label: 'supabase-admin' })
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    realtime: {
      transport: WebSocket
    }
  });

  console.log('[FullImportService] Supabase Admin initialized');
}

function normalizeString(value, maxLength = 4096) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) {
    return '';
  }
  return text;
}

function normalizeImportServerIdForSource(serverId, source = 'cn') {
  const normalized = normalizeString(serverId, 80);
  if (!normalized) {
    return '';
  }

  if (source === 'intl') {
    return normalized === '2' || normalized === '3' ? normalized : '';
  }

  if (source === 'cn') {
    return normalized === '1' ? normalized : '';
  }

  return normalized;
}

function inferImportServerIdFromSignals(account = {}, source = 'cn') {
  const signal = [
    account.serverTag,
    account.server_tag,
    account.serverLabel,
    account.server_label,
    account.region,
    account.serverRegion,
    account.serverName,
    account.channelName,
    account.channel_name,
    source,
  ].map(value => normalizeString(value, 160)).filter(Boolean).join(' ').toLowerCase();

  if (/(^|[^a-z])(cn|china|mainland)([^a-z]|$)|国服|官服|b服|大陆|官方/.test(signal)) {
    return '1';
  }

  if (/(^|[^a-z])(eu|na|us)([^a-z]|$)|america|europe|global|欧\/美|欧美|欧服|美服/.test(signal)) {
    return '3';
  }

  if (/(^|[^a-z])(asia|sea|jp|kr|tw|hk|mo|sg)([^a-z]|$)|亚服|亚洲/.test(signal)) {
    return '2';
  }

  return null;
}

function normalizeImportRegion(serverId, account = {}, source = 'cn') {
  if (source === 'intl') {
    return 'intl';
  }

  if (serverId === '1') {
    return 'cn';
  }

  if (serverId === '2' || serverId === '3' || source === 'intl') {
    return 'intl';
  }

  const rawRegion = normalizeString(account.region || account.serverRegion || account.serverName, 80);
  return rawRegion || null;
}

function pickExistingServerIdFromRows(rows, source = 'cn') {
  const counts = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const serverId = normalizeString(row?.server_id || row?.serverId, 80);
    if (!serverId) {
      return;
    }
    if (source === 'intl' && serverId === '1') {
      return;
    }
    if (source === 'cn' && serverId !== '1') {
      return;
    }
    counts.set(serverId, (counts.get(serverId) || 0) + 1);
  });

  if (counts.size !== 1) {
    return null;
  }

  return Array.from(counts.keys())[0];
}

async function resolveExistingAccountServerId(supabase, userId, gameUid, source = 'cn') {
  if (!supabase || !userId || !gameUid) {
    return null;
  }

  const { data, error } = await supabase
    .from('history')
    .select('server_id')
    .eq('user_id', userId)
    .eq('game_uid', gameUid)
    .range(0, HISTORY_PAGE_SIZE - 1);

  if (error) {
    console.warn('[FullImportService] 查询既有账号区服失败，将使用本次导入返回的区服信息:', error.message || error);
    return null;
  }

  return pickExistingServerIdFromRows(data, source);
}

async function resolveImportAccountServerContext(supabase, userId, account = {}, source = 'cn') {
  const explicitServerId = normalizeImportServerIdForSource(account.serverId || account.server_id, source);
  const inferredServerId = normalizeImportServerIdForSource(inferImportServerIdFromSignals(account, source), source);
  const existingServerId = normalizeImportServerIdForSource(
    await resolveExistingAccountServerId(supabase, userId, account.gameUid || account.game_uid, source),
    source
  );
  const serverId = inferredServerId
    || existingServerId
    || explicitServerId
    || (source === 'cn' ? '1' : null);
  const region = normalizeImportRegion(serverId, account, source);

  return {
    serverId,
    region,
    requestServerId: serverId || (source === 'intl' ? '2' : '1'),
  };
}

function getAlternateIntlServerId(serverId) {
  const normalized = normalizeImportServerIdForSource(serverId, 'intl');
  if (normalized === '2') {
    return '3';
  }
  if (normalized === '3') {
    return '2';
  }
  return '';
}

function collectRecordsFetchErrorText(result = {}) {
  const failedPools = Array.isArray(result?.data?.failed) ? result.data.failed : [];
  return [
    result?.error,
    result?.message,
    result?.data?.error,
    result?.data?.message,
    ...failedPools.flatMap(item => [item?.error, item?.message, item?.msg, item?.reason]),
  ].map(value => normalizeString(value, 500)).filter(Boolean).join(' ');
}

function isTokenInvalidRecordsFetchResult(result = {}) {
  const message = collectRecordsFetchErrorText(result).toLowerCase();
  return /token is invalid|invalid token|token无效|请检查token是否有效/.test(message);
}

function withResolvedRequestServerContext(context = {}, serverId, account = {}, source = 'cn') {
  const normalizedServerId = normalizeImportServerIdForSource(serverId, source);
  if (!normalizedServerId) {
    return context;
  }

  return {
    ...context,
    serverId: normalizedServerId,
    region: normalizeImportRegion(normalizedServerId, account, source),
    requestServerId: normalizedServerId,
  };
}

function normalizeResolvedCharacterIdForStorage(rawCharacterId, resolvedCharacterId) {
  const rawId = normalizeString(rawCharacterId, 160);
  const resolvedId = normalizeString(resolvedCharacterId, 160);
  if (!resolvedId) {
    return null;
  }

  if (rawId && rawId === resolvedId && classifyCharacterIdSource(rawId) === 'source_raw') {
    return null;
  }

  return resolvedId;
}

function base64UrlToBuffer(value) {
  const normalized = normalizeString(value).replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) {
    return Buffer.alloc(0);
  }
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function base64UrlToJson(value) {
  const buffer = base64UrlToBuffer(value);
  if (!buffer.length) {
    return null;
  }
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

function sanitizeAuthVerificationDetails(details = {}) {
  const sanitized = {};
  if (Number.isFinite(Number(details.exp))) {
    sanitized.exp = Number(details.exp);
  }
  if (Number.isFinite(Number(details.now))) {
    sanitized.now = Number(details.now);
  }
  if (Number.isFinite(Number(details.secondsSinceExpiry))) {
    sanitized.secondsSinceExpiry = Number(details.secondsSinceExpiry);
  }
  if (details.tokenKind) {
    sanitized.tokenKind = String(details.tokenKind).slice(0, 80);
  }
  return sanitized;
}

function createAuthTokenError(code, details = {}) {
  return new AuthTokenVerificationError(code, 'Invalid or expired session', details);
}

function hmacBase64Url(value, secret) {
  return createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

function signaturesMatch(actualSignature, expectedSignature) {
  const actual = Buffer.from(String(actualSignature || ''));
  const expected = Buffer.from(String(expectedSignature || ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function loadUserByVerifiedJwtPayload(supabase, payload) {
  const userId = normalizeString(payload?.sub, 128);
  if (!userId) {
    throw createAuthTokenError('compat_jwt_missing_subject');
  }

  const { data: authData } = await supabase.auth.admin.getUserById(userId);
  const authUser = authData?.user || authData || null;
  if (authUser?.id) {
    return authUser;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, username, role')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.id) {
    return {
      id: profile.id,
      email: profile.email || payload.email || null,
      role: 'authenticated',
      app_metadata: payload.app_metadata || {},
      user_metadata: {
        ...(payload.user_metadata || {}),
        username: profile.username || payload.user_metadata?.username || '',
        profile_role: profile.role || null,
      },
    };
  }

  throw createAuthTokenError('compat_jwt_user_not_found');
}

async function verifyActiveCompatSession(supabase, payload) {
  const sessionId = normalizeString(payload?.session_id, 128);
  const userId = normalizeString(payload?.sub, 128);
  if (!sessionId || !userId) {
    throw createAuthTokenError('compat_jwt_session_binding_missing');
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('app_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .gt('absolute_expires_at', nowIso)
    .maybeSingle();

  if (error) {
    throw createAuthTokenError('compat_jwt_session_lookup_failed');
  }
  if (!data?.id) {
    throw createAuthTokenError('compat_jwt_session_inactive');
  }
}

async function verifySiteSessionCompatToken(supabase, accessToken) {
  const jwtSecret = normalizeString(process.env.SUPABASE_JWT_SECRET || '');
  if (!jwtSecret) {
    throw createAuthTokenError('compat_jwt_secret_missing');
  }

  const parts = normalizeString(accessToken, 8192).split('.');
  if (parts.length !== 3) {
    throw createAuthTokenError('access_token_malformed');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = base64UrlToJson(encodedHeader);
  const payload = base64UrlToJson(encodedPayload);
  if (header?.alg !== 'HS256' || !payload) {
    throw createAuthTokenError('compat_jwt_invalid_header_or_payload');
  }

  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = hmacBase64Url(unsigned, jwtSecret);
  if (!signaturesMatch(signature, expectedSignature)) {
    const tokenKind = payload?.user_metadata?.site_session === true || payload?.app_metadata?.provider === 'site_session'
      ? 'site_session'
      : 'non_site_session';
    throw createAuthTokenError('compat_jwt_signature_mismatch', { tokenKind });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= nowSeconds) {
    throw createAuthTokenError('compat_jwt_expired', {
      exp: Number(payload.exp),
      now: nowSeconds,
      secondsSinceExpiry: nowSeconds - Number(payload.exp || 0),
    });
  }
  if (payload.aud !== 'authenticated' || payload.role !== 'authenticated') {
    throw createAuthTokenError('compat_jwt_invalid_claims');
  }
  if (payload.user_metadata?.site_session !== true || payload.app_metadata?.provider !== 'site_session') {
    throw createAuthTokenError('compat_jwt_not_site_session');
  }

  await verifyActiveCompatSession(supabase, payload);
  return loadUserByVerifiedJwtPayload(supabase, payload);
}

async function verifyNativeBearerSession(supabase, user, payload) {
  const sessionId = normalizeString(payload?.session_id, 128);
  const issuedAt = Number(payload?.iat || 0);
  if (!sessionId || !Number.isFinite(issuedAt) || issuedAt <= 0) {
    throw createAuthTokenError('auth_session_binding_missing');
  }

  const { data: allowed, error } = await supabase.rpc('is_bearer_auth_session_allowed', {
    p_user_id: user.id,
    p_auth_session_id: sessionId,
    p_bearer_issued_at: new Date(issuedAt * 1000).toISOString(),
  });
  if (error) {
    throw createAuthTokenError('auth_session_lookup_failed');
  }
  if (allowed !== true) {
    throw createAuthTokenError('auth_session_revoked');
  }
}

export function getAuthVerificationPublicDetails(error) {
  if (error instanceof AuthTokenVerificationError || error?.publicCode) {
    return {
      reason: error.publicCode || error.code || 'auth_session_invalid',
      ...(error.publicDetails && Object.keys(error.publicDetails).length > 0
        ? { details: error.publicDetails }
        : {}),
    };
  }

  return {
    reason: 'auth_session_invalid',
  };
}

/**
 * 使用前端 Supabase access token 校验当前调用者身份
 * @param {string} accessToken
 * @returns {Promise<object>} Supabase user
 */
export async function verifySupabaseAccessToken(accessToken) {
  const supabase = getSupabaseAdmin();

  if (!accessToken) {
    throw new Error('Missing access token');
  }

  const [, encodedPayload] = normalizeString(accessToken, 8192).split('.');
  const unverifiedPayload = base64UrlToJson(encodedPayload);
  const isSiteSessionCompatToken = unverifiedPayload?.user_metadata?.site_session === true
    && unverifiedPayload?.app_metadata?.provider === 'site_session';
  if (isSiteSessionCompatToken) {
    return verifySiteSessionCompatToken(supabase, accessToken);
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  const user = data?.user || null;
  if (!error && user?.id) {
    await verifyNativeBearerSession(supabase, user, unverifiedPayload);
    return user;
  }

  return verifySiteSessionCompatToken(supabase, accessToken);
}

/**
 * 获取 Supabase Admin 客户端
 */
function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error('Supabase Admin not initialized. Call initSupabaseAdmin() first.');
  }
  return supabaseAdmin;
}

/**
 * 简单字符串哈希函数（与前端保持一致）
 */
function simpleStringHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash % 1000); // 与旧前端 ImportManager.jsx 保持一致
}

const POOL_TYPE_MAP = {
  joint: 'extra',
  extra: 'extra',
  special: 'limited',
  standard: 'standard',
  beginner: 'beginner',
  weponbox: 'weapon',
  weaponbox: 'weapon',
  weapon: 'weapon'
};

const POOL_TYPE_ENUM_MAP = {
  E_CharacterGachaPoolType_Joint: 'extra',
  E_CharacterGachaPoolType_Special: 'limited',
  E_CharacterGachaPoolType_Standard: 'standard',
  E_CharacterGachaPoolType_Beginner: 'beginner'
};

function getFallbackPoolId(type, poolType) {
  if (type === 'extra') return 'extra';
  if (type === 'weapon') return 'weaponbox';
  if (poolType === 'E_CharacterGachaPoolType_Joint') return 'joint';
  if (poolType === 'E_CharacterGachaPoolType_Special') return 'special';
  if (poolType === 'E_CharacterGachaPoolType_Standard') return 'standard';
  if (poolType === 'E_CharacterGachaPoolType_Beginner') return 'beginner';
  return String(poolType || type || 'unknown');
}

function getOfficialPoolId(record, type, poolType) {
  return String(record.poolId || record.pool_id || getFallbackPoolId(type, poolType));
}

function getPoolTypeFromId(poolId, type, poolType) {
  if (poolId) {
    const prefix = String(poolId).split('_')[0].toLowerCase();
    if (POOL_TYPE_MAP[prefix]) {
      return POOL_TYPE_MAP[prefix];
    }
  }

  if (type === 'weapon') {
    return 'weapon';
  }

  return POOL_TYPE_ENUM_MAP[poolType] || 'standard';
}

function getDefaultPoolName(poolId, type) {
  switch (type) {
    case 'extra':
      return '附加寻访';
    case 'limited':
      return '限定角色池';
    case 'standard':
      return '基础寻访';
    case 'beginner':
      return '启程寻访';
    case 'weapon':
      return '武器池';
    default:
      return poolId || '未知卡池';
  }
}

function buildImportPoolSummary(rawResults = []) {
  const byPool = {};
  const byPoolType = {};

  (Array.isArray(rawResults) ? rawResults : []).forEach((poolData) => {
    const { type, poolType, records } = poolData || {};

    filterOfficialImportPullRecords(records).forEach((record) => {
      const poolId = getOfficialPoolId(record, type, poolType);
      const normalizedPoolType = getPoolTypeFromId(poolId, type, poolType);
      const poolName = record.poolName || record.pool_name || getDefaultPoolName(poolId, normalizedPoolType);

      byPool[poolName] = (byPool[poolName] || 0) + 1;
      byPoolType[normalizedPoolType] = (byPoolType[normalizedPoolType] || 0) + 1;
    });
  });

  return {
    byPool,
    byPoolType,
  };
}

function countOfficialImportPullRecords(rawResults = []) {
  return (Array.isArray(rawResults) ? rawResults : []).reduce(
    (total, poolData) => total + filterOfficialImportPullRecords(poolData?.records).length,
    0
  );
}

const LEGACY_NON_PULL_PLACEHOLDER_NAMES = new Set([
  '',
  '未知',
  'unknown',
  '未知目标',
  '未知角色或武器',
]);

function isLegacyNonPullPlaceholderName(value) {
  return LEGACY_NON_PULL_PLACEHOLDER_NAMES.has(normalizeString(value, 160).toLowerCase());
}

export function isLegacyOfficialNonPullArtifact(historyRecord = {}, marker = {}) {
  const historyTimestamp = new Date(historyRecord.timestamp);
  const markerTimestamp = new Date(marker.timestamp);
  const timestampsMatch = !Number.isNaN(historyTimestamp.getTime())
    && !Number.isNaN(markerTimestamp.getTime())
    && historyTimestamp.toISOString() === markerTimestamp.toISOString();
  const markerServerId = normalizeString(marker.serverId, 160);
  const serverMatches = !markerServerId
    || normalizeString(historyRecord.server_id, 160) === markerServerId
    || normalizeString(historyRecord.server_scope, 160) === markerServerId;

  return Number(historyRecord.rarity) === 4
    && !normalizeString(historyRecord.character_id, 200)
    && isLegacyNonPullPlaceholderName(historyRecord.character_name)
    && isLegacyNonPullPlaceholderName(historyRecord.item_name)
    && normalizeString(historyRecord.pool_id, 160) === normalizeString(marker.poolId, 160)
    && normalizeString(historyRecord.seq_id, 200) === normalizeString(marker.seqId, 200)
    && serverMatches
    && timestampsMatch;
}

function collectOfficialNonPullMarkers(rawResults = [], account = {}, accountServerContext = {}) {
  const markers = [];
  (Array.isArray(rawResults) ? rawResults : []).forEach((poolData) => {
    const { type, poolType, records } = poolData || {};
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!isOfficialImportNonPullRecord(record)) {
        return;
      }
      const normalized = normalizeOfficialImportRecord(record, {
        gameUid: account.gameUid,
        serverId: accountServerContext.serverId,
        region: accountServerContext.region,
        type,
        poolType,
        poolId: getOfficialPoolId(record, type, poolType),
      });
      if (normalized.poolId && normalized.seqId && normalized.timestamp) {
        markers.push({
          poolId: normalized.poolId,
          seqId: normalized.seqId,
          timestamp: normalized.timestamp,
          serverId: accountServerContext.serverId || null,
        });
      }
    });
  });

  return Array.from(new Map(markers.map((marker) => [
    `${marker.poolId}\u0000${marker.seqId}`,
    marker,
  ])).values());
}

export async function hasPendingOfficialNonPullRepairCandidates({
  supabase,
  userId,
  gameUid,
  serverScope,
} = {}) {
  if (!supabase || !userId || !gameUid) {
    return false;
  }

  try {
    const normalizedServerScope = normalizeString(serverScope, 160);
    for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
      let query = supabase
        .from('history_anomalies')
        .select('id,details')
        .eq('user_id', userId)
        .eq('game_uid', gameUid)
        .eq('issue_code', 'OFFICIAL_IMPORT_UNKNOWN_ITEM')
        .eq('status', 'pending');

      if (normalizedServerScope) {
        query = query.eq('server_scope', normalizedServerScope);
      }

      const { data, error } = await query.range(from, from + HISTORY_PAGE_SIZE - 1);
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      if (rows.some((row) => (
        Number(row?.details?.rarity) === 4
        && isLegacyNonPullPlaceholderName(row?.details?.itemName)
      ))) {
        return true;
      }
      if (rows.length < HISTORY_PAGE_SIZE) {
        return false;
      }
    }
  } catch (error) {
    // 查询失败时采用完整获取，避免增量提前停止掩盖可修复的旧占位。
    console.warn('[FullImportService] 查询情报书旧占位候选失败，将完整获取官方记录:', error?.message || error);
    return true;
  }
}

export async function repairLegacyOfficialNonPullArtifacts({
  supabase,
  userId,
  account,
  accountServerContext,
  rawResults,
} = {}) {
  const markers = collectOfficialNonPullMarkers(rawResults, account, accountServerContext);
  if (!supabase || !userId || !account?.gameUid || markers.length === 0) {
    return { repairedRecords: 0, failures: 0, warnings: [] };
  }

  let poolAliasMap;
  try {
    poolAliasMap = await resolvePoolAliasMap(
      supabase,
      markers.map((marker) => marker.poolId),
      'official_api'
    );
  } catch (error) {
    console.warn('[FullImportService] 情报书旧占位卡池映射失败:', error?.message || error);
    return {
      repairedRecords: 0,
      failures: markers.length,
      warnings: [{ code: 'OFFICIAL_IMPORT_NON_PULL_REPAIR_FAILED', count: markers.length }],
    };
  }

  let repairedRecords = 0;
  let failures = 0;
  for (const marker of markers) {
    const resolvedMarker = {
      ...marker,
      poolId: resolveAliasValue(poolAliasMap, marker.poolId),
    };
    try {
      let historyQuery = supabase
        .from('history')
        .select('record_id,game_uid,server_scope,server_id,pool_id,seq_id,timestamp,rarity,character_id,character_name,item_name')
        .eq('user_id', userId)
        .eq('game_uid', account.gameUid)
        .eq('pool_id', resolvedMarker.poolId)
        .eq('seq_id', resolvedMarker.seqId);
      if (resolvedMarker.serverId) {
        historyQuery = historyQuery.eq('server_scope', resolvedMarker.serverId);
      }
      const { data: historyRows, error: historyError } = await historyQuery.range(0, 0);
      if (historyError) throw historyError;

      const artifact = (Array.isArray(historyRows) ? historyRows : [])
        .find((row) => isLegacyOfficialNonPullArtifact(row, resolvedMarker));
      if (!artifact) {
        continue;
      }

      const { data: repairResult, error: repairError } = await supabase.rpc('repair_official_non_pull_artifact', {
        p_user_id: userId,
        p_record_id: String(artifact.record_id),
        p_game_uid: String(artifact.game_uid),
        p_server_scope: String(artifact.server_scope),
        p_pool_id: String(artifact.pool_id),
        p_seq_id: String(artifact.seq_id),
        p_marker_timestamp: resolvedMarker.timestamp,
      });
      if (repairError) throw repairError;
      repairedRecords += Number(repairResult?.repaired || 0);
    } catch (error) {
      failures += 1;
      console.warn('[FullImportService] 情报书旧占位自动修复失败:', error?.message || error);
    }
  }

  return {
    repairedRecords,
    failures,
    warnings: failures > 0
      ? [{ code: 'OFFICIAL_IMPORT_NON_PULL_REPAIR_FAILED', count: failures }]
      : [],
  };
}

function assignBatchIds(records) {
  const timestampGroups = new Map();

  records.forEach(record => {
    const key = record.timestamp || new Date().toISOString();
    if (!timestampGroups.has(key)) {
      timestampGroups.set(key, []);
    }
    timestampGroups.get(key).push(record);
  });

  const sortedTimestamps = Array.from(timestampGroups.keys()).sort((a, b) => {
    return new Date(a).getTime() - new Date(b).getTime();
  });

  let batchIndex = 0;
  const result = [];

  sortedTimestamps.forEach(timestampKey => {
    const batchId = `batch_${new Date(timestampKey).getTime()}_${batchIndex}`;
    const batch = timestampGroups.get(timestampKey) || [];

    batch.forEach(record => {
      result.push({
        ...record,
        batch_id: batchId
      });
    });

    batchIndex++;
  });

  return result;
}

export function buildStagedRecordsWithMetadata(processedRecords = [], stagedRecordMetadata = []) {
  if (processedRecords.length !== stagedRecordMetadata.length) {
    throw new Error('导入记录与异常信息数量不一致');
  }

  const recordsWithMetadataIndex = processedRecords.map((record, index) => ({
    ...record,
    __stagingMetadataIndex: index,
  }));
  const records = [];
  const stagedRecords = [];

  assignBatchIds(recordsWithMetadataIndex).forEach((recordWithIndex) => {
    const { __stagingMetadataIndex: metadataIndex, ...historyRecord } = recordWithIndex;
    records.push(historyRecord);
    stagedRecords.push({
      historyRecord,
      ...stagedRecordMetadata[metadataIndex],
    });
  });

  return { records, stagedRecords };
}

export function buildPostImportAnomalyRows(stagedRecords = [], userId) {
  return (Array.isArray(stagedRecords) ? stagedRecords : [])
    .filter((record) => (
      hasActionableImportIdentityIssues(record?.issues)
      && !hasWriteBlockingImportIssues(record?.issues)
    ))
    .map((record) => {
      const history = record.historyRecord || {};
      const serverScope = normalizeString(history.server_id, 160) || 'legacy';
      const issueCodes = (record.issues || [])
        .map((issue) => issue?.code)
        .filter(Boolean);
      return {
        user_id: userId,
        record_id: String(history.record_id),
        game_uid: String(history.game_uid),
        server_scope: serverScope,
        pool_id: String(history.pool_id),
        seq_id: String(history.seq_id),
        issue_code: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
        status: 'pending',
        details: {
          message: '本次官方导入没有完整识别这条记录的角色或武器，请确认它是否正确。',
          itemName: history.item_name || history.character_name || '未知角色或武器',
          rarity: history.rarity ?? null,
          timestamp: history.timestamp ?? null,
          pity: history.pity ?? null,
          serverId: history.server_id ?? null,
          region: history.region ?? null,
          issueCodes,
        },
      };
    });
}

export function buildPostImportAnomalyItems(anomalyRows = []) {
  return (Array.isArray(anomalyRows) ? anomalyRows : []).map((row) => ({
    recordId: row.record_id,
    gameUid: row.game_uid,
    serverScope: row.server_scope,
    poolId: row.pool_id,
    seqId: row.seq_id,
    issueCode: row.issue_code,
    itemName: row.details?.itemName || '未知角色或武器',
    rarity: row.details?.rarity ?? null,
    timestamp: row.details?.timestamp ?? null,
    pity: row.details?.pity ?? null,
    message: row.details?.message || '这条记录需要核对。',
  }));
}

export function resolveOfficialImportStorageQuality(normalized = {}) {
  if (
    normalized.quality === null
    && hasActionableImportIdentityIssues(normalized.issues)
    && !hasWriteBlockingImportIssues(normalized.issues)
  ) {
    return 4;
  }
  return normalized.quality;
}

export async function savePostImportAnomalies(supabase, stagedRecords, userId) {
  const anomalyRows = buildPostImportAnomalyRows(stagedRecords, userId);
  for (let index = 0; index < anomalyRows.length; index += 200) {
    const { error } = await supabase
      .from('history_anomalies')
      .upsert(anomalyRows.slice(index, index + 200), {
        onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id,issue_code',
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  return {
    anomalyRecords: anomalyRows.length,
    anomalyPoolIds: [...new Set(anomalyRows.map((row) => row.pool_id))],
    anomalyItems: buildPostImportAnomalyItems(anomalyRows),
  };
}

function splitHistoryUpsertGroups(records) {
  const serverScopedCompositeKeyRecords = [];
  const compositeKeyRecords = [];
  const legacyRecords = [];

  records.forEach(record => {
    if (record.game_uid && record.pool_id && record.seq_id) {
      if (record.server_id) {
        serverScopedCompositeKeyRecords.push(record);
      } else {
        compositeKeyRecords.push(record);
      }
    } else {
      legacyRecords.push(record);
    }
  });

  return { serverScopedCompositeKeyRecords, compositeKeyRecords, legacyRecords };
}

const HISTORY_OPTIONAL_COLUMNS = ['character_id', 'server_id', 'region'];

function detectMissingHistoryOptionalColumn(error) {
  const message = String(error?.message || '');

  for (const column of HISTORY_OPTIONAL_COLUMNS) {
    if (
      message.includes(`history.${column} does not exist`)
      || message.includes(`Could not find the '${column}' column`)
    ) {
      return column;
    }
  }

  return null;
}

function isMissingHistoryConflictTargetError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P10'
    || message.includes('no unique or exclusion constraint matching the on conflict specification')
    || message.includes('there is no unique or exclusion constraint matching the on conflict specification');
}

function omitHistoryColumns(rows, omittedColumns) {
  if (!omittedColumns.length) {
    return rows;
  }

  return rows.map((row) => {
    const nextRow = { ...row };
    omittedColumns.forEach((column) => {
      delete nextRow[column];
    });
    return nextRow;
  });
}

async function upsertHistoryGroupsWithOptionalColumnFallback(supabase, upsertGroups) {
  const supportedOptionalColumns = new Set(HISTORY_OPTIONAL_COLUMNS);

  for (const group of upsertGroups) {
    if (group.rows.length === 0) continue;

    let pendingRows = omitHistoryColumns(
      group.rows,
      HISTORY_OPTIONAL_COLUMNS.filter(column => !supportedOptionalColumns.has(column))
    );
    let onConflict = group.onConflict;

    while (true) {
      const result = await supabase
        .from('history')
        .upsert(pendingRows, { onConflict });

      if (!result.error) {
        break;
      }

      if (group.serverScopeKey && isMissingHistoryConflictTargetError(result.error)) {
        if (onConflict === 'user_id,game_uid,server_scope,pool_id,seq_id') {
          onConflict = 'user_id,game_uid,pool_id,seq_id';
          continue;
        }

        if (onConflict === 'user_id,game_uid,pool_id,seq_id') {
          onConflict = 'user_id,record_id';
          continue;
        }
      }

      const missingColumn = detectMissingHistoryOptionalColumn(result.error);
      if (!missingColumn || !supportedOptionalColumns.has(missingColumn)) {
        throw result.error;
      }

      supportedOptionalColumns.delete(missingColumn);
      console.warn(`[FullImportService] history.${missingColumn} 不存在，当前批次将按旧表结构保存`);
      pendingRows = omitHistoryColumns(
        group.rows,
        HISTORY_OPTIONAL_COLUMNS.filter(column => !supportedOptionalColumns.has(column))
      );
    }
  }
}

/**
 * 归一化 isStandard 字段（与前端 poolUtils.js 保持一致）
 * 注意：API 原始数据使用驼峰命名 (rarity/charId)，需要兼容两种格式
 */
function normalizeIsStandard(record, poolType, upCharacter) {
  if (record.rarity !== 6) {
    return false;
  }

  if (poolType === 'standard' || poolType === 'beginner') {
    return true;
  }

  if (poolType === 'extra') {
    return false;
  }

  if (poolType === 'limited' || poolType === 'limited_character' || poolType === 'weapon' || poolType === 'limited_weapon') {
    if (upCharacter) {
      const characterName = record.character_name || record.item_name || record.name || record.charName || record.weaponName || '';
      return !characterName.includes(upCharacter) && !upCharacter.includes(characterName);
    }

    if (record.isLimited !== undefined) {
      return !record.isLimited;
    }

    return false;
  }

  return false;
}

function calculatePity(records) {
  return calculateHistoryPity(records);
}

/**
 * 获取已存在的 seq_id（用于去重，带分页以突破 Supabase 1000 行限制）
 */
async function getExistingSeqIds(userId, gameUid, serverId = '') {
  const supabase = getSupabaseAdmin();
  const PAGE_SIZE = 1000;
  const allData = [];
  let from = 0;
  const normalizedServerId = normalizeString(serverId, 80);

  while (true) {
    let query = supabase
      .from('history')
      .select('seq_id, pool_id, server_id')
      .eq('user_id', userId)
      .eq('game_uid', gameUid);

    if (normalizedServerId) {
      query = query.eq('server_id', normalizedServerId);
    }

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('[FullImportService] Error fetching existing seq_ids:', error);
      return new Set();
    }

    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE_SIZE) break; // 最后一页
    from += PAGE_SIZE;
  }

  console.log(`[FullImportService] 已有记录: ${allData.length} 条`);

  // 使用 game_uid:server_id:pool_id:seq_id 组合作为唯一标识，避免不同区服互相跳过。
  return new Set(allData.map(r => buildOfficialImportRecordKey({
    gameUid,
    serverId: r.server_id || normalizedServerId,
    poolId: r.pool_id,
    seqId: r.seq_id,
  })).filter(Boolean));
}

/**
 * 保存卡池到数据库（如果不存在）
 */
export async function savePoolsToServer(pools, userId) {
  const supabase = getSupabaseAdmin();
  const reconciliation = await reconcileOfficialPoolIds(supabase, pools, {
    userId,
  });

  const poolAliasMap = await resolvePoolAliasMap(
    supabase,
    pools.map(pool => pool?.pool_id),
    'official_api'
  );
  const canonicalPools = pools.map(pool => ({
    ...pool,
    pool_id: resolveAliasValue(poolAliasMap, pool?.pool_id)
  }));
  const uniquePools = Array.from(
    new Map(canonicalPools.map(pool => [String(pool.pool_id), { ...pool, pool_id: String(pool.pool_id) }])).values()
  );

  // 确保所有 pool_id 都是字符串类型
  const poolIds = uniquePools.map(p => String(p.pool_id));

  // 查询已存在的卡池
  const { data: existingPools } = await supabase
    .from('pools')
    .select('pool_id')
    .in('pool_id', poolIds);

  const existingPoolIds = new Set(existingPools?.map(p => String(p.pool_id)) || []);

  // 只创建不存在的卡池
  const newPools = uniquePools.filter(p => !existingPoolIds.has(String(p.pool_id)));

  if (newPools.length > 0) {
    const { error } = await supabase
      .from('pools')
      .upsert(
        newPools.map(pool => ({
          ...pool,
          user_id: userId,
          created_at: new Date().toISOString()
        })),
        {
          onConflict: 'pool_id',
          ignoreDuplicates: true
        }
      );

    if (error) {
      throw new Error(`Failed to save pools: ${error.message}`);
    }
  }

  // Full import fallback only guarantees canonical pool rows exist.
  // Source alias remaps are owned by pool management / announcement sync,
  // while internal self aliases are maintained by the database trigger.

  return {
    success: true,
    created: newPools.length + Number(reconciliation?.created || 0),
    migrated: Number(reconciliation?.migrated || 0),
    skipped: Number(reconciliation?.skipped || 0),
  };
}

/**
 * 批量保存记录到数据库（增强错误处理和重试机制）
 * @param {Array} records - 要保存的记录数组
 * @param {string} userId - 用户 ID
 * @returns {Promise<Object>} 保存结果
 */
export async function saveHistoryToServer(records, userId) {
  const supabase = getSupabaseAdmin();
  const batchSize = 100;  // 每批次处理 100 条
  const maxRetries = 3;   // 最大重试次数
  let savedCount = 0;
  const failedBatches = [];

  console.log(`[FullImportService] 开始保存 ${records.length} 条记录，分 ${Math.ceil(records.length / batchSize)} 批次`);

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;
    let success = false;
    let lastError = null;

    // 重试机制
    for (let retry = 0; retry < maxRetries && !success; retry++) {
      try {
        const batchWithUser = batch.map(record => ({
          ...record,
          user_id: userId
        }));

        const { serverScopedCompositeKeyRecords, compositeKeyRecords, legacyRecords } = splitHistoryUpsertGroups(batchWithUser);
        const upsertGroups = [
          {
            rows: [...serverScopedCompositeKeyRecords, ...compositeKeyRecords],
            onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id',
            serverScopeKey: true,
          },
          { rows: legacyRecords, onConflict: 'user_id,record_id' }
        ];

        try {
          await upsertHistoryGroupsWithOptionalColumnFallback(supabase, upsertGroups);
          success = true;
          savedCount += batch.length;
        } catch (error) {
          lastError = error;
          // 检查是否是 pity 约束错误
          if (error.message.includes('pity_check') || error.message.includes('pity')) {
            console.error(`[FullImportService] 批次 ${batchIndex} pity 约束错误，尝试修复数据...`);
            // 修复批次中的 pity 值
            const fixedBatch = batchWithUser.map(r => ({
              ...r,
              pity: r.pity === null ? null : Math.max(0, Math.min(80, parseInt(r.pity, 10) || 0))
            }));

            const fixedGroups = splitHistoryUpsertGroups(fixedBatch);
            const retryGroups = [
              {
                rows: [...fixedGroups.serverScopedCompositeKeyRecords, ...fixedGroups.compositeKeyRecords],
                onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id',
                serverScopeKey: true,
              },
              { rows: fixedGroups.legacyRecords, onConflict: 'user_id,record_id' }
            ];

            let retryError = null;
            try {
              await upsertHistoryGroupsWithOptionalColumnFallback(supabase, retryGroups);
            } catch (err) {
              retryError = err;
            }

            if (!retryError) {
              success = true;
              savedCount += batch.length;
              continue;
            }
            lastError = retryError;
          }
          
          if (retry < maxRetries - 1) {
            console.warn(`[FullImportService] 批次 ${batchIndex} 失败，${retry + 1}/${maxRetries} 次重试: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1))); // 递增延迟
          }
        }
      } catch (err) {
        lastError = err;
        if (retry < maxRetries - 1) {
          console.warn(`[FullImportService] 批次 ${batchIndex} 异常，${retry + 1}/${maxRetries} 次重试: ${err.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
        }
      }
    }

    if (!success) {
      console.error(`[FullImportService] 批次 ${batchIndex} 最终失败: ${lastError?.message || 'Unknown error'}`);
      const sample = batch.slice(0, 3).map(record => ({
        record_id: record.record_id,
        pool_id: record.pool_id,
        seq_id: record.seq_id,
        pity: record.pity,
        rarity: record.rarity,
        timestamp: record.timestamp
      }));
      console.error(`[FullImportService] 批次 ${batchIndex} 示例记录:`, sample);
      failedBatches.push({ batchIndex, error: lastError?.message, recordCount: batch.length });
    }

    // 每处理 10 批输出一次进度
    if (batchIndex % 10 === 0) {
      console.log(`[FullImportService] 进度: ${savedCount}/${records.length} (${Math.round(savedCount / records.length * 100)}%)`);
    }
  }

  console.log(`[FullImportService] 保存完成: ${savedCount}/${records.length} 条记录`);

  if (failedBatches.length > 0) {
    console.error(`[FullImportService] ${failedBatches.length} 个批次失败:`, failedBatches);
    const firstFailure = failedBatches[0];
    throw new Error(
      `部分批次保存失败 (${savedCount}/${records.length})，批次 ${firstFailure?.batchIndex || '?'}: ${firstFailure?.error || 'Unknown'}`
    );
  }

  return { 
    success: true, 
    saved: savedCount,
    failed: failedBatches.length > 0 ? failedBatches : undefined
  };
}

function isPublicAnalyticsRefreshFunctionMissing(error) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || error?.details || '').toLowerCase();
  return ['42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('refresh_public_analytics_cache')
    || message.includes('could not find the function')
    || message.includes('schema cache');
}

function normalizePublicAnalyticsRefreshResult(data, functionName) {
  const payload = data && typeof data === 'object' ? data : {};
  return {
    functionName,
    refreshedPools: Number(payload.refreshedPools ?? payload.pool?.refreshedPools ?? 0),
    refreshedTrendRows: Number(payload.refreshedTrendRows ?? payload.trends?.refreshedTrendRows ?? 0),
    updatedAt: payload.updatedAt || payload.pool?.updatedAt || payload.trends?.updatedAt || null,
  };
}

async function refreshPublicAnalyticsAfterImport(supabase, {
  savedRecords = 0,
  reason = 'official-import',
} = {}) {
  const savedCount = Number(savedRecords) || 0;
  if (savedCount <= 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_new_records',
      savedRecords: savedCount,
    };
  }

  if (!supabase || typeof supabase.rpc !== 'function') {
    return {
      ok: false,
      reason,
      savedRecords: savedCount,
      error: 'Supabase RPC client is not configured',
      attempts: [],
    };
  }

  const attempts = [];
  const callRpc = async (functionName) => {
    const { data, error } = await supabase.rpc(functionName);
    attempts.push({
      functionName,
      ok: !error,
      ...(error ? { error: error.message || String(error) } : {}),
    });

    if (error) {
      throw error;
    }

    return data;
  };

  try {
    const data = await callRpc('refresh_public_analytics_cache');
    return {
      ok: true,
      reason,
      savedRecords: savedCount,
      ...normalizePublicAnalyticsRefreshResult(data, 'refresh_public_analytics_cache'),
      attempts,
    };
  } catch (error) {
    if (!isPublicAnalyticsRefreshFunctionMissing(error)) {
      return {
        ok: false,
        reason,
        savedRecords: savedCount,
        error: error?.message || 'Failed to refresh public analytics cache',
        attempts,
      };
    }
  }

  try {
    const data = await callRpc('refresh_public_pool_analytics_cache');
    return {
      ok: true,
      reason,
      savedRecords: savedCount,
      partial: true,
      warning: 'public_analytics_wrapper_unavailable',
      ...normalizePublicAnalyticsRefreshResult(data, 'refresh_public_pool_analytics_cache'),
      attempts,
    };
  } catch (error) {
    return {
      ok: false,
      reason,
      savedRecords: savedCount,
      error: error?.message || 'Failed to refresh public analytics cache',
      attempts,
    };
  }
}

/**
 * 处理抽卡记录（转换格式、计算 pity、去重）
 * 将 API 原始格式转换为数据库格式
 * 
 * API 原始字段 -> 数据库字段:
 *   charName/weaponName -> character_name, item_name
 *   charId/weaponId -> used for alias resolution only
 *   rarity -> rarity
 *   gachaTs -> timestamp
 *   seqId -> seq_id
 *   isFree -> is_free
 *   isNew -> is_new
 */
async function processRecords(rawRecords, account, _userId, existingSeqIds, source = 'cn', accountServerContext = null) {
  const { gameUid, nickName } = account;
  const fallbackContext = accountServerContext || {
    serverId: inferImportServerIdFromSignals(account, source),
    region: null,
  };
  const resolvedServerId = fallbackContext.serverId ? String(fallbackContext.serverId) : null;
  const resolvedRegion = fallbackContext.region || normalizeImportRegion(resolvedServerId, account, source);
  const processedRecords = [];
  const stagedRecordMetadata = [];
  const supabase = getSupabaseAdmin();
  const sourcePoolIds = [];
  const sourceCharacterIds = [];

  for (const poolData of rawRecords.results) {
    const { type, poolType, records } = poolData;

    filterOfficialImportPullRecords(records).forEach((record) => {
      const normalized = normalizeOfficialImportRecord(record, {
        gameUid,
        serverId: resolvedServerId,
        region: resolvedRegion,
        type,
        poolType,
        poolId: getOfficialPoolId(record, type, poolType),
      });
      sourcePoolIds.push(normalized.poolId);
      const officialCharacterId = normalized.rawItemId;
      sourceCharacterIds.push(officialCharacterId);
    });
  }

  const [poolAliasMap, characterAliasMap] = await Promise.all([
    resolvePoolAliasMap(supabase, sourcePoolIds, 'official_api'),
    resolveCharacterAliasMap(supabase, sourceCharacterIds, 'official_api')
  ]);

  for (const poolData of rawRecords.results) {
    const { type, poolType, records, currentUpCharacter } = poolData;
    const pullRecords = filterOfficialImportPullRecords(records);

    // 计算 pity
    const recordsWithPity = calculatePity(pullRecords.map((record) => {
      const normalized = normalizeOfficialImportRecord(record, {
        gameUid,
        serverId: resolvedServerId,
        region: resolvedRegion,
        type,
        poolType,
        poolId: getOfficialPoolId(record, type, poolType),
      });
      return {
        ...record,
        rarity: normalized.quality,
        itemName: normalized.itemName,
        itemId: normalized.rawItemId,
        itemType: normalized.itemType,
        __officialNormalized: normalized,
      };
    }));

    for (let index = 0; index < recordsWithPity.length; index++) {
      const record = recordsWithPity[index];
      const normalized = record.__officialNormalized;
      // 获取 seqId（兼容不同命名格式）
      const seqRaw = record.seqId || record.seq_id;
      const seqId = seqRaw !== undefined && seqRaw !== null ? String(seqRaw) : null;
      const rawPoolId = normalized.poolId;
      const poolId = resolveAliasValue(poolAliasMap, rawPoolId);
      const poolHash = simpleStringHash(poolId || 'unknown');
      const recordId = /^\d+$/.test(seqId || '')
        ? (BigInt(poolHash) * 10000000n + BigInt(seqId)).toString()
        : `${poolHash}:${seqId || index}`;
      const normalizedPoolType = getPoolTypeFromId(poolId, type, poolType);
      const uniqueKey = buildOfficialImportRecordKey({
        gameUid,
        serverId: resolvedServerId,
        poolId,
        seqId,
      });
      const rawCharacterId = normalized.rawItemId;
      const characterId = normalizeResolvedCharacterIdForStorage(
        rawCharacterId,
        resolveAliasValue(characterAliasMap, rawCharacterId)
      );

      // 去重
      if (uniqueKey && existingSeqIds.has(uniqueKey)) {
        continue;
      }

      const characterName = normalized.itemName;
      const rarity = resolveOfficialImportStorageQuality(normalized);
      const normalizedRecord = {
        ...record,
        rarity,
        character_name: characterName,
        item_name: characterName,
        name: characterName
      };

      // 归一化 isStandard
      const isStandard = normalizeIsStandard(normalizedRecord, normalizedPoolType, currentUpCharacter);
      
      // 获取时间戳（API 原始字段是 gachaTs，是毫秒级字符串）
      const timestamp = normalized.timestamp;

      // 处理 pity 值：确保在 0-80 范围内（与前端 ImportManager.jsx 保持一致）
      // null/undefined 转换为 0，负数转 0，超过 80 截断为 80，避免字符串/NaN 造成约束错误
      let pityValue = 0;
      if (record.pity !== null && record.pity !== undefined) {
        const parsed = typeof record.pity === 'number' ? record.pity : parseInt(record.pity, 10);
        if (Number.isFinite(parsed)) {
          pityValue = Math.max(0, Math.min(80, parsed));
        }
      }

      processedRecords.push({
        // 主键和关联字段
        record_id: recordId,
        pool_id: poolId,
        seq_id: seqId,
        game_uid: gameUid,
        nick_name: nickName,
        
        // 数据库必需字段（与前端 ImportManager.jsx 保持一致）
        rarity,
        character_name: characterName,
        item_name: characterName,
        character_id: characterId,
        timestamp: timestamp,
        
        // 计算字段
        pity: pityValue,
        is_free: normalized.isFree,
        is_info_book: normalized.isInfoBook,
        is_new: normalized.isNew,
        is_standard: isStandard,
        
        // 区服信息
        server_id: resolvedServerId,
        region: resolvedRegion,

        // 其他可选字段
        batch_id: null,
        special_type: null,
        
        // 时间戳
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      stagedRecordMetadata.push({
        normalized,
        issues: normalized.issues,
        rawMin: normalized.rawMin,
        blocked: normalized.blocked,
      });
    }
  }

  const alignedRecords = buildStagedRecordsWithMetadata(processedRecords, stagedRecordMetadata);
  const records = alignedRecords.records;
  const normalizedRecords = stagedRecordMetadata.map((item) => item.normalized);

  return {
    records,
    normalizedRecords,
    stagedRecords: alignedRecords.stagedRecords,
    reviewSummary: summarizeOfficialImportIssues(normalizedRecords),
  };
}

function sanitizeStagedHistoryRecord(record = {}) {
  const allowedFields = [
    'record_id',
    'pool_id',
    'seq_id',
    'game_uid',
    'nick_name',
    'rarity',
    'character_name',
    'item_name',
    'character_id',
    'timestamp',
    'pity',
    'is_free',
    'is_info_book',
    'is_new',
    'is_standard',
    'server_id',
    'region',
    'batch_id',
    'special_type',
    'created_at',
    'updated_at',
  ];

  return Object.fromEntries(
    allowedFields
      .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
      .map((field) => [field, record[field]])
  );
}

function sanitizeStagedPool(pool = {}) {
  const poolId = normalizeString(pool.pool_id || pool.id || pool.poolId, 200);
  if (!poolId) return null;
  const rawType = normalizeString(pool.type || pool.pool_type || pool.poolType, 80);
  const type = rawType === 'limited_character'
    ? 'limited'
    : rawType === 'limited_weapon'
      ? 'weapon'
      : ['extra', 'limited', 'standard', 'weapon', 'beginner'].includes(rawType)
        ? rawType
        : 'standard';
  return {
    pool_id: poolId,
    name: normalizeString(pool.name || pool.pool_name || pool.poolName, 300) || poolId,
    type,
    start_time: pool.start_time || pool.startTime || null,
    end_time: pool.end_time || pool.endTime || null,
    up_character: normalizeString(pool.up_character || pool.upCharacter, 300) || null,
    featured_characters: Array.isArray(pool.featured_characters) ? pool.featured_characters : null,
    created_at: pool.created_at || null,
  };
}

async function commitStagedOfficialImport({ task, rows }) {
  const supabase = getSupabaseAdmin();
  const keptRows = Array.isArray(rows) ? rows : [];
  if (keptRows.length === 0) {
    return {
      savedRecords: 0,
      skippedRecords: Number(task?.summary?.newRecords || 0),
      publicAnalyticsRefresh: { ok: true, skipped: true, reason: 'no_records_selected' },
    };
  }

  const normalizedEntries = keptRows.map((row) => row?.normalized_record || {});
  const officialCharacterRecords = normalizedEntries
    .map((entry) => entry.normalized || {})
    .filter((record) => record.rawItemId || record.itemId)
    .map((record) => ({
      id: record.rawItemId || record.itemId,
      itemId: record.rawItemId || record.itemId,
      itemName: record.itemName || null,
      itemType: record.itemType || 'unknown',
      quality: record.quality ?? null,
      name: record.itemName || null,
      type: record.itemType || 'unknown',
      rarity: record.quality ?? null,
    }));

  await reconcileOfficialCharacterIds(supabase, officialCharacterRecords);
  const characterAliasMap = await resolveCharacterAliasMap(
    supabase,
    officialCharacterRecords.map((record) => record.id),
    'official_api'
  );

  const historyRecords = normalizedEntries.map((entry) => {
    const historyRecord = sanitizeStagedHistoryRecord(entry.history || {});
    const normalized = entry.normalized || {};
    const rawCharacterId = normalized.rawItemId || normalized.itemId || null;
    return {
      ...historyRecord,
      character_id: normalizeResolvedCharacterIdForStorage(
        rawCharacterId,
        resolveAliasValue(characterAliasMap, rawCharacterId)
      ),
    };
  });

  const pools = Array.from(new Map(
    normalizedEntries
      .map((entry) => entry.pool)
      .filter((pool) => pool?.pool_id)
      .map((pool) => [String(pool.pool_id), pool])
  ).values()).map(sanitizeStagedPool).filter(Boolean);

  const { data: atomicResult, error: atomicError } = await supabase.rpc(
    'commit_official_import_records',
    {
      p_task_id: task.id,
      p_user_id: task.user_id,
      p_pools: pools,
      p_history: historyRecords,
    }
  );
  if (atomicError) {
    throw new Error(`正式写入导入记录失败：${atomicError.message || atomicError}`);
  }

  const savedRecords = Number.isFinite(Number(atomicResult?.savedRecords))
    ? Number(atomicResult.savedRecords)
    : historyRecords.length;
  let poolReconciliation = { ok: true };
  try {
    if (pools.length > 0) {
      await reconcileOfficialPoolIds(supabase, pools, task.user_id);
    }
  } catch (error) {
    poolReconciliation = {
      ok: false,
      warning: String(error?.message || error).slice(0, 500),
    };
    console.warn('[FullImportService] 卡池目录合并失败，正式历史已安全写入:', poolReconciliation.warning);
  }
  const publicAnalyticsRefresh = await refreshPublicAnalyticsAfterImport(supabase, {
    savedRecords,
    reason: `official-import-confirm:${task.source}:${task.import_mode}`,
  });

  return {
    savedRecords,
    skippedRecords: Number.isFinite(Number(atomicResult?.skippedRecords))
      ? Number(atomicResult.skippedRecords)
      : Math.max(0, Number(task?.summary?.newRecords || 0) - historyRecords.length),
    createdPools: Number(atomicResult?.createdPools || 0),
    atomicCommit: true,
    poolReconciliation,
    publicAnalyticsRefresh,
    taskCommittedAtomically: true,
  };
}

export async function loadFullImportReview({ taskId, accessKey, userId }) {
  return getOfficialImportReview({
    supabase: getSupabaseAdmin(),
    taskId,
    accessKey,
    userId,
  });
}

export async function confirmFullImportReview({ taskId, accessKey, userId, decisions = [] }) {
  return confirmOfficialImportTask({
    supabase: getSupabaseAdmin(),
    taskId,
    accessKey,
    userId,
    decisions,
    commit: commitStagedOfficialImport,
  });
}

export async function rejectFullImportReview({ taskId, accessKey, userId }) {
  return rejectOfficialImportTask({
    supabase: getSupabaseAdmin(),
    taskId,
    accessKey,
    userId,
  });
}

/**
 * 导出：完全后端化导入的主函数
 *
 * @param {Object} params
 * @param {string} params.token - 24 位初始 token
 * @param {number} params.accountIndex - 选择的账号索引
 * @param {string} params.userId - Supabase 用户 ID
 * @param {Function} params.updateProgress - 进度更新回调
 * @param {Object} params.authChainFunctions - 认证链函数（从 server.js 传入）
 * @returns {Promise<Object>}
 */
export async function executeFullImport({
  token,
  accountIndex,
  userId,
  updateProgress,
  authChainFunctions,
  source = 'cn',
  importMode = FULL_IMPORT_MODES.INCREMENTAL
}) {
  const supabase = getSupabaseAdmin();
  const normalizedImportMode = normalizeFullImportMode(importMode);

  try {
    // 1. 验证用户是否存在
    updateProgress({ progress: 5, message: '验证用户身份...' });
    const { data: authData, error: authUserError } = await supabase.auth.admin.getUserById(userId);
    const authUser = authData?.user || authData || null;

    let userExists = Boolean(authUser?.id);
    let profileLookupError = null;

    // 某些部署环境下 admin.getUserById 可能因配置差异失败，回退到 profiles 再校验一次。
    if (!userExists) {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      profileLookupError = error;
      userExists = Boolean(profile?.id);
    }

    if (!userExists) {
      const details = [
        authUserError?.message,
        profileLookupError?.message
      ].filter(Boolean).join(' | ');

      throw new Error(
        details
          ? `Invalid user ID. Check that backend SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point to the same project as the frontend. Detail: ${details}`
          : 'Invalid user ID. Check that backend SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point to the same project as the frontend.'
      );
    }

    // 2. 执行认证链 - grant
    updateProgress({ progress: 10, message: '正在验证 token...' });
    const { grantAppToken } = authChainFunctions;
    const grantResult = await grantAppToken(token);
    if (!grantResult.success) {
      throw new Error(grantResult.error || 'Grant failed');
    }
    const appToken = grantResult.data.token;

    // 3. 执行认证链 - bindings
    updateProgress({ progress: 20, message: '正在获取账号列表...' });
    const { fetchBindingList } = authChainFunctions;
    const bindingsResult = await fetchBindingList(appToken);
    if (!bindingsResult.success) {
      throw new Error(bindingsResult.error || 'Bindings failed');
    }
    const accounts = bindingsResult.data.accounts || bindingsResult.data.list;

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }

    if (accountIndex < 0 || accountIndex >= accounts.length) {
      throw new Error('Invalid account index');
    }

    const account = accounts[accountIndex];
    let accountServerContext = await resolveImportAccountServerContext(supabase, userId, account, source);

    // 4. 执行认证链 - u8token
    updateProgress({ progress: 30, message: '正在获取访问凭证...' });
    const { fetchU8TokenByUid } = authChainFunctions;
    const u8Result = await fetchU8TokenByUid(account.uid, appToken);
    if (!u8Result.success) {
      throw new Error(u8Result.error || 'U8Token failed');
    }
    const u8Token = u8Result.data.token;

    let existingSeqIds = null;
    let needsCompleteNonPullRepairScan = false;
    if (normalizedImportMode === FULL_IMPORT_MODES.INCREMENTAL) {
      updateProgress({ progress: 35, message: '正在准备增量导入游标...' });
      existingSeqIds = await getExistingSeqIds(userId, account.gameUid, accountServerContext.serverId);
      needsCompleteNonPullRepairScan = await hasPendingOfficialNonPullRepairCandidates({
        supabase,
        userId,
        gameUid: account.gameUid,
        serverScope: accountServerContext.serverId,
      });
    }

    // 5. 获取抽卡记录
    updateProgress({ progress: 40, message: '正在获取抽卡记录...' });
    const { fetchAllRecordsConcurrent } = authChainFunctions;
    let recordsRequestServerId = accountServerContext.requestServerId;
    let recordsResult = await fetchAllRecordsConcurrent(
      u8Token,
      recordsRequestServerId,
      account.gameUid,
      account.nickName,
      {
        importMode: normalizedImportMode,
        existingRecordKeys: needsCompleteNonPullRepairScan ? null : existingSeqIds
      }
    );

    if (source === 'intl' && isTokenInvalidRecordsFetchResult(recordsResult)) {
      const alternateServerId = getAlternateIntlServerId(recordsRequestServerId);
      if (alternateServerId) {
        console.warn(`[FullImportService] 国际服 ${recordsRequestServerId} 抽卡记录返回 Token is invalid，尝试切换到 ${alternateServerId} 重试一次`);
        const retryResult = await fetchAllRecordsConcurrent(
          u8Token,
          alternateServerId,
          account.gameUid,
          account.nickName,
          {
            importMode: normalizedImportMode,
            existingRecordKeys: null,
          }
        );

        if (retryResult.success || !recordsResult.success) {
          recordsResult = retryResult;
          recordsRequestServerId = alternateServerId;
        }
      }
    }

    if (!recordsResult.success) {
      throw new Error(recordsResult.error || 'Records fetch failed');
    }

    accountServerContext = withResolvedRequestServerContext(
      accountServerContext,
      recordsRequestServerId,
      account,
      source
    );

    updateProgress({ progress: 68, message: '正在核对历史情报书记录...' });
    const nonPullRepairResult = await repairLegacyOfficialNonPullArtifacts({
      supabase,
      userId,
      account,
      accountServerContext,
      rawResults: recordsResult.data.results,
    });

    // 6. 整理真实抽卡记录所属的卡池；官方非抽卡事件不会参与建池或写入。
    updateProgress({ progress: 70, message: '正在整理导入内容...' });
    const pools = [];
    const seenPoolIds = new Set();
    for (const poolData of recordsResult.data.results) {
      const { type, poolType, records, currentUpCharacter } = poolData;

      filterOfficialImportPullRecords(records).forEach(record => {
        const poolId = getOfficialPoolId(record, type, poolType);
        if (seenPoolIds.has(poolId)) {
          return;
        }
        seenPoolIds.add(poolId);

        const normalizedPoolType = getPoolTypeFromId(poolId, type, poolType);
        pools.push({
          pool_id: poolId,
          name: record.poolName || record.pool_name || getDefaultPoolName(poolId, normalizedPoolType),
          type: normalizedPoolType,
          start_time: null,
          end_time: null,
          up_character: currentUpCharacter || null
        });
      });
    }

    // 7. 获取已存在的记录（用于去重）
    updateProgress({ progress: 75, message: '正在检查重复记录...' });
    existingSeqIds = await getExistingSeqIds(userId, account.gameUid, accountServerContext.serverId);

    // 8. 处理记录
    updateProgress({ progress: 80, message: '正在处理数据...' });
    const processedResult = await processRecords(
      recordsResult.data,
      account,
      userId,
      existingSeqIds,
      source,
      accountServerContext
    );
    const processedRecords = processedResult.records;

    // 9. 暂存后立即由后端完成安全写入。用户只在导入完成后处理身份异常记录。
    const poolSummary = buildImportPoolSummary(recordsResult.data.results);
    const officialPullRecords = countOfficialImportPullRecords(recordsResult.data.results);
    const ignoredNonPullRecords = Math.max(
      0,
      Number(recordsResult.data.totalRecords || 0) - officialPullRecords
    );
    const fetchStrategy = recordsResult.data.fetchStrategy || (
      normalizedImportMode === FULL_IMPORT_MODES.INCREMENTAL && existingSeqIds.size > 0
        ? 'incremental_official_fetch_with_context_guard'
        : 'full_official_fetch_with_dedupe'
    );
    const commonSummary = {
      importMode: normalizedImportMode,
      fetchStrategy,
      totalRecords: officialPullRecords,
      ignoredNonPullRecords,
      repairedNonPullArtifacts: nonPullRepairResult.repairedRecords,
      newRecords: processedRecords.length,
      savedRecords: 0,
      duplicates: officialPullRecords - processedRecords.length,
      byPool: poolSummary.byPool,
      byPoolType: poolSummary.byPoolType,
      earlyStoppedPools: recordsResult.data.earlyStopped || [],
      partialPools: recordsResult.data.partial || [],
      failedPools: recordsResult.data.failed || [],
    };

    if (processedRecords.length === 0) {
      const publicAnalyticsRefresh = await refreshPublicAnalyticsAfterImport(supabase, {
        savedRecords: nonPullRepairResult.repairedRecords,
        reason: `official-import-repair:${source}:${normalizedImportMode}`,
      });
      updateProgress({ progress: 100, message: '没有发现需要导入的新记录' });
      return {
        success: true,
        data: {
          ...commonSummary,
          reviewRequired: false,
          warnings: nonPullRepairResult.warnings,
          publicAnalyticsRefresh,
          account: {
            gameUid: account.gameUid,
            nickName: account.nickName,
            serverId: accountServerContext.serverId || null,
            region: accountServerContext.region || null,
          },
        },
      };
    }

    updateProgress({ progress: 90, message: '正在写入抽卡记录...' });
    const staged = await stageOfficialImportTask({
      supabase,
      userId,
      source,
      importMode: normalizedImportMode,
      account: {
        gameUid: account.gameUid,
        serverId: accountServerContext.serverId || null,
        region: accountServerContext.region || null,
      },
      pools,
      stagedRecords: processedResult.stagedRecords,
      reviewSummary: processedResult.reviewSummary,
      importSummary: commonSummary,
    });

    const confirmed = await confirmOfficialImportTask({
      supabase,
      taskId: staged.task.id,
      userId,
      accessKey: staged.accessKey,
      commit: commitStagedOfficialImport,
    });
    const writtenOrdinals = new Set(
      staged.records
        .filter((record) => !hasWriteBlockingImportIssues(record.issues))
        .map((record) => Number(record.ordinal))
    );
    const writtenStagedRecords = processedResult.stagedRecords.filter((_record, ordinal) => writtenOrdinals.has(ordinal));
    let anomalyResult = { anomalyRecords: 0, anomalyPoolIds: [], anomalyItems: [] };
    let anomalyWarning = null;
    try {
      anomalyResult = await savePostImportAnomalies(supabase, writtenStagedRecords, userId);
    } catch (anomalyError) {
      anomalyWarning = `记录已写入，但异常提醒创建失败：${String(anomalyError?.message || anomalyError).slice(0, 300)}`;
      console.warn('[FullImportService] 导入后异常提醒创建失败:', anomalyWarning);
    }

    const commitResult = confirmed?.result || {};
    const skippedRecords = Number(commitResult.skippedRecords || 0);
    updateProgress({
      progress: 100,
      message: anomalyResult.anomalyRecords > 0
        ? `导入完成，发现 ${anomalyResult.anomalyRecords} 条记录需要后续核对`
        : '导入完成',
    });

    return {
      success: true,
      data: {
        ...commonSummary,
        ...commitResult,
        reviewRequired: false,
        review: processedResult.reviewSummary,
        savedRecords: Number(commitResult.savedRecords || 0),
        skippedRecords,
        anomalyRecords: anomalyResult.anomalyRecords,
        anomalyPoolIds: anomalyResult.anomalyPoolIds,
        anomalyItems: anomalyResult.anomalyItems,
        warnings: [
          ...nonPullRepairResult.warnings,
          ...(anomalyResult.anomalyRecords > 0
            ? [`有 ${anomalyResult.anomalyRecords} 条已导入记录需要后续核对。`]
            : []),
          ...(skippedRecords > 0
            ? [`有 ${skippedRecords} 条记录缺少卡池、账号、序号、时间或有效品质，无法安全写入。`]
            : []),
          ...(anomalyWarning ? [anomalyWarning] : []),
        ],
        account: {
          gameUid: account.gameUid,
          nickName: account.nickName,
          serverId: accountServerContext.serverId || null,
          region: accountServerContext.region || null
        }
      }
    };

  } catch (error) {
    console.error('[FullImportService] Error:', error);
    throw error;
  }
}
