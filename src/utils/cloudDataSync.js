import { getPreferredPoolId } from './poolSelectionUtils';
import { STORAGE_KEYS, writeStorageValue } from './storageUtils.js';
import { isGameAccountSelectionMatch } from './gameAccountMetadata.js';
import { isPoolGroupId } from './poolGroupUtils.js';
import usePersonalAnalysisStore, {
  PERSONAL_ANALYSIS_AVAILABILITIES,
} from '../stores/usePersonalAnalysisStore.js';
import { unstable_batchedUpdates } from 'react-dom';
import { startTransition } from 'react';

function getHistoryPoolId(record) {
  return record?.poolId || record?.pool_id || null;
}

export function prepareCloudDataSnapshot(cloudData) {
  if (
    !cloudData
    || !Array.isArray(cloudData.pools)
    || !Array.isArray(cloudData.history)
  ) {
    return null;
  }

  return {
    ...cloudData,
    pools: [...cloudData.pools],
    history: [...cloudData.history],
  };
}

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function prepareCloudAnalysisSnapshot(cloudData) {
  if (
    !cloudData
    || cloudData.kind !== 'analysis'
    || !Array.isArray(cloudData.pools)
    || !cloudData.analysis
    || typeof cloudData.analysis !== 'object'
    || !PERSONAL_ANALYSIS_AVAILABILITIES.includes(cloudData.analysis.availability)
  ) {
    return null;
  }

  const ownerId = normalizeText(cloudData.ownerId);
  const responseOwnerId = normalizeText(cloudData.analysis.meta?.ownerId);
  if (ownerId && responseOwnerId && ownerId !== responseOwnerId) {
    return null;
  }

  return {
    ...cloudData,
    kind: 'analysis',
    ownerId,
    pools: [...cloudData.pools],
    analysis: {
      ...cloudData.analysis,
      warnings: Array.isArray(cloudData.analysis.warnings)
        ? [...cloudData.analysis.warnings]
        : [],
    },
    warnings: Array.isArray(cloudData.warnings) ? [...cloudData.warnings] : [],
  };
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
  const snapshot = prepareCloudDataSnapshot(cloudData);
  if (!snapshot) {
    return false;
  }

  const nextPools = snapshot.pools;
  const nextHistory = snapshot.history;

  const fallbackId = resolvePreferredPoolIdFromHistory(nextPools, nextHistory, {
    preferredPoolId,
    preferredGameUid
  }) || getPreferredPoolId(nextPools, {
    preferredPoolId
  });

  unstable_batchedUpdates(() => {
    startTransition(() => {
      setPools(nextPools);
      setHistory(nextHistory);
      if (fallbackId) {
        switchPool(fallbackId);
      }
    });
  });

  if (fallbackId) {
    writeStorageValue(STORAGE_KEYS.CURRENT_POOL_ID, fallbackId, { raw: true });
  }

  return true;
}

function resolveAnalysisAccountKey(analysis) {
  return normalizeText(analysis?.meta?.accountKey)
    || normalizeText(analysis?.scope?.account?.accountKey)
    || normalizeText(analysis?.owner?.defaultAccountKey);
}

function resolvePreferredPoolIdFromAnalysis(pools, analysis, preferredPoolId = null) {
  const normalizedPreferredPoolId = normalizeText(preferredPoolId);
  const requestedView = normalizedPreferredPoolId
    ? analysis?.scope?.dashboard?.views?.[normalizedPreferredPoolId]
    : null;
  if (isPoolGroupId(normalizedPreferredPoolId) && requestedView) {
    return normalizedPreferredPoolId;
  }

  const pullCounts = analysis?.scope?.selector?.poolPullCounts;
  if (!pullCounts || typeof pullCounts !== 'object' || Array.isArray(pullCounts)) {
    return null;
  }

  const poolIdsWithData = Object.entries(pullCounts)
    .filter(([, count]) => Number(count) > 0)
    .map(([poolId]) => normalizeText(poolId))
    .filter(Boolean);
  if (poolIdsWithData.length === 0) {
    return null;
  }

  if (normalizedPreferredPoolId && poolIdsWithData.includes(normalizedPreferredPoolId)) {
    return normalizedPreferredPoolId;
  }

  const idsWithData = new Set(poolIdsWithData);
  const poolsWithData = pools.filter((pool) => idsWithData.has(pool?.id));
  return getPreferredPoolId(poolsWithData, {
    preferredPoolId: null,
    includeDefaultPool: false,
  }) || poolIdsWithData[0];
}

export function applyCloudAnalysisToStores(
  cloudData,
  {
    setPools,
    switchPool,
    switchGameAccount,
    preferredPoolId = null,
    analysisStore = usePersonalAnalysisStore,
  } = {}
) {
  const snapshot = prepareCloudAnalysisSnapshot(cloudData);
  const analysisActions = typeof analysisStore?.getState === 'function'
    ? analysisStore.getState()
    : analysisStore;
  if (
    !snapshot
    || !snapshot.ownerId
    || typeof setPools !== 'function'
    || typeof analysisActions?.applyAnalysis !== 'function'
  ) {
    return false;
  }

  const accountKey = resolveAnalysisAccountKey(snapshot.analysis);
  const nextPoolId = resolvePreferredPoolIdFromAnalysis(
    snapshot.pools,
    snapshot.analysis,
    preferredPoolId
  );
  let analysisApplied = false;

  unstable_batchedUpdates(() => {
    startTransition(() => {
      setPools(snapshot.pools);
      analysisApplied = analysisActions.applyAnalysis(snapshot.ownerId, snapshot.analysis);
      if (analysisApplied && accountKey && typeof switchGameAccount === 'function') {
        switchGameAccount(accountKey);
      }
      if (analysisApplied && nextPoolId && typeof switchPool === 'function') {
        switchPool(nextPoolId);
      }
    });
  });

  if (!analysisApplied) {
    return false;
  }
  if (nextPoolId) {
    writeStorageValue(STORAGE_KEYS.CURRENT_POOL_ID, nextPoolId, { raw: true });
  }

  return true;
}
