import { describe, expect, it } from 'vitest';
import { buildWorkbenchPreview } from '../_lib/dataWorkbench.js';

describe('historical banner availability for rescued files', () => {
  const entity = { id: 'character', name: '测试UP', type: 'character', rarity: 6,
    pool_config: { pools: ['limited'], introduced_at: '2026-02-20T00:00:00Z' } };
  const pool = { id: 'special_test', name: '测试卡池', type: 'limited', up_character: '测试UP',
    start_time: '2026-02-01T00:00:00Z', end_time: '2026-03-01T00:00:00Z',
    rosterEntityIds: [entity.id], six_star_entities: [{ id: entity.id, is_up: true }] };
  const entry = { entryId: 'entry', kind: 'pool-ledger', poolId: pool.id, source: 'file', timePrecision: 'range', reviewState: 'confirmed',
    values: { drawMethod: 'normal', coverageMode: 'range', complete: false,
      rangeStart: '2026-02-10T00:00:00Z', rangeEnd: '2026-02-11T00:00:00Z',
      acquisitions: [{ id: 'drop', entityId: entity.id, rarity: 6, drawMethod: 'normal', timePrecision: 'second', timestamp: '2026-02-10T00:00:00Z' }] } };
  const preview = candidate => buildWorkbenchPreview({ entries: [entry], scope: { gameUid: '1', serverScope: '1' } }, { entries: [], history: [] }, { pools: [candidate], entities: [entity] });
  it('uses the opening date supported by the UP roster when catalog introduction was edited later', () => {
    expect(preview(pool).canCommit).toBe(true);
    expect(entity.pool_config.introduced_at).toBe('2026-02-20T00:00:00Z');
  });
  it('keeps the release constraint when the historical UP evidence is absent', () => {
    expect(preview({ ...pool, six_star_entities: [{ id: entity.id, is_up: false }] }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'entity_not_released' }),
    ]));
    expect(preview({ ...pool, up_character: '另一角色' }).canCommit).toBe(false);
  });
});
