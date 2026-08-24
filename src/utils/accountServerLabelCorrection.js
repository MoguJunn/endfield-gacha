import { updateAccountGachaServerLabel } from '../services/accountGachaDataService.js';
import {
  buildGameAccountKey,
  buildGameAccountServerTag,
  buildHistorySeqDedupeKeys,
  getGameAccountSelectionValue,
  getHistoryRecordGameUid,
  isGameAccountSelectionMatch,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
  saveGameAccountMetadataAlias,
  saveGameAccountMetadata,
} from './gameAccountMetadata.js';

export const ACCOUNT_SERVER_LABEL_OPTIONS = [
  { serverId: '1', region: 'cn', channelMasterId: '1', labelKey: 'settings.serverLabelCnOfficial' },
  { serverId: 'bilibili', region: 'cn', channelMasterId: '2', labelKey: 'settings.serverLabelCnBilibili' },
  { serverId: '2', region: 'intl', labelKey: 'settings.serverLabelIntlAsia' },
  { serverId: '3', region: 'intl', labelKey: 'settings.serverLabelIntlEuUs' },
];

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function getAccountGameUid(account = {}) {
  return normalizeText(account.gameUid || account.game_uid || account.uid);
}

function getAccountServerIdentity(account = {}) {
  const serverId = normalizeGameAccountServerId(account) || normalizeText(account.serverId || account.server_id);
  if (serverId) {
    return `server:${serverId}`;
  }

  const region = normalizeGameAccountRegion(account);
  return region ? `region:${region}` : 'unknown';
}

function isSameGameUidSelection(selectedValue, gameUid) {
  const selected = normalizeText(selectedValue);
  const uid = normalizeText(gameUid);
  return Boolean(selected && uid && (selected === uid || selected.startsWith(`${uid}::`)));
}

function buildServerLabelUpdatedHistory({
  history,
  gameUid,
  accountValue,
  mergeGameUid,
  option,
  region,
  nextChannelMasterId,
} = {}) {
  const seenMergeKeys = new Set();

  return history.reduce((rows, record) => {
    const shouldUpdate = mergeGameUid
      ? getHistoryRecordGameUid(record) === gameUid
      : isGameAccountSelectionMatch(record, accountValue);

    if (!shouldUpdate) {
      rows.push(record);
      return rows;
    }

    const nextRecord = {
      ...record,
      serverId: option.serverId,
      server_id: option.serverId,
      channelMasterId: nextChannelMasterId,
      channel_master_id: nextChannelMasterId,
      region,
    };

    if (mergeGameUid) {
      const dedupeKeys = buildHistorySeqDedupeKeys(nextRecord);
      if (dedupeKeys.length > 0 && dedupeKeys.some(key => seenMergeKeys.has(key))) {
        return rows;
      }
      dedupeKeys.forEach(key => seenMergeKeys.add(key));
    }

    rows.push(nextRecord);
    return rows;
  }, []);
}

export function buildDuplicateGameUidServerGroups(accounts = []) {
  const groups = new Map();

  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    const gameUid = getAccountGameUid(account);
    if (!gameUid) {
      return;
    }

    if (!groups.has(gameUid)) {
      groups.set(gameUid, {
        gameUid,
        accounts: [],
        accountKeys: new Set(),
        serverIdentities: new Set(),
      });
    }

    const group = groups.get(gameUid);
    group.accounts.push(account);
    group.accountKeys.add(getGameAccountSelectionValue(account) || gameUid);
    group.serverIdentities.add(getAccountServerIdentity(account));
  });

  return Array.from(groups.values())
    .filter(group => group.accounts.length > 1 && (group.serverIdentities.size > 1 || group.accountKeys.size > 1))
    .map((group) => {
      return {
        gameUid: group.gameUid,
        accounts: group.accounts,
        accountKeyCount: group.accountKeys.size,
        serverCount: group.serverIdentities.size,
        defaultServerId: '',
        labels: [...new Set(group.accounts
          .map(account => buildGameAccountServerTag(account) || normalizeText(account.serverId || account.server_id) || 'unknown')
          .filter(Boolean))],
      };
    });
}

export async function updateAccountServerLabel({
  account,
  nextServerId,
  history,
  setHistory,
  currentGameUid,
  switchGameAccount,
  mergeGameUid = true,
  mergeAccounts = [],
} = {}) {
  const option = ACCOUNT_SERVER_LABEL_OPTIONS.find(item => item.serverId === String(nextServerId || '').trim());
  if (!account || !option) {
    throw new Error('invalid_server_label');
  }

  const gameUid = getAccountGameUid(account);
  if (!gameUid) {
    throw new Error('missing_game_uid');
  }

  const accountValue = getGameAccountSelectionValue(account) || gameUid;
  const region = normalizeGameAccountRegion({
    ...account,
    serverId: option.serverId,
    region: option.region,
  }) || option.region;
  const nextChannelMasterId = option.channelMasterId || null;

  const result = await updateAccountGachaServerLabel({
    gameUid,
    accountKey: account.accountKey || account.account_key || accountValue,
    currentServerId: account.serverId || account.server_id || '',
    currentRegion: account.region || '',
    serverId: option.serverId,
    region,
    mergeGameUid,
  });

  if (Number(result?.updated || 0) + Number(result?.deletedDuplicates || 0) <= 0) {
    throw new Error('server_label_update_no_records');
  }

  const nextAccount = {
    ...account,
    serverId: option.serverId,
    server_id: option.serverId,
    channelMasterId: nextChannelMasterId,
    channel_master_id: nextChannelMasterId,
    region,
  };
  const metadataSeeds = mergeGameUid && Array.isArray(mergeAccounts) && mergeAccounts.length > 0
    ? mergeAccounts
    : [account];
  metadataSeeds.forEach((seedAccount) => {
    const nextMetadata = {
      ...seedAccount,
      accountKey: getGameAccountSelectionValue(seedAccount),
      account_key: getGameAccountSelectionValue(seedAccount),
      serverId: option.serverId,
      server_id: option.serverId,
      channelMasterId: nextChannelMasterId,
      channel_master_id: nextChannelMasterId,
      region,
    };

    saveGameAccountMetadata(nextMetadata);
    saveGameAccountMetadataAlias(nextMetadata, gameUid);
  });

  if (typeof setHistory === 'function' && Array.isArray(history)) {
    setHistory(buildServerLabelUpdatedHistory({
      history,
      gameUid,
      accountValue,
      mergeGameUid,
      option,
      region,
      nextChannelMasterId,
    }));
  }

  const nextAccountValue = buildGameAccountKey(nextAccount) || gameUid;
  if (
    typeof switchGameAccount === 'function'
    && currentGameUid
    && (mergeGameUid
      ? isSameGameUidSelection(currentGameUid, gameUid)
      : isGameAccountSelectionMatch(account, currentGameUid))
  ) {
    switchGameAccount(nextAccountValue);
  }

  return {
    ...result,
    accountValue,
    nextAccountValue,
    serverId: option.serverId,
    region,
  };
}
