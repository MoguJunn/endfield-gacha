import { describe, expect, it } from 'vitest';
import {
  buildGameUidOptionsFromHistory,
  filterHistoryForEffectiveGameUid,
  isImplicitAllAccountAnalysis,
  resolveEffectiveGameUid
} from '../accountScopeUtils.js';

describe('accountScopeUtils', () => {
  const history = [
    { id: 1, gameUid: '1001' },
    { id: 2, game_uid: '1002' },
    { id: 3, gameUid: '1002' },
    { id: 4, gameUid: '1002' },
    { id: 5, gameUid: '1001' },
    { id: 6, gameUid: 'null' },
    { id: 7, gameUid: 'undefined' },
    { id: 8, gameUid: '' },
    { id: 9 }
  ];

  it('preserves a valid current UID', () => {
    expect(resolveEffectiveGameUid({
      currentGameUid: '1001',
      gameAccounts: [{ gameUid: '1001' }, { gameUid: '1002' }],
      historyRecords: history
    })).toBe('1001');
  });

  it('falls back to the highest-record-count account when current UID is missing or invalid', () => {
    expect(resolveEffectiveGameUid({
      currentGameUid: '9999',
      historyRecords: history
    })).toBe('1002');

    expect(buildGameUidOptionsFromHistory(history).map((account) => account.gameUid)).toEqual(['1002', '1001']);
  });

  it('splits same uid records by server account key', () => {
    const multiServerHistory = [
      { id: 'cn-1', gameUid: '1001', serverId: '1', poolId: 'pool_a', seqId: '1' },
      { id: 'intl-1', gameUid: '1001', serverId: '2', poolId: 'pool_a', seqId: '1' },
      { id: 'cn-2', gameUid: '1001', serverId: '1', poolId: 'pool_a', seqId: '2' },
    ];

    const options = buildGameUidOptionsFromHistory(multiServerHistory);

    expect(options.map((account) => account.accountKey)).toEqual([
      '1001::server:1',
      '1001::server:2',
    ]);
    expect(filterHistoryForEffectiveGameUid(multiServerHistory, '1001::server:1').map((record) => record.id)).toEqual(['cn-1', 'cn-2']);
    expect(filterHistoryForEffectiveGameUid(multiServerHistory, '1001::server:2').map((record) => record.id)).toEqual(['intl-1']);
  });

  it('ignores empty null-like UID values', () => {
    expect(buildGameUidOptionsFromHistory(history).some((account) => (
      account.gameUid === 'null' || account.gameUid === 'undefined' || account.gameUid === ''
    ))).toBe(false);
  });

  it('filters history to the effective UID only', () => {
    expect(filterHistoryForEffectiveGameUid(history, '1001').map((record) => record.id)).toEqual([1, 5]);
    expect(filterHistoryForEffectiveGameUid(history, '1002').map((record) => record.id)).toEqual([2, 3, 4]);
  });

  it('keeps only records without a real UID when no effective UID exists', () => {
    expect(filterHistoryForEffectiveGameUid(history, null).map((record) => record.id)).toEqual([6, 7, 8, 9]);
  });

  it('detects the old implicit all-account analysis state', () => {
    expect(isImplicitAllAccountAnalysis(null, [{ gameUid: '1001' }, { gameUid: '1002' }])).toBe(true);
    expect(isImplicitAllAccountAnalysis('1001', [{ gameUid: '1001' }, { gameUid: '1002' }])).toBe(false);
  });
});
