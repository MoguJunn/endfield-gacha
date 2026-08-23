import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  fetchPublicApiJson: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: harness.supabaseFrom,
  },
}));

vi.mock('../../services/publicResourceClient.js', () => ({
  fetchPublicApiJson: harness.fetchPublicApiJson,
  shouldAllowPublicSupabaseFallback: () => true,
}));

import { characterCache } from '../characterUtils.js';
import { resolvePoolRosterBucketsBatch } from '../poolRoster.js';

describe('pool roster batch fallback', () => {
  beforeEach(() => {
    characterCache.clear();
    harness.fetchPublicApiJson.mockReset();
    harness.supabaseFrom.mockReset();
    harness.fetchPublicApiJson.mockRejectedValue(new Error('batch unavailable'));
    characterCache.applyCharacters([
      {
        id: 'local-standard-six',
        name: '本地常驻六星',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
      {
        id: 'local-standard-five',
        name: '本地常驻五星',
        rarity: 5,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
    ]);
  });

  afterEach(() => {
    characterCache.clear();
  });

  it('uses one failed batch read and never fans out to per-pool Supabase reads', async () => {
    const result = await resolvePoolRosterBucketsBatch([
      {
        poolId: 'scope-pool-a',
        expectedType: 'character',
        poolType: 'standard',
      },
      {
        poolId: 'scope-pool-b',
        expectedType: 'character',
        poolType: 'standard',
      },
    ], { forceRefresh: true });

    expect(harness.fetchPublicApiJson).toHaveBeenCalledTimes(1);
    expect(harness.supabaseFrom).not.toHaveBeenCalled();
    expect(result.get('scope-pool-a').sixStar).toEqual(['本地常驻六星']);
    expect(result.get('scope-pool-b').fiveStar).toEqual(['本地常驻五星']);
  });
});
