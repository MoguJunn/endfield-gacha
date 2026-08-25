import { beforeEach, describe, expect, it } from 'vitest';

import { characterCache } from '../../../utils/characterUtils.js';
import { resolveMobileDetailedLogAvatarUrl } from '../../../utils/mobileDetailedLogAvatar.js';

describe('MobileDetailedLogList avatar resolution', () => {
  beforeEach(() => {
    characterCache.clear();
    characterCache.applyCharacters([
      {
        id: 'char_pear',
        name: '梨',
        type: 'character',
        rarity: 4,
        avatar_url: '/avatars/pear.png',
      },
      {
        id: 'weapon_guard',
        name: '狼卫',
        type: 'weapon',
        rarity: 5,
        avatar_url: '/avatars/guard.png',
      },
    ]);
  });

  it('prefers a direct record avatar URL', () => {
    expect(resolveMobileDetailedLogAvatarUrl({
      avatar_url: '/records/direct.png',
      character_id: 'char_pear',
    })).toBe('/records/direct.png');
  });

  it('resolves character IDs and weapon names through the shared catalog', () => {
    expect(resolveMobileDetailedLogAvatarUrl({ character_id: 'char_pear' }))
      .toBe('/avatars/pear.png');
    expect(resolveMobileDetailedLogAvatarUrl({ item_name: '狼卫' }))
      .toBe('/avatars/guard.png');
  });
});
