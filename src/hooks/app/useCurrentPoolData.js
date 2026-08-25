import { useMemo } from 'react';
import { DEFAULT_POOL_ID } from '../../constants';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../stores';
import {
  getPoolGroupType,
  getPoolsForGroupType,
  isPoolGroupId
} from '../../stores/usePoolStore';
import {
  isFreeHistoryPull,
  isGiftHistoryPull
} from '../../utils/historyInfoBook';
import { normalizeIsStandard } from '../../utils';
import { getPreferredPool } from '../../utils/poolSelectionUtils';
import { buildPoolSelectorGroups, getPoolTypeLabel } from '../../utils/poolSelectorDisplay';
import { getCachedHistoryIndex } from '../../utils/historyIndex.js';
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
  const selectedGroupType = groupMode ? getPoolGroupType(currentPoolId) : null;

  if (groupMode) {
    const orderedGroups = buildPoolSelectorGroups({ pools: poolsArray, locale });
    if (selectedGroupType === 'all') {
      return orderedGroups.flatMap((group) => group.pools);
    }

    return orderedGroups.find((group) => group.type === selectedGroupType)?.pools
      || getPoolsForGroupType(poolsArray, selectedGroupType);
  }

  const preferredPool = getPreferredPool(poolsArray, {
    preferredPoolId: currentPoolId,
    includeDefaultPool: true,
  });
  return preferredPool ? [preferredPool] : [];
}

export function useCurrentPoolData() {
  const { locale, t } = useI18n();
  const user = useAuthStore(state => state.user);
  const pools = usePoolStore(state => state.pools);
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const history = useHistoryStore(state => state.history);

  const rawPoolsArray = useMemo(() => (Array.isArray(pools) ? pools : []), [pools]);
  const historyIndex = useMemo(() => getCachedHistoryIndex({
    history,
    pools: rawPoolsArray,
    userId: user?.id || null,
    currentGameUid,
  }), [currentGameUid, history, rawPoolsArray, user?.id]);
  const {
    historyArray,
    annotatedAccountHistoryArray,
    sortedAccountHistoryArray,
    historyByPoolId,
    poolById,
    allLimitedHistory,
  } = historyIndex;
  const hasMergedAccountView = false;
  const isGroupMode = isPoolGroupId(currentPoolId);
  const groupType = isGroupMode ? getPoolGroupType(currentPoolId) : null;
  const selectedScopePools = useMemo(() => selectPoolsForRosterScope({
    pools: rawPoolsArray,
    currentPoolId,
    locale,
  }), [currentPoolId, locale, rawPoolsArray]);
  const poolRosterById = usePoolRoster({
    pools: selectedScopePools,
    enabled: selectedScopePools.length > 0,
  });
  const selectedPools = useMemo(() => selectedScopePools.map((pool) => {
    const rosterMeta = poolRosterById.get(normalizePoolId(getPoolId(pool)));
    return rosterMeta
      ? { ...pool, resolved_roster: rosterMeta.roster }
      : pool;
  }), [poolRosterById, selectedScopePools]);
  const poolsArray = useMemo(() => rawPoolsArray.map((pool) => {
    const rosterMeta = poolRosterById.get(normalizePoolId(getPoolId(pool)));
    return rosterMeta
      ? { ...pool, resolved_roster: rosterMeta.roster }
      : pool;
  }), [poolRosterById, rawPoolsArray]);

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
          locked: true
        };
      }

      const baseType = groupType === 'weapon_limited' || groupType === 'weapon_standard'
        ? 'weapon'
        : groupType === 'extra'
          ? 'extra'
        : groupType === 'limited'
          ? 'limited'
          : groupType;

      return {
        id: currentPoolId,
        name: t('pool.card.allGroupTitle', { label: getPoolTypeLabel(groupType, locale) }),
        type: baseType,
        isGroupMode: true,
        isAllPoolsOverview: false,
        up_character: null,
        locked: true
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
      locked: false
    };
  }, [currentPoolId, groupType, isGroupMode, locale, selectedPools, t]);

  const currentPoolHistory = useMemo(() => {
    if (!user?.id) {
      return [];
    }

    if (isGroupMode) {
      const groupPoolIds = new Set(
        selectedPools
          .map(pool => getPoolId(pool))
          .filter(Boolean)
      );

      return sortedAccountHistoryArray.filter(item => groupPoolIds.has(getHistoryPoolId(item)));
    }

    const activePoolId = currentPool?.id || currentPoolId;
    if (!activePoolId) {
      return [];
    }

    return historyByPoolId.get(activePoolId) || [];
  }, [currentPool?.id, currentPoolId, historyByPoolId, isGroupMode, selectedPools, sortedAccountHistoryArray, user?.id]);

  const normalizedCurrentPoolHistory = useMemo(() => {
    if (isGroupMode) {
      return currentPoolHistory.map(item => {
        const pool = poolById.get(getHistoryPoolId(item));
        return {
          ...item,
          isStandard: normalizeIsStandard(item, pool?.type, pool?.up_character)
        };
      });
    }

    return currentPoolHistory.map(item => ({
      ...item,
      isStandard: normalizeIsStandard(item, currentPool?.type, currentPool?.up_character)
    }));
  }, [currentPool?.type, currentPool?.up_character, currentPoolHistory, isGroupMode, poolById]);

  const crossPoolPityMap = useMemo(() => {
    if (allLimitedHistory.length === 0) {
      return null;
    }

    const map = new Map();
    let sixPity = 0;
    let fivePity = 0;

    allLimitedHistory
      .filter(item => !isGiftHistoryPull(item))
      .forEach(item => {
        const isFree = isFreeHistoryPull(item);
        const recordKey = getHistoryRecordKey(item);

        if (!isFree) {
          sixPity++;
          fivePity++;
        }

        if (item.rarity >= 5 && recordKey) {
          map.set(recordKey, {
            sixStarPity: isFree ? 'free' : (item.rarity === 6 ? sixPity : null),
            fiveStarPity: isFree ? 'free' : fivePity
          });
        }

        if (!isFree) {
          if (item.rarity === 6) {
            sixPity = 0;
          }
          if (item.rarity >= 5) {
            fivePity = 0;
          }
        }
      });

    return map;
  }, [allLimitedHistory]);

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
    groupType
  };
}

export default useCurrentPoolData;
