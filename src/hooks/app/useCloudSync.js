import { useCallback, useRef } from 'react';
import { getBootstrapVisiblePools } from '../../services/bootstrapService';
import {
  loadAllPoolsForCatalog,
  loadVisiblePools,
  loadPoolsByIds,
  mergePoolCollections,
  normalizeRemotePoolType,
} from '../../services/poolReadService';
import {
  deleteAccountGachaPool,
  deleteAccountGachaPoolHistory,
  deleteAccountGachaRecords,
  deleteAllAccountGachaData,
  loadAccountGachaData,
  saveAccountGachaData,
} from '../../services/accountGachaDataService.js';
import { useAuthStore, usePoolStore, useHistoryStore } from '../../stores';
import { getPoolTypeFromId } from '../../stores/usePoolStore';
import { getMessage } from '../../i18n/index.js';

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
  const history = useHistoryStore((state) => state.history);

  // DR-B05: 防止并发调用 loadCloudData 导致请求加倍
  const loadingPromiseRef = useRef(null);

  // 从云端加载数据（只加载当前用户的数据）
  const loadCloudData = useCallback(
    async (targetUser = null) => {
      const currentUser = targetUser || useAuthStore.getState().user;
      if (!currentUser) {
        return { pools: [], history: [] };
      }

      // DR-B05: 如果已有正在执行的请求，复用同一个 Promise
      if (loadingPromiseRef.current) {
        return loadingPromiseRef.current;
      }

      const doLoad = async () => {
        setSyncing(true);
        setSyncError(null);

        try {
          const fallbackPools = usePoolStore.getState().pools;
          const [latestVisiblePools, catalogPools, accountData] = await Promise.all([
            loadLatestVisiblePools(),
            loadAllPoolsForCatalog().catch(() => []),
            loadAccountGachaData(),
          ]);
          const visiblePools =
            Array.isArray(latestVisiblePools) && latestVisiblePools.length > 0
              ? latestVisiblePools
              : Array.isArray(fallbackPools)
                ? fallbackPools
                : [];

          const formattedHistory = accountData.history;

          const knownPoolsMap = new Map();
          [...catalogPools, ...visiblePools].forEach((pool) => {
            if (pool?.id) {
              knownPoolsMap.set(pool.id, pool);
            }
          });
          const historyPoolIds = [...new Set(formattedHistory.map((h) => h.poolId))];
          const missingPoolIds = historyPoolIds.filter((pid) => pid && !knownPoolsMap.has(pid));
          const hydratedHistoryPools =
            missingPoolIds.length > 0 ? await loadPoolsByIds(missingPoolIds).catch(() => []) : [];

          hydratedHistoryPools.forEach((pool) => {
            if (pool?.id) {
              knownPoolsMap.set(pool.id, pool);
            }
          });

          const knownPoolIds = new Set(knownPoolsMap.keys());

          // 补占位池
          const placeholderPools = historyPoolIds
            .filter((pid) => !knownPoolIds.has(pid))
            .map((pid) => {
              const rawType = getPoolTypeFromId(pid);
              const inferredType = normalizeRemotePoolType(rawType);
              const defaultName = (() => {
                switch (inferredType) {
                  case 'extra':
                    return getMessage('pool.group.extra');
                  case 'limited_character':
                  case 'limited':
                    return getMessage('cloudSync.placeholder.limitedCharacterBanner');
                  case 'standard':
                    return getMessage('cloudSync.placeholder.standardBanner');
                  case 'beginner':
                    return getMessage('cloudSync.placeholder.beginnerBanner');
                  case 'limited_weapon':
                  case 'weapon':
                    return getMessage('cloudSync.placeholder.weaponBanner');
                  default:
                    return pid || getMessage('cloudSync.placeholder.unknownBanner');
                }
              })();
              return {
                id: pid,
                name: defaultName,
                type: inferredType === 'unknown' ? 'standard' : inferredType,
                locked: false,
                isLimitedWeapon: rawType === 'limited_weapon' || inferredType === 'weapon',
                created_at: null,
                updated_at: null,
                user_id: null,
                creator_username: null,
                up_character: null,
                description: null,
                banner_url: null,
                start_time: null,
                end_time: null,
                featured_characters: null,
              };
            });

          const allPools = [...knownPoolsMap.values(), ...placeholderPools];

          // 根据池类型回填历史记录的 isStandard
          const poolTypeLookup = new Map(allPools.map((p) => [p.id, p.type]));
          const normalizedHistory = formattedHistory.map((h) => {
            const poolType = poolTypeLookup.get(h.poolId);
            const inferredIsStandard =
              poolType === 'standard' || poolType === 'beginner'
                ? true
                : poolType === 'extra' ||
                    poolType === 'limited' ||
                    poolType === 'limited_character' ||
                    poolType === 'weapon' ||
                    poolType === 'limited_weapon'
                  ? false
                  : null;
            const isStandard = inferredIsStandard !== null ? inferredIsStandard : Boolean(h.isStandard);
            return { ...h, isStandard };
          });

          setLastSyncAt(new Date().toISOString());
          return { pools: allPools, history: normalizedHistory };
        } catch (error) {
          setSyncError(error.message);
          return null;
        } finally {
          setSyncing(false);
        }
      };

      // DR-B05: 缓存 Promise，并发调用共享同一个请求
      loadingPromiseRef.current = doLoad();
      try {
        return await loadingPromiseRef.current;
      } finally {
        loadingPromiseRef.current = null;
      }
    },
    [setLastSyncAt, setSyncError, setSyncing]
  );

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
        setPools(mergedPools);
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
