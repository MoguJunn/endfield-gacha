export async function readCompletePoolRoster(client, poolIds = null) {
  const { data, error } = await client.rpc('read_pool_roster_catalog', { p_pool_ids: poolIds });
  if (error) throw error;

  if (!Array.isArray(data?.rows) || !Number.isSafeInteger(data.rowCount) || data.rowCount !== data.rows.length) {
    throw new Error('卡池名单读取不完整，请重试');
  }

  const requested = poolIds === null ? null : new Set(poolIds);
  const seen = new Set();
  for (const row of data.rows) {
    const key = JSON.stringify([row?.pool_id, row?.character_id]);
    if (!row?.pool_id || !row?.character_id || (requested && !requested.has(row.pool_id)) || seen.has(key)) {
      throw new Error('卡池名单读取不完整，请重试');
    }
    seen.add(key);
  }
  return data.rows;
}
