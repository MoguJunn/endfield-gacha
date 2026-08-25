// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  reconcileOfficialCharacterIds,
  reconcileOfficialPoolIds,
} from '../../backend/lib/officialIdReconciliation.js';

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
    async rpc(functionName, args) {
      if (!Array.isArray(state.rpcCalls)) {
        state.rpcCalls = [];
      }
      state.rpcCalls.push({ functionName, args });

      if (state.rpcError) {
        return { data: null, error: state.rpcError };
      }

      if (functionName === 'promote_manual_pool_to_official_id') {
        const manualPool = tableRows(state, 'pools').find(
          (pool) => pool.pool_id === args.p_manual_pool_id
        );
        state.pools = tableRows(state, 'pools').filter(
          (pool) => pool.pool_id !== args.p_manual_pool_id
            && pool.pool_id !== args.p_official_pool.pool_id
        );
        state.pools.push({ ...manualPool, ...args.p_official_pool });
        state.history = tableRows(state, 'history').map((row) => (
          row.pool_id === args.p_manual_pool_id
            ? { ...row, pool_id: args.p_official_pool.pool_id }
            : row
        ));
        state.pool_characters = tableRows(state, 'pool_characters').map((row) => (
          row.pool_id === args.p_manual_pool_id
            ? { ...row, pool_id: args.p_official_pool.pool_id }
            : row
        ));
      }

      return { data: { promoted: true }, error: null };
    },
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

describe('reconcileOfficialPoolIds', () => {
  it('keeps unknown ID prefixes blocked outside the trusted official import path', async () => {
    const state = {
      pools: [],
      history: [],
      pool_characters: [],
      pool_id_aliases: [],
    };

    const result = await reconcileOfficialPoolIds(createQueryClient(state), [{
      pool_id: 'reconstruction_9_0_1',
      name: '绚丽异彩',
      type: 'limited',
      up_character: '伊冯',
    }]);

    expect(result).toEqual({ created: 0, migrated: 0, skipped: 0, operations: [] });
    expect(state.pools).toEqual([]);
  });

  it('promotes official IDs without assuming reconstruction pool prefixes', async () => {
    const characterManualId = 'joint_manual_extra_reconstruction_yvonne_p1';
    const weaponManualId = 'joint_manual_extra_reconstruction_arttyrant_p1';
    const state = {
      pools: [
        {
          pool_id: characterManualId,
          name: '绚丽异彩',
          type: 'extra',
          extra_subtype: 'reconstruction',
          extra_rule_profile: 'reconstruction_character_v1',
          extra_series_key: 'reconstruction-xuesong-youmeng',
          extra_series_phase: 1,
          start_time: '2026-09-24T12:00:00+08:00',
          end_time: null,
          up_character: '伊冯',
          featured_characters: ['chr_0017_yvonne'],
          description: '版本更新维护前结束',
          banner_url: '/banners/yvonne.webp',
          locked: true,
          user_id: null,
        },
        {
          pool_id: weaponManualId,
          name: '点绘申领',
          type: 'extra',
          extra_subtype: 'reconstruction',
          extra_rule_profile: 'reconstruction_weapon_v1',
          extra_series_key: 'reconstruction-xuesong-youmeng',
          extra_series_phase: 1,
          start_time: '2026-09-24T12:00:00+08:00',
          end_time: null,
          up_character: '艺术暴君',
          featured_characters: ['wpn_pistol_0010'],
          description: '版本更新维护前结束',
          banner_url: '/banners/arttyrant.webp',
          locked: true,
          user_id: null,
        },
      ],
      history: [
        { record_id: 'character-history', pool_id: characterManualId },
        { record_id: 'weapon-history', pool_id: weaponManualId },
      ],
      pool_characters: [
        { pool_id: characterManualId, character_id: 'chr_0017_yvonne', is_up: true },
        { pool_id: weaponManualId, character_id: 'wpn_pistol_0010', is_up: true },
      ],
      pool_id_aliases: [],
      rpcCalls: [],
    };

    const result = await reconcileOfficialPoolIds(createQueryClient(state), [
      {
        pool_id: 'reconstruction_9_0_1',
        name: '绚丽异彩',
        type: 'limited',
        start_time: '2026-09-24T12:00:00+08:00',
        up_character: '伊冯',
      },
      {
        pool_id: 'reclaim_9_0_2',
        name: '点绘申领',
        type: 'extra',
        start_time: '2026-09-24T12:00:00+08:00',
        up_character: '艺术暴君',
      },
    ], { allowUnknownOfficialIds: true });

    expect(result).toMatchObject({ migrated: 2, skipped: 0 });
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls.map((call) => call.functionName)).toEqual([
      'promote_manual_pool_to_official_id',
      'promote_manual_pool_to_official_id',
    ]);

    const characterPayload = state.rpcCalls[0].args.p_official_pool;
    expect(characterPayload).toMatchObject({
      pool_id: 'reconstruction_9_0_1',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'reconstruction-xuesong-youmeng',
      extra_series_phase: 1,
      description: '版本更新维护前结束',
      banner_url: '/banners/yvonne.webp',
      locked: true,
      user_id: null,
    });

    const weaponPayload = state.rpcCalls[1].args.p_official_pool;
    expect(weaponPayload).toMatchObject({
      pool_id: 'reclaim_9_0_2',
      type: 'extra',
      extra_subtype: 'reconstruction_claim',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'reconstruction-xuesong-youmeng',
      extra_series_phase: 1,
      description: '版本更新维护前结束',
      banner_url: '/banners/arttyrant.webp',
      locked: true,
      user_id: null,
    });
    expect(state.pools.map((pool) => pool.pool_id)).toEqual(
      expect.arrayContaining(['reconstruction_9_0_1', 'reclaim_9_0_2'])
    );
    expect(state.pools.some((pool) => pool.pool_id === characterManualId)).toBe(false);
    expect(state.pools.some((pool) => pool.pool_id === weaponManualId)).toBe(false);
  });

  it('uses the compatibility migration only when PostgREST reports PGRST202', async () => {
    const manualId = 'joint_manual_extra_reconstruction_yvonne_p1';
    const state = {
      pools: [{
        pool_id: manualId,
        name: '绚丽异彩',
        type: 'extra',
        extra_subtype: 'reconstruction',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'reconstruction-xuesong-youmeng',
        extra_series_phase: 1,
        start_time: '2026-09-24T12:00:00+08:00',
        up_character: '伊冯',
        locked: true,
      }],
      history: [{ pool_id: manualId }],
      pool_characters: [],
      pool_id_aliases: [],
      rpcError: { code: 'PGRST202', message: 'function not found in schema cache' },
    };

    const result = await reconcileOfficialPoolIds(createQueryClient(state), [{
      pool_id: 'joint_9_0_1',
      name: '绚丽异彩',
      type: 'extra',
      start_time: '2026-09-24T12:00:00+08:00',
      up_character: '伊冯',
    }]);

    expect(result).toMatchObject({ migrated: 1 });
    expect(result.operations[0]).toMatchObject({ promotionMode: 'compatibility' });
    expect(state.history[0].pool_id).toBe('joint_9_0_1');
    expect(state.pools.some((pool) => pool.pool_id === manualId)).toBe(false);
  });
});

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
