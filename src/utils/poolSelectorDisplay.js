import { getAppLocale, getMessage } from '../i18n/index.js';
import { localizeEntityName, localizePoolFeaturedList, localizePoolName } from './gameDataI18n.js';
import { normalizeExtraPoolSubtype, parsePoolGroupId, POOL_GROUP_PREFIX } from './poolGroupUtils.js';
import { getPoolFeaturedNames } from './poolFeaturedResolver.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';

const TYPE_ORDER = ['limited', 'extra', 'standard', 'weapon_limited', 'weapon_standard', 'beginner'];
const EXTRA_SUBTYPE_ORDER = ['reconstruction', 'reconstruction_claim', 'special', 'unclassified'];

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

export function getPoolTypeLabel(groupType, locale = getAppLocale(), groupSubtype = null) {
  const normalizedType = typeof groupType === 'object' ? groupType?.type : groupType;
  const normalizedSubtype = typeof groupType === 'object' ? groupType?.subtype : groupSubtype;

  if (normalizedType === 'extra' && normalizedSubtype === 'reconstruction') {
    return getMessage('pool.group.extraReconstruction', {}, locale);
  }
  if (normalizedType === 'extra' && normalizedSubtype === 'reconstruction_claim') {
    return getMessage('pool.group.extraReconstructionClaim', {}, locale);
  }
  if (normalizedType === 'extra' && normalizedSubtype === 'special') {
    return getMessage('pool.group.extraSpecial', {}, locale);
  }
  if (normalizedType === 'extra' && normalizedSubtype === 'unclassified') {
    return getMessage('pool.group.extraUnclassified', {}, locale);
  }
  if (normalizedType === 'extra') return getMessage('pool.group.extra', {}, locale);
  if (normalizedType === 'limited') return getMessage('pool.group.limited', {}, locale);
  if (normalizedType === 'weapon_limited') return getMessage('pool.group.weaponLimited', {}, locale);
  if (normalizedType === 'weapon_standard') return getMessage('pool.group.weaponStandard', {}, locale);
  if (normalizedType === 'beginner') return getMessage('pool.group.beginner', {}, locale);
  if (normalizedType === 'standard') return getMessage('pool.group.standard', {}, locale);
  if (normalizedType === 'all') return getMessage('pool.group.all', {}, locale);
  return getMessage('pool.group.other', {}, locale);
}

export function getPoolFeaturedLabel(pool, { locale = getAppLocale(), short = false } = {}) {
  const normalizedGroupType = normalizePoolGroupType(pool);
  const capabilities = resolvePoolCapabilities(pool);
  const isRosterStylePool =
    capabilities.targetMode === 'four-target-equal' ||
    normalizedGroupType === 'standard' ||
    normalizedGroupType === 'beginner';
  const isWeaponPool = capabilities.entityType === 'weapon';

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
  const capabilities = resolvePoolCapabilities(pool);
  return capabilities.targetMode !== 'none';
}

export function getPoolGroupId(groupType, groupSubtype = null) {
  const normalizedType = typeof groupType === 'object' ? groupType?.type : groupType;
  const normalizedSubtype = typeof groupType === 'object' ? groupType?.subtype : groupSubtype;
  return `${POOL_GROUP_PREFIX}${normalizedType}${normalizedSubtype ? `:${normalizedSubtype}` : ''}`;
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
      orderTime: 0,
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
    progressPercent: totalMs > 0 ? (isActive ? Math.min((elapsedMs / totalMs) * 100, 100) : isExpired ? 100 : 0) : 0,
    remainingLabel: isActive
      ? getMessage('dashboard.analysis.remainingTime', { days: remainingDays, hours: remainingHours }, locale)
      : isUpcoming
        ? getMessage('dashboard.analysis.startsIn', { days: startsInDays, hours: startsInHours }, locale)
        : getMessage('dashboard.timeline.status.ended', {}, locale),
    orderBucket: isActive ? 0 : isUpcoming ? 1 : 2,
    orderTime: isActive || isUpcoming ? start.getTime() : -start.getTime(),
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
    ...localizedFeaturedNames,
  ];
  return haystacks.some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

export function getPoolSelectorFeaturedCharacters(pool, { locale = getAppLocale() } = {}) {
  const capabilities = resolvePoolCapabilities(pool);
  const entityType = capabilities.entityType === 'weapon' ? 'weapon' : 'character';
  const localizedFeaturedNames = localizePoolFeaturedList(pool, { locale, type: entityType }).filter(Boolean);
  const normalizedGroupType = normalizePoolGroupType(pool);
  const shouldUseMultiFeaturedDisplay =
    capabilities.targetMode === 'four-target-equal' ||
    ((normalizedGroupType === 'standard' || normalizedGroupType === 'beginner') &&
      !pool?.up_character &&
      !pool?.upCharacter);

  if (shouldUseMultiFeaturedDisplay) {
    return localizedFeaturedNames;
  }

  const localizedUpCharacter = localizeEntityName(pool?.up_character || pool?.upCharacter || '', {
    locale,
    type: entityType,
  });

  return localizedUpCharacter ? [localizedUpCharacter] : [];
}

export function getPoolSelectorAvatarLookupNames(pool) {
  const featuredNames = getPoolFeaturedNames(pool);
  const normalizedGroupType = normalizePoolGroupType(pool);
  const capabilities = resolvePoolCapabilities(pool);
  const shouldUseMultiAvatarBackdrop =
    capabilities.targetMode === 'four-target-equal' ||
    ((normalizedGroupType === 'standard' || normalizedGroupType === 'beginner') &&
      !pool?.up_character &&
      !pool?.upCharacter);

  if (shouldUseMultiAvatarBackdrop) {
    return featuredNames.slice(0, 4);
  }

  const singleUpName = pool?.up_character || pool?.upCharacter || featuredNames[0];
  return singleUpName ? [singleUpName] : [];
}

function sortPoolsForDisplay(pools, referenceDate, locale = getAppLocale()) {
  return [...pools]
    .map((pool) => ({
      pool,
      timing: getPoolTimingMeta(pool, referenceDate, locale),
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

      const nameOrder = String(left.pool?.name || '').localeCompare(String(right.pool?.name || ''), locale);
      if (nameOrder !== 0) {
        return nameOrder;
      }

      return String(left.pool?.id || left.pool?.pool_id || '').localeCompare(
        String(right.pool?.id || right.pool?.pool_id || ''),
        locale
      );
    })
    .map(({ pool, timing }) => ({
      ...(() => {
        const displayFeaturedCharacters = getPoolSelectorFeaturedCharacters(pool, { locale });
        return {
          displayFeaturedCharacters,
          displayUpCharacter: shouldShowPoolFeaturedSummary(pool) ? displayFeaturedCharacters.join(' / ') : '',
          avatarLookupNames: getPoolSelectorAvatarLookupNames(pool),
        };
      })(),
      ...pool,
      selectorTiming: timing,
      displayName: localizePoolName(pool, { locale }),
    }));
}

function getPoolVersionStartTime(pool) {
  return normalizeDateInput(pool?.start_time || pool?.startTime || pool?.startDate)?.getTime() || NaN;
}

function getVersionTime(version, key) {
  const value = key === 'start' ? version?.startsAt || version?.starts_at : version?.endsAt || version?.ends_at;
  return normalizeDateInput(value)?.getTime() || NaN;
}

export function resolvePoolSelectorVersionId(pool, versionTimeline = []) {
  const versions = Array.isArray(versionTimeline) ? versionTimeline : [];
  const poolId = String(pool?.id || pool?.pool_id || '').trim();
  if (!poolId || versions.length === 0) {
    return null;
  }

  const explicitMatches = versions.filter(
    (version) =>
      Array.isArray(version?.poolIds || version?.pool_ids) &&
      (version.poolIds || version.pool_ids).map(String).includes(poolId)
  );
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
    return (
      Number.isFinite(startsAt) && poolStartTime >= startsAt && (!Number.isFinite(endsAt) || poolStartTime < endsAt)
    );
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
  currentPoolId = null,
  referenceDate = new Date(),
  locale = getAppLocale(),
  versionTimeline = [],
  latestVersionLimit = 2,
}) {
  const selectedGroupScope = parsePoolGroupId(currentPoolId);
  const filteredPools = (Array.isArray(pools) ? pools : []).filter(
    (pool) =>
      matchesQuery(pool, searchQuery, locale) ||
      pool.id === currentPoolId ||
      (selectedGroupScope?.type === 'extra' &&
        selectedGroupScope.subtype &&
        normalizePoolGroupType(pool) === 'extra' &&
        normalizeExtraPoolSubtype(pool) === selectedGroupScope.subtype)
  );
  const grouped = {
    extra: [],
    limited: [],
    standard: [],
    weapon_limited: [],
    weapon_standard: [],
    beginner: [],
  };

  filteredPools.forEach((pool) => {
    const groupType = normalizePoolGroupType(pool);
    if (!grouped[groupType]) {
      grouped.standard.push(pool);
      return;
    }
    grouped[groupType].push(pool);
  });

  return TYPE_ORDER.map((groupType) => {
    let subgroups = null;
    let orderedPools;

    if (groupType === 'extra') {
      const extraPoolsBySubtype = Object.fromEntries(EXTRA_SUBTYPE_ORDER.map((subtype) => [subtype, []]));
      grouped.extra.forEach((pool) => {
        extraPoolsBySubtype[normalizeExtraPoolSubtype(pool)].push(pool);
      });

      subgroups = EXTRA_SUBTYPE_ORDER.map((subtype) => {
        const subtypePools = sortPoolsForDisplay(extraPoolsBySubtype[subtype], referenceDate, locale).map((pool) => ({
          ...pool,
          pullCount: poolPullCounts[pool.id] || 0,
          selectorExtraSubtype: subtype,
        }));

        if (subtypePools.length === 0) {
          return null;
        }

        const totalPulls = subtypePools.reduce((sum, pool) => sum + (pool.pullCount || 0), 0);
        return {
          type: 'extra',
          subtype,
          label: getPoolTypeLabel('extra', locale, subtype),
          groupId: getPoolGroupId('extra', subtype),
          totalPulls,
          poolCount: subtypePools.length,
          defaultExpanded: subtype !== 'special' || totalPulls > 0,
          disableCollapse: Boolean(searchQuery?.trim()),
          pools: subtypePools,
        };
      }).filter(Boolean);
      orderedPools = subgroups.flatMap((subgroup) => subgroup.pools);
    } else {
      orderedPools = sortPoolsForDisplay(grouped[groupType], referenceDate, locale).map((pool) => ({
        ...pool,
        pullCount: poolPullCounts[pool.id] || 0,
      }));
    }

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
      ...(subgroups
        ? { subgroups }
        : {
            versionFold: buildPoolSelectorVersionFold({
              pools: orderedPools,
              groupType,
              versionTimeline,
              latestVersionLimit,
              disabled: disableCollapse,
            }),
          }),
    };
  }).filter(Boolean);
}

function isSubgroupSelection(currentPoolId, subgroup) {
  return currentPoolId === subgroup.groupId || subgroup.pools.some((pool) => pool.id === currentPoolId);
}

export function applyPoolSelectorScopeView({
  groups,
  currentPoolId = null,
  hideZeroPullPools = false,
  searchQuery = '',
  subgroupExpansionOverrides = {},
}) {
  const hasSearchQuery = Boolean(searchQuery?.trim());

  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      if (!Array.isArray(group.subgroups)) {
        const visiblePools = group.pools.filter(
          (pool) => !hideZeroPullPools || (pool.pullCount || 0) > 0 || pool.id === currentPoolId || hasSearchQuery
        );

        if (visiblePools.length === 0) {
          return null;
        }

        const visiblePoolIds = new Set(visiblePools.map((pool) => pool.id));

        return {
          ...group,
          pools: visiblePools,
          ...(group.versionFold
            ? {
                versionFold: {
                  ...group.versionFold,
                  directPools: group.versionFold.directPools.filter((pool) => visiblePoolIds.has(pool.id)),
                  foldedPools: group.versionFold.foldedPools.filter((pool) => visiblePoolIds.has(pool.id)),
                },
              }
            : {}),
        };
      }

      const subgroups = group.subgroups.map((subgroup) => {
        const expansionOverride = subgroupExpansionOverrides[subgroup.groupId];
        const selectionForcesExpanded = isSubgroupSelection(currentPoolId, subgroup);
        const searchForcesExpanded = hasSearchQuery && subgroup.pools.length > 0;
        const isExpanded =
          selectionForcesExpanded ||
          searchForcesExpanded ||
          (typeof expansionOverride === 'boolean' ? expansionOverride : subgroup.defaultExpanded);
        const manualSpecialExpansion = subgroup.subtype === 'special' && expansionOverride === true;
        const showZeroPullPools =
          !hideZeroPullPools || selectionForcesExpanded || searchForcesExpanded || manualSpecialExpansion;
        const visiblePools = isExpanded
          ? subgroup.pools.filter((pool) => showZeroPullPools || (pool.pullCount || 0) > 0 || pool.id === currentPoolId)
          : [];

        return {
          ...subgroup,
          allPools: subgroup.pools,
          pools: visiblePools,
          isExpanded,
          expansionOverride,
        };
      });

      return {
        ...group,
        subgroups,
        visiblePools: subgroups.flatMap((subgroup) => subgroup.pools),
      };
    })
    .filter(Boolean);
}

export function getPoolSelectorVisiblePoolCount(groups) {
  return (Array.isArray(groups) ? groups : []).reduce(
    (total, group) =>
      total +
      (Array.isArray(group.subgroups)
        ? group.subgroups.reduce((subgroupTotal, subgroup) => subgroupTotal + subgroup.pools.length, 0)
        : group.pools.length),
    0
  );
}

export function getSelectorVisiblePools({ pools, currentPoolId = null, expanded = false, limit = 5 }) {
  if (!Array.isArray(pools) || pools.length <= limit || expanded) {
    return {
      visiblePools: pools || [],
      hiddenPools: [],
      autoExpanded: false,
    };
  }

  const selectedIndex = pools.findIndex((pool) => pool.id === currentPoolId);
  const autoExpanded = selectedIndex >= limit;
  return {
    visiblePools: autoExpanded ? pools : pools.slice(0, limit),
    hiddenPools: autoExpanded ? [] : pools.slice(limit),
    autoExpanded,
  };
}
