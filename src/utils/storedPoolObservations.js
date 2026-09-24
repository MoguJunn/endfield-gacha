import { buildPoolObservations } from './poolObservationStats.js';
import { compareHistoryTimelineAsc, getHistoryTimelineTimestampMs } from './historyTimelineSort.js';
import { isFreeHistoryPull, isGiftHistoryPull, isInfoBookHistoryPull } from './historyInfoBook.js';

export const STORED_OBSERVATION_VERSION = 'stored-pool-observation-v3';

export function storedAccountKey(row) {
  const uid = String(row.game_uid ?? row.gameUid ?? '').trim();
  const scope = String(row.server_scope ?? row.serverScope ?? row.server_id ?? row.serverId ?? row.region ?? 'unknown').trim();
  return uid ? JSON.stringify([String(row.user_id ?? ''), uid, scope]) : null;
}

export function getStoredObservationAccounts(history) {
  const accounts = new Map();
  for (const row of history) {
    const key = storedAccountKey(row);
    if (!key || accounts.has(key)) continue;
    accounts.set(key, { key, gameUid: String(row.game_uid ?? row.gameUid),
      name: String(row.nick_name ?? row.nickName ?? row.game_uid ?? row.gameUid),
      serverScope: String(row.server_scope ?? row.serverScope ?? row.server_id ?? row.serverId ?? row.region ?? 'unknown') });
  }
  return [...accounts.values()];
}

/** The input must include all stored rows for this scope; never pass a UI history page. */
export function buildStoredPoolObservations({ history, poolId, accountKey = null, catalog = [], directory = null, entityType = null }) {
  const records = [];
  const names = new Map([...(directory || []), ...catalog].map((item) => [String(item.id ?? item.character_id), item]));
  const nameIndex = new Map();
  for (const item of directory || catalog) {
    if (entityType && item.type !== entityType) continue;
    for (const label of new Set([item.name, ...(item.aliases || [])].filter(Boolean))) {
      const key = JSON.stringify([label.trim(), Number(item.rarity)]);
      nameIndex.set(key, [...(nameIndex.get(key) || []), String(item.id)]);
    }
  }
  const exclusions = { missingIdentity: 0, invalidTime: 0, invalidRarity: 0, duplicate: 0 };
  let matchedByName = 0;
  const unidentifiedByRarity = { 4: 0, 5: 0, 6: 0 };
  const seen = new Set();
  const scoped = history.filter((row) => !accountKey || storedAccountKey(row) === accountKey).slice().sort(compareHistoryTimelineAsc);
  for (const [sequence, row] of scoped.entries()) {
    const account = storedAccountKey(row);
    const recordPool = String(row.poolId ?? row.pool_id ?? '');
    const rawItemId = String(row.character_id ?? row.characterId ?? row.item_id ?? '');
    const id = String(row.record_id ?? row.id ?? '');
    const timestamp = getHistoryTimelineTimestampMs(row);
    const rarity = Number(row.rarity);
    const key = JSON.stringify([account, id]);
    const reason = !account || !recordPool || !id ? 'missingIdentity'
      : !timestamp ? 'invalidTime' : ![4, 5, 6].includes(rarity) ? 'invalidRarity'
        : seen.has(key) ? 'duplicate' : null;
    if (reason) {
      if (recordPool === poolId) exclusions[reason]++;
      continue;
    }
    seen.add(key);
    const canonical = names.get(rawItemId);
    // A conflicting rarity/type cannot share the same item's cost timeline.
    // Retain the recorded result as unidentified at its recorded rarity.
    let itemId = rawItemId && (!directory || canonical && Number(canonical.rarity) === rarity
      && (!entityType || canonical.type === entityType)) ? rawItemId : null;
    if (!itemId && !rawItemId) {
      const label = String(row.character_name || row.item_name || row.name || '').trim();
      const matches = nameIndex.get(JSON.stringify([label, rarity]));
      if (matches?.length === 1) {
        itemId = matches[0];
        if (recordPool === poolId && !isGiftHistoryPull(row)) matchedByName++;
      }
    }
    if (itemId && !names.has(itemId)) names.set(itemId, { id: itemId, name: row.character_name || row.item_name || row.name || itemId, rarity });
    if (!itemId && recordPool === poolId && !isGiftHistoryPull(row)) unidentifiedByRarity[rarity]++;
    records.push({ id, accountKey: account, poolId: recordPool, itemId, rarity, timestamp, sequence,
      kind: isGiftHistoryPull(row) ? 'gift' : isFreeHistoryPull(row) ? 'free' : isInfoBookHistoryPull(row) ? 'infoBook' : 'pull',
      // Old imports defaulted missing isNew to false. Only a positive flag is proof;
      // a prior observed acquisition still proves repeat ownership.
      newItem: (row.is_new ?? row.isNew) === true ? true : null });
  }
  // First means first occurrence in this account's stored banner period.
  // This is a recorded-result metric, not a claim of complete in-game history.
  const stats = buildPoolObservations({ records, poolId, accountKey, firstBasis: 'stored-period' });
  const selected = records.filter((row) => row.poolId === poolId && row.kind !== 'gift');
  const firstTimestamp = selected.reduce((value, row) => Math.min(value, row.timestamp), Infinity);
  const lastTimestamp = selected.reduce((value, row) => Math.max(value, row.timestamp), -Infinity);
  const items = stats.items.map((item) => ({ ...item,
    name: names.get(item.itemId)?.name || item.itemId,
    nameEn: names.get(item.itemId)?.name_en || null }));
  for (const item of catalog) {
    const id = String(item.id ?? item.character_id ?? '');
    if (!id || items.some((entry) => entry.itemId === id)) continue;
    const empty = () => ({ sampleCount: 0, mean: null, points: [] });
    items.push({ itemId: id, name: item.name || id, nameEn: item.name_en || null, rarity: Number(item.rarity),
      count: 0, rate: 0, first: empty(), repeat: empty(), unknownClassification: 0, unknownCost: 0,
      repeatUnfinished: 0, nonObtainingAccounts: stats.participatingAccounts });
  }
  return { ...stats, items, costUnit: 'stored-results',
    meta: { schemaVersion: STORED_OBSERVATION_VERSION, excludedRecords: Object.values(exclusions).reduce((sum, value) => sum + value, 0), exclusions,
      matchedByName, unidentifiedRecords: Object.values(unidentifiedByRarity).reduce((sum, value) => sum + value, 0), unidentifiedByRarity,
      prefixVerified: false, firstBasis: 'stored-period', costBasis: 'stored-results',
      firstRecordAt: selected.length ? new Date(firstTimestamp).toISOString() : null,
      lastRecordAt: selected.length ? new Date(lastTimestamp).toISOString() : null } };
}
