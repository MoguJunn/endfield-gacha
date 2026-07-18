import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAccountGachaRecord,
  deleteAccountGachaRecords,
  loadAccountGachaData,
  loadAccountGachaSeqKeys,
  resolveAccountGachaAliases,
  saveAccountGachaData,
  updateAccountGachaRecord,
} from '../accountGachaDataService.js';
import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';

vi.mock('../authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

describe('accountGachaDataService', () => {
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
        source: 'site_session',
        history: [
          {
            id: 'record-1',
            poolId: 'special_001',
            user_id: 'user-1',
          },
        ],
        meta: {
          count: 1,
        },
        warnings: [],
      },
    });
  });

  it('loads account gacha data with same-origin cookies when no native token is available', async () => {
    await expect(loadAccountGachaData()).resolves.toEqual({
      history: [
        {
          id: 'record-1',
          poolId: 'special_001',
          user_id: 'user-1',
        },
      ],
      source: 'site_session',
      meta: {
        count: 1,
      },
      warnings: [],
    });

    expect(getSupabaseAccessToken).toHaveBeenCalledWith({
      syncSiteSession: false,
      useSiteSessionCache: true,
      allowSiteSessionToken: false,
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    }, expect.objectContaining({
      label: 'account-gacha-data',
    }));
  });

  it('uses a native Supabase token when one is available', async () => {
    getSupabaseAccessToken.mockResolvedValue('native-token');

    await loadAccountGachaData();

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer native-token',
      },
    }, expect.any(Object));
  });

  it('throws a readable error when the endpoint rejects the request', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: false,
        status: 401,
      },
      data: {
        success: false,
        error: 'Missing access token',
        code: 'missing_access_token',
      },
    });

    await expect(loadAccountGachaData()).rejects.toMatchObject({
      message: 'Missing access token',
      code: 'missing_access_token',
      status: 401,
    });
  });

  it('loads seq keys for import dedupe through same-origin auth', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        source: 'site_session',
        keys: [
          {
            seqId: '1',
            gameUid: 'game-1',
            poolId: 'pool-1',
          },
        ],
        meta: {
          count: 1,
        },
        warnings: [],
      },
    });

    await expect(loadAccountGachaSeqKeys({ gameUid: 'game-1' })).resolves.toEqual({
      keys: [
        {
          seqId: '1',
          gameUid: 'game-1',
          poolId: 'pool-1',
        },
      ],
      source: 'site_session',
      meta: {
        count: 1,
      },
      warnings: [],
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data?mode=seq-keys&gameUid=game-1', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    }, expect.objectContaining({
      label: 'account-gacha-data-seq-keys',
    }));
  });

  it('saves account gacha data with same-origin cookies when no native token is available', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        saved: {
          pools: 1,
          history: 1,
        },
        skipped: {
          pools: 0,
          history: 0,
        },
      },
    });

    await expect(saveAccountGachaData({
      pools: [{ id: 'pool-1' }],
      history: [{ id: 1 }],
    })).resolves.toEqual({
      saved: {
        pools: 1,
        history: 1,
      },
      skipped: {
        pools: 0,
        history: 0,
      },
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pools: [{ id: 'pool-1' }],
        history: [{ id: 1 }],
      }),
    }, expect.objectContaining({
      label: 'account-gacha-data-save',
    }));
  });

  it('resolves account gacha aliases through the same private endpoint', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        poolAliases: {
          old_pool: 'new_pool',
        },
        characterAliases: {
          old_char: 'new_char',
        },
      },
    });

    await expect(resolveAccountGachaAliases({
      poolIds: ['old_pool'],
      characterIds: ['old_char'],
    })).resolves.toEqual({
      poolAliases: {
        old_pool: 'new_pool',
      },
      characterAliases: {
        old_char: 'new_char',
      },
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'resolveAliases',
        poolIds: ['old_pool'],
        characterIds: ['old_char'],
      }),
    }, expect.objectContaining({
      label: 'account-gacha-data-aliases',
    }));
  });

  it('deletes selected account gacha records through same-origin auth', async () => {
    getSupabaseAccessToken.mockResolvedValue('native-token');
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        deleted: {
          history: 2,
          pools: 0,
        },
      },
    });

    await expect(deleteAccountGachaRecords([1, 2])).resolves.toEqual({
      deleted: {
        history: 2,
        pools: 0,
      },
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer native-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'records',
        recordIds: [1, 2],
      }),
    }, expect.objectContaining({
      label: 'account-gacha-data-delete',
    }));
  });

  it('updates one owned record with its complete account scope and optimistic version', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { success: true, updated: 1, record: { id: 'record-1', editVersion: 3 } },
    });

    const payload = {
      recordId: 'record-1',
      gameUid: 'game-1',
      serverScope: '1',
      currentPoolId: 'pool-1',
      seqId: '10',
      editVersion: 2,
      changes: {
        poolId: 'pool-2',
        characterId: 'char-1',
        drawMethod: 'info_book',
      },
      reason: '修正错误导入',
    };

    await expect(updateAccountGachaRecord(payload)).resolves.toEqual({
      updated: 1,
      record: { id: 'record-1', editVersion: 3 },
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', expect.objectContaining({
      method: 'PATCH',
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    }), expect.objectContaining({
      label: 'account-gacha-data-record-update',
      retries: 0,
    }));
  });

  it('deletes one detailed record with its complete account scope', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { success: true, deleted: { history: 1, pools: 0 } },
    });

    const locator = {
      recordId: 'record-1',
      gameUid: 'game-1',
      serverScope: '1',
      currentPoolId: 'pool-1',
      seqId: '10',
      reason: '不是我的记录',
    };
    await expect(deleteAccountGachaRecord(locator)).resolves.toEqual({
      deleted: { history: 1, pools: 0 },
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-gacha-data', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ action: 'record', ...locator }),
    }), expect.objectContaining({ label: 'account-gacha-data-delete' }));
  });
});
