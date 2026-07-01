import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateAccountGachaServerLabel } from '../../services/accountGachaDataService.js';
import {
  buildDuplicateGameUidServerGroups,
  updateAccountServerLabel,
} from '../accountServerLabelCorrection.js';

vi.mock('../../services/accountGachaDataService.js', () => ({
  updateAccountGachaServerLabel: vi.fn(async (payload) => ({
    updated: payload.mergeGameUid ? 2 : 1,
    serverId: payload.serverId,
    region: payload.region,
  })),
}));

describe('accountServerLabelCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects the same UID split across multiple servers', () => {
    const groups = buildDuplicateGameUidServerGroups([
      { gameUid: '10000001', nickName: 'Doctor', serverId: '2', region: 'intl', recordCount: 12 },
      { gameUid: '10000001', nickName: 'Doctor', serverId: '3', region: 'intl', recordCount: 8 },
      { gameUid: '10000002', nickName: 'Other', serverId: '3', region: 'intl', recordCount: 4 },
      { gameUid: '10000002', nickName: 'Other', serverId: '3', region: 'intl', recordCount: 2 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      gameUid: '10000001',
      serverCount: 2,
      defaultServerId: '2',
    });
    expect(groups[0].labels).toEqual(expect.arrayContaining(['国际服·亚服', '国际服·欧/美服']));
  });

  it('updates all records for a UID when merging split server groups', async () => {
    const history = [
      { gameUid: '10000001', game_uid: '10000001', serverId: '2', server_id: '2', region: 'intl' },
      { gameUid: '10000001', game_uid: '10000001', serverId: '3', server_id: '3', region: 'intl' },
      { gameUid: '10000002', game_uid: '10000002', serverId: '2', server_id: '2', region: 'intl' },
    ];
    let nextHistory = [];
    const setHistory = vi.fn((rows) => {
      nextHistory = rows;
    });
    const switchGameAccount = vi.fn();

    await updateAccountServerLabel({
      account: {
        gameUid: '10000001',
        accountKey: '10000001::server:2',
        serverId: '2',
        region: 'intl',
      },
      nextServerId: '3',
      history,
      setHistory,
      currentGameUid: '10000001::server:2',
      switchGameAccount,
      mergeGameUid: true,
      mergeAccounts: [
        { gameUid: '10000001', accountKey: '10000001::server:2', serverId: '2', region: 'intl' },
        { gameUid: '10000001', accountKey: '10000001::server:3', serverId: '3', region: 'intl' },
      ],
    });

    expect(updateAccountGachaServerLabel).toHaveBeenCalledWith(expect.objectContaining({
      gameUid: '10000001',
      accountKey: '10000001::server:2',
      serverId: '3',
      region: 'intl',
      mergeGameUid: true,
    }));
    expect(setHistory).toHaveBeenCalledTimes(1);
    expect(nextHistory.filter(record => record.gameUid === '10000001')).toEqual([
      expect.objectContaining({ serverId: '3', server_id: '3', region: 'intl' }),
      expect.objectContaining({ serverId: '3', server_id: '3', region: 'intl' }),
    ]);
    expect(nextHistory.find(record => record.gameUid === '10000002')).toMatchObject({
      serverId: '2',
      server_id: '2',
      region: 'intl',
    });
    expect(switchGameAccount).toHaveBeenCalledWith('10000001::server:3');
  });
});
