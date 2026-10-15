import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCompletePoolRosters } from '../../../../shared/fetchCompletePoolRosters.js';
import { loadWorkbenchRosters } from '../workbenchCatalog.js';

const rowsFor = (poolId, count) => Array.from({ length: count }, (_, index) => ({ pool_id: poolId, character_id: `${poolId}-${index}`, is_up: index === 0 }));
const ok = body => ({ ok: true, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('工作台完整名单读取', () => {
  it('逐池读取超过 1000 条的整套名单，并恢复无抽卡记录卡池的可选项', async () => {
    const pools = Array.from({ length: 40 }, (_, index) => ({ id: `pool-${index}` }));
    const fetchImpl = vi.fn(async url => {
      const params = new URL(url, 'https://test.invalid').searchParams;
      expect(params.has('poolIds')).toBe(false);
      const id = params.get('poolId');
      return ok({ success: true, partial: false, data: { poolRosters: { [id]: rowsFor(id, id === 'pool-39' ? 57 : 30) } } });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const result = await loadWorkbenchRosters(pools);
    expect(fetchImpl).toHaveBeenCalledTimes(40);
    expect(result.reduce((sum, pool) => sum + pool.rosterEntityIds.length, 0)).toBe(1227);
    expect(result.at(-1).rosterEntityIds).toHaveLength(57);
    expect(result.at(-1).rosterUpEntityIds).toEqual(['pool-39-0']);
  });
  it.each(['partial', 'missing-pool', 'bad-count', 'duplicate', 'failed'])('对 %s 明确报错，不转换为空名单', async failure => {
    const rows = rowsFor('pool', 2);
    const payload = { success: true, partial: failure === 'partial', data: { poolRosters: { pool: rows } } };
    if (failure === 'missing-pool') delete payload.data.poolRosters.pool;
    if (failure === 'bad-count') payload.data.rosterCounts = { pool: 3 };
    if (failure === 'duplicate') rows.push(rows[0]);
    await expect(fetchCompletePoolRosters(['pool'], { fetchImpl: async () => failure === 'failed' ? { ok: false } : ok(payload) })).rejects.toThrow('名单');
  });
  it('只有单池确实返回空名单才保留空数组', async () => {
    const result = await fetchCompletePoolRosters(['empty'], { fetchImpl: async () => ok({ success: true, partial: false,
      data: { poolRosters: { empty: [] }, rosterCounts: { empty: 0 } } }) });
    expect(result).toEqual({ empty: [] });
  });
});
