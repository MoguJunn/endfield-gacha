import { normalizeWorkbenchEntry, normalizeWorkbenchScope, WORKBENCH_KINDS } from '../../shared/dataWorkbench.js';

export const WORKBENCH_TRANSFER_VERSION = 1;
const VALUE_KEYS = ['entityId', 'quantity', 'totalPulls', 'fourStarCount', 'fiveStarCount', 'sixStarCount', 'intervalPulls', 'pity', 'orderIndex', 'batchIndex', 'timestamp', 'rangeStart', 'rangeEnd', 'drawMethod', 'evidenceRef', 'notes', 'coverageId', 'coverageMode', 'initialPity', 'complete', 'acquisitions', 'fillSeed', 'inferredRecords', 'inferredFill', 'knownFields', 'skippedPools'];

// Portable IDs belong to the supplement namespace. Never emit DB IDs or seq_id.
export function serializeWorkbenchEntry(raw) {
  const entry = normalizeWorkbenchEntry(raw);
  const scope = normalizeWorkbenchScope(raw.scope || raw);
  return {
    entryId: entry.entryId,
    draftId: raw.draftId ?? raw.draft_id,
    gameUid: scope?.gameUid,
    serverScope: scope?.serverScope,
    poolId: entry.poolId,
    kind: entry.kind,
    source: ['manual', 'file', 'xhh'].includes(raw.source) ? raw.source : 'manual',
    derivation: raw.derivation || 'declared',
    timePrecision: entry.timePrecision,
    reviewState: 'confirmed',
    values: Object.fromEntries(VALUE_KEYS.filter(key => entry.values[key] !== undefined).map(key => [key, entry.values[key]])),
  };
}

export function readWorkbenchSupplements(payload, { currentUserId = null, knownPoolIds = null } = {}) {
  if (payload.supplements == null) return [];
  const supplements = payload.supplements;
  if (supplements.schemaVersion !== WORKBENCH_TRANSFER_VERSION || !Array.isArray(supplements.workbenchEntries)) {
    throw new Error('补录数据版本或格式不受支持');
  }
  const seen = new Set();
  return supplements.workbenchEntries.map(raw => {
    const entry = serializeWorkbenchEntry(raw);
    if (!entry.entryId || !entry.draftId || !normalizeWorkbenchScope(entry) || !WORKBENCH_KINDS.includes(entry.kind)) {
      throw new Error('补录条目缺少身份、账号区服或有效类型');
    }
    if (knownPoolIds && !knownPoolIds.has(entry.poolId)) throw new Error('补录条目引用了未知卡池');
    const key = JSON.stringify([entry.gameUid, entry.serverScope, entry.draftId, entry.entryId]);
    if (seen.has(key)) throw new Error('补录条目标识重复');
    seen.add(key);
    return { ...entry, ...(currentUserId ? { user_id: currentUserId } : {}) };
  });
}
