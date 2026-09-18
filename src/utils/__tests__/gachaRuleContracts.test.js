import { describe, expect, it } from 'vitest';

import {
  calculateAveragePullCost,
  calculateTargetWinRate,
  collectForcedUpRecordKeysFromTimeline,
  getForcedUpFloor,
  isFreeHistoryRecord,
  isGiftHistoryRecord,
  isManuallyMarkedGuaranteedRecord,
  isNewHistoryRecord,
  isPaidHistoryRecord,
} from '../gachaRuleContracts.js';
import { EXTRA_POOL_RULES, LIMITED_POOL_RULES, STANDARD_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';

function makePull(index, overrides = {}) {
  return {
    id: `pull-${index}`,
    rarity: 4,
    ...overrides,
  };
}

describe('getForcedUpFloor', () => {
  it('限定角色池硬保底起始为第 120 付费抽', () => {
    expect(getForcedUpFloor(LIMITED_POOL_RULES)).toBe(120);
  });

  it('武器池按第 8 次申领起始抽（71）判定', () => {
    expect(getForcedUpFloor(WEAPON_POOL_RULES)).toBe(71);
  });

  it('无一次性硬保底的池型返回 Infinity', () => {
    expect(getForcedUpFloor(EXTRA_POOL_RULES)).toBe(Infinity);
    expect(getForcedUpFloor(STANDARD_POOL_RULES)).toBe(Infinity);
    expect(getForcedUpFloor(null)).toBe(Infinity);
    expect(getForcedUpFloor({})).toBe(Infinity);
  });
});

describe('记录分类', () => {
  it('赠送记录兼容两种字段写法', () => {
    expect(isGiftHistoryRecord({ specialType: 'gift' })).toBe(true);
    expect(isGiftHistoryRecord({ special_type: 'gift' })).toBe(true);
    expect(isGiftHistoryRecord({ specialType: 'guaranteed' })).toBe(false);
    expect(isGiftHistoryRecord({})).toBe(false);
  });

  it('免费记录兼容全部四种字段写法', () => {
    expect(isFreeHistoryRecord({ isFree: true })).toBe(true);
    expect(isFreeHistoryRecord({ is_free: true })).toBe(true);
    expect(isFreeHistoryRecord({ isFreePull: true })).toBe(true);
    expect(isFreeHistoryRecord({ is_free_pull: true })).toBe(true);
    expect(isFreeHistoryRecord({ isFree: false })).toBe(false);
    expect(isFreeHistoryRecord({})).toBe(false);
  });

  it('付费记录排除赠送与免费', () => {
    expect(isPaidHistoryRecord({})).toBe(true);
    expect(isPaidHistoryRecord({ specialType: 'gift' })).toBe(false);
    expect(isPaidHistoryRecord({ isFreePull: true })).toBe(false);
  });

  it('手工保底标记兼容五种字段写法', () => {
    expect(isManuallyMarkedGuaranteedRecord({ specialType: 'guaranteed' })).toBe(true);
    expect(isManuallyMarkedGuaranteedRecord({ special_type: 'guaranteed' })).toBe(true);
    expect(isManuallyMarkedGuaranteedRecord({ isGuaranteed: true })).toBe(true);
    expect(isManuallyMarkedGuaranteedRecord({ is_guaranteed: true })).toBe(true);
    expect(isManuallyMarkedGuaranteedRecord({ isSpark: true })).toBe(true);
    expect(isManuallyMarkedGuaranteedRecord({ is_spark: true })).toBe(true);
    expect(isManuallyMarkedGuaranteedRecord({})).toBe(false);
  });

  it('首次获得标记兼容两种字段写法', () => {
    expect(isNewHistoryRecord({ isNew: true })).toBe(true);
    expect(isNewHistoryRecord({ is_new: true })).toBe(true);
    expect(isNewHistoryRecord({ isNew: false })).toBe(false);
    expect(isNewHistoryRecord({})).toBe(false);
  });
});

describe('collectForcedUpRecordKeysFromTimeline', () => {
  const isTarget = (record) => record.isTarget === true;

  it('限定池第 120 付费抽首次命中目标标记为吃井', () => {
    const timeline = Array.from({ length: 120 }, (_, index) => makePull(index + 1));
    timeline[119] = { ...timeline[119], rarity: 6, isTarget: true };
    const keys = collectForcedUpRecordKeysFromTimeline(timeline, { floor: 120, isTargetRecord: isTarget });
    expect([...keys]).toEqual(['pull-120']);
  });

  it('限定池第 119 抽自然命中不标记', () => {
    const timeline = Array.from({ length: 120 }, (_, index) => makePull(index + 1));
    timeline[118] = { ...timeline[118], rarity: 6, isTarget: true };
    const keys = collectForcedUpRecordKeysFromTimeline(timeline, { floor: 120, isTargetRecord: isTarget });
    expect(keys.size).toBe(0);
  });

  it('首个目标自然命中后，后续达阈值命中不再标记（回归：避免过度剔除）', () => {
    const timeline = Array.from({ length: 130 }, (_, index) => makePull(index + 1));
    timeline[49] = { ...timeline[49], rarity: 6, isTarget: true };
    timeline[119] = { ...timeline[119], rarity: 6, isTarget: true };
    timeline[124] = { ...timeline[124], rarity: 6, isTarget: true };
    const keys = collectForcedUpRecordKeysFromTimeline(timeline, { floor: 120, isTargetRecord: isTarget });
    expect(keys.size).toBe(0);
  });

  it('武器池第 71~80 付费抽区间内的首次目标命中均标记为吃井', () => {
    for (const hitAt of [71, 75, 80]) {
      const timeline = Array.from({ length: hitAt }, (_, index) => makePull(index + 1));
      timeline[hitAt - 1] = { ...timeline[hitAt - 1], rarity: 6, isTarget: true };
      const keys = collectForcedUpRecordKeysFromTimeline(timeline, { floor: 71, isTargetRecord: isTarget });
      expect([...keys]).toEqual([`pull-${hitAt}`]);
    }
  });

  it('武器池第 70 抽自然命中不标记', () => {
    const timeline = Array.from({ length: 71 }, (_, index) => makePull(index + 1));
    timeline[69] = { ...timeline[69], rarity: 6, isTarget: true };
    const keys = collectForcedUpRecordKeysFromTimeline(timeline, { floor: 71, isTargetRecord: isTarget });
    expect(keys.size).toBe(0);
  });

  it('非 6 星命中不影响判定，6 星非目标命中不结束本期', () => {
    const timeline = Array.from({ length: 125 }, (_, index) => makePull(index + 1));
    timeline[59] = { ...timeline[59], rarity: 6, isTarget: false };
    timeline[124] = { ...timeline[124], rarity: 6, isTarget: true };
    const keys = collectForcedUpRecordKeysFromTimeline(timeline, { floor: 120, isTargetRecord: isTarget });
    expect([...keys]).toEqual(['pull-125']);
  });

  it('无硬保底池型直接返回空集', () => {
    const timeline = [makePull(1, { rarity: 6, isTarget: true })];
    expect(collectForcedUpRecordKeysFromTimeline(timeline, { floor: Infinity, isTargetRecord: isTarget }).size).toBe(0);
    expect(collectForcedUpRecordKeysFromTimeline(timeline, { floor: 0, isTargetRecord: isTarget }).size).toBe(0);
    expect(collectForcedUpRecordKeysFromTimeline(null, { floor: 120, isTargetRecord: isTarget }).size).toBe(0);
  });
});

describe('calculateTargetWinRate', () => {
  it('剔除吃井后按真 50/50 口径计算', () => {
    expect(calculateTargetWinRate({ targetCount: 5, sixStarCount: 10, sparkCount: 2 })).toBeCloseTo(37.5);
  });

  it('spark 缺失时退化为原始比值', () => {
    expect(calculateTargetWinRate({ targetCount: 3, sixStarCount: 10 })).toBeCloseTo(30);
  });

  it('spark 超过目标数时不产生负值', () => {
    expect(calculateTargetWinRate({ targetCount: 1, sixStarCount: 10, sparkCount: 5 })).toBe(0);
  });

  it('剔除后分母为 0 时返回 0', () => {
    expect(calculateTargetWinRate({ targetCount: 2, sixStarCount: 2, sparkCount: 2 })).toBe(0);
    expect(calculateTargetWinRate({ targetCount: 0, sixStarCount: 0 })).toBe(0);
  });
});

describe('calculateAveragePullCost', () => {
  it('统一为总抽数除以命中数', () => {
    expect(calculateAveragePullCost(300, 10)).toBe('30.00');
  });

  it('命中数为 0 时返回 null', () => {
    expect(calculateAveragePullCost(300, 0)).toBeNull();
    expect(calculateAveragePullCost(0, 0)).toBeNull();
  });
});
