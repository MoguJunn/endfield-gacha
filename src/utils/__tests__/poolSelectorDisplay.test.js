import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { characterCache } from '../characterUtils.js';
import { buildPoolSelectorGroups } from '../poolSelectorDisplay.js';

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
});
