export function isWorkbenchPoolUnopened(pool, now = Date.now()) {
  const start = Date.parse(pool?.start_time ?? pool?.startTime);
  return Number.isFinite(start) && start > now;
}

export function workbenchPoolUnavailableMessage(pool) {
  return `${pool?.name || '该卡池'}尚未开放，开放后才能导入或修改。`;
}

/** Check both sides of moves and existing rows targeted for update or deletion. */
export function validateWorkbenchPoolOperations({ entries = [], historyChanges = [], supplementChanges = [],
  history = [], existingEntries = [], pools = [], now = Date.now() } = {}) {
  const ids = new Set(entries.filter(entry => entry.reviewState !== 'skipped').map(entry => String(entry.poolId ?? entry.pool_id)));
  for (const change of historyChanges) {
    const original = history.find(row => String(row.record_id ?? row.id) === String(change.recordId));
    ids.add(String(original?.poolId ?? original?.pool_id ?? change.currentPoolId));
    if (change.changes?.poolId) ids.add(String(change.changes.poolId));
  }
  for (const change of supplementChanges) {
    const original = existingEntries.find(row => String(row.id) === String(change.id));
    ids.add(String(original?.poolId ?? original?.pool_id));
    if (change.entry) ids.add(String(change.entry.poolId ?? change.entry.pool_id));
  }
  return pools.filter(pool => ids.has(String(pool.id ?? pool.pool_id)) && isWorkbenchPoolUnopened(pool, now))
    .map(pool => ({ code: 'pool_not_open', poolId: pool.id ?? pool.pool_id, severity: 'error', message: workbenchPoolUnavailableMessage(pool) }));
}
