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
import { buildResourceSummaryFromAggregates, DEFAULT_RESOURCE_RULES } from './resourceEconomy.js';
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

function buildPoolLookup(pools) {
  const lookup = new Map();
  for (const pool of pools) {
    for (const alias of [pool?.id, pool?.pool_id]) {
      if (alias != null) {
        lookup.set(String(alias), pool);
      }
    }
  }
  return lookup;
}

/**
 * memberPoolIds 允许传池别名：成员集合同时包含传入值与这些池的规范 id，
 * 与旧的 buildScopedLegacyStatistics 完全一致。
 */
function resolveMemberPoolIds(poolLookup, memberPoolIds) {
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
  return members;
}

function createEmptyResourceAggregate() {
  return {
    characterPulls: 0,
    weaponPulls: 0,
    chargedCharacterPulls: 0,
    chargedWeaponPulls: 0,
    characterCounts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
  };
}

/**
 * 逐池贡献保存的是「可加计数」而不是比率：同一任务内换范围时按成员池
 * 求和后再算比率，避免对已经平均过的比率再平均。
 */
function createPoolContribution() {
  return {
    regularTotal: 0,
    sixStarCount: 0,
    targetCount: 0,
    offTargetCount: 0,
    unknownTargetCount: 0,
    giftCount: 0,
    missingSeriesSixStarCount: 0,
    quota: createEmptyQuotaSummary(),
    resourceAggregate: createEmptyResourceAggregate(),
  };
}

function addResourceAggregate(target, addition) {
  target.characterPulls += addition.characterPulls;
  target.weaponPulls += addition.weaponPulls;
  target.chargedCharacterPulls += addition.chargedCharacterPulls;
  target.chargedWeaponPulls += addition.chargedWeaponPulls;
  target.characterCounts[6] += addition.characterCounts[6];
  target.characterCounts['6_std'] += addition.characterCounts['6_std'];
  target.characterCounts[5] += addition.characterCounts[5];
  target.characterCounts[4] += addition.characterCounts[4];
}

// 与 resourceEconomy 的记录判定保持一致：免费记录、赠送记录与信息书
// 在池资源聚合里的处理必须逐字段复刻，避免两份规则漂移。
function isResourceFreeRecord(record) {
  return record?.isFree === true
    || record?.is_free === true
    || record?.isFreePull === true
    || record?.is_free_pull === true;
}

function isResourceInfoBookRecord(record) {
  return isInfoBookHistoryPull(record)
    || record?.isInfoBookPull === true
    || record?.is_info_book_pull === true
    || record?.specialType === 'info_book'
    || record?.special_type === 'info_book';
}

/**
 * 与 buildCapabilityAwarePoolResourceSummary 的逐记录聚合完全等价：
 * 赠送跳过、免费跳过（includeFreePulls=false）、武器只计抽数、
 * 角色按 isStandard 拆分六星计数，聚合值可跨池相加。
 */
function addRecordResourceAggregate(aggregate, record, capabilities) {
  if (isGiftHistoryPull(record)) {
    return;
  }
  if (isResourceFreeRecord(record)) {
    return;
  }

  const isWeapon = capabilities.entityType === 'weapon' || capabilities.basePoolType === 'weapon';
  const isCharged = !isResourceInfoBookRecord(record);

  if (isWeapon) {
    aggregate.weaponPulls += 1;
    if (isCharged) {
      aggregate.chargedWeaponPulls += 1;
    }
    return;
  }

  aggregate.characterPulls += 1;
  if (isCharged) {
    aggregate.chargedCharacterPulls += 1;
  }

  const rarity = Number(record?.rarity) || 0;
  if (rarity >= 6) {
    aggregate.characterCounts[record?.isStandard ? '6_std' : 6] += 1;
  } else if (rarity === 5) {
    aggregate.characterCounts[5] += 1;
  } else if (rarity > 0) {
    aggregate.characterCounts[4] += 1;
  }
}

function addExclusionCount(exclusionCountsByAccount, account, reason, rawPoolId, canonicalPoolId) {
  let exclusionCounts = exclusionCountsByAccount.get(account);
  if (!exclusionCounts) {
    exclusionCounts = new Map();
    exclusionCountsByAccount.set(account, exclusionCounts);
  }

  // 排除记录的统计范围只能在 build 时判断，因此按 (原因, 原始池 id, 规范池 id)
  // 先聚合计数，范围确定后再决定是否计入 meta.exclusions。
  const entryKey = JSON.stringify([reason, rawPoolId, canonicalPoolId]);
  const entry = exclusionCounts.get(entryKey);
  if (entry) {
    entry.count += 1;
    return;
  }
  exclusionCounts.set(entryKey, { reason, rawPoolId, canonicalPoolId, count: 1 });
}

/**
 * 同一任务内复用：准备阶段只做与统计范围无关的工作（有效性校验、逐账号
 * 时间线、信息书推断、拷贝顺序、保底分桶、资源与配额增量），并按账号 +
 * 规范池 id 保存可加贡献。之后任意组合同一任务内多次调用 build，
 * 不会再次复制历史、重排时间线或重复计算保底。
 *
 * 生命周期仅限本次计算：返回对象不持有原始/规范化历史记录，也不做跨任务缓存。
 */
export function prepareScopedLegacyStatistics({ history = [], pools = [], characters = [] } = {}) {
  const poolLookup = buildPoolLookup(pools);
  const catalogIndex = buildCatalogIndex(characters);
  const resolvePool = createPoolResolver();
  const recordsByAccount = new Map();
  const seenRecordKeysByAccount = new Map();
  const exclusionEntriesByAccount = new Map();

  for (const original of history) {
    const account = storedAccountKey(original);
    const rawPoolId = String(getHistoryPoolId(original) ?? '');
    const recordKey = String(original.record_id ?? original.id ?? '');
    const timelineMs = getHistoryTimelineTimestampMs(original);
    const pool = poolLookup.get(rawPoolId);
    const canonicalPoolId = pool ? String(getPoolRecordId(pool)) : null;
    const seenRecordKeys = account ? seenRecordKeysByAccount.get(account) : null;

    let reason = null;
    if (!account || !rawPoolId || !recordKey) {
      reason = 'missingIdentity';
    } else if (!timelineMs) {
      reason = 'invalidTime';
    } else if (!VALID_RARITIES.includes(Number(original.rarity))) {
      reason = 'invalidRarity';
    } else if (!pool) {
      reason = 'missingPool';
    } else if (!resolvePool(pool).capabilities.isResolved) {
      reason = 'unresolvedPool';
    } else if (seenRecordKeys?.has(recordKey)) {
      reason = 'duplicate';
    }

    if (reason) {
      addExclusionCount(exclusionEntriesByAccount, account, reason, rawPoolId, canonicalPoolId);
      continue;
    }

    if (seenRecordKeys) {
      seenRecordKeys.add(recordKey);
    } else {
      seenRecordKeysByAccount.set(account, new Set([recordKey]));
    }

    const accountRecords = recordsByAccount.get(account);
    if (accountRecords) {
      accountRecords.push(original);
    } else {
      recordsByAccount.set(account, [original]);
    }
  }

  seenRecordKeysByAccount.clear();
  const accounts = new Map();

  for (const [account, accountRecords] of recordsByAccount) {
    // 只复制当前账号的记录，完成贡献压缩后即可释放，避免同时保留全量副本。
    const normalized = accountRecords.map((original) => {
      const pool = poolLookup.get(String(getHistoryPoolId(original)));
      const row = { ...original, poolId: String(getPoolRecordId(pool)), rarity: Number(original.rarity),
        isInfoBookPull: isResourceInfoBookRecord(original) };
      const timelineMs = getHistoryTimelineTimestampMs(original);
      if (timelineMs >= 1e12) row.timestamp = timelineMs;
      return row;
    });
    recordsByAccount.delete(account);
    // 情报书抵扣与拷贝顺序都建立在完整账号历史上，不能被范围过滤或分页重置。
    const timeline = annotateInfoBookPulls(normalized, pools).sort(compareHistoryTimelineAsc);
    const contributions = new Map();
    const poolBuckets = new Map();
    const sharedScopePools = new Map();
    const copies = new Map();

    for (const row of timeline) {
      const pool = poolLookup.get(String(getHistoryPoolId(row)));
      const { capabilities, scopeKey, scopeKind, targetReferences } = resolvePool(pool);
      const canonicalPoolId = String(getPoolRecordId(pool));
      let contribution = contributions.get(canonicalPoolId);
      if (!contribution) {
        contribution = createPoolContribution();
        contributions.set(canonicalPoolId, contribution);
      }

      const gift = isGiftHistoryPull(row);
      const paid = isPaidHistoryPull(row);

      if (paid) {
        contribution.regularTotal += 1;
        if (row.rarity === 6) {
          contribution.sixStarCount += 1;
          const classification = classifySixStarTarget(row, capabilities, targetReferences, catalogIndex);
          if (classification === 'target') {
            contribution.targetCount += 1;
          } else if (classification === 'offTarget') {
            contribution.offTargetCount += 1;
          } else if (classification === 'unknown') {
            contribution.unknownTargetCount += 1;
          }
        }
      }
      if (gift) {
        contribution.giftCount += 1;
      }

      // 免费抽同样产生配额；赠送只推进持有顺序，不产生任何资源。
      if (!gift && capabilities.bondQuotaPerPull
        && !row.isInfoBookPull && !isInfoBookHistoryPull(row)) {
        contribution.quota.bondQuotaDirect += QUOTA_RULES.extraPullBondQuota;
      }

      // 付费时间线只分组一次：per-pool 按时间顺序入桶，shared/series 交给既有 helper
      // 复用同一套作用域规则，避免对每个池重复过滤和排序整段账号历史。
      if (paid) {
        if (!scopeKey) {
          if (row.rarity === 6) {
            contribution.missingSeriesSixStarCount += 1;
          }
        } else if (scopeKind === 'pool') {
          const bucket = poolBuckets.get(scopeKey);
          if (bucket) {
            bucket.push(row);
          } else {
            poolBuckets.set(scopeKey, [row]);
          }
        } else if (!sharedScopePools.has(scopeKey)) {
          sharedScopePools.set(scopeKey, pool);
        }
      }

      addRecordResourceAggregate(contribution.resourceAggregate, row, capabilities);

      const identity = resolveCopyIdentity(row, catalogIndex, readEntityType(capabilities));
      if (!identity.key) {
        continue;
      }
      if (capabilities.entityType === 'weapon' || identity.item?.type === 'weapon') {
        if (!gift) {
          addQuota(contribution.quota, calculateWeaponQuotaForCopy({ rarity: row.rarity }));
        }
        continue;
      }

      const copyNumber = (copies.get(identity.key) || 0) + 1;
      copies.set(identity.key, copyNumber);
      if (!gift) {
        addQuota(contribution.quota, calculateCharacterQuotaForCopy({ rarity: row.rarity, copyNumber }));
      }
    }

    // 保底间隔只依赖桶内付费记录序列，与统计范围无关：这里把每个桶压缩成
    // 六星条目（间隔、是否桶内首个六星、目标分类），build 时无需重排时间线。
    const bucketEntries = [];
    const appendBucketEntries = (paidTimeline) => {
      let interval = 0;
      let isBucketLead = true;
      for (const row of paidTimeline) {
        interval += 1;
        if (row.rarity !== 6) {
          continue;
        }
        const pool = poolLookup.get(String(getHistoryPoolId(row)));
        const { capabilities, targetReferences } = resolvePool(pool);
        bucketEntries.push({
          canonicalPoolId: String(getPoolRecordId(pool)),
          interval,
          isBucketLead,
          classification: classifySixStarTarget(row, capabilities, targetReferences, catalogIndex),
        });
        interval = 0;
        isBucketLead = false;
      }
    };

    for (const bucket of poolBuckets.values()) {
      appendBucketEntries(bucket);
    }
    sharedScopePools.forEach((pool) => {
      appendBucketEntries(buildScopedPaidHistoryTimeline({ history: timeline, pools, pool }));
    });

    const exclusionEntries = exclusionEntriesByAccount.get(account);
    accounts.set(account, {
      contributions,
      bucketEntries,
      exclusions: exclusionEntries ? [...exclusionEntries.values()] : [],
    });
  }

  // 逐池贡献构建完成后不再需要历史记录：避免把整份历史留在缓存里。
  recordsByAccount.clear();
  seenRecordKeysByAccount.clear();
  // 只有无效记录的账号也必须保留排除计数，但不能算作参与账号。
  for (const [account, entries] of exclusionEntriesByAccount) {
    if (account !== null && !accounts.has(account)) {
      accounts.set(account, { contributions: new Map(), bucketEntries: [], exclusions: [...entries.values()] });
    }
  }

  const build = ({ memberPoolIds = [], accountKey = null } = {}) => {
    const members = resolveMemberPoolIds(poolLookup, memberPoolIds);
    const exclusions = {
      missingIdentity: 0,
      invalidTime: 0,
      invalidRarity: 0,
      duplicate: 0,
      missingPool: 0,
      unresolvedPool: 0,
    };
    const quota = createEmptyQuotaSummary();
    const resourceAggregate = createEmptyResourceAggregate();
    const distribution = new Map();

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

    // accountKey 指定时只合并该账号；未指定时合并全部账号。范围只影响合并，
    // 因此同一份准备结果可以安全地服务同一任务内的任意多个范围。
    const accountEntries = accountKey === null
      ? accounts.values()
      : (accounts.has(accountKey) ? [accounts.get(accountKey)] : []);

    for (const account of accountEntries) {
      let accountParticipates = false;
      for (const poolId of account.contributions.keys()) {
        if (members.has(poolId)) {
          accountParticipates = true;
          break;
        }
      }
      if (accountParticipates) {
        participatingAccounts += 1;
      }

      for (const [poolId, contribution] of account.contributions) {
        if (!members.has(poolId)) {
          continue;
        }
        regularTotal += contribution.regularTotal;
        sixStarCount += contribution.sixStarCount;
        targetCount += contribution.targetCount;
        offTargetCount += contribution.offTargetCount;
        unknownTargetCount += contribution.unknownTargetCount;
        giftCount += contribution.giftCount;
        missingSeriesIntervalCount += contribution.missingSeriesSixStarCount;
        addQuota(quota, contribution.quota);
        addResourceAggregate(resourceAggregate, contribution.resourceAggregate);
      }

      for (const entry of account.exclusions) {
        const selectedInScope = members.has(entry.rawPoolId)
          || (entry.canonicalPoolId !== null && members.has(entry.canonicalPoolId));
        if (selectedInScope) {
          exclusions[entry.reason] += entry.count;
        }
      }

      for (const entry of account.bucketEntries) {
        if (!members.has(entry.canonicalPoolId)) {
          continue;
        }

        intervalSum += entry.interval;
        intervalCount += 1;
        if (entry.isBucketLead) {
          boundaryIntervalCount += 1;
        }

        const from = Math.floor((entry.interval - 1) / 10) * 10 + 1;
        let bin = distribution.get(from);
        if (!bin) {
          bin = { from, to: from + 9, target: 0, offTarget: 0, unknown: 0, count: 0 };
          distribution.set(from, bin);
        }
        bin.count += 1;
        if (entry.classification === 'target') {
          bin.target += 1;
        } else if (entry.classification === 'offTarget') {
          bin.offTarget += 1;
        } else if (entry.classification === 'unknown') {
          bin.unknown += 1;
        }
      }
    }

    // 无账号身份（game_uid 为空）的排除记录只在全账号口径下计数，
    // 指定 accountKey 时旧实现会先跳过它们。
    if (accountKey === null) {
      const unassignedExclusionEntries = exclusionEntriesByAccount.get(null);
      if (unassignedExclusionEntries) {
        for (const entry of unassignedExclusionEntries.values()) {
          const selectedInScope = members.has(entry.rawPoolId)
            || (entry.canonicalPoolId !== null && members.has(entry.canonicalPoolId));
          if (selectedInScope) {
            exclusions[entry.reason] += entry.count;
          }
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
      resources: buildResourceSummaryFromAggregates({
        characterPulls: resourceAggregate.characterPulls,
        weaponPulls: resourceAggregate.weaponPulls,
        chargedCharacterPulls: resourceAggregate.chargedCharacterPulls,
        chargedWeaponPulls: resourceAggregate.chargedWeaponPulls,
        counts: resourceAggregate.characterCounts,
        arsenalGainCounts: resourceAggregate.characterCounts,
        quotaLedger: { quota },
        settings: DEFAULT_RESOURCE_RULES,
      }),
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
  };

  return { build };
}

/**
 * 仅用于完整保存历史（不可传 UI 分页或已过滤切片）。账号隔离与
 * 有效性校验（id、时间、4/5/6、按账号 record_id 去重）与
 * storedPoolObservations 保持一致；比率是 0~1 的小数，无样本的平均值为 null。
 * 每个账号的保底时间线从保存起点开始，meta 明确该边界不是完整游戏历史。
 * 输出只有聚合值，不含账号键与原始记录。
 *
 * 单次调用等价于 prepareScopedLegacyStatistics(...).build(...)；需要同一任务内
 * 多个范围复用逐池贡献时，先 prepare 再多次 build。
 */
export function buildScopedLegacyStatistics({
  history = [], pools = [], characters = [], memberPoolIds = [], accountKey = null,
} = {}) {
  return prepareScopedLegacyStatistics({ history, pools, characters }).build({ memberPoolIds, accountKey });
}

export default buildScopedLegacyStatistics;
