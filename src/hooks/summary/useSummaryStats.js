import { useMemo } from 'react';
import { RARITY_CONFIG, EXTRA_POOL_RULES, LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';
import { buildResourceSummaryFromAggregates } from '../../utils/resourceEconomy.js';
import { buildQuotaLedgerFromHistory } from '../../utils/quotaEconomy.js';
import { annotateInfoBookPulls, isInfoBookHistoryPull } from '../../utils/historyInfoBook.js';
import { classifyGameAccountRegionBucket } from '../../utils/gameAccountMetadata.js';
import { characterCache } from '../../utils/characterUtils.js';
import { getHardPityFloor } from '../../utils/forcedUpDetection.js';

const PITY_LIMITS = {
  extra: EXTRA_POOL_RULES.sixStarPity,
  limited: LIMITED_POOL_RULES.sixStarPity,
  standard: LIMITED_POOL_RULES.sixStarPity,
  weapon: WEAPON_POOL_RULES.sixStarPity
};

const _localStatsModuleCache = { key: null, result: null };

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

/**
 * 从桶计数器生成分布数组
 * @param {Object} buckets - 桶计数器 { [bucketIndex]: { limited, standard, guaranteed? } }
 * @param {number} hardPityLimit - 池型保底上限（角色80，武器40），分布不会超出此范围
 */
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
 * 统计数据计算 Hook
 * 计算本地用户的抽卡统计数据
 *
 * @param {Array} history - 抽卡历史记录
 * @param {Array} pools - 卡池列表
 * @param {Object|null} user - 当前用户
 * @returns {Object} 统计数据
 */
export function useSummaryStats(history, pools, user) {
  // 过滤当前用户的卡池和历史记录
  const myPools = useMemo(() => {
    if (!pools) return [];
    if (!user) return [];
    return pools;
  }, [pools, user]);

  const myHistory = useMemo(() => {
    if (!history) return [];
    if (!user) return [];
    return history.filter(h => h.user_id === user.id);
  }, [history, user]);
  const annotatedMyHistory = useMemo(
    () => annotateInfoBookPulls(myHistory, myPools),
    [myHistory, myPools]
  );

  // 归一化 myHistory 的 isStandard（基于 UP 角色匹配重新计算）
  const normalizedMyHistory = useMemo(() => {
    const poolMap = new Map();
    myPools.forEach(p => {
      [p.id, p.pool_id].forEach((poolId) => {
        if (poolId) {
          poolMap.set(poolId, { type: p.type, upCharacter: p.up_character });
        }
      });
    });

    return annotatedMyHistory.map(h => {
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
  }, [annotatedMyHistory, myPools]);

  // 计算当前用户统计数据
  // PERF-009: 合并多次全量遍历为 2 次（分组+计数 → 分池保底计算），
  //           分布图改桶计数 O(n)，消除 chargedPulls 的 3 次独立 filter
  const localStats = useMemo(() => {
    const cacheKey = user?.id
      ? `${user.id}:${normalizedMyHistory.length}:${myPools.length}`
      : null;

    if (cacheKey && cacheKey === _localStatsModuleCache.key && _localStatsModuleCache.result) {
      return _localStatsModuleCache.result;
    }

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

    // ── Phase 1: 单次遍历 normalizedMyHistory ──
    // 同时完成：按池分组、全局/池型计数、chargedPulls、region bucket
    const pullsByPool = {};
    const chargedPullsByType = { extra: 0, limited: 0, weapon: 0, standard: 0 };
    const contributorBuckets = new Set();

    for (let i = 0; i < normalizedMyHistory.length; i++) {
      const item = normalizedMyHistory[i];
      const poolId = item.poolId || item.pool_id;

      // 按池分组
      if (!pullsByPool[poolId]) pullsByPool[poolId] = [];
      pullsByPool[poolId].push(item);

      const isGift = isGiftPull(item);
      const isFree = isFreePull(item);

      // gift 和免费十连不计入任何统计
      if (isGift || isFree) continue;

      const rawType = poolTypeMap.get(poolId) || 'standard';
      const type = normalizePoolType(rawType);
      const typeData = data.byType[type];
      if (!typeData) continue;

      // 总计数
      data.total++;
      typeData.total++;

      // chargedPulls（排除 gift + free + 情报书）
      if (type === 'limited' || type === 'extra') {
        if (!isInfoBookHistoryPull(item)) chargedPullsByType[type]++;
      } else if (type === 'weapon') {
        chargedPullsByType.weapon++;
      } else {
        chargedPullsByType.standard++;
      }

      // 地区 bucket
      const bucket = classifyGameAccountRegionBucket({
        serverId: item.serverId || item.server_id,
        region: item.region || item.serverRegion
      });
      if (bucket) contributorBuckets.add(bucket);

      // 稀有度计数
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
      characters: characterCache.getAll()
    });
    const characterQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
      pools: myPools,
      characters: characterCache.getAll(),
      includePoolTypes: ['extra', 'limited', 'standard']
    });
    const extraQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
      pools: myPools,
      characters: characterCache.getAll(),
      includePoolTypes: ['extra']
    });
    const limitedQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
      pools: myPools,
      characters: characterCache.getAll(),
      includePoolTypes: ['limited']
    });
    const standardQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
      pools: myPools,
      characters: characterCache.getAll(),
      includePoolTypes: ['standard']
    });
    const weaponQuotaLedger = buildQuotaLedgerFromHistory(normalizedMyHistory, {
      pools: myPools,
      characters: characterCache.getAll(),
      includePoolTypes: ['weapon']
    });

    // ── Phase 2: 按池独立计算保底/区间/赠送/分布 ──
    // 每个池独立追踪保底计数器，与时间线视图一致
    const upCountByType = { extra: 0, limited: 0, weapon: 0 };
    // 各池型硬保底强制 UP（吃井/spark）次数；用于「吃井次数」展示及真不歪率剔除
    const sparkCountByType = { extra: 0, limited: 0, weapon: 0, standard: 0 };

    const globalDistBuckets = {};
    const typeDistBuckets = { extra: {}, limited: {}, weapon: {}, standard: {} };

    let limitedNonFreeNonSparkCount = 0;
    let limitedNonFreeCount = 0;
    let allSixStarPityCount = 0;
    let allSixStarExclFreePityCount = 0;
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
      let cumulativePullCount = 0;
      let hasGotUpBefore = false;

      for (let j = 0; j < sortedPulls.length; j++) {
        const pull = sortedPulls[j];
        if (isGiftPull(pull) || isFreePull(pull)) continue;

        const isFree = pull.isFree || pull.is_free;
        tempCounter++;
        cumulativePullCount++;

        if (pull.rarity === 6) {
          const isUp = isTargetSixStarByPoolType(pull, type);
          // 硬保底强制 UP（spark）：限定 120 / 武器第 8 申领（71~80）。阈值取自 forcedUpDetection。
          const hardPityFloor = getHardPityFloor(type);
          let isSpark = false;
          if (isUp && !hasGotUpBefore && Number.isFinite(hardPityFloor) && cumulativePullCount >= hardPityFloor) {
            isSpark = true;
          }
          if (isUp && Number.isFinite(hardPityFloor) && cumulativePullCount < hardPityFloor) {
            hasGotUpBefore = true;
          }

          if (isSpark && sparkCountByType[type] !== undefined) sparkCountByType[type]++;

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

          if (type === 'limited') {
            if (!isFree && !isSpark) {
              limitedNonFreeNonSparkCount++;
            }
            if (!isFree) {
              limitedNonFreeCount++;
            }
          }

          if (!isFree) {
            allSixStarExclFreePityCount++;
          }

          data.byType[type].pityList.push({
            count: tempCounter,
            isStandard: !isUp,
            isFree: isFree,
            isSpark
          });

          // 硬保底强制 UP 不计入「排除保底」的 UP 均值分母（与卡池分析页同口径）
          if (type === 'extra') {
            if (!isSpark) upCountByType.extra++;
          } else if ((type === 'limited' || type === 'weapon') && matchesPoolTarget(pull, poolMeta)) {
            if (!isSpark && upCountByType[type] !== undefined) upCountByType[type]++;
          }
          tempCounter = 0;
        }
      }
    }

    // ── Phase 3: 汇总 ──

    // 饼图
    data.chartData = generatePieData(data.counts);

    // 池型汇总
    ['extra', 'limited', 'weapon', 'standard'].forEach(t => {
      data.byType[t].distribution = buildDistFromBuckets(typeDistBuckets[t], PITY_LIMITS[t]);
      data.byType[t].chartData = generatePieData(data.byType[t].counts);
      data.byType[t].sparkCount = sparkCountByType[t] || 0;
      if (data.byType[t].six > 0) {
        // 「全部6★ 抽/个」= 该池型总抽 / 6★ 总数（与字段标签「抽/个」及 UP 均值口径 total/count 一致）
        data.byType[t].avgPity = (data.byType[t].total / data.byType[t].six).toFixed(1);
      }
      if (t === 'limited') {
        if (limitedNonFreeNonSparkCount > 0) {
          // 排除保底(spark)的平均出货：池总抽 / 非保底6★数（与 avgPity 同口径 total/count）
          data.byType[t].avgPityExcludingFree = (data.byType[t].total / limitedNonFreeNonSparkCount).toFixed(1);
        }
        if (limitedNonFreeCount > 0) {
          // 含保底的平均出货：池总抽 / 全部6★数（total/count，等同 avgPity）
          data.byType[t].avgPityWithSpark = (data.byType[t].total / limitedNonFreeCount).toFixed(1);
        }
      }
    });

    // BUG-035: UP 平均出货 = 池总抽 / UP 6★ 数（分母已排除硬保底强制 UP，与卡池分析页同口径）
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

    // 全局分布（使用角色池保底上限，因为它是所有池中最高的）
    if (allSixStarPityCount > 0) {
      data.pityStats.distribution = buildDistFromBuckets(globalDistBuckets, PITY_LIMITS.limited);
    }

    // 角色池合并数据
    const characterCounts = {
      6: data.byType.extra.counts[6] + data.byType.limited.counts[6] + data.byType.standard.counts[6],
      '6_std': data.byType.extra.counts['6_std'] + data.byType.limited.counts['6_std'] + data.byType.standard.counts['6_std'],
      5: data.byType.extra.counts[5] + data.byType.limited.counts[5] + data.byType.standard.counts[5],
      4: data.byType.extra.counts[4] + data.byType.limited.counts[4] + data.byType.standard.counts[4]
    };

    // 合并角色分布桶
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

    const characterTotalPulls = data.byType.extra.total + data.byType.limited.total + data.byType.standard.total;
    const characterSixCount = data.byType.extra.six + data.byType.limited.six + data.byType.standard.six;

    const charExclFreePityCount = characterPityListExcludingFree.length;

    data.byType.character = {
      total: data.byType.extra.total + data.byType.limited.total + data.byType.standard.total,
      six: data.byType.extra.six + data.byType.limited.six + data.byType.standard.six,
      limitedSix: data.byType.extra.limitedSix + data.byType.limited.limitedSix,
      sparkCount: sparkCountByType.extra + sparkCountByType.limited + sparkCountByType.standard,
      counts: characterCounts,
      pityList: characterPityList,
      pityListExcludingFree: characterPityListExcludingFree,
      distribution: buildDistFromBuckets(charDistBuckets, PITY_LIMITS.limited),
      chartData: generatePieData(characterCounts),
      avgPity: characterSixCount > 0
        ? (characterTotalPulls / characterSixCount).toFixed(1)
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
        ? (characterTotalPulls / charExclFreePityCount).toFixed(1)
        : null
    };

    // 资源
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

    data.avgPity = data.sixStar > 0
      ? (data.total / data.sixStar).toFixed(1)
      : '-';

    data.avgPityExcludingFree = allSixStarExclFreePityCount > 0
      ? (data.total / allSixStarExclFreePityCount).toFixed(1)
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

    if (cacheKey) {
      _localStatsModuleCache.key = cacheKey;
      _localStatsModuleCache.result = data;
    }

    return data;
  }, [normalizedMyHistory, myPools, user]);

  return localStats;
}

export default useSummaryStats;
