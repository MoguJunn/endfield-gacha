import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: harness.from,
  },
}));

vi.mock('../../services/publicResourceClient.js', () => ({
  fetchPublicApiJson: vi.fn(),
  shouldAllowPublicSupabaseFallback: () => true,
}));

vi.mock('../characterUtils.js', () => ({
  characterCache: {
    searchByName: vi.fn(() => null),
    getAll: vi.fn(() => []),
  },
  getLimitedCharacterPoolStatus: vi.fn(() => ({
    isIntroduced: true,
    isActive: true,
  })),
}));

import { fetchPoolRosterBuckets } from '../poolRoster.js';

describe('pool roster direct fallback cache', () => {
  beforeEach(() => {
    harness.from.mockReset();
    harness.select.mockReset();
    harness.eq.mockReset();
    harness.from.mockReturnValue({ select: harness.select });
    harness.select.mockReturnValue({ eq: harness.eq });
    harness.eq.mockResolvedValue({
      data: [
        {
          is_up: true,
          characters: {
            id: 'char-cache',
            name: '缓存角色',
            rarity: 6,
            type: 'character',
            avatar_url: '/cache.png',
          },
        },
      ],
      error: null,
    });
  });

  it('shares in-flight and completed Supabase reads for the same pool', async () => {
    const options = { expectedType: 'character', currentUpName: '缓存角色' };
    const firstPromise = fetchPoolRosterBuckets('pool-cache', options);
    const secondPromise = fetchPoolRosterBuckets('pool-cache', options);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const third = await fetchPoolRosterBuckets('pool-cache', options);

    expect(harness.from).toHaveBeenCalledTimes(1);
    expect(first.sixStar).toEqual(['缓存角色']);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
