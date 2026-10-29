import { resolvePoolCapabilities } from './poolCapabilities.js';
import { buildCatalogIndex } from './scopedLegacyStatistics.js';
import { statisticsTargetReferences } from '../../shared/statisticsScopes.js';
import { isFreeHistoryPull, isGiftHistoryPull } from './historyInfoBook.js';
import { isOfficialImportNonPullRecord } from '../../shared/officialImportRecordNormalizer.js';
import { sanitizePublicCatalogResourceUrl } from '../../shared/publicCatalogDto.js';
import { storedAccountKey } from './storedPoolObservations.js';
import { sumLuckWindows } from './personalLuckRating.js';
import { getStartedLuckVersions, groupLuckUnitsByVersion } from './personalLuckVersions.js';

const text = value => String(value ?? '').trim();
const seq = row => /^\d+$/.test(text(row.seq_id)) ? BigInt(row.seq_id) : null;
const order = (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
  || (seq(a) != null && seq(b) != null ? (seq(a) < seq(b) ? -1 : seq(a) > seq(b) ? 1 : 0) : 0);
const nonPull = row => isGiftHistoryPull(row) || isOfficialImportNonPullRecord(row);
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const blank = () => ({ sample: 0, actual: 0, expected: 0, upActual: 0, upExpected: 0 });

function poolInfo(pool, catalog) {
  const c = resolvePoolCapabilities(pool);
  const supported = c.isResolved && c.targetMode === 'single-up'
    && (pool.type !== 'extra' || ['reconstruction', 'reconstruction_claim'].includes(c.extraSubtype));
  const ids = statisticsTargetReferences(pool).map(ref => catalog.resolveRecordId(catalog.get(ref)
    ? { character_id: ref, rarity: 6 } : { name: ref, rarity: 6 }, c.entityType));
  const target = ids.length && ids.every(Boolean) && new Set(ids).size === 1 ? ids[0] : null;
  const scope = mode => mode === 'shared' ? `${c.entityType}:shared`
    : mode === 'series' ? `${c.entityType}:${c.ruleProfile}:${c.seriesKey}` : pool.id;
  return { pool, c, target, supported: supported && (c.pityScope !== 'series' && c.targetScope !== 'series' || Boolean(c.seriesKey)),
    pityKey: scope(c.pityScope), targetKey: scope(c.targetScope) };
}

function classify(row, info, catalog) {
  if (Number(row.rarity) !== 6) return false;
  if (!info.target) return null;
  const id = catalog.resolveRecordId(row, info.c.entityType);
  const name = text(row.character_name || row.item_name || row.name);
  if (!id || name && catalog.resolveRecordId({ name, rarity: 6 }, info.c.entityType) !== id) return null;
  return id === info.target;
}

function highlightItem(row, info, catalog) {
  const id = catalog.resolveRecordId(row, info.c.entityType), item = catalog.get(id);
  const avatar = sanitizePublicCatalogResourceUrl(item?.avatar_url);
  return { name: text(item?.name || row.character_name || row.item_name || row.name) || '名称待确认',
    nameEn: item?.name_en || null, avatarUrl: avatar ? new URL(avatar, 'https://ef-gacha.mogujun.icu').href : null,
    rarity: Number(row.rarity), up: classify(row, info, catalog), at: row.timestamp,
    poolName: info.pool.name, poolNameEn: info.pool.name_en || null };
}

function scopeStartTimes(infos, entity, key) {
  const starts = new Map();
  for (const info of infos.values()) {
    if (!info.supported || info.c.entityType !== entity) continue;
    // Earliest phase of a series, never just the current rerun banner.
    const start = time(info.pool.start_time) ?? -Infinity;
    starts.set(info[key], Math.min(starts.get(info[key]) ?? Infinity, start));
  }
  return starts;
}

function analyzeEntity(rows, infos, catalog, entity, entries, versions) {
  const weapon = entity === 'weapon';
  const relevant = rows.filter(row => infos.get(row.pool_id)?.c.entityType === entity).sort(order);
  const paid = relevant.filter(row => infos.get(row.pool_id)?.supported && !nonPull(row)
    && !isFreeHistoryPull(row) && row.statistics_excluded !== true);
  const result = { total: paid.length, six: 0, up: 0, unknownUp: 0, hard: 0, guarantee: 0, soft: weapon ? null : 0,
    double: 0, triple: 0, batches: 0, best: null, longest: null, wins: 0, chances: 0,
    distribution: weapon ? [0, 0, 0, 0] : [0, 0, 0, 0, 0],
    highlightRecords: { multi: null, fastest: null, streak: null },
    excluded: { initial: 0, target: 0, batch: 0, identity: 0, manual: 0, rule: 0 },
    continuity: { confirmedRewards: 0, inferredRewards: [], unknownGaps: 0 } };
  for (const row of paid) if (Number(row.rarity) === 6) {
    result.six++;
    const up = classify(row, infos.get(row.pool_id), catalog);
    if (up === true) result.up++;
    if (up === null) result.unknownUp++;
  }
  const batches = new Map(), confirmed = new Map();
  for (const row of relevant) if (row.batch_id) {
    const key = JSON.stringify([row.pool_id, row.batch_id]);
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(row);
  }
  for (const group of batches.values()) {
    group.sort(order);
    if (group.length !== 10 || new Set(group.map(row => row.timestamp)).size !== 1
      || group.some((row, i) => seq(row) == null || i > 0 && seq(row) !== seq(group[i - 1]) + 1n)) continue;
    if (group.some(row => !infos.get(row.pool_id)?.supported || isFreeHistoryPull(row) || nonPull(row) || row.statistics_excluded === true)) continue;
    for (const row of group) confirmed.set(row, group);
    result.batches++;
    const gold = group.filter(row => Number(row.rarity) === 6).length;
    if (gold === 2) result.double++;
    if (gold >= 3) result.triple++;
    const best = result.highlightRecords.multi?.items.filter(item => item.rarity === 6).length || 0;
    if (gold >= 2 && gold >= best) result.highlightRecords.multi = {
      items: group.map(row => highlightItem(row, infos.get(row.pool_id), catalog)), at: group[0].timestamp,
      poolName: infos.get(group[0].pool_id).pool.name, poolNameEn: infos.get(group[0].pool_id).pool.name_en || null };
  }
  const pity = new Map(), targets = new Map(), inferredPity = new Set(), freeCounts = new Map(), usedRewards = new Set();
  let lastSeq = null, previousRow = null, prefixComplete = seq(relevant[0] || {}) === 1n;
  let uncertainUntil = prefixComplete ? -Infinity : time(relevant[0]?.timestamp) ?? Infinity;
  const pityStarts = scopeStartTimes(infos, entity, 'pityKey'), targetStarts = scopeStartTimes(infos, entity, 'targetKey');
  const baselineKnown = (starts, key) => prefixComplete || (starts.get(key) ?? -Infinity) > uncertainUntil;
  const consumed = new Set(), units = [];
  let streakItems = [], bestStreak = 0, targetChecks = 0, pityChecks = 0;
  const blocked = entries.some(entry => infos.get(entry.pool_id)?.c.entityType === entity);
  for (const row of relevant) {
    if (consumed.has(row)) continue;
    const info = infos.get(row.pool_id), scope = info.pityKey;
    const group = weapon ? confirmed.get(row) || [row] : [row];
    for (const member of group) consumed.add(member);
    // Standard character draws fill the character sequence stream, but never
    // advance the shared limited pity. Weapon claims use a separate stream.
    if (seq(row) == null || lastSeq != null && seq(row) !== lastSeq + 1n) {
      const target = targets.get(info.targetKey);
      const rewardGap = !blocked && !weapon && info.c.infoBookEnabled && info.c.rawPoolType === 'limited'
        && lastSeq != null && seq(row) === lastSeq + 2n && previousRow?.pool_id === row.pool_id
        && !nonPull(previousRow) && !isFreeHistoryPull(previousRow) && !previousRow.statistics_excluded
        && !nonPull(row) && !isFreeHistoryPull(row) && !row.statistics_excluded
        && time(row.timestamp) > time(previousRow.timestamp)
        && row.batch_id && previousRow.batch_id && row.batch_id !== previousRow.batch_id
        && target?.known && target.count === info.c.rules.infoBookThreshold
        && freeCounts.get(row.pool_id) === info.c.freeTenPullLimit * 10 && !usedRewards.has(row.pool_id);
      if (rewardGap) {
        usedRewards.add(row.pool_id);
        result.continuity.inferredRewards.push({ poolName: info.pool.name, at: row.timestamp });
        if (pity.get(scope) != null) inferredPity.add(scope);
        if (!target.seen) target.inferred = true;
      } else {
        result.continuity.unknownGaps++;
        for (const key of pity.keys()) pity.set(key, null);
        for (const state of targets.values()) { state.known = false; state.inferred = false; }
        inferredPity.clear(); prefixComplete = false; streakItems = [];
        uncertainUntil = Math.max(uncertainUntil, time(row.timestamp) ?? Infinity);
      }
    }
    lastSeq = seq(group.at(-1)); previousRow = group.at(-1);
    if (nonPull(row)) { result.continuity.confirmedRewards++; usedRewards.add(row.pool_id); continue; }
    if (isFreeHistoryPull(row)) { freeCounts.set(row.pool_id, (freeCounts.get(row.pool_id) || 0) + group.length); continue; }
    if (!info.supported) continue;
    if (row.statistics_excluded === true) {
      pity.set(scope, null); inferredPity.delete(scope);
      if (targets.has(info.targetKey)) targets.get(info.targetKey).known = false;
      prefixComplete = false; streakItems = [];
      uncertainUntil = Math.max(uncertainUntil, time(row.timestamp) ?? Infinity); continue;
    }
    const unit = { ...blank(), observed: group.length, startAt: row.timestamp, endAt: group.at(-1).timestamp };
    units.push(unit);
    const six = group.filter(item => Number(item.rarity) === 6), classifications = six.map(item => classify(item, info, catalog));
    const upCount = classifications.filter(Boolean).length;
    if (!pity.has(scope)) pity.set(scope, baselineKnown(pityStarts, scope) ? 0 : null);
    if (!targets.has(info.targetKey)) targets.set(info.targetKey, { known: baselineKnown(targetStarts, info.targetKey), count: 0, seen: false, inferred: false });
    const target = targets.get(info.targetKey), before = pity.get(scope) ?? null;
    const targetKnown = target.known || target.seen;
    if (targetKnown) targetChecks += group.length;
    if (before != null) pityChecks += group.length;
    const rules = info.c.rules, firstLimit = weapon ? rules.guaranteedLimitedClaimPity : rules.guaranteedLimitedPity;
    const forcedUp = target.known && !target.seen && target.count + 1 >= firstLimit;
    let reason = blocked ? 'manual' : weapon && group.length !== 10 ? 'batch' : before == null ? 'initial'
      : !info.target || classifications.includes(null) ? 'identity' : !targetKnown ? 'target' : null;
    const position = before == null ? null : before + 1, hardLimit = weapon ? rules.sixStarClaimPity : rules.sixStarPity;
    if (position != null && position >= hardLimit && six.length === 0 || forcedUp && upCount === 0) reason = 'rule';
    if (reason) { result.excluded[reason] += group.length; streakItems = []; }
    else {
      const probability = weapon ? forcedUp || position >= hardLimit ? 1 + 9 * rules.sixStarBaseProbability : 10 * rules.sixStarBaseProbability
        : forcedUp || position >= hardLimit ? 1 : Math.min(1, rules.sixStarBaseProbability + Math.max(0, position - rules.sixStarSoftPityStart + 1) * rules.sixStarSoftPityIncrease);
      const upProbability = forcedUp ? weapon ? 1 + 9 * rules.sixStarBaseProbability * rules.upProbability : 1 : probability * rules.upProbability;
      Object.assign(unit, { sample: group.length, actual: six.length, expected: probability, upActual: upCount, upExpected: upProbability,
        inferredSample: inferredPity.has(scope) || target.inferred ? group.length : 0 });
      if (forcedUp) streakItems = [];
      else for (const [index, up] of classifications.entries()) {
        result.chances++;
        if (!up) { streakItems = []; continue; }
        result.wins++; streakItems.push(highlightItem(six[index], info, catalog));
        if (streakItems.length >= 2 && streakItems.length >= bestStreak) {
          bestStreak = streakItems.length;
          result.highlightRecords.streak = { items: [...streakItems], count: bestStreak, startAt: streakItems[0].at, endAt: streakItems.at(-1).at };
        }
      }
    }
    if (forcedUp && upCount > 0) result.guarantee++;
    if (before != null && (!weapon || group.length === 10) && six.length && reason !== 'rule') {
      if (position === hardLimit) result.hard++;
      if (!weapon && position >= 66 && position < 80) result.soft++;
      if (position <= (result.best ?? Infinity) && !blocked) result.highlightRecords.fastest = {
        items: six.map(item => highlightItem(item, info, catalog)), position, at: row.timestamp,
        poolName: info.pool.name, poolNameEn: info.pool.name_en || null, inferred: inferredPity.has(scope) };
      result.best = Math.min(result.best ?? Infinity, position); result.longest = Math.max(result.longest ?? 0, position);
      const bin = weapon ? Math.min(position - 1, 3) : position <= 20 ? 0 : position <= 40 ? 1 : position <= 65 ? 2 : position <= 79 ? 3 : 4;
      result.distribution[bin]++;
    }
    if (reason === 'rule' || weapon && group.length !== 10) pity.set(scope, null);
    else if (six.length) pity.set(scope, 0);
    else if (before != null) pity.set(scope, before + 1);
    if (six.length || reason === 'rule' || weapon && group.length !== 10) inferredPity.delete(scope);
    if (upCount) { target.seen = true; target.inferred = false; }
    if (weapon && group.length !== 10 || reason === 'rule') target.known = false;
    if (target.known) target.count++;
  }
  Object.assign(result, groupLuckUnitsByVersion(units, versions), sumLuckWindows(units));
  if (!targetChecks) result.guarantee = null;
  if (!pityChecks) { result.hard = null; result.soft = null; }
  return result;
}

/** Complete, owner-scoped history only; never call this on a paginated UI list. */
export function buildPersonalLuck({ history, pools, characters, entries = [], versionConfig, fetchedAt }) {
  const versions = getStartedLuckVersions(versionConfig, fetchedAt), catalog = buildCatalogIndex(characters);
  const infos = new Map(pools.map(pool => [pool.id, poolInfo(pool, catalog)]));
  const normalized = history.map(row => ({ ...row, pool_id: row.poolId ?? row.pool_id, record_id: row.id ?? row.record_id,
    seq_id: row.seqId ?? row.seq_id, batch_id: row.batchId ?? row.batch_id,
    statistics_excluded: row.statisticsExcluded ?? row.statistics_excluded }));
  const accounts = [];
  for (const [key, raw] of Map.groupBy(normalized, storedAccountKey)) {
    if (!key) continue;
    const seen = new Set();
    const rows = raw.filter(row => { const id = JSON.stringify([row.pool_id, row.seq_id || row.record_id]);
      if (seen.has(id)) return false; seen.add(id); return true; });
    const accountEntries = entries.filter(entry => storedAccountKey(entry) === key);
    accounts.push({ key, character: analyzeEntity(rows, infos, catalog, 'character', accountEntries, versions),
      weapon: analyzeEntity(rows, infos, catalog, 'weapon', accountEntries, versions) });
  }
  return { version: 1, fetchedAt, accounts };
}
