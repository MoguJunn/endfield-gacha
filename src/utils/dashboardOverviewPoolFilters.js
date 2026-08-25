import { normalizePoolGroupType } from './poolSelectorDisplay.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';

export function getOverviewPoolBucket(pool) {
  const capabilities = resolvePoolCapabilities(pool);
  if (capabilities.entityType === 'weapon') {
    return 'weapon';
  }

  const groupType = normalizePoolGroupType(pool);
  if (groupType === 'extra') {
    return 'extra';
  }

  if (groupType === 'limited') {
    return 'limited';
  }

  if (groupType === 'weapon_limited' || groupType === 'weapon_standard') {
    return 'weapon';
  }

  return 'standard';
}

export function getOverviewPoolTypeKey(pool) {
  const capabilities = resolvePoolCapabilities(pool);
  const groupType = normalizePoolGroupType(pool);
  if (capabilities.entityType === 'weapon') {
    if (groupType === 'weapon_limited' || groupType === 'weapon_standard') {
      return groupType;
    }
    return pool?.isLimitedWeapon === false ? 'weapon_standard' : 'weapon_limited';
  }

  if (groupType === 'weapon_limited' || groupType === 'weapon_standard') {
    return groupType;
  }

  if (groupType === 'extra') {
    return 'extra';
  }

  if (groupType === 'limited') {
    return 'limited';
  }

  return 'standard';
}

export default {
  getOverviewPoolBucket,
  getOverviewPoolTypeKey,
};
