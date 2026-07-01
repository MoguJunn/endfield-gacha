import { updateAccountGachaServerLabel } from '../services/accountGachaDataService.js';
import {
  buildGameAccountKey,
  buildGameAccountServerTag,
  getGameAccountSelectionValue,
  getHistoryRecordGameUid,
  isGameAccountSelectionMatch,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
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

function getAccountServerOptionValue(account = {}) {
  return normalizeGameAccountServerId(account) || normalizeText(account.serverId || account.server_id) || '';
}

function isSameGameUidSelection(selectedValue, gameUid) {
  const selected = normalizeText(selectedValue);
  const uid = normalizeText(gameUid);
  return Boolean(selected && uid && (selected === uid || selected.startsWith(`${uid}::`)));
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
        serverIdentities: new Set(),
      });
    }

    const group = groups.get(gameUid);
    group.accounts.push(account);
    group.serverIdentities.add(getAccountServerIdentity(account));
  });

  return Array.from(groups.values())
    .filter(group => group.accounts.length > 1 && group.serverIdentities.size > 1)
    .map((group) => {
      const defaultServerId = group.accounts
        .map(account => getAccountServerOptionValue(account))
        .find(Boolean) || ACCOUNT_SERVER_LABEL_OPTIONS[0]?.serverId || '';

      return {
        gameUid: group.gameUid,
        accounts: group.accounts,
        serverCount: group.serverIdentities.size,
        defaultServerId,
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
  mergeGameUid = false,
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
    saveGameAccountMetadata({
      ...seedAccount,
      accountKey: getGameAccountSelectionValue(seedAccount),
      account_key: getGameAccountSelectionValue(seedAccount),
      serverId: option.serverId,
      server_id: option.serverId,
      channelMasterId: nextChannelMasterId,
      channel_master_id: nextChannelMasterId,
      region,
    });
  });

  if (typeof setHistory === 'function' && Array.isArray(history)) {
    setHistory(history.map((record) => {
      const shouldUpdate = mergeGameUid
        ? getHistoryRecordGameUid(record) === gameUid
        : isGameAccountSelectionMatch(record, accountValue);

      return shouldUpdate
        ? {
            ...record,
            serverId: option.serverId,
            server_id: option.serverId,
            channelMasterId: nextChannelMasterId,
            channel_master_id: nextChannelMasterId,
            region,
          }
        : record;
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
