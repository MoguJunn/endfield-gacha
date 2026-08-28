import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseAccessToken } from '../../authFetchService.js';
import { fetchJsonWithTimeout } from '../../supabaseRequest.js';
import {
  loadOpsAutomationRuns,
  triggerManualSync,
} from '../opsAutomationService.js';

vi.mock('../../authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

describe('opsAutomationService same-origin API client', () => {
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
        runs: [
          {
            id: 'run-1',
            job_id: 'official-announcements',
            status: 'success',
          },
        ],
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({ success: true })),
    })));
  });

  it('loads runs with same-origin cookies when no native token exists', async () => {
    await expect(loadOpsAutomationRuns({
      jobId: 'official-announcements',
      status: 'success',
      triggerType: 'manual',
      limit: 500,
    })).resolves.toEqual([
      {
        id: 'run-1',
        job_id: 'official-announcements',
        status: 'success',
      },
    ]);

    expect(getSupabaseAccessToken).toHaveBeenCalledWith({
      syncSiteSession: false,
      useSiteSessionCache: true,
      allowSiteSessionToken: false,
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/admin-ops-automation?limit=200&jobId=official-announcements&status=success&triggerType=manual',
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      },
      expect.objectContaining({
        label: 'admin-ops-automation-load',
      }),
    );
  });

  it('uses a native Supabase token when one is available', async () => {
    getSupabaseAccessToken.mockResolvedValue('native-token');

    await loadOpsAutomationRuns();

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/admin-ops-automation?limit=20',
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer native-token',
        },
      },
      expect.any(Object),
    );
  });

  it('triggers manual jobs with same-origin cookies when no native token exists', async () => {
    fetchJsonWithTimeout.mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: { success: true },
    });

    await expect(triggerManualSync('all', {
      forceRefresh: true,
      refreshMode: 'all',
      announcementLimit: 20,
    })).resolves.toEqual({ success: true });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/admin-ops-automation',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          job: 'all',
          forceRefresh: true,
          refreshMode: 'all',
          announcementLimit: 20,
        }),
      },
      expect.objectContaining({
        label: 'admin-ops-automation-trigger',
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws readable failures when the admin route rejects the request', async () => {
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

    await expect(loadOpsAutomationRuns()).rejects.toMatchObject({
      message: 'Super admin role required',
      code: 'admin_ops_automation_load_failed',
      status: 403,
    });
  });
});
