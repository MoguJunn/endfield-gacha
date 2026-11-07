import { getHistoryRecordGameUid, normalizeGameAccountServerId } from './gameAccountMetadata.js';

export function getImportAccountScopeConflicts(incoming = [], existing = []) {
  const conflicts = new Map();
  for (const account of incoming) {
    const gameUid = getHistoryRecordGameUid(account);
    const serverId = normalizeGameAccountServerId(account);
    if (!gameUid || !['1', 'bilibili'].includes(serverId)) continue;
    const previous = existing.filter(item => getHistoryRecordGameUid(item) === gameUid
      && ['1', 'bilibili'].includes(normalizeGameAccountServerId(item))
      && normalizeGameAccountServerId(item) !== serverId);
    if (previous.length) conflicts.set(`${gameUid}:${serverId}`, { gameUid, serverId });
  }
  return [...conflicts.values()];
}
