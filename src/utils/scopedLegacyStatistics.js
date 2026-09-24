import { storedAccountKey } from './storedPoolObservations.js';
import { compareHistoryTimelineAsc, getHistoryTimelineTimestampMs } from './historyTimelineSort.js';
import { annotateInfoBookPulls, isGiftHistoryPull, isInfoBookHistoryPull } from './historyInfoBook.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import {
  buildScopedPaidHistoryTimeline,
  getHistoryPoolId,
  getPoolRecordId,
  getPoolSeriesStateKey,
  isPaidHistoryPull,
} from './poolScopedHistory.js';
import {
  calculateCharacterQuotaForCopy,
  calculateWeaponQuotaForCopy,
  createEmptyQuotaSummary,
  QUOTA_RULES,
} from './quotaEconomy.js';
import { buildCapabilityAwarePoolResourceSummary } from './resourceEconomy.js';
import { statisticsTargetReferences } from '../../shared/statisticsScopes.js';

// 与 storedPoolObservations 相同的有效稀有度集合，invalid 记录一律不进入统计。
const VALID_RARITIES = [4, 5, 6];

function foldName(value) {
  return value == null ? '' : String(value).trim().toLowerCase();
}

function readHistoryRawItemId(record) {
  const value = record?.character_id ?? record?.characterId ?? record?.item_id ?? record?.itemId ?? '';
  return value == null ? '' : String(value).trim();
}

function readHistoryRecordName(record) {
  return record?.character_name
    ?? record?.characterName
    ?? record?.item_name
    ?? record?.itemName
    ?? record?.name
    ?? '';
}

function readEntityType(capabilities) {
  return capabilities?.entityType === 'character' || capabilities?.entityType === 'weapon'
    ? capabilities.entityType
    : null;
}

/**
 * 目录索引沿用 storedPoolObservations 的识别规则：名称必须唯一命中，
 * 且记录存在原始 id 时绝不回退名称匹配。
 */
function buildCatalogIndex(catalog = []) {
  const itemsById = new Map();
  const idsByNameRarity = new Map();

  const registerName = (name, rarity, id) => {
    const folded = foldName(name);
    if (!folded || !id) {
      return;
    }
    const rarityKey = JSON.stringify([folded, Number(rarity)]);
    const ids = idsByNameRarity.get(rarityKey) || [];
    if (!ids.includes(id)) {
      ids.push(id);
    }
    idsByNameRarity.set(rarityKey, ids);
  };

  (Array.isArray(catalog) ? catalog : []).forEach((item) => {
    const id = String(item?.id ?? item?.character_id ?? item?.characterId ?? '').trim();
    if (!id) {
      return;
    }
    itemsById.set(id, item);
    registerName(item?.name ?? item?.item_name, item?.rarity, id);
    (Array.isArray(item?.aliases) ? item.aliases : []).forEach((alias) => registerName(alias, item?.rarity, id));
  });

  return {
    get: (id) => itemsById.get(id) || null,
    /** 记录身份：原始 id 在目录内才成立，否则视为未识别。 */
    resolveRecordId(record, entityType = null) {
      const rawId = readHistoryRawItemId(record);
      if (rawId) {
        const item = itemsById.get(rawId);
        if (!item || Number(item.rarity) !== Number(record.rarity)) return null;
        return !entityType || !item.type || item.type === entityType ? rawId : null;
      }
      const folded = foldName(readHistoryRecordName(record));
      if (!folded) {
        return null;
      }
      const matches = (idsByNameRarity.get(JSON.stringify([folded, Number(record?.rarity)])) || [])
        .filter((id) => !entityType || !itemsById.get(id)?.type || itemsById.get(id).type === entityType);
      return matches.length === 1 ? matches[0] : null;
    },
  };
}

/**
 * 记录侧目标引用与 statisticsItemCategory 完全一致：只使用目录解析出的规范 id、
 * 规范名称与别名，绝不使用历史里可能被打过的 character_name 文本。
 */
function buildRecordReferences(record, capabilities, catalogIndex) {
  const itemId = catalogIndex.resolveRecordId(record);
  if (!itemId) {
    return null;
  }
  const item = catalogIndex.get(itemId);
  const entityType = readEntityType(capabilities);
  if (entityType && item.type !== entityType) {
    return null;
  }
  return [itemId, item.name, ...(item.aliases || [])].filter(Boolean).map((value) => String(value).trim());
}

/** 资源拷贝需要稳定键：原始 id 优先，其次规范 id，最后按名称归并。 */
function resolveCopyIdentity(record, catalogIndex, entityType = null) {
  const rawId = readHistoryRawItemId(record);
  if (rawId) {
    return { key: `id:${rawId}`, item: catalogIndex.get(rawId) };
  }
  const resolvedId = catalogIndex.resolveRecordId(record, entityType);
  if (resolvedId) {
    return { key: `id:${resolvedId}`, item: catalogIndex.get(resolvedId) };
  }
  const folded = foldName(readHistoryRecordName(record));
  return folded ? { key: `name:${folded}`, item: null } : { key: null, item: null };
}

/**
 * 目标分类复用 shared/statisticsScopes.js 的 exact 目标引用，避免与
 * statisticsItemCategory 出现两份规则。目标未配置或记录无法识别时返回
 * 'unknown'（待分类），只有两边都能精确对应才给出 target/offTarget；
 * 返回 null 表示该卡池不区分目标。
 */
function classifySixStarTarget(record, capabilities, targetReferences, catalogIndex) {
  if (!capabilities?.isResolved || capabilities.targetMode === 'none') {
    return null;
  }

  const references = buildRecordReferences(record, capabilities, catalogIndex);
  if (!references || !targetReferences.length) {
    return 'unknown';
  }
  return references.some((reference) => targetReferences.includes(reference)) ? 'target' : 'offTarget';
}

function addQuota(summary, addition) {
  Object.keys(summary).forEach((key) => {
    summary[key] = (summary[key] || 0) + (addition[key] || 0);
  });
}

/** 卡池能力、保底作用域与目标引用只依赖卡池本身，缓存后避免逐条记录重复解析。 */
function createPoolResolver() {
  const cache = new Map();
  return (pool) => {
    const poolId = String(getPoolRecordId(pool) ?? '');
    let resolved = cache.get(poolId);
    if (!resolved) {
      const capabilities = resolvePoolCapabilities(pool);
      const scopeKind = capabilities.pityScope === 'series'
        ? 'series'
        : capabilities.pityScope === 'shared' ? 'shared' : 'pool';
      const seriesStateKey = scopeKind === 'series' ? getPoolSeriesStateKey(pool) : null;
      resolved = {
        capabilities,
        scopeKind,
        // 与 poolScopedHistory 的作用域匹配等价：shared 汇总全部共享池，
        // series 必须 profile 与 seriesKey 同时一致，其余按池 id 隔离。
        scopeKey: scopeKind === 'shared'
          ? 'shared'
          : scopeKind === 'series' ? (seriesStateKey ? `series:${seriesStateKey}` : null) : `pool:${poolId}`,
        targetReferences: statisticsTargetReferences(pool),
      };
      cache.set(poolId, resolved);
    }
    return resolved;
  };
}

/**
 * 仅用于完整保存历史（不可传 UI 分页或已过滤切片）。账号隔离与
 * 有效性校验（id、时间、4/5/6、按账号 record_id 去重）与
 * storedPoolObservations 保持一致；比率是 0~1 的小数，无样本的平均值为 null。
 * 每个账号的保底时间线从保存起点开始，meta 明确该边界不是完整游戏历史。
 * 输出只有聚合值，不含账号键与原始记录。
 */
export function buildScopedLegacyStatistics({
  history = [], pools = [], characters = [], memberPoolIds = [], accountKey = null,
} = {}) {
  const poolLookup = new Map();
  for (const pool of pools) {
    for (const alias of [pool?.id, pool?.pool_id]) {
      if (alias != null) {
        poolLookup.set(String(alias), pool);
      }
    }
  }

  const members = new Set();
  for (const memberId of memberPoolIds) {
    const id = String(memberId);
    members.add(id);
    const pool = poolLookup.get(id);
    if (pool) {
      for (const alias of [pool.id, pool.pool_id]) {
        if (alias != null) {
          members.add(String(alias));
        }
      }
    }
  }

  const isSelected = (record) => {
    const rawPoolId = String(getHistoryPoolId(record) ?? '');
    if (members.has(rawPoolId)) {
      return true;
    }
    const pool = poolLookup.get(rawPoolId);
    return Boolean(pool) && members.has(String(getPoolRecordId(pool)));
  };

  const catalogIndex = buildCatalogIndex(characters);
  const resolvePool = createPoolResolver();
  const accounts = new Map();
  const seenRecordKeys = new Set();
  const exclusions = {
    missingIdentity: 0,
    invalidTime: 0,
    invalidRarity: 0,
    duplicate: 0,
    missingPool: 0,
    unresolvedPool: 0,
  };

  for (const original of history) {
    const account = storedAccountKey(original);
    if (accountKey !== null && account !== accountKey) {
      continue;
    }

    const rawPoolId = getHistoryPoolId(original);
    const recordKey = String(original.record_id ?? original.id ?? '');
    const timelineMs = getHistoryTimelineTimestampMs(original);
    const pool = poolLookup.get(String(rawPoolId ?? ''));
    const reason = !account || !rawPoolId || !recordKey
      ? 'missingIdentity'
      : !timelineMs
        ? 'invalidTime'
        : !VALID_RARITIES.includes(Number(original.rarity))
          ? 'invalidRarity'
          : !pool
            ? 'missingPool'
            : !resolvePool(pool).capabilities.isResolved
              ? 'unresolvedPool'
              : seenRecordKeys.has(JSON.stringify([account, recordKey]))
                ? 'duplicate'
                : null;

    if (reason) {
      if (isSelected(original)) {
        exclusions[reason] += 1;
      }
      continue;
    }

    seenRecordKeys.add(JSON.stringify([account, recordKey]));
    const normalized = {
      ...original,
      poolId: String(getPoolRecordId(pool)),
      rarity: Number(original.rarity),
      isInfoBookPull: isInfoBookHistoryPull(original)
        || original?.isInfoBookPull === true
        || original?.is_info_book_pull === true
        || original?.specialType === 'info_book'
        || original?.special_type === 'info_book',
    };
    // 数十万记录时，时间线排序的字符串日期解析是热点；只把合理量级的
    // 已解析毫秒值回写成数值时间戳，排序结果与逐次解析完全一致。
    if (timelineMs >= 1e12) {
      normalized.timestamp = timelineMs;
    }
    if (!accounts.has(account)) {
      accounts.set(account, []);
    }
    accounts.get(account).push(normalized);
  }

  let regularTotal = 0;
  let sixStarCount = 0;
  let targetCount = 0;
  let offTargetCount = 0;
  let unknownTargetCount = 0;
  let giftCount = 0;
  let intervalSum = 0;
  let intervalCount = 0;
  let boundaryIntervalCount = 0;
  let missingSeriesIntervalCount = 0;
  let participatingAccounts = 0;
  const distribution = new Map();
  const quota = createEmptyQuotaSummary();
  const selectedHistory = [];

  for (const accountHistory of accounts.values()) {
    // 情报书抵扣与拷贝顺序都建立在完整账号历史上，不能被范围过滤或分页重置。
    const timeline = annotateInfoBookPulls(accountHistory, pools).sort(compareHistoryTimelineAsc);
    const copies = new Map();
    const poolTimelines = new Map();
    const sharedScopePools = new Map();
    let hasSelectedRows = false;

    for (const row of timeline) {
      const pool = poolLookup.get(String(getHistoryPoolId(row)));
      const { capabilities, scopeKey, scopeKind, targetReferences } = resolvePool(pool);
      const selected = isSelected(row);
      const gift = isGiftHistoryPull(row);
      const paid = isPaidHistoryPull(row);

      if (selected) {
        hasSelectedRows = true;
        selectedHistory.push(row);
        if (gift) {
          giftCount += 1;
        }
        if (paid) {
          regularTotal += 1;
          if (row.rarity === 6) {
            sixStarCount += 1;
            const classification = classifySixStarTarget(row, capabilities, targetReferences, catalogIndex);
            if (classification === 'target') {
              targetCount += 1;
            } else if (classification === 'offTarget') {
              offTargetCount += 1;
            } else if (classification === 'unknown') {
              unknownTargetCount += 1;
            }
          }
        }
      }

      // 免费抽同样产生配额；赠送只推进持有顺序，不产生任何资源。
      if (selected && !gift && capabilities.bondQuotaPerPull
        && !row.isInfoBookPull && !isInfoBookHistoryPull(row)) {
        quota.bondQuotaDirect += QUOTA_RULES.extraPullBondQuota;
      }

      // 付费时间线只分组一次：per-pool 按时间顺序入桶，shared/series 交给既有 helper
      // 复用同一套作用域规则，避免对每个池重复过滤和排序整段账号历史。
      if (paid) {
        if (!scopeKey) {
          if (selected && row.rarity === 6) {
            missingSeriesIntervalCount += 1;
          }
        } else if (scopeKind === 'pool') {
          const bucket = poolTimelines.get(scopeKey);
          if (bucket) {
            bucket.push(row);
          } else {
            poolTimelines.set(scopeKey, [row]);
          }
        } else if (!sharedScopePools.has(scopeKey)) {
          sharedScopePools.set(scopeKey, pool);
        }
      }

      const identity = resolveCopyIdentity(row, catalogIndex, readEntityType(capabilities));
      if (!identity.key) {
        continue;
      }
      if (capabilities.entityType === 'weapon' || identity.item?.type === 'weapon') {
        if (selected && !gift) {
          addQuota(quota, calculateWeaponQuotaForCopy({ rarity: row.rarity }));
        }
        continue;
      }

      const copyNumber = (copies.get(identity.key) || 0) + 1;
      copies.set(identity.key, copyNumber);
      if (selected && !gift) {
        addQuota(quota, calculateCharacterQuotaForCopy({ rarity: row.rarity, copyNumber }));
      }
    }

    if (!hasSelectedRows) {
      continue;
    }
    participatingAccounts += 1;

    const paidTimelines = [...poolTimelines.values()];
    sharedScopePools.forEach((pool) => {
      paidTimelines.push(buildScopedPaidHistoryTimeline({ history: timeline, pools, pool }));
    });

    for (const paid of paidTimelines) {
      let interval = 0;
      let hasPreviousSixStar = false;

      for (const row of paid) {
        interval += 1;
        if (row.rarity !== 6) {
          continue;
        }

        if (isSelected(row)) {
          intervalSum += interval;
          intervalCount += 1;
          if (!hasPreviousSixStar) {
            boundaryIntervalCount += 1;
          }

          const from = Math.floor((interval - 1) / 10) * 10 + 1;
          if (!distribution.has(from)) {
            distribution.set(from, { from, to: from + 9, target: 0, offTarget: 0, unknown: 0, count: 0 });
          }

          const bin = distribution.get(from);
          bin.count += 1;
          const sourcePool = poolLookup.get(String(getHistoryPoolId(row)));
          const source = resolvePool(sourcePool);
          const classification = classifySixStarTarget(
            row,
            source.capabilities,
            source.targetReferences,
            catalogIndex
          );
          if (classification === 'target') {
            bin.target += 1;
          } else if (classification === 'offTarget') {
            bin.offTarget += 1;
          } else if (classification === 'unknown') {
            bin.unknown += 1;
          }
        }

        interval = 0;
        hasPreviousSixStar = true;
      }
    }
  }

  return {
    regularTotal,
    sixStarCount,
    sixStarRate: regularTotal ? sixStarCount / regularTotal : 0,
    targetCount,
    offTargetCount,
    unknownTargetCount,
    targetRate: targetCount + offTargetCount ? targetCount / (targetCount + offTargetCount) : null,
    avgSixStarInterval: intervalCount ? intervalSum / intervalCount : null,
    resultsPerTarget: targetCount ? regularTotal / targetCount : null,
    giftCount,
    intervalDistribution: [...distribution.values()].sort((left, right) => left.from - right.from),
    resources: buildCapabilityAwarePoolResourceSummary({ history: selectedHistory, pools, quotaLedger: { quota } }),
    meta: {
      schemaVersion: 'scoped-legacy-statistics-v3',
      prefixVerified: false,
      firstBasis: 'stored-history',
      costBasis: 'stored-results',
      resourceBasis: 'stored-account-history',
      targetBasis: 'statisticsTargetReferences-exact',
      participatingAccounts,
      intervalCount,
      boundaryIntervalCount,
      missingSeriesIntervalCount,
      excludedRecords: Object.values(exclusions).reduce((sum, count) => sum + count, 0),
      exclusions,
    },
  };
}

export default buildScopedLegacyStatistics;
