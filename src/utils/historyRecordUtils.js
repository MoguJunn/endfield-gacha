export const MAX_HISTORY_PITY = 80;

export function clampHistoryPity(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(MAX_HISTORY_PITY, parsed));
}

export function hasCompositeHistoryKey(record) {
  return Boolean(
    record &&
    record.game_uid &&
    record.pool_id !== null &&
    record.pool_id !== undefined &&
    record.seq_id
  );
}

export function hasServerScopedCompositeHistoryKey(record) {
  return Boolean(hasCompositeHistoryKey(record) && record.server_id);
}

export function splitHistoryUpsertGroups(records) {
  const serverScopedCompositeKeyRecords = [];
  const compositeKeyRecords = [];
  const legacyRecords = [];

  records.forEach((record) => {
    if (hasServerScopedCompositeHistoryKey(record)) {
      serverScopedCompositeKeyRecords.push(record);
    } else if (hasCompositeHistoryKey(record)) {
      compositeKeyRecords.push(record);
    } else {
      legacyRecords.push(record);
    }
  });

  return { serverScopedCompositeKeyRecords, compositeKeyRecords, legacyRecords };
}
