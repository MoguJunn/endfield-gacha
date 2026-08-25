import { getAppLocale, getMessage } from '../i18n/index.js';
import { POOL_GROUP_PREFIX } from '../stores/usePoolStore.js';
import { localizeEntityName, localizePoolFeaturedList, localizePoolName } from './gameDataI18n.js';
import { getPoolFeaturedNames } from './poolFeaturedResolver.js';

const TYPE_ORDER = ['limited', 'extra', 'standard', 'weapon_limited', 'weapon_standard', 'beginner'];

function normalizeDateInput(input) {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizePoolGroupType(pool) {
  let type = pool?.type || 'standard';
  if (type === 'limited_character') type = 'limited';

  if (type === 'limited_weapon' || type === 'weapon') {
    return pool?.isLimitedWeapon === false ? 'weapon_standard' : 'weapon_limited';
  }

  if (type === 'extra') return 'extra';
  if (type === 'limited') return 'limited';
  if (type === 'beginner') return 'beginner';
  return 'standard';
}

export function getPoolTypeLabel(groupType, locale = getAppLocale()) {
  if (groupType === 'extra') return getMessage('pool.group.extra', {}, locale);
  if (groupType === 'limited') return getMessage('pool.group.limited', {}, locale);
  if (groupType === 'weapon_limited') return getMessage('pool.group.weaponLimited', {}, locale);
  if (groupType === 'weapon_standard') return getMessage('pool.group.weaponStandard', {}, locale);
  if (groupType === 'beginner') return getMessage('pool.group.beginner', {}, locale);
  if (groupType === 'standard') return getMessage('pool.group.standard', {}, locale);
  if (groupType === 'all') return getMessage('pool.group.all', {}, locale);
  return getMessage('pool.group.other', {}, locale);
}

export function getPoolFeaturedLabel(pool, { locale = getAppLocale(), short = false } = {}) {
  const normalizedGroupType = normalizePoolGroupType(pool);
  const isRosterStylePool = normalizedGroupType === 'extra'
    || normalizedGroupType === 'standard'
    || normalizedGroupType === 'beginner';
  const isWeaponPool = normalizedGroupType === 'weapon_limited' || normalizedGroupType === 'weapon_standard';

  if (short) {
    if (isWeaponPool) {
      return getMessage('pool.card.upWeaponShort', {}, locale);
    }

    return isRosterStylePool
      ? getMessage('pool.card.sixStarRosterShort', {}, locale)
      : getMessage('pool.card.upShort', {}, locale);
  }

  if (isWeaponPool) {
    return getMessage('dashboard.pool.upWeapon', {}, locale);
  }

  return isRosterStylePool
    ? getMessage('dashboard.pool.sixStarRoster', {}, locale)
    : getMessage('dashboard.pool.upCharacter', {}, locale);
}

export function shouldShowPoolFeaturedSummary(pool) {
  const normalizedGroupType = normalizePoolGroupType(pool);
  return normalizedGroupType !== 'standard' && normalizedGroupType !== 'beginner';
}

export function getPoolGroupId(groupType) {
  return `${POOL_GROUP_PREFIX}${groupType}`;
}

export function getPoolTimingMeta(pool, referenceDate = new Date(), locale = getAppLocale()) {
  const now = normalizeDateInput(referenceDate) || new Date();
  const start = normalizeDateInput(pool?.start_time);
  const end = normalizeDateInput(pool?.end_time);

  if (!start || !end) {
    return {
      isTimed: false,
      isActive: false,
      isUpcoming: false,
      isExpired: false,
      remainingLabel: '',
      orderBucket: 3,
      orderTime: 0
    };
  }

  const isActive = now >= start && now < end;
  const isUpcoming = now < start;
  const isExpired = now >= end;
  const remainingMs = isActive ? Math.max(end.getTime() - now.getTime(), 0) : 0;
  const startsInMs = isUpcoming ? Math.max(start.getTime() - now.getTime(), 0) : 0;
  const totalMs = Math.max(end.getTime() - start.getTime(), 0);
  const elapsedMs = isActive ? Math.max(now.getTime() - start.getTime(), 0) : 0;

  const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
  const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const startsInDays = Math.floor(startsInMs / (1000 * 60 * 60 * 24));
  const startsInHours = Math.floor((startsInMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return {
    isTimed: true,
    isActive,
    isUpcoming,
    isExpired,
    start,
    end,
    remainingDays,
    remainingHours,
    startsInDays,
    startsInHours,
    progressPercent: totalMs > 0
      ? (isActive ? Math.min((elapsedMs / totalMs) * 100, 100) : isExpired ? 100 : 0)
      : 0,
    remainingLabel: isActive
      ? getMessage('dashboard.analysis.remainingTime', { days: remainingDays, hours: remainingHours }, locale)
      : isUpcoming
        ? getMessage('dashboard.analysis.startsIn', { days: startsInDays, hours: startsInHours }, locale)
        : getMessage('dashboard.timeline.status.ended', {}, locale),
    orderBucket: isActive ? 0 : isUpcoming ? 1 : 2,
    orderTime: isActive || isUpcoming ? start.getTime() : -start.getTime()
  };
}

function matchesQuery(pool, query, locale = getAppLocale()) {
  if (!query) return true;
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const localizedFeaturedNames = getPoolSelectorFeaturedCharacters(pool, { locale });
  const haystacks = [
    pool?.name,
    pool?.up_character,
    pool?.upCharacter,
    ...(Array.isArray(pool?.featured_characters) ? pool.featured_characters : []),
    localizePoolName(pool, { locale }),
    localizeEntityName(pool?.up_character || pool?.upCharacter || '', { locale }),
    ...localizedFeaturedNames
  ];
  return haystacks.some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
}

export function getPoolSelectorFeaturedCharacters(pool, { locale = getAppLocale() } = {}) {
  const entityType = pool?.type === 'weapon' || pool?.type === 'limited_weapon' ? 'weapon' : 'character';
  const localizedFeaturedNames = localizePoolFeaturedList(pool, { locale, type: entityType }).filter(Boolean);
  const normalizedGroupType = normalizePoolGroupType(pool);
  const shouldUseMultiFeaturedDisplay = normalizedGroupType === 'extra'
    || (
      (normalizedGroupType === 'standard' || normalizedGroupType === 'beginner')
      && !pool?.up_character
      && !pool?.upCharacter
    );

  if (shouldUseMultiFeaturedDisplay) {
    return localizedFeaturedNames;
  }

  const localizedUpCharacter = localizeEntityName(pool?.up_character || pool?.upCharacter || '', {
    locale,
    type: entityType
  });

  return localizedUpCharacter ? [localizedUpCharacter] : [];
}

function getPoolSelectorAvatarLookupNames(pool) {
  const featuredNames = getPoolFeaturedNames(pool);
  const normalizedGroupType = normalizePoolGroupType(pool);
  const shouldUseMultiAvatarBackdrop = normalizedGroupType === 'extra'
    || (
      (normalizedGroupType === 'standard' || normalizedGroupType === 'beginner')
      && !pool?.up_character
      && !pool?.upCharacter
    );

  if (shouldUseMultiAvatarBackdrop) {
    return featuredNames.slice(0, 4);
  }

  return featuredNames.slice(0, 1);
}

function sortPoolsForDisplay(pools, referenceDate, locale = getAppLocale()) {
  return [...pools]
    .map((pool) => ({
      pool,
      timing: getPoolTimingMeta(pool, referenceDate, locale)
    }))
    .sort((left, right) => {
      if (left.timing.orderBucket !== right.timing.orderBucket) {
        return left.timing.orderBucket - right.timing.orderBucket;
      }

      if (left.timing.orderTime !== right.timing.orderTime) {
        return left.timing.orderTime - right.timing.orderTime;
      }

      const leftCreated = normalizeDateInput(left.pool?.created_at)?.getTime() || 0;
      const rightCreated = normalizeDateInput(right.pool?.created_at)?.getTime() || 0;
      if (leftCreated !== rightCreated) {
        return rightCreated - leftCreated;
      }

      return String(left.pool?.name || '').localeCompare(String(right.pool?.name || ''), locale);
    })
    .map(({ pool, timing }) => ({
      ...(() => {
        const displayFeaturedCharacters = getPoolSelectorFeaturedCharacters(pool, { locale });
        return {
          displayFeaturedCharacters,
          displayUpCharacter: shouldShowPoolFeaturedSummary(pool)
            ? displayFeaturedCharacters.join(' / ')
            : '',
          avatarLookupNames: getPoolSelectorAvatarLookupNames(pool)
        };
      })(),
      ...pool,
      selectorTiming: timing,
      displayName: localizePoolName(pool, { locale }),
    }));
}

function getPoolVersionStartTime(pool) {
  return normalizeDateInput(
    pool?.start_time
    || pool?.startTime
    || pool?.startDate
  )?.getTime() || NaN;
}

function getVersionTime(version, key) {
  const value = key === 'start'
    ? (version?.startsAt || version?.starts_at)
    : (version?.endsAt || version?.ends_at);
  return normalizeDateInput(value)?.getTime() || NaN;
}

export function resolvePoolSelectorVersionId(pool, versionTimeline = []) {
  const versions = Array.isArray(versionTimeline) ? versionTimeline : [];
  const poolId = String(pool?.id || pool?.pool_id || '').trim();
  if (!poolId || versions.length === 0) {
    return null;
  }

  const explicitMatches = versions.filter((version) => (
    Array.isArray(version?.poolIds || version?.pool_ids)
    && (version.poolIds || version.pool_ids).map(String).includes(poolId)
  ));
  if (explicitMatches.length === 1) {
    return explicitMatches[0].id || null;
  }
  if (explicitMatches.length > 1) {
    return null;
  }

  const poolStartTime = getPoolVersionStartTime(pool);
  if (!Number.isFinite(poolStartTime)) {
    return null;
  }

  const timeMatches = versions.filter((version, index) => {
    const startsAt = getVersionTime(version, 'start');
    const explicitEndAt = getVersionTime(version, 'end');
    const nextStartsAt = getVersionTime(versions[index + 1], 'start');
    const endsAt = Number.isFinite(explicitEndAt) ? explicitEndAt : nextStartsAt;
    return Number.isFinite(startsAt)
      && poolStartTime >= startsAt
      && (!Number.isFinite(endsAt) || poolStartTime < endsAt);
  });

  return timeMatches.length === 1 ? timeMatches[0].id || null : null;
}

export function buildPoolSelectorVersionFold({
  pools = [],
  groupType = '',
  versionTimeline = [],
  latestVersionLimit = 2,
  disabled = false,
} = {}) {
  const poolList = Array.isArray(pools) ? pools : [];
  const versions = Array.isArray(versionTimeline) ? versionTimeline : [];
  const supportsVersionFold = groupType === 'limited' || groupType === 'weapon_limited';
  if (disabled || !supportsVersionFold || versions.length === 0 || latestVersionLimit < 1) {
    return {
      enabled: false,
      directPools: poolList,
      foldedPools: [],
      recentVersionIds: [],
    };
  }

  const versionRank = new Map(versions.map((version, index) => [version.id, index]));
  const assignments = poolList.map((pool) => ({
    pool,
    versionId: resolvePoolSelectorVersionId(pool, versions),
  }));
  const recentVersionIds = [...new Set(assignments.map(({ versionId }) => versionId).filter(Boolean))]
    .sort((left, right) => (versionRank.get(right) ?? -1) - (versionRank.get(left) ?? -1))
    .slice(0, latestVersionLimit);
  const recentVersions = new Set(recentVersionIds);
  const directPools = [];
  const foldedPools = [];

  assignments.forEach(({ pool, versionId }) => {
    if (!versionId || recentVersions.has(versionId)) {
      directPools.push(pool);
    } else {
      foldedPools.push(pool);
    }
  });

  return {
    enabled: foldedPools.length > 0,
    directPools,
    foldedPools,
    recentVersionIds,
  };
}

export function buildPoolSelectorGroups({
  pools,
  poolPullCounts = {},
  searchQuery = '',
  referenceDate = new Date(),
  locale = getAppLocale(),
  versionTimeline = [],
  latestVersionLimit = 2,
}) {
  const filteredPools = (Array.isArray(pools) ? pools : []).filter((pool) => matchesQuery(pool, searchQuery, locale));
  const grouped = {
    extra: [],
    limited: [],
    standard: [],
    weapon_limited: [],
    weapon_standard: [],
    beginner: []
  };

  filteredPools.forEach((pool) => {
    const groupType = normalizePoolGroupType(pool);
    if (!grouped[groupType]) {
      grouped.standard.push(pool);
      return;
    }
    grouped[groupType].push(pool);
  });

  return TYPE_ORDER
    .map((groupType) => {
      const orderedPools = sortPoolsForDisplay(grouped[groupType], referenceDate, locale).map((pool) => ({
        ...pool,
        pullCount: poolPullCounts[pool.id] || 0
      }));
      if (orderedPools.length === 0) {
        return null;
      }

      const disableCollapse = Boolean(searchQuery?.trim());
      return {
        type: groupType,
        label: getPoolTypeLabel(groupType, locale),
        groupId: getPoolGroupId(groupType),
        totalPulls: orderedPools.reduce((sum, pool) => sum + (pool.pullCount || 0), 0),
        disableCollapse,
        pools: orderedPools,
        versionFold: buildPoolSelectorVersionFold({
          pools: orderedPools,
          groupType,
          versionTimeline,
          latestVersionLimit,
          disabled: disableCollapse,
        }),
      };
    })
    .filter(Boolean);
}

export function getSelectorVisiblePools({
  pools,
  currentPoolId = null,
  expanded = false,
  limit = 5
}) {
  if (!Array.isArray(pools) || pools.length <= limit || expanded) {
    return {
      visiblePools: pools || [],
      hiddenPools: [],
      autoExpanded: false
    };
  }

  const selectedIndex = pools.findIndex((pool) => pool.id === currentPoolId);
  const autoExpanded = selectedIndex >= limit;
  return {
    visiblePools: autoExpanded ? pools : pools.slice(0, limit),
    hiddenPools: autoExpanded ? [] : pools.slice(limit),
    autoExpanded
  };
}
