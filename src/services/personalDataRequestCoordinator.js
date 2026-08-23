import usePersonalDataStore, {
  getPersonalSnapshotCompletionState,
} from '../stores/usePersonalDataStore.js';

function createResult({ ok, data = null, error = null, stale = false, applied = false }) {
  return {
    ok: Boolean(ok),
    data,
    error,
    stale: Boolean(stale),
    applied: Boolean(applied),
  };
}

function createRequestKey(ownerId, ownerGeneration, kind) {
  return JSON.stringify([ownerId, ownerGeneration, kind]);
}

function normalizeError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error || fallbackMessage));
}

export function createPersonalDataRequestCoordinator({ store = usePersonalDataStore } = {}) {
  const inFlightRequests = new Map();

  const run = ({
    ownerId,
    ownerGeneration,
    kind = 'session',
    reason = kind,
    request,
    apply,
  } = {}) => {
    const normalizedOwnerId = String(ownerId || '').trim();
    const normalizedKind = String(kind || 'session').trim() || 'session';
    const requestKey = createRequestKey(normalizedOwnerId, ownerGeneration, normalizedKind);
    const sharedRequest = inFlightRequests.get(requestKey);
    if (sharedRequest) {
      return sharedRequest;
    }

    const current = store.getState();
    if (
      !normalizedOwnerId
      || typeof request !== 'function'
      || current.ownerId !== normalizedOwnerId
      || current.ownerGeneration !== ownerGeneration
    ) {
      return Promise.resolve(createResult({
        ok: false,
        stale: true,
        error: new Error('个人数据请求的 owner token 已失效'),
      }));
    }

    const token = current.beginRequest({
      ownerId: normalizedOwnerId,
      ownerGeneration,
      kind: normalizedKind,
      reason,
    });
    if (!token) {
      return Promise.resolve(createResult({
        ok: false,
        stale: true,
        error: new Error('个人数据请求无法取得当前 token'),
      }));
    }

    const requestPromise = (async () => {
      try {
        const data = await request(token);
        const stateAfterRequest = store.getState();
        if (!stateAfterRequest.isRequestTokenCurrent(token)) {
          return createResult({ ok: true, data, stale: true });
        }
        if (!getPersonalSnapshotCompletionState(token, data)) {
          throw new Error('个人数据请求未返回可提交的完整快照');
        }

        const applied = typeof apply === 'function' ? apply(data, token) : true;
        if (applied && typeof applied.then === 'function') {
          throw new Error('个人数据提交函数必须同步完成');
        }
        if (applied === false) {
          throw new Error('个人数据快照未能提交到运行时 Store');
        }
        if (!store.getState().isRequestTokenCurrent(token)) {
          return createResult({ ok: true, data, stale: true });
        }

        const committed = store.getState().completeRequest(token, data);
        if (!committed) {
          return createResult({ ok: true, data, stale: true });
        }
        return createResult({ ok: true, data, applied: true });
      } catch (cause) {
        const error = normalizeError(cause, '个人数据请求失败');
        const isCurrent = store.getState().isRequestTokenCurrent(token);
        if (isCurrent) {
          store.getState().failRequest(token, error);
        }
        return createResult({
          ok: false,
          error,
          stale: !isCurrent,
        });
      }
    })();

    const trackedPromise = requestPromise.finally(() => {
      if (inFlightRequests.get(requestKey) === trackedPromise) {
        inFlightRequests.delete(requestKey);
      }
    });
    inFlightRequests.set(requestKey, trackedPromise);
    return trackedPromise;
  };

  return {
    run,
    getInFlightCount: () => inFlightRequests.size,
  };
}

export const personalDataRequestCoordinator = createPersonalDataRequestCoordinator();

export default personalDataRequestCoordinator;
