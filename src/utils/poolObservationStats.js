/**
 * 分池观测统计 v3。首次固定为本期卡池内首次，不猜测来源字段。
 * 见 docs/STATS_OBSERVATION_CONTRACT.md；保存记录由 storedPoolObservations 适配。
 */
export const OBSERVATION_RULE_VERSION = 'pool-observation-v3';
const KINDS = new Set(['pull', 'free', 'infoBook', 'gift']);

function summarizeCosts(frequencies) {
  let sampleCount = 0;
  let sum = 0;
  for (const [cost, count] of frequencies) { sampleCount += count; sum += cost * count; }
  let cumulative = 0;
  const points = [...frequencies].sort(([a], [b]) => a - b).map(([cost, count]) => {
    cumulative += count;
    return { cost, count, cumulativeRate: cumulative / sampleCount };
  });
  return {
    sampleCount,
    mean: sampleCount ? sum / sampleCount : null,
    points,
  };
}

/**
 * records: {id, accountKey, poolId, itemId, rarity, timestamp, sequence,
 *           kind: pull|free|infoBook|gift, newItem: true|false|null}[]
 * itemId=null 表示对象不明的有效记录：计入总数、星级与间隔，不归入具体对象。
 * completeAccounts: 当前 poolId 从开池以来记录完整的 accountKey[]。
 * firstBasis: stored-period 从首条保存记录计数；verified-prefix 要求完整前缀证据。
 * accountKey=null 表示聚合输入内的账号，仍先逐账号计算。
 */
export function buildPoolObservations({
  records, poolId, accountKey = null, completeAccounts = [], firstBasis = 'verified-prefix',
}) {
  if (!['verified-prefix', 'stored-period'].includes(firstBasis)) throw new Error('Invalid first acquisition basis');
  const complete = new Set(completeAccounts);
  const byAccount = new Map();
  const seen = new Map();
  for (const record of records) {
    if (!record.accountKey || !record.poolId || (!record.itemId && record.itemId !== null) || !record.id
      || !KINDS.has(record.kind) || !Number.isFinite(record.timestamp)
      || !Number.isInteger(record.sequence) || ![4, 5, 6].includes(record.rarity)
      || ![true, false, null].includes(record.newItem)) {
      throw new Error('Observation records must have normalized identity, order and kind');
    }
    if (!seen.has(record.accountKey)) seen.set(record.accountKey, new Set());
    const accountSeen = seen.get(record.accountKey);
    if (accountSeen.has(record.id)) throw new Error('Duplicate observation record');
    accountSeen.add(record.id);
    if (accountKey !== null && record.accountKey !== accountKey) continue;
    if (!byAccount.has(record.accountKey)) byAccount.set(record.accountKey, []);
    byAccount.get(record.accountKey).push(record);
  }

  const items = new Map();
  seen.clear();
  const obtainingAccounts = new Map();
  const rarityCounts = new Map();
  let total = 0;
  let free = 0;
  let infoBook = 0;
  let resources = 0;
  let participatingAccounts = 0;
  let incompleteAccounts = 0;
  const ensureItem = (record) => {
    if (!items.has(record.itemId)) items.set(record.itemId, {
      itemId: record.itemId, rarity: record.rarity, count: 0,
      first: new Map(), repeat: new Map(), unknownClassification: 0, unknownCost: 0,
      repeatUnfinished: 0,
    });
    return items.get(record.itemId);
  };

  for (const [key, accountRecords] of byAccount) {
    // Buckets are owned by this calculation; sorting them does not mutate input.
    const timeline = accountRecords.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
    const hasPoolRecords = timeline.some((row) => row.poolId === poolId && row.kind !== 'gift');
    if (!hasPoolRecords) continue;
    participatingAccounts++;
    if (!complete.has(key)) incompleteAccounts++;
    const periods = new Map();
    for (const record of timeline) {
      if (record.poolId === poolId && record.kind !== 'gift') {
        const periodKey = record.poolVersion ?? null;
        if (!periods.has(periodKey)) periods.set(periodKey, { previous: new Map(), lastUnidentified: new Map(), pullCount: 0 });
        const period = periods.get(periodKey);
        const { previous, lastUnidentified } = period;
        const pullCount = ++period.pullCount;
        total++;
        if (record.kind === 'free') free++;
        else if (record.kind === 'infoBook') infoBook++;
        else resources++;
        rarityCounts.set(record.rarity, (rarityCounts.get(record.rarity) || 0) + 1);
        if (record.itemId === null) {
          lastUnidentified.set(record.rarity, pullCount);
          continue;
        }
        const item = ensureItem(record);
        item.count++;
        const last = previous.get(record.itemId);
        // 只判断本期卡池内首次。跨池拥有、赠送和历史非新标记不改变本期定义。
        const unknownBefore = lastUnidentified.get(record.rarity) || 0;
        const canStart = firstBasis === 'stored-period' || complete.has(key);
        const isFirst = last !== undefined ? false : !unknownBefore && (canStart || record.newItem === true) ? true : null;
        const cost = last !== undefined ? unknownBefore > last ? null : pullCount - last : canStart ? pullCount : null;
        if (isFirst === null) item.unknownClassification++;
        else if (cost === null) item.unknownCost++;
        else {
          const frequencies = item[isFirst ? 'first' : 'repeat'];
          frequencies.set(cost, (frequencies.get(cost) || 0) + 1);
        }
        previous.set(record.itemId, pullCount);
      }
    }
    const obtained = new Set();
    for (const { previous, pullCount } of periods.values()) for (const [itemId, last] of previous) {
      if (last < pullCount) items.get(itemId).repeatUnfinished++;
      obtained.add(itemId);
    }
    for (const itemId of obtained) {
      obtainingAccounts.set(itemId, (obtainingAccounts.get(itemId) || 0) + 1);
    }
  }

  return {
    rulesVersion: OBSERVATION_RULE_VERSION,
    poolId, firstMode: 'pool', firstBasis, costUnit: 'effective-pulls',
    total, free, infoBook, resources, participatingAccounts, incompleteAccounts,
    rarities: [...rarityCounts].sort(([a], [b]) => b - a)
      .map(([rarity, count]) => ({ rarity, count, rate: count / total })),
    items: [...items.values()].map((item) => ({
      ...item, rate: item.count / total,
      nonObtainingAccounts: participatingAccounts - obtainingAccounts.get(item.itemId),
      first: summarizeCosts(item.first), repeat: summarizeCosts(item.repeat),
    })).sort((a, b) => b.rarity - a.rarity || b.count - a.count || a.itemId.localeCompare(b.itemId)),
  };
}

/** 裁切只改变显示范围；CDF 始终沿用全体已完成样本分母。 */
export function observationRange(series, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end - start > 2000) {
    throw new Error('Invalid observation range');
  }
  const points = series.points;
  let index = 0;
  let cumulativeRate = 0;
  while (index < points.length && points[index].cost < start) {
    cumulativeRate = points[index++].cumulativeRate;
  }
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const cost = start + offset;
    const point = points[index]?.cost === cost ? points[index++] : null;
    if (point) cumulativeRate = point.cumulativeRate;
    return { cost, count: point?.count || 0, cumulativeRate };
  });
}
