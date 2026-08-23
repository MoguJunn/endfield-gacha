import { beforeEach, describe, expect, it } from 'vitest';

import usePersonalAnalysisStore, {
  createPersonalAnalysisInitialState,
} from '../usePersonalAnalysisStore.js';

function createAnalysis(ownerId, overrides = {}) {
  return {
    availability: 'ready',
    schemaVersion: 2,
    owner: { defaultAccountKey: 'account-1' },
    scope: { account: { accountKey: 'account-1' } },
    meta: { ownerId },
    warnings: [{ code: 'test-warning' }],
    ...overrides,
  };
}

describe('usePersonalAnalysisStore', () => {
  beforeEach(() => {
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
  });

  it('拒绝 meta.ownerId 与目标 owner 不一致的快照', () => {
    const applied = usePersonalAnalysisStore.getState().applyAnalysis(
      'user-a',
      createAnalysis('user-b')
    );

    expect(applied).toBe(false);
    expect(usePersonalAnalysisStore.getState()).toMatchObject({
      ownerId: null,
      availability: 'idle',
      owner: null,
      scope: null,
    });
  });

  it('切换 owner 时不会沿用旧 owner 的载荷', () => {
    expect(usePersonalAnalysisStore.getState().applyAnalysis(
      'user-a',
      createAnalysis('user-a')
    )).toBe(true);

    expect(usePersonalAnalysisStore.getState().applyAnalysis('user-b', {
      availability: 'building',
      schemaVersion: 1,
      meta: { ownerId: 'user-b', retryAfterSeconds: 3 },
    })).toBe(true);

    expect(usePersonalAnalysisStore.getState()).toMatchObject({
      ownerId: 'user-b',
      availability: 'building',
      owner: null,
      scope: null,
    });
  });

  it('stale 更新缺少载荷时保留同 owner 的上次载荷', () => {
    const initial = createAnalysis('user-a');
    usePersonalAnalysisStore.getState().applyAnalysis('user-a', initial);

    expect(usePersonalAnalysisStore.getState().applyAnalysis('user-a', {
      availability: 'stale',
      schemaVersion: 2,
      meta: { ownerId: 'user-a' },
      warnings: [{ code: 'stale' }],
    })).toBe(true);

    expect(usePersonalAnalysisStore.getState()).toMatchObject({
      availability: 'stale',
      owner: initial.owner,
      scope: initial.scope,
      warnings: [{ code: 'stale' }],
    });
  });
});
