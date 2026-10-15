import { computeWorkbenchMetrics } from './dataWorkbenchMetrics.js';

const COUNTS = ['totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount'];
const RESOURCES = ['arsenalQuota', 'knownWeaponAic', 'knownExcessAic', 'knownBondQuota', 'knownEndpointQuota', 'rangeExcessAic', 'aicSupplemental'];
const count = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const emptyCounts = () => Object.fromEntries(COUNTS.map(key => [key, 0]));
const poolId = row => String(row.poolId ?? row.pool_id ?? '');
const accountKey = row => JSON.stringify([
  row.user_id ?? row.ownerId ?? '', row.game_uid ?? row.gameUid ?? row.scope?.gameUid ?? '',
  row.server_scope ?? row.serverScope ?? row.scope?.serverScope ?? row.server_id ?? row.serverId ?? 'legacy',
]);

// Explicit DTO: never forward the engine's ranges, entry IDs, evidence or account identifiers.
export function aggregateWorkbenchMetrics(results = [], { status = 'ready', scope = 'all-accounts' } = {}) {
  const result = {
    schemaVersion: 1, status, scope,
    confirmed: emptyCounts(), supplemental: emptyCounts(), combined: emptyCounts(),
    inferred: { records: 0, excludedFromExactAnalysis: true },
    rates: { sixStarNumerator: 0, sixStarDenominator: 0, fiveStarNumerator: 0, fiveStarDenominator: 0 },
    coverage: { accounts: results.length, includedDetails: 0, includedRanges: 0, includedLedgers: 0, unknownFourStar: 0, issueCount: 0, resourceUnknownCount: 0, mode: 'metric-specific' },
    intervals: { count: 0, totalPulls: 0, averagePulls: null },
    resource: Object.fromEntries(RESOURCES.map(key => [key, 0])),
  };
  for (const metrics of results) {
    for (const group of ['confirmed', 'supplemental', 'combined']) {
      for (const key of COUNTS) result[group][key] += count(metrics[group]?.[key]);
    }
    for (const key of Object.keys(result.rates)) result.rates[key] += count(metrics.rates?.[key]);
    for (const key of ['includedDetails', 'includedRanges', 'includedLedgers', 'unknownFourStar']) result.coverage[key] += count(metrics.coverage?.[key]);
    result.inferred.records += count(metrics.inferred?.records);
    result.coverage.issueCount += metrics.issues?.length || 0;
    result.coverage.resourceUnknownCount += metrics.resource?.unknown?.length || 0;
    for (const interval of metrics.intervals || []) {
      result.intervals.count += 1;
      result.intervals.totalPulls += count(interval.pulls);
    }
    for (const key of RESOURCES) result.resource[key] += count(metrics.resource?.[key]);
  }
  for (const rarity of ['sixStar', 'fiveStar']) {
    const denominator = result.rates[`${rarity}Denominator`];
    result.rates[`${rarity}Rate`] = denominator > 0 ? result.rates[`${rarity}Numerator`] / denominator : null;
  }
  result.intervals.averagePulls = result.intervals.count ? result.intervals.totalPulls / result.intervals.count : null;
  result.eligible = { rates: result.rates.sixStarDenominator > 0, intervals: result.intervals.count > 0, time: result.coverage.includedDetails > 0 };
  return result;
}

export function buildWorkbenchAnalytics({ entries = [], history = [], pools = [], entities = [], status = 'ready', scope = 'all-accounts' } = {}) {
  const groups = new Map();
  const getGroup = row => {
    const key = accountKey(row);
    if (!groups.has(key)) groups.set(key, { entries: [], history: [] });
    return groups.get(key);
  };
  history.forEach(row => getGroup(row).history.push(row));
  entries.filter(row => !row.deleted_at && !row.deletedAt).forEach(row => getGroup(row).entries.push(row));
  const compute = (selectedPoolIds = null) => aggregateWorkbenchMetrics(
    [...groups.values()].map(group => computeWorkbenchMetrics({
      entries: selectedPoolIds ? group.entries.filter(row => selectedPoolIds.has(poolId(row)) || row.kind === 'potential-evidence') : group.entries,
      history: selectedPoolIds ? group.history.filter(row => selectedPoolIds.has(poolId(row))) : group.history,
      resourceHistory: group.history,
      evidenceEntries: selectedPoolIds ? group.entries.filter(row => !selectedPoolIds.has(poolId(row)) && row.kind === 'detail') : [],
      pools, entities,
    })), { status, scope }
  );
  const result = compute();
  result.byType = {};
  for (const type of ['limited', 'extra', 'standard', 'weapon', 'character']) {
    const selected = pools.filter(pool => {
      const base = ({ limited_character: 'limited', limited_weapon: 'weapon', beginner: 'standard' })[pool.type] || pool.type;
      return type === 'character' ? ['limited', 'extra', 'standard'].includes(base) : base === type;
    });
    result.byType[type] = compute(new Set(selected.map(pool => String(pool.id ?? pool.pool_id))));
  }
  return result;
}
