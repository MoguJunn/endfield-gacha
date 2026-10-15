import { computeWorkbenchMetrics } from '../../shared/dataWorkbenchMetrics.js';
import { normalizeWorkbenchEntry, validateWorkbenchEntry } from '../../shared/dataWorkbench.js';
import { prepareStatisticsContinuity } from './statisticsContinuity.js';

const poolId = row => String(row.poolId ?? row.pool_id ?? '');
const method = row => row.drawMethod ?? (row.special_type === 'gift' || row.specialType === 'gift' ? 'gift'
  : row.is_free || row.isFree ? 'free' : row.is_info_book || row.isInfoBook ? 'info_book' : 'normal');
const present = value => value !== null && value !== undefined && value !== '';
const acquisitionKey = row => JSON.stringify([row.user_id, row.game_uid ?? row.gameUid,
  row.server_scope ?? row.serverScope ?? row.server_id ?? row.serverId ?? 'legacy', poolId(row), method(row), row.character_id ?? row.characterId,
  present(row.timestamp) ? Date.parse(row.timestamp) : null]);

/** Private, in-memory projection of known acquisitions. Never writes or invents history rows. */
export function preparePersonalAnalysisData({ history = [], entries = [], pools = [], characters = [] } = {}) {
  const entities = new Map(characters.map(entity => [String(entity.id), entity]));
  const accepted = entries.filter(entry => !entry.deleted_at && !entry.deletedAt)
    .map(raw => normalizeWorkbenchEntry({ ...raw, reviewState: 'confirmed' }))
    .filter(entry => validateWorkbenchEntry(entry, { pools, entities: characters }).valid);
  const projected = [...history];
  const consumed = new Map();
  for (const row of history) {
    const key = acquisitionKey(row);
    consumed.set(key, (consumed.get(key) || 0) + 1);
  }
  const gaps = [];
  for (const entry of accepted) {
    const values = entry.values;
    const acquisitions = entry.kind === 'detail' ? [{ ...values, id: entry.entryId, timePrecision: entry.timePrecision }]
      : entry.kind === 'pool-ledger' ? values.acquisitions || [] : [];
    // Aggregate counts cannot prove order, a current pity value, or complete copy ownership.
    if (!['potential-evidence', 'detail'].includes(entry.kind)) {
      gaps.push({ ...entry, pool_id: entry.poolId, history_start_at: values.rangeStart,
        history_end_at: values.rangeEnd, history_time_unknown: values.coverageMode === 'pool' && !values.rangeEnd });
    }
    for (const acquisition of acquisitions) {
      const entity = entities.get(String(acquisition.entityId));
      if (!entity) continue;
      const drawMethod = acquisition.drawMethod || values.drawMethod;
      const row = {
        id: `supplement:${entry.entryId}:${acquisition.id}`, user_id: entry.user_id,
        game_uid: entry.game_uid, server_scope: entry.server_scope, server_id: entry.server_scope === 'legacy' ? null : entry.server_scope,
        poolId: entry.poolId, pool_id: entry.poolId, character_id: entity.id,
        character_name: entity.name, item_name: entity.name, name: entity.name, rarity: entity.rarity,
        timestamp: acquisition.timePrecision === 'second' ? acquisition.timestamp : null,
        is_free: drawMethod === 'free', isFree: drawMethod === 'free', is_info_book: drawMethod === 'info_book',
        special_type: drawMethod === 'gift' ? 'gift' : null, specialType: drawMethod === 'gift' ? 'gift' : null,
        source: 'workbench', personalIntervalPulls: acquisition.intervalPulls ?? null,
      };
      const key = acquisitionKey(row);
      const duplicates = consumed.get(key) || 0;
      if (duplicates && row.timestamp) { consumed.set(key, duplicates - 1); continue; }
      projected.push(row);
    }
  }
  const annotated = prepareStatisticsContinuity({ history: projected, pools, audience: 'personal', gaps }).history;
  return { entries: accepted, history: annotated.map(row => Number(row.rarity) === 6 && Number(row.personalIntervalPulls) > 0
    ? { ...row, statisticsContinuity: { ...row.statisticsContinuity, interrupted: true,
      sixStarKnown: true, sixStarPity: Number(row.personalIntervalPulls) } } : row) };
}

/** Summary-only totals join counts, never a fabricated per-pull probability sample. */
export function personalAnalysisCoverage({ history = [], entries = [], pools = [], characters = [], includeFree = false } = {}) {
  const selected = entries.filter(entry => includeFree || entry.values.drawMethod !== 'free');
  const metrics = computeWorkbenchMetrics({
    history: history.filter(row => includeFree || method(row) !== 'free'), entries: selected, pools, entities: characters,
  });
  const incompleteTotal = selected.some(entry => entry.values.drawMethod !== 'gift' && entry.kind === 'pool-ledger' && !present(entry.values.totalPulls))
    || selected.some(entry => ['pool-summary', 'batch-summary'].includes(entry.kind) && !present(entry.values.totalPulls));
  return { metrics, totalKnown: !incompleteTotal, hasSupplements: selected.length > 0 };
}

export function applyPersonalAnalysisCoverage(variant, coverage) {
  if (!coverage.hasSupplements) return variant;
  const { metrics, totalKnown } = coverage;
  const stats = variant.stats;
  const total = metrics.combined.totalPulls;
  const orderUnknown = !totalKnown || total > stats.total;
  const counts = { ...stats.counts, 4: metrics.combined.fourStarCount, 5: metrics.combined.fiveStarCount };
  const chartData = (stats.chartData || []).map(item => {
    const key = item.kind === 'target-six' ? 6 : ['standard-six', 'offrate-six'].includes(item.kind) ? '6_std' : item.kind === 'five-star' ? 5 : 4;
    return { ...item, value: counts[key], originalValue: counts[key], displayValue: counts[key] };
  });
  return {
    ...variant,
    ...(!totalKnown && variant.dashboardResourceSummary ? { dashboardResourceSummary: {
      ...variant.dashboardResourceSummary, personalData: { totalKnown: false },
    } } : {}),
    ...(orderUnknown ? { effectivePity: { ...variant.effectivePity, pity6: null, pity5: null } } : {}),
    stats: {
      ...stats, total, counts, chartData,
      totalSixStar: metrics.combined.sixStarCount,
      personalData: { totalKnown, hasSupplements: true, supplemental: metrics.supplemental,
        knownSixStarCount: metrics.combined.sixStarCount,
        unclassifiedSixStarCount: Math.max(0, metrics.combined.sixStarCount - (counts[6] || 0) - (counts['6_std'] || 0)),
        unknownFourStar: metrics.coverage.unknownFourStar },
      ...(orderUnknown ? { currentPity: null, currentPity5: null, probabilityInfo: null } : {}),
      ...(!totalKnown ? { winRate: '--', resourceSummary: { ...stats.resourceSummary, personalData: { totalKnown: false } },
        avgPullCost: Object.fromEntries(Object.keys(stats.avgPullCost || {}).map(key => [key, null])) } : {}),
    },
    workbench: { status: 'ready', ...metrics },
  };
}
