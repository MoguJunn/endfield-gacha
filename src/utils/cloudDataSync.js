import { getPreferredPoolId } from './poolSelectionUtils';
import { STORAGE_KEYS, writeStorageValue } from './storageUtils.js';
import { isGameAccountSelectionMatch } from './gameAccountMetadata.js';

function getHistoryPoolId(record) {
  return record?.poolId || record?.pool_id || null;
}

function resolvePreferredPoolIdFromHistory(pools, history, { preferredPoolId = null, preferredGameUid = null } = {}) {
  const poolsArray = Array.isArray(pools) ? pools : [];
  const historyArray = Array.isArray(history) ? history : [];
  if (poolsArray.length === 0 || historyArray.length === 0) {
    return null;
  }

  const scopedHistory = preferredGameUid
    ? historyArray.filter((record) => isGameAccountSelectionMatch(record, preferredGameUid))
    : historyArray;

  const candidateHistory = scopedHistory.length > 0 ? scopedHistory : historyArray;
  const candidatePoolIds = new Set(
    candidateHistory
      .map((record) => getHistoryPoolId(record))
      .filter(Boolean)
  );

  if (candidatePoolIds.size === 0) {
    return null;
  }

  if (preferredPoolId && candidatePoolIds.has(preferredPoolId)) {
    return preferredPoolId;
  }

  const candidatePools = poolsArray.filter((pool) => candidatePoolIds.has(pool.id));
  return getPreferredPoolId(candidatePools, {
    preferredPoolId: null,
    includeDefaultPool: false
  });
}

export function applyCloudDataToStores(
  cloudData,
  {
    setPools,
    switchPool,
    setHistory,
    preferredPoolId = null,
    preferredGameUid = null,
  }
) {
  const nextPools = Array.isArray(cloudData?.pools) ? cloudData.pools : [];
  const nextHistory = Array.isArray(cloudData?.history) ? cloudData.history : [];

  setPools(nextPools);
  setHistory(nextHistory);

  const fallbackId = resolvePreferredPoolIdFromHistory(nextPools, nextHistory, {
    preferredPoolId,
    preferredGameUid
  }) || getPreferredPoolId(nextPools, {
    preferredPoolId
  });

  if (fallbackId) {
    switchPool(fallbackId);
    writeStorageValue(STORAGE_KEYS.CURRENT_POOL_ID, fallbackId, { raw: true });
  }
}
