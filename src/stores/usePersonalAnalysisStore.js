import { create } from 'zustand';

export const PERSONAL_ANALYSIS_AVAILABILITIES = Object.freeze([
  'building',
  'ready',
  'stale',
  'empty',
]);

function normalizeOwnerId(ownerId) {
  const normalized = String(ownerId || '').trim();
  return normalized || null;
}

export function createPersonalAnalysisInitialState(reason = null) {
  return {
    ownerId: null,
    availability: 'idle',
    schemaVersion: null,
    owner: null,
    scope: null,
    meta: null,
    warnings: [],
    reason,
  };
}

const usePersonalAnalysisStore = create((set, get) => ({
  ...createPersonalAnalysisInitialState(),

  applyAnalysis: (ownerId, analysis) => {
    const normalizedOwnerId = normalizeOwnerId(ownerId);
    if (
      !normalizedOwnerId
      || !analysis
      || typeof analysis !== 'object'
      || !PERSONAL_ANALYSIS_AVAILABILITIES.includes(analysis.availability)
    ) {
      return false;
    }

    const responseOwnerId = normalizeOwnerId(analysis.meta?.ownerId);
    if (responseOwnerId && responseOwnerId !== normalizedOwnerId) {
      return false;
    }

    const current = get();
    const sameOwner = current.ownerId === normalizedOwnerId;
    const preserveStalePayload = sameOwner && analysis.availability === 'stale';

    set({
      ownerId: normalizedOwnerId,
      availability: analysis.availability,
      schemaVersion: Math.max(1, Number(analysis.schemaVersion) || 1),
      owner: preserveStalePayload && analysis.owner == null ? current.owner : (analysis.owner ?? null),
      scope: preserveStalePayload && analysis.scope == null ? current.scope : (analysis.scope ?? null),
      meta: analysis.meta && typeof analysis.meta === 'object' ? analysis.meta : null,
      warnings: Array.isArray(analysis.warnings) ? analysis.warnings : [],
      reason: null,
    });
    return true;
  },

  clearAnalysis: (reason = 'cleared') => {
    set(createPersonalAnalysisInitialState(reason));
  },
}));

export default usePersonalAnalysisStore;
