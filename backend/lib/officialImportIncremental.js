import { filterOfficialImportPullRecords } from '../../shared/officialImportRecordNormalizer.js';

export const INCREMENTAL_PITY_CONTEXT_PAID_LIMIT = 80;

export function normalizeRecordSeqId(record) {
  const value = record?.seqId ?? record?.seq_id;
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

export function buildOfficialImportRecordKey({ gameUid, serverId, poolId, seqId }) {
  const normalizedGameUid = String(gameUid || '').trim();
  const normalizedServerId = String(serverId || '').trim();
  const normalizedPoolId = String(poolId || '').trim();
  const normalizedSeqId = seqId === null || seqId === undefined ? '' : String(seqId).trim();

  if (!normalizedGameUid || !normalizedPoolId || !normalizedSeqId) {
    return null;
  }

  if (normalizedServerId) {
    return `${normalizedGameUid}:server:${normalizedServerId}:${normalizedPoolId}:${normalizedSeqId}`;
  }

  return `${normalizedGameUid}:${normalizedPoolId}:${normalizedSeqId}`;
}

export function analyzeIncrementalPage({
  records,
  gameUid,
  serverId,
  existingRecordKeys,
  getPoolId
} = {}) {
  const list = filterOfficialImportPullRecords(records);
  const keySet = existingRecordKeys instanceof Set ? existingRecordKeys : new Set();
  let checked = 0;
  let existing = 0;
  let missingKey = 0;

  for (const record of list) {
    const poolId = typeof getPoolId === 'function'
      ? getPoolId(record)
      : (record?.poolId || record?.pool_id);
    const key = buildOfficialImportRecordKey({
      gameUid,
      serverId,
      poolId,
      seqId: normalizeRecordSeqId(record)
    });

    if (!key) {
      missingKey++;
      continue;
    }

    checked++;
    if (keySet.has(key)) {
      existing++;
    }
  }

  return {
    checked,
    existing,
    missingKey,
    allExisting: list.length > 0 && missingKey === 0 && checked === list.length && existing === checked
  };
}

export function hasSufficientIncrementalPityContext(records, {
  paidLimit = INCREMENTAL_PITY_CONTEXT_PAID_LIMIT
} = {}) {
  const list = filterOfficialImportPullRecords(records);
  if (list.length === 0) {
    return false;
  }

  let paidCount = 0;

  for (const record of list) {
    const rarity = Number(record?.rarity ?? record?.qualityLevel ?? 0);
    if (rarity === 6) {
      return true;
    }
    if (record?.isFree !== true) {
      paidCount++;
    }
    if (paidCount >= paidLimit) {
      return true;
    }
  }

  return false;
}

export function createIncrementalImportStopGuard({
  gameUid,
  serverId,
  existingRecordKeys,
  getPoolId,
  paidLimit = INCREMENTAL_PITY_CONTEXT_PAID_LIMIT
} = {}) {
  const enabled = Boolean(gameUid)
    && existingRecordKeys instanceof Set
    && existingRecordKeys.size > 0
    && typeof getPoolId === 'function';

  const state = {
    enabled,
    pagesChecked: 0,
    checked: 0,
    existing: 0,
    missingKey: 0,
    contextRecords: [],
    stopped: false,
    stopReason: null
  };

  function inspectPage(records) {
    if (!enabled) {
      return {
        enabled: false,
        page: {
          checked: 0,
          existing: 0,
          missingKey: 0,
          allExisting: false
        },
        shouldStop: false,
        reason: null,
        meta: getMeta()
      };
    }

    const pullRecords = filterOfficialImportPullRecords(records);
    const page = analyzeIncrementalPage({
      records: pullRecords,
      gameUid,
      serverId,
      existingRecordKeys,
      getPoolId
    });

    state.pagesChecked++;
    state.checked += page.checked;
    state.existing += page.existing;
    state.missingKey += page.missingKey;
    state.contextRecords = page.allExisting
      ? state.contextRecords.concat(pullRecords)
      : [];

    const shouldStop = Boolean(
      page.allExisting
      && hasSufficientIncrementalPityContext(state.contextRecords, { paidLimit })
    );

    if (shouldStop) {
      state.stopped = true;
      state.stopReason = 'all_existing_page_with_pity_context';
    }

    return {
      enabled: true,
      page,
      shouldStop,
      reason: state.stopReason,
      meta: getMeta()
    };
  }

  function getMeta() {
    return {
      checked: state.checked,
      existing: state.existing,
      missingKey: state.missingKey,
      pagesChecked: state.pagesChecked,
      contextRecords: state.contextRecords.length,
      stopped: state.stopped,
      stopReason: state.stopReason
    };
  }

  return {
    enabled,
    inspectPage,
    getMeta
  };
}
