import { useMemo } from 'react';
import { DEFAULT_POOL_ID } from '../../constants';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../stores';
import { getPoolsForGroupType, isPoolGroupId, parsePoolGroupId } from '../../stores/usePoolStore';
import { isFreeHistoryPull } from '../../utils/historyInfoBook';
import { normalizeIsStandard } from '../../utils/poolUtils.js';
import { getPreferredPool } from '../../utils/poolSelectionUtils';
import { buildPoolSelectorGroups, getPoolTypeLabel } from '../../utils/poolSelectorDisplay';
import { getCachedHistoryIndex } from '../../utils/historyIndex.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { buildPaidTimelinePityMap, buildScopedPaidHistoryTimeline } from '../../utils/poolScopedHistory.js';
import { useI18n } from '../../i18n/index.js';
import { usePoolRoster } from './usePoolRoster.js';

function getPoolId(pool) {
  return pool?.id || pool?.pool_id || null;
}

function getHistoryPoolId(item) {
  return item.poolId || item.pool_id || null;
}

function getHistoryRecordKey(item) {
  const value = item?.id || item?.record_id || null;
  return value == null ? null : String(value);
}

function normalizePoolId(value) {
  if (value == null) {
    return '';
  }

  return String(value).trim();
}

export function selectPoolsForRosterScope({ pools = [], currentPoolId = null, locale } = {}) {
  const poolsArray = Array.isArray(pools) ? pools : [];
  const groupMode = isPoolGroupId(currentPoolId);
  const groupScope = groupMode ? parsePoolGroupId(currentPoolId) : null;

  if (groupMode) {
    const orderedGroups = buildPoolSelectorGroups({ pools: poolsArray, locale });
    if (groupScope?.type === 'all') {
      return orderedGroups.flatMap((group) => group.pools);
    }

    const targetGroup = orderedGroups.find((group) => group.type === groupScope?.type);
    if (groupScope?.subtype) {
      return (
        targetGroup?.subgroups?.find((subgroup) => subgroup.subtype === groupScope.subtype)?.pools ||
        getPoolsForGroupType(poolsArray, groupScope.type, groupScope.subtype)
      );
    }

    return targetGroup?.pools || getPoolsForGroupType(poolsArray, groupScope?.type);
  }

  const preferredPool = getPreferredPool(poolsArray, {
    preferredPoolId: currentPoolId,
    includeDefaultPool: true,
  });
  return preferredPool ? [preferredPool] : [];
}

function normalizeHistoryStandardForPool(item, pool) {
  const capabilities = resolvePoolCapabilities(pool);
  if (Number(item?.rarity) !== 6) {
    return false;
  }
  if (capabilities.targetMode === 'four-target-equal') {
    return false;
  }
  if (!capabilities.isResolved || capabilities.targetMode === 'none') {
    return true;
  }
  return normalizeIsStandard(item, capabilities.basePoolType, pool?.up_character || pool?.upCharacter);
}

function getCommonCapabilityValue(pools, key) {
  const values = new Set(pools.map((pool) => resolvePoolCapabilities(pool)?.[key]).filter(Boolean));
  return values.size === 1 ? Array.from(values)[0] : null;
}

export function useCurrentPoolData() {
  const { locale, t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const pools = usePoolStore((state) => state.pools);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const history = useHistoryStore((state) => state.history);

  const rawPoolsArray = useMemo(() => (Array.isArray(pools) ? pools : []), [pools]);
  const historyIndex = useMemo(
    () =>
      getCachedHistoryIndex({
        history,
        pools: rawPoolsArray,
        userId: user?.id || null,
        currentGameUid,
      }),
    [currentGameUid, history, rawPoolsArray, user?.id]
  );
  const { historyArray, annotatedAccountHistoryArray, sortedAccountHistoryArray, historyByPoolId } = historyIndex;
  const hasMergedAccountView = false;

  const isGroupMode = isPoolGroupId(currentPoolId);
  const groupScope = isGroupMode ? parsePoolGroupId(currentPoolId) : null;
  const groupType = groupScope?.type || null;
  const groupSubtype = groupScope?.subtype || null;
  const selectedScopePools = useMemo(
    () =>
      selectPoolsForRosterScope({
        pools: rawPoolsArray,
        currentPoolId,
        locale,
      }),
    [currentPoolId, locale, rawPoolsArray]
  );
  const rosterScopePools = useMemo(
    () =>
      selectedScopePools.flatMap((pool) => {
        const capabilities = resolvePoolCapabilities(pool);
        if (!capabilities.isResolved || capabilities.entityType === 'unknown') {
          return [];
        }
        return [
          {
            ...pool,
            type: capabilities.basePoolType,
          },
        ];
      }),
    [selectedScopePools]
  );
  const poolRosterById = usePoolRoster({
    pools: rosterScopePools,
    enabled: rosterScopePools.length > 0,
  });
  const selectedPools = useMemo(
    () =>
      selectedScopePools.map((pool) => {
        const rosterMeta = poolRosterById.get(normalizePoolId(getPoolId(pool)));
        return rosterMeta ? { ...pool, resolved_roster: rosterMeta.roster } : pool;
      }),
    [poolRosterById, selectedScopePools]
  );
  const poolsArray = useMemo(
    () =>
      rawPoolsArray.map((pool) => {
        const rosterMeta = poolRosterById.get(normalizePoolId(getPoolId(pool)));
        return rosterMeta ? { ...pool, resolved_roster: rosterMeta.roster } : pool;
      }),
    [poolRosterById, rawPoolsArray]
  );
  const poolById = useMemo(
    () => new Map(poolsArray.map((pool) => [getPoolId(pool), pool]).filter(([poolId]) => Boolean(poolId))),
    [poolsArray]
  );

  const currentPool = useMemo(() => {
    if (isGroupMode) {
      if (groupType === 'all') {
        return {
          id: currentPoolId,
          name: t('dashboard.timeline.title.overview'),
          type: 'all',
          isGroupMode: true,
          isAllPoolsOverview: true,
          up_character: null,
          locked: true,
        };
      }

      const baseType = groupType === 'weapon_limited' || groupType === 'weapon_standard' ? 'weapon' : groupType;
      const ruleProfile = getCommonCapabilityValue(selectedPools, 'ruleProfile');
      const seriesKey = getCommonCapabilityValue(selectedPools, 'seriesKey');

      return {
        id: currentPoolId,
        name: t('pool.card.allGroupTitle', { label: getPoolTypeLabel(groupType, locale, groupSubtype) }),
        type: baseType,
        subtype: groupSubtype,
        extra_rule_profile: ruleProfile,
        extra_series_key: seriesKey,
        isGroupMode: true,
        isAllPoolsOverview: false,
        up_character: null,
        locked: true,
      };
    }

    const preferredPool = selectedPools[0];
    if (preferredPool) {
      return preferredPool;
    }

    return {
      id: DEFAULT_POOL_ID,
      name: t('simulator.defaultPoolName'),
      type: 'limited',
      locked: false,
    };
  }, [currentPoolId, groupSubtype, groupType, isGroupMode, locale, selectedPools, t]);

  const currentPoolHistory = useMemo(() => {
    if (!user?.id) {
      return [];
    }

    if (isGroupMode) {
      const groupPoolIds = new Set(selectedPools.map((pool) => getPoolId(pool)).filter(Boolean));

      return sortedAccountHistoryArray.filter((item) => groupPoolIds.has(getHistoryPoolId(item)));
    }

    const activePoolId = currentPool?.id || currentPoolId;
    if (!activePoolId) {
      return [];
    }

    return historyByPoolId.get(activePoolId) || [];
  }, [
    currentPool?.id,
    currentPoolId,
    historyByPoolId,
    isGroupMode,
    selectedPools,
    sortedAccountHistoryArray,
    user?.id,
  ]);

  const normalizedCurrentPoolHistory = useMemo(
    () =>
      currentPoolHistory.map((item) => {
        const sourcePool = isGroupMode ? poolById.get(getHistoryPoolId(item)) : currentPool;
        return {
          ...item,
          isStandard: normalizeHistoryStandardForPool(item, sourcePool),
        };
      }),
    [currentPool, currentPoolHistory, isGroupMode, poolById]
  );

  const allLimitedHistory = useMemo(
    () =>
      sortedAccountHistoryArray.filter((item) => {
        const sourcePool = poolById.get(getHistoryPoolId(item));
        const capabilities = resolvePoolCapabilities(sourcePool);
        return capabilities.entityType === 'character' && capabilities.basePoolType === 'limited';
      }),
    [poolById, sortedAccountHistoryArray]
  );

  const crossPoolPityMap = useMemo(() => {
    const map = new Map();
    const inheritedPools = selectedPools.filter((pool) => {
      const capabilities = resolvePoolCapabilities(pool);
      return capabilities.pityScope === 'shared' || capabilities.pityScope === 'series';
    });

    inheritedPools.forEach((pool) => {
      const timeline = buildScopedPaidHistoryTimeline({
        history: annotatedAccountHistoryArray,
        pools: poolsArray,
        pool,
        scopeType: 'pity',
      });
      buildPaidTimelinePityMap(timeline).forEach((value, key) => {
        map.set(key, value);
      });
    });

    const inheritedPoolIds = new Set(inheritedPools.map((pool) => getPoolId(pool)).filter(Boolean));
    annotatedAccountHistoryArray.forEach((item) => {
      const recordKey = getHistoryRecordKey(item);
      if (
        recordKey &&
        inheritedPoolIds.has(getHistoryPoolId(item)) &&
        Number(item?.rarity) >= 5 &&
        isFreeHistoryPull(item)
      ) {
        map.set(recordKey, {
          sixStarPity: 'free',
          fiveStarPity: 'free',
        });
      }
    });

    return map.size > 0 ? map : null;
  }, [annotatedAccountHistoryArray, poolsArray, selectedPools]);

  return {
    poolsArray,
    poolRosterById,
    selectedPools,
    historyArray,
    annotatedAccountHistoryArray,
    currentPool,
    currentPoolHistory,
    normalizedCurrentPoolHistory,
    allLimitedHistory,
    crossPoolPityMap,
    hasMergedAccountView,
    isGroupMode,
    groupType,
    groupSubtype,
  };
}

export default useCurrentPoolData;
