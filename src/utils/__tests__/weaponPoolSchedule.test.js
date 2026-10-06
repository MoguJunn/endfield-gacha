import { describe, expect, it } from 'vitest';
import { identifyWeaponCharacterPool, resolveWeaponPoolSchedule } from '../../../shared/weaponPoolSchedule.js';
import { buildPoolDataFromForm } from '../../hooks/admin/usePools.js';

const pools = [
  { pool_id: 'a', name: '第一期', type: 'limited', start_time: '2026-10-15T12:00:00+08:00', end_time: '2026-11-05T11:59:00+08:00' },
  { pool_id: 'b', name: '第二期', type: 'limited', start_time: '2026-11-05T12:00:00+08:00', end_time: '2026-11-26T12:00:00+08:00' },
  { pool_id: 'c', name: '第三期', type: 'limited', start_time: '2026-11-26T12:00:00+08:00', end_time: '2026-12-17T06:00:00+08:00' },
  { pool_id: 'rerun', type: 'extra', start_time: '2026-10-29T12:00:00+08:00', end_time: '2026-11-19T12:00:00+08:00' },
];

describe('限定武器池三期时间', () => {
  it('按同期或正在开启的限定角色池识别，复刻不占期次', () => {
    const weapon = { start_time: '2026-10-15T11:00:00+08:00' };
    expect(identifyWeaponCharacterPool(weapon, pools)).toBe('a');
    expect(identifyWeaponCharacterPool({ start_time: '2026-10-29T12:00:00+08:00' }, pools)).toBe('a');
    expect(resolveWeaponPoolSchedule(weapon, pools)).toMatchObject({ characterPoolId: 'a', endsAt: pools[2].end_time, estimated: false });
  });

  it('手动关联优先，缺少后续期次按 21 天估算', () => {
    expect(resolveWeaponPoolSchedule({ character_pool_id: 'b' }, pools.slice(0, 2))).toMatchObject({ endsAt: '2027-01-07T04:00:00.000Z', estimated: true });
    expect(resolveWeaponPoolSchedule({ character_pool_id: 'missing' }, pools).endsAt).toBeNull();
    expect(identifyWeaponCharacterPool({ start_time: '' }, pools)).toBeNull();
  });

  it('保存自动或手动关联但不自动改写人工截止时间，常驻与非武器池清空关联', () => {
    const form = { name: '武器池', type: 'weapon', is_limited_weapon: true, start_time: pools[0].start_time, end_time: '2026-12-20T12:00:00+08:00' };
    expect(buildPoolDataFromForm(form, pools).poolData).toMatchObject({ character_pool_id: 'a', end_time: '2026-12-20T04:00:00.000Z' });
    expect(buildPoolDataFromForm({ ...form, character_pool_id: 'b' }, pools).poolData.character_pool_id).toBe('b');
    expect(buildPoolDataFromForm({ ...form, character_pool_id: 'b', is_limited_weapon: false }, pools).poolData.character_pool_id).toBeNull();
    expect(buildPoolDataFromForm({ ...form, character_pool_id: 'b', type: 'limited' }, pools).poolData.character_pool_id).toBeNull();
  });
});
