import assert from 'node:assert/strict';
import {
  reconcileOfficialCharacterIds,
  reconcileOfficialPoolIds,
} from '../backend/lib/officialIdReconciliation.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getConflictColumns(table, options = {}) {
  if (options.onConflict) {
    return String(options.onConflict).split(',').map(item => item.trim()).filter(Boolean);
  }
  if (table === 'pools') return ['pool_id'];
  if (table === 'characters') return ['id'];
  if (table === 'pool_id_aliases' || table === 'character_id_aliases') return ['source', 'alias_id'];
  if (table === 'pool_characters') return ['pool_id', 'character_id'];
  return ['id'];
}

function matchesFilters(row, filters) {
  return filters.every((filter) => {
    if (filter.op === 'eq') {
      return row[filter.column] === filter.value;
    }
    return true;
  });
}

function createQuery(state, table, operation = 'select', payload = null) {
  const filters = [];
  const query = {
    eq(column, value) {
      filters.push({ op: 'eq', column, value });
      return query;
    },
    limit() {
      return query;
    },
    then(resolve, reject) {
      try {
        const rows = state[table] || [];
        if (operation === 'select') {
          return Promise.resolve({
            data: clone(rows.filter(row => matchesFilters(row, filters))),
            error: null,
          }).then(resolve, reject);
        }

        if (operation === 'update') {
          rows.forEach((row) => {
            if (matchesFilters(row, filters)) {
              Object.assign(row, clone(payload));
            }
          });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }

        if (operation === 'delete') {
          state[table] = rows.filter(row => !matchesFilters(row, filters));
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }

        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    },
  };
  return query;
}

function upsertRows(state, table, rows, options = {}) {
  const conflictColumns = getConflictColumns(table, options);
  if (!state[table]) {
    state[table] = [];
  }

  for (const row of rows || []) {
    const existing = state[table].find(item => conflictColumns.every(column => item[column] === row[column]));
    if (existing) {
      Object.assign(existing, clone(row));
    } else {
      state[table].push(clone(row));
    }
  }
}

function createAdminClient(initialState) {
  const state = clone(initialState);
  return {
    async rpc(functionName) {
      if (functionName === 'promote_manual_pool_to_official_id') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Verification client exercises the compatibility migration path',
          },
        };
      }
      return { data: null, error: null };
    },
    from(table) {
      return {
        select() {
          return createQuery(state, table, 'select');
        },
        update(values) {
          return createQuery(state, table, 'update', values);
        },
        delete() {
          return createQuery(state, table, 'delete');
        },
        async upsert(rows, options) {
          upsertRows(state, table, rows, options);
          return { data: rows, error: null };
        },
      };
    },
    __state: state,
  };
}

const manualPoolId = 'special_manual_limited_mifu_20260605_abc123';
const officialPoolId = 'special_2_0_1';
const manualCharacterId = 'char_manual_mifu_abc123';
const officialCharacterId = 'char_002_mifu';

const adminClient = createAdminClient({
  pools: [
    {
      pool_id: manualPoolId,
      name: '拳出无悔（前瞻）',
      type: 'limited',
      start_time: '2026-06-05T04:00:00.000Z',
      end_time: null,
      up_character: '弭弗',
      featured_characters: [manualCharacterId],
      user_id: 'admin-user',
    },
  ],
  characters: [
    {
      id: manualCharacterId,
      name: '弭弗',
      type: 'character',
      rarity: 6,
      aliases: ['弭弗'],
    },
  ],
  history: [
    {
      record_id: 1,
      user_id: 'user-1',
      game_uid: 'game-1',
      pool_id: manualPoolId,
      seq_id: '1001',
      character_id: manualCharacterId,
      updated_at: null,
    },
  ],
  pool_characters: [
    {
      pool_id: manualPoolId,
      character_id: manualCharacterId,
      is_up: true,
      created_at: '2026-06-01T00:00:00.000Z',
    },
  ],
  pool_id_aliases: [
    {
      source: 'manual_placeholder',
      alias_id: manualPoolId,
      pool_id: manualPoolId,
      is_primary: true,
    },
  ],
  character_id_aliases: [
    {
      source: 'manual_placeholder',
      alias_id: manualCharacterId,
      character_id: manualCharacterId,
      is_primary: true,
    },
  ],
});

const poolResult = await reconcileOfficialPoolIds(adminClient, [{
  pool_id: officialPoolId,
  name: '拳出无悔',
  type: 'limited',
  up_character: '弭弗',
}], {
  userId: 'admin-user',
});

assert.equal(poolResult.migrated, 1, '官方 poolId 应唯一命中并迁移手动池');
assert.ok(adminClient.__state.pools.some(pool => pool.pool_id === officialPoolId), '官方池主记录应存在');
assert.ok(!adminClient.__state.pools.some(pool => pool.pool_id === manualPoolId), '手动池主记录应退场');
assert.equal(adminClient.__state.history[0].pool_id, officialPoolId, 'history.pool_id 应迁到官方池');
assert.equal(adminClient.__state.pool_characters[0].pool_id, officialPoolId, 'pool_characters.pool_id 应迁到官方池');
assert.ok(adminClient.__state.pool_id_aliases.some(row => (
  row.source === 'manual_placeholder'
  && row.alias_id === manualPoolId
  && row.pool_id === officialPoolId
)), '手动池 ID 应保留为指向官方池的 alias');

const characterResult = await reconcileOfficialCharacterIds(adminClient, [{
  charId: officialCharacterId,
  charName: '弭弗',
  rarity: 6,
}]);

assert.equal(characterResult.migrated, 1, '官方 charId 应唯一命中并迁移手动角色');
assert.ok(adminClient.__state.characters.some(character => character.id === officialCharacterId), '官方角色主记录应存在');
assert.ok(!adminClient.__state.characters.some(character => character.id === manualCharacterId), '手动角色主记录应退场');
assert.equal(adminClient.__state.history[0].character_id, officialCharacterId, 'history.character_id 应迁到官方角色');
assert.equal(adminClient.__state.pool_characters[0].character_id, officialCharacterId, 'pool_characters.character_id 应迁到官方角色');
assert.deepEqual(adminClient.__state.pools[0].featured_characters, [officialCharacterId], 'featured_characters 应替换成官方角色 ID');
assert.ok(adminClient.__state.character_id_aliases.some(row => (
  row.source === 'manual_placeholder'
  && row.alias_id === manualCharacterId
  && row.character_id === officialCharacterId
)), '手动角色 ID 应保留为指向官方角色的 alias');

const canonicalCatcherId = 'chr_0020_meurs';
const rawCatcherId = '45';
adminClient.__state.characters.push(
  {
    id: canonicalCatcherId,
    name: '卡契尔',
    type: 'character',
    rarity: 4,
    aliases: ['Catcher'],
    avatar_url: '/avatars/characters/chr_0020_meurs.webp',
  },
  {
    id: rawCatcherId,
    name: '卡契尔',
    type: 'character',
    rarity: 4,
    aliases: [],
    avatar_url: null,
  }
);
adminClient.__state.history.push({
  record_id: 2,
  user_id: 'user-1',
  game_uid: 'game-1',
  pool_id: officialPoolId,
  seq_id: '1002',
  character_id: rawCatcherId,
  updated_at: null,
});
adminClient.__state.pool_characters.push({
  pool_id: officialPoolId,
  character_id: rawCatcherId,
  is_up: false,
  created_at: '2026-06-01T00:00:00.000Z',
});
adminClient.__state.pools[0].featured_characters = [rawCatcherId];
adminClient.__state.character_id_aliases.push(
  {
    source: 'internal',
    alias_id: rawCatcherId,
    character_id: rawCatcherId,
    is_primary: true,
  },
  {
    source: 'official_api',
    alias_id: rawCatcherId,
    character_id: rawCatcherId,
    is_primary: true,
  }
);

const rawAliasResult = await reconcileOfficialCharacterIds(adminClient, [{
  charId: rawCatcherId,
  charName: '卡契尔',
  rarity: 4,
}]);

assert.equal(rawAliasResult.created, 0, '数字 raw ID 不应创建新的角色主记录');
assert.equal(rawAliasResult.rawDuplicatesRetired, 1, '已存在的数字重复角色应退场');
assert.ok(!adminClient.__state.characters.some(character => character.id === rawCatcherId), '数字角色主记录应被删除');
assert.equal(adminClient.__state.history.find(row => row.record_id === 2).character_id, canonicalCatcherId, 'history.character_id 应从数字 ID 改回 canonical ID');
assert.ok(adminClient.__state.pool_characters.some(row => (
  row.pool_id === officialPoolId
  && row.character_id === canonicalCatcherId
)), 'pool_characters.character_id 应从数字 ID 改回 canonical ID');
assert.deepEqual(adminClient.__state.pools[0].featured_characters, [canonicalCatcherId], 'featured_characters 应从数字 ID 改回 canonical ID');
assert.ok(adminClient.__state.character_id_aliases.some(row => (
  row.source === 'official_api'
  && row.alias_id === rawCatcherId
  && row.character_id === canonicalCatcherId
)), '数字 raw ID 应保留为指向 canonical ID 的 official_api alias');

console.log('DATA-NEW-018 official import ID reconciliation verification passed');
