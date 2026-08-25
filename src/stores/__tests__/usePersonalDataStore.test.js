import { beforeEach, describe, expect, it } from 'vitest';

import usePersonalDataStore, {
  createPersonalDataInitialState,
} from '../usePersonalDataStore.js';

function beginOwnerRequest(ownerId = 'user-1') {
  const owner = usePersonalDataStore.getState().switchOwner(ownerId);
  return usePersonalDataStore.getState().beginRequest({
    ownerId,
    ownerGeneration: owner.ownerGeneration,
  });
}

function createAnalysisSnapshot(availability, ownerId = 'user-1') {
  return {
    kind: 'analysis',
    ownerId,
    pools: [],
    analysis: {
      availability,
      schemaVersion: 1,
      meta: { ownerId },
    },
  };
}

describe('usePersonalDataStore.completeRequest', () => {
  beforeEach(() => {
    usePersonalDataStore.setState(createPersonalDataInitialState());
  });

  it('继续接受旧 pools/history 快照', () => {
    const token = beginOwnerRequest();

    expect(usePersonalDataStore.getState().completeRequest(token, {
      pools: [],
      history: [],
    })).toBe(true);
    expect(usePersonalDataStore.getState()).toMatchObject({
      phase: 'empty',
      hasSnapshot: true,
    });
  });

  it.each([
    ['building', 'building', false],
    ['empty', 'empty', true],
    ['ready', 'ready', true],
    ['stale', 'ready', true],
  ])('将 analysis %s 映射为 %s', (availability, phase, hasSnapshot) => {
    const token = beginOwnerRequest();

    expect(usePersonalDataStore.getState().completeRequest(
      token,
      createAnalysisSnapshot(availability)
    )).toBe(true);
    expect(usePersonalDataStore.getState()).toMatchObject({ phase, hasSnapshot });
  });

  it.each([
    ['非法 availability', createAnalysisSnapshot('unknown')],
    ['顶层 owner 不匹配', createAnalysisSnapshot('ready', 'user-2')],
    ['analysis owner 不匹配', {
      ...createAnalysisSnapshot('ready'),
      analysis: {
        ...createAnalysisSnapshot('ready').analysis,
        meta: { ownerId: 'user-2' },
      },
    }],
  ])('拒绝%s', (_name, snapshot) => {
    const token = beginOwnerRequest();

    expect(usePersonalDataStore.getState().completeRequest(token, snapshot)).toBe(false);
    expect(usePersonalDataStore.getState().hasSnapshot).toBe(false);
  });

  it.each(['building-poll', 'session', 'explicit', 'mutation'])(
    'building 期间 %s 请求保持 building 而不是退回 loading',
    (kind) => {
      const firstToken = beginOwnerRequest();
      expect(usePersonalDataStore.getState().completeRequest(
        firstToken,
        createAnalysisSnapshot('building')
      )).toBe(true);

      const current = usePersonalDataStore.getState();
      const pollToken = current.beginRequest({
        ownerId: current.ownerId,
        ownerGeneration: current.ownerGeneration,
        kind,
      });

      expect(pollToken).toBeTruthy();
      expect(usePersonalDataStore.getState()).toMatchObject({
        phase: 'building',
        hasSnapshot: false,
      });
    }
  );

  it('全局重试状态保留下一次时间并在 owner generation 变化时清空', () => {
    beginOwnerRequest();
    const store = usePersonalDataStore.getState();
    const first = store.ensureAnalysisRetrySchedule('retry-key', 60_000, 1_000);
    const duplicate = usePersonalDataStore.getState().ensureAnalysisRetrySchedule(
      'retry-key',
      120_000,
      2_000
    );

    expect(first).toEqual({
      key: 'retry-key',
      attempt: 0,
      nextRetryAt: 61_000,
    });
    expect(duplicate).toEqual(first);
    expect(usePersonalDataStore.getState().markAnalysisRetryFired('retry-key')).toBe(true);
    expect(usePersonalDataStore.getState().analysisRetry).toEqual({
      key: 'retry-key',
      attempt: 1,
      nextRetryAt: null,
    });

    usePersonalDataStore.getState().invalidateRequests('owner_generation_changed');
    expect(usePersonalDataStore.getState().analysisRetry).toEqual({
      key: null,
      attempt: 0,
      nextRetryAt: null,
    });
  });
});
