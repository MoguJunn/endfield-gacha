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
 * @version 1.0.0
 * @date 2026-02-24
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

// Supabase Admin 客户端（需要 SUPABASE_SECRET_KEY；旧 service_role_key 仍兼容）
let supabaseAdmin = null;

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
  if (payload.user_metadata?.site_session !== true && payload.app_metadata?.provider !== 'site_session') {
    throw createAuthTokenError('compat_jwt_not_site_session');
  }

  return loadUserByVerifiedJwtPayload(supabase, payload);
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

  const { data, error } = await supabase.auth.getUser(accessToken);
  const user = data?.user || null;
  if (!error && user?.id) {
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

    (Array.isArray(records) ? records : []).forEach((record) => {
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

function getRecordTimestamp(record) {
  if (record.gachaTs) {
    const parsed = parseInt(record.gachaTs, 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (record.timestamp) {
    if (typeof record.timestamp === 'number') return record.timestamp;
    const parsed = new Date(record.timestamp).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
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

      if (
        group.serverScopeKey
        && onConflict !== 'user_id,game_uid,pool_id,seq_id'
        && isMissingHistoryConflictTargetError(result.error)
      ) {
        onConflict = 'user_id,game_uid,pool_id,seq_id';
        continue;
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

/**
 * 计算 pity（与前端逻辑保持一致，排除免费十连）
 * pity 值钳制在 [0, 80] 范围内以满足数据库 CHECK 约束
 * 注意：API 原始数据使用驼峰命名 (rarity)，需要兼容
 * 免费十连的 pity 存储为 0（与前端 ImportManager.jsx 保持一致）
 */
function calculatePity(records) {
  const MAX_PITY = 80;
  let pity = 0;
  const processedRecords = [];

  // 与旧前端一致：优先按时间升序，时间相同再按 seqId 升序
  const sortedRecords = [...records].sort((a, b) => {
    const timeA = getRecordTimestamp(a);
    const timeB = getRecordTimestamp(b);
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    const seqA = parseInt(a.seqId || a.seq_id || 0, 10);
    const seqB = parseInt(b.seqId || b.seq_id || 0, 10);
    return seqA - seqB;
  });

  for (const record of sortedRecords) {
    const rarity = record.rarity || record.qualityLevel;

    // 与旧前端保持一致：免费十连 pity 记为 0，但若该条是 6 星仍需重置计数器
    if (record.isFree === true) {
      processedRecords.push({
        ...record,
        pity: 0 // 免费十连不计入保底，存储 0 而不是 null
      });
      if (rarity === 6) {
        pity = 0;
      }
      continue;
    }

    pity++;
    
    // 如果是 6 星，重置保底
    if (rarity === 6) {
      processedRecords.push({
        ...record,
        pity: Math.min(pity, MAX_PITY)
      });
      pity = 0;
    } else {
      processedRecords.push({
        ...record,
        pity: Math.min(pity, MAX_PITY)
      });
    }
  }

  return processedRecords;
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
async function saveHistoryToServer(records, userId) {
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
async function processRecords(rawRecords, account, _userId, existingSeqIds, source = 'cn') {
  const { gameUid, nickName, serverId } = account;
  const resolvedServerId = String(serverId || (source === 'intl' ? '2' : '1'));
  const resolvedRegion = resolvedServerId === '1' ? 'cn' : 'intl';
  const processedRecords = [];
  const supabase = getSupabaseAdmin();
  const sourcePoolIds = [];
  const sourceCharacterIds = [];
  const officialCharacterRecords = [];

  for (const poolData of rawRecords.results) {
    const { type, poolType, records } = poolData;

    records.forEach((record) => {
      sourcePoolIds.push(getOfficialPoolId(record, type, poolType));
      const officialCharacterId = record.charId || record.weaponId || record.character_id || record.item_id || null;
      sourceCharacterIds.push(officialCharacterId);
      if (officialCharacterId) {
        officialCharacterRecords.push({
          ...record,
          id: officialCharacterId,
          type: record.weaponId || type === 'weapon' ? 'weapon' : 'character',
          name: record.charName || record.weaponName || record.character_name || record.item_name || record.name,
        });
      }
    });
  }

  await reconcileOfficialCharacterIds(supabase, officialCharacterRecords);

  const [poolAliasMap, characterAliasMap] = await Promise.all([
    resolvePoolAliasMap(supabase, sourcePoolIds, 'official_api'),
    resolveCharacterAliasMap(supabase, sourceCharacterIds, 'official_api')
  ]);

  for (const poolData of rawRecords.results) {
    const { type, poolType, records, currentUpCharacter } = poolData;

    // 计算 pity
    const recordsWithPity = calculatePity(records);

    for (let index = 0; index < recordsWithPity.length; index++) {
      const record = recordsWithPity[index];
      // 获取 seqId（兼容不同命名格式）
      const seqRaw = record.seqId || record.seq_id;
      const seqId = seqRaw !== undefined && seqRaw !== null ? String(seqRaw) : null;
      const seqIdNum = seqId ? (parseInt(seqId, 10) || index) : index;
      const rawPoolId = getOfficialPoolId(record, type, poolType);
      const poolId = resolveAliasValue(poolAliasMap, rawPoolId);
      const poolHash = simpleStringHash(poolId || 'unknown');
      const normalizedPoolType = getPoolTypeFromId(poolId, type, poolType);
      const uniqueKey = buildOfficialImportRecordKey({
        gameUid,
        serverId: resolvedServerId,
        poolId,
        seqId,
      });
      const rawCharacterId = record.charId || record.weaponId || record.character_id || record.item_id || null;
      const characterId = normalizeResolvedCharacterIdForStorage(
        rawCharacterId,
        resolveAliasValue(characterAliasMap, rawCharacterId)
      );

      // 去重
      if (uniqueKey && existingSeqIds.has(uniqueKey)) {
        continue;
      }

      // 获取角色/武器名称（API 原始字段是 charName/weaponName）
      const characterName = record.charName || record.weaponName || record.character_name || record.name || '未知';
      
      // 获取稀有度（API 原始字段是 rarity）
      const rarity = record.rarity || record.qualityLevel || 4;
      const normalizedRecord = {
        ...record,
        rarity: parseInt(rarity, 10),
        character_name: characterName,
        item_name: characterName,
        name: characterName
      };

      // 归一化 isStandard
      const isStandard = normalizeIsStandard(normalizedRecord, normalizedPoolType, currentUpCharacter);
      
      // 获取时间戳（API 原始字段是 gachaTs，是毫秒级字符串）
      const timestamp = record.gachaTs 
        ? new Date(parseInt(record.gachaTs, 10)).toISOString()
        : record.timestamp 
          ? (typeof record.timestamp === 'number' 
              ? new Date(record.timestamp).toISOString() 
              : new Date(record.timestamp).toISOString())
          : new Date().toISOString();

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
        record_id: String(poolHash * 10000000 + seqIdNum),
        pool_id: poolId,
        seq_id: seqId,
        game_uid: gameUid,
        nick_name: nickName,
        
        // 数据库必需字段（与前端 ImportManager.jsx 保持一致）
        rarity: parseInt(rarity, 10),
        character_name: characterName,
        item_name: characterName,
        character_id: characterId,
        timestamp: timestamp,
        
        // 计算字段
        pity: pityValue,
        is_free: Boolean(record.isFree),
        is_new: Boolean(record.isNew),
        is_standard: isStandard,
        
        // 区服信息
        server_id: resolvedServerId,
        region: resolvedRegion,

        // 其他可选字段
        batch_id: null,
        special_type: null,
        
        // 时间戳
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }

  return assignBatchIds(processedRecords);
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

    // 4. 执行认证链 - u8token
    updateProgress({ progress: 30, message: '正在获取访问凭证...' });
    const { fetchU8TokenByUid } = authChainFunctions;
    const u8Result = await fetchU8TokenByUid(account.uid, appToken);
    if (!u8Result.success) {
      throw new Error(u8Result.error || 'U8Token failed');
    }
    const u8Token = u8Result.data.token;

    let existingSeqIds = null;
    if (normalizedImportMode === FULL_IMPORT_MODES.INCREMENTAL) {
      updateProgress({ progress: 35, message: '正在准备增量导入游标...' });
      existingSeqIds = await getExistingSeqIds(userId, account.gameUid, account.serverId || (source === 'intl' ? '2' : '1'));
    }

    // 5. 获取抽卡记录
    updateProgress({ progress: 40, message: '正在获取抽卡记录...' });
    const { fetchAllRecordsConcurrent } = authChainFunctions;
    const recordsResult = await fetchAllRecordsConcurrent(
      u8Token,
      account.serverId || '1',
      account.gameUid,
      account.nickName,
      {
        importMode: normalizedImportMode,
        existingRecordKeys: existingSeqIds
      }
    );
    if (!recordsResult.success) {
      throw new Error(recordsResult.error || 'Records fetch failed');
    }

    // 6. 保存卡池信息
    updateProgress({ progress: 70, message: '正在保存卡池信息...' });
    const pools = [];
    const seenPoolIds = new Set();
    for (const poolData of recordsResult.data.results) {
      const { type, poolType, records, currentUpCharacter } = poolData;

      records.forEach(record => {
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

    await savePoolsToServer(pools, userId);

    // 7. 获取已存在的记录（用于去重）
    updateProgress({ progress: 75, message: '正在检查重复记录...' });
    existingSeqIds = await getExistingSeqIds(userId, account.gameUid, account.serverId || (source === 'intl' ? '2' : '1'));

    // 8. 处理记录
    updateProgress({ progress: 80, message: '正在处理数据...' });
    const processedRecords = await processRecords(
      recordsResult.data,
      account,
      userId,
      existingSeqIds,
      source
    );

    // 9. 保存记录
    updateProgress({ progress: 90, message: '正在保存数据...' });
    const saveResult = await saveHistoryToServer(processedRecords, userId);
    const savedRecords = Number.isFinite(Number(saveResult?.saved))
      ? Number(saveResult.saved)
      : processedRecords.length;

    updateProgress({ progress: 95, message: '正在刷新公共统计...' });
    const publicAnalyticsRefresh = await refreshPublicAnalyticsAfterImport(supabase, {
      savedRecords,
      reason: `official-import:${source}:${normalizedImportMode}`,
    });
    if (publicAnalyticsRefresh.ok === false) {
      console.warn('[FullImportService] 公共统计刷新失败:', publicAnalyticsRefresh.error);
    }

    // 10. 完成
    updateProgress({ progress: 100, message: '导入完成' });
    const poolSummary = buildImportPoolSummary(recordsResult.data.results);
    const fetchStrategy = recordsResult.data.fetchStrategy || (
      normalizedImportMode === FULL_IMPORT_MODES.INCREMENTAL && existingSeqIds.size > 0
        ? 'incremental_official_fetch_with_context_guard'
        : 'full_official_fetch_with_dedupe'
    );

    return {
      success: true,
      data: {
        importMode: normalizedImportMode,
        fetchStrategy,
        totalRecords: recordsResult.data.totalRecords,
        newRecords: processedRecords.length,
        savedRecords,
        duplicates: recordsResult.data.totalRecords - processedRecords.length,
        byPool: poolSummary.byPool,
        byPoolType: poolSummary.byPoolType,
        earlyStoppedPools: recordsResult.data.earlyStopped || [],
        partialPools: recordsResult.data.partial || [],
        failedPools: recordsResult.data.failed || [],
        publicAnalyticsRefresh,
        warnings: publicAnalyticsRefresh.ok === false
          ? [`公共统计刷新失败：${publicAnalyticsRefresh.error || '未知错误'}`]
          : [],
        account: {
          gameUid: account.gameUid,
          nickName: account.nickName,
          serverId: String(account.serverId || (source === 'intl' ? '2' : '1'))
        }
      }
    };

  } catch (error) {
    console.error('[FullImportService] Error:', error);
    throw error;
  }
}
