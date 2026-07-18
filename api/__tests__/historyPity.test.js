// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  calculateHistoryPity,
  historyRecordCountsTowardPity,
} from '../../shared/historyPity.js';

describe('history pity rules', () => {
  it('excludes free, info-book, and gift records without resetting charged pity', () => {
    const result = calculateHistoryPity([
      { seqId: '1', timestamp: 1_780_000_000_000, rarity: 4 },
      { seqId: '2', timestamp: 1_780_000_001_000, rarity: 6, isFree: true },
      { seqId: '3', timestamp: 1_780_000_002_000, rarity: 6, isInfoBook: true },
      { seqId: '4', timestamp: 1_780_000_003_000, rarity: 6, specialType: 'gift' },
      { seqId: '5', timestamp: 1_780_000_004_000, rarity: 5 },
      { seqId: '6', timestamp: 1_780_000_005_000, rarity: 6 },
      { seqId: '7', timestamp: 1_780_000_006_000, rarity: 4 },
    ]);

    expect(result.map((record) => record.pity)).toEqual([1, 1, 1, 1, 2, 3, 1]);
  });

  it('recognizes snake-case persistence fields', () => {
    expect(historyRecordCountsTowardPity({ is_free: true })).toBe(false);
    expect(historyRecordCountsTowardPity({ is_info_book: true })).toBe(false);
    expect(historyRecordCountsTowardPity({ special_type: 'gift' })).toBe(false);
    expect(historyRecordCountsTowardPity({ special_type: 'guaranteed' })).toBe(true);
  });

  it('orders large numeric sequence ids without number precision loss', () => {
    const result = calculateHistoryPity([
      { seqId: '9007199254740993', timestamp: 1_780_000_000_000, rarity: 4 },
      { seqId: '9007199254740992', timestamp: 1_780_000_000_000, rarity: 4 },
    ]);

    expect(result.map((record) => record.seqId)).toEqual([
      '9007199254740992',
      '9007199254740993',
    ]);
    expect(result.map((record) => record.pity)).toEqual([1, 2]);
  });
});
