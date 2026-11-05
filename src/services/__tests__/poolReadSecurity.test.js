import { describe, expect, it } from 'vitest';
import { formatVisiblePoolRecord, mergePoolCollections } from '../poolReadService.js';

describe('poolReadService public fallback contract', () => {
  it('does not restore creator identity fields from direct Supabase records', () => {
    const pool = formatVisiblePoolRecord({
      pool_id: 'pool-1',
      name: 'Pool',
      type: 'limited',
      user_id: 'private-user',
      creator_username: 'private-name',
      creator_role: 'super_admin',
      banner_url: 'https://127.0.0.1/private.png',
    });

    expect(pool).toMatchObject({ id: 'pool-1', name: 'Pool', banner_url: null });
    expect(pool).not.toHaveProperty('user_id');
    expect(pool).not.toHaveProperty('creator_username');
    expect(pool).not.toHaveProperty('creator_role');
  });

  it('replaces cached manual previews when the official character and weapon pools arrive', () => {
    const character = { id: 'special_1_6_2', name: '烟火邀星河', type: 'limited', up_character: '明河', start_time: '2026-11-05T04:00:00Z' };
    const weapon = { id: 'weaponbox_1_6_2', name: '月映申领', type: 'weapon', up_character: '唤月', start_time: character.start_time };
    const preview = { ...character, id: 'special_manual_limited_pool_us8t52_20261105_14pdl0', name: '烟火邀星河（前瞻）', start_time: '2026-11-05T12:00:00+08:00' };
    const weaponPreview = { ...weapon, id: 'weaponbox_manual_weapon_pool_1bv5uc_20261105_1nb5dl' };
    const result = mergePoolCollections([character, weapon], [preview, weaponPreview]);
    expect(result.map(pool => pool.id)).toEqual(['special_1_6_2', 'weaponbox_1_6_2']);
    expect(mergePoolCollections([preview, weaponPreview], [character, weapon])).toEqual(result);
  });

  it('keeps custom pools and different runs, and does not guess between ambiguous official matches', () => {
    const pool = { id: 'special_1_6_2', type: 'limited', up_character: '明河', start_time: '2026-11-05T04:00:00Z' };
    const preview = { ...pool, id: 'special_manual_preview' };
    const custom = { ...pool, id: 'pool_custom_minghe' };
    const rerun = { ...preview, id: 'special_manual_rerun', start_time: '2027-01-01T04:00:00Z' };
    expect(mergePoolCollections([pool], [custom, rerun, preview]).map(row => row.id)).toEqual(expect.arrayContaining([pool.id, custom.id, rerun.id]));
    expect(mergePoolCollections([pool, { ...pool, id: 'special_other' }], [preview])).toHaveLength(3);
    expect(mergePoolCollections([pool], [{ ...preview, start_time: null }])).toHaveLength(2);
  });
});
