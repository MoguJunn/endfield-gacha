import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseAccessToken } from '../../authFetchService.js';
import { fetchJsonWithTimeout } from '../../supabaseRequest.js';
import {
  buildPoolAliasRowsForSave,
  createUpCharacter,
  deletePool,
  loadPools,
  recalculateIsStandard,
  savePool,
} from '../poolService.js';

vi.mock('../../authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

describe('poolService alias helpers', () => {
  it('builds self aliases for the canonical pool id', () => {
    const rows = buildPoolAliasRowsForSave({
      canonicalPoolId: 'special_manual_limited_test_20260605_abc123',
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pool_id: 'special_manual_limited_test_20260605_abc123',
        source: 'internal',
        alias_id: 'special_manual_limited_test_20260605_abc123',
        is_primary: true,
      }),
      expect.objectContaining({
        pool_id: 'special_manual_limited_test_20260605_abc123',
        source: 'manual_placeholder',
        alias_id: 'special_manual_limited_test_20260605_abc123',
        is_primary: true,
      }),
    ]));
  });

  it('keeps the edited previous id as a non-primary alias when canonical id changes', () => {
    const rows = buildPoolAliasRowsForSave({
      canonicalPoolId: 'special_1001',
      editingPool: {
        pool_id: 'special_manual_limited_laevatain_20260605_abc123',
      },
      poolData: {
        pool_id: 'special_1001',
      },
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pool_id: 'special_1001',
        source: 'official_api',
        alias_id: 'special_1001',
        is_primary: true,
      }),
      expect.objectContaining({
        pool_id: 'special_1001',
        source: 'manual_placeholder',
        alias_id: 'special_manual_limited_laevatain_20260605_abc123',
        is_primary: false,
        note: 'Pool previous id alias',
      }),
    ]));
  });

  it('deduplicates repeated alias rows by source and alias id', () => {
    const rows = buildPoolAliasRowsForSave({
      canonicalPoolId: 'special_manual_limited_test_20260605_abc123',
      editingPool: {
        pool_id: 'special_manual_limited_test_20260605_abc123',
      },
      poolData: {
        pool_id: 'special_manual_limited_test_20260605_abc123',
      },
    });

    const keys = rows.map(row => `${row.source}:${row.alias_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('poolService same-origin API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAccessToken.mockResolvedValue(null);
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        data: [
          {
            pool_id: 'pool-1',
          },
        ],
      },
    });
  });

  it('loads pools with same-origin cookies when no native token is available', async () => {
    await expect(loadPools()).resolves.toEqual({
      success: true,
      data: [
        {
          pool_id: 'pool-1',
        },
      ],
    });

    expect(getSupabaseAccessToken).toHaveBeenCalledWith({
      syncSiteSession: false,
      useSiteSessionCache: true,
      allowSiteSessionToken: false,
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/admin-pools?mode=pools', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    }, expect.objectContaining({
      label: 'admin-pools-load',
    }));
  });

  it('uses a native Supabase token when one is available', async () => {
    getSupabaseAccessToken.mockResolvedValue('native-token');

    await loadPools();

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/admin-pools?mode=pools', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer native-token',
      },
    }, expect.any(Object));
  });

  it('saves pools through the same-origin admin route', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        isNew: true,
        addedCount: 1,
        poolId: 'pool-created',
      },
    });

    await expect(savePool(
      { name: '测试卡池', type: 'limited' },
      null,
      [{ id: 'char-1', name: '测试角色', type: 'character' }],
      [{ character_id: 'char-1', is_up: true }]
    )).resolves.toMatchObject({
      success: true,
      isNew: true,
      addedCount: 1,
      poolId: 'pool-created',
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/admin-pools', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'savePool',
        poolData: { name: '测试卡池', type: 'limited' },
        editingPool: null,
        characters: [{ id: 'char-1', name: '测试角色', type: 'character' }],
        editingPoolCharacters: [{ character_id: 'char-1', is_up: true }],
      }),
    }, expect.objectContaining({
      label: 'admin-pool-save',
    }));
  });

  it('creates an up character through the same-origin route', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        character: {
          id: 'char-created',
          name: '测试角色',
        },
      },
    });

    await expect(createUpCharacter('测试角色', 'limited', '2026-06-05T04:00:00.000Z')).resolves.toEqual({
      id: 'char-created',
      name: '测试角色',
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/admin-pools', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'createUpCharacter',
        characterName: '测试角色',
        poolType: 'limited',
        poolStartTime: '2026-06-05T04:00:00.000Z',
        rotationBaseCount: 0,
      }),
    }), expect.objectContaining({
      label: 'admin-pool-create-up-character',
    }));
  });

  it('forwards reconstruction profile and entity semantics when creating an extra UP target', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        character: { id: 'weapon-created', name: '重构武器', type: 'weapon', is_limited: true },
      },
    });

    await createUpCharacter(
      '重构武器',
      'extra',
      '2026-06-05T04:00:00.000Z',
      0,
      'weapon',
      'reconstruction_weapon_v1'
    );

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/admin-pools', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'createUpCharacter',
        characterName: '重构武器',
        poolType: 'extra',
        poolStartTime: '2026-06-05T04:00:00.000Z',
        rotationBaseCount: 0,
        itemType: 'weapon',
        extraRuleProfile: 'reconstruction_weapon_v1',
      }),
    }), expect.objectContaining({
      label: 'admin-pool-create-up-character',
    }));
  });

  it('deletes pools and recalculates history through the same-origin route', async () => {
    fetchJsonWithTimeout
      .mockResolvedValueOnce({
        response: {
          ok: true,
          status: 200,
        },
        data: {
          success: true,
          poolId: 'pool-1',
        },
      })
      .mockResolvedValueOnce({
        response: {
          ok: true,
          status: 200,
        },
        data: {
          success: true,
          changedCount: 2,
        },
      });

    await expect(deletePool('pool-1')).resolves.toEqual({ success: true });
    await expect(recalculateIsStandard([{ pool_id: 'pool-1' }])).resolves.toMatchObject({
      success: true,
      changedCount: 2,
    });

    expect(fetchJsonWithTimeout).toHaveBeenNthCalledWith(1, '/api/admin-pools', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ poolId: 'pool-1' }),
    }), expect.objectContaining({
      label: 'admin-pool-delete',
    }));
    expect(fetchJsonWithTimeout).toHaveBeenNthCalledWith(2, '/api/admin-pools', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'recalculateIsStandard',
        pools: [{ pool_id: 'pool-1' }],
      }),
    }), expect.objectContaining({
      label: 'admin-pool-recalculate-is-standard',
    }));
  });

  it('returns readable failures when the admin route rejects the request', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: false,
        status: 403,
      },
      data: {
        success: false,
        error: 'Super admin role required',
      },
    });

    await expect(loadPools()).resolves.toEqual({
      success: false,
      error: 'Super admin role required',
    });
  });
});
