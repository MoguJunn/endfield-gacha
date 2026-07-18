// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  normalizeOfficialImportRecord,
  summarizeOfficialImportIssues,
} from '../../shared/officialImportRecordNormalizer.js';

describe('officialImportRecordNormalizer', () => {
  it('normalizes legacy character fields', () => {
    const result = normalizeOfficialImportRecord({
      charId: 'chr_0001_demo',
      charName: '测试干员',
      rarity: 6,
      poolId: 'special_demo',
      poolName: '测试寻访',
      seqId: '12',
      gachaTs: '1780000000000',
    }, {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
      type: 'character',
    });

    expect(result).toMatchObject({
      itemId: 'chr_0001_demo',
      itemName: '测试干员',
      itemType: 'character',
      quality: 6,
      poolId: 'special_demo',
      seqId: '12',
      gameUid: '10001',
      serverId: '1',
      reviewRequired: false,
      blocked: false,
    });
  });

  it('normalizes new generic item fields without falling back to unknown rarity', () => {
    const result = normalizeOfficialImportRecord({
      itemId: 'wpn_demo',
      itemName: '测试武器',
      itemType: 'weapon',
      quality: 5,
      is_info_book: true,
      poolId: 'weponbox_demo',
      seqId: '7',
      gachaTs: 1780000000,
    }, {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
    });

    expect(result).toMatchObject({
      itemId: 'wpn_demo',
      itemName: '测试武器',
      itemType: 'weapon',
      quality: 5,
      isInfoBook: true,
      reviewRequired: false,
      blocked: false,
    });
  });

  it('blocks records without an official sequence id', () => {
    const result = normalizeOfficialImportRecord({
      itemId: 'chr_demo',
      itemName: '测试干员',
      quality: 5,
      poolId: 'special_demo',
      gachaTs: 1780000000000,
    }, {
      gameUid: '10001',
      serverId: '1',
    });

    expect(result.blocked).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain('MISSING_SEQ_ID');
  });

  it('blocks missing item identity and quality instead of creating unknown four-star data', () => {
    const result = normalizeOfficialImportRecord({
      poolId: 'special_1_4_1',
      seqId: '1026',
      gachaTs: 1784173217803,
    }, {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
    });

    expect(result.itemName).toBeNull();
    expect(result.quality).toBeNull();
    expect(result.blocked).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'MISSING_ITEM_ID_AND_NAME',
      'MISSING_QUALITY',
    ]));
  });

  it('summarizes blocking and review issues for the review screen', () => {
    const records = [
      normalizeOfficialImportRecord({
        itemId: 'chr_demo',
        itemName: '测试干员',
        quality: 4,
        poolId: 'special_demo',
        seqId: '1',
        gachaTs: 1780000000000,
      }, { gameUid: '10001' }),
      normalizeOfficialImportRecord({
        poolId: 'special_demo',
        gachaTs: 1780000000000,
      }, { gameUid: '10001', serverId: '1' }),
    ];

    expect(summarizeOfficialImportIssues(records)).toMatchObject({
      totalRecords: 2,
      issueRecords: 2,
      blockingRecords: 1,
    });
  });
});
