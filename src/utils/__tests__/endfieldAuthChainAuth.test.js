import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseAccessToken } from '../../services/authFetchService.js';
import { fetchWithTimeout } from '../../services/supabaseRequest.js';
import { queuedFetch } from '../requestQueue.js';
import {
  fetchFullImportStatus,
  importAllRecordsFullyOnBackend,
} from '../endfieldAuthChain.js';

vi.mock('../../services/authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../../services/supabaseRequest.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../requestQueue.js', () => ({
  queuedFetch: vi.fn(),
}));

vi.mock('../appLogger.js', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function jsonResponse(payload) {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

describe('endfieldAuthChain auth headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAccessToken.mockResolvedValue('site-session-token');
    fetchWithTimeout.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        status: 'running',
        progress: 20,
      },
    }));
    queuedFetch.mockResolvedValue(jsonResponse({
      success: true,
      taskId: 'task-1',
    }));
  });

  it('uses the shared site-session aware token for backend import status requests', async () => {
    const result = await fetchFullImportStatus('task-1');

    expect(getSupabaseAccessToken).toHaveBeenCalledWith({
      syncSiteSession: true,
      useSiteSessionCache: true,
      allowSiteSessionToken: true,
      preferSiteSessionToken: true,
    });
    const [requestUrl, requestInit, requestOptions] = fetchWithTimeout.mock.calls[0];
    const parsedUrl = new URL(requestUrl, 'http://localhost');
    expect(parsedUrl.pathname).toBe('/api/hg-proxy');
    expect(parsedUrl.searchParams.get('action')).toBe('import-status');
    expect(parsedUrl.searchParams.get('taskId')).toBe('task-1');
    expect(parsedUrl.searchParams.get('source')).toBe('cn');
    expect(requestInit).toEqual({
      headers: {
        Authorization: 'Bearer site-session-token',
      },
    });
    expect(requestOptions).toEqual(expect.objectContaining({
      label: 'import-status',
    }));
    expect(result).toEqual({
      status: 'running',
      progress: 20,
    });
  });

  it('refreshes the site session once when a required import token is missing from cache', async () => {
    getSupabaseAccessToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('fresh-site-session-token');

    await expect(fetchFullImportStatus('task-1')).resolves.toEqual({
      status: 'running',
      progress: 20,
    });

    expect(getSupabaseAccessToken).toHaveBeenNthCalledWith(1, {
      syncSiteSession: true,
      useSiteSessionCache: true,
      allowSiteSessionToken: true,
      preferSiteSessionToken: true,
    });
    expect(getSupabaseAccessToken).toHaveBeenNthCalledWith(2, {
      syncSiteSession: true,
      useSiteSessionCache: false,
      allowSiteSessionToken: true,
      preferSiteSessionToken: true,
    });
    const [, requestInit] = fetchWithTimeout.mock.calls[0];
    expect(requestInit).toEqual({
      headers: {
        Authorization: 'Bearer fresh-site-session-token',
      },
    });
  });

  it('allows the shared site-session aware token when submitting a full backend import', async () => {
    getSupabaseAccessToken.mockResolvedValue('site-session-token');
    fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          status: 'completed',
          progress: 100,
          result: {
            totalRecords: 0,
            newRecords: 0,
          },
        },
      }));

    await importAllRecordsFullyOnBackend('official-token', 0, 'user-1', null, 'cn');

    expect(getSupabaseAccessToken).toHaveBeenNthCalledWith(1, {
      syncSiteSession: true,
      useSiteSessionCache: false,
      allowSiteSessionToken: true,
      preferSiteSessionToken: true,
    });
    expect(queuedFetch).toHaveBeenCalledWith(
      expect.stringContaining('action=import-full'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer site-session-token',
        }),
      }),
      expect.any(Object)
    );
  });

  it('stops polling a cancelled persistent task immediately', async () => {
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ success: true,
      data: { status: 'cancelled', error: '导入任务已取消。' } }));
    await expect(importAllRecordsFullyOnBackend('official-token',0,'user-1',null,'cn'))
      .rejects.toMatchObject({ step:'import-full', message:'导入任务已取消。' });
    expect(fetchWithTimeout).toHaveBeenCalledOnce();
  });

  it('continues a persistent task beyond the old five minute browser limit', async () => {
    vi.useFakeTimers();
    try {
      const initialTime=Date.now();
      fetchWithTimeout.mockResolvedValueOnce(jsonResponse({success:true,data:{status:'pending',progress:0}}))
        .mockResolvedValueOnce(jsonResponse({success:true,data:{status:'completed',result:{savedRecords:1}}}));
      const result=importAllRecordsFullyOnBackend('official-token',0,'user-1',(update)=>{
        if(update.status==='pending' && update.progress===0) vi.setSystemTime(initialTime+6*60*1000);
      },'cn');
      await vi.advanceTimersByTimeAsync(2001);
      await expect(result).resolves.toEqual({savedRecords:1});
    } finally { vi.useRealTimers(); }
  });
});
