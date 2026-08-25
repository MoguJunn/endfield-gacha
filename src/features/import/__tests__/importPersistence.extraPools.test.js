import { describe, expect, it } from 'vitest';

import { prepareOfficialImportPersistenceData } from '../importPersistence.js';

function createOfficialRecord(poolId, seqId) {
  return {
    poolId,
    poolName: `卡池 ${poolId}`,
    seqId,
    charId: `char_${seqId}`,
    charName: `角色 ${seqId}`,
    rarity: 6,
    gachaTs: '1767225600000',
  };
}

describe('importPersistence extra pool metadata', () => {
  it('classifies only joint_1_2_2 and leaves unknown Joint pools unclassified', async () => {
    const result = await prepareOfficialImportPersistenceData({
      records: [
        createOfficialRecord('joint_1_2_2', '1'),
        createOfficialRecord('joint_9_9_9', '2'),
      ],
      userInfo: { gameUid: '10000001', serverId: '1' },
      pools: [],
    });

    expect(result.poolEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'joint_1_2_2',
        type: 'extra',
        extra_subtype: 'special',
        extra_rule_profile: 'brilliance_festival_v1',
        extra_series_key: null,
        extra_series_phase: null,
      }),
      expect.objectContaining({
        id: 'joint_9_9_9',
        type: 'extra',
        extra_subtype: null,
        extra_rule_profile: null,
        extra_series_key: null,
        extra_series_phase: null,
      }),
    ]));
  });

  it('preserves the existing canonical directory classification after alias resolution', async () => {
    const result = await prepareOfficialImportPersistenceData({
      records: [createOfficialRecord('joint_9_9_9', '3')],
      userInfo: { gameUid: '10000001', serverId: '1' },
      pools: [{
        id: 'manual_reconstruction_pool',
        type: 'extra',
        extra_subtype: 'reconstruction',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'canonical-reconstruction',
        extra_series_phase: 4,
      }],
      poolAliasMap: {
        joint_9_9_9: 'manual_reconstruction_pool',
      },
    });

    expect(result.poolEntries).toEqual([
      expect.objectContaining({
        id: 'manual_reconstruction_pool',
        type: 'extra',
        extra_subtype: 'reconstruction',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'canonical-reconstruction',
        extra_series_phase: 4,
      }),
    ]);
  });

  it('canonicalizes an existing legacy reconstruction weapon tuple', async () => {
    const result = await prepareOfficialImportPersistenceData({
      records: [createOfficialRecord('reclaim_9_0_2', '4')],
      userInfo: { gameUid: '10000001', serverId: '1' },
      pools: [{
        id: 'reclaim_9_0_2',
        type: 'extra',
        extra_subtype: 'reconstruction',
        extra_rule_profile: 'reconstruction_weapon_v1',
        extra_series_key: 'canonical-claim',
        extra_series_phase: 2,
      }],
    });

    expect(result.poolEntries).toEqual([
      expect.objectContaining({
        id: 'reclaim_9_0_2',
        extra_subtype: 'reconstruction_claim',
        extra_rule_profile: 'reconstruction_weapon_v1',
      }),
    ]);
  });
});
