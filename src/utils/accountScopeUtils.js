import {
  buildGameAccountKey,
  getGameAccountSelectionValue,
  getHistoryRecordAccountKey,
  isGameAccountSelectionMatch,
} from './gameAccountMetadata.js';

function normalizeGameUid(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'null' || text === 'undefined') {
    return null;
  }
  return text;
}

function normalizeFirstGameUid(...values) {
  return values
    .map(normalizeGameUid)
    .find(Boolean) || null;
}

function getRecordGameUid(record) {
  return normalizeFirstGameUid(record?.game_uid, record?.gameUid);
}

export function buildGameUidOptionsFromHistory(historyRecords = []) {
  const accountMap = new Map();

  (Array.isArray(historyRecords) ? historyRecords : []).forEach((record) => {
    const gameUid = getRecordGameUid(record);
    if (!gameUid) {
      return;
    }

    const accountKey = getHistoryRecordAccountKey(record) || gameUid;
    const existing = accountMap.get(accountKey);
    if (existing) {
      existing.recordCount += 1;
      return;
    }

    accountMap.set(accountKey, {
      accountKey,
      gameUid,
      recordCount: 1,
      firstSeenIndex: accountMap.size,
    });
  });

  return Array.from(accountMap.values())
    .sort((a, b) => (b.recordCount - a.recordCount) || (a.firstSeenIndex - b.firstSeenIndex));
}

export function resolveEffectiveGameUid({
  currentGameUid = null,
  gameAccounts = [],
  historyRecords = [],
} = {}) {
  const normalizedCurrent = normalizeGameUid(currentGameUid);
  const accountOptions = Array.isArray(gameAccounts) && gameAccounts.length > 0
    ? gameAccounts
    : buildGameUidOptionsFromHistory(historyRecords);
  const accountUids = accountOptions
    .map(getGameAccountSelectionValue)
    .filter(Boolean);

  if (normalizedCurrent) {
    const selectedAccount = accountOptions.find((account) => isGameAccountSelectionMatch(account, normalizedCurrent));
    if (selectedAccount) {
      return getGameAccountSelectionValue(selectedAccount) || normalizedCurrent;
    }

    if (accountUids.length === 0 || accountUids.includes(normalizedCurrent)) {
      return normalizedCurrent;
    }
  }

  return accountUids[0] || null;
}

export function filterHistoryForEffectiveGameUid(historyRecords = [], effectiveGameUid = null) {
  const records = Array.isArray(historyRecords) ? historyRecords : [];
  const normalizedGameUid = normalizeGameUid(effectiveGameUid);

  if (!normalizedGameUid) {
    return records.filter((record) => !getRecordGameUid(record));
  }

  return records.filter((record) => {
    const recordAccountKey = getHistoryRecordAccountKey(record) || buildGameAccountKey(record);
    if (recordAccountKey && recordAccountKey === normalizedGameUid) {
      return true;
    }

    return isGameAccountSelectionMatch(record, normalizedGameUid);
  });
}

export function isImplicitAllAccountAnalysis(currentGameUid, gameAccounts = []) {
  return !normalizeGameUid(currentGameUid) && Array.isArray(gameAccounts) && gameAccounts.length > 1;
}
