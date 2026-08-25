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
