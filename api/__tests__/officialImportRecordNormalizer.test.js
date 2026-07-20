// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  filterOfficialImportPullRecords,
  getOfficialImportRecordKind,
  hasActionableImportIdentityIssues,
  hasWriteBlockingImportIssues,
  isOfficialImportNonPullRecord,
  normalizeOfficialImportRecord,
  summarizeOfficialImportIssues,
} from '../../shared/officialImportRecordNormalizer.js';

describe('officialImportRecordNormalizer', () => {
  it('normalizes legacy character fields', () => {
    const result = normalizeOfficialImportRecord(
      {
      charId: 'chr_0001_demo',
      charName: '测试干员',
      rarity: 6,
      poolId: 'special_demo',
      poolName: '测试寻访',
      seqId: '12',
      gachaTs: '1780000000000',
      },
      {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
      type: 'character',
      }
    );

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
    const result = normalizeOfficialImportRecord(
      {
      itemId: 'wpn_demo',
      itemName: '测试武器',
      itemType: 'weapon',
      quality: 5,
      is_info_book: true,
      poolId: 'weponbox_demo',
      seqId: '7',
      gachaTs: 1780000000,
      },
      {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
      }
    );

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

  it('filters the official info-book gift marker while preserving the ten real draws', () => {
    const timestamp = '1780000000000';
    const records = [
      ...Array.from({ length: 10 }, (_, index) => ({
        kind: 'draw',
        nameText: '角色寻访',
        poolId: 'special_demo',
        poolName: '测试限定池',
        seqId: String(index + 1),
        charId: `char_${index + 1}`,
        charName: `测试角色${index + 1}`,
        rarity: index === 9 ? 5 : 4,
        gachaTs: timestamp,
      })),
      {
        kind: 'gift_intel_book',
        nameText: '寻访情报书',
        poolId: 'special_demo',
        poolName: '测试限定池',
        seqId: '11',
        gachaTs: timestamp,
      },
    ];

    expect(getOfficialImportRecordKind(records[10])).toBe('gift_intel_book');
    expect(isOfficialImportNonPullRecord(records[10])).toBe(true);
    expect(filterOfficialImportPullRecords(records)).toHaveLength(10);
    expect(filterOfficialImportPullRecords(records).every((record) => record.kind === 'draw')).toBe(true);
  });

  it('blocks records without an official sequence id', () => {
    const result = normalizeOfficialImportRecord(
      {
      itemId: 'chr_demo',
      itemName: '测试干员',
      quality: 5,
      poolId: 'special_demo',
      gachaTs: 1780000000000,
      },
      {
      gameUid: '10001',
      serverId: '1',
      }
    );

    expect(result.blocked).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain('MISSING_SEQ_ID');
  });

  it('keeps an identifiable scope available for post-import anomaly handling', () => {
    const result = normalizeOfficialImportRecord(
      {
      poolId: 'special_1_4_1',
      seqId: '1026',
      gachaTs: 1784173217803,
      },
      {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
      }
    );

    expect(result.itemName).toBeNull();
    expect(result.quality).toBeNull();
    expect(result.blocked).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MISSING_ITEM_ID_AND_NAME', 'MISSING_QUALITY'])
    );
    expect(hasActionableImportIdentityIssues(result.issues)).toBe(true);
    expect(hasWriteBlockingImportIssues(result.issues)).toBe(false);
  });

  it('still blocks records whose account scope cannot be safely located', () => {
    const result = normalizeOfficialImportRecord(
      {
      seqId: '1026',
      gachaTs: 1784173217803,
      },
      {
      gameUid: '10001',
      serverId: '1',
      region: 'cn',
      }
    );

    expect(hasActionableImportIdentityIssues(result.issues)).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain('MISSING_POOL_ID');
    expect(hasWriteBlockingImportIssues(result.issues)).toBe(true);
  });

  it('summarizes blocking and review issues for the review screen', () => {
    const records = [
      normalizeOfficialImportRecord(
        {
        itemId: 'chr_demo',
        itemName: '测试干员',
        quality: 4,
        poolId: 'special_demo',
        seqId: '1',
        gachaTs: 1780000000000,
        },
        { gameUid: '10001' }
      ),
      normalizeOfficialImportRecord(
        {
        poolId: 'special_demo',
        gachaTs: 1780000000000,
        },
        { gameUid: '10001', serverId: '1' }
      ),
    ];

    expect(summarizeOfficialImportIssues(records)).toMatchObject({
      totalRecords: 2,
      issueRecords: 2,
      blockingRecords: 1,
    });
  });
});
