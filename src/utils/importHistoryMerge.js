import { getHistoryImportDedupKey } from './dataImport.js';
import { normalizeGameAccountServerId } from './gameAccountMetadata.js';

const text = value => String(value ?? '').trim();
const kwer = row => [row.record_id, row.id, row.seq_id, row.seqId, row.batch_id, row.batchId]
  .some(value => text(value).startsWith('endgacha:'));
const syntheticSequence = row => text(row.seqId || row.seq_id).startsWith('endgacha:');
const freeKnown = row => row.importFreeStatusKnown !== false;
const specialType = row => text(row.specialType || row.special_type);
const specialKnown = row => !kwer(row) || Boolean(specialType(row));

function compatibleAttributes(left, right) {
  if (freeKnown(left) && freeKnown(right) && Boolean(left.isFree || left.is_free) !== Boolean(right.isFree || right.is_free)) return false;
  return !specialKnown(left) || !specialKnown(right) || specialType(left) === specialType(right);
}

/** Match each existing pull at most once. Batch content is needed when TXT has
 * no source seq, and must keep repeated items inside the same ten-pull. */
export function filterImportedHistory(records = [], existing = [], pools = []) {
  const poolNames = new Map(pools.map(pool => [text(pool.pool_id || pool.id), text(pool.name)]));
  const canonicalPools = new Map();
  for (const pool of pools) {
    const id = text(pool.pool_id || pool.id), name = text(pool.name);
    if (id.startsWith('endgacha_kwer_') || !name) continue;
    if (!canonicalPools.has(name)) canonicalPools.set(name, new Set());
    canonicalPools.get(name).add(id);
  }
  const canonical = row => {
    const id = text(row.poolId || row.pool_id);
    const candidates = canonicalPools.get(poolNames.get(id));
    const pool = id.startsWith('endgacha_kwer_') && candidates?.size === 1 ? [...candidates][0] : id;
    const serverScope = text(row.serverScope || row.server_scope) || normalizeGameAccountServerId(row) || 'legacy';
    return { ...row, poolId: pool, pool_id: pool, serverScope, server_scope: serverScope };
  };
  const points = existing.map(canonical);
  const exact = new Map(), batches = new Map();
  const batchKey = row => {
    const time = Date.parse(row.timestamp);
    const name = text(row.character_name || row.name || row.item_name);
    if (!Number.isFinite(time) || !name) return null;
    return JSON.stringify([text(row.gameUid || row.game_uid), row.serverScope, row.poolId, time, name, Number(row.rarity)]);
  };
  const index = (map, key, i) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  };
  points.forEach((row, i) => { index(exact, getHistoryImportDedupKey(row), i); index(batches, batchKey(row), i); });
  const used = new Set(), seenKeys = new Set(), unmatched = [], added = new Set();
  // Reserve real sequence matches before any content match can consume them.
  records.forEach((raw, recordIndex) => {
    const row = canonical(raw);
    const exactKey = getHistoryImportDedupKey(row);
    if (exactKey && seenKeys.has(exactKey)) return;
    if (exactKey) seenKeys.add(exactKey);
    const match = syntheticSequence(row) ? undefined : (exact.get(exactKey) || []).find(i => !used.has(i));
    if (match != null) used.add(match);
    else unmatched.push({ row, recordIndex });
  });
  // Match explicit attributes first; an omitted TXT flag must not consume the
  // only free/paid result needed by another, more complete source entry.
  const specificity = row => Number(freeKnown(row)) + Number(specialKnown(row));
  unmatched.sort((a, b) => specificity(b.row) - specificity(a.row));
  for (const { row, recordIndex } of unmatched) {
    const key = batchKey(row);
    const match = key == null ? undefined : (batches.get(key) || []).find(i => !used.has(i)
      && (syntheticSequence(row) || syntheticSequence(points[i]))
      && compatibleAttributes(row, points[i]));
    if (match != null) used.add(match);
    else added.add(recordIndex);
  }
  return records.filter((_, i) => added.has(i));
}
