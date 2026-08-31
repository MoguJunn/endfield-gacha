import { useMemo, useState } from 'react';
import { useAuthStore, usePersonalAnalysisStore, usePoolStore } from '../../stores';
import { getCurrentUpPoolInfo, getPoolActivityTiming } from '../../utils/poolTimeUtils';
import { getCharacterAvatarUrl } from '../../utils/characterUtils';
import { buildCharacterStats } from '../../utils/dashboardCharacterStats';
import { buildDashboardResourceSummary } from '../../utils/dashboardResourceSummary.js';
import { getPoolFeaturedLead } from '../../utils/poolFeaturedResolver.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { buildScopedPaidHistoryTimeline, isTargetSixStarHistoryRecord } from '../../utils/poolScopedHistory.js';
import { useCurrentPoolData } from './useCurrentPoolData';
import { usePoolStats } from './usePoolStats';
import { readBooleanStorageValue, STORAGE_KEYS, writeBooleanStorageValue } from '../../utils/storageUtils.js';
import { useI18n } from '../../i18n/index.js';
import { resolveEffectiveGameUid } from '../../utils/accountScopeUtils.js';

function normalizePoolType(type) {
  if (type === 'extra') return 'extra';
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'beginner') return 'standard';
  return type;
}

function isLimitedPoolType(type) {
  return type === 'limited' || type === 'limited_character';
}

export function getDashboardPoolViewMeta(pool) {
  const capabilities = resolvePoolCapabilities(pool);
  const normalizedPoolType = normalizePoolType(pool?.type);
  return {
    capabilities,
    normalizedPoolType,
    isLimited: normalizedPoolType === 'limited',
    isExtra: normalizedPoolType === 'extra',
    isWeapon: capabilities.entityType === 'weapon',
    isStandard: capabilities.basePoolType === 'standard',
    maxPity: Number(capabilities.rules?.sixStarPity || 80),
    usesInheritedPity: capabilities.pityScope === 'shared' || capabilities.pityScope === 'series',
    resourceSummaryVariant: capabilities.entityType === 'weapon' ? 'weapon' : 'character',
  };
}

export function buildDashboardSpecialProgress({
  capabilities,
  paidTotal = 0,
  freePullCount = 0,
  targetProgress = null,
} = {}) {
  const normalizedPaidTotal = Math.max(Number(paidTotal) || 0, 0);
  const normalizedFreePullCount = Math.max(Number(freePullCount) || 0, 0);
  return {
    paidTotal: normalizedPaidTotal,
    freeTenMilestones: (capabilities?.freeTenPullMilestones || []).map((threshold, index) => ({
      threshold,
      progress: Math.min(normalizedPaidTotal, threshold),
      reached: normalizedPaidTotal >= threshold,
      received: normalizedFreePullCount >= (index + 1) * 10,
    })),
    targetGuarantee:
      Number(capabilities?.rules?.guaranteedLimitedPity || 0) > 0
        ? {
            threshold: Number(capabilities.rules.guaranteedLimitedPity),
            progress: Math.min(
              Number(targetProgress?.validPullCount ?? normalizedPaidTotal) || 0,
              Number(capabilities.rules.guaranteedLimitedPity)
            ),
            reached: Number(targetProgress?.firstTargetIndex || 0) > 0,
          }
        : null,
    giftInterval: Number(capabilities?.rules?.giftInterval || 0),
  };
}

export function useDashboardViewState() {
  const { locale } = useI18n();
  const user = useAuthStore((state) => state.user);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisOwnerAccounts = usePersonalAnalysisStore((state) => state.owner?.accounts);
  const analysisScope = usePersonalAnalysisStore((state) => state.scope);
  const [charViewMode, setCharViewMode] = useState('waterfall');
  const [includeFreePullsInStats, setIncludeFreePullsInStatsState] = useState(() =>
    readBooleanStorageValue(STORAGE_KEYS.DASHBOARD_INCLUDE_FREE_PULLS, false, { raw: true })
  );
  const setIncludeFreePullsInStats = (valueOrUpdater) => {
    setIncludeFreePullsInStatsState((current) => {
      const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater;
      writeBooleanStorageValue(STORAGE_KEYS.DASHBOARD_INCLUDE_FREE_PULLS, next, { raw: true });
      return next;
    });
  };

  const {
    poolsArray,
    selectedPools,
    annotatedAccountHistoryArray,
    currentPool,
    currentPoolHistory,
    normalizedCurrentPoolHistory: normalizedPoolHistory,
    allLimitedHistory,
    crossPoolPityMap,
    hasMergedAccountView,
    groupType,
  } = useCurrentPoolData();

  const poolViewMeta = useMemo(() => getDashboardPoolViewMeta(currentPool), [currentPool]);
  const {
    capabilities: currentPoolCapabilities,
    normalizedPoolType,
    isLimited,
    isExtra,
    isWeapon,
    isStandard,
    maxPity,
    usesInheritedPity,
  } = poolViewMeta;
  const hasPoolData = poolsArray.length > 0;
  const isGroupMode = currentPool?.isGroupMode === true;
  const isAllPoolsOverview = currentPool?.isAllPoolsOverview === true;
  const usesLimitedCharacterStats =
    currentPoolCapabilities.basePoolType === 'limited' && currentPoolCapabilities.entityType === 'character';
  const visibleLimitedPoolIds = useMemo(
    () =>
      new Set(
        selectedPools
          .filter((pool) => {
            const capabilities = resolvePoolCapabilities(pool);
            return (
              isLimitedPoolType(pool?.type) ||
              (capabilities.basePoolType === 'limited' && capabilities.entityType === 'character')
            );
          })
          .map((pool) => pool?.id)
          .filter(Boolean)
      ),
    [selectedPools]
  );

  const {
    stats: computedStats,
    effectivePity: computedEffectivePity,
    groupedHistory,
  } = usePoolStats({
    normalizedCurrentPoolHistory: normalizedPoolHistory,
    currentPool,
    allLimitedHistory,
    accountHistory: annotatedAccountHistoryArray,
    poolCatalog: poolsArray,
    currentPoolId: currentPool?.id,
    selectedPools,
    includeFreePullsInStats,
  });

  const computedCharacterStats = useMemo(
    () =>
      buildCharacterStats({
        history: normalizedPoolHistory,
        isLimitedPool: usesLimitedCharacterStats,
        crossPoolPityMap,
        limitedPoolIds: isGroupMode ? visibleLimitedPoolIds : null,
        includeFreePullsInStats,
      }),
    [
      crossPoolPityMap,
      includeFreePullsInStats,
      isGroupMode,
      normalizedPoolHistory,
      usesLimitedCharacterStats,
      visibleLimitedPoolIds,
    ]
  );

  const computedCheckLimitedInFirstN = useMemo(() => {
    const poolLookup = new Map(
      poolsArray
        .flatMap((pool) => [pool?.id, pool?.pool_id].map((poolId) => [String(poolId || ''), pool]))
        .filter(([poolId]) => Boolean(poolId))
    );
    const targetTimeline = isGroupMode
      ? normalizedPoolHistory.filter(
          (item) =>
            item?.specialType !== 'gift' &&
            item?.special_type !== 'gift' &&
            item?.isFree !== true &&
            item?.is_free !== true
        )
      : buildScopedPaidHistoryTimeline({
          history: annotatedAccountHistoryArray,
          pools: poolsArray,
          pool: currentPool,
          scopeType: 'target',
        });
    let firstTargetIndex = 0;

    for (let index = 0; index < targetTimeline.length; index += 1) {
      const item = targetTimeline[index];
      const sourcePool = poolLookup.get(String(item?.poolId || item?.pool_id || '')) || currentPool;
      if (isTargetSixStarHistoryRecord(item, sourcePool)) {
        firstTargetIndex = index + 1;
        break;
      }
    }

    return {
      firstTargetIndex,
      firstLimitedIndex120: firstTargetIndex > 0 && firstTargetIndex <= 120 ? firstTargetIndex : 0,
      firstLimitedIndex80: firstTargetIndex > 0 && firstTargetIndex <= 80 ? firstTargetIndex : 0,
      validPullCount: targetTimeline.length,
    };
  }, [annotatedAccountHistoryArray, currentPool, isGroupMode, normalizedPoolHistory, poolsArray]);

  const analysisScopeAccountKey = String(analysisScope?.account?.accountKey || '').trim();
  const effectiveAnalysisAccountKey = useMemo(
    () =>
      resolveEffectiveGameUid({
        currentGameUid,
        gameAccounts: analysisOwnerAccounts,
      }),
    [analysisOwnerAccounts, currentGameUid]
  );
  const isAnalysisScopeCurrent =
    !effectiveAnalysisAccountKey || analysisScopeAccountKey === effectiveAnalysisAccountKey;
  const analysisViewKey = String(currentPoolId || currentPool?.id || '').trim();
  const snapshotView =
    isAnalysisScopeCurrent && ['ready', 'stale', 'empty'].includes(analysisAvailability)
      ? analysisScope?.dashboard?.views?.[analysisViewKey]
      : null;
  const snapshotVariant = snapshotView?.[includeFreePullsInStats ? 'includeFree' : 'excludeFree'] || null;
  const isAnalysisBacked = Boolean(snapshotVariant);
  const stats = isAnalysisBacked && snapshotVariant.stats ? snapshotVariant.stats : computedStats;
  const effectivePity =
    isAnalysisBacked && snapshotVariant.effectivePity ? snapshotVariant.effectivePity : computedEffectivePity;
  const characterStats =
    isAnalysisBacked && Array.isArray(snapshotVariant.characterStats)
      ? snapshotVariant.characterStats
      : computedCharacterStats;
  const checkLimitedInFirstN =
    isAnalysisBacked && snapshotVariant.checkLimitedInFirstN
      ? snapshotVariant.checkLimitedInFirstN
      : computedCheckLimitedInFirstN;
  const hasReceivedFreeTen = isAnalysisBacked
    && Object.prototype.hasOwnProperty.call(snapshotVariant, 'hasReceivedFreeTen')
    ? Boolean(snapshotVariant.hasReceivedFreeTen)
    : Number(stats.rewardFreePullCount ?? stats.freePullCount ?? 0) > 0;
  const snapshotSplitOverviewStats = isAnalysisBacked ? (snapshotVariant.splitOverviewStats ?? null) : null;
  const snapshotOverviewCharacterStats = isAnalysisBacked
    && snapshotVariant.overviewCharacterStats
    && typeof snapshotVariant.overviewCharacterStats === 'object'
    ? snapshotVariant.overviewCharacterStats
    : null;
  const snapshotTimelineSections = isAnalysisBacked
    ? analysisScope?.dashboard?.timelineViews?.[locale]?.[analysisViewKey] ||
      analysisScope?.dashboard?.timelineViews?.['zh-CN']?.[analysisViewKey] ||
      null
    : null;

  const totalCharacterCount = useMemo(() => {
    return characterStats.reduce((sum, char) => sum + char.count, 0);
  }, [characterStats]);

  const specialProgress = useMemo(
    () =>
      buildDashboardSpecialProgress({
        capabilities: currentPoolCapabilities,
        paidTotal: stats.rewardPaidTotal ?? stats.paidTotal ?? stats.total,
        freePullCount: stats.rewardFreePullCount ?? stats.freePullCount,
        targetProgress: checkLimitedInFirstN,
      }),
    [
      checkLimitedInFirstN,
      currentPoolCapabilities,
      stats.freePullCount,
      stats.paidTotal,
      stats.rewardFreePullCount,
      stats.rewardPaidTotal,
      stats.total,
    ]
  );

  const weaponGifts = useMemo(() => {
    if (!isWeapon) {
      return null;
    }

    const paidTotal = stats.rewardPaidTotal ?? stats.paidTotal ?? stats.total;
    const firstStandardGift = Number(currentPoolCapabilities.rules?.firstStandardGift || 0);
    const firstLimitedGift = Number(currentPoolCapabilities.rules?.firstLimitedGift || 0);
    const interval = Number(currentPoolCapabilities.rules?.giftAlternateInterval || 0);
    let nextGift = paidTotal < firstStandardGift ? firstStandardGift : firstLimitedGift;
    let nextGiftType = paidTotal < firstStandardGift ? 'standard' : 'limited';
    if (firstLimitedGift > 0 && paidTotal >= firstLimitedGift && interval > 0) {
      const completedIntervals = Math.floor((paidTotal - firstLimitedGift) / interval);
      nextGift = firstLimitedGift + (completedIntervals + 1) * interval;
      nextGiftType = completedIntervals % 2 === 0 ? 'standard' : 'limited';
    }

    return {
      nextGift,
      nextGiftType,
      standardCount: stats.gifts?.standardCount || 0,
      limitedCount: stats.gifts?.limitedCount || 0,
    };
  }, [currentPoolCapabilities.rules, isWeapon, stats.gifts, stats.paidTotal, stats.rewardPaidTotal, stats.total]);

  const currentUpPool = useMemo(() => {
    if ((isLimited || isExtra) && currentPool?.start_time && currentPool?.end_time) {
      const timing = getPoolActivityTiming(currentPool);

      return {
        name: getPoolFeaturedLead(currentPool),
        ...timing,
        remainingDays: timing.days,
        remainingHours: timing.hours,
        remainingMinutes: timing.minutes,
        startsIn: timing.days,
        startsInHours: timing.hours,
        startsInMinutes: timing.minutes,
      };
    }

    return getCurrentUpPoolInfo(poolsArray);
  }, [currentPool, isExtra, isLimited, poolsArray]);

  const getProgressClass = () => {
    if (isLimited) return 'rainbow-progress';
    if (isExtra) return 'bg-cyan-500';
    if (isWeapon) return 'bg-slate-500';
    return 'bg-amber-500';
  };

  const getCharacterAvatar = (name) => {
    return getCharacterAvatarUrl(name);
  };

  const computedDashboardResourceSummary = useMemo(
    () =>
      buildDashboardResourceSummary({
        isAllPoolsOverview,
        pools: selectedPools,
        history: currentPoolHistory,
        includeFreePullsInStats,
        stats: computedStats,
      }),
    [computedStats, currentPoolHistory, includeFreePullsInStats, isAllPoolsOverview, selectedPools]
  );
  const dashboardResourceSummary =
    isAnalysisBacked && Object.prototype.hasOwnProperty.call(snapshotVariant, 'dashboardResourceSummary')
      ? snapshotVariant.dashboardResourceSummary
      : computedDashboardResourceSummary;

  const resourceSummaryVariant = useMemo(() => {
    if (isAllPoolsOverview) {
      return 'all';
    }

    if (isGroupMode) {
      const entityTypes = new Set(
        selectedPools
          .map((pool) => resolvePoolCapabilities(pool).entityType)
          .filter((entityType) => entityType === 'character' || entityType === 'weapon')
      );
      if (entityTypes.has('character') && entityTypes.has('weapon')) {
        return 'all';
      }
      if (entityTypes.has('weapon')) {
        return 'weapon';
      }
    }

    return poolViewMeta.resourceSummaryVariant;
  }, [isAllPoolsOverview, isGroupMode, poolViewMeta.resourceSummaryVariant, selectedPools]);

  return {
    user,
    charViewMode,
    setCharViewMode,
    includeFreePullsInStats,
    setIncludeFreePullsInStats,
    poolsArray,
    selectedPools,
    accountHistory: annotatedAccountHistoryArray,
    currentPool,
    currentPoolHistory,
    normalizedPoolHistory,
    allLimitedHistory,
    crossPoolPityMap,
    hasMergedAccountView,
    normalizedPoolType,
    isLimited,
    isExtra,
    isWeapon,
    isStandard,
    isAllPoolsOverview,
    maxPity,
    usesInheritedPity,
    hasPoolData,
    isGroupMode,
    groupType,
    stats,
    effectivePity,
    groupedHistory,
    characterStats,
    totalCharacterCount,
    checkLimitedInFirstN,
    hasReceivedFreeTen,
    specialProgress,
    weaponGifts,
    currentUpPool,
    getProgressClass,
    getCharacterAvatar,
    dashboardResourceSummary,
    resourceSummaryVariant,
    isAnalysisBacked,
    snapshotSplitOverviewStats,
    snapshotOverviewCharacterStats,
    snapshotTimelineSections,
  };
}

export default useDashboardViewState;
