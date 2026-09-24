import { describe, expect, it } from 'vitest';
import { getOfficialRerunProfile, resolveRerunPoolIdentity } from '../../shared/officialRerunPools.js';
import { prepareOfficialImportPersistenceData } from '../../src/features/import/importPersistence.js';

const characterProfile = 'reconstruction_character_v1';
const existing = {
  pool_id: 'official-existing-rerun', name: '绚丽异彩', type: 'extra',
  extra_subtype: 'reconstruction', extra_rule_profile: characterProfile,
  extra_series_key: 'reconstruction-xuesong-youmeng', extra_series_phase: 1,
  up_character: '伊冯', locked: true,
};

describe('official rerun identity across occurrences', () => {
  it('classifies by the explicit official category, including mixed weapon lists', () => {
    expect(getOfficialRerunProfile({}, { poolType: 'E_CharacterGachaPoolType_Rerun' })).toBe(characterProfile);
    expect(getOfficialRerunProfile({ poolType: 'rerun', weaponId: 'wpn_1' })).toBe('reconstruction_weapon_v1');
    expect(getOfficialRerunProfile({ poolType: 'normal', weaponId: 'wpn_1' })).toBeNull();
    expect(getOfficialRerunProfile({ poolName: '绚丽异彩#2' })).toBeNull();
  });

  it('keeps the original identity, roster contract and series for a later version', () => {
    const result = resolveRerunPoolIdentity({
      pool_id: 'new-official-id', name: '绚丽异彩#2', extra_rule_profile: characterProfile,
    }, [existing]);
    expect(result).toMatchObject(existing);
    expect(result.name).toBe('绚丽异彩');
  });

  it('does not merge weapon and character pools or choose an ambiguous catalog', () => {
    const weapon = resolveRerunPoolIdentity({ pool_id: 'weapon-rerun', name: existing.name,
      extra_rule_profile: 'reconstruction_weapon_v1' }, [existing]);
    expect(weapon.pool_id).toBe('weapon-rerun');
    expect(weapon.extra_subtype).toBe('reconstruction_claim');
    expect(() => resolveRerunPoolIdentity({ pool_id: 'third', name: existing.name,
      extra_rule_profile: characterProfile }, [existing, { ...existing, pool_id: 'second' }])).toThrow('多个同名');
  });

  it('browser persistence produces one pool and retains both record versions', async () => {
    const result = await prepareOfficialImportPersistenceData({
      pools: [existing], userInfo: { gameUid: '100', serverId: '1' },
      records: [1, 2].map((version) => ({
        poolId: `incoming-${version}`, poolName: `绚丽异彩#${version}`, poolVersion: version,
        sourcePoolType: 'E_CharacterGachaPoolType_Rerun', charId: 'chr_0001',
        charName: '伊冯', rarity: 6, seqId: String(version), gachaTs: '1790223900000',
      })),
    });
    expect(result.poolEntries).toHaveLength(1);
    expect(result.poolEntries[0]).toMatchObject({ id: existing.pool_id, name: existing.name, extra_rule_profile: characterProfile });
    expect(result.historyRecords.map((record) => record.poolId)).toEqual([existing.pool_id, existing.pool_id]);
    expect(result.historyRecords.map((record) => record.poolVersion)).toEqual([1, 2]);
    expect(result.historyRecords.map((record) => record.isStandard)).toEqual([false, false]);
  });

  it('groups versions in a fresh browser catalog without generating a synthetic ID', async () => {
    const result = await prepareOfficialImportPersistenceData({
      pools: [], userInfo: { gameUid: '100', serverId: '1' },
      records: [1, 2].map((version) => ({
        poolId: `incoming-${version}`, poolName: '点绘申领', poolVersion: version,
        sourcePoolType: 'rerun', recordType: 'weapon', weaponId: 'wpn_1',
        weaponName: '艺术暴君', rarity: 6, seqId: String(version), gachaTs: '1790223900000',
      })),
    });
    expect(result.poolEntries).toHaveLength(1);
    expect(result.poolEntries[0]).toMatchObject({ id: 'incoming-1', extra_subtype: 'reconstruction_claim' });
    expect(result.historyRecords.map((record) => record.poolId)).toEqual(['incoming-1', 'incoming-1']);
  });
});
