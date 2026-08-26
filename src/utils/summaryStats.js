import { RARITY_CONFIG, EXTRA_POOL_RULES, LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { buildCapabilityAwarePoolResourceSummary } from './resourceEconomy.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { annotateInfoBookPulls } from './historyInfoBook.js';
import { classifyGameAccountRegionBucket } from './gameAccountMetadata.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import {
  buildOneTimeTargetGuaranteeState,
  buildScopedPaidHistoryTimeline,
  getPoolSeriesStateKey,
  isTargetSixStarHistoryRecord,
} from './poolScopedHistory.js';

const PITY_LIMITS = {
  extra: EXTRA_POOL_RULES.sixStarPity,
  limited: LIMITED_POOL_RULES.sixStarPity,
  standard: LIMITED_POOL_RULES.sixStarPity,
  weapon: WEAPON_POOL_RULES.sixStarPity,
};

function isGiftPull(pull) {
  return pull?.specialType === 'gift' || pull?.special_type === 'gift';
}

function isFreePull(pull) {
  return pull?.isFree === true || pull?.is_free === true;
}

function generatePieData(counts) {
  const rawData = [
    { name: '6星(限定)', value: counts[6], color: RARITY_CONFIG[6].color },
    { name: '6星(常驻)', value: counts['6_std'], color: RARITY_CONFIG['6_std'].color },
    { name: '5星', value: counts[5], color: RARITY_CONFIG[5].color },
    { name: '4星', value: counts[4], color: RARITY_CONFIG[4].color },
  ].filter((item) => item.value > 0);

  const totalValue = rawData.reduce((sum, d) => sum + d.value, 0);
  return rawData.map((item) => {
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;
    if (item.name.includes('6星')) minPercent = 15;
    else if (item.name.includes('5星')) minPercent = 20;

    if (currentPercent < minPercent && totalValue > 0) {
      return { ...item, displayValue: Math.ceil((totalValue * minPercent) / 100) };
    }
    return { ...item, displayValue: item.value };
  });
}

function buildDistFromBuckets(buckets, hardPityLimit) {
  const numBuckets = Math.ceil(hardPityLimit / 10);
  const dist = [];
  for (let i = 0; i < numBuckets; i++) {
    const rangeStart = i * 10 + 1;
    const rangeEnd = (i + 1) * 10;
    const isLast = i === numBuckets - 1;

    let limited = 0;
    let standard = 0;
    let guaranteed = 0;
    let hasGuaranteed = false;

    if (isLast) {
      for (const idx in buckets) {
        if (Number(idx) >= i) {
          limited += buckets[idx].limited || 0;
          standard += buckets[idx].standard || 0;
          if (buckets[idx].guaranteed !== undefined) {
            guaranteed += buckets[idx].guaranteed;
            hasGuaranteed = true;
          }
        }
      }
    } else {
      const b = buckets[i];
      if (b) {
        limited = b.limited || 0;
        standard = b.standard || 0;
        if (b.guaranteed !== undefined) {
          guaranteed = b.guaranteed;
          hasGuaranteed = true;
        }
      }
    }

    dist.push({
      range: `${rangeStart}-${rangeEnd}`,
      rangeStart,
      count: limited + standard,
      limited,
      standard,
      ...(hasGuaranteed ? { guaranteed } : {}),
    });
  }
  return dist;
}

function normalizePoolType(type) {
  if (type === 'extra') return 'extra';
  if (type === 'limited' || type === 'limited_character') return 'limited';
  if (type === 'weapon' || type === 'limited_weapon') return 'weapon';
  return 'standard';
}

function getPoolRecordId(pool) {
  return pool?.id || pool?.pool_id || null;
}

function getHistoryPoolId(record) {
  return record?.poolId || record?.pool_id || null;
}

function getRuleScopeKey(pool, capabilities, scopeType) {
  const scopeKind =
    scopeType === 'reward'
      ? capabilities.rewardScope
      : scopeType === 'target'
        ? capabilities.targetScope
        : capabilities.pityScope;
  if (scopeKind === 'series') {
    const seriesStateKey = getPoolSeriesStateKey(capabilities);
    return seriesStateKey ? `${scopeType}:series:${seriesStateKey}` : null;
  }
  if (scopeKind === 'shared') {
    return `${scopeType}:shared:${capabilities.rulesKey}`;
  }
  const poolId = getPoolRecordId(pool);
  return poolId ? `${scopeType}:pool:${poolId}` : null;
}

/**
 * 构建当前用户的抽卡统计数据。
 *
 * @param {Object} options
 * @param {Array} options.history 抽卡历史记录
 * @param {Array} options.pools 卡池列表
 * @param {Object|null} options.user 当前用户
 * @param {Array} [options.characters=[]] 角色元数据
 * @returns {Object} 统计数据
 */
export function buildSummaryStats({ history, pools, user, characters = [] }) {
  const myPools = pools && user ? pools : [];
  const myHistory = history && user ? history.filter((h) => h.user_id === user.id) : [];
  const annotatedMyHistory = annotateInfoBookPulls(myHistory, myPools);

  const poolMap = new Map();
  myPools.forEach((p) => {
    [p.id, p.pool_id].forEach((poolId) => {
      if (poolId) {
        poolMap.set(String(poolId), p);
      }
    });
  });

  const normalizedMyHistory = annotatedMyHistory.map((h) => {
    const pool = poolMap.get(String(getHistoryPoolId(h) || ''));
    if (!pool) return h;

    const capabilities = resolvePoolCapabilities(pool);
    const isStd =
      Number(h?.rarity) === 6
        ? capabilities.targetMode === 'none'
          ? capabilities.basePoolType === 'standard' || (h.isStandard ?? h.is_standard ?? false)
          : !isTargetSixStarHistoryRecord(h, pool)
        : (h.isStandard ?? h.is_standard ?? false);

    return { ...h, isStandard: isStd };
  });

  const data = {
    total: 0,
    sixStar: 0,
    fiveStar: 0,
    counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
    byType: {
      extra: {
        total: 0,
        six: 0,
        limitedSix: 0,
        avgPityUp: null,
        avgPityTarget: null,
        counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
        pityList: [],
      },
      limited: {
        total: 0,
        six: 0,
        limitedSix: 0,
        avgPityUp: null,
        avgPityTarget: null,
        counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
        pityList: [],
      },
      weapon: {
        total: 0,
        six: 0,
        limitedSix: 0,
        avgPityUp: null,
        avgPityTarget: null,
        counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
        pityList: [],
      },
      standard: {
        total: 0,
        six: 0,
        avgPityUp: null,
        avgPityTarget: null,
        counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
        pityList: [],
      },
    },
    contributorsByRegion: { cn: 0, intl: 0 },
    pityStats: { distribution: [] },
    chartData: [],
  };

  const pullsByPool = {};
  const contributorBuckets = new Set();
  const createEntityBucket = () => ({
    total: 0,
    targetScopeTotal: 0,
    six: 0,
    limitedSix: 0,
    counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
    pityList: [],
  });
  const entityBuckets = {
    character: createEntityBucket(),
    weapon: createEntityBucket(),
  };

  for (let i = 0; i < normalizedMyHistory.length; i++) {
    const item = normalizedMyHistory[i];
    const poolId = getHistoryPoolId(item);

    if (!pullsByPool[poolId]) pullsByPool[poolId] = [];
    pullsByPool[poolId].push(item);

    const isGift = isGiftPull(item);
    const isFree = isFreePull(item);

    if (isGift || isFree) continue;

    const sourcePool = poolMap.get(String(poolId || ''));
    const rawType = sourcePool?.type || item?.poolType || item?.pool_type || 'standard';
    const type = normalizePoolType(rawType);
    const typeData = data.byType[type];
    if (!typeData) continue;
    const capabilities = resolvePoolCapabilities(sourcePool || { type: rawType });
    const entityData = entityBuckets[capabilities.entityType];

    data.total++;
    typeData.total++;
    if (entityData) {
      entityData.total++;
      if (capabilities.targetMode !== 'none') {
        entityData.targetScopeTotal++;
      }
    }

    const bucket = classifyGameAccountRegionBucket({
      serverId: item.serverId || item.server_id,
      region: item.region || item.serverRegion,
    });
    if (bucket) contributorBuckets.add(bucket);

    const r = item.rarity;
    if (r === 6) {
      const isTargetSixStar = sourcePool
        ? isTargetSixStarHistoryRecord(item, sourcePool)
        : capabilities.targetMode !== 'none' && !item?.isStandard;
      if (!isTargetSixStar) {
        data.counts['6_std']++;
        typeData.counts['6_std']++;
      } else {
        data.counts[6]++;
        typeData.counts[6]++;
      }
      data.sixStar++;
      typeData.six++;
      if (isTargetSixStar && typeData.limitedSix !== undefined) {
        typeData.limitedSix++;
      }
      if (entityData) {
        entityData.six++;
        if (isTargetSixStar) {
          entityData.counts[6]++;
          entityData.limitedSix++;
        } else {
          entityData.counts['6_std']++;
        }
      }
    } else if (r === 5) {
      data.fiveStar++;
      data.counts[5]++;
      typeData.counts[5]++;
      if (entityData) entityData.counts[5]++;
    } else {
      const nr = r < 4 ? 4 : r;
      data.counts[nr]++;
      typeData.counts[nr]++;
      if (entityData && entityData.counts[nr] !== undefined) entityData.counts[nr]++;
    }
  }

  const upCountByType = { extra: 0, limited: 0, weapon: 0 };

  const globalDistBuckets = {};
  const typeDistBuckets = { extra: {}, limited: {}, weapon: {}, standard: {} };
  const typePityLimits = { extra: 0, limited: 0, weapon: 0, standard: 0 };
  const entityDistBuckets = { character: {}, weapon: {} };
  const entityPityLimits = { character: 0, weapon: 0 };
  const entityPitySums = {
    character: { sum: 0, count: 0 },
    weapon: { sum: 0, count: 0 },
  };
  const entityUpCounts = { character: 0, weapon: 0 };

  const typePitySums = {
    extra: { sum: 0, count: 0 },
    limited: { sum: 0, count: 0 },
    weapon: { sum: 0, count: 0 },
    standard: { sum: 0, count: 0 },
  };
  let limitedNonFreeNonSparkSum = 0,
    limitedNonFreeNonSparkCount = 0;
  let limitedNonFreeSum = 0,
    limitedNonFreeCount = 0;
  let allSixStarPitySum = 0,
    allSixStarPityCount = 0;
  let allSixStarExclFreePitySum = 0,
    allSixStarExclFreePityCount = 0;
  let globalPityLimit = 0;

  let charGiftCount = 0;
  let weaponGiftLimitedCount = 0;
  let weaponGiftStandardCount = 0;

  const poolIds = Object.keys(pullsByPool);
  const poolsWithHistory = myPools.filter((pool) => pullsByPool[getPoolRecordId(pool)]);
  const processedPityScopes = new Set();
  for (let pi = 0; pi < poolIds.length; pi++) {
    const poolId = poolIds[pi];
    const scopePool = poolMap.get(String(poolId || ''));
    if (!scopePool) continue;
    const scopeCapabilities = resolvePoolCapabilities(scopePool);
    const pityScopeKey = getRuleScopeKey(scopePool, scopeCapabilities, 'pity');
    if (!pityScopeKey || processedPityScopes.has(pityScopeKey)) continue;
    processedPityScopes.add(pityScopeKey);

    const sortedPulls = buildScopedPaidHistoryTimeline({
      history: normalizedMyHistory,
      pools: myPools,
      pool: scopePool,
      scopeType: 'pity',
    });
    const guaranteedRecordKeys = new Set();
    poolsWithHistory
      .filter(
        (candidatePool) =>
          getRuleScopeKey(candidatePool, resolvePoolCapabilities(candidatePool), 'pity') === pityScopeKey
      )
      .forEach((candidatePool) => {
        buildOneTimeTargetGuaranteeState({
          history: normalizedMyHistory,
          pools: myPools,
          pool: candidatePool,
        }).guaranteedRecordKeys.forEach((recordKey) => guaranteedRecordKeys.add(recordKey));
      });

    let tempCounter = 0;

    for (let j = 0; j < sortedPulls.length; j++) {
      const pull = sortedPulls[j];
      const sourcePool = poolMap.get(String(getHistoryPoolId(pull) || '')) || scopePool;
      const capabilities = resolvePoolCapabilities(sourcePool);
      const pullType = normalizePoolType(sourcePool?.type || pull?.poolType || pull?.pool_type);
      const entityType = capabilities.entityType;
      const hardPityLimit = Number(capabilities.rules?.sixStarPity || 80);
      typePityLimits[pullType] = Math.max(typePityLimits[pullType], hardPityLimit);
      if (entityPityLimits[entityType] !== undefined) {
        entityPityLimits[entityType] = Math.max(entityPityLimits[entityType], hardPityLimit);
      }
      globalPityLimit = Math.max(globalPityLimit, hardPityLimit);
      tempCounter++;

      if (pull.rarity === 6) {
        const isUp = isTargetSixStarHistoryRecord(pull, sourcePool);
        const recordKey = pull?.id || pull?.record_id;
        const isSpark = recordKey != null && guaranteedRecordKeys.has(String(recordKey));

        allSixStarPitySum += tempCounter;
        allSixStarPityCount++;
        allSixStarExclFreePitySum += tempCounter;
        allSixStarExclFreePityCount++;

        const bucketIdx = Math.floor((tempCounter - 1) / 10);
        if (!globalDistBuckets[bucketIdx]) {
          globalDistBuckets[bucketIdx] = { limited: 0, standard: 0, guaranteed: 0 };
        }
        if (isUp) globalDistBuckets[bucketIdx].limited++;
        else globalDistBuckets[bucketIdx].standard++;
        if (pull.specialType === 'guaranteed') globalDistBuckets[bucketIdx].guaranteed++;

        if (!typeDistBuckets[pullType][bucketIdx]) {
          typeDistBuckets[pullType][bucketIdx] = { limited: 0, standard: 0 };
        }
        if (isUp) typeDistBuckets[pullType][bucketIdx].limited++;
        else typeDistBuckets[pullType][bucketIdx].standard++;

        if (entityDistBuckets[entityType]) {
          if (!entityDistBuckets[entityType][bucketIdx]) {
            entityDistBuckets[entityType][bucketIdx] = { limited: 0, standard: 0 };
          }
          if (isUp) entityDistBuckets[entityType][bucketIdx].limited++;
          else entityDistBuckets[entityType][bucketIdx].standard++;
          entityPitySums[entityType].sum += tempCounter;
          entityPitySums[entityType].count++;
          entityBuckets[entityType].pityList.push({
            count: tempCounter,
            isStandard: !isUp,
            isFree: false,
            isSpark,
            isTargetCapable: capabilities.targetMode !== 'none',
          });
          if (isUp) entityUpCounts[entityType]++;
        }

        typePitySums[pullType].sum += tempCounter;
        typePitySums[pullType].count++;

        if (pullType === 'limited') {
          if (!isSpark) {
            limitedNonFreeNonSparkSum += tempCounter;
            limitedNonFreeNonSparkCount++;
          }
          limitedNonFreeSum += tempCounter;
          limitedNonFreeCount++;
        }

        data.byType[pullType].pityList.push({
          count: tempCounter,
          isStandard: !isUp,
          isFree: false,
          isSpark,
        });

        if (isUp && upCountByType[pullType] !== undefined) {
          upCountByType[pullType]++;
        }
        tempCounter = 0;
      }
    }
  }

  const processedRewardScopes = new Set();
  for (const scopePool of poolsWithHistory) {
    const capabilities = resolvePoolCapabilities(scopePool);
    const rewardScopeKey = getRuleScopeKey(scopePool, capabilities, 'reward');
    if (!rewardScopeKey || processedRewardScopes.has(rewardScopeKey)) continue;
    processedRewardScopes.add(rewardScopeKey);

    const rewardPaidTotal = buildScopedPaidHistoryTimeline({
      history: normalizedMyHistory,
      pools: myPools,
      pool: scopePool,
      scopeType: 'reward',
    }).length;
    const giftInterval = Number(capabilities.rules?.giftInterval || 0);
    if (capabilities.entityType === 'character' && giftInterval > 0) {
      charGiftCount += Math.floor(rewardPaidTotal / giftInterval);
      continue;
    }
    if (capabilities.entityType !== 'weapon') continue;

    const firstStandardGift = Number(capabilities.rules?.firstStandardGift || 0);
    const firstLimitedGift = Number(capabilities.rules?.firstLimitedGift || 0);
    const alternateInterval = Number(capabilities.rules?.giftAlternateInterval || 0);
    if (firstStandardGift > 0 && rewardPaidTotal >= firstStandardGift) weaponGiftStandardCount++;
    if (firstLimitedGift > 0 && rewardPaidTotal >= firstLimitedGift) {
      weaponGiftLimitedCount++;
      if (alternateInterval > 0) {
        const extraCycles = Math.floor((rewardPaidTotal - firstLimitedGift) / alternateInterval);
        weaponGiftStandardCount += Math.ceil(extraCycles / 2);
        weaponGiftLimitedCount += Math.floor(extraCycles / 2);
      }
    }
  }

  data.chartData = generatePieData(data.counts);

  ['extra', 'limited', 'weapon', 'standard'].forEach((t) => {
    data.byType[t].distribution = buildDistFromBuckets(typeDistBuckets[t], typePityLimits[t] || PITY_LIMITS[t]);
    data.byType[t].chartData = generatePieData(data.byType[t].counts);
    if (typePitySums[t].count > 0) {
      data.byType[t].avgPity = (typePitySums[t].sum / typePitySums[t].count).toFixed(1);
    }
    if (t === 'limited') {
      if (limitedNonFreeNonSparkCount > 0) {
        data.byType[t].avgPityExcludingFree = (limitedNonFreeNonSparkSum / limitedNonFreeNonSparkCount).toFixed(1);
      }
      if (limitedNonFreeCount > 0) {
        data.byType[t].avgPityWithSpark = (limitedNonFreeSum / limitedNonFreeCount).toFixed(1);
      }
    }
  });

  data.byType.extra.avgPityUp =
    upCountByType.extra > 0 ? (data.byType.extra.total / upCountByType.extra).toFixed(1) : null;
  data.byType.extra.avgPityTarget = data.byType.extra.avgPityUp;
  data.byType.limited.avgPityUp =
    upCountByType.limited > 0 ? (data.byType.limited.total / upCountByType.limited).toFixed(1) : null;
  data.byType.limited.avgPityTarget = data.byType.limited.avgPityUp;
  data.byType.weapon.avgPityUp =
    upCountByType.weapon > 0 ? (data.byType.weapon.total / upCountByType.weapon).toFixed(1) : null;
  data.byType.weapon.avgPityTarget = data.byType.weapon.avgPityUp;

  if (allSixStarPityCount > 0) {
    data.pityStats.distribution = buildDistFromBuckets(globalDistBuckets, globalPityLimit || 80);
  }

  const characterCounts = entityBuckets.character.counts;
  const characterPityList = entityBuckets.character.pityList;
  const limitedPityListExcludingFree = characterPityList.filter((pull) => pull.isTargetCapable && !pull.isFree);
  const characterPityListExcludingFree = characterPityList.filter((p) => !p.isFree && !p.isSpark);

  const charPitySum = entityPitySums.character.sum;
  const charPityCount = entityPitySums.character.count;

  let charExclFreePitySum = 0,
    charExclFreePityCount = 0;
  for (let i = 0; i < characterPityListExcludingFree.length; i++) {
    charExclFreePitySum += characterPityListExcludingFree[i].count;
    charExclFreePityCount++;
  }

  data.byType.character = {
    total: entityBuckets.character.total,
    six: entityBuckets.character.six,
    limitedSix: entityBuckets.character.limitedSix,
    counts: characterCounts,
    pityList: characterPityList,
    pityListExcludingFree: characterPityListExcludingFree,
    distribution: buildDistFromBuckets(entityDistBuckets.character, entityPityLimits.character || PITY_LIMITS.limited),
    chartData: generatePieData(characterCounts),
    avgPity: charPityCount > 0 ? (charPitySum / charPityCount).toFixed(1) : '-',
    avgPityUp: (() => {
      return entityUpCounts.character > 0
        ? (entityBuckets.character.targetScopeTotal / entityUpCounts.character).toFixed(1)
        : null;
    })(),
    avgPityTarget: (() => {
      return entityUpCounts.character > 0
        ? (entityBuckets.character.targetScopeTotal / entityUpCounts.character).toFixed(1)
        : null;
    })(),
    avgPityExcludingFree: charExclFreePityCount > 0 ? (charExclFreePitySum / charExclFreePityCount).toFixed(1) : null,
  };

  data.byType.weapon = {
    ...data.byType.weapon,
    total: entityBuckets.weapon.total,
    six: entityBuckets.weapon.six,
    limitedSix: entityBuckets.weapon.limitedSix,
    counts: entityBuckets.weapon.counts,
    pityList: entityBuckets.weapon.pityList,
    distribution: buildDistFromBuckets(entityDistBuckets.weapon, entityPityLimits.weapon || PITY_LIMITS.weapon),
    chartData: generatePieData(entityBuckets.weapon.counts),
    avgPity:
      entityPitySums.weapon.count > 0 ? (entityPitySums.weapon.sum / entityPitySums.weapon.count).toFixed(1) : null,
    avgPityUp:
      entityUpCounts.weapon > 0 ? (entityBuckets.weapon.targetScopeTotal / entityUpCounts.weapon).toFixed(1) : null,
    avgPityTarget:
      entityUpCounts.weapon > 0 ? (entityBuckets.weapon.targetScopeTotal / entityUpCounts.weapon).toFixed(1) : null,
  };

  const buildBucketResources = (predicate) => {
    const bucketHistory = normalizedMyHistory.filter((record) => {
      const sourcePool = poolMap.get(String(getHistoryPoolId(record) || ''));
      const rawType = sourcePool?.type || record?.poolType || record?.pool_type || 'standard';
      return predicate(sourcePool, rawType);
    });
    const quotaLedger = buildQuotaLedgerFromHistory(bucketHistory, {
      pools: myPools,
      characters,
    });
    return buildCapabilityAwarePoolResourceSummary({
      history: bucketHistory,
      pools: myPools,
      quotaLedger,
    });
  };
  const buildDisplayBucketResources = (displayTypes) => {
    const allowedTypes = new Set(displayTypes);
    return buildBucketResources((sourcePool, rawType) =>
      allowedTypes.has(normalizePoolType(sourcePool?.type || rawType))
    );
  };
  const buildEntityBucketResources = (entityType) =>
    buildBucketResources(
      (sourcePool, rawType) => resolvePoolCapabilities(sourcePool || { type: rawType }).entityType === entityType
    );

  data.byType.extra.resources = buildDisplayBucketResources(['extra']);
  data.byType.limited.resources = buildDisplayBucketResources(['limited']);
  data.byType.standard.resources = buildDisplayBucketResources(['standard']);
  data.byType.weapon.resources = buildEntityBucketResources('weapon');
  data.byType.character.resources = buildEntityBucketResources('character');

  data.byType.limited.pityListExcludingFree = limitedPityListExcludingFree;

  data.avgPity = allSixStarPityCount > 0 ? (allSixStarPitySum / allSixStarPityCount).toFixed(1) : '-';

  data.avgPityExcludingFree =
    allSixStarExclFreePityCount > 0 ? (allSixStarExclFreePitySum / allSixStarExclFreePityCount).toFixed(1) : '-';

  data.charGift = charGiftCount;
  data.weaponGiftLimited = weaponGiftLimitedCount;
  data.weaponGiftStandard = weaponGiftStandardCount;
  data.giftTotal = charGiftCount + weaponGiftLimitedCount + weaponGiftStandardCount;
  data.totalUsers = user ? 1 : 0;
  data.totalContributors = user ? 1 : 0;
  data.contributorsByRegion = {
    cn: contributorBuckets.has('cn') ? 1 : 0,
    intl: contributorBuckets.has('intl') ? 1 : 0,
  };
  data.resources = buildDisplayBucketResources(['extra', 'limited', 'standard', 'weapon']);

  return data;
}

export default buildSummaryStats;
