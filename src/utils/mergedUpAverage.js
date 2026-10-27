import { statisticsTargetReferences } from '../../shared/statisticsScopes.js';
import { buildCatalogIndex } from './scopedLegacyStatistics.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import { isFreeHistoryPull, isGiftHistoryPull } from './historyInfoBook.js';

export const MERGED_UP_AVERAGE_VERSION = 1;
const mergedText = value => String(value ?? '').trim();
const getMergedPoolId = row => mergedText(row.poolId ?? row.pool_id ?? row.id);
const emptyCounts = () => ({ pulls: 0, upCount: 0, unknownSixCount: 0 });

function categoryFor(pool, capabilities) {
  if (!capabilities.isResolved || capabilities.targetMode !== 'single-up') return null;
  if (['reconstruction', 'reconstruction_claim'].includes(capabilities.extraSubtype)) return 'reconstruction';
  return pool.type !== 'extra' ? 'limited' : null;
}

/** Resolve exact catalog identities; imported isStandard/isUp flags are not evidence. */
function resolveTarget(pool, entityType, catalog) {
  const references = statisticsTargetReferences(pool);
  const ids = references.map(reference => catalog.resolveRecordId({
    rarity: 6, ...(catalog.get(reference) ? { character_id: reference } : { name: reference }),
  }, entityType));
  return ids.length && ids.every(Boolean) && new Set(ids).size === 1 ? ids[0] : null;
}

function classifyUp(row, fact, targetId, catalog) {
  if (!targetId) return null;
  const id = catalog.resolveRecordId(row, fact.entityType);
  if (!id) return null;
  const name = mergedText(row.character_name ?? row.characterName ?? row.item_name ?? row.itemName ?? row.name);
  // Conflicting ID/name pairs must remain unclassified, even if one matches the UP.
  if (name && catalog.resolveRecordId({ name, rarity: 6 }, fact.entityType) !== id) return null;
  return id === targetId;
}

/** Additive facts for one account. No raw records, tokens or per-pool averages are persisted. */
export function buildMergedUpAverage({ history = [], pools = [], characters = [], entries = [] } = {}) {
  const catalog = buildCatalogIndex(characters);
  const byId = new Map();
  const targets = new Map();
  for (const pool of pools) {
    const capabilities = resolvePoolCapabilities(pool);
    const category = categoryFor(pool, capabilities);
    const id = getMergedPoolId(pool);
    if (!id || !category || byId.has(id)) continue;
    byId.set(id, { poolId: id, entityType: capabilities.entityType, category,
      excludeFree: { ...emptyCounts(), incomplete: false }, includeFree: { ...emptyCounts(), incomplete: false } });
    targets.set(id, resolveTarget(pool, capabilities.entityType, catalog));
  }
  const seen = new Set();
  for (const row of history) {
    const fact = byId.get(getMergedPoolId(row));
    if (!fact || isGiftHistoryPull(row) || row.drawMethod === 'gift'
      || row.statistics_excluded === true || row.statisticsExcluded === true) continue;
    const sequence = row.seq_id ?? row.seqId ?? row.record_id ?? row.id;
    if (sequence != null) {
      const key = JSON.stringify([row.user_id ?? '', row.game_uid ?? row.gameUid ?? '',
        row.server_scope ?? row.serverScope ?? row.server_id ?? row.serverId ?? '', fact.poolId, mergedText(sequence)]);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const free = isFreeHistoryPull(row) || row.is_free_pull === true || row.isFreePull === true || row.drawMethod === 'free';
    const up = Number(row.rarity) === 6 ? classifyUp(row, fact, targets.get(fact.poolId), catalog) : false;
    for (const counts of free ? [fact.includeFree] : [fact.excludeFree, fact.includeFree]) {
      counts.pulls += 1;
      if (up === true) counts.upCount += 1;
      if (up === null) counts.unknownSixCount += 1;
    }
  }
  // Supplementary counts do not always prove total draws or the identities of every six-star.
  for (const entry of entries) {
    if (entry.deleted_at || entry.deletedAt || entry.kind === 'potential-evidence') continue;
    const fact = byId.get(getMergedPoolId(entry));
    const method = entry.values?.drawMethod ?? entry.drawMethod;
    if (fact && method !== 'gift') {
      fact.includeFree.incomplete = true;
      if (method !== 'free') fact.excludeFree.incomplete = true;
    }
  }
  return { version: MERGED_UP_AVERAGE_VERSION, pools: [...byId.values()] };
}

export function aggregateMergedUpAverage(data, { entityType, categories = ['limited', 'reconstruction'], includeFree = false } = {}) {
  if (data?.version !== MERGED_UP_AVERAGE_VERSION || !Array.isArray(data.pools)) return null;
  const selected = data.pools.filter(fact => fact.entityType === entityType && categories.includes(fact.category));
  const variant = includeFree ? 'includeFree' : 'excludeFree';
  const counts = selected.reduce((total, fact) => {
    const addition = fact[variant];
    for (const key of Object.keys(total)) total[key] += addition[key];
    return total;
  }, emptyCounts());
  const incomplete = selected.some(fact => fact[variant].incomplete);
  return { ...counts, poolIds: selected.filter(fact => fact[variant].pulls > 0 || fact[variant].incomplete).map(fact => fact.poolId),
    incomplete, average: !incomplete && counts.unknownSixCount === 0 && counts.upCount > 0 ? counts.pulls / counts.upCount : null };
}
