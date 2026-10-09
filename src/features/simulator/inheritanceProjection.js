import { createPoolState, createSession, replayHistoryEvent } from '../../../shared/simulator/engine.js';
import { classifyRecord, compareRecords } from '../../../shared/simulator/records.js';
import { annotateInfoBookPulls } from '../../utils/historyInfoBook.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { isTargetSixStarHistoryRecord } from '../../utils/poolScopedHistory.js';
import {
  getHistoryRecordAccountKey,
  getHistoryRecordGameUid,
  getHistoryRecordTimestampMs,
} from '../../utils/gameAccountMetadata.js';

export const SIMULATOR_INHERITANCE_CONTRACT_VERSION = 2;

const text = (value) => String(value ?? '').trim();
const poolIdOf = (pool) => text(pool?.id ?? pool?.pool_id ?? pool?.poolId);

function accountKeyOf(record) {
  if (!getHistoryRecordGameUid(record)) return 'legacy';
  const serverScope = text(record?.server_scope ?? record?.serverScope);
  const metadata =
    serverScope && serverScope !== 'legacy' && !text(record?.server_id ?? record?.serverId)
      ? { ...record, server_id: serverScope }
      : record;
  return getHistoryRecordAccountKey(metadata) || getHistoryRecordGameUid(record);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

export function buildSimulatorCatalogSignature({ pools = [] } = {}) {
  const serialized = JSON.stringify(
    (Array.isArray(pools) ? pools : [])
      .filter((pool) => poolIdOf(pool))
      .map((pool) => ({
        id: poolIdOf(pool),
        capabilities: stableValue(resolvePoolCapabilities(pool)),
        startTime: pool.start_time ?? pool.startTime ?? pool.created_at ?? null,
        endTime: pool.end_time ?? pool.endTime ?? null,
        upCharacter: pool.up_character ?? pool.upCharacter ?? null,
        featuredCharacters: stableValue(pool.featured_characters ?? pool.featuredCharacters ?? []),
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
  // A compact consistency fingerprint; it is not an authentication primitive.
  let first = 2166136261;
  let second = 3339675911;
  for (let index = 0; index < serialized.length; index += 1) {
    first = Math.imul(first ^ serialized.charCodeAt(index), 16777619);
    second = Math.imul(second ^ serialized.charCodeAt(index), 2246822519);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

/** Builds a serializable projection without editing imported history or catalog data. */
export function buildSimulatorInheritanceProjection({
  history = [],
  pools = [],
  currentUserId = '',
  accountKey = '',
  resourceSettings = {},
} = {}) {
  const catalog = (Array.isArray(pools) ? pools : []).filter((pool) => poolIdOf(pool));
  const infoBookPoolsById = new Map();
  catalog.forEach((pool) => {
    const id = poolIdOf(pool);
    if (!infoBookPoolsById.has(id)) infoBookPoolsById.set(id, pool);
  });
  const orderedInfoBookPools = Array.from(infoBookPoolsById.values())
    .filter((pool) => resolvePoolCapabilities(pool).infoBookEnabled)
    .sort(
      (left, right) =>
        (Date.parse(left.start_time ?? left.startTime ?? left.created_at ?? '') || 0) -
          (Date.parse(right.start_time ?? right.startTime ?? right.created_at ?? '') || 0) ||
        poolIdOf(left).localeCompare(poolIdOf(right))
    );
  const nextPoolIds = new Map(
    orderedInfoBookPools.map((pool, index) => [poolIdOf(pool), poolIdOf(orderedInfoBookPools[index + 1]) || null])
  );
  const descriptors = new Map();
  catalog.forEach((pool) => {
    const id = poolIdOf(pool);
    const descriptor = {
      id,
      capabilities: resolvePoolCapabilities(pool),
      // The core reads descriptor.pool for limited-weapon gifts and
      // descriptor.nextPoolId when it earns an info book, so hand both over
      // in one unified shape instead of patching the session per event.
      pool: {
        ...pool,
        id,
        pool_id: pool?.pool_id || id,
        isLimitedWeapon: pool?.isLimitedWeapon ?? pool?.is_limited_weapon,
      },
      nextPoolId: nextPoolIds.get(id) || null,
    };
    descriptors.set(id, descriptor);
    if (pool.pool_id) descriptors.set(text(pool.pool_id), descriptor);
  });
  const scopedHistory = (Array.isArray(history) ? history : []).filter(
    (record) =>
      (!currentUserId || !record?.user_id || record.user_id === currentUserId) &&
      (!accountKey || accountKeyOf(record) === accountKey)
  );
  // Only rows that carry no info-book flag at all fall back to the existing
  // annotation; explicit flags stay authoritative, and "used" is never inferred
  // here because only the core consumes real info-book events.
  const hasExplicitInfoBookFlag = scopedHistory.some(
    (record) =>
      (record?.is_info_book !== undefined && record?.is_info_book !== null) ||
      record?.isInfoBookPull !== undefined ||
      record?.is_info_book_pull !== undefined
  );
  const records = (hasExplicitInfoBookFlag ? scopedHistory : annotateInfoBookPulls(scopedHistory, catalog))
    .map((record) => {
      const rawPoolId = text(record?.poolId ?? record?.pool_id);
      const descriptor = descriptors.get(rawPoolId);
      const poolId = descriptor?.id || rawPoolId;
      const rarity = Number(record?.rarity) || 0;
      const timestamp = getHistoryRecordTimestampMs(record);
      const sourceSequence = Number(record?.sequenceIndex ?? record?.seqId ?? record?.seq_id ?? 0) || 0;
      return {
        eventId: `${accountKey || accountKeyOf(record)}:${poolId}:${text(record?.eventId ?? record?.record_id ?? record?.id) || `${sourceSequence}:${timestamp}`}`,
        // The source order only keeps equal timestamps stable; the per-pool
        // sequence index is assigned while accumulating below.
        sequenceIndex: sourceSequence,
        kind: classifyRecord(record),
        rarity,
        isUp: rarity === 6 && Boolean(descriptor && isTargetSixStarHistoryRecord(record, descriptor.pool)),
        characterName:
          text(record?.characterName ?? record?.character_name ?? record?.item_name ?? record?.name) || '未知对象',
        characterId: record?.characterId ?? record?.character_id ?? null,
        timestamp,
        poolId,
        ...(record?.pityBefore !== undefined ? { pityBefore: Number(record.pityBefore) || 0 } : {}),
      };
    })
    .sort(compareRecords);
  let session = createSession({ scope: accountKey, resourceSettings });
  const histories = Object.fromEntries(catalog.map((pool) => [poolIdOf(pool), []]));
  records.forEach((record) => {
    const poolHistory = (histories[record.poolId] ||= []);
    const event = { ...record, sequenceIndex: poolHistory.length + 1 };
    poolHistory.push(event);
    const descriptor = descriptors.get(event.poolId);
    if (!descriptor?.capabilities.isResolved || ![4, 5, 6].includes(event.rarity) || !Number.isFinite(event.timestamp))
      return;
    session = replayHistoryEvent(session, event, descriptor);
  });
  for (const [poolId, poolHistory] of Object.entries(histories)) {
    const descriptor = descriptors.get(poolId);
    if (poolHistory.length && descriptor?.capabilities.isResolved) {
      session.pools[poolId] = {
        ...(session.pools[poolId] || createPoolState(descriptor)),
        sequenceCount: poolHistory.length,
      };
    }
  }
  return {
    contractVersion: SIMULATOR_INHERITANCE_CONTRACT_VERSION,
    session,
    histories,
    catalogSignature: buildSimulatorCatalogSignature({ pools: catalog }),
  };
}
