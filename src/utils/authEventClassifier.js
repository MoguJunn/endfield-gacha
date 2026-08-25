export const AUTH_EVENT_CLASSIFICATION = Object.freeze({
  INITIAL_SESSION: 'INITIAL_SESSION',
  FIRST_SIGNED_IN: 'FIRST_SIGNED_IN',
  SAME_OWNER_SIGNED_IN_RECOVERY: 'SAME_OWNER_SIGNED_IN_RECOVERY',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  USER_UPDATED: 'USER_UPDATED',
  PASSWORD_RECOVERY: 'PASSWORD_RECOVERY',
  USER_SWITCH: 'USER_SWITCH',
  SIGNED_OUT: 'SIGNED_OUT',
  SITE_SESSION_SYNC: 'SITE_SESSION_SYNC',
  AUTHENTICATED_EVENT: 'AUTHENTICATED_EVENT',
});

export const PERSONAL_DATA_REFRESH_KIND = Object.freeze({
  SESSION: 'session',
  EXPLICIT: 'explicit',
  MUTATION: 'mutation',
});

function normalizeOwnerId(value) {
  const ownerId = typeof value === 'object' ? value?.id : value;
  const normalized = String(ownerId || '').trim();
  return normalized || null;
}

function normalizeAuthEvent(event, source) {
  if (source === 'site_session' || event === 'SITE_SESSION_SYNC') {
    return 'SITE_SESSION_SYNC';
  }

  return String(event || '').trim().toUpperCase() || 'AUTHENTICATED_EVENT';
}

function resolveClassificationKind(event, { isFirstOwner, ownerChanged }) {
  if (event === 'SIGNED_OUT') {
    return AUTH_EVENT_CLASSIFICATION.SIGNED_OUT;
  }
  if (ownerChanged) {
    return AUTH_EVENT_CLASSIFICATION.USER_SWITCH;
  }

  switch (event) {
    case 'INITIAL_SESSION':
      return AUTH_EVENT_CLASSIFICATION.INITIAL_SESSION;
    case 'SIGNED_IN':
      return isFirstOwner
        ? AUTH_EVENT_CLASSIFICATION.FIRST_SIGNED_IN
        : AUTH_EVENT_CLASSIFICATION.SAME_OWNER_SIGNED_IN_RECOVERY;
    case 'TOKEN_REFRESHED':
      return AUTH_EVENT_CLASSIFICATION.TOKEN_REFRESHED;
    case 'USER_UPDATED':
      return AUTH_EVENT_CLASSIFICATION.USER_UPDATED;
    case 'PASSWORD_RECOVERY':
      return AUTH_EVENT_CLASSIFICATION.PASSWORD_RECOVERY;
    case 'SITE_SESSION_SYNC':
      return AUTH_EVENT_CLASSIFICATION.SITE_SESSION_SYNC;
    default:
      return AUTH_EVENT_CLASSIFICATION.AUTHENTICATED_EVENT;
  }
}

/**
 * 将 Supabase 与站点 Session 事件归一为稳定的个人数据刷新合同。
 * 该函数不读取 Store，也不产生副作用，便于逐事件验证。
 */
export function classifyAuthEvent({
  event,
  source = 'supabase',
  currentOwnerId = null,
  nextOwnerId = null,
  nextUser = null,
  hasSnapshot = false,
  refreshKind = null,
} = {}) {
  const normalizedEvent = normalizeAuthEvent(event, source);
  const previousOwnerId = normalizeOwnerId(currentOwnerId);
  const targetOwnerId = normalizeOwnerId(nextOwnerId || nextUser);
  const isSignedOut = normalizedEvent === 'SIGNED_OUT';
  const isAuthenticated = !isSignedOut && Boolean(targetOwnerId);
  const isFirstOwner = !previousOwnerId && Boolean(targetOwnerId);
  const ownerChanged = Boolean(
    previousOwnerId
    && targetOwnerId
    && previousOwnerId !== targetOwnerId
  );
  const requestedRefreshKind = Object.values(PERSONAL_DATA_REFRESH_KIND).includes(refreshKind)
    ? refreshKind
    : null;
  const classification = resolveClassificationKind(
    normalizedEvent,
    { isFirstOwner, ownerChanged }
  );
  const shouldRefreshPersonalData = isAuthenticated && Boolean(
    requestedRefreshKind
    || ownerChanged
    || !hasSnapshot
  );

  return {
    classification,
    event: normalizedEvent,
    previousOwnerId,
    ownerId: targetOwnerId,
    isAuthenticated,
    isFirstOwner,
    ownerChanged,
    hasSnapshot: Boolean(hasSnapshot),
    shouldRefreshPersonalData,
    shouldUpdateLastSeen: isAuthenticated && (isFirstOwner || ownerChanged),
    refreshKind: requestedRefreshKind || PERSONAL_DATA_REFRESH_KIND.SESSION,
  };
}

export default classifyAuthEvent;
