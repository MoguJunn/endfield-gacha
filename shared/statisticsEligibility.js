// Workbench entries are an editing ledger, never a statistical sample.
export function isStatisticsHistoryRecord(row) {
  if (!row) return false;
  if (row.statistics_pool_excluded === true || row.statisticsPoolExcluded === true) return false;
  const id = String(row.record_id ?? row.id ?? '');
  if (id.startsWith('manual_')) return false;
  const excluded = row.statistics_excluded ?? row.statisticsExcluded;
  if (excluded !== undefined) return excluded === false;
  return Number(row.edit_version ?? row.editVersion ?? 1) <= 1;
}

export function statisticsScopeKey(row) {
  return JSON.stringify([
    row.user_id ?? row.userId ?? '',
    String(row.game_uid ?? row.gameUid ?? '').trim() || 'legacy',
    row.server_scope ?? row.serverScope ?? row.server_id ?? row.serverId ?? 'legacy',
    row.pool_id ?? row.poolId ?? '',
  ]);
}

export function statisticsHistory(history = [], { entries = [], exclusions = [] } = {}) {
  const excludedScopes = new Set(exclusions.map(statisticsScopeKey));
  for (const entry of entries) excludedScopes.add(statisticsScopeKey(entry));
  for (const row of history) if (!isStatisticsHistoryRecord(row)) excludedScopes.add(statisticsScopeKey(row));
  return history.filter(row => !excludedScopes.has(statisticsScopeKey(row)));
}
