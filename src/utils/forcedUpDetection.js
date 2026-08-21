/**
 * 硬保底强制 UP 识别（统一各统计面的口径）
 *
 * 终末地三类卡池的「UP 硬保底」阈值（每期独立、仅生效一次、不计入免费十连）：
 *   - 限定角色池 (limited)：本期累计第 120 抽强制出 UP
 *   - 武器池 (weapon)：第 8 申领（第 71~80 抽）强制出概率提升武器
 *   - 辉光庆典 (extra) / 常驻 (standard)：无 UP 硬保底
 *
 * 由硬保底「强制」产生的那个 UP 不是一次独立判定，因此：
 *   - 不计入不歪率（win rate）的分子/分母
 *   - 不计入「排除保底」的平均出货 UP 计数
 * 这与参考算法 gui.cpp 的 forced_by_hardpity（!got_up_banner && pity_since_last_up >= hardpity_n）
 * 一致：每期第一个 UP，且其出现时累计抽数已达硬保底阈值，即视为强制（spark）。
 *
 * 历史问题：此前仅限定池计算了 120 spark，武器池的 80 硬保底强制 UP 从未被剔除，
 * 导致武器 UP 条件率被系统性抬高于真实 25%；且总览分栏页（dashboard）连限定 120
 * spark 都没算。本模块把阈值集中到一处，供三个统计面共用，消除口径漂移。
 */

const HARD_PITY_FLOOR = {
  limited: 120, // 角色限定：第 120 抽硬保底
  weapon: 71,   // 武器：第 8 申领（71~80 抽）硬保底，下限 71
};

/**
 * 返回该池型 UP 硬保底的「触发下限抽数」；无 UP 硬保底的池型返回 Infinity。
 * @param {string} poolType - 归一化池型：'limited' | 'weapon' | 'extra' | 'standard'
 * @returns {number}
 */
export function getHardPityFloor(poolType) {
  const floor = HARD_PITY_FLOOR[poolType];
  return typeof floor === 'number' ? floor : Infinity;
}

/**
 * 扫描单一卡池（单期）的抽卡历史，返回「硬保底强制 UP」记录的 key 集合。
 *
 * 本函数按「单期」处理：累计抽数不跨期。池组聚合（多期）应由调用方按 poolId 分期、
 * 逐期调用本函数再合并结果（见 usePoolStats 的 buildForcedUpRecordKeysForPool）；
 * 若直接以 isGroupMode=true 传入多期合并历史，则跨期累计无意义，返回空集以示拒绝。
 * gift / 免费十连不计入累计抽数（与游戏机制及保底通道一致）。
 *
 * @param {Object} params
 * @param {Array}    params.history       - 该池历史（调用方保证为时间序）
 * @param {Function} params.getPoolType   - (pull) => 归一化池型
 * @param {Function} params.isUp          - (pull, poolType) => 是否为目标/UP 六星
 * @param {Function} params.getRecordKey  - (pull) => 唯一记录 key（用于回查）
 * @param {Function} params.isExcluded    - (pull) => 是否为 gift/免费抽（不计入累计）
 * @param {boolean}  [params.isGroupMode] - 池组聚合模式则跳过
 * @returns {Set<string>}
 */
export function buildForcedUpRecordKeys({
  history = [],
  getPoolType,
  isUp,
  getRecordKey,
  isExcluded,
  isGroupMode = false,
}) {
  const keys = new Set();
  if (isGroupMode || !Array.isArray(history)) {
    return keys;
  }

  let cumulativePullCount = 0;
  let hasGotUpBefore = false;

  history.forEach((pull) => {
    if (isExcluded(pull)) {
      return;
    }
    cumulativePullCount += 1;

    if (Number(pull?.rarity) !== 6) {
      return;
    }

    const poolType = getPoolType(pull);
    const floor = getHardPityFloor(poolType);
    if (!Number.isFinite(floor)) {
      return; // 无 UP 硬保底（extra / standard）
    }

    const up = isUp(pull, poolType);
    if (up && !hasGotUpBefore && cumulativePullCount >= floor) {
      const recordKey = getRecordKey(pull);
      if (recordKey) {
        keys.add(recordKey);
      }
    }
    if (up && cumulativePullCount < floor) {
      hasGotUpBefore = true;
    }
  });

  return keys;
}

export default {
  getHardPityFloor,
  buildForcedUpRecordKeys,
};
