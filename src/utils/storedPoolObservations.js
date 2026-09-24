import { buildPoolObservations } from './poolObservationStats.js';
import { getRecordPoolVersion } from '../../shared/poolVersion.js';
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
export function buildStoredPoolObservations({ history, poolId, accountKey = null, catalog = [], directory = null, entityType = null, directoryIndex = null }) {
  return prepareStoredPoolObservations({ history, catalog, directory, entityType, accountKey, directoryIndex })(poolId, accountKey);
}

export function createStoredObservationDirectory({ catalog = [], directory = null, entityType = null }) {
  const names = new Map([...(directory || []), ...catalog].map((item) => [String(item.id ?? item.character_id), item]));
  const nameIndex = new Map();
  for (const item of directory || catalog) {
    if (entityType && item.type !== entityType) continue;
    for (const label of new Set([item.name, ...(item.aliases || [])].filter(Boolean))) {
      const key = JSON.stringify([label.trim(), Number(item.rarity)]);
      if (!nameIndex.has(key)) nameIndex.set(key, []);
      nameIndex.get(key).push(String(item.id));
    }
  }
  return { names, nameIndex };
}

/** Task-local reader: normalize and order once, then visit only the requested
 * pool/account buckets. Nothing is retained globally or after this reader dies. */
export function prepareStoredPoolObservations({ history, catalog = [], directory = null, entityType = null, accountKey = null, directoryIndex = null }) {
  const buckets = new Map();
  const getBucket = (poolId, account) => {
    if (!buckets.has(poolId)) buckets.set(poolId, new Map());
    const accounts = buckets.get(poolId);
    if (!accounts.has(account)) accounts.set(account, { accountKey: account, records: [], matchedByName: 0,
      exclusions: { missingIdentity: 0, invalidTime: 0, invalidRarity: 0, duplicate: 0 },
      unidentifiedByRarity: { 4: 0, 5: 0, 6: 0 }, firstTimestamp: Infinity, lastTimestamp: -Infinity });
    return accounts.get(account);
  };
  const index = directoryIndex || createStoredObservationDirectory({ catalog, directory, entityType });
  const names = directory ? index.names : new Map(index.names);
  const nameIndex = index.nameIndex;
  const namesByAccount = new Map();
  const seen = new Map();
  const scoped = (accountKey ? history.filter((row) => storedAccountKey(row) === accountKey) : history.slice()).sort(compareHistoryTimelineAsc);
  for (const [sequence, row] of scoped.entries()) {
    const account = storedAccountKey(row);
    const recordPool = String(row.poolId ?? row.pool_id ?? '');
    const bucket = getBucket(recordPool, account);
    const rawItemId = String(row.character_id ?? row.characterId ?? row.item_id ?? '');
    const id = String(row.record_id ?? row.id ?? '');
    const timestamp = getHistoryTimelineTimestampMs(row);
    const rarity = Number(row.rarity);
    if (!seen.has(account)) seen.set(account, new Set());
    const accountSeen = seen.get(account);
    const reason = !account || !recordPool || !id ? 'missingIdentity'
      : !timestamp ? 'invalidTime' : ![4, 5, 6].includes(rarity) ? 'invalidRarity'
        : accountSeen.has(id) ? 'duplicate' : null;
    if (reason) {
      bucket.exclusions[reason]++;
      continue;
    }
    accountSeen.add(id);
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
        if (!isGiftHistoryPull(row)) bucket.matchedByName++;
      }
    }
    if (itemId && !index.names.has(itemId)) {
      if (!namesByAccount.has(account)) namesByAccount.set(account, new Map());
      const accountNames = namesByAccount.get(account);
      const fallback = { id: itemId, name: row.character_name || row.item_name || row.name || itemId, rarity };
      if (!accountNames.has(itemId)) accountNames.set(itemId, fallback);
      if (!names.has(itemId)) names.set(itemId, fallback);
    }
    if (!isGiftHistoryPull(row)) {
      if (!itemId) bucket.unidentifiedByRarity[rarity]++;
      bucket.firstTimestamp = Math.min(bucket.firstTimestamp, timestamp);
      bucket.lastTimestamp = Math.max(bucket.lastTimestamp, timestamp);
    }
    bucket.records.push({ id, accountKey: bucket.accountKey, poolId: recordPool, itemId, rarity, timestamp, sequence,
      poolVersion: getRecordPoolVersion(row),
      kind: isGiftHistoryPull(row) ? 'gift' : isFreeHistoryPull(row) ? 'free' : isInfoBookHistoryPull(row) ? 'infoBook' : 'pull',
      // Old imports defaulted missing isNew to false. Only a positive flag is proof;
      // a prior observed acquisition still proves repeat ownership.
      newItem: (row.is_new ?? row.isNew) === true ? true : null });
  }
  seen.clear();
  return (poolId, selectedAccount = null) => readPreparedPool({ buckets, names, catalog, poolId, accountKey: selectedAccount,
    accountNames: namesByAccount.get(selectedAccount) });
}

function readPreparedPool({ buckets, names, catalog, poolId, accountKey, accountNames }) {
  const accounts = buckets.get(poolId);
  const selected = accountKey ? [accounts?.get(accountKey)].filter(Boolean) : [...(accounts?.values() || [])];
  // Stream the normalized buckets rather than allocating a second flat history.
  function* records() { for (const bucket of selected) yield* bucket.records; }
  const exclusions = { missingIdentity: 0, invalidTime: 0, invalidRarity: 0, duplicate: 0 };
  const unidentifiedByRarity = { 4: 0, 5: 0, 6: 0 };
  let matchedByName = 0;
  let firstTimestamp = Infinity;
  let lastTimestamp = -Infinity;
  for (const bucket of selected) {
    for (const key of Object.keys(exclusions)) exclusions[key] += bucket.exclusions[key];
    for (const rarity of [4, 5, 6]) unidentifiedByRarity[rarity] += bucket.unidentifiedByRarity[rarity];
    matchedByName += bucket.matchedByName;
    firstTimestamp = Math.min(firstTimestamp, bucket.firstTimestamp);
    lastTimestamp = Math.max(lastTimestamp, bucket.lastTimestamp);
  }
  // First means first occurrence in this account's stored banner period.
  // This is a recorded-result metric, not a claim of complete in-game history.
  const stats = buildPoolObservations({ records: records(), poolId, accountKey, firstBasis: 'stored-period' });
  const items = stats.items.map((item) => ({ ...item,
    name: accountNames?.get(item.itemId)?.name || names.get(item.itemId)?.name || item.itemId,
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
      firstRecordAt: stats.total ? new Date(firstTimestamp).toISOString() : null,
      lastRecordAt: stats.total ? new Date(lastTimestamp).toISOString() : null } };
}
