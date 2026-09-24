import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ client: null, staged: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => state.client }));
vi.mock('../../backend/lib/officialImportStaging.js', () => ({
  stageOfficialImportTask: async (payload) => {
    state.staged = payload;
    return { task: { id: 'test-task' }, accessKey: 'test-key', records: [] };
  },
  confirmOfficialImportTask: async ({ commit }) => {
    const payload = state.staged;
    const rows = payload.stagedRecords.map((record) => ({
      normalized_record: { history: record.historyRecord, normalized: record.normalized,
        pool: payload.pools.find((pool) => pool.pool_id === record.historyRecord.pool_id) },
    }));
    const result = await commit({ task: { id: 'test-task', user_id: 'user-1', source: 'cn',
      import_mode: 'incremental', summary: payload.importSummary }, rows });
    return { task: { id: 'test-task' }, result };
  },
  getOfficialImportReview: vi.fn(), rejectOfficialImportTask: vi.fn(),
}));

import { executeFullImport, initSupabaseAdmin } from '../../backend/fullImportService.js';

describe('full import of official rerun occurrences', () => {
  it('updates an old missing version, merges a new official ID and repeats without new history', async () => {
    const catalog = [{ pool_id: 'rerun_wpn_yvonne', name: '点绘申领', type: 'extra',
      extra_subtype: 'reconstruction_claim', extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'original-series', extra_series_phase: 1, up_character: '艺术暴君' }];
    const history = [{ pool_id: catalog[0].pool_id, seq_id: '1', server_id: '1', pool_version: null }];
    const aliases = [];
    const commits = [];
    state.client = {
      auth: { admin: { getUserById: async () => ({ data: { user: { id: 'user-1' } } }) } },
      rpc: vi.fn(async (name, args) => {
        if (name === 'is_account_credential_allowed') return { data: true };
        if (name === 'commit_official_import_records') {
          commits.push(args);
          args.p_history.forEach((row) => {
            const old = history.find((item) => item.pool_id === row.pool_id && item.seq_id === row.seq_id);
            if (old) Object.assign(old, row); else history.push(row);
          });
          return { data: { savedRecords: args.p_history.length, createdPools: 0 } };
        }
        return { data: {} };
      }),
      from: (table) => {
        let rows = table === 'pools' ? catalog : table === 'history' ? history : table === 'pool_id_aliases' ? aliases : [];
        const query = {
          select: () => query,
          eq: (column, value) => { if (['pool_id', 'type', 'source'].includes(column)) rows = rows.filter((row) => row[column] === value); return query; },
          in: (column, values) => { rows = rows.filter((row) => values.includes(row[column])); return query; },
          range: () => Promise.resolve({ data: rows }), limit: () => Promise.resolve({ data: rows }),
          then: (resolve) => Promise.resolve({ data: rows }).then(resolve),
          upsert: async (values) => { if (table === 'pool_id_aliases') aliases.push(...values); return { error: null }; },
        };
        return query;
      },
    };
    initSupabaseAdmin('https://test.invalid', 'test-service-key');
    const authChainFunctions = {
      grantAppToken: async () => ({ success: true, data: { token: 'app' } }),
      fetchBindingList: async () => ({ success: true, data: { accounts: [{ gameUid: '100', serverId: '1' }] } }),
      fetchU8TokenByUid: async () => ({ success: true, data: { token: 'u8' } }),
      fetchAllRecordsConcurrent: async () => ({ success: true, data: { totalRecords: 3, results: [{
        type: 'weapon', records: [
          { poolId: 'rerun_wpn_yvonne', poolName: '点绘申领', poolType: 'rerun', poolVersion: 1,
            seqId: '1', weaponId: 'wpn_test', nameText: '艺术暴君', rarity: 6, gachaTs: '1790223900000' },
          { poolId: 'later-official-id', poolName: '点绘申领', poolType: 'rerun', poolVersion: 2,
            seqId: '2', weaponId: 'wpn_test', nameText: '艺术暴君', rarity: 6, gachaTs: '1791223900000' },
          { poolId: 'later-official-id', poolName: '点绘申领', poolType: 'rerun', poolVersion: 2,
            seqId: '3', kind: 'gift_intel_book', nameText: '寻访情报书', gachaTs: '1791223900000' },
        ],
      }] } }),
    };
    const input = { token: 'AbCdEfGhIjKlMnOpQrStUvWx', userId: 'user-1', accountIndex: 0,
      updateProgress: vi.fn(), authChainFunctions, source: 'cn', importMode: 'incremental' };
    const result = await executeFullImport(input);
    expect(result.success).toBe(true);
    expect(commits[0].p_history).toHaveLength(2);
    expect(commits[0].p_history.map((row) => [row.pool_id, row.pool_version, row.is_standard])).toEqual([
      ['rerun_wpn_yvonne', 1, false], ['rerun_wpn_yvonne', 2, false],
    ]);
    expect(commits[0].p_pools).toHaveLength(1);
    expect(commits[0].p_pools[0]).toMatchObject(catalog[0]);
    expect(aliases).toContainEqual(expect.objectContaining({ alias_id: 'later-official-id', pool_id: 'rerun_wpn_yvonne' }));
    const repeat = await executeFullImport(input);
    expect(repeat.data.newRecords).toBe(0);
    expect(history).toHaveLength(2);
    expect(commits).toHaveLength(1);
  });
});
