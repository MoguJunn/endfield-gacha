import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { characterCache } from '../characterUtils.js';
import {
  applyPoolSelectorScopeView,
  buildPoolSelectorGroups,
  buildPoolSelectorVersionFold,
  getPoolFeaturedLabel,
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
      pools: [{ id: 'pool_standard', type: 'standard', name: '基础寻访' }],
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
      pools: [{ id: 'pool_weapon', type: 'weapon', isLimitedWeapon: true, name: '行舟审锻', up_character: '焰羽火燎' }],
      locale: 'zh-CN',
    });

    const weaponPool = groups[0].pools[0];
    expect(weaponPool.displayFeaturedCharacters).toEqual(['焰羽火燎']);
    expect(weaponPool.avatarLookupNames).toEqual(['焰羽火燎']);
    expect(weaponPool.displayUpCharacter).toBe('焰羽火燎');
  });

  it('does not display malformed weapon featured IDs beside a named UP item', () => {
    const groups = buildPoolSelectorGroups({
      pools: [
        {
          id: 'weponbox_1_3_2',
          type: 'weapon',
          isLimitedWeapon: true,
          name: '染赤申领',
          up_character: '镀红祝福',
          featured_characters: ['wpn_lance_0015', 'wpn_lance_0010', 'wpn_lance_0011'],
        },
      ],
      locale: 'zh-CN',
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
    const pools = versionTimeline.flatMap((version, index) => [
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
    ]);

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

  it('uses capabilities for reconstruction labels, entity localization and avatar counts', () => {
    characterCache.applyCharacters([
      { id: 'rw-up', name: '重构武器UP', avatar_url: '/avatars/rw.webp', rarity: 6, type: 'weapon' },
      { id: 'rc-up', name: '重构角色UP', avatar_url: '/avatars/rc.webp', rarity: 6, type: 'character' },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `festival-${index}`,
        name: `辉光角色${index + 1}`,
        avatar_url: `/avatars/festival-${index}.webp`,
        rarity: 6,
        type: 'character',
      })),
    ]);
    const groups = buildPoolSelectorGroups({
      pools: [
        {
          id: 'recon-weapon',
          type: 'extra',
          name: '武器重构',
          extra_subtype: 'reconstruction',
          extra_rule_profile: 'reconstruction_weapon_v1',
          extra_series_key: 'rw',
          up_character: '重构武器UP',
          featured_characters: ['其他武器', '重构武器UP'],
        },
        {
          id: 'recon-character',
          type: 'extra',
          name: '角色重构',
          extra_subtype: 'reconstruction',
          extra_rule_profile: 'reconstruction_character_v1',
          extra_series_key: 'rc',
          up_character: '重构角色UP',
          featured_characters: ['重构角色UP', '其他角色'],
        },
        {
          id: 'festival',
          type: 'extra',
          name: '辉光',
          extra_subtype: 'special',
          extra_rule_profile: 'brilliance_festival_v1',
          featured_characters: ['辉光角色1', '辉光角色2', '辉光角色3', '辉光角色4'],
        },
      ],
      locale: 'zh-CN',
    });
    const allExtraPools = groups.find((group) => group.type === 'extra').pools;
    const reconWeapon = allExtraPools.find((pool) => pool.id === 'recon-weapon');
    const reconCharacter = allExtraPools.find((pool) => pool.id === 'recon-character');
    const festival = allExtraPools.find((pool) => pool.id === 'festival');

    expect(getPoolFeaturedLabel(reconWeapon, { locale: 'zh-CN', short: true })).toBe('UP武器');
    expect(reconWeapon.displayFeaturedCharacters).toEqual(['重构武器UP']);
    expect(reconWeapon.avatarLookupNames).toEqual(['重构武器UP']);
    expect(reconCharacter.displayFeaturedCharacters).toEqual(['重构角色UP']);
    expect(reconCharacter.avatarLookupNames).toEqual(['重构角色UP']);
    expect(festival.displayFeaturedCharacters).toEqual(['辉光角色1', '辉光角色2', '辉光角色3', '辉光角色4']);
    expect(festival.avatarLookupNames).toEqual(['辉光角色1', '辉光角色2', '辉光角色3', '辉光角色4']);
  });

  it('groups extra pools by explicit subtype with the single legacy special fallback', () => {
    const groups = buildPoolSelectorGroups({
      pools: [
        { id: 'joint_reconstruction', type: 'extra', name: '重构', extra_subtype: 'reconstruction' },
        {
          id: 'joint_reconstruction_claim',
          type: 'extra',
          name: '重构申领',
          extra_subtype: 'reconstruction',
          extra_rule_profile: 'reconstruction_weapon_v1',
        },
        { id: 'joint_special', type: 'extra', name: '特殊', extraSubtype: 'special' },
        { id: 'joint_1_2_2', type: 'extra', name: '旧特殊' },
        { id: 'joint_unknown', type: 'extra', name: '未知附加' },
        { id: 'joint_1_2_2_explicit', type: 'extra', name: '显式重构', extra_subtype: 'reconstruction' },
      ],
      locale: 'zh-CN',
    });

    const extraGroup = groups.find((group) => group.type === 'extra');
    expect(extraGroup.groupId).toBe('__group_extra');
    expect(extraGroup.subgroups.map((subgroup) => subgroup.subtype)).toEqual([
      'reconstruction',
      'reconstruction_claim',
      'special',
      'unclassified',
    ]);
    expect(extraGroup.subgroups[0].pools.map((pool) => pool.id).sort()).toEqual([
      'joint_1_2_2_explicit',
      'joint_reconstruction',
    ]);
    expect(extraGroup.subgroups[1]).toMatchObject({
      label: '重构申领',
      groupId: '__group_extra:reconstruction_claim',
      defaultExpanded: true,
    });
    expect(extraGroup.subgroups[1].pools.map((pool) => pool.id)).toEqual(['joint_reconstruction_claim']);
    expect(extraGroup.subgroups[2].pools.map((pool) => pool.id).sort()).toEqual(['joint_1_2_2', 'joint_special']);
    expect(extraGroup.subgroups[3].pools.map((pool) => pool.id)).toEqual(['joint_unknown']);
  });

  it('sorts each extra subtype by timing and uses pool id as the stable fallback', () => {
    const groups = buildPoolSelectorGroups({
      pools: [
        { id: 'z_untimed', type: 'extra', name: '同名', extra_subtype: 'reconstruction' },
        { id: 'a_untimed', type: 'extra', name: '同名', extra_subtype: 'reconstruction' },
        {
          id: 'active',
          type: 'extra',
          name: '进行中',
          extra_subtype: 'reconstruction',
          start_time: '2026-08-01T00:00:00Z',
          end_time: '2026-09-01T00:00:00Z',
        },
        {
          id: 'upcoming',
          type: 'extra',
          name: '即将',
          extra_subtype: 'reconstruction',
          start_time: '2026-09-01T00:00:00Z',
          end_time: '2026-10-01T00:00:00Z',
        },
        {
          id: 'expired',
          type: 'extra',
          name: '结束',
          extra_subtype: 'reconstruction',
          start_time: '2026-07-01T00:00:00Z',
          end_time: '2026-08-01T00:00:00Z',
        },
      ],
      referenceDate: new Date('2026-08-24T00:00:00Z'),
      locale: 'zh-CN',
    });

    const reconstruction = groups.find((group) => group.type === 'extra').subgroups[0];
    expect(reconstruction.pools.map((pool) => pool.id)).toEqual([
      'active',
      'upcoming',
      'expired',
      'a_untimed',
      'z_untimed',
    ]);
  });

  it('keeps a zero-pull special catalog header collapsed until explicitly revealed', () => {
    const catalogGroups = buildPoolSelectorGroups({
      pools: [
        { id: 'joint_reconstruction', type: 'extra', name: '重构', extra_subtype: 'reconstruction' },
        { id: 'joint_special', type: 'extra', name: '特殊', extra_subtype: 'special' },
      ],
      poolPullCounts: { joint_reconstruction: 2 },
      locale: 'zh-CN',
    });

    const collapsedView = applyPoolSelectorScopeView({
      groups: catalogGroups,
      hideZeroPullPools: true,
    });
    const collapsedSpecial = collapsedView[0].subgroups.find((subgroup) => subgroup.subtype === 'special');
    expect(collapsedSpecial).toMatchObject({
      groupId: '__group_extra:special',
      totalPulls: 0,
      poolCount: 1,
      isExpanded: false,
    });
    expect(collapsedSpecial.pools).toEqual([]);
    expect(collapsedSpecial.allPools.map((pool) => pool.id)).toEqual(['joint_special']);

    const expandedView = applyPoolSelectorScopeView({
      groups: catalogGroups,
      hideZeroPullPools: true,
      subgroupExpansionOverrides: { '__group_extra:special': true },
    });
    const expandedSpecial = expandedView[0].subgroups.find((subgroup) => subgroup.subtype === 'special');
    expect(expandedSpecial.isExpanded).toBe(true);
    expect(expandedSpecial.pools.map((pool) => pool.id)).toEqual(['joint_special']);
  });

  it('reveals zero-pull special pools for search hits and selected subtype scopes', () => {
    const pools = [{ id: 'joint_special', type: 'extra', name: 'Festival Special', extra_subtype: 'special' }];
    const searchedGroups = buildPoolSelectorGroups({
      pools,
      searchQuery: 'festival',
      locale: 'en-US',
    });
    const searchedView = applyPoolSelectorScopeView({
      groups: searchedGroups,
      hideZeroPullPools: true,
      searchQuery: 'festival',
    });
    expect(searchedView[0].subgroups[0].pools.map((pool) => pool.id)).toEqual(['joint_special']);

    const selectedGroups = buildPoolSelectorGroups({
      pools,
      searchQuery: 'no match',
      currentPoolId: '__group_extra:special',
      locale: 'en-US',
    });
    const selectedView = applyPoolSelectorScopeView({
      groups: selectedGroups,
      currentPoolId: '__group_extra:special',
      hideZeroPullPools: true,
      searchQuery: 'no match',
    });
    expect(selectedView[0].subgroups[0].isExpanded).toBe(true);
    expect(selectedView[0].subgroups[0].pools.map((pool) => pool.id)).toEqual(['joint_special']);
  });

  it('does not render a special subgroup when the catalog has no special pool', () => {
    const groups = buildPoolSelectorGroups({
      pools: [{ id: 'joint_reconstruction', type: 'extra', name: '重构', extra_subtype: 'reconstruction' }],
      locale: 'zh-CN',
    });

    expect(groups[0].subgroups.map((subgroup) => subgroup.subtype)).toEqual(['reconstruction']);
  });
});
