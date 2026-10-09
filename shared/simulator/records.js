/** One canonical event kind for inheritance, simulation, resources and exports. */
export function classifyRecord(record = {}) {
  if (record.kind) return record.kind;
  if (record.specialType === 'gift' || record.special_type === 'gift') return 'gift';
  if (
    record.isInfoBook === true ||
    record.is_info_book === true ||
    record.isInfoBookPull === true ||
    record.is_info_book_pull === true ||
    record.specialType === 'info_book' ||
    record.special_type === 'info_book'
  )
    return 'info_book';
  if (record.isFree === true || record.is_free === true || record.isFreePull === true || record.is_free_pull === true)
    return 'free';
  return 'paid';
}

export function recordTimestamp(record) {
  const value = record.timestamp ?? record.gacha_time ?? record.created_at ?? 0;
  return typeof value === 'number' ? value : new Date(value).getTime() || 0;
}

export function compareRecords(left, right) {
  return (
    recordTimestamp(left) - recordTimestamp(right) ||
    Number(left.seqId ?? left.seq_id ?? left.sequenceIndex ?? 0) -
      Number(right.seqId ?? right.seq_id ?? right.sequenceIndex ?? 0) ||
    String(left.id ?? left.record_id ?? left.eventId ?? '').localeCompare(
      String(right.id ?? right.record_id ?? right.eventId ?? '')
    )
  );
}

export function toDisplayRecord(record) {
  return {
    ...record,
    pullNumber: record.sequenceIndex,
    isLimited: record.isUp,
    isFree: record.kind === 'free',
    isFreePull: record.kind === 'free',
    isInfoBookPull: record.kind === 'info_book',
    specialType: record.kind === 'gift' ? 'gift' : undefined,
    isTenPull: record.batchId != null,
    batchIndex: record.batchIndex,
  };
}
