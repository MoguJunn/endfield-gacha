import { create } from 'zustand';
import useAuthStore from './useAuthStore.js';
import { getPreferredPool } from '../utils/poolSelectionUtils.js';
import {
  POOL_GROUP_PREFIX,
  GROUP_TYPE_LABELS,
  isPoolGroupId,
  parsePoolGroupId,
  getPoolGroupType,
  getPoolGroupSubtype,
  getPoolsForGroupType,
} from '../utils/poolGroupUtils.js';
import appLogger from '../utils/appLogger.js';
import { readStorageValue, removeStorageValue, STORAGE_KEYS, writeStorageValue } from '../utils/storageUtils.js';

// ========== 池组聚合模式 (FEAT-018) ==========
export {
  POOL_GROUP_PREFIX,
  GROUP_TYPE_LABELS,
  isPoolGroupId,
  parsePoolGroupId,
  getPoolGroupType,
  getPoolGroupSubtype,
  getPoolsForGroupType,
};

/**
 * 卡池类型映射：官方 poolId 前缀 -> 本地类型
 */
const POOL_TYPE_MAP = {
  joint: 'extra', // 附加寻访
  extra: 'extra', // 附加寻访（本地兼容）
  special: 'limited_character', // 限定角色池（特许寻访）
  standard: 'standard', // 常驻池（基础寻访）
  beginner: 'beginner', // 新手池（启程寻访）
  weponbox: 'limited_weapon', // 武器池（注意官方拼写错误）
  weaponbox: 'limited_weapon', // 武器池
};

/**
 * 从官方 poolId 推断卡池类型
 * @param {string} poolId - 官方 poolId (如 "special_1_0_1", "standard", "beginner")
 * @returns {string} 卡池类型
 */
export function getPoolTypeFromId(poolId) {
  if (!poolId) return 'unknown';
  const prefix = poolId.split('_')[0].toLowerCase();
  return POOL_TYPE_MAP[prefix] || 'unknown';
}

/**
 * 根据 poolId 和类型生成默认的卡池名称
 * @param {string} poolId - 官方 poolId
 * @param {string} type - 卡池类型
 * @returns {string} 默认名称
 */
function getDefaultPoolName(poolId, type) {
  switch (type) {
    case 'extra':
      return '附加寻访';
    case 'limited_character':
    case 'limited':
      return '限定角色池';
    case 'standard':
      return '基础寻访';
    case 'beginner':
      return '启程寻访';
    case 'limited_weapon':
    case 'weapon':
      return '武器池';
    default:
      return poolId || '未知卡池';
  }
}

/**
 * 同步获取当前用户ID（从 AuthStore 读取，避免异步问题 DR-B01）
 * @returns {string|null}
 */
const getCurrentUserId = () => {
  try {
    const user = useAuthStore.getState().user;
    return user?.id || null;
  } catch {
    return null;
  }
};

function readStoredUiValue(key) {
  const saved = readStorageValue(key, null, { raw: true });
  if (!saved || saved === 'null' || saved === 'undefined') {
    return null;
  }

  return saved;
}

function getOwnerScopedStorageKey(key, ownerId) {
  const normalizedOwnerId = String(ownerId || '').trim();
  return normalizedOwnerId ? `${key}:${normalizedOwnerId}` : key;
}

function writeOwnerScopedUiValue(key, value) {
  const ownerId = getCurrentUserId();
  if (!ownerId) {
    return;
  }

  const scopedKey = getOwnerScopedStorageKey(key, ownerId);
  if (value === null || value === undefined || value === '') {
    removeStorageValue(scopedKey, { raw: true });
  } else {
    writeStorageValue(scopedKey, value, { raw: true });
  }
}

/**
 * 卡池状态管理 V3
 *
 * 主要变更：
 * - 移除按抽卡人分组（改为按官方卡池类型分组）
 * - 新增多游戏账号支持
 * - 简化卡池创建逻辑（只通过 API 导入创建）
 * - 移除 localStorage 存储卡池数据（数据只保存在服务器）
 * - 仅保留 UI 状态（当前选中卡池ID、当前游戏账号）在 localStorage
 */
const usePoolStore = create((set, get) => ({
  // ========== 卡池列表（仅内存，不使用 localStorage）==========
  pools: [],

  // ========== 当前选中卡池（UI 状态，保留 localStorage）==========
  currentPoolId: readStoredUiValue(STORAGE_KEYS.CURRENT_POOL_ID),

  // ========== 当前游戏账号（UI 状态，保留 localStorage）==========
  currentGameUid: readStoredUiValue(STORAGE_KEYS.CURRENT_GAME_UID),

  // ========== 卡池搜索 ==========
  poolSearchQuery: '',
  setPoolSearchQuery: (query) => set({ poolSearchQuery: query }),

  /**
   * 用户切换时恢复该 owner 自己的 UI 范围；没有历史选择时明确
   * 清空，避免沿用上一个站点账号的游戏 UID 或卡池。
   */
  restoreOwnerSelection: (ownerId) => {
    const currentPoolId = readStoredUiValue(getOwnerScopedStorageKey(STORAGE_KEYS.CURRENT_POOL_ID, ownerId));
    const currentGameUid = readStoredUiValue(getOwnerScopedStorageKey(STORAGE_KEYS.CURRENT_GAME_UID, ownerId));
    set({ currentPoolId, currentGameUid });
    return { currentPoolId, currentGameUid };
  },

  // ========== 操作方法 ==========

  /**
   * 设置卡池列表（仅更新内存状态，不写入 localStorage）
   * 支持直接传入数组或函数更新器
   */
  setPools: (poolsOrUpdater) => {
    // 支持函数更新器模式：setPools(prev => [...prev, newPool])
    if (typeof poolsOrUpdater === 'function') {
      const currentPools = get().pools;
      const newPools = poolsOrUpdater(currentPools);
      // 确保结果是数组
      if (!Array.isArray(newPools)) {
        appLogger.error('[usePoolStore] setPools 函数更新器必须返回数组');
        return;
      }
      set({ pools: newPools });
      // 不再写入 localStorage，数据只保存在服务器
    } else {
      // 确保传入的是数组
      if (!Array.isArray(poolsOrUpdater)) {
        appLogger.error('[usePoolStore] setPools 必须接收数组或函数更新器');
        return;
      }
      set({ pools: poolsOrUpdater });
      // 不再写入 localStorage，数据只保存在服务器
    }
  },

  /**
   * 切换当前卡池
   */
  switchPool: (poolId) => {
    set({ currentPoolId: poolId });
    writeStorageValue(STORAGE_KEYS.CURRENT_POOL_ID, poolId, { raw: true });
    writeOwnerScopedUiValue(STORAGE_KEYS.CURRENT_POOL_ID, poolId);
  },

  /**
   * 切换到池组聚合模式 (FEAT-018)
   */
  switchToPoolGroup: (groupType) => {
    const id = POOL_GROUP_PREFIX + groupType;
    set({ currentPoolId: id });
    writeStorageValue(STORAGE_KEYS.CURRENT_POOL_ID, id, { raw: true });
    writeOwnerScopedUiValue(STORAGE_KEYS.CURRENT_POOL_ID, id);
  },

  /**
   * 切换当前游戏账号
   */
  switchGameAccount: (gameUid) => {
    // ⚠️ 修复：确保不会保存字符串 "null"
    const normalizedUid = !gameUid || gameUid === 'null' || gameUid === 'undefined' ? null : gameUid;
    set({ currentGameUid: normalizedUid });

    if (normalizedUid === null) {
      removeStorageValue(STORAGE_KEYS.CURRENT_GAME_UID, { raw: true });
      writeOwnerScopedUiValue(STORAGE_KEYS.CURRENT_GAME_UID, null);
    } else {
      writeStorageValue(STORAGE_KEYS.CURRENT_GAME_UID, normalizedUid, { raw: true });
      writeOwnerScopedUiValue(STORAGE_KEYS.CURRENT_GAME_UID, normalizedUid);
    }
  },

  /**
   * 创建新卡池
   * @param {object} poolData - 卡池数据
   */
  createPool: (poolData) => {
    const { pools } = get();
    const userId = getCurrentUserId();

    const poolId = poolData.id || `pool_${Date.now()}`;

    const newPool = {
      ...poolData,
      id: poolId,
      type: poolData.type || getPoolTypeFromId(poolId),
      locked: false,
      user_id: userId,
      created_at: new Date().toISOString(),
    };

    const updatedPools = [...pools, newPool];
    get().setPools(updatedPools);

    return newPool;
  },

  /**
   * 根据官方 poolId 获取或创建卡池
   * @param {string} poolId - 官方 poolId
   * @param {string} [poolName] - 官方 poolName
   * @returns {object} 卡池对象
   */
  getOrCreatePool: (poolId, poolName) => {
    const { pools } = get();

    // 先查找是否已存在
    let pool = pools.find((p) => p.id === poolId);
    if (pool) {
      // 如果名称有更新，更新卡池名称
      if (poolName && pool.name !== poolName) {
        get().updatePool(poolId, { name: poolName });
        pool = { ...pool, name: poolName };
      }
      return pool;
    }

    // 不存在则创建
    const type = getPoolTypeFromId(poolId);
    const name = poolName || getDefaultPoolName(poolId, type);

    return get().createPool({
      id: poolId,
      name: name,
      type: type,
    });
  },

  /**
   * 批量获取或创建卡池
   * @param {Array<{poolId: string, poolName: string}>} poolInfos
   * @returns {Map<string, object>} poolId -> pool 映射
   */
  getOrCreatePools: (poolInfos) => {
    const poolMap = new Map();
    poolInfos.forEach(({ poolId, poolName }) => {
      if (!poolMap.has(poolId)) {
        const pool = get().getOrCreatePool(poolId, poolName);
        poolMap.set(poolId, pool);
      }
    });
    return poolMap;
  },

  /**
   * 删除卡池
   */
  deletePool: (poolId) => {
    const { pools, currentPoolId } = get();
    const updatedPools = pools.filter((p) => p.id !== poolId);
    get().setPools(updatedPools);

    // 如果删除的是当前卡池，切换到第一个
    if (currentPoolId === poolId && updatedPools.length > 0) {
      get().switchPool(updatedPools[0].id);
    }
  },

  /**
   * 更新卡池
   */
  updatePool: (poolId, updates) => {
    const { pools } = get();

    const updatedPools = pools.map((p) =>
      p.id === poolId ? { ...p, ...updates, updated_at: new Date().toISOString() } : p
    );
    get().setPools(updatedPools);
  },

  /**
   * 获取当前卡池对象
   */
  getCurrentPool: () => {
    const { pools, currentPoolId } = get();
    return getPreferredPool(pools, {
      preferredPoolId: currentPoolId,
      includeDefaultPool: true,
    });
  },

  /**
   * 获取按官方类型分组的卡池列表
   * @returns {Array<{type: string, label: string, pools: Array}>}
   */
  getPoolsByType: () => {
    const { pools, poolSearchQuery } = get();

    // 先按搜索词过滤
    const filteredPools = poolSearchQuery.trim()
      ? pools.filter((pool) => pool.name.toLowerCase().includes(poolSearchQuery.toLowerCase()))
      : pools;

    // 按类型分组
    const groups = {
      extra: { label: '附加寻访', pools: [] },
      limited_character: { label: '限定角色池', pools: [] },
      standard: { label: '常驻池', pools: [] },
      beginner: { label: '新手池', pools: [] },
      limited_weapon: { label: '武器池', pools: [] },
    };

    filteredPools.forEach((pool) => {
      // 统一类型映射
      let type = pool.type || 'standard';
      if (type === 'extra') type = 'extra';
      if (type === 'limited') type = 'limited_character';
      if (type === 'weapon') type = 'limited_weapon';

      if (groups[type]) {
        groups[type].pools.push(pool);
      } else {
        groups.standard.pools.push(pool);
      }
    });

    // 转换为数组，按预定顺序，过滤空分组
    return ['limited_character', 'extra', 'standard', 'beginner', 'limited_weapon']
      .map((type) => ({
        type,
        ...groups[type],
      }))
      .filter((group) => group.pools.length > 0);
  },
}));

export default usePoolStore;
