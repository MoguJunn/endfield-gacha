import { buildStoredPoolObservations, storedAccountKey } from './storedPoolObservations.js';
import { compareHistoryTimelineAsc, getHistoryTimelineTimestampMs } from './historyTimelineSort.js';
import { getStatisticsGroup, getStatisticsGroupPools, statisticsCategoryDefinitions, statisticsItemCategory, statisticsMemberSignature } from '../../shared/statisticsScopes.js';

function summarize(frequencies) {
  const sampleCount = [...frequencies.values()].reduce((sum, count) => sum + count, 0);
  let cumulative = 0;
  let costSum = 0;
  const points = [...frequencies].sort(([a], [b]) => a - b).map(([cost, count]) => {
    cumulative += count;
    costSum += cost * count;
    return { cost, count, cumulativeRate: cumulative / sampleCount };
  });
  return { sampleCount, mean: sampleCount ? costSum / sampleCount : null, points };
}

/** Calculate per-account/per-period/per-item first; only then combine six-star roles.
 * Account sets stay in memory and never leave this function. */
export function buildGroupPoolObservations({ history, pools, groupKey, directory, accountKey = null }) {
  const group = getStatisticsGroup(groupKey);
  if (!group) throw new Error('Unknown statistics group');
  const members = getStatisticsGroupPools(pools, groupKey);
  const memberById = new Map(members.map((pool) => [pool.id, pool]));
  const directoryById = new Map(directory.map((item) => [String(item.id), item]));
  const timelines = new Map();
  const seen = new Set();
  let duplicate = 0;
  for (const row of history.slice().sort(compareHistoryTimelineAsc)) {
    const poolId = String(row.poolId ?? row.pool_id ?? '');
    if (!memberById.has(poolId)) continue;
    const key = storedAccountKey(row);
    if (accountKey && key !== accountKey) continue;
    const id = String(row.record_id ?? row.id ?? '');
    if (key && id && getHistoryTimelineTimestampMs(row) && [4, 5, 6].includes(Number(row.rarity))) {
      const identity = JSON.stringify([key, id]);
      if (seen.has(identity)) { duplicate++; continue; }
      seen.add(identity);
    }
    const timelineKey = JSON.stringify([key, poolId]);
    if (!timelines.has(timelineKey)) timelines.set(timelineKey, { key, poolId, rows: [] });
    timelines.get(timelineKey).rows.push(row);
  }
  const categories = new Map(statisticsCategoryDefinitions(group.entityType).map((item) => [item.itemId, {
    ...item, rarity: 6, count: 0, first: new Map(), repeat: new Map(), accounts: new Set(),
    unknownClassification: 0, unknownCost: 0, repeatUnfinished: 0,
  }]));
  const accounts = new Set();
  const rarityCounts = new Map();
  const memberCounts = new Map(members.map((pool) => [pool.id, 0]));
  const meta = { excludedRecords: duplicate, exclusions: { missingIdentity: 0, invalidTime: 0, invalidRarity: 0, duplicate },
    matchedByName: 0, unidentifiedRecords: 0, unidentifiedByRarity: { 4: 0, 5: 0, 6: 0 },
    prefixVerified: false, firstBasis: 'stored-period', costBasis: 'stored-results',
    firstRecordAt: null, lastRecordAt: null, sampleBasis: 'account-period-item', coverageBasis: 'distinct-account',
    memberSignature: statisticsMemberSignature(members) };
  let total = 0; let free = 0; let infoBook = 0; let resources = 0;
  for (const timeline of timelines.values()) {
    const pool = memberById.get(timeline.poolId);
    const stats = buildStoredPoolObservations({ history: timeline.rows, poolId: pool.id, directory, entityType: group.entityType });
    total += stats.total; free += stats.free; infoBook += stats.infoBook; resources += stats.resources;
    memberCounts.set(pool.id, memberCounts.get(pool.id) + stats.total);
    if (stats.total) accounts.add(timeline.key);
    for (const rarity of stats.rarities) rarityCounts.set(rarity.rarity, (rarityCounts.get(rarity.rarity) || 0) + rarity.count);
    for (const field of ['excludedRecords', 'matchedByName', 'unidentifiedRecords']) meta[field] += stats.meta[field];
    for (const reason of Object.keys(meta.exclusions)) meta.exclusions[reason] += stats.meta.exclusions[reason];
    for (const rarity of [4, 5, 6]) meta.unidentifiedByRarity[rarity] += stats.meta.unidentifiedByRarity[rarity];
    if (stats.meta.firstRecordAt && (!meta.firstRecordAt || stats.meta.firstRecordAt < meta.firstRecordAt)) meta.firstRecordAt = stats.meta.firstRecordAt;
    if (stats.meta.lastRecordAt && (!meta.lastRecordAt || stats.meta.lastRecordAt > meta.lastRecordAt)) meta.lastRecordAt = stats.meta.lastRecordAt;
    for (const item of stats.items.filter((item) => item.rarity === 6)) {
      const category = categories.get(statisticsItemCategory(item, pool, directoryById));
      category.count += item.count;
      if (item.count) category.accounts.add(timeline.key);
      for (const kind of ['first', 'repeat']) for (const point of item[kind].points) {
        category[kind].set(point.cost, (category[kind].get(point.cost) || 0) + point.count);
      }
      for (const field of ['unknownClassification', 'unknownCost', 'repeatUnfinished']) category[field] += item[field];
    }
    // An unidentified six-star has no trustworthy item timeline, but is a known category hit.
    const unknownCount = stats.meta.unidentifiedByRarity[6];
    if (unknownCount) {
      const unknown = categories.get('unknown');
      unknown.count += unknownCount; unknown.unknownClassification += unknownCount; unknown.accounts.add(timeline.key);
    }
  }
  return {
    rulesVersion: 'group-pool-observation-v1', scopeKind: 'group', groupKey, entityType: group.entityType,
    firstMode: 'pool', firstBasis: 'stored-period', costUnit: 'stored-results', total, free, infoBook, resources,
    participatingAccounts: accounts.size, incompleteAccounts: accounts.size,
    rarities: [...rarityCounts].sort(([a], [b]) => b - a).map(([rarity, count]) => ({ rarity, count, rate: total ? count / total : 0 })),
    items: [...categories.values()].filter((item) => item.itemId !== 'unknown' || item.count).map(({ accounts: obtained, ...item }) => ({
      ...item, first: summarize(item.first), repeat: summarize(item.repeat), rate: total ? item.count / total : 0,
      nonObtainingAccounts: accounts.size - obtained.size,
    })),
    members: members.map((pool) => ({ id: pool.id, name: pool.name, nameEn: pool.name_en, total: memberCounts.get(pool.id) })), meta,
  };
}
