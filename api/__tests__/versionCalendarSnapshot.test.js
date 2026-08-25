import { describe, expect, it } from 'vitest';

import {
  buildVersionCalendarPoolCatalog,
  buildVersionCalendarPayload,
  cleanPoolDisplayName,
  mergeVersionTimelineConfig,
  sanitizeVersionCalendarPool,
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
      version_key: 'version-5',
      version_number: '5',
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
      versionKey: 'version-5',
      versionNumber: '5',
      revision: 1,
      poolBindings: { 'op-wander': 'pool-a' },
    }));
    expect(result).not.toHaveProperty('created_by');
    expect(result).not.toHaveProperty('is_active');
  });

  it('publishes only calendar-safe pool fields including artwork', () => {
    const result = sanitizeVersionCalendarPool({
      pool_id: 'weapon-pool-a',
      name: '军列申领（前瞻）',
      name_en: 'Arsenal A',
      type: 'limited_weapon',
      start_time: '2026-07-16T04:00:00+00:00',
      end_time: '2026-09-05T04:00:00+00:00',
      banner_url: 'https://cdn.example/pool-a.webp',
      user_id: 'private-user',
      creator_username: 'private-name',
    });

    expect(result).toEqual(expect.objectContaining({
      poolId: 'weapon-pool-a',
      name: '军列申领',
      type: 'arsenal',
      bannerUrl: 'https://cdn.example/pool-a.webp',
    }));
    expect(result).not.toHaveProperty('user_id');
    expect(result).not.toHaveProperty('creator_username');
  });

  it('deduplicates the public pool catalog', () => {
    const result = buildVersionCalendarPoolCatalog([
      { pool_id: 'pool-a', name: '临渊望北', start_time: '2026-07-16T04:00:00+00:00' },
      { pool_id: 'pool-a', name: '不应重复', start_time: '2026-07-16T04:00:00+00:00' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('临渊望北');
  });

  it('keeps reconstruction claims in the version calendar as arsenal pools', () => {
    const result = buildVersionCalendarPoolCatalog([{
      pool_id: 'reclaim_9_0_2',
      name: '点绘申领',
      type: 'extra',
      extra_subtype: 'reconstruction_claim',
      extra_rule_profile: 'reconstruction_weapon_v1',
      up_character: '艺术暴君',
      start_time: '2026-09-24T04:00:00+00:00',
    }]);

    expect(result).toEqual([
      expect.objectContaining({
        poolId: 'reclaim_9_0_2',
        name: '点绘申领',
        type: 'arsenal',
      }),
    ]);
  });

  it('uses the UP character artwork for operator and matching weapon pools', () => {
    const result = buildVersionCalendarPoolCatalog([
      {
        pool_id: 'special_1_0_1',
        name: '熔火灼痕',
        type: 'limited',
        up_character: '莱万汀',
        start_time: '2026-01-22T03:00:00+00:00',
      },
      {
        pool_id: 'weponbox_1_0_1',
        name: '熔铸申领',
        type: 'weapon',
        up_character: '熔铸火焰',
        start_time: '2026-01-22T04:00:00+00:00',
      },
    ], [{
      id: 'chr_0016_laevat',
      name: '莱万汀',
      avatar_url: '/avatars/characters/chr_0016_laevat.png',
      aliases: ['莱万汀'],
      type: 'character',
    }, {
      id: 'wpn_sword_0006',
      name: '熔铸火焰',
      avatar_url: '/avatars/weapons/wpn_sword_0006.webp',
      aliases: [],
      type: 'weapon',
    }]);

    expect(result).toEqual([
      expect.objectContaining({
        poolId: 'special_1_0_1',
        backgroundCharacter: '莱万汀',
        backgroundUrl: '/avatars/characters/chr_0016_laevat.png',
      }),
      expect.objectContaining({
        poolId: 'weponbox_1_0_1',
        backgroundCharacter: '熔铸火焰',
        backgroundType: 'weapon',
        backgroundUrl: '/avatars/weapons/wpn_sword_0006.webp',
      }),
    ]);
  });

  it('uses main-site version management as display metadata source', () => {
    const result = mergeVersionTimelineConfig([{
      version_key: 'version-5',
      version_number: 'legacy-number',
      title: '旧标题',
      starts_at: '2026-07-01T00:00:00+00:00',
      ends_at: '2026-08-01T00:00:00+00:00',
      content: { events: [{ id: 'kept-event' }] },
      pool_bindings: { 'kept-event': 'pool-a' },
    }], JSON.stringify({
      versions: [{
        id: 'version-5',
        name: '向渊行',
        name_en: '',
        starts_at: '2026-07-16T04:00:00+00:00',
        ends_at: '2026-09-02T06:00:00+08:00',
        enabled: true,
        order: 50,
      }],
    }), '2026-07-11T18:16:32.446+00:00');

    expect(result[0]).toEqual(expect.objectContaining({
      version_key: 'version-5',
      version_number: '5',
      title: '向渊行',
      starts_at: '2026-07-16T04:00:00+00:00',
      ends_at: '2026-09-02T06:00:00+08:00',
      content: { events: [{ id: 'kept-event' }] },
      pool_bindings: { 'kept-event': 'pool-a' },
    }));
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

  it('builds sorted versions and assigns pools by overlapping time ranges', () => {
    const result = buildVersionCalendarPayload([
      {
        version_key: 'version-5',
        version_number: '5',
        title: '向渊行',
        starts_at: '2026-07-16T04:00:00+00:00',
        ends_at: '2026-09-01T22:00:00+00:00',
        content: { events: [] },
        pool_bindings: {},
      },
      {
        version_key: 'version-4',
        version_number: '4',
        title: '寻遗散记',
        starts_at: '2026-06-04T20:00:00+00:00',
        ends_at: '2026-07-15T22:00:00+00:00',
        content: { activitiesComplete: false, events: [] },
        pool_bindings: {},
      },
    ], [
      {
        pool_id: 'pool-cross-version',
        name: '染赤申领',
        type: 'weapon',
        start_time: '2026-06-26T04:00:00+00:00',
        end_time: '2026-08-16T04:00:00+00:00',
        banner_url: 'https://cdn.example/cross.webp',
      },
      {
        pool_id: 'pool-version-5',
        name: '临渊望北',
        type: 'limited_character',
        start_time: '2026-07-16T04:00:00+00:00',
        end_time: '2026-08-09T04:00:00+00:00',
      },
    ]);

    expect(result.versions.map((version) => version.versionKey)).toEqual([
      'version-4',
      'version-5',
    ]);
    expect(result.versions[0].pools.map((pool) => pool.poolId)).toEqual([
      'pool-cross-version',
    ]);
    expect(result.versions[1].pools.map((pool) => pool.poolId)).toEqual([
      'pool-cross-version',
      'pool-version-5',
    ]);
    expect(result.activeVersionKey).toBe('version-5');
    expect(result.versionNumber).toBe('5');
  });
});
