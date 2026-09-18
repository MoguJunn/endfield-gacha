/**
 * 抽卡统计规则统一合同（STATS-007A）。
 *
 * 个人统计、卡池分析、总览分栏、分享导出等所有统计面必须从本模块取口径，
 * 不允许各页面再自行实现保底 / UP / 免费抽 / 首次获得判定，避免并行实现漂移。
 *
 * 本模块保持零依赖（纯函数），poolScopedHistory.js 在此基础上组合卡池作用域。
 */

/**
 * 各池型「一次性硬保底强制 UP」的起始付费抽数（含）。
 *
 * - 限定角色池：第 120 付费抽必出 UP，因此首个 UP 落在 >=120 即为强制。
 * - 武器池：第 8 次申领（覆盖第 71~80 付费抽）必出 UP，强制落点在区间内随机，
 *   因此首个 UP 落在 >=71 即视为强制（与 gui.cpp forced_by_hardpity 口径一致）。
 * - 无硬保底的池型返回 Infinity。
 *
 * 判定规则：按期（目标作用域）扫描付费时间线，本期「首个目标 6★」的累计付费抽数
 * 达到 floor 即标记为强制 UP（吃井）；首个目标命中后本期判定立即结束，
 * 后续命中无论抽数都不再标记（避免把自然重复命中误标为吃井）。
 */
export function getForcedUpFloor(rules) {
  const threshold = Number(rules?.guaranteedLimitedPity || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return Infinity;
  }
  const claimPity = Number(rules?.guaranteedLimitedClaimPity || 0);
  const claimSize = Number(rules?.claimSize || 0);
  if (claimPity > 0 && claimSize > 0) {
    return (claimPity - 1) * claimSize + 1;
  }
  return threshold;
}

/** 赠送记录（信物 / 自选 / 补充箱），不参与任何抽数口径。 */
export function isGiftHistoryRecord(record) {
  return record?.specialType === 'gift' || record?.special_type === 'gift';
}

/** 免费记录（免费十连等），不计费、不推进保底。兼容全部四种历史字段写法。 */
export function isFreeHistoryRecord(record) {
  return record?.isFree === true
    || record?.is_free === true
    || record?.isFreePull === true
    || record?.is_free_pull === true;
}

/** 付费记录：非赠送且非免费。保底累计、花费抽数等口径只统计付费记录。 */
export function isPaidHistoryRecord(record) {
  return !isGiftHistoryRecord(record) && !isFreeHistoryRecord(record);
}

/**
 * 手工/导入标记的保底命中（区别于从时间线推导的强制 UP）。
 * 兼容五种字段写法；统计面应统一从这里判定，不再各自枚举字段。
 */
export function isManuallyMarkedGuaranteedRecord(record) {
  return record?.specialType === 'guaranteed'
    || record?.special_type === 'guaranteed'
    || record?.isGuaranteed === true
    || record?.is_guaranteed === true
    || record?.isSpark === true
    || record?.is_spark === true;
}

/**
 * 官方导入提供的「首次获得」标记。
 *
 * 注意覆盖率：仅官方 API 导入链路稳定提供；CSV / 手工录入 / 旧数据缺省 false。
 * 需要「首次/非首次获得」口径的统计面必须在使用本标记之外，
 * 再叠加「按 (账号, 区服, 物品) 的首次出现时间」派生兜底，不能直接信任缺省值。
 */
export function isNewHistoryRecord(record) {
  return record?.isNew === true || record?.is_new === true;
}

function getRecordKey(record) {
  const value = record?.id || record?.record_id || null;
  return value == null ? null : String(value);
}

/**
 * 从一条「单期、付费、按时间升序」的时间线中收集硬保底强制 UP（吃井）记录键。
 *
 * @param {Array} timeline 付费记录时间线（调用方负责作用域与排序，
 *   例如 poolScopedHistory.buildScopedPaidHistoryTimeline(scopeType: 'target')）
 * @param {Object} options
 * @param {number} options.floor getForcedUpFloor 的结果；Infinity 时直接返回空集
 * @param {(record: Object) => boolean} options.isTargetRecord 目标 UP 判定
 * @returns {Set<string>} 被判定为强制 UP 的记录键
 */
export function collectForcedUpRecordKeysFromTimeline(timeline, { floor, isTargetRecord } = {}) {
  const keys = new Set();
  if (!Number.isFinite(floor) || floor <= 0 || typeof isTargetRecord !== 'function') {
    return keys;
  }

  let cumulativePaidPulls = 0;
  let hasReceivedTarget = false;

  for (const record of Array.isArray(timeline) ? timeline : []) {
    if (hasReceivedTarget) {
      break;
    }
    cumulativePaidPulls += 1;
    if (Number(record?.rarity) !== 6 || !isTargetRecord(record)) {
      continue;
    }
    if (cumulativePaidPulls >= floor) {
      const key = getRecordKey(record);
      if (key) {
        keys.add(key);
      }
    }
    // 本期首个目标命中后保底判定结束，无论是否吃井
    hasReceivedTarget = true;
  }

  return keys;
}

/**
 * 统一的不歪率口径：分子分母同时剔除硬保底强制 UP（真 50/50 口径）。
 * sparkCount 缺失或大于目标数时退化为原始比值，不产生负数或除零。
 */
export function calculateTargetWinRate({ targetCount, sixStarCount, sparkCount = 0 }) {
  const six = Number(sixStarCount) || 0;
  const target = Number(targetCount) || 0;
  const spark = Math.min(Math.max(Number(sparkCount) || 0, 0), target);
  const denominator = six - spark;
  const numerator = target - spark;
  if (denominator <= 0 || numerator < 0) {
    return 0;
  }
  return (numerator / denominator) * 100;
}

/**
 * 统一的「平均出货」口径：总抽数 / 命中数（total/count）。
 * 全部分统计面（个人、卡池分析、总览分栏、全服 SQL 提案）使用同一公式；
 * 分布描述统计（min/max/avg of completed intervals）不属于本口径，单独标注。
 */
export function calculateAveragePullCost(totalPulls, hitCount, decimals = 2) {
  const hits = Number(hitCount) || 0;
  if (hits <= 0) {
    return null;
  }
  return ((Number(totalPulls) || 0) / hits).toFixed(decimals);
}
