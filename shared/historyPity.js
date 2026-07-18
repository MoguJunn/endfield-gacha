function normalizeBoolean(value) {
  return value === true;
}

function readTimestamp(record = {}) {
  const raw = record.timestamp ?? record.gachaTs ?? record.gacha_ts;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareSequence(left = {}, right = {}) {
  const leftSeq = String(left.seqId ?? left.seq_id ?? '');
  const rightSeq = String(right.seqId ?? right.seq_id ?? '');
  if (/^\d+$/.test(leftSeq) && /^\d+$/.test(rightSeq)) {
    const leftNumber = BigInt(leftSeq);
    const rightNumber = BigInt(rightSeq);
    if (leftNumber < rightNumber) return -1;
    if (leftNumber > rightNumber) return 1;
    return 0;
  }
  return leftSeq.localeCompare(rightSeq);
}

export function historyRecordCountsTowardPity(record = {}) {
  const isFree = normalizeBoolean(record.isFree) || normalizeBoolean(record.is_free);
  const isInfoBook = normalizeBoolean(record.isInfoBook) || normalizeBoolean(record.is_info_book);
  const specialType = record.specialType ?? record.special_type ?? null;
  return !isFree && !isInfoBook && specialType !== 'gift';
}

export function calculateHistoryPity(records, { maxPity = 80 } = {}) {
  let pity = 0;
  const sortedRecords = [...(Array.isArray(records) ? records : [])].sort((left, right) => {
    const timestampDifference = readTimestamp(left) - readTimestamp(right);
    return timestampDifference || compareSequence(left, right);
  });

  return sortedRecords.map((record) => {
    const countsTowardPity = historyRecordCountsTowardPity(record);
    if (countsTowardPity) {
      pity += 1;
    }

    const nextRecord = {
      ...record,
      pity: Math.min(Math.max(pity, 0), maxPity),
    };
    const rarity = Number(record.rarity ?? record.quality ?? record.qualityLevel);
    if (countsTowardPity && rarity === 6) {
      pity = 0;
    }
    return nextRecord;
  });
}

export default {
  calculateHistoryPity,
  historyRecordCountsTowardPity,
};
