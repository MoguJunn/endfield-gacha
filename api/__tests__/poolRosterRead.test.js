// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readCompletePoolRoster } from '../_lib/poolRosterRead.js';

describe('complete roster contract', () => {
  it('preserves all 1227 relations and entity fields', async () => {
    const rows = Array.from({ length: 1227 }, (_, i) => ({
      pool_id: 'pool', character_id: `entity-${i}`, is_up: i === 1226,
      characters: { id: `entity-${i}`, name: `角色 ${i}`, rarity: 6, type: 'character', pool_config: { standard: true } },
    }));
    const client = { rpc: vi.fn().mockResolvedValue({ data: { rowCount: rows.length, rows }, error: null }) };
    expect(await readCompletePoolRoster(client, ['pool'])).toEqual(rows);
  });

  it.each([
    { rowCount: 1227, rows: [] },
    { rowCount: 0 },
    { rowCount: 1, rows: [{ pool_id: 'other', character_id: 'entity' }] },
    { rowCount: 1, rows: [{ pool_id: 'pool' }] },
    { rowCount: 2, rows: [{ pool_id: 'pool', character_id: 'entity' }, { pool_id: 'pool', character_id: 'entity' }] },
  ])('rejects incomplete, wrong-scope or duplicate rows: %j', async (data) => {
    const client = { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
    await expect(readCompletePoolRoster(client, ['pool'])).rejects.toThrow('读取不完整');
  });

  it('accepts a genuine empty pool and propagates database failures', async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { rowCount: 0, rows: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('catalog unavailable') }) };
    expect(await readCompletePoolRoster(client, ['empty'])).toEqual([]);
    await expect(readCompletePoolRoster(client, ['empty'])).rejects.toThrow('catalog unavailable');
  });
});
