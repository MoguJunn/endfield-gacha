import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { characterCache } from '../characterUtils.js';
import {
  buildPoolSelectorGroups,
  buildPoolSelectorVersionFold,
  resolvePoolSelectorVersionId,
} from '../poolSelectorDisplay.js';

describe('poolSelectorDisplay', () => {
  beforeEach(() => {
    characterCache.clear();
  });

  afterEach(() => {
    characterCache.clear();
  });

  it('shows full standard six-star roster as multi-avatar display for standard pools without up characters', () => {
    characterCache.applyCharacters([
      {
        id: 'std_1',
        name: '莱万汀',
        avatar_url: '/avatars/laevatain.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
      {
        id: 'std_2',
        name: '洁尔佩塔',
        avatar_url: '/avatars/gilberta.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
      {
        id: 'std_3',
        name: '艾尔黛拉',
        avatar_url: '/avatars/ardelia.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
      {
        id: 'std_4',
        name: '骏卫',
        avatar_url: '/avatars/pogranichnik.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
      {
        id: 'std_5',
        name: '余烬',
        avatar_url: '/avatars/ember.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
    ]);

    const groups = buildPoolSelectorGroups({
      pools: [
        { id: 'pool_standard', type: 'standard', name: '基础寻访' },
      ],
      locale: 'zh-CN',
    });

    const standardPool = groups[0].pools[0];
    expect(standardPool.displayFeaturedCharacters).toEqual(['莱万汀', '洁尔佩塔', '艾尔黛拉', '骏卫', '余烬']);
    expect(standardPool.avatarLookupNames).toEqual(['莱万汀', '洁尔佩塔', '艾尔黛拉', '骏卫']);
    expect(standardPool.displayUpCharacter).toBe('');
  });

  it('keeps weapon pools in single-up display mode', () => {
    characterCache.applyCharacters([
      {
        id: 'weapon_1',
        name: '焰羽火燎',
        avatar_url: '/avatars/weapon-up.png',
        rarity: 6,
        type: 'weapon',
        pool_config: { pools: ['weapon'] },
      },
      {
        id: 'weapon_2',
        name: 'J.E.T.',
        avatar_url: '/avatars/jet.png',
        rarity: 6,
        type: 'weapon',
        pool_config: { pools: ['weapon'] },
      },
    ]);

    const groups = buildPoolSelectorGroups({
      pools: [
        { id: 'pool_weapon', type: 'weapon', isLimitedWeapon: true, name: '行舟审锻', up_character: '焰羽火燎' },
      ],
      locale: 'zh-CN',
    });

    const weaponPool = groups[0].pools[0];
    expect(weaponPool.displayFeaturedCharacters).toEqual(['焰羽火燎']);
    expect(weaponPool.avatarLookupNames).toEqual(['焰羽火燎']);
    expect(weaponPool.displayUpCharacter).toBe('焰羽火燎');
  });

  it('does not display malformed weapon featured IDs beside a named UP item', () => {
    const groups = buildPoolSelectorGroups({
      pools: [{
        id: 'weponbox_1_3_2',
        type: 'weapon',
        isLimitedWeapon: true,
        name: '染赤申领',
        up_character: '镀红祝福',
        featured_characters: ['wpn_lance_0015', 'wpn_lance_0010', 'wpn_lance_0011']
      }],
      locale: 'zh-CN'
    });

    const weaponPool = groups[0].pools[0];
    expect(weaponPool.displayFeaturedCharacters).toEqual(['镀红祝福']);
    expect(weaponPool.displayUpCharacter).toBe('镀红祝福');
    expect(weaponPool.displayFeaturedCharacters).not.toContain('wpn_lance_0015');
  });

  it('keeps only the latest two represented versions direct for character and weapon pools', () => {
    const versionTimeline = [1, 2, 3, 4].map((version) => ({
      id: `v${version}`,
      startsAt: `2026-0${version}-01T00:00:00Z`,
      poolIds: [`character-v${version}`, `weapon-v${version}`],
    }));
    const pools = versionTimeline.flatMap((version, index) => ([
      {
        id: version.poolIds[0],
        type: 'limited_character',
        name: `角色 ${index + 1}`,
        start_time: version.startsAt,
      },
      {
        id: version.poolIds[1],
        type: 'limited_weapon',
        isLimitedWeapon: true,
        name: `武器 ${index + 1}`,
        start_time: version.startsAt,
      },
    ]));

    const groups = buildPoolSelectorGroups({ pools, versionTimeline, referenceDate: '2026-05-01T00:00:00Z' });
    const characterFold = groups.find((group) => group.type === 'limited').versionFold;
    const weaponFold = groups.find((group) => group.type === 'weapon_limited').versionFold;

    expect(characterFold.directPools.map((pool) => pool.id).sort()).toEqual(['character-v3', 'character-v4']);
    expect(characterFold.foldedPools.map((pool) => pool.id).sort()).toEqual(['character-v1', 'character-v2']);
    expect(weaponFold.directPools.map((pool) => pool.id).sort()).toEqual(['weapon-v3', 'weapon-v4']);
    expect(weaponFold.foldedPools.map((pool) => pool.id).sort()).toEqual(['weapon-v1', 'weapon-v2']);
  });

  it('uses explicit version ownership before time fallback and keeps ambiguous pools visible', () => {
    const versions = [
      { id: 'v1', startsAt: '2026-01-01T00:00:00Z', poolIds: ['explicit-v2', 'ambiguous'] },
      { id: 'v2', startsAt: '2026-02-01T00:00:00Z', poolIds: ['ambiguous'] },
      { id: 'v3', startsAt: '2026-03-01T00:00:00Z', poolIds: [] },
    ];
    const explicitPool = { id: 'explicit-v2', start_time: '2026-03-15T00:00:00Z' };
    const ambiguousPool = { id: 'ambiguous', start_time: '2026-01-15T00:00:00Z' };

    expect(resolvePoolSelectorVersionId(explicitPool, versions)).toBe('v1');
    expect(resolvePoolSelectorVersionId(ambiguousPool, versions)).toBeNull();

    const fold = buildPoolSelectorVersionFold({
      pools: [explicitPool, ambiguousPool, { id: 'time-v3', start_time: '2026-03-15T00:00:00Z' }],
      groupType: 'limited',
      versionTimeline: versions,
      latestVersionLimit: 1,
    });
    expect(fold.directPools.map((pool) => pool.id).sort()).toEqual(['ambiguous', 'time-v3']);
    expect(fold.foldedPools.map((pool) => pool.id)).toEqual(['explicit-v2']);
  });

  it('disables version folding while searching', () => {
    const groups = buildPoolSelectorGroups({
      pools: [
        { id: 'old', type: 'limited_character', name: '旧池', start_time: '2026-01-10T00:00:00Z' },
        { id: 'current', type: 'limited_character', name: '当前池', start_time: '2026-04-10T00:00:00Z' },
      ],
      searchQuery: '池',
      versionTimeline: [
        { id: 'v1', startsAt: '2026-01-01T00:00:00Z' },
        { id: 'v2', startsAt: '2026-02-01T00:00:00Z' },
        { id: 'v3', startsAt: '2026-03-01T00:00:00Z' },
        { id: 'v4', startsAt: '2026-04-01T00:00:00Z' },
      ],
      latestVersionLimit: 1,
    });

    expect(groups[0].disableCollapse).toBe(true);
    expect(groups[0].versionFold.enabled).toBe(false);
    expect(groups[0].versionFold.directPools).toHaveLength(2);
  });
});
