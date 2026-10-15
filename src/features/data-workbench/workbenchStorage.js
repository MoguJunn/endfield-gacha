import { getWorkbenchStorageKey, normalizeWorkbenchScope } from '../../../shared/dataWorkbench.js';

export const WORKBENCH_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function readWorkbenchSession(ownerId, scope, storage = globalThis.sessionStorage, now = Date.now()) {
  const normalized = normalizeWorkbenchScope(scope);
  if (!ownerId || !normalized) return null;
  const key = getWorkbenchStorageKey(ownerId, normalized);
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!saved) return null;
    const draftScope = normalizeWorkbenchScope(saved.draft?.scope);
    if (
      saved.expiresAt <= now ||
      !Number.isFinite(saved.expiresAt) ||
      saved.draft?.ownerId !== ownerId ||
      saved.draft?.schemaVersion !== 1 ||
      !Array.isArray(saved.draft?.entries) ||
      draftScope?.gameUid !== normalized.gameUid ||
      draftScope?.serverScope !== normalized.serverScope
    ) {
      storage.removeItem(key);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function writeWorkbenchSession(session, storage = globalThis.sessionStorage) {
  const scope = normalizeWorkbenchScope(session?.draft?.scope);
  if (!session?.draft?.ownerId || !scope) return false;
  try {
    storage.setItem(getWorkbenchStorageKey(session.draft.ownerId, scope), JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function removeWorkbenchSession(ownerId, scope, storage = globalThis.sessionStorage) {
  if (!ownerId || !normalizeWorkbenchScope(scope)) return;
  try {
    storage.removeItem(getWorkbenchStorageKey(ownerId, scope));
  } catch {
    // The in-memory draft remains usable when browser storage is unavailable.
  }
}

export function buildWorkbenchPayload(draft, commitId) {
  return {
    draftId: draft.draftId,
    commitId,
    scope: draft.scope,
    entries: draft.entries.filter((entry) => entry.reviewState !== 'skipped').map(serializeWorkbenchEntry),
  };
}

export function buildWorkspacePayload(draft, commitId, validationToken) {
  return {
    ...buildWorkbenchPayload(draft, commitId), mode: 'pool-workspace', draftRevision: draft.revision,
    historyChanges: (draft.historyChanges || []).map(change => {
      const { changes: values } = change;
      const drawMethod = values.drawMethod || ('isFree' in values || 'isInfoBook' in values || 'specialType' in values
        ? values.specialType === 'gift' ? 'gift' : values.isInfoBook ? 'info_book' : values.isFree ? 'free' : 'normal' : undefined);
      return { ...change, recordId: String(change.recordId), seqId: String(change.seqId ?? ''), changes: {
        ...Object.fromEntries(['timestamp', 'poolId', 'characterId', 'isStandard', 'specialType'].filter(key => values[key] !== undefined).map(key => [key, values[key]])),
        ...(drawMethod ? { drawMethod } : {}),
      } };
    }),
    supplementChanges: (draft.supplementChanges || []).map(change => ({ ...change, ...(change.entry ? { entry: serializeWorkbenchEntry(change.entry) } : {}) })),
    ...(validationToken ? { validationToken } : {}),
  };
}

export function serializeWorkbenchEntry(entry) {
  const values = { ...entry.values };
  for (const key of ['timestamp', 'rangeStart', 'rangeEnd']) {
    if (values[key] && Number.isFinite(Date.parse(values[key]))) values[key] = new Date(values[key]).toISOString();
  }
  return { ...entry, values };
}
