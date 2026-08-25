import { useMemo } from 'react';
import { characterCache } from '../../utils/characterUtils.js';
import { buildSummaryStats } from '../../utils/summaryStats.js';

/**
 * 统计数据计算 Hook
 * 计算本地用户的抽卡统计数据
 *
 * @param {Array} history - 抽卡历史记录
 * @param {Array} pools - 卡池列表
 * @param {Object|null} user - 当前用户
 * @returns {Object} 统计数据
 */
export function useSummaryStats(history, pools, user) {
  return useMemo(
    () => buildSummaryStats({
      history,
      pools,
      user,
      characters: characterCache.getAll()
    }),
    [history, pools, user]
  );
}

export default useSummaryStats;
