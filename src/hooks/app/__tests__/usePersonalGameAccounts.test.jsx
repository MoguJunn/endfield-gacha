// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePersonalGameAccounts } from '../usePersonalGameAccounts.js';
import {
  useHistoryStore,
  usePersonalAnalysisStore,
} from '../../../stores/index.js';
import { createPersonalAnalysisInitialState } from '../../../stores/usePersonalAnalysisStore.js';

describe('usePersonalGameAccounts', () => {
  beforeEach(() => {
    useHistoryStore.setState({ history: [] });
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
  });

  it('keeps the snapshot manifest authoritative over a partial history page', () => {
    useHistoryStore.setState({
      history: [{
        id: 'page-record',
        user_id: 'user-1',
        game_uid: 'partial-account',
        server_id: '1',
      }],
    });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      owner: {
        accounts: [{
          accountKey: 'snapshot-account::server:2',
          gameUid: 'snapshot-account',
          serverId: '2',
          recordCount: 824,
        }],
      },
    });

    const { result } = renderHook(() => usePersonalGameAccounts());

    expect(result.current).toEqual([expect.objectContaining({
      accountKey: 'snapshot-account::server:2',
      recordCount: 824,
    })]);
  });

  it('falls back to raw history before an analysis snapshot exists', () => {
    useHistoryStore.setState({
      history: [{
        id: 'legacy-record',
        user_id: 'user-1',
        game_uid: 'legacy-account',
        server_id: '1',
      }],
    });

    const { result } = renderHook(() => usePersonalGameAccounts());

    expect(result.current).toEqual([expect.objectContaining({
      gameUid: 'legacy-account',
      recordCount: 1,
    })]);
  });
});
