import { describe, expect, it, vi } from 'vitest';

import {
  buildOverviewTimelineSections,
  buildSinglePoolTimelineSection,
} from '../poolTimelineView.js';

vi.mock('../characterUtils.js', () => ({
  characterCache: {
    searchByName: vi.fn(() => null),
  },
}));

vi.mock('../historyInfoBook.js', () => ({
  isFreeHistoryPull: (item) => item?.isFree === true || item?.is_free === true,
  isGiftHistoryPull: (item) => item?.specialType === 'gift' || item?.special_type === 'gift',
  isInfoBookHistoryPull: () => false,
}));

vi.mock('../poolSelectorDisplay.js', () => ({
  getPoolTimingMeta: () => ({
    isTimed: true,
    isActive: true,
    isUpcoming: false,
    remainingLabel: 'active',
  }),
  normalizePoolGroupType: (pool) => pool?.type || 'standard',
}));

vi.mock('../../i18n/index.js', () => ({
  getAppLocale: () => 'zh-CN',
  isEnglishLocale: () => false,
}));

vi.mock('../gameDataI18n.js', () => ({
  localizeEntityName: (value) => value,
  localizeHistoryItemName: (item) => item?.item_name || item?.character_name || item?.name || '未知',
  localizePoolFeaturedName: (pool) => pool?.up_character || pool?.upCharacter || pool?.name || '未知',
  localizePoolName: (pool) => pool?.name || '未知卡池',
}));

describe('poolTimelineView', () => {
  it('projects individual drops with precise times and excludes gifts from pull positions and intervals', () => {
    const history = [4, 6, 6, 4, 6].map((rarity, index) => ({ id: `r${index}`, poolId: 'weapon', rarity,
      item_name: `武器${index}`, timestamp: `2026-01-01T00:00:0${index}.000Z`, seqId: String(index),
      ...(index === 2 ? { specialType: 'gift' } : {}) }));
    const section = buildSinglePoolTimelineSection({ pool: { id: 'weapon', type: 'weapon' }, history });
    expect(section.acquisitions.map(row => [row.id, row.pullIndex, row.intervalPulls])).toEqual([
      ['r4', 4, 2], ['r2', null, null], ['r1', 2, 2],
    ]);
    expect(section.acquisitions[0].timestamp).toBe(history[4].timestamp);
    expect(section.acquisitions[1].drawMethod).toBe('gift');
  });

  it('leaves unknown workbench order, intervals and timestamps unknown', () => {
    const section = buildSinglePoolTimelineSection({ pool: { id: 'limited', type: 'limited' }, history: [
      { id: 'supplement', rarity: 6, name: '角色', source: 'workbench', timestamp: null },
    ] });
    expect(section.acquisitions[0]).toMatchObject({ pullIndex: null, intervalPulls: null, timestamp: null });
  });

  it('uses weapon milestones for reconstruction weapon timelines', () => {
    const section = buildSinglePoolTimelineSection({
      pool: {
        id: 'reconstruction-weapon',
        type: 'extra',
        name: '重构申领',
        extra_rule_profile: 'reconstruction_weapon_v1',
      },
      history: [],
      locale: 'zh-CN',
    });

    expect(section.entries[0]).toMatchObject({
      isCurrentStage: true,
      targetPulls: 40,
    });
    expect(section.scaleMax).toBeGreaterThanOrEqual(40);
  });

  it('uses inherited limited pity for the first six-star milestone in single-pool timeline', () => {
    const pool = {
      id: 'pool_new',
      type: 'limited',
      name: '春雷动，万物生',
      up_character: '庄方宜',
      start_time: '2026-04-17T00:00:00.000Z',
      end_time: '2026-05-22T00:00:00.000Z',
    };
    const history = [
      { id: 'n1', poolId: 'pool_new', rarity: 4, item_name: '阿列什', timestamp: '2026-04-17T10:00:00.000Z', seqId: '1' },
      { id: 'n2', poolId: 'pool_new', rarity: 4, item_name: '陈千语', timestamp: '2026-04-17T10:01:00.000Z', seqId: '2' },
      { id: 'n3', poolId: 'pool_new', rarity: 6, item_name: '庄方宜', timestamp: '2026-04-17T10:02:00.000Z', seqId: '3', isStandard: false },
    ];
    const crossPoolPityMap = new Map([
      ['n3', { sixStarPity: 34 }],
    ]);

    const section = buildSinglePoolTimelineSection({
      pool,
      history,
      crossPoolPityMap,
      locale: 'zh-CN',
    });

    expect(section.totalPulls).toBe(3);
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0].pulls).toBe(34);
    expect(section.entries[0]).toMatchObject({ localPulls: 3, inheritedPulls: 31 });
    expect(section.avgSixStarPulls).toBe(34);
    expect(section.avgUpPulls).toBe(34);
  });

  it('applies inherited pity only to limited sections in overview timeline', () => {
    const pools = [
      {
        id: 'pool_limited',
        type: 'limited',
        name: '春雷动，万物生',
        up_character: '庄方宜',
        start_time: '2026-04-17T00:00:00.000Z',
        end_time: '2026-05-22T00:00:00.000Z',
      },
      {
        id: 'pool_standard',
        type: 'standard',
        name: '常驻寻访',
        start_time: null,
        end_time: null,
      },
    ];
    const history = [
      { id: 'l1', poolId: 'pool_limited', rarity: 4, item_name: '阿列什', timestamp: '2026-04-17T10:00:00.000Z', seqId: '1' },
      { id: 'l2', poolId: 'pool_limited', rarity: 6, item_name: '庄方宜', timestamp: '2026-04-17T10:01:00.000Z', seqId: '2', isStandard: false },
      { id: 's1', poolId: 'pool_standard', rarity: 4, item_name: '阿列什', timestamp: '2026-04-18T10:00:00.000Z', seqId: '3' },
      { id: 's2', poolId: 'pool_standard', rarity: 6, item_name: '常驻角色', timestamp: '2026-04-18T10:01:00.000Z', seqId: '4', isStandard: true },
    ];
    const crossPoolPityMap = new Map([
      ['l2', { sixStarPity: 31 }],
    ]);

    const sections = buildOverviewTimelineSections({
      pools,
      history,
      crossPoolPityMap,
      locale: 'zh-CN',
    });

    const limitedSection = sections.find((section) => section.id === 'pool_limited');
    const standardSection = sections.find((section) => section.id === 'pool_standard');

    expect(limitedSection.entries[0].pulls).toBe(31);
    expect(limitedSection.avgSixStarPulls).toBe(31);
    expect(standardSection.entries[0].pulls).toBe(2);
    expect(standardSection.avgSixStarPulls).toBe(2);
  });

  it('supports numeric history ids with string-based inherited pity keys', () => {
    const pools = [
      {
        id: 'pool_prev',
        type: 'limited',
        name: '河流的女儿',
        up_character: '汤汤',
        start_time: '2026-03-12T00:00:00.000Z',
        end_time: '2026-03-29T00:00:00.000Z',
      },
      {
        id: 'pool_next',
        type: 'limited',
        name: '狼珀',
        up_character: '洛茜',
        start_time: '2026-03-29T00:00:00.000Z',
        end_time: '2026-04-17T00:00:00.000Z',
      },
    ];
    const history = [
      { id: 1001, poolId: 'pool_prev', rarity: 4, item_name: 'A', timestamp: '2026-03-12T10:00:00.000Z', seqId: '1' },
      { id: 1002, poolId: 'pool_prev', rarity: 4, item_name: 'B', timestamp: '2026-03-12T10:01:00.000Z', seqId: '2' },
      { id: 1003, poolId: 'pool_next', rarity: 6, item_name: '艾尔黛拉', timestamp: '2026-03-29T10:02:00.000Z', seqId: '3', isStandard: true },
    ];

    const sections = buildOverviewTimelineSections({
      pools,
      history,
      crossPoolPityMap: new Map([
        ['1003', { sixStarPity: 78 }],
      ]),
      locale: 'zh-CN',
    });

    const nextSection = sections.find((section) => section.id === 'pool_next');
    expect(nextSection.entries[0].pulls).toBe(78);
    expect(nextSection.avgSixStarPulls).toBe(78);
  });

  it('hides current progress stage after beginner banner reaches 40 paid pulls', () => {
    const pool = {
      id: 'pool_beginner',
      type: 'beginner',
      name: '启程寻访',
      start_time: null,
      end_time: null,
    };
    const history = Array.from({ length: 40 }, (_, index) => ({
      id: `b${index + 1}`,
      poolId: 'pool_beginner',
      rarity: 4,
      item_name: `角色${index + 1}`,
      timestamp: `2026-01-01T00:${String(index).padStart(2, '0')}:00.000Z`,
      seqId: String(index + 1),
    }));

    const section = buildSinglePoolTimelineSection({
      pool,
      history,
      locale: 'zh-CN',
    });

    expect(section.totalPulls).toBe(40);
    expect(section.entries.some((entry) => entry.isCurrentStage)).toBe(false);
  });

  it('excludes limited guarantee hits from timeline win rate while keeping counts', () => {
    const pool = {
      id: 'pool_limited',
      type: 'limited',
      name: '限定寻访',
      up_character: '当期UP',
      start_time: '2026-04-17T00:00:00.000Z',
      end_time: '2026-05-22T00:00:00.000Z',
    };
    const history = [
      { id: 'l1', poolId: 'pool_limited', rarity: 6, item_name: '当期UP', timestamp: '2026-04-17T10:00:00.000Z', seqId: '1', isStandard: false },
      { id: 'l2', poolId: 'pool_limited', rarity: 6, item_name: '保底UP', timestamp: '2026-04-17T10:01:00.000Z', seqId: '2', isStandard: false, specialType: 'guaranteed' },
      { id: 'l3', poolId: 'pool_limited', rarity: 6, item_name: '常驻角色', timestamp: '2026-04-17T10:02:00.000Z', seqId: '3', isStandard: true },
    ];

    const section = buildSinglePoolTimelineSection({
      pool,
      history,
      locale: 'zh-CN',
    });

    expect(section.sixStarCount).toBe(3);
    expect(section.upSixStarCount).toBe(2);
    expect(section.winRate).toBe(50);
    expect(section.entries.find((entry) => entry.sourceRecordKeys.includes('l2')).guaranteePulls).toBe(120);
  });

  it('marks the first target at 120 paid pulls without confusing the six-star interval or free pulls', () => {
    const pool = { id: 'limited', type: 'limited', name: '限定寻访', up_character: '当期UP' };
    const start = Date.parse('2026-04-17T10:00:00Z');
    const paidHistory = Array.from({ length: 120 }, (_, index) => ({
      id: `paid-${index + 1}`, poolId: pool.id, seqId: String(index + 1), timestamp: start + index * 1000,
      rarity: index === 69 || index === 119 ? 6 : 4,
      item_name: index === 119 ? '当期UP' : '常驻角色', isStandard: index !== 119,
    }));
    const freeHistory = Array.from({ length: 10 }, (_, index) => ({
      id: `free-${index + 1}`, poolId: pool.id, timestamp: start + 20500 + index,
      rarity: index === 9 ? 6 : 4, item_name: '当期UP', isStandard: false, isFree: true,
    }));
    const section = buildSinglePoolTimelineSection({ pool, history: [...paidHistory, ...freeHistory] });
    const guaranteed = section.entries.find((entry) => entry.sourceRecordKeys.includes('paid-120'));
    const previous = section.entries.find((entry) => entry.sourceRecordKeys.includes('paid-70'));

    expect(guaranteed).toMatchObject({ guaranteePulls: 120, pulls: 50, inheritedPulls: 0 });
    expect(previous.guaranteePulls).toBeNull();
    expect(section.entries.find((entry) => entry.stageKind === 'gift').guaranteePulls).toBeUndefined();
    expect(section.totalPulls).toBe(120);

    paidHistory[59] = { ...paidHistory[59], rarity: 6, item_name: '当期UP', isStandard: false };
    const earlyTarget = buildSinglePoolTimelineSection({ pool, history: paidHistory });
    expect(earlyTarget.entries.every((entry) => !entry.guaranteePulls)).toBe(true);
  });

  it('does not attribute later six-star milestones to the previous banner', () => {
    const pool = { id: 'limited', type: 'limited', up_character: '当期UP' };
    const history = [
      { id: 'first', poolId: pool.id, rarity: 6, item_name: '当期UP', timestamp: 1776420000000 },
      { id: 'second', poolId: pool.id, rarity: 6, item_name: '当期UP', timestamp: 1776420010000 },
    ];
    const section = buildSinglePoolTimelineSection({
      pool, history, crossPoolPityMap: new Map([
        ['first', { sixStarPity: 21 }], ['second', { sixStarPity: 1 }],
      ]),
    });
    expect(section.entries.find((entry) => entry.sourceRecordKeys.includes('first')).inheritedPulls).toBe(20);
    expect(section.entries.find((entry) => entry.sourceRecordKeys.includes('second')).inheritedPulls).toBe(0);
  });

  it('keeps an entire weapon ten-pull together, including drops after a six-star, without changing intervals', () => {
    const pool = { id: 'weapon', type: 'weapon', up_character: '当期武器' };
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `weapon-${index + 1}`, poolId: pool.id, seqId: String(index + 1),
      timestamp: 1776420000000 + Math.floor(index / 10) * 10000,
      batchId: `weapon-ten-${Math.floor(index / 10)}`,
      rarity: [13, 18].includes(index) ? 6 : [10, 15, 19].includes(index) ? 5 : 4,
      item_name: `武器${index + 1}`, isStandard: index !== 18,
    }));
    const section = buildSinglePoolTimelineSection({ pool, history });
    const milestones = section.entries.filter((entry) => entry.highestRarity >= 6);
    expect(milestones.map((entry) => entry.pulls)).toEqual([5, 14]);
    expect(milestones[0].weaponBatch).toEqual(milestones[1].weaponBatch);
    expect(milestones[0].weaponBatch).toMatchObject({
      size: 10, isCompleteTenPull: true, sixStarCount: 2, fiveStarCount: 3,
    });
    expect(milestones[0].weaponBatch.slots.map((slot) => slot.rarity)).toEqual([5, 4, 4, 6, 4, 5, 4, 4, 6, 5]);
    expect(section.entries[0]).toMatchObject({ isCurrentStage: true, pulls: 1 });
    expect(section.entries[0].weaponBatch).toBeUndefined();
  });

  it('shows the latest weapon ten-pull even if it contains no six-star, and labels partial batches honestly', () => {
    const pool = { id: 'weapon', type: 'weapon' };
    const history = Array.from({ length: 10 }, (_, index) => ({
      id: `weapon-${index + 1}`, poolId: pool.id, seqId: String(index + 1),
      timestamp: 1776420000000, rarity: index === 9 ? 5 : 4, item_name: '武器',
    }));
    const complete = buildSinglePoolTimelineSection({ pool, history });
    expect(complete.entries[0].weaponBatch).toMatchObject({
      size: 10, isCompleteTenPull: true, sixStarCount: 0, fiveStarCount: 1,
    });
    const partial = buildSinglePoolTimelineSection({ pool, history: history.slice(4) });
    expect(partial.entries[0].weaponBatch).toMatchObject({ size: 6, isCompleteTenPull: false });
  });

  it('annotates adjacent six-star milestones from the same ten-pull batch', () => {
    const pool = {
      id: 'pool_weapon',
      type: 'weapon',
      name: '行舟申领',
      up_character: '孤舟',
      start_time: '2026-04-17T00:00:00.000Z',
      end_time: '2026-06-07T00:00:00.000Z',
    };
    const history = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `w${index + 1}`,
        poolId: 'pool_weapon',
        rarity: 4,
        item_name: `武器${index + 1}`,
        timestamp: '2026-04-17T10:00:00.000Z',
        batchId: 'batch_same_ten',
        seqId: String(index + 1),
      })),
      {
        id: 'w9',
        poolId: 'pool_weapon',
        rarity: 6,
        item_name: '遗忘',
        timestamp: '2026-04-17T10:00:00.000Z',
        batchId: 'batch_same_ten',
        seqId: '9',
        isStandard: true,
      },
      {
        id: 'w10',
        poolId: 'pool_weapon',
        rarity: 6,
        item_name: '孤舟',
        timestamp: '2026-04-17T10:00:00.000Z',
        batchId: 'batch_same_ten',
        seqId: '10',
        isStandard: false,
      },
    ];

    const section = buildSinglePoolTimelineSection({
      pool,
      history,
      locale: 'zh-CN',
    });
    const sixStarEntries = section.entries.filter((entry) => Number(entry.highestRarity) >= 6);

    expect(sixStarEntries).toHaveLength(2);
    expect(new Set(sixStarEntries.map((entry) => entry.multiDropBatchKey))).toEqual(new Set(['batch:batch_same_ten']));
  });

});
