import { useMemo } from 'react';
import { buildPoolStats } from '../../utils/poolStats.js';
import { useCurrentPoolGroupedHistory } from './useCurrentPoolGroupedHistory.js';

/**
 * 卡池统计 Hook
 * 处理统计计算逻辑：stats、groupedHistory、filteredGroupedHistory、effectivePity 等
 */
export function usePoolStats({
  normalizedCurrentPoolHistory,
  currentPool,
  allLimitedHistory = [],
  currentPoolId = currentPool?.id,
  selectedPools = [],
  includeFreePullsInStats = false
}) {
  const {
    groupedHistory,
    filteredGroupedHistory
  } = useCurrentPoolGroupedHistory(normalizedCurrentPoolHistory);

  const {
    stats,
    inheritedPityInfo,
    effectivePity
  } = useMemo(() => buildPoolStats({
    normalizedCurrentPoolHistory,
    currentPool,
    allLimitedHistory,
    currentPoolId,
    selectedPools,
    includeFreePullsInStats
  }), [
    allLimitedHistory,
    currentPool,
    currentPoolId,
    includeFreePullsInStats,
    normalizedCurrentPoolHistory,
    selectedPools
  ]);

  return {
    groupedHistory,
    filteredGroupedHistory,
    stats,
    inheritedPityInfo,
    effectivePity
  };
}

export default usePoolStats;
