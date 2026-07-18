export const ImportStatus = {
  IDLE: 'idle',
  AUTHENTICATING: 'authenticating',
  ACCOUNT_SELECTION: 'account_selection',
  FETCHING: 'fetching',
  PROCESSING: 'processing',
  REVIEW_REQUIRED: 'review_required',
  CONFIRMING: 'confirming',
  SUCCESS: 'success',
  ERROR: 'error'
};

function translateWithFallback(t, key, fallback) {
  return typeof t === 'function' ? t(key, {}, fallback) : fallback;
}

export function getPoolName(poolType, t) {
  const nameMap = {
    extra: translateWithFallback(t, 'pool.group.extra', '附加寻访'),
    limited_character: translateWithFallback(t, 'pool.group.limited', '限定角色'),
    standard: translateWithFallback(t, 'pool.group.standard', '常驻'),
    beginner: translateWithFallback(t, 'pool.group.beginner', '新手'),
    limited_weapon: translateWithFallback(t, 'pool.group.weaponLimited', '限定武器'),
    weapon: translateWithFallback(t, 'pool.group.weaponLimited', '限定武器'),
    unknown: translateWithFallback(t, 'common.unknown', '未知')
  };

  return nameMap[poolType] || poolType;
}
