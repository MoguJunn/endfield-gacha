// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  applyCloudAnalysisToStores,
  applyCloudDataToStores,
  prepareCloudAnalysisSnapshot,
} from '../cloudDataSync.js';

function createStoreTargets() {
  return {
    setPools: vi.fn(),
    switchPool: vi.fn(),
    setHistory: vi.fn(),
  };
}

describe('applyCloudDataToStores', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['缺少 history', { pools: [] }],
    ['缺少 pools', { history: [] }],
  ])('%s 快照不写入空数组', (_name, cloudData) => {
    const targets = createStoreTargets();

    expect(applyCloudDataToStores(cloudData, targets)).toBe(false);
    expect(targets.setPools).not.toHaveBeenCalled();
    expect(targets.setHistory).not.toHaveBeenCalled();
    expect(targets.switchPool).not.toHaveBeenCalled();
  });

  it('允许提交服务端确认成功的空快照', () => {
    const targets = createStoreTargets();

    expect(applyCloudDataToStores({ pools: [], history: [] }, targets)).toBe(true);
    expect(targets.setPools).toHaveBeenCalledWith([]);
    expect(targets.setHistory).toHaveBeenCalledWith([]);
  });
});

describe('analysis cloud snapshot', () => {
  function createAnalysisSnapshot() {
    return {
      kind: 'analysis',
      ownerId: 'user-1',
      pools: [
        { id: 'pool-a', name: 'A' },
        { id: 'pool-b', name: 'B' },
      ],
      analysis: {
        availability: 'ready',
        schemaVersion: 1,
        owner: { defaultAccountKey: 'account-default' },
        scope: {
          account: { accountKey: 'account-scope' },
          selector: { poolPullCounts: { 'pool-a': 3, 'pool-b': 5 } },
        },
        meta: { ownerId: 'user-1', accountKey: 'account-meta' },
        warnings: [],
      },
      warnings: [],
    };
  }

  it('准备 analysis 快照时拒绝 owner contract 不一致', () => {
    const snapshot = createAnalysisSnapshot();
    snapshot.analysis.meta.ownerId = 'user-2';

    expect(prepareCloudAnalysisSnapshot(snapshot)).toBeNull();
  });

  it('应用 analysis、账号与有数据的首选卡池，且不写 history', () => {
    const setHistory = vi.fn();
    const targets = {
      setPools: vi.fn(),
      switchPool: vi.fn(),
      switchGameAccount: vi.fn(),
      setHistory,
      preferredPoolId: 'pool-b',
      analysisStore: { applyAnalysis: vi.fn(() => true) },
    };
    const snapshot = createAnalysisSnapshot();

    expect(applyCloudAnalysisToStores(snapshot, targets)).toBe(true);
    expect(targets.setPools).toHaveBeenCalledWith(snapshot.pools);
    expect(targets.analysisStore.applyAnalysis).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ availability: 'ready' })
    );
    expect(targets.switchGameAccount).toHaveBeenCalledWith('account-meta');
    expect(targets.switchPool).toHaveBeenCalledWith('pool-b');
    expect(setHistory).not.toHaveBeenCalled();
  });
});
