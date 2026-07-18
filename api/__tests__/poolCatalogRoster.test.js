// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  attachPoolSixStarRoster,
  buildPoolSixStarRosterMap,
} from '../_lib/poolCatalogRoster.js';

describe('pool catalog six-star roster', () => {
  it('groups complete six-star entities without treating UP as the whole roster', () => {
    const rosterMap = buildPoolSixStarRosterMap([
      {
        pool_id: 'limited-a',
        character_id: 'char-up',
        is_up: true,
        characters: {
          id: 'char-up',
          name: 'UP角色',
          rarity: 6,
          type: 'character',
        },
      },
      {
        pool_id: 'limited-a',
        character_id: 'char-off-banner',
        is_up: false,
        characters: {
          id: 'char-off-banner',
          name: '非UP角色',
          rarity: 6,
          type: 'character',
        },
      },
      {
        pool_id: 'weapon-a',
        character_id: 'weapon-six',
        is_up: true,
        characters: [{
          id: 'weapon-six',
          name: '六星武器',
          rarity: 6,
          type: 'weapon',
        }],
      },
      {
        pool_id: 'limited-a',
        character_id: 'char-five',
        is_up: false,
        characters: {
          id: 'char-five',
          name: '五星角色',
          rarity: 5,
          type: 'character',
        },
      },
      {
        pool_id: 'limited-a',
        character_id: 'char-off-banner',
        is_up: false,
        characters: {
          id: 'char-off-banner',
          name: '非UP角色',
          rarity: 6,
          type: 'character',
        },
      },
      {
        pool_id: 'unknown-pool',
        character_id: 'ignored',
        is_up: true,
        characters: {
          id: 'ignored',
          name: '不在请求池中',
          rarity: 6,
          type: 'character',
        },
      },
    ], ['limited-a', 'weapon-a', 'empty-a']);

    expect(rosterMap.get('limited-a')).toEqual([
      { id: 'char-up', name: 'UP角色', type: 'character', is_up: true },
      { id: 'char-off-banner', name: '非UP角色', type: 'character', is_up: false },
    ]);
    expect(rosterMap.get('weapon-a')).toEqual([
      { id: 'weapon-six', name: '六星武器', type: 'weapon', is_up: true },
    ]);
    expect(rosterMap.get('empty-a')).toEqual([]);
  });

  it('marks only non-empty database rosters as complete', () => {
    const rosterMap = new Map([
      ['limited-a', [{ id: 'char-a', name: '角色A', type: 'character', is_up: false }]],
      ['empty-a', []],
    ]);

    expect(attachPoolSixStarRoster({
      pool_id: 'limited-a',
      up_character: '角色A',
    }, rosterMap)).toMatchObject({
      six_star_entities: [{ id: 'char-a', name: '角色A', type: 'character', is_up: true }],
      six_star_roster_complete: true,
    });
    expect(attachPoolSixStarRoster({ pool_id: 'empty-a' }, rosterMap)).toMatchObject({
      six_star_entities: [],
      six_star_roster_complete: false,
    });
  });
});
