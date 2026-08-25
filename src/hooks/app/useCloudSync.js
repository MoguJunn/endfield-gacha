import { useCallback, useEffect, useRef } from 'react';
import { getBootstrapVisiblePools } from '../../services/bootstrapService';
import {
  loadAllPoolsForCatalog,
  loadVisiblePools,
  mergePoolCollections,
} from '../../services/poolReadService';
import {
  deleteAccountGachaPool,
  deleteAccountGachaPoolHistory,
  deleteAccountGachaRecords,
  deleteAllAccountGachaData,
  loadAccountGachaAnalysis,
  saveAccountGachaData,
} from '../../services/accountGachaDataService.js';
import {
  useAuthStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePersonalDataStore,
  usePoolStore,
} from '../../stores';
import { getAppLocale, getMessage } from '../../i18n/index.js';
import {
  applyCloudAnalysisToStores,
  prepareCloudAnalysisSnapshot,
} from '../../utils/cloudDataSync.js';
import personalDataRequestCoordinator from '../../services/personalDataRequestCoordinator.js';

let activePersonalRefreshCalls = 0;

function setPersonalRefreshActivity(active) {
  activePersonalRefreshCalls = Math.max(0, activePersonalRefreshCalls + (active ? 1 : -1));
  useAuthStore.getState().setSyncing(activePersonalRefreshCalls > 0);
}

export function assertPersonalDataOwner(accountData, targetUser) {
  const responseOwnerId = String(accountData?.meta?.ownerId || '').trim();
  const targetOwnerId = String(targetUser?.id || '').trim();
  if (responseOwnerId && responseOwnerId !== targetOwnerId) {
    const error = new Error('个人数据响应 owner 与当前登录用户不一致');
    error.code = 'personal_data_owner_mismatch';
    error.responseOwnerId = responseOwnerId;
    error.targetOwnerId = targetOwnerId;
    throw error;
  }
}

async function loadLatestVisiblePools(options = {}) {
  const { preferBootstrap = false } = options;

  if (preferBootstrap) {
    const bootstrapPools = await getBootstrapVisiblePools().catch(() => null);
    if (Array.isArray(bootstrapPools) && bootstrapPools.length > 0) {
      return bootstrapPools;
    }
  }

  const directPools = await loadVisiblePools().catch(() => null);
  if (Array.isArray(directPools) && directPools.length > 0) {
    return directPools;
  }

  if (!preferBootstrap) {
    const bootstrapPools = await getBootstrapVisiblePools().catch(() => null);
    if (Array.isArray(bootstrapPools) && bootstrapPools.length > 0) {
      return bootstrapPools;
    }
  }

  return null;
}

/**
 * 云同步 Hook
 * 处理 loadCloudData/savePoolToCloud/saveHistoryToCloud 等云端数据操作
 * 包含数据归一化、dedupe、isStandard 推断
 */
export function useCloudSync({ showToast }) {
  const user = useAuthStore((state) => state.user);
  const setSyncing = useAuthStore((state) => state.setSyncing);
  const setSyncError = useAuthStore((state) => state.setSyncError);
  const setLastSyncAt = useAuthStore((state) => state.setLastSyncAt);
  const pools = usePoolStore((state) => state.pools);
  const setPools = usePoolStore((state) => state.setPools);
  const switchPool = usePoolStore((state) => state.switchPool);
  const switchGameAccount = usePoolStore((state) => state.switchGameAccount);
  const restoreOwnerSelection = usePoolStore((state) => state.restoreOwnerSelection);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const history = useHistoryStore((state) => state.history);
  const setHistory = useHistoryStore((state) => state.setHistory);
  const personalDataHasSnapshot = usePersonalDataStore((state) => state.hasSnapshot);
  const personalDataPhase = usePersonalDataStore((state) => state.phase);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisAccountKey = usePersonalAnalysisStore((state) => state.meta?.accountKey || null);
  const analysisScope = usePersonalAnalysisStore((state) => state.scope);
  const accountScopeRequestRef = useRef(null);

  // 只准备快照；请求合并、token 校验和提交由 refreshPersonalData 统一负责。
  const loadCloudData = useCallback(
    async (targetUser = null, options = {}) => {
      const currentUser = targetUser || useAuthStore.getState().user;
      if (!currentUser?.id) {
        const error = new Error('个人数据读取需要明确的目标用户');
        error.code = 'personal_data_owner_required';
        throw error;
      }

      const fallbackPools = usePersonalDataStore.getState().publicPools;
      const preferredGameUid = options.preferredGameUid
        ?? usePoolStore.getState().currentGameUid
        ?? '';
      const preferredPoolId = options.preferredPoolId
        ?? usePoolStore.getState().currentPoolId
        ?? '__group_all';
      const analysisViewKey = preferredPoolId || '__group_all';
      const analysisRequestOptions = {
        accountKey: preferredGameUid,
        viewKey: analysisViewKey,
        locale: getAppLocale(),
      };
      const analysisRequest = loadAccountGachaAnalysis(analysisRequestOptions)
        .catch((error) => {
          if (preferredGameUid && error?.code === 'personal_analysis_account_not_found') {
            return loadAccountGachaAnalysis({
              viewKey: analysisViewKey,
              locale: getAppLocale(),
            });
          }
          throw error;
        });
      const shouldRefreshPublicPools = options.refreshPublicPools !== false;
      const [latestVisiblePools, analysis] = await Promise.all([
        shouldRefreshPublicPools ? loadLatestVisiblePools() : Promise.resolve(null),
        analysisRequest,
      ]);
      assertPersonalDataOwner(analysis, currentUser);

      const visiblePools =
        Array.isArray(latestVisiblePools) && latestVisiblePools.length > 0
          ? latestVisiblePools
          : Array.isArray(fallbackPools)
            ? fallbackPools
            : [];
      const analysisPools = Array.isArray(analysis.scope?.poolManifest)
        ? analysis.scope.poolManifest
        : [];

      const knownPoolsMap = new Map();
      [...analysisPools, ...visiblePools].forEach((pool) => {
        const poolId = pool?.id || pool?.pool_id;
        if (poolId) {
          const existing = knownPoolsMap.get(poolId) || {};
          knownPoolsMap.set(poolId, {
            ...existing,
            ...pool,
            id: poolId,
          });
        }
      });

      return prepareCloudAnalysisSnapshot({
        kind: 'analysis',
        ownerId: currentUser.id,
        pools: [...knownPoolsMap.values()],
        analysis,
        meta: analysis.meta || null,
        source: analysis.source || 'unknown',
        warnings: analysis.warnings || [],
      });
    },
    []
  );

  const refreshPersonalData = useCallback(async (targetUser = null, options = {}) => {
    const currentUser = targetUser || useAuthStore.getState().user;
    if (!currentUser?.id) {
      const error = new Error('个人数据刷新需要明确的目标用户');
      error.code = 'personal_data_owner_required';
      return { ok: false, data: null, error, stale: false, applied: false };
    }

    const personalDataState = usePersonalDataStore.getState();
    const ownerChanged = personalDataState.ownerId !== currentUser.id;
    if (ownerChanged) {
      personalDataState.switchOwner(currentUser.id);
      setHistory([]);
      usePersonalAnalysisStore.getState().clearAnalysis('owner_changed');
      setPools(usePersonalDataStore.getState().publicPools);
      restoreOwnerSelection(currentUser.id);
    }

    const ownerState = usePersonalDataStore.getState();
    const preferredPoolId = options.preferredPoolId ?? usePoolStore.getState().currentPoolId;
    const preferredGameUid = options.preferredGameUid ?? usePoolStore.getState().currentGameUid;
    const refreshPublicPools = options.refreshPublicPools
      ?? options.kind !== 'building-poll';

    setSyncError(null);
    setPersonalRefreshActivity(true);
    try {
      const result = await personalDataRequestCoordinator.run({
        ownerId: currentUser.id,
        ownerGeneration: ownerState.ownerGeneration,
        kind: options.kind || 'explicit',
        reason: options.reason || options.kind || 'explicit',
        request: () => loadCloudData(currentUser, {
          preferredGameUid,
          preferredPoolId,
          refreshPublicPools,
        }),
        apply: (snapshot) => applyCloudAnalysisToStores(snapshot, {
          setPools,
          switchPool,
          switchGameAccount,
          preferredPoolId,
        }),
      });

      if (result.ok && result.applied) {
        setLastSyncAt(new Date().toISOString());
      } else if (!result.stale && result.error) {
        setSyncError(result.error.message);
      }
      return result;
    } finally {
      setPersonalRefreshActivity(false);
    }
  }, [
    loadCloudData,
    restoreOwnerSelection,
    setHistory,
    setLastSyncAt,
    setPools,
    setSyncError,
    switchGameAccount,
    switchPool,
  ]);

  useEffect(() => {
    const ownerId = String(user?.id || '').trim();
    const preferredGameUid = String(currentGameUid || '').trim();
    const currentAnalysisAccountKey = String(analysisAccountKey || '').trim();
    const preferredPoolId = String(currentPoolId || '').trim();
    const hasCurrentView = Boolean(
      preferredPoolId
      && analysisScope?.dashboard?.views?.[preferredPoolId]
    );
    const isBuilding = personalDataPhase === 'building' || analysisAvailability === 'building';

    if (
      !ownerId
      || !personalDataHasSnapshot
      || !preferredGameUid
      || (preferredGameUid === currentAnalysisAccountKey && hasCurrentView)
      || isBuilding
    ) {
      if (preferredGameUid && preferredGameUid === currentAnalysisAccountKey && hasCurrentView) {
        accountScopeRequestRef.current = null;
      }
      return;
    }

    const requestKey = JSON.stringify([ownerId, preferredGameUid, preferredPoolId]);
    if (accountScopeRequestRef.current === requestKey) {
      return;
    }
    accountScopeRequestRef.current = requestKey;
    void refreshPersonalData(user, {
      // Include the target in the coordinator key so rapid B → C switches
      // cannot reuse B's in-flight promise for C.
      kind: `account-view:${preferredGameUid}:${preferredPoolId}`,
      reason: preferredGameUid === currentAnalysisAccountKey
        ? 'analysis_view_changed'
        : 'account_scope_changed',
      preferredGameUid,
      preferredPoolId,
    });
  }, [
    analysisAccountKey,
    analysisAvailability,
    analysisScope,
    currentGameUid,
    currentPoolId,
    personalDataHasSnapshot,
    personalDataPhase,
    refreshPersonalData,
    user,
  ]);

  // 加载公共卡池数据（无需登录，用于首页轮换计划/倒计时）
  const loadPublicPools = useCallback(async () => {
    try {
      const latestVisiblePools = await loadLatestVisiblePools({ preferBootstrap: true });
      const catalogPools = await loadAllPoolsForCatalog().catch(() => []);
      const mergedPools = mergePoolCollections(
        Array.isArray(latestVisiblePools) ? latestVisiblePools : [],
        Array.isArray(catalogPools) ? catalogPools : []
      );

      if (mergedPools.length > 0) {
        const personalDataState = usePersonalDataStore.getState();
        personalDataState.setPublicPools(mergedPools);
        if (!personalDataState.ownerId || !personalDataState.hasSnapshot) {
          setPools(mergedPools);
        }
        return mergedPools;
      }
    } catch {
      return null;
    }

    return null;
  }, [setPools]);

  const savePoolToCloud = useCallback(
    async (pool, _showNotification = false) => {
      if (!user) {
        return false;
      }

      try {
        await saveAccountGachaData({ pools: [pool] });
        return true;
      } catch (error) {
        setSyncError(error.message);
        return false;
      }
    },
    [setSyncError, user]
  );

  // 保存历史记录到云端
  const saveHistoryToCloud = useCallback(
    async (records) => {
      if (!user || records.length === 0) return;

      try {
        await saveAccountGachaData({ history: records });
      } catch (error) {
        const errorMessage = error.message || '';
        if (errorMessage.includes('policy') || errorMessage.includes('violates row-level security')) {
          showToast(getMessage('cloudSync.error.lockedData'), 'error', getMessage('cloudSync.error.permissionTitle'));
        } else {
          showToast(
            getMessage('cloudSync.error.saveFailed', { message: errorMessage.substring(0, 100) }),
            'error',
            getMessage('cloudSync.error.syncTitle')
          );
        }

        setSyncError(error.message);
        throw error;
      }
    },
    [setSyncError, showToast, user]
  );

  // 从云端删除历史记录
  const deleteHistoryFromCloud = useCallback(
    async (recordIds) => {
      if (!user) return false;

      try {
        await deleteAccountGachaRecords(recordIds);
        return true;
      } catch (error) {
        setSyncError(error.message);
        showToast(getMessage('cloudSync.error.deleteHistoryFailed', { message: error.message }), 'error');
        return false;
      }
    },
    [setSyncError, showToast, user]
  );

  // 从云端删除指定卡池的所有历史记录
  const deletePoolHistoryFromCloud = useCallback(
    async (poolId) => {
      if (!user) return false;

      try {
        await deleteAccountGachaPoolHistory(poolId);
        return true;
      } catch (error) {
        setSyncError(error.message);
        showToast(getMessage('cloudSync.error.deletePoolHistoryFailed', { message: error.message }), 'error');
        return false;
      }
    },
    [setSyncError, showToast, user]
  );

  // 从云端删除卡池本身
  const deletePoolFromCloud = useCallback(
    async (poolId) => {
      if (!user) return false;

      try {
        await deleteAccountGachaPool(poolId);
        return true;
      } catch (error) {
        setSyncError(error.message);
        showToast(getMessage('cloudSync.error.deletePoolFailed', { message: error.message }), 'error');
        return false;
      }
    },
    [setSyncError, showToast, user]
  );

  // 删除当前用户的全部云端抽卡数据（仅作用于本人拥有的数据，不删除账号）
  const deleteUserDataFromCloud = useCallback(async () => {
    if (!user) return false;

    try {
      await deleteAllAccountGachaData();
      return true;
    } catch (error) {
      setSyncError(error.message);
      throw error;
    }
  }, [user, setSyncError]);

  // 迁移本地数据到云端
  const migrateLocalToCloud = useCallback(async () => {
    if (!user) return false;

    setSyncing(true);
    setSyncError(null);

    try {
      for (const pool of pools) {
        // eslint-disable-next-line no-await-in-loop -- pool sync stays sequential to keep failure attribution deterministic
        await savePoolToCloud(pool);
      }

      const batchSize = 100;
      for (let i = 0; i < history.length; i += batchSize) {
        const batch = history.slice(i, i + batchSize);
        // eslint-disable-next-line no-await-in-loop -- history sync batches are intentionally serialized
        await saveHistoryToCloud(batch);
      }

      setLastSyncAt(new Date().toISOString());
      return true;
    } catch (error) {
      setSyncError(error.message);
      return false;
    } finally {
      setSyncing(false);
    }
  }, [history, pools, saveHistoryToCloud, savePoolToCloud, setLastSyncAt, setSyncError, setSyncing, user]);

  // 手动同步数据到云端（设置页面使用）
  const syncToCloud = useCallback(async () => {
    if (!user) {
      showToast(getMessage('cloudSync.error.loginRequired'), 'warning');
      return;
    }

    try {
      setSyncing(true);
      let syncedPools = 0;
      let syncedHistory = 0;
      let skippedPools = 0;
      let skippedHistory = 0;

      const myPools = (pools || []).filter((pool) => !pool.user_id || pool.user_id === user.id);
      skippedPools = (pools || []).length - myPools.length;

      for (const pool of myPools) {
        // eslint-disable-next-line no-await-in-loop -- pool sync stays sequential to keep per-pool success counts exact
        const success = await savePoolToCloud(pool);
        if (success) syncedPools++;
      }

      const myHistory = history.filter((h) => !h.user_id || h.user_id === user.id);
      skippedHistory = history.length - myHistory.length;

      const batchSize = 100;
      for (let i = 0; i < myHistory.length; i += batchSize) {
        const batch = myHistory.slice(i, i + batchSize);
        // eslint-disable-next-line no-await-in-loop -- history batches are intentionally serialized
        await saveHistoryToCloud(batch);
        syncedHistory += batch.length;
      }

      let message = getMessage('cloudSync.success.syncCompleted', {
        pools: syncedPools,
        records: syncedHistory,
      });
      if (skippedPools > 0 || skippedHistory > 0) {
        message += getMessage('cloudSync.success.syncSkipped', {
          pools: skippedPools,
          records: skippedHistory,
        });
      }
      setLastSyncAt(new Date().toISOString());
      showToast(message, 'success');
    } catch (error) {
      showToast(getMessage('cloudSync.error.syncFailed', { message: error.message }), 'error');
    } finally {
      setSyncing(false);
    }
  }, [history, pools, saveHistoryToCloud, savePoolToCloud, setLastSyncAt, setSyncing, showToast, user]);

  return {
    loadCloudData,
    refreshPersonalData,
    loadPublicPools,
    savePoolToCloud,
    saveHistoryToCloud,
    deleteHistoryFromCloud,
    deletePoolHistoryFromCloud,
    deletePoolFromCloud,
    deleteUserDataFromCloud,
    migrateLocalToCloud,
    handleManualSync: syncToCloud,
    syncToCloud,
  };
}

export default useCloudSync;
