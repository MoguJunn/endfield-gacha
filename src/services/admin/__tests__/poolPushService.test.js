import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseAccessToken } from '../../authFetchService.js';
import { fetchJsonWithTimeout } from '../../supabaseRequest.js';
import { previewPoolPush, sendPoolPush } from '../poolPushService.js';

vi.mock('../../authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

describe('poolPushService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAccessToken.mockResolvedValue('admin-access-token');
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        data: {
          dedupeKey: 'pool-update:test',
          confirmationToken: 'signed-preview-token',
        },
      },
    });
  });

  it('requests a preview with the selected pool and admin authorization', async () => {
    const pool = { id: 'pool-1', name: '逐罪者', type: 'limited', upItems: ['卡缪'] };

    await expect(previewPoolPush({ pool })).resolves.toMatchObject({
      success: true,
      data: { confirmationToken: 'signed-preview-token' },
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/admin-pool-push',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ Authorization: 'Bearer admin-access-token' }),
        body: JSON.stringify({ action: 'previewPoolPush', pool }),
      }),
      expect.objectContaining({ label: 'admin-pool-push-previewPoolPush' })
    );
  });

  it('confirms a preview using only its signed confirmation token', async () => {
    await sendPoolPush({
      confirmationToken: 'signed-preview-token',
      dedupeKey: 'pool-update:must-not-be-sent',
      pool: { id: 'must-not-be-sent', name: '不应发送' },
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/admin-pool-push',
      expect.objectContaining({
        body: JSON.stringify({
          action: 'sendPoolPush',
          confirmationToken: 'signed-preview-token',
        }),
      }),
      expect.objectContaining({ label: 'admin-pool-push-sendPoolPush' })
    );
  });

  it('returns confirmation expiry codes for actionable UI feedback', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: false, status: 400 },
      data: {
        success: false,
        error: 'expired_confirmation_token',
        code: 'expired_confirmation_token',
      },
    });

    await expect(sendPoolPush({ confirmationToken: 'expired-token' })).resolves.toEqual({
      success: false,
      error: 'expired_confirmation_token',
      code: 'expired_confirmation_token',
    });
  });
});
