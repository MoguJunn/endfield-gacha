import { useCallback, useEffect, useMemo } from 'react';
import { loadAccountGachaHistoryPage } from '../../services/accountGachaDataService.js';
import {
  useAuthStore,
  useHistoryPageStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePoolStore,
} from '../../stores/index.js';

const DEFAULT_PAGE_LIMIT = 100;

function normalizeText(value) {
  return String(value || '').trim();
}

function getSelectionGameUid(value) {
  return normalizeText(value).split('::')[0] || '';
}

function normalizeAccountScope(account, currentGameUid) {
  if (!account || typeof account !== 'object') {
    return null;
  }

  const accountKey = normalizeText(account.accountKey);
  const gameUid = normalizeText(account.gameUid);
  const serverScope = normalizeText(account.serverScope);
  const region = normalizeText(account.region);
  const selectedAccountKey = normalizeText(currentGameUid);
  if (
    !accountKey
    || !gameUid
    || !serverScope
    || !Object.prototype.hasOwnProperty.call(account, 'region')
  ) {
    return null;
  }
  if (selectedAccountKey && selectedAccountKey !== accountKey) {
    // 区服修正会让持久化的旧 accountKey 暂时落后于权威快照。
    // 同 UID 可以采用当前快照 scope；不同 UID 切换期间仍必须拒绝。
    if (getSelectionGameUid(selectedAccountKey) !== gameUid) {
      return null;
    }
  }

  return {
    accountKey,
    gameUid,
    serverScope,
    region,
  };
}

function getRecordDedupeKey(record) {
  return [
    record?.id ?? record?.record_id ?? '',
    record?.gameUid ?? record?.game_uid ?? '',
    record?.serverScope ?? record?.server_scope ?? record?.serverId ?? record?.server_id ?? '',
    record?.poolId ?? record?.pool_id ?? '',
    record?.seqId ?? record?.seq_id ?? '',
  ].map((value) => String(value ?? '')).join('\u001f');
}

export function appendUniqueHistoryRecords(currentRecords, pageRecords) {
  const current = Array.isArray(currentRecords) ? currentRecords : [];
  const incoming = Array.isArray(pageRecords) ? pageRecords : [];
  const seen = new Set(current.map(getRecordDedupeKey));
  const additions = [];

  incoming.forEach((record) => {
    const key = getRecordDedupeKey(record);
    if (!seen.has(key)) {
      seen.add(key);
      additions.push(record);
    }
  });

  return additions.length > 0 ? [...current, ...additions] : current;
}

function createOwnerMismatchError(responseOwnerId, ownerId) {
  const error = new Error('抽卡记录响应 owner 与当前登录用户不一致');
  error.code = 'history_owner_mismatch';
  error.responseOwnerId = responseOwnerId;
  error.ownerId = ownerId;
  return error;
}

export function useScopedHistoryPages({ limit = DEFAULT_PAGE_LIMIT, poolId = '' } = {}) {
  const user = useAuthStore((state) => state.user);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisAccount = usePersonalAnalysisStore((state) => state.scope?.account || null);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const loadedCount = useHistoryStore((state) => (
    Array.isArray(state.history) ? state.history.length : 0
  ));

  const ownerId = normalizeText(user?.id);
  const normalizedPoolId = normalizeText(poolId);
  const accountScope = useMemo(
    () => normalizeAccountScope(analysisAccount, currentGameUid),
    [analysisAccount, currentGameUid]
  );
  const scopeKey = useMemo(() => (
    accountScope
      ? JSON.stringify([
        accountScope.accountKey,
        accountScope.gameUid,
        accountScope.serverScope,
        accountScope.region,
        normalizedPoolId,
      ])
      : null
  ), [accountScope, normalizedPoolId]);

  const pageOwnerId = useHistoryPageStore((state) => state.ownerId);
  const pageScopeKey = useHistoryPageStore((state) => state.scopeKey);
  const phase = useHistoryPageStore((state) => state.phase);
  const nextCursor = useHistoryPageStore((state) => state.nextCursor);
  const hasMore = useHistoryPageStore((state) => state.hasMore);
  const total = useHistoryPageStore((state) => state.total);
  const revision = useHistoryPageStore((state) => state.revision);
  const error = useHistoryPageStore((state) => state.error);
  const generation = useHistoryPageStore((state) => state.generation);
  const reason = useHistoryPageStore((state) => state.reason);

  const requestPage = useCallback(async ({ reset, cursor = '', revisionRetry = false }) => {
    if (!ownerId || !scopeKey || !accountScope) {
      return false;
    }

    const pageStore = useHistoryPageStore.getState();
    const token = pageStore.begin({ ownerId, scopeKey, reset });
    if (!token) {
      return false;
    }
    if (reset) {
      useHistoryStore.getState().setHistory([]);
    }

    try {
      const response = await loadAccountGachaHistoryPage({
        accountKey: accountScope.accountKey,
        gameUid: accountScope.gameUid,
        serverScope: accountScope.serverScope,
        region: accountScope.region,
        ...(normalizedPoolId ? { poolId: normalizedPoolId } : {}),
        cursor: reset ? '' : cursor,
        limit,
      });
      const responseOwnerId = normalizeText(response?.meta?.ownerId);
      if (!responseOwnerId || responseOwnerId !== ownerId) {
        throw createOwnerMismatchError(responseOwnerId, ownerId);
      }

      const accepted = useHistoryPageStore.getState().complete(token, response?.page || {});
      if (!accepted) {
        return false;
      }

      const records = Array.isArray(response?.records) ? response.records : [];
      const historyStore = useHistoryStore.getState();
      historyStore.setHistory(reset
        ? records
        : appendUniqueHistoryRecords(historyStore.history, records));
      return true;
    } catch (requestError) {
      if (requestError?.code === 'history_revision_changed' && !revisionRetry) {
        useHistoryPageStore.getState().invalidate('history_revision_changed');
        useHistoryStore.getState().setHistory([]);
        return requestPage({ reset: true, cursor: '', revisionRetry: true });
      }

      useHistoryPageStore.getState().fail(token, requestError);
      return false;
    }
  }, [accountScope, limit, normalizedPoolId, ownerId, scopeKey]);

  const loadFirstPage = useCallback(
    () => requestPage({ reset: true, cursor: '' }),
    [requestPage]
  );

  const loadMore = useCallback(() => {
    const current = useHistoryPageStore.getState();
    if (
      current.ownerId !== ownerId
      || current.scopeKey !== scopeKey
      || current.phase === 'loading'
      || !current.hasMore
      || !current.nextCursor
    ) {
      return Promise.resolve(false);
    }
    return requestPage({ reset: false, cursor: current.nextCursor });
  }, [ownerId, requestPage, scopeKey]);

  const retry = useCallback(() => {
    const current = useHistoryPageStore.getState();
    const history = useHistoryStore.getState().history;
    if (
      Array.isArray(history)
      && history.length > 0
      && current.ownerId === ownerId
      && current.scopeKey === scopeKey
      && current.nextCursor
    ) {
      return requestPage({ reset: false, cursor: current.nextCursor });
    }
    return loadFirstPage();
  }, [loadFirstPage, ownerId, requestPage, scopeKey]);

  useEffect(() => {
    const pageStore = useHistoryPageStore.getState();
    const historyStore = useHistoryStore.getState();

    if (!ownerId) {
      if (pageStore.ownerId || pageStore.scopeKey || pageStore.phase !== 'unloaded') {
        pageStore.clear('owner_unavailable');
      }
      if (Array.isArray(historyStore.history) && historyStore.history.length > 0) {
        historyStore.setHistory([]);
      }
      return;
    }

    if (analysisAvailability === 'empty' || !accountScope || !scopeKey) {
      const emptyScopeKey = JSON.stringify([
        ownerId,
        normalizeText(currentGameUid) || 'none',
        'empty',
      ]);
      if (
        pageStore.ownerId !== ownerId
        || pageStore.scopeKey !== emptyScopeKey
        || pageStore.phase !== 'ready'
        || pageStore.total !== 0
      ) {
        const token = pageStore.begin({ ownerId, scopeKey: emptyScopeKey, reset: true });
        historyStore.setHistory([]);
        if (token) {
          useHistoryPageStore.getState().complete(token, {
            nextCursor: null,
            hasMore: false,
            total: 0,
            revision: null,
          });
        }
      }
      return;
    }

    if (
      pageStore.ownerId !== ownerId
      || pageStore.scopeKey !== scopeKey
      || pageStore.phase === 'unloaded'
    ) {
      historyStore.setHistory([]);
      void loadFirstPage();
    }
  }, [
    accountScope,
    analysisAvailability,
    currentGameUid,
    generation,
    loadFirstPage,
    ownerId,
    scopeKey,
  ]);

  return {
    ownerId: pageOwnerId,
    scopeKey: pageScopeKey,
    phase,
    nextCursor,
    hasMore,
    total,
    revision,
    error,
    generation,
    reason,
    loadedCount,
    loadFirstPage,
    loadMore,
    retry,
  };
}

export default useScopedHistoryPages;
