import { getHistoryImportDedupKey } from './dataImport.js';
import { normalizeGameAccountServerId } from './gameAccountMetadata.js';

const text = value => String(value ?? '').trim();
const kwer = row => [row.record_id, row.id, row.seq_id, row.seqId, row.batch_id, row.batchId]
  .some(value => text(value).startsWith('endgacha:'));

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
    return JSON.stringify([text(row.gameUid || row.game_uid), row.serverScope, row.poolId, time, name,
      Number(row.rarity), Boolean(row.isFree || row.is_free), row.specialType || row.special_type || null]);
  };
  const index = (map, key, i) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  };
  points.forEach((row, i) => { index(exact, getHistoryImportDedupKey(row), i); index(batches, batchKey(row), i); });
  const used = new Set(), seenKeys = new Set(), added = [];
  for (const raw of records) {
    const row = canonical(raw);
    const exactKey = getHistoryImportDedupKey(row);
    if (exactKey && seenKeys.has(exactKey)) continue;
    if (exactKey) seenKeys.add(exactKey);
    const syntheticSequence = text(row.seqId || row.seq_id).startsWith('endgacha:');
    let match = (exact.get(exactKey) || []).find(i => !used.has(i)
      && (!syntheticSequence || batchKey(row) === batchKey(points[i])));
    if (match == null && kwer(row)) match = (batches.get(batchKey(row)) || []).find(i => !used.has(i) && kwer(points[i]));
    if (match != null) { used.add(match); continue; }
    added.push(raw);
  }
  return added;
}
