// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildWorkbenchPreview } from '../_lib/dataWorkbench.js';

const SCOPE = { gameUid: '1', serverScope: '1' };
const pool = { pool_id: 'p', type: 'limited', roster_status: 'missing', start_time: '2026-01-01', end_time: '2026-02-01' };
const entity = { id: 'e', type: 'character', rarity: 6 };
const catalog = { entities: [entity], pools: [{ ...pool, id: pool.pool_id, six_star_entities: [] }] };

describe('workbench matching summary boundary', () => {
  it('accepts a summary equal to known pulls without adding a second pull', () => {
    const result = buildWorkbenchPreview({
      draftId: '22222222-2222-4222-8222-222222222222',
      scope: SCOPE,
      entries: [
        {
          entryId: '66666666-6666-4666-8666-666666666666', kind: 'pool-summary', poolId: 'p',
          timePrecision: 'range', reviewState: 'confirmed',
          values: { drawMethod: 'normal', totalPulls: 1, rangeStart: '2026-01-01T00:00:00Z', rangeEnd: '2026-02-01T00:00:00Z' },
        },
      ],
    }, { entries: [], history: [{ pool_id: 'p', character_id: 'e', rarity: 6, timestamp: '2026-01-10T01:00:00Z', record_id: 'r1' }], contextToken: 't' }, catalog);
    expect(result.canCommit).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.metrics.confirmed.totalPulls).toBe(1);
    expect(result.metrics.supplemental.totalPulls).toBe(0);
    expect(result.metrics.combined.totalPulls).toBe(1);
    expect(result.metrics.coverage.ranges).toEqual([
      expect.objectContaining({ delta: expect.objectContaining({ totalPulls: 0 }) }),
    ]);
  });
});
