import { create } from 'zustand';

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error || '抽卡记录读取失败'));
}

export function createHistoryPageInitialState(reason = null) {
  return {
    ownerId: null,
    scopeKey: null,
    phase: 'unloaded',
    nextCursor: null,
    hasMore: false,
    total: null,
    revision: null,
    error: null,
    generation: 0,
    requestSequence: 0,
    activeToken: null,
    reason,
  };
}

function isCurrentToken(state, token) {
  return Boolean(
    token
    && state.activeToken === token
    && state.ownerId === token.ownerId
    && state.scopeKey === token.scopeKey
    && state.generation === token.generation
  );
}

const useHistoryPageStore = create((set, get) => ({
  ...createHistoryPageInitialState(),

  begin: ({ ownerId, scopeKey, reset = false } = {}) => {
    const normalizedOwnerId = normalizeText(ownerId);
    const normalizedScopeKey = normalizeText(scopeKey);
    if (!normalizedOwnerId || !normalizedScopeKey) {
      return null;
    }

    const current = get();
    const scopeChanged = current.ownerId !== normalizedOwnerId
      || current.scopeKey !== normalizedScopeKey;
    const shouldReset = reset || scopeChanged;
    const generation = shouldReset ? current.generation + 1 : current.generation;
    const requestSequence = current.requestSequence + 1;
    const token = Object.freeze({
      ownerId: normalizedOwnerId,
      scopeKey: normalizedScopeKey,
      generation,
      requestSequence,
    });

    set({
      ownerId: normalizedOwnerId,
      scopeKey: normalizedScopeKey,
      phase: 'loading',
      nextCursor: shouldReset ? null : current.nextCursor,
      hasMore: shouldReset ? false : current.hasMore,
      total: shouldReset ? null : current.total,
      revision: shouldReset ? null : current.revision,
      error: null,
      generation,
      requestSequence,
      activeToken: token,
      reason: shouldReset ? 'page_reset' : current.reason,
    });
    return token;
  },

  complete: (token, page = {}) => {
    const current = get();
    if (!isCurrentToken(current, token)) {
      return false;
    }

    const pageTotal = page?.total;
    set({
      phase: 'ready',
      nextCursor: page?.nextCursor || null,
      hasMore: page?.hasMore === true,
      total: pageTotal !== null && pageTotal !== undefined && Number.isFinite(Number(pageTotal))
        ? Number(pageTotal)
        : current.total,
      revision: page?.revision || null,
      error: null,
      activeToken: null,
      reason: null,
    });
    return true;
  },

  fail: (token, error) => {
    const current = get();
    if (!isCurrentToken(current, token)) {
      return false;
    }

    set({
      phase: 'error',
      error: normalizeError(error),
      activeToken: null,
      reason: 'request_failed',
    });
    return true;
  },

  invalidate: (reason = 'invalidated') => {
    const current = get();
    set({
      phase: 'unloaded',
      nextCursor: null,
      hasMore: false,
      total: null,
      revision: null,
      error: null,
      generation: current.generation + 1,
      activeToken: null,
      reason,
    });
  },

  clear: (reason = 'cleared') => {
    const current = get();
    set({
      ...createHistoryPageInitialState(reason),
      generation: current.generation + 1,
      requestSequence: current.requestSequence,
    });
  },

  isTokenCurrent: (token) => isCurrentToken(get(), token),
}));

export default useHistoryPageStore;
