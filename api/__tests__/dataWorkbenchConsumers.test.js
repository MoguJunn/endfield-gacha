import { describe, it, expect, vi } from 'vitest';
import { buildWorkbenchAnalytics } from '../../shared/dataWorkbenchAnalytics.js';
import { loadPublicWorkbenchAnalytics, loadWorkbenchEntriesForAnalytics } from '../_lib/dataWorkbenchAnalytics.js';
import { buildPersonalAnalysisSnapshots } from '../../src/utils/personalAnalysisSnapshot.js';
import { fetchGlobalSummary } from '../_lib/publicCatalog.js';
import { STATISTICS_SNAPSHOT_VERSION } from '../../shared/statisticsRefreshPolicy.js';

const pools = [{ id: 'special_test', pool_id: 'special_test', name: '限定', type: 'limited' }, { id: 'standard_test', pool_id: 'standard_test', name: '常驻', type: 'standard' }];
const entities = [{ id: 'four', type: 'character', rarity: 4, name: '四星', release_date: '2026-01-01' }, { id: 'six', type: 'character', rarity: 6, name: '六星', release_date: '2026-01-01' }];
const summary = { id: 'private-db', entry_id: 'private-entry', draft_id: 'private-draft', user_id: 'owner', game_uid: '100', server_scope: 'cn:official', pool_id: 'special_test', kind: 'pool-summary', time_precision: 'range', values: { rangeStart: '2026-02-01T00:00:00Z', rangeEnd: '2026-03-01T00:00:00Z', drawMethod: 'normal', totalPulls: 180, sixStarCount: 3 } };
const history = Array.from({ length: 100 }, (_, index) => ({ id: `${index}`, ...{ user_id: summary.user_id, game_uid: summary.game_uid, server_scope: summary.server_scope, pool_id: summary.pool_id }, character_id: index < 2 ? 'six' : 'four', rarity: index < 2 ? 6 : 4, timestamp: Date.parse('2026-02-02T00:00:00Z') }));

function database(tables, failures = {}) {
  return {
    rpc: async () => ({ data: { schema_version: STATISTICS_SNAPSHOT_VERSION,
      payload: { totalPulls: 100, byType: {} }, computed_at: new Date().toISOString() }, error: null }),
    from(table) {
      let rows = [...(tables[table] || [])];
      const query = {
        select: () => query, order: () => query,
        is: (key, value) => { rows = rows.filter(row => (row[key] ?? null) === value); return query; },
        eq: (key, value) => { rows = rows.filter(row => row[key] === value); return query; },
        in: (key, values) => { rows = rows.filter(row => values.includes(row[key])); return query; },
        range: async (from, to) => ({ data: rows.slice(from, to + 1), error: failures[table] || null }),
        then: (resolve, reject) => Promise.resolve({ data: rows, error: failures[table] || null }).then(resolve, reject),
      };
      return query;
    },
  };
}

describe('workbench analytics consumers', () => {
  it('retains numeric timestamps and subtracts overlap per owner, UID and server', () => {
    const foreign = { ...summary, id: 'other-db', user_id: 'other-owner' };
    const intl = { ...summary, id: 'intl-db', server_scope: 'intl:asia' };
    const result = buildWorkbenchAnalytics({ entries: [summary, foreign, intl], history, pools, entities });
    expect(result.combined.totalPulls).toBe(540);
    expect(result.supplemental.totalPulls).toBe(440);
    expect(result.rates.sixStarRate).toBe(9 / 540);
    expect(result.combined.fourStarCount).toBe(98);
    expect(result.coverage.unknownFourStar).toBe(3);
  });

  it('keeps supplement-only accounts available for editing without contributing any statistics', () => {
    const model = buildPersonalAnalysisSnapshots({ userId: 'owner', history: [], pools, characters: entities, workbenchEntries: [summary] });
    expect(model.owner.accounts).toHaveLength(1);
    expect(model.scopes).toHaveLength(1);
    expect(model.owner.summary.total).toBe(0);
    expect(model.owner.summary).not.toHaveProperty('workbench');
    expect(model.scopes[0].payload).not.toHaveProperty('workbench');
    expect(model.scopes[0].payload.poolManifest).toHaveLength(1);
  });

  it('keeps full-potential evidence across pool type filters', () => {
    const proof = { ...summary, entry_id: 'proof', pool_id: 'standard_test', kind: 'potential-evidence', time_precision: 'second', values: { entityId: 'four', quantity: 6, timestamp: '2026-01-20T00:00:00Z', evidenceRef: 'inventory' } };
    const range = { ...summary, values: { ...summary.values, fourStarCount: 10, totalPulls: 10, sixStarCount: 0 } };
    const result = buildWorkbenchAnalytics({ entries: [proof, range], pools, entities });
    expect(result.resource.rangeExcessAic).toBe(50);
    expect(result.byType.limited.resource.rangeExcessAic).toBe(50);
    expect(result.byType.standard.resource.rangeExcessAic).toBe(0);
  });

  it('does not publish supplemental rates or counts in public statistics', async () => {
    const db = database({ account_data_workbench_entries: [summary], history, pools, characters: entities });
    const workbench = await loadPublicWorkbenchAnalytics(db);
    db.rpc = async () => ({ data: { schema_version: STATISTICS_SNAPSHOT_VERSION,
      payload: { totalPulls: 100, workbench }, computed_at: new Date().toISOString() }, error: null });
    db.from = () => { throw new Error('读取已发布统计时不应重算历史'); };
    const result = await fetchGlobalSummary(db);
    expect(result.totalPulls).toBe(100);
    expect(result.workbench).toMatchObject({ status: 'excluded', combined: { totalPulls: 0 }, supplemental: { totalPulls: 0 } });
    expect(JSON.stringify(result.workbench)).not.toMatch(/private-db|private-entry|private-draft|cn:official|evidenceRef/);
  });

  it('never scans private ledgers or raw histories to build public supplemental statistics', async () => {
    const db = { from: vi.fn(() => { throw new Error('Private data must not be read'); }) };
    expect((await loadPublicWorkbenchAnalytics(db)).status).toBe('excluded');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('does not serve a partial supplement result after a lookup failure', async () => {
    const db = database({ account_data_workbench_entries: [summary] }, { history: { code: 'timeout' } });
    const result = await loadPublicWorkbenchAnalytics(db);
    expect(result.status).toBe('excluded');
    expect(result.combined.totalPulls).toBe(0);
    expect((await fetchGlobalSummary(db)).totalPulls).toBe(100);
  });

  it('reads beyond one page of persisted supplements', async () => {
    const entries = Array.from({ length: 1001 }, (_, index) => ({ ...summary, id: `${index}`, user_id: `u${index}` }));
    const result = await loadWorkbenchEntriesForAnalytics(database({ account_data_workbench_entries: entries }), summary.user_id);
    expect(result.entries).toHaveLength(0);
    const ownEntries = entries.map(row => ({ ...row, user_id: summary.user_id }));
    expect((await loadWorkbenchEntriesForAnalytics(database({ account_data_workbench_entries: ownEntries }), summary.user_id)).entries).toHaveLength(1001);
  });
});
