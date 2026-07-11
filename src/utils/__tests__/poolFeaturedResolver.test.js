import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { characterCache } from '../characterUtils.js';
import { getPoolFeaturedLead, getPoolFeaturedNames } from '../poolFeaturedResolver.js';

describe('poolFeaturedResolver', () => {
  beforeEach(() => {
    characterCache.clear();
  });

  afterEach(() => {
    characterCache.clear();
  });

  it('prefers resolved roster up entries over explicit featured list', () => {
    const pool = {
      up_character: '旧名单A',
      featured_characters: ['旧名单A', '旧名单B'],
      resolved_roster: {
        up: [
          { name: '莱万汀' },
          { name: '洁尔佩塔' },
          { name: '艾尔黛拉' },
          { name: '骏卫' },
        ],
      },
    };

    expect(getPoolFeaturedNames(pool)).toEqual(['莱万汀', '洁尔佩塔', '艾尔黛拉', '骏卫']);
    expect(getPoolFeaturedLead(pool)).toBe('莱万汀');
  });

  it('falls back to explicit featured list and preserves single up as lead', () => {
    const pool = {
      up_character: '莱万汀',
      featured_characters: ['莱万汀', '洁尔佩塔'],
    };

    expect(getPoolFeaturedNames(pool)).toEqual(['莱万汀', '洁尔佩塔']);
    expect(getPoolFeaturedLead(pool)).toBe('莱万汀');
  });

  it('prefers the explicit single UP for limited pools even when the roster contains other six-stars', () => {
    const pool = {
      type: 'limited',
      name: '拳出无悔',
      up_character: '弭弗',
      featured_characters: ['余烬', '弭弗', '庄方宜'],
      resolved_roster: {
        up: [
          { name: '余烬' },
          { name: '弭弗' },
          { name: '庄方宜' },
        ],
      },
    };

    expect(getPoolFeaturedNames(pool)).toEqual(['弭弗']);
    expect(getPoolFeaturedLead(pool)).toBe('弭弗');
  });

  it('falls back to pool name when no featured names exist', () => {
    expect(getPoolFeaturedLead({ name: '未命名卡池' })).toBe('未命名卡池');
  });

  it('falls back to standard six-star roster for standard pools without up characters', () => {
    characterCache.applyCharacters([
      {
        id: 'std_1',
        name: '莱万汀',
        avatar_url: '/avatars/lv.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
      {
        id: 'std_2',
        name: '洁尔佩塔',
        avatar_url: '/avatars/jep.png',
        rarity: 6,
        type: 'character',
        pool_config: { pools: ['standard'] },
      },
    ]);

    const pool = {
      type: 'standard',
      name: '基础寻访',
    };

    const featuredNames = getPoolFeaturedNames(pool);

    expect(featuredNames.length).toBeGreaterThan(0);
    expect(featuredNames).toContain('莱万汀');
  });

  it('keeps explicit single up for weapon pools instead of falling back to a roster', () => {
    const pool = {
      type: 'weapon',
      isLimitedWeapon: true,
      up_character: '焰羽火燎',
    };

    expect(getPoolFeaturedNames(pool)).toEqual(['焰羽火燎']);
    expect(getPoolFeaturedLead(pool)).toBe('焰羽火燎');
  });

  it('canonicalizes character ids from unified featured sources', () => {
    characterCache.applyCharacters([
      {
        id: 'chr_0027_tangtang',
        name: '汤汤',
        avatar_url: '/avatars/tangtang.png',
        rarity: 6,
        type: 'character',
        aliases: ['Tangtang'],
        is_limited: true,
      },
    ]);

    const pool = {
      up_character: 'chr_0027_tangtang',
      featured_characters: ['chr_0027_tangtang'],
    };

    expect(getPoolFeaturedNames(pool)).toEqual(['汤汤']);
    expect(getPoolFeaturedLead(pool)).toBe('汤汤');
  });

  it('filters unresolved internal entity IDs from featured display names', () => {
    expect(getPoolFeaturedNames({
      type: 'extra',
      featured_characters: ['wpn_lance_0015', '镀红祝福']
    })).toEqual(['镀红祝福']);
  });

  it('keeps a weapon pool focused on its named single UP item', () => {
    expect(getPoolFeaturedNames({
      type: 'weapon',
      up_character: '镀红祝福',
      featured_characters: [
        'wpn_lance_0015',
        'wpn_lance_0010',
        'wpn_lance_0011',
        'wpn_pistol_0009',
        'wpn_sword_0012',
        'wpn_funnel_0009',
        'wpn_claym_0004'
      ]
    })).toEqual(['镀红祝福']);
  });
});
