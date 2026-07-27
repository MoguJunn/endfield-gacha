// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  consumeLotteryRateLimit,
  hashLotteryRateLimitIdentifier,
} from '../_lib/lotteryRateLimit.js';

const SECRET = 'shared-rate-limit-hmac-secret-with-at-least-43-characters';

describe('lottery shared rate limit adapter', () => {
  it('creates stable opaque identifiers without storing raw requester data', () => {
    const identifiers = ['203.0.113.10', 'session-secret-material'];
    const first = hashLotteryRateLimitIdentifier(identifiers, SECRET);
    const second = hashLotteryRateLimitIdentifier(identifiers, SECRET);

    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(first).toBe(second);
    expect(first).not.toContain(identifiers[0]);
    expect(hashLotteryRateLimitIdentifier(['203.0.113.11'], SECRET)).not.toBe(first);
  });

  it('sends only the HMAC identifier to the atomic database RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { allowed: true, remaining: 9, retryAfter: 0 },
      error: null,
    });

    await expect(consumeLotteryRateLimit({ rpc }, {
      action: 'gateway_enter',
      identifiers: ['203.0.113.10', 'session-secret-material'],
      secret: SECRET,
    })).resolves.toEqual({ allowed: true, remaining: 9, retryAfter: 0 });

    expect(rpc).toHaveBeenCalledWith('consume_summer_lottery_rate_limit', {
      p_identifier_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      p_action: 'gateway_enter',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.10');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('session-secret-material');
  });

  it('fails closed on weak keys, database errors, and malformed responses', async () => {
    expect(() => hashLotteryRateLimitIdentifier(['requester'], 'weak'))
      .toThrow('lottery_rate_limit_not_configured');

    await expect(consumeLotteryRateLimit({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }),
    }, {
      action: 'gateway_enter',
      identifiers: ['requester'],
      secret: SECRET,
    })).rejects.toThrow('lottery_rate_limit_unavailable');

    await expect(consumeLotteryRateLimit({
      rpc: vi.fn().mockResolvedValue({ data: { allowed: 'yes' }, error: null }),
    }, {
      action: 'gateway_enter',
      identifiers: ['requester'],
      secret: SECRET,
    })).rejects.toThrow('lottery_rate_limit_unavailable');
  });
});
