import { clampHistoryPity } from './historyRecordUtils.js';
import { normalizeGameAccountMetadata } from './gameAccountMetadata.js';
import { detectImportFormat, prepareImportPayload } from './dataFormatRegistry.js';
import { canonicalizeExtraPoolSubtype } from '../../shared/extraPoolSubtype.js';

const MAX_IMPORT_ERRORS = 10;
const VALID_POOL_TYPES = new Set([
  'extra',
  'joint',
  'limited',
  'limited_character',
  'standard',
  'weapon',
  'limited_weapon',
  'beginner'
]);

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeRecordIdValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  if (/^-?\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  return normalized;
}

function normalizePoolType(rawType, poolId, isLimitedWeapon) {
  const normalizedType = normalizeString(rawType)?.toLowerCase();

  if (normalizedType && VALID_POOL_TYPES.has(normalizedType)) {
    if (normalizedType === 'extra' || normalizedType === 'joint') return 'extra';
    if (normalizedType === 'limited_character') return 'limited';
    if (normalizedType === 'limited_weapon') return 'weapon';
    return normalizedType;
  }

  const prefix = normalizeString(poolId)?.split('_')[0]?.toLowerCase();
  if (prefix === 'joint' || prefix === 'extra') return 'extra';
  if (prefix === 'special') return 'limited';
  if (prefix === 'standard') return 'standard';
  if (prefix === 'beginner') return 'beginner';
  if (prefix === 'weponbox' || prefix === 'weaponbox') return 'weapon';
  if (normalizedType === 'weapon' && isLimitedWeapon === false) return 'weapon';
  return null;
}

function buildAccountLookup(accounts) {
  const accountLookup = new Map();

  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    const normalized = normalizeGameAccountMetadata(account);
    if (!normalized) {
      return;
    }

    accountLookup.set(normalized.gameUid, normalized);
  });

  return accountLookup;
}

function normalizeImportedPool(pool, currentUserId) {
  const poolId = normalizeString(pool?.id || pool?.pool_id);
  const name = normalizeString(pool?.name);
  const normalizedWeaponFlag = normalizeBoolean(pool?.isLimitedWeapon ?? pool?.is_limited_weapon);
  const type = normalizePoolType(pool?.type, poolId, normalizedWeaponFlag);

  const errors = [];

  if (!poolId) {
    errors.push('缺少有效的 id');
  }

  if (!name) {
    errors.push('缺少名称 (name)');
  }

  if (!type) {
    errors.push('无效的类型 (type)，应为 extra/joint/limited/limited_character/standard/weapon/limited_weapon/beginner');
  }

  const startTime = normalizeTimestamp(pool?.start_time || pool?.startTime);
  const endTime = normalizeTimestamp(pool?.end_time || pool?.endTime);
  const extraRuleProfile = type === 'extra'
    ? normalizeString(pool?.extra_rule_profile ?? pool?.extraRuleProfile)
    : null;
  const extraSubtype = type === 'extra'
    ? canonicalizeExtraPoolSubtype(pool?.extra_subtype ?? pool?.extraSubtype, extraRuleProfile)
    : null;

  if ((pool?.start_time || pool?.startTime) && !startTime) {
    errors.push('start_time 无法解析为有效时间');
  }

  if ((pool?.end_time || pool?.endTime) && !endTime) {
    errors.push('end_time 无法解析为有效时间');
  }

  return {
    errors,
    value: errors.length > 0 ? null : {
      id: poolId,
      name,
      name_en: normalizeString(pool?.name_en),
      type,
      extra_subtype: extraSubtype,
      extra_rule_profile: extraRuleProfile,
      extra_series_key: type === 'extra'
        ? normalizeString(pool?.extra_series_key ?? pool?.extraSeriesKey)
        : null,
      extra_series_phase: type === 'extra'
        ? normalizeInteger(pool?.extra_series_phase ?? pool?.extraSeriesPhase)
        : null,
      locked: normalizeBoolean(pool?.locked) === true,
      isLimitedWeapon: type === 'weapon' ? normalizedWeaponFlag !== false : true,
      user_id: currentUserId || null,
      creator_username: null,
      creator_role: null,
      up_character: normalizeString(pool?.up_character || pool?.upCharacter),
      description: normalizeString(pool?.description),
      banner_url: normalizeString(pool?.banner_url || pool?.bannerUrl),
      start_time: startTime,
      end_time: endTime,
      featured_characters: Array.isArray(pool?.featured_characters) ? [...pool.featured_characters] : null,
      created_at: normalizeTimestamp(pool?.created_at || pool?.createdAt),
      updated_at: normalizeTimestamp(pool?.updated_at || pool?.updatedAt)
    }
  };
}

function normalizeImportedHistoryRecord(record, context) {
  const poolId = normalizeString(record?.poolId || record?.pool_id);
  const pool = poolId ? context.poolLookup.get(poolId) || null : null;
  const metadata = normalizeGameAccountMetadata({
    ...(context.accountLookup.get(normalizeString(record?.gameUid || record?.game_uid)) || {}),
    gameUid: record?.gameUid || record?.game_uid,
    nickName: record?.nickName || record?.nick_name,
    channelName: record?.channelName || record?.channel_name,
    hgUid: record?.hgUid || record?.hg_uid,
    channelMasterId: record?.channelMasterId || record?.channel_master_id,
    serverId: record?.serverId || record?.server_id,
    region: record?.region || record?.serverRegion,
    isOfficial: record?.isOfficial ?? record?.is_official
  });
  const recordId = normalizeRecordIdValue(
    record?.id
      ?? record?.record_id
      ?? record?.seqId
      ?? record?.seq_id
  );
  const rarity = normalizeInteger(record?.rarity);
  const itemName = normalizeString(
    record?.name
      || record?.item_name
      || record?.itemName
      || record?.character_name
      || record?.characterName
  );
  const timestamp = normalizeTimestamp(record?.timestamp || record?.created_at || record?.createdAt);
  const seqId = normalizeString(record?.seqId || record?.seq_id);
  const explicitIsStandard = normalizeBoolean(record?.isStandard ?? record?.is_standard);

  let isStandard = explicitIsStandard;
  if (isStandard === null) {
    isStandard = pool?.type === 'standard' || pool?.type === 'beginner';
  }

  const errors = [];

  if (recordId === null) {
    errors.push('缺少有效的 id');
  }

  if (!poolId) {
    errors.push('缺少 pool_id / poolId');
  } else if (!context.knownPoolIds.has(poolId)) {
    errors.push(`pool_id (${poolId}) 引用的卡池不存在`);
  }

  if (!Number.isInteger(rarity) || rarity < 3 || rarity > 6) {
    errors.push('rarity 应为 3-6 的数字');
  }

  if (!itemName) {
    errors.push('缺少 item_name / name');
  }

  if (!timestamp) {
    errors.push('timestamp 无法解析为有效时间');
  }

  return {
    errors,
    value: errors.length > 0 ? null : {
      id: recordId,
      record_id: recordId,
      user_id: context.currentUserId || null,
      poolId,
      pool_id: poolId,
      rarity,
      isStandard,
      is_standard: isStandard,
      specialType: normalizeString(record?.specialType || record?.special_type),
      special_type: normalizeString(record?.specialType || record?.special_type),
      name: itemName,
      item_name: itemName,
      character_name: normalizeString(record?.character_name || record?.characterName) || itemName,
      character_id: normalizeString(record?.character_id || record?.item_id),
      batchId: normalizeString(record?.batchId || record?.batch_id),
      batch_id: normalizeString(record?.batchId || record?.batch_id),
      seqId,
      seq_id: seqId,
      pity: clampHistoryPity(record?.pity, 0),
      isNew: normalizeBoolean(record?.isNew ?? record?.is_new) === true,
      is_new: normalizeBoolean(record?.isNew ?? record?.is_new) === true,
      isFree: normalizeBoolean(record?.isFree ?? record?.is_free) === true,
      is_free: normalizeBoolean(record?.isFree ?? record?.is_free) === true,
      gameUid: metadata?.gameUid || normalizeString(record?.gameUid || record?.game_uid),
      game_uid: metadata?.gameUid || normalizeString(record?.gameUid || record?.game_uid),
      nickName: metadata?.nickName || normalizeString(record?.nickName || record?.nick_name),
      nick_name: metadata?.nickName || normalizeString(record?.nickName || record?.nick_name),
      channelName: metadata?.channelName || null,
      channel_name: metadata?.channelName || null,
      hgUid: metadata?.hgUid || null,
      hg_uid: metadata?.hgUid || null,
      channelMasterId: metadata?.channelMasterId || null,
      channel_master_id: metadata?.channelMasterId || null,
      serverId: metadata?.serverId || null,
      server_id: metadata?.serverId || null,
      region: metadata?.region || null,
      isOfficial: metadata?.isOfficial ?? null,
      is_official: metadata?.isOfficial ?? null,
      timestamp
    }
  };
}

export function getHistoryImportDedupKey(record) {
  const seqId = normalizeString(record?.seqId || record?.seq_id);
  const gameUid = normalizeString(record?.gameUid || record?.game_uid);
  const poolId = normalizeString(record?.poolId || record?.pool_id);
  if (seqId) {
    const accountPrefix = gameUid ? `uid:${gameUid}:` : '';
    const poolPrefix = poolId ? `pool:${poolId}:` : '';
    return `${accountPrefix}${poolPrefix}seq:${seqId}`;
  }

  const recordId = normalizeRecordIdValue(record?.id ?? record?.record_id);
  if (recordId === null) {
    return null;
  }

  return gameUid ? `uid:${gameUid}:id:${String(recordId)}` : `id:${String(recordId)}`;
}

export function validateAndNormalizeImportData(data, options = {}) {
  const errors = [];
  const detectedFormat = detectImportFormat(data);
  let sourceData = data;

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['无效的数据格式'] };
  }

  if (!detectedFormat) {
    return {
      valid: false,
      errors: ['暂不支持该导入格式；当前兼容站内 JSON、endfield-gacha Excel、EndfieldGachaHelper JSON/CSV、endgacha.kwer.top JSON/TXT'],
    };
  }

  try {
    sourceData = prepareImportPayload(data, detectedFormat, options);
  } catch (error) {
    return {
      valid: false,
      errors: [`导入格式预处理失败: ${error?.message || '未知错误'}`],
    };
  }

  if (!sourceData || typeof sourceData !== 'object') {
    return { valid: false, errors: ['导入格式预处理失败：未返回对象 payload'] };
  }

  if (!Array.isArray(sourceData.pools)) {
    errors.push('缺少 pools 字段或格式错误');
  }

  if (!Array.isArray(sourceData.history)) {
    errors.push('缺少 history 字段或格式错误');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const currentUserId = options.currentUserId || null;
  const existingPoolIds = new Set(
    (Array.isArray(options.existingPools) ? options.existingPools : [])
      .map((pool) => normalizeString(pool?.id || pool?.pool_id))
      .filter(Boolean)
  );
  const normalizedPools = [];
  const normalizedHistory = [];
  const poolLookup = new Map();
  const knownPoolIds = new Set(existingPoolIds);
  const accountLookup = buildAccountLookup(sourceData.accounts);

  sourceData.pools.forEach((pool, index) => {
    const normalized = normalizeImportedPool(pool, currentUserId);
    if (normalized.errors.length > 0) {
      normalized.errors.forEach((error) => {
        errors.push(`卡池 #${index + 1}: ${error}`);
      });
      return;
    }

    if (poolLookup.has(normalized.value.id)) {
      errors.push(`卡池 #${index + 1}: id 重复 (${normalized.value.id})`);
      return;
    }

    normalizedPools.push(normalized.value);
    poolLookup.set(normalized.value.id, normalized.value);
    knownPoolIds.add(normalized.value.id);
  });

  const historyKeys = new Set();
  sourceData.history.forEach((record, index) => {
    const normalized = normalizeImportedHistoryRecord(record, {
      currentUserId,
      poolLookup,
      knownPoolIds,
      accountLookup
    });

    if (normalized.errors.length > 0) {
      normalized.errors.forEach((error) => {
        errors.push(`记录 #${index + 1}: ${error}`);
      });
      return;
    }

    const dedupKey = getHistoryImportDedupKey(normalized.value);
    if (dedupKey && historyKeys.has(dedupKey)) {
      errors.push(`记录 #${index + 1}: id/seqId 重复 (${dedupKey})`);
      return;
    }

    if (dedupKey) {
      historyKeys.add(dedupKey);
    }

    normalizedHistory.push(normalized.value);
  });

  const normalizedAccounts = Array.from(accountLookup.values())
    .filter((account) => normalizedHistory.some((record) => record.gameUid === account.gameUid));

  if (errors.length > MAX_IMPORT_ERRORS) {
    const totalErrors = errors.length;
    errors.length = MAX_IMPORT_ERRORS;
    errors.push(`... 还有 ${totalErrors - MAX_IMPORT_ERRORS} 个错误`);
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      poolCount: normalizedPools.length,
      historyCount: normalizedHistory.length,
      accountCount: normalizedAccounts.length
    },
    normalizedData: {
      sourceFormatId: detectedFormat.id,
      sourceFormatLabel: detectedFormat.label,
      schemaVersion: normalizeString(sourceData.schemaVersion || sourceData.version),
      importedAt: normalizeString(sourceData.exportTime || sourceData.exportedAt) || new Date().toISOString(),
      accountInfoMissing: sourceData.accountInfoMissing === true,
      importWarningCodes: Array.isArray(sourceData.importWarningCodes) ? [...sourceData.importWarningCodes] : [],
      filters: sourceData.filters || null,
      summary: sourceData.summary || null,
      pools: normalizedPools,
      history: normalizedHistory,
      accounts: normalizedAccounts
    }
  };
}

export default {
  detectImportFormat,
  getHistoryImportDedupKey,
  validateAndNormalizeImportData
};
