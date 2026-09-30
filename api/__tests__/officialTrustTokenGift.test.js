// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ client: null, staged: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => state.client }));
vi.mock('../../backend/lib/officialImportStaging.js', () => ({
  stageOfficialImportTask: async (payload) => {
    state.staged = payload;
    return { task: { id: 'test-task' }, accessKey: 'test-key', records: [] };
  },
  confirmOfficialImportTask: async ({ commit }) => ({ result: await commit({
    task: { id: 'test-task', user_id: 'user-1', source: 'cn', summary: state.staged.importSummary },
    rows: state.staged.stagedRecords.map((record) => ({ normalized_record: {
      history: record.historyRecord, normalized: record.normalized,
      pool: state.staged.pools.find((pool) => pool.pool_id === record.historyRecord.pool_id),
    } })),
  }) }),
  getOfficialImportReview: vi.fn(), rejectOfficialImportTask: vi.fn(),
}));

import { executeFullImport, initSupabaseAdmin } from '../../backend/fullImportService.js';
import { buildPersonalAnalysisSnapshots } from '../../src/utils/personalAnalysisSnapshot.js';

describe('official trust-token import through analysis', () => {
  it('keeps 291 draws + ten free draws + a token, without advancing pity or duplicating the token', async () => {
    const pool = { pool_id: 'special_1_5_1', name: '冬猎', type: 'limited', up_character: '提弗洛斯' };
    const history = [];
    const commits = [];
    state.client = {
      auth: { admin: { getUserById: async () => ({ data: { user: { id: 'user-1' } } }) } },
      rpc: vi.fn(async (name, args) => {
        if (name === 'is_account_credential_allowed') return { data: true };
        if (name === 'commit_official_import_records') {
          commits.push(args);
          history.push(...args.p_history.map((row) => ({ ...row, user_id: 'user-1' })));
          return { data: { savedRecords: args.p_history.length, createdPools: 0 } };
        }
        return { data: {} };
      }),
      from: (table) => {
        let rows = table === 'pools' ? [pool] : table === 'history' ? history : [];
        const query = {
          select: () => query,
          eq: (column, value) => { if (['pool_id', 'type'].includes(column)) rows = rows.filter((row) => row[column] === value); return query; },
          in: (column, values) => { rows = rows.filter((row) => values.includes(row[column])); return query; },
          range: () => Promise.resolve({ data: rows }), limit: () => Promise.resolve({ data: rows }),
          then: (resolve) => Promise.resolve({ data: rows }).then(resolve),
          upsert: async () => ({ error: null }),
        };
        return query;
      },
    };
    initSupabaseAdmin('https://test.invalid', 'test-service-key');
    const timestamp = (i) => String(Date.UTC(2026, 8, 1, 0, 0, i));
    const record = (i, extra = {}) => ({ poolId: pool.pool_id, poolName: pool.name,
      seqId: String(i), charId: 'chr_test', charName: '普通角色', rarity: 4, gachaTs: timestamp(i), ...extra });
    const paid = Array.from({ length: 291 }, (_, i) => record(i + 1, {
      seqId: String(i < 240 ? i + 1 : i + 2),
      ...(i === 204 || i === 274 ? { rarity: 6, charName: '提弗洛斯' } : {}),
    }));
    const token = { poolId: pool.pool_id, poolName: pool.name, seqId: '241', nameText: '提弗洛斯的信物', gachaTs: timestamp(240) };
    const records = [...paid, token, ...Array.from({ length: 10 }, (_, i) => record(1000 + i, { isFree: true }))];
    const input = { token: 'AbCdEfGhIjKlMnOpQrStUvWx', userId: 'user-1', accountIndex: 0,
      source: 'cn', importMode: 'incremental', updateProgress: vi.fn(), authChainFunctions: {
        grantAppToken: async () => ({ success: true, data: { token: 'app' } }),
        fetchBindingList: async () => ({ success: true, data: { accounts: [{ gameUid: 'synthetic', serverId: '1' }] } }),
        fetchU8TokenByUid: async () => ({ success: true, data: { token: 'u8' } }),
        fetchAllRecordsConcurrent: async () => ({ success: true, data: { totalRecords: records.length,
          results: [{ type: 'char', poolType: 'E_CharacterGachaPoolType_Special', records }] } }),
      } };
    expect((await executeFullImport(input)).success).toBe(true);
    const gift = history.find((row) => row.seq_id === '241');
    expect(gift).toMatchObject({ special_type: 'gift', rarity: 6,
      character_name: '提弗洛斯', item_name: '提弗洛斯的信物', pity: 35, is_free: false });
    expect(history.find((row) => row.seq_id === '242').pity).toBe(36);
    expect(history.find((row) => row.seq_id === '276').pity).toBe(70);
    expect(state.staged.stagedRecords.find((row) => row.historyRecord.seq_id === '241').issues).toEqual([]);
    const snapshot = buildPersonalAnalysisSnapshots({ history, pools: [pool], userId: 'user-1' }).scopes[0].payload;
    const stats = snapshot.dashboard.views[pool.pool_id].excludeFree.stats;
    expect(stats).toMatchObject({ total: 291, paidTotal: 291, freePullCount: 10, totalSixStar: 2, gifts: { count: 1 } });
    expect(snapshot.dashboard.views[pool.pool_id].includeFree.stats.total).toBe(301);
    const timeline = snapshot.dashboard.timelineViews['zh-CN'][pool.pool_id][0];
    expect(timeline.entries.filter((entry) => entry.stageLabel === '赠送节点')).toHaveLength(1);
    expect(timeline.totalPulls).toBe(291);
    expect((await executeFullImport(input)).data.newRecords).toBe(0);
    expect(commits).toHaveLength(1);
    expect(history).toHaveLength(302);
  });
});
