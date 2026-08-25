import { RARITY_CONFIG, EXTRA_POOL_RULES, LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { buildResourceSummaryFromAggregates } from './resourceEconomy.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { annotateInfoBookPulls, isInfoBookHistoryPull } from './historyInfoBook.js';
import { classifyGameAccountRegionBucket } from './gameAccountMetadata.js';

const PITY_LIMITS = {
  extra: EXTRA_POOL_RULES.sixStarPity,
  limited: LIMITED_POOL_RULES.sixStarPity,
  standard: LIMITED_POOL_RULES.sixStarPity,
  weapon: WEAPON_POOL_RULES.sixStarPity
};

function isGiftPull(pull) {
  return pull?.specialType === 'gift' || pull?.special_type === 'gift';
}

function isFreePull(pull) {
  return pull?.isFree === true || pull?.is_free === true;
}

function matchesPoolTarget(pull, poolMeta) {
  const upCharacter = String(poolMeta?.upCharacter || '').trim();
  if (!upCharacter || pull?.rarity !== 6) {
    return false;
  }

  const target = upCharacter.toLowerCase();
  const pullName = String(pull?.character_name || pull?.item_name || pull?.name || '').trim().toLowerCase();
  if (!pullName) {
    return false;
  }

  return pullName.includes(target) || target.includes(pullName);
}

function generatePieData(counts) {
  const rawData = [
    { name: '6星(限定)', value: counts[6], color: RARITY_CONFIG[6].color },
    { name: '6星(常驻)', value: counts['6_std'], color: RARITY_CONFIG['6_std'].color },
    { name: '5星', value: counts[5], color: RARITY_CONFIG[5].color },
    { name: '4星', value: counts[4], color: RARITY_CONFIG[4].color },
  ].filter(item => item.value > 0);

  const totalValue = rawData.reduce((sum, d) => sum + d.value, 0);
  return rawData.map(item => {
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;
    if (item.name.includes('6星')) minPercent = 15;
    else if (item.name.includes('5星')) minPercent = 20;

    if (currentPercent < minPercent && totalValue > 0) {
      return { ...item, displayValue: Math.ceil(totalValue * minPercent / 100) };
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
      ...(hasGuaranteed ? { guaranteed } : {})
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

function isTargetSixStarByPoolType(item, poolType) {
  return poolType === 'extra' || !item?.isStandard;
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
  const myHistory = history && user
    ? history.filter(h => h.user_id === user.id)
    : [];
  const annotatedMyHistory = annotateInfoBookPulls(myHistory, myPools);

  const poolMap = new Map();
  myPools.forEach(p => {
    [p.id, p.pool_id].forEach((poolId) => {
      if (poolId) {
        poolMap.set(poolId, { type: p.type, upCharacter: p.up_character });
      }
    });
  });

  const normalizedMyHistory = annotatedMyHistory.map(h => {
    const pool = poolMap.get(h.poolId || h.pool_id);
    if (!pool) return h;

    const poolType = pool.type;
    const upCharacter = pool.upCharacter;
    const characterName = h.character_name || h.item_name || h.name || '';
    let isStd;

    if (poolType === 'standard' || poolType === 'beginner') {
      isStd = true;
    } else if (poolType === 'extra') {
      if (h.rarity === 6) {
        isStd = false;
      } else {
        isStd = h.isStandard ?? false;
      }
    } else if (poolType === 'limited' || poolType === 'limited_character' || poolType === 'weapon' || poolType === 'limited_weapon') {
      if (upCharacter && h.rarity === 6) {
        isStd = !characterName.toLowerCase().includes(upCharacter.toLowerCase()) &&
                !upCharacter.toLowerCase().includes(characterName.toLowerCase());
      } else if (h.rarity === 6) {
        isStd = false;
      } else {
        isStd = h.isStandard ?? false;
      }
    } else {
      isStd = h.isStandard ?? false;
    }

    return { ...h, isStandard: isStd };
  });

  const data = {
    total: 0,
    sixStar: 0,
    fiveStar: 0,
    counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
    byType: {
      extra: { total: 0, six: 0, limitedSix: 0, avgPityUp: null, avgPityTarget: null, counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 }, pityList: [] },
      limited: { total: 0, six: 0, limitedSix: 0, avgPityUp: null, avgPityTarget: null, counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 }, pityList: [] },
      weapon: { total: 0, six: 0, limitedSix: 0, avgPityUp: null, avgPityTarget: null, counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 }, pityList: [] },
      standard: { total: 0, six: 0, avgPityUp: null, avgPityTarget: null, counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 }, pityList: [] }
    },
    contributorsByRegion: { cn: 0, intl: 0 },
    pityStats: { distribution: [] },
    chartData: []
  };

  const poolTypeMap = new Map();
  const poolMetaMap = new Map();
  myPools.forEach(p => {
    [p.id, p.pool_id].forEach((poolId) => {
      if (poolId) {
        poolTypeMap.set(poolId, p.type);
        poolMetaMap.set(poolId, { type: p.type, upCharacter: p.upCharacter || p.up_character || null });
      }
    });
  });

  const pullsByPool = {};
  const chargedPullsByType = { extra: 0, limited: 0, weapon: 0, standard: 0 };
  const contributorBuckets = new Set();

  for (let i = 0; i < normalizedMyHistory.length; i++) {
    const item = normalizedMyHistory[i];
    const poolId = item.poolId || item.pool_id;

    if (!pullsByPool[poolId]) pullsByPool[poolId] = [];
    pullsByPool[poolId].push(item);

    const isGift = isGiftPull(item);
    const isFree = isFreePull(item);

    if (isGift || isFree) continue;

    const rawType = poolTypeMap.get(poolId) || 'standard';
    const type = normalizePoolType(rawType);
    const typeData = data.byType[type];
    if (!typeData) continue;

    data.total++;
    typeData.total++;

    if (type === 'limited' || type === 'extra') {
      if (!isInfoBookHistoryPull(item)) chargedPullsByType[type]++;
    } else if (type === 'weapon') {
      chargedPullsByType.weapon++;
    } else {
      chargedPullsByType.standard++;
    }

    const bucket = classifyGameAccountRegionBucket({
      serverId: item.serverId || item.server_id,
      region: item.region || item.serverRegion
    });
    if (bucket) contributorBuckets.add(bucket);

    const r = item.rarity;
    if (r === 6) {
      const isTargetSixStar = isTargetSixStarByPoolType(item, type);
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
    } else if (r === 5) {
      data.fiveStar++;
      data.counts[5]++;
      typeData.counts[5]++;
    } else {
      const nr = r < 4 ? 4 : r;
      data.counts[nr]++;
      typeData.counts[nr]++;
    }
  }

  const allQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
    pools: myPools,
    characters
  });
  const characterQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
    pools: myPools,
    characters,
    includePoolTypes: ['extra', 'limited', 'standard']
  });
  const extraQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
    pools: myPools,
    characters,
    includePoolTypes: ['extra']
  });
  const limitedQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
    pools: myPools,
    characters,
    includePoolTypes: ['limited']
  });
  const standardQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
    pools: myPools,
    characters,
    includePoolTypes: ['standard']
  });
  const weaponQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
    pools: myPools,
    characters,
    includePoolTypes: ['weapon']
  });

  const upCountByType = { extra: 0, limited: 0, weapon: 0 };

  const globalDistBuckets = {};
  const typeDistBuckets = { extra: {}, limited: {}, weapon: {}, standard: {} };

  const typePitySums = {
    extra: { sum: 0, count: 0 },
    limited: { sum: 0, count: 0 },
    weapon: { sum: 0, count: 0 },
    standard: { sum: 0, count: 0 }
  };
  let limitedNonFreeNonSparkSum = 0, limitedNonFreeNonSparkCount = 0;
  let limitedNonFreeSum = 0, limitedNonFreeCount = 0;
  let allSixStarPitySum = 0, allSixStarPityCount = 0;
  let allSixStarExclFreePitySum = 0, allSixStarExclFreePityCount = 0;
  let globalMaxPity = 0;

  let charGiftCount = 0;
  let weaponGiftLimitedCount = 0;
  let weaponGiftStandardCount = 0;

  const poolIds = Object.keys(pullsByPool);
  for (let pi = 0; pi < poolIds.length; pi++) {
    const poolId = poolIds[pi];
    const rawType = poolTypeMap.get(poolId) || 'standard';
    const type = normalizePoolType(rawType);
    const poolMeta = poolMetaMap.get(poolId);
    const sortedPulls = pullsByPool[poolId].sort((a, b) => a.id - b.id);

    let poolTotal = 0;
    for (let j = 0; j < sortedPulls.length; j++) {
      if (!isGiftPull(sortedPulls[j]) && !isFreePull(sortedPulls[j])) poolTotal++;
    }

    if (type === 'limited') {
      charGiftCount += Math.floor(poolTotal / 240);
    } else if (type === 'weapon') {
      if (poolTotal >= 100) weaponGiftStandardCount += 1 + Math.floor((poolTotal - 100) / 160);
      if (poolTotal >= 180) weaponGiftLimitedCount += 1 + Math.floor((poolTotal - 180) / 160);
    }

    let tempCounter = 0;
    let tempCounterExcludingFree = 0;
    let cumulativePullCount = 0;
    let hasGotUpBefore120 = false;

    for (let j = 0; j < sortedPulls.length; j++) {
      const pull = sortedPulls[j];
      if (isGiftPull(pull) || isFreePull(pull)) continue;

      const isFree = pull.isFree || pull.is_free;
      tempCounter++;
      if (!isFree) tempCounterExcludingFree++;
      cumulativePullCount++;

      if (pull.rarity === 6) {
        const isUp = isTargetSixStarByPoolType(pull, type);
        let isSpark = false;
        if (type === 'limited' && isUp && cumulativePullCount === 120 && !hasGotUpBefore120) {
          isSpark = true;
        }
        if (isUp && cumulativePullCount < 120) {
          hasGotUpBefore120 = true;
        }

        allSixStarPitySum += tempCounter;
        allSixStarPityCount++;
        if (tempCounter > globalMaxPity) globalMaxPity = tempCounter;

        const bucketIdx = Math.floor((tempCounter - 1) / 10);
        if (!globalDistBuckets[bucketIdx]) {
          globalDistBuckets[bucketIdx] = { limited: 0, standard: 0, guaranteed: 0 };
        }
        if (isUp) globalDistBuckets[bucketIdx].limited++;
        else globalDistBuckets[bucketIdx].standard++;
        if (pull.specialType === 'guaranteed') globalDistBuckets[bucketIdx].guaranteed++;

        if (!typeDistBuckets[type][bucketIdx]) {
          typeDistBuckets[type][bucketIdx] = { limited: 0, standard: 0 };
        }
        if (isUp) typeDistBuckets[type][bucketIdx].limited++;
        else typeDistBuckets[type][bucketIdx].standard++;

        typePitySums[type].sum += tempCounter;
        typePitySums[type].count++;

        if (type === 'limited') {
          if (!isFree && !isSpark) {
            limitedNonFreeNonSparkSum += tempCounter;
            limitedNonFreeNonSparkCount++;
          }
          if (!isFree) {
            limitedNonFreeSum += tempCounter;
            limitedNonFreeCount++;
          }
        }

        if (!isFree) {
          allSixStarExclFreePitySum += tempCounterExcludingFree;
          allSixStarExclFreePityCount++;
          tempCounterExcludingFree = 0;
        }

        data.byType[type].pityList.push({
          count: tempCounter,
          isStandard: !isUp,
          isFree: isFree,
          isSpark
        });

        if (type === 'extra') {
          upCountByType.extra++;
        } else if ((type === 'limited' || type === 'weapon') && matchesPoolTarget(pull, poolMeta)) {
          if (upCountByType[type] !== undefined) upCountByType[type]++;
        }
        tempCounter = 0;
      }
    }
  }

  data.chartData = generatePieData(data.counts);

  ['extra', 'limited', 'weapon', 'standard'].forEach(t => {
    data.byType[t].distribution = buildDistFromBuckets(typeDistBuckets[t], PITY_LIMITS[t]);
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

  data.byType.extra.avgPityUp = upCountByType.extra > 0
    ? (data.byType.extra.total / upCountByType.extra).toFixed(1)
    : null;
  data.byType.extra.avgPityTarget = data.byType.extra.avgPityUp;
  data.byType.limited.avgPityUp = upCountByType.limited > 0
    ? (data.byType.limited.total / upCountByType.limited).toFixed(1)
    : null;
  data.byType.limited.avgPityTarget = data.byType.limited.avgPityUp;
  data.byType.weapon.avgPityUp = upCountByType.weapon > 0
    ? (data.byType.weapon.total / upCountByType.weapon).toFixed(1)
    : null;
  data.byType.weapon.avgPityTarget = data.byType.weapon.avgPityUp;

  if (allSixStarPityCount > 0) {
    data.pityStats.distribution = buildDistFromBuckets(globalDistBuckets, PITY_LIMITS.limited);
  }

  const characterCounts = {
    6: data.byType.extra.counts[6] + data.byType.limited.counts[6] + data.byType.standard.counts[6],
    '6_std': data.byType.extra.counts['6_std'] + data.byType.limited.counts['6_std'] + data.byType.standard.counts['6_std'],
    5: data.byType.extra.counts[5] + data.byType.limited.counts[5] + data.byType.standard.counts[5],
    4: data.byType.extra.counts[4] + data.byType.limited.counts[4] + data.byType.standard.counts[4]
  };

  const charDistBuckets = {};
  for (const t of ['extra', 'limited', 'standard']) {
    for (const idx in typeDistBuckets[t]) {
      if (!charDistBuckets[idx]) charDistBuckets[idx] = { limited: 0, standard: 0 };
      charDistBuckets[idx].limited += typeDistBuckets[t][idx].limited || 0;
      charDistBuckets[idx].standard += typeDistBuckets[t][idx].standard || 0;
    }
  }

  const characterPityList = [...data.byType.extra.pityList, ...data.byType.limited.pityList, ...data.byType.standard.pityList];
  const limitedPityListExcludingFree = [...data.byType.extra.pityList, ...data.byType.limited.pityList].filter(p => !p.isFree);
  const characterPityListExcludingFree = characterPityList.filter(p => !p.isFree && !p.isSpark);

  const charPitySum = typePitySums.extra.sum + typePitySums.limited.sum + typePitySums.standard.sum;
  const charPityCount = typePitySums.extra.count + typePitySums.limited.count + typePitySums.standard.count;

  let charExclFreePitySum = 0, charExclFreePityCount = 0;
  for (let i = 0; i < characterPityListExcludingFree.length; i++) {
    charExclFreePitySum += characterPityListExcludingFree[i].count;
    charExclFreePityCount++;
  }

  data.byType.character = {
    total: data.byType.extra.total + data.byType.limited.total + data.byType.standard.total,
    six: data.byType.extra.six + data.byType.limited.six + data.byType.standard.six,
    limitedSix: data.byType.extra.limitedSix + data.byType.limited.limitedSix,
    counts: characterCounts,
    pityList: characterPityList,
    pityListExcludingFree: characterPityListExcludingFree,
    distribution: buildDistFromBuckets(charDistBuckets, PITY_LIMITS.limited),
    chartData: generatePieData(characterCounts),
    avgPity: charPityCount > 0
      ? (charPitySum / charPityCount).toFixed(1)
      : '-',
    avgPityUp: (() => {
      const totalCharacterTargets = upCountByType.extra + upCountByType.limited;
      return totalCharacterTargets > 0
        ? ((data.byType.extra.total + data.byType.limited.total) / totalCharacterTargets).toFixed(1)
        : null;
    })(),
    avgPityTarget: (() => {
      const totalCharacterTargets = upCountByType.extra + upCountByType.limited;
      return totalCharacterTargets > 0
        ? ((data.byType.extra.total + data.byType.limited.total) / totalCharacterTargets).toFixed(1)
        : null;
    })(),
    avgPityExcludingFree: charExclFreePityCount > 0
      ? (charExclFreePitySum / charExclFreePityCount).toFixed(1)
      : null
  };

  const limitedChargedPulls = chargedPullsByType.extra + chargedPullsByType.limited;
  const standardChargedPulls = chargedPullsByType.standard;
  const weaponChargedPulls = chargedPullsByType.weapon;

  data.byType.extra.resources = buildResourceSummaryFromAggregates({
    characterPulls: data.byType.extra.total,
    chargedCharacterPulls: chargedPullsByType.extra,
    counts: data.byType.extra.counts,
    arsenalGainCounts: data.byType.extra.counts,
    quotaLedger: extraQuotaLedger
  });
  data.byType.limited.resources = buildResourceSummaryFromAggregates({
    characterPulls: data.byType.limited.total,
    chargedCharacterPulls: chargedPullsByType.limited,
    counts: data.byType.limited.counts,
    arsenalGainCounts: data.byType.limited.counts,
    quotaLedger: limitedQuotaLedger
  });
  data.byType.standard.resources = buildResourceSummaryFromAggregates({
    characterPulls: data.byType.standard.total,
    chargedCharacterPulls: standardChargedPulls,
    counts: data.byType.standard.counts,
    arsenalGainCounts: data.byType.standard.counts,
    quotaLedger: standardQuotaLedger
  });
  data.byType.weapon.resources = buildResourceSummaryFromAggregates({
    weaponPulls: data.byType.weapon.total,
    chargedWeaponPulls: weaponChargedPulls,
    counts: data.byType.weapon.counts,
    arsenalGainCounts: {},
    quotaLedger: weaponQuotaLedger
  });
  data.byType.character.resources = buildResourceSummaryFromAggregates({
    characterPulls: data.byType.character.total,
    chargedCharacterPulls: limitedChargedPulls + standardChargedPulls,
    counts: characterCounts,
    arsenalGainCounts: characterCounts,
    quotaLedger: characterQuotaLedger
  });

  data.byType.limited.pityListExcludingFree = limitedPityListExcludingFree;

  data.avgPity = allSixStarPityCount > 0
    ? (allSixStarPitySum / allSixStarPityCount).toFixed(1)
    : '-';

  data.avgPityExcludingFree = allSixStarExclFreePityCount > 0
    ? (allSixStarExclFreePitySum / allSixStarExclFreePityCount).toFixed(1)
    : '-';

  data.charGift = charGiftCount;
  data.weaponGiftLimited = weaponGiftLimitedCount;
  data.weaponGiftStandard = weaponGiftStandardCount;
  data.giftTotal = charGiftCount + weaponGiftLimitedCount + weaponGiftStandardCount;
  data.totalUsers = user ? 1 : 0;
  data.totalContributors = user ? 1 : 0;
  data.contributorsByRegion = {
    cn: contributorBuckets.has('cn') ? 1 : 0,
    intl: contributorBuckets.has('intl') ? 1 : 0
  };
  data.resources = buildResourceSummaryFromAggregates({
    characterPulls: data.byType.character.total,
    weaponPulls: data.byType.weapon.total,
    chargedCharacterPulls: limitedChargedPulls + standardChargedPulls,
    chargedWeaponPulls: weaponChargedPulls,
    counts: data.counts,
    arsenalGainCounts: characterCounts,
    quotaLedger: allQuotaLedger
  });

  return data;
}

export default buildSummaryStats;
