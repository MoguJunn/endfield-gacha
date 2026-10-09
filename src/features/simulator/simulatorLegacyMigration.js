import {
  createSession,
  getPoolState,
  replayHistoryEvent,
  restorePoolCounters,
  seriesKey,
} from '../../../shared/simulator/engine.js';
import { classifyRecord, compareRecords, recordTimestamp } from '../../../shared/simulator/records.js';
import { normalizeResourceSettings } from '../../utils/resourceEconomy.js';

function readKnown(key, version, storage) {
  const text = storage.getItem(key);
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed.version !== version) {
    const error = new Error('simulator_legacy_version');
    error.code = 'simulator_legacy_version';
    throw error;
  }
  return parsed;
}

/** Read-only migration: a failed IndexedDB commit leaves every original key intact. */
export function readLegacySimulatorSession(scope, descriptors, storage = globalThis.localStorage) {
  const suffix = `__${scope}`;
  // Unscoped saves are guest data; never assign them to the first authenticated account.
  const unscoped = scope === 'u:guest|g:all';
  const key = (base) =>
    storage.getItem(`${base}${suffix}`) != null ? `${base}${suffix}` : unscoped ? base : `${base}${suffix}`;
  const settings = readKnown(key('gacha_simulator_resource_settings'), '1.0', storage);
  let session = createSession({ scope, resourceSettings: normalizeResourceSettings(settings?.settings) });
  const histories = {};
  const savedPools = {};
  const timeline = [];
  for (const descriptor of Object.values(descriptors)) {
    const saved = readKnown(key(`gacha_simulator_state_sim_${descriptor.id}`), '1.0', storage)?.state;
    if (!saved) continue;
    savedPools[descriptor.id] = saved;
    for (const record of saved.pullHistory || []) timeline.push({ ...record, poolId: descriptor.id });
  }
  timeline.sort(compareRecords);
  for (const row of timeline) {
    const descriptor = descriptors[row.poolId];
    const before = getPoolState(session, descriptor);
    const sequence = (histories[descriptor.id]?.length || 0) + 1;
    const record = {
      ...row,
      poolId: descriptor.id,
      kind: classifyRecord(row),
      timestamp: recordTimestamp(row),
      sequenceIndex: sequence,
      eventId: `legacy:${scope}:${descriptor.id}:${sequence}`,
      characterName: row.characterName || row.name,
      characterId: row.characterId || row.character_id || row.characterName || row.name,
      rarity: Number(row.rarity),
      isUp: Boolean(row.isUp || row.isLimited),
      batchId: row.isTenPull
        ? `legacy:${descriptor.id}:${Math.floor((before.sequenceCount - Number(row.batchIndex || 0)) / 10)}`
        : null,
    };
    if (descriptor.capabilities.isResolved) session = replayHistoryEvent(session, record, descriptor);
    (histories[descriptor.id] ||= []).push(record);
  }
  for (const [poolId, saved] of Object.entries(savedPools))
    session = restorePoolCounters(session, descriptors[poolId], saved);
  const shared = readKnown(key('gacha_simulator_shared_pity'), '1.0', storage)?.pityState;
  if (shared) session.sharedPityState = { ...session.sharedPityState, ...shared };
  for (const descriptor of Object.values(descriptors)) {
    const series = seriesKey(descriptor.capabilities);
    if (!series) continue;
    const saved = readKnown(key(`gacha_simulator_series_state_${series}`), '1.0', storage)?.seriesState;
    if (saved) session.seriesStates[series] = { ...session.seriesStates[series], ...saved };
  }
  const books = readKnown(key('gacha_simulator_info_book'), '2.0', storage)?.infoBooks;
  if (books)
    session.infoBooks = Object.fromEntries(
      Object.entries(books).map(([id, book]) => [
        id.replace(/^sim_/, ''),
        {
          ...book,
          targetPoolId: book.targetPoolId?.replace(/^sim_/, '') || null,
        },
      ])
    );
  session.currentPoolId = storage.getItem(key('simulator_currentPoolId'))?.replace(/^sim_/, '') || null;
  return { session, histories };
}
