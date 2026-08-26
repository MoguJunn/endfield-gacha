import {
  EXTRA_POOL_SUBTYPES,
  getCanonicalExtraPoolSubtype,
} from '../../shared/extraPoolSubtype.js';

export const POOL_GROUP_PREFIX = '__group_';

export const GROUP_TYPE_LABELS = {
  all: '卡池',
  extra: '附加寻访',
  'extra:reconstruction': '重构寻访',
  'extra:reconstruction_claim': '重构申领',
  'extra:special': '特殊寻访',
  'extra:unclassified': '未分类附加寻访',
  limited: '限定角色',
  standard: '常驻',
  weapon_limited: '限定武器',
  weapon_standard: '常驻武器',
  beginner: '新手'
};

export function isPoolGroupId(poolId) {
  return typeof poolId === 'string' && poolId.startsWith(POOL_GROUP_PREFIX);
}

export function parsePoolGroupId(poolId) {
  if (!isPoolGroupId(poolId)) return null;

  const scope = poolId.slice(POOL_GROUP_PREFIX.length);
  const separatorIndex = scope.indexOf(':');
  if (separatorIndex < 0) {
    return {
      type: scope,
      subtype: null
    };
  }

  return {
    type: scope.slice(0, separatorIndex),
    subtype: scope.slice(separatorIndex + 1) || null
  };
}

export function getPoolGroupType(poolId) {
  return parsePoolGroupId(poolId)?.type || null;
}

export function getPoolGroupSubtype(poolId) {
  return parsePoolGroupId(poolId)?.subtype || null;
}

export function normalizeExtraPoolSubtype(pool) {
  const explicitSubtype = getCanonicalExtraPoolSubtype(pool);
  if (Object.values(EXTRA_POOL_SUBTYPES).includes(explicitSubtype)) {
    return explicitSubtype;
  }

  if ((explicitSubtype == null || explicitSubtype === '') && String(pool?.id || pool?.pool_id || '') === 'joint_1_2_2') {
    return 'special';
  }

  return 'unclassified';
}

function normalizeRequestedGroupScope(groupType, groupSubtype = null) {
  if (groupType && typeof groupType === 'object') {
    return {
      type: groupType.type || null,
      subtype: groupType.subtype || null
    };
  }

  if (typeof groupType === 'string' && groupType.includes(':')) {
    const separatorIndex = groupType.indexOf(':');
    return {
      type: groupType.slice(0, separatorIndex),
      subtype: groupType.slice(separatorIndex + 1) || null
    };
  }

  return {
    type: groupType,
    subtype: groupSubtype
  };
}

export function getPoolsForGroupType(pools, groupType, groupSubtype = null) {
  const requestedScope = normalizeRequestedGroupScope(groupType, groupSubtype);

  if (requestedScope.type === 'all') {
    return Array.isArray(pools) ? pools : [];
  }

  return (pools || []).filter((pool) => {
    let type = pool.type || 'standard';
    if (type === 'limited_character') type = 'limited';

    switch (requestedScope.type) {
      case 'extra':
        return type === 'extra'
          && (!requestedScope.subtype || normalizeExtraPoolSubtype(pool) === requestedScope.subtype);
      case 'limited':
        return type === 'limited';
      case 'standard':
        return type === 'standard';
      case 'weapon_limited':
        return (type === 'limited_weapon' || type === 'weapon') && pool.isLimitedWeapon !== false;
      case 'weapon_standard':
        return (type === 'limited_weapon' || type === 'weapon') && pool.isLimitedWeapon === false;
      case 'beginner':
        return type === 'beginner';
      default:
        return false;
    }
  });
}

export default {
  POOL_GROUP_PREFIX,
  GROUP_TYPE_LABELS,
  isPoolGroupId,
  parsePoolGroupId,
  getPoolGroupType,
  getPoolGroupSubtype,
  normalizeExtraPoolSubtype,
  getPoolsForGroupType
};
