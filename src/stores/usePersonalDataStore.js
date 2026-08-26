import { create } from 'zustand';
import { PERSONAL_ANALYSIS_AVAILABILITIES } from './usePersonalAnalysisStore.js';

function normalizeOwnerId(ownerId) {
  const normalized = String(ownerId || '').trim();
  return normalized || null;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error || '个人数据请求失败'));
}

function isMatchingOwnerId(value, ownerId) {
  const normalized = normalizeOwnerId(value);
  return !normalized || normalized === ownerId;
}

export function getPersonalSnapshotCompletionState(token, data) {
  if (!data || !Array.isArray(data.pools)) {
    return null;
  }

  if (data.kind !== 'analysis') {
    if (!Array.isArray(data.history)) {
      return null;
    }
    return {
      phase: data.history.length > 0 ? 'ready' : 'empty',
      hasSnapshot: true,
    };
  }

  const analysis = data.analysis;
  if (
    !analysis
    || typeof analysis !== 'object'
    || !PERSONAL_ANALYSIS_AVAILABILITIES.includes(analysis.availability)
    || !isMatchingOwnerId(data.ownerId, token?.ownerId)
    || !isMatchingOwnerId(analysis.meta?.ownerId, token?.ownerId)
  ) {
    return null;
  }

  if (analysis.availability === 'building') {
    return { phase: 'building', hasSnapshot: false };
  }
  if (analysis.availability === 'empty') {
    return { phase: 'empty', hasSnapshot: true };
  }
  return { phase: 'ready', hasSnapshot: true };
}

export function createPersonalDataInitialState() {
  return {
    ownerId: null,
    ownerGeneration: 0,
    requestGeneration: 0,
    phase: 'idle',
    refreshing: false,
    hasSnapshot: false,
    lastSuccessfulAt: null,
    error: null,
    activeRequest: null,
    reason: null,
    publicPools: [],
    analysisRetry: {
      key: null,
      attempt: 0,
      nextRetryAt: null,
    },
  };
}

const usePersonalDataStore = create((set, get) => ({
  ...createPersonalDataInitialState(),

  switchOwner: (ownerId) => {
    const normalizedOwnerId = normalizeOwnerId(ownerId);
    const current = get();
    if (current.ownerId === normalizedOwnerId) {
      return {
        ownerId: current.ownerId,
        ownerGeneration: current.ownerGeneration,
        changed: false,
      };
    }

    const ownerGeneration = current.ownerGeneration + 1;
    set({
      ownerId: normalizedOwnerId,
      ownerGeneration,
      requestGeneration: current.requestGeneration + 1,
      phase: 'idle',
      refreshing: false,
      hasSnapshot: false,
      lastSuccessfulAt: null,
      error: null,
      activeRequest: null,
      reason: null,
      analysisRetry: {
        key: null,
        attempt: 0,
        nextRetryAt: null,
      },
    });

    return {
      ownerId: normalizedOwnerId,
      ownerGeneration,
      changed: true,
    };
  },

  beginRequest: ({ ownerId, ownerGeneration, kind = 'session', reason = kind } = {}) => {
    const normalizedOwnerId = normalizeOwnerId(ownerId);
    const current = get();
    if (
      !normalizedOwnerId
      || current.ownerId !== normalizedOwnerId
      || current.ownerGeneration !== ownerGeneration
    ) {
      return null;
    }

    const requestGeneration = current.requestGeneration + 1;
    const token = Object.freeze({
      ownerId: normalizedOwnerId,
      ownerGeneration,
      requestGeneration,
      kind,
    });
    // Once an owner is waiting for a snapshot, every same-owner read remains
    // non-blocking. Passive session events and explicit retries must not turn
    // the authoritative building state back into the initial loading gate.
    const preserveBuildingPhase = !current.hasSnapshot
      && current.phase === 'building';

    set({
      requestGeneration,
      phase: current.hasSnapshot
        ? current.phase
        : preserveBuildingPhase ? 'building' : 'loading',
      refreshing: current.hasSnapshot,
      error: null,
      activeRequest: token,
      reason,
    });
    return token;
  },

  completeRequest: (token, data, completedAt = new Date().toISOString()) => {
    if (!get().isRequestTokenCurrent(token)) {
      return false;
    }
    const completion = getPersonalSnapshotCompletionState(token, data);
    if (!completion) {
      return false;
    }

    const availability = data?.analysis?.availability || null;
    set({
      phase: completion.phase,
      refreshing: false,
      hasSnapshot: completion.hasSnapshot,
      lastSuccessfulAt: completion.hasSnapshot ? completedAt : get().lastSuccessfulAt,
      error: null,
      activeRequest: null,
      reason: null,
      analysisRetry: ['ready', 'empty'].includes(availability)
        ? { key: null, attempt: 0, nextRetryAt: null }
        : get().analysisRetry,
    });
    return true;
  },

  failRequest: (token, error) => {
    const current = get();
    if (!current.isRequestTokenCurrent(token)) {
      return false;
    }

    set({
      phase: current.hasSnapshot ? current.phase : 'error',
      refreshing: false,
      error: normalizeError(error),
      activeRequest: null,
      reason: null,
    });
    return true;
  },

  invalidateRequests: (reason = 'invalidated') => {
    const current = get();
    set({
      ownerGeneration: current.ownerGeneration + 1,
      requestGeneration: current.requestGeneration + 1,
      refreshing: false,
      activeRequest: null,
      reason,
      analysisRetry: {
        key: null,
        attempt: 0,
        nextRetryAt: null,
      },
    });
  },

  clearOwner: (reason = 'signed_out') => {
    const current = get();
    set({
      ownerId: null,
      ownerGeneration: current.ownerGeneration + 1,
      requestGeneration: current.requestGeneration + 1,
      phase: 'idle',
      refreshing: false,
      hasSnapshot: false,
      lastSuccessfulAt: null,
      error: null,
      activeRequest: null,
      reason,
      analysisRetry: {
        key: null,
        attempt: 0,
        nextRetryAt: null,
      },
    });
  },

  isRequestTokenCurrent: (token) => {
    const current = get();
    return Boolean(
      token
      && current.activeRequest === token
      && current.ownerId === token.ownerId
      && current.ownerGeneration === token.ownerGeneration
      && current.requestGeneration === token.requestGeneration
    );
  },

  ensureAnalysisRetrySchedule: (key, delayMs, now = Date.now()) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return null;
    const current = get().analysisRetry;
    if (
      current.key === normalizedKey
      && Number.isFinite(Number(current.nextRetryAt))
      && Number(current.nextRetryAt) > now
    ) {
      return current;
    }

    const next = {
      key: normalizedKey,
      attempt: current.key === normalizedKey ? current.attempt : 0,
      nextRetryAt: now + Math.max(0, Number(delayMs) || 0),
    };
    set({ analysisRetry: next });
    return next;
  },

  markAnalysisRetryFired: (key) => {
    const normalizedKey = String(key || '').trim();
    const current = get().analysisRetry;
    if (!normalizedKey || current.key !== normalizedKey) return false;
    set({
      analysisRetry: {
        key: normalizedKey,
        attempt: current.attempt + 1,
        nextRetryAt: null,
      },
    });
    return true;
  },

  resetAnalysisRetry: (key = null) => {
    set({
      analysisRetry: {
        key: String(key || '').trim() || null,
        attempt: 0,
        nextRetryAt: null,
      },
    });
  },

  setPublicPools: (publicPools) => {
    if (!Array.isArray(publicPools)) {
      return false;
    }
    set({ publicPools });
    return true;
  },
}));

export default usePersonalDataStore;
