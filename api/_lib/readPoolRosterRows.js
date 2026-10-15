export const POOL_ROSTER_PAGE_SIZE = 500;
const MAX_ROSTER_ROWS = 50000;

/** Read the complete relation, never interpret a capped response as an empty pool. */
export async function readPoolRosterRows(client, { poolIds = null, columns = 'pool_id,character_id,is_up' } = {}) {
  const requested = poolIds == null ? null : new Set(poolIds.map(String));
  if (requested?.size === 0) return [];
  const rows = []; const seen = new Set();
  let expected = null;
  for (let offset = 0; offset < MAX_ROSTER_ROWS; offset += POOL_ROSTER_PAGE_SIZE) {
    let query = client.from('pool_characters').select(columns, { count: 'exact' });
    if (requested) query = query.in('pool_id', [...requested]);
    const { data, count, error } = await query.order('pool_id', { ascending: true })
      .order('character_id', { ascending: true }).range(offset, offset + POOL_ROSTER_PAGE_SIZE - 1);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_ROSTER_ROWS || !Array.isArray(data)) {
      throw new Error('卡池名单读取失败：无法确认完整数量。请重试。');
    }
    if (expected !== null && count !== expected) throw new Error('读取期间卡池名单已变化，请重新读取。');
    expected = count;
    if (data.length !== Math.min(POOL_ROSTER_PAGE_SIZE, expected - offset)) {
      throw new Error('卡池名单返回不完整，请重试。');
    }
    for (const row of data) {
      const key = JSON.stringify([row.pool_id, row.character_id]);
      if (!row.pool_id || !row.character_id || requested && !requested.has(String(row.pool_id)) || seen.has(key)) {
        throw new Error('卡池名单返回重复或无效记录，请重试。');
      }
      seen.add(key); rows.push(row);
    }
    if (rows.length === expected) return rows;
  }
  throw new Error('卡池名单超出读取范围，请联系管理员。');
}
