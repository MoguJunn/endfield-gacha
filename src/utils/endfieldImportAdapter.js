import { clampHistoryPity } from './historyRecordUtils';
import { calculateHistoryPity } from '../../shared/historyPity.js';

/**
 * 终末地抽卡记录导入适配器
 *
 * 用于将官方API返回的数据转换为本地数据库格式
 *
 * @author Claude
 * @version 1.0.0
 * @date 2026-01-27
 */

/**
 * 终末地API配置
 */
export const ENDFIELD_API = {
  BASE_URL: 'https://ef-webview.hypergryph.com',

  // API端点
  ENDPOINTS: {
    CHARACTER: '/api/record/char',
    WEAPON: '/api/record/weapon'
  },

  // 角色卡池类型
  CHARACTER_POOL_TYPES: {
    SPECIAL: 'E_CharacterGachaPoolType_Special',   // 限定池（特许寻访）
    JOINT: 'E_CharacterGachaPoolType_Joint',       // 附加寻访（辉光庆典）
    STANDARD: 'E_CharacterGachaPoolType_Standard', // 常驻池（基础寻访）
    BEGINNER: 'E_CharacterGachaPoolType_Beginner'  // 新手池（启程寻访）
  },

  // 默认参数
  DEFAULT_PARAMS: {
    lang: 'zh-cn',
    server_id: '1'
  }
};

/**
 * 卡池类型映射：API poolId -> 本地类型
 */
export const POOL_TYPE_MAP = {
  // 角色池
  'extra': 'extra',                    // 附加寻访（预留本地映射）
  'joint': 'extra',                    // 官方附加寻访
  'special': 'limited_character',      // 限定角色池（特许寻访）
  'standard': 'standard',              // 常驻池（基础寻访）
  'beginner': 'beginner',              // 新手池（启程寻访）

  // 武器池
  'weponbox': 'limited_weapon',        // 武器池
  'weapon': 'limited_weapon'           // 武器池备用
};

/**
 * 根据poolId推断本地卡池类型
 * @param {string} poolId - API返回的poolId (如 "special_1_0_1", "standard", "beginner")
 * @returns {string} 本地卡池类型
 */
export function mapPoolType(poolId) {
  if (!poolId) return 'unknown';

  // 提取poolId前缀
  const prefix = poolId.split('_')[0].toLowerCase();

  return POOL_TYPE_MAP[prefix] || 'unknown';
}

/**
 * 解析URL中的token
 * @param {string} url - 用户粘贴的完整URL
 * @returns {object} 解析结果 { token, serverId, success, error }
 */
export function parseTokenFromUrl(url) {
  try {
    if (!url || typeof url !== 'string') {
      return { success: false, error: '请输入有效的URL' };
    }

    // 尝试从URL中提取token
    const urlObj = new URL(url);

    // 检查域名
    if (!urlObj.hostname.includes('hypergryph.com')) {
      return { success: false, error: 'URL域名不正确，请确保是鹰角官方链接' };
    }

    // 从URL参数中获取token
    let token = urlObj.searchParams.get('token') || urlObj.searchParams.get('u8_token');

    // 如果URL参数中没有，尝试从路径中提取
    if (!token) {
      // 尝试匹配 token= 后面的内容
      const tokenMatch = url.match(/[?&](?:token|u8_token)=([^&]+)/);
      if (tokenMatch) {
        token = tokenMatch[1];
      }
    }

    if (!token) {
      return { success: false, error: '未找到token，请确保URL包含token参数' };
    }

    // 获取服务器ID
    const serverId = urlObj.searchParams.get('server_id') ||
                     urlObj.searchParams.get('server') || '1';

    return {
      success: true,
      token: token,
      serverId: serverId
    };

  } catch (error) {
    // 如果不是有效URL，尝试直接作为token使用
    if (url.length > 50) {
      return {
        success: true,
        token: url,
        serverId: '1'
      };
    }

    return { success: false, error: `URL解析失败: ${error.message}` };
  }
}

/**
 * 构建API请求URL
 * @param {string} endpoint - API端点
 * @param {object} params - 请求参数
 * @returns {string} 完整的API URL
 */
export function buildApiUrl(endpoint, params) {
  const url = new URL(endpoint, ENDFIELD_API.BASE_URL);

  // 添加默认参数
  Object.entries(ENDFIELD_API.DEFAULT_PARAMS).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  // 添加自定义参数
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

/**
 * 将API返回的单条记录转换为本地格式
 * @param {object} apiRecord - API返回的原始记录
 * @param {string} recordType - 记录类型 ('character' | 'weapon')
 * @returns {object} 本地格式的记录
 */
export function convertRecord(apiRecord, recordType = 'character') {
  const {
    poolId,
    poolName,
    charId,
    charName,
    weaponId,
    weaponName,
    rarity,
    isFree,
    isNew,
    gachaTs,
    seqId
  } = apiRecord;

  // 确定名称和ID（角色或武器）
  const itemName = charName || weaponName || '未知';
  const itemId = charId || weaponId || '';

  // 确定卡池类型
  const localPoolType = mapPoolType(poolId);

  // 判断是否限定
  const isLimited = localPoolType === 'extra' ||
                    localPoolType === 'limited_character' ||
                    localPoolType === 'limited_weapon';

  return {
    // 基础信息
    name: itemName,
    character_name: itemName,
    item_id: itemId,

    // 稀有度（API直接返回4/5/6，无需转换）
    rarity: rarity,

    // 时间戳（API返回毫秒级字符串，转为数字）
    timestamp: parseInt(gachaTs, 10),

    // 卡池信息
    pool: localPoolType,
    pool_id: poolId,
    pool_name: poolName,

    // 状态标记
    isNew: isNew || false,
    isFree: isFree || false,
    isLimited: isLimited,

    // 序列ID（用于去重和排序）
    seqId: seqId,

    // 记录类型
    recordType: recordType
  };
}

/**
 * 批量转换API记录
 * @param {Array} apiRecords - API返回的记录数组
 * @param {string} recordType - 记录类型
 * @returns {Array} 转换后的记录数组
 */
export function convertRecords(apiRecords, recordType = 'character') {
  if (!Array.isArray(apiRecords)) {
    return [];
  }

  return apiRecords.map(record => convertRecord(record, recordType));
}

/**
 * 生成导入摘要
 * @param {Array} records - 转换后的记录数组
 * @returns {object} 导入摘要
 */
export function generateImportSummary(records) {
  const summary = {
    total: records.length,
    byRarity: { 4: 0, 5: 0, 6: 0 },
    byPool: {},
    byPoolType: {},
    sixStars: [],
    fiveStars: []
  };

  records.forEach(record => {
    // 按稀有度统计
    if (summary.byRarity[record.rarity] !== undefined) {
      summary.byRarity[record.rarity]++;
    }

    // 按卡池ID统计
    const poolKey = record.pool_name || record.pool_id || 'unknown';
    summary.byPool[poolKey] = (summary.byPool[poolKey] || 0) + 1;

    // 按卡池类型统计
    summary.byPoolType[record.pool] = (summary.byPoolType[record.pool] || 0) + 1;

    // 收集高星角色
    if (record.rarity === 6) {
      summary.sixStars.push(record);
    } else if (record.rarity === 5) {
      summary.fiveStars.push(record);
    }
  });

  return summary;
}

/**
 * 去重：基于 seqId 去重（seqId是全局唯一的）
 * @param {Array} newRecords - 新导入的记录
 * @param {Array} existingRecords - 已存在的记录
 * @returns {Array} 去重后的新记录
 */
export function deduplicateBySeqId(newRecords, existingRecords) {
  const existingSeqIds = new Set(
    existingRecords.map(r => r.seqId).filter(Boolean)
  );

  return newRecords.filter(record => {
    if (!record.seqId) return true; // 没有seqId的记录保留
    return !existingSeqIds.has(record.seqId);
  });
}

/**
 * 去重：基于 timestamp + name 去重（兼容旧数据）
 * @param {Array} newRecords - 新导入的记录
 * @param {Array} existingRecords - 已存在的记录
 * @returns {Array} 去重后的新记录
 */
export function deduplicateByTimestampName(newRecords, existingRecords) {
  const existingKeys = new Set(
    existingRecords.map(r => `${r.timestamp}_${r.name || r.character_name}`)
  );

  return newRecords.filter(record => {
    const key = `${record.timestamp}_${record.name}`;
    return !existingKeys.has(key);
  });
}

/**
 * 计算保底进度
 * 需要按时间顺序处理记录，计算每条记录的保底计数
 * @param {Array} records - 记录数组（应按时间升序排序）
 * @param {string} poolType - 卡池类型
 * @returns {Array} 带有pity字段的记录数组
 */
export function calculatePity(records, _poolType) {
  return calculateHistoryPity(records);
}

/**
 * 为记录分配批次ID（十连为一组）
 * @param {Array} records - 记录数组
 * @returns {Array} 带有batchId字段的记录数组
 */
export function assignBatchIds(records) {
  // 按时间戳分组（相同时间戳的记录为同一批次）
  const timestampGroups = new Map();

  records.forEach(record => {
    const ts = record.timestamp;
    if (!timestampGroups.has(ts)) {
      timestampGroups.set(ts, []);
    }
    timestampGroups.get(ts).push(record);
  });

  // 为每个批次分配ID
  let batchIndex = 0;
  const result = [];

  // 按时间戳排序
  const sortedTimestamps = Array.from(timestampGroups.keys()).sort((a, b) => a - b);

  sortedTimestamps.forEach(ts => {
    const batch = timestampGroups.get(ts);
    const batchId = `batch_${ts}_${batchIndex}`;

    batch.forEach(record => {
      result.push({
        ...record,
        batchId: batchId
      });
    });

    batchIndex++;
  });

  return result;
}

/**
 * 转换为数据库存储格式
 * @param {Array} records - 转换后的记录数组
 * @param {string} userId - 用户ID
 * @returns {Array} 数据库格式的记录数组
 */
export function toDbFormat(records, userId) {
  return records.map(record => ({
    id: `record_${record.timestamp}_${record.seqId || Math.random().toString(36).substr(2, 9)}`,
    user_id: userId,
    pool_id: record.pool_id,
    pool_type: record.pool,
    character_name: record.name,
    item_id: record.item_id,
    rarity: record.rarity,
    timestamp: record.timestamp,
    batch_id: record.batchId,
    pity: clampHistoryPity(record.pity),
    is_new: record.isNew,
    is_free: record.isFree,
    is_limited: record.isLimited,
    seq_id: record.seqId,
    record_type: record.recordType,
    created_at: new Date().toISOString()
  }));
}

export default {
  ENDFIELD_API,
  POOL_TYPE_MAP,
  parseTokenFromUrl,
  buildApiUrl,
  convertRecord,
  convertRecords,
  generateImportSummary,
  deduplicateBySeqId,
  deduplicateByTimestampName,
  calculatePity,
  assignBatchIds,
  toDbFormat,
  mapPoolType
};
