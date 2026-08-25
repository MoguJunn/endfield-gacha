/**
 * 模拟器状态持久化工具
 *
 * 管理模拟器状态的浏览器存储和导出
 */

import { DEFAULT_SIMULATOR_RESOURCE_SETTINGS, normalizeResourceSettings } from './resourceEconomy.js';
import appLogger from './appLogger.js';
import {
  STORAGE_KEYS,
  readBooleanStorageValue,
  readStorageValue,
  removeStorageValue,
  writeBooleanStorageValue,
  writeStorageValue,
} from './storageUtils.js';

const STORAGE_KEY = 'gacha_simulator_state';
const SHARED_PITY_KEY = 'gacha_simulator_shared_pity'; // 限定池共享保底
const SERIES_STATE_KEY = 'gacha_simulator_series_state'; // profile + seriesKey 隔离的系列状态
const INFO_BOOK_KEY = 'gacha_simulator_info_book'; // 情报书状态（全局）
const RESOURCE_SETTINGS_KEY = 'gacha_simulator_resource_settings';
const CURRENT_POOL_KEY = 'simulator_currentPoolId';
const LEGACY_SCOPE_MIGRATION_KEY = 'gacha_simulator_scope_migrated_v2';
const STORAGE_VERSION = '1.0';

function normalizeScopePart(value, fallback) {
  const normalizedValue = value === null || value === undefined || value === '' ? fallback : String(value);
  return encodeURIComponent(normalizedValue);
}

function getScopedStorageKey(baseKey, scope) {
  return scope ? `${baseKey}__${scope}` : baseKey;
}

export function buildSimulatorStorageScope({ currentUserId = null, currentGameUid = null } = {}) {
  const userPart = normalizeScopePart(currentUserId, 'guest');
  const gamePart = normalizeScopePart(currentGameUid, 'all');
  return `u:${userPart}|g:${gamePart}`;
}

export function getSimulatorCurrentPoolStorageKey(scope = null) {
  return getScopedStorageKey(CURRENT_POOL_KEY, scope);
}

export function loadSimulatorCurrentPoolId(scope = null) {
  return readStorageValue(getSimulatorCurrentPoolStorageKey(scope), null, { raw: true });
}

export function saveSimulatorCurrentPoolId(poolId, scope = null) {
  if (!poolId) {
    return clearSimulatorCurrentPoolId(scope);
  }

  return writeStorageValue(getSimulatorCurrentPoolStorageKey(scope), poolId, { raw: true });
}

export function clearSimulatorCurrentPoolId(scope = null) {
  return removeStorageValue(getSimulatorCurrentPoolStorageKey(scope), { raw: true });
}

export function loadSimulatorSkipAnimationPreference() {
  return readBooleanStorageValue(STORAGE_KEYS.SIMULATOR_SKIP_ANIMATION, false, { raw: true });
}

export function saveSimulatorSkipAnimationPreference(value) {
  return writeBooleanStorageValue(STORAGE_KEYS.SIMULATOR_SKIP_ANIMATION, value, { raw: true });
}

export function clearSimulatorSkipAnimationPreference() {
  return removeStorageValue(STORAGE_KEYS.SIMULATOR_SKIP_ANIMATION, { raw: true });
}

export function clearSimulatorMultipleFreeTenPreference() {
  return removeStorageValue(STORAGE_KEYS.SIMULATOR_MULTIPLE_FREE_TEN, { raw: true });
}

export function loadSimulatorOriginitePromptSuppressDate() {
  return readStorageValue(STORAGE_KEYS.SIMULATOR_ORIGINITE_PROMPT_SUPPRESS_DATE, null, { raw: true });
}

export function saveSimulatorOriginitePromptSuppressDate(value) {
  if (!value) {
    return clearSimulatorOriginitePromptSuppressDate();
  }

  return writeStorageValue(STORAGE_KEYS.SIMULATOR_ORIGINITE_PROMPT_SUPPRESS_DATE, value, { raw: true });
}

export function clearSimulatorOriginitePromptSuppressDate() {
  return removeStorageValue(STORAGE_KEYS.SIMULATOR_ORIGINITE_PROMPT_SUPPRESS_DATE, { raw: true });
}

export function migrateLegacySimulatorStorageToScope({
  scope = null,
  poolIds = []
} = {}) {
  if (!scope || localStorage.getItem(LEGACY_SCOPE_MIGRATION_KEY) === '1') {
    return false;
  }

  let migrated = false;

  const migrateKey = (legacyKey, scopedKey) => {
    const legacyValue = localStorage.getItem(legacyKey);
    if (!legacyValue || localStorage.getItem(scopedKey)) {
      return;
    }

    localStorage.setItem(scopedKey, legacyValue);
    migrated = true;
  };

  poolIds.forEach((poolId) => {
    migrateKey(`${STORAGE_KEY}_${poolId}`, getScopedStorageKey(`${STORAGE_KEY}_${poolId}`, scope));
  });

  migrateKey(SHARED_PITY_KEY, getScopedStorageKey(SHARED_PITY_KEY, scope));
  migrateKey(INFO_BOOK_KEY, getScopedStorageKey(INFO_BOOK_KEY, scope));
  migrateKey(RESOURCE_SETTINGS_KEY, getScopedStorageKey(RESOURCE_SETTINGS_KEY, scope));
  migrateKey(CURRENT_POOL_KEY, getScopedStorageKey(CURRENT_POOL_KEY, scope));

  if (migrated) {
    localStorage.setItem(LEGACY_SCOPE_MIGRATION_KEY, '1');
  }

  return migrated;
}

/**
 * 保存模拟器状态到 localStorage
 * @param {string} poolType - 卡池类型
 * @param {Object} state - 模拟器状态
 */
export function saveSimulatorState(poolType, state, scope = null) {
  try {
    const storageData = {
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      poolType,
      state
    };
    localStorage.setItem(getScopedStorageKey(`${STORAGE_KEY}_${poolType}`, scope), JSON.stringify(storageData));
    return true;
  } catch (error) {
    appLogger.error('保存模拟器状态失败:', error);
    return false;
  }
}

/**
 * 从 localStorage 加载模拟器状态
 * @param {string} poolType - 卡池类型
 * @returns {Object|null} 模拟器状态或null
 */
export function loadSimulatorState(poolType, scope = null) {
  try {
    const data = localStorage.getItem(getScopedStorageKey(`${STORAGE_KEY}_${poolType}`, scope));
    if (!data) return null;

    const storageData = JSON.parse(data);

    // 版本检查
    if (storageData.version !== STORAGE_VERSION) {
      appLogger.warn('存储版本不匹配，清除旧数据');
      clearSimulatorState(poolType, scope);
      return null;
    }

    return storageData.state;
  } catch (error) {
    appLogger.error('加载模拟器状态失败:', error);
    return null;
  }
}

/**
 * 清除指定卡池的存储数据
 * @param {string} poolType - 卡池类型
 */
export function clearSimulatorState(poolType, scope = null) {
  try {
    localStorage.removeItem(getScopedStorageKey(`${STORAGE_KEY}_${poolType}`, scope));
    return true;
  } catch (error) {
    appLogger.error('清除模拟器状态失败:', error);
    return false;
  }
}

/**
 * 清除所有卡池的存储数据
 */
export function clearAllSimulatorStates(scope = null) {
  const poolTypes = ['limited', 'extra', 'weapon', 'standard'];
  poolTypes.forEach(type => clearSimulatorState(type, scope));
}

/**
 * 将模拟器历史记录转换为可导入格式
 * @param {Array} pullHistory - 模拟器的抽卡历史
 * @param {string} poolId - 模拟池ID（sim_xxx格式）
 * @param {string} poolType - 卡池类型（limited/weapon/standard）
 * @returns {Array} 可导入的记录列表
 */
export function convertSimulatorHistoryToImportFormat(pullHistory, poolId, poolType) {
  if (!pullHistory || pullHistory.length === 0) {
    return [];
  }

  // 将卡池类型转换为导入系统需要的格式
  const poolTypeMap = {
    'extra': 'extra',
    'limited': 'limited_character',
    'weapon': 'limited_weapon',
    'standard': 'standard'
  };
  const importPoolType = poolTypeMap[poolType] || 'limited_character';

  return pullHistory.map(record => ({
    pool: importPoolType,  // 使用标准卡池类型而非模拟池ID
    name: record.characterName || record.name || `${record.rarity}星角色`,
    rarity: record.rarity,
    timestamp: record.timestamp || Date.now(),
    isLimited: record.isUp || false,  // 是否为限定角色（UP角色视为限定）
    isSimulated: true  // 标记为模拟器数据
  }));
}

/**
 * 导出模拟器数据为JSON格式（可导入）
 * @param {Array} pullHistory - 模拟器的抽卡历史
 * @param {string} poolId - 模拟池ID
 * @param {string} poolType - 卡池类型（limited/weapon/standard）
 * @returns {string} JSON字符串
 */
export function exportSimulatorDataAsJSON(pullHistory, poolId, poolType) {
  const importData = convertSimulatorHistoryToImportFormat(pullHistory, poolId, poolType);
  return JSON.stringify(importData, null, 2);
}

/**
 * 导出模拟器数据为CSV格式（可导入）
 * @param {Array} pullHistory - 模拟器的抽卡历史
 * @param {string} poolId - 模拟池ID
 * @param {string} poolType - 卡池类型（limited/weapon/standard）
 * @returns {string} CSV字符串
 */
export function exportSimulatorDataAsCSV(pullHistory, poolId, poolType) {
  const importData = convertSimulatorHistoryToImportFormat(pullHistory, poolId, poolType);

  if (importData.length === 0) {
    return 'pool,name,rarity,timestamp,isLimited,isSimulated\n';
  }

  // CSV 表头
  const headers = ['pool', 'name', 'rarity', 'timestamp', 'isLimited', 'isSimulated'];
  let csv = headers.join(',') + '\n';

  // CSV 数据行
  importData.forEach(record => {
    const row = headers.map(header => {
      const value = record[header];
      // 处理包含逗号的字段，用双引号包裹
      if (typeof value === 'string' && value.includes(',')) {
        return `"${value}"`;
      }
      return value;
    });
    csv += row.join(',') + '\n';
  });

  return csv;
}

/**
 * 下载模拟器数据（JSON或CSV格式）
 * @param {Array} pullHistory - 模拟器的抽卡历史
 * @param {string} poolId - 模拟池ID
 * @param {string} poolName - 卡池名称
 * @param {string} poolType - 卡池类型（limited/weapon/standard）
 * @param {string} format - 格式（'json' 或 'csv'）
 */
export function downloadSimulatorData(pullHistory, poolId, poolName, poolType, format = 'json') {
  let content, mimeType, extension;

  if (format === 'csv') {
    content = exportSimulatorDataAsCSV(pullHistory, poolId, poolType);
    mimeType = 'text/csv;charset=utf-8;';
    extension = 'csv';
  } else {
    content = exportSimulatorDataAsJSON(pullHistory, poolId, poolType);
    mimeType = 'application/json';
    extension = 'json';
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const sanitizedPoolName = poolName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const filename = `终末地模拟器_${sanitizedPoolName}_${timestamp}.${extension}`;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 导出模拟器分析报告为JSON
 * @param {Object} stats - 统计数据
 * @param {Object} pityInfo - 保底信息
 * @param {string} poolType - 卡池类型
 * @returns {string} JSON字符串
 */
export function exportAnalysisReport(stats, pityInfo, poolType) {
  const report = {
    exportTime: new Date().toISOString(),
    version: STORAGE_VERSION,
    poolType,
    summary: {
      totalPulls: stats.totalPulls,
      sixStarCount: stats.sixStarCount,
      fiveStarCount: stats.fiveStarCount,
      upSixStarCount: stats.upSixStarCount,
      sixStarRate: stats.sixStarRate,
      fiveStarRate: stats.fiveStarRate,
      upRate: stats.upRate,
      avgPullsPerSixStar: stats.avgPullsPerSixStar,
      expectedPulls: stats.expectedPulls
    },
    pityStatus: {
      sixStarPity: pityInfo.sixStar.current,
      fiveStarPity: pityInfo.fiveStar.current,
      guaranteedUpPity: pityInfo.guaranteedUp?.current || 0,
      isGuaranteedUp: pityInfo.guaranteedUp?.isActive || false
    },
    giftProgress: stats.gifts,
    hasReceivedInfoBook: stats.hasReceivedInfoBook,
    hasReceivedSelectGift: stats.hasReceivedSelectGift,
    sixStarHistory: stats.sixStarHistory.map(record => ({
      pullNumber: record.pullNumber,
      isUp: record.isUp,
      isLimited: record.isLimited,
      pityWhenPulled: record.pityWhenPulled,
      timestamp: record.timestamp
    }))
  };

  return JSON.stringify(report, null, 2);
}

/**
 * 下载JSON文件
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 */
export function downloadJSON(content, filename) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 导出分析报告并下载
 * @param {Object} stats - 统计数据
 * @param {Object} pityInfo - 保底信息
 * @param {string} poolType - 卡池类型
 */
export function downloadAnalysisReport(stats, pityInfo, poolType) {
  const report = exportAnalysisReport(stats, pityInfo, poolType);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const poolName = poolType === 'extra'
    ? '附加寻访'
    : poolType === 'limited'
      ? '限定池'
      : poolType === 'weapon'
        ? '武器池'
        : '常驻池';
  const filename = `终末地模拟器报告_${poolName}_${timestamp}.json`;

  downloadJSON(report, filename);
}

/**
 * 生成可分享的文本摘要
 * @param {Object} stats - 统计数据
 * @param {string} poolType - 卡池类型
 * @returns {string} 文本摘要
 */
export function generateShareText(stats, poolType) {
  const poolName = poolType === 'extra'
    ? '附加寻访'
    : poolType === 'limited'
      ? '限定寻访'
      : poolType === 'weapon'
        ? '武器寻访'
        : '常驻寻访';

  let text = `【终末地 ${poolName} 模拟报告】\n\n`;
  text += `📊 总抽数: ${stats.totalPulls}\n`;
  text += `⭐ 6星数量: ${stats.sixStarCount} (${stats.sixStarRate}%)\n`;
  text += `⭐ 5星数量: ${stats.fiveStarCount} (${stats.fiveStarRate}%)\n`;

  if (poolType !== 'standard') {
    text += `🎯 UP 6星: ${stats.upSixStarCount} (不歪率: ${stats.upRate}%)\n`;
  }

  text += `📈 平均出货: ${stats.avgPullsPerSixStar} 抽/UP\n`;
  text += `🎲 期望抽数: ${stats.expectedPulls} 抽\n\n`;

  // 赠送进度
  if ((poolType === 'limited' || poolType === 'extra') && stats.gifts.count > 0) {
    text += `🎁 已领赠送: ${stats.gifts.count} 次 (每240抽)\n`;
  } else if (poolType === 'weapon') {
    text += `🎁 已领赠送: 常驻×${stats.gifts.standardCount} 限定×${stats.gifts.limitedCount}\n`;
  } else if (poolType === 'standard' && stats.hasReceivedSelectGift) {
    text += `🎁 已领自选6星 (300抽)\n`;
  }

  if (stats.hasReceivedInfoBook) {
    text += `📖 已获取情报书 (60抽)\n`;
  }

  text += `\n🔗 终末地抽卡分析器 - 模拟器功能`;

  return text;
}

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>} 是否成功
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级方案
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (fallbackError) {
      appLogger.error('复制到剪贴板失败:', fallbackError);
      return false;
    }
  }
}

/**
 * 保存限定池共享保底状态
 * @param {Object} pityState - 保底状态
 */
export function saveSharedPityState(pityState, scope = null) {
  try {
    const storageData = {
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      pityState
    };
    localStorage.setItem(getScopedStorageKey(SHARED_PITY_KEY, scope), JSON.stringify(storageData));
    return true;
  } catch (error) {
    appLogger.error('保存共享保底状态失败:', error);
    return false;
  }
}

/**
 * 加载限定池共享保底状态
 * @returns {Object|null} 保底状态或null
 */
export function loadSharedPityState(scope = null) {
  try {
    const data = localStorage.getItem(getScopedStorageKey(SHARED_PITY_KEY, scope));
    if (!data) return null;

    const storageData = JSON.parse(data);

    // 版本检查
    if (storageData.version !== STORAGE_VERSION) {
      appLogger.warn('共享保底版本不匹配，清除旧数据');
      clearSharedPityState(scope);
      return null;
    }

    return storageData.pityState;
  } catch (error) {
    appLogger.error('加载共享保底状态失败:', error);
    return null;
  }
}

/**
 * 清除限定池共享保底状态
 */
export function clearSharedPityState(scope = null) {
  try {
    localStorage.removeItem(getScopedStorageKey(SHARED_PITY_KEY, scope));
    return true;
  } catch (error) {
    appLogger.error('清除共享保底状态失败:', error);
    return false;
  }
}

export function getSimulatorSeriesStateStorageKey(seriesStateKey, scope = null) {
  if (!seriesStateKey) {
    return null;
  }
  return getScopedStorageKey(`${SERIES_STATE_KEY}_${seriesStateKey}`, scope);
}

export function saveSimulatorSeriesState(seriesStateKey, seriesState, scope = null) {
  const storageKey = getSimulatorSeriesStateStorageKey(seriesStateKey, scope);
  if (!storageKey || !seriesState) {
    return false;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify({
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      seriesState,
    }));
    return true;
  } catch (error) {
    appLogger.error('保存系列模拟状态失败:', error);
    return false;
  }
}

export function loadSimulatorSeriesState(seriesStateKey, scope = null) {
  const storageKey = getSimulatorSeriesStateStorageKey(seriesStateKey, scope);
  if (!storageKey) {
    return null;
  }

  try {
    const data = localStorage.getItem(storageKey);
    if (!data) {
      return null;
    }

    const storageData = JSON.parse(data);
    if (storageData.version !== STORAGE_VERSION) {
      clearSimulatorSeriesState(seriesStateKey, scope);
      return null;
    }
    return storageData.seriesState || null;
  } catch (error) {
    appLogger.error('加载系列模拟状态失败:', error);
    return null;
  }
}

export function clearSimulatorSeriesState(seriesStateKey, scope = null) {
  const storageKey = getSimulatorSeriesStateStorageKey(seriesStateKey, scope);
  if (!storageKey) {
    return false;
  }

  try {
    localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    appLogger.error('清除系列模拟状态失败:', error);
    return false;
  }
}

/**
 * 保存情报书状态（全局，使用映射表）
 * @param {Object} infoBooks - 情报书映射表 { [poolId]: { activated, used, targetPoolId, obtainedAt } }
 */
export function saveInfoBookState(infoBooks, scope = null) {
  try {
    const storageData = {
      version: '2.0',
      timestamp: Date.now(),
      infoBooks
    };
    localStorage.setItem(getScopedStorageKey(INFO_BOOK_KEY, scope), JSON.stringify(storageData));
    return true;
  } catch (error) {
    appLogger.error('保存情报书状态失败:', error);
    return false;
  }
}

/**
 * 加载情报书状态（全局）
 * @returns {Object} 情报书映射表或空对象
 */
export function loadInfoBookState(scope = null) {
  try {
    const data = localStorage.getItem(getScopedStorageKey(INFO_BOOK_KEY, scope));
    if (!data) return {};

    const storageData = JSON.parse(data);

    // 版本检查和迁移
    if (storageData.version === '2.0') {
      return storageData.infoBooks || {};
    }

    // 旧版本数据，清除
    appLogger.warn('情报书状态版本不匹配，清除旧数据');
    clearInfoBookState(scope);
    return {};
  } catch (error) {
    appLogger.error('加载情报书状态失败:', error);
    return {};
  }
}

/**
 * 清除情报书状态
 */
export function clearInfoBookState(scope = null) {
  try {
    localStorage.removeItem(getScopedStorageKey(INFO_BOOK_KEY, scope));
    return true;
  } catch (error) {
    appLogger.error('清除情报书状态失败:', error);
    return false;
  }
}

/**
 * 保存模拟器资源设置（全局）
 * @param {Object} settings - 资源设置
 */
export function saveSimulatorResourceSettings(settings, scope = null) {
  try {
    const storageData = {
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      settings: normalizeResourceSettings(settings)
    };
    localStorage.setItem(getScopedStorageKey(RESOURCE_SETTINGS_KEY, scope), JSON.stringify(storageData));
    return true;
  } catch (error) {
    appLogger.error('保存模拟器资源设置失败:', error);
    return false;
  }
}

/**
 * 加载模拟器资源设置（全局）
 * @returns {Object} 资源设置
 */
export function loadSimulatorResourceSettings(scope = null) {
  try {
    const data = localStorage.getItem(getScopedStorageKey(RESOURCE_SETTINGS_KEY, scope));
    if (!data) {
      return { ...DEFAULT_SIMULATOR_RESOURCE_SETTINGS };
    }

    const storageData = JSON.parse(data);
    if (storageData.version !== STORAGE_VERSION) {
      clearSimulatorResourceSettings(scope);
      return { ...DEFAULT_SIMULATOR_RESOURCE_SETTINGS };
    }

    return normalizeResourceSettings(storageData.settings);
  } catch (error) {
    appLogger.error('加载模拟器资源设置失败:', error);
    return { ...DEFAULT_SIMULATOR_RESOURCE_SETTINGS };
  }
}

/**
 * 清除模拟器资源设置
 */
export function clearSimulatorResourceSettings(scope = null) {
  try {
    localStorage.removeItem(getScopedStorageKey(RESOURCE_SETTINGS_KEY, scope));
    return true;
  } catch (error) {
    appLogger.error('清除模拟器资源设置失败:', error);
    return false;
  }
}

export default {
  buildSimulatorStorageScope,
  getSimulatorCurrentPoolStorageKey,
  loadSimulatorCurrentPoolId,
  saveSimulatorCurrentPoolId,
  clearSimulatorCurrentPoolId,
  loadSimulatorSkipAnimationPreference,
  saveSimulatorSkipAnimationPreference,
  clearSimulatorSkipAnimationPreference,
  clearSimulatorMultipleFreeTenPreference,
  loadSimulatorOriginitePromptSuppressDate,
  saveSimulatorOriginitePromptSuppressDate,
  clearSimulatorOriginitePromptSuppressDate,
  migrateLegacySimulatorStorageToScope,
  saveSimulatorState,
  loadSimulatorState,
  clearSimulatorState,
  clearAllSimulatorStates,
  saveSharedPityState,
  loadSharedPityState,
  clearSharedPityState,
  saveInfoBookState,
  loadInfoBookState,
  clearInfoBookState,
  saveSimulatorResourceSettings,
  loadSimulatorResourceSettings,
  clearSimulatorResourceSettings,
  convertSimulatorHistoryToImportFormat,
  exportSimulatorDataAsJSON,
  exportSimulatorDataAsCSV,
  downloadSimulatorData,
  exportAnalysisReport,
  downloadJSON,
  downloadAnalysisReport,
  generateShareText,
  copyToClipboard
};
