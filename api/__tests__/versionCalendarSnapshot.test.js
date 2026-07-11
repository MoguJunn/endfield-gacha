import { describe, expect, it } from 'vitest';

import {
  buildVersionCalendarPayload,
  cleanPoolDisplayName,
  sanitizeVersionCalendarSnapshot,
} from '../_lib/versionCalendarSnapshot.js';

describe('version calendar snapshot', () => {
  it('removes admin-only preview notes from public pool names', () => {
    expect(cleanPoolDisplayName('临渊望北（前瞻）')).toBe('临渊望北');
    expect(cleanPoolDisplayName('军列申领（前瞻，结束时间与六星不准）')).toBe('军列申领');
    expect(cleanPoolDisplayName('染赤申领')).toBe('染赤申领');
  });

  it('returns a public snapshot without private metadata', () => {
    const result = sanitizeVersionCalendarSnapshot({
      version_key: 'xiangyuan-2026',
      revision: 1,
      title: '终「向渊行」',
      starts_at: '2026-07-16T04:00:00+00:00',
      ends_at: '2026-09-01T22:00:00+00:00',
      content: { events: [{ id: 'op-wander' }] },
      pool_bindings: { 'op-wander': 'pool-a' },
      source_meta: { source: 'official-calendar' },
      published_at: '2026-07-11T00:00:00+00:00',
      updated_at: '2026-07-11T00:00:00+00:00',
      created_by: 'private-user-id',
      is_active: true,
    });

    expect(result).toEqual(expect.objectContaining({
      versionKey: 'xiangyuan-2026',
      revision: 1,
      poolBindings: { 'op-wander': 'pool-a' },
    }));
    expect(result).not.toHaveProperty('created_by');
    expect(result).not.toHaveProperty('is_active');
  });

  it('binds only requested canonical pool names', () => {
    const result = buildVersionCalendarPayload({
      version_key: 'xiangyuan-2026',
      revision: 1,
      title: '终「向渊行」',
      content: { events: [] },
      pool_bindings: {
        'op-wander': 'pool-a',
        'weapon-years': 'pool-b',
      },
    }, [
      { pool_id: 'pool-a', name: '临渊望北（前瞻）' },
      { pool_id: 'pool-b', name: '军列申领（前瞻，结束时间与六星不准）' },
      { pool_id: 'other', name: '不应公开绑定' },
    ]);

    expect(result.poolNames).toEqual({
      'pool-a': '临渊望北',
      'pool-b': '军列申领',
    });
  });
});
