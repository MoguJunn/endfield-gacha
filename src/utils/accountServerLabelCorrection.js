import { updateAccountGachaServerLabel } from '../services/accountGachaDataService.js';
import {
  buildGameAccountKey,
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
  normalizeGameAccountRegion,
  saveGameAccountMetadata,
} from './gameAccountMetadata.js';

export const ACCOUNT_SERVER_LABEL_OPTIONS = [
  { serverId: '1', region: 'cn', labelKey: 'settings.serverLabelCn' },
  { serverId: '2', region: 'intl', labelKey: 'settings.serverLabelIntlAsia' },
  { serverId: '3', region: 'intl', labelKey: 'settings.serverLabelIntlEuUs' },
];

export async function updateAccountServerLabel({
  account,
  nextServerId,
  history,
  setHistory,
  currentGameUid,
  switchGameAccount,
} = {}) {
  const option = ACCOUNT_SERVER_LABEL_OPTIONS.find(item => item.serverId === String(nextServerId || '').trim());
  if (!account || !option) {
    throw new Error('invalid_server_label');
  }

  const gameUid = account.gameUid || account.game_uid || account.uid || null;
  if (!gameUid) {
    throw new Error('missing_game_uid');
  }

  const accountValue = getGameAccountSelectionValue(account) || gameUid;
  const region = normalizeGameAccountRegion({
    ...account,
    serverId: option.serverId,
    region: option.region,
  }) || option.region;

  const result = await updateAccountGachaServerLabel({
    gameUid,
    accountKey: account.accountKey || account.account_key || accountValue,
    currentServerId: account.serverId || account.server_id || '',
    currentRegion: account.region || '',
    serverId: option.serverId,
    region,
  });

  const nextAccount = {
    ...account,
    serverId: option.serverId,
    server_id: option.serverId,
    region,
  };
  saveGameAccountMetadata(nextAccount);

  if (typeof setHistory === 'function' && Array.isArray(history)) {
    setHistory(history.map((record) => (
      isGameAccountSelectionMatch(record, accountValue)
        ? {
            ...record,
            serverId: option.serverId,
            server_id: option.serverId,
            region,
          }
        : record
    )));
  }

  const nextAccountValue = buildGameAccountKey(nextAccount) || gameUid;
  if (
    typeof switchGameAccount === 'function'
    && currentGameUid
    && isGameAccountSelectionMatch(account, currentGameUid)
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
