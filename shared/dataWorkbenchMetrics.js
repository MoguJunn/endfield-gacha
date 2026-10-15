import { normalizeWorkbenchEntry, normalizeWorkbenchScope, validateWorkbenchEntry } from './dataWorkbench.js';
import { FULL_POTENTIAL_COPY_COUNT, QUOTA_RULES } from '../src/utils/quotaEconomy.js';

const KEYS = ['totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount'];
const empty = () => Object.fromEntries(KEYS.map(key => [key, 0]));
const has = value => value !== undefined && value !== null && value !== '';
const ms = value => {
  if (!has(value)) return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const keyForRarity = rarity => ({ 4: 'fourStarCount', 5: 'fiveStarCount', 6: 'sixStarCount' })[Number(rarity)];
const poolId = row => String(row.poolId ?? row.pool_id ?? '');
const entityId = row => String(row.characterId ?? row.character_id ?? row.entityId ?? '');
const account = row => `${row.user_id ?? row.ownerId ?? ''}|${row.gameUid ?? row.game_uid ?? row.scope?.gameUid ?? ''}|${row.serverScope ?? row.server_scope ?? row.scope?.serverScope ?? ''}`;
const method = row => row.drawMethod ?? (row.special_type === 'gift' || row.specialType === 'gift' ? 'gift' : row.is_info_book || row.isInfoBook || row.isInfoBookPull ? 'info_book' : row.is_free || row.isFree ? 'free' : 'normal');
const sum = (target, addition) => KEYS.forEach(key => { target[key] += Number(addition[key]) || 0; });

function scopeMatch(row, scope) {
  if (!scope) return true;
  return String(row.game_uid ?? row.gameUid ?? row.scope?.gameUid ?? scope.gameUid) === scope.gameUid
    && String(row.server_scope ?? row.serverScope ?? row.scope?.serverScope ?? scope.serverScope) === scope.serverScope;
}

function historyPoint(row) {
  const point = { ...row, poolId: poolId(row), timestampMs: ms(row.timestamp), drawMethod: method(row), counts: empty() };
  // A gift is an acquisition, not a pull in a probability denominator.
  if (point.drawMethod !== 'gift') {
    point.counts.totalPulls = 1;
    const key = keyForRarity(row.rarity);
    if (key) point.counts[key] = 1;
  }
  return point;
}

/** Pure coverage projection. No synthetic history, identities or timestamps are emitted. */
export function computeWorkbenchMetrics({ entries = [], history = [], resourceHistory = history, evidenceEntries = [], pools = [], entities = [], scope = null } = {}) {
  const normalizedScope = normalizeWorkbenchScope(scope);
  const issues = [];
  const confirmed = empty();
  const supplemental = empty();
  const seenHistory = new Set();
  const points = [];
  for (const row of history.filter(row => scopeMatch(row, normalizedScope))) {
    const identity = `${account(row)}|${poolId(row)}|${row.seq_id ?? row.seqId ?? row.record_id ?? row.id ?? `row:${points.length}`}`;
    if (seenHistory.has(identity)) continue;
    seenHistory.add(identity);
    const point = { ...historyPoint(row), origin: 'history' };
    points.push(point);
    sum(confirmed, point.counts);
  }
  const records = [];
  const seenEntries = new Set();
  for (const raw of entries) {
    if (raw.deleted_at || raw.deletedAt || !scopeMatch(raw, normalizedScope)) continue;
    const entry = normalizeWorkbenchEntry(raw);
    const identity = `${account(raw)}|${raw.draft_id ?? raw.draftId ?? ''}|${entry.entryId}`;
    if (seenEntries.has(identity) || entry.reviewState !== 'confirmed') continue;
    seenEntries.add(identity);
    const result = validateWorkbenchEntry(entry, { pools, entities });
    if (!result.valid) { issues.push(...result.issues); continue; }
    records.push(result.entry);
  }
  const entityMap = new Map(entities.map(entity => [String(entity.id), entity]));
  const includedDetails = [];
  for (const entry of records.filter(item => item.kind === 'detail')) {
    const v = entry.values;
    const duplicate = points.some(point => point.poolId === String(entry.poolId) && point.drawMethod === v.drawMethod
      && point.timestampMs === ms(v.timestamp) && entityId(point) === String(v.entityId));
    if (duplicate) { issues.push({ code: 'detail_covered', entryId: entry.entryId, message: '相同实体和时间的明细已存在，补录暂不重复计入' }); continue; }
    const entity = entityMap.get(String(v.entityId));
    // entityId must ride on the point: history rows expose character_id, and the
    // duplicate lookup compares one field for both sources.
    const point = {
      ...historyPoint({
        ...entry, entityId: v.entityId, character_id: v.entityId,
        rarity: entity.rarity, timestamp: v.timestamp, drawMethod: v.drawMethod,
      }),
      origin: 'workbench',
    };
    points.push(point);
    includedDetails.push(entry);
    sum(supplemental, point.counts);
  }
  const ranges = records.filter(entry => ['pool-summary', 'batch-summary', 'six-star-interval'].includes(entry.kind)).map(entry => ({ entry, start: ms(entry.values.rangeStart), end: ms(entry.values.rangeEnd) }));
  const rangeResults = [];
  const intervalValues = [];
  // Individually entered wins do not prove an unbiased complete sampling window.
  // They contribute counts, and only join rates when a matched summary supplies coverage.
  const officialRatePoints = points.filter(point => point.drawMethod === 'normal' && point.origin === 'history');
  let rateNumerator6 = officialRatePoints.reduce((n, point) => n + point.counts.sixStarCount, 0);
  let rateNumerator5 = officialRatePoints.reduce((n, point) => n + point.counts.fiveStarCount, 0);
  let denominator6 = officialRatePoints.length;
  let denominator5 = denominator6;
  for (const range of ranges) {
    const { entry, start, end } = range;
    const v = entry.values;
    // Half-open [start,end) permits adjacent intervals without double counting the boundary.
    if (ranges.some(other => other !== range && other.entry.poolId === entry.poolId && other.entry.values.drawMethod === v.drawMethod && start < other.end && other.start < end)) {
      issues.push({ code: 'overlapping_summaries', entryId: entry.entryId, message: '补充范围相互重叠，需修正范围后参与统计' });
      continue;
    }
    const candidates = points.filter(point => point.poolId === String(entry.poolId) && point.drawMethod === v.drawMethod);
    if (candidates.some(point => point.timestampMs === null)) {
      issues.push({ code: 'coverage_time_unknown', entryId: entry.entryId, message: '同池明细缺少时间，无法确认摘要覆盖范围' });
      continue;
    }
    const covered = candidates.filter(point => point.timestampMs >= start && point.timestampMs < end);
    const existing = empty();
    covered.forEach(point => {
      if (v.drawMethod === 'gift') {
        existing.totalPulls += 1;
        const key = keyForRarity(point.rarity);
        if (key) existing[key] += 1;
      } else sum(existing, point.counts);
    });
    const snapshot = entry.kind === 'six-star-interval' ? { totalPulls: v.intervalPulls, sixStarCount: 1 } : v;
    const knownComposition = KEYS.filter(key => key !== 'totalPulls').reduce((total, key) => total + Math.max(Number(snapshot[key]) || 0, existing[key]), 0);
    if (KEYS.some(key => has(snapshot[key]) && snapshot[key] < existing[key]) || (has(snapshot.totalPulls) && knownComposition > snapshot.totalPulls)) {
      issues.push({ code: 'summary_less_than_details', entryId: entry.entryId, message: '汇总数量小于同范围已知明细，需核对后参与统计' });
      continue;
    }
    const delta = empty();
    KEYS.forEach(key => { if (has(snapshot[key])) delta[key] = snapshot[key] - existing[key]; });
    if (v.drawMethod !== 'gift') sum(supplemental, delta);
    if (entry.kind === 'six-star-interval' && v.drawMethod === 'normal') intervalValues.push({ entryId: entry.entryId, pulls: v.intervalPulls });
    if (v.drawMethod === 'normal' && has(snapshot.totalPulls)) {
      const officialCovered = empty();
      covered.filter(point => point.origin === 'history').forEach(point => sum(officialCovered, point.counts));
      if (has(snapshot.sixStarCount)) { denominator6 += snapshot.totalPulls - officialCovered.totalPulls; rateNumerator6 += snapshot.sixStarCount - officialCovered.sixStarCount; }
      if (has(snapshot.fiveStarCount)) { denominator5 += snapshot.totalPulls - officialCovered.totalPulls; rateNumerator5 += snapshot.fiveStarCount - officialCovered.fiveStarCount; }
    }
    rangeResults.push({ entryId: entry.entryId, poolId: entry.poolId, start, end, delta, snapshot, method: v.drawMethod });
  }
  const ledgerCoverage = [];
  const inferred = { records: 0, excludedFromExactAnalysis: true };
  const ledgers = records.filter(entry => entry.kind === 'pool-ledger');
  for (const entry of ledgers) {
    const v = entry.values;
    const start = v.coverageMode === 'range' ? ms(v.rangeStart) : null;
    const end = v.coverageMode === 'range' ? ms(v.rangeEnd) : null;
    const overlaps = other => other.poolId === entry.poolId && other.values.drawMethod === v.drawMethod && (v.coverageMode === 'pool' || other.values.coverageMode === 'pool' || start < ms(other.values.rangeEnd) && ms(other.values.rangeStart) < end);
    if (ledgers.some(other => other !== entry && overlaps(other)) || ranges.some(range => range.entry.poolId === entry.poolId && range.entry.values.drawMethod === v.drawMethod && (v.coverageMode === 'pool' || start < range.end && range.start < end))) {
      issues.push({ code: 'overlapping_ledgers', entryId: entry.entryId, message: '整池存档与已有汇总覆盖重叠，请合并后参与统计' });
      continue;
    }
    const covered = points.filter(point => point.poolId === String(entry.poolId) && point.drawMethod === v.drawMethod && (v.coverageMode === 'pool' || point.timestampMs !== null && point.timestampMs >= start && point.timestampMs < end));
    const existing = empty();
    covered.forEach(point => sum(existing, point.counts));
    const snapshot = { ...v };
    const freshAcquisitions = (v.acquisitions || []).filter(row => row.drawMethod === v.drawMethod && !covered.some(point => row.entityId && entityId(point) === String(row.entityId) && row.timestamp && point.timestampMs === ms(row.timestamp)));
    for (const [rarity, key] of [[5, 'fiveStarCount'], [6, 'sixStarCount']]) {
      if (!has(snapshot[key]) && freshAcquisitions.some(row => Number(row.rarity) === rarity)) snapshot[key] = existing[key] + freshAcquisitions.filter(row => Number(row.rarity) === rarity).length;
    }
    if (!has(snapshot.totalPulls) && freshAcquisitions.length) snapshot.totalPullsLowerBound = existing.totalPulls + freshAcquisitions.length;
    // Subtraction from three confirmed counts proves a count, never a character identity.
    if (!has(snapshot.fourStarCount) && ['totalPulls', 'fiveStarCount', 'sixStarCount'].every(key => has(v[key]))) snapshot.fourStarCount = Number(v.totalPulls) - Number(v.fiveStarCount) - Number(v.sixStarCount);
    const knownComposition = ['fourStarCount', 'fiveStarCount', 'sixStarCount'].reduce((total, key) => total + Math.max(Number(snapshot[key]) || 0, existing[key]), 0);
    if (KEYS.some(key => has(snapshot[key]) && Number(snapshot[key]) < existing[key]) || has(snapshot.totalPulls) && knownComposition > Number(snapshot.totalPulls)) {
      issues.push({ code: 'summary_less_than_details', entryId: entry.entryId, message: '整池存档数量小于该池已存在的真实明细' });
      continue;
    }
    const delta = empty();
    for (const key of KEYS) if (has(snapshot[key])) delta[key] = Number(snapshot[key]) - existing[key];
    if (!has(snapshot.totalPulls)) delta.totalPulls = freshAcquisitions.length;
    if (v.drawMethod !== 'gift') sum(supplemental, delta);
    const official = empty();
    covered.filter(point => point.origin === 'history').forEach(point => sum(official, point.counts));
    if (v.drawMethod === 'normal' && has(snapshot.totalPulls)) {
      if (has(v.sixStarCount)) { denominator6 += Number(snapshot.totalPulls) - official.totalPulls; rateNumerator6 += Number(v.sixStarCount) - official.sixStarCount; }
      if (has(v.fiveStarCount)) { denominator5 += Number(snapshot.totalPulls) - official.totalPulls; rateNumerator5 += Number(v.fiveStarCount) - official.fiveStarCount; }
    }
    const inferredRemaining = Math.max(0, (Number(v.inferredFill?.count) || v.inferredRecords?.length || 0) - existing.fourStarCount);
    inferred.records += inferredRemaining;
    ledgerCoverage.push({ entryId: entry.entryId, poolId: entry.poolId, method: v.drawMethod, snapshot, delta, inferredRemaining, complete: v.complete === true });
    // Confirmed six-star intervals are separate evidence; inferred four-star order is ignored.
    for (const row of v.acquisitions || []) if (Number(row.rarity) === 6 && row.drawMethod === 'normal' && has(row.intervalPulls)) intervalValues.push({ entryId: entry.entryId, pulls: Number(row.intervalPulls) });
    // A screenshot may contain a separate free/info-book lane without a full
    // lane summary. Preserve its known drops, keeping them outside paid rates.
    for (const lane of ['free', 'info_book']) {
      if (v.drawMethod === lane || ledgers.some(other => other.poolId === entry.poolId && other.values.drawMethod === lane)) continue;
      const acquired = (v.acquisitions || []).filter(row => row.drawMethod === lane && !points.some(point => point.poolId === String(entry.poolId) && point.drawMethod === lane && row.entityId && entityId(point) === String(row.entityId) && row.timestamp && point.timestampMs === ms(row.timestamp)));
      supplemental.totalPulls += acquired.length;
      supplemental.fiveStarCount += acquired.filter(row => Number(row.rarity) === 5).length;
      supplemental.sixStarCount += acquired.filter(row => Number(row.rarity) === 6).length;
    }
  }
  const combined = { ...confirmed };
  sum(combined, supplemental);
  return {
    schemaVersion: 1, confirmed, supplemental, combined, inferred,
    eligible: { rates: denominator6 > 0, intervals: intervalValues.length > 0, time: includedDetails.length > 0 },
    rates: { sixStarRate: denominator6 > 0 ? rateNumerator6 / denominator6 : null, fiveStarRate: denominator5 > 0 ? rateNumerator5 / denominator5 : null, sixStarNumerator: rateNumerator6, sixStarDenominator: denominator6, fiveStarNumerator: rateNumerator5, fiveStarDenominator: denominator5 },
    intervals: intervalValues,
    coverage: { includedDetails: includedDetails.length, includedRanges: rangeResults.length, includedLedgers: ledgerCoverage.length, ledgers: ledgerCoverage, ranges: rangeResults, unknownFourStar: rangeResults.filter(range => !has(range.snapshot.fourStarCount)).length + ledgerCoverage.filter(ledger => !has(ledger.snapshot.fourStarCount)).length, mode: 'metric-specific', timeZone: 'explicit-input' },
    issues,
    resource: computeWorkbenchResources({ records, includedDetails, history: resourceHistory, evidenceEntries, entities, pools, rangeResults, scope: normalizedScope }),
  };
}

/** Only proves excess copies from evidence; never assumes the first observed copy is the first owned. */
export function computeWorkbenchResources({ records = [], includedDetails = [], history = [], evidenceEntries = [], entities = [], pools = [], rangeResults = [], scope = null } = {}) {
  const lookup = new Map(entities.map(entity => [String(entity.id), entity]));
  const poolLookup = new Map(pools.map(pool => [String(pool.id ?? pool.pool_id), pool]));
  const events = [];
  const seen = new Set();
  const add = event => {
    if (!event.key || seen.has(event.key) || event.time === null || !lookup.has(event.entityId)) return;
    seen.add(event.key); events.push(event);
  };
  for (const row of history.filter(item => scopeMatch(item, scope))) add({ key: `history:${account(row)}:${poolId(row)}:${row.seq_id ?? row.seqId ?? row.id ?? row.record_id}`, entityId: entityId(row), time: ms(row.timestamp), quantity: 1, supplemental: false });
  for (const entry of includedDetails) add({ key: `entry:${entry.entryId}`, entityId: String(entry.values.entityId), time: ms(entry.values.timestamp), quantity: entry.values.quantity, supplemental: true });
  for (const raw of evidenceEntries) {
    const validated = validateWorkbenchEntry(raw, { pools, entities });
    if (!validated.valid || validated.entry.reviewState !== 'confirmed' || raw.deleted_at || raw.deletedAt || !scopeMatch(raw, scope)) continue;
    const entry = validated.entry;
    if (entry.kind !== 'detail' || history.some(row => poolId(row) === String(entry.poolId) && entityId(row) === String(entry.values.entityId) && ms(row.timestamp) === ms(entry.values.timestamp) && method(row) === entry.values.drawMethod)) continue;
    add({ key: `entry:${entry.entryId}`, entityId: String(entry.values.entityId), time: ms(entry.values.timestamp), quantity: entry.values.quantity, supplemental: false });
  }
  for (const entry of records.filter(item => item.kind === 'potential-evidence')) {
    // A repeated source, or evidence pointing to an acquisition already loaded,
    // cannot establish additional copies or an earlier potential boundary.
    const ref = String(entry.values.evidenceRef);
    if (history.some(row => [row.id, row.record_id, row.seq_id, row.seqId].some(id => id != null && String(id) === ref) && entityId(row) === String(entry.values.entityId))
      || includedDetails.some(detail => detail.entryId === ref)) continue;
    add({ key: `evidence:${entry.values.entityId}:${ref}`, entityId: String(entry.values.entityId), time: ms(entry.values.timestamp), quantity: entry.values.quantity, supplemental: false });
  }
  events.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
  const copies = new Map();
  const boundaries = new Map();
  let knownExcessAic = 0;
  let knownWeaponAic = 0;
  let knownBondQuota = 0;
  let knownEndpointQuota = 0;
  const unknown = [];
  // Same-time evidence establishes a boundary after this group, not within an unknown order.
  for (let index = 0; index < events.length;) {
    const time = events[index].time;
    let end = index;
    while (end < events.length && events[end].time === time) end++;
    for (const event of events.slice(index, end)) {
      const entity = lookup.get(event.entityId);
      const before = copies.get(event.entityId) || 0;
      if (event.supplemental && entity.type === 'weapon') knownWeaponAic += event.quantity * (Number(entity.rarity) === 6 ? QUOTA_RULES.weaponSixStarAicQuota : Number(entity.rarity) === 5 ? QUOTA_RULES.weaponFiveStarAicQuota : 0);
      else if (event.supplemental && entity.type === 'character') {
        if (before > 0) knownBondQuota += event.quantity * (Number(entity.rarity) === 6 ? QUOTA_RULES.sixStarDuplicateBondQuota : Number(entity.rarity) === 5 ? QUOTA_RULES.fiveStarDuplicateBondQuota : 0);
        if (before >= FULL_POTENTIAL_COPY_COUNT) {
          knownExcessAic += event.quantity * (Number(entity.rarity) === 4 ? QUOTA_RULES.fourStarExcessAicQuota : Number(entity.rarity) === 5 ? QUOTA_RULES.fiveStarExcessAicQuota : 0);
          if (Number(entity.rarity) === 6) knownEndpointQuota += event.quantity * QUOTA_RULES.sixStarExcessEndpointQuota;
        }
        else unknown.push({ code: 'copy_state_unknown', entryId: event.key, message: '无法证明这次获取之前已满潜，重复兑换收益暂未知' });
      }
    }
    for (const event of events.slice(index, end)) {
      const count = (copies.get(event.entityId) || 0) + event.quantity;
      copies.set(event.entityId, count);
      if (count >= FULL_POTENTIAL_COPY_COUNT && !boundaries.has(event.entityId)) boundaries.set(event.entityId, time);
    }
    index = end;
  }
  let rangeExcessAic = 0;
  let arsenalQuota = 0;
  const eligibleFourStarRanges = [];
  for (const detail of includedDetails) {
    const entity = lookup.get(String(detail.values.entityId));
    if (entity?.type === 'character' && ['normal', 'free'].includes(detail.values.drawMethod)) arsenalQuota += ({ 4: 20, 5: 200, 6: 2000 })[Number(entity.rarity)] || 0;
  }
  for (const range of rangeResults) {
    const pool = poolLookup.get(String(range.poolId));
    if (String(pool?.type).includes('weapon')) {
      knownWeaponAic += range.delta.sixStarCount * QUOTA_RULES.weaponSixStarAicQuota + range.delta.fiveStarCount * QUOTA_RULES.weaponFiveStarAicQuota;
      continue;
    }
    if (['normal', 'free'].includes(range.method)) arsenalQuota += range.delta.fourStarCount * 20 + range.delta.fiveStarCount * 200 + range.delta.sixStarCount * 2000;
    if (!has(range.snapshot.fourStarCount)) { unknown.push({ code: 'four_star_count_unknown', entryId: range.entryId }); continue; }
    if (range.delta.fourStarCount === 0) continue;
    const fourStars = entities.filter(entity => entity.type === 'character' && Number(entity.rarity) === 4);
    // Missing release dates cannot prove the historically applicable roster.
    const missingRelease = fourStars.some(entity => ms(entity.release_date ?? entity.releaseDate ?? entity.pool_config?.introduced_at) === null);
    const applicable = fourStars.filter(entity => ms(entity.release_date ?? entity.releaseDate ?? entity.pool_config?.introduced_at) < range.end);
    const fullBeforeStart = !missingRelease && applicable.length > 0 && applicable.every(entity => boundaries.has(String(entity.id)) && boundaries.get(String(entity.id)) < range.start);
    if (fullBeforeStart) {
      rangeExcessAic += range.delta.fourStarCount * QUOTA_RULES.fourStarExcessAicQuota;
      eligibleFourStarRanges.push(range.entryId);
    } else unknown.push({ code: 'potential_boundary_required', entryId: range.entryId, message: '满潜边界或历史目录不明确；请拆分前后区间后补算' });
  }
  return { arsenalQuota, knownWeaponAic, knownExcessAic, knownBondQuota, knownEndpointQuota, rangeExcessAic, aicSupplemental: knownWeaponAic + knownExcessAic + rangeExcessAic, eligibleFourStarRanges, potentialBoundaries: Object.fromEntries([...boundaries].map(([id, time]) => [id, new Date(time).toISOString()])), unknown, mode: 'proven-only' };
}
