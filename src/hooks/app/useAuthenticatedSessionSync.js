import { useCallback } from 'react';
import {
  useAuthStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePersonalDataStore,
  usePoolStore,
} from '../../stores';
import { classifyAuthEvent } from '../../utils/authEventClassifier.js';
import appLogger from '../../utils/appLogger.js';

export function canUsePrivateCloudDataFromSiteSession(siteSession, fallbackUser = null) {
  if (siteSession?.authenticated) {
    return true;
  }

  return Boolean(fallbackUser);
}

function createSkippedResult(classification) {
  return {
    ok: true,
    data: null,
    error: null,
    stale: false,
    applied: false,
    skipped: true,
    classification,
  };
}

export function useAuthenticatedSessionSync({
  refreshPersonalData,
  onUpdateLastSeen,
} = {}) {
  const setUser = useAuthStore(state => state.setUser);
  const setAuthResolved = useAuthStore(state => state.setAuthResolved);
  const setPools = usePoolStore(state => state.setPools);
  const restoreOwnerSelection = usePoolStore(state => state.restoreOwnerSelection);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const setHistory = useHistoryStore(state => state.setHistory);

  const applyAuthenticatedSession = useCallback(async (targetUser, {
    event = 'SIGNED_IN',
    canLoadPrivateCloudData = true,
    source = 'auth',
    refreshKind = null,
    isMountedRef = { current: true },
  } = {}) => {
    if (!targetUser?.id || !isMountedRef.current) {
      return null;
    }

    const previousPersonalState = usePersonalDataStore.getState();
    const classification = classifyAuthEvent({
      event,
      source,
      currentOwnerId: previousPersonalState.ownerId,
      nextUser: targetUser,
      hasSnapshot: previousPersonalState.hasSnapshot,
      refreshKind,
    });

    if (classification.ownerChanged || classification.isFirstOwner) {
      previousPersonalState.switchOwner(targetUser.id);
      setHistory([]);
      usePersonalAnalysisStore.getState().clearAnalysis('owner_changed');
      setPools(usePersonalDataStore.getState().publicPools);
      restoreOwnerSelection(targetUser.id);
    }

    setUser(targetUser);
    setAuthResolved(true);

    if (classification.shouldUpdateLastSeen && typeof onUpdateLastSeen === 'function') {
      void onUpdateLastSeen(targetUser, classification);
    }

    if (
      !canLoadPrivateCloudData
      || !classification.shouldRefreshPersonalData
      || typeof refreshPersonalData !== 'function'
    ) {
      return createSkippedResult(classification);
    }

    const poolState = usePoolStore.getState();
    const result = await refreshPersonalData(targetUser, {
      kind: classification.refreshKind,
      reason: `${source}:${classification.classification}`,
      preferredPoolId: poolState.currentPoolId,
      preferredGameUid: poolState.currentGameUid,
    });
    if (!result?.ok && !result?.stale) {
      appLogger.warn?.(
        `[useAuthenticatedSessionSync] ${source} 个人数据加载失败:`,
        result?.error
      );
    }
    return {
      ...result,
      classification,
    };
  }, [onUpdateLastSeen, refreshPersonalData, restoreOwnerSelection, setAuthResolved, setHistory, setPools, setUser]);

  const applySiteSession = useCallback(async (siteSession, {
    source = 'site_session',
    isMountedRef = { current: true },
  } = {}) => {
    if (!siteSession?.authenticated || !siteSession.user) {
      return null;
    }

    return applyAuthenticatedSession(siteSession.user, {
      event: 'SITE_SESSION_SYNC',
      canLoadPrivateCloudData: canUsePrivateCloudDataFromSiteSession(siteSession, siteSession.user),
      source,
      isMountedRef,
    });
  }, [applyAuthenticatedSession]);

  const applySignedOut = useCallback(({ source = 'auth', event = 'SIGNED_OUT' } = {}) => {
    const previousPersonalState = usePersonalDataStore.getState();
    const classification = classifyAuthEvent({
      event,
      source,
      currentOwnerId: previousPersonalState.ownerId,
      nextOwnerId: null,
      hasSnapshot: previousPersonalState.hasSnapshot,
    });

    previousPersonalState.clearOwner(`${source}:${classification.classification}`);
    usePersonalAnalysisStore.getState().clearAnalysis(`${source}:${classification.classification}`);
    setUser(null);
    setAuthResolved(true);
    setHistory([]);
    setPools(usePersonalDataStore.getState().publicPools);
    switchGameAccount(null);
    return classification;
  }, [setAuthResolved, setHistory, setPools, setUser, switchGameAccount]);

  return {
    applyAuthenticatedSession,
    applySiteSession,
    applySignedOut,
  };
}

export default useAuthenticatedSessionSync;
