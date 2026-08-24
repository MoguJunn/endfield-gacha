import { ACCOUNT_SERVER_LABEL_OPTIONS } from './accountServerLabelCorrection.js';
import { readStorageValue, writeStorageValue } from './storageUtils.js';

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'account_server_label_notice_ignored_v1:';
const VALID_SERVER_IDS = new Set(ACCOUNT_SERVER_LABEL_OPTIONS.map((option) => option.serverId));

function normalizeText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function getOwnerStorageKey(ownerId) {
  const normalizedOwnerId = normalizeText(ownerId);
  return normalizedOwnerId ? `${STORAGE_KEY_PREFIX}${normalizedOwnerId}` : null;
}

export function getAccountServerLabelIssue(account = {}) {
  const gameUid = normalizeText(account.gameUid || account.game_uid || account.uid);
  if (!gameUid || gameUid === 'legacy') {
    return null;
  }

  const serverScope = normalizeText(account.serverScope || account.server_scope);
  const rawServerId = normalizeText(account.serverId || account.server_id);
  let code = null;

  if (serverScope?.toLowerCase() === 'legacy') {
    code = 'legacy_server_scope';
  } else if (!rawServerId || !VALID_SERVER_IDS.has(rawServerId.toLowerCase())) {
    code = 'missing_or_unknown_server';
  }

  if (!code) {
    return null;
  }

  return {
    code,
    gameUid,
    accountKey: normalizeText(account.accountKey || account.account_key),
    fingerprint: [code, gameUid, serverScope || '_', rawServerId || '_'].join(':'),
  };
}

export function getAccountServerLabelIssues(accounts = []) {
  return (Array.isArray(accounts) ? accounts : [])
    .map(getAccountServerLabelIssue)
    .filter(Boolean);
}

export function readIgnoredAccountServerLabelIssues(ownerId) {
  const key = getOwnerStorageKey(ownerId);
  if (!key) return new Set();

  try {
    const parsed = JSON.parse(readStorageValue(key, '{}') || '{}');
    if (parsed?.version !== STORAGE_VERSION || !parsed.ignored || typeof parsed.ignored !== 'object') {
      return new Set();
    }
    return new Set(Object.keys(parsed.ignored));
  } catch {
    return new Set();
  }
}

export function ignoreAccountServerLabelIssues(ownerId, issues = []) {
  const key = getOwnerStorageKey(ownerId);
  if (!key) return false;

  const current = readIgnoredAccountServerLabelIssues(ownerId);
  issues.forEach((issue) => {
    if (issue?.fingerprint) current.add(issue.fingerprint);
  });

  const ignoredAt = new Date().toISOString();
  return writeStorageValue(key, JSON.stringify({
    version: STORAGE_VERSION,
    ignored: Object.fromEntries([...current].map((fingerprint) => [fingerprint, { ignoredAt }])),
  }));
}

export function getVisibleAccountServerLabelIssues(ownerId, accounts = []) {
  const ignored = readIgnoredAccountServerLabelIssues(ownerId);
  return getAccountServerLabelIssues(accounts).filter((issue) => !ignored.has(issue.fingerprint));
}
