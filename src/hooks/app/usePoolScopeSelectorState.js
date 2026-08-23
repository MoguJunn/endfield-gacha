import { useEffect, useMemo } from 'react';
import {
  useAuthStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePoolStore,
} from '../../stores/index.js';
import { buildPoolSelectorGroups } from '../../utils/poolSelectorDisplay.js';
import {
  filterHistoryForEffectiveGameUid,
  resolveEffectiveGameUid,
} from '../../utils/accountScopeUtils.js';
import { getPreferredPool } from '../../utils/poolSelectionUtils.js';
import { isPoolGroupId } from '../../stores/usePoolStore.js';

/** Shared account/pool scope projection for desktop and mobile selectors. */
export function usePoolScopeSelectorState({
  locale,
  searchQuery = '',
  hideZeroPullPools = true,
} = {}) {
  const user = useAuthStore((state) => state.user);
  const pools = usePoolStore((state) => state.pools);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const switchPool = usePoolStore((state) => state.switchPool);
  const switchToPoolGroup = usePoolStore((state) => state.switchToPoolGroup);
  const switchGameAccount = usePoolStore((state) => state.switchGameAccount);
  const history = useHistoryStore((state) => state.history);
  const getGameAccountsFromHistory = useHistoryStore((state) => state.getGameAccountsFromHistory);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisOwner = usePersonalAnalysisStore((state) => state.owner);
  const analysisScope = usePersonalAnalysisStore((state) => state.scope);
  const hasAnalysisSnapshot = ['ready', 'stale', 'empty'].includes(analysisAvailability);
  const poolsArray = useMemo(() => (Array.isArray(pools) ? pools : []), [pools]);
  const historyArray = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const gameAccounts = useMemo(() => {
    if (hasAnalysisSnapshot && Array.isArray(analysisOwner?.accounts)) {
      return analysisOwner.accounts;
    }
    void history;
    return getGameAccountsFromHistory();
  }, [analysisOwner, getGameAccountsFromHistory, hasAnalysisSnapshot, history]);
  const effectiveGameUid = useMemo(() => resolveEffectiveGameUid({
    currentGameUid,
    gameAccounts,
    historyRecords: historyArray,
  }), [currentGameUid, gameAccounts, historyArray]);
  const filteredHistory = useMemo(
    () => filterHistoryForEffectiveGameUid(historyArray, effectiveGameUid),
    [effectiveGameUid, historyArray]
  );
  const historyPoolPullCounts = useMemo(() => filteredHistory.reduce((counts, item) => {
    const poolId = item.poolId || item.pool_id;
    if (poolId) {
      counts[poolId] = (counts[poolId] || 0) + 1;
    }
    return counts;
  }, {}), [filteredHistory]);
  const poolPullCounts = useMemo(() => {
    const snapshotCounts = analysisScope?.selector?.poolPullCounts;
    const snapshotAccountKey = String(analysisScope?.account?.accountKey || '').trim();
    if (
      hasAnalysisSnapshot
      && snapshotAccountKey
      && snapshotAccountKey === effectiveGameUid
      && snapshotCounts
      && typeof snapshotCounts === 'object'
    ) {
      return snapshotCounts;
    }
    return historyPoolPullCounts;
  }, [analysisScope, effectiveGameUid, hasAnalysisSnapshot, historyPoolPullCounts]);
  const zeroPullPoolCount = useMemo(
    () => poolsArray.filter((pool) => (poolPullCounts[pool.id] || 0) === 0).length,
    [poolPullCounts, poolsArray]
  );
  const selectorPools = useMemo(() => poolsArray.filter((pool) => (
    !hideZeroPullPools
    || (poolPullCounts[pool.id] || 0) > 0
    || pool.id === currentPoolId
  )), [currentPoolId, hideZeroPullPools, poolPullCounts, poolsArray]);
  const groupedPools = useMemo(() => buildPoolSelectorGroups({
    pools: selectorPools,
    poolPullCounts,
    searchQuery,
    locale,
  }), [locale, poolPullCounts, searchQuery, selectorPools]);
  const totalPulls = hasAnalysisSnapshot
    && analysisScope?.account?.accountKey === effectiveGameUid
    && Number.isFinite(Number(analysisScope?.selector?.totalPulls))
    ? Number(analysisScope.selector.totalPulls)
    : Object.values(poolPullCounts).reduce((total, count) => total + count, 0);
  const showOverviewOptions = Boolean(effectiveGameUid);

  useEffect(() => {
    if (effectiveGameUid && currentGameUid !== effectiveGameUid) {
      switchGameAccount(effectiveGameUid);
    }
  }, [currentGameUid, effectiveGameUid, switchGameAccount]);

  useEffect(() => {
    if (showOverviewOptions || !isPoolGroupId(currentPoolId)) {
      return;
    }
    const fallbackPool = getPreferredPool(poolsArray, {
      preferredPoolId: null,
      includeDefaultPool: true,
    });
    if (fallbackPool?.id) {
      switchPool(fallbackPool.id);
    }
  }, [currentPoolId, poolsArray, showOverviewOptions, switchPool]);

  return {
    user,
    pools: poolsArray,
    history: historyArray,
    currentPoolId,
    currentGameUid,
    switchPool,
    switchToPoolGroup,
    switchGameAccount,
    gameAccounts,
    effectiveGameUid,
    filteredHistory,
    poolPullCounts,
    zeroPullPoolCount,
    selectorPools,
    groupedPools,
    totalPulls,
    showOverviewOptions,
  };
}

export default usePoolScopeSelectorState;
