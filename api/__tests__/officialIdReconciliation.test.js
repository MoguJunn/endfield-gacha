// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { reconcileOfficialCharacterIds } from '../../backend/lib/officialIdReconciliation.js';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function tableRows(state, tableName) {
  if (!Array.isArray(state[tableName])) {
    state[tableName] = [];
  }
  return state[tableName];
}

function createQueryClient(state) {
  return {
    from(tableName) {
      return {
        select() {
          return {
            limit: async () => ({ data: [...tableRows(state, tableName)], error: null }),
            eq: async (columnName, value) => ({
              data: tableRows(state, tableName).filter(
                (row) => normalizeText(row?.[columnName]) === normalizeText(value)
              ),
              error: null,
            }),
          };
        },
        update(values) {
          return {
            eq: async (columnName, value) => {
              state[tableName] = tableRows(state, tableName).map((row) =>
                normalizeText(row?.[columnName]) === normalizeText(value) ? { ...row, ...values } : row
              );
              return { error: null };
            },
          };
        },
        delete() {
          return {
            eq: async (columnName, value) => {
              state[tableName] = tableRows(state, tableName).filter(
                (row) => normalizeText(row?.[columnName]) !== normalizeText(value)
              );
              return { error: null };
            },
          };
        },
        async upsert(rows) {
          const incomingRows = Array.isArray(rows) ? rows : [rows];
          if (tableName === 'characters') {
            incomingRows.forEach((row) => {
              const index = state.characters.findIndex((item) => item.id === row.id);
              if (index >= 0) {
                state.characters[index] = { ...state.characters[index], ...row };
              } else {
                state.characters.push(row);
              }
            });
            return { error: null };
          }

          if (tableName === 'pool_characters') {
            incomingRows.forEach((row) => {
              const index = state.pool_characters.findIndex(
                (item) => item.pool_id === row.pool_id && item.character_id === row.character_id
              );
              if (index >= 0) {
                state.pool_characters[index] = { ...state.pool_characters[index], ...row };
              } else {
                state.pool_characters.push(row);
              }
            });
            return { error: null };
          }

          tableRows(state, tableName).push(...incomingRows);
          return { error: null };
        },
      };
    },
  };
}

describe('reconcileOfficialCharacterIds', () => {
  it('preserves managed character settings and pool roster while migrating manual placeholders', async () => {
    const manualId = 'char_manual_rossi_abc123';
    const officialId = 'chr_rossi';
    const state = {
      characters: [
        {
          id: officialId,
          name: '洛茜',
          type: 'character',
          rarity: 6,
          aliases: ['official-existing'],
          avatar_url: '/avatars/official.png',
          is_limited: false,
          release_date: null,
          pool_config: { pools: [] },
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: manualId,
          name: '洛茜',
          type: 'character',
          rarity: 6,
          aliases: ['Rossi'],
          avatar_url: '/avatars/manual.png',
          is_limited: true,
          release_date: '2026-03-29',
          pool_config: { pools: ['pool-limited'], note: 'managed' },
          created_at: '2026-02-01T00:00:00.000Z',
        },
      ],
      pool_characters: [
        { pool_id: 'pool-limited', character_id: manualId, is_up: true, created_at: 'manual-link' },
        { pool_id: 'pool-existing', character_id: manualId, is_up: false, created_at: 'manual-existing' },
        { pool_id: 'pool-existing', character_id: officialId, is_up: true, created_at: 'official-existing' },
      ],
      pools: [{ pool_id: 'pool-limited', featured_characters: [manualId] }],
      history: [{ record_id: 1, character_id: manualId }],
      character_id_aliases: [],
    };

    const result = await reconcileOfficialCharacterIds(createQueryClient(state), [
      { id: officialId, name: '洛茜', type: 'character', rarity: 6 },
    ]);

    expect(result).toMatchObject({ migrated: 1 });
    expect(state.characters.some((character) => character.id === manualId)).toBe(false);

    const canonical = state.characters.find((character) => character.id === officialId);
    expect(canonical).toMatchObject({
      id: officialId,
      name: '洛茜',
      is_limited: true,
      avatar_url: '/avatars/official.png',
      release_date: '2026-03-29',
      pool_config: { pools: ['pool-limited'], note: 'managed' },
    });
    expect(canonical.aliases).toEqual(expect.arrayContaining(['official-existing', 'Rossi', manualId, '洛茜']));

    expect(state.history[0].character_id).toBe(officialId);
    expect(state.pools[0].featured_characters).toEqual([officialId]);
    expect(state.pool_characters.some((row) => row.character_id === manualId)).toBe(false);
    expect(state.pool_characters).toEqual(
      expect.arrayContaining([
        { pool_id: 'pool-limited', character_id: officialId, is_up: true, created_at: 'manual-link' },
        { pool_id: 'pool-existing', character_id: officialId, is_up: true, created_at: 'official-existing' },
      ])
    );
  });

  it('keeps the manual avatar when the official ID has no existing row', async () => {
    const manualId = 'char_manual_lizhiyan_abc123';
    const officialId = 'chr_0032_lizhiyan';
    const state = {
      characters: [
        {
          id: manualId,
          name: '黎知言',
          type: 'character',
          rarity: 6,
          aliases: [],
          avatar_url: `/avatars/characters/${manualId}.png`,
          is_limited: false,
          release_date: null,
          pool_config: { pools: [] },
          created_at: '2026-07-01T00:00:00.000Z',
        },
      ],
      pool_characters: [],
      pools: [],
      history: [],
      character_id_aliases: [],
    };

    const result = await reconcileOfficialCharacterIds(createQueryClient(state), [
      { id: officialId, name: '黎知言', type: 'character', rarity: 6 },
    ]);

    expect(result).toMatchObject({ migrated: 1 });
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0]).toMatchObject({
      id: officialId,
      avatar_url: `/avatars/characters/${manualId}.png`,
    });
    expect(state.characters[0].aliases).toContain(manualId);
  });
});
