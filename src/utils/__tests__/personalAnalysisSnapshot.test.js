import { describe, expect, it } from 'vitest';
import {
  buildCrossPoolPityMap,
  buildPersonalAnalysisSnapshots,
  createSnapshotCharacterResolver
} from '../personalAnalysisSnapshot.js';
import { buildSummaryStats } from '../summaryStats.js';

const USER_ID = 'user-1';

function createPull({
  id,
  userId = USER_ID,
  gameUid = 'game-1',
  serverId = '1',
  poolId = 'standard-main',
  rarity = 4,
  timestamp = '2026-01-01T00:00:00.000Z',
  ...overrides
}) {
  return {
    id,
    user_id: userId,
    game_uid: gameUid,
    server_id: serverId,
    pool_id: poolId,
    rarity,
    timestamp,
    character_name: overrides.character_name || `角色-${id}`,
    ...overrides
  };
}

function assertNoMapOrSet(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeInstanceOf(Set);
  seen.add(value);
  Object.values(value).forEach((item) => assertNoMapOrSet(item, seen));
}

describe('buildPersonalAnalysisSnapshots', () => {
  it('只处理目标用户，并按记录数选择默认账号', () => {
    const history = [
      createPull({ id: 'mine-1' }),
      createPull({ id: 'mine-2', timestamp: '2026-01-02T00:00:00.000Z' }),
      createPull({ id: 'other', userId: 'user-2', gameUid: 'other-game' })
    ];

    const result = buildPersonalAnalysisSnapshots({
      history,
      pools: [{ id: 'standard-main', type: 'standard' }],
      userId: USER_ID
    });

    expect(result.owner.accounts).toHaveLength(1);
    expect(result.owner.accounts[0]).toMatchObject({
      accountKey: 'game-1::server:1',
      gameUid: 'game-1',
      recordCount: 2,
      latestRecordAt: '2026-01-02T00:00:00.000Z'
    });
    expect(result.owner.defaultAccountKey).toBe('game-1::server:1');
    expect(result.scopes).toHaveLength(1);
    expect(result.scopes[0].payload.selector.totalPulls).toBe(2);
    expect(JSON.stringify(result)).not.toContain('other-game');
  });

  it('隔离相同 UID 的不同服务器，并统一旧记录为 legacy', () => {
    const history = [
      createPull({ id: 'asia', gameUid: 'same-game', serverId: '2' }),
      createPull({ id: 'eu', gameUid: 'same-game', serverId: '3' }),
      createPull({ id: 'legacy-1', gameUid: null, serverId: '9' }),
      createPull({ id: 'legacy-2', gameUid: null, serverId: '10' })
    ];

    const result = buildPersonalAnalysisSnapshots({
      history,
      pools: [{ id: 'standard-main', type: 'standard' }],
      userId: USER_ID
    });
    const byKey = Object.fromEntries(result.scopes.map((scope) => [scope.scopeKey, scope]));

    expect(Object.keys(byKey)).toEqual(expect.arrayContaining([
      'same-game::server:2',
      'same-game::server:3',
      'legacy'
    ]));
    expect(byKey['same-game::server:2'].sourceServerScope).toBe('2');
    expect(byKey['same-game::server:3'].sourceServerScope).toBe('3');
    expect(byKey.legacy).toMatchObject({
      sourceGameUid: 'legacy',
      sourceServerScope: '10'
    });
    expect(byKey.legacy.payload.account.recordCount).toBe(2);
  });

  it('旧 server_scope 不会被伪装成 server id，账号键与分页 API 一致', () => {
    const history = [createPull({
      id: 'legacy-scope',
      gameUid: 'legacy-game',
      serverId: null,
      server_scope: 'legacy',
      region: 'cn',
    })];

    const result = buildPersonalAnalysisSnapshots({
      history,
      pools: [{ id: 'standard-main', type: 'standard' }],
      userId: USER_ID,
    });

    expect(result.owner.accounts[0]).toMatchObject({
      accountKey: 'legacy-game::region:cn',
      gameUid: 'legacy-game',
      serverId: null,
      serverScope: 'legacy',
      region: 'cn',
    });
  });

  it('为限定单池使用账号内完整限定时间线计算跨池继承', () => {
    const pools = [
      { id: 'limited-a', type: 'limited', up_character: '限定甲' },
      { id: 'limited-b', type: 'limited_character', up_character: '限定乙' }
    ];
    const history = [
      createPull({
        id: 'six-a',
        poolId: 'limited-a',
        rarity: 6,
        character_name: '限定甲',
        timestamp: '2026-01-01T00:00:00.000Z'
      }),
      createPull({ id: 'after-a', poolId: 'limited-a', timestamp: '2026-01-02T00:00:00.000Z' }),
      createPull({ id: 'in-b-1', poolId: 'limited-b', timestamp: '2026-01-03T00:00:00.000Z' }),
      createPull({ id: 'in-b-2', poolId: 'limited-b', timestamp: '2026-01-04T00:00:00.000Z' })
    ];

    const { scopes } = buildPersonalAnalysisSnapshots({ history, pools, userId: USER_ID });
    const limitedB = scopes[0].payload.dashboard.views['limited-b'].excludeFree;

    expect(limitedB.inheritedPityInfo).toEqual({
      inheritedPity: 3,
      inheritedPity5: 3,
      hasInheritedPity: true
    });
    expect(limitedB.effectivePity).toEqual({ pity6: 3, pity5: 3, isInherited: true });
  });

  it('选择器保留免费与赠送计数，统计按开关纳入免费且始终排除赠送', () => {
    const history = [
      createPull({ id: 'paid' }),
      createPull({ id: 'free', is_free: true, timestamp: '2026-01-02T00:00:00.000Z' }),
      createPull({
        id: 'gift',
        special_type: 'gift',
        rarity: 6,
        timestamp: '2026-01-03T00:00:00.000Z'
      })
    ];

    const { scopes } = buildPersonalAnalysisSnapshots({
      history,
      pools: [{ id: 'standard-main', type: 'standard' }],
      userId: USER_ID
    });
    const payload = scopes[0].payload;
    const view = payload.dashboard.views['standard-main'];

    expect(payload.selector).toMatchObject({
      totalPulls: 3,
      latestRecordAt: '2026-01-03T00:00:00.000Z',
      poolPullCounts: { 'standard-main': 3 },
      poolLatestRecordAt: { 'standard-main': '2026-01-03T00:00:00.000Z' }
    });
    expect(view.excludeFree.stats.total).toBe(1);
    expect(view.includeFree.stats.total).toBe(2);
    expect(view.excludeFree.stats.totalSixStar).toBe(0);
    expect(view.includeFree.stats.totalSixStar).toBe(0);
  });

  it('为 Dashboard 视图写入角色、首限定、全池拆分和资源快照', () => {
    const pools = [
      { id: 'limited-a', type: 'limited', up_character: '限定甲' },
      { id: 'standard-main', type: 'standard' },
      { id: 'weapon-main', type: 'weapon', up_character: '限定武器', isLimitedWeapon: true }
    ];
    const characters = [
      { id: 'limited-alpha', name: '限定甲', type: 'character', is_limited: true },
      { id: 'limited-offrate', name: '往期限定', type: 'character', is_limited: true }
    ];
    const history = [
      createPull({
        id: 'limited-four',
        poolId: 'limited-a',
        character_name: '四星甲',
        timestamp: '2026-01-01T00:00:00.000Z'
      }),
      createPull({
        id: 'limited-free',
        poolId: 'limited-a',
        rarity: 6,
        character_name: '限定甲',
        character_id: 'limited-alpha',
        is_free: true,
        timestamp: '2026-01-02T00:00:00.000Z'
      }),
      createPull({
        id: 'limited-target',
        poolId: 'limited-a',
        rarity: 6,
        character_name: '限定甲',
        character_id: 'limited-alpha',
        timestamp: '2026-01-03T00:00:00.000Z'
      }),
      createPull({
        id: 'limited-offrate',
        poolId: 'limited-a',
        rarity: 6,
        character_name: '往期限定',
        character_id: 'limited-offrate',
        timestamp: '2026-01-04T00:00:00.000Z'
      }),
      createPull({
        id: 'standard-five',
        poolId: 'standard-main',
        rarity: 5,
        character_name: '常驻五星',
        timestamp: '2026-01-05T00:00:00.000Z'
      }),
      createPull({
        id: 'weapon-six',
        poolId: 'weapon-main',
        rarity: 6,
        character_name: '限定武器',
        timestamp: '2026-01-06T00:00:00.000Z'
      })
    ];

    const { scopes } = buildPersonalAnalysisSnapshots({
      history,
      pools,
      characters,
      userId: USER_ID
    });
    const views = scopes[0].payload.dashboard.views;
    const limitedExclude = views['limited-a'].excludeFree;
    const limitedInclude = views['limited-a'].includeFree;
    const allExclude = views.__group_all.excludeFree;
    const allInclude = views.__group_all.includeFree;
    const timelineViews = scopes[0].payload.dashboard.timelineViews;

    expect(limitedExclude.characterStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '限定甲', count: 1, pities: [2] }),
      expect.objectContaining({ name: '往期限定', count: 1, pities: [1] })
    ]));
    expect(limitedInclude.characterStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '限定甲', count: 2, freeCount: 1, pities: ['free', 2] })
    ]));
    expect(limitedExclude.checkLimitedInFirstN).toEqual({
      firstLimitedIndex120: 2,
      firstLimitedIndex80: 2,
      validPullCount: 3
    });
    expect(limitedExclude.hasReceivedFreeTen).toBe(true);
    expect(limitedExclude.splitOverviewStats).toBeNull();
    expect(limitedExclude.dashboardResourceSummary).toEqual(limitedExclude.stats.resourceSummary);

    expect(allExclude.splitOverviewStats.character.total).toBe(4);
    expect(allExclude.splitOverviewStats.weapon.total).toBe(1);
    expect(allInclude.splitOverviewStats.character.total).toBe(5);
    expect(allExclude.dashboardResourceSummary).toMatchObject({
      characterPulls: 4,
      weaponPulls: 1,
      chargedCharacterPulls: 4,
      chargedWeaponPulls: 1
    });
    expect(allInclude.dashboardResourceSummary).toMatchObject({
      characterPulls: 5,
      weaponPulls: 1,
      chargedCharacterPulls: 4,
      chargedWeaponPulls: 1
    });
    expect(timelineViews['zh-CN']['limited-a']).toEqual([
      expect.objectContaining({
        id: 'limited-a',
        totalPulls: 3,
        entries: expect.arrayContaining([
          expect.objectContaining({ stageKind: 'up' })
        ])
      })
    ]);
    expect(timelineViews['en-US'].__group_all.length).toBeGreaterThan(0);
    expect(JSON.stringify(timelineViews)).not.toContain('sourceRecordKeys');
    expect(JSON.stringify(timelineViews)).not.toContain('sourceBatchKeys');
  });

  it('跨限定池保底映射排除赠送并标记免费高星', () => {
    const map = buildCrossPoolPityMap([
      createPull({ id: 'paid-four', timestamp: '2026-01-01T00:00:00.000Z' }),
      createPull({ id: 'gift-six', rarity: 6, special_type: 'gift', timestamp: '2026-01-02T00:00:00.000Z' }),
      createPull({ id: 'free-five', rarity: 5, is_free: true, timestamp: '2026-01-03T00:00:00.000Z' }),
      createPull({ id: 'paid-five', rarity: 5, timestamp: '2026-01-04T00:00:00.000Z' }),
      createPull({ id: 'paid-six', rarity: 6, timestamp: '2026-01-05T00:00:00.000Z' })
    ]);

    expect(map.has('gift-six')).toBe(false);
    expect(map.get('free-five')).toEqual({ sixStarPity: 'free', fiveStarPity: 'free' });
    expect(map.get('paid-five')).toEqual({ sixStarPity: null, fiveStarPity: 2 });
    expect(map.get('paid-six')).toEqual({ sixStarPity: 3, fiveStarPity: 1 });
  });

  it('为历史引用的未知池按前缀创建占位数据和统计视图', () => {
    const history = [createPull({ id: 'unknown', poolId: 'special_9_9_9' })];

    const { scopes } = buildPersonalAnalysisSnapshots({ history, pools: [], userId: USER_ID });
    const payload = scopes[0].payload;

    expect(payload.poolManifest).toEqual([expect.objectContaining({
      id: 'special_9_9_9',
      type: 'limited',
      isPlaceholder: true
    })]);
    expect(payload.dashboard.views['special_9_9_9'].excludeFree.stats.total).toBe(1);
    expect(payload.dashboard.views.__group_limited.excludeFree.stats.total).toBe(1);
  });

  it('直接用 owner 全量历史和显式角色元数据构建汇总', () => {
    const pools = [
      { id: 'limited-a', type: 'limited', up_character: 'Alpha' },
      { id: 'standard-main', type: 'standard' }
    ];
    const characters = [
      { id: 'char-alpha', name: 'Alpha', aliases: ['阿尔法'], rarity: 6, type: 'character' },
      { id: 'char-beta', name: 'Beta', rarity: 4, type: 'character' }
    ];
    const history = [
      createPull({
        id: 'alpha',
        poolId: 'limited-a',
        rarity: 6,
        character_name: 'Alpha',
        character_id: 'char-alpha'
      }),
      createPull({
        id: 'beta',
        gameUid: 'game-2',
        poolId: 'standard-main',
        character_name: 'Beta',
        character_id: 'char-beta'
      }),
      createPull({ id: 'other-user', userId: 'user-2', character_name: 'Beta' })
    ];

    const result = buildPersonalAnalysisSnapshots({
      history,
      pools,
      characters,
      userId: USER_ID
    });
    const expected = buildSummaryStats({
      history: history.filter((record) => record.user_id === USER_ID),
      pools,
      user: { id: USER_ID },
      characters
    });

    expect(result.owner.summary).toEqual(expected);
    expect(result.owner.summary.total).toBe(2);
  });

  it('只保留最近六条六星紧凑字段', () => {
    const history = Array.from({ length: 8 }, (_, index) => createPull({
      id: `six-${index}`,
      rarity: 6,
      character_name: `六星-${index}`,
      character_id: `char-${index}`,
      timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    }));

    const { scopes } = buildPersonalAnalysisSnapshots({
      history,
      pools: [{ id: 'standard-main', type: 'standard' }],
      userId: USER_ID
    });
    const recent = scopes[0].payload.recentSixStars;

    expect(recent).toHaveLength(6);
    expect(recent[0].id).toBe('six-7');
    expect(Object.keys(recent[0]).sort()).toEqual([
      'character_id',
      'id',
      'isStandard',
      'name',
      'pity',
      'poolId',
      'rarity',
      'timestamp'
    ]);
  });

  it('注入支持 ID、名称、别名和基础模糊匹配的角色解析器', () => {
    const alpha = { id: 'char-alpha', name: 'Alpha Prime', aliases: ['阿尔法'], is_limited: true };
    const resolveCharacter = createSnapshotCharacterResolver([alpha]);

    expect(resolveCharacter('char-alpha')).toBe(alpha);
    expect(resolveCharacter('阿尔法')).toBe(alpha);
    expect(resolveCharacter('alpha', { fuzzy: true })).toBe(alpha);
    expect(resolveCharacter('missing', { fuzzy: true })).toBeNull();
  });

  it('返回值可 JSON 序列化且不泄漏 Map 或 Set', () => {
    const result = buildPersonalAnalysisSnapshots({
      history: [createPull({ id: 'serializable' })],
      pools: [{
        id: 'standard-main',
        type: 'standard',
        nestedMap: new Map([['key', { value: 1 }]]),
        nestedSet: new Set(['a', 'b'])
      }],
      userId: USER_ID
    });

    expect(() => JSON.stringify(result)).not.toThrow();
    assertNoMapOrSet(result);
    expect(result.scopes[0].payload.poolManifest[0]).toMatchObject({
      nestedMap: { key: { value: 1 } },
      nestedSet: ['a', 'b']
    });
  });
});
