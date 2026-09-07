import { describe, expect, it } from 'vitest';
import {
  getDataFormatById,
  prepareImportPayload,
} from '../dataFormatRegistry.js';
import {
  getPoolIdCandidate,
  isReservedPoolTypeId,
} from '../../../shared/poolIdValidation.js';

describe('pool id validation', () => {
  it('distinguishes pool type sentinels from official pool ids', () => {
    expect(isReservedPoolTypeId(' limited_character ')).toBe(true);
    expect(isReservedPoolTypeId('limited_weapon')).toBe(true);
    expect(isReservedPoolTypeId('special_1_5_1')).toBe(false);
    expect(isReservedPoolTypeId('standard')).toBe(false);
    expect(isReservedPoolTypeId('beginner')).toBe(false);
    expect(getPoolIdCandidate({ pool_id: 'special_1_5_1' })).toBe('special_1_5_1');
  });

  it('does not promote a legacy pool type field into a pool id', () => {
    const payload = prepareImportPayload({
      accounts: [],
      records: [{
        recordUid: 'record-1',
        uid: '1:game-1',
        category: 'character',
        pool: 'limited_character',
        charId: 'chr_0001',
        charName: '测试角色',
        rarity: 4,
        gachaTs: '1778260000000',
        seqId: '1',
      }],
      weaponRecords: [],
    }, getDataFormatById('endfield_gacha_helper_json'));

    expect(payload.pools).toEqual([]);
    expect(payload.history[0]).toMatchObject({
      poolId: null,
      pool_id: null,
    });
  });
});
