import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCurrentPoolData } from '../useCurrentPoolData.js';

const mockStoreState = vi.hoisted(() => ({
  user: { id: 'user-1' },
  currentPoolId: '__group_extra:special',
  currentGameUid: 'game-1',
  pools: [
    { id: 'joint_reconstruction', type: 'extra', name: '重构', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_weapon_v1' },
    { id: 'joint_special', type: 'extra', name: '特殊', extra_subtype: 'special', extra_rule_profile: 'brilliance_festival_v1' },
    { id: 'joint_unknown', type: 'extra', name: '未知', extra_subtype: null, extra_rule_profile: 'future_profile_v2' },
  ],
  history: [
    { id: 'record-reconstruction', user_id: 'user-1', game_uid: 'game-1', poolId: 'joint_reconstruction', rarity: 4, timestamp: '2026-08-20T00:00:00Z' },
    { id: 'record-special', user_id: 'user-1', game_uid: 'game-1', poolId: 'joint_special', rarity: 5, timestamp: '2026-08-21T00:00:00Z' },
    { id: 'record-unknown', user_id: 'user-1', game_uid: 'game-1', poolId: 'joint_unknown', rarity: 4, timestamp: '2026-08-22T00:00:00Z' },
  ],
}));
const mockResolvePoolRosterBucketsBatch = vi.hoisted(() => vi.fn(async () => new Map()));

vi.mock('../../../stores/index.js', () => ({
  useAuthStore: (selector) => selector({ user: mockStoreState.user }),
  usePoolStore: (selector) => selector({
    pools: mockStoreState.pools,
    currentPoolId: mockStoreState.currentPoolId,
    currentGameUid: mockStoreState.currentGameUid,
  }),
  useHistoryStore: (selector) => selector({ history: mockStoreState.history }),
}));

vi.mock('../../../i18n/index.js', () => ({
  getAppLocale: () => 'zh-CN',
  getMessage: (key) => key,
  isEnglishLocale: (locale) => locale === 'en-US',
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key) => key,
  }),
}));

vi.mock('../../../utils/poolRoster.js', () => ({
  resolvePoolRosterBucketsBatch: mockResolvePoolRosterBucketsBatch,
}));

describe('useCurrentPoolData extra subtype scopes', () => {
  it('limits selected pools and record history to the selected extra subtype', async () => {
    const { result } = renderHook(() => useCurrentPoolData());

    expect(result.current.groupType).toBe('extra');
    expect(result.current.groupSubtype).toBe('special');
    expect(result.current.selectedPools.map((pool) => pool.id)).toEqual(['joint_special']);
    expect(result.current.currentPoolHistory.map((record) => record.id)).toEqual(['record-special']);
    expect(result.current.normalizedCurrentPoolHistory.map((record) => record.id)).toEqual(['record-special']);

    await waitFor(() => {
      expect(mockResolvePoolRosterBucketsBatch).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          poolId: 'joint_special',
          expectedType: 'character',
          poolType: 'limited',
        }),
      ]));
    });
    expect(mockResolvePoolRosterBucketsBatch).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ poolId: 'joint_reconstruction' }),
    ]));
    expect(mockResolvePoolRosterBucketsBatch).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ poolId: 'joint_unknown' }),
    ]));
  });

  it('canonicalizes the legacy weapon tuple into the reconstruction claim scope', async () => {
    const previousPoolId = mockStoreState.currentPoolId;
    mockStoreState.currentPoolId = '__group_extra:reconstruction_claim';

    try {
      const { result } = renderHook(() => useCurrentPoolData());

      expect(result.current.groupSubtype).toBe('reconstruction_claim');
      expect(result.current.selectedPools.map((pool) => pool.id)).toEqual(['joint_reconstruction']);
      expect(result.current.currentPoolHistory.map((record) => record.id)).toEqual(['record-reconstruction']);

      await waitFor(() => {
        expect(mockResolvePoolRosterBucketsBatch).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({
            poolId: 'joint_reconstruction',
            expectedType: 'weapon',
            poolType: 'weapon',
          }),
        ]));
      });
    } finally {
      mockStoreState.currentPoolId = previousPoolId;
    }
  });
});
