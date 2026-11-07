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

function createQueryClient(state, { rowLimit = 1000, failPage, changeCount, failOperation } = {}) {
  const events = [];
  function failure(event) {
    events.push(event);
    return failOperation?.(event) ? { code: 'TEST_FAILURE', message: 'injected operation failure' } : null;
  }
  return {
    events,
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
        select(columns = '*', options = {}) {
          let sortKey;
          let bounds;
          const filters = [];
          const execute = async () => {
            const [from, to] = bounds || [0, rowLimit - 1];
            const error = failure({ tableName, action: 'select', from, filters });
            if (error) return { data: null, count: null, error };
            if (failPage === from) return { data: null, count: null, error: { code: '57014', message: 'statement timeout' } };
            const rows = [...tableRows(state, tableName)].filter(row => filters.every(([key, value]) => normalizeText(row[key]) === normalizeText(value)));
            if (sortKey) rows.sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
            const page = rows.slice(from, Math.min(to + 1, from + rowLimit));
            return {
              data: structuredClone(columns === '*' ? page : page.map(row => Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])))),
              count: options.count === 'exact' ? rows.length + (from > 0 && changeCount ? 1 : 0) : null,
              error: null,
            };
          };
          const query = {
            limit: value => { bounds = [0, value - 1]; return query; },
            order: key => { sortKey = key; return query; },
            range: (from, to) => { bounds = [from, to]; return query; },
            eq: (key, value) => { filters.push([key, value]); return query; },
            then: (resolve, reject) => execute().then(resolve, reject),
          };
          return query;
        },
        update(values) {
          return {
            eq: async (columnName, value) => {
              const error = failure({ tableName, action: 'update', columnName, value, values });
              if (error) return { error };
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
              const error = failure({ tableName, action: 'delete', columnName, value });
              if (error) return { error };
              state[tableName] = tableRows(state, tableName).filter(
                (row) => normalizeText(row?.[columnName]) !== normalizeText(value)
              );
              return { error: null };
            },
          };
        },
        async upsert(rows, options = {}) {
          const incomingRows = Array.isArray(rows) ? rows : [rows];
          const error = failure({ tableName, action: 'upsert', rows: incomingRows });
          if (error) return { error };
          const keys = options.onConflict?.split(',') || ['id'];
          const target = tableRows(state, tableName);
          for (const row of incomingRows) {
            const index = target.findIndex(item => keys.every(key => item[key] === row[key]));
            if (index < 0) target.push(structuredClone(row));
            else target[index] = { ...target[index], ...structuredClone(row) };
          }
          return { error: null };
        },
      };
    },
  };
}

describe('reconcileOfficialPoolIds', () => {
  it('preserves existing pool metadata beyond a server-capped first page', async () => {
    const target = { pool_id: 'special_target', name: '目标池', type: 'limited', description: '保留说明', banner_url: '/keep.png', locked: true, user_id: 'managed-owner', featured_characters: ['chr_keep'] };
    const state = {
      pools: [...Array.from({ length: 230 }, (_, i) => ({ pool_id: `pool_${String(i).padStart(3, '0')}`, name: `其他${i}`, type: 'standard' })), target],
      history: [], pool_characters: [], pool_id_aliases: [],
    };
    await reconcileOfficialPoolIds(createQueryClient(state, { rowLimit: 73 }), [{ pool_id: target.pool_id, name: target.name, type: target.type }]);
    const row = state.pools.find(item => item.pool_id === target.pool_id);
    expect(state.pools.filter(item => item.pool_id === target.pool_id)).toHaveLength(1);
    expect(row).toMatchObject({ description: target.description, banner_url: target.banner_url, locked: true, user_id: target.user_id, featured_characters: target.featured_characters });
  });

  it.each([{ failPage: 200 }, { changeCount: true }])('does not mutate a catalog when a later page is unreadable or changes: %j', async options => {
    const state = {
      pools: Array.from({ length: 230 }, (_, i) => ({ pool_id: `pool_${i}`, name: `池${i}`, type: 'standard' })),
      history: [], pool_characters: [], pool_id_aliases: [],
    };
    const before = structuredClone(state);
    await expect(reconcileOfficialPoolIds(createQueryClient(state, options), [{ pool_id: 'special_new', name: '新池', type: 'limited' }]))
      .rejects.toMatchObject({ code: options.failPage ? '57014' : 'IMPORT_CATALOG_INCOMPLETE' });
    expect(state).toEqual(before);
  });

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
  it('preserves a managed character beyond 1000 rows when REST pages are capped', async () => {
    const target = { id: 'chr_zz_target', name: '目标角色', type: 'character', rarity: 6, aliases: ['managed'], avatar_url: '/managed.png', is_limited: true, pool_config: { pools: ['keep'] } };
    const state = {
      characters: [...Array.from({ length: 1001 }, (_, i) => ({ id: `chr_${String(i).padStart(4, '0')}`, name: `其他角色${i}`, type: 'character', rarity: 4 })), target],
      history: [], pools: [], pool_characters: [], character_id_aliases: [],
    };
    await reconcileOfficialCharacterIds(createQueryClient(state, { rowLimit: 73 }), [{ id: target.id, name: target.name, type: target.type, rarity: 6 }]);
    expect(state.characters.find(row => row.id === target.id)).toMatchObject({ avatar_url: '/managed.png', is_limited: true, pool_config: { pools: ['keep'] } });
  });

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

describe('safe association migration', () => {
  const sourcePoolId = 'special_manual_safety_abc123';
  const targetPoolId = 'special_safety';
  const poolInput = [{ pool_id: targetPoolId, name: '安全测试池', type: 'limited', up_character: '定向角色' }];
  const poolState = () => ({
    pools: [{ pool_id: sourcePoolId, name: '安全测试池', type: 'limited', up_character: '定向角色' }],
    pool_characters: [
      ...Array.from({ length: 7 }, (_, i) => ({ pool_id: sourcePoolId, character_id: `chr_${i}`, is_up: i === 6, created_at: 'source' })),
      { pool_id: targetPoolId, character_id: 'chr_0', is_up: true, created_at: 'target' },
    ],
    pool_id_aliases: [{ source: 'official_api', alias_id: 'previous_pool_id', pool_id: sourcePoolId }],
    history: [{ record_id: 'record', pool_id: sourcePoolId }],
  });

  it('moves every association across capped pages, preserves UP flags and redirects pre-existing aliases', async () => {
    const state = poolState();
    const client = createQueryClient(state, { rowLimit: 2 });
    await reconcileOfficialPoolIds(client, poolInput);
    expect(state.pool_characters).toHaveLength(7);
    expect(state.pool_characters.every(row => row.pool_id === targetPoolId)).toBe(true);
    expect(state.pool_characters.find(row => row.character_id === 'chr_0')).toMatchObject({ is_up: true, created_at: 'target' });
    expect(state.pool_characters.find(row => row.character_id === 'chr_6').is_up).toBe(true);
    expect(state.pool_id_aliases.find(row => row.alias_id === 'previous_pool_id').pool_id).toBe(targetPoolId);
    expect(state.history[0].pool_id).toBe(targetPoolId);
    expect(state.pools.some(row => row.pool_id === sourcePoolId)).toBe(false);
    const first = structuredClone(state);
    await reconcileOfficialPoolIds(client, poolInput);
    expect(state).toEqual(first);
  });

  it('retains the source associations when a later roster page fails', async () => {
    const state = poolState();
    const original = structuredClone(state.pool_characters);
    const client = createQueryClient(state, { rowLimit: 2, failOperation: event => event.tableName === 'pool_characters' && event.action === 'select' && event.from === 2 });
    await expect(reconcileOfficialPoolIds(client, poolInput)).rejects.toMatchObject({ code: 'TEST_FAILURE' });
    expect(state.pool_characters).toEqual(original);
    expect(state.pools.some(row => row.pool_id === sourcePoolId)).toBe(true);
    expect(client.events.some(event => event.tableName === 'pool_characters' && event.action === 'delete')).toBe(false);
  });

  it.each([
    ['pool_id_aliases', 'upsert'], ['history', 'update'], ['pool_characters', 'upsert'],
    ['pool_characters', 'delete'], ['pool_id_aliases', 'update'], ['pools', 'delete'],
  ])('retains a recoverable source after %s %s fails and converges on retry', async (tableName, action) => {
    const state = poolState();
    let failed = false;
    const client = createQueryClient(state, { rowLimit: 2, failOperation: event => {
      if (!failed && event.tableName === tableName && event.action === action) { failed = true; return true; }
      return false;
    } });
    await expect(reconcileOfficialPoolIds(client, poolInput)).rejects.toMatchObject({ code: 'TEST_FAILURE' });
    expect(state.pools.some(row => row.pool_id === sourcePoolId)).toBe(true);
    // Source rows or their copies must remain reachable throughout recovery.
    expect(new Set(state.pool_characters.map(row => row.character_id)).size).toBe(7);
    await reconcileOfficialPoolIds(client, poolInput);
    expect(state.pools.some(row => row.pool_id === sourcePoolId)).toBe(false);
    expect(state.pool_characters).toHaveLength(7);
    expect(state.pool_characters.every(row => row.pool_id === targetPoolId)).toBe(true);
    expect(state.pool_id_aliases.every(row => row.pool_id === targetPoolId)).toBe(true);
  });

  const sourceCharacterId = 'char_manual_rossi_abc123';
  const targetCharacterId = 'chr_rossi';
  const characterInput = [{ id: targetCharacterId, name: '洛茜', type: 'character', rarity: 6 }];
  const characterState = () => ({
    characters: [{ id: sourceCharacterId, name: '洛茜', type: 'character', rarity: 6, avatar_url: '/keep.png' }],
    pools: Array.from({ length: 5 }, (_, i) => ({ pool_id: `pool_${i}`, featured_characters: [sourceCharacterId] })),
    pool_characters: Array.from({ length: 5 }, (_, i) => ({ pool_id: `pool_${i}`, character_id: sourceCharacterId, is_up: i === 3 })),
    character_id_aliases: [{ source: 'official_api', alias_id: 'previous_raw_id', character_id: sourceCharacterId }],
    history: [{ record_id: 'record', character_id: sourceCharacterId }],
  });

  it('moves all character rosters and featured references, including an existing raw alias', async () => {
    const state = characterState();
    await reconcileOfficialCharacterIds(createQueryClient(state, { rowLimit: 2 }), [
      ...characterInput, { id: 'new_raw_id', name: '洛茜', type: 'character', rarity: 6 },
    ]);
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0].id).toBe(targetCharacterId);
    expect(state.pool_characters).toHaveLength(5);
    expect(state.pool_characters.every(row => row.character_id === targetCharacterId)).toBe(true);
    expect(state.pools.every(row => row.featured_characters[0] === targetCharacterId)).toBe(true);
    expect(state.character_id_aliases.every(row => row.character_id === targetCharacterId)).toBe(true);
    expect(state.character_id_aliases.find(row => row.alias_id === 'new_raw_id').character_id).toBe(targetCharacterId);
  });

  it.each([
    ['character_id_aliases', 'upsert'], ['history', 'update'], ['pool_characters', 'upsert'],
    ['pool_characters', 'delete'], ['pools', 'update'], ['character_id_aliases', 'update'], ['characters', 'delete'],
  ])('keeps a manual character recoverable after %s %s fails', async (tableName, action) => {
    const state = characterState();
    let failed = false;
    const client = createQueryClient(state, { rowLimit: 2, failOperation: event => {
      if (!failed && event.tableName === tableName && event.action === action) { failed = true; return true; }
      return false;
    } });
    await expect(reconcileOfficialCharacterIds(client, characterInput)).rejects.toMatchObject({ code: 'TEST_FAILURE' });
    expect(state.characters.some(row => row.id === sourceCharacterId)).toBe(true);
    expect(new Set(state.pool_characters.map(row => row.pool_id)).size).toBe(5);
    await reconcileOfficialCharacterIds(client, characterInput);
    expect(state.characters).toHaveLength(1);
    expect(state.pool_characters).toHaveLength(5);
    expect(state.pool_characters.every(row => row.character_id === targetCharacterId)).toBe(true);
    expect(state.character_id_aliases.every(row => row.character_id === targetCharacterId)).toBe(true);
    expect(state.pools.every(row => row.featured_characters[0] === targetCharacterId)).toBe(true);
  });

  it('persists raw aliases before deleting any duplicate raw character', async () => {
    const state = characterState();
    state.characters[0].id = 'raw_rossi';
    state.characters.push({ ...characterInput[0], avatar_url: '/official.png' });
    state.pool_characters = state.pool_characters.map(row => ({ ...row, character_id: 'raw_rossi' }));
    state.history[0].character_id = 'raw_rossi';
    state.pools = state.pools.map(row => ({ ...row, featured_characters: ['raw_rossi'] }));
    state.character_id_aliases = [];
    let fail = true;
    const client = createQueryClient(state, { rowLimit: 2, failOperation: event => {
      if (fail && event.tableName === 'character_id_aliases' && event.action === 'upsert') { fail = false; return true; }
      return false;
    } });
    const input = [{ id: 'raw_rossi', name: '洛茜', type: 'character', rarity: 6 }];
    await expect(reconcileOfficialCharacterIds(client, input)).rejects.toMatchObject({ code: 'TEST_FAILURE' });
    expect(state.characters.some(row => row.id === 'raw_rossi')).toBe(true);
    expect(client.events.some(event => event.action === 'delete')).toBe(false);
    await reconcileOfficialCharacterIds(client, input);
    expect(state.characters.some(row => row.id === 'raw_rossi')).toBe(false);
    expect(state.character_id_aliases.find(row => row.alias_id === 'raw_rossi').character_id).toBe(targetCharacterId);
    expect(state.pool_characters.every(row => row.character_id === targetCharacterId)).toBe(true);
  });

  it('rejects a missing update capability without deleting the source entity', async () => {
    const state = characterState();
    const client = createQueryClient(state);
    const from = client.from;
    client.from = table => table === 'history' ? { update: () => ({}) } : from(table);
    await expect(reconcileOfficialCharacterIds(client, characterInput)).rejects.toMatchObject({ code: 'IMPORT_CATALOG_CLIENT_INVALID' });
    expect(state.characters.some(row => row.id === sourceCharacterId)).toBe(true);
    expect(client.events.some(event => event.action === 'delete')).toBe(false);
  });
});
