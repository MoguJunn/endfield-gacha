import { create } from 'zustand';
import { DEFAULT_DISPLAY_PITY } from '../constants/index.js';
import {
  buildGameAccountServerTag,
  getHistoryRecordAccountKey,
  getHistoryRecordGameUid,
  getHistoryRecordTimestampMs,
  isGameAccountSelectionMatch,
  loadGameAccountMetadataMap,
  normalizeGameAccountMetadata
} from '../utils/gameAccountMetadata.js';

function getHistoryGameUid(record) {
  return getHistoryRecordGameUid(record);
}

function getHistoryNickName(record) {
  return record?.nick_name || record?.nickName || getHistoryGameUid(record) || 'unknown';
}

function getHistoryAccountMetadata(record, storedMetadata = null) {
  const normalized = normalizeGameAccountMetadata({
    ...(storedMetadata || {}),
    gameUid: getHistoryGameUid(record),
    nickName: getHistoryNickName(record),
    channelName: record?.channel_name || record?.channelName || storedMetadata?.channelName,
    hgUid: record?.hg_uid || record?.hgUid || storedMetadata?.hgUid,
    channelMasterId: record?.channel_master_id || record?.channelMasterId || storedMetadata?.channelMasterId,
    serverId: record?.server_id || record?.serverId || storedMetadata?.serverId,
    region: record?.region || record?.serverRegion || storedMetadata?.region,
    isOfficial: record?.is_official ?? record?.isOfficial ?? storedMetadata?.isOfficial
  });

  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    serverTag: buildGameAccountServerTag(normalized)
  };
}

/**
 * 抽卡历史记录状态管理 V3
 *
 * 主要变更：
 * - 移除 localStorage 存储（数据只保存在服务器）
 * - 添加新字段支持：character_name, batch_id, seq_id, pity, is_new, is_free, game_uid
 * - 新增按游戏账号筛选功能
 */
const useHistoryStore = create((set, get) => ({
  // ========== 历史记录（仅内存，不使用 localStorage）==========
  history: [],

  // ========== 筛选和分页 ==========
  manualPityLimit: DEFAULT_DISPLAY_PITY,
  visibleHistoryCount: 20,
  historyFilter: 'all', // 'all' | '6star' | '5star'

  setManualPityLimit: (limit) => set({ manualPityLimit: limit }),
  setVisibleHistoryCount: (count) => set({ visibleHistoryCount: count }),
  setHistoryFilter: (filter) => set({ historyFilter: filter }),
  loadMoreHistory: () => set((state) => ({
    visibleHistoryCount: state.visibleHistoryCount + 20
  })),

  // ========== 操作方法 ==========

  /**
   * 设置历史记录（仅更新内存状态，不写入 localStorage）
   */
  setHistory: (history) => {
    set({ history });
    // 不再写入 localStorage，数据只保存在服务器
  },

  /**
   * 获取当前卡池的历史记录
   * @param {string} poolId - 卡池 ID
   * @returns {Array} 该卡池的历史记录
   */
  getCurrentPoolHistory: (poolId) => {
    const { history } = get();
    if (!poolId) return [];
    return history.filter(h => h.poolId === poolId);
  },

  /**
   * 获取指定游戏账号和卡池的历史记录
   * @param {string} poolId - 卡池 ID
   * @param {string} [gameUid] - 游戏账号 UID
   * @returns {Array} 历史记录
   */
  getPoolHistoryByGameAccount: (poolId, gameUid) => {
    const { history } = get();
    if (!poolId) return [];

    return history.filter(h => {
      if (h.poolId !== poolId) return false;
      if (gameUid && !isGameAccountSelectionMatch(h, gameUid)) return false;
      return true;
    });
  },

  /**
   * 添加单条记录
   */
  addPull: (pull) => {
    const { history } = get();
    const newHistory = [...history, pull];
    get().setHistory(newHistory);
    return pull;
  },

  /**
   * 批量添加记录
   */
  addPulls: (pulls) => {
    const { history } = get();
    const newHistory = [...history, ...pulls];
    get().setHistory(newHistory);
  },

  /**
   * 更新单条记录
   */
  updatePull: (id, updates) => {
    const { history } = get();
    const newHistory = history.map(h =>
      h.id === id ? { ...h, ...updates } : h
    );
    get().setHistory(newHistory);
  },

  /**
   * 删除单条记录
   */
  deletePull: (id) => {
    const { history } = get();
    const newHistory = history.filter(h => h.id !== id);
    get().setHistory(newHistory);
  },

  /**
   * 删除整组记录（十连）
   * @param {string} batchId - 批次 ID
   */
  deleteBatch: (batchId) => {
    const { history } = get();
    const newHistory = history.filter(h => h.batchId !== batchId);
    get().setHistory(newHistory);
  },

  /**
   * 删除指定卡池的所有记录
   */
  deletePoolHistory: (poolId) => {
    const { history } = get();
    const newHistory = history.filter(h => h.poolId !== poolId);
    get().setHistory(newHistory);
  },

  /**
   * 清空所有历史记录
   */
  clearAllHistory: () => {
    get().setHistory([]);
  },

  /**
   * 导入历史记录（替换现有数据）
   */
  importHistory: (importedHistory) => {
    get().setHistory(importedHistory);
  },

  /**
   * 合并历史记录（基于 seqId 或 id 去重）
   */
  mergeHistory: (importedHistory) => {
    const { history } = get();

    // 优先使用 seqId 去重（官方 API 返回的唯一标识）
    const existingSeqIds = new Set(
      history.filter(h => h.seqId).map(h => h.seqId)
    );
    const existingIds = new Set(history.map(h => h.id));

    const newPulls = importedHistory.filter(h => {
      // 如果有 seqId，用 seqId 去重
      if (h.seqId && existingSeqIds.has(h.seqId)) return false;
      // 否则用 id 去重
      if (existingIds.has(h.id)) return false;
      return true;
    });

    const mergedHistory = [...history, ...newPulls];
    get().setHistory(mergedHistory);

    return {
      total: importedHistory.length,
      added: newPulls.length,
      duplicates: importedHistory.length - newPulls.length
    };
  },

  /**
   * 获取过滤后的历史记录
   */
  getFilteredHistory: (poolId) => {
    const { historyFilter } = get();
    const poolHistory = get().getCurrentPoolHistory(poolId);

    switch (historyFilter) {
      case '6star':
        return poolHistory.filter(h => h.rarity === 6);
      case '5star':
        return poolHistory.filter(h => h.rarity === 5);
      default:
        return poolHistory;
    }
  },

  /**
   * 获取某卡池的统计数据
   * @param {string} poolId - 卡池 ID
   * @returns {object} 统计数据
   */
  getPoolStats: (poolId) => {
    const poolHistory = get().getCurrentPoolHistory(poolId);

    const stats = {
      total: poolHistory.length,
      byRarity: { 6: 0, 5: 0, 4: 0 },
      sixStars: [],
      currentPity: 0
    };

    // 统计各稀有度数量
    poolHistory.forEach(h => {
      if (stats.byRarity[h.rarity] !== undefined) {
        stats.byRarity[h.rarity]++;
      }
      if (h.rarity === 6) {
        stats.sixStars.push(h);
      }
    });

    // 计算当前保底（从最后一条6星之后算起）
    const sortedHistory = [...poolHistory].sort((a, b) => b.timestamp - a.timestamp);
    for (const h of sortedHistory) {
      if (h.rarity === 6) break;
      stats.currentPity++;
    }

    return stats;
  },

  /**
   * 从历史记录中提取所有游戏账号
   * @returns {Array<{gameUid: string, nickName: string, recordCount: number}>}
   */
  getGameAccountsFromHistory: () => {
    const { history } = get();
    const accountMap = new Map();
    const storedMetadataMap = loadGameAccountMetadataMap();

    history.forEach(h => {
      const gameUid = getHistoryGameUid(h);
      if (gameUid) {
        const historyAccountKey = getHistoryRecordAccountKey(h) || gameUid;
        const recordTimestamp = getHistoryRecordTimestampMs(h);
        const metadata = getHistoryAccountMetadata(h, storedMetadataMap[historyAccountKey] || storedMetadataMap[gameUid]);
        const accountKey = metadata?.accountKey || historyAccountKey;
        const derivedImportTimestamp = metadata?.lastImportedAt
          || metadata?.lastImportedRecordAt
          || (recordTimestamp ? new Date(recordTimestamp).toISOString() : null);
        if (!accountMap.has(accountKey)) {
          accountMap.set(accountKey, {
            accountKey,
            gameUid,
            nickName: metadata?.nickName || getHistoryNickName(h), // 优先使用昵称，否则使用 UID
            channelName: metadata?.channelName || null,
            hgUid: metadata?.hgUid || null,
            channelMasterId: metadata?.channelMasterId || null,
            serverId: metadata?.serverId || null,
            region: metadata?.region || null,
            isOfficial: metadata?.isOfficial ?? null,
            serverTag: metadata?.serverTag || null,
            lastImportedAt: derivedImportTimestamp,
            lastImportedRecordAt: metadata?.lastImportedRecordAt || null,
            lastImportSource: metadata?.lastImportSource || null,
            latestRecordAt: recordTimestamp ? new Date(recordTimestamp).toISOString() : null,
            recordCount: 0
          });
        } else if (metadata) {
          const existing = accountMap.get(accountKey);
          accountMap.set(accountKey, {
            ...existing,
            accountKey,
            nickName: metadata.nickName || existing.nickName,
            channelName: metadata.channelName || existing.channelName,
            hgUid: metadata.hgUid || existing.hgUid,
            channelMasterId: metadata.channelMasterId || existing.channelMasterId,
            serverId: metadata.serverId || existing.serverId,
            region: metadata.region || existing.region,
            isOfficial: metadata.isOfficial ?? existing.isOfficial,
            serverTag: metadata.serverTag || existing.serverTag,
            lastImportedAt: metadata.lastImportedAt || metadata.lastImportedRecordAt || existing.lastImportedAt,
            lastImportedRecordAt: metadata.lastImportedRecordAt || existing.lastImportedRecordAt,
            lastImportSource: metadata.lastImportSource || existing.lastImportSource
          });
        }
        const accountEntry = accountMap.get(accountKey);
        accountEntry.recordCount++;

        const latestRecordTimestamp = getHistoryRecordTimestampMs(h);
        const currentLatestTimestamp = getHistoryRecordTimestampMs({
          timestamp: accountEntry.latestRecordAt
        });

        if (latestRecordTimestamp && (!currentLatestTimestamp || latestRecordTimestamp > currentLatestTimestamp)) {
          accountEntry.latestRecordAt = new Date(latestRecordTimestamp).toISOString();
        }
      }
    });

    return Array.from(accountMap.values())
      .sort((a, b) => b.recordCount - a.recordCount); // 按记录数降序
  },

  /**
   * 按游戏账号筛选历史记录
   * @param {string|null} gameUid - 游戏账号UID，null表示全部
   * @returns {Array} 筛选后的历史记录
   */
  getHistoryByGameAccount: (gameUid) => {
    const { history } = get();
    if (!gameUid) return history;
    return history.filter(h => isGameAccountSelectionMatch(h, gameUid));
  },

  /**
   * 获取所有游戏账号的历史记录统计
   * @returns {Map<string, object>} gameUid -> 统计数据
   */
  getStatsByGameAccount: () => {
    const { history } = get();
    const statsMap = new Map();
    const storedMetadataMap = loadGameAccountMetadataMap();

    history.forEach(h => {
      const gameUid = getHistoryGameUid(h) || 'unknown';
      const historyAccountKey = getHistoryRecordAccountKey(h) || gameUid;
      const metadata = getHistoryAccountMetadata(h, storedMetadataMap[historyAccountKey] || storedMetadataMap[gameUid]);
      const accountKey = metadata?.accountKey || historyAccountKey;
      if (!statsMap.has(accountKey)) {
        statsMap.set(accountKey, {
          accountKey,
          gameUid,
          total: 0,
          sixStars: 0,
          fiveStars: 0
        });
      }
      const stats = statsMap.get(accountKey);
      stats.total++;
      if (h.rarity === 6) stats.sixStars++;
      if (h.rarity === 5) stats.fiveStars++;
    });

    return statsMap;
  },
}));

export default useHistoryStore;
