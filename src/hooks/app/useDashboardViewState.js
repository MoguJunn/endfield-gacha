import { useMemo, useState } from 'react';
import { useAuthStore, usePersonalAnalysisStore, usePoolStore } from '../../stores';
import { getCurrentUpPoolInfo } from '../../utils/poolTimeUtils';
import { getCharacterAvatarUrl } from '../../utils/characterUtils';
import { buildCharacterStats } from '../../utils/dashboardCharacterStats';
import { buildDashboardResourceSummary } from '../../utils/dashboardResourceSummary.js';
import { getPoolFeaturedLead } from '../../utils/poolFeaturedResolver.js';
import { useCurrentPoolData } from './useCurrentPoolData';
import { usePoolStats } from './usePoolStats';
import { readBooleanStorageValue, STORAGE_KEYS, writeBooleanStorageValue } from '../../utils/storageUtils.js';
import { useI18n } from '../../i18n/index.js';

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

export function useDashboardViewState() {
  const { locale } = useI18n();
  const user = useAuthStore(state => state.user);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisScope = usePersonalAnalysisStore((state) => state.scope);
  const [charViewMode, setCharViewMode] = useState('waterfall');
  const [includeFreePullsInStats, setIncludeFreePullsInStatsState] = useState(() => (
    readBooleanStorageValue(STORAGE_KEYS.DASHBOARD_INCLUDE_FREE_PULLS, false, { raw: true })
  ));
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
    groupType
  } = useCurrentPoolData();

  const normalizedPoolType = normalizePoolType(currentPool?.type);
  const isLimited = normalizedPoolType === 'limited';
  const isExtra = normalizedPoolType === 'extra';
  const isWeapon = normalizedPoolType === 'weapon';
  const isStandard = normalizedPoolType === 'standard';
  const maxPity = isWeapon ? 40 : 80;
  const hasPoolData = poolsArray.length > 0;
  const isGroupMode = currentPool?.isGroupMode === true;
  const isAllPoolsOverview = currentPool?.isAllPoolsOverview === true;
  const visibleLimitedPoolIds = useMemo(() => (
    new Set(
      selectedPools
        .filter((pool) => isLimitedPoolType(pool?.type))
        .map((pool) => pool?.id)
        .filter(Boolean)
    )
  ), [selectedPools]);

  const {
    stats: computedStats,
    effectivePity: computedEffectivePity,
    groupedHistory
  } = usePoolStats({
    normalizedCurrentPoolHistory: normalizedPoolHistory,
    currentPool,
    allLimitedHistory,
    currentPoolId: currentPool?.id,
    selectedPools,
    includeFreePullsInStats
  });

  const computedCharacterStats = useMemo(() => (
    buildCharacterStats({
      history: normalizedPoolHistory,
      isLimitedPool: isLimited,
      crossPoolPityMap,
      limitedPoolIds: isGroupMode ? visibleLimitedPoolIds : null,
      includeFreePullsInStats
    })
  ), [crossPoolPityMap, includeFreePullsInStats, isGroupMode, isLimited, normalizedPoolHistory, visibleLimitedPoolIds]);

  const computedCheckLimitedInFirstN = useMemo(() => {
    const sortedHistory = [...normalizedPoolHistory].sort((a, b) => {
      const timeA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
      const timeB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    let pullCount = 0;
    let firstLimitedIndex120 = 0;
    let firstLimitedIndex80 = 0;

    for (const item of sortedHistory) {
      if (item.specialType === 'gift' || item.special_type === 'gift' || item.isFree || item.is_free) {
        continue;
      }

      pullCount++;
      if (item.rarity === 6 && !item.isStandard) {
        if (firstLimitedIndex120 === 0 && pullCount <= 120) firstLimitedIndex120 = pullCount;
        if (firstLimitedIndex80 === 0 && pullCount <= 80) firstLimitedIndex80 = pullCount;
      }
    }

    return { firstLimitedIndex120, firstLimitedIndex80, validPullCount: pullCount };
  }, [normalizedPoolHistory]);

  const computedHasReceivedFreeTen = useMemo(() => {
    return normalizedPoolHistory.some(item => item.isFree || item.is_free);
  }, [normalizedPoolHistory]);

  const analysisScopeAccountKey = String(analysisScope?.account?.accountKey || '').trim();
  const isAnalysisScopeCurrent = !currentGameUid || analysisScopeAccountKey === currentGameUid;
  const snapshotView = isAnalysisScopeCurrent
    && ['ready', 'stale', 'empty'].includes(analysisAvailability)
    ? analysisScope?.dashboard?.views?.[currentPool?.id]
    : null;
  const snapshotVariant = snapshotView?.[
    includeFreePullsInStats ? 'includeFree' : 'excludeFree'
  ] || null;
  const isAnalysisBacked = Boolean(snapshotVariant);
  const stats = isAnalysisBacked && snapshotVariant.stats
    ? snapshotVariant.stats
    : computedStats;
  const effectivePity = isAnalysisBacked && snapshotVariant.effectivePity
    ? snapshotVariant.effectivePity
    : computedEffectivePity;
  const characterStats = isAnalysisBacked && Array.isArray(snapshotVariant.characterStats)
    ? snapshotVariant.characterStats
    : computedCharacterStats;
  const checkLimitedInFirstN = isAnalysisBacked && snapshotVariant.checkLimitedInFirstN
    ? snapshotVariant.checkLimitedInFirstN
    : computedCheckLimitedInFirstN;
  const hasReceivedFreeTen = isAnalysisBacked
    && typeof snapshotVariant.hasReceivedFreeTen === 'boolean'
    ? snapshotVariant.hasReceivedFreeTen
    : computedHasReceivedFreeTen;
  const snapshotSplitOverviewStats = isAnalysisBacked
    ? snapshotVariant.splitOverviewStats ?? null
    : null;
  const snapshotTimelineSections = isAnalysisBacked
    ? analysisScope?.dashboard?.timelineViews?.[locale]?.[currentPool?.id]
      || analysisScope?.dashboard?.timelineViews?.['zh-CN']?.[currentPool?.id]
      || null
    : null;

  const totalCharacterCount = useMemo(() => {
    return characterStats.reduce((sum, char) => sum + char.count, 0);
  }, [characterStats]);

  const weaponGifts = useMemo(() => {
    if (normalizedPoolType !== 'weapon') {
      return null;
    }

    const giftThresholds = [100, 180, 260, 340, 420, 500];
    const paidTotal = stats.paidTotal ?? stats.total;
    let nextGift = 0;
    let nextGiftType = 'standard';
    let standardCount = 0;
    let limitedCount = 0;

    for (const threshold of giftThresholds) {
      if (paidTotal >= threshold) {
        if (threshold === 180 || threshold === 340 || threshold === 500) {
          limitedCount++;
        } else {
          standardCount++;
        }
      }
    }

    for (const threshold of giftThresholds) {
      if (paidTotal < threshold) {
        nextGift = threshold;
        nextGiftType = (threshold === 180 || threshold === 340 || threshold === 500) ? 'limited' : 'standard';
        break;
      }
    }

    if (nextGift === 0 && paidTotal >= 500) {
      const cycle = Math.floor((paidTotal - 180) / 160);
      nextGift = 180 + (cycle + 1) * 160;
      nextGiftType = nextGift % 160 === 20 ? 'limited' : 'standard';
    }

    return { nextGift, nextGiftType, standardCount, limitedCount };
  }, [normalizedPoolType, stats.paidTotal, stats.total]);

  const currentUpPool = useMemo(() => {
    if ((isLimited || isExtra) && currentPool?.start_time && currentPool?.end_time) {
      const now = new Date();
      const start = new Date(currentPool.start_time);
      const end = new Date(currentPool.end_time);
      const isActive = now >= start && now < end;
      const isExpired = now >= end;
      const remainingMs = end - now;

      return {
        name: getPoolFeaturedLead(currentPool),
        isActive,
        isExpired,
        remainingDays: isActive ? Math.floor(remainingMs / (1000 * 60 * 60 * 24)) : 0,
        remainingHours: isActive ? Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) : 0
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

  const computedDashboardResourceSummary = useMemo(() => (
    buildDashboardResourceSummary({
      isAllPoolsOverview,
      pools: selectedPools,
      history: currentPoolHistory,
      includeFreePullsInStats,
      stats: computedStats
    })
  ), [computedStats, currentPoolHistory, includeFreePullsInStats, isAllPoolsOverview, selectedPools]);
  const dashboardResourceSummary = isAnalysisBacked
    && Object.prototype.hasOwnProperty.call(snapshotVariant, 'dashboardResourceSummary')
    ? snapshotVariant.dashboardResourceSummary
    : computedDashboardResourceSummary;

  const resourceSummaryVariant = useMemo(() => {
    if (isAllPoolsOverview) {
      return 'all';
    }

    return normalizedPoolType === 'weapon' ? 'weapon' : 'character';
  }, [isAllPoolsOverview, normalizedPoolType]);

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
    weaponGifts,
    currentUpPool,
    getProgressClass,
    getCharacterAvatar,
    dashboardResourceSummary,
    resourceSummaryVariant,
    isAnalysisBacked,
    snapshotSplitOverviewStats,
    snapshotTimelineSections
  };
}

export default useDashboardViewState;
