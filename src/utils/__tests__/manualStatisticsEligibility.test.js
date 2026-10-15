import { describe, expect, it } from 'vitest';
import { statisticsHistory } from '../../../shared/statisticsEligibility.js';
import { buildSummaryStats } from '../summaryStats.js';
import { buildPoolStats } from '../poolStats.js';
import { buildPersonalAnalysisSnapshots } from '../personalAnalysisSnapshot.js';

const pool = { id: 'standard', pool_id: 'standard', type: 'standard', name: '常驻寻访' };
const pull = (id, extra = {}) => ({ id, record_id: id, user_id: 'owner', game_uid: 'uid', server_id: '1',
  poolId: 'standard', pool_id: 'standard', rarity: 4, timestamp: '2026-10-01T00:00:00Z', ...extra });
const original = [pull('import-1'), pull('restored-import', { edit_version: 8, statistics_excluded: false })];
const excluded = [pull('edited', { rarity: 6, statistics_excluded: true }),
  pull('camel-edited', { rarity: 6, statisticsExcluded: true }),
  pull('manual_added', { rarity: 6, statistics_excluded: false }),
  pull('legacy-edit', { rarity: 6, editVersion: 2 })];

describe('manual data statistics exclusion', () => {
  it('excludes the entire account and server pool when any row has manual evidence', () => {
    expect(statisticsHistory([...original, ...excluded])).toEqual([]);
    const isolated = [pull('other-account', { game_uid: 'other' }), pull('other-server', { server_id: '2' }),
      pull('other-owner', { user_id: 'someone' }), pull('other-pool', { pool_id: 'another', poolId: 'another' })];
    expect(statisticsHistory([...original, ...excluded, ...isolated])).toEqual(isolated);
  });
  it('manual records cannot change local summary, pity, drop rates or resource metrics', () => {
    const summary = history => buildSummaryStats({ history, pools: [pool], user: { id: 'owner' } });
    const singlePool = history => buildPoolStats({ normalizedCurrentPoolHistory: history,
      currentPool: pool, poolCatalog: [pool], accountHistory: history });
    expect(summary([...original, ...excluded])).toEqual(summary([]));
    expect(singlePool([...original, ...excluded])).toEqual(singlePool([]));
    expect(buildPoolStats({ normalizedCurrentPoolHistory: original, currentPool: pool,
      accountHistory: [...original, ...excluded] })).toEqual(singlePool([]));
  });
  it('includes manual edits in private analysis while public calculations still exclude the scope', () => {
    const result = buildPersonalAnalysisSnapshots({ history: [...original, ...excluded], pools: [pool], userId: 'owner',
      workbenchEntries: [{ id: 'ledger', user_id: 'owner', game_uid: 'uid', server_scope: '1', pool_id: 'standard',
        kind: 'pool-ledger', values: { totalPulls: 9999, sixStarCount: 999 } }] });
    expect(result.owner.accounts[0].recordCount).toBe(original.length + excluded.length);
    expect(result.owner.summary.total).toBe(original.length + excluded.length);
    expect(result.owner.summary.sixStar).toBe(4);
    expect(result.scopes[0].payload.selector.totalPulls).toBe(6);
    expect(result.scopes[0].payload.dashboard.views.standard.excludeFree.stats.totalSixStar).toBe(4);
    expect(statisticsHistory([...original, ...excluded])).toEqual([]);
    expect(result.owner.summary).not.toHaveProperty('workbench');
  });
  it('a supplement or permanent marker excludes untouched rows even after the manual record is gone', () => {
    const scope = { user_id: 'owner', game_uid: 'uid', server_scope: '1', pool_id: 'standard' };
    expect(statisticsHistory(original, { entries: [scope] })).toEqual([]);
    expect(statisticsHistory(original, { exclusions: [scope] })).toEqual([]);
    const model = buildPersonalAnalysisSnapshots({ history: original, pools: [pool], userId: 'owner', statisticsExclusions: [scope] });
    expect(model.owner.summary.total).toBe(2);
    expect(model.scopes[0].payload.selector.totalPulls).toBe(2);
    expect(model.owner.accounts[0].recordCount).toBe(2);
  });
});
