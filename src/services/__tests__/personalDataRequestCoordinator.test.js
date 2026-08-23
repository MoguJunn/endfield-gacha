import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPersonalDataRequestCoordinator,
} from '../personalDataRequestCoordinator.js';
import usePersonalDataStore, {
  createPersonalDataInitialState,
} from '../../stores/usePersonalDataStore.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSnapshot(ownerId, history = [{ id: `${ownerId}-record` }]) {
  return {
    ownerId,
    pools: [{ id: `${ownerId}-pool` }],
    history,
  };
}

function createAnalysisSnapshot(ownerId, availability = 'ready') {
  return {
    kind: 'analysis',
    ownerId,
    pools: [{ id: `${ownerId}-pool` }],
    analysis: {
      availability,
      schemaVersion: 1,
      owner: { defaultAccountKey: 'account-1' },
      scope: null,
      meta: { ownerId },
      warnings: [],
    },
  };
}

function getOwnerContext(ownerId) {
  usePersonalDataStore.getState().switchOwner(ownerId);
  const state = usePersonalDataStore.getState();
  return {
    ownerId,
    ownerGeneration: state.ownerGeneration,
  };
}

describe('personalDataRequestCoordinator', () => {
  beforeEach(() => {
    usePersonalDataStore.setState(createPersonalDataInitialState());
  });

  it('合并同 owner、同 generation、同 kind 的进行中请求', async () => {
    const coordinator = createPersonalDataRequestCoordinator();
    const owner = getOwnerContext('user-a');
    const deferred = createDeferred();
    const request = vi.fn(() => deferred.promise);
    const apply = vi.fn(() => true);

    const first = coordinator.run({ ...owner, kind: 'session', request, apply });
    const second = coordinator.run({ ...owner, kind: 'session', request, apply });

    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);

    deferred.resolve(createSnapshot('user-a'));
    await expect(first).resolves.toMatchObject({
      ok: true,
      stale: false,
      applied: true,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(usePersonalDataStore.getState()).toMatchObject({
      ownerId: 'user-a',
      phase: 'ready',
      hasSnapshot: true,
      refreshing: false,
    });
  });

  it('不同 owner 不共享请求，并丢弃 A→B 后返回的 A 响应', async () => {
    const coordinator = createPersonalDataRequestCoordinator();
    const ownerA = getOwnerContext('user-a');
    const deferredA = createDeferred();
    const requestA = vi.fn(() => deferredA.promise);
    const applyA = vi.fn(() => true);
    const promiseA = coordinator.run({
      ...ownerA,
      kind: 'session',
      request: requestA,
      apply: applyA,
    });

    const ownerB = getOwnerContext('user-b');
    const deferredB = createDeferred();
    const requestB = vi.fn(() => deferredB.promise);
    const applyB = vi.fn(() => true);
    const promiseB = coordinator.run({
      ...ownerB,
      kind: 'session',
      request: requestB,
      apply: applyB,
    });

    expect(promiseB).not.toBe(promiseA);
    expect(requestA).toHaveBeenCalledTimes(1);
    expect(requestB).toHaveBeenCalledTimes(1);

    deferredB.resolve(createSnapshot('user-b'));
    await expect(promiseB).resolves.toMatchObject({ ok: true, applied: true, stale: false });

    deferredA.resolve(createSnapshot('user-a'));
    await expect(promiseA).resolves.toMatchObject({ ok: true, applied: false, stale: true });
    expect(applyA).not.toHaveBeenCalled();
    expect(applyB).toHaveBeenCalledTimes(1);
    expect(usePersonalDataStore.getState().ownerId).toBe('user-b');
  });

  it('登出后丢弃仍在返回途中的响应', async () => {
    const coordinator = createPersonalDataRequestCoordinator();
    const owner = getOwnerContext('user-a');
    const deferred = createDeferred();
    const apply = vi.fn(() => true);
    const pending = coordinator.run({
      ...owner,
      kind: 'session',
      request: () => deferred.promise,
      apply,
    });

    usePersonalDataStore.getState().clearOwner('signed_out');
    deferred.resolve(createSnapshot('user-a'));

    await expect(pending).resolves.toMatchObject({
      ok: true,
      stale: true,
      applied: false,
    });
    expect(apply).not.toHaveBeenCalled();
    expect(usePersonalDataStore.getState()).toMatchObject({
      ownerId: null,
      phase: 'idle',
      hasSnapshot: false,
    });
  });

  it('后续请求使先前不同 kind 的响应失效', async () => {
    const coordinator = createPersonalDataRequestCoordinator();
    const owner = getOwnerContext('user-a');
    const earlierDeferred = createDeferred();
    const earlierApply = vi.fn(() => true);
    const earlier = coordinator.run({
      ...owner,
      kind: 'session',
      request: () => earlierDeferred.promise,
      apply: earlierApply,
    });

    const laterApply = vi.fn(() => true);
    const later = coordinator.run({
      ...owner,
      kind: 'mutation',
      request: () => Promise.resolve(createSnapshot('user-a', [{ id: 'new-record' }])),
      apply: laterApply,
    });
    await expect(later).resolves.toMatchObject({ ok: true, applied: true, stale: false });

    earlierDeferred.resolve(createSnapshot('user-a', [{ id: 'old-record' }]));
    await expect(earlier).resolves.toMatchObject({ ok: true, applied: false, stale: true });
    expect(earlierApply).not.toHaveBeenCalled();
    expect(laterApply).toHaveBeenCalledTimes(1);
  });

  it('刷新失败时保留同 owner 的成功快照状态', async () => {
    const coordinator = createPersonalDataRequestCoordinator();
    const owner = getOwnerContext('user-a');
    await coordinator.run({
      ...owner,
      kind: 'session',
      request: () => Promise.resolve(createSnapshot('user-a')),
      apply: () => true,
    });
    const successfulAt = usePersonalDataStore.getState().lastSuccessfulAt;
    const applyFailure = vi.fn(() => true);

    const result = await coordinator.run({
      ...owner,
      kind: 'mutation',
      request: () => Promise.reject(new Error('network unavailable')),
      apply: applyFailure,
    });

    expect(result).toMatchObject({
      ok: false,
      stale: false,
      applied: false,
    });
    expect(result.error).toMatchObject({ message: 'network unavailable' });
    expect(applyFailure).not.toHaveBeenCalled();
    expect(usePersonalDataStore.getState()).toMatchObject({
      ownerId: 'user-a',
      phase: 'ready',
      refreshing: false,
      hasSnapshot: true,
      lastSuccessfulAt: successfulAt,
    });
  });

  it('接受不包含 history 的 analysis 完整快照', async () => {
    const coordinator = createPersonalDataRequestCoordinator();
    const owner = getOwnerContext('user-a');
    const snapshot = createAnalysisSnapshot('user-a', 'ready');
    const apply = vi.fn(() => true);

    await expect(coordinator.run({
      ...owner,
      kind: 'session',
      request: () => Promise.resolve(snapshot),
      apply,
    })).resolves.toMatchObject({ ok: true, applied: true, stale: false });

    expect(apply).toHaveBeenCalledWith(snapshot, expect.any(Object));
    expect(usePersonalDataStore.getState()).toMatchObject({
      phase: 'ready',
      hasSnapshot: true,
    });
  });

  it.each([
    ['缺少 analysis', { kind: 'analysis', ownerId: 'user-a', pools: [] }],
    ['非法 availability', createAnalysisSnapshot('user-a', 'unknown')],
    ['owner 不一致', createAnalysisSnapshot('user-b', 'ready')],
  ])('拒绝 malformed analysis：%s', async (_name, snapshot) => {
    const coordinator = createPersonalDataRequestCoordinator();
    const owner = getOwnerContext('user-a');
    const apply = vi.fn(() => true);

    const result = await coordinator.run({
      ...owner,
      kind: 'session',
      request: () => Promise.resolve(snapshot),
      apply,
    });

    expect(result).toMatchObject({ ok: false, applied: false, stale: false });
    expect(result.error.message).toBe('个人数据请求未返回可提交的完整快照');
    expect(apply).not.toHaveBeenCalled();
  });
});
