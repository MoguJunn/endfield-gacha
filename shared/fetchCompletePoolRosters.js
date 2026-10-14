/** Single-pool requests also work with the currently published endpoint's total-row cap. */
export async function fetchCompletePoolRosters(poolIds, { baseUrl = '', fetchImpl = globalThis.fetch, signal } = {}) {
  const ids = [...new Set(poolIds.map(id => String(id).trim()).filter(Boolean))];
  const rosters = new Map();
  let position = 0;
  async function readNext() {
    while (position < ids.length) {
      const poolId = ids[position++];
      const response = await fetchImpl(`${baseUrl}/api/pool-rosters?${new URLSearchParams({ poolId })}`, {
        credentials: 'same-origin', signal,
      });
      if (!response.ok) throw new Error(`卡池 ${poolId} 的名单读取失败，请重试。`);
      const payload = await response.json();
      const rows = payload.data?.poolRosters?.[poolId];
      if (payload.success === false || payload.partial === true || payload.stale === true || !Array.isArray(rows)) {
        throw new Error(`卡池 ${poolId} 的名单未完整读取，请重试。`);
      }
      const count = payload.data?.rosterCounts?.[poolId];
      if (count !== undefined ? !Number.isSafeInteger(count) || count !== rows.length : rows.length >= 1000) {
        throw new Error(`卡池 ${poolId} 的名单数量校验失败，请重试。`);
      }
      const seen = new Set();
      for (const row of rows) {
        if (String(row.pool_id) !== poolId || !row.character_id || seen.has(String(row.character_id))) {
          throw new Error(`卡池 ${poolId} 的名单包含无效或重复记录，请重试。`);
        }
        seen.add(String(row.character_id));
      }
      rosters.set(poolId, rows);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, readNext));
  return Object.fromEntries(ids.map(id => [id, rosters.get(id)]));
}
