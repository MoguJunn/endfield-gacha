import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAccountGachaRecord,
  deleteAccountGachaRecords,
  loadAllAccountGachaHistoryForAccounts,
  loadAccountGachaAnalysis,
  loadAccountGachaData,
  loadAccountGachaHistoryPage,
  loadAccountGachaSeqKeys,
  resolveAccountGachaAliases,
  saveAccountGachaData,
  updateAccountGachaRecord,
} from '../accountGachaDataService.js';
import { getSameOriginAuthHeaders } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';

vi.mock('../authFetchService.js', () => ({
  getSameOriginAuthHeaders: vi.fn(),
}));

vi.mock('../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

describe('accountGachaDataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSameOriginAuthHeaders.mockImplementation(async (headers) => ({
      headers,
      accessToken: null,
      credentialSource: 'site_session',
      credentialOwnerId: 'user-1',
    }));
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
          ownerId: 'user-1',
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
        ownerId: 'user-1',
        count: 1,
      },
      warnings: [],
    });

    expect(getSameOriginAuthHeaders).toHaveBeenCalledWith({
      Accept: 'application/json',
    }, {
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

  it('loads a lightweight analysis snapshot without requiring a history array', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        mode: 'analysis',
        schemaVersion: 1,
        availability: 'stale',
        source: 'site_session',
        meta: {
          ownerId: 'user-1',
          rawIncluded: false,
          accountKey: 'game-1::server:2',
        },
        owner: {
          accounts: [{ accountKey: 'game-1::server:2' }],
          summary: { total: 12 },
        },
        scope: {
          selector: { totalPulls: 12 },
        },
        warnings: [{ code: 'personal_analysis_scope_stale' }],
      },
    });

    await expect(loadAccountGachaAnalysis({
      accountKey: 'game-1::server:2',
    })).resolves.toEqual({
      availability: 'stale',
      schemaVersion: 1,
      owner: {
        accounts: [{ accountKey: 'game-1::server:2' }],
        summary: { total: 12 },
      },
      scope: {
        selector: { totalPulls: 12 },
      },
      source: 'site_session',
      meta: {
        ownerId: 'user-1',
        rawIncluded: false,
        accountKey: 'game-1::server:2',
      },
      warnings: [{ code: 'personal_analysis_scope_stale' }],
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/account-gacha-data?mode=analysis&accountKey=game-1%3A%3Aserver%3A2',
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      },
      expect.objectContaining({
        label: 'account-gacha-data-analysis',
      })
    );
  });

  it('uses a native Supabase token only when no site session is active', async () => {
    getSameOriginAuthHeaders.mockResolvedValue({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer native-token',
      },
      accessToken: 'native-token',
      credentialSource: 'supabase',
      credentialOwnerId: null,
    });

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
          ownerId: 'user-1',
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
        ownerId: 'user-1',
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

  it('loads one bounded history page with an account-scoped cursor', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
      },
      data: {
        success: true,
        mode: 'history',
        source: 'site_session',
        meta: {
          ownerId: 'user-1',
          rawIncluded: true,
        },
        scope: {
          accountKey: 'game-1::server:2',
          gameUid: 'game-1',
          serverScope: '2',
          poolId: 'pool-1',
        },
        records: [{ id: 'record-1' }],
        page: {
          limit: 25,
          nextCursor: 'next-cursor',
          hasMore: true,
          total: 824,
          revision: '7',
        },
        warnings: [],
      },
    });

    await expect(loadAccountGachaHistoryPage({
      gameUid: 'game-1',
      accountKey: 'game-1::server:2',
      serverScope: '2',
      poolId: 'pool-1',
      region: 'intl',
      cursor: 'current-cursor',
      limit: 25,
    })).resolves.toEqual({
      records: [{ id: 'record-1' }],
      page: {
        limit: 25,
        nextCursor: 'next-cursor',
        hasMore: true,
        total: 824,
        revision: '7',
      },
      scope: {
        accountKey: 'game-1::server:2',
        gameUid: 'game-1',
        serverScope: '2',
        poolId: 'pool-1',
      },
      source: 'site_session',
      meta: {
        ownerId: 'user-1',
        rawIncluded: true,
      },
      warnings: [],
    });

    const [requestUrl, requestInit, requestOptions] = fetchJsonWithTimeout.mock.calls[0];
    const parsedUrl = new URL(requestUrl, 'https://example.test');
    expect(Object.fromEntries(parsedUrl.searchParams)).toEqual({
      mode: 'history',
      gameUid: 'game-1',
      serverScope: '2',
      limit: '25',
      accountKey: 'game-1::server:2',
      poolId: 'pool-1',
      region: 'intl',
      cursor: 'current-cursor',
    });
    expect(requestInit).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(requestOptions).toMatchObject({
      label: 'account-gacha-data-history-page',
      retries: 1,
    });
  });

  it('loads every page for multiple accounts in order and removes duplicate records', async () => {
    const accountOne = {
      accountKey: 'game-1::server:1',
      gameUid: 'game-1',
      serverScope: '1',
      region: 'cn',
      recordCount: 3,
    };
    const accountTwo = {
      accountKey: 'game-2::server:2',
      gameUid: 'game-2',
      serverScope: '2',
      region: 'intl',
      recordCount: 1,
    };
    const record = (id, gameUid, serverScope, seqId) => ({
      id,
      gameUid,
      serverScope,
      poolId: 'pool-1',
      seqId,
    });
    fetchJsonWithTimeout
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: {
          success: true,
          records: [record('record-1', 'game-1', '1', '1'), record('record-2', 'game-1', '1', '2')],
          page: { limit: 2, nextCursor: 'cursor-1', hasMore: true, total: 3, revision: 7 },
          meta: { ownerId: 'user-1' },
          warnings: [{ code: 'page-one-warning' }],
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: {
          success: true,
          records: [record('record-2', 'game-1', '1', '2'), record('record-3', 'game-1', '1', '3')],
          page: { limit: 2, nextCursor: null, hasMore: false, total: null, revision: '7' },
          meta: { ownerId: 'user-1' },
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: {
          success: true,
          records: [record('record-4', 'game-2', '2', '4')],
          page: { limit: 2, nextCursor: null, hasMore: false, total: 1, revision: '3' },
          meta: { ownerId: 'user-1' },
          warnings: [{ code: 'account-two-warning' }],
        },
      });
    const onProgress = vi.fn();

    const result = await loadAllAccountGachaHistoryForAccounts({
      accounts: [accountOne, accountTwo],
      expectedOwnerId: 'user-1',
      onProgress,
      pageLimit: 2,
    });

    expect(result.history.map((item) => item.id)).toEqual([
      'record-1',
      'record-2',
      'record-3',
      'record-4',
    ]);
    expect(result.accounts).toEqual([accountOne, accountTwo]);
    expect(result.warnings).toEqual([
      { code: 'page-one-warning' },
      { code: 'account-two-warning' },
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({
      accountIndex: 1,
      accountCount: 2,
      loaded: 4,
      total: 4,
    });

    const requestUrls = fetchJsonWithTimeout.mock.calls.map(([url]) => new URL(url, 'https://example.test'));
    expect(requestUrls.map((url) => url.searchParams.get('accountKey'))).toEqual([
      accountOne.accountKey,
      accountOne.accountKey,
      accountTwo.accountKey,
    ]);
    expect(requestUrls.map((url) => url.searchParams.get('poolId'))).toEqual([null, null, null]);
    expect(requestUrls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'cursor-1', null]);
  });

  it('rejects an incomplete account before starting paged reads', async () => {
    await expect(loadAllAccountGachaHistoryForAccounts({
      accounts: [{
        accountKey: 'game-1::server:1',
        gameUid: 'game-1',
      }],
      expectedOwnerId: 'user-1',
    })).rejects.toMatchObject({
      code: 'account_gacha_history_account_invalid',
    });
    expect(fetchJsonWithTimeout).not.toHaveBeenCalled();
  });

  it('allows accounts without a region when game and server scope are known', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        records: [{ id: 'record-1' }],
        page: { hasMore: false, total: 1, revision: '1' },
        meta: { ownerId: 'user-1' },
      },
    });

    await expect(loadAllAccountGachaHistoryForAccounts({
      accounts: [{
        accountKey: 'game-1::server:1',
        gameUid: 'game-1',
        serverScope: '1',
        region: null,
      }],
      expectedOwnerId: 'user-1',
    })).resolves.toMatchObject({
      history: [{ id: 'record-1' }],
    });
  });

  it('rejects a history page owned by another user', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        records: [{ id: 'record-1' }],
        page: { hasMore: false, total: 1, revision: '1' },
        meta: { ownerId: 'user-2' },
      },
    });

    await expect(loadAllAccountGachaHistoryForAccounts({
      accounts: [{
        accountKey: 'game-1::server:1',
        gameUid: 'game-1',
        serverScope: '1',
        region: 'cn',
      }],
      expectedOwnerId: 'user-1',
    })).rejects.toMatchObject({
      code: 'account_gacha_history_owner_mismatch',
    });
  });

  it('restarts one account from its first page once when the history revision changes', async () => {
    const buildPage = ({ records, nextCursor = null, hasMore = false, revision }) => ({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        records,
        page: { limit: 200, nextCursor, hasMore, total: 2, revision },
        meta: { ownerId: 'user-1' },
        warnings: [],
      },
    });
    fetchJsonWithTimeout
      .mockResolvedValueOnce(buildPage({
        records: [{ id: 'discarded-record' }],
        nextCursor: 'stale-cursor',
        hasMore: true,
        revision: '1',
      }))
      .mockResolvedValueOnce({
        response: { ok: false, status: 409 },
        data: {
          success: false,
          error: 'History changed while paging',
          code: 'history_revision_changed',
        },
      })
      .mockResolvedValueOnce(buildPage({
        records: [{ id: 'record-new-1' }],
        nextCursor: 'fresh-cursor',
        hasMore: true,
        revision: '2',
      }))
      .mockResolvedValueOnce(buildPage({
        records: [{ id: 'record-new-2' }],
        revision: '2',
      }));

    const result = await loadAllAccountGachaHistoryForAccounts({
      accounts: [{
        accountKey: 'game-1::server:1',
        gameUid: 'game-1',
        serverScope: '1',
        region: 'cn',
      }],
      expectedOwnerId: 'user-1',
    });

    expect(result.history.map((item) => item.id)).toEqual(['record-new-1', 'record-new-2']);
    const requestUrls = fetchJsonWithTimeout.mock.calls.map(([url]) => new URL(url, 'https://example.test'));
    expect(requestUrls.map((url) => url.searchParams.get('cursor'))).toEqual([
      null,
      'stale-cursor',
      null,
      'fresh-cursor',
    ]);
  });

  it('surfaces a second revision change after using the single account retry', async () => {
    const firstPage = (nextCursor, revision) => ({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        records: [{ id: `record-${revision}` }],
        page: { nextCursor, hasMore: true, total: 2, revision },
        meta: { ownerId: 'user-1' },
      },
    });
    const revisionChanged = {
      response: { ok: false, status: 409 },
      data: {
        success: false,
        error: 'History changed while paging',
        code: 'history_revision_changed',
      },
    };
    fetchJsonWithTimeout
      .mockResolvedValueOnce(firstPage('cursor-1', '1'))
      .mockResolvedValueOnce(revisionChanged)
      .mockResolvedValueOnce(firstPage('cursor-2', '2'))
      .mockResolvedValueOnce(revisionChanged);

    await expect(loadAllAccountGachaHistoryForAccounts({
      accounts: [{
        accountKey: 'game-1::server:1',
        gameUid: 'game-1',
        serverScope: '1',
        region: 'cn',
      }],
      expectedOwnerId: 'user-1',
    })).rejects.toMatchObject({
      code: 'history_revision_changed',
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledTimes(4);
  });

  it('rejects a repeated cursor and an account that exceeds the page limit', async () => {
    const account = {
      accountKey: 'game-1::server:1',
      gameUid: 'game-1',
      serverScope: '1',
      region: 'cn',
    };
    const repeatingPage = {
      response: { ok: true, status: 200 },
      data: {
        success: true,
        records: [],
        page: { nextCursor: 'same-cursor', hasMore: true, total: 3, revision: '1' },
        meta: { ownerId: 'user-1' },
      },
    };
    fetchJsonWithTimeout.mockResolvedValue(repeatingPage);

    await expect(loadAllAccountGachaHistoryForAccounts({
      accounts: [account],
      expectedOwnerId: 'user-1',
    })).rejects.toMatchObject({
      code: 'account_gacha_history_cursor_repeated',
    });

    vi.clearAllMocks();
    getSameOriginAuthHeaders.mockImplementation(async (headers) => ({ headers }));
    fetchJsonWithTimeout.mockResolvedValue(repeatingPage);
    await expect(loadAllAccountGachaHistoryForAccounts({
      accounts: [account],
      expectedOwnerId: 'user-1',
      maxPagesPerAccount: 1,
    })).rejects.toMatchObject({
      code: 'account_gacha_history_page_limit_exceeded',
    });
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
    getSameOriginAuthHeaders.mockResolvedValue({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer native-token',
      },
      accessToken: 'native-token',
      credentialSource: 'supabase',
      credentialOwnerId: null,
    });
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
