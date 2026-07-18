const ISSUE_SEVERITIES = new Set(['blocking', 'review', 'info']);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeItemType(value, fallback = '') {
  const normalized = normalizeText(value).toLowerCase();
  if (['character', 'char', 'operator', '角色', '干员'].includes(normalized)) return 'character';
  if (['weapon', 'wepon', '武器'].includes(normalized)) return 'weapon';
  if (normalized) return normalized;
  return normalizeText(fallback).toLowerCase() || 'unknown';
}

function normalizeQuality(value) {
  if (value === undefined || value === null || value === '') return null;
  const quality = Number.parseInt(String(value), 10);
  return Number.isFinite(quality) ? quality : null;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  const candidate = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
}

function createIssue(code, severity, message, details = {}) {
  return Object.freeze({
    code,
    severity: ISSUE_SEVERITIES.has(severity) ? severity : 'review',
    message,
    suggestedAction: severity === 'blocking' ? 'skip_record' : 'review_record',
    ...details,
  });
}

export function hasBlockingImportIssues(issues) {
  return (Array.isArray(issues) ? issues : []).some((issue) => issue?.severity === 'blocking');
}

export function normalizeOfficialImportRecord(record = {}, context = {}) {
  const rawItemId = normalizeText(
    firstDefined(record.charId, record.weaponId, record.itemId, record.character_id, record.item_id)
  );
  const itemName = normalizeText(
    firstDefined(
      record.charName,
      record.weaponName,
      record.itemName,
      record.character_name,
      record.item_name,
      record.name
    )
  );
  const poolId = normalizeText(firstDefined(record.poolId, record.pool_id, context.poolId, context.pool_id));
  const poolName = normalizeText(firstDefined(record.poolName, record.pool_name, context.poolName, context.pool_name));
  const itemType = normalizeItemType(
    firstDefined(record.itemType, record.item_type),
    record.weaponId || context.poolType === 'weapon' || context.type === 'weapon'
      ? 'weapon'
      : record.charId
        ? 'character'
        : context.itemType || context.type
  );
  const quality = normalizeQuality(
    firstDefined(record.rarity, record.quality, record.qualityLevel, record.quality_level)
  );
  const seqId = normalizeText(firstDefined(record.seqId, record.seq_id));
  const sourceTimestamp = firstDefined(record.gachaTs, record.timestamp, record.gacha_ts);
  const timestamp = normalizeTimestamp(sourceTimestamp);
  const gameUid = normalizeText(firstDefined(record.gameUid, record.game_uid, context.gameUid, context.game_uid));
  const serverId = normalizeText(firstDefined(record.serverId, record.server_id, context.serverId, context.server_id));
  const region = normalizeText(firstDefined(record.region, context.region));
  const issues = [];

  if (!rawItemId && !itemName) {
    issues.push(
      createIssue('MISSING_ITEM_ID_AND_NAME', 'blocking', '这条记录没有物品 ID 和名称，系统无法判断抽到了什么。', {
        fields: ['itemId', 'itemName'],
      })
    );
  } else if (!rawItemId) {
    issues.push(
      createIssue('MISSING_ITEM_ID', 'review', `“${itemName}”缺少物品 ID，需要确认后再导入。`, { fields: ['itemId'] })
    );
  } else if (!itemName) {
    issues.push(
      createIssue('MISSING_ITEM_NAME', 'review', '这条记录有物品 ID，但没有名称，需要确认对应角色或武器。', {
        fields: ['itemName'],
        rawItemId,
      })
    );
  }

  if (quality === null) {
    issues.push(
      createIssue('MISSING_QUALITY', 'blocking', '这条记录缺少品质信息，无法正确计算保底和统计。', {
        fields: ['quality'],
      })
    );
  } else if (quality < 4 || quality > 6) {
    issues.push(
      createIssue('INVALID_QUALITY', 'blocking', `这条记录的品质值为 ${quality}，不在可识别的 4–6 星范围内。`, {
        fields: ['quality'],
        value: quality,
      })
    );
  }

  if (!poolId) {
    issues.push(
      createIssue('MISSING_POOL_ID', 'blocking', '这条记录没有卡池 ID，无法确定它属于哪个卡池。', {
        fields: ['poolId'],
      })
    );
  }

  if (!seqId) {
    issues.push(
      createIssue('MISSING_SEQ_ID', 'blocking', '这条记录缺少官方序号，无法可靠去重或定位，请跳过后重新获取。', {
        fields: ['seqId'],
      })
    );
  }

  if (!timestamp) {
    issues.push(
      createIssue('INVALID_TIMESTAMP', 'blocking', '这条记录的抽卡时间缺失或格式无效。', {
        fields: ['timestamp'],
        value: sourceTimestamp ?? null,
      })
    );
  }

  if (!gameUid) {
    issues.push(
      createIssue('MISSING_GAME_UID', 'blocking', '无法确认这条记录属于哪个游戏账号。', { fields: ['gameUid'] })
    );
  }

  if (!serverId) {
    issues.push(
      createIssue('INFERRED_SERVER_SCOPE', 'review', '官方记录没有直接返回区服，系统将使用当前选择的账号区服。', {
        fields: ['serverId'],
      })
    );
  }

  return Object.freeze({
    rawItemId: rawItemId || null,
    itemId: rawItemId || null,
    itemName: itemName || null,
    itemType,
    quality,
    poolId: poolId || null,
    poolName: poolName || null,
    seqId: seqId || null,
    timestamp,
    isFree: record.isFree === true || record.is_free === true,
    isInfoBook: record.isInfoBook === true || record.is_info_book === true,
    isNew: record.isNew === true || record.is_new === true,
    gameUid: gameUid || null,
    serverId: serverId || null,
    region: region || null,
    issues: Object.freeze(issues),
    reviewRequired: issues.length > 0,
    blocked: hasBlockingImportIssues(issues),
    rawMin: Object.freeze({
      itemId: rawItemId || null,
      itemName: itemName || null,
      itemType,
      quality,
      poolId: poolId || null,
      poolName: poolName || null,
      seqId: seqId || null,
      timestamp: sourceTimestamp ?? null,
      isInfoBook: record.isInfoBook === true || record.is_info_book === true,
    }),
  });
}

export function summarizeOfficialImportIssues(records) {
  const normalizedRecords = Array.isArray(records) ? records : [];
  const issues = normalizedRecords.flatMap((record, recordIndex) =>
    (record?.issues || []).map((issue) => ({ ...issue, recordIndex }))
  );

  return Object.freeze({
    totalRecords: normalizedRecords.length,
    issueRecords: normalizedRecords.filter((record) => record?.issues?.length > 0).length,
    blockingRecords: normalizedRecords.filter((record) => hasBlockingImportIssues(record?.issues)).length,
    blockingIssues: issues.filter((issue) => issue.severity === 'blocking').length,
    reviewIssues: issues.filter((issue) => issue.severity === 'review').length,
    infoIssues: issues.filter((issue) => issue.severity === 'info').length,
    issues: Object.freeze(issues),
  });
}

export default {
  hasBlockingImportIssues,
  normalizeOfficialImportRecord,
  summarizeOfficialImportIssues,
};
